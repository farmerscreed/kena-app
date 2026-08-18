// Shared classifier module for Edge Functions — Sprint 15.
//
// Ports apps/mobile/src/utils/classification.ts to a Deno-compatible
// form so detect-anomaly + compute-baselines + send-push can run the
// same rules the mobile app already uses for in-app tier chips.
//
// Pure functions only — no database access. The Edge Function fetches
// readings + baselines + recent overnight lows from Postgres and
// passes them in. Keeps the rules unit-testable without a database.
//
// Per CLAUDE.md + D3: STATISTICAL classification, not clinical.
// Per D13 §11.1: Sleep + Activity never produce anomaly events
// regardless of their classifier tier. That's enforced by
// producesAnomalyEvent below — the only place that decision lives.
//
// Sourced from:
//   apps/mobile/src/utils/classification.ts (Sprint 6 / 7.5)
//   docs/_reference/D13-multi-vitals-constellation-spec.md §6, §11
//   docs/10-anomaly-logic.md §2

// ─────────────────────────────────────────────────────────────────────
// Shared types.

export type VitalKind = 'bp' | 'hr' | 'spo2' | 'sleep' | 'activity';

export type ClassificationTier = 'in_pattern' | 'calm_concerned' | 'confirmed_urgent';

// Sleep gets one extra tier because its classifier returns `no_data` when
// the parent skipped a night. Activity's `progress` tier never produces
// an anomaly event so it doesn't need to flow back here.

// ─────────────────────────────────────────────────────────────────────
// BP — single-reading classifier (mirror of mobile path).

export interface ReadingForClassification {
  systolic: number;
  diastolic: number;
  pulse?: number | null;
}


export interface BPClassification {
  tier: ClassificationTier;
  reason: 'crisis_absolute' | 'cold_start' | 'outside_band' | 'within_baseline';
}

const BP_CRISIS_SYS = 180;
const BP_CRISIS_DIA = 120;
const BP_STAGE2_SYS = 160;
const BP_STAGE2_DIA = 100;
const BP_SIGMA_MULTIPLIER = 2;
const BP_MIN_BASELINE_DAYS = 14;

/** One vital_baselines row, as the D13 truth layer stores it. */
export interface VitalBaselineRowLike {
  mean: number;
  sd: number;
  p10: number;
  p90: number;
  isSufficient: boolean;
}

export interface BpBaselinePair {
  systolic: VitalBaselineRowLike | null;
  diastolic: VitalBaselineRowLike | null;
}

/**
 * Classify a single BP reading — D13 §4.4 rules, aligned with the
 * mobile classifier in PR-2 (in-app and push can no longer disagree):
 *
 *   1. Absolute floor ≥ 180/120 → confirmed_urgent, regardless of
 *      band and regardless of sufficiency.
 *   2. No baseline / insufficient → in_pattern (learning — below the
 *      §4.3 gate nothing ambers; the floor is the only absolute).
 *   3. Inside [p10, p90] → in_pattern.
 *   4. Outside mean ± 2σ (σ scaled by the family's anomaly_sensitivity,
 *      clamped 0.8–1.5 per docs/10 §3) → calm_concerned.
 *   5. The shoulder between p90 and mean + 2σ stays in_pattern.
 *
 * Pulse no longer participates: resting HR is its own vital with its
 * own baseline row. The retired cold-start ladder and the
 * outlier-AND-soft-threshold conjunction are gone with it.
 */
export function classifyBP(
  reading: ReadingForClassification,
  baselines?: BpBaselinePair | null,
  sensitivity: number = 1.0,
): BPClassification {
  const { systolic, diastolic } = reading;

  if (systolic >= BP_CRISIS_SYS || diastolic >= BP_CRISIS_DIA) {
    return { tier: 'confirmed_urgent', reason: 'crisis_absolute' };
  }

  const judge = (
    value: number,
    row: VitalBaselineRowLike | null,
  ): 'learning' | 'in_range' | 'worth_a_look' => {
    if (!row || !row.isSufficient) return 'learning';
    if (value >= row.p10 && value <= row.p90) return 'in_range';
    const spread = BP_SIGMA_MULTIPLIER * sensitivity * row.sd;
    if (value > row.mean + spread || value < row.mean - spread) return 'worth_a_look';
    return 'in_range';
  };

  const sys = judge(systolic, baselines?.systolic ?? null);
  const dia = judge(diastolic, baselines?.diastolic ?? null);

  if (sys === 'worth_a_look' || dia === 'worth_a_look') {
    return { tier: 'calm_concerned', reason: 'outside_band' };
  }
  if (sys === 'learning' && dia === 'learning') {
    return { tier: 'in_pattern', reason: 'cold_start' };
  }
  return { tier: 'in_pattern', reason: 'within_baseline' };
}

// BP — rolling 60-minute sustained-pattern check.

/**
 * Returns true when 3+ readings in the last 60 minutes are at Stage 2
 * (> 160/100). Per docs/10-anomaly-logic.md §2.
 *
 * `recent` is expected sorted by measured_at desc; we only consider
 * the rows whose measured_at is within (nowSec - 3600, nowSec].
 */
