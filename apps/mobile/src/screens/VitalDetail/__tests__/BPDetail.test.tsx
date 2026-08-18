// BPDetail — Sprint 8.5 integration tests.
//
// Mocks `useDailyPulseData` + `useReadings` at the module boundary so
// these stay screen-level tests, not data-store tests. Mirrors the
// pattern in SelfBuyerHome.test.tsx.

import { type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme';
import { BPDetail, formatHeroTime } from '../BPDetail';
import {
  composeDailyPulseData,
  type DailyPulseData,
  type DailyPulseSnapshot,
} from '../../../state/dailyPulse';
import type { LocalReading } from '../../../state/readings';

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

let mockRecent: LocalReading[] = [];
let mockPending: LocalReading[] = [];

function setMockData(snapshot: DailyPulseSnapshot) {
  mockData = composeDailyPulseData(snapshot, NOW_SEC());
}

jest.mock('../../../state/dailyPulse', () => {
  const actual = jest.requireActual('../../../state/dailyPulse');
  return {
    ...actual,
    useDailyPulseData: () => mockData,
  };
});

jest.mock('../../../state/readings', () => ({
  useReadings: (selector?: (s: unknown) => unknown) => {
    const state = { recent: mockRecent, pending: mockPending };
    return selector ? selector(state) : state;
  },
}));

// Sprint 17a parent-scoped hooks land in BPDetail but were never
// mocked here (same pre-existing bug Sleep/HR tests had). Without a
// QueryClient, every render throws "No QueryClient set". Stub both
// to "self-buyer path" defaults; the Sprint 18 audit fix tests opt
// in to the loading + error paths by flipping these.
let mockParentPulse: {
  data: unknown;
  wearerTimeZone: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} = {
  data: null,
  wearerTimeZone: null,
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
    wearerTimeZone: null,
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

function withProviders(ui: ReactNode, colorMode: 'dark' | 'light' = 'dark') {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 720 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider mode="caregiver" colorMode={colorMode}>
        {ui}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function makeBp(
  measuredAtSec: number,
  sys = 122,
  dia = 78,
  tier: 'in_pattern' | 'calm_concerned' | 'confirmed_urgent' = 'in_pattern',
  localId = `bp-${measuredAtSec}`,
): LocalReading {
  return {
    localId,
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

// Sprint 18 B4 — anchor a "definitely today" timestamp for test
// readings. The previous tests used NOW_SEC() - 60*60 which crossed
// the day boundary near midnight and made `readingsForToday()` return
// []; with the Sprint 18 B4 check that now hides the chart and shows
// a "no readings today" placeholder, the chart-presence assertions
// became flaky. Anchoring to today at noon avoids the boundary.
function todayNoonSec(): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRecent = [];
  mockPending = [];
  resetParentMocks();
});

describe('BPDetail — populated states', () => {
  it('renders 122/78 + within-your-range copy when BP classifies in_pattern', () => {
    // Sprint 18 B4 — use today's noon so the 7d chart definitely
    // sees a "today" reading and renders (rather than the
    // no-readings-today placeholder).
    const reading = makeBp(todayNoonSec(), 122, 78, 'in_pattern');
    mockRecent = [reading];
    setMockData({
      bpLatest: reading,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<BPDetail onBack={() => undefined} />));
    expect(screen.getByText('122')).toBeTruthy();
    expect(screen.getByText('/ 78')).toBeTruthy();
    // Sprint 19 (audit D12 P0-4 / P2-1) — canonical vocabulary. The
    // app used six different phrases for this one idea; "within your
    // usual range" is now the single source, via
    // utils/classification.vitalRangeCopyForTier.
    expect(screen.getByText('mmHg · within your usual range')).toBeTruthy();
    expect(screen.getByTestId('bp-detail-chart')).toBeTruthy();
    expect(screen.getByTestId('bp-detail-readings')).toBeTruthy();
  });

  it('renders worth-a-look copy when tier is calm_concerned', () => {
    const reading = makeBp(NOW_SEC() - 30 * 60, 142, 92, 'calm_concerned');
    mockRecent = [reading];
    setMockData({
      bpLatest: reading,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<BPDetail onBack={() => undefined} />));
    expect(screen.getByText('mmHg · worth a look')).toBeTruthy();
  });

  it('renders talk-to-your-doctor copy when tier is confirmed_urgent', () => {
    const reading = makeBp(NOW_SEC() - 30 * 60, 188, 122, 'confirmed_urgent');
    mockRecent = [reading];
    setMockData({
      bpLatest: reading,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<BPDetail onBack={() => undefined} />));
    expect(screen.getByText('mmHg · talk to your doctor today')).toBeTruthy();
  });
});

describe('BPDetail — empty state', () => {
  it('renders the no-readings placeholder when there is no BP data', () => {
    mockRecent = [];
    mockPending = [];
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
    render(withProviders(<BPDetail onBack={() => undefined} />));
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('No readings yet')).toBeTruthy();
    expect(
      screen.getByText("Take your first reading whenever you're ready."),
    ).toBeTruthy();
    // Chart + readings list omitted in empty state
    expect(screen.queryByTestId('bp-detail-chart')).toBeNull();
    expect(screen.queryByTestId('bp-detail-readings')).toBeNull();
  });
});

describe('BPDetail — interactions', () => {
  it('fires onSelectReading with the localId when a recent row is tapped', () => {
    const onSelectReading = jest.fn();
    const r1 = makeBp(NOW_SEC() - 60 * 60, 122, 78, 'in_pattern', 'bp-aaa');
    const r2 = makeBp(NOW_SEC() - 25 * 3600, 124, 79, 'in_pattern', 'bp-bbb');
    mockRecent = [r1, r2];
    setMockData({
      bpLatest: r1,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(
      withProviders(
        <BPDetail onBack={() => undefined} onSelectReading={onSelectReading} />,
      ),
    );
    // testID nests through RecentReadingsSection → RecentReadingsList:
    // `${section}-list-row-${id}`.
    fireEvent.press(screen.getByTestId('bp-detail-readings-list-row-bp-aaa'));
    expect(onSelectReading).toHaveBeenCalledWith('bp-aaa');
  });

  it('fires onBack when the back chevron is tapped', () => {
    const onBack = jest.fn();
    const r1 = makeBp(NOW_SEC() - 60 * 60, 122, 78, 'in_pattern');
    mockRecent = [r1];
    setMockData({
      bpLatest: r1,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<BPDetail onBack={onBack} />));
    fireEvent.press(screen.getByTestId('bp-detail-header-back'));
    expect(onBack).toHaveBeenCalled();
  });
});

// ─── Sprint 18 audit fixes ──────────────────────────────────────────────

describe('BPDetail — caregiver-scoped loading + error (Sprint 18 B1)', () => {
  it('shows a loading spinner — not the empty-state UI — when the parent fetch is in flight', () => {
    setMockParentPulse({ isLoading: true, data: null });
    render(
      withProviders(
        <BPDetail onBack={() => undefined} familyId="fam-77" />,
      ),
    );
    expect(screen.getByTestId('bp-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('bp-detail-insight')).toBeNull();
  });

  it('shows an ErrorState — not the empty-state UI — when the parent fetch errored', () => {
    setMockParentPulse({ error: new Error('network down'), data: null });
    render(
      withProviders(
        <BPDetail onBack={() => undefined} familyId="fam-77" />,
      ),
    );
    expect(screen.getByTestId('bp-detail-error')).toBeTruthy();
    expect(screen.queryByTestId('bp-detail-insight')).toBeNull();
  });
});

describe("BPDetail — recent-list 'now' label freshness (Sprint 18 B2)", () => {
  it("does NOT label the newest row 'now' when the reading is more than an hour old", () => {
    // Reading 6 hours ago (sparse-tracker scenario). The newest row
    // should NOT be labelled "now".
    const stale = makeBp(NOW_SEC() - 6 * 3600, 124, 80, 'in_pattern');
    mockRecent = [stale];
    setMockData({
      bpLatest: stale,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<BPDetail onBack={() => undefined} />));
    // The list section renders, but no row chip should say "now".
    expect(screen.getByTestId('bp-detail-readings')).toBeTruthy();
    expect(screen.queryByText('now')).toBeNull();
  });

  it("DOES label the newest row 'now' when the reading is fresh (<1 hour old)", () => {
    const fresh = makeBp(NOW_SEC() - 5 * 60, 122, 78, 'in_pattern'); // 5 min ago
    mockRecent = [fresh];
    setMockData({
      bpLatest: fresh,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<BPDetail onBack={() => undefined} />));
    expect(screen.getByText('now')).toBeTruthy();
  });
});

describe('BPDetail — "no readings today" chart placeholder (Sprint 18 B4)', () => {
  it('shows the placeholder when there are old readings but none today', () => {
    // Reading from 5 days ago — definitely not today.
    const old = makeBp(NOW_SEC() - 5 * 24 * 3600, 124, 80, 'in_pattern');
    mockRecent = [old];
    setMockData({
      bpLatest: old,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<BPDetail onBack={() => undefined} />));
    expect(screen.getByTestId('bp-detail-chart-empty-today')).toBeTruthy();
    expect(screen.queryByTestId('bp-detail-chart')).toBeNull();
  });
});

describe('BPDetail — hero time formatting (Sprint 18 B5)', () => {
  it('formatHeroTime — under 24h returns "Latest · <time>" only', () => {
    const oneHourAgo = NOW_SEC() - 60 * 60;
    const out = formatHeroTime(oneHourAgo, 'UTC');
    expect(out).toMatch(/^Latest · /);
    expect(out).not.toMatch(/Latest · .+ · /); // no second "·"
  });

  it('formatHeroTime — over 24h includes the weekday AND date so the week is unambiguous', () => {
    // 25 hours ago — definitely cross-day, but inside the 36h
    // staleness threshold so we exercise the >24h-but-fresh path.
    const yesterday = NOW_SEC() - 25 * 3600;
    const out = formatHeroTime(yesterday, 'UTC');
    // Format: "Latest · <weekday> · <month-day>, <time>".
    // Three " · " (or two: "Latest ·" and "<wd> ·") + a "," before time.
    expect(out).toMatch(/^Latest · .+ · .+, /);
  });

  it('formatHeroTime — renders in the wearer timezone, not the device (UTC) zone', () => {
    // Vitals data-completeness fix: a reading at 23:30 UTC reads as
    // 12:30 AM in Lagos (UTC+1) but 7:30 PM in New York (UTC-4 in June).
    // The runner is TZ=UTC, so this proves the tz is actually applied.
    const at2330Utc = Math.floor(Date.UTC(2026, 5, 3, 23, 30, 0) / 1000);
    const nowMs = Date.UTC(2026, 5, 4, 0, 0, 0); // 30 min later → <24h branch
    expect(formatHeroTime(at2330Utc, 'Africa/Lagos', nowMs)).toMatch(/12:30/);
    expect(formatHeroTime(at2330Utc, 'America/New_York', nowMs)).toMatch(/7:30/);
  });
});

describe('BPDetail — Share-with-doctor wiring (Sprint 18 B3)', () => {
  it('renders the share row when onSharePress is wired and fires the callback on tap', () => {
    const onSharePress = jest.fn();
    const reading = makeBp(todayNoonSec(), 122, 78, 'in_pattern');
    mockRecent = [reading];
    setMockData({
      bpLatest: reading,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(
      withProviders(
        <BPDetail onBack={() => undefined} onSharePress={onSharePress} />,
      ),
    );
    const row = screen.getByTestId('bp-detail-share-row');
    expect(row).toBeTruthy();
    fireEvent.press(row);
    expect(onSharePress).toHaveBeenCalled();
  });

  it('does NOT render the share row when onSharePress is not provided', () => {
    const reading = makeBp(todayNoonSec(), 122, 78, 'in_pattern');
    mockRecent = [reading];
    setMockData({
      bpLatest: reading,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<BPDetail onBack={() => undefined} />));
    expect(screen.queryByTestId('bp-detail-share-row')).toBeNull();
  });
});

describe('BPDetail — Yesterday row format (Sprint 18 P-B1)', () => {
  it("includes the time alongside 'Yesterday' so same-day readings are distinguishable", () => {
    const yesterdayMorning = makeBp(NOW_SEC() - 30 * 3600, 124, 80, 'in_pattern');
    mockRecent = [yesterdayMorning];
    setMockData({
      bpLatest: yesterdayMorning,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<BPDetail onBack={() => undefined} />));
    // The list row's time chip should match "Yesterday <hh:mm>".
    // We assert the prefix only — exact time depends on the test
    // machine's clock + timezone.
    const yesterdayChip = screen.getByText(/^Yesterday \d/);
    expect(yesterdayChip).toBeTruthy();
  });
});

describe('BPDetail — snapshot', () => {
  // Pin the wall clock so the rendered "Today, X:XX PM" timestamp string
  // is deterministic across runs. Without this the snapshot drifts every
  // few minutes as the test machine's clock advances.
  const FROZEN = new Date('2026-05-08T16:30:00Z').getTime();
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(FROZEN);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('matches snapshot in dark mode with a populated reading', () => {
    const r1 = makeBp(NOW_SEC() - 60 * 60, 122, 78, 'in_pattern', 'bp-snap');
    mockRecent = [r1];
    setMockData({
      bpLatest: r1,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: null,
      spo2OvernightLowsRecent: [],
      spo2LatestSampleAt: null,
      sleepSession: null,
      activityToday: null,
    });
    const { toJSON } = render(
      withProviders(<BPDetail onBack={() => undefined} />, 'dark'),
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
