// TrendsWeeklySummaryCard — Sprint 16.5g.
//
// Real weekly recap card. Pre-fix this rendered a static "Weekly
// summary · coming soon" placeholder; now it consumes the Tier-C
// engine output (`buildWeeklySummary` in services/ai/trendsTierC.ts)
// and renders a present-tense letter about what the week did.
//
// When the engine can't author a meaningful recap (insufficient data),
// the card falls back to the calm placeholder copy so the slot
// doesn't disappear entirely. The dashed-border treatment is reserved
// for the placeholder; the real recap uses a solid border.
//
// Voice rules (docs/05-voice-and-claims.md): all strings come from
// the engine, which is voice-clean by construction.

import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { buildWeeklySummary } from '../services/ai/trendsTierC';
import type { TrendsData } from '../utils/trends-aggregate';
import type { AccountType, CorrelationRow } from '../types/database';
import type { BPBaseline } from '../utils/vitalBaselines';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

export const TRENDS_WEEKLY_EYEBROW_FALLBACK = 'Weekly summary';
export const TRENDS_WEEKLY_BODY_FALLBACK =
  'A short letter every Sunday, once your week has a few days of readings.';

export interface TrendsWeeklySummaryCardProps {
  /** Aggregated trends data from useTrendsData. */
  data?: TrendsData;
  correlations?: CorrelationRow[];
  accountType?: AccountType;
  parentLabel?: string;
  baselineBP?: BPBaseline | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TrendsWeeklySummaryCard({
  data,
  correlations = [],
  accountType = 'caregiver',
  parentLabel,
  baselineBP,
  style,
  testID,
}: TrendsWeeklySummaryCardProps) {
  const theme = useTheme();

  const summary = useMemo(
    () =>
      buildWeeklySummary({
        data,
        correlations,
        accountType,
        parentLabel,
        baselines: { bp: baselineBP ?? null },
      }),
    [data, correlations, accountType, parentLabel, baselineBP],
  );

  const isPlaceholder = summary === null;
  const eyebrow = summary?.eyebrow ?? TRENDS_WEEKLY_EYEBROW_FALLBACK;
  const body = summary?.body ?? TRENDS_WEEKLY_BODY_FALLBACK;

  return (
    <View
      style={[
        styles.root,
        {
          marginHorizontal: theme.spacing.l,
          marginTop: theme.spacing.l,
          padding: theme.spacing.l,
          borderRadius: theme.radii.m,
          borderColor: theme.colors.border.subtle,
          borderStyle: isPlaceholder ? 'dashed' : 'solid',
          backgroundColor: isPlaceholder
            ? 'transparent'
            : theme.colors.surface.warmSubtle,
        },
        style,
      ]}
      testID={testID}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: theme.fontFamilies.numeric,
          fontSize: 9,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: isPlaceholder
            ? theme.colors.text.tertiary
            : theme.colors.brand.primary,
          marginBottom: 6,
        }}
        testID={testID ? `${testID}-eyebrow` : undefined}
      >
        {eyebrow}
      </Text>
      <Text
        style={[
          theme.type('bodyM'),
          { color: theme.colors.text.secondary },
        ]}
        testID={testID ? `${testID}-body` : undefined}
      >
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
  },
});
