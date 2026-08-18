import type { VitalKind } from '../types/vitals';
export type { VitalKind };

// Reading classification — Sprint 6; truth-layer contract since D13 PR-1.
//
// `classifyVital` is the canonical classifier (D13 §4.4): it judges one
// value against the person's OWN 28-day baseline row (vital_baselines,
// served through utils/vitalBaselines.resolveBpBaselines). Rules, in
// spec order:
//
//   1. Absolute floor — systolic ≥ 180 or diastolic ≥ 120 →
//      talk_to_doctor, regardless of band and regardless of
//      sufficiency. The one place an absolute number drives the UI.
//   2. No baseline / insufficient → learning. Below the §4.3 gate no
//      surface shows a coloured verdict — not amber, not green.
//   3. Inside [p10, p90] → in_range.
//   4. Outside mean ± 2σ → worth_a_look.
//   5. Between p90 and mean + 2σ (and mirrored below) → in_range —
//      the band edge is soft; never flag on the shoulder.
//
// talk_to_doctor from outside_band requires CONFIRMATION, never a
// single reading: three consecutive readings outside mean ± 2σ on the
// same side within 72 hours (`confirmedOutsideBand`), or the absolute
// floor. A single outlier never escalates past worth_a_look.
//
// `classifyReading` remains the entry point the app calls, as a thin
// adapter: it classifies systolic and diastolic against their own
// baselines, keeps the legacy tier/reason vocabulary that is persisted
// in MMKV and consumed by every UI surface, and carries the full
// Verdict alongside for PR-2 to surface. Pulse no longer participates
// in BP classification — resting HR is its own vital with its own
// baseline row.
//
// HARD RULE per CLAUDE.md + D3: this is a STATISTICAL classification,
// not a clinical one. Verdicts are statements about the person's own
// baseline; UI strings never name a clinical category. See
// docs/05-voice-and-claims.md.

import type { BaselineVital, VitalBaseline, BpBaselinePair } from './vitalBaselines';
export type { BaselineVital, VitalBaseline, BpBaselinePair };

// Tier taxonomy per D13 §6 — `in_pattern` (premium-pulse framing) replaces
// the Sprint 6 `in_range` literal. Display string is "In your usual range".
export type ClassificationTier = 'in_pattern' | 'calm_concerned' | 'confirmed_urgent';

/** D13 §4.4 canonical tiers. The legacy ClassificationTier above maps
 *  1:1 (learning+in_range → in_pattern) until PR-2 swaps the UI over. */
export type Tier = 'learning' | 'in_range' | 'worth_a_look' | 'talk_to_doctor';

export type VerdictReason =
  | 'insufficient_data'
  | 'inside_band'
  | 'outside_band'
  | 'absolute_floor';

export interface Verdict {
  tier: Tier;
  reason: VerdictReason;
  band: { low: number; high: number } | null;
  /** Signed, in units of the vital: value − mean. Null without a baseline. */
  deviation: number | null;
  sampleCount: number;
  windowDays: number;
  /** True when computed from the offline fallback baseline. */
  provisional: boolean;
}

export interface ReadingForClassification {
  systolic: number;
  diastolic: number;
  pulse?: number | null;
}

export interface Classification {
  tier: ClassificationTier;
  reason:
    | 'crisis_absolute'
    | 'absolute_cold_start'
    | 'cold_start'
    | 'outlier_and_soft_threshold'
    | 'outside_band_confirmed'
    | 'within_baseline';
  /** The winning canonical verdict (D13 §4.4), carried for PR-2's
   *  surfaces. Optional so Classification objects persisted in MMKV
   *  before PR-1 stay valid. */
  verdict?: Verdict;
}

const ABSOLUTE_FLOOR_SYS = 180;
const ABSOLUTE_FLOOR_DIA = 120;
const SIGMA_MULTIPLIER = 2;
const CONFIRMATION_COUNT = 3;
const CONFIRMATION_WINDOW_SEC = 72 * 3600;

