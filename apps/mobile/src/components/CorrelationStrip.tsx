// CorrelationStrip — D12 §11.2.5 (Sprint 7.6).
//
// A small two-vital chart used on Trends and Reading Detail. Two series
// are scaled to *their own* y-extent (each vital reads against its own
// range — the chart is for visual co-pattern, not absolute comparison),
// share a single time x-axis, and animate left-to-right on first paint
// per D12 §7.3 / motion.slow / ease.decelerate.
//
// API design:
//   - Pure presentational. The consumer hands in two `VitalSeries` of
//     `{ t, value }` points. `t` is treated as a monotonic numeric x —
//     epoch ms or any other numeric. We don't sort or de-dupe.
//   - `caption` is the only user-visible string; voice rules apply (the
//     example "Sleep × Morning BP" is fine; a forbidden word would not be).
//   - Reduced motion bypasses the draw-on animation: lines render at their
//     final state immediately. Same useReducedMotion hook the rest of the
//     motion-aware components rely on.
//
// SVG-based via react-native-svg, matching VitalRing's rendering choice.
// Skia upgrade path (D12 §12.4) is the same as VitalRing: profile then
// migrate if FPS drops on the constellation. The pure-logic helpers
// (scaleX / scaleY / polylinePoints) are exported so the math is unit-
// testable without mounting the component.

import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Polyline } from 'react-native-svg';
import { useTheme } from '../theme';
import { vitalTheme } from '../utils/vitalThemes';
import { useReducedMotion } from '../theme/useReducedMotion';
import { type VitalType } from './VitalRing';

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 96;
// Drop a small inset so a stroke right at the edge isn't clipped, and so
// the area-fill polygons don't sit flush against the bounding box.
const PADDING_X = 4;
const PADDING_Y = 4;

const AREA_FILL_OPACITY = 0.12; // D12 §11.2.5
const STROKE_WIDTH = 2;
const DASH_PATTERN = '4 4'; // vital B dashed stroke
// motion.slow (D12 §7.1) + ease.decelerate (D12 §7.2)
const REVEAL_DURATION_MS = 320;
const REVEAL_EASING = Easing.bezier(0, 0, 0, 1);

export interface VitalSeriesPoint {
  t: number;
  value: number;
}

export interface VitalSeries {
  type: VitalType;
  points: VitalSeriesPoint[];
}

