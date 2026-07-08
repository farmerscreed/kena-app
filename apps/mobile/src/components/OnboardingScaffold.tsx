// OnboardingScaffold — the one layout wrapper every onboarding + auth
// screen uses. It exists to guarantee the thing that broke on a client's
// phone can never break again: content is ALWAYS inside a correctly
// configured ScrollView, so a CTA can never be stranded off-screen on a
// short viewport or at a large OS font size.
//
// Before this, ~8 screens each re-declared the same SafeAreaView +
// KeyboardAvoidingView + ScrollView + "Back" link + bottom-spacer stack
// by hand (and the intro screens forgot the ScrollView entirely — the
// bug). Collapsing that into one component removes the duplication and
// the opportunity to get it wrong.
//
// Layout contract:
//   - SafeAreaView (top + bottom insets) paints the base surface.
//   - Optional KeyboardAvoidingView (default on; a no-op on screens
//     without inputs) lifts content above the keyboard on iOS. Android
//     relies on windowSoftInputMode=adjustResize + the ScrollView.
//   - ScrollView contentContainer uses flexGrow:1, so:
//       * when content fits, `footer` bottom-anchors via the flex spacer
//         (and `center` vertically centers the body);
//       * when content overflows, the whole screen scrolls and every
//         control stays reachable.

import { type ReactNode, useEffect } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { CaretLeftIcon } from 'phosphor-react-native';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

export interface OnboardingScaffoldProps {
  children: ReactNode;
  /** Renders a standard top-left "Back" link. Omit when there's no back target. */
  onBack?: () => void;
  /**
   * Footer pinned to the bottom of the viewport when there's room, and
   * scrolled-to when there isn't. Use for the primary CTA so it is always
   * reachable. Not combined with `center`.
   */
  footer?: ReactNode;
  /** Vertically + horizontally center the content (welcome-style screens). */
  center?: boolean;
  /**
   * Wrap in KeyboardAvoidingView. Default true. Harmless on input-less
   * screens; required on screens with TextInputs.
   */
  keyboardAware?: boolean;
  scrollTestID?: string;
  testID?: string;
}

export function OnboardingScaffold({
  children,
  onBack,
  footer,
  center = false,
  keyboardAware = true,
  scrollTestID = 'onboarding-scroll',
  testID,
}: OnboardingScaffoldProps) {
  const theme = useTheme();
  const body = theme.type('bodyL');

  // Subtle entrance: fade + a tiny rise on mount. Honors OS Reduce Motion
  // (renders at final state, no animation, when it's on).
  const reduceMotion = useReducedMotion();
  const enter = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    enter.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [reduceMotion, enter]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

  const scroll = (
    <AnimatedScrollView
      testID={scrollTestID}
      style={[styles.fill, enterStyle]}
      contentContainerStyle={[
        styles.content,
        center && styles.center,
        {
          paddingHorizontal: theme.spacing.xxl,
          paddingTop: theme.spacing.xxl,
          paddingBottom: theme.spacing.xxl,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      alwaysBounceVertical={false}
    >
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={theme.spacing.m}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            marginBottom: theme.spacing.xxl,
          }}
        >
          <CaretLeftIcon
            size={body.size + 2}
            color={theme.colors.brand.primary}
            weight="bold"
          />
          <Text
            maxFontSizeMultiplier={1.4}
            style={{
              color: theme.colors.brand.primary,
              fontSize: body.size,
              fontFamily: body.family,
              marginLeft: theme.spacing.xs,
            }}
          >
            Back
          </Text>
        </Pressable>
      ) : null}

      {children}

      {footer ? (
        <>
          <View style={styles.spacer} />
          {footer}
        </>
      ) : null}
    </AnimatedScrollView>
  );

  return (
    <SafeAreaView
      testID={testID}
      style={[styles.fill, { backgroundColor: theme.colors.surface.base }]}
      edges={['top', 'bottom']}
    >
      {keyboardAware ? (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {scroll}
        </KeyboardAvoidingView>
      ) : (
        scroll
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  // flex:1 so the footer bottom-anchors when there's room; minHeight keeps a
  // little breathing room between content and CTA when the screen is full.
  spacer: { flex: 1, minHeight: 24 },
});
