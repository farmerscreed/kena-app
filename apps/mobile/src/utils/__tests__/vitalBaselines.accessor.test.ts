// Truth-layer accessor — D13 PR-1.
//
// The FIXTURE_* arrays are duplicated verbatim from the server suite
// (supabase/functions/_shared/baselines.test.ts) so the client's
// provisional fallback and the server row maths are pinned against the
// same numbers. Change one, change both.

const mockEq = jest.fn();
const mockFrom = jest.fn(() => ({ select: jest.fn(() => ({ eq: mockEq })) }));
jest.mock('../../services/supabase', () => ({
  supabase: { from: mockFrom },
}));

import { mmkv, STORAGE_KEYS } from '../../services/storage';
import {
  __resetVitalBaselinesForTests,
  getServerBaseline,
  provisionalBpBaselines,
  refreshVitalBaselines,
  resolveBpBaselines,
  seedVitalBaselines,
  type VitalBaselineServerRow,
} from '../vitalBaselines';

const FIXTURE_SYS = [118, 120, 122, 124, 125, 126, 126, 127, 128, 130, 132, 134];

const NOW_SEC = 1_700_000_000;
const DAY = 24 * 3600;

/** One reading per day, days 2–13 back — 12 distinct UTC days. */
function fixtureSamples() {
  return FIXTURE_SYS.map((systolic, i) => ({
    systolic,
    diastolic: 80,
    measuredAtSec: NOW_SEC - (2 + i) * DAY,
  }));
}

function serverRow(partial: Partial<VitalBaselineServerRow>): VitalBaselineServerRow {
  return {
    vital: 'bp_systolic',
    window_days: 28,
    sample_count: 12,
    mean_value: 126,
    sd_value: 5,
    p10_value: 118,
    p90_value: 134,
    context_tag: null,
    is_sufficient: true,
    computed_at: '2026-08-18T03:00:00Z',
    ...partial,
  };
}

beforeEach(() => {
  mmkv.remove(STORAGE_KEYS.vitalBaselinesByFamily);
  __resetVitalBaselinesForTests();
  jest.clearAllMocks();
});

describe('provisionalBpBaselines — parity with the server maths', () => {
  it('reproduces the server suite numbers on the shared fixture', () => {
    const { systolic } = provisionalBpBaselines(fixtureSamples(), NOW_SEC);
    expect(systolic).not.toBeNull();
    expect(systolic!.sampleCount).toBe(12);
    expect(systolic!.mean).toBe(126);
    expect(systolic!.sd).toBeCloseTo(4.490731195, 6);
    expect(systolic!.p10).toBe(120);
    expect(systolic!.p90).toBe(132);
    expect(systolic!.isSufficient).toBe(true);
    expect(systolic!.provisional).toBe(true);
    expect(systolic!.computedAt).toBeNull();
  });

  it('is insufficient below 10 readings', () => {
    const { systolic } = provisionalBpBaselines(fixtureSamples().slice(0, 9), NOW_SEC);
    expect(systolic!.sampleCount).toBe(9);
    expect(systolic!.isSufficient).toBe(false);
  });

  it('is insufficient below 7 distinct days even with 10+ readings', () => {
    const twoDays = FIXTURE_SYS.map((systolic, i) => ({
      systolic,
      diastolic: 80,
      measuredAtSec: NOW_SEC - (i % 2 === 0 ? 2 : 3) * DAY,
    }));
    const { systolic } = provisionalBpBaselines(twoDays, NOW_SEC);
    expect(systolic!.isSufficient).toBe(false);
  });

  it('ignores samples outside the 28-day window', () => {
    const stale = fixtureSamples().map((s) => ({
      ...s,
      measuredAtSec: s.measuredAtSec - 40 * DAY,
    }));
    const { systolic, diastolic } = provisionalBpBaselines(stale, NOW_SEC);
    expect(systolic).toBeNull();
    expect(diastolic).toBeNull();
  });
});

describe('seed / get / resolve', () => {
  it('round-trips a server row through the cache', () => {
    seedVitalBaselines('fam-1', [serverRow({})]);
    const row = getServerBaseline('fam-1', 'bp_systolic');
    expect(row).not.toBeNull();
    expect(row!.mean).toBe(126);
    expect(row!.provisional).toBe(false);
  });

  it('survives a module reset via MMKV (cold-start read)', () => {
    seedVitalBaselines('fam-1', [serverRow({})]);
    __resetVitalBaselinesForTests();
    const row = getServerBaseline('fam-1', 'bp_systolic');
    expect(row).not.toBeNull();
    expect(row!.p90).toBe(134);
  });

  it('keys context-conditioned rows separately', () => {
    seedVitalBaselines('fam-1', [
      serverRow({}),
      serverRow({ context_tag: 'morning', mean_value: 122 }),
    ]);
    expect(getServerBaseline('fam-1', 'bp_systolic')!.mean).toBe(126);
    expect(getServerBaseline('fam-1', 'bp_systolic', 'morning')!.mean).toBe(122);
  });

  it('resolveBpBaselines prefers server rows over the provisional recompute', () => {
    seedVitalBaselines('fam-1', [serverRow({})]);
    const pair = resolveBpBaselines('fam-1', fixtureSamples(), NOW_SEC);
    expect(pair.systolic!.provisional).toBe(false);
    expect(pair.systolic!.p10).toBe(118); // server row, not the local 120
  });

  it('falls back to provisional when the cache is empty', () => {
    const pair = resolveBpBaselines('fam-none', fixtureSamples(), NOW_SEC);
    expect(pair.systolic!.provisional).toBe(true);
  });

  it('returns nulls with no rows and no samples — never a fabricated band', () => {
    const pair = resolveBpBaselines('fam-none', [], NOW_SEC);
    expect(pair.systolic).toBeNull();
    expect(pair.diastolic).toBeNull();
  });
});

describe('refreshVitalBaselines', () => {
  it('caches fetched rows', async () => {
    mockEq.mockResolvedValueOnce({ data: [serverRow({})], error: null });
    await refreshVitalBaselines('fam-1');
    expect(mockFrom).toHaveBeenCalledWith('vital_baselines');
    expect(getServerBaseline('fam-1', 'bp_systolic')).not.toBeNull();
  });

  it('a failed fetch keeps the previously cached rows', async () => {
    seedVitalBaselines('fam-1', [serverRow({})]);
    mockEq.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await refreshVitalBaselines('fam-1');
    expect(getServerBaseline('fam-1', 'bp_systolic')).not.toBeNull();
  });

  it('a thrown fetch is swallowed (offline-first)', async () => {
    mockEq.mockRejectedValueOnce(new Error('network'));
    await expect(refreshVitalBaselines('fam-1')).resolves.toBeUndefined();
  });
});