export function checkSustainedPattern(
  recent: { systolic: number; diastolic: number; measured_at_sec: number }[],
  nowSec: number,
): boolean {
  const windowStart = nowSec - 60 * 60;
  const stage2Hits = recent.filter(
    (r) =>
      r.measured_at_sec > windowStart &&
      r.measured_at_sec <= nowSec &&
      (r.systolic > BP_STAGE2_SYS || r.diastolic > BP_STAGE2_DIA),
  ).length;
  return stage2Hits >= 3;
}

// The legacy computeBpBaseline (14-day mean±σ, pulse included) is
// retired with D13 PR-2 — the nightly cron writes vital_baselines via
// _shared/baselines.ts, and keeping the old maths alive would preserve
// exactly the divergence §4.1 exists to kill.

// ─────────────────────────────────────────────────────────────────────
// HR.

export interface HRClassificationInput {
  restingBpmToday: number;
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

const HR_EXTREME_LOW = 40;
const HR_EXTREME_HIGH = 130;
const HR_COLD_BAND_LOW = 50;
const HR_COLD_BAND_HIGH = 95;
const HR_TREND_DELTA_BPM = 15;
const HR_HIGH_AT_REST = 100;
const HR_MIN_BASELINE_DAYS = 14;
const HR_TREND_DAYS = 3;

export function classifyHR(input: HRClassificationInput): HRClassification {
  const { restingBpmToday, restingBpmRecent } = input;

  if (restingBpmToday < HR_EXTREME_LOW || restingBpmToday > HR_EXTREME_HIGH) {
    return { tier: 'confirmed_urgent', reason: 'extreme_value' };
  }

  if (restingBpmRecent.length < HR_MIN_BASELINE_DAYS) {
    if (restingBpmToday >= HR_COLD_BAND_LOW && restingBpmToday <= HR_COLD_BAND_HIGH) {
      return { tier: 'in_pattern', reason: 'cold_start_in_band' };
    }
    return { tier: 'calm_concerned', reason: 'cold_start_outside_band' };
  }

  const sorted = [...restingBpmRecent].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const last3 = [...restingBpmRecent.slice(-(HR_TREND_DAYS - 1)), restingBpmToday];
  if (
    last3.length === HR_TREND_DAYS &&
    last3.every((bpm) => bpm > median + HR_TREND_DELTA_BPM)
  ) {
    return { tier: 'calm_concerned', reason: 'baseline_3day_trend' };
  }

  if (restingBpmToday > HR_HIGH_AT_REST) {
    return { tier: 'calm_concerned', reason: 'sustained_high_at_rest' };
  }

  return { tier: 'in_pattern', reason: 'baseline_within' };
}

/** Median of an HR series. Exposed so the cron can persist hr_baselines.median_bpm. */
export function computeHrMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ─────────────────────────────────────────────────────────────────────
// SpO2.

export interface SpO2ClassificationInput {
  latestPercent: number;
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

  const sampleHealthy = latestPercent >= SPO2_IN_PATTERN_SAMPLE_FLOOR;
  const overnightHealthy =
    lastOvernightLow === null || lastOvernightLow >= SPO2_IN_PATTERN_OVERNIGHT_FLOOR;
  if (sampleHealthy && overnightHealthy) {
    return { tier: 'in_pattern', reason: 'sample_and_overnight_in_band' };
  }

  return { tier: 'in_pattern', reason: 'sample_below_90_alone' };
}

// ─────────────────────────────────────────────────────────────────────
// Anomaly-event gate.

/**
 * Whether a (vital, tier) pair produces a persisted anomaly_events row
 * (and therefore a candidate push). Per D13 §11.1:
 *
 *   - bp, hr, spo2: calm_concerned + confirmed_urgent → event
 *   - sleep, activity: NEVER → no event, no push, no banner
 *
 * Single source of truth so detect-anomaly and the nightly cron can't
 * accidentally diverge.
 */
export function producesAnomalyEvent(
  vital: VitalKind,
  tier: ClassificationTier | 'no_data' | 'progress',
): boolean {
  if (vital === 'sleep' || vital === 'activity') return false;
  return tier === 'calm_concerned' || tier === 'confirmed_urgent';
}

/**
 * Per docs/10-anomaly-logic.md §3 dedup: if the most recent
 * anomaly_events row for (user_id, vital_kind) is within 4h AND the
 * incoming tier is calm_concerned, suppress. confirmed_urgent always
 * fires (a crisis-absolute can't be hidden behind a 4h dedup window).
 */
export function shouldDedupAnomaly(
  incomingTier: ClassificationTier,
  lastTriggeredAtSec: number | null,
  nowSec: number,
): boolean {
  if (incomingTier === 'confirmed_urgent') return false;
  if (lastTriggeredAtSec === null) return false;
  const FOUR_HOURS_SEC = 4 * 60 * 60;
  return nowSec - lastTriggeredAtSec < FOUR_HOURS_SEC;
}

// ─────────────────────────────────────────────────────────────────────
// Math helpers.

