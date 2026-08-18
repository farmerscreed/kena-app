import {
  caregiverPersonFromParent,
  caregiverPeopleFromParents,
  formatRelation,
  resolveRelation,
} from '../caregiverPerson';
import type {
  ParentSummary,
  ReadingSummary,
} from '../../services/families/fetchParentSummaries';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function reading(
  partial: Partial<ReadingSummary> & { measuredAt: string },
): ReadingSummary {
  return {
    id: 'r1',
    measuredAt: partial.measuredAt,
    systolic: partial.systolic ?? 122,
    diastolic: partial.diastolic ?? 78,
    pulse: partial.pulse ?? 64,
    qualityScore: partial.qualityScore ?? 'good',
  };
}

function summary(partial: Partial<ParentSummary> = {}): ParentSummary {
  return {
    familyId: partial.familyId ?? 'fam-1',
    parentDisplayName: partial.parentDisplayName ?? 'Marian Okeke',
    parentRelationship: partial.parentRelationship ?? 'Mom',
    parentYearOfBirth: partial.parentYearOfBirth ?? 1955,
    viewerRole: partial.viewerRole ?? 'caregiver',
    caregiverRelationshipLabel: partial.caregiverRelationshipLabel ?? null,
    latestReading: partial.latestReading ?? null,
    recentReadings: partial.recentReadings ?? [],
    latestHr: partial.latestHr ?? null,
    latestSpo2: partial.latestSpo2 ?? null,
    latestSleep: partial.latestSleep ?? null,
  };
}

// D13 PR-1 — a sufficient personal band (12 readings across 8 distinct
// days, sys mean 126 / ±2σ ≈ 117–135, dia mean 80). Verdicts now come
// from the person's own baseline: a fixture that wants "attention" must
// carry enough history to have a band, not just a big number.
const BAND_SYS = [118, 120, 122, 124, 125, 126, 126, 127, 128, 130, 132, 134];
const BAND_DIA = [74, 76, 77, 78, 79, 80, 80, 81, 82, 83, 85, 86];

function bandedRecent(nowMs: number): ReadingSummary[] {
  // One reading per day, days 2–13 back: 12 distinct UTC days, all
  // inside the 28-day window, clearing the ≥7-distinct-days gate.
  return BAND_SYS.map((sys, i) =>
    reading({
      id: `band-${i}`,
      measuredAt: new Date(nowMs - (2 + i) * 24 * HOUR).toISOString(),
      systolic: sys,
      diastolic: BAND_DIA[i],
    }),
  );
}

describe('caregiverPersonFromParent — accent rotation', () => {
  it('rotates the slot index 0/1/2 → 1/2/3', () => {
    expect(caregiverPersonFromParent(summary(), 0, NOW).accentIndex).toBe(1);
    expect(caregiverPersonFromParent(summary(), 1, NOW).accentIndex).toBe(2);
    expect(caregiverPersonFromParent(summary(), 2, NOW).accentIndex).toBe(3);
  });

  it('wraps at index 3+ back to slot 1', () => {
    expect(caregiverPersonFromParent(summary(), 3, NOW).accentIndex).toBe(1);
    expect(caregiverPersonFromParent(summary(), 4, NOW).accentIndex).toBe(2);
    expect(caregiverPersonFromParent(summary(), 5, NOW).accentIndex).toBe(3);
    expect(caregiverPersonFromParent(summary(), 6, NOW).accentIndex).toBe(1);
  });
});

describe('caregiverPersonFromParent — initial', () => {
  it('takes the uppercased first letter of the trimmed name', () => {
    expect(
      caregiverPersonFromParent(summary({ parentDisplayName: 'marian Okeke' }), 0, NOW)
        .initial,
    ).toBe('M');
  });

  it('returns "·" for an empty name', () => {
    expect(
      caregiverPersonFromParent(summary({ parentDisplayName: '   ' }), 0, NOW).initial,
    ).toBe('·');
  });

  it('keeps the rest of the name unchanged in fullName', () => {
    expect(
      caregiverPersonFromParent(summary({ parentDisplayName: 'Marian Okeke' }), 0, NOW)
        .fullName,
    ).toBe('Marian Okeke');
  });

  it('falls back to "Family member" when name is empty', () => {
    expect(
      caregiverPersonFromParent(summary({ parentDisplayName: '' }), 0, NOW).fullName,
    ).toBe('Family member');
  });
});

