// CaregiverHome — Sprint 7.7a integration tests for the bird's-eye view.
//
// Acceptance criteria covered:
//   - Empty state ("Your family circle is quiet for now")
//   - Loading state (skeleton renders)
//   - Three-person populated state (orbs + legend present)
//   - Drill-in: tap a person → navigation.navigate('ReadingDetail', ...)
//   - AnomalyBanner: confirmed-urgent fires; calm-concerned fires; clear-only suppresses
//   - CaregiverActionBar visible with count when populated
//   - Voice gate passes on every authored screen-level string
//
// Mocks the data hooks at the boundary so these stay screen tests,
// not data tests. The pure helper (utils/caregiverPerson.ts) has its
// own unit tests; this file just exercises the wiring.

import { type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme';
import { CaregiverHome } from '../Home/CaregiverHome';
import type { ParentSummary } from '../../services/families/fetchParentSummaries';
import type { CaregiverPerson } from '../../utils/caregiverPerson';
import { timeOfDayGreeting } from '../../utils/greeting';

const mockNavigate = jest.fn();
const mockRefresh = jest.fn(async () => undefined);

const mockHookResult = {
  parents: [] as ParentSummary[],
  people: [] as CaregiverPerson[],
  isLoading: false,
  isRefreshing: false,
  error: null as Error | null,
  refresh: mockRefresh,
};


jest.mock('../../hooks/useCaregiverFamily', () => ({
  useCaregiverFamily: () => mockHookResult,
}));

// Test-controlled viewMode — defaults to 'birds'; individual tests
// flip it via `setMockViewMode('cards')` before render.
let mockViewMode: 'birds' | 'cards' = 'birds';
const setMockViewMode = (m: 'birds' | 'cards') => {
  mockViewMode = m;
};
// hasExplicitPreference defaults to true so tests that set mockViewMode
// get exactly that mode (the count-based default only applies when the
// user hasn't toggled). The default-by-count behaviour is covered by its
// own describe block below, which flips this to false.
let mockHasExplicitPreference = true;
const setMockHasExplicitPreference = (v: boolean) => {
  mockHasExplicitPreference = v;
};
jest.mock('../../hooks/useCaregiverViewMode', () => ({
  useCaregiverViewMode: () => ({
    viewMode: mockViewMode,
    setViewMode: jest.fn(),
    hasExplicitPreference: mockHasExplicitPreference,
  }),
}));

jest.mock('../../state/pairing', () => ({
  usePairing: (selector?: (s: unknown) => unknown) => {
    const state = { pairedDevice: null };
    return selector ? selector(state) : state;
  },
}));

// Sprint 14.5 task 3 — Caregiver Home renders the home-seeded
// Learn card via this hook. Default the mock to "no card available"
// so the existing 20+ tests don't depend on Learn-corpus state;
// the dedicated test below flips it to assert the slot renders.
jest.mock('../../hooks/useSeededLearnCard', () => ({
  useSeededLearnCard: jest.fn(() => ({
    article: null,
    onArticleOpen: jest.fn(),
    onDismiss: jest.fn(),
  })),
}));

jest.mock('../../state/readings', () => {
  // Sprint 16.6 — `byLocalId` was added to useReadings in the cross-phone
  // tap-routing fix (commit 221f19c) so CaregiverHome can distinguish a
  // local reading (route to ReadingDetail) from a server-only one
  // (sprint 17a routes those to ParentDashboard). The test's existing
  // assertion expects ReadingDetail navigation, so the mock returns a
  // stub for any id.
  const state = {
    latest: () => null,
    pending: [],
    recent: [],
    byLocalId: (id: string) => ({ localId: id } as unknown),
  };
  const useReadings = (selector?: (s: unknown) => unknown) =>
    selector ? selector(state) : state;
  // Sprint 14.5 task 3 — useSeededLearnCard reads useReadings.getState()
  // for the priority-cascade decision. Mirror the zustand surface.
  useReadings.getState = () => state;
  return { useReadings };
});

// Sprint 10a — the SixthReadingPaywallHost mounted on CaregiverHome
// pulls usePlusEntitlement (TanStack Query against families). These
// tests don't need a live entitlement; stub to a Plus user so the
// auto-paywall short-circuits and the component never opens.
jest.mock('../../hooks/usePlusEntitlement', () => ({
  usePlusEntitlement: () => ({
    tier: 'plus',
    isPlus: true,
    isLoading: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  }),
  isPlusTier: (t: string) => ['plus', 'plus_trial', 'plus_grace'].includes(t),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: {} }),
}));

