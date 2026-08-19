// CLI entry — `npm run copy-lint` (CI step 5 per docs/05:186-196).
// Exit 1 on hard fails; soft warnings print and exit 0.

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scanTree } from './scanner';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const offences = scanTree(srcRoot);

const hard = offences.filter((o) => o.severity === 'hard');
const soft = offences.filter((o) => o.severity === 'soft');

for (const o of soft) {
  console.warn(
    `⚠ soft ${o.file}:${o.line} — "${o.text.slice(0, 80)}" [${o.hits.map((h) => h.why).join('; ')}]`,
  );
}
for (const o of hard) {
  console.error(
    `✖ HARD ${o.file}:${o.line} — "${o.text.slice(0, 80)}" [${o.hits.map((h) => h.why).join('; ')}]`,
  );
}

console.log(`copy-lint: ${hard.length} hard, ${soft.length} soft across the scanned tree.`);
if (hard.length > 0) process.exit(1);
