// ActivityDetail — Sprint 8.5 (vital-detail · activity), range-wired
// in Sprint 16.5e.
//
// Per-vital detail screen for steps + calories + move minutes. Sourced
// from leiko-detail-screens.jsx lines 360–507 (ActivityDetail). Composes
// the bespoke `ActivityRingsHero` (three concentric rings) + standard
// detail-screen primitives + the `ActivityWeeklyBars` chart + the
// `ActivityGoalSheet` picker.
//
// Sections (top → bottom):
//   1. ActivityRingsHero     — bespoke 3-ring hero (steps / calories / move)
//   2. StatTrio              — Daily avg / Best day / Streak (over range)
//   3. ActivityWeeklyBars    — daily bars for 7d; weekly aggregates for 30d/90d
//   4. VitalInsightCard      — Tier-B placeholder; Sprint 12.5 generates
//   5. RecentReadingsList    — recent days history within the range
//   6. Goal config row       — tap → ActivityGoalSheet
//
// 7d / 30d / 90d range (Sprint 16.5e):
//   The DetailShell-owned TimeRangePills are now wired here through
//   `setRange`. Switching range filters:
//     - the chart (daily bars for 7d, weekly aggregates otherwise)
//     - the stat trio (Daily avg + Best day computed over the range;
//       Streak still measured from today backwards, range-independent)
//     - the Recent-days list (all non-zero days within the range, no
//       hard cap — pre-16.5e the list was capped at today + 3, which
//       hid history the user had asked to see)
//   The hero is unaffected — it always shows today's progress.
//
// Empty state: when `stepsToday === 0` AND no non-zero days exist in
// the range we render a soft welcome ring + a single insight card + the
// goal-config row. Bars + stat trio + recent days hide.
//
// Voice rules (docs/05-voice-and-claims.md):
//   - "Daily avg", "Best day", "Streak (days at goal)" — factual.
//   - "days at goal" — supportive framing per Activity-specific anti-
//     patterns; no gamification verbs anywhere in the rendered tree.
//   - "Take a walk this evening to close the ring" / equivalent — calm
//     supportive nudge, not pushy.
//   - "Recent days" / "Daily step goal" — neutral section labels.
//
// Persistence note: Sprint 8.5 surfaces the goal-config sheet but does
// not persist the new goal. `useActivity.setTargetSteps` does not exist
// yet; Sprint 10 wires it. The screen accepts an optional `onGoalChange`
// override so the parent navigator can wire it earlier if needed.

import { useMemo, useState, useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DetailShell } from '../../components/DetailShell';
import { StatTrio } from '../../components/StatTrio';
import { ViewAsTableLink } from '../../components/ViewAsTableLink';
import { VitalInsightCard } from '../../components/VitalInsightCard';
import { VitalExplainerAnchor } from '../../components/VitalExplainerAnchor';
import { type RecentReading } from '../../components/RecentReadingsList';
import { RecentReadingsSection } from '../../components/RecentReadingsSection';
import { ActivityRingsHero } from '../../components/ActivityRingsHero';
import { ActivityWeeklyBars } from '../../components/ActivityWeeklyBars';
import { ActivityGoalSheet } from '../../components/ActivityGoalSheet';
import type { TrendRange } from '../../components/TimeRangePills';
import { useDailyPulseData, emptyDailyPulse } from '../../state/dailyPulse';
import { useParentDailyPulseData } from '../../hooks/useParentDailyPulseData';
import { useParentVitalsRecent } from '../../hooks/useParentVitalsRecent';
import { checkStaleness } from '../../utils/classification';
import { formatStalenessCaption } from '../../utils/stalenessCaption';
import { useActivity } from '../../state/activity';
import { useAuth } from '../../state/auth';
import { useOnboarding } from '../../state/onboarding';
import { ViewAllHistoryLink } from '../../components/ViewAllHistoryLink';
import { resolveTimeZone, hourInZone, dayKeyInZone } from '../../utils/timeInZone';
import { useTheme } from '../../theme';
import type { ActivityDay } from '../../types/vitals';
import { BaselineReference } from '../../components/BaselineReference';
import { StalenessHintRow } from '../../components/StalenessHintRow';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { MAX_FONT_SCALE } from '../../theme/fontScaling';
import {
  activityBaseline,
  formatActivityBaseline,
  type ActivityBaseline,
} from '../../utils/vitalBaselines';