function withProviders(ui: ReactNode) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 720 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider mode="caregiver" colorMode="dark">
        {ui}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function reading(overrides: Partial<{ id: string; measuredAt: string; systolic: number; diastolic: number }> = {}) {
  return {
    id: overrides.id ?? 'r1',
    measuredAt:
      overrides.measuredAt ?? new Date(Date.now() - 60_000).toISOString(),
    systolic: overrides.systolic ?? 122,
    diastolic: overrides.diastolic ?? 78,
    pulse: 64,
    qualityScore: 'good' as const,
  };
}

function parent(overrides: Partial<ParentSummary> & { familyId: string; parentDisplayName: string }): ParentSummary {
  return {
    familyId: overrides.familyId,
    parentDisplayName: overrides.parentDisplayName,
    parentRelationship: overrides.parentRelationship ?? 'Mom',
    parentYearOfBirth: overrides.parentYearOfBirth ?? 1955,
    viewerRole: overrides.viewerRole ?? 'family_owner',
    caregiverRelationshipLabel: overrides.caregiverRelationshipLabel ?? null,
    latestReading: overrides.latestReading ?? null,
    recentReadings: overrides.recentReadings ?? [],
    latestHr: overrides.latestHr ?? null,
    latestSpo2: overrides.latestSpo2 ?? null,
    latestSleep: overrides.latestSleep ?? null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHookResult.parents = [];
  mockHookResult.people = [];
  mockHookResult.isLoading = false;
  mockHookResult.isRefreshing = false;
  mockHookResult.error = null;
  setMockViewMode('birds');
  setMockHasExplicitPreference(true);
});

describe('<CaregiverHome /> — empty state', () => {
  // Sprint 16.6 Issue #1 — empty state inverted to lead with the
  // invite-code path (the more common journey for non-technical
  // caregivers being invited by an existing user) and a secondary
  // link drops to Settings → Family for outgoing invites.
  it('renders the empty-state heading + body + both CTAs', () => {
    render(withProviders(<CaregiverHome />));
    expect(screen.getByText('Your family circle is quiet for now')).toBeTruthy();
    expect(
      screen.getByText(/Has someone shared a Leiko code with you/),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Enter a code' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Or share your own code' }),
    ).toBeTruthy();
  });

  it('does not render the constellation or action bar when empty', () => {
    render(withProviders(<CaregiverHome />));
    expect(screen.queryByTestId('caregiver-home-constellation')).toBeNull();
    expect(screen.queryByTestId('caregiver-home-action-bar')).toBeNull();
  });
});

describe('<CaregiverHome /> — loading state', () => {
  it('renders the skeleton (no orbs yet)', () => {
    mockHookResult.isLoading = true;
    render(withProviders(<CaregiverHome />));
    expect(screen.queryByTestId('caregiver-home-constellation')).toBeNull();
    expect(screen.queryByText('Your family circle is quiet for now')).toBeNull();
  });
});

