// VitalTrendChart — Sprint 8.5 (vital-detail screens).
//
// Continuous time-series line chart for a single vital. Renders:
//   - A faint healthy-range band (consumer supplies [low, high])
//   - The line itself, vital-colored, animated draw-on
//   - Optional peak + trough markers with the value above/below
//   - A "now" dot at the rightmost point
//
// react-native-svg only — no Victory dependency. Matches the existing
// pattern in CorrelationStrip.tsx + VitalRing.tsx (founder pick:
// stay with hand-rolled SVG, sprint card open-prompt 1).
//
// API design:
//   - Presentational. Consumer hands in `data: number[]` (already
//     binned to display points) + the healthy-range band + flags for
//     peak/trough markers.
//   - Defaults: 320×170 SVG, ~18pt internal padding so strokes don't
//     clip against the edges.
//
// Reduced motion (D12 §7.4): the draw-on animation is bypassed under
// useReducedMotion. The line renders at its final state immediately.
//
// Accessibility: composed accessibilityLabel reads
// "<caption> trend, latest <last>, peak <peak>, low <low>" so screen-
// reader users hear the full summary.

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
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Polyline,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';
import type { VitalType } from './VitalRing';

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 170;
const PADDING_X = 16;
const PADDING_Y = 22;
const STROKE_WIDTH = 1.6;
const REVEAL_DURATION_MS = 1200;
const FILL_OPACITY = 0.3;
const RANGE_BAND_OPACITY = 0.08;
const GRID_ROWS = [0.25, 0.5, 0.75];

export interface VitalTrendChartProps {
  vital: VitalType;
  /** Pre-binned data points to plot, oldest → newest. */
  data: number[];
  /** Healthy-range band [low, high] — drawn as a faint vital-color rectangle. */
  range: [number, number];
  /** Optional caption above the chart ("Today · resting HR"). */
  caption?: string;
  /** Optional sub-caption right-aligned ("60–95 band"). */
  subCaption?: string;
  /** When true, marks the maximum value with a circle + label. */
  peak?: boolean;
  /** When true, marks the minimum value with a circle + label. */
  trough?: boolean;
  width?: number;
  height?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

interface ChartGeometry {
  xs: number[];
  ys: number[];
  fillPath: string;
  linePath: string;
  rangeRect: { x: number; y: number; w: number; h: number };
  peakIdx: number;
  troughIdx: number;
}

/**
 * Pure geometry helper — exported for unit tests. Given the data,
 * range, and chart bounds, returns the per-point coordinates + the
 * SVG paths for the line and area fill.
 */
export function buildChartGeometry(
  data: number[],
  range: [number, number],
  width: number,
  height: number,
): ChartGeometry {
  const innerW = Math.max(0, width - PADDING_X * 2);
  const innerH = Math.max(0, height - PADDING_Y * 2);
  if (data.length === 0) {
    return {
      xs: [],
      ys: [],
      fillPath: '',
      linePath: '',
      rangeRect: { x: PADDING_X, y: PADDING_Y, w: 0, h: 0 },
      peakIdx: -1,
      troughIdx: -1,
    };
  }
  const dataMin = Math.min(...data, range[0]);
  const dataMax = Math.max(...data, range[1]);
  const span = Math.max(dataMax - dataMin, 1);

  const xs =
    data.length === 1
      ? [PADDING_X + innerW / 2]
      : data.map((_, i) => PADDING_X + (innerW * i) / (data.length - 1));
  const ys = data.map(
    (v) => PADDING_Y + innerH - ((v - dataMin) / span) * innerH,
  );

  const linePath = ys
    .map((y, i) => `${i === 0 ? 'M' : 'L'} ${xs[i]} ${y}`)
    .join(' ');
  const fillPath =
    data.length === 0
      ? ''
      : `${linePath} L ${xs[xs.length - 1]} ${height - PADDING_Y} L ${xs[0]} ${height - PADDING_Y} Z`;

  const rangeY =
    PADDING_Y + innerH - ((range[1] - dataMin) / span) * innerH;
  const rangeBottomY =
    PADDING_Y + innerH - ((range[0] - dataMin) / span) * innerH;
  const rangeRect = {
    x: PADDING_X,
    y: rangeY,
    w: innerW,
    h: Math.max(rangeBottomY - rangeY, 1),
  };

  let peakIdx = 0;
  let troughIdx = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i] > data[peakIdx]) peakIdx = i;
    if (data[i] < data[troughIdx]) troughIdx = i;
  }

  return { xs, ys, fillPath, linePath, rangeRect, peakIdx, troughIdx };
}

function composeAccessibilityLabel(
  caption: string | undefined,
  data: number[],
  peakIdx: number,
  troughIdx: number,
): string {
  if (data.length === 0) return caption ?? 'No data yet';
  const last = data[data.length - 1];
  const peak = data[peakIdx];
  const low = data[troughIdx];
  const lead = caption ? `${caption} trend` : 'Trend';
  return `${lead}, latest ${last}, peak ${peak}, low ${low}`;
}

