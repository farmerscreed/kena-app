// PersonCard — Sprint 7.7b (caregiver Family Constellation, detailed view).
//
// A tappable editorial card per person. Translates the design's
// `PersonPage` (leiko-caregiver-a.jsx) to React Native: a Pressable with
// a Portrait + relation/age eyebrow + full name, a status pill, an
// italic editorial headline, an AI prose sentence, a four-vital row,
// and a footer with a "last reading" timestamp + "Open ›" affordance.
//
// Gradient simplification:
//   The web design paints the card with a multi-stop linear-gradient
//   (`accent / .08` → `oklch(16% .015 60 / .55)` → `oklch(14% .012 55 / .4)`)
//   plus a radial-gradient corner glow. RN doesn't render multi-stop CSS
//   gradients without expo-linear-gradient. We approximate with:
//     - solid surface.warmSubtle background
//     - hairline accent borderColor at ~18% alpha
//     - top-edge accent stroke at ~30% alpha (borderTopColor)
//     - absolutely-positioned 140×140 round accent-tint blob in the
//       top-right corner at ~18% alpha (the "corner glow" stand-in)
//   The visual reads close enough; a future pass with expo-linear-gradient
//   could land the full multi-stop fidelity if needed.
//
// Motion: tap fires the existing button-press scale pattern from
// theme/motion/patterns (1.0 → 0.97 spring on press, → 1.0 on release).
// Reduced motion (theme.reduceMotion) collapses to instant.
//
// Accessibility: composed accessibilityLabel is
// "{firstName}'s card. {Status humanised}. {sentence}" — uses the
// canonical STATUS_LABEL_FOR map from StatusPill so the label matches
// the visible pill text exactly.

import { useCallback } from 'react';
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
} from 'react-native-reanimated';
import { Portrait } from './Portrait';
import { STATUS_LABEL_FOR, StatusPill, type Status } from './StatusPill';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';
import {
  buttonPressInScale,
  buttonPressOutScale,
} from '../theme/motion/patterns';

export interface VitalStripLabels {
  bp: string;
  hr: string;
  spo2: string;
  sleep: string;
}

