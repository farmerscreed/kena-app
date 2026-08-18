// AnomalyBanner — D12 §11.2.6 (Sprint 7.6).
//
// Standalone primitive. Sprint 7's CaregiverHome currently embeds a private
// AnomalyBanner function for the placeholder; Sprint 7.7 swaps the screen-
// level usage onto this component. This file just ships the primitive.
//
// One-line deviation from D12 §11.2.6: the spec lists `onDismiss` as a
// required callback, but the same section says confirmed-urgent has no
// dismiss action ("must be acted on"). We make `onDismiss` optional and
// ignore it for severity='confirmed-urgent'. The dismiss X is rendered only
// when severity='calm-concerned' AND onDismiss is provided.
//
// Visual (D12 §11.2.6):
//   - calm-concerned: surface = state.warning (amber), text = text.onBrand,
//     radius.m. Phosphor WarningIcon at iconSize.l, left-aligned. Dismiss X
//     (XIcon, iconSize.s) on the right.
//   - confirmed-urgent: surface = state.urgent (crimson), text = text.onUrgent,
//     radius.m, elevation.high to feel weighted. Phosphor WarningCircleIcon
//     at iconSize.l, left-aligned. NO dismiss X.
//   - CTA (when provided): right-aligned text button on the row beneath the
//     body copy. Underlined to read as actionable; color tracks on-surface
//     text token.
//
// Motion (D12 §7.3 sheet-rise + §11.2.6):
//   - Appears: translateY -100 → 0 over motion.slow (320ms) from the TOP of
//     the screen (sheet-rise inverted). calm-concerned uses spring
//     (motion.pattern.sheet-rise default); confirmed-urgent uses
//     ease.decelerate timing — restraint matters here, no bounce.
//   - Reduced motion: hard-cut to position 0; no animation at all.
//
// Accessibility:
//   - accessibilityRole="alert" on the root.
//   - accessibilityLiveRegion="assertive" for confirmed-urgent, "polite" for
//     calm-concerned. Android only — see the P1-7 note below.
//   - Composed accessibilityLabel: "<severity humanized> alert: <title>. <body>".
//   - Audit P1-7: accessibilityLiveRegion is Android-only, so on iOS this
//     banner never spoke. useAnnounceOnChange posts the same composed
//     sentence to VoiceOver. Android is excluded inside the hook so the
//     banner is not read twice there.
//
// Voice rules (docs/05-voice-and-claims.md): this component does NOT generate
// copy — title/body/cta.label are passed by the consumer. The primitive ships
// with no default fallback strings, so there's nothing here to lint. Test
// fixtures use voice-compliant copy (no "patient", no fear language).

import { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  WarningCircleIcon,
  WarningIcon,
  XIcon,
} from 'phosphor-react-native';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';
import { duration, spring as springTokens } from '../theme/tokens';
import { useAnnounceOnChange } from '../hooks/useAnnounce';

export type AnomalyBannerSeverity = 'calm-concerned' | 'confirmed-urgent';

