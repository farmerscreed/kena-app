// TimeOfDayRing — D13 PR-7 (§7.3, the BP signature section).
//
// A 24-hour ring showing when readings usually land and where today's
// sit. Midnight at the top, clockwise through the day. Each historical
// reading adds weight to its hour-of-day position (rendered as dots
// sized by count); today's readings render as distinct filled marks in
// the series colour.
//
// Deliberately unlabelled: hour digits are static strings, and §0 rule
// 2 keeps digits out of vital-detail chrome that isn't data. The
// composed accessibility label carries the meaning instead.

import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

export interface TimeOfDayRingProps {
  /** Hour-of-day (0..23, wearer-local) of every reading in the window. */
  historyHours: number[];
  /** Hour-of-day of today's readings. */
  todayHours: number[];
  size?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const DOT_MIN = 2;
const DOT_MAX = 5;
// The "morning" / "evening" compass words sit outside the ring on the
// left and right. Without a horizontal gutter the SVG canvas ends at
// the ring's own box and clips them to "morni" / "ening".
const LABEL_GUTTER = 40;

function positionFor(hour: number, radius: number, cx: number, cy: number) {
  // Midnight at 12 o'clock, clockwise.
  const angle = (hour / 24) * 2 * Math.PI - Math.PI / 2;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

/** Buckets hours and scales dot radius by count. Exported for tests. */
export function hourBuckets(hours: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const h of hours) {
    const k = ((Math.floor(h) % 24) + 24) % 24;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function TimeOfDayRing({
  historyHours,
  todayHours,
  size = 148,
  testID,
  style,
}: TimeOfDayRingProps) {
  const theme = useTheme();
  const caption = theme.type('caption');
  const svgWidth = size + LABEL_GUTTER * 2;
  const cx = svgWidth / 2;
  const cy = size / 2;
  const radius = size / 2 - 26;

  const buckets = hourBuckets(historyHours);
  const maxCount = Math.max(1, ...buckets.values());

  const describe = () => {
    if (historyHours.length === 0) return 'No reading times to show yet.';
    const morning = historyHours.filter((h) => h < 12).length;
    const evening = historyHours.filter((h) => h >= 17).length;
    const lead =
      morning >= evening
        ? 'Readings usually land in the morning.'
        : 'Readings usually land in the evening.';
    return `${lead} ${todayHours.length > 0 ? `Today has ${todayHours.length}.` : ''}`.trim();
  };

  return (
    <View
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel={describe()}
      testID={testID}
      style={[{ alignItems: 'center' }, style]}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: theme.fontFamilies.eyebrow,
          fontSize: 11,
          lineHeight: 14,
          letterSpacing: 0.88,
          textTransform: 'uppercase',
          color: theme.colors.text.tertiary,
          marginBottom: 8,
        }}
      >
        When readings usually land
      </Text>
      <Svg width={svgWidth} height={size} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {/* The track. */}
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={theme.colors.surface.warmElevated}
          strokeWidth={1}
          fill="none"
        />
        {/* Compass words orient the clock face without digit chrome:
            midnight top, morning right, noon bottom, evening left. */}
        <Circle cx={cx} cy={cy - radius} r={1.5} fill={theme.colors.text.tertiary} />
        {/* History density dots. */}
        {[...buckets.entries()].map(([hour, count]) => {
          const { x, y } = positionFor(hour + 0.5, radius, cx, cy);
          const r = DOT_MIN + (count / maxCount) * (DOT_MAX - DOT_MIN);
          return (
            <Circle
              key={`h-${hour}`}
              cx={x}
              cy={y}
              r={r}
              fill={theme.colors.vital.bp}
              opacity={0.45}
            />
          );
        })}
        {/* Today's marks. */}
        {todayHours.map((hour, i) => {
          const { x, y } = positionFor(hour + 0.5, radius, cx, cy);
          return (
            <Circle
              key={`t-${i}`}
              cx={x}
              cy={y}
              r={3.4}
              fill={theme.colors.text.primary}
              stroke={theme.colors.vital.bp}
              strokeWidth={1}
            />
          );
        })}
        <SvgText x={cx} y={cy - radius - 4} fontSize={9} fill={theme.colors.text.tertiary} textAnchor="middle">
          midnight
        </SvgText>
        <SvgText x={cx + radius + 4} y={cy + 3} fontSize={9} fill={theme.colors.text.tertiary} textAnchor="start">
          morning
        </SvgText>
        <SvgText x={cx} y={cy + radius + 12} fontSize={9} fill={theme.colors.text.tertiary} textAnchor="middle">
          noon
        </SvgText>
        <SvgText x={cx - radius - 4} y={cy + 3} fontSize={9} fill={theme.colors.text.tertiary} textAnchor="end">
          evening
        </SvgText>
      </Svg>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: caption.family,
          fontSize: caption.size,
          lineHeight: caption.lineHeight,
          color: theme.colors.text.tertiary,
          marginTop: 6,
          textAlign: 'center',
        }}
      >
        A clock face of your day: each dot is a time you tend to measure —
        bigger dots, more readings at that hour. The bright marks are today's.
      </Text>
    </View>
  );
}
