// VitalInsightCard — Sprint 8.5 (vital-detail screens).
//
// Tier-B AI placeholder card. Header: tinted sparkle icon + uppercase
// "Leiko · about your <vital>" eyebrow. Body: a single voice-rule-clean
// paragraph (Sprint 8.5 ships placeholders; Sprint 12.5 replaces with the
// real ambient-AI generator).
//
// API design:
//   - Presentational. Consumer passes `body` text — voice rules apply at
//     the call site.
//   - The eyebrow uses `vitalTheme(vital).displayName` lower-cased so it
//     reads "Leiko · about your blood pressure" naturally.
//
// Accessibility: card is accessibilityRole="text"; composed label
// "Leiko about your <vital>: <body>".
//
// Voice rules: this file ships no user-facing copy beyond the eyebrow
// label. Body text is consumer-owned.

import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SparkleIcon } from 'phosphor-react-native';
import { useTheme } from '../theme';
import { vitalTheme } from '../utils/vitalThemes';
import type { VitalType } from './VitalRing';
import { MAX_FONT_SCALE_PROSE } from '../theme/fontScaling';

export interface VitalInsightCardProps {
  vital: VitalType;
  /** AI-generated paragraph (placeholder until Sprint 12.5). */
  body: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function VitalInsightCard({
  vital,
  body,
  testID,
  style,
}: VitalInsightCardProps) {
  const theme = useTheme();
  const labelStyle = theme.type('labelUppercase');
  const bodyStyle = theme.type('bodyM');
  const vitalColor = theme.colors.vital[vital];
  const lowerName = vitalTheme(vital).displayName.toLowerCase();
  const eyebrow = `Leiko · about your ${lowerName}`;
  const a11y = `Leiko about your ${lowerName}: ${body}`;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={a11y}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface.warmSubtle,
          borderColor: theme.colors.border.rim,
          borderRadius: theme.radii.l,
          padding: theme.spacing.l,
          marginHorizontal: 20,
        },
        style,
      ]}
      testID={testID}
    >
      <View style={styles.headerRow}>
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: vitalColor + '26' },
          ]}
        >
          <SparkleIcon size={11} color={vitalColor} weight="fill" />
        </View>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_PROSE}
          style={{
            fontFamily: labelStyle.family,
            fontSize: labelStyle.size,
            lineHeight: labelStyle.lineHeight,
            letterSpacing: labelStyle.letterSpacing,
            color: vitalColor,
            textTransform: 'uppercase',
            marginLeft: 8,
          }}
        >
          {eyebrow}
        </Text>
      </View>
      <Text
        style={{
          fontFamily: bodyStyle.family,
          fontSize: bodyStyle.size,
          lineHeight: bodyStyle.lineHeight,
          color: theme.colors.text.primary,
        }}
      >
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconWrap: {
    width: 18,
    height: 18,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