export function VitalTrendChart({
  vital,
  data,
  range,
  caption,
  subCaption,
  peak,
  trough,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  testID,
  style,
}: VitalTrendChartProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const labelStyle = theme.type('labelUppercase');
  const captionStyle = theme.type('caption');
  const vitalColor = theme.colors.vital[vital];

  const geometry = useMemo(
    () => buildChartGeometry(data, range, width, height),
    [data, range, width, height],
  );

  // Draw-on reveal — animate strokeDashoffset from a safe upper-bound
  // length down to 0. The chart's diagonal × 2 is a generous bound that
  // guarantees the line is fully hidden at offset = length.
  const revealLength = useMemo(
    () => Math.ceil(Math.sqrt(width * width + height * height) * 2),
    [width, height],
  );
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
  const animatedLineProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  const a11yLabel = composeAccessibilityLabel(
    caption,
    data,
    geometry.peakIdx,
    geometry.troughIdx,
  );

  return (
    // Audit P1-6 — `accessible` added explicitly. A View that carries an
    // accessibilityLabel but not `accessible` is not guaranteed to be
    // exposed as a single element on iOS, so this composed label was at
    // risk of never being spoken.
    <View
      style={style}
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
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
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        testID={testID ? `${testID}-svg` : undefined}
      >
        <Defs>
          <LinearGradient id={`${testID ?? 'trend'}-fill`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={vitalColor} stopOpacity={FILL_OPACITY} />
            <Stop offset="100%" stopColor={vitalColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {/* Range band */}
        {geometry.rangeRect.w > 0 ? (
          <Rect
            x={geometry.rangeRect.x}
            y={geometry.rangeRect.y}
            width={geometry.rangeRect.w}
            height={geometry.rangeRect.h}
            fill={vitalColor}
            fillOpacity={RANGE_BAND_OPACITY}
          />
        ) : null}

        {/* Faint horizontal grid */}
        {GRID_ROWS.map((r) => {
          const y = PADDING_Y + (height - PADDING_Y * 2) * r;
          return (
            <Line
              key={r}
              x1={PADDING_X}
              x2={width - PADDING_X}
              y1={y}
              y2={y}
              stroke={theme.colors.text.primary}
              strokeOpacity={0.04}
              strokeDasharray="2 4"
            />
          );
        })}

        {/* Area fill */}
        {geometry.fillPath ? (
          <Path d={geometry.fillPath} fill={`url(#${testID ?? 'trend'}-fill)`} />
        ) : null}

        {/* Animated line */}
        {data.length > 1 ? (
          <AnimatedPolyline
            points={geometry.xs.map((x, i) => `${x},${geometry.ys[i]}`).join(' ')}
            stroke={vitalColor}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={revealLength}
            strokeDashoffset={reduceMotion ? 0 : revealLength}
            animatedProps={animatedLineProps}
            testID={testID ? `${testID}-line` : undefined}
          />
        ) : null}

        {/* Peak marker */}
        {peak && data.length > 0 ? (
          <>
            <Circle
              cx={geometry.xs[geometry.peakIdx]}
              cy={geometry.ys[geometry.peakIdx]}
              r={3.5}
              fill={theme.colors.surface.warmBase}
              stroke={vitalColor}
              strokeWidth={1.5}
            />
            <SvgText
              x={geometry.xs[geometry.peakIdx]}
              y={geometry.ys[geometry.peakIdx] - 8}
              textAnchor="middle"
              fontFamily={theme.fontFamilies.numeric}
              fontSize={9}
              fill={theme.colors.text.primary}
              letterSpacing={0.4}
            >
              {data[geometry.peakIdx]}
            </SvgText>
          </>
        ) : null}

        {/* Trough marker */}
        {trough && data.length > 0 ? (
          <>
            <Circle
              cx={geometry.xs[geometry.troughIdx]}
              cy={geometry.ys[geometry.troughIdx]}
              r={3.5}
              fill={theme.colors.surface.warmBase}
              stroke={vitalColor}
              strokeWidth={1.5}
            />
            <SvgText
              x={geometry.xs[geometry.troughIdx]}
              y={geometry.ys[geometry.troughIdx] + 14}
              textAnchor="middle"
              fontFamily={theme.fontFamilies.numeric}
              fontSize={9}
              fill={theme.colors.text.tertiary}
              letterSpacing={0.4}
            >
              {data[geometry.troughIdx]}
            </SvgText>
          </>
        ) : null}

        {/* Now dot — last point */}
        {data.length > 0 ? (
          <Circle
            cx={geometry.xs[geometry.xs.length - 1]}
            cy={geometry.ys[geometry.ys.length - 1]}
            r={3.5}
            fill={vitalColor}
            stroke={theme.colors.surface.warmBase}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  captionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
});