function isAtAbsoluteFloor(vital: BaselineVital, value: number): boolean {
  return (
    (vital === 'bp_systolic' && value >= ABSOLUTE_FLOOR_SYS) ||
    (vital === 'bp_diastolic' && value >= ABSOLUTE_FLOOR_DIA)
  );
}

/** Canonical single-value classifier — D13 §4.4, rules in order. */
export function classifyVital(
  input: { vital: BaselineVital; value: number; contextTag?: string | null },
  baseline: VitalBaseline | null,
): Verdict {
  const { vital, value } = input;
  const common = {
    band: baseline && baseline.isSufficient ? { low: baseline.p10, high: baseline.p90 } : null,
    deviation: baseline ? value - baseline.mean : null,
    sampleCount: baseline?.sampleCount ?? 0,
    windowDays: baseline?.windowDays ?? 28,
    provisional: baseline?.provisional ?? false,
  };

  // 1. The absolute floor beats everything, including insufficiency.
  if (isAtAbsoluteFloor(vital, value)) {
    return { tier: 'talk_to_doctor', reason: 'absolute_floor', ...common };
  }

  // 2. Below the §4.3 gate every surface renders the learning state.
  if (!baseline || !baseline.isSufficient) {
    return { tier: 'learning', reason: 'insufficient_data', ...common };
  }

  // 3. Inside the display band.
  if (value >= baseline.p10 && value <= baseline.p90) {
    return { tier: 'in_range', reason: 'inside_band', ...common };
  }

  // 4. Outside the classification band.
  const spread = SIGMA_MULTIPLIER * baseline.sd;
  if (value > baseline.mean + spread || value < baseline.mean - spread) {
    return { tier: 'worth_a_look', reason: 'outside_band', ...common };
  }

  // 5. The shoulder between p90 and mean + 2σ (and its mirror) is soft.
  return { tier: 'in_range', reason: 'inside_band', ...common };
}

/** One historical value for the confirmation rule. */
export interface HistoryEntry {
  value: number;
  measuredAtSec: number;
}

/**
 * D13 §4.4 confirmation: true when the three most recent entries are
 * all outside mean ± 2σ on the SAME side and span ≤ 72 hours.
 * `history` must be most-recent-first and INCLUDE the reading being
 * judged. Only meaningful for the latest reading — never call it when
 * re-classifying an older row.
 */
export function confirmedOutsideBand(
  history: readonly HistoryEntry[],
  baseline: VitalBaseline,
): boolean {
  if (!baseline.isSufficient) return false;
  if (history.length < CONFIRMATION_COUNT) return false;
  const recent = history.slice(0, CONFIRMATION_COUNT);
  const spanSec = recent[0].measuredAtSec - recent[CONFIRMATION_COUNT - 1].measuredAtSec;
  if (spanSec < 0 || spanSec > CONFIRMATION_WINDOW_SEC) return false;
  const spread = SIGMA_MULTIPLIER * baseline.sd;
  const high = baseline.mean + spread;
  const low = baseline.mean - spread;
  const allAbove = recent.every((e) => e.value > high);
  const allBelow = recent.every((e) => e.value < low);
  return allAbove || allBelow;
}

const TIER_SEVERITY: Record<Tier, number> = {
  learning: 0,
  in_range: 1,
  worth_a_look: 2,
  talk_to_doctor: 3,
};

const LEGACY_TIER: Record<Tier, ClassificationTier> = {
  learning: 'in_pattern',
  in_range: 'in_pattern',
  worth_a_look: 'calm_concerned',
  talk_to_doctor: 'confirmed_urgent',
};

function legacyReason(verdict: Verdict): Classification['reason'] {
  switch (verdict.tier) {
    case 'learning':
      return 'cold_start';
    case 'in_range':
      return 'within_baseline';
    case 'worth_a_look':
      return 'outlier_and_soft_threshold';
    case 'talk_to_doctor':
      return verdict.reason === 'absolute_floor'
        ? 'crisis_absolute'
        : 'outside_band_confirmed';
  }
}

