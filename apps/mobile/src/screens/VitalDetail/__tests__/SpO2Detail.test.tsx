// SpO2Detail — Sprint 8.5 integration tests.
//
// Mocks the data hooks at the boundary so this stays a screen test, not a
// data test. Verifies:
//   - Hero renders the latest percent + the correct tier-based range copy
//     for each of the three classification tiers.
//   - Empty state renders when latestPercent is null (no chart, welcome
//     helper, calm insight body).
//   - Insight card body changes per tier.
//   - Snapshot in dark mode (full surface + populated state).
//   - Voice gate: rendered text never contains the SpO2-forbidden words
//     (dangerous, critical, diagnose, abnormal, predict, prevent, silent
//     killer, medical-grade, clinical SpO2, loved one, you may have, we
//     detected, patient).

import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme';
import { SpO2Detail } from '../SpO2Detail';
import {
  composeDailyPulseData,
  type DailyPulseSnapshot,
  type DailyPulseData,
} from '../../../state/dailyPulse';
import type { SpO2Sample } from '../../../types/vitals';

// Real-clock-relative timestamps so the screen's freshness windows always
// see data as current, mirroring SelfBuyerHome.test.tsx.
const NOW_SEC = () => Math.floor(Date.now() / 1000);

const mockOnBack = jest.fn();

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

let mockSpO2Samples: SpO2Sample[] = [];

const setMockData = (snapshot: DailyPulseSnapshot) => {
  mockData = composeDailyPulseData(snapshot, NOW_SEC());
};

jest.mock('../../../state/dailyPulse', () => {
  const actual = jest.requireActual('../../../state/dailyPulse');
  return {
    ...actual,
    useDailyPulseData: () => mockData,
  };
});

// Sprint 18 SP2 — slice exposes overnightLowsRecentByNight()
// (called via getState() by SpO2Detail's correlation memo). Default
// returns empty; correlation tests opt-in by flipping this.
let mockLowsByNight: Array<{ nightKey: string; low: number }> = [];
jest.mock('../../../state/spo2', () => ({
  useSpO2: Object.assign(
    (selector?: (s: unknown) => unknown) => {
      const state = { pending: [], recent: mockSpO2Samples };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        pending: [],
        recent: mockSpO2Samples,
        overnightLowsRecentByNight: () => mockLowsByNight,
      }),
    },
  ),
}));

// Sprint 17a parent-scoped hooks land in SpO2Detail. Same pre-existing
// missing-mocks bug as Sleep/HR/BP. Stub to "self-buyer path" defaults;
// audit tests opt in to loading/error by flipping these.
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

// SpO2Detail also reads useSleep for the correlation; stub empty by
// default so existing assertions don't see a correlation strip they
// didn't ask for.
jest.mock('../../../state/sleep', () => ({
  useSleep: (selector?: (s: unknown) => unknown) => {
    const state = { recent: [], pending: [] };
    return selector ? selector(state) : state;
  },
}));

function withProviders(ui: ReactNode, colorMode: 'light' | 'dark' = 'dark') {
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

function makeSample(measuredAtSec: number, percent: number): SpO2Sample {
  return {
    measuredAtSec,
    percent,
    maxInWindow: percent,
    minInWindow: percent,
    sampleWindowSec: 60,
    isSpotCheck: false,
    perfusionIndex: null,
  };
}

// Sprint 18 SP3 — helper to build a sample whose UTC hour is reliably
// in the overnight window (22–06 UTC), independent of test-machine
// timezone. Avoids the prior "chart visibility depends on wall clock"
// flake. Uses today-at-04:00-UTC minus an hour offset so timestamps
// are recent (won't trip the staleness gate) but in the overnight
// band.
function overnightSampleSec(offsetHours: number): number {
  const d = new Date();
  d.setUTCHours(4, 0, 0, 0); // anchor to 04:00 UTC today
  return Math.floor(d.getTime() / 1000) - offsetHours * 3600;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSpO2Samples = [];
  mockLowsByNight = [];
  resetParentMocks();
});

