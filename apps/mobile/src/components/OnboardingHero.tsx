// OnboardingHero — shared composition for the 6 intro screens (caregiver
// + self-buyer × 3 each). Implements the premium "Apple-of-Healthcare"
// pattern from D11 §5 (visual direction) + D12 onboarding tokens:
//
//   - Hero icon at 96pt, Phosphor v3, weight="duotone" (icon weight +
//     duotone fill is the brand language for vital constellations and
//     reused here for premium feel).
//   - Soft radial glow behind the icon via react-native-svg <RadialGradient>.
//     Single brand-accent stop at 18% opacity centre, fading to 0 at
//     280pt radius. Keeps the colour budget under D11's 8% screen rule
//     because the gradient is mostly transparent.
//   - type.displayXl headline (48/52 bold). D12 §3 lists displayXxl
//     (64pt) for onboarding heroes; in practice on 360pt-wide Androids
//     (Nord, Pixel 4a-class) that bleeds 3+ lines and consumes the
//     fold. Stepping down one notch keeps the premium feel without
//     pushing the CTA off-screen.
//   - spacing.xxxxl (48pt) top vertical rhythm; reduced from D12 §4's
//     suggested 6xl (96pt) for the same fold-budget reason.
//   - Cinematic entrance: glow + icon scale + fade over 1200ms with a
//     decelerate ease, then headline → body → buttons stagger in. Once
//     per screen mount; treats the intro as a *moment* rather than a
//     navigation push.
//
// The screens stay thin: they pass icon + headline + body + page index +
// CTA labels. No layout decisions belong on individual screens.

