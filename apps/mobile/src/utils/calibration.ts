// Calibration ladder — D13 PR-4 (§4.3, §6.2, §7.7; closes the
// "no calibration ladder" gap).
//
// Two jobs:
//
// 1. THE RING'S NEW MEANING (§6.2): stroke encodes data sufficiency,
//    not tier. Fill fraction = min(sampleCount / requiredCount, 1);
//    colour stays the learning grey until the §4.3 gate is met, then
//    takes the verdict's status colour. A vital below threshold never
//    shows a green check, an amber flag, or a filled ring.
//
// 2. THE STAGED UNLOCKS: each unlock is real capability arriving as
//    the data it needs accumulates — never manufactured achievement
//    (the §3.4 obligation test). Day thresholds per §10 PR-4:
//    1 / 2 / 4 / 7 / 14 / 21 / 30. Identifiers are internal; the only
//    user-facing strings live in LEARNING_COPY (§7.7 verbatim).

import type { Verdict, Classification, BaselineVital } from './classification';

/** §4.3 classification minimum, client mirror of the server
 *  SUFFICIENCY table (_shared/baselines.ts). Counts only — the
 *  distinct-days half of the gate is enforced where baselines are
 *  computed; the ring fill is a count-progress bar. */
export const REQUIRED_COUNT: Record<BaselineVital, number> = {
  bp_systolic: 10,
  bp_diastolic: 10,
  resting_hr: 7,
  spo2: 10,
  sleep_duration: 10,
  steps_daily: 10,
};

export interface RingCalibration {
  /** True → grey ring, partial fill, no coloured verdict anywhere. */
  isLearning: boolean;
  /** min(sampleCount / requiredCount, 1). */
  fillFraction: number;
  sampleCount: number;
  requiredCount: number;
}

/** Ring calibration from a verdict (or none at all — zero data). */
export function ringCalibration(
  verdict: Verdict | null | undefined,
  vital: BaselineVital,
): RingCalibration {
  const requiredCount = REQUIRED_COUNT[vital];
  const sampleCount = verdict?.sampleCount ?? 0;
  return {
    isLearning: verdict == null || verdict.tier === 'learning',
    fillFraction: Math.min(sampleCount / requiredCount, 1),
    sampleCount,
    requiredCount,
  };
}

/** BP convenience over the persisted Classification. A legacy row with
 *  no verdict predates the truth layer — treated as learning until the
 *  next classification writes one (grey is always safe; a colour from
 *  unknown provenance is not). */
export function bpRingCalibration(
  classification: Classification | null | undefined,
): RingCalibration {
  return ringCalibration(classification?.verdict ?? null, 'bp_systolic');
}

// ── Staged unlocks ───────────────────────────────────────────────────

export type UnlockCapability =
  | 'first_reading_visible'
  | 'day_over_day'
  | 'early_shape'
  | 'personal_band'
  | 'fourteen_day_trend'
  | 'context_conditioning'
  | 'full_window';

export interface UnlockStage {
  capability: UnlockCapability;
  /** Distinct days of readings this stage waits for. */
  atDay: number;
  /** The personal band additionally needs the §4.3 sufficiency gate —
   *  seven days alone is not a band. */
  requiresSufficiency: boolean;
}

export const UNLOCK_STAGES: readonly UnlockStage[] = [
  { capability: 'first_reading_visible', atDay: 1, requiresSufficiency: false },
  { capability: 'day_over_day', atDay: 2, requiresSufficiency: false },
  { capability: 'early_shape', atDay: 4, requiresSufficiency: false },
  { capability: 'personal_band', atDay: 7, requiresSufficiency: true },
  { capability: 'fourteen_day_trend', atDay: 14, requiresSufficiency: false },
  { capability: 'context_conditioning', atDay: 21, requiresSufficiency: false },
  { capability: 'full_window', atDay: 30, requiresSufficiency: false },
];

/** The capabilities the data has earned. Each unlock requires exactly
 *  the data it waits for — days can't be skipped, and sufficiency-gated
 *  stages stay locked on day count alone. */
export function unlockedCapabilities(
  distinctDays: number,
  isSufficient: boolean,
): UnlockCapability[] {
  return UNLOCK_STAGES.filter(
    (s) => distinctDays >= s.atDay && (!s.requiresSufficiency || isSufficient),
  ).map((s) => s.capability);
}

// ── §7.7 learning copy — verbatim, one definition site ───────────────

export const LEARNING_COPY = {
  vitalDetail: {
    headline: 'Still learning',
    body: (n: number, required: number, name: string): string =>
      `We have ${n} of the ${required} readings we need before we can tell you what's usual for ${name}.`,
  },
  monitorAllLearning: {
    headline: (name: string): string => `Getting to know ${name}`,
    body: 'Each of these fills in as readings come through. Most take about a week.',
  },
  correlationLearning: {
    headline: 'Not yet',
    body: "We compare things once there's enough to compare. We'll tell you when there is.",
  },
} as const;
