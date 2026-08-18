// Deno tests for the shared classification module — Sprint 15.
//
// Mirrors apps/mobile/src/utils/__tests__/classification*.test.ts so
// drift between the two ports surfaces immediately.

import { assertEquals } from 'jsr:@std/assert@1';
import {
  classifyBP,
  classifyHR,
  classifySpO2,
  checkSustainedPattern,
  computeHrMedian,
  producesAnomalyEvent,
  shouldDedupAnomaly,
} from './classification.ts';

// BP — single-reading ────────────────────────────────────────────────

// The canonical §4.4 band fixture — mirrors the mobile suite
// (apps/mobile/src/utils/__tests__/classification.test.ts): display
// band 118–134, classification band 116–136.
const SYS_ROW = { mean: 126, sd: 5, p10: 118, p90: 134, isSufficient: true };
const DIA_ROW = { mean: 80, sd: 4, p10: 74, p90: 86, isSufficient: true };
const PAIR = { systolic: SYS_ROW, diastolic: DIA_ROW };

Deno.test('classifyBP — the 180/120 absolute floor always wins', () => {
  assertEquals(classifyBP({ systolic: 180, diastolic: 90 }).tier, 'confirmed_urgent');
  assertEquals(classifyBP({ systolic: 185, diastolic: 125 }, PAIR).reason, 'crisis_absolute');
  assertEquals(
    classifyBP({ systolic: 120, diastolic: 120 }, { systolic: null, diastolic: null }).tier,
    'confirmed_urgent',
  );
});

Deno.test('classifyBP — no baseline → learning (in_pattern/cold_start), even at 162', () => {
  // The retired cold-start ladder ambered 162 with no baseline; §4.3
  // says below the sufficiency gate nothing colours except the floor.
  const c = classifyBP({ systolic: 162, diastolic: 80 });
  assertEquals(c.tier, 'in_pattern');
  assertEquals(c.reason, 'cold_start');
});

Deno.test('classifyBP — insufficient rows → cold_start', () => {
  const c = classifyBP(
    { systolic: 162, diastolic: 80 },
    { systolic: { ...SYS_ROW, isSufficient: false }, diastolic: { ...DIA_ROW, isSufficient: false } },
  );
  assertEquals(c.reason, 'cold_start');
});

Deno.test('classifyBP — 140 against the 118–134 band → calm_concerned/outside_band', () => {
  const c = classifyBP({ systolic: 140, diastolic: 80 }, PAIR);
  assertEquals(c.tier, 'calm_concerned');
  assertEquals(c.reason, 'outside_band');
});

Deno.test('classifyBP — 130 inside the band → in_pattern', () => {
  assertEquals(classifyBP({ systolic: 130, diastolic: 80 }, PAIR).tier, 'in_pattern');
});

Deno.test('classifyBP — 135 on the shoulder (between p90 and mean+2σ) → in_pattern', () => {
  assertEquals(classifyBP({ systolic: 135, diastolic: 80 }, PAIR).tier, 'in_pattern');
});

Deno.test('classifyBP — diastolic outlier alone flags', () => {
  assertEquals(classifyBP({ systolic: 128, diastolic: 95 }, PAIR).tier, 'calm_concerned');
});

Deno.test('classifyBP — pulse no longer participates', () => {
  assertEquals(classifyBP({ systolic: 128, diastolic: 80, pulse: 135 }, PAIR).tier, 'in_pattern');
});

Deno.test('classifyBP — sensitivity > 1 widens the outlier band', () => {
  // 137 is just outside mean+2σ (136) at 1.0, inside at 1.5 (mean+3σ=141).
  assertEquals(classifyBP({ systolic: 137, diastolic: 80 }, PAIR, 1.0).tier, 'calm_concerned');
  assertEquals(classifyBP({ systolic: 137, diastolic: 80 }, PAIR, 1.5).tier, 'in_pattern');
});

Deno.test('classifyHR — bpm=30 → confirmed_urgent (extreme)', () => {
  const c = classifyHR({ restingBpmToday: 30, restingBpmRecent: [] });
  assertEquals(c.tier, 'confirmed_urgent');
});

Deno.test('classifyHR — cold-start in band → in_pattern', () => {
  const c = classifyHR({ restingBpmToday: 70, restingBpmRecent: [] });
  assertEquals(c.tier, 'in_pattern');
});

Deno.test('classifyHR — 3-day trend → calm_concerned', () => {
  const recent = [...Array.from({ length: 12 }, () => 70), 90, 92];
  const c = classifyHR({ restingBpmToday: 95, restingBpmRecent: recent });
  assertEquals(c.tier, 'calm_concerned');
  assertEquals(c.reason, 'baseline_3day_trend');
});

Deno.test('computeHrMedian — basic median', () => {
  assertEquals(computeHrMedian([60, 70, 80, 90, 100]), 80);
});

Deno.test('computeHrMedian — empty → null', () => {
  assertEquals(computeHrMedian([]), null);
});

// SpO2 ───────────────────────────────────────────────────────────────

Deno.test('classifySpO2 — overnight <88 sustained 3 nights → confirmed_urgent', () => {
  const c = classifySpO2({ latestPercent: 97, overnightLowsRecent: [85, 86, 87] });
  assertEquals(c.tier, 'confirmed_urgent');
});

Deno.test('classifySpO2 — single 88-89 overnight → calm_concerned', () => {
  const c = classifySpO2({ latestPercent: 97, overnightLowsRecent: [89] });
  assertEquals(c.tier, 'calm_concerned');
});

// producesAnomalyEvent ───────────────────────────────────────────────

Deno.test('producesAnomalyEvent — sleep never produces', () => {
  assertEquals(producesAnomalyEvent('sleep', 'calm_concerned'), false);
  assertEquals(producesAnomalyEvent('sleep', 'confirmed_urgent'), false);
});

Deno.test('producesAnomalyEvent — activity never produces', () => {
  assertEquals(producesAnomalyEvent('activity', 'progress'), false);
});

Deno.test('producesAnomalyEvent — bp tier-aware', () => {
  assertEquals(producesAnomalyEvent('bp', 'in_pattern'), false);
  assertEquals(producesAnomalyEvent('bp', 'calm_concerned'), true);
  assertEquals(producesAnomalyEvent('bp', 'confirmed_urgent'), true);
});

// shouldDedupAnomaly ────────────────────────────────────────────────

Deno.test('shouldDedupAnomaly — confirmed_urgent always fires', () => {
  const now = 1_715_000_000;
  assertEquals(shouldDedupAnomaly('confirmed_urgent', now - 60, now), false);
});

Deno.test('shouldDedupAnomaly — calm dedup inside 4h', () => {
  const now = 1_715_000_000;
  assertEquals(shouldDedupAnomaly('calm_concerned', now - 3600, now), true);
});

Deno.test('shouldDedupAnomaly — calm fires after 4h', () => {
  const now = 1_715_000_000;
  assertEquals(shouldDedupAnomaly('calm_concerned', now - 4 * 3600 - 1, now), false);
});

Deno.test('shouldDedupAnomaly — first event ever → fires', () => {
  const now = 1_715_000_000;
  assertEquals(shouldDedupAnomaly('calm_concerned', null, now), false);
});
