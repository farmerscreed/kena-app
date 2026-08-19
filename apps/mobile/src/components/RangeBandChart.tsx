// RangeBandChart — D13 PR-6 (§6.3, closes P1-6). The core chart.
//
// Replaces BPTwinLineChart and VitalTrendChart. What was wrong before:
// no line between time slots, systolic vs diastolic encoded by alpha of
// the same hue, and a fixed 8-slot axis so n=2 rendered as two bars on
// an eight-label axis.
//
// Anatomy (§6.3), bottom layer first:
//   · Band ribbon — series[vital] at 15% opacity spanning [p10, p90].
//     The most important element on the screen: the visual form of the
//     product's promise. Present whenever the baseline is sufficient.
//   · Outer band — optional, 7% opacity, mean ± 2σ ("All" range only).
//   · Primary series — solid 1.6pt polyline, 2.6pt filled circles.
//   · Secondary series (diastolic) — DASHED 1.2pt polyline, 6pt hollow
//     SQUARES. Shape and dash, never opacity (WCAG 1.4.1).
//   · Latest point — 3.4pt, text.primary fill: the "you are here" mark.
//   · Out-of-band points — 4pt in the worth-a-look tone plus a 1pt
//     ring. Size and ring, not colour alone.
//   · Axis — numericS; the BAND ENDPOINTS are labelled, not arbitrary
//     ticks.
//
// Density adaptation (§6.3):
//   0        → renders nothing (the screen owns its empty state)
//   1–2      → dot plot against the band; no polyline, no time axis
//   3–7      → polyline, every point labelled
//   8+       → polyline, sparse labels (first, last, out-of-band)
//
// Interaction: horizontal scrub with a vertical rule + value callout,
// a light haptic per point detent, all suppressed under reduced
// motion. Pinch is not supported.
//
// Accessibility: one composed label on an `accessible={true}` wrapper
// (a bare labelled <View> is likely not exposed on iOS); the SVG layer
// is decorative. The companion ViewAsTableLink provides the non-visual
// route to the underlying numbers.

import { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, {
  Circle,
  Line as SvgLine,
  Polyline,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';
import type { VitalType } from './VitalRing';

export interface RangeBandPoint {
  /** Primary value (systolic, bpm, percent, minutes…). */
  value: number;
  /** Secondary value — the diastolic half of a BP pair. */
  secondary?: number | null;
  /** Axis label for this point ("6:42a", "Mon 12"). Optional; density
   *  rules decide which labels actually render. */
  label?: string;
}

export interface RangeBand {
  low: number;
  high: number;
}

export interface RangeBandChartProps {
  vital: VitalType;
  /** Points oldest → newest. The chart never pads with empty slots. */
  points: RangeBandPoint[];
  /** The personal display band (p10–p90). Null while learning — the
   *  ribbon only ever draws a band that has been earned (§4.3). */
  band: RangeBand | null;
  /** Secondary series band (diastolic p10–p90). */
  secondaryBand?: RangeBand | null;
  /** mean ± 2σ, drawn at 7% on the "All" range only. */
  outerBand?: RangeBand | null;
  /** Unit for the callout + composed label ("mmHg", "bpm", "%"). */
  unit?: string;
  caption?: string;
  subCaption?: string;
  width?: number;
  height?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 180;
const PADDING_X = 34; // room for the band-endpoint labels on the left
const PADDING_TOP = 12;
const PADDING_BOTTOM = 22;
const PRIMARY_STROKE = 1.6;
const PRIMARY_DOT = 2.6;
const SECONDARY_STROKE = 1.2;
const SECONDARY_SQUARE = 6;
const LATEST_DOT = 3.4;
const OUT_OF_BAND_DOT = 4;
const OUT_OF_BAND_RING = 1;
const BAND_OPACITY = 0.15; // series.band (§5.1)
const OUTER_BAND_OPACITY = 0.07;

export type RangeBandDensity = 'empty' | 'dots' | 'labelled' | 'sparse';

export function densityFor(count: number): RangeBandDensity {
  if (count === 0) return 'empty';
  if (count <= 2) return 'dots';
  if (count <= 7) return 'labelled';
  return 'sparse';
}

export interface RangeBandGeometry {
  xs: number[];
  ys: number[];
  secondaryYs: (number | null)[];
  outOfBand: boolean[];
  bandRect: { y: number; h: number } | null;
  secondaryBandRect: { y: number; h: number } | null;
  outerRect: { y: number; h: number } | null;
  yFor: (value: number) => number;
  plotLeft: number;
  plotRight: number;
}

/** Pure geometry — exported for the density/shape unit tests. The y
 *  domain is data ∪ bands with 6% headroom so the ribbon is always
 *  fully inside the plot. */
export function buildRangeBandGeometry(
  points: RangeBandPoint[],
  band: RangeBand | null,
  secondaryBand: RangeBand | null,
  outerBand: RangeBand | null,
  width: number,
  height: number,
): RangeBandGeometry {
  const values: number[] = [];
  for (const p of points) {
    values.push(p.value);
    if (p.secondary != null) values.push(p.secondary);
  }
  for (const b of [band, secondaryBand, outerBand]) {
    if (b) values.push(b.low, b.high);
  }
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max((rawMax - rawMin) * 0.06, 2);
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;
  const plotTop = PADDING_TOP;
  const plotBottom = height - PADDING_BOTTOM;
  const plotLeft = PADDING_X;
  const plotRight = width - 10;

  const yFor = (v: number) =>
    plotBottom - ((v - yMin) / (yMax - yMin)) * (plotBottom - plotTop);
  const xFor = (i: number) =>
    points.length === 1
      ? (plotLeft + plotRight) / 2
      : plotLeft + (i / (points.length - 1)) * (plotRight - plotLeft);

  const rectFor = (b: RangeBand | null) =>
    b ? { y: yFor(b.high), h: Math.max(yFor(b.low) - yFor(b.high), 1) } : null;

  const judge = (v: number, b: RangeBand | null) =>
    b != null && (v < b.low || v > b.high);

  return {
    xs: points.map((_, i) => xFor(i)),
    ys: points.map((p) => yFor(p.value)),
    secondaryYs: points.map((p) => (p.secondary != null ? yFor(p.secondary) : null)),
    outOfBand: points.map(
      (p) => judge(p.value, band) || (p.secondary != null && judge(p.secondary, secondaryBand ?? null)),
    ),
    bandRect: rectFor(band),
    secondaryBandRect: rectFor(secondaryBand),
    outerRect: rectFor(outerBand),
    yFor,
    plotLeft,
    plotRight,
  };
}

/** Which point indices get an axis label under the density rules. */
export function labelledIndices(count: number, outOfBand: boolean[]): number[] {
  const density = densityFor(count);
  if (density === 'empty' || density === 'dots') return [];
  if (density === 'labelled') return outOfBand.map((_, i) => i);
  const set = new Set<number>([0, count - 1]);
  outOfBand.forEach((oob, i) => {
    if (oob) set.add(i);
  });
  return [...set].sort((a, b) => a - b);
}

/** §6.3 dot-plot caption. Numeric words, no digits — the digit rule
 *  (§0.2) applies to this screen's static strings too. */
export function dotPlotCaption(count: number): string {
  return count === 1 ? 'One reading so far.' : 'Two readings so far.';
}

function composeLabel(
  points: RangeBandPoint[],
  band: RangeBand | null,
  unit: string | undefined,
  caption: string | undefined,
): string {
  const parts: string[] = [];
  if (caption) parts.push(caption);
  const n = points.length;
  parts.push(`${n} reading${n === 1 ? '' : 's'} plotted`);
  if (band) parts.push(`usual band ${band.low} to ${band.high}${unit ? ` ${unit}` : ''}`);
  const latest = points[n - 1];
  if (latest) {
    const pair =
      latest.secondary != null ? `${latest.value} over ${latest.secondary}` : `${latest.value}`;
    parts.push(`latest ${pair}${unit ? ` ${unit}` : ''}`);
  }
  return `${parts.join(', ')}.`;
}

export function RangeBandChart({
  vital,
  points,
  band,
  secondaryBand,
  outerBand,
  unit,
  caption,
  subCaption,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  testID,
  style,
}: RangeBandChartProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const lastDetent = useRef<number | null>(null);

  const geometry = useMemo(
    () =>
      points.length > 0
        ? buildRangeBandGeometry(points, band, secondaryBand ?? null, outerBand ?? null, width, height)
        : null,
    [points, band, secondaryBand, outerBand, width, height],
  );

  const density = densityFor(points.length);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !reduceMotion && density !== 'empty' && density !== 'dots',
        onMoveShouldSetPanResponder: () => !reduceMotion && density !== 'empty' && density !== 'dots',
        onPanResponderMove: (_evt, gesture) => {
          if (!geometry) return;
          const x = gesture.moveX;
          let best = 0;
          let bestDist = Number.POSITIVE_INFINITY;
          geometry.xs.forEach((px, i) => {
            const d = Math.abs(px - x);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          });
          setScrubIndex(best);
          if (lastDetent.current !== best) {
            lastDetent.current = best;
            void Haptics.selectionAsync().catch(() => undefined);
          }
        },
        onPanResponderRelease: () => {
          setScrubIndex(null);
          lastDetent.current = null;
        },
        onPanResponderTerminate: () => {
          setScrubIndex(null);
          lastDetent.current = null;
        },
      }),
    [geometry, reduceMotion, density],
  );

  if (density === 'empty') return null;

  const seriesColor = theme.colors.vital[vital];
  const captionStyle = theme.type('caption');
  const numericS = theme.type('numericS');
  const labels = geometry ? labelledIndices(points.length, geometry.outOfBand) : [];
  const a11yLabel = composeLabel(points, band, unit, caption);
  const scrubbed = scrubIndex != null ? points[scrubIndex] : null;

  return (
    <View
      // §6.3 — explicit: a labelled bare <View> is likely not exposed
      // on iOS without `accessible`.
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
      testID={testID}
      style={style}
      {...panResponder.panHandlers}
    >
      {caption || subCaption ? (
        <View style={styles.captionRow}>
          {caption ? (
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: theme.fontFamilies.eyebrow,
                fontSize: captionStyle.size - 1,
                lineHeight: captionStyle.lineHeight,
                letterSpacing: 0.6,
                color: theme.colors.text.tertiary,
                textTransform: 'uppercase',
              }}
            >
              {caption}
            </Text>
          ) : (
            <View />
          )}
          {subCaption ? (
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: numericS.family,
                fontVariant: ['tabular-nums'],
                fontSize: numericS.size,
                lineHeight: numericS.lineHeight,
                color: theme.colors.text.tertiary,
              }}
            >
              {subCaption}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {geometry?.outerRect ? (
          <Rect
            x={geometry.plotLeft}
            y={geometry.outerRect.y}
            width={geometry.plotRight - geometry.plotLeft}
            height={geometry.outerRect.h}
            fill={seriesColor}
            opacity={OUTER_BAND_OPACITY}
          />
        ) : null}
        {geometry?.bandRect ? (
          <Rect
            x={geometry.plotLeft}
            y={geometry.bandRect.y}
            width={geometry.plotRight - geometry.plotLeft}
            height={geometry.bandRect.h}
            fill={seriesColor}
            opacity={BAND_OPACITY}
            testID={testID ? `${testID}-band` : undefined}
          />
        ) : null}
        {geometry?.secondaryBandRect ? (
          <Rect
            x={geometry.plotLeft}
            y={geometry.secondaryBandRect.y}
            width={geometry.plotRight - geometry.plotLeft}
            height={geometry.secondaryBandRect.h}
            fill={seriesColor}
            opacity={OUTER_BAND_OPACITY}
          />
        ) : null}

        {/* Band-endpoint labels — the axis IS the band (§6.3). */}
        {geometry && band ? (
          <>
            <SvgText
              x={geometry.plotLeft - 6}
              y={geometry.yFor(band.high) + 4}
              fontSize={numericS.size}
              fill={theme.colors.text.tertiary}
              textAnchor="end"
            >
              {String(band.high)}
            </SvgText>
            <SvgText
              x={geometry.plotLeft - 6}
              y={geometry.yFor(band.low) + 4}
              fontSize={numericS.size}
              fill={theme.colors.text.tertiary}
              textAnchor="end"
            >
              {String(band.low)}
            </SvgText>
          </>
        ) : null}

        {/* Polyline — not for the dot plot. */}
        {geometry && density !== 'dots' ? (
          <>
            <Polyline
              points={geometry.xs.map((x, i) => `${x},${geometry.ys[i]}`).join(' ')}
              fill="none"
              stroke={seriesColor}
              strokeWidth={PRIMARY_STROKE}
            />
            {geometry.secondaryYs.some((y) => y != null) ? (
              <Polyline
                points={geometry.xs
                  .map((x, i) =>
                    geometry.secondaryYs[i] != null ? `${x},${geometry.secondaryYs[i]}` : null,
                  )
                  .filter(Boolean)
                  .join(' ')}
                fill="none"
                stroke={seriesColor}
                strokeWidth={SECONDARY_STROKE}
                strokeDasharray="4 3"
              />
            ) : null}
          </>
        ) : null}

        {/* Points. */}
        {geometry
          ? geometry.xs.map((x, i) => {
              const isLatest = i === points.length - 1;
              const oob = geometry.outOfBand[i];
              const r = oob ? OUT_OF_BAND_DOT : isLatest ? LATEST_DOT : PRIMARY_DOT;
              return (
                <Circle
                  key={`p-${i}`}
                  cx={x}
                  cy={geometry.ys[i]}
                  r={r}
                  fill={isLatest ? theme.colors.text.primary : oob ? theme.colors.status.attention : seriesColor}
                  stroke={oob ? theme.colors.status.attention : 'none'}
                  strokeWidth={oob ? OUT_OF_BAND_RING : 0}
                  testID={
                    testID
                      ? oob
                        ? `${testID}-point-oob-${i}`
                        : `${testID}-point-${i}`
                      : undefined
                  }
                />
              );
            })
          : null}
        {/* Secondary series — hollow squares (shape, never opacity). */}
        {geometry
          ? geometry.secondaryYs.map((y, i) =>
              y != null ? (
                <Rect
                  key={`s-${i}`}
                  x={geometry.xs[i] - SECONDARY_SQUARE / 2}
                  y={y - SECONDARY_SQUARE / 2}
                  width={SECONDARY_SQUARE}
                  height={SECONDARY_SQUARE}
                  fill="none"
                  stroke={seriesColor}
                  strokeWidth={1.2}
                  testID={testID ? `${testID}-secondary-${i}` : undefined}
                />
              ) : null,
            )
          : null}

        {/* Scrub rule. */}
        {geometry && scrubIndex != null ? (
          <SvgLine
            x1={geometry.xs[scrubIndex]}
            y1={PADDING_TOP}
            x2={geometry.xs[scrubIndex]}
            y2={height - PADDING_BOTTOM}
            stroke={theme.colors.text.secondary}
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        ) : null}

        {/* Axis labels per density. */}
        {geometry
          ? labels.map((i) =>
              points[i].label ? (
                <SvgText
                  key={`l-${i}`}
                  x={geometry.xs[i]}
                  y={height - 6}
                  fontSize={numericS.size - 1}
                  fill={theme.colors.text.tertiary}
                  textAnchor="middle"
                >
                  {points[i].label as string}
                </SvgText>
              ) : null,
            )
          : null}
      </Svg>

      {/* Scrub callout. */}
      {scrubbed ? (
        <View style={[styles.callout, { backgroundColor: theme.colors.surface.warmElevated }]}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
            style={{
              fontFamily: numericS.family,
              fontVariant: ['tabular-nums'],
              fontSize: numericS.size,
              lineHeight: numericS.lineHeight,
              color: theme.colors.text.primary,
            }}
          >
            {scrubbed.secondary != null
              ? `${scrubbed.value}/${scrubbed.secondary}`
              : `${scrubbed.value}`}
            {unit ? ` ${unit}` : ''}
            {scrubbed.label ? ` · ${scrubbed.label}` : ''}
          </Text>
        </View>
      ) : null}

      {/* §6.3 dot-plot caption. */}
      {density === 'dots' ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
          style={{
            fontFamily: captionStyle.family,
            fontSize: captionStyle.size,
            lineHeight: captionStyle.lineHeight,
            color: theme.colors.text.tertiary,
            marginTop: 4,
          }}
          testID={testID ? `${testID}-dot-caption` : undefined}
        >
          {dotPlotCaption(points.length)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  captionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  callout: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
});
