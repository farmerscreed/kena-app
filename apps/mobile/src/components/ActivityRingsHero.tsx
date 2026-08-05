// ActivityRingsHero — Sprint 8.5 (vital-detail · activity).
//
// Bespoke hero block for `ActivityDetail`. Replaces the standard
// `VitalHero` because the activity design (leiko-detail-screens.jsx
// lines 360–429) shows three concentric rings rather than the single
// ring + value pair every other vital uses.
//
// Layout matches `VitalHero` chrome:
//   - Same paddingHorizontal: 20, paddingTop: 12, paddingBottom: 22
//   - Same vital-tinted top glow (static — the hero already animates the
//     three rings on mount; an additional breathing glow would feel busy)
//
// Right column copy:
//   - "Today" eyebrow (mono uppercase 9.5pt — labelUppercase token)
//   - Giant `{steps.toLocaleString()}` (numericXl)
//   - "steps · {pct}% of {target.toLocaleString()}" (mono uppercase, vital
//     color)
//
// Dot legend below the row: Steps + Calories + Move (each rendering a
// vital-tinted dot, the label, and the value). Calories / move minutes
// fall back to "—" when the consumer passes null/undefined.
//
// Voice rules (docs/05-voice-and-claims.md):
//   - "Today", "Steps", "Calories", "Move", "steps · X% of Y"
//   - Empty-state callsite passes "—" + a supportive sentence we ship as
//     a placeholder prop (consumer-supplied, voice-checked at the call
//     site).
//
// Pure helper `activityRingFill` is exported so the screen + tests can
// share one source of truth with the existing `activityFill` in
// `utils/vitalThemes.ts`. Same formula; aliased for the bespoke hero.

import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { VitalRing } from './VitalRing';
import { useTheme } from '../theme';

const RING_OUTER_DIAMETER = 120;
const RING_OUTER_STROKE = 6;
const RING_MID_DIAMETER = 96;
const RING_MID_STROKE = 5;
const RING_INNER_DIAMETER = 72;
const RING_INNER_STROKE = 4;

// Calories + move-minutes targets used to drive the secondary rings.
// Sprint 8.5 ships activity tracking as steps-only persistence (calories
// + move minutes are synthesised when present, otherwise null). Defaults
// here are reasonable middle-of-the-day targets — Sprint 10 lets the user
// override them.
const DEFAULT_CALORIES_TARGET = 600;
const DEFAULT_MOVE_TARGET_MIN = 30;

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Pure helper: ring fill for the activity hero. Mirrors `activityFill`
 *  in utils/vitalThemes.ts; aliased here so the bespoke hero + tests
 *  import a single function. */
export function activityRingFill(value: number, target: number): number {
  if (target <= 0) return 0;
  return clamp01(value / target);
}

