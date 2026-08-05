// DetailHeader — Sprint 8.5 (vital-detail screens).
//
// Glass-blurred back chevron on the left + uppercase mono vital eyebrow
// in the centre + ellipsis menu on the right. Translates the design's
// `DetailHeader` from leiko-detail.jsx (see docs/_reference/design-bundles.md).
//
// API design:
//   - Presentational. Consumer passes the vital + onBack.
//   - Optional onMenuPress (Sprint 10 lands the per-vital menu sheet);
//     omitted = the ellipsis renders disabled (kept for visual rhythm).
//
// Accessibility:
//   - Back button: accessibilityRole="button", accessibilityLabel="Back"
//   - Menu button: accessibilityRole="button", accessibilityLabel="More
//     options" (only when interactive).
//   - Eyebrow: accessibilityRole="header" with accessibilityLabel set to
//     the displayName ("Blood pressure") so screen-reader users hear the
//     full word, not the BP/HR/SPO2 abbreviation.
//
// Voice rules (docs/05-voice-and-claims.md): no user-facing copy beyond
// the eyebrow string, which comes from `vitalThemes.eyebrowLabel` —
// voice-checked at the source.

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { vitalTheme } from '../utils/vitalThemes';
import type { VitalType } from './VitalRing';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export interface DetailHeaderProps {
  vital: VitalType;
  onBack: () => void;
  onMenuPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const CHEVRON_SIZE = 14;
const MENU_DOT_RADIUS = 1.5;

export function DetailHeader({
  vital,
  onBack,
  onMenuPress,
  testID,
  style,
}: DetailHeaderProps) {
  const theme = useTheme();
  const { displayName, eyebrowLabel } = vitalTheme(vital);
  const labelStyle = theme.type('labelUppercase');
  const vitalColor = theme.colors.vital[vital];

  return (
    <View
      style={[styles.row, style]}
      testID={testID}
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        testID={testID ? `${testID}-back` : undefined}
        style={({ pressed }) => [
          styles.iconButton,
          {
            backgroundColor: theme.colors.surface.warmSubtle,
            borderColor: theme.colors.border.rim,
            opacity: pressed ? 0.65 : 1,
          },
        ]}
      >
        <Svg width={CHEVRON_SIZE} height={CHEVRON_SIZE} viewBox="0 0 24 24" fill="none">
          <Path
            d="M15 6 L9 12 L15 18"
            stroke={theme.colors.text.primary}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>

      <Text
        accessibilityRole="header"
        accessibilityLabel={displayName}
        maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
        style={{
          fontFamily: labelStyle.family,
          fontSize: labelStyle.size,
          lineHeight: labelStyle.lineHeight,
          letterSpacing: labelStyle.letterSpacing,
          color: vitalColor,
          textTransform: 'uppercase',
        }}
      >
        {eyebrowLabel}
      </Text>

      <Pressable
        onPress={onMenuPress}
        accessibilityRole="button"
        accessibilityLabel="More options"
        accessibilityState={{ disabled: !onMenuPress }}
        hitSlop={8}
        disabled={!onMenuPress}
        testID={testID ? `${testID}-menu` : undefined}
        style={({ pressed }) => [
          styles.iconButton,
          {
            backgroundColor: theme.colors.surface.warmSubtle,
            borderColor: theme.colors.border.rim,
            opacity: pressed && onMenuPress ? 0.65 : onMenuPress ? 1 : 0.4,
          },
        ]}
      >
        <Svg width={22} height={6} viewBox="0 0 22 6">
          <Circle cx={3} cy={3} r={MENU_DOT_RADIUS} fill={theme.colors.text.tertiary} />
          <Circle cx={11} cy={3} r={MENU_DOT_RADIUS} fill={theme.colors.text.tertiary} />
          <Circle cx={19} cy={3} r={MENU_DOT_RADIUS} fill={theme.colors.text.tertiary} />
        </Svg>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
});
