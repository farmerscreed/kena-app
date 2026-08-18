// SleepDetail — Sprint 8.5, fully reworked in Sprint 16.5c.
//
// Per-vital detail screen for sleep. Composes the Sprint 8.5 foundation
// primitives (DetailShell, VitalHero, StatTrio, VitalInsightCard,
// CorrelationStrip, RecentReadingsSection) with the bespoke
// SleepStagesBar (last-night composition) + SleepNightlyBars (range
// chart). The earlier SleepHypnogram was removed: it expected a
// transitions[] array, but the U16PRO_protocol_en.pdf §4.3 sleep
// packet has no field for transitions — total / deep / light minutes
// only — so the hypnogram was rendering as a single flat "light"
// band and gave the impression no stage data existed.
//
// 7d / 30d / 90d range:
//   The DetailShell-owned TimeRangePills are now wired through to
//   `setRange` here. Switching range filters:
//     - the nightly bar chart (window length)
//     - the "Recent nights" list (only sessions within the window)
//     - the morning-BP × sleep-score correlation (matching range)
//   The hero is unaffected — it always shows last night.
//
// Risk note (sprint card, D13 §8.5): "Sleep stage data accuracy from
// the watch is decent but not clinical. Don't surface stage data with
// false precision — broad bands only." We now show three broad bands
// (Deep / Light / Other) by duration; no per-minute precision.
//
// Voice rules: every user-visible string in this file passes
// docs/05-voice-and-claims.md — descriptive, calm, no "patient",
// "diagnose", "predict", "dangerous", "critical", "silent killer".

import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { DetailShell } from '../../components/DetailShell';
import { VitalHero } from '../../components/VitalHero';
import { type RecentReading } from '../../components/RecentReadingsList';
import { RecentReadingsSection } from '../../components/RecentReadingsSection';
import { VitalInsightCard } from '../../components/VitalInsightCard';
import { VitalExplainerAnchor } from '../../components/VitalExplainerAnchor';
import {
  CorrelationStrip,
  type VitalSeries,
} from '../../components/CorrelationStrip';
import { SleepStagesBar } from '../../components/SleepStagesBar';
import { ViewAsTableLink } from '../../components/ViewAsTableLink';
import { CorrelationCountdown } from '../../components/CorrelationCountdown';
import { SleepNightlyBars } from '../../components/SleepNightlyBars';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import type { TrendRange } from '../../components/TimeRangePills';
import { useDailyPulseData, emptyDailyPulse } from '../../state/dailyPulse';
import { useSleep } from '../../state/sleep';
import { useReadings } from '../../state/readings';
import { useParentDailyPulseData } from '../../hooks/useParentDailyPulseData';
import { useParentVitalsRecent } from '../../hooks/useParentVitalsRecent';
import { sleepFill } from '../../utils/vitalThemes';
import { sleepScoreForSession } from '../../utils/classification';
import { checkStaleness } from '../../utils/classification';
import { formatStalenessCaption } from '../../utils/stalenessCaption';
import { formatClockInTz, useUserTz } from '../../utils/userTz';
import { useOnboarding } from '../../state/onboarding';
import { ViewAllHistoryLink } from '../../components/ViewAllHistoryLink';
import {
  resolveTimeZone,
  weekdayInZone,
  monthDayInZone,
  hourInZone,
  dayKeyInZone,
} from '../../utils/timeInZone';
import { useReconcileSleepFromHR } from '../../hooks/useReconcileSleepFromHR';
import { useTheme } from '../../theme';
import type { SleepSession } from '../../types/vitals';
import { MAX_FONT_SCALE } from '../../theme/fontScaling';

/** Sprint 18 — pick the HR-inferred wake/bed times when present, else
 *  fall back to the legacy synthesized boundaries. Exported for tests. */
