// Sourced from docs/_reference/D12-visual-system-v2.md §11.1 (BottomSheet —
// D12 migration: glass material heavy, spring rise, full-size variant) and
// the original Sprint 1 anatomy in docs/03-components/bottom-sheet.md.
//
// Sprint 1.5 changes from D8:
//   - Sheet surface uses material.glass.heavy (D12 §6.3) — expo-blur BlurView
//     with intensity 80 + tint matched to colorMode. Android < 12 falls back
//     to a non-blurred translucent background per D12 §12.5; the underlying
//     surface.glassHeavy token already provides the opacity floor so glass
//     looks intentional even without native blur.
//   - Open animation is motion.pattern.sheet-rise (D12 §7.3) — Reanimated
//     spring on translateY plus a parallel timing animation on the backdrop
//     opacity. Dismiss reverses with timing+ease.accelerate (unchanged).
//   - 'full' size variant added per backlog deferral — 95% of screen height
//     (5pt status-bar slot at top so the sheet still reads as a sheet, not a
//     navigation push).
//   - border.default → border.subtle (D12 token rename).
//   - Backdrop scrim is now mode-agnostic black (was hardcoded D8 navy);
//     opacity stays at theme.opacity.scrim and animates 0 → scrim on open.
//
// Animation + gesture come from react-native-gesture-handler@2.28.0 and
// react-native-reanimated@4.1.7 (see ADR-0004). The translateY is a shared
// value driven on the UI thread so drag stays at 60fps.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import {
  sheetRiseInBackdropOpacity,
  sheetRiseInTranslate,
  sheetRiseOutBackdropOpacity,
} from '../theme/motion/patterns';

export type BottomSheetSize = 'compact' | 'default' | 'tall' | 'full';

/**
 * Surface treatment for the sheet floor.
 *
 *   'solid'  — opaque surface.elevated. Default. Reads as a discrete
 *              card; the brand voice (premium-precise, Aesop test)
 *              favours this for forms, lists and most settings sheets.
 *   'glass'  — material.glass.heavy + BlurView (D12 §11.1). Use when
 *              seeing the underlying context matters — confirmation
 *              moments, anomaly dispatchers, dialogs over the chart.
 */
export type BottomSheetSurface = 'solid' | 'glass';

interface BottomSheetProps {
  visible: boolean;
  onDismiss: () => void;
  size?: BottomSheetSize;
  /**
   * Confirmed-urgent dispatcher mode (D8 §3.7). Backdrop tap and drag-down
   * are both disabled; consumer is responsible for calling onDismiss from
   * an explicit primary action ("OK, I've called").
   */
  confirmedUrgent?: boolean;
  /** Surface treatment — defaults to 'solid'. */
  surface?: BottomSheetSurface;
  title?: string;
  children: ReactNode;
  testID?: string;
}

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_THRESHOLD = 0.3;

const EASE_ACCELERATE = Easing.bezier(0.3, 0, 1, 1);

function sizeToDimension(size: BottomSheetSize): { height?: number; maxHeight?: number } {
  switch (size) {
    case 'compact':
      return { maxHeight: SCREEN_HEIGHT * 0.5 };
    case 'default':
      return { height: SCREEN_HEIGHT * 0.6 };
    case 'tall':
      return { height: SCREEN_HEIGHT * 0.8 };
    case 'full':
      // 5pt gap at top so the sheet still reads as a sheet rather than a
      // full-screen modal — preserves the "modal over context" affordance.
      return { height: SCREEN_HEIGHT * 0.95 };
  }
}

