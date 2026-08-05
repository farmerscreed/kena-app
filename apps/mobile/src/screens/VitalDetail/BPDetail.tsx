// BPDetail — Sprint 8.5 (per-vital detail screens, BP slice).
//
// Composition (top → bottom), per docs/04-screens/vital-detail-bp.md +
// design source `leiko-detail-screens.jsx` lines 4-111:
//
//   1. DetailShell                 — owns back chevron, vital-tinted bg,
//                                    range pills, scroll container
//   2. VitalHero (slot)            — 122/78 ring + classification-aware
//                                    range copy + "Latest · {time}"
//   3. StatTrio                    — 7-day avg · lowest · highest
//   4. BPTwinLineChart (in card)   — today's twin sys/dia hourly chart
//   5. VitalInsightCard            — Tier-B placeholder paragraph
//   6. RecentReadingsList          — last 4 BP readings, tappable
//
// Empty-state branch: when no BP exists (`data.bp.latest === null`),
// the screen renders a calm placeholder VitalHero + welcome
// VitalInsightCard. No chart, no readings list. Range pills still
// render; they are no-ops until data arrives, which matches the
// behaviour the user expects (the pills are still affordable for
// "this is where trends will live").
//
// Voice rules (docs/05-voice-and-claims.md): every visible string in
// this file is reassuring or informative. No "patient", "diagnose",
// "predict", "dangerous", "critical". Calm-concerned copy mirrors the
// existing tier mapping in utils/classification.ts:tierChipText().
//
// Hook surface: this screen is presentational. It pulls data via
// `useDailyPulseData()` + `useReadings()`, but does NOT call
// `useNavigation`. The router (built separately) wires `onBack` +
// `onSelectReading`. Tests can mount the screen directly with mocked
// hooks — no NavigationContainer needed.

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DetailShell } from '../../components/DetailShell';
import { VitalHero } from '../../components/VitalHero';
import { StatTrio, type StatTrioItem } from '../../components/StatTrio';
import { type RecentReading } from '../../components/RecentReadingsList';
import { RecentReadingsSection } from '../../components/RecentReadingsSection';
import { VitalInsightCard } from '../../components/VitalInsightCard';
import { BPTwinLineChart } from '../../components/BPTwinLineChart';
import { VitalExplainerAnchor } from '../../components/VitalExplainerAnchor';
import { BaselineReference } from '../../components/BaselineReference';
import { StalenessHintRow } from '../../components/StalenessHintRow';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import type { TrendRange } from '../../components/TimeRangePills';
import { useDailyPulseData, emptyDailyPulse } from '../../state/dailyPulse';
import { useReadings, type LocalReading } from '../../state/readings';
import { useParentDailyPulseData } from '../../hooks/useParentDailyPulseData';
import { useParentVitalsRecent } from '../../hooks/useParentVitalsRecent';
import { bpFillFromTier } from '../../utils/vitalThemes';
import { useTheme } from '../../theme';
import {
  checkStaleness,
  vitalRangeCopyForTier,
  type ClassificationTier,
} from '../../utils/classification';
import { formatStalenessCaption } from '../../utils/stalenessCaption';
import { bpBaseline, formatBPBaseline, type BPBaseline } from '../../utils/vitalBaselines';
import {
  resolveTimeZone,
  timeInZone,
  weekdayInZone,
  monthDayInZone,
  hourInZone,
  dayKeyInZone,
} from '../../utils/timeInZone';
import { useAuth } from '../../state/auth';
import { useOnboarding } from '../../state/onboarding';
import { ViewAllHistoryLink } from '../../components/ViewAllHistoryLink';

const RANGE_TO_DAYS: Record<TrendRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function rangeStatsLabel(range: TrendRange): string {
  switch (range) {
    case '7d':
      return '7-day avg';
    case '30d':
      return '30-day avg';
    case '90d':
      return '90-day avg';
  }
}

function rangeFallbackUnit(range: TrendRange): string {
  return `last ${RANGE_TO_DAYS[range]} days`;
}

