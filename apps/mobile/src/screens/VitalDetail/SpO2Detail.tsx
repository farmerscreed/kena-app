// SpO2Detail — Sprint 8.5 (vital-detail screens, D13 §8.4).
//
// Per-vital detail surface for blood oxygen. Composes the Sprint 8.5
// foundation primitives (DetailShell, VitalHero, StatTrio, VitalTrendChart,
// VitalInsightCard, RecentReadingsList) into the SpO2 layout from the
// design's leiko-detail-screens.jsx (lines 190–242).
//
// Voice rules (docs/05-voice-and-claims.md) — SpO2 is the closest
// surface to a clinical signal in the entire app, so the bar is higher:
//   - Frame any low value as "worth mentioning at your next visit" or
//     "share with your doctor" — never "dangerous", "critical",
//     "abnormal", or "low oxygen" alone.
//   - "Wellness oxygen estimate", never "medical-grade SpO2" or
//     "clinical SpO2".
//   - For overnight dips, lean on "Healthy sleep often shows small,
//     transient dips like this" framing.
//   - Forbidden everywhere: patient, diagnose, predict, dangerous,
//     critical, silent killer, medical-grade, clinical SpO2, loved one,
//     you may have, we detected, abnormal.
//
// Tier-aware copy:
//   - in_pattern        → "Steady through the night" + reassuring insight.
//   - calm_concerned    → "Worth a look — share with your doctor at your
//                          next visit." + insight that names the dip
//                          calmly and points to the next visit.
//   - confirmed_urgent  → "We recommend talking to your doctor soon."
//                          + insight phrased per the spec ("held below 90
//                          on a few recent nights — worth mentioning at
//                          your next doctor visit"). Still calm, never
//                          panicky; matches Tone D from D5 §3.5.
//   - null              → empty welcome state (no chart, no readings).
//
// Sprint 8.5 ships a placeholder data path: the chart prefers real
// overnight samples from `useSpO2().recent` when available; otherwise it
// falls back to the design's mock array so the surface still reads
// completely. Sprint 12.5 wires the real generator.

import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DetailShell } from '../../components/DetailShell';
import { VitalHero } from '../../components/VitalHero';
import { StatTrio } from '../../components/StatTrio';
import { VitalTrendChart } from '../../components/VitalTrendChart';
import { VitalInsightCard } from '../../components/VitalInsightCard';
import { VitalExplainerAnchor } from '../../components/VitalExplainerAnchor';
import { type RecentReading } from '../../components/RecentReadingsList';
import { RecentReadingsSection } from '../../components/RecentReadingsSection';
import { CorrelationStrip, type VitalSeries } from '../../components/CorrelationStrip';
import { BaselineReference } from '../../components/BaselineReference';
import { StalenessHintRow } from '../../components/StalenessHintRow';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import type { TrendRange } from '../../components/TimeRangePills';
import { useSleep } from '../../state/sleep';
import {
  spo2Baseline,
  formatSpO2Baseline,
  type SpO2Baseline,
} from '../../utils/vitalBaselines';

const RANGE_TO_DAYS: Record<TrendRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const SECONDS_PER_DAY = 24 * 60 * 60;
import { useDailyPulseData, emptyDailyPulse } from '../../state/dailyPulse';
import { useSpO2 } from '../../state/spo2';
import { useParentDailyPulseData } from '../../hooks/useParentDailyPulseData';
import { useParentVitalsRecent } from '../../hooks/useParentVitalsRecent';
import { useAuth } from '../../state/auth';
import { useOnboarding } from '../../state/onboarding';
import { ViewAllHistoryLink } from '../../components/ViewAllHistoryLink';
import {
  resolveTimeZone,
  timeInZone,
  weekdayInZone,
  hourInZone,
  dayKeyInZone,
} from '../../utils/timeInZone';
import { spo2Fill } from '../../utils/vitalThemes';
import { checkStaleness } from '../../utils/classification';
import { formatStalenessCaption } from '../../utils/stalenessCaption';
import { useTheme } from '../../theme';
import type { ClassificationTier } from '../../utils/classification';
import type { SpO2Sample } from '../../types/vitals';
import { MAX_FONT_SCALE } from '../../theme/fontScaling';

