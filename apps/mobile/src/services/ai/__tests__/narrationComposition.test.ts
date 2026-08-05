// narrationComposition — Sprint 19 (audit D12 P0-7).
//
// Slot-level tests are not enough. `dailyNarration.test.ts` asserted
// `slots.bp_delta === 'six below her week'` and passed for months while
// the RENDERED sentence read:
//
//   "Mum's morning number is six below her week above her week."
//
// …because the template supplied "above her week" too. A user on any
// calm-concerned BP day saw that. CI was green throughout.
//
// This suite renders every template against real slots and asserts
// properties of the finished sentence. Any future template that
// double-supplies a phrase, or any slot deriver that grows past a bare
// value, fails here.

import { renderNarration } from '../dailyNarration';
import { NARRATION_TEMPLATES } from '../narrationTemplates';
import type { NarrationSlots } from '../dailyNarration';

/**
 * Every slot filled with a value shaped like the real deriver's output.
 * `bp_delta` carries the complete predicate form the templates now
 * expect.
 */
const SLOTS: NarrationSlots = {
  parent_label: 'Dad',
  bp_value: '124/79',
  bp_delta: "six above the week's average",
  bp_week_avg: '130/82',
  hr_resting: '64',
  hr_delta: 'two below',
  spo2_overnight: '97',
  sleep_total: '7h 12m',
  sleep_delta: 'about the same',
  steps_today: '4,166',
  steps_target_hits: 'four days',
} as NarrationSlots;

function renderAll(): { id: string; text: string }[] {
  return NARRATION_TEMPLATES.map((t) => ({
    id: t.id,
    text: renderNarration(t.text, SLOTS),
  }));
}

describe('narration composition', () => {
  it('never repeats a phrase a slot already supplied', () => {
    // The exact failure mode from P0-7: the slot ends with "…average"
    // and the template appends "above her week" / "below her week".
    for (const { id, text } of renderAll()) {
      expect(`${id}: ${text}`).not.toMatch(
        /(week's average|higher than usual)\s+(above|below|than)\b/i,
      );
    }
  });

  it('never emits two directional words in one sentence', () => {
    // The literal P0-7 output was "…is six below her week above her
    // week." — note the two DIFFERENT directionals, which is why a
    // backreference (\1) would miss it. Any sentence carrying both an
    // "above" and a "below" is describing one delta twice.
    for (const { id, text } of renderAll()) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        expect(`${id}: ${sentence}`).not.toMatch(
          /\b(?:above|below)\b[^.]*\b(?:above|below)\b/i,
        );
      }
    }
  });

  it('leaves no unsubstituted slot placeholders', () => {
    for (const { id, text } of renderAll()) {
      expect(`${id}: ${text}`).not.toMatch(/\{[a-z_]+\}/);
    }
  });

  it('never emits gendered pronouns — parent_label may be "Dad"', () => {
    // The audit found "Dad's resting heart rate is outside her usual
    // range." shipping in the highest-stakes copy in the product.
    for (const { id, text } of renderAll()) {
      expect(`${id}: ${text}`).not.toMatch(/\b(her|hers|his|she|he)\b/i);
    }
  });

  it('produces sentences that terminate cleanly', () => {
    for (const { id, text } of renderAll()) {
      expect(`${id}: ${text}`).toMatch(/[.!?]$/);
      // No double spaces or space-before-punctuation from a slot that
      // rendered empty.
      expect(`${id}: ${text}`).not.toMatch(/\s{2,}|\s[.,]/);
    }
  });
});
