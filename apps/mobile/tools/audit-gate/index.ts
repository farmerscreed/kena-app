// CLI entry — `npm run audit-gate`, CI's dependency-security step.
//
// Replaces a bare `npm audit --omit=dev --audit-level=high`, which had
// been failing continuously since 2026-08-14 and so had stopped
// carrying information: every run was red, so no run could tell you
// anything had changed.
//
// The reason it was permanently red is that `--omit=dev` does not mean
// "what ships". Expo declares its CLI, Metro and Babel as runtime
// dependencies, so the whole build toolchain is audited as if it were
// in the APK. Severity alone cannot separate the two.
//
// So this gate asks the question the old one meant to ask: can this
// advisory reach the shipped app? Anything not explicitly recorded in
// allowlist.ts as unreachable fails the build. Suppressions expire.

import { execFileSync } from 'child_process';
import { ALLOWLIST } from './allowlist';

interface AuditVulnerability {
  name: string;
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical';
  isDirect: boolean;
  via: (string | { title?: string; url?: string })[];
}

const BLOCKING: ReadonlySet<string> = new Set(['high', 'critical']);

function runAudit(): Record<string, AuditVulnerability> {
  let stdout: string;
  try {
    // npm audit exits non-zero when it finds anything, so a throw here
    // is the normal path and the payload still lands on stdout.
    stdout = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: string };
    if (!e.stdout) throw err;
    stdout = e.stdout;
  }
  return JSON.parse(stdout).vulnerabilities ?? {};
}

const today = new Date().toISOString().slice(0, 10);
const allowed = new Map(ALLOWLIST.map((e) => [e.package, e]));
const vulns = runAudit();

const blocking: AuditVulnerability[] = [];
const suppressed: { name: string; severity: string }[] = [];
const expired: { name: string; reviewBy: string }[] = [];

for (const [name, v] of Object.entries(vulns)) {
  // Only advisories filed against the package itself. An entry whose
  // `via` is all strings is inherited from a dependency and is
  // reported there too — counting it again would mean react-native
  // showing up because its CLI plugin has a finding.
  const ownAdvisory = v.via.some((entry) => typeof entry !== 'string');
  if (!ownAdvisory) continue;
  if (!BLOCKING.has(v.severity)) continue;

  const entry = allowed.get(name);
  if (!entry) {
    blocking.push(v);
  } else if (entry.reviewBy < today) {
    expired.push({ name, reviewBy: entry.reviewBy });
  } else {
    suppressed.push({ name, severity: v.severity });
  }
}

for (const s of suppressed) {
  console.log(`· allowed ${s.name} (${s.severity}) — ${allowed.get(s.name)!.reason}`);
}

for (const e of expired) {
  console.error(
    `✖ EXPIRED ${e.name} — the allowlist entry lapsed on ${e.reviewBy}. Re-verify it cannot reach the APK, then extend reviewBy, or fix the dependency.`,
  );
}

for (const v of blocking) {
  const titles = v.via
    .filter((entry): entry is { title?: string } => typeof entry !== 'string')
    .map((entry) => entry.title ?? 'advisory')
    .join('; ');
  console.error(
    `✖ ${v.severity.toUpperCase()} ${v.name}${v.isDirect ? ' (direct dependency)' : ''} — ${titles}`,
  );
}

const failures = blocking.length + expired.length;
console.log(
  `audit-gate: ${failures} blocking, ${suppressed.length} allowed (build-time only), reviewed against allowlist.ts`,
);

if (failures > 0) {
  console.error(
    '\nA finding is blocking because nothing in tools/audit-gate/allowlist.ts says it cannot reach the shipped app.\n' +
      'Fix the dependency, or add an entry that explains why it is unreachable.\n' +
      'Do NOT run `npm audit fix --force` here: it resolves these by downgrading react-native to 0.72.17.',
  );
  process.exit(1);
}