/** A prior reading, for the confirmation rule at live-capture sites. */
export interface ReadingHistoryEntry {
  systolic: number;
  diastolic: number;
  measuredAtSec: number;
}

/**
 * The app-facing adapter. Judges systolic and diastolic against their
 * own baselines and returns the more severe verdict in the legacy
 * shape every consumer (and MMKV) already understands.
 *
 * `history` — most-recent-first, INCLUDING the reading being judged —
 * enables the three-consecutive confirmation. Pass it only when
 * classifying the latest reading (live capture, latest-reading status);
 * batch re-classification of older rows must omit it.
 */
export function classifyReading(
  reading: ReadingForClassification,
  baselines?: BpBaselinePair | null,
  history?: readonly ReadingHistoryEntry[],
): Classification {
  const sysVerdict = classifyVital(
    { vital: 'bp_systolic', value: reading.systolic },
    baselines?.systolic ?? null,
  );
  const diaVerdict = classifyVital(
    { vital: 'bp_diastolic', value: reading.diastolic },
    baselines?.diastolic ?? null,
  );

  let worst =
    TIER_SEVERITY[diaVerdict.tier] > TIER_SEVERITY[sysVerdict.tier]
      ? diaVerdict
      : sysVerdict;

  // Confirmation: a worth_a_look latest reading escalates when three
  // consecutive readings sit outside the band on the same side in 72h.
  if (worst.tier === 'worth_a_look' && history && history.length >= CONFIRMATION_COUNT) {
    const sysConfirmed =
      sysVerdict.tier === 'worth_a_look' &&
      baselines?.systolic != null &&
      confirmedOutsideBand(
        history.map((h) => ({ value: h.systolic, measuredAtSec: h.measuredAtSec })),
        baselines.systolic,
      );
    const diaConfirmed =
      diaVerdict.tier === 'worth_a_look' &&
      baselines?.diastolic != null &&
      confirmedOutsideBand(
        history.map((h) => ({ value: h.diastolic, measuredAtSec: h.measuredAtSec })),
        baselines.diastolic,
      );
    if (sysConfirmed || diaConfirmed) {
      worst = { ...worst, tier: 'talk_to_doctor' };
    }
  }

  return { tier: LEGACY_TIER[worst.tier], reason: legacyReason(worst), verdict: worst };
}

// UI helpers — thin shims over the canonical vocabulary
// (services/voice/tierVocabulary, D13 §7.4). One definition site;
// these keep the legacy ClassificationTier signatures that existing
// surfaces call with, defaulting to the self subject. Caregiver
// surfaces pass their own Subject as they migrate (PR-7/PR-8).

import {
  chipTextForTier,
  sentenceFragmentForTier,
  SELF_SUBJECT,
  type Subject,
} from '../services/voice/tierVocabulary';
export type { Subject };

/** Legacy tier → canonical §4.4 tier. Without a Verdict the legacy
 *  in_pattern is ambiguous (learning vs in_range); callers that have
 *  a Classification should use canonicalTierFor instead. */
export function canonicalTierForLegacy(tier: ClassificationTier): Tier {
  switch (tier) {
    case 'in_pattern':
      return 'in_range';
    case 'calm_concerned':
      return 'worth_a_look';
    case 'confirmed_urgent':
      return 'talk_to_doctor';
  }
}

/** Canonical tier for a full Classification — verdict-aware, so the
 *  learning state survives the legacy shape. */
export function canonicalTierFor(classification: Classification): Tier {
  return classification.verdict?.tier ?? canonicalTierForLegacy(classification.tier);
}

/** UI string for the tier chip. */
export function tierChipText(
  tier: ClassificationTier,
  subject: Subject = SELF_SUBJECT,
): string {
  return chipTextForTier(canonicalTierForLegacy(tier), subject);
}

/**
 * The hero sub-line under a vital value — "<unit> · <verdict>".
 * A null tier yields the bare unit: we say nothing rather than guess.
 */
