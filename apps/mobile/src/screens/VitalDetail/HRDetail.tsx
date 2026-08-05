// HRDetail — Sprint 8.5 (per-vital detail screen).
//
// One of five vital-detail screens (BP, HR, SpO2, Sleep, Activity). Built
// on the shared DetailShell + VitalHero + StatTrio + VitalTrendChart +
// VitalInsightCard primitives, plus the HR-specific HRZonesCard and a
// CorrelationStrip for sleep × resting-HR.
//
// Composition (per the brief):
//   1. VitalHero — vital="hr"; resting bpm + ring fill
//   2. StatTrio — Resting / Peak / Variability
//   3. VitalTrendChart — continuous HR through the day
//   4. HRZonesCard — 4-tier time-in-zones
//   5. CorrelationStrip — sleep × resting HR over the last 7 days (hidden
//      when either series has no data)
//   6. VitalInsightCard — Tier-B placeholder copy about HR + sleep
//
// Empty state (no resting bpm yet today): hero shows "—" + a calm
// onboarding line; trend chart + zones card are skipped; the correlation
// strip still renders if both vitals have history; insight card carries
// a welcome paragraph.
//
// Voice rules (docs/05-voice-and-claims.md): every user-visible string
// in this file is voice-checked. Forbidden: "patient", "diagnose",
// "predict", "dangerous level", "critical level", "silent killer", "you
// may have", "we detected", "loved one", "smartwatch". Preferred: "your
// reading", "talk to your doctor", calm/reassuring framing.
//
// Stack pin (docs/00-tech-stack.md): RN 0.81.5, react-native-svg 15.x,
// react-native-reanimated v3, phosphor-react-native v3. No new deps.

import { Fragment, useMemo, useState } from 'react';
import { DetailShell } from '../../components/DetailShell';
import { BaselineReference } from '../../components/BaselineReference';
import { StalenessHintRow } from '../../components/StalenessHintRow';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import type { TrendRange } from '../../components/TimeRangePills';
import { hrBaseline, formatHRBaseline, type HRBaseline } from '../../utils/vitalBaselines';

const RANGE_TO_DAYS: Record<TrendRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

import { VitalHero } from '../../components/VitalHero';
import { StatTrio } from '../../components/StatTrio';
import { VitalTrendChart } from '../../components/VitalTrendChart';
import { VitalInsightCard } from '../../components/VitalInsightCard';
import { VitalExplainerAnchor } from '../../components/VitalExplainerAnchor';
import {
  CorrelationStrip,
  type VitalSeries,
} from '../../components/CorrelationStrip';
import { HRZonesCard, type HRZone } from '../../components/HRZonesCard';
import {
  RecentReadingsSection,
} from '../../components/RecentReadingsSection';
import type { RecentReading } from '../../components/RecentReadingsList';
import { useDailyPulseData, emptyDailyPulse } from '../../state/dailyPulse';
import { useHR } from '../../state/hr';
import { useSleep } from '../../state/sleep';
import { useAuth } from '../../state/auth';
import { resolveTimeZone, timeInZone, weekdayInZone } from '../../utils/timeInZone';
import { useParentDailyPulseData } from '../../hooks/useParentDailyPulseData';
import { useParentVitalsRecent } from '../../hooks/useParentVitalsRecent';
import { useOnboarding } from '../../state/onboarding';
import { useHRRangeSummary } from '../../hooks/useHRRangeSummary';
import { hrFill } from '../../utils/vitalThemes';
import {
  checkStaleness,
  vitalRangeCopyForTier,
} from '../../utils/classification';
import { formatStalenessCaption } from '../../utils/stalenessCaption';
import type { HRSample, SleepSession } from '../../types/vitals';

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Build the trend-chart series for "today". Bins all available HR samples
 * for the last 24h and returns up to 16 evenly spaced rolling-average
 * points. Returns an empty array when there are < 2 samples — the trend
 * chart hides itself in that case.
 */
