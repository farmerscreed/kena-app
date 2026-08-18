// readingBaseline — Sprint 19 (audit D12 P0-2 / P0-3).
//
// These tests pin the two things that matter:
//   1. The maths agrees with the server (`_shared/classification.ts`
//      `computeBpBaseline`) — same window, same population sigma, same
//      distinct-UTC-date day count. If the two drift, a user sees one
//      tier on-device and gets a push computed from another.
//   2. Wiring the baseline in actually CHANGES what the classifier says,
//      which is the whole point of the fix — the regression this guards
//      is someone quietly passing `null` again.

import {
  BASELINE_WINDOW_DAYS,
  computeReadingBaseline,
  type BaselineSample,
} from '../readingBaseline';
import { classifyReading } from '../classification';

const DAY = 24 * 60 * 60;
const NOW = 1_760_000_000; // fixed; no Date.now() in assertions

function sample(
  daysAgo: number,
  systolic: number,
  diastolic: number,
  pulse: number | null = 70,
): BaselineSample {
  return {
    measuredAtSec: NOW - daysAgo * DAY,
    systolic,
    diastolic,
    pulse,
  };
}

/** 20 days of steady readings — a mature baseline with tiny variance. */
function steadyHistory(): BaselineSample[] {
  return Array.from({ length: 20 }, (_, i) =>
    sample(i, 130 + (i % 2), 82 + (i % 2), 70),
  );
}

describe('computeReadingBaseline', () => {
  it('returns null with no samples', () => {
    expect(computeReadingBaseline([], NOW)).toBeNull();
  });

  it('returns null when every sample is outside the window', () => {
    const old = [sample(BASELINE_WINDOW_DAYS + 5, 130, 82)];
    expect(computeReadingBaseline(old, NOW)).toBeNull();
  });

  it('uses a 14-day window, matching detect-anomaly on the server', () => {
    expect(BASELINE_WINDOW_DAYS).toBe(14);
    const mixed = [
      sample(1, 120, 80),
      sample(2, 120, 80),
      // Outside the window — must not drag the mean.
      sample(30, 200, 120),
    ];
    const b = computeReadingBaseline(mixed, NOW);
    expect(b).not.toBeNull();
    expect(b!.sys).toBe(120);
    expect(b!.dia).toBe(80);
  });

  it('computes population sigma (1/N), not sample sigma (1/(N-1))', () => {
    // values 10 and 20 → mean 15; population sigma = 5, sample = 7.07.
    const b = computeReadingBaseline(
      [sample(1, 10, 10, null), sample(2, 20, 20, null)],
      NOW,
    );
    expect(b!.sigmaSys).toBeCloseTo(5, 10);
    expect(b!.sigmaDia).toBeCloseTo(5, 10);
  });

  it('counts daysOfData as distinct UTC dates, not sample count', () => {
    // Six samples, all on two calendar days.
    const sameDay = [
      sample(0, 130, 82),
      sample(0, 131, 83),
      sample(0, 129, 81),
      sample(1, 130, 82),
      sample(1, 131, 83),
      sample(1, 129, 81),
    ];
    const b = computeReadingBaseline(sameDay, NOW);
    expect(b!.daysOfData).toBe(2);
  });

  it('handles an all-null pulse history without producing NaN', () => {
    const b = computeReadingBaseline(
      [sample(1, 130, 82, null), sample(2, 132, 84, null)],
      NOW,
    );
    expect(b!.pulse).toBe(0);
    expect(b!.sigmaPulse).toBe(0);
    expect(Number.isNaN(b!.sigmaSys)).toBe(false);
  });

  it('ignores samples dated in the future', () => {
    const b = computeReadingBaseline(
      [sample(1, 120, 80), sample(-3, 200, 120)],
      NOW,
    );
    expect(b!.sys).toBe(120);
  });
});

describe('baseline changes what the classifier says (the P0-2 fix)', () => {
  const history = steadyHistory();
  const baseline = computeReadingBaseline(history, NOW)!;

  it('produces a mature baseline from 20 days of readings', () => {
    expect(baseline.daysOfData).toBeGreaterThanOrEqual(14);
  });

  it('flags a personal outlier that the absolute ladder would pass', () => {
    // 152/94 is under the old STAGE2 gate (160/100) but far outside a
    // user whose own band is ~130/82 with sub-1 sigma. Before the fix
    // this rendered "within your range".
    const reading = { systolic: 152, diastolic: 94, pulse: 72 };
    expect(classifyReading(reading, null).tier).toBe('in_pattern');
    expect(classifyReading(reading, baseline).tier).toBe('calm_concerned');
  });

  it('leaves a reading inside the personal band alone', () => {
    const reading = { systolic: 131, diastolic: 83, pulse: 70 };
    expect(classifyReading(reading, baseline).tier).toBe('in_pattern');
  });

  it('still lets crisis-absolute win regardless of baseline', () => {
    const reading = { systolic: 185, diastolic: 125, pulse: 70 };
    expect(classifyReading(reading, baseline).tier).toBe('confirmed_urgent');
    expect(classifyReading(reading, baseline).reason).toBe('crisis_absolute');
  });

  it('falls back to cold-start when the window is too short', () => {
    const short = computeReadingBaseline(
      [sample(0, 130, 82), sample(1, 131, 83)],
      NOW,
    )!;
    expect(short.daysOfData).toBeLessThan(14);
    // Immature baseline → classifier ignores it and uses the ladder.
    expect(classifyReading({ systolic: 152, diastolic: 94 }, short).reason).toBe(
      'cold_start',
    );
  });
});