export function vitalRangeCopyForTier(
  unit: string,
  tier: ClassificationTier | null | undefined,
  subject: Subject = SELF_SUBJECT,
): string {
  if (tier == null) return unit;
  const fragment = sentenceFragmentForTier(canonicalTierForLegacy(tier), subject);
  // "is in your usual range" → "in your usual range" for the sub-line.
  return `${unit} · ${fragment.replace(/^is /, '')}`;
}

export function tierPillVariant(tier: ClassificationTier): 'success' | 'accent' | 'urgent' {
  switch (tier) {
    case 'in_pattern':
      return 'success';
    case 'calm_concerned':
      return 'accent';
    case 'confirmed_urgent':
      return 'urgent';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Multi-vital classifiers — Sprint 7.5.
//
// Per docs/_reference/D13-multi-vitals-constellation-spec.md §6.2-§6.6.
// Each classifier returns the narrowest tier subset its vital allows
// (Sleep never goes confirmed_urgent; Activity only ever in_pattern or
// progress) so consumers don't have to handle states a given vital
// can't produce.
//
// Inputs are vital-specific aggregates (resting HR for the day, the
// last 14 nights of overnight-low SpO2, the latest sleep session) —
// not raw watch samples. The aggregation lives in the state slices
// (state/hr.ts etc.); these classifiers stay pure for testability.
//
// HARD RULE per CLAUDE.md + D3: same as BP — STATISTICAL, not clinical.
// Reasons are machine-readable; UI strings come from tierChipText (BP)
// or per-vital UI helpers introduced when the detail screens land.
// ─────────────────────────────────────────────────────────────────────

// HR ─────────────────────────────────────────────────────────────────

export interface HRClassificationInput {
  /** Resting HR for the user today, in bpm. Per D13 §2.2 this is the
   *  lowest 10-min rolling-average HR sample during the user's sleep
   *  window — the state slice computes it from raw HR samples. */
  restingBpmToday: number;
  /** Last 14 days of `restingBpmToday` values, oldest first. Used to
   *  compute the median baseline and the 3-day trend. Length < 14
   *  triggers the cold-start branch. The today value is NOT included. */
  restingBpmRecent: number[];
}

export interface HRClassification {
  tier: ClassificationTier;
  reason:
    | 'extreme_value'
    | 'cold_start_in_band'
    | 'cold_start_outside_band'
    | 'baseline_within'
    | 'baseline_3day_trend'
    | 'sustained_high_at_rest';
}

const HR_EXTREME_LOW = 40;       // < this is confirmed_urgent
const HR_EXTREME_HIGH = 130;     // > this is confirmed_urgent
const HR_COLD_BAND_LOW = 50;
const HR_COLD_BAND_HIGH = 95;
const HR_TREND_DELTA_BPM = 15;       // > baseline + 15 for 3 days = trend
const HR_HIGH_AT_REST = 100;         // > this at rest = calm_concerned
const HR_MIN_BASELINE_DAYS = 14;
const HR_TREND_DAYS = 3;

export function classifyHR(input: HRClassificationInput): HRClassification {
  const { restingBpmToday, restingBpmRecent } = input;

  // Confirmed-urgent always wins. Per D13 §6.2 the spec language is
  // "sustained at rest" — we trigger on a single sample because the
  // ingest-layer rule only writes a sample when the watch reports
  // motion_state='rest' (sensor-error fallback per §6.2 last paragraph).
  if (restingBpmToday < HR_EXTREME_LOW || restingBpmToday > HR_EXTREME_HIGH) {
    return { tier: 'confirmed_urgent', reason: 'extreme_value' };
  }

  // Cold-start: < 14 days of baseline data.
  if (restingBpmRecent.length < HR_MIN_BASELINE_DAYS) {
    if (restingBpmToday >= HR_COLD_BAND_LOW && restingBpmToday <= HR_COLD_BAND_HIGH) {
      return { tier: 'in_pattern', reason: 'cold_start_in_band' };
    }
    return { tier: 'calm_concerned', reason: 'cold_start_outside_band' };
  }

  // Hot path: median baseline.
  const sorted = [...restingBpmRecent].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // 3-day trend: today + last 2 days all > baseline + 15.
  const last3 = [...restingBpmRecent.slice(-(HR_TREND_DAYS - 1)), restingBpmToday];
  if (
    last3.length === HR_TREND_DAYS &&
    last3.every((bpm) => bpm > median + HR_TREND_DELTA_BPM)
  ) {
    return { tier: 'calm_concerned', reason: 'baseline_3day_trend' };
  }

  // Sustained high at rest.
  if (restingBpmToday > HR_HIGH_AT_REST) {
    return { tier: 'calm_concerned', reason: 'sustained_high_at_rest' };
  }

  // Within baseline ±10 bpm AND within absolute 50-95 → in_pattern.
  // Anything else also returns in_pattern (D13's §6.2 hot-path table
  // does not enumerate a fall-through rule — only the trend and the
  // sustained-high explicitly fire calm_concerned).
  return { tier: 'in_pattern', reason: 'baseline_within' };
}

// SpO2 ───────────────────────────────────────────────────────────────

export interface SpO2ClassificationInput {
  /** Latest SpO2 spot/auto sample percent, 0-100. */
  latestPercent: number;
  /** Overnight-low percent for the last N nights, oldest first. The
   *  3-night sustained-below-88 rule needs at least 3 entries; an
   *  empty array means no overnight context yet. */
  overnightLowsRecent: number[];
}

export interface SpO2Classification {
  tier: ClassificationTier;
  reason:
    | 'overnight_dip_sustained'
    | 'sample_or_overnight_borderline'
    | 'sample_and_overnight_in_band'
    | 'sample_below_90_alone';
}

const SPO2_URGENT_OVERNIGHT_LOW = 88;
const SPO2_URGENT_SUSTAINED_NIGHTS = 3;
const SPO2_BORDERLINE_SAMPLE_LOW = 90;
const SPO2_BORDERLINE_SAMPLE_HIGH = 94;
const SPO2_BORDERLINE_OVERNIGHT_LOW = 88;
const SPO2_BORDERLINE_OVERNIGHT_HIGH = 89;
const SPO2_IN_PATTERN_SAMPLE_FLOOR = 95;
const SPO2_IN_PATTERN_OVERNIGHT_FLOOR = 90;

export function classifySpO2(input: SpO2ClassificationInput): SpO2Classification {
  const { latestPercent, overnightLowsRecent } = input;

  // Confirmed-urgent: overnight_low < 88 sustained 3+ nights.
  const lastN = overnightLowsRecent.slice(-SPO2_URGENT_SUSTAINED_NIGHTS);
  if (
    lastN.length >= SPO2_URGENT_SUSTAINED_NIGHTS &&
    lastN.every((low) => low < SPO2_URGENT_OVERNIGHT_LOW)
  ) {
    return { tier: 'confirmed_urgent', reason: 'overnight_dip_sustained' };
  }

  const lastOvernightLow =
    overnightLowsRecent.length > 0
      ? overnightLowsRecent[overnightLowsRecent.length - 1]
      : null;

  // Calm-concerned: latest 90-94 OR last overnight 88-89.
  const sampleBorderline =
    latestPercent >= SPO2_BORDERLINE_SAMPLE_LOW &&
    latestPercent <= SPO2_BORDERLINE_SAMPLE_HIGH;
  const overnightBorderline =
    lastOvernightLow !== null &&
    lastOvernightLow >= SPO2_BORDERLINE_OVERNIGHT_LOW &&
    lastOvernightLow <= SPO2_BORDERLINE_OVERNIGHT_HIGH;
  if (sampleBorderline || overnightBorderline) {
    return { tier: 'calm_concerned', reason: 'sample_or_overnight_borderline' };
  }

  // In-pattern: latest >= 95 AND overnight (if known) >= 90.
  const sampleHealthy = latestPercent >= SPO2_IN_PATTERN_SAMPLE_FLOOR;
  const overnightHealthy =
    lastOvernightLow === null || lastOvernightLow >= SPO2_IN_PATTERN_OVERNIGHT_FLOOR;
  if (sampleHealthy && overnightHealthy) {
    return { tier: 'in_pattern', reason: 'sample_and_overnight_in_band' };
  }

  // Fall-through: a single below-90 reading with no concerning overnight
  // pattern. Per D13 §6.3 explicitly: "A single below-90 reading does
  // NOT trigger calm-concerned alone (sensor noise is real). Pattern-of-3
  // is the threshold."
  return { tier: 'in_pattern', reason: 'sample_below_90_alone' };
}

// Sleep ──────────────────────────────────────────────────────────────

export type SleepTier = 'in_pattern' | 'calm_concerned' | 'no_data';

export interface SleepClassificationInput {
  /** Total minutes asleep across the session. */
  totalMinutes: number;
  /** Minutes in deep stage. */
  deepMinutes: number;
  /** Number of wake events during the session. */
  awakeCount: number;
  /** unix sec UTC; session start. */
  sessionStartSec: number;
  /** unix sec UTC; session end. */
  sessionEndSec: number;
}

export interface SleepClassification {
  tier: SleepTier;
  /** 0-100, computed per D13 §6.4. */
  sleepScore: number;
  reason: 'no_session' | 'score_70_plus' | 'score_50_to_69' | 'score_below_50';
}

/**
 * Sleep score 0-100 per D13 §6.4. The doc has an internal arithmetic
 * tension on the total_score sub-formula ("each hour from 4h up = 6.25
 * pts" can't reach max 50 by 8h). I take the consistent reading:
 * 12.5 pts per hour above 4h, capped at 50 — which matches both the
 * "max 50" and "capped at 8h" bounds in the same line. Flagged in
 * D13 §15.4 Q-D13-3 if we want to revisit after 90 days of production.
 */
export function computeSleepScore(input: SleepClassificationInput): number {
  const { totalMinutes, deepMinutes, awakeCount, sessionStartSec, sessionEndSec } = input;

  // total_score: 12.5 pts per hour above 4h, capped at 50 (8h gives 50).
  const totalHours = totalMinutes / 60;
  const totalScore = Math.max(0, Math.min(50, (totalHours - 4) * 12.5));

  // deep_score: deep ratio scaled so 25%+ deep = full 20 pts.
  const deepRatio = totalMinutes > 0 ? deepMinutes / totalMinutes : 0;
  const deepScore = Math.min(20, (deepRatio / 0.25) * 20);

  // continuity_score: 20 - wake_count*4, floored at 0.
  const continuityScore = Math.max(0, 20 - awakeCount * 4);

  // efficiency_score: asleep ratio of in-bed window, max 10.
  const windowMinutes = (sessionEndSec - sessionStartSec) / 60;
  const efficiencyRatio = windowMinutes > 0 ? totalMinutes / windowMinutes : 0;
  const efficiencyScore = Math.min(10, Math.max(0, efficiencyRatio * 10));

  return Math.round(totalScore + deepScore + continuityScore + efficiencyScore);
}

/**
 * Score for a stored/synced session object — the display-side single
 * source of truth (data-completeness fix, 2026-06-05 physical testing).
 *
 * Why: ingestion used to stamp `sleepScore: 0` ("computed by classifier
 * downstream") but nothing downstream ever ran, so every consumer (hero
 * copy, ring fill, sleep×BP correlation, home tiles) judged nights from a
 * constant 0 — "a more restless night than your usual" fired for every
 * night regardless of the data. Display consumers now RECOMPUTE from the
 * session's real fields (works for historical rows too); ingestion also
 * stores the computed score for server-side consumers.
 *
 * Note: with the synthesized in-bed window (= total) and awakeCount 0
 * (the 0x07 reply exposes neither), the efficiency + continuity
 * components are constant (+30); the score's variance comes from the
 * measured duration + deep ratio. Comparisons across nights stay
 * meaningful; the absolute floor is ~30.
 */
export function sleepScoreForSession(session: {
  totalMinutes: number;
  deepMinutes: number;
  awakeCount: number;
  sessionStartSec: number;
  sessionEndSec: number;
}): number {
  return computeSleepScore({
    totalMinutes: session.totalMinutes,
    deepMinutes: session.deepMinutes,
    awakeCount: session.awakeCount,
    sessionStartSec: session.sessionStartSec,
    sessionEndSec: session.sessionEndSec,
  });
}

const SLEEP_SCORE_IN_PATTERN_FLOOR = 70;
const SLEEP_SCORE_CALM_CONCERNED_FLOOR = 50;

export function classifySleep(
  input: SleepClassificationInput | null,
): SleepClassification {
  if (!input) return { tier: 'no_data', sleepScore: 0, reason: 'no_session' };

  const sleepScore = computeSleepScore(input);

  if (sleepScore >= SLEEP_SCORE_IN_PATTERN_FLOOR) {
    return { tier: 'in_pattern', sleepScore, reason: 'score_70_plus' };
  }
  if (sleepScore >= SLEEP_SCORE_CALM_CONCERNED_FLOOR) {
    return { tier: 'calm_concerned', sleepScore, reason: 'score_50_to_69' };
  }
  // D13 §6.4 "confirmed_urgent: never" — even a very low score stays
  // calm_concerned. Sleep is contextual data for BP/HR, not a urgent
  // state on its own.
  return { tier: 'calm_concerned', sleepScore, reason: 'score_below_50' };
}

// Activity ───────────────────────────────────────────────────────────

export type ActivityTier = 'in_pattern' | 'progress';

export interface ActivityClassificationInput {
  stepsToday: number;
  /** User-set goal; default 6000 per D13 §15.4 Q-D13-1. */
  targetSteps: number;
}

export interface ActivityClassification {
  tier: ActivityTier;
  /** 0..1+ ratio of stepsToday / targetSteps. */
  percentOfTarget: number;
  reason: 'at_or_above_80_percent' | 'below_80_percent';
}

const ACTIVITY_IN_PATTERN_RATIO = 0.8;

export function classifyActivity(
  input: ActivityClassificationInput,
): ActivityClassification {
  const { stepsToday, targetSteps } = input;
  const percentOfTarget = targetSteps > 0 ? stepsToday / targetSteps : 0;
  if (percentOfTarget >= ACTIVITY_IN_PATTERN_RATIO) {
    return { tier: 'in_pattern', percentOfTarget, reason: 'at_or_above_80_percent' };
  }
  // Per D13 §6.5: low activity is informational, never calm_concerned
  // and never confirmed_urgent. The activity ring is the only ring that
  // does not surface concern states.
  return { tier: 'progress', percentOfTarget, reason: 'below_80_percent' };
}

// Staleness ─────────────────────────────────────────────────────────

export type VitalStaleness = 'fresh' | 'stale' | 'no_data';

const STALENESS_THRESHOLDS_SEC: Record<VitalKind, number> = {
  // Per D13 §6.6 staleness thresholds. Calories rides with activity.
  bp: 36 * 3600,
  hr: 6 * 3600,
  spo2: 8 * 3600,
  sleep: 24 * 3600,
  activity: 6 * 3600,
  calories: 6 * 3600,
};

export function checkStaleness(
  vital: VitalKind,
  lastSampleAtSec: number | null,
  nowSec: number = Math.floor(Date.now() / 1000),
): VitalStaleness {
  if (lastSampleAtSec === null) return 'no_data';
  const ageSec = nowSec - lastSampleAtSec;
  return ageSec > STALENESS_THRESHOLDS_SEC[vital] ? 'stale' : 'fresh';
}
