// Sourced from docs/_reference/D12-visual-system-v2.md §6 (elevation) +
// §11.1 (Card migration: rim light + tinted shadow per mode, glass variant
// added). Original anatomy in docs/03-components/card.md.
//
// Sprint 1.5 changes from D8:
//   - Elevation styles are now mode-aware automatically (theme.elevation
//     resolves to elevationDark or elevationLight per the active colorMode).
//     Dark surfaces lift via lightening + a 1px rim light at the top edge;
//     light surfaces lift via tinted-ink cast shadows. Components don't
//     branch on mode — they read theme.elevation[token] and the resolver
//     returns the right map.
//   - Rim light: when the active elevation map's `rimLight` flag is true
//     (dark mode, low/medium/high/glass), Card paints a 1px top border
//     in border.rim.
//   - 'glass' elevation variant added (D12 §6.3). Renders a BlurView
//     background + surface.glassMedium floor for the Android < 12 fallback.
//   - Default radius now 14 (theme.radii.m raised from D8s 12).
//
// Sprint 1 deviations retained: 'swipeable' behavioural variant + 'loading'
// state are still deferred. The press transform stays static (D12 §11.1
// doesn't migrate Card press to a spring — only Button gets that).

import { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme';

export type CardElevation = 'default' | 'low' | 'medium' | 'high' | 'glass';

interface CardProps {
  /**
   * Visual elevation. 'default' is the flat variant (subtle surface, no
   * shadow). 'low' | 'medium' | 'high' lift via mode-aware elevation
   * (rim light on dark, cast shadow on light). 'glass' renders the
   * material.glass.medium translucent surface — used over imagery or
   * over the constellation hero (D12 §6.3).
   */
  elevation?: CardElevation;
  /**
   * Presence of onPress flips the card from static (View, no role) to
   * tappable (Pressable, accessibilityRole="button"). When set,
   * `accessibilityLabel` should be provided — we warn at runtime when it
   * isn't.
   */
  onPress?: () => void;
  disabled?: boolean;
  /**
   * Required when `onPress` is set. Describes the destination
   * (e.g. "Mum's reading card, opens reading detail").
   */
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

export function Card({
  elevation = 'default',
  onPress,
  disabled = false,
  accessibilityLabel,
  testID,
  style,
  children,
}: CardProps) {
  const theme = useTheme();

  const isFlat = elevation === 'default';
  const isGlass = elevation === 'glass';
  const elevationKey = isFlat ? 'none' : elevation;
  const elevationStyle = theme.elevation[elevationKey];

  // Glass variant uses surface.glassMedium as the floor + BlurView overlay;
  // other variants use the solid surface tokens.
  const surfaceBg = isGlass
    ? theme.colors.surface.glassMedium
    : isFlat
      ? theme.colors.surface.subtle
      : theme.colors.surface.elevated;

  const containerStyle: ViewStyle = {
    backgroundColor: surfaceBg,
    borderRadius: theme.radii.m,
    padding: theme.spacing.l,
    opacity: disabled ? theme.opacity.disabled : 1,
    // Rim light — 1px top border in border.rim. Map is mode-resolved, so
    // border.rim is the rim color in dark mode and 'transparent' in light;
    // the borderTopWidth still sits in the layout but renders invisibly on light.
    ...(elevationStyle.rimLight
      ? { borderTopWidth: 1, borderTopColor: theme.colors.border.rim }
      : {}),
    // Glass needs overflow:hidden so the BlurView clips to the rounded corners.
    ...(isGlass ? { overflow: 'hidden' as const } : {}),
    // RN ignores platform-irrelevant shadow fields, so spread both.
    ...elevationStyle.ios,
    ...elevationStyle.android,
  };

  const blurTint: 'dark' | 'light' = theme.colorMode === 'dark' ? 'dark' : 'light';

  const renderContent = (): ReactNode => {
    if (!isGlass) return children;
    // Glass: BlurView fills the container behind the children.
    return (
      <>
        <BlurView intensity={50} tint={blurTint} style={StyleSheet.absoluteFill} />
        {children}
      </>
    );
  };

  if (onPress) {
    if (__DEV__ && !accessibilityLabel) {
      console.warn(
        'Card: tappable cards (cards with onPress) must supply an ' +
          'accessibilityLabel that describes the destination — e.g. ' +
          '"Mum\'s reading card, opens reading detail".',
      );
    }

    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={({ pressed }) => [
          containerStyle,
          pressed && !disabled ? { transform: [{ scale: 0.98 }] } : null,
          style,
        ]}
      >
        {renderContent()}
      </Pressable>
    );
  }

  return (
    <View accessible={true} testID={testID} accessibilityLabel={accessibilityLabel} style={[containerStyle, style]}>
      {renderContent()}
    </View>
  );
}
