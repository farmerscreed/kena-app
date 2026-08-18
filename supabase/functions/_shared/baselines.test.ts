// Deno tests for the shared baseline maths — D13 PR-1.
//
// The FIXTURE_* arrays here are duplicated verbatim in the mobile
// suite (apps/mobile/src/utils/__tests__/vitalBaselines.accessor.test.ts)
// so the server row and the client's provisional offline fallback are
// pinned against the same numbers. Change one, change both.

import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert@1';
import {
  BASELINE_WINDOW_DAYS,
  CONTEXT_MIN_READINGS,
  SUFFICIENCY,
  computeVitalBaselineRow,
  computeBpBaselineRows,
  percentile,
  type BpReadingSample,
} from './baselines.ts';

// The canonical D13 §10 done-when fixture: a user whose usual band is
// ~118–134. Twelve readings across eight distinct days.
export const FIXTURE_SYS = [118, 120, 122, 124, 125, 126, 126, 127, 128, 130, 132, 134];
export const FIXTURE_DAYS = ['d1', 'd1', 'd2', 'd2', 'd3', 'd3', 'd4', 'd4', 'd5', 'd6', 'd7', 'd8'];

const sysSamples = FIXTURE_SYS.map((value, i) => ({ value, dayKey: FIXTURE_DAYS[i] }));

Deno.test('computeVitalBaselineRow — canonical BP fixture', () => {
  const row = computeVitalBaselineRow('bp_systolic', sysSamples);
  if (!row) throw new Error('expected a row');
  assertEquals(row.windowDays, BASELINE_WINDOW_DAYS);
  assertEquals(row.sampleCount, 12);
  assertEquals(row.mean, 126);
  assertAlmostEquals(row.sd, 4.490731195, 1e-6);
  assertEquals(row.p10, 120);
  assertEquals(row.p90, 132);
  assertEquals(row.isSufficient, true); // 12 readings ≥ 10, 8 days ≥ 7
});

Deno.test('computeVitalBaselineRow — below the §4.3 gate keeps the row, drops sufficiency', () => {
  const four = sysSamples.slice(0, 4);
  const row = computeVitalBaselineRow('bp_systolic', four);
  if (!row) throw new Error('expected a row');
  assertEquals(row.sampleCount, 4);
  assertEquals(row.isSufficient, false);
});

Deno.test('computeVitalBaselineRow — count met but days not met is insufficient', () => {
  // 10 readings all on the same two days: count clears, days do not.
  const samples = FIXTURE_SYS.slice(0, 10).map((value, i) => ({
    value,
    dayKey: i % 2 === 0 ? 'd1' : 'd2',
  }));
  const row = computeVitalBaselineRow('bp_systolic', samples);
  if (!row) throw new Error('expected a row');
  assertEquals(row.isSufficient, false);
});

Deno.test('computeVitalBaselineRow — no samples means no row, never a fabricated band', () => {
  assertEquals(computeVitalBaselineRow('spo2', []), null);
});

Deno.test('sufficiency table matches D13 §4.3 classification column', () => {
  assertEquals(SUFFICIENCY.bp_systolic, { minCount: 10, minDays: 7 });
  assertEquals(SUFFICIENCY.bp_diastolic, { minCount: 10, minDays: 7 });
  assertEquals(SUFFICIENCY.resting_hr, { minCount: 7, minDays: 7 });
  assertEquals(SUFFICIENCY.spo2, { minCount: 10, minDays: 10 });
  assertEquals(SUFFICIENCY.sleep_duration, { minCount: 10, minDays: 10 });
  assertEquals(SUFFICIENCY.steps_daily, { minCount: 10, minDays: 10 });
});

Deno.test('percentile — nearest-rank matches the client formula', () => {
  // idx = min(n-1, floor(n·pct)); n=12 → p10 at idx 1, p90 at idx 10.
  const sorted = [...FIXTURE_SYS].sort((a, b) => a - b);
  assertEquals(percentile(sorted, 0.1), sorted[1]);
  assertEquals(percentile(sorted, 0.9), sorted[10]);
  assertEquals(percentile([7], 0.9), 7);
  assertEquals(percentile([], 0.5), 0);
});

// Context-conditioned rows — BP only, ≥ CONTEXT_MIN_READINGS per tag.

function bpFixture(): BpReadingSample[] {
  return FIXTURE_SYS.map((systolic, i) => ({
    systolic,
    diastolic: 80,
    dayKey: FIXTURE_DAYS[i],
    // Tag the first eight readings 'morning', the next three 'evening'.
    contextTags: i < 8 ? ['morning'] : i < 11 ? ['evening'] : [],
  }));
}

Deno.test('computeBpBaselineRows — all-readings pair plus qualifying context pairs', () => {
  const rows = computeBpBaselineRows(bpFixture());
  const keys = rows.map((r) => `${r.vital}:${r.contextTag ?? ''}`).sort();
  // 'morning' has 8 readings (= CONTEXT_MIN_READINGS) → rows.
  // 'evening' has 3 (< 8) → no rows.
  assertEquals(keys, [
    'bp_diastolic:',
    'bp_diastolic:morning',
    'bp_systolic:',
    'bp_systolic:morning',
  ]);
  const morningSys = rows.find((r) => r.vital === 'bp_systolic' && r.contextTag === 'morning');
  if (!morningSys) throw new Error('expected the morning systolic row');
  assertEquals(morningSys.sampleCount, CONTEXT_MIN_READINGS);
});

Deno.test('computeBpBaselineRows — a tag one short of the gate earns no row', () => {
  const readings = bpFixture().map((r, i) => ({
    ...r,
    contextTags: i < 7 ? ['after_meds'] : [],
  }));
  const rows = computeBpBaselineRows(readings);
  assertEquals(rows.filter((r) => r.contextTag !== null).length, 0);
});
