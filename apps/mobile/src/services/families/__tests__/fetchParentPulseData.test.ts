// fetchParentPulseData tests — Sprint 17a.
//
// Validates the family-scoped read path composes the same
// `DailyPulseData` shape `useDailyPulseData()` returns. The supabase
// client is stubbed with a router that returns canned rows per
// (table, vital_type) tuple.

import { fetchParentPulseData } from '../fetchParentPulseData';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockChain = any;

/**
 * Build a fake supabase client whose `.from(table)` returns a chain
 * that ultimately resolves to the rows registered for the (table,
 * filterValue) tuple it sees on the second `.eq()` call.
 */
function makeFakeClient(rowsByKey: Record<string, unknown[]>) {
  return {
    from: jest.fn((table: string) => {
      // The fetcher hits `.eq('family_id', ...).eq('hidden', false |
      // 'vital_type', '<value>')`. We capture the second eq's value to
      // route.
      const calls: { secondEq?: unknown } = {};
      const chain: MockChain = {
        select: jest.fn(() => chain),
        eq: jest.fn((col: string, val: unknown) => {
          if (col === 'hidden' || col === 'vital_type') {
            calls.secondEq = val;
          }
          return chain;
        }),
        in: jest.fn(() => chain),
        is: jest.fn(() => chain),
        order: jest.fn(() => chain),
        // D13 PR-1 — the vital_baselines query awaits the chain itself
        // (.select().eq() with no terminal call), so the chain is
        // thenable. Other queries end on .limit()/.maybeSingle(), which
        // return real promises, so this never intercepts them.
        then: jest.fn(
          (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve({
              data: rowsByKey['vital_baselines'] ?? [],
              error: null,
            }).then(resolve, reject),
        ),
        // Wearer-tz lookup ends on .maybeSingle() against family_members.
        maybeSingle: jest.fn(() =>
          Promise.resolve({ data: rowsByKey['owner']?.[0] ?? null, error: null }),
        ),
        limit: jest.fn(() => {
          const key =
            table === 'readings'
              ? 'readings'
              : `vitals_other:${String(calls.secondEq)}`;
          return Promise.resolve({
            data: rowsByKey[key] ?? [],
            error: null,
          });
        }),
      };
      return chain;
    }),
  } as unknown as SupabaseClient<Database>;
}

const NOW_SEC = Math.floor(Date.parse('2026-05-19T12:00:00Z') / 1000);
const TEST_FAMILY_ID = 'fam-123';

describe('fetchParentPulseData', () => {
  it('returns empty slices when no data exists for the family', async () => {
    const client = makeFakeClient({});
    const result = await fetchParentPulseData(
      client,
      TEST_FAMILY_ID,
      NOW_SEC,
    );
    expect(result.pulse.bp.latest).toBeNull();
    expect(result.pulse.hr.restingToday).toBeNull();
    expect(result.pulse.spo2.latestPercent).toBeNull();
    expect(result.pulse.sleep.session).toBeNull();
    expect(result.pulse.activity.stepsToday).toBe(0);
    expect(result.recent.readings).toEqual([]);
    expect(result.recent.hr).toEqual([]);
    expect(result.recent.spo2).toEqual([]);
    expect(result.recent.sleep).toEqual([]);
    expect(result.recent.steps).toEqual([]);
    expect(result.recent.calories).toEqual([]);
    expect(result.wearerTimeZone).toBeNull();
  });

  it('surfaces the wearer (family owner) timezone for caregiver-tz rendering', async () => {
    const client = makeFakeClient({
      owner: [{ users: { timezone: 'Africa/Lagos' } }],
    });
    const result = await fetchParentPulseData(client, TEST_FAMILY_ID, NOW_SEC);
    expect(result.wearerTimeZone).toBe('Africa/Lagos');
  });

  it('maps a server BP row into the composed pulse + recent arrays', async () => {
    const measuredAt = '2026-05-19T08:30:00Z';
    const client = makeFakeClient({
      readings: [
        {
          id: 'r-1',
          family_id: TEST_FAMILY_ID,
          device_id: null,
          source: 'watch',
          measured_at: measuredAt,
          systolic: 124,
          diastolic: 78,
          pulse: 68,
          hidden: false,
        },
      ],
    });
    const result = await fetchParentPulseData(
      client,
      TEST_FAMILY_ID,
      NOW_SEC,
    );
    expect(result.pulse.bp.latest).toEqual({
      systolic: 124,
      diastolic: 78,
      pulse: 68,
    });
    expect(result.recent.readings).toHaveLength(1);
    expect(result.recent.readings[0].serverId).toBe('r-1');
    expect(result.recent.readings[0].measuredAtSec).toBe(
      Math.floor(Date.parse(measuredAt) / 1000),
    );
    // Classifier ran inline — the LocalReading carries a classification.
    expect(result.recent.readings[0].classification).toBeDefined();
  });

  it('maps a server steps_day row into today activity slice', async () => {
    const measuredAt = '2026-05-19T18:00:00Z';
    const client = makeFakeClient({
      'vitals_other:steps_day': [
        {
          id: 's-1',
          family_id: TEST_FAMILY_ID,
          device_id: null,
          vital_type: 'steps_day',
          measured_at: measuredAt,
          value_int: 7240,
          value_int_2: null,
          value_int_3: null,
          value_jsonb: {
            day_local: '2026-05-19',
            target_steps: 6000,
            last_sample_at: measuredAt,
            hourly: Array.from({ length: 24 }, () => 0),
          },
        },
      ],
    });
    const result = await fetchParentPulseData(
      client,
      TEST_FAMILY_ID,
      NOW_SEC,
    );
    expect(result.pulse.activity.stepsToday).toBe(7240);
    expect(result.pulse.activity.targetSteps).toBe(6000);
    expect(result.recent.steps).toHaveLength(1);
    expect(result.recent.steps[0].dayLocal).toBe('2026-05-19');
  });

  it('threads the family_id filter into every query', async () => {
    const client = makeFakeClient({});
    await fetchParentPulseData(client, TEST_FAMILY_ID, NOW_SEC);
    // 1 readings + 5 vitals_other + 1 family_members (wearer tz)
    // + 1 vital_baselines (D13 PR-1) = 8.
    expect((client.from as jest.Mock).mock.calls.length).toBe(8);
    expect((client.from as jest.Mock).mock.calls).toEqual([
      ['readings'],
      ['vitals_other'],
      ['vitals_other'],
      ['vitals_other'],
      ['vitals_other'],
      ['vitals_other'],
      ['family_members'],
      ['vital_baselines'],
    ]);
  });
});
