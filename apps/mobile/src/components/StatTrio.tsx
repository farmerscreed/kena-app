// StatTrio — Sprint 8.5 (vital-detail screens).
//
// Three small cards in a row, each showing label / value / unit. Used by
// every vital-detail screen as the headline-stat band immediately below
// the hero.
//
// API design:
//   - Presentational; consumer pre-formats every string.
//   - Always renders 3 items — a 4th is silently ignored, fewer renders
//     blanks (the consumer should always pass exactly 3).
//
// Accessibility: each card is accessibilityRole="text" with a composed
// label "<label>: <value> <unit>". Tap-through is intentionally not
// supported in Sprint 8.5 — these stats are summaries, not nav targets.
//
// Voice rules: all visible strings consumer-supplied; voice is checked
// at the call site (the per-vital detail screens).

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export interface StatTrioItem {
  /** Mono-uppercase label ("7-day avg", "Lowest", etc.). */
  label: string;
  /** Pre-formatted value ("121/77", "62", "7:42"). */
  value: string;
  /** Optional unit / context line. */
  unit?: string;
}

export interface StatTrioProps {
  items: [StatTrioItem, StatTrioItem, StatTrioItem];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatTrio({ items, testID, style }: StatTrioProps) {
  const theme = useTheme();
  const labelStyle = theme.type('labelUppercase');
  const valueStyle = theme.type('numericM');
  const captionStyle = theme.type('caption');

  return (
    <View style={[styles.row, { gap: theme.spacing.m }, style]} testID={testID}>
      {items.map((item, idx) => {
        const a11yLabel = item.unit
          ? `${item.label}: ${item.value} ${item.unit}`
          : `${item.label}: ${item.value}`;
        return (
          <View accessible={true}
            key={`${item.label}-${idx}`}
            accessibilityRole="text"
            accessibilityLabel={a11yLabel}
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surface.warmSubtle,
                borderColor: theme.colors.border.rim,
                borderRadius: theme.radii.m,
                padding: theme.spacing.m,
              },
            ]}
            testID={testID ? `${testID}-${idx}` : undefined}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: labelStyle.family,
                fontSize: labelStyle.size,
                lineHeight: labelStyle.lineHeight,
                letterSpacing: labelStyle.letterSpacing,
                color: theme.colors.text.tertiary,
                textTransform: 'uppercase',
                marginBottom: theme.spacing.xs,
              }}
            >
              {item.label}
            </Text>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontVariant: ['tabular-nums'],
                fontSize: valueStyle.size,
                lineHeight: valueStyle.lineHeight,
                color: theme.colors.text.primary,
              }}
            >
              {item.value}
            </Text>
            {item.unit ? (
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                style={{
                  fontFamily: theme.fontFamilies.numeric,
                  fontSize: captionStyle.size,
                  lineHeight: captionStyle.lineHeight,
                  color: theme.colors.text.tertiary,
                  letterSpacing: 0.4,
                  marginTop: theme.spacing.xs,
                }}
              >
                {item.unit}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 20,
  },
  card: {
    flex: 1,
    borderWidth: 0.5,
  },
});