describe('<CaregiverHome /> — populated state', () => {
  function setupThreePeople() {
    // PR-4 — the tapped row carries a sufficient band so the populated
    // state exercises the in-range path, not learning.
    const bandSys = [118, 120, 122, 124, 125, 126, 126, 127, 128, 130, 132, 134];
    const bandDia = [74, 76, 77, 78, 79, 80, 80, 81, 82, 83, 85, 86];
    const banded = bandSys.map((sys, i) =>
      reading({
        id: `band-${i}`,
        measuredAt: new Date(Date.now() - (2 + i) * 24 * 3600_000).toISOString(),
        systolic: sys,
        diastolic: bandDia[i],
      }),
    );
    mockHookResult.parents = [
      parent({
        familyId: 'fam-1',
        parentDisplayName: 'Marian Okeke',
        parentRelationship: 'Mom',
        latestReading: reading({ id: 'r-mom', systolic: 122, diastolic: 78 }),
        recentReadings: banded,
      }),
      parent({
        familyId: 'fam-2',
        parentDisplayName: 'Emeka Okeke',
        parentRelationship: 'Dad',
        latestReading: reading({ id: 'r-dad', systolic: 134, diastolic: 86 }),
      }),
      parent({
        familyId: 'fam-3',
        parentDisplayName: 'Joy Adeyemi',
        parentRelationship: 'Aunt',
        latestReading: reading({ id: 'r-aunt', systolic: 118, diastolic: 74 }),
      }),
    ];
    mockHookResult.people = [
      {
        id: 'fam-1',
        fullName: 'Marian Okeke',
        initial: 'M',
        accentIndex: 1,
        status: 'clear',
        lastReadingAgeMs: 60_000,
      bpLabel: '122/78',
        headline: 'Read 1 min ago — in the usual range.',
        sentence: 'BP 122/78 a moment ago. Inside the usual band.',
        relation: 'Mom',
        vitalStrip: { bp: '122/78', hr: '64', spo2: '98%', sleep: '7:42' },
      },
      {
        id: 'fam-2',
        fullName: 'Emeka Okeke',
        initial: 'E',
        accentIndex: 2,
        status: 'clear',
        lastReadingAgeMs: 60_000,
      bpLabel: '134/86',
        headline: 'Read 1 min ago — in the usual range.',
        sentence: 'BP 134/86 a moment ago. Inside the usual band.',
        relation: 'Dad',
        vitalStrip: { bp: '134/86', hr: '72', spo2: '96%', sleep: '6:18' },
      },
      {
        id: 'fam-3',
        fullName: 'Joy Adeyemi',
        initial: 'J',
        accentIndex: 3,
        status: 'clear',
        lastReadingAgeMs: 60_000,
      bpLabel: '118/74',
        headline: 'Read 1 min ago — in the usual range.',
        sentence: 'BP 118/74 a moment ago. Inside the usual band.',
        relation: 'Aunt',
        vitalStrip: { bp: '118/74', hr: '58', spo2: '97%', sleep: '8:00' },
      },
    ];
  }

  it('renders three orbs (constellation) + legend + action bar', () => {
    setupThreePeople();
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-constellation')).toBeTruthy();
    expect(screen.getByTestId('caregiver-home-legend')).toBeTruthy();
    expect(screen.getByTestId('caregiver-home-action-bar')).toBeTruthy();
  });

  it('renders the count in the action bar', () => {
    setupThreePeople();
    render(withProviders(<CaregiverHome />));
    expect(screen.getByText('3 · all in your circle')).toBeTruthy();
  });

  it('navigates to PersonOverview on a legend row tap (D13 §7.1)', () => {
    setupThreePeople();
    render(withProviders(<CaregiverHome />));
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Marian, Mom, In their usual range, Read 1 min ago — in the usual range.',
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('PersonOverview', {
      familyId: 'fam-1',
      personName: 'Marian Okeke',
      isSelf: false,
    });
  });
});

