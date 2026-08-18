// trendsTierC engine unit tests — Sprint 16.5g.
//
// Exercises pickFocalVital, pickCitedDayIndex, buildTrendsLetter,
// buildWeeklySummary. Pure helpers; no React, no Supabase, no MMKV.

import {
  buildTrendsLetter,
  buildWeeklySummary,
  pickCitedDayIndex,
  pickFocalVital,
} from '../trendsTierC';
import type { TrendsData } from '../../../utils/trends-aggregate';
import type { CorrelationRow } from '../../../types/database';

function makeBPSeries(values: Array<[string, number, number]>) {
  return values.map(([day, sys, dia]) => ({
    day,
    sys,
    dia,
    pulse: null,
    count: 1,
  }));
}

function makeTrends(
  overrides: Partial<TrendsData['summary']> = {},
  series: Partial<TrendsData['series']> = {},
): TrendsData {
  return {
    series: {
      bp: makeBPSeries([
        ['2026-05-01', 122, 78],
        ['2026-05-02', 124, 80],
        ['2026-05-03', 121, 77],
        ['2026-05-04', 125, 81],
        ['2026-05-05', 145, 92], // outlier
        ['2026-05-06', 123, 79],
      ]),
      hr: [],
      spo2: [],
      sleep: [],
      activity: [],
      ...series,
    },
    summary: {
      bp: { count: 6, avgSys: 126, avgDia: 81, pctInRange: 0.83 },
      hr: { count: 0, avgResting: null },
      spo2: { count: 0, avgMinPercent: null },
      sleep: { count: 0, avgTotalMinutes: null },
      activity: { count: 0, avgSteps: null },
      ...overrides,
    },
  };
}

function makeCorrelation(
  type: CorrelationRow['correlation_type'],
  pearson_r = 0.6,
): CorrelationRow {
  return {
    id: `c-${type}`,
    family_id: 'fam',
    user_id: 'usr',
    correlation_type: type,
    pearson_r,
    p_value: 0.01,
    is_meaningful: true,
    sample_size: 20,
    sample_n: 20,
    effect_size: pearson_r,
    effect_unit: '',
    significance: 'meaningful',
    computed_at: '2026-05-06T00:00:00Z',
    created_at: '2026-05-06T00:00:00Z',
    window_days: 30,
    narrative_short: null,
    narrative_long: null,
  } as unknown as CorrelationRow;
}

describe('pickFocalVital', () => {
  it('picks BP when no correlations and BP has data', () => {
    expect(
      pickFocalVital({
        data: makeTrends(),
        correlations: [],
        range: '30d',
        accountType: 'self_buyer',
      }),
    ).toBe('bp');
  });

  it('picks the correlation primary vital when one exists', () => {
    expect(
      pickFocalVital({
        data: makeTrends(),
        correlations: [makeCorrelation('activity_x_resting_hr')],
        range: '30d',
        accountType: 'self_buyer',
      }),
    ).toBe('hr');
    expect(
      pickFocalVital({
        data: makeTrends(),
        correlations: [makeCorrelation('spo2_dip_x_sleep_score')],
        range: '30d',
        accountType: 'self_buyer',
      }),
    ).toBe('spo2');
  });

  it('falls back through vitals when BP is empty', () => {
    expect(
      pickFocalVital({
        data: makeTrends({
          bp: { count: 0, avgSys: null, avgDia: null, pctInRange: null },
          hr: { count: 5, avgResting: 70 },
        }),
        correlations: [],
        range: '7d',
        accountType: 'self_buyer',
      }),
    ).toBe('hr');
  });
});

