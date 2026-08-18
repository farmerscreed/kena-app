// DaySpine — Sprint 8 (Self-Buyer Home).
//
// Vertical timeline of moments through the day. Replaces the design's
// "Recents" history list per the founder's call (2026-05-08): see
// `docs/04-screens/self-buyer-home.md` and the v2 source at
// new-design/project/leiko-home-v2.html (DaySpine + Divider blocks).
//
// Visual: a thin coral-fading-to-rim vertical spine on the left, with
// each moment rendered as time label (mono right-aligned) → colored dot
// on the spine → serif title + mono sub-line. Past moments dim to 0.55
// opacity. Concerned moments tint the dot to brand.coral regardless of
// vital color, matching D11's calm-concerned visual treatment.
//
// API: presentational. Accepts a moment array (built by
// `utils/dayMoments.ts deriveDayMoments`) plus an optional onSelect
// callback. The screen owns selection (tap → ReadingDetail for BP, etc.).
//
// Voice rules: every visible string here comes from the consumer
// (`moments[i].title` / `.sub`) or a calm-clean header ("Through your
// day") + empty-state ("Your day will fill in as readings come in.").
// No "patient" / "diagnose" / "predict".
//
// Reduced motion: the moments fade in via the global daily-pulse-reveal
// staggered pattern at the screen level — DaySpine itself does no
// animation. Static under reduced motion automatically.

import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';
import type { DayMoment, MomentVital } from '../utils/dayMoments';
import type { VitalType } from './VitalRing';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

// Moment vitals are a strict subset of VitalType; the cast is safe.
function vitalToVitalType(v: MomentVital): VitalType {
  return v as VitalType;
}

export interface DaySpineProps {
  moments: DayMoment[];
  /** Tap a moment → consumer routes to detail (Sprint 8.5 wiring). */
  onSelect?: (moment: DayMoment) => void;
  /** Eyebrow above the spine — defaults to "Through your day". */
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const SPINE_X = 56;       // matches the v2 source's 56px left offset
const DOT_SIZE = 9;
const PAST_OPACITY = 0.55;

export function DaySpine({
  moments,
  onSelect,
  label = 'Through your day',
  testID,
  style,
}: DaySpineProps) {
  const theme = useTheme();
  const eyebrowStyle = theme.type('labelUppercase');
  const titleStyle = theme.type('headline');
  const subStyle = theme.type('caption');
  const timeStyle = theme.type('caption');

  const isEmpty = moments.length === 0;

  return (
    <View style={[styles.root, style]} testID={testID}>
      {/* Eyebrow */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.m,
          paddingHorizontal: theme.spacing.l,
          marginBottom: theme.spacing.l,
        }}
      >
        <View
          style={{
            flex: 1,
            height: 1,
            backgroundColor: theme.colors.border.subtle,
          }}
        />
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
          style={{
            fontFamily: eyebrowStyle.family,
            fontSize: eyebrowStyle.size,
            lineHeight: eyebrowStyle.lineHeight,
            letterSpacing: eyebrowStyle.letterSpacing,
            color: theme.colors.text.tertiary,
            textTransform: 'uppercase',
          }}
        >
          {label}
        </Text>
        <View
          style={{
            flex: 1,
            height: 1,
            backgroundColor: theme.colors.border.subtle,
          }}
        />
      </View>

      {isEmpty ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            fontFamily: subStyle.family,
            fontSize: subStyle.size,
            lineHeight: subStyle.lineHeight,
            color: theme.colors.text.tertiary,
            textAlign: 'center',
            paddingHorizontal: theme.spacing.xl,
            paddingVertical: theme.spacing.l,
          }}
          testID={testID ? `${testID}-empty` : undefined}
        >
          Your day will fill in as readings come in.
        </Text>
      ) : (
        <View style={{ position: 'relative', paddingHorizontal: theme.spacing.xl }}>
          {/* The spine itself — thin gradient stand-in: a flat coral line that
              fades down using a translucent overlay couldn't render reliably
              cross-platform; we use a single 1pt brand.coral line at the
              tertiary-text alpha for the same reading. */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: SPINE_X + theme.spacing.xl - 0.5,
              top: theme.spacing.s,
              bottom: theme.spacing.s,
              width: 1,
              backgroundColor: theme.colors.brand.coral,
              opacity: 0.4,
            }}
          />

          {moments.map((m) => {
            const vitalColor = m.concerned
              ? theme.colors.brand.coral
              : theme.colors.vital[vitalToVitalType(m.vital)];
            const interactive = Boolean(onSelect);
            const a11yLabel = `${m.timeLabel}: ${m.title}. ${m.sub}`;

            return (
              <Pressable
                key={m.id}
                onPress={interactive ? () => onSelect?.(m) : undefined}
                accessibilityRole={interactive ? 'button' : 'text'}
                accessibilityLabel={a11yLabel}
                hitSlop={interactive ? 8 : undefined}
                testID={testID ? `${testID}-moment-${m.id}` : undefined}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  paddingVertical: theme.spacing.m,
                  opacity: pressed && interactive ? 0.7 : m.past ? PAST_OPACITY : 1,
                })}
              >
                {/* Time label — fixed-width column on the left */}
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                  style={{
                    fontFamily: theme.fontFamilies.numeric,
                    fontSize: timeStyle.size,
                    lineHeight: timeStyle.lineHeight,
                    color: theme.colors.text.tertiary,
                    width: SPINE_X - theme.spacing.m,
                    textAlign: 'right',
                    paddingTop: 4,
                    letterSpacing: 0.4,
                  }}
                >
                  {m.timeLabel}
                </Text>

                {/* Spine column: dot. The spine line itself is the absolute
                    sibling above; the dot sits on top of it. */}
                <View
                  style={{
                    width: theme.spacing.m * 2,
                    paddingTop: 6,
                    alignItems: 'center',
                  }}
                >
                  <View
                    style={{
                      width: DOT_SIZE,
                      height: DOT_SIZE,
                      borderRadius: DOT_SIZE / 2,
                      backgroundColor: m.past ? 'transparent' : vitalColor,
                      borderWidth: 1.5,
                      borderColor: vitalColor,
                    }}
                  />
                </View>

                {/* Body column */}
                <View style={{ flex: 1, paddingTop: 2 }}>
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                    style={{
                      fontFamily: theme.fontFamilies.editorial,
                      fontSize: titleStyle.size,
                      lineHeight: titleStyle.lineHeight,
                      color: theme.colors.text.primary,
                    }}
                  >
                    {m.title}
                  </Text>
                  <Text
                    style={{
                      fontFamily: subStyle.family,
                      fontSize: subStyle.size,
                      lineHeight: subStyle.lineHeight,
                      color: theme.colors.text.tertiary,
                      marginTop: 2,
                    }}
                  >
                    {m.sub}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
  },
});
