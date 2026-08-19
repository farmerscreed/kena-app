// The detector's honesty gates: a real sustained shift is found at the
// right week; a flat or merely noisy series yields NOTHING.
import {
  detectChangePoints,
  welchT,
  MIN_ABS_SHIFT,
  type WeeklyAnchor,
} from '../changePoints';

function anchors(means: number[]): WeeklyAnchor[] {
  return means.map((m, i) => ({
    weekStart: `2026-0${Math.floor(i / 4) + 1}-${String((i % 4) * 7 + 1).padStart(2, '0')}`,
    mean: m,
    sampleCount: 10,
  }));
}

it('finds a clean 10 mmHg step at the right anchor', () => {
  const series = anchors([140, 141, 139, 140, 141, 130, 129, 131, 130, 129]);
  const cps = detectChangePoints(series);
  expect(cps).toHaveLength(1);
  expect(cps[0].index).toBe(5);
  expect(cps[0].delta).toBeLessThan(-MIN_ABS_SHIFT);
  expect(cps[0].beforeMean).toBeCloseTo(140.2, 1);
  expect(cps[0].afterMean).toBeCloseTo(129.8, 1);
});

it('a flat series yields the honest null', () => {
  expect(detectChangePoints(anchors([132, 133, 131, 132, 133, 132, 131, 133]))).toEqual([]);
});

it('noise without a level change yields nothing', () => {
  expect(
    detectChangePoints(anchors([135, 128, 137, 130, 136, 129, 135, 131, 134, 130])),
  ).toEqual([]);
});

it('a 3 mmHg drift stays below the clinical noise floor', () => {
  expect(
    detectChangePoints(anchors([135, 135, 134, 135, 132, 132, 133, 132])),
  ).toEqual([]);
});

it('two sustained shifts both surface, in order', () => {
  const series = anchors([
    148, 149, 147, 148, 148, 140, 139, 141, 140, 139, 131, 130, 132, 131, 130,
  ]);
  const cps = detectChangePoints(series);
  expect(cps).toHaveLength(2);
  expect(cps[0].index).toBe(5);
  expect(cps[1].index).toBe(10);
});

it('a shift needs three weeks of evidence on each side', () => {
  // Level change in the last two anchors only — not sustained.
  expect(detectChangePoints(anchors([140, 141, 140, 139, 141, 128, 129]))).toEqual([]);
});

it('welchT handles degenerate variance', () => {
  expect(welchT([5, 5, 5], [5, 5, 5])).toBe(0);
  expect(welchT([5, 5, 5], [9, 9, 9])).toBe(Number.POSITIVE_INFINITY);
});
