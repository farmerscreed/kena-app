// HRDetail — Sprint 8.5 screen tests.
//
// Mocks the data hooks at the boundary so this stays a screen test, not
// a data test. The pure helpers (buildTodayTrendData / buildZones /
// buildStats / buildSleepHRCorrelation) could be unit-tested separately;
// here we exercise the screen-level wiring across has-data and empty-
// state paths.

import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme';
import { HRDetail } from '../HRDetail';
import {
  composeDailyPulseData,
  type DailyPulseData,
  type DailyPulseSnapshot,
} from '../../../state/dailyPulse';
import type { HRSample, SleepSession } from '../../../types/vitals';

const NOW_SEC = () => Math.floor(Date.now() / 1000);

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

let mockHRRecent: HRSample[] = [];
let mockHRPending: HRSample[] = [];
let mockHRRestingRecent: number[] = [];
// Sprint 18 H3 — date-keyed accessor added to the HR slice so the
// correlation can pair by night, not by index. Tests need to seed
// both shapes (the legacy `restingBpmRecent()` and the new
// `restingBpmRecentByNight()`). Default keeps both empty; the
// correlation describe block opts in to real-night data.
let mockHRRestingByNight: Array<{ nightKey: string; restingBpm: number }> = [];
let mockSleepRecent: SleepSession[] = [];
let mockSleepPending: SleepSession[] = [];

jest.mock('../../../state/dailyPulse', () => {
  const actual = jest.requireActual('../../../state/dailyPulse');
  return {
    ...actual,
    useDailyPulseData: () => mockData,
  };
});

jest.mock('../../../state/hr', () => ({
  useHR: (selector?: (s: unknown) => unknown) => {
    const state = { recent: mockHRRecent, pending: mockHRPending };
    return selector ? selector(state) : state;
  },
}));
(jest.requireMock('../../../state/hr') as {
  useHR: { getState: () => unknown };
}).useHR.getState = () => ({
  recent: mockHRRecent,
  pending: mockHRPending,
  restingBpmRecent: () => mockHRRestingRecent,
  restingBpmRecentByNight: () => mockHRRestingByNight,
});

jest.mock('../../../state/sleep', () => ({
  useSleep: (selector?: (s: unknown) => unknown) => {
    const state = { recent: mockSleepRecent, pending: mockSleepPending };
    return selector ? selector(state) : state;
  },
}));

// Sprint 17a parent-scoped hooks land in HRDetail but were never
// mocked here (same pre-existing bug SleepDetail's test had). Without
// a QueryClient, every render throws "No QueryClient set". Stub both
// to "self-buyer path" defaults; the Sprint 18 audit fix tests opt
// in to the loading / error paths by flipping these.
let mockParentPulse: {
  data: unknown;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} = {
  data: null,
  isLoading: false,
  isRefreshing: false,
  error: null,
  refresh: async () => undefined,
};
let mockParentRecent: {
  data: { sleep: unknown[]; readings: unknown[]; hr: unknown[]; spo2: unknown[]; activity: unknown[] };
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} = {
  data: { sleep: [], readings: [], hr: [], spo2: [], activity: [] },
  isLoading: false,
  isRefreshing: false,
  error: null,
  refresh: async () => undefined,
};
const setMockParentPulse = (next: Partial<typeof mockParentPulse>) => {
  mockParentPulse = { ...mockParentPulse, ...next };
};
const resetParentMocks = () => {
  mockParentPulse = {
    data: null,
    isLoading: false,
    isRefreshing: false,
    error: null,
    refresh: async () => undefined,
  };
  mockParentRecent = {
    data: { sleep: [], readings: [], hr: [], spo2: [], activity: [] },
    isLoading: false,
    isRefreshing: false,
    error: null,
    refresh: async () => undefined,
  };
};
jest.mock('../../../hooks/useParentDailyPulseData', () => ({
  useParentDailyPulseData: () => mockParentPulse,
}));
jest.mock('../../../hooks/useParentVitalsRecent', () => ({
  useParentVitalsRecent: () => mockParentRecent,
}));