describe('pickCitedDayIndex', () => {
  it('returns null with too few data points', () => {
    expect(
      pickCitedDayIndex(
        makeTrends(
          {},
          {
            bp: makeBPSeries([
              ['2026-05-01', 122, 78],
              ['2026-05-02', 124, 80],
            ]),
          },
        ),
        'bp',
      ),
    ).toBeNull();
  });

  it('returns the outlier index when one exceeds 1 SD', () => {
    // The fixture has 145/92 on 2026-05-05 (index 4) — clear outlier
    // in a series centred around 122-125.
    expect(pickCitedDayIndex(makeTrends(), 'bp')).toBe(4);
  });

  it('returns null when the data is too uniform', () => {
    const uniform = makeTrends(
      {},
      {
        bp: makeBPSeries([
          ['2026-05-01', 122, 78],
          ['2026-05-02', 122, 78],
          ['2026-05-03', 122, 78],
          ['2026-05-04', 122, 78],
          ['2026-05-05', 122, 78],
          ['2026-05-06', 122, 78],
        ]),
      },
    );
    // Perfectly flat series → SD 0 and max deviation 0, so maxDev > SD
    // is false and the engine returns null rather than pin a near-mean
    // day. (A near-flat 121–123 series is NOT "too uniform": its 1–2
    // mmHg outlier exceeds the ~0.76 SD and is correctly surfaced.)
    expect(pickCitedDayIndex(uniform, 'bp')).toBeNull();
  });
});

describe('buildTrendsLetter', () => {
  it('returns null when no vital has ≥ 3 entries', () => {
    expect(
      buildTrendsLetter({
        data: makeTrends({
          bp: { count: 2, avgSys: 120, avgDia: 75, pctInRange: 1 },
        }),
        correlations: [],
        range: '7d',
        accountType: 'self_buyer',
      }),
    ).toBeNull();
  });

  it('produces a multi-sentence body with BP comparison and emphasis', () => {
    const letter = buildTrendsLetter({
      data: makeTrends(),
      correlations: [],
      range: '30d',
      accountType: 'self_buyer',
    });
    expect(letter).not.toBeNull();
    expect(letter!.body).toContain('usual range');
    // BP avg (126/81) clause should appear.
    expect(letter!.body).toMatch(/126\/81/);
    // Emphasis markers should be present.
    expect(letter!.body).toMatch(/_[^_]+_/);
  });

  it('uses parentLabel + caregiver pronouns in caregiver mode', () => {
    const letter = buildTrendsLetter({
      data: makeTrends(),
      correlations: [],
      range: '30d',
      accountType: 'caregiver',
      parentLabel: 'Patricia',
    });
    expect(letter!.body).toContain('Patricia');
    expect(letter!.body).toContain('is');
  });

  it('cites the strongest correlation when one exists', () => {
    const letter = buildTrendsLetter({
      data: makeTrends(),
      correlations: [makeCorrelation('sleep_x_morning_bp')],
      range: '30d',
      accountType: 'self_buyer',
    });
    expect(letter!.body.toLowerCase()).toMatch(/shorter nights/);
    expect(letter!.focalVital).toBe('bp');
  });

  it('produces a sign-off', () => {
    const letter = buildTrendsLetter({
      data: makeTrends(),
      correlations: [],
      range: '30d',
      accountType: 'self_buyer',
    });
    expect(letter!.signOff).toContain('Leiko');
  });

  it('annotates a cited day when the focal vital has an outlier', () => {
    const letter = buildTrendsLetter({
      data: makeTrends(),
      correlations: [],
      range: '30d',
      accountType: 'self_buyer',
    });
    expect(letter!.citedDayIdx).toBe(4);
  });
});

describe('buildWeeklySummary', () => {
  it('returns null when no week of data', () => {
    expect(
      buildWeeklySummary({
        data: makeTrends({
          bp: { count: 1, avgSys: 120, avgDia: 75, pctInRange: 1 },
        }),
        correlations: [],
        accountType: 'self_buyer',
      }),
    ).toBeNull();
  });

  it('produces a calm recap with eyebrow + body', () => {
    const ws = buildWeeklySummary({
      data: makeTrends(),
      correlations: [],
      accountType: 'self_buyer',
    });
    expect(ws).not.toBeNull();
    expect(ws!.eyebrow).toContain('week');
    expect(ws!.body).toMatch(/126\/81/);
    // Voice-clean: no forbidden words.
    expect(ws!.body).not.toMatch(/diagnose|patient|dangerous|critical/i);
  });

  it('handles activity-only data (no BP)', () => {
    const ws = buildWeeklySummary({
      data: makeTrends({
        bp: { count: 0, avgSys: null, avgDia: null, pctInRange: null },
        activity: { count: 6, avgSteps: 7400 },
      }),
      correlations: [],
      accountType: 'self_buyer',
    });
    expect(ws).not.toBeNull();
    expect(ws!.body).toMatch(/7,400/);
  });
});
