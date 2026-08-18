// ViewToggle — Sprint 16.6 redesign v2 (caregiver Family Constellation).
//
// Pill-shaped segmented control that flips the caregiver home between
// the bird's-eye constellation view and the editorial detailed-card view.
//
// v2 brings text labels BACK alongside the icons after on-device feedback
// that the icon-only version didn't read as a control. Anatomy:
//
//   · Warm-dark glass pill (#140E0A @ 88%) with hairline warm-near-white
//     rim + soft drop shadow so it sits forward of the canopy.
//   · Two segment buttons. Each carries a small icon + a mono-uppercase
//     label ("BIRD'S-EYE" / "DETAILED"). Unmistakably tappable.
//   · An animated coral "thumb" sits behind the labels and slides
//     between positions on selection via Reanimated withSpring (mass 0.8)
//     so the state change feels physical.
//   · Active label + icon: pure white at full opacity (sits on top of
//     the coral thumb). Inactive: white at 50% opacity.
//   · Per-button press feedback: scale-down to 0.94 with spring-back
//     on release. Reduced-motion users skip the animation; the thumb
//     still snaps.
//
// Geometry: ~168 × 36pt total (84 × 28pt per button). Tap target meets
// the iOS 44pt guideline including the 4pt hitSlop.
//
// Voice (docs/05-voice-and-claims.md): visible labels + accessibility
// labels both plain-language: "BIRD'S-EYE" / "DETAILED" and
// "Bird's-eye view" / "Detailed view". No forbidden vocabulary.

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
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import Svg, { Circle, Rect } from 'react-native-svg';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';
import type { CaregiverViewMode } from '../hooks/useCaregiverViewMode';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export interface ViewToggleProps {
  /** Current value — usually wired to useCaregiverViewMode().viewMode. */
  value: CaregiverViewMode;
  onChange: (next: CaregiverViewMode) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

interface SegmentDef {
  key: CaregiverViewMode;
  label: string;
  a11yLabel: string;
  testIDSuffix: string;
}

const SEGMENTS: readonly SegmentDef[] = [
  {
    key: 'birds',
    label: "BIRD'S-EYE",
    a11yLabel: "Bird's-eye view",
    testIDSuffix: 'birds',
  },
  {
    key: 'cards',
    label: 'DETAILED',
    a11yLabel: 'Detailed view',
    testIDSuffix: 'cards',
  },
] as const;

// Geometry. Each button width is sized to fit the longer label
// "BIRD'S-EYE" (10 chars + apostrophe + dash) in JetBrainsMono 9.5pt
// with 0.06em letter-spacing + 14pt icon + 6pt gap + side padding.
const PILL_HEIGHT = 36;
const PILL_PADDING = 4;
const BUTTON_WIDTH = 84;
const THUMB_HEIGHT = PILL_HEIGHT - PILL_PADDING * 2;

const ALPHA_THUMB_BG = '40'; // ~25%
const ALPHA_THUMB_BORDER = '8C'; // ~55%
const ALPHA_GLASS_FILL = 'E0'; // ~88% — solid enough to read as a chip
const ALPHA_RIM = '33'; // ~20% — warm-near-white hairline rim
const ALPHA_INACTIVE = 0.5;

const THUMB_SPRING = { stiffness: 220, damping: 22, mass: 0.8 } as const;
const PRESS_SPRING = { stiffness: 400, damping: 22, mass: 0.6 } as const;
const PRESS_SCALE = 0.94;

function BirdsGlyph({ color, opacity }: { color: string; opacity: number }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" opacity={opacity}>
      <Circle cx={7} cy={9} r={2.5} fill={color} opacity={0.9} />
      <Circle cx={16} cy={6} r={1.8} fill={color} opacity={0.7} />
      <Circle cx={14} cy={16} r={2.2} fill={color} opacity={0.85} />
    </Svg>
  );
}

function DetailedGlyph({ color, opacity }: { color: string; opacity: number }) {
  return (
    <Svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      opacity={opacity}
    >
      <Rect
        x={4}
        y={5}
        width={16}
        height={4}
        rx={1.2}
        stroke={color}
        strokeWidth={1.8}
      />
      <Rect
        x={4}
        y={11}
        width={16}
        height={4}
        rx={1.2}
        stroke={color}
        strokeWidth={1.8}
      />
      <Rect
        x={4}
        y={17}
        width={16}
        height={2.5}
        rx={1}
        stroke={color}
        strokeWidth={1.8}
      />
    </Svg>
  );
}

