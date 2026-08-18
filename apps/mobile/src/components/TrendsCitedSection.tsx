// TrendsCitedSection — Trends v2 "The Letter".
//
// The "Cited" footnote rail under the evidence chart. Numbered cards
// presenting each meaningful correlation as evidence the narrative
// above cites. v1.0 doesn't yet wire the inline citation superscripts
// (the Tier-A engine isn't emitting structured spans), so cards are
// numbered 1..N in correlation-strength order — the user reads them
// as a footnote section.
//
// Inputs are the `CorrelationRow[]` from `useTrendsCorrelations`. The
// component computes the strength label + accent colour locally.
// Hidden entirely when the list is empty — per the spec, "restraint
// matters" (D13 §9.1).

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import type { CorrelationRow } from '../types/database';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

export const TRENDS_CITED_LABEL = 'Cited';

const CORRELATION_HEADLINE: Record<CorrelationRow['correlation_type'], string> = {
  sleep_x_morning_bp: 'Sleep × morning BP',
  activity_x_resting_hr: 'Activity × resting HR',
  spo2_dip_x_sleep_score: 'SpO2 × sleep score',
};

// Sprint 16.5g — deterministic body fallback per correlation type.
// Pre-fix, when both `narrative_long` and `narrative_short` were null
// (which the Sprint 9 backend doesn't always populate), the card
// rendered just the headline + strength label with no explanation.
// Now every card has at least one sentence of context.
const CORRELATION_BODY_FALLBACK: Record<CorrelationRow['correlation_type'], string> = {
  sleep_x_morning_bp:
    'After shorter nights, morning blood pressure has run a little higher.',
  activity_x_resting_hr:
    'On the days with more walking, resting heart rate has settled lower.',
  spo2_dip_x_sleep_score:
    'On the nights oxygen dipped, sleep tended to be lighter.',
};

function strengthLabel(r: number | null): 'Strong' | 'Moderate' | 'Gentle' {
  const abs = Math.abs(r ?? 0);
  if (abs >= 0.6) return 'Strong';
  if (abs >= 0.3) return 'Moderate';
  return 'Gentle';
}

export interface TrendsCitedSectionProps {
  rows: CorrelationRow[];
  /** Override row text body with a calm summary (the engine's
   *  narrative_long lives in correlations.narrative_long; the screen
   *  passes it through). */
  bodyFor?: (row: CorrelationRow) => string;
  /** Sprint 16.5g — tap handler. The screen navigates to the relevant
   *  detail screen ("Sleep × morning BP" → BPDetail). When omitted, the
   *  cards render as static. */
  onSelectRow?: (row: CorrelationRow) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TrendsCitedSection({
  rows,
  bodyFor,
  onSelectRow,
  style,
  testID,
}: TrendsCitedSectionProps) {
  const theme = useTheme();
  if (rows.length === 0) return null;

  const accentFor = (type: CorrelationRow['correlation_type']): string => {
    switch (type) {
      case 'sleep_x_morning_bp':
        return theme.colors.vital.sleep;
      case 'activity_x_resting_hr':
        return theme.colors.vital.hr;
      case 'spo2_dip_x_sleep_score':
        return theme.colors.vital.spo2;
      default:
        return theme.colors.brand.primary;
    }
  };

  return (
    <View style={[styles.root, style]} testID={testID}>
      <View
        style={[
          styles.eyebrowRow,
          { paddingHorizontal: theme.spacing.l, marginTop: theme.spacing.xl },
        ]}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: 10,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
            color: theme.colors.text.tertiary,
            marginRight: 8,
          }}
          testID={testID ? `${testID}-eyebrow` : undefined}
        >
          {TRENDS_CITED_LABEL}
        </Text>
        <View
          style={{
            flex: 1,
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme.colors.border.subtle,
          }}
        />
      </View>

