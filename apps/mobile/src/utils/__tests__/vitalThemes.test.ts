// vitalThemes — Sprint 8.5 unit tests.
//
// Pure-function helpers; no React. Verifies the per-vital display names,
// the D13 §7.1 ring fill formulas, and the convenience selector that
// pulls the right fill from a composed DailyPulseData snapshot.

import {
  activityFill,
  bpRingFill,
  clamp01,
  fillForVital,
  hrFill,
  sleepFill,
  spo2Fill,
  vitalTheme,
} from '../vitalThemes';
import {
  composeDailyPulseData,
  type DailyPulseSnapshot,
} from '../../state/dailyPulse';
import type { LocalReading } from '../../state/readings';

const NOW_SEC = Math.floor(Date.now() / 1000);

function emptySnapshot(): DailyPulseSnapshot {
  return {
    bpLatest: null,
    hrRestingToday: null,
    hrRestingRecent: [],
    hrLatestSampleAt: null,
    spo2LatestPercent: null,
    spo2OvernightLowsRecent: [],
    spo2LatestSampleAt: null,
    sleepSession: null,
    activityToday: null,
  };
}

describe('vitalTheme', () => {
  it('returns plain-language display names for every vital', () => {
    expect(vitalTheme('bp').displayName).toBe('Blood pressure');
    expect(vitalTheme('hr').displayName).toBe('Heart rate');
    expect(vitalTheme('spo2').displayName).toBe('Oxygen');
    expect(vitalTheme('sleep').displayName).toBe('Sleep');
    expect(vitalTheme('activity').displayName).toBe('Activity');
  });

  it('returns mono-uppercase eyebrow strings', () => {
    expect(vitalTheme('bp').eyebrowLabel).toBe('BP');
    expect(vitalTheme('hr').eyebrowLabel).toBe('HR');
    expect(vitalTheme('spo2').eyebrowLabel).toBe('OXYGEN');
    expect(vitalTheme('sleep').eyebrowLabel).toBe('SLEEP');
    expect(vitalTheme('activity').eyebrowLabel).toBe('ACTIVITY');
  });
});

describe('clamp01', () => {
  it('clamps below 0 → 0', () => expect(clamp01(-2)).toBe(0));
  it('clamps above 1 → 1', () => expect(clamp01(5)).toBe(1));
  it('passes mid-range through unchanged', () => expect(clamp01(0.42)).toBeCloseTo(0.42));
  it('NaN folds to 0', () => expect(clamp01(NaN)).toBe(0));
});

describe('bpRingFill (D13 §6.2 — stroke encodes data sufficiency)', () => {
  const verdictFor = (sampleCount: number) => ({
    tier: 'in_pattern' as const,
    reason: 'within_baseline' as const,
    verdict: {
      tier: 'in_range' as const,
      reason: 'inside_band' as const,
      band: { low: 118, high: 134 },
      deviation: 0,
      sampleCount,
      windowDays: 28,
      provisional: false,
    },
  });
  it('2 of 10 readings → 0.2 (the partial ring)', () =>
    expect(bpRingFill(verdictFor(2))).toBeCloseTo(0.2));
  it('10+ of 10 → capped at 1', () => expect(bpRingFill(verdictFor(14))).toBe(1));
  it('no classification → 0', () => expect(bpRingFill(null)).toBe(0));
  it('legacy row without a verdict → 0 (grey until reclassified)', () =>
    expect(bpRingFill({ tier: 'in_pattern', reason: 'within_baseline' })).toBe(0));
});

describe('hrFill — (resting - 40) / 80 clamped', () => {
  it('40 → 0', () => expect(hrFill(40)).toBe(0));
  it('120 → 1', () => expect(hrFill(120)).toBe(1));
  it('80 → 0.5', () => expect(hrFill(80)).toBeCloseTo(0.5));
  it('null → 0', () => expect(hrFill(null)).toBe(0));
});

describe('spo2Fill — (latest - 85) / 15 clamped', () => {
  it('85 → 0', () => expect(spo2Fill(85)).toBe(0));
  it('100 → 1', () => expect(spo2Fill(100)).toBe(1));
  it('null → 0', () => expect(spo2Fill(null)).toBe(0));
});

describe('sleepFill — sleep_score / 100', () => {
  it('0 → 0', () => expect(sleepFill(0)).toBe(0));
  it('100 → 1', () => expect(sleepFill(100)).toBe(1));
  it('clamps over 100', () => expect(sleepFill(150)).toBe(1));
  it('null → 0', () => expect(sleepFill(null)).toBe(0));
});

describe('activityFill — steps / target clamped', () => {
  it('half target → 0.5', () => expect(activityFill(3000, 6000)).toBeCloseTo(0.5));
  it('over-target clamps to 1', () => expect(activityFill(15000, 6000)).toBe(1));
  it('zero target → 0 (no divide-by-zero)', () => expect(activityFill(5000, 0)).toBe(0));
});

describe('fillForVital — convenience selector over DailyPulseData', () => {
  it('routes BP to the sufficiency formula (D13 §6.2)', () => {
    const reading: LocalReading = {
      localId: 'r1',
      serverId: null,
      measuredAtSec: NOW_SEC,
      systolic: 122,
      diastolic: 78,
      pulse: 64,
      source: 'watch',
      classification: {
        tier: 'in_pattern',
        reason: 'within_baseline',
        verdict: {
          tier: 'in_range',
          reason: 'inside_band',
          band: { low: 118, high: 134 },
          deviation: -4,
          sampleCount: 12,
          windowDays: 28,
          provisional: false,
        },
      },
      deviceBleId: null,
      capturedAtMs: NOW_SEC * 1000,
    };
    const data = composeDailyPulseData(
      { ...emptySnapshot(), bpLatest: reading },
      NOW_SEC,
    );
    expect(fillForVital('bp', data)).toBe(1.0);
  });

  it('returns 0 for every vital when DailyPulseData is empty', () => {
    const data = composeDailyPulseData(emptySnapshot(), NOW_SEC);
    expect(fillForVital('bp', data)).toBe(0);
    expect(fillForVital('hr', data)).toBe(0);
    expect(fillForVital('spo2', data)).toBe(0);
    expect(fillForVital('sleep', data)).toBe(0);
    expect(fillForVital('activity', data)).toBe(0);
  });
});
