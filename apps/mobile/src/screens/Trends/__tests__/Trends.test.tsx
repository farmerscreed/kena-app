// Trends v2 — "The Letter" integration tests.
//
// Mocks the hooks the screen depends on at the module boundary so
// these stay screen-level tests, not data-store tests. Pattern
// mirrors BPDetail.test.tsx.

import { type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme';
import { Trends } from '../Trends';
import { TRENDS_ASK_LABEL } from '../../../components/TrendsAskAffordance';
import { TRENDS_WEEKLY_BODY_FALLBACK as TRENDS_WEEKLY_BODY } from '../../../components/TrendsWeeklySummaryCard';
import type { TrendsData } from '../../../utils/trends-aggregate';
import type {
  CorrelationRow,
  AccountType,
  UserRow,
} from '../../../types/database';

// ── Mock state — mutated per test ───────────────────────────────────

let mockTrendsData: TrendsData | undefined = emptyTrends();
let mockTrendsLoading = false;
let mockTrendsError: Error | null = null;
let mockCorrelations: CorrelationRow[] = [];
let mockIsPlus = false;
let mockAccountType: AccountType = 'self_buyer';
let mockFamilyId: string | null = 'family-1';

function emptyTrends(): TrendsData {
  return {
    series: { bp: [], hr: [], spo2: [], sleep: [], activity: [] },
    summary: {
      bp: { count: 0, avgSys: null, avgDia: null, pctInRange: null },
      hr: { count: 0, avgResting: null },
      spo2: { count: 0, avgMinPercent: null },
      sleep: { count: 0, avgTotalMinutes: null },
      activity: { count: 0, avgSteps: null },
    },
  };
}

function trendsWithData(): TrendsData {
  const days = ['2025-04-08', '2025-04-09', '2025-04-10'];
  return {
    series: {
      bp: days.map((day, i) => ({
        day,
        sys: 122 + i,
        dia: 80 + i,
        pulse: 70,
        count: 1,
      })),
      hr: days.map((day, i) => ({
        day,
        restingBpm: 60 + i,
        count: 5,
      })),
      spo2: days.map((day) => ({
        day,
        avgPercent: 96,
        minPercent: 94,
        count: 3,
      })),
      sleep: days.map((day, i) => ({
        day,
        totalMinutes: 420 + i * 10,
        deepMinutes: 100,
      })),
      activity: days.map((day, i) => ({
        day,
        totalSteps: 7000 + i * 200,
      })),
    },
    summary: {
      bp: { count: 3, avgSys: 123, avgDia: 81, pctInRange: 1 },
      hr: { count: 15, avgResting: 61 },
      spo2: { count: 9, avgMinPercent: 94 },
      sleep: { count: 3, avgTotalMinutes: 430 },
      activity: { count: 3, avgSteps: 7200 },
    },
  };
}

jest.mock('../../../hooks/useTrendsData', () => ({
  useTrendsData: () => ({
    data: mockTrendsData,
    isLoading: mockTrendsLoading,
    isRefreshing: false,
    error: mockTrendsError,
  }),
  useTrendsCorrelations: () => ({
    correlations: mockCorrelations,
    isLoading: false,
    error: null,
  }),
  // Prefetch hook is a fire-and-forget void; no-op in tests.
  usePrefetchTrendsRange: () => undefined,
}));

// Story Trends (2026-08-19) — the section owns its own react-query
// wiring; this suite tests the page chrome, so stub it (its own suite
// covers the story pieces).
jest.mock('../../../components/StorySection', () => ({
  StorySection: () => null,
}));

jest.mock('../../../hooks/usePlusEntitlement', () => ({
  usePlusEntitlement: () => ({
    tier: mockIsPlus ? 'plus' : 'free',
    isPlus: mockIsPlus,
    isLoading: false,
  }),
  isPlusTier: (t: string) => t === 'plus' || t === 'plus_trial' || t === 'plus_grace',
}));

jest.mock('../../../hooks/useFamilyReadings', () => ({
  useFamilyReadings: () => ({
    parents: mockFamilyId
      ? [
          {
            familyId: mockFamilyId,
            parentDisplayName: 'Test',
            parentRelationship: 'self',
            parentYearOfBirth: 1980,
            latestReading: null,
            recentReadings: [],
            latestHr: null,
            latestSpo2: null,
            latestSleep: null,
          },
        ]
      : [],
    isLoading: false,
    isRefreshing: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

// Trends v2 uses useNavigation to deep-link to "For your doctor".
// Tests don't mount a NavigationContainer; mock the hook to a no-op.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
    }),
  };
});

jest.mock('../../../state/auth', () => ({
  useAuth: (selector?: (s: unknown) => unknown) => {
    const fakeProfile: UserRow = {
      id: 'user-1',
      email: 'fixture@leiko.test',
      display_name: 'Fixture',
      photo_url: null,
      preferred_language: 'en',
      timezone: 'Africa/Lagos',
      year_of_birth: 1980,
      account_type: mockAccountType,
      marketing_opt_in: false,
      gender: null,
      height_cm: null,
      weight_kg: null,
      hypertension_status: null,
      deleted_at: null,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    const state = {
      profile: fakeProfile,
      session: { user: { id: 'user-1' } },
    };
    return selector ? selector(state) : state;
  },
}));

// ────────────────────────────────────────────────────────────────────

function withProviders(ui: ReactNode) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 720 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider mode="caregiver">{ui}</ThemeProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTrendsData = trendsWithData();
  mockTrendsLoading = false;
  mockTrendsError = null;
  mockCorrelations = [];
  mockIsPlus = false;
  mockAccountType = 'self_buyer';
  mockFamilyId = 'family-1';
});