export interface SpO2DetailProps {
  onBack: () => void;
  onArticleOpen?: (articleId: string) => void;
  onLearnOpen?: () => void;
  /** Sprint 17a — caregiver entry. When set, SpO2 + sleep data
   *  sources swap to the parent-scoped query layer. */
  /** ADR-0008 follow-up — opens the full-window VitalHistory browse for
   *  the selected range. Router curries the vital kind. */
  onViewAllHistory?: (
    range: TrendRange,
    familyId: string,
    timeZone: string,
  ) => void;
  familyId?: string;
}

// Sprint 16.5f — design fallback removed. The chart now shows real
// data only; when there are < 3 overnight samples, the chart hides
// and the screen renders an empty-state message instead. Previously
// the FALLBACK_OVERNIGHT_SAMPLES array drew a fake trace for new
// users on their first night.
const OVERNIGHT_DISPLAY_POINTS = 11;
const OVERNIGHT_WINDOW_START_HOUR = 22;
const OVERNIGHT_WINDOW_END_HOUR = 6;

interface RangeCopy {
  /** Hero `range` line under the value. */
  hero: string;
  /** Voice-clean Insight body for this tier. */
  insight: string;
}

/**
 * Observed overnight facts used to build the Insight body. Every field is
 * derived from the user's own samples — never assumed.
 */
interface OvernightFacts {
  /** Lowest overnight percent in the selected range, or null when none. */
  lowestPercent: number | null;
  /**
   * Clock label for `lowestPercent` (e.g. "4 am"), or the literal
   * 'overnight' when the lowest value came from the pre-baked slice and
   * we have no time for it.
   */
  lowestTime: string;
}

/**
 * Renders the observed low as a clause, or an empty string when we have
 * no low to report. Never invents a value or a time.
 *
 * Sprint 19 (audit D12 P0-1) — the previous implementation hardcoded
 * "one brief dip around 4 am" into the in_pattern branch and fixed
 * thresholds ("below 92%", "below 90") into the concerned branches.
 * Those strings rendered for every user regardless of their data,
 * asserting a physiological event that may not have happened. All
 * specifics now come from `OvernightFacts` or are omitted entirely.
 */
function lowestClause(facts: OvernightFacts): string {
  if (facts.lowestPercent === null) return '';
  const when =
    facts.lowestTime === 'overnight' ? 'overnight' : `around ${facts.lowestTime}`;
  return `${facts.lowestPercent}% ${when}`;
}

/**
 * Tier → copy. Every string here passes the docs/05-voice-and-claims.md
 * rules. The confirmed-urgent line still uses the calm Direct tone (D5
 * §3.5 Tone D) — it does not say "dangerous" or "critical".
 *
 * Specifics (percentages, times) are interpolated from `facts` only when
 * we actually observed them. With no observation the copy stays true but
 * general — it never fills the gap with an example.
 */
function copyForTier(
  tier: ClassificationTier | null | undefined,
  facts: OvernightFacts,
): RangeCopy {
  const low = lowestClause(facts);
  switch (tier) {
    case 'in_pattern':
      return {
        hero: 'Steady through the night',
        insight: low
          ? `Your oxygen held in your usual range through the night, with a low of ${low}. Small, brief dips like this are common in healthy sleep.`
          : 'Your oxygen held in your usual range through the night. Small, brief dips are common in healthy sleep.',
      };
    case 'calm_concerned':
      return {
        hero: 'Worth a look — share with your doctor at your next visit',
        insight: low
          ? `Your overnight oxygen has been running below your usual, with a low of ${low}. Worth mentioning at your next doctor visit.`
          : 'Your overnight oxygen has been running below your usual on recent nights. Worth mentioning at your next doctor visit.',
      };
    case 'confirmed_urgent':
      return {
        hero: 'We recommend talking to your doctor soon',
        insight: low
          ? `Your overnight oxygen has been running well below your usual, with a low of ${low}. Worth talking to your doctor soon.`
          : 'Your overnight oxygen has been running well below your usual on recent nights. Worth talking to your doctor soon.',
      };
    default:
      return {
        hero: 'No oxygen samples yet today',
        insight:
          'Wear the watch overnight to start tracking your oxygen. We will surface an estimate of your overnight pattern after the first night.',
      };
  }
}

