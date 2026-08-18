// D13 PR-3 done-when: "CI fails on a deliberately introduced HARD
// FAIL." These tests prove the gate bites.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ALLOWED_EXACT,
  extractUserVisibleStrings,
  scanTree,
} from '../scanner';

describe('extraction', () => {
  it('extracts JSX text, string literals and template statics', () => {
    const src = `
      const a = 'A calm sentence for the reader.';
      const b = \`Readings for \${name} this week\`;
      export function C() { return <Text>Worth a look today</Text>; }
    `;
    const texts = extractUserVisibleStrings(src, 'x.tsx').map((s) => s.text);
    expect(texts).toContain('A calm sentence for the reader.');
    expect(texts.some((t) => t.includes('Readings for'))).toBe(true);
    expect(texts).toContain('Worth a look today');
  });

  it('skips identifier-shaped literals (queries, keys, enum values)', () => {
    const src = `const q = supabase.from('family_members').select('user_id, users');`;
    expect(extractUserVisibleStrings(src, 'x.ts')).toEqual([]);
  });

  it('never extracts comments', () => {
    const src = `// the word diagnosis lives here in a comment about patients\nconst x = 1;`;
    expect(extractUserVisibleStrings(src, 'x.ts')).toEqual([]);
  });
});

describe('the gate bites', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'copy-lint-'));
    mkdirSync(join(dir, 'screens'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('a deliberately introduced HARD FAIL is caught with file:line', () => {
    writeFileSync(
      join(dir, 'screens', 'Bad.tsx'),
      `export const s = 'This will treat your condition before it is too late.';\n`,
    );
    const offences = scanTree(dir);
    expect(offences).toHaveLength(1);
    expect(offences[0].severity).toBe('hard');
    expect(offences[0].file).toBe(join('screens', 'Bad.tsx'));
    expect(offences[0].line).toBe(1);
  });

  it('an ALLOWED_EXACT string passes only as the exact full string', () => {
    writeFileSync(
      join(dir, 'screens', 'Ok.tsx'),
      `export const s = 'It is not a diagnosis.';\n`,
    );
    writeFileSync(
      join(dir, 'screens', 'NotOk.tsx'),
      `export const s = 'It is not a diagnosis. But here is more text.';\n`,
    );
    const offences = scanTree(dir);
    expect(offences.map((o) => o.file)).toEqual([join('screens', 'NotOk.tsx')]);
  });

  it('test files are excluded from the scan', () => {
    mkdirSync(join(dir, 'screens', '__tests__'), { recursive: true });
    writeFileSync(
      join(dir, 'screens', '__tests__', 'fixture.test.tsx'),
      `export const s = 'the silent killer phrase used as a test fixture';\n`,
    );
    expect(scanTree(dir)).toEqual([]);
  });

  it('every allowlist entry carries meaning — no empty strings', () => {
    for (const entry of ALLOWED_EXACT) {
      expect(entry.trim().length).toBeGreaterThan(0);
    }
  });
});