describe('<CaregiverHome /> — anomaly banner', () => {
  function setupOnePerson(status: 'clear' | 'attention' | 'urgent') {
    // ADR-0006 Phase 2 — status is DERIVED from the reading by
    // buildConstellationNodes now (not injected via `people`). Since
    // D13 PR-1 the tier comes from the person's OWN band, so the
    // fixture carries a sufficient recent-readings history (12 readings
    // over 12 days, sys mean 126 / ±2σ ≈ 117–135): 168/104 is outside
    // the band (attention); ≥180/120 is the absolute floor (urgent);
    // 122/78 is inside (clear).
    const bp =
      status === 'urgent'
        ? { systolic: 188, diastolic: 122 }
        : status === 'attention'
          ? { systolic: 168, diastolic: 104 }
          : { systolic: 122, diastolic: 78 };
    const bandSys = [118, 120, 122, 124, 125, 126, 126, 127, 128, 130, 132, 134];
    const bandDia = [74, 76, 77, 78, 79, 80, 80, 81, 82, 83, 85, 86];
    const recent = bandSys.map((sys, i) =>
      reading({
        id: `band-${i}`,
        measuredAt: new Date(Date.now() - (2 + i) * 24 * 3600_000).toISOString(),
        systolic: sys,
        diastolic: bandDia[i],
      }),
    );
    mockHookResult.parents = [
      parent({
        familyId: 'fam-1',
        parentDisplayName: 'Marian Okeke',
        parentRelationship: 'Mom',
        latestReading: reading({ id: 'r1', ...bp }),
        recentReadings: recent,
      }),
    ];
  }

  it('shows confirmed-urgent banner when any person is urgent', () => {
    setupOnePerson('urgent');
    render(withProviders(<CaregiverHome />));
    expect(screen.getByText('Please check on Marian')).toBeTruthy();
  });

  it('shows calm-concerned banner when only attention status is present', () => {
    setupOnePerson('attention');
    render(withProviders(<CaregiverHome />));
    expect(screen.getByText('Worth a look')).toBeTruthy();
  });

  it('does NOT render an AnomalyBanner when everyone is clear', () => {
    setupOnePerson('clear');
    render(withProviders(<CaregiverHome />));
    expect(screen.queryByText(/Talk to/)).toBeNull();
    expect(screen.queryByText(/Worth a chat/)).toBeNull();
  });

  it('confirmed-urgent wins over calm-concerned (most-severe-wins)', () => {
    // Status derived from readings: Marian attention (168/104), Emeka
    // urgent (188/122). Most-severe-wins → Emeka's banner.
    mockHookResult.parents = [
      parent({
        familyId: 'fam-1',
        parentDisplayName: 'Marian Okeke',
        parentRelationship: 'Mom',
        latestReading: reading({ id: 'r1', systolic: 168, diastolic: 104 }),
      }),
      parent({
        familyId: 'fam-2',
        parentDisplayName: 'Emeka Okeke',
        parentRelationship: 'Dad',
        latestReading: reading({ id: 'r2', systolic: 188, diastolic: 122 }),
      }),
    ];
    render(withProviders(<CaregiverHome />));
    // Confirmed-urgent (Dad) wins; calm-concerned (Marian) is suppressed
    // in the BANNER. (Marian's attention headline "Worth a chat …" still
    // renders in her legend row — that's per-person copy, not the banner,
    // so we assert on the banner's specific title, not a loose substring.)
    expect(screen.getByText('Please check on Emeka')).toBeTruthy();
    expect(screen.queryByText('Worth a look')).toBeNull();
  });
});

