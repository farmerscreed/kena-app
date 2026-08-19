// SelfBuyerHome — Sprint 8 integration tests.
//
// Mocks the data hooks at the boundary so this stays a screen test, not
// a data test. The pure helpers (utils/dayMoments.ts) are unit-tested
// separately. We verify:
//   - 4 D13 §7.2 central-value priority states render the right hero
//     value + label
//   - AnomalyBanner appears for calm_concerned and confirmed_urgent BP
//   - DaySpine renders moments derived from the same data
//   - FAB navigates to TakeReading
//   - Tile + DaySpine moment taps navigate to VitalDetail
//   - Visual tab bar renders with Home active

import { type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme';
import { SelfBuyerHome } from '../Home/SelfBuyerHome';
import {
  composeDailyPulseData,
  type DailyPulseSnapshot,
  type DailyPulseData,
} from '../../state/dailyPulse';
import type { LocalReading } from '../../state/readings';
import type { SleepSession } from '../../types/vitals';

// Tests use real-clock-relative timestamps so the screen's internal
// `pickCentralValue(data)` (which uses Date.now() unconditionally) always
// sees data as fresh. A fixed historical NOW_SEC would land in the future
// or past relative to the wall clock and break the freshness windows.
const NOW_SEC = () => Math.floor(Date.now() / 1000);

const mockNavigate = jest.fn();
const mockRefresh = jest.fn(async () => undefined);

let mockData: DailyPulseData = composeDailyPulseData(
  {
    bpLatest: null,
    hrRestingToday: null,
    hrRestingRecent: [],
    hrLatestSampleAt: null,
    spo2LatestPercent: null,
    spo2OvernightLowsRecent: [],
    spo2LatestSampleAt: null,
    sleepSession: null,
    activityToday: null,
  },
  NOW_SEC(),
);

const setMockData = (snapshot: DailyPulseSnapshot) => {
  mockData = composeDailyPulseData(snapshot, NOW_SEC());
};

jest.mock('../../state/dailyPulse', () => {
  const actual = jest.requireActual('../../state/dailyPulse');
  return {
    ...actual,
    useDailyPulseData: () => mockData,
  };
});

jest.mock('../../hooks/useFamilyReadings', () => ({
  useFamilyReadings: () => ({
    parents: [],
    isLoading: false,
    isRefreshing: false,
    error: null,
    refresh: mockRefresh,
  }),
}));

// Sprint 10a — the SixthReadingPaywallHost mounted on SelfBuyerHome
// pulls usePlusEntitlement (TanStack Query against families). Stub to
// a Plus user so the auto-paywall short-circuits and the test surface
// stays focused on the home screen content.
jest.mock('../../hooks/usePlusEntitlement', () => ({
  usePlusEntitlement: () => ({
    tier: 'plus',
    isPlus: true,
    isLoading: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  }),
  isPlusTier: (t: string) => ['plus', 'plus_trial', 'plus_grace'].includes(t),
}));

// Sprint 10a — readings store: SixthReadingPaywallHost reads pending
// + recent for its month-count check. Stub both to empty.
jest.mock('../../state/readings', () => ({
  useReadings: (selector?: (s: unknown) => unknown) => {
    const state = { pending: [], recent: [], latest: () => null };
    return selector ? selector(state) : state;
  },
}));

jest.mock('../../state/auth', () => ({
  useAuth: (selector?: (s: unknown) => unknown) => {
    const state = {
      profile: { display_name: 'Adaeze Okafor', account_type: 'self_buyer' },
    };
    return selector ? selector(state) : state;
  },
}));

jest.mock('../../state/hr', () => ({
  useHR: (selector?: (s: unknown) => unknown) => {
    const state = { recent: [], pending: [] };
    return selector ? selector(state) : state;
  },
}));
(jest.requireMock('../../state/hr') as { useHR: { getState: () => unknown } }).useHR.getState = () => ({
  recent: [],
  pending: [],
});

jest.mock('../../state/sleep', () => ({
  useSleep: (selector?: (s: unknown) => unknown) => {
    const state = { recent: [], pending: [] };
    return selector ? selector(state) : state;
  },
}));

// Sprint 18 bench bug — PairWatchPrompt reads usePairing to gate
// whether it renders. Stub a paired-device by default so the existing
// pre-Sprint-18 assertions (which assume the prompt is not present)
// stay green; tests that exercise the prompt path opt in via
// setPaired(false).
let mockPaired: { macSuffix: string } | null = { macSuffix: 'AB12' };
const setPaired = (p: { macSuffix: string } | null) => {
  mockPaired = p;
};
jest.mock('../../state/pairing', () => ({
  usePairing: (selector?: (s: unknown) => unknown) => {
    const state = { pairedDevice: mockPaired };
    return selector ? selector(state) : state;
  },
}));
(jest.requireMock('../../state/sleep') as { useSleep: { getState: () => unknown } }).useSleep.getState = () => ({
  recent: [],
  pending: [],
});

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

function makeBp(measuredAtSec: number, sys = 122, dia = 78, tier: 'in_pattern' | 'calm_concerned' | 'confirmed_urgent' = 'in_pattern'): LocalReading {
  return {
    localId: 'bp-1',
    serverId: null,
    measuredAtSec,
    systolic: sys,
    diastolic: dia,
    pulse: 64,
    source: 'watch',
    classification: { tier, reason: 'within_baseline' },
    deviceBleId: null,
    capturedAtMs: measuredAtSec * 1000,
  };
}

function makeSleep(endSec: number, totalMinutes = 7 * 60 + 24): SleepSession {
  const startSec = endSec - totalMinutes * 60;
  return {
    sessionStartSec: startSec,
    sessionEndSec: endSec,
    sessionStartLocal: new Date(startSec * 1000).toISOString(),
    sessionEndLocal: new Date(endSec * 1000).toISOString(),
    totalMinutes,
    deepMinutes: 90,
    remMinutes: 80,
    lightMinutes: totalMinutes - 90 - 80 - 4,
    awakeMinutes: 4,
    awakeCount: 1,
    transitions: [],
    sleepScore: 78,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default to paired-device for every existing assertion. The
  // pairing-prompt describe block below opts in to the unpaired path.
  setPaired({ macSuffix: 'AB12' });
});

describe('SelfBuyerHome — pairing prompt (Sprint 18 bench bug)', () => {
  it('renders nothing when a watch is already paired', () => {
    setPaired({ macSuffix: 'AB12' });
    render(withProviders(<SelfBuyerHome />));
    expect(screen.queryByTestId('self-buyer-home-pair-watch-prompt')).toBeNull();
  });

  it('renders the calm pair-watch prompt when no watch is paired', () => {
    setPaired(null);
    render(withProviders(<SelfBuyerHome />));
    expect(screen.getByTestId('self-buyer-home-pair-watch-prompt')).toBeTruthy();
    expect(screen.getByText('Pair your watch to start.')).toBeTruthy();
  });

  it('tapping the prompt routes to the Pairing screen', () => {
    setPaired(null);
    render(withProviders(<SelfBuyerHome />));
    fireEvent.press(screen.getByTestId('self-buyer-home-pair-watch-prompt'));
    expect(mockNavigate).toHaveBeenCalledWith('Pairing');
  });
});

describe('SelfBuyerHome — adaptive central value (D13 §7.2)', () => {
  it('priority 1: renders the BP central value when fresh', () => {
    setMockData({
      bpLatest: makeBp(NOW_SEC() - 60 * 60, 128, 82),
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SelfBuyerHome />));
    // "128/82" appears in the hero centre AND the BP vital tile — both
    // are correct. Confirming a fresh-BP eyebrow distinguishes this from
    // the no-data path.
    expect(screen.getAllByText('128/82').length).toBeGreaterThanOrEqual(1);
    // Constellation hero (2026-05-08 redesign): the central label inside
    // the BP ring is always "Blood pressure" when priority resolves to bp.
    expect(screen.getByText('Blood pressure')).toBeTruthy();
  });

  it('priority 2: HR fallback when BP is absent', () => {
    setMockData({
      bpLatest: null,
      hrRestingToday: 64,
      hrRestingRecent: [],
      hrLatestSampleAt: NOW_SEC() - 60 * 60,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SelfBuyerHome />));
    // The "64" appears in the hero centre AND in the HR vital tile —
    // checking the hero label tells us which path resolved.
    expect(screen.getAllByText('64').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('resting HR')).toBeTruthy();
  });

  it('priority 3: last night sleep when BP and HR are absent', () => {
    setMockData({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: makeSleep(NOW_SEC() - 4 * 3600, 7 * 60 + 24),
      activityToday: null,
    });
    render(withProviders(<SelfBuyerHome />));
    // "7h 24m" appears in the hero AND the sleep vital tile — both are valid.
    expect(screen.getAllByText('7h 24m').length).toBeGreaterThanOrEqual(1);
    // "last night" appears in the hero label AND as the sleep tile secondary.
    expect(screen.getAllByText('last night').length).toBeGreaterThanOrEqual(1);
  });

  it('priority 4: dash and a calm placeholder copy when nothing is recorded', () => {
    setMockData({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SelfBuyerHome />));
    // "—" appears in the hero centre AND every empty vital tile — that's
    // expected. The unique hero label proves the dash is the central value.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('no readings yet today')).toBeTruthy();
    // Empty DaySpine renders the calm empty-state line.
    expect(
      screen.getByText('Your day will fill in as readings come in.'),
    ).toBeTruthy();
  });
});

describe('SelfBuyerHome — anomaly banner', () => {
  it('renders the calm-concerned banner when BP classifies calm_concerned', () => {
    setMockData({
      bpLatest: makeBp(NOW_SEC() - 30 * 60, 142, 92, 'calm_concerned'),
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SelfBuyerHome />));
    expect(screen.getByTestId('self-buyer-home-anomaly-banner')).toBeTruthy();
    expect(screen.getByText('Worth a look')).toBeTruthy();
  });

  it('renders the confirmed-urgent banner when BP classifies confirmed_urgent', () => {
    setMockData({
      bpLatest: makeBp(NOW_SEC() - 30 * 60, 188, 122, 'confirmed_urgent'),
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SelfBuyerHome />));
    expect(screen.getByText('Please call your doctor')).toBeTruthy();
  });

  it('omits the banner when BP is in pattern', () => {
    setMockData({
      bpLatest: makeBp(NOW_SEC() - 30 * 60, 122, 78, 'in_pattern'),
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SelfBuyerHome />));
    expect(screen.queryByTestId('self-buyer-home-anomaly-banner')).toBeNull();
  });
});

describe('SelfBuyerHome — navigation wiring', () => {
  beforeEach(() => {
    setMockData({
      bpLatest: makeBp(NOW_SEC() - 60 * 60, 128, 82),
      hrRestingToday: 64,
      hrRestingRecent: [],
      hrLatestSampleAt: NOW_SEC() - 60 * 60,
      spo2LatestPercent: 97,
      spo2OvernightLowsRecent: [97, 96, 97],
      spo2LatestSampleAt: NOW_SEC() - 2 * 3600,
      sleepSession: makeSleep(NOW_SEC() - 4 * 3600, 7 * 60 + 24),
      activityToday: null,
    });
  });

  // Sprint 12 follow-up: the floating "+" → "Take a reading" FAB was
  // replaced with a floating "Ask Leiko" affordance. Take a reading
  // moved to the centre tab-bar slot. The old testID
  // 'self-buyer-home-fab' no longer exists.
  it('Take-a-reading centre tab → navigates to TakeReading', () => {
    render(withProviders(<SelfBuyerHome />));
    fireEvent.press(screen.getByTestId('self-buyer-home-tab-take_reading'));
    expect(mockNavigate).toHaveBeenCalledWith('TakeReading');
  });

  it('Ask Leiko FAB exists on the home screen', () => {
    render(withProviders(<SelfBuyerHome />));
    // Tapping opens the sheet; full open-sheet rendering is exercised
    // in the AskLeikoBody / AskLeikoScreen tests.
    expect(screen.getByTestId('self-buyer-home-ask-leiko-fab')).toBeTruthy();
  });

  it('vital tile tap → navigates to VitalDetail', () => {
    render(withProviders(<SelfBuyerHome />));
    fireEvent.press(screen.getByTestId('self-buyer-home-tile-hr'));
    expect(mockNavigate).toHaveBeenCalledWith('VitalDetail', { vital: 'hr' });
  });

  it('Settings tab → navigates to Settings', () => {
    render(withProviders(<SelfBuyerHome />));
    fireEvent.press(screen.getByTestId('self-buyer-home-tab-settings'));
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });

  it('Settings affordance tap → navigates to Settings', () => {
    // Sprint 17b redesign: the header's initial-bubble avatar became a
    // gear "settings" affordance; testID self-buyer-home-avatar →
    // self-buyer-home-settings.
    render(withProviders(<SelfBuyerHome />));
    fireEvent.press(screen.getByTestId('self-buyer-home-settings'));
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });
});

describe('SelfBuyerHome — visual tab bar (option c — visual only)', () => {
  it('renders all four tabs with Home selected', () => {
    setMockData({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SelfBuyerHome />));
    expect(screen.getByTestId('self-buyer-home-tab-home')).toBeTruthy();
    expect(screen.getByTestId('self-buyer-home-tab-trends')).toBeTruthy();
    // Sprint 12 follow-up — centre stage "+" Take a reading slot.
    expect(screen.getByTestId('self-buyer-home-tab-take_reading')).toBeTruthy();
    // Sprint 10c.2 polish — Family tab dropped in favour of Learn; family
    // management lives in Settings → Family for the rare hybrid-mode case.
    expect(screen.getByTestId('self-buyer-home-tab-learn')).toBeTruthy();
    expect(screen.getByTestId('self-buyer-home-tab-settings')).toBeTruthy();
  });
});