      <View style={{ marginTop: theme.spacing.s }}>
        {rows.map((row, i) => {
          const accent = accentFor(row.correlation_type);
          const headline = CORRELATION_HEADLINE[row.correlation_type] ?? row.correlation_type;
          const body =
            bodyFor?.(row) ??
            row.narrative_long ??
            row.narrative_short ??
            CORRELATION_BODY_FALLBACK[row.correlation_type] ??
            '';
          // Sprint 16.5g — show the actual r value alongside the
          // strength label so users (or curious doctors) can see
          // the underlying number. Strong/Moderate/Gentle is the
          // headline; the value is the receipt.
          const rDisplay =
            row.pearson_r !== null
              ? `${row.pearson_r >= 0 ? '+' : ''}${row.pearson_r.toFixed(2)}`
              : null;
          const CardContent = (
            <>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  fontFamily: theme.fontFamilies.numeric,
                  fontSize: 18,
                  lineHeight: 20,
                  color: accent,
                  letterSpacing: -0.3,
                  marginRight: 14,
                }}
                testID={testID ? `${testID}-${i + 1}-numeral` : undefined}
              >
                {i + 1}
              </Text>
              <View style={{ flex: 1 }}>
                <View style={styles.strengthRow}>
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    style={{
                      fontFamily: theme.fontFamilies.numeric,
                      fontSize: 9,
                      letterSpacing: 1.4,
                      textTransform: 'uppercase',
                      color: accent,
                    }}
                    testID={testID ? `${testID}-${i + 1}-strength` : undefined}
                  >
                    {strengthLabel(row.pearson_r)}
                  </Text>
                  {rDisplay ? (
                    <Text
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                      style={{
                        fontFamily: theme.fontFamilies.numeric,
                        fontSize: 9,
                        letterSpacing: 0.6,
                        color: theme.colors.text.tertiary,
                        marginLeft: 6,
                      }}
                      testID={testID ? `${testID}-${i + 1}-r` : undefined}
                    >
                      {`r = ${rDisplay}`}
                    </Text>
                  ) : null}
                </View>
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={{
                    fontFamily: theme.fontFamilies.editorial,
                    fontSize: 15,
                    lineHeight: 20,
                    color: theme.colors.text.primary,
                    marginTop: 4,
                    marginBottom: 4,
                  }}
                  testID={testID ? `${testID}-${i + 1}-headline` : undefined}
                >
                  {headline}
                </Text>
                {body ? (
                  <Text
                    style={[
                      theme.type('bodyM'),
                      { color: theme.colors.text.secondary },
                    ]}
                    testID={testID ? `${testID}-${i + 1}-body` : undefined}
                  >
                    {body}
                  </Text>
                ) : null}
              </View>
            </>
          );
          const cardStyle = [
            styles.card,
            {
              marginHorizontal: theme.spacing.l,
              marginTop: theme.spacing.s,
              paddingVertical: theme.spacing.m,
              paddingHorizontal: theme.spacing.m,
              borderRadius: theme.radii.m,
              borderLeftWidth: 2,
              borderLeftColor: accent,
              backgroundColor: theme.colors.surface.warmSubtle,
            },
          ];
          if (onSelectRow) {
            return (
              <Pressable
                key={row.id}
                onPress={() => onSelectRow(row)}
                accessibilityRole="button"
                accessibilityHint="Opens the relevant detail screen"
                style={({ pressed }) => [
                  ...cardStyle,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
                testID={testID ? `${testID}-${i + 1}` : undefined}
              >
                {CardContent}
              </Pressable>
            );
          }
          return (
            <View
              key={row.id}
              style={cardStyle}
              testID={testID ? `${testID}-${i + 1}` : undefined}
            >
              {CardContent}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {},
  eyebrowRow: { flexDirection: 'row', alignItems: 'center' },
  card: { flexDirection: 'row', alignItems: 'flex-start' },
  strengthRow: { flexDirection: 'row', alignItems: 'baseline' },
});
