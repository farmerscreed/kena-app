// useFamilyRemovalBanner tests — Sprint 17b.
//
// Pure-helper coverage. The hook's React-side effect is exercised
// via the public exports `buildCurrentMap` + `diffDisappeared`.

import {
  buildCurrentMap,
  diffDisappeared,
} from '../useFamilyRemovalBanner';
import type { ParentSummary } from '../../services/families/fetchParentSummaries';

function parent(
  familyId: string,
  parentDisplayName: string,
): ParentSummary {
  return {
    familyId,
    parentDisplayName,
    parentRelationship: 'mother',
    parentYearOfBirth: 1955,
    viewerRole: 'caregiver',
    caregiverRelationshipLabel: null,
    latestReading: null,
    recentReadings: [],
    latestHr: null,
    latestSpo2: null,
    latestSleep: null,
  };
}

describe('buildCurrentMap', () => {
  it('returns an empty map when parents is empty', () => {
    expect(buildCurrentMap([])).toEqual({});
  });

  it('uses parentDisplayName as the label', () => {
    const map = buildCurrentMap([parent('fam-1', 'Mum')]);
    expect(map).toEqual({ 'fam-1': 'Mum' });
  });

  // Sprint 19 (audit D12 P0-8) — the fallback WAS "your loved one",
  // which is a HARD FAIL in docs/05-voice-and-claims.md §87. This test
  // asserted the violation, so it was pinning the bug in place.
  it('falls back to a voice-clean generic when display name is empty', () => {
    const map = buildCurrentMap([parent('fam-1', '')]);
    expect(map).toEqual({ 'fam-1': 'your family member' });
  });

  it('never emits a forbidden generic in the fallback', () => {
    const map = buildCurrentMap([parent('fam-1', '')]);
    expect(map['fam-1']).not.toMatch(/loved one|patient/i);
  });

  it('handles multiple parents', () => {
    const map = buildCurrentMap([
      parent('fam-1', 'Mum'),
      parent('fam-2', 'Dad'),
    ]);
    expect(map).toEqual({ 'fam-1': 'Mum', 'fam-2': 'Dad' });
  });
});

describe('diffDisappeared', () => {
  it('returns empty when persisted is empty', () => {
    expect(diffDisappeared({}, { 'fam-1': 'Mum' })).toEqual([]);
  });

  it('returns empty when persisted == current', () => {
    expect(
      diffDisappeared(
        { 'fam-1': 'Mum' },
        { 'fam-1': 'Mum' },
      ),
    ).toEqual([]);
  });

  it('returns the disappeared family with its persisted label', () => {
    const out = diffDisappeared(
      { 'fam-1': 'Mum', 'fam-2': 'Dad' },
      { 'fam-1': 'Mum' },
    );
    expect(out).toEqual([{ familyId: 'fam-2', label: 'Dad' }]);
  });

  it('returns multiple entries when multiple disappeared', () => {
    const out = diffDisappeared(
      { 'fam-1': 'Mum', 'fam-2': 'Dad', 'fam-3': 'Aunt' },
      {},
    );
    expect(out.length).toBe(3);
    expect(out.map((e) => e.familyId).sort()).toEqual([
      'fam-1',
      'fam-2',
      'fam-3',
    ]);
  });

  it('does not report new families as disappeared', () => {
    // Newly joined `fam-2` is in current but not persisted — should
    // be a NO-OP for the diff.
    expect(
      diffDisappeared(
        { 'fam-1': 'Mum' },
        { 'fam-1': 'Mum', 'fam-2': 'Dad' },
      ),
    ).toEqual([]);
  });
});
