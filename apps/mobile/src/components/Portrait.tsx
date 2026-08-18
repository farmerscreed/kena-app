// Portrait — Sprint 7.7a (caregiver Family Constellation).
//
// Circular initial-letter portrait used in the caregiver home's bird's-eye
// orbs and (in 7.7b) editorial cards. Each loved one gets one as a visual
// anchor when there's no photo. Background is a subtle accent-tinted
// gradient; the initial is rendered in the editorial serif so it reads as
// editorial portraiture, not avatar chrome.
//
// API:
//   - `accent` is the per-person hex (typically theme.colors.person.{1,2,3})
//     drawn from the rotating per-person palette.
//   - `initial` is a single character (the consumer slices the name
//     upstream — the Portrait doesn't know about names).
//   - `size` ∈ {sm 32 / md 44 / lg 56} matches the design's three usages:
//       sm legend rows, md detail-card header, lg drill-in.
//
// No animation. The breathing pulse lives on PersonOrb; Portrait stays
// static so it composes safely inside other animated wrappers.

import { type StyleProp, type ViewStyle, View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export type PortraitSize = 'sm' | 'md' | 'lg';

export interface PortraitProps {
  initial: string;
  accent: string;
  size?: PortraitSize;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const SIZE_PT: Record<PortraitSize, number> = {
  sm: 32,
  md: 44,
  lg: 56,
};

// Portrait initial size scales with the diameter — the design uses 0.45×
// for editorial cards and orbs both. Matches `leiko-caregiver-a.jsx`'s
// Portrait component.
const INITIAL_SIZE_RATIO = 0.45;

export function Portrait({
  initial,
  accent,
  size = 'md',
  testID,
  style,
}: PortraitProps) {
  const theme = useTheme();
  const diameter = SIZE_PT[size];
  const initialFontSize = Math.round(diameter * INITIAL_SIZE_RATIO);
  // Soft gradient background tinted with the accent at low opacity. RN
  // doesn't have native CSS gradients so we layer a translucent fill;
  // the accent border makes the tint read.
  // The tint hex is `accent + '22'` (≈13% alpha) to match the design's
  // oklch(40% .06 35) → oklch(28% .04 30) range without a gradient lib.
  const tintBackground = accent + '22';
  const borderColor = accent + '66';

  // No accessibility role/label here — the consumer (PersonOrb / PersonCard
  // / drill-in header) composes the full label including the person's name.
  // The Portrait reads as decorative chrome.
  return (
    <View
      style={[
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: tintBackground,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
      testID={testID}
    >
      <Text
        style={{
          fontFamily: theme.fontFamilies.editorialItalic,
          fontSize: initialFontSize,
          lineHeight: initialFontSize,
          color: accent,
        }}
        maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
      >
        {initial}
      </Text>
    </View>
  );
}
