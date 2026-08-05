// TrendsEvidenceCard — Trends v2 "The Letter".
//
// The focal chart that sits below the narrative paragraph as visual
// evidence. Low-contrast by design — the narrative is the lead, the
// chart is the proof. One vital per render (AI-picked upstream). For
// v1.0 the picker defaults to BP since that's the headline vital.
//
// Renders:
//   - "The evidence" mono eyebrow + vital name
//   - Latest numeric value on the right (editorial serif)
//   - SVG line with a faint healthy-range band
//   - Today pin marker at the rightmost point
//   - Optional "annotation" pin — a vertical dashed line + label,
//     used when the cited correlation references a specific day
//   - Date axis caption underneath
//
// The annotation feature is wired but optional. v1.0 only fires it
// when the caller passes an `annotation` prop. The Tier-B narrative
// engine will eventually surface the cited-day; until then, the
// screen omits the annotation and the chart reads as a clean trend.

import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { useTheme } from '../theme';
import type { VitalType } from './VitalRing';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

const CHART_W = 320;
const CHART_H = 110;
const PAD_X = 14;
const PAD_Y = 14;
const INNER_H = CHART_H - PAD_Y * 2 - 12;

export interface EvidenceAnnotation {
  /** Index into `series` to anchor the annotation pin. */
  index: number;
  /** Short uppercase label shown at the top of the pin. */
  label: string;
}

export interface TrendsEvidenceCardProps {
  vital: VitalType;
  /** Display label for the vital row, e.g. "Blood pressure · morning". */
  title: string;
  /** Pre-formatted hero value, e.g. "122/78" for BP or "62" for HR. */
  latestValue: string;
  /** The bucketed series the chart plots. */
  series: number[];
  /** Min/max for the visible Y axis. Caller supplies the band that
   *  matches the vital's healthy range. */
  yRange: [number, number];
  /** Range band rendered behind the line. Inclusive. */
  healthyBand?: [number, number];
  /** Optional annotation pin — used for "the cited day". */
  annotation?: EvidenceAnnotation;
  /** Left/right axis captions, e.g. "Apr 12" / "Today · May 12". */
  axisStart?: string;
  axisEnd?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TrendsEvidenceCard({
  vital,
  title,
  latestValue,
  series,
  yRange,
  healthyBand,
  annotation,
  axisStart,
  axisEnd,
  style,
  testID,
}: TrendsEvidenceCardProps) {
  const theme = useTheme();
  const vitalColor = theme.colors.vital[vital];
  const gradientId = `trends-evidence-${vital}-fill`;

  const { path, fillPath, xs, ys } = useMemo(() => {
    const [yMin, yMax] = yRange;
    const range = Math.max(0.0001, yMax - yMin);
    const xsCalc = series.map(
      (_, i) =>
        PAD_X + ((CHART_W - PAD_X * 2) * i) / Math.max(1, series.length - 1),
    );
    const ysCalc = series.map(
      (v) => PAD_Y + INNER_H - ((v - yMin) / range) * INNER_H,
    );
    const pathStr = ysCalc
      .map((y, i) => `${i ? 'L' : 'M'} ${xsCalc[i]} ${y}`)
      .join(' ');
    const fillStr =
      ysCalc.length > 0
        ? `${pathStr} L ${xsCalc[xsCalc.length - 1]} ${
            PAD_Y + INNER_H
          } L ${xsCalc[0]} ${PAD_Y + INNER_H} Z`
        : '';
    return { path: pathStr, fillPath: fillStr, xs: xsCalc, ys: ysCalc };
  }, [series, yRange]);

  const [yMin, yMax] = yRange;
  const range = Math.max(0.0001, yMax - yMin);
  const bandTop = healthyBand
    ? PAD_Y + INNER_H - ((healthyBand[1] - yMin) / range) * INNER_H
    : null;
  const bandHeight = healthyBand
    ? ((healthyBand[1] - healthyBand[0]) / range) * INNER_H
    : 0;

  const annotationIdx =
    annotation && xs.length > annotation.index ? annotation.index : null;

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.surface.warmElevated,
          borderColor: theme.colors.border.subtle,
          borderRadius: theme.radii.l,
          padding: theme.spacing.l,
          marginHorizontal: theme.spacing.l,
        },
        style,
      ]}
      testID={testID}
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: 9,
              lineHeight: 12,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              color: theme.colors.brand.primary,
            }}
            testID={testID ? `${testID}-eyebrow` : undefined}
          >
            The evidence
          </Text>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: theme.fontFamilies.bodyMedium,
              fontSize: 13,
              lineHeight: 18,
              color: theme.colors.text.primary,
              marginTop: 3,
            }}
            testID={testID ? `${testID}-title` : undefined}
          >
            {title}
          </Text>
        </View>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.editorial,
            fontSize: 22,
            lineHeight: 26,
            color: theme.colors.text.primary,
            letterSpacing: -0.2,
          }}
          testID={testID ? `${testID}-value` : undefined}
        >
          {latestValue}
        </Text>
      </View>

      <Svg
        width="100%"
        height={CHART_H}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        testID={testID ? `${testID}-chart` : undefined}
      >
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={vitalColor} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={vitalColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {healthyBand && bandTop !== null ? (
          <Rect
            x={PAD_X}
            y={bandTop}
            width={CHART_W - PAD_X * 2}
            height={bandHeight}
            fill={vitalColor}
            fillOpacity={0.05}
          />
        ) : null}
        {fillPath ? <Path d={fillPath} fill={`url(#${gradientId})`} /> : null}
        {path ? (
          <Path
            d={path}
            fill="none"
            stroke={vitalColor}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {annotationIdx !== null ? (
          <>
            <Line
              x1={xs[annotationIdx]}
              y1={ys[annotationIdx]}
              x2={xs[annotationIdx]}
              y2={20}
              stroke={theme.colors.brand.primary}
              strokeOpacity={0.55}
              strokeDasharray="2 3"
            />
            <Circle
              cx={xs[annotationIdx]}
              cy={ys[annotationIdx]}
              r={3.5}
              fill={theme.colors.brand.primary}
              stroke={theme.colors.surface.warmBase}
              strokeWidth={1.5}
            />
            <SvgText
              x={xs[annotationIdx] - 4}
              y={14}
              textAnchor="end"
              fontFamily={theme.fontFamilies.numeric}
              fontSize={7.5}
              letterSpacing={0.7}
              fill={theme.colors.brand.primary}
            >
              {annotation?.label ?? ''}
            </SvgText>
          </>
        ) : null}

        {xs.length > 0 ? (
          <Circle
            cx={xs[xs.length - 1]}
            cy={ys[ys.length - 1]}
            r={3.5}
            fill={vitalColor}
            stroke={theme.colors.surface.warmBase}
            strokeWidth={1.5}
          />
        ) : null}
      </Svg>

      <View style={styles.axisRow}>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: 9,
            letterSpacing: 0.5,
            color: theme.colors.text.tertiary,
          }}
          testID={testID ? `${testID}-axis-start` : undefined}
        >
          {axisStart ?? ''}
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: 9,
            letterSpacing: 0.5,
            color: theme.colors.text.tertiary,
          }}
          testID={testID ? `${testID}-axis-end` : undefined}
        >
          {axisEnd ?? ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
});
