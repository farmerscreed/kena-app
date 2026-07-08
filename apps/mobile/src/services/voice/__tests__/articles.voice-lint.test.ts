// articles.voice-lint.test.ts — Sprint 13.
//
// Loads every checked-in MDX article from
// apps/mobile/src/learn/articles/ and asserts each passes voice-lint.
// This is the integration test that gates article PRs at CI time.
//
// Soft hits are surfaced via console.warn but do NOT fail the build —
// they are review-prompts, not hard fails.

import * as fs from 'fs';
import * as path from 'path';
import { lintVoiceText, formatVoiceHits } from '../voiceLint';

const ARTICLES_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'learn',
  'articles',
);

function loadArticleFiles(): Array<{ name: string; body: string }> {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  return fs
    .readdirSync(ARTICLES_DIR)
    .filter(f => f.endsWith('.mdx'))
    .map(f => ({
      name: f,
      body: fs.readFileSync(path.join(ARTICLES_DIR, f), 'utf8'),
    }));
}

describe('Learn articles — voice-lint', () => {
  const articles = loadArticleFiles();

  it('finds at least one article (smoke)', () => {
    expect(articles.length).toBeGreaterThan(0);
  });

  for (const article of articles) {
    it(`${article.name} — passes voice-lint (no HARD hits)`, () => {
      const result = lintVoiceText(article.body);
      if (result.hardHits.length > 0) {
        // Help the reader by formatting hits inline in the failure
        // message instead of dumping the raw object graph.
        throw new Error(
          `${article.name} has voice-lint HARD hits:\n` +
            formatVoiceHits(result.hardHits),
        );
      }
      // Surface soft hits as a warning, but keep the build green.
      if (result.softHits.length > 0) {
         
        console.warn(
          `[voice-lint soft] ${article.name}\n` +
            formatVoiceHits(result.softHits),
        );
      }
      expect(result.passes).toBe(true);
    });
  }
});