export function buildTodayTrendData(
  samples: ReadonlyArray<HRSample>,
  nowSec: number,
): number[] {
  if (samples.length < 2) return [];
  const cutoff = nowSec - SECONDS_PER_DAY;
  const todays = samples
    .filter((s) => s.measuredAtSec >= cutoff && s.measuredAtSec <= nowSec)
    .sort((a, b) => a.measuredAtSec - b.measuredAtSec);
  if (todays.length < 2) return [];
  // Bin into ~16 buckets across the 24h window — matches the design's
  // 16-point sample. Each bucket carries the bucket-mean BPM; empty
  // buckets fall back to the previous bucket's value (so the line stays
  // continuous instead of going to zero).
  const BUCKETS = 16;
  const bucketSpan = SECONDS_PER_DAY / BUCKETS;
  const sums = new Array<number>(BUCKETS).fill(0);
  const counts = new Array<number>(BUCKETS).fill(0);
  for (const s of todays) {
    const idx = Math.min(
      BUCKETS - 1,
      Math.max(0, Math.floor((s.measuredAtSec - cutoff) / bucketSpan)),
    );
    sums[idx] += s.bpm;
    counts[idx] += 1;
  }
  const out: number[] = [];
  let last = todays[0].bpm;
  for (let i = 0; i < BUCKETS; i++) {
    if (counts[i] > 0) {
      last = sums[i] / counts[i];
      out.push(Math.round(last));
    } else {
      out.push(Math.round(last));
    }
  }
  return out;
}

/**
 * Compute the four HR zones from a window of samples. Each zone carries
 * the share of samples falling into its BPM band. When the input is
 * empty, returns four zones with pct = 0 (the consumer can hide the card).
 */
export function buildZones(samples: ReadonlyArray<HRSample>): [HRZone, HRZone, HRZone, HRZone] {
  let resting = 0;
  let calm = 0;
  let active = 0;
  let vigorous = 0;
  for (const s of samples) {
    if (s.bpm < 60) resting += 1;
    else if (s.bpm < 80) calm += 1;
    else if (s.bpm < 110) active += 1;
    else vigorous += 1;
  }
  const total = resting + calm + active + vigorous;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return [
    { name: 'Resting', range: '< 60', pct: pct(resting) },
    { name: 'Calm', range: '60–80', pct: pct(calm) },
    { name: 'Active', range: '80–110', pct: pct(active) },
    { name: 'Vigorous', range: '110+', pct: pct(vigorous) },
  ];
}

/**
 * Convert the server summary's zone counts (migration 0030
 * hr_range_summary) into the same HRZone[] shape `buildZones` produces,
 * so HRZonesCard is agnostic to the data source. Bands are identical to
 * buildZones: resting < 60, calm 60–80, active 80–110, vigorous 110+.
 */
export function zonesFromCounts(z: {
  resting: number;
  calm: number;
  active: number;
  vigorous: number;
  total: number;
}): [HRZone, HRZone, HRZone, HRZone] {
  const pct = (n: number) => (z.total === 0 ? 0 : (n / z.total) * 100);
  return [
    { name: 'Resting', range: '< 60', pct: pct(z.resting) },
    { name: 'Calm', range: '60–80', pct: pct(z.calm) },
    { name: 'Active', range: '80–110', pct: pct(z.active) },
    { name: 'Vigorous', range: '110+', pct: pct(z.vigorous) },
  ];
}

/**
 * Compute the headline "stats trio" inputs from the live HR data.
 * Sprint 16.5f — Variability slot was a permanent "—" placeholder
 * (HRV needs RR intervals, not 5-min averages). Replaced with
 * "Range today" — max − min of today's samples. Real, useful,
 * computable from current data.
 *
 * - Resting: range-average of `restingBpmRecent` (rounded; null if empty)
 * - Peak: max bpm in the last 24h (null if no samples)
 * - Range today: today's max − min spread in bpm (null if < 2 samples)
 */
