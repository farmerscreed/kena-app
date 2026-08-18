// Shared baseline maths for the vital_baselines truth layer — D13 PR-1.
//
// One row per (subject, vital, context) in public.vital_baselines
// (migration 0054), computed nightly by detect-anomaly's cron mode over
// a 28-day window. Each row carries BOTH bands the product needs:
//
//   mean_value ± 2·sd_value   — the classification band (worth_a_look)
//   p10_value … p90_value     — the display band ("usual 118–134")
//
// computed together from the same samples, which is the entire point:
// the band the user sees and the band their reading is judged against
// can no longer disagree (audit D12 P0-3).
//
// Pure functions only — no database access, mirroring the design of
// _shared/classification.ts. The caller fetches rows and passes samples
// in; everything here is unit-testable without Postgres.
//
// The percentile is NEAREST-RANK with the same formula the mobile
// client uses (apps/mobile/src/utils/vitalBaselines.ts): on identical
// samples the server row and the client's provisional offline fallback
// produce identical numbers. If you change the formula, change it
// there too — baselines.test.ts and the client suite pin the two
// against shared fixtures.
//
// Sourced from:
//   docs/D13_Leiko_Vitals_Layer_Implementation_Spec.md §4.1–§4.3
//   supabase/migrations/0054_vital_baselines.sql

export type BaselineVital =
  | 'bp_systolic'
  | 'bp_diastolic'
  | 'resting_hr'
  | 'spo2'
  | 'sleep_duration'
  | 'steps_daily';

/** D13 §4.1 — one window for display and classification alike. */
export const BASELINE_WINDOW_DAYS = 28;

/** D13 §4.2 — a BP context tag earns its own row at this many readings. */
export const CONTEXT_MIN_READINGS = 8;

/**
 * D13 §4.3 sufficiency — the CLASSIFICATION column of the table. The
 * spec also lists looser "band" minima for SpO2 / sleep / steps;
 * is_sufficient encodes the stricter bar because it is the single field
 * the client consults before showing any coloured verdict, and a colour
 * is a classification claim. A surface that wants the looser band-only
 * gate can derive it from sample_count without a schema change.
 */
export const SUFFICIENCY: Record<BaselineVital, { minCount: number; minDays: number }> = {
  bp_systolic: { minCount: 10, minDays: 7 },
  bp_diastolic: { minCount: 10, minDays: 7 },
  resting_hr: { minCount: 7, minDays: 7 },
  spo2: { minCount: 10, minDays: 10 },
  sleep_duration: { minCount: 10, minDays: 10 },
  steps_daily: { minCount: 10, minDays: 10 },
};

/** One observation: a value plus the distinct-day bucket it belongs to
 *  (UTC date for BP readings, night key for nightly vitals, local day
 *  for steps — the caller owns the bucketing rule per vital). */
export interface BaselineSample {
  value: number;
  dayKey: string;
}

export interface VitalBaselineRow {
  vital: BaselineVital;
  contextTag: string | null;
  windowDays: number;
  sampleCount: number;
  mean: number;
  sd: number;
  p10: number;
  p90: number;
  isSufficient: boolean;
}

export function mean(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Population standard deviation (1/N) — matches both the retired
 *  computeBpBaseline here and the client's provisional fallback. */
export function popStdDev(values: readonly number[], mu: number): number {
  let sumSq = 0;
  for (const v of values) sumSq += (v - mu) * (v - mu);
  return Math.sqrt(sumSq / values.length);
}

/** Nearest-rank percentile over a pre-sorted ascending array — the
 *  mobile client's formula, verbatim: idx = min(n-1, floor(n·pct)). */
export function percentile(sorted: readonly number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * pct));
  return sorted[idx];
}

/**
 * Compute one vital_baselines row from the window's samples. Returns
 * null when there are no samples at all (no row is written — absence
 * of data is not a baseline). Below the §4.3 threshold the row IS
 * written with is_sufficient=false: sample_count is what lets the
 * client render "we have {n} of the {required} readings".
 */
export function computeVitalBaselineRow(
  vital: BaselineVital,
  samples: readonly BaselineSample[],
  contextTag: string | null = null,
): VitalBaselineRow | null {
  if (samples.length === 0) return null;
  const values = samples.map((s) => s.value);
  const sorted = [...values].sort((a, b) => a - b);
  const mu = mean(values);
  const distinctDays = new Set(samples.map((s) => s.dayKey)).size;
  const gate = SUFFICIENCY[vital];
  return {
    vital,
    contextTag,
    windowDays: BASELINE_WINDOW_DAYS,
    sampleCount: samples.length,
    mean: mu,
    sd: popStdDev(values, mu),
    p10: percentile(sorted, 0.1),
    p90: percentile(sorted, 0.9),
    isSufficient: samples.length >= gate.minCount && distinctDays >= gate.minDays,
  };
}

/** A BP reading as the cron fetches it — values plus its context tags. */
export interface BpReadingSample {
  systolic: number;
  diastolic: number;
  dayKey: string;
  contextTags: readonly string[];
}

/**
 * The full BP row set for one subject: the all-readings systolic +
 * diastolic pair, plus a context-conditioned pair for every tag that
 * clears CONTEXT_MIN_READINGS (D13 §4.2 — BP only, decisions log #2).
 */
export function computeBpBaselineRows(
  readings: readonly BpReadingSample[],
): VitalBaselineRow[] {
  const rows: VitalBaselineRow[] = [];
  const push = (row: VitalBaselineRow | null) => {
    if (row) rows.push(row);
  };
  push(computeVitalBaselineRow('bp_systolic', readings.map((r) => ({ value: r.systolic, dayKey: r.dayKey }))));
  push(computeVitalBaselineRow('bp_diastolic', readings.map((r) => ({ value: r.diastolic, dayKey: r.dayKey }))));

  const byTag = new Map<string, BpReadingSample[]>();
  for (const r of readings) {
    for (const tag of r.contextTags) {
      const bucket = byTag.get(tag);
      if (bucket) bucket.push(r);
      else byTag.set(tag, [r]);
    }
  }
  for (const [tag, tagged] of byTag) {
    if (tagged.length < CONTEXT_MIN_READINGS) continue;
    push(computeVitalBaselineRow('bp_systolic', tagged.map((r) => ({ value: r.systolic, dayKey: r.dayKey })), tag));
    push(computeVitalBaselineRow('bp_diastolic', tagged.map((r) => ({ value: r.diastolic, dayKey: r.dayKey })), tag));
  }
  return rows;
}
