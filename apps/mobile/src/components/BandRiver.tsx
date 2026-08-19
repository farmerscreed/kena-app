// BandRiver — the Story Trends hero. The person's own 28-day usual
// band recomputed at weekly anchors and drawn as a flowing ribbon:
// where the ribbon goes IS the story ("is it working?" answered by the
// band itself, no claims made). Change points render as quiet vertical
// rules so a genuine shift is findable at a glance.

import { useMemo } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Line as SvgLine, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE, MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';
import type { RiverAnchor } from '../services/story/bandRiver';
import type { ChangePoint } from '../utils/changePoints';
import { storyCopy } from '../services/voice/storyCopy';

export interface BandRiverProps {
  anchors: RiverAnchor[];
  changePoints: ChangePoint[];
  width?: number;
  height?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_W = 336;
const DEFAULT_H = 150;
const PAD_X = 30;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;

export function BandRiver({
  anchors,
  changePoints,
  width = DEFAULT_W,
  height = DEFAULT_H,
  testID,
  style,
}: BandRiverProps) {
  const theme = useTheme();
  const numericS = theme.type('numericS');
  const caption = theme.type('caption');

  const geometry = useMemo(() => {
    if (anchors.length < 2) return null;
    const values = anchors.flatMap((a) => [a.p10, a.p90]);
    const yMin = Math.min(...values) - 4;
    const yMax = Math.max(...values) + 4;
    const xFor = (i: number) =>
      PAD_X + (i / (anchors.length - 1)) * (width - PAD_X - 10);
    const yFor = (v: number) =>
      height - PAD_BOTTOM - ((v - yMin) / (yMax - yMin)) * (height - PAD_TOP - PAD_BOTTOM);
    const top = anchors.map((a, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)} ${yFor(a.p90)}`).join(' ');
    const bottom = [...anchors]
      .reverse()
      .map((a, ri) => `L${xFor(anchors.length - 1 - ri)} ${yFor(a.p10)}`)
      .join(' ');
    const meanLine = anchors
      .map((a, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)} ${yFor(a.mean)}`)
      .join(' ');
    return { xFor, yFor, ribbon: `${top} ${bottom} Z`, meanLine };
  }, [anchors, width, height]);

  const a11y = useMemo(() => {
    if (anchors.length < 2) return storyCopy.chapters.noChapters;
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    return `${storyCopy.riverEyebrow}: from ${Math.round(first.p10)} to ${Math.round(first.p90)} at the start, ${Math.round(last.p10)} to ${Math.round(last.p90)} now.${changePoints.length > 0 ? ` ${changePoints.length} shift${changePoints.length === 1 ? '' : 's'} along the way.` : ''}`;
  }, [anchors, changePoints]);

  if (!geometry) return null;
  const seriesColor = theme.colors.vital.bp;
  const last = anchors[anchors.length - 1];

  return (
    <View
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={a11y}
      testID={testID}
      style={style}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
        style={{
          fontFamily: theme.fontFamilies.eyebrow,
          fontSize: 11,
          lineHeight: 14,
          letterSpacing: 0.88,
          textTransform: 'uppercase',
          color: theme.colors.text.tertiary,
          marginBottom: 6,
        }}
      >
        {storyCopy.riverEyebrow}
      </Text>
      <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Path d={geometry.ribbon} fill={seriesColor} opacity={0.15} />
        <Path d={geometry.meanLine} stroke={seriesColor} strokeWidth={1.6} fill="none" />
        {changePoints.map((cp) => (
          <SvgLine
            key={cp.weekStart}
            x1={geometry.xFor(cp.index)}
            y1={PAD_TOP}
            x2={geometry.xFor(cp.index)}
            y2={height - PAD_BOTTOM}
            stroke={theme.colors.text.secondary}
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        ))}
        {/* Latest band endpoints label the right edge — the axis IS
            the band, same rule as RangeBandChart. */}
        <SvgText
          x={width - 6}
          y={geometry.yFor(last.p90) - 2}
          fontSize={numericS.size - 1}
          fill={theme.colors.text.tertiary}
          textAnchor="end"
        >
          {String(Math.round(last.p90))}
        </SvgText>
        <SvgText
          x={width - 6}
          y={geometry.yFor(last.p10) + 10}
          fontSize={numericS.size - 1}
          fill={theme.colors.text.tertiary}
          textAnchor="end"
        >
          {String(Math.round(last.p10))}
        </SvgText>
      </Svg>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[caption, { color: theme.colors.text.tertiary, marginTop: 4 }]}
      >
        {storyCopy.riverCaption}
      </Text>
    </View>
  );
}