export interface ActivityDetailProps {
  onBack: () => void;
  /** Sprint 10 wires real persistence; Sprint 8.5 callers may override. */
  onGoalChange?: (newGoal: number) => void;
  onArticleOpen?: (articleId: string) => void;
  onLearnOpen?: () => void;
  /** Sprint 17a — caregiver entry. When set, activity data sources
   *  swap to the parent-scoped query layer. */
  /** ADR-0008 follow-up — opens the full-window VitalHistory browse for
   *  the selected range. Router curries the vital kind. */
  onViewAllHistory?: (
    range: TrendRange,
    familyId: string,
    timeZone: string,
  ) => void;
  familyId?: string;
  /** Opens the For-your-doctor export (DetailShell renders the card). */
  onDoctorPress?: () => void;
}

// Indexed by Date.getUTCDay(): 0=Sun, 1=Mon, ..., 6=Sat.
const DAY_INITIALS_BY_WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const SECONDS_PER_DAY = 24 * 60 * 60;

const RANGE_TO_DAYS: Record<TrendRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

// Sprint 16.5f — deterministic insight bodies. The pre-fix
// PLACEHOLDER_INSIGHT_POPULATED was a hardcoded story about "four
// times this week + evening walk"; this version computes against the
// real numbers in `rangedDays`.

const PLACEHOLDER_INSIGHT_EMPTY =
  "Welcome. Once your steps start coming in, this is where you'll see how the day is shaping up — and a gentle nudge if you'd like one.";

const PLACEHOLDER_INSIGHT_PRE_BASELINE =
  "After a few days of activity, this card will compare your current pace to your usual and call out anything worth noting.";

/** Deterministic activity insight body — real "X met-goal days this
 *  week" / "your week is averaging Y/day vs your usual Z" framing. */
function activityInsightBody(
  rangedDays: ActivityDay[],
  goal: number,
  baseline: ActivityBaseline | null,
  windowLabel: string,
): string {
  if (rangedDays.length === 0 || baseline === null) {
    return PLACEHOLDER_INSIGHT_PRE_BASELINE;
  }
  // Founder-test fix (2026-08-19): the narration averaged over ALL
  // ranged days — including zero-step days, which are almost always
  // days the watch wasn't worn — while the stat trio and the baseline
  // median both average over days WITH data. Same number, same
  // denominator, everywhere: days with steps only.
  const daysWithData = rangedDays.filter((d) => d.totalSteps > 0);
  if (daysWithData.length === 0) return PLACEHOLDER_INSIGHT_PRE_BASELINE;
  const metGoal = daysWithData.filter((d) => d.totalSteps >= goal).length;
  const sum = daysWithData.reduce((a, b) => a + b.totalSteps, 0);
  const avgPerDay = Math.round(sum / daysWithData.length);
  const baselineDiff = avgPerDay - baseline.median;
  const absDiff = Math.abs(baselineDiff);

  // First line — met-goal frequency, honest about the window (it was
  // hardcoded to "this week" even on the 30/90-day ranges).
  const goalLine =
    metGoal === 0
      ? `No met-goal days yet ${windowLabel} — a gentle walk today would change that.`
      : metGoal === 1
        ? `You met your goal once ${windowLabel}.`
        : `You met your goal ${metGoal} times ${windowLabel}.`;

  // Second line — how the average compares to baseline.
  let compareLine: string;
  if (absDiff < 500) {
    compareLine = `Your daily average (${avgPerDay.toLocaleString()}) is right at your usual.`;
  } else if (baselineDiff > 0) {
    compareLine = `Your daily average (${avgPerDay.toLocaleString()}) is about ${absDiff.toLocaleString()} steps above your usual — a small lift.`;
  } else {
    compareLine = `Your daily average (${avgPerDay.toLocaleString()}) is about ${absDiff.toLocaleString()} steps below your usual.`;
  }
  return `${goalLine} ${compareLine}`;
}