export interface CorrelationStripProps {
  vitalA: VitalSeries;
  vitalB: VitalSeries;
  range: '7d' | '30d' | '90d';
  /** Optional label, e.g. "Sleep × Morning BP". Voice rules apply. */
  caption?: string;
  /** Defaults to 320. */
  width?: number;
  /** Defaults to 96. */
  height?: number;
  /**
   * Sprint 16.5c — optional x-axis override. When omitted the chart
   * auto-scales to the data's tMin/tMax. When provided, the x-axis
   * spans `[tMin, tMax]` regardless of the data extent, so a chart for
   * a 30d range still reads as "30 days wide" even if the data only
   * covers the last week. Pair with the new `axisLabels` prop to
   * surface the date window to the user.
   */
  tBounds?: { tMin: number; tMax: number };
  /**
   * Sprint 16.5c — optional left / right axis labels rendered under
   * the chart (e.g. "May 6" → "today"). Pure decoration; no effect on
   * the line geometry.
   */
  axisLabels?: { left: string; right: string };
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// ============================================================
// Pure-logic helpers — exported for unit testing.
// ============================================================

/**
 * Maps a time `t` to an x-coordinate in `[PADDING_X, width - PADDING_X]`.
 * Zero-range (tMin === tMax) pins to the horizontal centre so a single-x
 * series doesn't divide-by-zero.
 */
export function scaleX(t: number, tMin: number, tMax: number, width: number): number {
  const usable = Math.max(0, width - PADDING_X * 2);
  if (tMax === tMin) return PADDING_X + usable / 2;
  const ratio = (t - tMin) / (tMax - tMin);
  return PADDING_X + ratio * usable;
}

/**
 * Maps a value `v` to a y-coordinate in `[PADDING_Y, height - PADDING_Y]`.
 * Inverted so larger values render higher up. Zero-range (vMin === vMax)
 * pins to the vertical centre.
 */
export function scaleY(value: number, vMin: number, vMax: number, height: number): number {
  const usable = Math.max(0, height - PADDING_Y * 2);
  if (vMax === vMin) return PADDING_Y + usable / 2;
  const ratio = (value - vMin) / (vMax - vMin);
  return PADDING_Y + (1 - ratio) * usable;
}

/**
 * Returns an SVG `points` string ("x,y x,y …") for a series. Returns an
 * empty string when the series has no points. Single-point series return
 * one coordinate pair (the consumer renders this as a dot).
 */
export function polylinePoints(
  series: VitalSeries,
  bounds: { tMin: number; tMax: number; width: number; height: number },
): string {
  const pts = series.points;
  if (pts.length === 0) return '';
  const vMin = Math.min(...pts.map((p) => p.value));
  const vMax = Math.max(...pts.map((p) => p.value));
  const { tMin, tMax, width, height } = bounds;
  return pts
    .map((p) => {
      const x = scaleX(p.t, tMin, tMax, width);
      const y = scaleY(p.value, vMin, vMax, height);
      return `${x},${y}`;
    })
    .join(' ');
}

// Builds the closed area path under a polyline by anchoring the start and
// end of the line back down to the bottom edge of the chart.
function areaPathFromPoints(pointsStr: string, height: number): string {
  if (!pointsStr) return '';
  const coords = pointsStr.split(' ');
  if (coords.length === 0) return '';
  const first = coords[0];
  const last = coords[coords.length - 1];
  const firstX = first.split(',')[0];
  const lastX = last.split(',')[0];
  const bottom = height - PADDING_Y;
  return `M ${firstX},${bottom} L ${coords.join(' L ')} L ${lastX},${bottom} Z`;
}

// ============================================================
// Accessibility (audit P1-6)
// ============================================================

// Plain-language names for each series. Voice rules
// (docs/05-voice-and-claims.md): plain words before clinical ones, and no
// "smartwatch" / clinical framing.
const VITAL_SPOKEN_NAME: Record<VitalType, string> = {
  bp: 'blood pressure',
  hr: 'heart rate',
  spo2: 'oxygen',
  sleep: 'sleep',
  activity: 'steps',
};

function describeSeries(series: VitalSeries, shape: string): string {
  const name = VITAL_SPOKEN_NAME[series.type];
  const count = series.points.length;
  if (count === 0) return `No ${name} to show for this window (${shape} line).`;
  const values = series.points.map((p) => p.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const noun = count === 1 ? 'point' : 'points';
  if (low === high) {
    return `${name}, ${shape} line, ${count} ${noun}, steady at ${formatValue(low)}.`;
  }
  return `${name}, ${shape} line, ${count} ${noun}, from ${formatValue(low)} to ${formatValue(high)}.`;
}

// Values arrive in whatever unit the caller uses (hours of sleep, mmHg,
// bpm). Round to one decimal so the sentence doesn't read out 6.499999.
function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

/**
 * Audit P1-6 — composes the strip's spoken description. Exported so the
 * sentence is unit-testable without mounting SVG.
 *
 * The chart's whole point is "do these two move together?", so the label
 * names both series, says which is solid and which is dashed, and gives
 * each one's span. It deliberately does NOT assert a relationship between
 * them: describing what is drawn is safe; claiming a cause is not.
 */
export function composeCorrelationAccessibilityLabel(
  vitalA: VitalSeries,
  vitalB: VitalSeries,
  range: '7d' | '30d' | '90d',
  caption?: string,
): string {
  const window =
    range === '7d' ? 'the last 7 days' : range === '30d' ? 'the last 30 days' : 'the last 90 days';
  // Captions are written without terminal punctuation ("Sleep × Morning
  // BP"), but strip it if a caller supplies one so the sentence doesn't
  // read "BP..".
  const head = caption ? `${caption.trim().replace(/[.!?]+$/, '')}.` : 'Two vitals compared.';
  return `${head} Over ${window}. ${describeSeries(vitalA, 'solid')} ${describeSeries(vitalB, 'dashed')}`;
}

// ============================================================
// Component
// ============================================================

export function CorrelationStrip({
  vitalA,
  vitalB,
  // `range` is metadata for the consumer (which window of data to fetch).
  // The chart auto-scales to whatever points it's handed, so it has no
  // effect on the geometry — but audit P1-6 uses it to say how wide the
  // window is in the composed accessibility label.
  range,
  caption,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  tBounds,
  axisLabels,
  testID,
  style,
}: CorrelationStripProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const captionStyle = theme.type('caption');

  // Shared time extent. Pre-16.5c this always auto-scaled to the
  // data's tMin/tMax — fine when both series spanned the same window,
  // but misleading when one series (e.g. sleep, 7 nights) is sparse
  // and the other (BP morning, 90 days) is dense: the dense series
  // dominates the x-axis and the sparse one bunches at one edge. The
  // optional `tBounds` prop pins the x-axis to the requested range
  // window so the chart reads as wide as the user selected.
  const { tMin, tMax } = useMemo(() => {
    if (tBounds) return { tMin: tBounds.tMin, tMax: tBounds.tMax };
    const all = [...vitalA.points, ...vitalB.points];
    if (all.length === 0) return { tMin: 0, tMax: 1 };
    let min = all[0].t;
    let max = all[0].t;
    for (const p of all) {
      if (p.t < min) min = p.t;
      if (p.t > max) max = p.t;
    }
    return { tMin: min, tMax: max };
  }, [vitalA.points, vitalB.points, tBounds]);

  const bounds = { tMin, tMax, width, height };

  // Deps list the primitives `bounds` is built from — they're stable across
  // renders that produce identical output. (The `react-hooks/exhaustive-deps`
  // rule is not configured in this project, so listing primitives rather
  // than the composed `bounds` object is safe and intentional.)
  const pointsA = useMemo(
    () => polylinePoints(vitalA, bounds),
    [vitalA, tMin, tMax, width, height],
  );
  const pointsB = useMemo(
    () => polylinePoints(vitalB, bounds),
    [vitalB, tMin, tMax, width, height],
  );

  const colorA = theme.colors.vital[vitalA.type];
  const colorB = theme.colors.vital[vitalB.type];

  // Estimate path length for the dashoffset reveal trick. A polyline's
  // exact path length isn't trivially available without measuring the
  // mounted node; the chart's diagonal is a safe upper bound that
  // guarantees the line is fully hidden at offset = length.
  const revealLengthEstimate = useMemo(
    () => Math.ceil(Math.sqrt(width * width + height * height) * 2),
    [width, height],
  );

  // Reveal animations: dashoffset shared values animate from `length` → 0
  // on mount. Under reduced motion, pin to 0 immediately so lines render
  // at final state.
  const offsetA = useSharedValue(reduceMotion ? 0 : revealLengthEstimate);
  const offsetB = useSharedValue(reduceMotion ? 0 : revealLengthEstimate);

  useEffect(() => {
    if (reduceMotion) {
      offsetA.value = 0;
      offsetB.value = 0;
      return;
    }
    offsetA.value = revealLengthEstimate;
    offsetB.value = revealLengthEstimate;
    offsetA.value = withTiming(0, {
      duration: REVEAL_DURATION_MS,
      easing: REVEAL_EASING,
    });
    offsetB.value = withTiming(0, {
      duration: REVEAL_DURATION_MS,
      easing: REVEAL_EASING,
    });
  }, [reduceMotion, revealLengthEstimate, offsetA, offsetB]);

  const animatedPropsA = useAnimatedProps(() => ({
    strokeDashoffset: offsetA.value,
  }));
  const animatedPropsB = useAnimatedProps(() => ({
    strokeDashoffset: offsetB.value,
  }));

  const hasA = vitalA.points.length > 0;
  const hasB = vitalB.points.length > 0;
  const isSinglePointA = vitalA.points.length === 1;
  const isSinglePointB = vitalB.points.length === 1;

  const areaA = hasA && !isSinglePointA ? areaPathFromPoints(pointsA, height) : '';
  const areaB = hasB && !isSinglePointB ? areaPathFromPoints(pointsB, height) : '';

  // Audit P1-6 — this chart had zero accessibility props.
  const a11yLabel = composeCorrelationAccessibilityLabel(vitalA, vitalB, range, caption);

  return (
    // Audit P1-6 — `accessible` is explicit so iOS exposes the strip as a
    // single element carrying the composed sentence, rather than leaving
    // the label on a container it never focuses.
    <View
      style={style}
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
    >
      {caption ? (
        <Text
          style={[
            styles.caption,
            {
              fontFamily: captionStyle.family,
              fontSize: captionStyle.size,
              fontWeight: captionStyle.weight,
              lineHeight: captionStyle.lineHeight,
              color: theme.colors.text.secondary,
            },
          ]}
          testID={testID ? `${testID}-caption` : undefined}
        >
          {caption}
        </Text>
      ) : null}
      <Svg
        width={width}
        height={height}
        testID={testID ? `${testID}-svg` : undefined}
        // Audit P1-6 — decorative once the composed label describes it.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {/* Vital A — solid line + area fill at 12% opacity */}
        {areaA ? <Path d={areaA} fill={colorA} fillOpacity={AREA_FILL_OPACITY} /> : null}
        {hasA && !isSinglePointA ? (
          <AnimatedPolyline
            points={pointsA}
            stroke={colorA}
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeDasharray={revealLengthEstimate}
            strokeDashoffset={reduceMotion ? 0 : revealLengthEstimate}
            animatedProps={animatedPropsA}
            testID={testID ? `${testID}-line-a` : undefined}
          />
        ) : null}
        {hasA && isSinglePointA ? (
          // Single-point: render a small dot via a Polyline of one coord.
          // SVG polyline doesn't draw a dot for a single point, so we use
          // a degenerate stroke with linecap="round" — a 1-coord polyline
          // with strokeLinecap renders a circle of strokeWidth diameter.
          <Polyline
            points={`${pointsA} ${pointsA}`}
            stroke={colorA}
            strokeWidth={STROKE_WIDTH * 2}
            strokeLinecap="round"
            fill="none"
            testID={testID ? `${testID}-dot-a` : undefined}
          />
        ) : null}

        {/* Vital B — dashed line + area fill at 12% opacity */}
        {areaB ? <Path d={areaB} fill={colorB} fillOpacity={AREA_FILL_OPACITY} /> : null}
        {hasB && !isSinglePointB ? (
          <AnimatedPolyline
            points={pointsB}
            stroke={colorB}
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={DASH_PATTERN}
            fill="none"
            // Reveal effect for dashed lines is approximated by animating
            // dashoffset along the same pattern. We re-apply the dasharray
            // intentionally; the offset animates over the pattern repeat.
            strokeDashoffset={reduceMotion ? 0 : revealLengthEstimate}
            animatedProps={animatedPropsB}
            testID={testID ? `${testID}-line-b` : undefined}
          />
        ) : null}
        {hasB && isSinglePointB ? (
          <Polyline
            points={`${pointsB} ${pointsB}`}
            stroke={colorB}
            strokeWidth={STROKE_WIDTH * 2}
            strokeLinecap="round"
            fill="none"
            testID={testID ? `${testID}-dot-b` : undefined}
          />
        ) : null}
      </Svg>
      {/* Founder-test feedback (2026-08-19) — a two-line key: which
          line is which, and how to read the pairing. Without it the
          strip reads as random lines. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 14, height: 2, backgroundColor: theme.colors.vital[vitalA.type] }} />
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: captionStyle.family,
              fontSize: captionStyle.size,
              color: theme.colors.text.secondary,
            }}
          >
            {vitalTheme(vitalA.type).displayName}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View
            style={{
              width: 14,
              height: 0,
              borderTopWidth: 2,
              borderStyle: 'dashed',
              borderColor: theme.colors.vital[vitalB.type],
            }}
          />
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: captionStyle.family,
              fontSize: captionStyle.size,
              color: theme.colors.text.secondary,
            }}
          >
            {vitalTheme(vitalB.type).displayName}
          </Text>
        </View>
      </View>
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: captionStyle.family,
          fontSize: captionStyle.size,
          lineHeight: captionStyle.lineHeight,
          color: theme.colors.text.tertiary,
          marginTop: 4,
        }}
        testID={testID ? `${testID}-how-to-read` : undefined}
      >
        Both lines share the same nights, each on its own scale. When they
        rise and fall together — or mirror each other — that pairing is
        worth noticing.
      </Text>
      {axisLabels ? (
        <View style={styles.axisRow}>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: captionStyle.family,
              fontSize: captionStyle.size,
              lineHeight: captionStyle.lineHeight,
              color: theme.colors.text.tertiary,
            }}
            testID={testID ? `${testID}-axis-left` : undefined}
          >
            {axisLabels.left}
          </Text>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: captionStyle.family,
              fontSize: captionStyle.size,
              lineHeight: captionStyle.lineHeight,
              color: theme.colors.text.tertiary,
            }}
            testID={testID ? `${testID}-axis-right` : undefined}
          >
            {axisLabels.right}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    marginBottom: 4,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
});
