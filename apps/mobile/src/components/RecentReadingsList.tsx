// RecentReadingsList — Sprint 8.5 (vital-detail screens).
//
// Vertical list of recent readings, each row showing a vital-color rail
// + value + context + time. Used by BP / SpO2 / Sleep / Activity detail
// screens (HRDetail uses the HRZonesCard instead, no readings list).
//
// API design:
//   - Presentational. Consumer formats every string.
//   - Optional onSelect per row (Sprint 8.5 wires BP rows → ReadingDetail
//     by readingLocalId; other vitals defer interaction to Sprint 9+).
//
// Accessibility: each row is accessibilityRole="button" when onSelect is
// provided; otherwise "text". Composed label
// "<value>, <context>, <time>".
//
// Voice rules: all visible strings consumer-supplied.

import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';
import type { VitalType } from './VitalRing';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export interface RecentReading {
  /** Stable id for keys + tests. Optional id for navigation purposes. */
  id: string;
  /** Pre-formatted headline value ("122/78", "98%", "7:42"). */
  value: string;
  /** Mono-uppercase context line ("Just now · resting"). */
  context: string;
  /** Mono time label ("6:42 am", "Sat", "now"). */
  time: string;
}

export interface RecentReadingsListProps {
  vital: VitalType;
  readings: RecentReading[];
  onSelect?: (reading: RecentReading) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function RecentReadingsList({
  vital,
  readings,
  onSelect,
  testID,
  style,
}: RecentReadingsListProps) {
  const theme = useTheme();
  const valueStyle = theme.type('numericM');
  const contextStyle = theme.type('labelUppercase');
  const timeStyle = theme.type('caption');
  const vitalColor = theme.colors.vital[vital];

  if (readings.length === 0) {
    return (
      <View
        style={[
          styles.empty,
          {
            backgroundColor: theme.colors.surface.warmSubtle,
            borderColor: theme.colors.border.rim,
            borderRadius: theme.radii.l,
            padding: theme.spacing.l,
            marginHorizontal: 20,
          },
          style,
        ]}
        testID={testID ? `${testID}-empty` : testID}
      >
        <Text
          accessibilityLiveRegion="polite"
          style={{
            fontFamily: timeStyle.family,
            fontSize: timeStyle.size,
            lineHeight: timeStyle.lineHeight,
            color: theme.colors.text.tertiary,
            textAlign: 'center',
          }}
        >
          Recent readings will land here as they come in.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface.warmSubtle,
          borderColor: theme.colors.border.rim,
          borderRadius: theme.radii.l,
          marginHorizontal: 20,
          paddingHorizontal: theme.spacing.l,
        },
        style,
      ]}
      testID={testID}
    >
      {readings.map((r, idx) => {
        const isLast = idx === readings.length - 1;
        const interactive = Boolean(onSelect);
        const a11yLabel = `${r.value}, ${r.context}, ${r.time}`;
        return (
          <Pressable
            key={r.id}
            onPress={interactive ? () => onSelect?.(r) : undefined}
            accessibilityRole={interactive ? 'button' : 'text'}
            accessibilityLabel={a11yLabel}
            hitSlop={interactive ? 4 : undefined}
            testID={testID ? `${testID}-row-${r.id}` : undefined}
            style={({ pressed }) => [
              styles.row,
              {
                paddingVertical: theme.spacing.m,
                borderBottomColor: theme.colors.border.subtle,
                borderBottomWidth: isLast ? 0 : 0.5,
                opacity: pressed && interactive ? 0.7 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.rail,
                { backgroundColor: vitalColor },
              ]}
            />
            <View style={{ flex: 1, marginLeft: theme.spacing.m }}>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                style={{
                  fontFamily: theme.fontFamilies.editorial,
                  fontSize: valueStyle.size,
                  lineHeight: valueStyle.lineHeight,
                  color: theme.colors.text.primary,
                }}
              >
                {r.value}
              </Text>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                style={{
                  fontFamily: contextStyle.family,
                  fontSize: contextStyle.size,
                  lineHeight: contextStyle.lineHeight,
                  letterSpacing: contextStyle.letterSpacing,
                  color: theme.colors.text.tertiary,
                  textTransform: 'uppercase',
                  marginTop: 3,
                }}
              >
                {r.context}
              </Text>
            </View>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: timeStyle.size,
                lineHeight: timeStyle.lineHeight,
                color: theme.colors.text.tertiary,
                letterSpacing: 0.4,
              }}
            >
              {r.time}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0.5,
  },
  empty: {
    borderWidth: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rail: {
    width: 6,
    height: 32,
    borderRadius: 3,
  },
});
