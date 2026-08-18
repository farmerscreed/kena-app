// Sourced from docs/03-components/pill.md (D8 §3.13). 6 variants × default /
// pressed / selected / disabled. Static pills render as <View accessibilityRole="text">;
// pills with onPress render as <Pressable accessibilityRole="button"> with a hitSlop
// large enough that the touch target meets 48pt (caregiver) / 64pt (parent).
//
// Sprint 1 deviation: the spec calls for a 12pt Phosphor `Check` icon when the
// `selected` state is active. We don't ship an icon library in Sprint 1, so the
// `selected` flip is a colour change only. Color is normally not the sole signal,
// per docs/02-design-tokens.md §1.3 — the visible text on a filter chip provides
// the secondary signal until the icon lands in a later sprint.

import { type ReactNode } from 'react';
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';

export type PillVariant = 'neutral' | 'info' | 'accent' | 'urgent' | 'success' | 'outline';

interface PillProps {
  variant?: PillVariant;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  leadingIcon?: ReactNode;
  children: ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface VariantStyle {
  background: string;
  text: string;
  borderColor?: string;
}

function hexAt(hex: string, alpha: number): string {
  // Compose a hex color with an alpha channel as rgba(). Used for the
  // success variant background (D12-mode-aware tint over the surface).
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function variantStyle(
  variant: PillVariant,
  theme: ReturnType<typeof useTheme>,
): VariantStyle {
  switch (variant) {
    case 'neutral':
      return { background: theme.colors.surface.subtle, text: theme.colors.text.primary };
    case 'info':
      return { background: theme.colors.surface.subtle, text: theme.colors.text.secondary };
    case 'accent':
      // D12 §11.1: selected state uses brand-primary background. accent === selected
      // since Pill's selected-flip delegates to this variant.
      return { background: theme.colors.brand.primary, text: theme.colors.text.onBrand };
    case 'urgent':
      return { background: theme.colors.state.urgent, text: theme.colors.text.onUrgent };
    case 'success':
      // color.state.success at 15% over the surface — derived from the
      // mode-resolved hex so the tint stays legible in both dark and light.
      return {
        background: hexAt(theme.colors.state.success, 0.15),
        text: theme.colors.state.success,
      };
    case 'outline':
      return {
        background: 'transparent',
        text: theme.colors.text.primary,
        borderColor: theme.colors.border.subtle,
      };
  }
}

export function Pill({
  variant = 'neutral',
  selected = false,
  disabled = false,
  onPress,
  leadingIcon,
  children,
  accessibilityLabel,
  style,
  testID,
}: PillProps) {
  const theme = useTheme();
  const palette = variantStyle(selected ? 'accent' : variant, theme);
  const labelStyle = theme.type('caption');

  const containerStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.s,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radii.full,
    backgroundColor: palette.background,
    borderWidth: palette.borderColor ? 1 : 0,
    borderColor: palette.borderColor,
    opacity: disabled ? theme.opacity.disabled : 1,
    alignSelf: 'flex-start',
  };

  const textStyle: TextStyle = {
    fontSize: labelStyle.size,
    lineHeight: labelStyle.lineHeight,
    fontFamily: labelStyle.family,
    fontWeight: '700',
    color: palette.text,
  };

  const labelFromChildren = typeof children === 'string' ? children : undefined;
  const a11yLabel = accessibilityLabel ?? labelFromChildren;

  // Hit-slop large enough to clear the 48pt (caregiver) / 64pt (parent) tap
  // target. Caption is 12–13pt + spacing.xs vertical padding (4pt each side)
  // ≈ 24pt tall; 20pt slop top+bottom puts us at 64pt which clears both modes.
  const hitSlop = { top: 20, bottom: 20, left: 12, right: 12 };

  if (onPress) {
    return (
      <Pressable
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled }}
        accessibilityLabel={a11yLabel}
        hitSlop={hitSlop}
        testID={testID}
        style={({ pressed }) => [
          containerStyle,
          pressed && !disabled ? { opacity: 0.92 } : null,
          style,
        ]}
      >
        {leadingIcon ? <View style={{ marginRight: theme.spacing.xs }}>{leadingIcon}</View> : null}
        <Text style={textStyle}>{children}</Text>
      </Pressable>
    );
  }

  return (
    <View accessible={true}
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
      testID={testID}
      style={[containerStyle, style]}
    >
      {leadingIcon ? <View style={{ marginRight: theme.spacing.xs }}>{leadingIcon}</View> : null}
      <Text style={textStyle}>{children}</Text>
    </View>
  );
}