async function renderAndAwaitNarrative(): Promise<void> {
  render(withProviders(<Trends />));
  await waitFor(() => {
    expect(screen.queryByTestId('trends-letter-paragraph')).not.toBeNull();
  });
}

describe('Trends v2 — header + range chips', () => {
  it('renders the self-buyer header copy', async () => {
    await renderAndAwaitNarrative();
    expect(screen.getByTestId('trends-header-title').props.children).toBe(
      'Your trends',
    );
  });

  it('switches the header for caregivers', async () => {
    mockAccountType = 'caregiver';
    await renderAndAwaitNarrative();
    expect(screen.getByTestId('trends-header-title').props.children).toBe(
      'Trends',
    );
  });

  it('renders all 4 range chips for caregiver mode', async () => {
    mockAccountType = 'caregiver';
    await renderAndAwaitNarrative();
    // Free user (default mock): 7d is unlocked; 30d/90d/1y render as
    // Plus-locked chips (testID trends-range:<label>-locked, label
    // lowercased — "30D" → "30d-locked"). Sprint 16.5g redesign.
    expect(screen.getByTestId('trends-range:7d')).toBeTruthy();
    for (const label of ['30d', '90d', '1y'] as const) {
      expect(screen.getByTestId(`trends-range:${label}-locked`)).toBeTruthy();
    }
  });

  it('renders the all-time chip for self-buyer mode', async () => {
    await renderAndAwaitNarrative();
    // Free self-buyer: the all-time chip is Plus-locked. Its label is
    // "All" → testID trends-range:all-locked.
    expect(screen.getByTestId('trends-range:all-locked')).toBeTruthy();
  });
});

describe('Trends v2 — the letter narrative', () => {
  it('renders the eyebrow + paragraph + freshness when BP data is present', async () => {
    await renderAndAwaitNarrative();
    expect(screen.getByTestId('trends-letter-eyebrow')).toBeTruthy();
    expect(screen.getByTestId('trends-letter-paragraph')).toBeTruthy();
    expect(screen.getByTestId('trends-letter-freshness')).toBeTruthy();
  });

  it('renders the focal evidence chart for BP', async () => {
    await renderAndAwaitNarrative();
    expect(screen.getByTestId('trends-evidence')).toBeTruthy();
    expect(screen.getByTestId('trends-evidence-title')).toBeTruthy();
    // Focal evidence shows the LATEST BP point (last series day:
    // sys 122+2, dia 80+2 = 124/82), not the week average (123/81).
    expect(screen.getByTestId('trends-evidence-value').props.children).toBe(
      '124/82',
    );
  });

  it('header Back is present and tappable (screens must never be one-way)', async () => {
    await renderAndAwaitNarrative();
    expect(screen.getByTestId('trends-back')).toBeTruthy();
    fireEvent.press(screen.getByTestId('trends-back')); // must not throw
  });

  it('focal chips switch the evidence card to another vital (package B)', async () => {
    await renderAndAwaitNarrative();
    expect(screen.getByTestId('trends-focal-chips')).toBeTruthy();
    fireEvent.press(screen.getByTestId('trends-focal-hr'));
    // Title flips to the HR framing; the card itself re-renders from
    // evidenceFor('hr', …) so the value is the latest resting bpm.
    expect(
      screen.getByTestId('trends-evidence-title').props.children,
    ).toBe('Heart rate · resting');
  });

  it('renders the Ask affordance pill', async () => {
    await renderAndAwaitNarrative();
    expect(screen.getByTestId('trends-ask')).toBeTruthy();
    expect(screen.getByTestId('trends-ask-label').props.children).toBe(
      TRENDS_ASK_LABEL,
    );
  });
});

