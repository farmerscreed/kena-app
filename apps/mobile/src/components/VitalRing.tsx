// VitalRing — D12 §11.2.1 (Sprint 7.6).
//
// The fundamental visual primitive of the multi-vitals constellation. A
// circular progress arc rendered via react-native-svg with Reanimated v3
// shared values driving the foreground fill + the live-pulse wrapper.
//
// API design:
//   - Pure presentational. The consumer computes `fill` (0..1) per the
//     D13 §7.1 per-vital formulas; the ring just draws an arc of that
//     fraction.
//   - `state` drives motion. `idle` is static; `filling` animates 0→fill
//     once on mount over motion.cinematic; `pulsing` wraps the ring in
//     the live-pulse worklet; `stale` reduces opacity per D12 §11.2.1.
//   - `withRimLight` (default true) adds a 1px inner highlight on dark
//     mode only — same rim-lighting strategy used by Card (D12 §6).
//
// Skia upgrade path (D12 §12.4): VitalRing is SVG-based at v1.0. The
// constellation hero with five concurrent rings + one pulsing is on the
// edge of react-native-svg performance. If profiling on a Pixel 6a shows
// FPS < 55, this component migrates to @shopify/react-native-skia. The
// public prop contract above is the boundary; consumers don't change.

import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import {
  LIVE_PULSE_BPM_DEFAULT,
  livePulseOpacity,
  livePulseScale,
} from '../theme/motion/patterns';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type VitalType = 'bp' | 'hr' | 'spo2' | 'sleep' | 'activity';
export type VitalRingSize = 'sm' | 'md' | 'lg' | 'hero';
export type VitalRingState = 'idle' | 'filling' | 'pulsing' | 'stale';

const SIZE_CONFIG: Record<
  VitalRingSize,
  { diameter: number; strokeWidth: number }
> = {
  sm: { diameter: 40, strokeWidth: 4 },
  md: { diameter: 88, strokeWidth: 8 },
  lg: { diameter: 168, strokeWidth: 12 },
  hero: { diameter: 240, strokeWidth: 16 },
};

const STALE_OPACITY = 0.5;
const TRACK_OPACITY = 0.12; // matches opacity.ringBackground (D12 §8)
const FILL_DURATION_MS = 720; // duration.cinematic (D12 §7.1)
const FILL_EASING = Easing.bezier(0.16, 1, 0.3, 1); // ease.cinematic (D12 §7.2)

export interface VitalRingProps {
  vitalType: VitalType;
  /** Arc fraction 0..1. Computed by consumer per D13 §7.1 formulas. */
  fill: number;
  /** D13 PR-4 (§6.2) — overrides the vital colour; used for the grey
   *  learning state while the §4.3 sufficiency gate is unmet. */
  colorOverride?: string;
  size?: VitalRingSize;
  /** Custom diameter in pt; overrides `size`'s diameter when set. */
  diameter?: number;
  /** Custom stroke width in pt; overrides `size`'s strokeWidth when set. */
  strokeWidth?: number;
  state?: VitalRingState;
  /** Render rim-light inner highlight on dark mode. Default true. */
  withRimLight?: boolean;
  /** Composed inner content (typically the value); rendered centered. */
  children?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** bpm for the live-pulse cycle when state='pulsing'. Defaults to 50. */
  pulseBpm?: number;
  /**
   * Optional delay in ms before the state='filling' arc animation begins.
   * Used by DailyPulseHero to stagger the constellation reveal per
   * D12 §7.3 motion.pattern.daily-pulse-reveal. Ignored unless state='filling'.
   */
  fillDelayMs?: number;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function arcCircumference(radius: number): number {
  return 2 * Math.PI * radius;
}

export function arcDashOffset(circumference: number, fill: number): number {
  return circumference * (1 - clamp01(fill));
}

export function VitalRing({
  vitalType,
  fill,
  colorOverride,
  size = 'md',
  diameter: diameterOverride,
  strokeWidth: strokeWidthOverride,
  state = 'idle',
  withRimLight = true,
  children,
  accessibilityLabel,
  testID,
  style,
  pulseBpm = LIVE_PULSE_BPM_DEFAULT,
  fillDelayMs = 0,
}: VitalRingProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  const sizeConfig = SIZE_CONFIG[size];
  const diameter = diameterOverride ?? sizeConfig.diameter;
  const strokeWidth = strokeWidthOverride ?? sizeConfig.strokeWidth;
  const center = diameter / 2;
  const radius = (diameter - strokeWidth) / 2;
  const circumference = arcCircumference(radius);
  const targetOffset = arcDashOffset(circumference, fill);

  const dashOffset = useSharedValue(
    state === 'filling' && !reduceMotion ? circumference : targetOffset,
  );
  useEffect(() => {
    if (state === 'filling' && !reduceMotion) {
      const fillTiming = withTiming(targetOffset, {
        duration: FILL_DURATION_MS,
        easing: FILL_EASING,
      });
      dashOffset.value =
        fillDelayMs > 0 ? withDelay(fillDelayMs, fillTiming) : fillTiming;
    } else {
      dashOffset.value = targetOffset;
    }
  }, [state, targetOffset, reduceMotion, dashOffset, fillDelayMs]);

  const isPulsing = state === 'pulsing';
  const pulseScaleValue = useSharedValue(1);
  const pulseOpacityValue = useSharedValue(1);
  useEffect(() => {
    if (isPulsing && !reduceMotion) {
      pulseScaleValue.value = livePulseScale(false, pulseBpm);
      pulseOpacityValue.value = livePulseOpacity(false, pulseBpm);
    } else {
      pulseScaleValue.value = 1;
      pulseOpacityValue.value = 1;
    }
  }, [isPulsing, reduceMotion, pulseBpm, pulseScaleValue, pulseOpacityValue]);

  const animatedFillProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  const animatedWrapperStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScaleValue.value }],
    opacity: pulseOpacityValue.value,
  }));

  const color = colorOverride ?? theme.colors.vital[vitalType];
  const isStale = state === 'stale';
  const baseOpacity = isStale ? STALE_OPACITY : 1;
  const showRim =
    withRimLight && theme.colorMode === 'dark' && !isStale && fill > 0;
  const rimRadius = radius - strokeWidth / 2 - 1;

  return (
    <Animated.View
      style={[
        { width: diameter, height: diameter, opacity: baseOpacity },
        animatedWrapperStyle,
        style,
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 1, now: clamp01(fill) }}
      testID={testID}
    >
      <Svg width={diameter} height={diameter}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeOpacity={TRACK_OPACITY}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={targetOffset}
          animatedProps={animatedFillProps}
          fill="none"
          transform={`rotate(-90 ${center} ${center})`}
        />
        {showRim ? (
          <Circle
            cx={center}
            cy={center}
            r={rimRadius}
            stroke={theme.colors.border.rim}
            strokeWidth={1}
            fill="none"
          />
        ) : null}
      </Svg>
      {children ? (
        <View pointerEvents="none" style={styles.center}>
          {children}
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