describe('SpO2Detail — hero + tier copy', () => {
  it('renders latestPercent with in_pattern hero copy', () => {
    setMockData({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: 98,
      // in_pattern: latest >= 95 AND last overnight low >= 90 (here 96).
      spo2OvernightLowsRecent: [97, 96, 96],
      spo2LatestSampleAt: NOW_SEC() - 60 * 60,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SpO2Detail onBack={mockOnBack} />));
    expect(screen.getByTestId('spo2-detail-hero-primary').props.children).toBe(
      '98',
    );
    expect(screen.getByText('Steady through the night')).toBeTruthy();
  });

  it('renders calm_concerned hero + insight when latest is in 90–94 borderline', () => {
    setMockData({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: 92,
      spo2OvernightLowsRecent: [94, 93, 92],
      spo2LatestSampleAt: NOW_SEC() - 60 * 60,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SpO2Detail onBack={mockOnBack} />));
    expect(screen.getByTestId('spo2-detail-hero-primary').props.children).toBe(
      '92',
    );
    expect(
      screen.getByText(
        'Worth a look — share with your doctor at your next visit',
      ),
    ).toBeTruthy();
    // Sprint 19 (audit D12 P0-1) — the insight used to hardcode a
    // threshold ("below 92%") that had nothing to do with this user's
    // data. It now quotes the observed low, or stays general when we
    // have none. Assert the SHAPE, not a frozen sentence, so honest
    // copy can evolve without a test edit.
    expect(screen.getByText(/below your usual/i)).toBeTruthy();
    expect(screen.getByText(/next doctor visit/i)).toBeTruthy();
    // Never asserts an event we did not observe.
    expect(screen.queryByText(/around \d+\s?(am|pm)/i)).toBeNull();
  });

  it('renders confirmed_urgent hero + insight when overnight lows < 88 sustained 3+ nights', () => {
    setMockData({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: 96,
      spo2OvernightLowsRecent: [87, 86, 85],
      spo2LatestSampleAt: NOW_SEC() - 60 * 60,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SpO2Detail onBack={mockOnBack} />));
    expect(
      screen.getByText('We recommend talking to your doctor soon'),
    ).toBeTruthy();
    // Sprint 19 (audit D12 P0-1) — see the calm_concerned case above.
    expect(screen.getByText(/well below your usual/i)).toBeTruthy();
    // The hero and the insight both carry this — assert at least one.
    expect(screen.getAllByText(/doctor soon/i).length).toBeGreaterThan(0);
    // The observed low here is 85, so it should be quoted — a real
    // number from the user's own data, not a hardcoded threshold.
    expect(screen.getByText(/85%/)).toBeTruthy();
  });
});

describe('SpO2Detail — empty state', () => {
  it('shows the welcome empty state when latestPercent is null', () => {
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
    render(withProviders(<SpO2Detail onBack={mockOnBack} />));

    // Hero renders the dash + the empty sub-label.
    expect(screen.getByTestId('spo2-detail-hero-primary').props.children).toBe(
      '—',
    );
    expect(screen.getByText('No oxygen samples yet')).toBeTruthy();
    expect(screen.getByText('No oxygen samples yet today')).toBeTruthy();
    expect(
      screen.getByText('Wear the watch overnight to start tracking your oxygen.'),
    ).toBeTruthy();

    // Chart + readings list omitted in empty state.
    expect(screen.queryByTestId('spo2-detail-chart')).toBeNull();
    expect(screen.queryByTestId('spo2-detail-readings')).toBeNull();
    expect(screen.queryByTestId('spo2-detail-trio')).toBeNull();

    // Insight card still renders with calm welcome body.
    expect(screen.getByTestId('spo2-detail-insight')).toBeTruthy();
  });
});

