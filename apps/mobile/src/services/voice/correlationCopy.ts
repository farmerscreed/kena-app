// Correlation disclosure copy — D13 PR-11 (§7.5). One definition site,
// verbatim from the table. Never imply causation; never recommend an
// action from a correlation. The engine's thresholds (n≥14, |r|≥0.3,
// p<0.05) are NOT weakened to make a finding appear — when a pair
// clears n but fails r or p, the honest negative renders instead of
// nothing.

import type { Subject } from './tierVocabulary';

export const correlationCopy = {
  counting: (nightsRemaining: number, subject: Subject): string =>
    nightsRemaining === 3
      ? `Three more nights and we can tell you whether short sleep is showing up in ${subject.possessive} morning numbers.`
      : `${numberWord(nightsRemaining)} more night${nightsRemaining === 1 ? '' : 's'} and we can tell you whether short sleep is showing up in ${subject.possessive} morning numbers.`,
  found: (name: string, n: number): string =>
    `On nights after shorter sleep, ${name}'s morning readings have run higher. We've seen this across ${n} nights.`,
  honestNegative: (name: string, n: number): string =>
    `We looked at sleep and ${name}'s morning readings across ${n} nights and didn't find a pattern. That's common, and it isn't a problem.`,
  missingInput: `We'll need a few more readings tagged "after meds" before we can compare.`,
} as const;

function numberWord(n: number): string {
  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen'];
  return words[n] ?? String(n);
}

/** §6.6 — the engine's n-threshold. Do not weaken. */
export const CORRELATION_MIN_N = 14;