// Vitals data-completeness fix: HRDetail now calls useHRRangeSummary
// (TanStack Query → hr_range_summary RPC) and useOnboarding (own-family
// resolution). Stub the summary to null so these tests exercise the
// local-slice fallback path (unchanged behaviour); range-summary wiring
// is covered by useHRRangeSummary's own unit tests + the live re-verify.
const mockHRRangeSummary: {
  data: unknown;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} = {
  data: null,
  isLoading: false,
  isRefreshing: false,
  error: null,
  refresh: async () => undefined,
};
jest.mock('../../../hooks/useHRRangeSummary', () => ({
  useHRRangeSummary: () => mockHRRangeSummary,
}));
jest.mock('../../../state/onboarding', () => ({
  useOnboarding: (selector?: (s: unknown) => unknown) => {
    const state = { familyId: 'fam-self' };
    return selector ? selector(state) : state;
  },
}));

// PersonalFindingsCard (D13 correlation matrix) calls useQuery directly,
// so the screen needs a client even though every data hook is mocked.
// Retries off: a failed fetch should surface now, not after backoff.
function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function withProviders(ui: ReactNode, colorMode: 'dark' | 'light' = 'dark') {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 720 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={makeTestQueryClient()}>
        <ThemeProvider mode="caregiver" colorMode={colorMode}>
          {ui}
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function makeHRSample(measuredAtSec: number, bpm: number): HRSample {
  return {
    measuredAtSec,
    bpm,
    sampleWindowSec: 30,
    motionState: 'rest',
    isSpotCheck: false,
  };
}

function makeSleep(endSec: number, totalMinutes = 7 * 60): SleepSession {
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
  mockHRRecent = [];
  mockHRPending = [];
  mockHRRestingRecent = [];
  mockHRRestingByNight = [];
  mockSleepRecent = [];
  mockSleepPending = [];
  resetParentMocks();
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
});