describe('caregiverPersonFromParent — status mapping (D13 §6 + D10 anomaly)', () => {
  function withReading(p: Partial<ReadingSummary>): ParentSummary {
    return summary({ latestReading: reading({ measuredAt: '2023-11-14T20:53:00Z', ...p }) });
  }

  it('returns "clear" when classification is in_pattern and the reading is fresh', () => {
    // 2023-11-14T20:53:00Z is exactly NOW (1_700_000_000_000)
    const p = caregiverPersonFromParent(withReading({ systolic: 122, diastolic: 78 }), 0, NOW);
    expect(p.status).toBe('clear');
    expect(p.bpLabel).toBe('122/78');
  });

  it('returns "attention" when the reading sits outside the personal band', () => {
    // 165/100 against a 12-reading band (sys ±2σ ≈ 117–135) — outside
    // the band but below the 180/120 absolute floor. One outlier never
    // escalates past worth_a_look (D13 §4.4).
    const p = caregiverPersonFromParent(
      summary({
        latestReading: reading({
          measuredAt: '2023-11-14T20:53:00Z',
          systolic: 165,
          diastolic: 100,
        }),
        recentReadings: bandedRecent(NOW),
      }),
      0,
      NOW,
    );
    expect(p.status).toBe('attention');
    expect(p.headline).toContain("pattern");
  });

  it('returns "urgent" when classification is confirmed_urgent (≥180/120)', () => {
    const p = caregiverPersonFromParent(withReading({ systolic: 185, diastolic: 125 }), 0, NOW);
    expect(p.status).toBe('urgent');
    expect(p.headline).toContain('calm check-in');
  });

  it('returns "offline" when latest reading is older than 12h', () => {
    const measuredAtMs = NOW - 13 * HOUR;
    const p = caregiverPersonFromParent(
      summary({ latestReading: reading({ measuredAt: new Date(measuredAtMs).toISOString() }) }),
      0,
      NOW,
    );
    expect(p.status).toBe('offline');
    expect(p.headline).toContain('Last reading');
  });

  it('treats stale-but-classifiable as offline (staleness wins)', () => {
    const measuredAtMs = NOW - 13 * HOUR;
    const p = caregiverPersonFromParent(
      summary({
        latestReading: reading({
          measuredAt: new Date(measuredAtMs).toISOString(),
          systolic: 200,
          diastolic: 130,
        }),
      }),
      0,
      NOW,
    );
    expect(p.status).toBe('offline'); // not 'urgent'
  });

  it('returns "clear" / "—" / "No readings yet" when latestReading is null', () => {
    const p = caregiverPersonFromParent(summary({ latestReading: null }), 0, NOW);
    expect(p.status).toBe('clear');
    expect(p.bpLabel).toBe('—');
    expect(p.headline).toBe('No readings yet');
  });
});

describe('caregiverPersonFromParent — voice rules in headlines', () => {
  const FORBIDDEN = [
    /patient/i,
    /diagnose/i,
    /silent killer/i,
    /critical/i,
    /dangerous level/i,
    /medical advice/i,
  ];

  function checkVoice(headline: string): void {
    for (const pattern of FORBIDDEN) {
      expect(headline).not.toMatch(pattern);
    }
  }

  it('clear-state headline passes', () => {
    const p = caregiverPersonFromParent(
      summary({ latestReading: reading({ measuredAt: new Date(NOW - HOUR).toISOString() }) }),
      0,
      NOW,
    );
    checkVoice(p.headline);
  });

  it('attention-state headline passes', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestReading: reading({
          measuredAt: new Date(NOW - HOUR).toISOString(),
          systolic: 165,
          diastolic: 100,
        }),
      }),
      0,
      NOW,
    );
    checkVoice(p.headline);
  });

  it('urgent-state headline passes', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestReading: reading({
          measuredAt: new Date(NOW - HOUR).toISOString(),
          systolic: 185,
          diastolic: 125,
        }),
      }),
      0,
      NOW,
    );
    checkVoice(p.headline);
  });

  it('offline-state headline passes', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestReading: reading({
          measuredAt: new Date(NOW - 13 * HOUR).toISOString(),
        }),
      }),
      0,
      NOW,
    );
    checkVoice(p.headline);
  });

  it('no-data headline passes', () => {
    const p = caregiverPersonFromParent(summary({ latestReading: null }), 0, NOW);
    checkVoice(p.headline);
  });
});

