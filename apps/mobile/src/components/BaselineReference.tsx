// BaselineReference — Sprint 16.5f.
//
// Small inline "Your usual: X–Y" line surfaced under each detail-screen
// hero. Replaces the bare hero range phrase — which made a
// claim ("your range") without showing the range. Now the user sees the
// reference and can judge for themselves.
//
// Pure presentational. Renders nothing when `body` is empty (the parent
// passes "" when the local history is too short to justify a baseline).
//
// Voice rules: caller passes formatted strings; this component frames
// them with "Your usual" — never "normal range" or "healthy range"
// (those imply clinical thresholds).

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

export interface BaselineReferenceProps {
  /** The pre-formatted baseline body (e.g. "115–128 / 72–82" or
   *  "62–78 bpm"). Empty string → component renders nothing. */
  body: string;
  /** Eyebrow label. Defaults to "Your usual" — caller can override
   *  with "Your typical" / "Your range" when context warrants. */
  eyebrow?: string;
  /** Optional caption shown after the body (e.g. "over the last 30 days"). */
  caption?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function BaselineReference({
  body,
  eyebrow = 'Your usual',
  caption,
  testID,
  style,
}: BaselineReferenceProps) {
  const theme = useTheme();
  if (!body) return null;
  const labelStyle = theme.type('labelUppercase');
  const captionStyle = theme.type('caption');

  return (
    <View
      style={[styles.root, style]}
      accessibilityRole="text"
      accessibilityLabel={`${eyebrow}: ${body}${caption ? `, ${caption}` : ''}`}
      testID={testID}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: labelStyle.family,
          fontSize: labelStyle.size,
          lineHeight: labelStyle.lineHeight,
          letterSpacing: labelStyle.letterSpacing,
          color: theme.colors.text.tertiary,
          textTransform: 'uppercase',
          marginBottom: 2,
        }}
      >
        {eyebrow}
      </Text>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: theme.fontFamilies.numeric,
          fontSize: 14,
          color: theme.colors.text.secondary,
          letterSpacing: 0.2,
        }}
        testID={testID ? `${testID}-body` : undefined}
      >
        {body}
      </Text>
      {caption ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: captionStyle.family,
            fontSize: captionStyle.size,
            lineHeight: captionStyle.lineHeight,
            color: theme.colors.text.tertiary,
            marginTop: 2,
          }}
        >
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 4,
  },
});