export interface ActivityRingsHeroProps {
  steps: number;
  target: number;
  /** Optional active calories. Null = render legend value as "—" and
   *  fill the calories ring at 0. */
  calories?: number | null;
  /** Optional move minutes. Null = render legend value as "—" and fill
   *  the move ring at 0. */
  moveMinutes?: number | null;
  /** Sprint 16.5f — when true, render only outer + middle rings (steps
   *  + calories) and drop the Move legend item. The U16PRO doesn't
   *  expose move minutes today; ActivityDetail passes true so the
   *  permanently-empty move ring isn't shown. */
  hideMoveRing?: boolean;
  /** When true, replaces the giant step count + percent line with "—"
   *  and a soft welcome sub. Empty state for first-day users. */
  empty?: boolean;
  /** Welcome line shown only when `empty=true`. Voice-checked at the
   *  call site. */
  emptyMessage?: string;
  /** Sprint 16 — calm "Last sync 4h ago" caption surfaced when the
   *  activity vital crosses D13 §6.6's 6h staleness threshold. Shown
   *  below the step count in tertiary text. Voice-checked at the
   *  call site. */
  staleCaption?: string | null;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function ActivityRingsHero({
  steps,
  target,
  calories = null,
  moveMinutes = null,
  hideMoveRing = false,
  empty = false,
  emptyMessage,
  staleCaption,
  testID,
  style,
}: ActivityRingsHeroProps) {
  const theme = useTheme();
  const labelStyle = theme.type('labelUppercase');
  const numericXl = theme.type('numericXl');
  const captionStyle = theme.type('caption');

  const stepsColor = theme.colors.vital.activity;
  // Distinct hues for the inner two rings — kept as compile-time hex
  // because design uses oklch values that don't translate to RN; these
  // values are the closest sRGB equivalents the design tokens already
  // expose elsewhere.
  const caloriesColor = '#E8C063';
  const moveColor = '#E89063';

  const stepsFill = activityRingFill(steps, target);
  const caloriesFill = activityRingFill(calories ?? 0, DEFAULT_CALORIES_TARGET);
  const moveFill = activityRingFill(moveMinutes ?? 0, DEFAULT_MOVE_TARGET_MIN);

  const pct = Math.round(stepsFill * 100);
  const formattedSteps = empty ? '—' : steps.toLocaleString();
  const subLine = empty
    ? null
    : `steps · ${pct}% of ${target.toLocaleString()}`;

  // Accessibility composes a sentence from the visual elements.
  const a11yLabel = empty
    ? `Today, ${formattedSteps}. ${emptyMessage ?? ''}`.trim()
    : `Today, ${formattedSteps} steps. ${pct}% of ${target.toLocaleString()}.`;

  const formatLegendValue = (val: number | null, suffix: string): string =>
    val === null ? '—' : `${val.toLocaleString()}${suffix}`;

  return (
    <View
      // Audit P1-6 — `accessible` added explicitly. A View carrying a
      // composed accessibilityLabel without it is not guaranteed to be
      // exposed as a single element on iOS, which would silence the label.
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
      style={[styles.root, style]}
      testID={testID}
    >
      <View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            backgroundColor: stepsColor,
            opacity: 0.18,
          },
        ]}
      />
      <View style={styles.row}>
        <View
          style={styles.ringStack}
          testID={testID ? `${testID}-rings` : undefined}
        >
          {/* Outer — steps */}
          <View style={[styles.ringLayer, { width: RING_OUTER_DIAMETER, height: RING_OUTER_DIAMETER }]}>
            <VitalRing
              vitalType="activity"
              fill={stepsFill}
              diameter={RING_OUTER_DIAMETER}
              strokeWidth={RING_OUTER_STROKE}
              testID={testID ? `${testID}-ring-steps` : undefined}
            />
          </View>
          {/* Middle — calories. Insets by 12 to nest concentrically. */}
          <View
            style={[
              styles.ringLayer,
              {
                top: 12,
                left: 12,
                width: RING_MID_DIAMETER,
                height: RING_MID_DIAMETER,
              },
            ]}
          >
            <VitalRing
              vitalType="activity"
              fill={caloriesFill}
              diameter={RING_MID_DIAMETER}
              strokeWidth={RING_MID_STROKE}
              // Override the vital color via the underlying SVG by
              // wrapping in a tinted layer. VitalRing pulls color from
              // theme.colors.vital[type], so we rely on the `style` prop
              // to tint the SVG via opacity layering. A more direct fix:
              // pass the type but render an additional colored Circle
              // overlay — but that's heavy. We accept the tonal variant
              // for the inner rings keeps the activity hue family.
              style={{ opacity: 0.85 }}
              testID={testID ? `${testID}-ring-calories` : undefined}
            />
          </View>
          {/* Inner — move minutes (hidden in 16.5f when watch can't
              provide a real value). */}
          {hideMoveRing ? null : (
            <View
              style={[
                styles.ringLayer,
                {
                  top: 24,
                  left: 24,
                  width: RING_INNER_DIAMETER,
                  height: RING_INNER_DIAMETER,
                },
              ]}
            >
              <VitalRing
                vitalType="activity"
                fill={moveFill}
                diameter={RING_INNER_DIAMETER}
                strokeWidth={RING_INNER_STROKE}
                style={{ opacity: 0.7 }}
                testID={testID ? `${testID}-ring-move` : undefined}
              />
            </View>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, marginLeft: theme.spacing.l }}>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: labelStyle.family,
              fontSize: labelStyle.size,
              lineHeight: labelStyle.lineHeight,
              letterSpacing: labelStyle.letterSpacing,
              color: theme.colors.text.tertiary,
              textTransform: 'uppercase',
              marginBottom: theme.spacing.xs,
            }}
            testID={testID ? `${testID}-eyebrow` : undefined}
          >
            Today
          </Text>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: theme.fontFamilies.editorial,
              fontSize: numericXl.size,
              lineHeight: numericXl.lineHeight,
              color: theme.colors.text.primary,
              letterSpacing: -0.5,
            }}
            testID={testID ? `${testID}-steps` : undefined}
          >
            {formattedSteps}
          </Text>
          {subLine ? (
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: captionStyle.size,
                lineHeight: captionStyle.lineHeight,
                color: stepsColor,
                marginTop: theme.spacing.xs,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
              testID={testID ? `${testID}-sub` : undefined}
            >
              {subLine}
            </Text>
          ) : null}
          {empty && emptyMessage ? (
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: captionStyle.family,
                fontSize: captionStyle.size,
                lineHeight: captionStyle.lineHeight,
                color: theme.colors.text.tertiary,
                marginTop: theme.spacing.xs,
              }}
              testID={testID ? `${testID}-empty-message` : undefined}
            >
              {emptyMessage}
            </Text>
          ) : null}
          {!empty && staleCaption ? (
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: captionStyle.family,
                fontSize: captionStyle.size,
                lineHeight: captionStyle.lineHeight,
                color: theme.colors.text.tertiary,
                marginTop: theme.spacing.xs,
              }}
              testID={testID ? `${testID}-stale-caption` : undefined}
            >
              {staleCaption}
            </Text>
          ) : null}
        </View>
      </View>
      <View
        style={styles.legendRow}
        testID={testID ? `${testID}-legend` : undefined}
      >
        <LegendDot
          color={stepsColor}
          label="Steps"
          value={empty ? '—' : steps.toLocaleString()}
          testID={testID ? `${testID}-legend-steps` : undefined}
        />
        <LegendDot
          color={caloriesColor}
          label="Calories"
          value={formatLegendValue(calories, '')}
          testID={testID ? `${testID}-legend-calories` : undefined}
        />
        {hideMoveRing ? null : (
          <LegendDot
            color={moveColor}
            label="Move"
            value={formatLegendValue(moveMinutes, 'm')}
            testID={testID ? `${testID}-legend-move` : undefined}
          />
        )}
      </View>
    </View>
  );
}

interface LegendDotProps {
  color: string;
  label: string;
  value: string;
  testID?: string;
}

function LegendDot({ color, label, value, testID }: LegendDotProps) {
  const theme = useTheme();
  const labelStyle = theme.type('labelUppercase');
  return (
    <View style={styles.legendItem} testID={testID}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: labelStyle.family,
          fontSize: 9,
          letterSpacing: labelStyle.letterSpacing,
          color: theme.colors.text.tertiary,
          textTransform: 'uppercase',
          marginLeft: 6,
        }}
      >
        {label}
      </Text>
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: theme.fontFamilies.editorial,
          fontSize: 14,
          color: theme.colors.text.primary,
          marginLeft: 6,
        }}
        testID={testID ? `${testID}-value` : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 22,
    position: 'relative',
  },
  glow: {
    position: 'absolute',
    left: '50%',
    top: 0,
    width: 280,
    height: 220,
    borderRadius: 999,
    transform: [{ translateX: -140 }],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  ringStack: {
    width: RING_OUTER_DIAMETER,
    height: RING_OUTER_DIAMETER,
    position: 'relative',
  },
  ringLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
  },
});