// ---------------------------------------------------------------------------
// Voice-clean copy
// ---------------------------------------------------------------------------

const HOUR_LABELS = ['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p'];
const SYS_RANGE: [number, number] = [110, 130];

// Sprint 16.5f — deterministic insight body. Replaces the Sprint 8.5
// hardcoded "morning coffee" paragraph (which was fiction — we didn't
// know whether the user had coffee). The new body is derived from the
// real stats over the range + the baseline band, so it never makes a
// claim the data can't support.

const INSIGHT_BODY_EMPTY =
  "Once you take your first reading, this is where you'll see how it lands compared to your usual range. Patterns appear after a few days of readings.";

const INSIGHT_BODY_PRE_BASELINE =
  "After about a week of readings, this card will compare your current numbers to your usual range and call out anything worth noting.";

// Range-line copy keyed to the BP classification tier. Sprint 19
// (audit D12 P0-4) — the switch moved to utils/classification.ts as
// `vitalRangeCopyForTier` so HRDetail (which had drifted) shares it.
// Kept as a named local so the call sites below read unchanged.
function rangeCopyForTier(tier: ClassificationTier | null | undefined): string {
  return vitalRangeCopyForTier('mmHg', tier);
}

// ---------------------------------------------------------------------------
// Pure formatting helpers — exported for tests
// ---------------------------------------------------------------------------

// Vitals data-completeness fix — every time-derived value is read in the
// wearer's `timeZone` (their Settings IANA tz), not the device's. See
// utils/timeInZone. Self path: the signed-in user's tz; caregiver path:
// the family owner's tz (carried on the parent fetch).
export function formatHeroTime(
  measuredAtSec: number,
  timeZone: string,
  nowMs: number = Date.now(),
): string {
  const ms = measuredAtSec * 1000;
  const time = timeInZone(ms, timeZone);
  const ageHours = (nowMs - ms) / 3_600_000;
  if (ageHours < 24) {
    return `Latest · ${time}`;
  }
  // Sprint 18 B5 — older than 24h includes the date so "Mon 3:14 PM"
  // isn't ambiguous about which week. Format: "Latest · Mon · May 18,
  // 3:14 PM".
  const weekday = weekdayInZone(ms, timeZone, 'short');
  const monthDay = monthDayInZone(ms, timeZone);
  return `Latest · ${weekday} · ${monthDay}, ${time}`;
}

export function formatRowTime(
  measuredAtSec: number,
  timeZone: string,
  nowMs: number = Date.now(),
): string {
  const ms = measuredAtSec * 1000;
  const ageHours = (nowMs - ms) / 3_600_000;
  const time = timeInZone(ms, timeZone);
  if (ageHours < 24) {
    return time;
  }
  // Sprint 18 P-B1 — include the time alongside "Yesterday" so three
  // readings on the same day are visually distinguishable in the list.
  if (ageHours < 48) {
    return `Yesterday ${time}`;
  }
  // Older — short weekday + time. Sparse trackers viewing a >48h-old
  // row should at least see when the reading happened, not just "Mon".
  return `${weekdayInZone(ms, timeZone, 'short')} ${time}`;
}

function rowContext(
  measuredAtSec: number,
  isFirst: boolean,
  timeZone: string,
  nowMs: number = Date.now(),
): string {
  const ms = measuredAtSec * 1000;
  const ageHours = (nowMs - ms) / 3_600_000;
  const hour = hourInZone(ms, timeZone);
  const partOfDay =
    hour < 5 ? 'overnight' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  if (isFirst && ageHours < 1) return 'Just now · resting';
  if (ageHours < 24) return `Today ${partOfDay}`;
  if (ageHours < 48) return `Yesterday ${partOfDay}`;
  return `${weekdayInZone(ms, timeZone, 'long')} ${partOfDay}`;
}