describe('<CaregiverHome /> — view toggle (Sprint 7.7b)', () => {
  function setupThree() {
    // ADR-0006 Phase 2 — the vital strip is now DERIVED from the parent's
    // latestHr/latestSpo2/latestSleep (not injected via `people`). Populate
    // them so the derived strip renders 64 / 98% / 7:42 (462 min).
    mockHookResult.parents = [
      parent({
        familyId: 'fam-1',
        parentDisplayName: 'Marian Okeke',
        parentRelationship: 'Mom',
        latestReading: reading({ id: 'r-mom', systolic: 122, diastolic: 78 }),
        latestHr: { measuredAt: new Date().toISOString(), bpm: 64 },
        latestSpo2: { measuredAt: new Date().toISOString(), percent: 98 },
        latestSleep: {
          measuredAt: new Date().toISOString(),
          totalMinutes: 462,
          deepMinutes: null,
          lightMinutes: null,
        },
      }),
    ];
  }

  it('renders the segmented toggle when populated', () => {
    setupThree();
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-view-toggle')).toBeTruthy();
    expect(screen.getByRole('button', { name: "Bird's-eye view" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Detailed view' })).toBeTruthy();
  });

  it('does NOT render the toggle in empty state', () => {
    render(withProviders(<CaregiverHome />));
    expect(screen.queryByTestId('caregiver-home-view-toggle')).toBeNull();
  });

  it('renders only the birds layer at rest (cards layer unmounted)', () => {
    setupThree();
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-birds-layer')).toBeTruthy();
    // Cards layer is unmounted at rest to prevent bleed-through and
    // touch interception. It mounts during the transition window.
    expect(screen.queryByTestId('caregiver-home-cards-layer')).toBeNull();
  });

  it('renders the editorial DetailedView when viewMode is cards', () => {
    setupThree();
    setMockViewMode('cards');
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-detailed')).toBeTruthy();
    expect(screen.queryByTestId('caregiver-home-birds-layer')).toBeNull();
    // 1 person → "One you love, checked in."
    expect(screen.getByText(/One/)).toBeTruthy();
  });

  it('renders a PersonCard per person with its vital strip in cards mode', () => {
    setupThree();
    setMockViewMode('cards');
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-card-fam-1')).toBeTruthy();
    expect(screen.getAllByText('122/78').length).toBeGreaterThan(0);
    expect(screen.getByText('64')).toBeTruthy();
    expect(screen.getByText('98%')).toBeTruthy();
    expect(screen.getByText('7:42')).toBeTruthy();
  });
});

describe('<CaregiverHome /> — Ask Leiko', () => {
  it('renders the Ask Leiko affordance in the header (moved off the bottom FAB)', () => {
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-ask-leiko')).toBeTruthy();
  });
});

describe('<CaregiverHome /> — seeded Learn card (Sprint 14.5 task 3)', () => {
  // The card sits inside the bird's-eye view, which only renders
  // when merged.length > 0 (i.e. the caregiver has at least one
  // person on the constellation). Set up minimal populated state
  // here so the bird's-eye block — and thus the Learn slot — paints.
  beforeEach(() => {
    mockHookResult.parents = [
      parent({
        familyId: 'fam-1',
        parentDisplayName: 'Marian Okeke',
        parentRelationship: 'Mom',
        latestReading: reading({ id: 'r-mom', systolic: 122, diastolic: 78 }),
      }),
    ];
    mockHookResult.people = [
      {
        id: 'fam-1',
        fullName: 'Marian Okeke',
        accentIndex: 1,
        initial: 'M',
        relation: 'Mom',
        status: 'clear',
        lastReadingAgeMs: 60_000,
      bpLabel: '122/78',
        headline: 'In pattern',
        sentence: 'morning numbers steady',
        vitalStrip: { bp: '122/78', hr: '64', spo2: '97', sleep: '7.5h' },
      },
    ];
    const useSeededLearnCard = jest.requireMock('../../hooks/useSeededLearnCard')
      .useSeededLearnCard as jest.Mock;
    useSeededLearnCard.mockReturnValue({
      article: {
        id: 'numbers-001',
        frontmatter: {
          id: 'numbers-001',
          title: 'What is blood pressure?',
          summary: 'A short answer.',
          audience: ['caregiver'],
          category: 'bp',
          read_time_min: 1,
        },
        // HomeLearnCard's extractExcerpt iterates blocks; provide a
        // minimal AST so the iterator doesn't throw.
        blocks: [
          { kind: 'paragraph', children: [{ kind: 'text', value: 'A short answer.' }] },
        ],
      },
      onArticleOpen: jest.fn(),
      onDismiss: jest.fn(),
    });
  });
  afterEach(() => {
    const useSeededLearnCard = jest.requireMock('../../hooks/useSeededLearnCard')
      .useSeededLearnCard as jest.Mock;
    useSeededLearnCard.mockReturnValue({ article: null, onArticleOpen: jest.fn(), onDismiss: jest.fn() });
  });

  it('renders the home-seeded Learn card when the hook returns one', () => {
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-learn-card')).toBeTruthy();
  });
});

describe('<CaregiverHome /> — voice rules', () => {
  it.each([
    'Your family circle is quiet for now',
    // Sprint 16.6 Issue #1 — empty-state copy refreshed for the
    // invite-code-first CTA. Body explains the incoming-caregiver
    // path; primary CTA opens the AcceptInviteSheet; secondary text
    // link drops to Settings → Family for outgoing invites.
    /Has someone shared a Leiko code with you/,
    'Enter a code',
    /Or share your own code/,
    'Leiko · Family',
  ])('voice-rule clean string present: %s', (text) => {
    render(withProviders(<CaregiverHome />));
    expect(screen.getByText(text)).toBeTruthy();
  });

  // The greeting used to be the hard-coded literal 'Good morning', so it
  // greeted the afternoon as morning. It now follows the clock, which
  // means the assertion has to be time-independent: whatever hour the
  // suite runs at, the rendered greeting must be one of the four vetted
  // strings. timeOfDayGreeting's boundaries are pinned in its own unit
  // test (src/utils/__tests__/greeting.test.ts).
  it('renders a vetted time-of-day greeting', () => {
    render(withProviders(<CaregiverHome />));
    expect(screen.getByText(timeOfDayGreeting())).toBeTruthy();
  });
});

describe('<CaregiverHome /> — Take a reading (wearer-only, ADR-0006 Phase 3)', () => {
  it('shows the bottom tab bar (with Take a reading) when the viewer is a wearer', () => {
    mockHookResult.parents = [
      parent({
        familyId: 'me',
        parentDisplayName: 'Lawrence',
        parentRelationship: 'self',
        latestReading: reading({ id: 'r-self', systolic: 118, diastolic: 78 }),
      }),
    ];
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-tab-bar')).toBeTruthy();
    // The centre "+" Take-a-reading lives inside the tab bar.
    expect(
      screen.getByTestId('caregiver-home-tab-bar-tab-take_reading'),
    ).toBeTruthy();
  });

  it('hides the tab bar for a pure caregiver (no self-circle)', () => {
    mockHookResult.parents = [
      parent({
        familyId: 'mum',
        parentDisplayName: 'Marian',
        parentRelationship: 'Mom',
        latestReading: reading({ id: 'r-mum', systolic: 122, diastolic: 78 }),
      }),
    ];
    render(withProviders(<CaregiverHome />));
    expect(screen.queryByTestId('caregiver-home-tab-bar')).toBeNull();
  });
});

describe('<CaregiverHome /> — default view by count (ADR-0006 Phase 3)', () => {
  // When the user has NOT explicitly toggled, the default view depends on
  // how many nodes are in the circle: cards for <=2, birds-eye for 3+.
  beforeEach(() => {
    setMockHasExplicitPreference(false);
  });

  function people(n: number) {
    return Array.from({ length: n }, (_, i) =>
      parent({
        familyId: `fam-${i}`,
        parentDisplayName: `Person ${i}`,
        parentRelationship: i === 0 ? 'self' : 'Mom',
        latestReading: reading({ id: `r-${i}`, systolic: 120, diastolic: 78 }),
      }),
    );
  }

  it('defaults to cards (detailed) for a solo wearer (1 node)', () => {
    mockHookResult.parents = people(1);
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-detailed')).toBeTruthy();
    expect(screen.queryByTestId('caregiver-home-birds-layer')).toBeNull();
  });

  it('defaults to cards for 2 nodes (you + 1 person)', () => {
    mockHookResult.parents = people(2);
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-detailed')).toBeTruthy();
  });

  it('defaults to birds-eye for 3+ nodes', () => {
    mockHookResult.parents = people(3);
    render(withProviders(<CaregiverHome />));
    expect(screen.getByTestId('caregiver-home-birds-layer')).toBeTruthy();
    expect(screen.queryByTestId('caregiver-home-detailed')).toBeNull();
  });
});