export interface PersonCardProps {
  /** Per-person accent hex from theme.colors.person[1|2|3]. The
   *  consumer resolves the accentIndex → hex. */
  accent: string;
  initial: string;
  fullName: string;
  /** "Mom" / "Dad" / "Aunt" — display string. */
  relation: string;
  /** Optional age in years (e.g. 71). When provided, renders alongside
   *  the relation: "MOM · 71". When absent, just "MOM". */
  age?: number;
  status: Status;
  /** Editorial italic title in 22pt Instrument-Serif. */
  headline: string;
  /** Body paragraph in 13.5pt body. */
  sentence: string;
  /** Pre-formatted four-vital row labels. */
  vitalStrip: VitalStripLabels;
  /** "Read · 6:42 am" or "Last reading · 12 min ago" — composer formats
   *  this. PersonCard renders it verbatim. */
  footerLeftLabel: string;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// Alpha suffixes for hex+alpha colour composition. Matches the design's
// `accent.replace(')', ' / .NN)')` patterns in oklch.
// Sprint 16.6 — corner glow trimmed from 2E (≈18%) to 17 (≈9%). At 18%
// the warm-charcoal corner blob was washing out everything behind it
// (status pill, right edges of headline, vital row), making the card
// FEEL dim even though all foreground colours are at AAA contrast on
// the card surface. Halving the alpha keeps the decorative warmth but
// stops it from competing with the type.
const CORNER_GLOW_ALPHA = '17'; // ≈9%
const BORDER_ALPHA = '2E'; // ≈18%
const TOP_EDGE_ALPHA = '4D'; // ≈30%
const HAIRLINE_ALPHA = '1A'; // ~10% — vital-row dividers (text.tertiary tinted)

const CORNER_GLOW_SIZE = 140;
const CORNER_GLOW_OFFSET = -40;

const VITAL_LABELS = {
  bp: 'BP',
  hr: 'HR',
  spo2: 'SPO₂',
  sleep: 'SLEEP',
} as const;

function composeAccessibilityLabel(
  fullName: string,
  status: Status,
  sentence: string,
): string {
  const firstName = fullName.split(' ')[0];
  const statusLabel = STATUS_LABEL_FOR[status];
  return `${firstName}'s card. ${statusLabel}. ${sentence}`;
}

export function PersonCard({
  accent,
  initial,
  fullName,
  relation,
  age,
  status,
  headline,
  sentence,
  vitalStrip,
  footerLeftLabel,
  onPress,
  testID,
  style,
}: PersonCardProps) {
  const theme = useTheme();
  const reduceMotion = theme.reduceMotion;
  const isSleeping = status === 'sleeping';

  const pressScale = useSharedValue(1);

  const handlePressIn = useCallback(() => {
    pressScale.value = buttonPressInScale(reduceMotion);
  }, [pressScale, reduceMotion]);
  const handlePressOut = useCallback(() => {
    pressScale.value = buttonPressOutScale(reduceMotion);
  }, [pressScale, reduceMotion]);

  const innerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const eyebrowText =
    typeof age === 'number'
      ? `${relation.toUpperCase()} · ${age}`
      : relation.toUpperCase();

  // Hairline divider tint — text.tertiary at ~10% alpha. We append the
  // alpha to a 6-digit hex; if text.tertiary is rgba(...) we fall back
  // to a known hairline token. (theme.colors.text.tertiary is always a
  // hex in the dark + light token tables — see color.ts.)
  const dividerColor = theme.colors.text.tertiary + HAIRLINE_ALPHA;

  const a11yLabel = composeAccessibilityLabel(fullName, status, sentence);

  // Outer card style. Dark-canonical caregiver surface; the accent
  // tints sit on top via borders + the corner-glow stand-in.
  const cardStyle: ViewStyle = {
    backgroundColor: theme.colors.surface.warmSubtle,
    borderRadius: theme.radii.l,
    padding: theme.spacing.l,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent + BORDER_ALPHA,
    borderTopWidth: 1,
    borderTopColor: accent + TOP_EDGE_ALPHA,
    overflow: 'hidden',
    opacity: isSleeping ? 0.92 : 1,
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      testID={testID}
      style={[cardStyle, style]}
    >
      {/* Corner accent glow — radial-gradient stand-in. Decorative only. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: CORNER_GLOW_OFFSET,
          right: CORNER_GLOW_OFFSET,
          width: CORNER_GLOW_SIZE,
          height: CORNER_GLOW_SIZE,
          borderRadius: 99,
          backgroundColor: accent + CORNER_GLOW_ALPHA,
        }}
      />

      <Animated.View style={innerAnimatedStyle}>
        {/* Header row: portrait + name column + status pill */}
        <View style={styles.headerRow}>
          <Portrait initial={initial} accent={accent} size="md" />
          <View style={[styles.headerNameCol, { marginLeft: theme.spacing.m }]}>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                // tertiary resolves to warm bright grey-cream — sits
                // visually below the serif full name without going dim.
                fontSize: 10,
                lineHeight: 13,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
                color: theme.colors.text.tertiary,
                marginBottom: 2,
              }}
            >
              {eyebrowText}
            </Text>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: theme.fontFamilies.editorial,
                fontSize: 19,
                lineHeight: 21,
                letterSpacing: -0.2,
                color: theme.colors.text.primary,
              }}
            >
              {fullName}
            </Text>
          </View>
          <StatusPill status={status} />
        </View>

        {/* Editorial italic headline */}
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
          style={{
            fontFamily: theme.fontFamilies.editorialItalic,
            fontStyle: 'italic',
            fontSize: 22,
            lineHeight: 28, // ≈1.25
            letterSpacing: -0.2,
            color: theme.colors.text.primary,
            marginTop: theme.spacing.m,
            marginBottom: theme.spacing.m,
          }}
        >
          {`“${headline}”`}
        </Text>

        {/* Body sentence — secondary (warm cream #F5EFE2) keeps the
            paragraph visibly under the italic headline while staying
            unambiguously bright. */}
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
          style={{
            fontFamily: theme.fontFamilies.body,
            fontSize: 13.5,
            lineHeight: 20,
            color: theme.colors.text.secondary,
            marginBottom: theme.spacing.l,
          }}
        >
          {sentence}
        </Text>

        {/* Vitals row */}
        <View
          style={[
            styles.vitalsRow,
            {
              borderTopColor: dividerColor,
              borderBottomColor: dividerColor,
            },
          ]}
        >
          <VitalCol
            value={vitalStrip.bp}
            label={VITAL_LABELS.bp}
            divider
            dividerColor={dividerColor}
            valueFamily={theme.fontFamilies.numeric}
            valueColor={theme.colors.text.primary}
            labelFamily={theme.fontFamilies.numeric}
            labelColor={theme.colors.text.tertiary}
          />
          <VitalCol
            value={vitalStrip.hr}
            label={VITAL_LABELS.hr}
            divider
            dividerColor={dividerColor}
            valueFamily={theme.fontFamilies.numeric}
            valueColor={theme.colors.text.primary}
            labelFamily={theme.fontFamilies.numeric}
            labelColor={theme.colors.text.tertiary}
          />
          <VitalCol
            value={vitalStrip.spo2}
            label={VITAL_LABELS.spo2}
            divider
            dividerColor={dividerColor}
            valueFamily={theme.fontFamilies.numeric}
            valueColor={theme.colors.text.primary}
            labelFamily={theme.fontFamilies.numeric}
            labelColor={theme.colors.text.tertiary}
          />
          <VitalCol
            value={vitalStrip.sleep}
            label={VITAL_LABELS.sleep}
            divider={false}
            dividerColor={dividerColor}
            valueFamily={theme.fontFamilies.numeric}
            valueColor={theme.colors.text.primary}
            labelFamily={theme.fontFamilies.numeric}
            labelColor={theme.colors.text.tertiary}
          />
        </View>

        {/* Footer row */}
        <View
          style={[
            styles.footerRow,
            { marginTop: theme.spacing.m },
          ]}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              // tertiary resolves to warm bright grey-cream — footer
              // sits below the body without falling dim.
              fontSize: 9.5,
              lineHeight: 13,
              letterSpacing: 1.33,
              textTransform: 'uppercase',
              color: theme.colors.text.tertiary,
            }}
          >
            {footerLeftLabel}
          </Text>
          <View style={styles.footerOpenRow}>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: 11,
                lineHeight: 14,
                letterSpacing: 0.44, // ~0.04em at 11pt
                color: accent,
              }}
            >
              Open
            </Text>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: 13,
                lineHeight: 14,
                color: accent,
                marginLeft: 4,
              }}
            >
              {'›'}
            </Text>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