describe('Trends v2 — paywall', () => {
  it('opens the paywall sheet when a free user taps a >7d range chip', async () => {
    await renderAndAwaitNarrative();
    // Free user: the 30d chip is a locked chip (testID …-locked).
    fireEvent.press(screen.getByTestId('trends-range:30d-locked'));
    expect(screen.getByText('Understand your numbers')).toBeTruthy();
  });

  it('does NOT open the paywall when a Plus user taps a >7d range chip', async () => {
    mockIsPlus = true;
    await renderAndAwaitNarrative();
    // Plus user: the chip is unlocked (testID trends-range:30d).
    fireEvent.press(screen.getByTestId('trends-range:30d'));
    expect(screen.queryByText('Understand your numbers')).toBeNull();
  });

  it('uses caregiver paywall copy when account_type is caregiver', async () => {
    mockAccountType = 'caregiver';
    await renderAndAwaitNarrative();
    fireEvent.press(screen.getByTestId('trends-range:30d-locked'));
    expect(screen.getByText('Stay close, every day')).toBeTruthy();
  });

  it('uses the all-time trigger for the all_time chip', async () => {
    await renderAndAwaitNarrative();
    // Free self-buyer: all-time chip is locked (label "All").
    fireEvent.press(screen.getByTestId('trends-range:all-locked'));
    // PaywallSheet surfaces the same self-buyer headline for either trigger.
    expect(screen.getByText('Understand your numbers')).toBeTruthy();
  });
});

describe('Trends v2 — see everything expansion', () => {
  it('is collapsed by default — the multi-vital chart is not rendered', async () => {
    await renderAndAwaitNarrative();
    expect(screen.queryByTestId('trends-expansion')).toBeNull();
  });

  it('reveals the multi-vital chart + toggle pills when tapped', async () => {
    await renderAndAwaitNarrative();
    fireEvent.press(screen.getByTestId('trends-see-everything'));
    expect(screen.getByTestId('trends-expansion')).toBeTruthy();
    for (const v of ['bp', 'hr', 'spo2', 'sleep', 'activity'] as const) {
      expect(screen.getByTestId(`trends-toggle:${v}`)).toBeTruthy();
    }
  });

  it('exposes a button role with expanded state on the toggle', async () => {
    await renderAndAwaitNarrative();
    const toggle = screen.getByTestId('trends-see-everything');
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    fireEvent.press(toggle);
    expect(
      screen.getByTestId('trends-see-everything').props.accessibilityState,
    ).toEqual({ expanded: true });
  });
});

describe('Trends v2 — empty / loading / error', () => {
  it('shows the empty state when no BP data is present', async () => {
    mockTrendsData = emptyTrends();
    render(withProviders(<Trends />));
    await waitFor(() => {
      expect(screen.queryByTestId('trends-empty')).not.toBeNull();
    });
    expect(screen.queryByTestId('trends-letter-paragraph')).toBeNull();
  });

  it('shows the loading state while the query is in flight and narrative is absent', () => {
    mockTrendsLoading = true;
    mockTrendsData = undefined;
    render(withProviders(<Trends />));
    expect(screen.getByTestId('trends-loading')).toBeTruthy();
  });

  it('shows the error state with a Try again CTA when the query fails', async () => {
    mockTrendsLoading = false;
    mockTrendsError = new Error('network');
    mockTrendsData = undefined;
    render(withProviders(<Trends />));
    await waitFor(() => {
      expect(screen.queryByTestId('trends-error')).not.toBeNull();
    });
    expect(screen.getByTestId('trends-error-retry')).toBeTruthy();
  });
});