describe('HRDetail — has-data path', () => {
  beforeEach(() => {
    const now = NOW_SEC();
    setMockData({
      bpLatest: null,
      hrRestingToday: 64,
      hrRestingRecent: [62, 63, 64, 62, 63],
      hrLatestSampleAt: now - 60 * 60,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    // Distribute samples through the last 24h with a peak of 142.
    mockHRRecent = [
      makeHRSample(now - 23 * 3600, 56),
      makeHRSample(now - 20 * 3600, 58),
      makeHRSample(now - 16 * 3600, 64),
      makeHRSample(now - 12 * 3600, 78),
      makeHRSample(now - 10 * 3600, 142),
      makeHRSample(now - 8 * 3600, 88),
      makeHRSample(now - 6 * 3600, 70),
      makeHRSample(now - 4 * 3600, 64),
      makeHRSample(now - 2 * 3600, 60),
      makeHRSample(now - 1 * 3600, 64),
    ];
    mockHRRestingRecent = [62, 63, 64, 62, 63];
    // Sprint 18 H3 — date-keyed accessor. Seed 8 nights so the
    // comparative copy gate (HR_HISTORY_REFERENCE_NIGHTS = 7) is met
    // and the insight card uses "your usual" phrasing. Same 5 values
    // as the legacy array, padded with 3 extra prior nights.
    mockHRRestingByNight = [
      { nightKey: '2026-05-13', restingBpm: 62 },
      { nightKey: '2026-05-14', restingBpm: 63 },
      { nightKey: '2026-05-15', restingBpm: 64 },
      { nightKey: '2026-05-16', restingBpm: 63 },
      { nightKey: '2026-05-17', restingBpm: 62 },
      { nightKey: '2026-05-18', restingBpm: 63 },
      { nightKey: '2026-05-19', restingBpm: 64 },
      { nightKey: '2026-05-20', restingBpm: 62 },
    ];
  });

  it('renders the resting HR primary value in the hero', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.getByTestId('hr-detail-hero-primary').props.children).toBe('64');
  });

  it('renders the "Overnight · resting" hero sub-label when a resting value exists', () => {
    // D13 PR-7 (§7.3) — resting-first hero: the nightly resting value
    // wins the headline even when a fresher spot sample exists. The
    // spot value lives in the stats below.
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.getByText('Overnight · resting')).toBeTruthy();
  });

  it('renders the StatTrio with three label/value pairs', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    // Sprint 18 H2 — first slot renamed "Resting" → "Resting avg"
    // to disambiguate from the hero's "Now · resting" (live value).
    // Sprint 16.5f — third slot renamed "Variability" → "Range today".
    expect(screen.getByText('Resting avg')).toBeTruthy();
    expect(screen.getByText('Peak')).toBeTruthy();
    expect(screen.getByText('Range today')).toBeTruthy();
    // Resting average rounds to 63 from the seeded byNight series.
    expect(screen.getByText('63')).toBeTruthy();
    // Peak of 142 from the 24h window.
    expect(screen.getByText('142')).toBeTruthy();
  });

  it('renders the trend chart when there is HR data', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.getByTestId('hr-detail-trend')).toBeTruthy();
  });

  it('renders the HR zones card with all four zone names', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.getByTestId('hr-detail-zones')).toBeTruthy();
    // "Resting" appears in StatTrio + HRZonesCard; the unique zones-only
    // names confirm the zones card itself is rendering.
    expect(screen.getByText('Calm')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Vigorous')).toBeTruthy();
  });

  it('renders the insight card with the has-data body', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    // Sprint 18 H6 — has-data body now describes the real numbers
    // against the baseline. With restingToday=64 and the seeded byNight
    // baseline midpoint around 63, the absDiff is small enough to land
    // in the "right at your usual / close to the middle" band.
    expect(
      screen.getAllByText(/resting heart rate/i).length,
    ).toBeGreaterThan(0);
  });

  it('hides the correlation strip when sleep history is missing', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.queryByTestId('hr-detail-correlation')).toBeNull();
  });

  it('renders the correlation strip when both HR + sleep have history', () => {
    // Sprint 18 H3 — correlation now pairs by date. Seed sleep
    // sessions AND matching HR-by-night entries on the same dates so
    // the intersection is non-empty.
    const now = NOW_SEC();
    const dateKeyFor = (sec: number) => {
      const d = new Date(sec * 1000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const sleepEnds = [
      now - 6 * 24 * 3600,
      now - 5 * 24 * 3600,
      now - 4 * 24 * 3600,
      now - 3 * 24 * 3600,
      now - 2 * 24 * 3600,
    ];
    mockSleepRecent = [
      makeSleep(sleepEnds[0], 7 * 60),
      makeSleep(sleepEnds[1], 6 * 60 + 40),
      makeSleep(sleepEnds[2], 7 * 60 + 30),
      makeSleep(sleepEnds[3], 7 * 60),
      makeSleep(sleepEnds[4], 6 * 60 + 50),
    ];
    mockHRRestingByNight = sleepEnds.map((endSec, i) => ({
      nightKey: dateKeyFor(endSec),
      restingBpm: 62 + i,
    }));
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.getByTestId('hr-detail-correlation')).toBeTruthy();
  });
});

describe('HRDetail — empty state', () => {
  it('renders an em-dash hero value when no resting HR is available', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.getByTestId('hr-detail-hero-primary').props.children).toBe('—');
  });

  it('renders the welcome onboarding line when there is no data', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(
      screen.getByText('Wear the watch to start tracking your heart rate.'),
    ).toBeTruthy();
  });

  it('skips the trend chart when there is no HR data', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.queryByTestId('hr-detail-trend')).toBeNull();
  });

  it('skips the zones card when there is no HR data', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.queryByTestId('hr-detail-zones')).toBeNull();
  });

  it('still renders the insight card with the welcome body', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    // Welcome copy appears in both the hero range line and the insight
    // card body; either surfacing is acceptable for the empty path.
    expect(screen.getAllByText(/Wear the watch to start tracking/i).length)
      .toBeGreaterThanOrEqual(1);
    // The insight-card-specific phrasing distinguishes it.
    expect(
      screen.getByText(/After a few nights of sleep/i),
    ).toBeTruthy();
  });
});

