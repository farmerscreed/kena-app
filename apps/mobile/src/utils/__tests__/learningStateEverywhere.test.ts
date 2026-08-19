// D13 PR-4 done-when: "a two-reading account shows grey everywhere,
// no green check, and a partial ring." Driven through the real
// classification path (two readings → provisional insufficient →
// learning verdict) and asserted on every surface that renders a
// verdict: the reading card tier, the caregiver status derivation,
// and the ring calibration that Home + BPDetail consume.

jest.mock('../../services/sync/postReading', () => ({
  postReading: jest.fn(() => Promise.resolve({ ok: false, retryable: true })),
}));
jest.mock('../../services/health-platform/syncBridge', () => ({
  forwardReadingToPlatform: jest.fn(),
}));
jest.mock('../../services/analytics/logger', () => ({
  logger: { track: jest.fn(), error: jest.fn(), breadcrumb: jest.fn() },
}));
jest.mock('../../services/supabase', () => ({
  supabase: { from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ data: [], error: null })) })) })) },
}));

import { mmkv, STORAGE_KEYS } from '../../services/storage';
import { useReadings } from '../../state/readings';
import { canonicalTierFor } from '../classification';
import { caregiverPersonFromParent } from '../caregiverPerson';
import { bpRingCalibration } from '../calibration';
import { bpRingFill } from '../vitalThemes';
import { __resetVitalBaselinesForTests } from '../vitalBaselines';
import type { ParentSummary } from '../../services/families/fetchParentSummaries';

// Real now: the readings store's provisional window is measured from
// Date.now(), so fixture timestamps must live inside it.
const NOW_MS = Date.now();
const NOW_SEC = Math.floor(NOW_MS / 1000);

function twoReadingParent(): ParentSummary {
  const readings = [0, 1].map((i) => ({
    id: `r-${i}`,
    measuredAt: new Date(NOW_MS - (i + 1) * 3600_000).toISOString(),
    systolic: 128 + i,
    diastolic: 80,
    pulse: 64,
    qualityScore: 'good' as const,
  }));
  return {
    familyId: 'fam-learn',
    parentDisplayName: 'Marian Okeke',
    parentRelationship: 'Mom',
    parentYearOfBirth: 1955,
    viewerRole: 'caregiver',
    caregiverRelationshipLabel: null,
    latestReading: readings[0],
    recentReadings: readings,
    latestHr: null,
    latestSpo2: null,
    latestSleep: null,
  };
}

beforeEach(() => {
  mmkv.clearAll();
  __resetVitalBaselinesForTests();
  useReadings.setState({ pending: [], recent: [], syncing: false, syncError: null });
  mmkv.set(STORAGE_KEYS.currentFamilyId, 'fam-learn');
});

describe('a two-reading account', () => {
  it('classifies as learning — never a coloured verdict', () => {
    useReadings.getState().addPendingReading({
      measuredAtSec: NOW_SEC - 7200,
      systolic: 128,
      diastolic: 80,
      pulse: 64,
      source: 'watch',
      deviceBleId: null,
    });
    const second = useReadings.getState().addPendingReading({
      measuredAtSec: NOW_SEC - 3600,
      systolic: 129,
      diastolic: 80,
      pulse: 64,
      source: 'watch',
      deviceBleId: null,
    });
    // No green check: the canonical tier is learning, not in_range —
    // ReadingCard renders the grey Learning chip from exactly this.
    expect(canonicalTierFor(second.classification)).toBe('learning');
    expect(second.classification.verdict?.reason).toBe('insufficient_data');

    // Partial ring: 2 of 10 → 0.2 fill, learning colour.
    const cal = bpRingCalibration(second.classification);
    expect(cal.isLearning).toBe(true);
    expect(cal.fillFraction).toBeCloseTo(0.2);
    expect(bpRingFill(second.classification)).toBeCloseTo(0.2);
  });

  it('renders the caregiver derivation grey with honest copy', () => {
    const person = caregiverPersonFromParent(twoReadingParent(), 0, NOW_MS);
    expect(person.status).toBe('learning');
    expect(person.headline).toBe('Still learning');
    expect(person.sentence).toContain("Still learning what's usual for Marian Okeke");
    // Never a range claim below the gate.
    expect(person.sentence).not.toContain('usual band');
    expect(person.sentence).not.toContain('usual range.');
  });

  it('a 161/101 reading still shows no amber below the sufficiency gate', () => {
    const stored = useReadings.getState().addPendingReading({
      measuredAtSec: NOW_SEC - 60,
      systolic: 161,
      diastolic: 101,
      pulse: 64,
      source: 'watch',
      deviceBleId: null,
    });
    expect(canonicalTierFor(stored.classification)).toBe('learning');
  });

  it('the 180/120 floor still colours through the learning state', () => {
    const stored = useReadings.getState().addPendingReading({
      measuredAtSec: NOW_SEC - 60,
      systolic: 185,
      diastolic: 125,
      pulse: 64,
      source: 'watch',
      deviceBleId: null,
    });
    expect(canonicalTierFor(stored.classification)).toBe('talk_to_doctor');
  });
});