export function displayWindow(session: SleepSession): {
  startSec: number;
  endSec: number;
  wakeSource: 'hr_inferred' | 'fallback' | undefined;
} {
  return {
    startSec: session.inferredSessionStartSec ?? session.sessionStartSec,
    endSec: session.inferredSessionEndSec ?? session.sessionEndSec,
    wakeSource: session.wakeSource,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests via the screen module)
// ---------------------------------------------------------------------------

/** Format minutes as e.g. "7:42". Always two-digit minutes. */
export function formatHm(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Whole-number percent of total, clamped 0..100. */
function pctOfTotal(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

/** Sprint 18 — P1 fix. Below `HISTORY_REFERENCE_NIGHTS` recorded
 *  nights, the "your usual / than last week" phrasing is misleading
 *  because the user has no baseline. Below the threshold we use
 *  non-comparative copy. Above it the earlier comparative copy
 *  returns. */
export const HISTORY_REFERENCE_NIGHTS = 7;

export function rangeCopyForSleepScore(
  score: number | null | undefined,
  recentNightsCount: number = HISTORY_REFERENCE_NIGHTS,
): string {
  if (score === null || score === undefined) return '';
  const hasHistory = recentNightsCount >= HISTORY_REFERENCE_NIGHTS;
  if (score >= 80) {
    return hasHistory ? 'A quieter night than last week' : 'A quieter night by the numbers';
  }
  if (score >= 65) {
    return hasHistory ? 'Roughly in line with your usual' : 'Roughly in the middle by the numbers';
  }
  if (score >= 50) {
    return hasHistory ? 'A lighter night than your usual' : 'A lighter night by the numbers';
  }
  return hasHistory
    ? 'A more restless night than your usual'
    : 'A more restless night by the numbers';
}

function insightBody(
  session: SleepSession | null,
  recentNightsCount: number = HISTORY_REFERENCE_NIGHTS,
): string {
  if (session === null) {
    return 'Wear the watch to bed and your sleep shape will land here in the morning. We highlight the night\'s composition and how it tends to line up with your morning readings.';
  }
  const deep = session.deepMinutes;
  const total = session.totalMinutes;
  const deepPct = pctOfTotal(deep, total);
  const hasHistory = recentNightsCount >= HISTORY_REFERENCE_NIGHTS;
  if (deepPct >= 22) {
    return hasHistory
      ? `Deep sleep landed around ${deepPct}% of the night, a touch above your usual. Heart rate tends to settle earlier on nights like this, which often shows up as a calmer morning reading.`
      : `Deep sleep landed around ${deepPct}% of the night — toward the higher end of what we typically see. Heart rate tends to settle earlier on nights like this, which often shows up as a calmer morning reading.`;
  }
  if (deepPct >= 14) {
    return hasHistory
      ? `Deep sleep made up about ${deepPct}% of the night — roughly your usual. We'll keep watching how this connects to your morning readings.`
      : `Deep sleep made up about ${deepPct}% of the night — within the range we typically see. Wear the watch a few more nights and we'll start showing how this connects to your morning readings.`;
  }
  return hasHistory
    ? `Deep sleep was about ${deepPct}% of the night, a little under your usual. A lighter night often pairs with a slightly higher morning reading; we'll keep an eye on how this week shapes up.`
    : `Deep sleep was about ${deepPct}% of the night — on the lighter side of what we typically see. A lighter night often pairs with a slightly higher morning reading; a few more nights of tracking will give us context.`;
}

/**
 * Hero sub-line for the last night.
 *
 * Honesty rule (data-completeness fix): the watch does NOT record bed/wake
 * times — its 0x07 reply carries only total/deep/light minutes. We only
 * show a clock window when HR (the morning-surge signal) let us infer it
 * with confidence (`wakeSource === 'hr_inferred'`), and then as an explicit
 * estimate (`~`). Without that signal we NEVER fabricate a time (the old
 * code synthesized a fixed 08:00/07:00) — we show the measured duration
 * only. Rather no time than a wrong one.
 */
export function bedTimeSub(
  sessionStartSec: number,
  sessionEndSec: number,
  tz: string,
  wakeSource: 'hr_inferred' | 'fallback' | undefined,
  totalMinutes: number,
): string {
  if (wakeSource === 'hr_inferred') {
    const bed = formatClockInTz(sessionStartSec, tz);
    const wake = formatClockInTz(sessionEndSec, tz);
    return `Last night · ~${bed} → ~${wake}`;
  }
  return `Last night · ${formatHm(totalMinutes)} slept`;
}

// Sprint 18 — S2 fix. The recent-nights list used to label the newest
// row as "Last night" / "now" regardless of when that session was
// recorded. For sparse trackers (5 days off, then 1 night) the newest
// row could be 5 days old and still be called "Last night". Gate the
// fresh labels on a 36-hour window — the same window
// `useSleep.lastNightSession` uses to decide whether a session counts
// as "last night" anywhere else in the app.
const LAST_NIGHT_WINDOW_SEC = 36 * 60 * 60;

export function isWithinLastNightWindow(
  sessionEndSec: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  return nowSec - sessionEndSec <= LAST_NIGHT_WINDOW_SEC && sessionEndSec <= nowSec;
}

function nightLabel(
  idx: number,
  sessionEndSec: number,
  timeZone: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): string {
  if (idx === 0 && isWithinLastNightWindow(sessionEndSec, nowSec)) return 'Last night';
  return weekdayInZone(sessionEndSec * 1000, timeZone, 'long');
}

function nightTime(sessionEndSec: number, timeZone: string): string {
  return weekdayInZone(sessionEndSec * 1000, timeZone, 'short');
}

const RANGE_TO_DAYS: Record<TrendRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Filter sessions to those ending within the last N days for the given
 *  range. Exported for tests. */
export function filterSessionsToRange(
  sessions: ReadonlyArray<SleepSession>,
  range: TrendRange,
  nowMs: number = Date.now(),
): SleepSession[] {
  const days = RANGE_TO_DAYS[range];
  const cutoffSec = Math.floor(nowMs / 1000) - days * 24 * 60 * 60;
  return sessions.filter((s) => s.sessionEndSec >= cutoffSec);
}

function buildMorningBPSeries(
  readings: { measuredAtSec: number; systolic: number }[],
  nowSec: number,
  days: number,
  timeZone: string,
): { t: number; value: number }[] {
  const cutoffSec = nowSec - days * 24 * 60 * 60;
  const byDay = new Map<string, { sumSys: number; count: number; tMs: number }>();
  for (const r of readings) {
    if (r.measuredAtSec < cutoffSec) continue;
    const ms = r.measuredAtSec * 1000;
    // "Morning" reading + day-key in the wearer's tz (was UTC, which
    // mis-bucketed the sleep×BP correlation for non-UTC users).
    if (hourInZone(ms, timeZone) >= 12) continue;
    const key = dayKeyInZone(ms, timeZone);
    const slot = byDay.get(key) ?? { sumSys: 0, count: 0, tMs: r.measuredAtSec * 1000 };
    slot.sumSys += r.systolic;
    slot.count += 1;
    slot.tMs = r.measuredAtSec * 1000;
    byDay.set(key, slot);
  }
  const out: { t: number; value: number }[] = [];
  for (const [, slot] of byDay) {
    out.push({ t: slot.tMs, value: slot.sumSys / slot.count });
  }
  return out.sort((a, b) => a.t - b.t);
}

function buildSleepScoreSeries(
  sessions: ReadonlyArray<SleepSession>,
): { t: number; value: number }[] {
  return sessions
    // Recomputed — the stored field was a constant 0 placeholder.
    .map((s) => ({ t: s.sessionEndSec * 1000, value: sleepScoreForSession(s) }))
    .sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SleepDetailProps {
  onBack: () => void;
  onArticleOpen?: (articleId: string) => void;
  onLearnOpen?: () => void;
  /** Sprint 17a — caregiver entry. When set, sleep + readings data
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

export function SleepDetail({
  onBack,
  onArticleOpen,
  onLearnOpen,
  onViewAllHistory,
  familyId,
}: SleepDetailProps) {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const ownTz = useUserTz();
  // Sprint 18 — re-derive HR-inferred wake times across stored
  // sessions whose `wakeSource` is missing or 'fallback'. Mounts here
  // (and on each Home variant) so we re-run whenever the screen
  // appears with fresh HR data.
  useReconcileSleepFromHR();
  // Sprint 17a — both data sources called unconditionally.
  const ownPulse = useDailyPulseData();
  const ownSleepRecent = useSleep((s) => s.recent);
  const ownSleepPending = useSleep((s) => s.pending);
  const ownAllReadings = useReadings((s) => [...s.pending, ...s.recent]);
  const scopedFamilyId = familyId ?? null;
  const parentPulse = useParentDailyPulseData(scopedFamilyId);
  const parentRecent = useParentVitalsRecent(scopedFamilyId);
  const emptyFallback = useMemo(() => emptyDailyPulse(), []);

  // All sleep times / night labels render in the wearer's tz: the family
  // owner's on the caregiver path, else the viewer's own (useUserTz). UTC last.
  const tz = resolveTimeZone(
    scopedFamilyId ? parentPulse.wearerTimeZone ?? ownTz : ownTz,
  );
  // Family the full-window history is scoped to (ADR-0008 follow-up).
  const ownFamilyId = useOnboarding((s) => s.familyId);
  const historyFamilyId = scopedFamilyId ?? ownFamilyId;

  // Sprint 18 — S1/S3 fix. Distinguish "loading on first mount" and
  // "errored" from "truly empty" when we're in the caregiver-scoped
  // path. Without this, both states fall through to the empty-state
  // UI and the user is told their parent has no sleep data when
  // actually we just haven't finished fetching, or fetching failed.
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
  const session = data.sleep.session;

  // Sprint 16.5c — DetailShell's TimeRangePills are now wired here.
  // The DetailShell still owns the internal state for the pills'
  // appearance; we mirror it into local state so the screen's data
  // selectors react to the choice.
  const [range, setRange] = useState<TrendRange>('7d');

  // All recorded sessions, newest-first.
  const sleepRecent = scopedFamilyId
    ? parentRecent.data.sleep
    : ownSleepRecent;
  const sleepPending = scopedFamilyId ? [] : ownSleepPending;
  const allNights = useMemo(() => {
    const all = [...sleepPending, ...sleepRecent];
    return all
      .slice()
      .sort((a, b) => b.sessionStartSec - a.sessionStartSec);
  }, [sleepRecent, sleepPending]);

  // Range-filtered slice for the chart, correlation, and list.
  const rangedNights = useMemo(
    () => filterSessionsToRange(allNights, range),
    [allNights, range],
  );

  // Morning BP × sleep score correlation, matching the selected range.
  const allReadings = scopedFamilyId
    ? parentRecent.data.readings
    : ownAllReadings;
  const correlationSeries = useMemo<{ a: VitalSeries; b: VitalSeries } | null>(() => {
    if (rangedNights.length < 2 || allReadings.length < 2) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const days = RANGE_TO_DAYS[range];
    const bpSeries = buildMorningBPSeries(allReadings, nowSec, days, tz);
    const sleepSeries = buildSleepScoreSeries(rangedNights);
    if (bpSeries.length < 2 || sleepSeries.length < 2) return null;
    return {
      a: { type: 'sleep', points: sleepSeries },
      b: { type: 'bp', points: bpSeries },
    };
  }, [allReadings, rangedNights, range, tz]);

  // ---- Empty state: no last-night session AT ALL ------------------------
  // If older nights exist we still render history below; only the
  // hero + stages-bar + "this morning's" insight need the empty path.
  const hasLastNight = session !== null;

  // ---- Hero ------------------------------------------------------------
  const heroPrimary = hasLastNight ? formatHm(session.totalMinutes) : '—';
  // Sprint 18 — prefer HR-inferred wake/bed when present.
  const heroDisplay = hasLastNight ? displayWindow(session) : null;
  const sleepStaleness = hasLastNight
    ? checkStaleness('sleep', heroDisplay!.endSec)
    : 'no_data';
  const sleepStaleCaption =
    sleepStaleness === 'stale' && hasLastNight
      ? formatStalenessCaption(heroDisplay!.endSec)
      : null;
  const heroSub = hasLastNight
    ? (sleepStaleCaption ??
      bedTimeSub(
        heroDisplay!.startSec,
        heroDisplay!.endSec,
        tz,
        heroDisplay!.wakeSource,
        session.totalMinutes,
      ))
    : 'No sleep recorded last night';
  // Sprint 18 — P1 fix. Pass the count of recorded nights so the
  // "than your usual" / "than last week" phrasing only fires once the
  // user actually has a baseline (HISTORY_REFERENCE_NIGHTS = 7).
  const heroRange = hasLastNight
    ? rangeCopyForSleepScore(sleepScoreForSession(session), allNights.length)
    : 'Wear the watch overnight to track your sleep.';

  // Sleep composition values for SleepStagesBar (replaces the
  // duplicated StatTrio above the bar — both showed the same numbers).
  const totalMinutes = hasLastNight ? session.totalMinutes : 0;
  const deepMinutes = hasLastNight ? session.deepMinutes : 0;
  const lightMinutes = hasLastNight ? session.lightMinutes : 0;
  const otherMinutes = Math.max(0, totalMinutes - deepMinutes - lightMinutes);

  // ---- Recent nights list (within the selected range) ------------------
  // Sprint 18 — S2 fix. The list used to label the first row "Last
  // night" / "now" unconditionally. For sparse trackers that's wrong:
  // the newest row could be 5 days old. Use a 36-hour window so the
  // fresh labels only fire when the newest session truly was last
  // night.
  const nowSecForLabels = Math.floor(Date.now() / 1000);
  const recentRows: RecentReading[] = rangedNights.map((s, idx) => {
    const deepP = pctOfTotal(s.deepMinutes, s.totalMinutes);
    const freshLabel =
      idx === 0 && isWithinLastNightWindow(s.sessionEndSec, nowSecForLabels);
    return {
      id: `sleep-${s.sessionStartSec}`,
      value: formatHm(s.totalMinutes),
      context: `${nightLabel(idx, s.sessionEndSec, tz, nowSecForLabels)} · ${deepP}% deep`,
      time: freshLabel ? 'now' : nightTime(s.sessionEndSec, tz),
    };
  });

  // Sprint 18 — P5 fix. When the correlation chart can't render (need
  // ≥2 nights AND ≥2 BP mornings), show a calm placeholder instead of
  // silently nothing so the user understands the strip will land once
  // they have enough data. Only show the placeholder if there's any
  // sleep history at all — otherwise the hero already explains the
  // empty state.
  const showCorrelationPlaceholder =
    correlationSeries === null && allNights.length >= 1 && rangedNights.length >= 1;

  return (
    <DetailShell
      vital="sleep"
      onBack={onBack}
      onRangeChange={setRange}
      testID="sleep-detail"
      hero={
        <VitalHero
          vital="sleep"
          primary={heroPrimary}
          secondary={hasLastNight ? 'hrs' : undefined}
          sub={heroSub}
          range={heroRange}
          ringFill={hasLastNight ? sleepFill(sleepScoreForSession(session)) : 0}
          testID="sleep-detail-hero"
        />
      }
    >
      {/* Sprint 18 — S1 + S3 fix. Caregiver-scoped first load shows a
          calm spinner instead of falsely claiming "No sleep recorded
          last night"; caregiver-scoped error surfaces a recoverable
          banner. Both branches REPLACE the body content; the hero
          above still renders so the persona header stays consistent. */}
      {isInitialParentLoad ? (
        <LoadingState testID="sleep-detail-loading" />
      ) : parentLoadError ? (
        <ErrorState
          onRetry={() => {
            void parentPulse.refresh();
            void parentRecent.refresh();
          }}
          testID="sleep-detail-error"
        />
      ) : (
        <>

          {/* Nightly chart for the selected range — shows historical
              context even when last night was missing. Sprint 18 S4:
              pass screen width so bars fill the card on any phone
              size instead of clustering left on wider devices. */}
          {allNights.length > 0 ? (
            <SleepNightlyBars
              sessions={allNights}
              range={range}
              width={screenWidth}
              testID="sleep-detail-nightly"
            />
          ) : null}
          {allNights.length > 0 ? (
            <ViewAsTableLink
              rows={allNights.map((n) => ({
                label: monthDayInZone(n.sessionEndSec * 1000, tz),
                value: `${Math.floor(n.totalMinutes / 60)}:${String(n.totalMinutes % 60).padStart(2, '0')} hrs`,
              }))}
              subjectNoun="nights"
              testID="sleep-detail-table"
              style={styles.correlationWrap}
            />
          ) : null}

          {correlationSeries ? (
            <View style={styles.correlationWrap}>
              <CorrelationStrip
                vitalA={correlationSeries.a}
                vitalB={correlationSeries.b}
                range={range}
                caption={`Sleep × morning BP — last ${RANGE_TO_DAYS[range]} days`}
                tBounds={(() => {
                  const nowMs = Date.now();
                  const days = RANGE_TO_DAYS[range];
                  return { tMin: nowMs - days * 24 * 60 * 60 * 1000, tMax: nowMs };
                })()}
                axisLabels={(() => {
                  const nowMs = Date.now();
                  const days = RANGE_TO_DAYS[range];
                  const startMs = nowMs - days * 24 * 60 * 60 * 1000;
                  const left = monthDayInZone(startMs, tz);
                  return { left, right: 'today' };
                })()}
                testID="sleep-detail-correlation"
              />
            </View>
          ) : showCorrelationPlaceholder ? (
            // Sprint 18 — P5 placeholder. Calm, explanatory; vital-tinted
            // border to match the other cards on the screen.
            <View
              style={[
                styles.correlationWrap,
                {
                  padding: theme.spacing.l,
                  borderRadius: theme.radii.l,
                  backgroundColor: theme.colors.surface.warmSubtle,
                  borderWidth: 0.5,
                  borderColor: theme.colors.border.rim,
                },
              ]}
              testID="sleep-detail-correlation-placeholder"
            >
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[
                  theme.type('labelUppercase'),
                  {
                    color: theme.colors.text.tertiary,
                    textTransform: 'uppercase',
                    marginBottom: theme.spacing.s,
                  },
                ]}
              >
                Sleep × morning BP
              </Text>
              <Text
                style={[
                  theme.type('bodyM'),
                  { color: theme.colors.text.secondary },
                ]}
              >
                A few more mornings of readings will let us chart how your sleep lines up with your morning BP.
              </Text>
            </View>
          ) : null}

          {/* D13 PR-11 (§6.6) — while the pair count is short of the
              engine's n≥14, the countdown says what is coming instead
              of leaving a silent gap. */}
          {!correlationSeries ? (
            <CorrelationCountdown
              pairedNights={Math.min(
                allNights.length,
                allReadings.length > 0 ? allNights.length : 0,
              )}
              testID="sleep-detail-correlation-countdown"
            />
          ) : null}

          {/* D13 PR-7 (§7.3) — the stage composition moves below the
              fold: the signature of this screen is the sleep→BP
              relationship above, not the hypnogram. */}
          {hasLastNight ? (
            <SleepStagesBar
              totalMinutes={totalMinutes}
              deepMinutes={deepMinutes}
              lightMinutes={lightMinutes}
              otherMinutes={otherMinutes}
              sessionStartSec={heroDisplay!.startSec}
              sessionEndSec={heroDisplay!.endSec}
              wakeSource={heroDisplay!.wakeSource}
              tz={tz}
              testID="sleep-detail-stages"
            />
          ) : null}
          {hasLastNight ? (
            <SleepStageApproxCaption testID="sleep-detail-stages-caption" />
          ) : null}

          <VitalInsightCard
            vital="sleep"
            body={insightBody(hasLastNight ? session : null, allNights.length)}
            testID="sleep-detail-insight"
          />
          <VitalExplainerAnchor
            context={{ type: 'sleep' }}
            onArticleOpen={onArticleOpen}
            onLearnOpen={onLearnOpen}
            testID="sleep-detail-explainer-anchor"
          />
          {recentRows.length > 0 ? (
            <RecentReadingsSection
              vital="sleep"
              eyebrow="Recent nights"
              readings={recentRows}
              testID="sleep-detail-recent"
            />
          ) : null}
          {onViewAllHistory && historyFamilyId ? (
            <ViewAllHistoryLink
              kind="sleep"
              familyId={historyFamilyId}
              range={range}
              onPress={() =>
                onViewAllHistory(range, historyFamilyId, tz)
              }
              testID="sleep-detail-view-all"
            />
          ) : null}
        </>
      )}
    </DetailShell>
  );
}

const styles = StyleSheet.create({
  correlationWrap: {
    marginHorizontal: 20,
  },
});


// D13 PR-7 (§7.3) — stage estimates are approximate (D9 other-003):
// the watch estimates stages from movement and heart rate. Trends
// matter more than any single night's breakdown.
function SleepStageApproxCaption({ testID }: { testID?: string }) {
  const theme = useTheme();
  const caption = theme.type('caption');
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[
        caption,
        {
          color: theme.colors.text.tertiary,
          marginHorizontal: 20,
          marginTop: theme.spacing.xs,
        },
      ]}
      testID={testID}
    >
      Stage estimates are approximate — the watch infers them from
      movement and heart rate. Night-to-night trends matter more than any
      single breakdown.
    </Text>
  );
}