/**
 * Pulls the latest overnight-window samples (22:00–06:00 UTC, matching
 * the spo2 slice's window) and returns the most recent N percent values
 * in chronological order.
 *
 * Sprint 16.5f — empty array when < 3 real overnight points (was: a
 * mock fallback that drew a fake trace for new users). Caller hides
 * the chart on empty.
 *
 * Pure helper — exported for potential reuse / tests.
 */
export function buildOvernightSeries(
  pendingAndRecent: readonly SpO2Sample[],
  points: number = OVERNIGHT_DISPLAY_POINTS,
): number[] {
  const overnight = pendingAndRecent
    .filter((s) => {
      const hr = new Date(s.measuredAtSec * 1000).getUTCHours();
      return (
        hr >= OVERNIGHT_WINDOW_START_HOUR || hr < OVERNIGHT_WINDOW_END_HOUR
      );
    })
    .slice()
    .sort((a, b) => a.measuredAtSec - b.measuredAtSec);

  if (overnight.length < 3) return [];
  return overnight.slice(-points).map((s) => s.percent);
}

/** Compute the awake-window average from samples that fall OUTSIDE
 *  the overnight window. Sprint 16.5f — replaces the lie where
 *  "Awake avg" was actually just the latest single sample.
 *  Returns null when there are no awake samples in the window. */
export function computeAwakeAverage(
  samples: ReadonlyArray<SpO2Sample>,
): number | null {
  const awake = samples.filter((s) => {
    const hr = new Date(s.measuredAtSec * 1000).getUTCHours();
    return !(
      hr >= OVERNIGHT_WINDOW_START_HOUR || hr < OVERNIGHT_WINDOW_END_HOUR
    );
  });
  if (awake.length === 0) return null;
  const sum = awake.reduce((a, b) => a + b.percent, 0);
  return Math.round(sum / awake.length);
}

/** Sprint 18 SP3 — single source of truth for the "Lowest" stat. Picks
 *  the overnight sample with the minimum percent across the chosen
 *  range and returns BOTH its percent and a formatted time-of-day so
 *  the StatTrio value and unit always describe the same sample. The
 *  prior code derived `lowest` from `data.spo2.overnightLowsRecent`
 *  (per-night minimums) but read `lowestUnit` from
 *  `lowestOvernightTime(rangedSamples)` — different sources, possible
 *  mismatch when last night's low fell on a different sample than the
 *  range minimum. */
export function findLowestOvernightSample(
  samples: ReadonlyArray<SpO2Sample>,
  timeZone: string,
): { percent: number; time: string } | null {
  const overnight = samples.filter((s) => {
    const hr = hourInZone(s.measuredAtSec * 1000, timeZone);
    return hr >= OVERNIGHT_WINDOW_START_HOUR || hr < OVERNIGHT_WINDOW_END_HOUR;
  });
  if (overnight.length === 0) return null;
  const lowestSample = overnight.reduce((a, b) =>
    b.percent < a.percent ? b : a,
  );
  return {
    percent: lowestSample.percent,
    time: `briefly · ${timeInZone(lowestSample.measuredAtSec * 1000, timeZone)}`,
  };
}