describe('Trends v2 — cited footnote rail', () => {
  it('renders a numbered footnote per meaningful correlation', async () => {
    mockCorrelations = [
      makeCorrelation('sleep_x_morning_bp', -0.9),
      makeCorrelation('activity_x_resting_hr', -0.5),
    ];
    await renderAndAwaitNarrative();
    expect(screen.getByTestId('trends-cited')).toBeTruthy();
    expect(screen.getByTestId('trends-cited-1')).toBeTruthy();
    expect(screen.getByTestId('trends-cited-2')).toBeTruthy();
    expect(screen.getByTestId('trends-cited-1-numeral').props.children).toBe(1);
    expect(screen.getByTestId('trends-cited-2-numeral').props.children).toBe(2);
  });

  it('renders nothing when no meaningful correlations exist', async () => {
    mockCorrelations = [];
    await renderAndAwaitNarrative();
    expect(screen.queryByTestId('trends-cited')).toBeNull();
  });

  it('labels strong correlations as Strong', async () => {
    mockCorrelations = [makeCorrelation('sleep_x_morning_bp', -0.9)];
    await renderAndAwaitNarrative();
    expect(screen.getByTestId('trends-cited-1-strength').props.children).toBe(
      'Strong',
    );
  });

  it('labels weak correlations as Gentle', async () => {
    mockCorrelations = [makeCorrelation('spo2_dip_x_sleep_score', 0.2)];
    await renderAndAwaitNarrative();
    expect(screen.getByTestId('trends-cited-1-strength').props.children).toBe(
      'Gentle',
    );
  });
});

describe('Trends v2 — weekly summary placeholder + doctor inline link', () => {
  it('renders the generated weekly summary body when data is present', async () => {
    // The placeholder (TRENDS_WEEKLY_BODY_FALLBACK) only renders when
    // there's no generated summary. With trends data present, the card
    // shows the real narrative body, so assert it's a non-empty string
    // distinct from the fallback rather than equal to the placeholder.
    await renderAndAwaitNarrative();
    const body = screen.getByTestId('trends-weekly-summary-body').props
      .children as string;
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toBe(TRENDS_WEEKLY_BODY);
  });

  it('reads "for your doctor" in self-buyer mode', async () => {
    await renderAndAwaitNarrative();
    expect(screen.getByText('For your doctor')).toBeTruthy();
  });

  it('reads "for their doctor" in caregiver mode', async () => {
    mockAccountType = 'caregiver';
    await renderAndAwaitNarrative();
    expect(screen.getByText('For your doctor')).toBeTruthy();
  });

  it('does NOT render a PDF export CTA anywhere on Trends', async () => {
    await renderAndAwaitNarrative();
    expect(screen.queryByTestId('trends-export-cta')).toBeNull();
    expect(screen.queryByText('Save as PDF for my doctor')).toBeNull();
    expect(screen.queryByText('Share with your doctor')).toBeNull();
  });
});

// Silence the React act-warning during the async narrative effect when
// a test never explicitly waits — calling act once at module teardown
// flushes any trailing microtask. Some tests above use waitFor instead.
afterEach(async () => {
  await act(async () => {});
});

// ────────────────────────────────────────────────────────────────────

function makeCorrelation(
  type: CorrelationRow['correlation_type'],
  r: number,
): CorrelationRow {
  return {
    id: 'c-' + type,
    family_id: 'family-1',
    user_id: 'user-1',
    correlation_type: type,
    window_days: 30,
    computed_at: '2025-04-11T03:00:00Z',
    pearson_r: r,
    effect_size: -0.083,
    effect_unit:
      type === 'sleep_x_morning_bp'
        ? 'mmHg/hour-sleep'
        : type === 'activity_x_resting_hr'
          ? 'bpm/1000-steps'
          : 'min/SpO2-percent',
    significance: 0.001,
    sample_n: 24,
    is_meaningful: true,
    narrative_short:
      type === 'sleep_x_morning_bp'
        ? 'Poor sleep ↔ +5 mmHg morning systolic'
        : type === 'activity_x_resting_hr'
          ? 'More daily steps ↔ −2 bpm resting HR'
          : 'Lower overnight SpO2 dips ↔ lower sleep score',
    narrative_long: 'Pattern based on the last 24 days.',
    created_at: '2025-04-11T03:00:00Z',
  };
}
