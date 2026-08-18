// BP classification — D13 PR-1 (§4.4). Rewritten from the Sprint 6
// suite: the cold-start absolute ladder (161/101 → amber before any
// baseline existed) and the outlier-AND-soft-threshold conjunction are
// spec-retired. Verdicts now come from the person's own 28-day band;
// below the §4.3 sufficiency gate everything is the learning state,
// with the 180/120 absolute floor as the single exception.

import {
  classifyReading,
  classifyVital,
  confirmedOutsideBand,
  tierChipText,
  tierPillVariant,
  type VitalBaseline,
} from '../classification';

// The canonical D13 §10 done-when band: "a user whose band is 118–134
// sees 140 classified worth_a_look and 130 classified in_range."
// Display band (p10–p90) 118–134; classification band (mean ± 2σ)
// 116–136 — so 135 sits on the soft shoulder.
const sysBaseline: VitalBaseline = {
  vital: 'bp_systolic',
  windowDays: 28,
  sampleCount: 12,
  mean: 126,
  sd: 5,
  p10: 118,
  p90: 134,
  contextTag: null,
  isSufficient: true,
  computedAt: '2026-08-18T03:00:00Z',
  provisional: false,
};

const diaBaseline: VitalBaseline = {
  ...sysBaseline,
  vital: 'bp_diastolic',
  mean: 80,
  sd: 4,
  p10: 74,
  p90: 86,
};

const insufficientSys: VitalBaseline = {
  ...sysBaseline,
  sampleCount: 4,
  isSufficient: false,
};

const provisionalSys: VitalBaseline = {
  ...sysBaseline,
  computedAt: null,
  provisional: true,
};

const pair = { systolic: sysBaseline, diastolic: diaBaseline };

describe('classifyVital — rules in §4.4 order', () => {
  it('140 against the 118–134 band → worth_a_look (outside mean ± 2σ)', () => {
    const v = classifyVital({ vital: 'bp_systolic', value: 140 }, sysBaseline);
    expect(v.tier).toBe('worth_a_look');
    expect(v.reason).toBe('outside_band');
    expect(v.band).toEqual({ low: 118, high: 134 });
    expect(v.deviation).toBe(14);
  });

  it('130 against the 118–134 band → in_range', () => {
    const v = classifyVital({ vital: 'bp_systolic', value: 130 }, sysBaseline);
    expect(v.tier).toBe('in_range');
    expect(v.reason).toBe('inside_band');
  });

  it('135 sits on the shoulder (between p90 and mean + 2σ) → in_range, never flagged', () => {
    expect(classifyVital({ vital: 'bp_systolic', value: 135 }, sysBaseline).tier).toBe(
      'in_range',
    );
  });

  it('the shoulder is symmetric below (117 between mean − 2σ and p10) → in_range', () => {
    expect(classifyVital({ vital: 'bp_systolic', value: 117 }, sysBaseline).tier).toBe(
      'in_range',
    );
  });

  it('band endpoints are inclusive', () => {
    expect(classifyVital({ vital: 'bp_systolic', value: 118 }, sysBaseline).tier).toBe(
      'in_range',
    );
    expect(classifyVital({ vital: 'bp_systolic', value: 134 }, sysBaseline).tier).toBe(
      'in_range',
    );
  });

  it('below the classification band is also worth_a_look (bands are two-sided)', () => {
    const v = classifyVital({ vital: 'bp_systolic', value: 110 }, sysBaseline);
    expect(v.tier).toBe('worth_a_look');
    expect(v.deviation).toBe(-16);
  });
});

describe('classifyVital — the 180/120 absolute floor (§4.3)', () => {
  it.each([
    ['sufficient baseline', sysBaseline],
    ['no baseline', null],
    ['insufficient baseline', insufficientSys],
    ['provisional baseline', provisionalSys],
  ])('systolic 185 escalates with %s', (_label, b) => {
    const v = classifyVital({ vital: 'bp_systolic', value: 185 }, b as VitalBaseline | null);
    expect(v.tier).toBe('talk_to_doctor');
    expect(v.reason).toBe('absolute_floor');
  });

  it('diastolic 125 escalates regardless of band', () => {
    const v = classifyVital({ vital: 'bp_diastolic', value: 125 }, diaBaseline);
    expect(v.tier).toBe('talk_to_doctor');
    expect(v.reason).toBe('absolute_floor');
  });

  it('the floor is inclusive at exactly 180 / 120', () => {
    expect(classifyVital({ vital: 'bp_systolic', value: 180 }, null).tier).toBe(
      'talk_to_doctor',
    );
    expect(classifyVital({ vital: 'bp_diastolic', value: 120 }, null).tier).toBe(
      'talk_to_doctor',
    );
  });

  it('179 / 119 do NOT hit the floor', () => {
    expect(classifyVital({ vital: 'bp_systolic', value: 179 }, null).tier).toBe('learning');
    expect(classifyVital({ vital: 'bp_diastolic', value: 119 }, null).tier).toBe('learning');
  });
});

