// readingBaseline — Sprint 19 (audit D12 P0-2 / P0-3).
//
// Computes the personal BP baseline that `classifyReading` needs, from
// readings the client already holds.
//
// ── Why this module exists ────────────────────────────────────────────
//
// `utils/classification.ts` has had a personal-baseline branch since
// Sprint 6, but every client call site passed `baseline = null`:
//
//   hooks/useHydrateReadingsFromServer.ts   classifyReading({...}, null)
//   services/families/fetchParentPulseData  classifyReading({...}, null)
//   state/readings.ts                       classifyReading({...}, null)
//   utils/caregiverPerson.ts                classifyReading({...}, null)
//
// So every tier the UI rendered came from the absolute ladder
// (SOFT 150/95 → STAGE2 160/100 → CRISIS 180/120), not from the user's
// own numbers. The app displayed "YOUR USUAL 123–149" and then told the
// same user that 158 was "within your range" — the product's core claim,
// decided by a threshold that had nothing to do with them.
//
// The personal path was live in exactly one place: the server-side
// `detect-anomaly` edge function, which drives push notifications only.
//
// ── Source of truth ──────────────────────────────────────────────────
//
// The audit found two baselines that disagreed by construction:
//
//                  displayed (utils/vitalBaselines)   judging (server)
//   window         30 days                            14 days
//   statistic      p10–p90 percentile band            mean ± 2σ
//
// This module implements the SERVER's definition — 14-day window,
// population σ, `daysOfData` counted as distinct UTC dates — because
// that is what `classifyReading`'s hot path is written against, and
// matching it means the tier a user sees on-device is the same tier the
// server would compute for a push. `utils/vitalBaselines` keeps its
// 30-day p10–p90 band for DISPLAY ("your usual 123–149"), which is a
// different and legitimate question: "where do my readings usually
// land?" vs "is this reading unusual for me?".
//
// Mirrors supabase/functions/_shared/classification.ts `computeBpBaseline`.
// If you change the maths here, change it there too — the two are meant
// to agree, and readingBaseline.test.ts pins them against shared fixtures.
//
// ── Offline ──────────────────────────────────────────────────────────
//
// Computed locally from MMKV-backed readings rather than fetched from
// `bp_baselines`. CLAUDE.md requires the app to function with no
// network, and classification drives what the user sees on the home
// screen. A network-dependent tier would mean the home screen changes
// meaning when the signal drops.

import type { ReadingBaseline } from './classification';

/** Matches the server window in detect-anomaly/index.ts:244. */
export const BASELINE_WINDOW_DAYS = 14;

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Minimal shape we need — any reading-like row satisfies it. */
export interface BaselineSample {
  measuredAtSec: number;
  systolic: number;
  diastolic: number;
  pulse: number | null;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Population standard deviation (1/N), matching `popStdDev` in
 * supabase/functions/_shared/classification.ts. Sample SD (1/(N-1))
 * would widen the band and make the classifier more forgiving than the
 * server's — the two must not diverge.
 */
function popStdDev(values: number[], mu: number): number {
  if (values.length === 0) return 0;
  const variance =
    values.reduce((acc, v) => acc + (v - mu) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Build a `ReadingBaseline` from the last `BASELINE_WINDOW_DAYS` of
 * readings, or null when there is nothing to compute from.
 *
 * Returning a baseline whose `daysOfData` is below `MIN_BASELINE_DAYS`
 * is intentional and safe: `classifyReading` checks that gate itself and
 * falls back to its cold-start path. We do not pre-filter, so the
 * classifier keeps sole ownership of the maturity rule.
 *
 * Hidden/soft-deleted readings must be filtered by the caller — this
 * function has no opinion about which rows are eligible.
 */
export function computeReadingBaseline(
  samples: readonly BaselineSample[],
  nowSec: number = Math.floor(Date.now() / 1000),
): ReadingBaseline | null {
  if (samples.length === 0) return null;

  const cutoff = nowSec - BASELINE_WINDOW_DAYS * SECONDS_PER_DAY;
  const inWindow = samples.filter(
    (s) => s.measuredAtSec >= cutoff && s.measuredAtSec <= nowSec,
  );
  if (inWindow.length === 0) return null;

  const sysValues = inWindow.map((s) => s.systolic);
  const diaValues = inWindow.map((s) => s.diastolic);
  const pulseValues = inWindow
    .map((s) => s.pulse)
    .filter((p): p is number => p != null);

  const sysMean = mean(sysValues);
  const diaMean = mean(diaValues);
  // No pulse readings → a zero mean with zero sigma. `classifyReading`
  // only consults the pulse branch when `reading.pulse != null`, and a
  // zero sigma makes any non-null pulse an outlier — which is why the
  // classifier ALSO requires `exceedsSoft` before escalating. Matches
  // the server, which stores null and coalesces the same way.
  const pulseMean = pulseValues.length > 0 ? mean(pulseValues) : 0;

  // Distinct UTC dates, matching the server's `daysOfData` proxy. The
  // gate is "at least 14 days", so local-vs-UTC drift can't move it
  // materially.
  const days = new Set(
    inWindow.map((s) =>
      new Date(s.measuredAtSec * 1000).toISOString().slice(0, 10),
    ),
  );

  return {
    sys: sysMean,
    dia: diaMean,
    pulse: pulseMean,
    sigmaSys: popStdDev(sysValues, sysMean),
    sigmaDia: popStdDev(diaValues, diaMean),
    sigmaPulse:
      pulseValues.length > 0 ? popStdDev(pulseValues, pulseMean) : 0,
    daysOfData: days.size,
  };
}
