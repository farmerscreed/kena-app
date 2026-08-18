// §7.5 correlation copy — verbatim; these tests ARE the table.
import { correlationCopy, CORRELATION_MIN_N } from '../correlationCopy';
import { subjectFor, SELF_SUBJECT } from '../tierVocabulary';
import { lintVoiceText } from '../voiceLint';

const mum = subjectFor('Mum', 'her');

it('counting — the §7.5 sentence at three nights', () => {
  expect(correlationCopy.counting(3, mum)).toBe(
    'Three more nights and we can tell you whether short sleep is showing up in her morning numbers.',
  );
});

it('found + honest negative are the table rows', () => {
  expect(correlationCopy.found('Mum', 16)).toBe(
    "On nights after shorter sleep, Mum's morning readings have run higher. We've seen this across 16 nights.",
  );
  expect(correlationCopy.honestNegative('Mum', 16)).toBe(
    "We looked at sleep and Mum's morning readings across 16 nights and didn't find a pattern. That's common, and it isn't a problem.",
  );
  expect(correlationCopy.missingInput).toBe(
    `We'll need a few more readings tagged "after meds" before we can compare.`,
  );
});

it('the n-threshold is the engine\'s and is not weakened', () => {
  expect(CORRELATION_MIN_N).toBe(14);
});

it('every string passes the voice lint and never implies causation', () => {
  for (const text of [
    correlationCopy.counting(3, SELF_SUBJECT),
    correlationCopy.found('Mum', 16),
    correlationCopy.honestNegative('Mum', 16),
    correlationCopy.missingInput,
  ]) {
    expect(lintVoiceText(text).hardHits).toEqual([]);
    expect(text).not.toMatch(/because|causes|caused|leads to|will lower|improves/i);
  }
});