/** Back-compat shim — kept for any external callers. New code in
 *  SpO2Detail uses `findLowestOvernightSample` for both fields. */
export function lowestOvernightTime(
  samples: ReadonlyArray<SpO2Sample>,
  timeZone: string,
): string {
  return findLowestOvernightSample(samples, timeZone)?.time ?? 'overnight';
}

/** Dynamic Y-axis range. Pre-16.5f was fixed [95, 100] which hid
 *  abnormal values entirely. Now adapts so a user with overnight lows
 *  of 88-92 still sees them. */
export function dynamicSpO2Range(data: ReadonlyArray<number>): [number, number] {
  if (data.length === 0) return [95, 100];
  const min = Math.min(...data);
  return [Math.max(80, Math.min(95, min - 3)), 100];
}

/**
 * Build the chronological list of recent SpO2 readings, newest-first.
 *
 * Sprint 16.5f — dropped the "Overnight low" pseudo-row. The StatTrio
 * already surfaces overnight avg / lowest / awake avg; the pseudo-row
 * was a duplicate that appeared every time, including when the
 * "newest" sample WAS the overnight low (double-counted). Now the
 * list is purely chronological samples, age-aware on the first row.
 */
function buildRecentList(
  pendingAndRecent: readonly SpO2Sample[],
  timeZone: string,
): RecentReading[] {
  if (pendingAndRecent.length === 0) return [];
  const sortedByRecency = pendingAndRecent
    .slice()
    .sort((a, b) => b.measuredAtSec - a.measuredAtSec);

  const rows: RecentReading[] = [];
  const nowMs = Date.now();
  // "Today" is the wearer's local calendar day, not UTC midnight (the old
  // nowSec % 86400 boundary was wrong for any non-UTC tz near midnight).
  const todayKey = dayKeyInZone(nowMs, timeZone);

  sortedByRecency.forEach((s, idx) => {
    const ms = s.measuredAtSec * 1000;
    const ageHours = (nowMs - ms) / 3_600_000;
    const isOvernight = (() => {
      const hr = hourInZone(ms, timeZone);
      return hr >= OVERNIGHT_WINDOW_START_HOUR || hr < OVERNIGHT_WINDOW_END_HOUR;
    })();
    let context: string;
    if (idx === 0) {
      // Age-aware label on the newest row.
      context =
        ageHours < 1.5
          ? 'Just now'
          : ageHours < 24
            ? 'Latest today'
            : ageHours < 48
              ? 'Latest · yesterday'
              : `Latest · ${formatDayShort(s.measuredAtSec, timeZone)}`;
    } else {
      context = isOvernight ? 'Overnight reading' : 'Daytime reading';
    }
    const isToday = dayKeyInZone(ms, timeZone) === todayKey;
    rows.push({
      id: `spo2-${s.measuredAtSec}`,
      value: `${s.percent}%`,
      context,
      time: isToday
        ? formatTimeShort(s.measuredAtSec, timeZone)
        : formatDayShort(s.measuredAtSec, timeZone),
    });
  });
  return rows;
}

/** "6:42 am" / "10:08 pm" in the wearer's tz. */
function formatTimeShort(sec: number, timeZone: string): string {
  return timeInZone(sec * 1000, timeZone).toLowerCase();
}

/** "Mon" / "Sun" — short weekday for older samples, in the wearer's tz. */
function formatDayShort(sec: number, timeZone: string): string {
  return weekdayInZone(sec * 1000, timeZone, 'short');
}