export function BottomSheet({
  visible,
  onDismiss,
  size = 'default',
  confirmedUrgent = false,
  surface = 'glass',
  title,
  children,
  testID,
}: BottomSheetProps) {
  const theme = useTheme();
  const dimension = sizeToDimension(size);
  const sheetHeight = dimension.height ?? SCREEN_HEIGHT * 0.5;

  const [mounted, setMounted] = useState(false);

  // translateY: 0 = fully open, sheetHeight (or SCREEN_HEIGHT) = offscreen.
  const translateY = useSharedValue(SCREEN_HEIGHT);
  // backdropOpacity: 0 = transparent, opacity.scrim = fully visible.
  const backdropOpacity = useSharedValue(0);

  const dismissDuration = theme.duration('slow');

  // Latest `visible` for the animation-completion callbacks. A dismissal
  // animation can be CANCELLED (finished === false): rapid open/close, a
  // competing gesture + backdrop dismiss, a re-render restarting the
  // timing. The old code only unmounted on finished === true, so a
  // cancelled dismissal left the (invisible: backdrop at opacity 0, sheet
  // off-screen) Modal mounted forever — silently eating every touch on
  // the screen below ("the back button sometimes doesn't work").
  // settleDismissed unmounts on ANY dismissal outcome unless the sheet
  // was re-opened mid-animation.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const settleDismissed = useCallback(() => {
    if (!visibleRef.current) setMounted(false);
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = sheetRiseInTranslate(theme.reduceMotion, 0);
      backdropOpacity.value = sheetRiseInBackdropOpacity(theme.reduceMotion, theme.opacity.scrim);
      return undefined;
    }
    if (mounted) {
      backdropOpacity.value = sheetRiseOutBackdropOpacity(theme.reduceMotion);
      translateY.value = withTiming(
        SCREEN_HEIGHT,
        { duration: dismissDuration, easing: EASE_ACCELERATE },
        () => {
          // Finished OR cancelled — either way the sheet must not linger.
          runOnJS(settleDismissed)();
        },
      );
      // JS-side guarantee: even if the worklet callback never fires
      // (cancelled animation chains), the invisible Modal must unmount.
      const fallback = setTimeout(settleDismissed, dismissDuration + 50);
      return () => clearTimeout(fallback);
    }
    return undefined;
  }, [
    visible,
    mounted,
    dismissDuration,
    translateY,
    backdropOpacity,
    theme.reduceMotion,
    theme.opacity.scrim,
    settleDismissed,
  ]);

  const dismissFromGesture = () => {
    backdropOpacity.value = sheetRiseOutBackdropOpacity(theme.reduceMotion);
    translateY.value = withTiming(
      SCREEN_HEIGHT,
      { duration: dismissDuration, easing: EASE_ACCELERATE },
      (finished) => {
        if (finished) {
          runOnJS(setMounted)(false);
          runOnJS(onDismiss)();
        } else {
          // Cancelled mid-gesture (a parent-driven close took over) —
          // settleDismissed decides from the latest `visible`.
          runOnJS(settleDismissed)();
        }
      },
    );
  };

  const panGesture = Gesture.Pan()
    .enabled(!confirmedUrgent)
    .onChange((event) => {
      // Sprint 1: clamp drag to downward only. Upward expand is deferred.
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      const past30 = event.translationY > sheetHeight * DISMISS_THRESHOLD;
      if (past30) {
        dismissFromGesture();
      } else {
        translateY.value = sheetRiseInTranslate(theme.reduceMotion, 0);
      }
    });

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!mounted) return null;

  const isSolid = surface === 'solid';

  // Solid sheets get a heavier elevation so the lift reads against
  // dense underlying content; glass relies on its blur for the lift.
  const elev = isSolid ? theme.elevation.high : theme.elevation.medium;

  // Surface container: sized + rounded + clipped. Solid mode paints
  // surface.elevated directly; glass mode leaves the background empty
  // and lets the BlurView + glass floor render over it.
  const surfaceContainerStyle: ViewStyle = {
    borderTopLeftRadius: theme.radii.l,
    borderTopRightRadius: theme.radii.l,
    overflow: 'hidden',
    ...(dimension.height !== undefined ? { height: dimension.height } : {}),
    ...(dimension.maxHeight !== undefined ? { maxHeight: dimension.maxHeight } : {}),
    ...(isSolid ? { backgroundColor: theme.colors.surface.elevated } : {}),
    ...elev.ios,
    ...elev.android,
  };

  // Glass floor — sits behind the BlurView so Android < 12 (where blur
  // doesn't render) still shows an intentional translucent surface.
  // Only used when surface='glass'.
  const glassFloorStyle: ViewStyle = {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surface.glassHeavy,
  };

  const contentPaddingStyle: ViewStyle = {
    paddingHorizontal: theme.spacing.xxl,
    paddingTop: theme.spacing.s,
    paddingBottom: theme.spacing.xxl,
  };

  const titleStyle = theme.type('title');
  const titleTextStyle: TextStyle = {
    fontSize: titleStyle.size,
    lineHeight: titleStyle.lineHeight,
    fontWeight: titleStyle.weight as TextStyle['fontWeight'],
    fontFamily: titleStyle.family,
    color: theme.colors.text.primary,
    flex: 1,
  };

  const showHeader = !!title || !confirmedUrgent;
  const blurTint: 'dark' | 'light' = theme.colorMode === 'dark' ? 'dark' : 'light';

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={confirmedUrgent ? () => undefined : onDismiss}
      statusBarTranslucent
      testID={testID}
    >
      <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
        {/* Backdrop — animated mode-agnostic black scrim. Tap dismisses
            unless urgent. */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: '#000000' },
            animatedBackdropStyle,
          ]}
          pointerEvents="box-none"
        >
          <Pressable
            accessible={!confirmedUrgent}
            accessibilityHint={confirmedUrgent ? undefined : 'Closes sheet'}
            onPress={confirmedUrgent ? undefined : onDismiss}
            style={StyleSheet.absoluteFill}
            testID="bottomsheet-backdrop"
          />
        </Animated.View>
        <KeyboardAvoidingView
          // iOS: 'padding' lets the bottom-anchored sheet rise smoothly
          // with the keyboard. Android: the activity is windowSoftInputMode
          // 'adjustResize', so 'padding' double-counted and left the
          // bottom-most input under the keyboard (the invite email field).
          // 'height' works correctly with adjustResize — it shrinks the
          // avoiding view to the resized window so the sheet's bottom input
          // sits just above the keyboard.
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kbAvoid}
          pointerEvents="box-none"
        >
          <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.sheetWrapper, animatedSheetStyle]}>
              <View style={surfaceContainerStyle}>
                {isSolid ? null : (
                  <>
                    <View style={glassFloorStyle} />
                    <BlurView
                      intensity={80}
                      tint={blurTint}
                      style={StyleSheet.absoluteFill}
                    />
                  </>
                )}
                <View style={contentPaddingStyle}>
                  <View accessible={true}
                    style={[
                      styles.dragHandle,
                      {
                        backgroundColor: theme.colors.border.subtle,
                        marginBottom: theme.spacing.s,
                      },
                    ]}
                    accessibilityLabel="Drag to dismiss"
                  />
                  {showHeader ? (
                    <View style={styles.titleRow}>
                      {title ? (
                        <Text style={titleTextStyle}>{title}</Text>
                      ) : (
                        <View style={{ flex: 1 }} />
                      )}
                      {!confirmedUrgent ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Close"
                          onPress={onDismiss}
                          hitSlop={12}
                          testID="bottomsheet-close"
                        >
                          <Text style={{ fontSize: 24, color: theme.colors.text.primary }}>
                            {'×'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {children}
                </View>
              </View>
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kbAvoid: { flex: 1, justifyContent: 'flex-end' },
  sheetWrapper: { width: '100%' },
  dragHandle: {
    alignSelf: 'center',
    width: 32,
    height: 4,
    borderRadius: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
});
