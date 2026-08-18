// D13 PR-9 (§9.1): a bare <View accessibilityLabel=…> is likely not
// exposed on iOS. Every labelled View carries an explicit `accessible`
// (or is deliberately hidden from the tree). AST-checked so comments
// and strings can't false-positive; this is the regression guard for
// the 31-site sweep.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

const SRC = join(__dirname, '..', '..');

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) {
      if (e === '__tests__' || e === '__mocks__' || e === '__snapshots__') continue;
      yield* walk(f);
    } else if (f.endsWith('.tsx')) yield f;
  }
}

it('every labelled View is explicitly accessible or explicitly hidden', () => {
  const offenders: string[] = [];
  for (const root of ['components', 'screens']) {
    for (const file of walk(join(SRC, root))) {
      const source = readFileSync(file, 'utf8');
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(sf);
          if (tag === 'View' || tag === 'Animated.View') {
            const names = node.attributes.properties
              .filter(ts.isJsxAttribute)
              .map((p) => p.name.getText(sf));
            if (
              names.includes('accessibilityLabel') &&
              !names.includes('accessible') &&
              !names.includes('accessibilityElementsHidden')
            ) {
              const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
              offenders.push(`${relative(SRC, file)}:${line + 1}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  expect(offenders).toEqual([]);
});
