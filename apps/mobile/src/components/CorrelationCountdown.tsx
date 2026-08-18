// CorrelationCountdown — D13 PR-11 (§6.6). A progress rule + one
// sentence. Shows only when the engine reports n < 14 for a pair it
// can compute, and only when the user has supplied at least one of the
// two inputs. Once n clears, the caller renders the finding or the
// §7.5 honest negative instead — never nothing.

import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE } from '../theme/fontScaling';
import { correlationCopy, CORRELATION_MIN_N } from '../services/voice/correlationCopy';
import { SELF_SUBJECT, type Subject } from '../services/voice/tierVocabulary';

export interface CorrelationCountdownProps {
  /** Nights of paired data the engine can already see. */
  pairedNights: number;
  subject?: Subject;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function CorrelationCountdown({
  pairedNights,
  subject = SELF_SUBJECT,
  testID,
  style,
}: CorrelationCountdownProps) {
  const theme = useTheme();
  if (pairedNights <= 0 || pairedNights >= CORRELATION_MIN_N) return null;
  const remaining = CORRELATION_MIN_N - pairedNights;
  const caption = theme.type('caption');

  return (
    <View
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={correlationCopy.counting(remaining, subject)}
      testID={testID}
      style={[{ marginHorizontal: 20, marginTop: theme.spacing.m }, style]}
    >
      {/* The progress rule. */}
      <View
        style={{
          height: 3,
          borderRadius: 2,
          backgroundColor: theme.colors.surface.warmElevated,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.round((pairedNights / CORRELATION_MIN_N) * 100)}%`,
            height: '100%',
            backgroundColor: theme.colors.vital.sleep,
          }}
        />
      </View>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[caption, { color: theme.colors.text.tertiary, marginTop: 6 }]}
      >
        {correlationCopy.counting(remaining, subject)}
      </Text>
    </View>
  );
}
