// StalenessHintRow — Sprint 16.5f.
//
// Calm one-line hint surfaced under a stale vital's hero. The hero's
// own `sub` slot already shows "Last sync 4h ago"; this row explains
// what to do about it ("Open the app within Bluetooth range to
// refresh.") so a user with multiple stale captions doesn't wonder if
// the watch is broken.
//
// Render only when caller passes `stale = true`. Pure presentational.
//
// Voice rules: calm, factual, action-forward. No fear.

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

export interface StalenessHintRowProps {
  /** When false, renders nothing. Hide-and-forget API for callers. */
  stale: boolean;
  /** Override the default hint copy. Voice-checked at the call site. */
  hint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const DEFAULT_HINT = 'Open the app within Bluetooth range to refresh.';

export function StalenessHintRow({
  stale,
  hint = DEFAULT_HINT,
  testID,
  style,
}: StalenessHintRowProps) {
  const theme = useTheme();
  if (!stale) return null;
  const captionStyle = theme.type('caption');
  return (
    <View style={[styles.root, style]} testID={testID}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.s,
          paddingHorizontal: theme.spacing.l,
          paddingVertical: theme.spacing.s,
          marginHorizontal: 20,
          borderRadius: theme.radii.m,
          backgroundColor: theme.colors.surface.warmSubtle,
          borderColor: theme.colors.border.subtle,
          borderWidth: 0.5,
        }}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: 14,
            color: theme.colors.text.tertiary,
          }}
        >
          ⓘ
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            flex: 1,
            fontFamily: captionStyle.family,
            fontSize: captionStyle.size,
            lineHeight: captionStyle.lineHeight,
            color: theme.colors.text.secondary,
          }}
          testID={testID ? `${testID}-hint` : undefined}
        >
          {hint}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: 4,
  },
});
