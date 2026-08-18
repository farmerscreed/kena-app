// utils/vitalBaselines — Sprint 16.5f; truth-layer accessor since D13 PR-1.
//
// Two layers now live here:
//
// 1. LEGACY DISPLAY HELPERS (bpBaseline … formatActivityBaseline):
//    pure local 30-day p10–p90 bands, still consumed by the detail
//    screens. They are superseded by the server truth layer below and
//    are re-pointed screen by screen in D13 PR-2/PR-6 — do not add new
//    callers.
//
// 2. TRUTH-LAYER ACCESSOR (D13 §4.1, P0-3): a read-through cache over
//    public.vital_baselines — one server-computed row per (subject,
//    vital, context) over a 28-day window, carrying BOTH the display
//    band (p10–p90) and the classification band (mean ± 2σ) from the
//    same samples. The accessor is:
//      · refreshed asynchronously (refreshVitalBaselines / seed…),
//      · read synchronously (getServerBaseline / resolveBpBaselines) —
//        classification happens inside synchronous mappers,
//      · offline-first: rows persist in MMKV; with no row at all the
//        resolver recomputes locally over the same 28-day window with
//        the same maths and flags the result `provisional: true`. A
//        provisional verdict renders the learning state, never a
//        coloured one (§6.2).
//
//    The provisional maths mirrors supabase/functions/_shared/
//    baselines.ts — nearest-rank percentile, population σ, the §4.3
//    sufficiency gate. Change one side, change both; the accessor test
//    suite pins them against shared fixtures.
//
// Voice rules (docs/05-voice-and-claims.md): caller surfaces these as
// "Your usual" / "Your typical" — never "normal range" or "healthy
// range" (those imply clinical thresholds). All forbidden words avoided.

import { mmkv, STORAGE_KEYS } from '../services/storage';
import { supabase } from '../services/supabase';
import type {
  HRSample,
  SpO2Sample,
  ActivityDay,
} from '../types/vitals';
import type { LocalReading } from '../state/readings';

const MIN_BP_READINGS = 5;
const MIN_HR_DAYS = 5;
const MIN_SPO2_NIGHTS = 5;
const MIN_ACTIVITY_DAYS = 5;
const BASELINE_WINDOW_DAYS = 30;

export interface BPBaseline {
  sysLow: number;
  sysHigh: number;
  diaLow: number;
  diaHigh: number;
  sampleCount: number;
}

export interface HRBaseline {
  bpmLow: number;
  bpmHigh: number;
  sampleCount: number;
}

export interface SpO2Baseline {
  percentLow: number;
  percentHigh: number;
  sampleCount: number;
}

export interface ActivityBaseline {
  /** Median daily step count over the window. */
  median: number;
  /** Days the baseline was computed over. */
  sampleCount: number;
}

/** Robust percentile — sorts then indexes; safe for small arrays. */
function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * pct));
  return sorted[idx];
}

/** p10 → p90 band of systolic + diastolic from the last 30 days of
 *  readings. Returns null when the user has < MIN_BP_READINGS in the
 *  window (avoids claiming a baseline we can't defend). */
export function bpBaseline(
  readings: ReadonlyArray<LocalReading>,
  nowMs: number = Date.now(),
  windowDays: number = BASELINE_WINDOW_DAYS,
): BPBaseline | null {
  const cutoff = nowMs - windowDays * 24 * 3_600_000;
  const window = readings.filter((r) => r.measuredAtSec * 1000 >= cutoff);
  if (window.length < MIN_BP_READINGS) return null;
  const sys = window.map((r) => r.systolic).slice().sort((a, b) => a - b);
  const dia = window.map((r) => r.diastolic).slice().sort((a, b) => a - b);
  return {
    sysLow: percentile(sys, 0.1),
    sysHigh: percentile(sys, 0.9),
    diaLow: percentile(dia, 0.1),
    diaHigh: percentile(dia, 0.9),
    sampleCount: window.length,
  };
}

/** Resting BPM band from the last 30 days of nightly resting samples.
 *  Returns null when < MIN_HR_DAYS of nights with data. */
export function hrBaseline(
  restingRecentBpm: ReadonlyArray<number>,
): HRBaseline | null {
  if (restingRecentBpm.length < MIN_HR_DAYS) return null;
  const sorted = restingRecentBpm.slice().sort((a, b) => a - b);
  return {
    bpmLow: percentile(sorted, 0.1),
    bpmHigh: percentile(sorted, 0.9),
    sampleCount: sorted.length,
  };
}

/** Overnight SpO2 band from the last 30 nights of overnight lows.
 *  Returns null when < MIN_SPO2_NIGHTS of nights with data. */
export function spo2Baseline(
  overnightLows: ReadonlyArray<number>,
): SpO2Baseline | null {
  if (overnightLows.length < MIN_SPO2_NIGHTS) return null;
  const sorted = overnightLows.slice().sort((a, b) => a - b);
  return {
    percentLow: percentile(sorted, 0.1),
    percentHigh: percentile(sorted, 0.9),
    sampleCount: sorted.length,
  };
}

