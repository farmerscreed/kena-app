// MultiVitalChart — Sprint 9 / D13 §10.1 + docs/04-screens/trends.md.
//
// Multi-series SVG line chart for the Trends screen. Renders the five
// vitals (BP, HR, SpO2, Sleep, Activity) on a shared X axis (days)
// with each series normalized independently to its own min–max so the
// chart reads as a *trend* picture rather than an absolute comparison.
// The legend row above the chart shows each visible vital's latest
// value in its own unit so absolute scale stays accessible to users
// who want it.
//
// Hand-rolled `react-native-svg` to stay consistent with RangeBandChart,
// Sparkline, and the rest of the chart library — no
// Victory Native dependency, per the founder-approved stack pin.
//
// Geometry pure helper exported for unit tests.
//
// Reduced motion (D12 §7.4): the draw-on animation is bypassed under
// useReducedMotion. The lines render at their final state immediately.

import { useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';
import type { VitalType } from './VitalRing';

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 200;
const PADDING_X = 16;
const PADDING_Y = 24;
const STROKE_WIDTH = 1.6;
const REVEAL_DURATION_MS = 1100;
const GRID_ROWS = [0.25, 0.5, 0.75];

export interface MultiVitalSeries {
  kind: VitalType;
  /** Per-day values, oldest → newest. Length defines the X axis. */
  values: number[];
  /** Same length as `values`; YYYY-MM-DD per index for a11y / tooltips. */
  days: string[];
  /** When false, the series is hidden — both line + legend chip latest. */
  visible: boolean;
  /** Anomaly indices to highlight on the line (0-based into `values`).
   *  Optional; defaults to none. */
  anomalyIndices?: number[];
}

export interface MultiVitalChartProps {
  series: MultiVitalSeries[];
  /** Render legend row above the chart with per-vital latest values.
   *  Defaults to true. */
  showLegend?: boolean;
  /** Optional caption above the chart ("This week"). */
  caption?: string;
  /** Optional sub-caption right-aligned (e.g., "7 days"). */
  subCaption?: string;
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface SeriesGeometry {
  /** Pixel coordinates oldest → newest, same length as the values fed in. */
  xs: number[];
  ys: number[];
  linePath: string;
  /** Normalized 0..1 range used to lay out absolute-value labels. */
  min: number;
  max: number;
  /** Latest non-null value for the legend chip. */
  latest: number | null;
}

export interface MultiVitalChartGeometry {
  /** Map keyed by VitalType — only includes series that produced a path. */
  perSeries: Partial<Record<VitalType, SeriesGeometry>>;
  /** Day-axis tick X positions (one per shared day index). */
  axisXs: number[];
  /** Number of distinct days the chart spans. */
  dayCount: number;
}

function dedupSortedDays(serieses: MultiVitalSeries[]): string[] {
  const set = new Set<string>();
  for (const s of serieses) {
    if (!s.visible) continue;
    for (const d of s.days) set.add(d);
  }
  return Array.from(set).sort();
}

/** Pure geometry helper. Builds shared-X-axis day list, then per-series
 *  pixel coordinates with each series normalized to its own min..max. */
export function buildMultiVitalGeometry(
  series: MultiVitalSeries[],
  width: number,
  height: number,
): MultiVitalChartGeometry {
  const innerW = Math.max(0, width - PADDING_X * 2);
  const innerH = Math.max(0, height - PADDING_Y * 2);
  const days = dedupSortedDays(series);
  const dayIdx = new Map<string, number>();
  days.forEach((d, i) => dayIdx.set(d, i));
  const axisXs =
    days.length === 0
      ? []
      : days.length === 1
        ? [PADDING_X + innerW / 2]
        : days.map((_, i) => PADDING_X + (innerW * i) / (days.length - 1));

  const perSeries: Partial<Record<VitalType, SeriesGeometry>> = {};

  for (const s of series) {
    if (!s.visible || s.values.length === 0) continue;
    // Pair (day, value) so we plot at the right shared-axis position.
    const pairs: { x: number; v: number }[] = [];
    for (let i = 0; i < s.values.length; i++) {
      const x = axisXs[dayIdx.get(s.days[i]) ?? -1];
      if (x === undefined) continue;
      pairs.push({ x, v: s.values[i] });
    }
    if (pairs.length === 0) continue;

    const values = pairs.map((p) => p.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 1);

    const xs = pairs.map((p) => p.x);
    const ys = pairs.map(
      (p) => PADDING_Y + innerH - ((p.v - min) / span) * innerH,
    );
    const linePath = ys
      .map((y, i) => `${i === 0 ? 'M' : 'L'} ${xs[i]} ${y}`)
      .join(' ');
    perSeries[s.kind] = {
      xs,
      ys,
      linePath,
      min,
      max,
      latest: values[values.length - 1] ?? null,
    };
  }

  return { perSeries, axisXs, dayCount: days.length };
}

const VITAL_LABEL: Record<VitalType, string> = {
  bp: 'BP',
  hr: 'HR',
  spo2: 'SpO2',
  sleep: 'Sleep',
  activity: 'Activity',
};

const VITAL_UNIT: Record<VitalType, string> = {
  bp: 'mmHg',
  hr: 'bpm',
  spo2: '%',
  sleep: 'min',
  activity: 'steps',
};

function formatLatest(kind: VitalType, latest: number | null): string {
  if (latest === null) return '—';
  if (kind === 'sleep') {
    const h = Math.floor(latest / 60);
    const m = Math.round(latest - h * 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  if (kind === 'activity') {
    return latest >= 1000
      ? `${(latest / 1000).toFixed(1)}k`
      : `${Math.round(latest)}`;
  }
  return String(Math.round(latest));
}

function composeAccessibilityLabel(series: MultiVitalSeries[]): string {
  const visible = series.filter((s) => s.visible && s.values.length > 0);
  if (visible.length === 0) return 'No trend data yet';
  const parts = visible.map((s) => {
    const last = s.values[s.values.length - 1];
    return `${VITAL_LABEL[s.kind]} ${formatLatest(s.kind, last)}`;
  });
  return `Trend chart with ${visible.length} ${visible.length === 1 ? 'series' : 'series'}: ${parts.join(', ')}`;
}

interface SeriesLineProps {
  vital: VitalType;
  geometry: SeriesGeometry;
  color: string;
  reduceMotion: boolean;
  revealLength: number;
  anomalyIndices: number[];
  testID?: string;
}

function SeriesLine({
  vital,
  geometry,
  color,
  reduceMotion,
  revealLength,
  anomalyIndices,
  testID,
}: SeriesLineProps) {
  const dashOffset = useSharedValue(reduceMotion ? 0 : revealLength);

  useEffect(() => {
    if (reduceMotion) {
      dashOffset.value = 0;
      return;
    }
    dashOffset.value = revealLength;
    dashOffset.value = withTiming(0, {
      duration: REVEAL_DURATION_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [reduceMotion, revealLength, dashOffset]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  const points = geometry.xs
    .map((x, i) => `${x},${geometry.ys[i]}`)
    .join(' ');

  return (
    <>
      <AnimatedPolyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={revealLength}
        animatedProps={animatedProps}
        testID={testID ? `${testID}-line-${vital}` : undefined}
      />
      {/* Latest-point dot for visual anchor on the right edge. */}
      {geometry.xs.length > 0 ? (
        <Circle
          cx={geometry.xs[geometry.xs.length - 1]}
          cy={geometry.ys[geometry.ys.length - 1]}
          r={3}
          fill={color}
          testID={testID ? `${testID}-dot-${vital}` : undefined}
        />
      ) : null}
      {/* Anomaly markers — small ring around the indexed points. */}
      {anomalyIndices.map((idx) =>
        idx >= 0 && idx < geometry.xs.length ? (
          <Circle
            key={`${vital}-anom-${idx}`}
            cx={geometry.xs[idx]}
            cy={geometry.ys[idx]}
            r={5}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            testID={testID ? `${testID}-anomaly-${vital}-${idx}` : undefined}
          />
        ) : null,
      )}
    </>
  );
}

export function MultiVitalChart({
  series,
  showLegend = true,
  caption,
  subCaption,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  style,
  testID,
}: MultiVitalChartProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const labelStyle = theme.type('labelUppercase');
  const captionStyle = theme.type('caption');
  const legendValueStyle = theme.type('bodyM');
  const legendUnitStyle = theme.type('label');

  const geometry = useMemo(
    () => buildMultiVitalGeometry(series, width, height),
    [series, width, height],
  );
  const revealLength = useMemo(
    () => Math.ceil(Math.sqrt(width * width + height * height) * 2),
    [width, height],
  );

  const a11yLabel = composeAccessibilityLabel(series);

  const anyVisible = series.some((s) => s.visible && s.values.length > 0);

  return (
    <View accessible={true}
      style={style}
      testID={testID}
      accessibilityLabel={a11yLabel}
      accessibilityRole="image"
    >
      {(caption || subCaption) ? (
        <View style={styles.captionRow}>
          {caption ? (
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: labelStyle.family,
                fontSize: labelStyle.size,
                lineHeight: labelStyle.lineHeight,
                letterSpacing: labelStyle.letterSpacing,
                color: theme.colors.text.tertiary,
                textTransform: 'uppercase',
              }}
              testID={testID ? `${testID}-caption` : undefined}
            >
              {caption}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {subCaption ? (
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: captionStyle.size,
                lineHeight: captionStyle.lineHeight,
                color: theme.colors.text.tertiary,
                letterSpacing: 0.4,
              }}
              testID={testID ? `${testID}-subCaption` : undefined}
            >
              {subCaption}
            </Text>
          ) : null}
        </View>
      ) : null}

      {showLegend ? (
        <View style={styles.legendRow}>
          {series.map((s) => {
            if (!s.visible) return null;
            const color = theme.colors.vital[s.kind];
            const seriesGeo = geometry.perSeries[s.kind];
            return (
              <View
                key={s.kind}
                style={[styles.legendChip, { borderColor: color }]}
                testID={testID ? `${testID}-legend-${s.kind}` : undefined}
              >
                <View
                  style={[styles.legendSwatch, { backgroundColor: color }]}
                />
                <Text
                  allowFontScaling={false}
                  style={[
                    legendValueStyle,
                    { color: theme.colors.text.primary },
                  ]}
                >
                  {VITAL_LABEL[s.kind]}{' '}
                  <Text style={{ color: theme.colors.text.secondary }}>
                    {formatLatest(s.kind, seriesGeo?.latest ?? null)}
                  </Text>{' '}
                  <Text
                    style={[
                      legendUnitStyle,
                      { color: theme.colors.text.tertiary },
                    ]}
                  >
                    {VITAL_UNIT[s.kind]}
                  </Text>
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        testID={testID ? `${testID}-svg` : undefined}
      >
        {/* Grid rules — three horizontal lines for visual rhythm. */}
        {GRID_ROWS.map((frac) => {
          const y = PADDING_Y + (height - PADDING_Y * 2) * frac;
          return (
            <Line
              key={frac}
              x1={PADDING_X}
              y1={y}
              x2={width - PADDING_X}
              y2={y}
              stroke={theme.colors.border.subtle}
              strokeWidth={0.5}
            />
          );
        })}
        {/* Per-series lines, in declared order so toggling matches reading order. */}
        {series.map((s) => {
          const seriesGeo = geometry.perSeries[s.kind];
          if (!s.visible || !seriesGeo) return null;
          return (
            <SeriesLine
              key={s.kind}
              vital={s.kind}
              geometry={seriesGeo}
              color={theme.colors.vital[s.kind]}
              reduceMotion={reduceMotion}
              revealLength={revealLength}
              anomalyIndices={s.anomalyIndices ?? []}
              testID={testID}
            />
          );
        })}
      </Svg>

      {!anyVisible ? (
        <View style={styles.emptyRow}>
          <Text
            allowFontScaling={false}
            style={[
              theme.type('bodyM'),
              { color: theme.colors.text.tertiary, textAlign: 'center' },
            ]}
            testID={testID ? `${testID}-empty` : undefined}
          >
            Pick a vital above to see its trend.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  captionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingBottom: 12,
    rowGap: 6,
    columnGap: 8,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  legendSwatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  emptyRow: {
    paddingTop: 12,
    paddingHorizontal: 16,
  },
});
