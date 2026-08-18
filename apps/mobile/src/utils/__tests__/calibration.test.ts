// Calibration ladder — D13 PR-4. The done-when, as tests: a
// two-reading account is grey everywhere with a partial ring, and
// each staged unlock requires exactly the data it waits for.

import {
  REQUIRED_COUNT,
  ringCalibration,
  bpRingCalibration,
  unlockedCapabilities,
  UNLOCK_STAGES,
  LEARNING_COPY,
} from '../calibration';
import { classifyVital, type VitalBaseline } from '../classification';

const insufficientBaseline = (sampleCount: number): VitalBaseline => ({
  vital: 'bp_systolic',
  windowDays: 28,
  sampleCount,
  mean: 126,
  sd: 5,
  p10: 118,
  p90: 134,
  contextTag: null,
  isSufficient: false,
  computedAt: null,
  provisional: true,
});

describe('ringCalibration — §6.2 stroke encodes sufficiency', () => {
  it('two readings → learning, fill 0.2', () => {
    const verdict = classifyVital(
      { vital: 'bp_systolic', value: 128 },
      insufficientBaseline(2),
    );
    const cal = ringCalibration(verdict, 'bp_systolic');
    expect(cal.isLearning).toBe(true);
    expect(cal.fillFraction).toBeCloseTo(0.2);
    expect(cal.sampleCount).toBe(2);
    expect(cal.requiredCount).toBe(10);
  });

  it('no verdict at all → learning, empty ring', () => {
    const cal = ringCalibration(null, 'resting_hr');
    expect(cal).toEqual({
      isLearning: true,
      fillFraction: 0,
      sampleCount: 0,
      requiredCount: REQUIRED_COUNT.resting_hr,
    });
  });

  it('sufficient verdict → not learning, full ring', () => {
    const verdict = classifyVital(
      { vital: 'bp_systolic', value: 128 },
      { ...insufficientBaseline(12), isSufficient: true, provisional: false },
    );
    const cal = ringCalibration(verdict, 'bp_systolic');
    expect(cal.isLearning).toBe(false);
    expect(cal.fillFraction).toBe(1);
  });

  it('a legacy Classification without a verdict is treated as learning', () => {
    const cal = bpRingCalibration({ tier: 'in_pattern', reason: 'within_baseline' });
    expect(cal.isLearning).toBe(true);
    expect(cal.fillFraction).toBe(0);
  });
});

describe('staged unlocks — each requires the data it waits for', () => {
  it('day thresholds are exactly the §10 ladder', () => {
    expect(UNLOCK_STAGES.map((s) => s.atDay)).toEqual([1, 2, 4, 7, 14, 21, 30]);
  });

  it.each([
    [0, []],
    [1, ['first_reading_visible']],
    [2, ['first_reading_visible', 'day_over_day']],
    [3, ['first_reading_visible', 'day_over_day']],
    [4, ['first_reading_visible', 'day_over_day', 'early_shape']],
    [6, ['first_reading_visible', 'day_over_day', 'early_shape']],
  ])('%i distinct days unlock %j', (days, expected) => {
    expect(unlockedCapabilities(days as number, false)).toEqual(expected);
  });

  it('day 7 alone does NOT unlock the personal band — sufficiency is part of its data', () => {
    expect(unlockedCapabilities(7, false)).not.toContain('personal_band');
    expect(unlockedCapabilities(7, true)).toContain('personal_band');
  });

  it('every later stage still requires its day count even when sufficiency arrives early', () => {
    const unlocked = unlockedCapabilities(8, true);
    expect(unlocked).toContain('personal_band');
    expect(unlocked).not.toContain('fourteen_day_trend');
    expect(unlocked).not.toContain('context_conditioning');
    expect(unlocked).not.toContain('full_window');
  });

  it('day 30 with sufficiency unlocks everything', () => {
    expect(unlockedCapabilities(30, true)).toHaveLength(UNLOCK_STAGES.length);
  });
});

describe('§7.7 copy — verbatim', () => {
  it('vital detail learning body', () => {
    expect(LEARNING_COPY.vitalDetail.headline).toBe('Still learning');
    expect(LEARNING_COPY.vitalDetail.body(2, 10, 'Mum')).toBe(
      "We have 2 of the 10 readings we need before we can tell you what's usual for Mum.",
    );
  });

  it('monitor + correlation learning copy', () => {
    expect(LEARNING_COPY.monitorAllLearning.headline('Mum')).toBe('Getting to know Mum');
    expect(LEARNING_COPY.monitorAllLearning.body).toBe(
      'Each of these fills in as readings come through. Most take about a week.',
    );
    expect(LEARNING_COPY.correlationLearning.headline).toBe('Not yet');
  });
});