describe('caregiverPersonFromParent — vitalStrip formatting (Sprint 7.7b)', () => {
  it('returns "—" for every vital when no data is available', () => {
    const p = caregiverPersonFromParent(summary({ latestReading: null }), 0, NOW);
    expect(p.vitalStrip).toEqual({ bp: '—', hr: '—', spo2: '—', sleep: '—' });
  });

  it('formats BP from latestReading', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestReading: reading({
          measuredAt: new Date(NOW - HOUR).toISOString(),
          systolic: 122,
          diastolic: 78,
        }),
      }),
      0,
      NOW,
    );
    expect(p.vitalStrip.bp).toBe('122/78');
  });

  it('formats HR bpm as a plain integer', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestHr: { measuredAt: new Date(NOW - HOUR).toISOString(), bpm: 64 },
      }),
      0,
      NOW,
    );
    expect(p.vitalStrip.hr).toBe('64');
  });

  it('formats SpO2 with a trailing %', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestSpo2: { measuredAt: new Date(NOW - HOUR).toISOString(), percent: 97 },
      }),
      0,
      NOW,
    );
    expect(p.vitalStrip.spo2).toBe('97%');
  });

  it('formats sleep duration as h:mm with zero-padded minutes', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestSleep: {
          measuredAt: new Date(NOW - HOUR).toISOString(),
          totalMinutes: 462, // 7h 42m
          deepMinutes: 100,
          lightMinutes: 240,
        },
      }),
      0,
      NOW,
    );
    expect(p.vitalStrip.sleep).toBe('7:42');
  });

  it('formats sleep with under-10 minutes correctly', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestSleep: {
          measuredAt: new Date(NOW - HOUR).toISOString(),
          totalMinutes: 365, // 6h 5m
          deepMinutes: null,
          lightMinutes: null,
        },
      }),
      0,
      NOW,
    );
    expect(p.vitalStrip.sleep).toBe('6:05');
  });

  it('mixes "—" placeholders with real data when only some vitals are present', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestReading: reading({ measuredAt: new Date(NOW - HOUR).toISOString() }),
        latestHr: { measuredAt: new Date(NOW - HOUR).toISOString(), bpm: 60 },
      }),
      0,
      NOW,
    );
    expect(p.vitalStrip).toEqual({
      bp: '122/78',
      hr: '60',
      spo2: '—',
      sleep: '—',
    });
  });
});

describe('caregiverPersonFromParent — sentence (placeholder editorial prose)', () => {
  const FORBIDDEN = [
    /patient/i,
    /diagnose/i,
    /silent killer/i,
    /critical/i,
    /dangerous level/i,
    /medical advice/i,
  ];
  function checkVoice(s: string) {
    for (const p of FORBIDDEN) expect(s).not.toMatch(p);
  }

  it('clear sentence is calm + factual', () => {
    const p = caregiverPersonFromParent(
      summary({ latestReading: reading({ measuredAt: new Date(NOW - HOUR).toISOString() }) }),
      0,
      NOW,
    );
    expect(p.sentence).toContain('122/78');
    expect(p.sentence).toContain('Inside the usual band');
    checkVoice(p.sentence);
  });

  it('attention sentence stays in voice', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestReading: reading({
          measuredAt: new Date(NOW - HOUR).toISOString(),
          systolic: 165,
          diastolic: 100,
        }),
        recentReadings: bandedRecent(NOW),
      }),
      0,
      NOW,
    );
    expect(p.sentence).toContain('a little above the usual band');
    checkVoice(p.sentence);
  });

  it('urgent sentence stays in voice (no fear language)', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestReading: reading({
          measuredAt: new Date(NOW - HOUR).toISOString(),
          systolic: 185,
          diastolic: 125,
        }),
      }),
      0,
      NOW,
    );
    expect(p.sentence).toContain('A calm check-in helps');
    checkVoice(p.sentence);
  });

  it('offline sentence is calm + factual', () => {
    const p = caregiverPersonFromParent(
      summary({
        latestReading: reading({ measuredAt: new Date(NOW - 13 * HOUR).toISOString() }),
      }),
      0,
      NOW,
    );
    expect(p.sentence).toContain('No reading in the last');
    checkVoice(p.sentence);
  });

  it('no-data sentence is calm + factual', () => {
    const p = caregiverPersonFromParent(summary({ latestReading: null }), 0, NOW);
    expect(p.sentence).toContain('watch will sync once it pairs');
    checkVoice(p.sentence);
  });
});