/** Median daily step count from the last 30 days of activity. Returns
 *  null when < MIN_ACTIVITY_DAYS of days with non-zero data. */
export function activityBaseline(
  recentDays: ReadonlyArray<ActivityDay>,
  nowMs: number = Date.now(),
  windowDays: number = BASELINE_WINDOW_DAYS,
): ActivityBaseline | null {
  const cutoff = nowMs - windowDays * 24 * 3_600_000;
  const window = recentDays.filter(
    (d) => d.measuredAtSec * 1000 >= cutoff && d.totalSteps > 0,
  );
  if (window.length < MIN_ACTIVITY_DAYS) return null;
  const sorted = window.map((d) => d.totalSteps).sort((a, b) => a - b);
  return {
    median: percentile(sorted, 0.5),
    sampleCount: window.length,
  };
}

/** "115–128 / 72–82" formatted BP band. Pure formatter for the hero
 *  baseline line. */
export function formatBPBaseline(b: BPBaseline): string {
  return `${b.sysLow}–${b.sysHigh} / ${b.diaLow}–${b.diaHigh}`;
}

/** "62–78 bpm" — pure formatter. */
export function formatHRBaseline(b: HRBaseline): string {
  return `${b.bpmLow}–${b.bpmHigh} bpm`;
}

/** "94–98%" — pure formatter. */
export function formatSpO2Baseline(b: SpO2Baseline): string {
  return `${b.percentLow}–${b.percentHigh}%`;
}

/** "~8,400 steps" — pure formatter. */
export function formatActivityBaseline(b: ActivityBaseline): string {
  return `~${b.median.toLocaleString()} steps`;
}

// Re-export for callers that want the type-only imports.
export type { HRSample, SpO2Sample, ActivityDay };

// ─────────────────────────────────────────────────────────────────────
// Truth-layer accessor — D13 PR-1 (§4.1, §4.3, §4.4 inputs).
// ─────────────────────────────────────────────────────────────────────


export type BaselineVital =
  | 'bp_systolic'
  | 'bp_diastolic'
  | 'resting_hr'
  | 'spo2'
  | 'sleep_duration'
  | 'steps_daily';

/** D13 §4.1 — one window for display and classification alike. */
export const TRUTH_WINDOW_DAYS = 28;

/** §4.3 sufficiency for the provisional BP fallback: 10 readings over
 *  ≥ 7 distinct days. (Server rows carry their own is_sufficient.) */
export const BP_MIN_READINGS = 10;
export const BP_MIN_DISTINCT_DAYS = 7;

export interface VitalBaseline {
  vital: BaselineVital;
  windowDays: number;
  sampleCount: number;
  mean: number;
  sd: number;
  p10: number;
  p90: number;
  contextTag: string | null;
  isSufficient: boolean;
  /** Server row timestamp; null for provisional local recomputes. */
  computedAt: string | null;
  /** True when computed from the offline fallback rather than the
   *  server row. A provisional verdict renders the learning state —
   *  we never colour a verdict computed from an unsynced cache. */
  provisional: boolean;
}

/** Raw row shape as selected from public.vital_baselines. */
export interface VitalBaselineServerRow {
  vital: string;
  window_days: number;
  sample_count: number;
  mean_value: number | string;
  sd_value: number | string;
  p10_value: number | string;
  p90_value: number | string;
  context_tag: string | null;
  is_sufficient: boolean;
  computed_at: string;
}

interface BaselineCacheBlob {
  [familyId: string]: { fetchedAtMs: number; rows: Omit<VitalBaseline, 'provisional'>[] };
}

let cacheLoaded = false;
const cacheByFamily = new Map<string, VitalBaseline[]>();

function loadCacheOnce(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = mmkv.getString(STORAGE_KEYS.vitalBaselinesByFamily);
    if (!raw) return;
    const blob = JSON.parse(raw) as BaselineCacheBlob;
    for (const [familyId, entry] of Object.entries(blob)) {
      cacheByFamily.set(
        familyId,
        entry.rows.map((r) => ({ ...r, provisional: false })),
      );
    }
  } catch {
    // A corrupt cache is discarded; the next refresh rewrites it.
  }
}

function persistCache(): void {
  const blob: BaselineCacheBlob = {};
  for (const [familyId, rows] of cacheByFamily) {
    blob[familyId] = {
      fetchedAtMs: Date.now(),
      rows: rows.map((r) => {
        const { provisional, ...rest } = r;
        void provisional;
        return rest;
      }),
    };
  }
  try {
    mmkv.set(STORAGE_KEYS.vitalBaselinesByFamily, JSON.stringify(blob));
  } catch {
    // Persistence is best-effort; the in-memory copy still serves reads.
  }
}

