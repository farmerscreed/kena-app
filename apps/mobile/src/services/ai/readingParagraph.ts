// services/ai/readingParagraph — Sprint 12.5 session 2.
//
// Tier-A reading-detail paragraph generator (D14 §4). Each BP
// reading detail screen shows a 2-4 sentence paragraph that
// contextualises the reading across the constellation. Tier-A
// runs synchronously on the device (Sprint 11 voice-clean templates
// adapted per-reading); Tier-B novel-pattern path lands in a later
// session via an Edge Function.
//
// Templates are simpler than the daily-narration set — there's only
// one "now" (this reading) so the central-vital decision tree from
// D13 §7.2 doesn't apply. We branch on the reading's own
// classification tier and weave in the adjacent vital context
// (sleep, activity) when present.

import type { LocalReading } from '../../state/readings';
import type { Classification } from '../../utils/classification';

// ── Slot derivers ─────────────────────────────────────────────────────

function formatSleepTotal(totalMinutes: number | null | undefined): string {
  if (totalMinutes === null || totalMinutes === undefined || totalMinutes === 0) {
    return '';
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function bpDeltaWord(latestSys: number, weekAvgSys: number | null | undefined): string {
  if (weekAvgSys === null || weekAvgSys === undefined) return '';
  const diff = latestSys - weekAvgSys;
  const word = (n: number): string => {
    const map: Record<number, string> = {
      1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
      6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
    };
    return map[n] ?? `${n}`;
  };
  const abs = Math.abs(diff);
  if (abs < 1) return 'in line with the week';
  return diff < 0
    ? `${word(abs)} below the week`
    : `${word(abs)} above the week`;
}

// ── Template library (intentionally small for v1.0) ───────────────────

export interface ReadingParagraphInput {
  reading: LocalReading;
  classification: Classification;
  parentLabel: string;
  weekAverageSystolic?: number | null;
  /** Last night's sleep total in minutes — when it's a morning reading. */
  sleepTotalMinutes?: number | null;
  /** Whether sleep is a known calm_concerned signal (poor sleep). */
  sleepConcerning?: boolean;
}

export interface ReadingParagraphResult {
  text: string;
  templateId: string;
  tier: 'A';
}

/**
 * Generate a 1–3 sentence contextual paragraph for a reading.
 * Voice-clean by construction; every branch passes D11 §3 / CLAUDE.md
 * voice rules. Branches on the classification tier and weaves
 * adjacent vital context when present.
 */
export function generateReadingParagraphTierA(
  input: ReadingParagraphInput,
): ReadingParagraphResult {
  const { reading, classification, parentLabel } = input;
  const sleepTotal = formatSleepTotal(input.sleepTotalMinutes ?? null);
  const delta = bpDeltaWord(reading.systolic, input.weekAverageSystolic ?? null);
  const tier = classification.tier;

  // confirmed_urgent: keep the language calm, redirect to the
  // doctor without alarmism.
  if (tier === 'confirmed_urgent') {
    return {
      text: `This reading is above ${parentLabel}'s usual week. Worth a calm check-in with the doctor at the next chance.`,
      templateId: 'reading.confirmed_urgent',
      tier: 'A',
    };
  }

  // calm_concerned: lean on the sleep correlation per D14 §4.2 if
  // sleep was poor; otherwise factual descriptor.
  if (tier === 'calm_concerned') {
    if (input.sleepConcerning && sleepTotal) {
      return {
        text: `This reading is ${delta || 'a little above the week'} for ${parentLabel}. ${parentLabel} slept ${sleepTotal} last night — these often go together.`,
        templateId: 'reading.calm_concerned.sleep_poor',
        tier: 'A',
      };
    }
    return {
      text: `This reading is ${delta || 'a little above the week'} for ${parentLabel}. Worth a closer look later when there's another reading to compare.`,
      templateId: 'reading.calm_concerned.factual',
      tier: 'A',
    };
  }

  // in_pattern → §7.4 'in {possessive} usual range' framing (D13 PR-2).
  if (sleepTotal) {
    return {
      text: `This reading is in ${parentLabel}'s usual range. ${parentLabel} slept ${sleepTotal} last night — both look good against the week.`,
      templateId: 'reading.in_pattern.with_sleep',
      tier: 'A',
    };
  }
  return {
    text: `This reading is in ${parentLabel}'s usual range.`,
    templateId: 'reading.in_pattern.bare',
    tier: 'A',
  };
}
