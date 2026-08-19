// changePoints — the Story Trends detector (D13 decisions log #1 named
// this as the right remedy when a band moves for real: "a change-point
// detector, not a shorter window").
//
// Finds genuine shifts in a person's weekly mean series (systolic by
// default) via binary segmentation with honest gates:
//
//   · a candidate split must leave ≥ MIN_SEGMENT_WEEKS on each side —
//     a shift needs sustained evidence, not a bad weekend;
//   · the level change must clear BOTH an absolute floor (4 mmHg —
//     below that nobody's life changed) and a Welch t statistic ≥ 2
//     (≈ p < 0.05 for the segment sizes involved);
//   · recursion stops when no candidate clears the gates, so a flat
//     series honestly yields zero chapters.
//
// STATISTICAL, not clinical: a change point says "the level moved
// here", never why. The chapter builder pairs it with what else was
// happening (medication log, tag regularity); the copy layer keeps
// every sentence observational.

export interface WeeklyAnchor {
  /** ISO date (YYYY-MM-DD) of the week's anchor (Monday). */
  weekStart: string;
  /** Mean of the vital across the trailing window at this anchor. */
  mean: number;
  /** Sample count behind the mean — anchors below MIN_ANCHOR_SAMPLES
   *  are excluded by the caller. */
  sampleCount: number;
}

export interface ChangePoint {
  /** Anchor index at which the new level begins. */
  index: number;
  weekStart: string;
  beforeMean: number;
  afterMean: number;
  /** Signed, after − before: negative = the level came down. */
  delta: number;
  tStat: number;
}

export const MIN_SEGMENT_WEEKS = 3;
export const MIN_ABS_SHIFT = 4; // mmHg — the clinical noise floor
export const MIN_T_STAT = 2;

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function variance(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const x of xs) s += (x - mu) * (x - mu);
  return s / (xs.length - 1);
}

/** Welch t between two segments; 0 when degenerate. */
export function welchT(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a, ma);
  const vb = variance(b, mb);
  const se = Math.sqrt(va / a.length + vb / b.length);
  if (se === 0) return Math.abs(ma - mb) > 0 ? Number.POSITIVE_INFINITY : 0;
  return Math.abs(ma - mb) / se;
}

function bestSplit(values: number[], offset: number): ChangePoint | null {
  let best: ChangePoint | null = null;
  for (let i = MIN_SEGMENT_WEEKS; i <= values.length - MIN_SEGMENT_WEEKS; i++) {
    const left = values.slice(0, i);
    const right = values.slice(i);
    const delta = mean(right) - mean(left);
    if (Math.abs(delta) < MIN_ABS_SHIFT) continue;
    const t = welchT(left, right);
    if (t < MIN_T_STAT) continue;
    if (!best || t > best.tStat) {
      best = {
        index: offset + i,
        weekStart: '',
        beforeMean: mean(left),
        afterMean: mean(right),
        delta,
        tStat: t,
      };
    }
  }
  return best;
}

/**
 * Binary segmentation over the weekly anchors. Returns change points in
 * chronological order; an empty array is the honest null result.
 */
export function detectChangePoints(anchors: WeeklyAnchor[]): ChangePoint[] {
  const out: ChangePoint[] = [];
  const values = anchors.map((a) => a.mean);

  const recurse = (start: number, end: number) => {
    const seg = values.slice(start, end);
    if (seg.length < MIN_SEGMENT_WEEKS * 2) return;
    const split = bestSplit(seg, start);
    if (!split) return;
    recurse(start, split.index);
    out.push(split);
    recurse(split.index, end);
  };

  recurse(0, values.length);
  out.sort((a, b) => a.index - b.index);
  return out.map((cp) => ({ ...cp, weekStart: anchors[cp.index].weekStart }));
}
