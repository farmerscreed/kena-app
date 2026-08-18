// TimeRangePills — Sprint 8.5 (vital-detail screens).
//
// Segmented control for the trend chart range. Three segments per the
// Sprint 8.5 acceptance criterion ("7d / 30d / 90d"). The design at
// new-design/project/leiko-detail.jsx had four (Day/Week/Month/Year);
// we go with the sprint-card values.
//
// API design:
//   - Presentational. Consumer owns the value + onChange.
//   - `value` is one of the union literals; if the consumer passes a
//     value not in the segment list it just renders all segments
//     unselected.
//
// Accessibility: each segment is accessibilityRole="tab" with
// accessibilityState.selected mirroring `value`. Container is
// accessibilityRole="tablist".

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export type TrendRange = '7d' | '30d' | '90d';

const SEGMENTS: Array<{ id: TrendRange; label: string }> = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
];

export interface TimeRangePillsProps {
  value: TrendRange;
  onChange: (range: TrendRange) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function TimeRangePills({
  value,
  onChange,
  testID,
  style,
}: TimeRangePillsProps) {
  const theme = useTheme();
  const labelStyle = theme.type('label');

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surface.warmSubtle,
          borderColor: theme.colors.border.rim,
          borderRadius: theme.radii.m,
          padding: theme.spacing.xs,
        },
        style,
      ]}
      testID={testID}
    >
      {SEGMENTS.map((seg) => {
        const selected = seg.id === value;
        return (
          <Pressable
            key={seg.id}
            accessibilityRole="tab"
            accessibilityLabel={`${seg.label} range`}
            accessibilityState={{ selected }}
            onPress={() => onChange(seg.id)}
            testID={testID ? `${testID}-${seg.id}` : undefined}
            style={({ pressed }) => [
              styles.segment,
              {
                backgroundColor: selected
                  ? theme.colors.surface.warmElevated
                  : 'transparent',
                borderRadius: theme.radii.s,
                opacity: pressed && !selected ? 0.7 : 1,
              },
            ]}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: labelStyle.size,
                lineHeight: labelStyle.lineHeight,
                letterSpacing: 0.4,
                color: selected
                  ? theme.colors.text.primary
                  : theme.colors.text.tertiary,
                textAlign: 'center',
              }}
            >
              {seg.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderWidth: 0.5,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
});