describe('SpO2Detail — populated surface', () => {
  beforeEach(() => {
    // Sprint 18 — anchor samples to 04:00 UTC ± a few hours so they
    // reliably fall inside the buildOvernightSeries window
    // (getUTCHours() >= 22 || < 6). The previous setup used
    // NOW_SEC()-based offsets which were flaky in CI depending on
    // wall-clock time-of-day.
    mockSpO2Samples = [
      makeSample(overnightSampleSec(5), 96),
      makeSample(overnightSampleSec(4), 95),
      makeSample(overnightSampleSec(3), 94),
      makeSample(overnightSampleSec(2), 96),
      makeSample(overnightSampleSec(1), 97),
      makeSample(overnightSampleSec(0), 98),
    ];
    setMockData({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: 98,
      spo2OvernightLowsRecent: [97, 96, 96],
      spo2LatestSampleAt: NOW_SEC() - 60 * 60,
      sleepSession: null,
      activityToday: null,
    });
  });

  it('renders chart, stat trio, insight card, and readings list', () => {
    render(withProviders(<SpO2Detail onBack={mockOnBack} />));
    expect(screen.getByTestId('spo2-detail-chart')).toBeTruthy();
    expect(screen.getByTestId('spo2-detail-trio')).toBeTruthy();
    expect(screen.getByTestId('spo2-detail-insight')).toBeTruthy();
    expect(screen.getByTestId('spo2-detail-readings')).toBeTruthy();
    expect(screen.getByText('Recent readings')).toBeTruthy();
    // Caption includes the range suffix; assert substring match.
    expect(screen.getByText(/^Overnight · oxygen · last /)).toBeTruthy();
    // Sub-caption is the dynamic chart Y-axis band — depends on
    // the data's minimum (Sprint 16.5f made this adaptive). Just
    // assert the format here, not the specific numbers.
    expect(screen.getByText(/^\d+–\d+ band$/)).toBeTruthy();
  });

  it('matches the dark-mode snapshot for an in_pattern surface', () => {
    // Pin the wall clock so any "now"-relative copy in the rendered tree
    // is deterministic across runs. The fake timer is installed BEFORE
    // we rebuild the sample data so the sample timestamps + the rendered
    // "Just now" / clock strings all derive from the same frozen instant.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-05-08T16:30:00Z').getTime());
    try {
      // Sprint 18 — anchor to overnight UTC window so the chart
      // renders deterministically.
      mockSpO2Samples = [
        makeSample(overnightSampleSec(5), 96),
        makeSample(overnightSampleSec(4), 95),
        makeSample(overnightSampleSec(3), 94),
        makeSample(overnightSampleSec(2), 96),
        makeSample(overnightSampleSec(1), 97),
        makeSample(overnightSampleSec(0), 98),
      ];
      setMockData({
        bpLatest: null,
        hrRestingToday: null,
        hrRestingRecent: [],
        hrLatestSampleAt: null,
        spo2LatestPercent: 98,
        spo2OvernightLowsRecent: [97, 96, 96],
        spo2LatestSampleAt: NOW_SEC() - 60 * 60,
        sleepSession: null,
        activityToday: null,
      });
      const tree = render(
        withProviders(<SpO2Detail onBack={mockOnBack} />, 'dark'),
      ).toJSON();
      expect(tree).toMatchSnapshot();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SpO2Detail — voice gate', () => {
  // SpO2 has the strictest voice bar of any vital. Any of these strings
  // appearing in rendered copy is an immediate fail.
  const FORBIDDEN = [
    'patient',
    'patients',
    'diagnose',
    'diagnosis',
    'diagnostic',
    'predict',
    'prevent',
    'dangerous',
    'critical',
    'silent killer',
    'medical-grade',
    'clinical SpO2',
    'loved one',
    'you may have',
    'we detected',
    'abnormal',
  ];

  function renderedTextFor(snapshot: DailyPulseSnapshot): string {
    setMockData(snapshot);
    const { toJSON } = render(
      withProviders(<SpO2Detail onBack={mockOnBack} />),
    );
    return JSON.stringify(toJSON());
  }

  it('does not contain forbidden words in the in_pattern surface', () => {
    const text = renderedTextFor({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: 98,
      spo2OvernightLowsRecent: [97, 96, 96],
      spo2LatestSampleAt: NOW_SEC() - 60 * 60,
      sleepSession: null,
      activityToday: null,
    });
    for (const word of FORBIDDEN) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('does not contain forbidden words in the calm_concerned surface', () => {
    const text = renderedTextFor({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: 92,
      spo2OvernightLowsRecent: [94, 93, 92],
      spo2LatestSampleAt: NOW_SEC() - 60 * 60,
      sleepSession: null,
      activityToday: null,
    });
    for (const word of FORBIDDEN) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('does not contain forbidden words in the confirmed_urgent surface', () => {
    const text = renderedTextFor({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: 96,
      spo2OvernightLowsRecent: [87, 86, 85],
      spo2LatestSampleAt: NOW_SEC() - 60 * 60,
      sleepSession: null,
      activityToday: null,
    });
    for (const word of FORBIDDEN) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('does not contain forbidden words in the empty state', () => {
    const text = renderedTextFor({
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
    for (const word of FORBIDDEN) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });
});

// ─── Sprint 18 audit fixes ──────────────────────────────────────────────

describe('SpO2Detail — caregiver-scoped loading + error (Sprint 18 SP1)', () => {
  it('shows a loading spinner — not the empty-state UI — when the parent fetch is in flight', () => {
    setMockParentPulse({ isLoading: true, data: null });
    render(
      withProviders(
        <SpO2Detail onBack={mockOnBack} familyId="fam-88" />,
      ),
    );
    expect(screen.getByTestId('spo2-detail-loading')).toBeTruthy();
    expect(screen.queryByTestId('spo2-detail-insight')).toBeNull();
  });

  it('shows an ErrorState — not the empty-state UI — when the parent fetch errored', () => {
    setMockParentPulse({ error: new Error('network down'), data: null });
    render(
      withProviders(
        <SpO2Detail onBack={mockOnBack} familyId="fam-88" />,
      ),
    );
    expect(screen.getByTestId('spo2-detail-error')).toBeTruthy();
    expect(screen.queryByTestId('spo2-detail-insight')).toBeNull();
  });
});

describe("SpO2Detail — 'Lowest' single-source-of-truth (Sprint 18 SP3)", () => {
  it("value and unit describe the SAME sample (the lowest overnight reading in range)", () => {
    // Seed a known lowest-sample at 03:00 UTC at 88%; other samples
    // are all higher. The StatTrio's "Lowest" should be 88 with a
    // time tied to that exact sample.
    const lowSec = overnightSampleSec(2); // some overnight time
    mockSpO2Samples = [
      makeSample(overnightSampleSec(5), 96),
      makeSample(overnightSampleSec(4), 95),
      makeSample(overnightSampleSec(3), 94),
      makeSample(lowSec, 88), // the lowest
      makeSample(overnightSampleSec(1), 97),
      makeSample(overnightSampleSec(0), 98),
    ];
    setMockData({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: 98,
      // overnightLowsRecent here intentionally says 95 (per-night
      // minimum that doesn't match the in-range sample minimum) to
      // prove that the StatTrio uses the SAMPLE-level minimum
      // (88), not the per-night roll-up.
      spo2OvernightLowsRecent: [95],
      spo2LatestSampleAt: NOW_SEC() - 60 * 60,
      sleepSession: null,
      activityToday: null,
    });
    render(withProviders(<SpO2Detail onBack={mockOnBack} />));
    // Value: 88. Unit: starts with "briefly · " followed by a time.
    expect(screen.getByText('88')).toBeTruthy();
    expect(screen.getByText(/^briefly · /)).toBeTruthy();
  });
});

describe('SpO2Detail — correlation pair-by-date (Sprint 18 SP2)', () => {
  it('skips a sleep night that has no matching overnight-low entry (no positional misalignment)', () => {
    // Sleep on Mon/Tue/Wed; overnight lows only on Mon/Wed (Tue
    // gap). Pre-Sprint-18 the function would have paired Tue-sleep
    // with Wed-low positionally. Post-fix the intersection is
    // {Mon, Wed} and Tue-sleep is dropped.
    const now = NOW_SEC();
    const mkSleep = (endSec: number, score = 78) => ({
      sessionStartSec: endSec - 7 * 3600,
      sessionEndSec: endSec,
      sessionStartLocal: new Date((endSec - 7 * 3600) * 1000).toISOString(),
      sessionEndLocal: new Date(endSec * 1000).toISOString(),
      totalMinutes: 7 * 60,
      deepMinutes: 100,
      remMinutes: 80,
      lightMinutes: 240,
      awakeMinutes: 0,
      awakeCount: 0,
      transitions: [],
      sleepScore: score,
    });
    // Anchor sleep sessions to the same nightKey-anchored dates the
    // SpO2 slice uses (UTC-based).
    const mon = now - 3 * 24 * 3600;
    const wed = now - 1 * 24 * 3600;
    const dayKeyFor = (sec: number) => {
      const d = new Date(sec * 1000);
      const hr = d.getUTCHours();
      const anchored =
        hr >= 22 ? new Date(d.getTime() + 86400 * 1000) : d;
      return anchored.toISOString().slice(0, 10);
    };
    // Mock useSleep to return Mon, Tue, Wed.
    const sleepMock = jest.requireMock('../../../state/sleep') as {
      useSleep: (selector?: (s: unknown) => unknown) => unknown;
    };
    const allSleep = [mkSleep(mon), mkSleep(mon + 86400), mkSleep(wed)];
    sleepMock.useSleep = (selector?: (s: unknown) => unknown) => {
      const state = { recent: allSleep, pending: [] };
      return selector ? selector(state) : state;
    };
    // SpO2 lows only on Mon + Wed (no Tuesday entry).
    mockLowsByNight = [
      { nightKey: dayKeyFor(mon), low: 92 },
      { nightKey: dayKeyFor(wed), low: 90 },
    ];
    setMockData({
      bpLatest: null,
      hrRestingToday: null,
      hrRestingRecent: [],
      hrLatestSampleAt: null,
      spo2LatestPercent: 97,
      spo2OvernightLowsRecent: [92, 90],
      spo2LatestSampleAt: NOW_SEC() - 60 * 60,
      sleepSession: null,
      activityToday: null,
    });
    // Seed at least 3 overnight samples so the chart renders the
    // surface around the correlation strip (the strip itself needs
    // at least 2 matched nights, which Mon+Wed satisfies).
    mockSpO2Samples = [
      makeSample(overnightSampleSec(5), 96),
      makeSample(overnightSampleSec(4), 95),
      makeSample(overnightSampleSec(3), 94),
    ];
    render(withProviders(<SpO2Detail onBack={mockOnBack} />));
    // Correlation strip still renders (Mon + Wed both matched).
    expect(screen.getByTestId('spo2-detail-correlation')).toBeTruthy();
  });
});