describe('classifyVital — learning state (§4.3 sufficiency gate)', () => {
  it('no baseline at all → learning, no band', () => {
    const v = classifyVital({ vital: 'bp_systolic', value: 161 }, null);
    expect(v.tier).toBe('learning');
    expect(v.reason).toBe('insufficient_data');
    expect(v.band).toBeNull();
    expect(v.sampleCount).toBe(0);
  });

  it('an insufficient row → learning, even for a formerly-amber value like 161', () => {
    // The Sprint 6 cold-start ladder amber-flagged 161/101 with no
    // baseline. D13 §4.3: below threshold no coloured verdict — the
    // absolute floor at 180/120 is the only exception.
    const v = classifyVital({ vital: 'bp_systolic', value: 161 }, insufficientSys);
    expect(v.tier).toBe('learning');
    expect(v.sampleCount).toBe(4);
  });

  it('carries the provisional flag through the verdict', () => {
    expect(classifyVital({ vital: 'bp_systolic', value: 130 }, provisionalSys).provisional).toBe(
      true,
    );
    expect(classifyVital({ vital: 'bp_systolic', value: 130 }, sysBaseline).provisional).toBe(
      false,
    );
  });
});

describe('confirmedOutsideBand — three consecutive, same side, 72h (§4.4)', () => {
  const H = 3600;
  const entry = (value: number, hoursAgo: number) => ({
    value,
    measuredAtSec: 1_700_000_000 - hoursAgo * H,
  });

  it('three above mean + 2σ within 72h → confirmed', () => {
    expect(
      confirmedOutsideBand([entry(140, 0), entry(139, 24), entry(141, 60)], sysBaseline),
    ).toBe(true);
  });

  it('three below mean − 2σ within 72h → confirmed', () => {
    expect(
      confirmedOutsideBand([entry(110, 0), entry(112, 20), entry(111, 40)], sysBaseline),
    ).toBe(true);
  });

  it('mixed directions never confirm', () => {
    expect(
      confirmedOutsideBand([entry(140, 0), entry(110, 24), entry(141, 60)], sysBaseline),
    ).toBe(false);
  });

  it('two outliers are not enough', () => {
    expect(confirmedOutsideBand([entry(140, 0), entry(139, 24)], sysBaseline)).toBe(false);
  });

  it('a streak wider than 72h does not confirm', () => {
    expect(
      confirmedOutsideBand([entry(140, 0), entry(139, 24), entry(141, 80)], sysBaseline),
    ).toBe(false);
  });

  it('an in-band reading in the middle breaks the streak', () => {
    expect(
      confirmedOutsideBand([entry(140, 0), entry(126, 24), entry(141, 48)], sysBaseline),
    ).toBe(false);
  });

  it('never confirms against an insufficient baseline', () => {
    expect(
      confirmedOutsideBand([entry(140, 0), entry(139, 24), entry(141, 60)], insufficientSys),
    ).toBe(false);
  });
});

describe('classifyReading — the legacy-shaped adapter', () => {
  it('in-band reading → in_pattern / within_baseline, verdict carried', () => {
    const c = classifyReading({ systolic: 128, diastolic: 80, pulse: 74 }, pair);
    expect(c.tier).toBe('in_pattern');
    expect(c.reason).toBe('within_baseline');
    expect(c.verdict?.tier).toBe('in_range');
  });

  it('140 systolic → calm_concerned; a single outlier never escalates further', () => {
    const c = classifyReading({ systolic: 140, diastolic: 80 }, pair);
    expect(c.tier).toBe('calm_concerned');
    expect(c.reason).toBe('outlier_and_soft_threshold');
    expect(c.verdict?.tier).toBe('worth_a_look');
  });

  it('takes the more severe of systolic and diastolic', () => {
    // Systolic in range, diastolic outside its 72–88 classification band.
    const c = classifyReading({ systolic: 128, diastolic: 95 }, pair);
    expect(c.tier).toBe('calm_concerned');
  });

  it('185/125 → confirmed_urgent / crisis_absolute with or without baselines', () => {
    expect(classifyReading({ systolic: 185, diastolic: 125 }, pair).reason).toBe(
      'crisis_absolute',
    );
    expect(classifyReading({ systolic: 185, diastolic: 125 }).tier).toBe('confirmed_urgent');
  });

  it('no baselines → in_pattern / cold_start (the learning state, uncoloured)', () => {
    const c = classifyReading({ systolic: 161, diastolic: 101 });
    expect(c.tier).toBe('in_pattern');
    expect(c.reason).toBe('cold_start');
    expect(c.verdict?.tier).toBe('learning');
  });

  it('three consecutive same-side outliers in 72h escalate to confirmed_urgent', () => {
    const nowSec = 1_700_000_000;
    const history = [
      { systolic: 140, diastolic: 80, measuredAtSec: nowSec },
      { systolic: 139, diastolic: 81, measuredAtSec: nowSec - 24 * 3600 },
      { systolic: 141, diastolic: 80, measuredAtSec: nowSec - 60 * 3600 },
    ];
    const c = classifyReading({ systolic: 140, diastolic: 80 }, pair, history);
    expect(c.tier).toBe('confirmed_urgent');
    expect(c.reason).toBe('outside_band_confirmed');
    expect(c.verdict?.tier).toBe('talk_to_doctor');
  });

  it('a broken streak stays calm_concerned', () => {
    const nowSec = 1_700_000_000;
    const history = [
      { systolic: 140, diastolic: 80, measuredAtSec: nowSec },
      { systolic: 126, diastolic: 80, measuredAtSec: nowSec - 24 * 3600 },
      { systolic: 141, diastolic: 80, measuredAtSec: nowSec - 60 * 3600 },
    ];
    const c = classifyReading({ systolic: 140, diastolic: 80 }, pair, history);
    expect(c.tier).toBe('calm_concerned');
  });

  it('pulse no longer participates in BP classification', () => {
    const c = classifyReading({ systolic: 128, diastolic: 80, pulse: 135 }, pair);
    expect(c.tier).toBe('in_pattern');
  });
});

describe('tier UI helpers', () => {
  it('tierChipText keeps the canonical vocabulary', () => {
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