export function buildStats(
  samples: ReadonlyArray<HRSample>,
  restingBpmRecent: ReadonlyArray<number>,
  nowSec: number,
): {
  restingAvg: number | null;
  peakToday: number | null;
  rangeToday: number | null;
} {
  const restingAvg =
    restingBpmRecent.length === 0
      ? null
      : Math.round(
          restingBpmRecent.reduce((a, b) => a + b, 0) / restingBpmRecent.length,
        );
  const cutoff = nowSec - SECONDS_PER_DAY;
  const todays = samples.filter(
    (s) => s.measuredAtSec >= cutoff && s.measuredAtSec <= nowSec,
  );
  const peakToday =
    todays.length === 0
      ? null
      : todays.reduce((a, b) => (b.bpm > a.bpm ? b : a)).bpm;
  let rangeToday: number | null = null;
  if (todays.length >= 2) {
    const minBpm = todays.reduce((a, b) => (b.bpm < a.bpm ? b : a)).bpm;
    const maxBpm = todays.reduce((a, b) => (b.bpm > a.bpm ? b : a)).bpm;
    rangeToday = Math.round(maxBpm - minBpm);
  }
  return { restingAvg, peakToday, rangeToday };
}

/** Dynamic Y-axis range for the today trend chart. Pre-16.5f was
 *  hardcoded [60, 95], which clipped activity peaks (110+) out of
 *  view. Returns a band rounded to the nearest 10 with a floor of 40
 *  and a ceiling of max(95, dataMax + 10). */
export function dynamicHRChartRange(data: ReadonlyArray<number>): [number, number] {
  if (data.length === 0) return [60, 95];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const lo = Math.max(40, Math.floor((min - 5) / 10) * 10);
  const hi = Math.max(95, Math.ceil((max + 5) / 10) * 10);
  return [lo, hi];
}

/**
 * Sprint 18 H3 — Build the sleep × resting-HR correlation series for
 * the chosen range, paired by DATE (nightKey) rather than positional
 * array index. The earlier version did `recentSleep.slice(-n)` and
 * `recentHR.slice(-n)` then matched i-th with i-th — but the two
 * arrays could have different lengths AND different night coverage,
 * so a sparse tracker (gap nights) would see Monday-HR mis-paired
 * with Wednesday-sleep, etc.
 *
 * The function now takes the date-keyed HR shape from
 * `useHR.restingBpmRecentByNight()`, keys both inputs by their night
 * (YYYY-MM-DD of the night the sleep window belongs to), and emits
 * one point per night that has BOTH datasets. Each point's `t` uses
 * the sleep session's end time so CorrelationStrip's tBounds frame
 * the window correctly.
 */
