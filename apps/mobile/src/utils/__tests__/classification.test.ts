import {
  classifyReading,
  tierChipText,
  tierPillVariant,
  type ReadingBaseline,
} from '../classification';

const baseline: ReadingBaseline = {
  sys: 124,
  dia: 78,
  pulse: 72,
  sigmaSys: 8,
  sigmaDia: 5,
  sigmaPulse: 6,
  daysOfData: 14,
};

describe('classifyReading — crisis absolute (always confirmed_urgent)', () => {
  it.each([
    [180, 100],
    [200, 70],
    [120, 120],
    [120, 130],
    [180, 120],
  ])('sys=%i dia=%i → confirmed_urgent (crisis_absolute)', (systolic, diastolic) => {
    const c = classifyReading({ systolic, diastolic, pulse: 72 }, baseline);
    expect(c.tier).toBe('confirmed_urgent');
    expect(c.reason).toBe('crisis_absolute');
  });

  it('crisis fires even with no baseline', () => {
    const c = classifyReading({ systolic: 185, diastolic: 95 });
    expect(c.tier).toBe('confirmed_urgent');
  });
});

describe('classifyReading — cold-start (no baseline / <14 days)', () => {
  it('sys=151 dia=80 → in_pattern (≤160 / ≤100 / pulse ≤130)', () => {
    expect(classifyReading({ systolic: 151, diastolic: 80, pulse: 80 }).tier).toBe('in_pattern');
  });

  it('sys=161 → calm_concerned (absolute_cold_start)', () => {
    const c = classifyReading({ systolic: 161, diastolic: 80, pulse: 80 });
    expect(c.tier).toBe('calm_concerned');
    expect(c.reason).toBe('absolute_cold_start');
  });

  it('dia=101 → calm_concerned', () => {
    expect(classifyReading({ systolic: 130, diastolic: 101, pulse: 80 }).tier).toBe(
      'calm_concerned',
    );
  });

  it('pulse=131 → calm_concerned', () => {
    expect(classifyReading({ systolic: 130, diastolic: 80, pulse: 131 }).tier).toBe(
      'calm_concerned',
    );
  });

  it('boundary sys=160 (NOT >) → in_pattern in cold start', () => {
    expect(classifyReading({ systolic: 160, diastolic: 80, pulse: 80 }).tier).toBe('in_pattern');
  });

  it('boundary dia=100 (NOT >) → in_pattern in cold start', () => {
    expect(classifyReading({ systolic: 130, diastolic: 100, pulse: 80 }).tier).toBe('in_pattern');
  });

  it('thin baseline (<14 days) takes the cold-start path', () => {
    const thin: ReadingBaseline = { ...baseline, daysOfData: 7 };
    expect(classifyReading({ systolic: 161, diastolic: 80, pulse: 80 }, thin).tier).toBe(
      'calm_concerned',
    );
  });
});

describe('classifyReading — hot path (full baseline)', () => {
  it('within ±2σ AND below soft thresholds → in_pattern', () => {
    const c = classifyReading({ systolic: 128, diastolic: 80, pulse: 74 }, baseline);
    expect(c.tier).toBe('in_pattern');
    expect(c.reason).toBe('within_baseline');
  });

  it('outlier alone (sys=151 = +27 vs baseline 124, σ 8) without soft threshold breach → in_pattern', () => {
    // sys=151 IS an outlier (>2σ over 124) AND >150 soft → should fire
    const c = classifyReading({ systolic: 151, diastolic: 80, pulse: 74 }, baseline);
    expect(c.tier).toBe('calm_concerned');
    expect(c.reason).toBe('outlier_and_soft_threshold');
  });

  it('soft-threshold breach alone without outlier (within ±2σ) → in_pattern', () => {
    const wide: ReadingBaseline = { ...baseline, sigmaSys: 30 };
    const c = classifyReading({ systolic: 151, diastolic: 80, pulse: 74 }, wide);
    expect(c.tier).toBe('in_pattern');
  });

  it('boundary sys=151 with σ=8: |151-124|=27 > 16 → outlier; >150 soft → calm_concerned', () => {
    expect(
      classifyReading({ systolic: 151, diastolic: 80, pulse: 74 }, baseline).tier,
    ).toBe('calm_concerned');
  });

  it('boundary sys=150 with σ=8: |150-124|=26 > 16 → outlier; NOT >150 → in_pattern', () => {
    expect(
      classifyReading({ systolic: 150, diastolic: 80, pulse: 74 }, baseline).tier,
    ).toBe('in_pattern');
  });

  it('boundary dia=96 with σ=5: |96-78|=18 > 10 → outlier; >95 soft → calm_concerned', () => {
    expect(
      classifyReading({ systolic: 130, diastolic: 96, pulse: 74 }, baseline).tier,
    ).toBe('calm_concerned');
  });

  it('boundary dia=95 with σ=5: |95-78|=17 > 10 → outlier; NOT >95 → in_pattern', () => {
    expect(
      classifyReading({ systolic: 130, diastolic: 95, pulse: 74 }, baseline).tier,
    ).toBe('in_pattern');
  });

  it('null/undefined pulse is tolerated (not counted)', () => {
    const c = classifyReading({ systolic: 128, diastolic: 80 }, baseline);
    expect(c.tier).toBe('in_pattern');
  });
});

describe('tier UI helpers', () => {
  it('tierChipText matches the docs/04-screens/reading-detail.md mapping', () => {
    // Sprint 19 (audit D12 P2-1) — "In pattern" was the internal enum
    // name (`in_pattern`) promoted to user copy, competing with five
    // other phrases for the same idea. Canonical vocabulary now.
    expect(tierChipText('in_pattern')).toBe('In your usual range');
    expect(tierChipText('calm_concerned')).toBe('Worth a look');
    expect(tierChipText('confirmed_urgent')).toBe('Talk to your doctor');
  });

  it('tierPillVariant matches the design-tokens semantic colour assignment', () => {
    expect(tierPillVariant('in_pattern')).toBe('success');
    expect(tierPillVariant('calm_concerned')).toBe('accent');
    expect(tierPillVariant('confirmed_urgent')).toBe('urgent');
  });
});
