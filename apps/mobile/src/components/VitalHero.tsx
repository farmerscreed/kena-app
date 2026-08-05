// VitalHero — Sprint 8.5 (vital-detail screens).
//
// Hero block on every vital detail screen. Composes a VitalRing on the
// left (with the vital's icon centered inside) + giant serif value on
// the right (numericXl primary, optional smaller secondary), an
// uppercase mono sub-label, an optional range copy line, and an optional
// live-pulse indicator chip.
//
// Translates the design's `VitalHero` from leiko-detail.jsx — the ring
// + numeric pair sits over a soft vital-tinted radial glow that breathes
// every 4.5s. We render the glow as a translucent View (no filter:blur
// support cross-platform) which reads cleanly on warm-charcoal surfaces.
//
// Accessibility: composed accessibilityLabel reads
// "<sub> <primary><secondary>. <range>." so screen-reader users hear the
// full sentence the visual presents.
//
// Voice rules: every user-visible string is consumer-supplied (`sub`,
// `range`). The component itself authors no copy — voice is checked at
// the call site.

import { useEffect } from 'react';
import {
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
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {
  DropIcon,
  FootprintsIcon,
  HeartStraightIcon,
  MoonIcon,
  WindIcon,
  type Icon as PhosphorIcon,
} from 'phosphor-react-native';
import { VitalRing, type VitalType } from './VitalRing';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';
import { opacity } from '../theme/tokens';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

const VITAL_ICON: Record<VitalType, PhosphorIcon> = {
  bp: DropIcon,
  hr: HeartStraightIcon,
  spo2: WindIcon,
  sleep: MoonIcon,
  activity: FootprintsIcon,
};

export interface VitalHeroProps {
  vital: VitalType;
  /** Pre-formatted primary value. Renders in numericXl. */
  primary: string;
  /** Optional smaller trailing secondary value (e.g. "/ 78", "%"). */
  secondary?: string;
  /** Mono uppercase sub-label ("Now · resting", "Latest · 6:42 am"). */
  sub: string;
  /** Optional context line under the value ("mmHg · within your range"). */
  range?: string;
  /** Arc fraction 0..1 for the ring. */
  ringFill: number;
  /** When true, ring runs the live-pulse worklet + a "live" pill renders. */
  livePulse?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// Hero ring is sized between md (88pt) and lg (168pt) per the design's
// 108pt — we use the explicit `diameter` override on VitalRing.
const RING_DIAMETER = 108;
const RING_STROKE = 6;
const ICON_SIZE = 28;

const GLOW_BREATHE_DURATION_MS = 4500;
/**
 * Rendered opacity of the ambient glow disc behind the hero value.
 * Sourced from the shared opacity tokens — see the rationale and the
 * contrast ceiling documented on `opacity.glowRest` / `opacity.glowPeak`.
 */
const GLOW_OPACITY_REST = opacity.glowRest;
const GLOW_OPACITY_PEAK = opacity.glowPeak;

function composeAccessibilityLabel(
  sub: string,
  primary: string,
  secondary: string | undefined,
  range: string | undefined,
): string {
  const value = secondary ? `${primary}${secondary}` : primary;
  return [sub, value, range].filter(Boolean).join('. ');
}

export function VitalHero({
  vital,
  primary,
  secondary,
  sub,
  range,
  ringFill,
  livePulse,
  testID,
  style,
}: VitalHeroProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const numericXl = theme.type('numericXl');
  const numericM = theme.type('numericM');
  const labelStyle = theme.type('labelUppercase');
  const captionStyle = theme.type('caption');
  const vitalColor = theme.colors.vital[vital];
  const IconComponent = VITAL_ICON[vital];

  // Ambient glow — soft "breathing" opacity. Reduced motion → static.
  //
  // Sprint 19 (audit D12 P0-5): these values ARE the rendered opacity.
  // `styles.glow` also declares `opacity: GLOW_OPACITY_REST`, but this
  // animated style is applied last and wins, so the stylesheet value is
  // decorative only. The previous 0.55→0.75 range therefore painted the
  // glow at 3–4× its designed strength, dropping `text.tertiary` over
  // the hero to ~1.1:1 and oscillating contrast on a 4.5s cycle.
  // Any change here must keep the peak at or below GLOW_OPACITY_PEAK —
  // see the contrast test in __tests__/glowOpacity.test.ts.
  const glowOpacity = useSharedValue<number>(GLOW_OPACITY_REST);
  useEffect(() => {
    if (reduceMotion) {
      glowOpacity.value = GLOW_OPACITY_REST;
      return;
    }
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(GLOW_OPACITY_PEAK, {
          duration: GLOW_BREATHE_DURATION_MS / 2,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(GLOW_OPACITY_REST, {
          duration: GLOW_BREATHE_DURATION_MS / 2,
          easing: Easing.inOut(Easing.ease),
        }),
      ),
      -1,
      false,
    );
  }, [reduceMotion, glowOpacity]);

  const glowAnimatedStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const composedA11yLabel = composeAccessibilityLabel(sub, primary, secondary, range);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={composedA11yLabel}
      style={[styles.root, style]}
      testID={testID}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glow,
          {
            backgroundColor: vitalColor,
          },
          glowAnimatedStyle,
        ]}
      />
      <View style={styles.row}>
        <View style={styles.ringWrap}>
          <VitalRing
            vitalType={vital}
            fill={ringFill}
            diameter={RING_DIAMETER}
            strokeWidth={RING_STROKE}
            state={livePulse ? 'pulsing' : 'idle'}
            testID={testID ? `${testID}-ring` : undefined}
          />
          <View pointerEvents="none" style={styles.iconCenter}>
            <IconComponent
              size={ICON_SIZE}
              color={vitalColor}
              weight="duotone"
              duotoneColor={vitalColor}
              duotoneOpacity={0.4}
            />
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0, marginLeft: theme.spacing.l }}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: labelStyle.family,
              fontSize: labelStyle.size,
              lineHeight: labelStyle.lineHeight,
              letterSpacing: labelStyle.letterSpacing,
              color: theme.colors.text.tertiary,
              textTransform: 'uppercase',
              marginBottom: theme.spacing.xs,
            }}
            testID={testID ? `${testID}-sub` : undefined}
          >
            {sub}
          </Text>
          <View style={styles.valueRow}>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={{
                fontFamily: theme.fontFamilies.editorial,
                fontSize: numericXl.size,
                lineHeight: numericXl.lineHeight,
                color: theme.colors.text.primary,
                letterSpacing: -0.5,
              }}
              testID={testID ? `${testID}-primary` : undefined}
            >
              {primary}
            </Text>
            {secondary ? (
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  fontFamily: theme.fontFamilies.editorial,
                  fontSize: numericM.size,
                  lineHeight: numericM.lineHeight,
                  color: theme.colors.text.tertiary,
                  marginLeft: 4,
                }}
                testID={testID ? `${testID}-secondary` : undefined}
              >
                {secondary}
              </Text>
            ) : null}
          </View>
          {range ? (
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: captionStyle.size,
                lineHeight: captionStyle.lineHeight,
                color: theme.colors.text.tertiary,
                marginTop: theme.spacing.xs,
                letterSpacing: 0.5,
              }}
              testID={testID ? `${testID}-range` : undefined}
            >
              {range}
            </Text>
          ) : null}
          {livePulse ? (
            <View
              style={[
                styles.livePill,
                { backgroundColor: vitalColor + '26', marginTop: theme.spacing.s },
              ]}
              testID={testID ? `${testID}-live-pill` : undefined}
            >
              <View
                style={[
                  styles.liveDot,
                  { backgroundColor: vitalColor },
                ]}
              />
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  fontFamily: theme.fontFamilies.numeric,
                  fontSize: 9,
                  letterSpacing: 1.4,
                  color: vitalColor,
                  textTransform: 'uppercase',
                }}
              >
                Live
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 22,
    position: 'relative',
  },
  glow: {
    position: 'absolute',
    left: '50%',
    top: 0,
    width: 280,
    height: 220,
    borderRadius: 999,
    // Overridden at runtime by the animated glow style (see GLOW_OPACITY_*).
    // Kept in sync so a static render matches the animated rest state.
    opacity: opacity.glowRest,
    transform: [{ translateX: -140 }],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  ringWrap: {
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