/** Filters BP readings to those that fell on the wearer's local "today". */
export function readingsForToday(
  readings: LocalReading[],
  timeZone: string,
  nowMs: number = Date.now(),
): LocalReading[] {
  const today = dayKeyInZone(nowMs, timeZone);
  return readings.filter(
    (r) => dayKeyInZone(r.measuredAtSec * 1000, timeZone) === today,
  );
}

/**
 * Bucket today's readings into the 8 hour-of-day slots used by the
 * BPTwinLineChart axis (12a, 3a, 6a, 9a, 12p, 3p, 6p, 9p). Each bucket
 * is the *average* of the readings landing in it.
 *
 * Sprint 16.5f — empty buckets now return `null` (was: mock fallback
 * data). The chart renders no dot for null slots. Previously a user
 * with one morning reading saw a complete fake 24h trace; now they
 * see one honest dot.
 */
export function bucketReadingsByHour(
  readings: LocalReading[],
  timeZone: string,
): { sys: (number | null)[]; dia: (number | null)[] } {
  // Slot index = floor(hour / 3) — 8 slots covering 0-23h.
  const sysSums = new Array(8).fill(0) as number[];
  const diaSums = new Array(8).fill(0) as number[];
  const counts = new Array(8).fill(0) as number[];
  for (const r of readings) {
    const hour = hourInZone(r.measuredAtSec * 1000, timeZone);
    const slot = Math.min(7, Math.floor(hour / 3));
    sysSums[slot] += r.systolic;
    diaSums[slot] += r.diastolic;
    counts[slot] += 1;
  }
  const sys: (number | null)[] = sysSums.map((sum, i) =>
    counts[i] > 0 ? Math.round(sum / counts[i]) : null,
  );
  const dia: (number | null)[] = diaSums.map((sum, i) =>
    counts[i] > 0 ? Math.round(sum / counts[i]) : null,
  );
  return { sys, dia };
}

/**
 * Bucket readings into N daily slots over the chosen window. Each bucket
 * is the average sys + dia for that day; days with no readings return
 * null. Used by the BP twin chart in 7d / 30d / 90d range modes.
 */
export function bucketReadingsByDay(
  readings: LocalReading[],
  days: number,
  timeZone: string,
  nowMs: number = Date.now(),
): { sys: (number | null)[]; dia: (number | null)[]; labels: string[] } {
  const sysSums = new Array(days).fill(0) as number[];
  const diaSums = new Array(days).fill(0) as number[];
  const counts = new Array(days).fill(0) as number[];
  const labels: string[] = [];
  for (let i = 0; i < days; i++) {
    const slotMs = nowMs - (days - 1 - i) * 24 * 3_600_000;
    // Two short label modes: short month-day for 7d (readable), single
    // char weekday for 30d/90d (avoid label crowding). Weekday read in
    // the wearer's tz so the axis matches their calendar.
    labels.push(
      days <= 7 ? weekdayInZone(slotMs, timeZone, 'short').slice(0, 3) : '',
    );
  }
  for (const r of readings) {
    const offsetDays = Math.floor(
      (nowMs - r.measuredAtSec * 1000) / (24 * 3_600_000),
    );
    if (offsetDays < 0 || offsetDays >= days) continue;
    const slot = days - 1 - offsetDays;
    sysSums[slot] += r.systolic;
    diaSums[slot] += r.diastolic;
    counts[slot] += 1;
  }
  const sys: (number | null)[] = sysSums.map((sum, i) =>
    counts[i] > 0 ? Math.round(sum / counts[i]) : null,
  );
  const dia: (number | null)[] = diaSums.map((sum, i) =>
    counts[i] > 0 ? Math.round(sum / counts[i]) : null,
  );
  return { sys, dia, labels };
}

/** Pure helper: stats for the chosen window from a list of BP readings.
 *  Pre-16.5e was hardcoded to 7 days; now takes `days` so the stat trio
 *  reacts to the 7d / 30d / 90d range pills. */