describe('caregiverPeopleFromParents — list mapping', () => {
  it('returns one CaregiverPerson per ParentSummary, in order', () => {
    const out = caregiverPeopleFromParents(
      [
        summary({ familyId: 'a', parentDisplayName: 'Anna' }),
        summary({ familyId: 'b', parentDisplayName: 'Bola' }),
        summary({ familyId: 'c', parentDisplayName: 'Chinwe' }),
      ],
      NOW,
    );
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(out.map((p) => p.initial)).toEqual(['A', 'B', 'C']);
    expect(out.map((p) => p.accentIndex)).toEqual([1, 2, 3]);
  });
});

describe('formatRelation — Sprint 19 SELF-label leakage fix', () => {
  it('returns "Wearer" when the family was created by a self-buyer', () => {
    expect(formatRelation('self')).toBe('Wearer');
    expect(formatRelation('SELF')).toBe('Wearer');
    expect(formatRelation(' Self ')).toBe('Wearer');
  });

  it('returns "Family" when the relationship is missing or empty', () => {
    expect(formatRelation(null)).toBe('Family');
    expect(formatRelation(undefined)).toBe('Family');
    expect(formatRelation('')).toBe('Family');
    expect(formatRelation('   ')).toBe('Family');
  });

  it('returns the original label for caregiver-set relationships', () => {
    expect(formatRelation('mother')).toBe('mother');
    expect(formatRelation('Mom')).toBe('Mom');
    expect(formatRelation('father')).toBe('father');
  });

  it('flows through caregiverPersonFromParent — self_buyer family renders Wearer, not Self', () => {
    const out = caregiverPersonFromParent(
      summary({ parentRelationship: 'self', parentDisplayName: 'TheOne' }),
      0,
      NOW,
    );
    expect(out.relation).toBe('Wearer');
  });

  it('flows through caregiverPersonFromParent — Mom relationship preserved', () => {
    const out = caregiverPersonFromParent(
      summary({ parentRelationship: 'Mom' }),
      0,
      NOW,
    );
    expect(out.relation).toBe('Mom');
  });
});

describe('resolveRelation — Sprint 19 Block 5 per-caregiver label preference', () => {
  it('prefers the per-caregiver label when present', () => {
    // Even though families says 'self', the caregiver's label wins.
    expect(resolveRelation('mother', 'self')).toBe('mother');
    expect(resolveRelation('Friend', 'self')).toBe('Friend');
  });

  it('unwraps the other:<label> encoding for the caregiver label', () => {
    expect(resolveRelation('other:Godfather', 'self')).toBe('Godfather');
    expect(resolveRelation('other:Best Friend', 'father')).toBe('Best Friend');
  });

  it('falls back to family default when label is empty', () => {
    expect(resolveRelation(null, 'mother')).toBe('mother');
    expect(resolveRelation(undefined, 'father')).toBe('father');
    expect(resolveRelation('', 'aunt')).toBe('aunt');
    expect(resolveRelation('   ', 'uncle')).toBe('uncle');
  });

  it('falls back to "Wearer" when family default is self and no label', () => {
    expect(resolveRelation(null, 'self')).toBe('Wearer');
    expect(resolveRelation('', 'self')).toBe('Wearer');
  });

  it('falls back to "Family" when both are missing', () => {
    expect(resolveRelation(null, null)).toBe('Family');
    expect(resolveRelation('', '')).toBe('Family');
  });

  it('unwraps other:<label> on the family default too', () => {
    expect(resolveRelation(null, 'other:Auntie')).toBe('Auntie');
  });

  it('renders bare "other" (no label) as Family', () => {
    expect(resolveRelation('other', null)).toBe('Family');
    expect(resolveRelation(null, 'other')).toBe('Family');
  });

  it('flows through caregiverPersonFromParent — label wins over self', () => {
    const out = caregiverPersonFromParent(
      summary({
        parentRelationship: 'self',
        parentDisplayName: 'TheOne',
        caregiverRelationshipLabel: 'mother',
      }),
      0,
      NOW,
    );
    expect(out.relation).toBe('mother');
  });

  it('flows through caregiverPersonFromParent — empty label falls back to family default', () => {
    const out = caregiverPersonFromParent(
      summary({
        parentRelationship: 'father',
        parentDisplayName: 'Papa',
        caregiverRelationshipLabel: null,
      }),
      0,
      NOW,
    );
    expect(out.relation).toBe('father');
  });
});