export interface AnomalyBannerProps {
  severity: AnomalyBannerSeverity;
  /** One-line heading. Consumer-supplied; voice rules apply at the call site. */
  title: string;
  /** One-line context. Consumer-supplied; voice rules apply at the call site. */
  body: string;
  /** Optional CTA. Right-aligned text button beneath the body copy. */
  cta?: { label: string; onPress: () => void };
  /**
   * Optional dismiss callback. Wired to a top-right X icon — but only rendered
   * when severity='calm-concerned'. Confirmed-urgent banners have no dismiss
   * affordance per D12 §11.2.6 ("must be acted on").
   */
  onDismiss?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const ENTER_OFFSET_Y = -100;
const REST_OFFSET_Y = 0;

const DECELERATE_EASE = Easing.bezier(0, 0, 0, 1);

function humanizeSeverity(severity: AnomalyBannerSeverity): string {
  return severity === 'confirmed-urgent' ? 'Urgent' : 'Worth-a-chat';
}

function composeAccessibilityLabel(
  severity: AnomalyBannerSeverity,
  title: string,
  body: string,
): string {
  return `${humanizeSeverity(severity)} alert: ${title}. ${body}`;
}

export function AnomalyBanner({
  severity,
  title,
  body,
  cta,
  onDismiss,
  testID,
  style,
}: AnomalyBannerProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  const isUrgent = severity === 'confirmed-urgent';

  // Confirmed-urgent ignores onDismiss per D12 §11.2.6.
  const showDismiss = !isUrgent && typeof onDismiss === 'function';

  // Sheet-rise from the TOP of the screen: translateY animates from
  // ENTER_OFFSET_Y (offscreen above) to REST_OFFSET_Y (0). Spring for
  // calm-concerned, ease.decelerate timing for confirmed-urgent.
  const translateY = useSharedValue(reduceMotion ? REST_OFFSET_Y : ENTER_OFFSET_Y);

  useEffect(() => {
    if (reduceMotion) {
      translateY.value = REST_OFFSET_Y;
      return;
    }
    if (isUrgent) {
      translateY.value = withTiming(REST_OFFSET_Y, {
        duration: duration.slow,
        easing: DECELERATE_EASE,
      });
    } else {
      translateY.value = withSpring(REST_OFFSET_Y, springTokens.default);
    }
  }, [reduceMotion, isUrgent, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const surfaceColor = isUrgent
    ? theme.colors.state.urgent
    : theme.colors.state.warning;
  const onSurfaceColor = isUrgent
    ? theme.colors.text.onUrgent
    : theme.colors.text.onBrand;

  // Elevation: confirmed-urgent uses elevation.high to feel weighted (D12 §11.2.6).
  // calm-concerned uses no shadow — the brand-accent surface carries weight on its own.
  const elevation = theme.elevation[isUrgent ? 'high' : 'none'];

  const titleStyle = theme.type('title');
  const bodyStyle = theme.type('bodyM');
  const ctaStyle = theme.type('label');

  const containerStyle: ViewStyle = {
    backgroundColor: surfaceColor,
    borderRadius: theme.radii.m,
    padding: theme.spacing.l,
    // Rim light on dark mode for elevation.high (matches Card pattern).
    ...(elevation.rimLight
      ? { borderTopWidth: 1, borderTopColor: theme.colors.border.rim }
      : {}),
    ...elevation.ios,
    ...elevation.android,
  };

  const composedA11yLabel = composeAccessibilityLabel(severity, title, body);

  // Audit P1-7 — iOS half of the live region. accessibilityLiveRegion below
  // covers Android; this covers iOS. Without it a VoiceOver user was never
  // told a reading had been flagged.
  useAnnounceOnChange(composedA11yLabel);

  const IconComponent = isUrgent ? WarningCircleIcon : WarningIcon;

  return (
    <Animated.View accessible={true}
      accessibilityRole="alert"
      accessibilityLabel={composedA11yLabel}
      accessibilityLiveRegion={isUrgent ? 'assertive' : 'polite'}
      testID={testID}
      style={[containerStyle, animatedStyle, style]}
    >
      <View style={styles.row}>
        <IconComponent
          size={theme.iconSize.l}
          color={onSurfaceColor}
          weight="regular"
          testID={testID ? `${testID}-icon` : undefined}
        />
        <View style={{ width: theme.spacing.m }} />
        <View style={styles.copyColumn}>
          <Text
            style={{
              color: onSurfaceColor,
              fontFamily: titleStyle.family,
              fontSize: titleStyle.size,
              lineHeight: titleStyle.lineHeight,
              fontWeight: titleStyle.weight as '600',
              marginBottom: theme.spacing.xs,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              color: onSurfaceColor,
              fontFamily: bodyStyle.family,
              fontSize: bodyStyle.size,
              lineHeight: bodyStyle.lineHeight,
            }}
          >
            {body}
          </Text>
        </View>
        {showDismiss ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss alert"
            hitSlop={12}
            testID={testID ? `${testID}-dismiss` : undefined}
            style={({ pressed }) => ({
              opacity: pressed ? 0.65 : 1,
              marginLeft: theme.spacing.m,
              alignSelf: 'flex-start',
            })}
          >
            <XIcon
              size={theme.iconSize.s}
              color={onSurfaceColor}
              weight="regular"
            />
          </Pressable>
        ) : null}
      </View>
      {cta ? (
        <View style={[styles.ctaRow, { marginTop: theme.spacing.m }]}>
          <Pressable
            onPress={cta.onPress}
            accessibilityRole="button"
            accessibilityLabel={cta.label}
            hitSlop={8}
            testID={testID ? `${testID}-cta` : undefined}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Text
              style={{
                color: onSurfaceColor,
                fontFamily: ctaStyle.family,
                fontSize: ctaStyle.size,
                lineHeight: ctaStyle.lineHeight,
                fontWeight: '600',
                textDecorationLine: 'underline',
              }}
            >
              {cta.label}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  copyColumn: {
    flex: 1,
  },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