export function computeStats(
  readings: LocalReading[],
  timeZone: string,
  nowMs: number = Date.now(),
  days: number = 7,
): {
  avgSys: number | null;
  avgDia: number | null;
  lowSys: number | null;
  lowDia: number | null;
  lowDayLabel: string | null;
  highSys: number | null;
  highDia: number | null;
  highDayLabel: string | null;
} {
  const cutoffMs = nowMs - days * 24 * 3_600_000;
  const window = readings.filter((r) => r.measuredAtSec * 1000 >= cutoffMs);
  if (window.length === 0) {
    return {
      avgSys: null,
      avgDia: null,
      lowSys: null,
      lowDia: null,
      lowDayLabel: null,
      highSys: null,
      highDia: null,
      highDayLabel: null,
    };
  }
  const avgSys = Math.round(
    window.reduce((acc, r) => acc + r.systolic, 0) / window.length,
  );
  const avgDia = Math.round(
    window.reduce((acc, r) => acc + r.diastolic, 0) / window.length,
  );
  const low = window.reduce((a, b) => (b.systolic < a.systolic ? b : a));
  const high = window.reduce((a, b) => (b.systolic > a.systolic ? b : a));
  // Sprint 16.5f — show short weekday + month-day so "Thu" isn't
  // ambiguous (this Thursday vs last Thursday). Example: "Thu · May 9".
  const labelFor = (r: LocalReading) => {
    const ms = r.measuredAtSec * 1000;
    return `${weekdayInZone(ms, timeZone, 'short')} · ${monthDayInZone(ms, timeZone)}`;
  };
  return {
    avgSys,
    avgDia,
    lowSys: low.systolic,
    lowDia: low.diastolic,
    lowDayLabel: labelFor(low),
    highSys: high.systolic,
    highDia: high.diastolic,
    highDayLabel: labelFor(high),
  };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export interface BPDetailProps {
  onBack: () => void;
  /** Wired by the router so a tap on a recent-readings row opens ReadingDetail. */
  onSelectReading?: (localId: string) => void;
  /** Wired by the router so the InlineExplainer's related-card row can
   *  navigate to a specific article. */
  onArticleOpen?: (articleId: string) => void;
  /** Wired by the router so the InlineExplainer's "Read more in Learn"
   *  CTA can route to the Learn home. */
  onLearnOpen?: () => void;
  /** Sprint 16.5f — tap "Share with your doctor" → navigates to Trends
   *  where the doctor-prep PDF generator lives. Router wires this. */
  onSharePress?: () => void;
  /** ADR-0008 follow-up — opens the full-window VitalHistory browse for
   *  the selected range. Router curries the vital kind. */
  onViewAllHistory?: (
    range: TrendRange,
    familyId: string,
    timeZone: string,
  ) => void;
  /** Sprint 17a — caregiver entry. When set, the screen sources its
   *  data from `useParentDailyPulseData(familyId)` +
   *  `useParentVitalsRecent(familyId)` instead of the singleton
   *  slices. Unset → unchanged self-buyer behavior. */
  familyId?: string;
}

export function BPDetail({
  onBack,
  onSelectReading,
  onArticleOpen,
  onLearnOpen,
  onSharePress,
  onViewAllHistory,
  familyId,
}: BPDetailProps) {
  const theme = useTheme();
  // Sprint 17a — both data sources called unconditionally (rules of
  // hooks). Value-level pick at the end. Self-buyer path: familyId
  // unset → singleton slices win. Caregiver path: familyId set →
  // parent-scoped query wins, with `emptyDailyPulse()` as the brief
  // loading-state fallback so the screen renders its empty state
  // instead of flashing the caregiver's own (probably empty) data.
  const ownPulse = useDailyPulseData();
  const ownRecentReadings = useReadings((s) => s.recent);
  const ownPendingReadings = useReadings((s) => s.pending);
  const scopedFamilyId = familyId ?? null;
  const parentPulse = useParentDailyPulseData(scopedFamilyId);
  const parentRecent = useParentVitalsRecent(scopedFamilyId);
  const emptyFallback = useMemo(() => emptyDailyPulse(), []);

  // Wearer's timezone — all times / day boundaries render in the wearer's
  // local zone (their Settings value), never the device's. Self path: the
  // signed-in user. Caregiver path: the family owner's tz from the parent
  // fetch, falling back to the viewer's tz, then UTC (resolveTimeZone).
  const ownTimeZone = useAuth((s) => s.profile?.timezone ?? null);
  // Family the full-window history is scoped to: the viewed parent on the
  // caregiver path, else the signed-in user's own family.
  const ownFamilyId = useOnboarding((s) => s.familyId);
  const historyFamilyId = scopedFamilyId ?? ownFamilyId;
  const timeZone = resolveTimeZone(
    scopedFamilyId ? parentPulse.wearerTimeZone ?? ownTimeZone : ownTimeZone,
  );

  // Sprint 18 B1 — distinguish loading + error from "truly empty" for
  // the caregiver-scoped path. Same pattern Sleep/HR audits introduced.
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
  const recentReadings = scopedFamilyId
    ? parentRecent.data.readings
    : ownRecentReadings;
  const pendingReadings: LocalReading[] = scopedFamilyId
    ? []
    : ownPendingReadings;

  // Sprint 16.5e — mirror DetailShell's range so stats + recent list
  // react to 7d / 30d / 90d.
  const [range, setRange] = useState<TrendRange>('7d');

  const allBPReadings = useMemo(
    () => [...pendingReadings, ...recentReadings],
    [pendingReadings, recentReadings],
  );

  const rangedReadings = useMemo(() => {
    const cutoffMs = Date.now() - RANGE_TO_DAYS[range] * 24 * 3_600_000;
    return allBPReadings.filter((r) => r.measuredAtSec * 1000 >= cutoffMs);
  }, [allBPReadings, range]);

  const tier = data.bp.classification?.tier ?? null;
  const ringFill = bpFillFromTier(tier);
  const isEmpty = data.bp.latest === null;
  // Sprint 16 — per D13 §6.6, surface a stale caption when the last
  // BP reading is older than 36h. Empty state takes precedence.
  const staleness = isEmpty
    ? 'no_data'
    : checkStaleness('bp', data.bp.latestSampleSec);
  const isStale = staleness === 'stale';
  const staleCaption = isStale
    ? formatStalenessCaption(data.bp.latestSampleSec)
    : null;

  // ----- Hero block ---------------------------------------------------
  const hero = isEmpty ? (
    <VitalHero
      vital="bp"
      primary="—"
      sub="No readings yet"
      range="Take your first reading whenever you're ready."
      ringFill={0}
      testID="bp-detail-hero"
    />
  ) : (
    <VitalHero
      vital="bp"
      primary={String(data.bp.latest!.systolic)}
      secondary={`/ ${data.bp.latest!.diastolic}`}
      sub={
        staleCaption ??
        (data.bp.latestSampleSec !== null
          ? formatHeroTime(data.bp.latestSampleSec, timeZone)
          : 'Latest')
      }
      range={rangeCopyForTier(tier)}
      ringFill={ringFill}
      livePulse={false}
      testID="bp-detail-hero"
    />
  );

  // ----- Stat trio (over the chosen range) ----------------------------
  const stats = useMemo(
    () => computeStats(allBPReadings, timeZone, Date.now(), RANGE_TO_DAYS[range]),
    [allBPReadings, timeZone, range],
  );
  const statItems: [StatTrioItem, StatTrioItem, StatTrioItem] = [
    {
      label: rangeStatsLabel(range),
      value:
        stats.avgSys !== null && stats.avgDia !== null
          ? `${stats.avgSys}/${stats.avgDia}`
          : '—',
      unit: 'mmHg',
    },
    {
      label: 'Lowest',
      value:
        stats.lowSys !== null && stats.lowDia !== null
          ? `${stats.lowSys}/${stats.lowDia}`
          : '—',
      unit: stats.lowDayLabel ?? rangeFallbackUnit(range),
    },
    {
      label: 'Highest',
      value:
        stats.highSys !== null && stats.highDia !== null
          ? `${stats.highSys}/${stats.highDia}`
          : '—',
      unit: stats.highDayLabel ?? rangeFallbackUnit(range),
    },
  ];

  // ----- Twin chart — range-aware (16.5f) ------------------------------
  // 7d default uses 24h hourly slots from today's readings (matches the
  // design's "Today" intent). 7d/30d/90d picks switch to daily bins so
  // the chart's window matches the range pill. Empty slots return null
  // → no dots drawn (was: mock fallback data on every empty slot).
  const todayReadings = useMemo(
    () => readingsForToday(allBPReadings, timeZone),
    [allBPReadings, timeZone],
  );
  const { sys, dia, hourLabels, chartEyebrow } = useMemo(() => {
    if (range === '7d') {
      // Default: today's 8-slot hourly chart.
      const { sys: s, dia: d } = bucketReadingsByHour(todayReadings, timeZone);
      return {
        sys: s,
        dia: d,
        hourLabels: HOUR_LABELS,
        chartEyebrow: 'Today · systolic & diastolic',
      };
    }
    // 30d / 90d — daily bins over the window.
    const days = RANGE_TO_DAYS[range];
    const { sys: s, dia: d, labels } = bucketReadingsByDay(
      allBPReadings,
      days,
      timeZone,
      Date.now(),
    );
    return {
      sys: s,
      dia: d,
      hourLabels: labels,
      chartEyebrow: `Last ${days} days · daily averages`,
    };
  }, [allBPReadings, todayReadings, range, timeZone]);

  // ----- Baseline reference (16.5f) ------------------------------------
  const baseline = useMemo(() => bpBaseline(allBPReadings), [allBPReadings]);
  const baselineBody = baseline ? formatBPBaseline(baseline) : '';

  // ----- Recent readings list — filtered to range, sliced by
  // RecentReadingsSection (the section wrapper owns the visible-count +
  // picker UX).
  // Sprint 18 B2 — gate the "now" time-chip on the same freshness
  // window rowContext uses (ageHours < 1). Previously the newest row
  // was unconditionally labelled "now" — so a sparse tracker whose
  // newest BP reading was 5 days old still saw "now" next to it.
  const recentRows: RecentReading[] = useMemo(() => {
    const nowMs = Date.now();
    return rangedReadings
      .slice()
      .sort((a, b) => b.measuredAtSec - a.measuredAtSec)
      .map((r, idx) => {
        const ageHours = (nowMs - r.measuredAtSec * 1000) / 3_600_000;
        const isFreshFirst = idx === 0 && ageHours < 1;
        return {
          id: r.localId,
          value: `${r.systolic}/${r.diastolic}`,
          context: rowContext(r.measuredAtSec, idx === 0, timeZone, nowMs),
          time: isFreshFirst ? 'now' : formatRowTime(r.measuredAtSec, timeZone, nowMs),
        };
      });
  }, [rangedReadings, timeZone]);

  // Sprint 18 B4 — when the 7d chart has zero readings today but the
  // user DOES have older readings, the chart would render with all 8
  // slots null (no dots) under a "Today · systolic & diastolic"
  // eyebrow. Honest but visually confusing. Show an inline placeholder
  // instead, while still keeping the chart card frame so the layout
  // doesn't jump.
  const has7dTodayData =
    range !== '7d' || sys.some((v) => v !== null) || dia.some((v) => v !== null);

  return (
    <DetailShell
      vital="bp"
      onBack={onBack}
      onRangeChange={setRange}
      hero={hero}
      testID="bp-detail"
    >
      {/* Sprint 18 B1 — caregiver-scoped loading + error swap-in.
          During the initial parent fetch we render a calm spinner
          instead of telling the caregiver their parent has no BP
          data; on fetch errors we surface a recoverable banner
          instead of falling through to the empty-state UI. The hero
          above still renders so the persona header stays consistent. */}
      {isInitialParentLoad ? (
        <LoadingState testID="bp-detail-loading" />
      ) : parentLoadError ? (
        <ErrorState
          onRetry={() => {
            void parentPulse.refresh();
            void parentRecent.refresh();
          }}
          testID="bp-detail-error"
        />
      ) : (
        <>
          {!isEmpty && baselineBody ? (
            <BaselineReference
              body={baselineBody}
              caption={`over the last ${baseline?.sampleCount ?? 30} readings`}
              testID="bp-detail-baseline"
            />
          ) : null}
          <StalenessHintRow stale={isStale} testID="bp-detail-staleness-hint" />
          {!isEmpty ? (
            <>
              <StatTrio items={statItems} testID="bp-detail-stats" />

              {/* Twin chart — range-aware (16.5f) */}
              <View
                style={[
                  styles.section,
                  { paddingHorizontal: theme.spacing.xl },
                ]}
              >
                <Text
                  allowFontScaling={false}
                  style={{
                    fontFamily: theme.type('labelUppercase').family,
                    fontSize: theme.type('labelUppercase').size,
                    lineHeight: theme.type('labelUppercase').lineHeight,
                    letterSpacing: theme.type('labelUppercase').letterSpacing,
                    color: theme.colors.text.tertiary,
                    textTransform: 'uppercase',
                    marginBottom: theme.spacing.s,
                  }}
                  testID="bp-detail-chart-eyebrow"
                >
                  {chartEyebrow}
                </Text>
                <View
                  style={{
                    backgroundColor: theme.colors.surface.warmSubtle,
                    borderColor: theme.colors.border.rim,
                    borderRadius: theme.radii.l,
                    borderWidth: 0.5,
                    padding: theme.spacing.l,
                  }}
                >
                  {has7dTodayData ? (
                    <BPTwinLineChart
                      vital="bp"
                      sys={sys}
                      dia={dia}
                      hourLabels={hourLabels}
                      range={SYS_RANGE}
                      testID="bp-detail-chart"
                    />
                  ) : (
                    // Sprint 18 B4 — "no readings today" inline copy.
                    // The chart card frame stays so the screen doesn't
                    // jump; the body explains why there's no line yet.
                    <Text
                      allowFontScaling={false}
                      testID="bp-detail-chart-empty-today"
                      style={[
                        theme.type('bodyM'),
                        {
                          color: theme.colors.text.secondary,
                          textAlign: 'center',
                          paddingVertical: theme.spacing.l,
                        },
                      ]}
                    >
                      No readings today yet. Tap the 30d or 90d range above to see your wider trend.
                    </Text>
                  )}
                </View>
              </View>
            </>
          ) : null}

          <VitalInsightCard
            vital="bp"
            body={
              isEmpty
                ? INSIGHT_BODY_EMPTY
                : baseline
                  ? bpInsightBody(stats, baseline, range, tier)
                  : INSIGHT_BODY_PRE_BASELINE
            }
            testID="bp-detail-insight"
          />

          {!isEmpty && data.bp.latest ? (
            <VitalExplainerAnchor
              context={{
                type: 'bp',
                reading: {
                  systolic: data.bp.latest.systolic,
                  diastolic: data.bp.latest.diastolic,
                },
              }}
              onArticleOpen={onArticleOpen}
              onLearnOpen={onLearnOpen}
              testID="bp-detail-explainer-anchor"
            />
          ) : null}

          {!isEmpty ? (
            <RecentReadingsSection
              vital="bp"
              eyebrow="Recent readings"
              readings={recentRows}
              onSelect={
                onSelectReading ? (r) => onSelectReading(r.id) : undefined
              }
              testID="bp-detail-readings"
            />
          ) : null}
          {!isEmpty && onViewAllHistory && historyFamilyId ? (
            <ViewAllHistoryLink
              kind="bp"
              familyId={historyFamilyId}
              range={range}
              onPress={() =>
                onViewAllHistory(range, historyFamilyId, timeZone)
              }
              testID="bp-detail-view-all"
            />
          ) : null}
          {!isEmpty && onSharePress ? (
            <ShareWithDoctorRow onPress={onSharePress} />
          ) : null}
        </>
      )}
    </DetailShell>
  );
}

// ---------------------------------------------------------------------------
// Sprint 16.5f — deterministic BP insight body
// ---------------------------------------------------------------------------

/** Deterministic template fed by the real stats + baseline. Returns a
 *  voice-clean paragraph that does NOT claim anything the data can't
 *  support (no coffee, no diet, no time-of-day causation). */
export function bpInsightBody(
  stats: ReturnType<typeof computeStats>,
  baseline: BPBaseline,
  range: TrendRange,
  tier: ClassificationTier | null,
): string {
  if (stats.avgSys === null || stats.avgDia === null) {
    return INSIGHT_BODY_PRE_BASELINE;
  }
  const windowLabel =
    range === '7d' ? 'this week' : range === '30d' ? 'this month' : 'the last 90 days';
  const baselineMid = Math.round((baseline.sysLow + baseline.sysHigh) / 2);
  const diff = stats.avgSys - baselineMid;
  const absDiff = Math.abs(diff);
  // Trend line — calm, never alarming.
  let trendLine: string;
  if (absDiff <= 3) {
    trendLine = `Your average ${windowLabel} (${stats.avgSys}/${stats.avgDia}) is right at your usual.`;
  } else if (diff > 0) {
    trendLine = `Your average ${windowLabel} (${stats.avgSys}/${stats.avgDia}) is about ${absDiff} points above your usual.`;
  } else {
    trendLine = `Your average ${windowLabel} (${stats.avgSys}/${stats.avgDia}) is about ${absDiff} points below your usual.`;
  }
  // Tier-driven framing — calm regardless.
  let tierLine: string;
  switch (tier) {
    case 'confirmed_urgent':
      tierLine = "Your recent readings have been higher than usual. Worth talking to your doctor today.";
      break;
    case 'calm_concerned':
      tierLine = "A few recent readings have been higher than usual — might be worth mentioning at your next visit.";
      break;
    case 'in_pattern':
    default:
      tierLine = "Your recent readings are following your usual pattern.";
  }
  return `${trendLine} ${tierLine}`;
}

// ---------------------------------------------------------------------------
// Sprint 16.5f — Share with doctor row
// ---------------------------------------------------------------------------

interface ShareWithDoctorRowProps {
  onPress: () => void;
}

function ShareWithDoctorRow({ onPress }: ShareWithDoctorRowProps) {
  const theme = useTheme();
  const labelStyle = theme.type('labelUppercase');
  const valueStyle = theme.type('bodyM');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Share with your doctor"
      accessibilityHint="Opens a summary you can send to your doctor"
      onPress={onPress}
      hitSlop={6}
      testID="bp-detail-share-row"
      style={({ pressed }) => [
        styles.shareRow,
        {
          backgroundColor: theme.colors.surface.warmSubtle,
          borderColor: theme.colors.border.rim,
          borderRadius: theme.radii.l,
          marginHorizontal: 20,
          paddingHorizontal: theme.spacing.l,
          paddingVertical: theme.spacing.l,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: labelStyle.family,
            fontSize: labelStyle.size,
            lineHeight: labelStyle.lineHeight,
            letterSpacing: labelStyle.letterSpacing,
            color: theme.colors.text.tertiary,
            textTransform: 'uppercase',
            marginBottom: 2,
          }}
        >
          Share
        </Text>
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: valueStyle.family,
            fontSize: valueStyle.size,
            lineHeight: valueStyle.lineHeight,
            color: theme.colors.text.primary,
          }}
        >
          Share with your doctor
        </Text>
      </View>
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: theme.fontFamilies.numeric,
          fontSize: 22,
          color: theme.colors.text.tertiary,
        }}
      >
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    // section eyebrow + body wrap; horizontal padding matches the rest
    // of the screen content (hero / stat trio).
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0.5,
  },
});
