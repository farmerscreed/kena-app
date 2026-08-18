// tools/copy-lint — D13 PR-3 (§9.2, closes the docs/05 "CI
// implementation contract" gap). The contract at docs/05:186-196
// specified this gate in Sprint 1; it never existed, which is how two
// live HARD-FAIL violations shipped.
//
// What it scans: string literals, template literals and JSX text nodes
// in src/{screens,components,utils,services,state} — the surfaces a
// user can read. Extraction uses the TypeScript AST (not regex over
// source) so comments and identifiers never false-positive.
//
// What it lints with: services/voice/voiceLint.ts — the same 30-rule
// dictionary the unit suites use. One dictionary, two enforcement
// points (tests for what tests cover; this gate for everything else).
//
// ALLOWED_EXACT: exact, full-string allowlist. docs/05's own rules can
// legitimately appear inside copy that NEGATES them — the canonical
// example is the IFU-mandated disclaimer "It is not a diagnosis.",
// which the /diagnos/ rule would otherwise block (and the natural
// reaction to a false positive on a legally required string would be
// to weaken the rule — D13 §9.2 calls this out explicitly). Every
// entry must carry a justification comment. Substrings do NOT match:
// the allowlist compares the whole extracted string.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { lintVoiceText, type VoiceHit } from '../../src/services/voice/voiceLint';

export interface CopyLintOffence {
  file: string;
  line: number;
  text: string;
  hits: VoiceHit[];
  severity: 'hard' | 'soft';
}

/** Exact strings allowed despite dictionary matches. Full-string
 *  comparison after trimming — a substring never qualifies. */
export const ALLOWED_EXACT: ReadonlySet<string> = new Set([
  // IFU-mandated disclaimer (docs/03; legally required wording). The
  // sentence NEGATES a diagnosis claim — the rule exists to stop us
  // MAKING one.
  'It is not a diagnosis.',
  "This is a statistical observation about the wearer's own pattern — it is not a diagnosis.",
  // Settings row linking to the clinician-facing IFU document.
  'Instructions for use',
  // Doctor-report disclaimer (JSX fragment before the {possessive}
  // slot) — the sentence NEGATES a diagnosis claim.
  'This report is general information. It is not a diagnosis. Please discuss with',
  // Clinical-context capture: asks whether a DOCTOR made the
  // diagnosis — attribution, not a claim. Flagged for founder review
  // in D13 PR-3; if the wording changes, change it here too.
  'Diagnosed with hypertension?',
  // "Battery optimisation" is the Android OS feature's proper name
  // (Settings → Apps → Battery optimisation), not wellness vocabulary.
  'Battery optimisation is delaying syncs. Tap to allow Leiko to run in the background.',
]);

const SCAN_ROOTS = ['screens', 'components', 'utils', 'services', 'state'];

/** Literals without whitespace are identifiers, keys, URLs, enum
 *  values — never prose a user reads. Comma-separated identifier lists
 *  (query select clauses like "user_id, users") are skipped when any
 *  token carries an identifier marker (_ : ( ) * !) — prose never
 *  does, so "just now" still scans. */
function looksLikeCopy(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 4) return false;
  if (!/\s/.test(trimmed)) return false;
  const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
  const allIdentifierish = tokens.every((t) => /^[a-zA-Z0-9_*.:!()<>=-]+$/.test(t));
  // A prose comma is not a marker — only identifier punctuation inside
  // a token ("user_id", "count(*)") marks a select-list, otherwise
  // "Small, brief dips…" would be skipped as a column list.
  const hasMarker = tokens.some((t) => /[_:()*!]/.test(t));
  if (allIdentifierish && hasMarker) return false;
  return true;
}

function shouldSkipFile(path: string): boolean {
  return (
    path.includes('__tests__') ||
    path.includes('__fixtures__') ||
    path.includes('__mocks__') ||
    path.endsWith('.test.ts') ||
    path.endsWith('.test.tsx') ||
    path.endsWith('.d.ts') ||
    // The lint dictionary itself and the canonical vocabulary carry
    // rule phrases by definition.
    path.endsWith('services/voice/voiceLint.ts')
  );
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkFiles(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

interface ExtractedString {
  text: string;
  line: number;
  /** True when the string is a template with data slots — its static
   *  fragments were joined for linting, but any claim it makes is
   *  anchored to interpolated data. */
  interpolated: boolean;
}

export function extractUserVisibleStrings(source: string, fileName: string): ExtractedString[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: ExtractedString[] = [];
  const push = (node: ts.Node, text: string, interpolated = false) => {
    if (!looksLikeCopy(text)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push({ text: text.trim(), line: line + 1, interpolated });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      push(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      // Lint the static text of a template — the slots are data.
      const staticText = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
      push(node, staticText, true);
    } else if (ts.isJsxText(node)) {
      push(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function scanTree(srcRoot: string): CopyLintOffence[] {
  const offences: CopyLintOffence[] = [];
  for (const root of SCAN_ROOTS) {
    const dir = join(srcRoot, root);
    let stats;
    try { stats = statSync(dir); } catch { continue; }
    if (!stats.isDirectory()) continue;
    for (const file of walkFiles(dir)) {
      if (shouldSkipFile(file)) continue;
      const source = readFileSync(file, 'utf8');
      for (const { text, line } of extractUserVisibleStrings(source, file)) {
        if (ALLOWED_EXACT.has(text)) continue;
        const result = lintVoiceText(text);
        if (result.hardHits.length > 0) {
          offences.push({ file: relative(srcRoot, file), line, text, hits: result.hardHits, severity: 'hard' });
        } else if (result.softHits.length > 0) {
          offences.push({ file: relative(srcRoot, file), line, text, hits: result.softHits, severity: 'soft' });
        }
      }
    }
  }
  return offences;
}