interface VitalColProps {
  value: string;
  label: string;
  divider: boolean;
  dividerColor: string;
  valueFamily: string;
  valueColor: string;
  labelFamily: string;
  labelColor: string;
}

function VitalCol({
  value,
  label,
  divider,
  dividerColor,
  valueFamily,
  valueColor,
  labelFamily,
  labelColor,
}: VitalColProps) {
  return (
    <View
      style={[
        styles.vitalCol,
        divider
          ? { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: dividerColor }
          : null,
      ]}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
        style={{
          fontFamily: valueFamily,
          fontSize: 18,
          lineHeight: 22,
          letterSpacing: -0.18,
          color: valueColor,
        }}
      >
        {value}
      </Text>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
        style={{
          fontFamily: labelFamily,
          // Back to design's 9pt mono uppercase letter-spacing 0.10em
          // for BP / HR / SPO2 / SLEEP. The earlier 10pt secondary
          // patch was compensating for legibility issues that the
          // warm-near-white text + warm canopy now resolve.
          fontSize: 9,
          lineHeight: 12,
          letterSpacing: 0.9,
          textTransform: 'uppercase',
          color: labelColor,
          marginTop: 4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerNameCol: {
    flex: 1,
    minWidth: 0,
  },
  vitalsRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  vitalCol: {
    flex: 1,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerOpenRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
