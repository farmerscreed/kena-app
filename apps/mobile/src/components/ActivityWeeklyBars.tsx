// ActivityWeeklyBars — Sprint 8.5 (vital-detail · activity).
//
// Bar chart for the activity detail screen. Translates the JSX in
// leiko-detail-screens.jsx lines 440–488: a card surface with seven
// vertical bars + a dashed goal line + a "goal Xk" label right-aligned
// + day initials along the bottom.
//
// Bars:
//   - Each bar's height ratio is `value / scaleMax`, where scaleMax is
//     max(goal * 1.5, max(values), 1) so a goal day reaches ~67% of card
//     height and a beat-the-goal day still has visual room above the
//     dashed line.
//   - Above goal: full activity color. Below: 55% opacity activity
//     color.
//   - Today (last index) receives a 0.5pt vital-color border.
//   - Each bar's scaleY enters 0→1 with a stagger of 70ms per bar
//     (cinematic ease).
//
// Dashed goal line: a horizontal absolute-positioned View at the goal-
// fraction y-offset; uses borderTopWidth + borderStyle 'dashed' to mimic
// the design's dashed treatment.
//
// Voice rules (docs/05-voice-and-claims.md):
//   - "This week vs goal" — section eyebrow, calm + factual.
//   - "goal {N}k" — fact label, no urgency framing.
//
// Pure helper `barHeightRatio` is exported for unit tests.

import { useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';

const CARD_HEIGHT = 120;
const BAR_AREA_BOTTOM_INSET = 18; // room for day labels under bars
const BAR_GAP = 8;
const ENTRY_DURATION_MS = 800;
const ENTRY_STAGGER_MS = 70;
const ENTRY_EASING = Easing.bezier(0.22, 1, 0.36, 1);

export interface ActivityWeeklyBarsProps {
  /** Daily step counts, oldest first. Today is the last index. 7 bars
   *  for the 7d range; weekly aggregates for 30d / 90d. */
  days: number[];
  /** Labels matching `days` — single-character initials for 7d, short
   *  month-day strings ("May 7") for weekly aggregates. */
  dayLabels: string[];
  /** Step goal — daily for 7d, weekly total for the aggregated ranges.
   *  Used for the dashed line + above/below tinting. */
  goal: number;
  /** Section eyebrow above the card. Defaults to "This week vs goal". */
  title?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Bar height as a fraction of the card body. Pure for tests. */
export function barHeightRatio(
  value: number,
  values: number[],
  goal: number,
): number {
  const valuesMax = values.length > 0 ? Math.max(...values) : 0;
  // Scale floor: enough room above the goal line so goal-day + above-
  // goal-day differ visually. 1.5 × goal matches the design's intent
  // (a 9100-step day reads as comfortably above the 8000 line).
  const scaleMax = Math.max(goal * 1.5, valuesMax, 1);
  if (scaleMax <= 0) return 0;
  return Math.max(0, Math.min(1, value / scaleMax));
}

/** Goal-line y-offset as a fraction (0 = top, 1 = bottom of body). */
export function goalLineFraction(goal: number, values: number[]): number {
  const valuesMax = values.length > 0 ? Math.max(...values) : 0;
  const scaleMax = Math.max(goal * 1.5, valuesMax, 1);
  if (scaleMax <= 0) return 1;
  // Bar height grows from the bottom; the goal line is at (1 - goal/max)
  // from the top.
  return Math.max(0, Math.min(1, 1 - goal / scaleMax));
}

/**
 * Audit P1-6 — composes the chart's spoken description. This component had
 * zero accessibility props, so a screen-reader user heard the seven day
 * initials ("M", "T", "W"…) and the string "goal 8k", and nothing that
 * explained what the bars were. Exported so the sentence is unit-testable.
 *
 * Calm and factual per docs/05-voice-and-claims.md: it reports how many
 * days met the goal without praising or scolding.
 */
export function composeActivityWeeklyAccessibilityLabel(
  days: number[],
  goal: number,
  title: string,
): string {
  // Titles are written without terminal punctuation ("This week vs
  // goal"); strip it if a caller supplies one so the sentence reads clean.
  const head = title.trim().replace(/[.!?]+$/, '');
  if (days.length === 0) {
    return `${head}. Steps appear here once the watch has a day of activity to show.`;
  }
  const low = Math.min(...days);
  const high = Math.max(...days);
  const met = days.filter((d) => d >= goal).length;
  const dayWord = days.length === 1 ? 'day' : 'days';
  const metClause =
    met === 0
      ? `No day reached the goal of ${goal.toLocaleString()} steps.`
      : met === days.length
        ? `Every one reached the goal of ${goal.toLocaleString()} steps.`
        : `${met} of them reached the goal of ${goal.toLocaleString()} steps.`;
  const spread =
    low === high
      ? `Each ${dayWord} was ${low.toLocaleString()} steps.`
      : `Steps ranged from ${low.toLocaleString()} to ${high.toLocaleString()}.`;
  return `${head}. ${days.length} ${dayWord} shown. ${spread} ${metClause}`;
}

export function ActivityWeeklyBars({
  days,
  dayLabels,
  goal,
  title = 'This week vs goal',
  testID,
  style,
}: ActivityWeeklyBarsProps) {
  const theme = useTheme();
  const labelStyle = theme.type('labelUppercase');
  const sectionLabelStyle = theme.type('labelUppercase');
  const vitalColor = theme.colors.vital.activity;

  const goalLabel = `goal ${Math.round(goal / 1000)}k`;

  // Audit P1-6.
  const a11yLabel = composeActivityWeeklyAccessibilityLabel(days, goal, title);

  return (
    // Audit P1-6 — one accessible element with one composed sentence.
    // `accessible` is explicit: without it iOS may not expose this View as
    // a single element, and the label would never be spoken.
    <View
      style={style}
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
    >
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: sectionLabelStyle.family,
          fontSize: sectionLabelStyle.size,
          lineHeight: sectionLabelStyle.lineHeight,
          letterSpacing: sectionLabelStyle.letterSpacing,
          color: theme.colors.text.tertiary,
          textTransform: 'uppercase',
          marginHorizontal: 20,
          marginBottom: theme.spacing.s,
        }}
        testID={testID ? `${testID}-section-label` : undefined}
      >
        {title}
      </Text>
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface.warmSubtle,
            borderColor: theme.colors.border.rim,
            borderRadius: theme.radii.l,
            marginHorizontal: 20,
            padding: theme.spacing.l,
          },
        ]}
      >
        {/* Audit P1-6 — the bars, the goal line and the day initials are
            decorative once the composed label above describes them; left
            exposed they read as a stream of single letters. */}
        <View
          style={[
            styles.body,
            { height: CARD_HEIGHT, paddingBottom: BAR_AREA_BOTTOM_INSET, gap: BAR_GAP },
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {/* Dashed goal line */}
          <GoalLine
            goal={goal}
            values={days}
            color={theme.colors.border.subtle}
            label={goalLabel}
            labelColor={theme.colors.text.tertiary}
            labelFontFamily={theme.fontFamilies.numeric}
            labelLetterSpacing={labelStyle.letterSpacing}
          />
          {days.map((value, idx) => {
            const isToday = idx === days.length - 1;
            const meetsGoal = value >= goal;
            const ratio = barHeightRatio(value, days, goal);
            return (
              <BarColumn
                key={`bar-${idx}`}
                ratio={ratio}
                color={vitalColor}
                meetsGoal={meetsGoal}
                isToday={isToday}
                indexForStagger={idx}
                dayLabel={dayLabels[idx] ?? ''}
                labelFontFamily={theme.fontFamilies.numeric}
                labelLetterSpacing={labelStyle.letterSpacing}
                todayColor={theme.colors.text.primary}
                otherDayColor={theme.colors.text.tertiary}
                testID={testID ? `${testID}-bar-${idx}` : undefined}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

interface BarColumnProps {
  ratio: number;
  color: string;
  meetsGoal: boolean;
  isToday: boolean;
  indexForStagger: number;
  dayLabel: string;
  labelFontFamily: string;
  labelLetterSpacing: number | undefined;
  todayColor: string;
  otherDayColor: string;
  testID?: string;
}

function BarColumn({
  ratio,
  color,
  meetsGoal,
  isToday,
  indexForStagger,
  dayLabel,
  labelFontFamily,
  labelLetterSpacing,
  todayColor,
  otherDayColor,
  testID,
}: BarColumnProps) {
  const reduceMotion = useReducedMotion();
  const scaleY = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      scaleY.value = 1;
      return;
    }
    scaleY.value = 0;
    scaleY.value = withDelay(
      500 + indexForStagger * ENTRY_STAGGER_MS,
      withTiming(1, { duration: ENTRY_DURATION_MS, easing: ENTRY_EASING }),
    );
  }, [reduceMotion, indexForStagger, scaleY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scaleY.value }],
  }));

  return (
    <View style={styles.barColumn} testID={testID}>
      <View style={styles.barTrack}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bar,
            {
              backgroundColor: color,
              opacity: meetsGoal ? 1 : 0.55,
              height: `${ratio * 100}%`,
              borderColor: isToday ? color : 'transparent',
              borderWidth: isToday ? 0.5 : 0,
            },
            animatedStyle,
          ]}
        />
      </View>
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: labelFontFamily,
          fontSize: 8.5,
          letterSpacing: labelLetterSpacing,
          color: isToday ? todayColor : otherDayColor,
          textTransform: 'uppercase',
          marginTop: 4,
        }}
      >
        {dayLabel}
      </Text>
    </View>
  );
}

interface GoalLineProps {
  goal: number;
  values: number[];
  color: string;
  label: string;
  labelColor: string;
  labelFontFamily: string;
  labelLetterSpacing: number | undefined;
}

function GoalLine({
  goal,
  values,
  color,
  label,
  labelColor,
  labelFontFamily,
  labelLetterSpacing,
}: GoalLineProps) {
  const fraction = goalLineFraction(goal, values);
  const usableHeight = CARD_HEIGHT - BAR_AREA_BOTTOM_INSET;
  const top = fraction * usableHeight;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.goalLine,
        {
          top,
          borderTopColor: color,
        },
      ]}
      testID="activity-weekly-bars-goal-line"
    >
      <Text
        allowFontScaling={false}
        style={{
          position: 'absolute',
          right: 0,
          top: -14,
          fontFamily: labelFontFamily,
          fontSize: 8.5,
          letterSpacing: labelLetterSpacing,
          color: labelColor,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0.5,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    position: 'relative',
  },
  barColumn: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barTrack: {
    flex: 1,
    width: '100%',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    flexDirection: 'row',
  },
  bar: {
    width: '100%',
    borderRadius: 4,
    transformOrigin: 'bottom',
  },
  goalLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    borderTopWidth: 1,
    borderStyle: 'dashed',
  },
});