export function SpO2Detail({
  onBack,
  onArticleOpen,
  onLearnOpen,
  onViewAllHistory,
  familyId,
}: SpO2DetailProps) {
  // Sprint 17a — both data sources called unconditionally.
  const ownPulse = useDailyPulseData();
  const ownSpO2Pending = useSpO2((s) => s.pending);
  const ownSpO2Recent = useSpO2((s) => s.recent);
  const scopedFamilyId = familyId ?? null;
  const parentPulse = useParentDailyPulseData(scopedFamilyId);
  const parentRecent = useParentVitalsRecent(scopedFamilyId);
  const emptyFallback = useMemo(() => emptyDailyPulse(), []);

  // Timezone the sample times / overnight window render in: the wearer's on
  // the caregiver path (the readings are the wearer's), else the viewer's
  // own. UTC last.
  const ownTimeZone = useAuth((s) => s.profile?.timezone ?? null);
  const displayTimeZone = resolveTimeZone(
    scopedFamilyId ? parentPulse.wearerTimeZone ?? ownTimeZone : ownTimeZone,
  );
  // Family the full-window history is scoped to (ADR-0008 follow-up).
  const ownFamilyId = useOnboarding((s) => s.familyId);
  const historyFamilyId = scopedFamilyId ?? ownFamilyId;

  // Sprint 18 SP1 — distinguish loading + error from "truly empty" on
  // the caregiver-scoped path (matches Sleep S1+S3 / HR H1 / BP B1).
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
  const spo2Pending = scopedFamilyId ? [] : ownSpO2Pending;
  const spo2Recent = scopedFamilyId
    ? parentRecent.data.spo2
    : ownSpO2Recent;

  // Sprint 16.5e — mirror DetailShell's range. SpO2 doesn't have a
  // dense per-day chart but the recent-readings list (now densely
  // populated by 16.5e server hydration) benefits from the filter.
  // Named `trendRange` to avoid colliding with the local `range` var
  // (which carries tier-keyed hero / insight copy) below.
  const [trendRange, setTrendRange] = useState<TrendRange>('7d');

  const latestPercent = data.spo2.latestPercent;
  const tier = data.spo2.classification?.tier ?? null;
  const isEmpty = latestPercent === null;
  // Sprint 16 — per D13 §6.6, stale when latest SpO2 is older than 8h.
  const spo2Staleness = isEmpty
    ? 'no_data'
    : checkStaleness('spo2', data.spo2.latestSampleSec);
  const spo2StaleCaption =
    spo2Staleness === 'stale'
      ? formatStalenessCaption(data.spo2.latestSampleSec)
      : null;

  const allSamples = useMemo(
    () => [...spo2Pending, ...spo2Recent],
    [spo2Pending, spo2Recent],
  );

  const rangedSamples = useMemo(() => {
    const cutoff = Math.floor(Date.now() / 1000) - RANGE_TO_DAYS[trendRange] * SECONDS_PER_DAY;
    return allSamples.filter((s) => s.measuredAtSec >= cutoff);
  }, [allSamples, trendRange]);

  // Overnight chart series — real data only. Sprint 16.5f dropped the
  // mock fallback; the chart hides when empty.
  const overnightSeries = useMemo(
    () => buildOvernightSeries(rangedSamples),
    [rangedSamples],
  );
  const chartHasData = overnightSeries.length >= 3;
  const chartRange = useMemo(
    () => dynamicSpO2Range(overnightSeries),
    [overnightSeries],
  );

  // Stat-trio values — derived from real data within the chosen range.
  const overnightLows = data.spo2.overnightLowsRecent;
  const overnightAvg = useMemo(() => {
    if (overnightSeries.length === 0) return null;
    const sum = overnightSeries.reduce((a, b) => a + b, 0);
    return Math.round(sum / overnightSeries.length);
  }, [overnightSeries]);
  // Sprint 18 SP3 — single source of truth: find the overnight sample
  // with the minimum percent in the chosen range and use its percent
  // AND time. Previously `lowest` came from
  // `overnightLowsRecent[last]` (last-night-only) while `lowestUnit`
  // came from `lowestOvernightTime(rangedSamples)` (range-wide). A
  // user could see "Lowest 94% briefly · 4 am" where the 94% was
  // from last night but 4 am was from a different night's lower
  // sample — incoherent. Now both fields come from one sample.
  // When the range has no overnight samples (e.g. the user has only
  // daytime data so far) we fall back to the slice's pre-baked
  // overnightLowsRecent so users with historical nights still see
  // their existing data — keyed to "overnight" instead of a time.
  const lowestSampleInRange = useMemo(
    () => findLowestOvernightSample(rangedSamples, displayTimeZone),
    [rangedSamples, displayTimeZone],
  );
  const overnightLowsRangeMin =
    overnightLows.length > 0 ? Math.min(...overnightLows) : null;
  const lowest =
    lowestSampleInRange?.percent ?? overnightLowsRangeMin ?? null;
  const lowestUnit = lowestSampleInRange?.time ?? 'overnight';
  // Sprint 19 (audit D12 P0-1) — tier copy is built AFTER `lowest` /
  // `lowestUnit` so the Insight body can quote the user's own observed
  // low instead of a hardcoded example. Keep this ordering.
  const range = copyForTier(tier, {
    lowestPercent: lowest,
    lowestTime: lowestUnit,
  });
  const awakeAvg = useMemo(
    () => computeAwakeAverage(rangedSamples),
    [rangedSamples],
  );

  const recentRows = useMemo(
    () => buildRecentList(rangedSamples, displayTimeZone),
    [rangedSamples, displayTimeZone],
  );

  // ----- Baseline reference (16.5f) ------------------------------------
  const baseline: SpO2Baseline | null = useMemo(
    () => spo2Baseline(overnightLows),
    [overnightLows],
  );
  const baselineBody = baseline ? formatSpO2Baseline(baseline) : '';

  // ----- SpO2 × Sleep correlation (16.5f) -----------------------------
  const ownSleepRecent = useSleep((s) => s.recent);
  const ownSleepPending = useSleep((s) => s.pending);
  const sleepRecent = scopedFamilyId
    ? parentRecent.data.sleep
    : ownSleepRecent;
  const sleepPending = scopedFamilyId ? [] : ownSleepPending;
  // Sprint 18 SP2 — pair the correlation by NIGHT (nightKey) instead
  // of positional array index. The previous version's
  // `overnightLows.slice(-n)` paired by position; a sparse tracker
  // whose sleep nights and SpO2 overnight-low nights didn't align
  // would see misleading dot pairings. The slice now exposes
  // overnightLowsRecentByNight which carries the nightKey alongside
  // the low; we key the sleep sessions by the same nightKey
  // (anchored to "owning morning" UTC date) and intersect.
  //
  // Match the slice's `nightDateKey` exactly: a sample whose UTC
  // hour ≥ 22 belongs to "tomorrow's" morning, otherwise to today.
  const lowsByNight = useMemo(
    () => useSpO2.getState().overnightLowsRecentByNight(),
    // Recompute when the underlying recent/pending arrays change.
    [spo2Recent, spo2Pending],
  );
  const correlation = useMemo<{ spo2: VitalSeries; sleep: VitalSeries } | null>(() => {
    const allSleep = [...sleepPending, ...sleepRecent];
    if (allSleep.length < 2 || lowsByNight.length < 2) return null;
    const days = RANGE_TO_DAYS[trendRange];
    const cutoffSec = Math.floor(Date.now() / 1000) - days * SECONDS_PER_DAY;
    const sleepInRange = allSleep.filter((s) => s.sessionEndSec >= cutoffSec);
    if (sleepInRange.length < 2) return null;
    // Anchor each sleep session to a nightKey using the same rule the
    // SpO2 slice's `nightDateKey` uses (UTC-based, with the 22:00+
    // shift into "owning morning").
    const dayKeyFor = (sessionEndSec: number): string => {
      const d = new Date(sessionEndSec * 1000);
      const hr = d.getUTCHours();
      const anchored =
        hr >= OVERNIGHT_WINDOW_START_HOUR
          ? new Date(d.getTime() + SECONDS_PER_DAY * 1000)
          : d;
      return anchored.toISOString().slice(0, 10);
    };
    const sleepByNight = new Map<string, typeof sleepInRange[number]>();
    for (const s of sleepInRange) {
      const key = dayKeyFor(s.sessionEndSec);
      const existing = sleepByNight.get(key);
      if (!existing || s.sessionEndSec > existing.sessionEndSec) {
        sleepByNight.set(key, s);
      }
    }
    const lowsMap = new Map<string, number>();
    for (const e of lowsByNight) lowsMap.set(e.nightKey, e.low);
    const matchedKeys = Array.from(sleepByNight.keys())
      .filter((k) => lowsMap.has(k))
      .sort();
    if (matchedKeys.length < 2) return null;
    const spo2Points: { t: number; value: number }[] = matchedKeys.map((k) => {
      const session = sleepByNight.get(k);
      return {
        t: (session?.sessionEndSec ?? 0) * 1000,
        value: lowsMap.get(k) as number,
      };
    });
    const sleepPoints: { t: number; value: number }[] = matchedKeys.map((k) => {
      const session = sleepByNight.get(k);
      return {
        t: (session?.sessionEndSec ?? 0) * 1000,
        value: session?.sleepScore ?? 0,
      };
    });
    return {
      spo2: { type: 'spo2', points: spo2Points },
      sleep: { type: 'sleep', points: sleepPoints },
    };
  }, [lowsByNight, sleepRecent, sleepPending, trendRange]);

  return (
    <DetailShell
      vital="spo2"
      onBack={onBack}
      onRangeChange={setTrendRange}
      testID="spo2-detail"
      hero={
        <VitalHero
          vital="spo2"
          primary={latestPercent === null ? '—' : String(latestPercent)}
          secondary={latestPercent === null ? undefined : '%'}
          sub={
            spo2StaleCaption ??
            (isEmpty ? 'No oxygen samples yet' : 'Now · oxygen saturation')
          }
          range={range.hero}
          ringFill={spo2Fill(latestPercent)}
          livePulse={false}
          testID="spo2-detail-hero"
        />
      }
    >
      {/* Sprint 18 SP1 — caregiver-scoped loading + error swap-in.
          Mirrors Sleep / HR / BP. Hero above still renders so the
          persona header stays consistent. */}
      {isInitialParentLoad ? (
        <LoadingState testID="spo2-detail-loading" />
      ) : parentLoadError ? (
        <ErrorState
          onRetry={() => {
            void parentPulse.refresh();
            void parentRecent.refresh();
          }}
          testID="spo2-detail-error"
        />
      ) : isEmpty ? (
        <>
          <EmptyHelperLine />
          <VitalInsightCard
            vital="spo2"
            body={range.insight}
            testID="spo2-detail-insight"
          />
        </>
      ) : (
        <>
          {baselineBody ? (
            <BaselineReference
              body={baselineBody}
              eyebrow="Your usual overnight"
              caption={`over the last ${baseline?.sampleCount ?? 14} nights`}
              testID="spo2-detail-baseline"
            />
          ) : null}
          <StalenessHintRow
            stale={spo2Staleness === 'stale'}
            testID="spo2-detail-staleness-hint"
          />
          <StatTrio
            testID="spo2-detail-trio"
            items={[
              {
                label: 'Overnight avg',
                value: overnightAvg !== null ? String(overnightAvg) : '—',
                unit: '%',
              },
              {
                label: 'Lowest',
                value: lowest !== null && Number.isFinite(lowest) ? String(lowest) : '—',
                unit: lowestUnit,
              },
              {
                label: 'Awake avg',
                value: awakeAvg !== null ? String(awakeAvg) : '—',
                unit: '%',
              },
            ]}
          />

          {chartHasData ? (
            <View style={{ paddingHorizontal: 20 }}>
              <VitalTrendChart
                vital="spo2"
                data={overnightSeries}
                range={chartRange}
                caption={`Overnight · oxygen · last ${RANGE_TO_DAYS[trendRange]} days`}
                subCaption={`${chartRange[0]}–${chartRange[1]} band`}
                peak
                trough
                testID="spo2-detail-chart"
              />
            </View>
          ) : (
            <EmptyChartHelper />
          )}

          {correlation ? (
            <View style={{ paddingHorizontal: 20 }}>
              <CorrelationStrip
                vitalA={correlation.spo2}
                vitalB={correlation.sleep}
                range={trendRange}
                caption={`Oxygen × sleep score — last ${RANGE_TO_DAYS[trendRange]} days`}
                tBounds={(() => {
                  const nowMs = Date.now();
                  const days = RANGE_TO_DAYS[trendRange];
                  return { tMin: nowMs - days * 24 * 60 * 60 * 1000, tMax: nowMs };
                })()}
                axisLabels={(() => {
                  const nowMs = Date.now();
                  const days = RANGE_TO_DAYS[trendRange];
                  const startMs = nowMs - days * 24 * 60 * 60 * 1000;
                  const left = new Date(startMs).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                  });
                  return { left, right: 'today' };
                })()}
                testID="spo2-detail-correlation"
              />
            </View>
          ) : null}

          <VitalInsightCard
            vital="spo2"
            body={range.insight}
            testID="spo2-detail-insight"
          />

          <VitalExplainerAnchor
            context={{ type: 'spo2', latestSpO2: latestPercent ?? null }}
            onArticleOpen={onArticleOpen}
            onLearnOpen={onLearnOpen}
            testID="spo2-detail-explainer-anchor"
          />

          <RecentReadingsSection
            vital="spo2"
            eyebrow="Recent readings"
            readings={recentRows}
            testID="spo2-detail-readings"
          />
          {onViewAllHistory && historyFamilyId ? (
            <ViewAllHistoryLink
              kind="spo2"
              familyId={historyFamilyId}
              range={trendRange}
              onPress={() =>
                onViewAllHistory(trendRange, historyFamilyId, displayTimeZone)
              }
              testID="spo2-detail-view-all"
            />
          ) : null}
        </>
      )}
    </DetailShell>
  );
}