describe('HRDetail — latest-sample fallback (no resting HR)', () => {
  beforeEach(() => {
    const now = NOW_SEC();
    // No resting HR today and no recent resting nights, but a fresh
    // daytime sample exists — the hero should show it rather than blank.
    setMockData({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: now - 30 * 60,
      hrLatestBpm: 84,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
  });

  it('shows the latest bpm in the hero instead of an em-dash', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.getByTestId('hr-detail-hero-primary').props.children).toBe('84');
  });

  it('labels the hero as a latest reading, not resting', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.getByText('Latest reading')).toBeTruthy();
    expect(screen.queryByText('Now · resting')).toBeNull();
  });

  it('keeps the pre-baseline insight body (no resting comparison)', () => {
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.getByText(/After a few nights of sleep/i)).toBeTruthy();
  });
});

describe('HRDetail — back button wiring', () => {
  it('routes back-button taps via the embedded DetailHeader', () => {
    const onBack = jest.fn();
    render(withProviders(<HRDetail onBack={onBack} />));
    const back = screen.getByTestId('hr-detail-header-back');
    expect(back).toBeTruthy();
    // SelfBuyerHome.test uses fireEvent.press; we keep parity here.
    const { fireEvent } = jest.requireActual(
      '@testing-library/react-native',
    ) as typeof import('@testing-library/react-native');
    fireEvent.press(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// ─── Sprint 18 audit fixes ──────────────────────────────────────────────

describe('HRDetail — caregiver-scoped loading + error (Sprint 18 H1)', () => {
  it('shows a loading spinner — not the empty-state UI — when the parent fetch is in flight', () => {
    setMockParentPulse({ isLoading: true, data: null });
    render(
      withProviders(<HRDetail onBack={() => undefined} familyId="fam-99" />),
    );
    expect(screen.getByTestId('hr-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('hr-detail-insight')).toBeNull();
  });

  it('shows an ErrorState — not the empty-state UI — when the parent fetch errored', () => {
    setMockParentPulse({ error: new Error('network down'), data: null });
    render(
      withProviders(<HRDetail onBack={() => undefined} familyId="fam-99" />),
    );
    expect(screen.getByTestId('hr-detail-error')).toBeTruthy();
    expect(screen.queryByTestId('hr-detail-insight')).toBeNull();
  });
});

describe('HRDetail — history-aware insight copy (Sprint 18 H6)', () => {
  it('uses non-comparative copy when the user has 5-6 nights (baseline computable but below HR_HISTORY_REFERENCE_NIGHTS)', () => {
    // hrBaseline needs MIN_HR_DAYS = 5 nights to return non-null;
    // HR_HISTORY_REFERENCE_NIGHTS = 7 gates the comparative phrasing.
    // So a 5- or 6-night user gets baseline (✓ insight body fires) but
    // non-comparative copy (✓ no "than your usual").
    const now = NOW_SEC();
    setMockData({
      bpLatest: null,
      hrRestingToday: 70,
      hrRestingRecent: [62, 63, 64, 62, 63],
      hrLatestSampleAt: now - 60 * 60,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    mockHRRecent = [
      makeHRSample(now - 2 * 3600, 70),
      makeHRSample(now - 1 * 3600, 70),
    ];
    mockHRRestingRecent = [62, 63, 64, 62, 63];
    mockHRRestingByNight = [
      { nightKey: '2026-05-17', restingBpm: 62 },
      { nightKey: '2026-05-18', restingBpm: 63 },
      { nightKey: '2026-05-19', restingBpm: 64 },
      { nightKey: '2026-05-20', restingBpm: 62 },
      { nightKey: '2026-05-21', restingBpm: 63 },
    ];
    render(withProviders(<HRDetail onBack={() => undefined} />));
    // Non-comparative phrasing references "what we've seen so far",
    // never "your usual" / "than last week".
    expect(
      screen.getByText(/what we've seen so far/i),
    ).toBeTruthy();
    expect(screen.queryByText(/than last week/i)).toBeNull();
  });
});

describe('HRDetail — hero range copy gating (Sprint 18 P-H1)', () => {
  it('shows neutral "bpm · latest" — not "within your range" — when no baseline is computed yet', () => {
    const now = NOW_SEC();
    setMockData({
      bpLatest: null,
      hrRestingToday: 65,
      hrRestingRecent: [],
      hrLatestSampleAt: now - 60 * 60,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    mockHRRecent = [
      makeHRSample(now - 2 * 3600, 65),
      makeHRSample(now - 1 * 3600, 65),
    ];
    mockHRRestingRecent = [];
    mockHRRestingByNight = []; // no baseline-eligible nights yet
    render(withProviders(<HRDetail onBack={() => undefined} />));
    // D13 PR-7 — resting-first hero: with a resting value but no
    // baseline the sub-line stays neutral and the chip says Learning.
    // The range claim never renders without a computed baseline.
    expect(screen.getByText('bpm · resting')).toBeTruthy();
    expect(screen.getByText('Learning', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('bpm · within your range')).toBeNull();
    expect(screen.queryByText('bpm · in your usual range')).toBeNull();
  });
});

describe('HRDetail — correlation pair-by-date (Sprint 18 H3)', () => {
  it('skips a sleep date that has no matching HR night entry (no positional misalignment)', () => {
    // Sleep on Mon/Tue/Wed; HR resting only on Mon/Wed (Tue gap).
    // Pre-Sprint-18 the function would have paired Tue-sleep with
    // Wed-HR positionally. Post-fix the intersection is {Mon, Wed},
    // and Tue-sleep is dropped from the correlation.
    const now = NOW_SEC();
    const sleepMon = makeSleep(now - 3 * 86400, 7 * 60);
    const sleepTue = makeSleep(now - 2 * 86400, 6 * 60);
    const sleepWed = makeSleep(now - 1 * 86400, 7 * 60 + 30);
    const dateKeyFor = (sec: number) => {
      const d = new Date(sec * 1000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    mockSleepRecent = [sleepMon, sleepTue, sleepWed];
    mockHRRestingByNight = [
      { nightKey: dateKeyFor(sleepMon.sessionEndSec), restingBpm: 60 },
      { nightKey: dateKeyFor(sleepWed.sessionEndSec), restingBpm: 64 },
    ];
    render(withProviders(<HRDetail onBack={() => undefined} />));
    // Correlation still renders (2 matched nights — Mon + Wed); the
    // unmatched Tue is silently dropped.
    expect(screen.getByTestId('hr-detail-correlation')).toBeTruthy();
  });
});

describe('HRDetail — trend chart caption is honest (Sprint 18 H4)', () => {
  it('labels the today chart as "Last 24h" (not "Today")', () => {
    const now = NOW_SEC();
    setMockData({
      bpLatest: null,
      hrRestingToday: 64,
      hrRestingRecent: [62, 63],
      hrLatestSampleAt: now - 60 * 60,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    mockHRRecent = [
      makeHRSample(now - 2 * 3600, 70),
      makeHRSample(now - 1 * 3600, 65),
    ];
    mockHRRestingByNight = [
      { nightKey: '2026-05-20', restingBpm: 62 },
      { nightKey: '2026-05-21', restingBpm: 63 },
    ];
    render(withProviders(<HRDetail onBack={() => undefined} />));
    expect(screen.getByText('Last 24h · heart rate')).toBeTruthy();
    expect(screen.queryByText('Today · heart rate')).toBeNull();
  });
});

describe('HRDetail — dark-mode snapshot', () => {
  // Pin the wall clock so the rendered relative timestamp strings
  // ("Today, X:XX PM" / "Yesterday at X:XX PM") don't drift as the
  // test machine's clock advances.
  const FROZEN = new Date('2026-05-08T16:30:00Z').getTime();
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(FROZEN);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('matches snapshot with full data in dark mode', () => {
    const now = NOW_SEC();
    setMockData({
      bpLatest: null,
      hrRestingToday: 64,
      hrRestingRecent: [62, 63, 64, 62, 63],
      hrLatestSampleAt: now - 60 * 60,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    mockHRRecent = [
      makeHRSample(now - 12 * 3600, 78),
      makeHRSample(now - 6 * 3600, 70),
      makeHRSample(now - 1 * 3600, 64),
    ];
    mockHRRestingRecent = [62, 63, 64];
    const { toJSON } = render(
      withProviders(<HRDetail onBack={() => undefined} />, 'dark'),
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