function mapServerRow(row: VitalBaselineServerRow): VitalBaseline {
  return {
    vital: row.vital as BaselineVital,
    windowDays: row.window_days,
    sampleCount: row.sample_count,
    mean: Number(row.mean_value),
    sd: Number(row.sd_value),
    p10: Number(row.p10_value),
    p90: Number(row.p90_value),
    contextTag: row.context_tag,
    isSufficient: row.is_sufficient,
    computedAt: row.computed_at,
    provisional: false,
  };
}

/** Seed the cache from rows a caller already fetched (e.g. the parent
 *  pulse fetcher includes vital_baselines in its Promise.all). */
export function seedVitalBaselines(
  familyId: string,
  rows: readonly VitalBaselineServerRow[],
): void {
  loadCacheOnce();
  cacheByFamily.set(familyId, rows.map(mapServerRow));
  persistCache();
}

/**
 * Fetch the family's vital_baselines rows and cache them (memory +
 * MMKV). Failure is non-fatal by design: offline keeps the last-fetched
 * rows, and with none at all the resolver falls back to a provisional
 * local recompute.
 */
export async function refreshVitalBaselines(familyId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('vital_baselines')
      .select(
        'vital, window_days, sample_count, mean_value, sd_value, p10_value, p90_value, context_tag, is_sufficient, computed_at',
      )
      .eq('family_id', familyId);
    if (error || !data) return;
    seedVitalBaselines(familyId, data as unknown as VitalBaselineServerRow[]);
  } catch {
    // Network failure keeps whatever the cache already holds.
  }
}

/** Synchronous cache read — never touches the network. */
export function getServerBaseline(
  familyId: string,
  vital: BaselineVital,
  contextTag: string | null = null,
): VitalBaseline | null {
  loadCacheOnce();
  const rows = cacheByFamily.get(familyId);
  if (!rows) return null;
  return (
    rows.find((r) => r.vital === vital && (r.contextTag ?? null) === contextTag) ?? null
  );
}

/** A locally-held BP sample the provisional fallback can judge from. */
export interface BpSampleForBaseline {
  systolic: number;
  diastolic: number;
  measuredAtSec: number;
}

function utcDayKey(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function popStdDev(values: readonly number[], mu: number): number {
  let sumSq = 0;
  for (const v of values) sumSq += (v - mu) * (v - mu);
  return Math.sqrt(sumSq / values.length);
}

function provisionalFor(
  vital: 'bp_systolic' | 'bp_diastolic',
  values: readonly number[],
  distinctDays: number,
): VitalBaseline | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  const mu = sum / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    vital,
    windowDays: TRUTH_WINDOW_DAYS,
    sampleCount: values.length,
    mean: mu,
    sd: popStdDev(values, mu),
    p10: percentile(sorted, 0.1),
    p90: percentile(sorted, 0.9),
    contextTag: null,
    isSufficient:
      values.length >= BP_MIN_READINGS && distinctDays >= BP_MIN_DISTINCT_DAYS,
    computedAt: null,
    provisional: true,
  };
}

/**
 * Offline fallback — recompute both BP baselines locally over the
 * 28-day window, flagged provisional. Same maths as the server
 * (_shared/baselines.ts); pinned by shared fixtures in both suites.
 */
export function provisionalBpBaselines(
  samples: readonly BpSampleForBaseline[],
  nowSec: number = Math.floor(Date.now() / 1000),
): { systolic: VitalBaseline | null; diastolic: VitalBaseline | null } {
  const cutoffSec = nowSec - TRUTH_WINDOW_DAYS * 24 * 3600;
  const window = samples.filter((s) => s.measuredAtSec >= cutoffSec);
  const distinctDays = new Set(window.map((s) => utcDayKey(s.measuredAtSec))).size;
  return {
    systolic: provisionalFor('bp_systolic', window.map((s) => s.systolic), distinctDays),
    diastolic: provisionalFor('bp_diastolic', window.map((s) => s.diastolic), distinctDays),
  };
}

export interface BpBaselinePair {
  systolic: VitalBaseline | null;
  diastolic: VitalBaseline | null;
}

/**
 * The one entry point classification call sites use: server rows when
 * the cache has them, otherwise the provisional local recompute. Never
 * returns a fabricated band — with zero samples and no server row both
 * sides are null and the classifier renders the learning state.
 */
export function resolveBpBaselines(
  familyId: string,
  samples: readonly BpSampleForBaseline[],
  nowSec: number = Math.floor(Date.now() / 1000),
): BpBaselinePair {
  const sys = getServerBaseline(familyId, 'bp_systolic');
  const dia = getServerBaseline(familyId, 'bp_diastolic');
  if (sys || dia) return { systolic: sys, diastolic: dia };
  return provisionalBpBaselines(samples, nowSec);
}

/** Test hook — clears the module cache between cases. */
export function __resetVitalBaselinesForTests(): void {
  cacheLoaded = false;
  cacheByFamily.clear();
}