import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import type { Icon as PhosphorIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { PageIndicator } from './PageIndicator';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';

export interface OnboardingHeroProps {
  /**
   * The Phosphor v3 icon component (e.g. `HandHeartIcon`). Rendered at
   * 96pt with weight="duotone" and the brand accent. Imported by the
   * caller so the bundler can tree-shake the icon set.
   */
  icon: PhosphorIcon;
  /** Optional override for the screen-reader image label. */
  iconAccessibilityLabel?: string;
  headline: string;
  body: string;
  pageCurrent: number;
  pageTotal: number;
  /** Stable id passed to PageIndicator for cross-screen test coverage. */
  pagerTestID: string;
  primary: { label: string; onPress: () => void; testID?: string };
  /** Optional. Omit on Intro 1 (no skip per spec). */
  skip?: { label: string; onPress: () => void; testID?: string };
}

const HERO_SIZE = 220;
const ICON_SIZE = 96;

export function OnboardingHero({
  icon: IconComponent,
  iconAccessibilityLabel,
  headline,
  body,
  pageCurrent,
  pageTotal,
  pagerTestID,
  primary,
  skip,
}: OnboardingHeroProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();

  const display = theme.type('displayXl');
  const bodyType = theme.type('bodyL');
  const accent = theme.colors.brand.primary;

  // Cinematic entrance — staggered fade + scale per element. Honors
  // OS Reduce Motion: when active, everything renders at final
  // opacity/scale on mount (no motion).
  const heroOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const heroScale = useSharedValue(reducedMotion ? 1 : 0.92);
  const headlineOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const bodyOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const ctaOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const ctaTranslate = useSharedValue(reducedMotion ? 0 : 12);

  useEffect(() => {
    if (reducedMotion) return;
    const ease = Easing.bezier(0, 0, 0, 1); // ease.decelerate per D12 §7.2
    heroOpacity.value = withTiming(1, { duration: 1200, easing: ease });
    heroScale.value = withTiming(1, { duration: 1200, easing: ease });
    headlineOpacity.value = withDelay(
      400,
      withTiming(1, { duration: 480, easing: ease }),
    );
    bodyOpacity.value = withDelay(
      600,
      withTiming(1, { duration: 480, easing: ease }),
    );
    ctaOpacity.value = withDelay(
      800,
      withTiming(1, { duration: 480, easing: ease }),
    );
    ctaTranslate.value = withDelay(
      800,
      withTiming(0, { duration: 480, easing: ease }),
    );
  }, [reducedMotion, heroOpacity, heroScale, headlineOpacity, bodyOpacity, ctaOpacity, ctaTranslate]);

  const heroAnimStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ scale: heroScale.value }],
  }));
  const headlineAnimStyle = useAnimatedStyle(() => ({
    opacity: headlineOpacity.value,
  }));
  const bodyAnimStyle = useAnimatedStyle(() => ({
    opacity: bodyOpacity.value,
  }));
  const ctaAnimStyle = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
    transform: [{ translateY: ctaTranslate.value }],
  }));

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.base }]}
      edges={['top', 'bottom']}
    >
      {/* Scrollable so the CTA is always reachable. With contentContainerStyle
          flexGrow:1, the flex:1 spacer bottom-anchors the CTA when there's room;
          when the hero + headline + body overflow a short viewport (small phone
          or large OS font) the screen scrolls instead of pushing the CTA
          off-screen. This was the onboarding-blocking bug on smaller devices. */}
      <ScrollView
        testID="onboarding-hero-scroll"
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: theme.spacing.xxl,
            paddingTop: theme.spacing.xxxxl,
            paddingBottom: theme.spacing.xxl,
          },
        ]}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
      >
        {/* Hero block — glow + icon, centered. */}
        <Animated.View
          style={[styles.heroBlock, heroAnimStyle]}
          accessible
          accessibilityRole="image"
          accessibilityLabel={iconAccessibilityLabel ?? headline}
        >
          <Svg
            width={HERO_SIZE}
            height={HERO_SIZE}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          >
            <Defs>
              <RadialGradient id="onboardingGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={accent} stopOpacity={0.18} />
                <Stop offset="60%" stopColor={accent} stopOpacity={0.06} />
                <Stop offset="100%" stopColor={accent} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle
              cx={HERO_SIZE / 2}
              cy={HERO_SIZE / 2}
              r={HERO_SIZE / 2}
              fill="url(#onboardingGlow)"
            />
          </Svg>
          <IconComponent
            size={ICON_SIZE}
            color={accent}
            weight="duotone"
            duotoneColor={accent}
            duotoneOpacity={0.35}
          />
        </Animated.View>

        {/* Headline. */}
        <Animated.Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.3}
          style={[
            headlineAnimStyle,
            {
              color: theme.colors.text.primary,
              fontSize: display.size,
              lineHeight: display.lineHeight,
              fontWeight: display.weight as '700',
              fontFamily: display.family,
              textAlign: 'center',
              marginTop: theme.spacing.xl,
              marginBottom: theme.spacing.l,
              maxWidth: 340,
            },
          ]}
        >
          {headline}
        </Animated.Text>

        {/* Body copy. */}
        <Animated.Text
          maxFontSizeMultiplier={1.5}
          style={[
            bodyAnimStyle,
            {
              color: theme.colors.text.secondary,
              fontSize: bodyType.size,
              lineHeight: bodyType.lineHeight,
              fontFamily: bodyType.family,
              textAlign: 'center',
              maxWidth: 320,
            },
          ]}
        >
          {body}
        </Animated.Text>

        {/* Spacer pushes the CTA group to the bottom of the safe area. */}
        <View style={styles.spacer} />

        <Animated.View style={[ctaAnimStyle, styles.ctaGroup]}>
          <View style={{ marginBottom: theme.spacing.xxl }}>
            <PageIndicator
              total={pageTotal}
              current={pageCurrent}
              testID={pagerTestID}
            />
          </View>

          <Button
            variant="primary"
            onPress={primary.onPress}
            testID={primary.testID}
            style={{
              width: '100%',
              marginBottom: skip ? theme.spacing.s : 0,
            }}
          >
            {primary.label}
          </Button>

          {skip ? (
            <Button
              variant="ghost"
              onPress={skip.onPress}
              testID={skip.testID}
              style={{ width: '100%' }}
            >
              {skip.label}
            </Button>
          ) : null}
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Convenience for screens that share the standard caregiver-or-self-buyer
// "Continue → Skip to form" wiring; lets the screen file stay declarative.
//
// Not exported on purpose — the type composes <OnboardingHeroProps> and
// any future divergence in CTA shape would propagate freely without it.

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'center' },
  heroBlock: {
    width: HERO_SIZE,
    height: HERO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { flex: 1, minHeight: 32 },
  ctaGroup: { width: '100%', alignItems: 'center' },
});

// Local type re-export so screens can `import type { OnboardingHeroProps }`
// from the same module they import the component from.
export type { OnboardingHeroProps as Props };