/**
 * Empty-state helper line — calm welcome copy, not "no data". Voice
 * rules: leads with what *will* happen, not what's missing.
 */
function EmptyHelperLine() {
  const theme = useTheme();
  const captionStyle = theme.type('caption');
  return (
    <View style={[styles.emptyHelper, { paddingHorizontal: 20 }]}>
      <Text
        style={{
          fontFamily: theme.fontFamilies.numeric,
          fontSize: captionStyle.size,
          lineHeight: captionStyle.lineHeight,
          color: theme.colors.text.tertiary,
          textAlign: 'center',
          letterSpacing: 0.4,
        }}
      >
        Wear the watch overnight to start tracking your oxygen.
      </Text>
    </View>
  );
}

/**
 * Sprint 16.5f — shown when overnight samples < 3. Replaces the prior
 * behaviour where a mock chart drew a fake trace. Honest "your first
 * night's pattern lands here" framing.
 */
function EmptyChartHelper() {
  const theme = useTheme();
  const captionStyle = theme.type('caption');
  return (
    <View style={[styles.emptyHelper, { paddingHorizontal: 20 }]}>
      <View
        style={{
          backgroundColor: theme.colors.surface.warmSubtle,
          borderColor: theme.colors.border.rim,
          borderRadius: theme.radii.l,
          borderWidth: 0.5,
          padding: theme.spacing.l,
          minHeight: 140,
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: captionStyle.size,
            lineHeight: captionStyle.lineHeight,
            color: theme.colors.text.tertiary,
            textAlign: 'center',
            letterSpacing: 0.4,
          }}
        >
          Your overnight oxygen pattern will appear here after a few nights.
        </Text>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  emptyHelper: {
    alignItems: 'center',
  },
});