export function buildSleepHRCorrelation(
  hrByNight: ReadonlyArray<{ nightKey: string; restingBpm: number }>,
  sleepSessions: ReadonlyArray<SleepSession>,
  days: number = 7,
  nowSec: number = Math.floor(Date.now() / 1000),
): { hr: VitalSeries; sleep: VitalSeries } | null {
  if (hrByNight.length < 2 || sleepSessions.length < 2) return null;
  const cutoffSec = nowSec - days * SECONDS_PER_DAY;
  const dayKeyFor = (sessionEndSec: number): string => {
    const d = new Date(sessionEndSec * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  // Key the sleep sessions by night (using sessionEndSec's local
  // date — same convention `nightDateKey` uses upstream in the HR
  // slice's restingBpmRecentByNight).
  const sleepByNight = new Map<string, SleepSession>();
  for (const s of sleepSessions) {
    if (s.sessionEndSec < cutoffSec) continue;
    const key = dayKeyFor(s.sessionEndSec);
    const existing = sleepByNight.get(key);
    // If two sessions land on the same night (rare; re-sync dupes), prefer the most recent.
    if (!existing || s.sessionEndSec > existing.sessionEndSec) {
      sleepByNight.set(key, s);
    }
  }
  const hrByNightMap = new Map<string, number>();
  for (const e of hrByNight) {
    hrByNightMap.set(e.nightKey, e.restingBpm);
  }
  // Intersect: only nights that have BOTH sleep + HR. Sorted by date.
  const matchedKeys = Array.from(sleepByNight.keys())
    .filter((k) => hrByNightMap.has(k))
    .sort();
  if (matchedKeys.length < 2) return null;
  const hr: VitalSeries = {
    type: 'hr',
    points: matchedKeys.map((k) => {
      const session = sleepByNight.get(k);
      return {
        t: (session?.sessionEndSec ?? 0) * 1000,
        value: hrByNightMap.get(k) as number,
      };
    }),
  };
  const sleep: VitalSeries = {
    type: 'sleep',
    points: matchedKeys.map((k) => {
      const session = sleepByNight.get(k);
      return {
        t: (session?.sessionEndSec ?? 0) * 1000,
        value: session?.totalMinutes ?? 0,
      };
    }),
  };
  return { hr, sleep };
}

// Sprint 16.5c — recent-readings row helpers.
//
// HR has the highest sample density of any vital (5-min auto cadence →
// ~200 samples in the slice's recent cap). The user asked for the same
// "Recent readings + Show more picker" affordance the other vitals have
// so they can audit when each sample was captured. We pass the full
// sorted list to RecentReadingsSection; its picker handles paging.

function hrRowContext(bpm: number, ageHours: number, isFirst: boolean): string {
  // The 0x15 history packet doesn't carry per-sample motion state, so
  // we lean on the BPM zones for readable copy. Matches the HRZones
  // bands (Resting / Steady / Elevated / Active) without re-inventing
  // colour semantics.
  const zone =
    bpm < 65
      ? 'Resting'
      : bpm < 95
        ? 'Steady'
        : bpm < 125
          ? 'Elevated'
          : 'Active';
  if (isFirst && ageHours < 1.5) return `Latest · ${zone.toLowerCase()}`;
  if (ageHours < 24) return zone;
  if (ageHours < 48) return `${zone} · yesterday`;
  return zone;
}

function hrRowTime(measuredAtSec: number, timeZone: string, nowMs: number): string {
  const ms = measuredAtSec * 1000;
  const ageHours = (nowMs - ms) / 3_600_000;
  if (ageHours < 24) {
    return timeInZone(ms, timeZone);
  }
  if (ageHours < 48) return 'Yesterday';
  return weekdayInZone(ms, timeZone, 'short');
}

function buildHRRecentRows(
  samples: ReadonlyArray<HRSample>,
  timeZone: string,
): RecentReading[] {
  if (samples.length === 0) return [];
  const sorted = samples.slice().sort((a, b) => b.measuredAtSec - a.measuredAtSec);
  const nowMs = Date.now();
  return sorted.map((s, idx) => {
    const ageHours = (nowMs - s.measuredAtSec * 1000) / 3_600_000;
    return {
      id: `hr-${s.measuredAtSec}`,
      value: `${Math.round(s.bpm)}`,
      context: hrRowContext(s.bpm, ageHours, idx === 0),
      time: hrRowTime(s.measuredAtSec, timeZone, nowMs),
    };
  });
}

const INSIGHT_BODY_EMPTY =
  "Wear the watch to start tracking your heart rate. After a few nights of sleep, you'll see how it moves with your rest.";

const INSIGHT_BODY_PRE_BASELINE =
  "After a few nights of sleep, this card will compare your resting heart rate to your usual band and call out anything worth noting.";

/** Sprint 18 H6 — comparative phrasing ("than your usual" / "than
 *  last week") needs more than a couple of nights of data to be
 *  honest. Matches the threshold used by SleepDetail. */
export const HR_HISTORY_REFERENCE_NIGHTS = 7;

/** Deterministic HR insight body — describes the real numbers against
 *  the baseline. No fabricated month-over-month claims. */
function hrInsightBody(
  restingToday: number | null,
  baseline: HRBaseline | null,
  recentNightsCount: number = HR_HISTORY_REFERENCE_NIGHTS,
): string {
  if (restingToday === null || baseline === null) {
    return INSIGHT_BODY_PRE_BASELINE;
  }
  const baselineMid = Math.round((baseline.bpmLow + baseline.bpmHigh) / 2);
  const diff = Math.round(restingToday) - baselineMid;
  const absDiff = Math.abs(diff);
  const hasHistory = recentNightsCount >= HR_HISTORY_REFERENCE_NIGHTS;
  if (absDiff <= 2) {
    return hasHistory
      ? `Your resting heart rate this morning (${Math.round(restingToday)} bpm) is right at your usual. Calm wake.`
      : `Your resting heart rate this morning is ${Math.round(restingToday)} bpm — close to the middle of what we've seen so far. Calm wake.`;
  }
  if (diff < 0) {
    return hasHistory
      ? `Your resting heart rate this morning (${Math.round(restingToday)} bpm) is about ${absDiff} below your usual — a quieter night than last week.`
      : `Your resting heart rate this morning is ${Math.round(restingToday)} bpm — about ${absDiff} below the middle of what we've seen so far. A few more nights of tracking will give us a stable usual to compare against.`;
  }
  return hasHistory
    ? `Your resting heart rate this morning (${Math.round(restingToday)} bpm) is about ${absDiff} above your usual. Worth watching this week.`
    : `Your resting heart rate this morning is ${Math.round(restingToday)} bpm — about ${absDiff} above the middle of what we've seen so far. A few more nights of tracking will tell us if this is a one-off.`;
}

export interface HRDetailProps {
  onBack: () => void;
  onArticleOpen?: (articleId: string) => void;
  onLearnOpen?: () => void;
  /** Sprint 17a — caregiver entry. When set, HR + sleep data sources
   *  swap to the parent-scoped query layer. Unset → unchanged
   *  self-buyer behavior. */
  familyId?: string;
}

export function HRDetail({
  onBack,
  onArticleOpen,
  onLearnOpen,
  familyId,
}: HRDetailProps) {
  // Sprint 17a — both data sources called unconditionally (rules of
  // hooks). Value-level pick below.
  const ownPulse = useDailyPulseData();
  const ownHRPending = useHR((s) => s.pending);
  const ownHRRecent = useHR((s) => s.recent);
  const ownSleepPending = useSleep((s) => s.pending);
  const ownSleepRecent = useSleep((s) => s.recent);
  const scopedFamilyId = familyId ?? null;
  // Family the server summary is scoped to: the tapped parent on the
  // caregiver path, else the signed-in user's own family (self-buyer).
  const ownFamilyId = useOnboarding((s) => s.familyId);
  const summaryFamilyId = scopedFamilyId ?? ownFamilyId;
  const parentPulse = useParentDailyPulseData(scopedFamilyId);
  const parentRecent = useParentVitalsRecent(scopedFamilyId);
  const emptyFallback = useMemo(() => emptyDailyPulse(), []);

  // Sprint 18 H1 — distinguish loading + error from "truly empty" for
  // the caregiver-scoped path. Same pattern SleepDetail uses.
  const isCaregiverScoped = scopedFamilyId !== null;
  const isInitialParentLoad =
    isCaregiverScoped &&
    (parentPulse.isLoading || parentRecent.isLoading) &&
    parentPulse.data === null;
  const parentLoadError = isCaregiverScoped
    ? (parentPulse.error ?? parentRecent.error ?? null)
    : null;

  const data = scopedFamilyId
    ? parentPulse.data ?? emptyFallback
    : ownPulse;
  const restingToday = data.hr.restingToday;
  // Display value for the hero — resting today → recent resting → latest
  // sample. Falls back so the hero stops blanking when only a daytime
  // reading exists, while resting-specific copy below (insight, baseline,
  // "resting this morning" prose) stays on `restingToday` so we never
  // narrate a daytime value as "resting".
  const displayBpm = data.hr.displayBpm;

  // Sprint 16.5e — mirror DetailShell's range so the recent-readings
  // list, the sleep × resting-HR correlation, and the zone-card
  // distribution react to 7d / 30d / 90d. The today trend chart stays
  // 24h-bound (it's literally "today").
  const [range, setRange] = useState<TrendRange>('7d');

  // Server-aggregated HR over the selected window (migration 0030 RPC).
  // Sidesteps the local HR slice's 200-sample (~16h) cap so 7d/30d/90d
  // render real data. Null while loading / offline / on error → the
  // local-slice computations below remain the fallback.
  const rangeSummary = useHRRangeSummary(summaryFamilyId, range);
  const serverSummary = rangeSummary.data;

  const hrPending = scopedFamilyId ? [] : ownHRPending;
  const hrRecent = scopedFamilyId ? parentRecent.data.hr : ownHRRecent;
  const sleepPending = scopedFamilyId ? [] : ownSleepPending;
  const sleepRecent = scopedFamilyId
    ? parentRecent.data.sleep
    : ownSleepRecent;

  const allSamples = useMemo(
    () => [...hrPending, ...hrRecent],
    [hrPending, hrRecent],
  );

  // Sprint 18 P-H3 — capture nowSec ONCE per mount so the useMemos
  // below actually memoize. Previously this was re-derived on every
  // render and listed as a dep, defeating each useMemo. The
  // tradeoff: if the screen sits open across the 24h boundary the
  // chart's "today" anchor doesn't drift — acceptable, and the user
  // can pull-to-refresh or re-enter the screen to re-anchor.
  const nowSec = useMemo(() => Math.floor(Date.now() / 1000), []);

  // Same user timezone the hero uses (via dailyPulse) so the recent
  // resting series here is bucketed consistently. Null → UTC.
  const timeZone = useAuth((s) => s.profile?.timezone ?? null);
  // Timezone the row times render in: the wearer's on the caregiver path
  // (the rows are the wearer's readings), else the viewer's own. UTC last.
  const displayTimeZone = resolveTimeZone(
    scopedFamilyId ? parentPulse.wearerTimeZone ?? timeZone : timeZone,
  );

  const rangedSamples = useMemo(() => {
    const cutoff = nowSec - RANGE_TO_DAYS[range] * SECONDS_PER_DAY;
    return allSamples.filter((s) => s.measuredAtSec >= cutoff);
  }, [allSamples, range, nowSec]);
  const allSleepSessions = useMemo(
    () => [...sleepPending, ...sleepRecent],
    [sleepPending, sleepRecent],
  );

  // Trend chart data. When the server window is available, plot a
  // daily-average line over the selected range (per_day from the
  // hr_range_summary RPC, ascending by day). Otherwise fall back to
  // today's intraday 24h curve (offline / loading / <2 days of data).
  const trend24hData = useMemo(
    () => buildTodayTrendData(allSamples, nowSec),
    [allSamples, nowSec],
  );
  const dailyAvgData = useMemo(
    () => (serverSummary ? serverSummary.per_day.map((d) => d.avg) : []),
    [serverSummary],
  );
  const isRangeTrend = dailyAvgData.length >= 2;
  const trendData = isRangeTrend ? dailyAvgData : trend24hData;
  const trendCaption = isRangeTrend
    ? `Last ${RANGE_TO_DAYS[range]} days · heart rate`
    : 'Last 24h · heart rate';
  const trendChartRange = useMemo(
    () => dynamicHRChartRange(trendData),
    [trendData],
  );
  // Zones over the selected window: server counts when available (full
  // window), else the local-slice computation (today / offline fallback).
  const zones = useMemo(
    () =>
      serverSummary
        ? zonesFromCounts(serverSummary.zones)
        : buildZones(rangedSamples),
    [serverSummary, rangedSamples],
  );

  // Sprint 18 H3 — switch to the date-keyed accessor so the
  // correlation downstream can pair by night.
  // Per-night resting bpm — feeds the resting-avg stat, the baseline,
  // and the sleep×HR correlation. Server summary gives the full window
  // (10-min rolling-min within 22:00–06:00 local, matching the local
  // computation); the local slice is the today/offline fallback.
  const restingByNightLocal = useMemo(
    () => useHR.getState().restingBpmRecentByNight(nowSec, timeZone),
    [nowSec, hrRecent, hrPending, timeZone],
  );
  const restingByNightServer = useMemo(
    () =>
      serverSummary
        ? serverSummary.resting_by_night.map((e) => ({
            nightKey: e.night,
            restingBpm: e.resting,
          }))
        : null,
    [serverSummary],
  );
  const restingByNight = restingByNightServer ?? restingByNightLocal;

  const { restingAvg, peakToday, rangeToday } = useMemo(
    () =>
      buildStats(
        allSamples,
        restingByNight.map((e) => e.restingBpm),
        nowSec,
      ),
    [allSamples, nowSec, restingByNight],
  );

  // ----- Baseline reference (16.5f) -----------------------------------
  const baseline: HRBaseline | null = useMemo(
    () => hrBaseline(restingByNight.map((e) => e.restingBpm)),
    [restingByNight],
  );
  const baselineBody = baseline ? formatHRBaseline(baseline) : '';

  const correlation = useMemo(
    () =>
      buildSleepHRCorrelation(
        restingByNight,
        allSleepSessions,
        RANGE_TO_DAYS[range],
        nowSec,
      ),
    [restingByNight, allSleepSessions, range, nowSec],
  );

  // NOTE: the recent-readings list still reads the local slice (capped at
  // ~200 / ~16h). The range-driven *analytics* (zones, resting, baseline,
  // correlation) are now server-windowed above; paging the raw HR list
  // server-side is a deliberate follow-up (a list of thousands of 5-min
  // samples needs its own pagination design, not a bigger fetch).
  const recentRows = useMemo(
    () => buildHRRecentRows(rangedSamples, displayTimeZone),
    [rangedSamples, displayTimeZone],
  );

  // Hero value — live-first (founder direction): the watch auto-samples
  // HR every 5 min, so the headline shows the most recent sample (the
  // closest thing to "now") and only falls back to the resting display
  // value when there's no sample at all. Resting still leads the
  // insight/baseline prose and the "Resting avg" stat below, so we never
  // lose the resting view — it just isn't the hero number anymore.
  const liveSample = useMemo(
    () =>
      allSamples.length === 0
        ? null
        : allSamples.reduce((a, b) =>
            b.measuredAtSec > a.measuredAtSec ? b : a,
          ),
    [allSamples],
  );
  const liveBpm = liveSample?.bpm ?? null;
  const heroBpm = liveBpm ?? displayBpm;
  // "Live" framing whenever the hero value is a recent sample rather than a
  // resting value — either one found in the slice, or dailyPulse's display
  // falling back to its latest (non-resting) sample. Only when the value is
  // genuinely resting do we keep the calm resting wording.
  const isLive = liveBpm !== null || data.hr.displaySource === 'latest';
  const heroSampleSec = liveSample?.measuredAtSec ?? data.hr.latestSampleSec;

  // Resting-specific copy (insight card, baseline) stays gated on a
  // true resting value.
  const hasData = restingToday !== null;
  const hasHero = heroBpm !== null;
  const hasZoneData = zones.some((z) => z.pct > 0);

  // Sprint 16 — per D13 §6.6, surface a stale caption when the displayed
  // HR sample is older than 6h.
  const staleness = hasHero
    ? checkStaleness('hr', heroSampleSec, nowSec)
    : 'no_data';
  const staleCaption =
    staleness === 'stale'
      ? formatStalenessCaption(heroSampleSec, nowSec)
      : null;

  // Live reading leads with neutral "Latest" wording (the sample may be a
  // few minutes old); the resting fallback keeps the calm resting framing.
  const heroPrimary = hasHero ? String(Math.round(heroBpm!)) : '—';
  const heroSub =
    staleCaption ??
    (hasHero ? (isLive ? 'Latest reading' : 'Now · resting') : 'Heart rate');
  // Sprint 19 (audit D12 P0-4) — this used to gate on `baseline !== null`
  // and render "bpm · within your range" for EVERY classified tier,
  // contradicting the anomaly banner above it. The verdict now comes
  // from the classification, via the same helper BPDetail uses.
  const hrTier = data.hr.classification?.tier ?? null;
  const heroRange = hasHero
    ? isLive
      ? 'bpm · latest'
      : hrTier !== null
        ? vitalRangeCopyForTier('bpm', hrTier)
        : 'bpm · resting'
    : 'Wear the watch to start tracking your heart rate.';

  return (
    <DetailShell
      vital="hr"
      onBack={onBack}
      onRangeChange={setRange}
      hero={
        <VitalHero
          vital="hr"
          primary={heroPrimary}
          sub={heroSub}
          range={heroRange}
          ringFill={hrFill(heroBpm)}
          livePulse={false}
          testID="hr-detail-hero"
        />
      }
      testID="hr-detail"
    >
      {/* Sprint 18 H1 — caregiver-scoped loading + error swap-in.
          During the initial parent fetch we render a calm spinner
          instead of telling the caregiver their parent has no HR
          data; on fetch errors we surface a recoverable banner
          instead of silently falling through to the empty-state UI. */}
      {isInitialParentLoad ? (
        <LoadingState testID="hr-detail-loading" />
      ) : parentLoadError ? (
        <ErrorState
          onRetry={() => {
            void parentPulse.refresh();
            void parentRecent.refresh();
          }}
          testID="hr-detail-error"
        />
      ) : (
        <Fragment>
          {baselineBody ? (
            <BaselineReference
              body={baselineBody}
              eyebrow="Your usual resting"
              caption={`over the last ${baseline?.sampleCount ?? 14} nights`}
              testID="hr-detail-baseline"
            />
          ) : null}
          <StalenessHintRow stale={staleness === 'stale'} testID="hr-detail-staleness-hint" />
          {/* Stat trio is range-consistent with the rest of the screen:
              when the server window is loaded it shows Resting avg / Peak /
              Low over the selected 7d/30d/90d (the hero already carries the
              live "now" value). Offline/loading falls back to the today
              snapshot (Peak today / Range today) so nothing blanks. */}
          <StatTrio
            items={[
              {
                label: 'Resting avg',
                value: restingAvg !== null ? String(restingAvg) : '—',
                unit: 'bpm',
              },
              serverSummary
                ? {
                    label: 'Peak',
                    value:
                      serverSummary.totals.max_bpm !== null
                        ? String(serverSummary.totals.max_bpm)
                        : '—',
                    unit: 'bpm',
                  }
                : {
                    label: 'Peak',
                    value: peakToday !== null ? String(peakToday) : '—',
                    unit: peakToday !== null ? 'today' : 'bpm',
                  },
              serverSummary
                ? {
                    label: 'Low',
                    value:
                      serverSummary.totals.min_bpm !== null
                        ? String(serverSummary.totals.min_bpm)
                        : '—',
                    unit: 'bpm',
                  }
                : {
                    label: 'Range today',
                    value: rangeToday !== null ? String(rangeToday) : '—',
                    unit: 'bpm',
                  },
            ]}
            testID="hr-detail-stats"
          />

          {trendData.length > 0 ? (
            <VitalTrendChart
              vital="hr"
              data={trendData}
              range={trendChartRange}
              // Range-driven: a daily-average line over the selected
              // window when the server summary is available, else
              // today's intraday 24h curve (offline/loading fallback).
              // Caption tracks which one is showing.
              caption={trendCaption}
              subCaption={`${trendChartRange[0]}–${trendChartRange[1]} band`}
              peak
              trough
              testID="hr-detail-trend"
              style={{ marginHorizontal: 20 }}
            />
          ) : null}

          {hasZoneData ? (
            <HRZonesCard
              zones={zones}
              label={`Time in zones · last ${RANGE_TO_DAYS[range]} days`}
              testID="hr-detail-zones"
            />
          ) : null}

          {correlation ? (
            <CorrelationStrip
              vitalA={correlation.sleep}
              vitalB={correlation.hr}
              range={range}
              caption={`Sleep × resting HR — last ${RANGE_TO_DAYS[range]} days`}
              tBounds={(() => {
                const nowMs = nowSec * 1000;
                const days = RANGE_TO_DAYS[range];
                return { tMin: nowMs - days * 24 * 60 * 60 * 1000, tMax: nowMs };
              })()}
              axisLabels={(() => {
                const nowMs = nowSec * 1000;
                const days = RANGE_TO_DAYS[range];
                const startMs = nowMs - days * 24 * 60 * 60 * 1000;
                const left = new Date(startMs).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                });
                return { left, right: 'today' };
              })()}
              testID="hr-detail-correlation"
              style={{ marginHorizontal: 20 }}
            />
          ) : null}

          {recentRows.length > 0 ? (
            <RecentReadingsSection
              vital="hr"
              eyebrow="Recent readings"
              readings={recentRows}
              testID="hr-detail-recent"
            />
          ) : null}

          {/* Sprint 18 H6 — insight body knows how many resting-night
              entries the user has, and gates the "than your usual" /
              "than last week" copy on HR_HISTORY_REFERENCE_NIGHTS (7).
              Below that, switches to non-comparative phrasing so the
              first-week user isn't told they're "above their usual"
              when they have no usual yet. */}
          <VitalInsightCard
            vital="hr"
            body={
              hasData
                ? hrInsightBody(restingToday, baseline, restingByNight.length)
                : INSIGHT_BODY_EMPTY
            }
            testID="hr-detail-insight"
          />

          <VitalExplainerAnchor
            context={{ type: 'hr', restingHr: restingToday ?? null }}
            onArticleOpen={onArticleOpen}
            onLearnOpen={onLearnOpen}
            testID="hr-detail-explainer-anchor"
          />
        </Fragment>
      )}
    </DetailShell>
  );
}
