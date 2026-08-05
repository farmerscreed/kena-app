// HRZonesCard — Sprint 8.5 (HRDetail screen).
//
// Specialized 4-tier "time in zones" bar chart for the HR detail screen.
// Per leiko-detail-screens.jsx HRDetail (lines 149–179): a card with a
// single eyebrow + four rows. Each row is the zone name + bpm range +
// horizontal progress bar (vital-color, progressively higher opacity per
// zone) + percent label.
//
// API design:
//   - Presentational. Consumer hands in exactly four zones. The visual
//     fixed-color stack mirrors the design's fade from .35 → .60 → .80 →
//     1.0 opacity over the HR vital color. The component owns the
//     opacity ramp; the consumer just supplies name / range / pct.
//   - Optional eyebrow override; defaults to "Time in zones · today" per
//     the design source.
//
// Motion: each bar animates `scaleX 0 → pct/100` on first paint, staggered
// by 100ms. Reduced-motion bypasses the animation (bars render at their
// final state immediately).
//
// Accessibility: each row composes accessibilityLabel
// "<name> zone, <range> bpm, <pct> percent" so screen-reader users hear
// the full sentence.
//
// Voice rules (docs/05-voice-and-claims.md): no user-visible copy authored
// in this file. Zone names + ranges + the eyebrow string are consumer-
// supplied — voice is checked at the call site (HRDetail.tsx).

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
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

const BAR_HEIGHT = 8;
const BAR_RADIUS = 99;
const REVEAL_DURATION_MS = 800;
const STAGGER_MS = 100;
// Opacity ramp from leiko-detail-screens.jsx (lines 154–157):
// resting .35, calm .60, active .80, vigorous 1.00.
const ZONE_OPACITY_RAMP = [0.35, 0.6, 0.8, 1] as const;

export interface HRZone {
  /** Plain-language zone name ("Resting", "Calm", "Active", "Vigorous"). */
  name: string;
  /** BPM range copy ("< 60", "60–80", "80–110", "110+"). */
  range: string;
  /** Time spent in this zone, 0–100. */
  pct: number;
}

export interface HRZonesCardProps {
  /** Exactly four zones, ordered low → high intensity. */
  zones: [HRZone, HRZone, HRZone, HRZone];
  /** Eyebrow label override. Defaults to "Time in zones · today". */
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

interface ZoneBarProps {
  pct: number;
  color: string;
  opacity: number;
  reduceMotion: boolean;
  delayMs: number;
  trackColor: string;
}

function ZoneBar({
  pct,
  color,
  opacity,
  reduceMotion,
  delayMs,
  trackColor,
}: ZoneBarProps) {
  const target = Math.max(0, Math.min(100, pct)) / 100;
  // Drive width via scaleX on a child View. We pre-set the child width to
  // 100% of the bar track and animate scaleX 0 → target with a left
  // transform-origin so the bar grows from the start of the track. The
  // outer track stays fixed-width so layout doesn't reflow during the
  // reveal.
  const progress = useSharedValue(reduceMotion ? target : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = target;
      return;
    }
    progress.value = 0;
    progress.value = withDelay(
      delayMs,
      withTiming(target, {
        duration: REVEAL_DURATION_MS,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
      }),
    );
  }, [reduceMotion, delayMs, target, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  return (
    <View
      style={[
        styles.barTrack,
        {
          backgroundColor: trackColor,
          height: BAR_HEIGHT,
          borderRadius: BAR_RADIUS,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.barFill,
          {
            backgroundColor: color,
            opacity,
            borderRadius: BAR_RADIUS,
          },
          animatedStyle,
        ]}
      />
    </View>
  );
}

export function HRZonesCard({
  zones,
  label = 'Time in zones · today',
  testID,
  style,
}: HRZonesCardProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const labelStyle = theme.type('labelUppercase');
  const captionStyle = theme.type('caption');
  const bodyStyle = theme.type('bodyM');
  const vitalColor = theme.colors.vital.hr;

  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface.warmSubtle,
          borderColor: theme.colors.border.rim,
          borderRadius: theme.radii.l,
          padding: theme.spacing.l,
        },
        style,
      ]}
      testID={testID}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: labelStyle.family,
          fontSize: labelStyle.size,
          lineHeight: labelStyle.lineHeight,
          letterSpacing: labelStyle.letterSpacing,
          color: theme.colors.text.tertiary,
          textTransform: 'uppercase',
          marginBottom: theme.spacing.m,
        }}
        testID={testID ? `${testID}-label` : undefined}
      >
        {label}
      </Text>
      {zones.map((z, i) => {
        const a11y = `${z.name} zone, ${z.range} bpm, ${Math.round(z.pct)} percent`;
        return (
          <View
            key={`${z.name}-${i}`}
            accessibilityRole="text"
            accessibilityLabel={a11y}
            style={[
              styles.row,
              {
                borderBottomColor: theme.colors.border.rim,
                borderBottomWidth: i === zones.length - 1 ? 0 : StyleSheet.hairlineWidth,
                paddingVertical: theme.spacing.s,
              },
            ]}
            testID={testID ? `${testID}-row-${i}` : undefined}
          >
            <View style={styles.nameColumn}>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  fontFamily: bodyStyle.family,
                  fontSize: bodyStyle.size,
                  lineHeight: bodyStyle.lineHeight,
                  color: theme.colors.text.primary,
                }}
              >
                {z.name}
              </Text>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  fontFamily: theme.fontFamilies.numeric,
                  fontSize: 9,
                  letterSpacing: 0.5,
                  color: theme.colors.text.tertiary,
                  marginTop: 2,
                  textTransform: 'uppercase',
                }}
              >
                {z.range} bpm
              </Text>
            </View>
            <View style={styles.barColumn}>
              <ZoneBar
                pct={z.pct}
                color={vitalColor}
                opacity={ZONE_OPACITY_RAMP[i] ?? 1}
                reduceMotion={reduceMotion}
                delayMs={i * STAGGER_MS}
                trackColor={theme.colors.surface.glassLight}
              />
            </View>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: captionStyle.size,
                lineHeight: captionStyle.lineHeight,
                color: theme.colors.text.tertiary,
                width: 36,
                textAlign: 'right',
              }}
            >
              {Math.round(z.pct)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 0.5,
    marginHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nameColumn: {
    width: 70,
  },
  barColumn: {
    flex: 1,
  },
  barTrack: {
    width: '100%',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    height: '100%',
    transformOrigin: 'left center',
  },
});
