import {
  buildTierATrendsNarrative,
  generateTrendsNarrative,
  parseNarrativeSpans,
} from '../trendsNarration';
import { lintVoiceText } from '../../voice/voiceLint';
import { DETERMINISTIC_COPY } from '../fallThrough';
import type { TrendsData } from '../../../utils/trends-aggregate';
import type { CorrelationRow } from '../../../types/database';

function makeTrends(): TrendsData {
  return {
    series: { bp: [], hr: [], spo2: [], sleep: [], activity: [] },
    summary: {
      bp: { count: 6, avgSys: 123, avgDia: 81, pctInRange: 0.8 },
      hr: { count: 5, avgResting: 60 },
      spo2: { count: 5, avgMinPercent: 94 },
      sleep: { count: 5, avgTotalMinutes: 420 },
      activity: { count: 5, avgSteps: 6000 },
    },
  };
}

function makeCorrelation(
  type: CorrelationRow['correlation_type'],
  r: number,
): CorrelationRow {
  return {
    id: 'c-' + type,
    family_id: 'f',
    user_id: 'u',
    correlation_type: type,
    window_days: 30,
    computed_at: '2025-04-11T03:00:00Z',
    pearson_r: r,
    effect_size: 0,
    effect_unit: 'x',
    significance: 0.001,
    sample_n: 24,
    is_meaningful: true,
    narrative_short: '',
    narrative_long: '',
    created_at: '2025-04-11T03:00:00Z',
  };
}

describe('buildTierATrendsNarrative', () => {
  it('returns null when no data is supplied', () => {
    expect(
      buildTierATrendsNarrative({
        data: undefined,
        correlations: [],
        range: '30d',
        accountType: 'self_buyer',
      }),
    ).toBeNull();
  });

  it('returns null when BP count is below the 3-reading threshold', () => {
    const data = makeTrends();
    data.summary.bp.count = 2;
    expect(
      buildTierATrendsNarrative({
        data,
        correlations: [],
        range: '30d',
        accountType: 'self_buyer',
      }),
    ).toBeNull();
  });

  it('composes a voice-clean paragraph for self-buyer mode with BP data', () => {
    const out = buildTierATrendsNarrative({
      data: makeTrends(),
      correlations: [],
      range: '30d',
      accountType: 'self_buyer',
    });
    expect(out).not.toBeNull();
    expect(out).toContain('You are _in your usual range_ this month');
    expect(out).toContain('123/81');
    expect(lintVoiceText(out!).passes).toBe(true);
  });

  it('appends a correlation clause when one is present', () => {
    const out = buildTierATrendsNarrative({
      data: makeTrends(),
      correlations: [makeCorrelation('sleep_x_morning_bp', -0.8)],
      range: '30d',
      accountType: 'self_buyer',
    });
    expect(out).toContain('after the shorter nights');
    expect(lintVoiceText(out!).passes).toBe(true);
  });

  it('uses the caregiver pronoun + parent label when caregiver mode', () => {
    const out = buildTierATrendsNarrative({
      data: makeTrends(),
      correlations: [makeCorrelation('sleep_x_morning_bp', -0.8)],
      range: '30d',
      accountType: 'caregiver',
      parentLabel: 'Mum',
    });
    expect(out).toContain('Mum is _in ');
    expect(out).toContain("Mum's mornings averaged");
    expect(out).toContain("after Mum's shorter nights");
    expect(lintVoiceText(out!).passes).toBe(true);
  });

  it('uses the right window word per range', () => {
    const dataset = makeTrends();
    const ranges: Array<[Parameters<typeof buildTierATrendsNarrative>[0]['range'], string]> = [
      ['7d', 'this week'],
      ['30d', 'this month'],
      ['90d', 'this quarter'],
      ['1y', 'this year'],
    ];
    for (const [range, expected] of ranges) {
      const out = buildTierATrendsNarrative({
        data: dataset,
        correlations: [],
        range,
        accountType: 'self_buyer',
      });
      expect(out).toContain(expected);
    }
  });
});

describe('parseNarrativeSpans', () => {
  it('returns a single plain span for un-marked text', () => {
    expect(parseNarrativeSpans('hello world')).toEqual([
      { text: 'hello world' },
    ]);
  });

  it('splits `_text_` markers into italic spans', () => {
    expect(parseNarrativeSpans('You are _in your usual range_ today.')).toEqual([
      { text: 'You are ' },
      { text: 'in your usual range', em: true },
      { text: ' today.' },
    ]);
  });

  it('handles multiple italic spans in one paragraph', () => {
    expect(
      parseNarrativeSpans('_calm_ before _clever_, always.'),
    ).toEqual([
      { text: 'calm', em: true },
      { text: ' before ' },
      { text: 'clever', em: true },
      { text: ', always.' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseNarrativeSpans('')).toEqual([]);
  });
});

describe('generateTrendsNarrative', () => {
  it('returns the Tier-A body when data is present', async () => {
    const result = await generateTrendsNarrative({
      data: makeTrends(),
      correlations: [],
      range: '30d',
      accountType: 'self_buyer',
    });
    // Sprint 16.5g — Tier-C is the new lead engine; Tier-A reads as
    // a backup. The body still contains the usual-range emphasis
    // span either way.
    expect(['C', 'A']).toContain(result.tier);
    expect(result.body).toContain('usual range');
  });

  it('falls through to deterministic when no data', async () => {
    const result = await generateTrendsNarrative({
      data: undefined,
      correlations: [],
      range: '7d',
      accountType: 'self_buyer',
    });
    expect(result.tier).toBe('deterministic');
    expect(result.body).toBe(DETERMINISTIC_COPY.trends_narrative);
  });

  it('deterministic copy passes voice-lint', () => {
    expect(lintVoiceText(DETERMINISTIC_COPY.trends_narrative).passes).toBe(true);
  });
});
