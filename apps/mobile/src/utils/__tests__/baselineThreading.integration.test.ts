// D13 PR-1 done-when: "an integration test covers all four call sites."
//
// One seeded truth-layer band, one reading, four call sites — the
// readings store, the hydration mapper, the parent pulse fetcher and
// the caregiver status derivation — all producing the SAME tier. Plus
// the learning case (4 readings → learning everywhere), the absolute
// floor (185/125 regardless of band), and a static guard that no call
// site ever regresses to a literal null baseline.

import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../services/sync/postReading', () => ({
  postReading: jest.fn(() => Promise.resolve({ ok: false, retryable: true })),
}));
jest.mock('../../services/health-platform/syncBridge', () => ({
  forwardReadingToPlatform: jest.fn(),
}));
jest.mock('../../services/analytics/logger', () => ({
  logger: { track: jest.fn(), error: jest.fn(), breadcrumb: jest.fn() },
}));
jest.mock('../../services/supabase', () => {
  const eq = jest.fn(() => Promise.resolve({ data: [], error: null }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { supabase: { from } };
});

import { mmkv, STORAGE_KEYS } from '../../services/storage';
import { useReadings } from '../../state/readings';
import { mapServerRowToLocal } from '../../hooks/useHydrateReadingsFromServer';
import { fetchParentPulseData } from '../../services/families/fetchParentPulseData';
import { caregiverPersonFromParent } from '../caregiverPerson';
import type { ParentSummary, ReadingSummary } from '../../services/families/fetchParentSummaries';
import {
  __resetVitalBaselinesForTests,
  resolveBpBaselines,
  seedVitalBaselines,
  type VitalBaselineServerRow,
} from '../vitalBaselines';

const FAMILY = 'fam-int-1';
const NOW_MS = 1_700_000_000_000;
const NOW_SEC = NOW_MS / 1000;
const DAY_SEC = 24 * 3600;

// The canonical band: display 118–134, classification 116–136 (sys);
// display 74–86, classification 72–88 (dia).
const SERVER_ROWS: VitalBaselineServerRow[] = [
  {
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
  },
  {
    vital: 'bp_diastolic',
    window_days: 28,
    sample_count: 12,
    mean_value: 80,
    sd_value: 4,
    p10_value: 74,
    p90_value: 86,
    context_tag: null,
    is_sufficient: true,
    computed_at: '2026-08-18T03:00:00Z',
  },
];

const BAND_SYS = [118, 120, 122, 124, 125, 126, 126, 127, 128, 130, 132, 134];
const BAND_DIA = [74, 76, 77, 78, 79, 80, 80, 81, 82, 83, 85, 86];

function bandedSummaries(): ReadingSummary[] {
  return BAND_SYS.map((sys, i) => ({
    id: `band-${i}`,
    measuredAt: new Date(NOW_MS - (2 + i) * DAY_SEC * 1000).toISOString(),
    systolic: sys,
    diastolic: BAND_DIA[i],
    pulse: 64,
    qualityScore: 'good' as const,
  }));
}

function parentSummary(
  latest: { systolic: number; diastolic: number },
  recent: ReadingSummary[],
): ParentSummary {
  return {
    familyId: FAMILY,
    parentDisplayName: 'Marian Okeke',
    parentRelationship: 'Mom',
    parentYearOfBirth: 1955,
    viewerRole: 'caregiver',
    caregiverRelationshipLabel: null,
    latestReading: {
      id: 'r-latest',
      measuredAt: new Date(NOW_MS - 60_000).toISOString(),
      ...latest,
      pulse: 64,
      qualityScore: 'good',
    },
    recentReadings: recent,
    latestHr: null,
    latestSpo2: null,
    latestSleep: null,
  };
}

/** Minimal fake supabase client for fetchParentPulseData — same shape
 *  as its own unit-test fake: readings/vitals end on .limit(), the
 *  wearer-tz lookup on .maybeSingle(), vital_baselines awaits the
 *  chain itself (thenable). */
function fakePulseClient(readingRows: unknown[], baselineRows: unknown[]) {
  return {
    from: jest.fn((table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: jest.fn(() => chain),
        eq: jest.fn(() => chain),
        in: jest.fn(() => chain),
        is: jest.fn(() => chain),
        order: jest.fn(() => chain),
        maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
        limit: jest.fn(() =>
          Promise.resolve({ data: table === 'readings' ? readingRows : [], error: null }),
        ),
        then: jest.fn((resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ data: baselineRows, error: null }).then(resolve, reject),
        ),
      };
      return chain;
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function serverReadingRow(id: string, systolic: number, diastolic: number, atMs: number) {
  return {
    id,
    family_id: FAMILY,
    device_id: null,
    source: 'watch',
    measured_at: new Date(atMs).toISOString(),
    systolic,
    diastolic,
    pulse: 64,
    hidden: false,
  };
}

beforeEach(() => {
  mmkv.clearAll();
  __resetVitalBaselinesForTests();
  useReadings.setState({ pending: [], recent: [], syncing: false, syncError: null });
  mmkv.set(STORAGE_KEYS.currentFamilyId, FAMILY);
});

describe('one band, one reading, four call sites, one tier', () => {
  it('140/80 outside the band → calm_concerned everywhere', async () => {
    seedVitalBaselines(FAMILY, SERVER_ROWS);

    // 1. The readings store (live capture).
    const stored = useReadings.getState().addPendingReading({
      measuredAtSec: NOW_SEC - 60,
      systolic: 140,
      diastolic: 80,
      pulse: 64,
      source: 'watch',
      deviceBleId: null,
    });
    expect(stored.classification.tier).toBe('calm_concerned');
    expect(stored.classification.verdict?.tier).toBe('worth_a_look');

    // 2. The hydration mapper (server rows → local).
    const hydrated = mapServerRowToLocal(
      serverReadingRow('srv-1', 140, 80, NOW_MS - 60_000),
      resolveBpBaselines(FAMILY, [], NOW_SEC),
    );
    expect(hydrated.classification.tier).toBe('calm_concerned');

    // 3. The parent pulse fetcher (caregiver path, server-seeded).
    const pulse = await fetchParentPulseData(
      fakePulseClient([serverReadingRow('srv-2', 140, 80, NOW_MS - 60_000)], SERVER_ROWS),
      FAMILY,
      NOW_SEC,
    );
    expect(pulse.recent.readings[0].classification.tier).toBe('calm_concerned');

    // 4. The caregiver status derivation.
    const person = caregiverPersonFromParent(
      parentSummary({ systolic: 140, diastolic: 80 }, bandedSummaries()),
      0,
      NOW_MS,
    );
    expect(person.status).toBe('attention');
  });

  it('4 readings and no server row → learning everywhere', async () => {
    const four = BAND_SYS.slice(0, 4);
    const fourSummaries = bandedSummaries().slice(0, 4);

    const stored = useReadings.getState().addPendingReading({
      measuredAtSec: NOW_SEC - 60,
      systolic: 161,
      diastolic: 101,
      pulse: 64,
      source: 'watch',
      deviceBleId: null,
    });
    expect(stored.classification.tier).toBe('in_pattern');
    expect(stored.classification.verdict?.tier).toBe('learning');

    const hydrated = mapServerRowToLocal(
      serverReadingRow('srv-3', 161, 101, NOW_MS - 60_000),
      resolveBpBaselines(
        FAMILY,
        four.map((sys, i) => ({
          systolic: sys,
          diastolic: BAND_DIA[i],
          measuredAtSec: NOW_SEC - (2 + i) * DAY_SEC,
        })),
        NOW_SEC,
      ),
    );
    expect(hydrated.classification.tier).toBe('in_pattern');
    expect(hydrated.classification.verdict?.tier).toBe('learning');

    const pulse = await fetchParentPulseData(
      fakePulseClient(
        [
          serverReadingRow('srv-4', 161, 101, NOW_MS - 60_000),
          ...fourSummaries.map((r, i) =>
            serverReadingRow(`srv-b${i}`, r.systolic, r.diastolic, Date.parse(r.measuredAt)),
          ),
        ],
        [],
      ),
      FAMILY,
      NOW_SEC,
    );
    expect(pulse.recent.readings[0].classification.tier).toBe('in_pattern');
    expect(pulse.recent.readings[0].classification.verdict?.tier).toBe('learning');

    const person = caregiverPersonFromParent(
      parentSummary({ systolic: 161, diastolic: 101 }, fourSummaries),
      0,
      NOW_MS,
    );
    expect(person.status).toBe('clear');
  });

  it('185/125 → confirmed_urgent everywhere, band or no band', async () => {
    seedVitalBaselines(FAMILY, SERVER_ROWS);

    const stored = useReadings.getState().addPendingReading({
      measuredAtSec: NOW_SEC - 60,
      systolic: 185,
      diastolic: 125,
      pulse: 64,
      source: 'watch',
      deviceBleId: null,
    });
    expect(stored.classification.tier).toBe('confirmed_urgent');
    expect(stored.classification.reason).toBe('crisis_absolute');

    const hydrated = mapServerRowToLocal(
      serverReadingRow('srv-5', 185, 125, NOW_MS - 60_000),
      resolveBpBaselines(FAMILY, [], NOW_SEC),
    );
    expect(hydrated.classification.tier).toBe('confirmed_urgent');

    const pulse = await fetchParentPulseData(
      fakePulseClient([serverReadingRow('srv-6', 185, 125, NOW_MS - 60_000)], []),
      FAMILY,
      NOW_SEC,
    );
    expect(pulse.recent.readings[0].classification.tier).toBe('confirmed_urgent');

    const person = caregiverPersonFromParent(
      parentSummary({ systolic: 185, diastolic: 125 }, []),
      0,
      NOW_MS,
    );
    expect(person.status).toBe('urgent');
  });
});

describe('no call site passes a literal null baseline', () => {
  const CALL_SITES = [
    'src/hooks/useHydrateReadingsFromServer.ts',
    'src/services/families/fetchParentPulseData.ts',
    'src/state/readings.ts',
    'src/utils/caregiverPerson.ts',
  ];

  it.each(CALL_SITES)('%s resolves a real baseline', (rel) => {
    const source = readFileSync(join(__dirname, '../../..', rel), 'utf8');
    // The deliberate offline fallback lives inside resolveBpBaselines;
    // a call site handing the classifier a literal null is a regression.
    expect(source).not.toMatch(/classifyReading\(\s*\{[^}]*\},\s*null/s);
    expect(source).toMatch(/resolveBpBaselines\(/);
  });
});