export function ViewToggle({
  value,
  onChange,
  testID,
  style,
}: ViewToggleProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  const blurTint: 'dark' | 'light' =
    theme.colorMode === 'dark' ? 'dark' : 'light';
  const activeIndex = value === 'cards' ? 1 : 0;

  // Thumb position. 0 = birds (left), 1 = cards (right). Translated by
  // BUTTON_WIDTH px when active = cards. Spring physics for a natural
  // tactile state change.
  const thumbPosition = useSharedValue(activeIndex);

  useEffect(() => {
    if (reduceMotion) {
      thumbPosition.value = activeIndex;
    } else {
      thumbPosition.value = withSpring(activeIndex, THUMB_SPRING);
    }
  }, [activeIndex, reduceMotion, thumbPosition]);

  const thumbAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbPosition.value * BUTTON_WIDTH }],
  }));

  const pillStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    width: BUTTON_WIDTH * 2 + PILL_PADDING * 2,
    height: PILL_HEIGHT,
    padding: PILL_PADDING,
    borderRadius: 999,
    backgroundColor: `#140E0A${ALPHA_GLASS_FILL}`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `#FFFFFF${ALPHA_RIM}`,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 8,
  };

  const thumbStyle: ViewStyle = {
    position: 'absolute',
    top: PILL_PADDING,
    left: PILL_PADDING,
    width: BUTTON_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: 999,
    backgroundColor: `${theme.colors.brand.coral}${ALPHA_THUMB_BG}`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${theme.colors.brand.coral}${ALPHA_THUMB_BORDER}`,
    shadowColor: theme.colors.brand.coral,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 2,
  };

  return (
    <View
      accessibilityRole="radiogroup"
      style={[pillStyle, style]}
      testID={testID}
    >
      <BlurView
        intensity={60}
        tint={blurTint}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Animated.View
        pointerEvents="none"
        style={[thumbStyle, thumbAnimatedStyle]}
      />
      {SEGMENTS.map((segment) => {
        const active = value === segment.key;
        return (
          <SegmentButton
            key={segment.key}
            segment={segment}
            active={active}
            reduceMotion={reduceMotion}
            tint="#FFFFFF"
            labelFamily={theme.fontFamilies.numeric}
            onPress={() => {
              if (!active) onChange(segment.key);
            }}
            testID={testID ? `${testID}-${segment.testIDSuffix}` : undefined}
          />
        );
      })}
    </View>
  );
}

interface SegmentButtonProps {
  segment: SegmentDef;
  active: boolean;
  reduceMotion: boolean;
  tint: string;
  labelFamily: string;
  onPress: () => void;
  testID?: string;
}

function SegmentButton({
  segment,
  active,
  reduceMotion,
  tint,
  labelFamily,
  onPress,
  testID,
}: SegmentButtonProps) {
  const pressScale = useSharedValue(1);
  const opacity = active ? 1 : ALPHA_INACTIVE;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const handlePressIn = () => {
    if (!reduceMotion) {
      pressScale.value = withSpring(PRESS_SCALE, PRESS_SPRING);
    }
  };
  const handlePressOut = () => {
    if (!reduceMotion) {
      pressScale.value = withSpring(1, PRESS_SPRING);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={segment.a11yLabel}
      accessibilityState={{ selected: active }}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      hitSlop={4}
      testID={testID}
      style={{
        width: BUTTON_WIDTH,
        height: THUMB_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          },
          animatedStyle,
        ]}
      >
        {segment.key === 'birds' ? (
          <BirdsGlyph color={tint} opacity={opacity} />
        ) : (
          <DetailedGlyph color={tint} opacity={opacity} />
        )}
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
          style={{
            fontFamily: labelFamily,
            fontSize: 9.5,
            lineHeight: 12,
            letterSpacing: 0.57, // ~0.06em at 9.5pt
            color: tint,
            opacity,
          }}
        >
          {segment.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}