const EMPTY_HERO_MESSAGE = 'Start moving to see your day fill in.';

export function ActivityDetail({
  onBack,
  onGoalChange,
  onArticleOpen,
  onLearnOpen,
  onViewAllHistory,
  familyId,
  onDoctorPress,
}: ActivityDetailProps) {
  // Same user timezone the rest of the app uses for day boundaries so
  // today's calories bucket matches the hero. Null → UTC.
  const timeZone = useAuth((s) => s.profile?.timezone ?? null);
  // Sprint 17a — both data sources called unconditionally.
  const ownPulse = useDailyPulseData();
  const ownRecentSteps = useActivity((s) => s.recentSteps);
  const ownPendingSteps = useActivity((s) => s.pendingSteps);
  const ownTodayCalories = useActivity((s) => s.todayCalories(undefined, timeZone));
  const ownRecentCalories = useActivity((s) => s.recentCalories);
  const ownPendingCalories = useActivity((s) => s.pendingCalories);
  const scopedFamilyId = familyId ?? null;
  const parentPulse = useParentDailyPulseData(scopedFamilyId);
  const parentRecent = useParentVitalsRecent(scopedFamilyId);
  // Day labels / "today" progress render in the wearer's tz on the caregiver
  // path, else the viewer's own. UTC last.
  const displayTimeZone = resolveTimeZone(
    scopedFamilyId ? parentPulse.wearerTimeZone ?? timeZone : timeZone,
  );
  // Family the full-window history is scoped to (ADR-0008 follow-up).
  const ownFamilyId = useOnboarding((s) => s.familyId);
  const historyFamilyId = scopedFamilyId ?? ownFamilyId;
  const emptyFallback = useMemo(() => emptyDailyPulse(), []);

  // Sprint 18 A1 — distinguish loading + error from "truly empty" on
  // the caregiver-scoped path (matches Sleep S1+S3 / HR H1 / BP B1 /
  // SpO2 SP1).
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
  const recentStepsRows = scopedFamilyId
    ? parentRecent.data.steps
    : ownRecentSteps;
  const pendingStepsRows = scopedFamilyId ? [] : ownPendingSteps;
  const recentCaloriesRows = scopedFamilyId
    ? parentRecent.data.calories
    : ownRecentCalories;
  const pendingCaloriesRows = scopedFamilyId ? [] : ownPendingCalories;
  // Parent path: find today's CaloriesDay from the server-fetched array.
  // The slice's `todayCalories()` method is replicated inline here.
  const parentTodayCalories = useMemo(() => {
    if (!scopedFamilyId) return null;
    const today = new Date().toISOString().slice(0, 10);
    return (
      parentRecent.data.calories.find((c) => c.dayLocal === today) ?? null
    );
  }, [parentRecent.data.calories, scopedFamilyId]);
  const todayCalories = scopedFamilyId ? parentTodayCalories : ownTodayCalories;
  const stepsToday = data.activity.stepsToday;
  const targetSteps = data.activity.targetSteps;

  // Sprint 16.5e — DetailShell's TimeRangePills are wired here. The
  // DetailShell still owns the internal state for the pills' appearance;
  // we mirror it so the screen's data selectors react to the choice.
  const [range, setRange] = useState<TrendRange>('7d');

  // ----- Chart series + recent-days source ---------------------------
  // For 7d we render the last 7 daily totals (today is the rightmost
  // bar). For 30d / 90d we aggregate into weekly bins so the bar count
  // stays legible on a phone screen.
  const chartSeries = useMemo(
    () => buildChartSeries(pendingStepsRows, recentStepsRows, targetSteps, range),
    [pendingStepsRows, recentStepsRows, targetSteps, range],
  );

  // ----- All non-zero days within the range, newest first ----------
  const rangedDays = useMemo(
    () => buildRangedDays(pendingStepsRows, recentStepsRows, range),
    [pendingStepsRows, recentStepsRows, range],
  );

  // ----- Today's calories + move minutes -----------------------------
  // Move ring is hidden in 16.5f — the U16PRO doesn't expose move
  // minutes. The watch's hourly step buckets are still all-zero per
  // Sprint 16.5a's open-bugs queue, so a "derived from hourly" estimate
  // would be 0 anyway. Drop the ring; revisit when hourly ingest lands.
  const caloriesToday = todayCalories?.activityKcal ?? null;
  const moveMinutesToday: number | null = null;

  // ----- Empty state detection ---------------------------------------
  const isEmpty = stepsToday === 0 && rangedDays.length === 0;

  // Sprint 16 — per D13 §6.6, stale when no step sync in last 6h. The
  // latest activity-day's `lastSampleAtSec` is the freshness signal.
  const activityStaleness = isEmpty
    ? 'no_data'
    : checkStaleness('activity', data.activity.latestSampleSec);
  const activityStaleCaption =
    activityStaleness === 'stale'
      ? formatStalenessCaption(data.activity.latestSampleSec)
      : null;

  // ----- Stat trio (over the chosen range) ---------------------------
  const dailyAvg = useMemo(() => {
    const non = rangedDays.filter((d) => d.totalSteps > 0);
    if (non.length === 0) return 0;
    return Math.round(
      non.reduce((a, b) => a + b.totalSteps, 0) / non.length,
    );
  }, [rangedDays]);

  const bestDay = useMemo(() => {
    let bestVal = 0;
    let bestLabel = rangeShortLabel(range);
    for (const d of rangedDays) {
      if (d.totalSteps > bestVal) {
        bestVal = d.totalSteps;
        bestLabel = dayContextLabel(d.dayLocal, range);
      }
    }
    return { value: bestVal, label: bestLabel };
  }, [rangedDays, range]);

  const streakDaysAtGoal = useMemo(
    () =>
      // Streak is a "current run" — always measured from today
      // backwards. Range-independent. 16.5f allows 1 skip per 7 met-
      // goal days so a single rest day doesn't reset the streak.
      computeStreakFromToday(rangedDays, targetSteps),
    [rangedDays, targetSteps],
  );

  // ----- Baseline reference (16.5f) -----------------------------------
  const baseline: ActivityBaseline | null = useMemo(
    () => activityBaseline(recentStepsRows),
    [recentStepsRows],
  );
  const baselineBody = baseline ? formatActivityBaseline(baseline) : '';

  // ----- Weekly calories total (16.5f) --------------------------------
  // Sum the active kcal over the last 7 days to surface a weekly
  // calorie stat below the StatTrio. The activity slice tracks
  // recentCalories per day; we use it directly.
  const weeklyActiveKcal = useMemo(() => {
    const all = [...pendingCaloriesRows, ...recentCaloriesRows];
    if (all.length === 0) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec - 7 * SECONDS_PER_DAY;
    const window = all.filter((c) => c.measuredAtSec >= cutoff);
    if (window.length === 0) return null;
    return Math.round(window.reduce((a, b) => a + b.activityKcal, 0));
  }, [pendingCaloriesRows, recentCaloriesRows]);

  // ----- Recent-days list (no hard cap) ------------------------------
  const recentReadings = useMemo<RecentReading[]>(
    () => buildRecentReadings(stepsToday, rangedDays, targetSteps, displayTimeZone),
    [stepsToday, rangedDays, targetSteps, displayTimeZone],
  );

  // ----- Goal sheet --------------------------------------------------
  const [goalSheetOpen, setGoalSheetOpen] = useState(false);
  const handleGoalSubmit = useCallback(
    (newGoal: number) => {
      onGoalChange?.(newGoal);
    },
    [onGoalChange],
  );

  return (
    <>
      <DetailShell
        onDoctorPress={onDoctorPress}
        vital="activity"
        onBack={onBack}
        onRangeChange={setRange}
        testID="activity-detail"
        hero={
          <ActivityRingsHero
            steps={stepsToday}
            target={targetSteps}
            calories={caloriesToday}
            moveMinutes={moveMinutesToday}
            hideMoveRing
            empty={isEmpty}
            emptyMessage={isEmpty ? EMPTY_HERO_MESSAGE : undefined}
            staleCaption={activityStaleCaption}
            testID="activity-detail-hero"
          />
        }
      >
        {/* Sprint 18 A1 — caregiver-scoped loading + error swap-in.
            Mirrors Sleep / HR / BP / SpO2. The hero above still
            renders so the persona header stays consistent. */}
        {isInitialParentLoad ? (
          <LoadingState testID="activity-detail-loading" />
        ) : parentLoadError ? (
          <ErrorState
            onRetry={() => {
              void parentPulse.refresh();
              void parentRecent.refresh();
            }}
            testID="activity-detail-error"
          />
        ) : (
        <>
        {!isEmpty && baselineBody ? (
          <BaselineReference
            body={baselineBody}
            eyebrow="Your typical day"
            caption={`based on ${baseline?.sampleCount ?? 30} days of activity`}
            testID="activity-detail-baseline"
          />
        ) : null}
        <StalenessHintRow
          stale={activityStaleness === 'stale'}
          testID="activity-detail-staleness-hint"
        />
        {!isEmpty ? (
          <StatTrio
            testID="activity-detail-stat-trio"
            items={[
              {
                label: 'Daily avg',
                value: dailyAvg.toLocaleString(),
                unit: `steps · ${rangeShortLabel(range)}`,
              },
              {
                label: 'Best day',
                value: bestDay.value > 0 ? bestDay.value.toLocaleString() : '—',
                unit: bestDay.label,
              },
              {
                label: 'Streak',
                value: streakDaysAtGoal.toString(),
                unit: 'days at goal',
              },
            ]}
          />
        ) : null}

        {!isEmpty ? (
          <ActivityWeeklyBars
            days={chartSeries.values}
            dayLabels={chartSeries.labels}
            goal={chartSeries.goal}
            title={chartTitle(range)}
            testID="activity-detail-weekly-bars"
          />
        ) : null}

        <VitalInsightCard
          vital="activity"
          body={
            isEmpty
              ? PLACEHOLDER_INSIGHT_EMPTY
              : activityInsightBody(rangedDays, targetSteps, baseline, rangeWindowLabel(range))
          }
          testID="activity-detail-insight"
        />

        <VitalExplainerAnchor
          context={{ type: 'activity' }}
          onArticleOpen={onArticleOpen}
          onLearnOpen={onLearnOpen}
          testID="activity-detail-explainer-anchor"
        />

        {!isEmpty && weeklyActiveKcal !== null ? (
          <WeeklyCaloriesRow kcal={weeklyActiveKcal} />
        ) : null}

        {!isEmpty && rangedDays.length > 0 ? (
          <ViewAsTableLink
            rows={rangedDays.map((d) => ({
              label: d.dayLocal,
              value: `${d.totalSteps.toLocaleString()} steps`,
            }))}
            subjectNoun="days"
            testID="activity-detail-table"
            style={{ marginHorizontal: 20 }}
          />
        ) : null}
        {!isEmpty ? (
          <RecentReadingsSection
            vital="activity"
            eyebrow="Recent days"
            readings={recentReadings}
            testID="activity-detail-recent"
          />
        ) : null}
          {onViewAllHistory && historyFamilyId ? (
            <ViewAllHistoryLink
              kind="activity"
              familyId={historyFamilyId}
              range={range}
              onPress={() =>
                onViewAllHistory(range, historyFamilyId, displayTimeZone)
              }
              testID="activity-detail-view-all"
            />
          ) : null}

        <GoalConfigSection
          currentGoal={targetSteps}
          onPress={() => setGoalSheetOpen(true)}
        />
        </>
        )}
      </DetailShell>
      <ActivityGoalSheet
        open={goalSheetOpen}
        currentGoal={targetSteps}
        onSubmit={handleGoalSubmit}
        onClose={() => setGoalSheetOpen(false)}
        testID="activity-detail-goal-sheet"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Section: Goal config tappable row (label above + opener row below)
// ---------------------------------------------------------------------------

interface GoalConfigSectionProps {
  currentGoal: number;
  onPress: () => void;
}

function GoalConfigSection({ currentGoal, onPress }: GoalConfigSectionProps) {
  const theme = useTheme();
  const labelStyle = theme.type('labelUppercase');
  const valueStyle = theme.type('numericM');

  return (
    <View>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: labelStyle.family,
          fontSize: labelStyle.size,
          lineHeight: labelStyle.lineHeight,
          letterSpacing: labelStyle.letterSpacing,
          color: theme.colors.text.tertiary,
          textTransform: 'uppercase',
          marginHorizontal: 20,
          marginBottom: theme.spacing.s,
        }}
      >
        Daily step goal
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Daily step goal, ${currentGoal.toLocaleString()} steps. Tap to change.`}
        onPress={onPress}
        hitSlop={6}
        testID="activity-detail-goal-row"
        style={({ pressed }) => [
          styles.goalRow,
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
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: theme.fontFamilies.editorial,
              fontSize: valueStyle.size,
              lineHeight: valueStyle.lineHeight,
              color: theme.colors.text.primary,
            }}
          >
            {currentGoal.toLocaleString()}
          </Text>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: 11,
              color: theme.colors.text.tertiary,
              letterSpacing: 0.4,
              marginTop: 2,
              textTransform: 'uppercase',
            }}
          >
            steps · tap to change
          </Text>
        </View>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: 22,
            color: theme.colors.text.tertiary,
          }}
        >
          ›
        </Text>
      </Pressable>
      {/* D13 PR-7 (§7.3) — goal framing uses the 7,000–9,000 step
          evidence for older adults, not the 10,000 marketing legacy
          (D9 other-004). Consistency over intensity. */}
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: theme.fontFamilies.body,
          fontSize: 13,
          lineHeight: 18,
          color: theme.colors.text.tertiary,
          marginHorizontal: 20,
          marginTop: theme.spacing.s,
        }}
        testID="activity-detail-goal-framing"
      >
        The famous ten-thousand figure is marketing, not medicine — the
        evidence for older adults supports benefit at 7,000–9,000 steps a
        day. Steady weeks matter more than big days.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests.
// ---------------------------------------------------------------------------

const FULL_DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export interface ChartSeries {
  /** Values for each bar, oldest first. Length depends on range. */
  values: number[];
  /** Short labels for each bar, matching `values`. */
  labels: string[];
  /** Goal line — for 7d this is the daily goal; for weekly aggregates
   *  this is the WEEKLY goal (daily × 7). */
  goal: number;
}

function todayKey(nowSec: number): string {
  return new Date(nowSec * 1000).toISOString().slice(0, 10);
}

function dayKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

function shortMonthDay(date: Date): string {
  return `${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "this week" / "this month" / "these 90 days" — the insight's
 *  honest window phrasing. */
export function rangeWindowLabel(range: TrendRange): string {
  switch (range) {
    case '7d':
      return 'this week';
    case '30d':
      return 'this month';
    case '90d':
      return 'these 90 days';
  }
}

export function rangeShortLabel(range: TrendRange): string {
  switch (range) {
    case '7d':
      return 'week';
    case '30d':
      return 'month';
    case '90d':
      return '90 days';
  }
}

export function chartTitle(range: TrendRange): string {
  switch (range) {
    case '7d':
      return 'This week vs goal';
    case '30d':
      return 'Last 30 days · weekly';
    case '90d':
      return 'Last 90 days · weekly';
  }
}

/** Build the chart series matching the selected range. For 7d we keep
 *  the original daily-bar layout (today is the rightmost bar, empty
 *  days zero-filled). For 30d / 90d we group consecutive 7-day windows
 *  ending today into weekly aggregates so the bar count stays legible
 *  (4-5 bars at 30d, 12-13 at 90d). */
export function buildChartSeries(
  pending: ActivityDay[],
  recent: ActivityDay[],
  dailyGoal: number,
  range: TrendRange,
  nowSec: number = Math.floor(Date.now() / 1000),
): ChartSeries {
  const all = [...pending, ...recent];
  const byDay = new Map<string, ActivityDay>();
  for (const d of all) {
    if (!byDay.has(d.dayLocal)) byDay.set(d.dayLocal, d);
  }
  if (range === '7d') {
    const values: number[] = [];
    const labels: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const t = nowSec - i * SECONDS_PER_DAY;
      const key = todayKey(t);
      const day = byDay.get(key);
      values.push(day?.totalSteps ?? 0);
      labels.push(DAY_INITIALS_BY_WEEKDAY[new Date(t * 1000).getUTCDay()] ?? '');
    }
    return { values, labels, goal: dailyGoal };
  }
  const totalDays = RANGE_TO_DAYS[range];
  const binCount = Math.ceil(totalDays / 7);
  const values: number[] = [];
  const labels: string[] = [];
  // Sprint 16.5f — bin values are the AVERAGE daily step count over
  // the days in that bin (was: total). The total made the chart read
  // wrong against a `dailyGoal × 7` line — a 56k weekly bar next to a
  // 56k goal line looked like "just barely". Now each bar reads like
  // "this week, you averaged 8.4k/day" — directly comparable to the
  // daily goal line. The goal stays at `dailyGoal` (was `dailyGoal × 7`).
  for (let bin = binCount - 1; bin >= 0; bin--) {
    let total = 0;
    let count = 0;
    let endKeyDate: Date | null = null;
    for (let d = 0; d < 7; d++) {
      const offset = bin * 7 + d;
      if (offset >= totalDays) break;
      const t = nowSec - offset * SECONDS_PER_DAY;
      const key = todayKey(t);
      const day = byDay.get(key);
      if (day && day.totalSteps > 0) {
        total += day.totalSteps;
        count += 1;
      }
      if (endKeyDate === null) endKeyDate = dayKeyToDate(key);
    }
    values.push(count > 0 ? Math.round(total / count) : 0);
    labels.push(endKeyDate ? shortMonthDay(endKeyDate) : '');
  }
  return { values, labels, goal: dailyGoal };
}

/** All days within the range, newest first. Includes days with zero
 *  steps so the empty-state heuristic + the Recent-days context lines
 *  can choose what to show. Today is always the first entry when a
 *  pending row for today exists. */
export function buildRangedDays(
  pending: ActivityDay[],
  recent: ActivityDay[],
  range: TrendRange,
  nowSec: number = Math.floor(Date.now() / 1000),
): ActivityDay[] {
  const days = RANGE_TO_DAYS[range];
  const all = [...pending, ...recent];
  const byDay = new Map<string, ActivityDay>();
  for (const d of all) {
    if (!byDay.has(d.dayLocal)) byDay.set(d.dayLocal, d);
  }
  const out: ActivityDay[] = [];
  for (let i = 0; i < days; i++) {
    const t = nowSec - i * SECONDS_PER_DAY;
    const key = todayKey(t);
    const day = byDay.get(key);
    if (day) out.push(day);
  }
  return out;
}

/** Walk back from today, count consecutive met-goal days. Sprint 16.5f
 *  allows ONE skip day per 7 met-goal days so a single rest day doesn't
 *  reset the streak. Rationale: an unforgiving streak punishes a
 *  meaningful rest day; the "consecutive met-goal days" interpretation
 *  stays intuitive while being kinder to real-life patterns. */
export function computeStreakFromToday(
  rangedDays: ActivityDay[],
  targetSteps: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): number {
  if (rangedDays.length === 0) return 0;
  const byDay = new Map<string, ActivityDay>();
  for (const d of rangedDays) byDay.set(d.dayLocal, d);
  let count = 0;
  let skipsAvailable = 1; // 1 skip per current streak run
  for (let i = 0; i < rangedDays.length; i++) {
    const t = nowSec - i * SECONDS_PER_DAY;
    const key = todayKey(t);
    const day = byDay.get(key);
    const metGoal = day && day.totalSteps >= targetSteps;
    if (metGoal) {
      count += 1;
      // Replenish skip every 7 met-goal days (so longer streaks earn
      // more grace).
      if (count > 0 && count % 7 === 0) skipsAvailable = 1;
    } else if (skipsAvailable > 0 && i > 0) {
      // Use a skip — streak continues but day isn't counted.
      skipsAvailable -= 1;
    } else {
      break;
    }
  }
  return count;
}

function dayContextLabel(dayLocal: string, range: TrendRange): string {
  const todayKeyStr = new Date().toISOString().slice(0, 10);
  if (dayLocal === todayKeyStr) return 'Today';
  const date = dayKeyToDate(dayLocal);
  if (range === '7d') {
    return FULL_DAY_NAMES[date.getUTCDay()];
  }
  return shortMonthDay(date);
}

/** Pre-16.5e this function capped at "today + 3 prior days". The cap
 *  silently hid history the user had asked to see. Now we surface every
 *  non-zero day within the selected range, newest first.
 *
 *  Sprint 16.5f — "Today" context is now time-of-day aware (was always
 *  "Today · in progress" regardless of hour). And historical days show
 *  "Today · met goal" or "Today · light day so far" depending on
 *  whether today is met-goal-yet. */
export function buildRecentReadings(
  stepsToday: number,
  rangedDays: ActivityDay[],
  goal: number,
  timeZone: string,
  nowMs: number = Date.now(),
): RecentReading[] {
  // Time-of-day + "today" key in the wearer's tz (was device getHours / UTC
  // toISOString, which mislabelled the day's progress near local midnight).
  const hour = hourInZone(nowMs, timeZone);
  const todayKeyStr = dayKeyInZone(nowMs, timeZone);
  const rows: RecentReading[] = [];

  // Today is always the first row. Sprint 16.5f — context is time-of-day
  // aware. "in progress" feels wrong at 11pm; "today so far" feels right.
  let todayContext: string;
  if (stepsToday >= goal) {
    todayContext = 'Today · met goal';
  } else if (hour < 12) {
    todayContext = 'Today · in progress';
  } else if (hour < 19) {
    todayContext = 'Today · so far';
  } else if (stepsToday > 0) {
    todayContext = 'Today · light day';
  } else {
    todayContext = 'Today · no steps yet';
  }
  rows.push({
    id: 'today',
    value: stepsToday > 0 ? stepsToday.toLocaleString() : '—',
    context: todayContext,
    time: 'now',
  });

  // Every other day with non-zero steps, oldest excluded only when zero.
  for (const day of rangedDays) {
    if (day.dayLocal === todayKeyStr) continue;
    if (day.totalSteps === 0) continue;
    const date = dayKeyToDate(day.dayLocal);
    const dayName = FULL_DAY_NAMES[date.getUTCDay()];
    const meets = day.totalSteps >= goal;
    // Sprint 16.5f — include date in context so "Wednesday" is no longer
    // ambiguous (this Wed vs last Wed).
    const dateLabel = shortMonthDay(date);
    const ctx = meets
      ? `${dayName} · met goal`
      : `${dayName} · light day`;
    rows.push({
      id: `day-${day.dayLocal}`,
      value: day.totalSteps.toLocaleString(),
      context: ctx,
      time: dateLabel,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Sprint 16.5f — WeeklyCaloriesRow: surfaces the active-kcal total
// from the last 7 days. The activity hydration in 16.5e populates the
// calories slice; this is the first place ActivityDetail exposes it
// outside the hero ring.
// ---------------------------------------------------------------------------

interface WeeklyCaloriesRowProps {
  kcal: number;
}

function WeeklyCaloriesRow({ kcal }: WeeklyCaloriesRowProps) {
  const theme = useTheme();
  const labelStyle = theme.type('labelUppercase');
  const valueStyle = theme.type('numericM');
  return (
    <View
      style={{
        marginHorizontal: 20,
        paddingHorizontal: theme.spacing.l,
        paddingVertical: theme.spacing.m,
        backgroundColor: theme.colors.surface.warmSubtle,
        borderColor: theme.colors.border.rim,
        borderWidth: 0.5,
        borderRadius: theme.radii.l,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
      testID="activity-detail-weekly-calories"
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: labelStyle.family,
          fontSize: labelStyle.size,
          lineHeight: labelStyle.lineHeight,
          letterSpacing: labelStyle.letterSpacing,
          color: theme.colors.text.tertiary,
          textTransform: 'uppercase',
        }}
      >
        Weekly calories
      </Text>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: theme.fontFamilies.editorial,
          fontSize: valueStyle.size,
          lineHeight: valueStyle.lineHeight,
          color: theme.colors.text.primary,
        }}
      >
        {kcal.toLocaleString()} kcal
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0.5,
  },
});
