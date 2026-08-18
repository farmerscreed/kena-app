import type { VitalKind } from '../types/vitals';
export type { VitalKind };

// Reading classification — Sprint 6.
//
// Pure function implementing docs/10-anomaly-logic.md §2. Two paths:
//
// • Cold-start (no baseline / <14 days of data): absolute-threshold
//   ladder only. Any reading at or above 180/120 is `confirmed_urgent`
//   (crisis); anything strictly above 160/100 (or pulse > 130) is
//   `calm_concerned`; otherwise `in_pattern`. Sprint 6 always runs this
//   path because the baseline isn't computed until the anomaly engine
//   ships in Sprint 15.
//
// • Hot path (≥14 days of baseline): outlier (>2σ) AND a soft-threshold
//   floor must both fire to flag `calm_concerned`. Crisis absolute
//   thresholds remain in force regardless of baseline.
//
// HARD RULE per CLAUDE.md + D3: this is a STATISTICAL classification, not
// a clinical diagnosis. UI never says "hypertension" or "crisis"; it
// says "Worth a look" / "Talk to your doctor". See docs/05-voice-and-claims.md.
//
// The hot-path `checkSustainedPattern` (3+ Stage-2 readings in 60min)
// is deferred to Sprint 15 — Sprint 6 ingests one reading at a time and
// has no rolling-window context. The cold-start path's
// `confirmed_urgent` crisis threshold still catches the single-reading
// emergency case.

// Tier taxonomy per D13 §6 — `in_pattern` (premium-pulse framing) replaces
// the Sprint 6 `in_range` literal. Display string is "In pattern".
export type ClassificationTier = 'in_pattern' | 'calm_concerned' | 'confirmed_urgent';

export interface ReadingForClassification {
  systolic: number;
  diastolic: number;
  pulse?: number | null;
}

export interface ReadingBaseline {
  sys: number;
  dia: number;
  pulse: number;
  sigmaSys: number;
  sigmaDia: number;
  sigmaPulse: number;
  daysOfData: number;
}

export interface Classification {
  tier: ClassificationTier;
  reason:
    | 'crisis_absolute'
    | 'absolute_cold_start'
    | 'cold_start'
    | 'outlier_and_soft_threshold'
    | 'within_baseline';
}

const CRISIS_SYS = 180;
const CRISIS_DIA = 120;
const STAGE2_SYS = 160;
const STAGE2_DIA = 100;
const SOFT_SYS = 150;
const SOFT_DIA = 95;
const SOFT_PULSE = 120;
const COLD_PULSE = 130;
const SIGMA_MULTIPLIER = 2;
const MIN_BASELINE_DAYS = 14;

export function classifyReading(
  reading: ReadingForClassification,
  baseline?: ReadingBaseline | null,
): Classification {
  const { systolic, diastolic } = reading;
  const pulse = reading.pulse ?? 0;

  // Crisis-absolute always wins, regardless of baseline maturity.
  if (systolic >= CRISIS_SYS || diastolic >= CRISIS_DIA) {
    return { tier: 'confirmed_urgent', reason: 'crisis_absolute' };
  }

  // Cold-start path: no baseline or insufficient data.
  if (!baseline || baseline.daysOfData < MIN_BASELINE_DAYS) {
    if (systolic > STAGE2_SYS || diastolic > STAGE2_DIA || pulse > COLD_PULSE) {
      return { tier: 'calm_concerned', reason: 'absolute_cold_start' };
    }
    return { tier: 'in_pattern', reason: 'cold_start' };
  }

  // Hot path: outlier AND exceeds soft threshold → calm-concerned.
  const sysOutlier =
    Math.abs(systolic - baseline.sys) > SIGMA_MULTIPLIER * baseline.sigmaSys;
  const diaOutlier =
    Math.abs(diastolic - baseline.dia) > SIGMA_MULTIPLIER * baseline.sigmaDia;
  const pulseOutlier =
    reading.pulse != null &&
    Math.abs(reading.pulse - baseline.pulse) >
      SIGMA_MULTIPLIER * baseline.sigmaPulse;

  const exceedsSoft = systolic > SOFT_SYS || diastolic > SOFT_DIA || pulse > SOFT_PULSE;

  if ((sysOutlier || diaOutlier || pulseOutlier) && exceedsSoft) {
    return { tier: 'calm_concerned', reason: 'outlier_and_soft_threshold' };
  }
  return { tier: 'in_pattern', reason: 'within_baseline' };
}

/** UI string for the tier chip. Centralised so tests catch voice-rule drift. */
/**
 * Sprint 19 (audit D12 P2-1) — "In pattern" was internal enum vocabulary
 * (`in_pattern`) promoted to brand copy. It means nothing to a reader
 * who hasn't seen the codebase, and it competed with five other phrases
 * for the same concept ("within your range", "in range", "ALL CLEAR",
 * "your usual", "steady"). The canonical user-facing vocabulary is now:
 *
 *   in_pattern       → "In your usual range"
 *   calm_concerned   → "Worth a look"
 *   confirmed_urgent → "Talk to your doctor"
 *
 * Everything that surfaces a tier imports from here. Do not re-coin.
 */
export function tierChipText(tier: ClassificationTier): string {
  switch (tier) {
    case 'in_pattern':
      return 'In your usual range';
    case 'calm_concerned':
      return 'Worth a look';
    case 'confirmed_urgent':
      return 'Talk to your doctor';
  }
}

/**
 * The hero sub-line under a vital value — "<unit> · <verdict>".
 *
 * Sprint 19 (audit D12 P0-4). BPDetail had a private `rangeCopyForTier`;
 * HRDetail had none and gated on `baseline !== null`, so a heart rate
 * classified calm_concerned or confirmed_urgent still rendered
 * "bpm · within your range" — directly contradicting the anomaly banner
 * firing above it. Both now call this.
 *
 * A null tier yields the bare unit: we say nothing rather than guess.
 */
export function vitalRangeCopyForTier(
  unit: string,
  tier: ClassificationTier | null | undefined,
): string {
  switch (tier) {
    case 'in_pattern':
      return `${unit} · within your usual range`;
    case 'calm_concerned':
      return `${unit} · worth a look`;
    case 'confirmed_urgent':
      return `${unit} · talk to your doctor today`;
    default:
      return unit;
  }
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
