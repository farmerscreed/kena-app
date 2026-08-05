// TrendsLetterHero — Trends v2 "The Letter".
//
// The narrative paragraph that anchors the redesigned Trends screen.
// Renders an editorial-serif paragraph with an italic-emphasis layer
// (spans wrapped in `_text_` become `editorialItalic`), plus a small
// mono uppercase eyebrow above and a freshness caption below.
//
// The component is presentational — the body is supplied by the
// caller (typically from the Sprint 16 fall-through cascade output).
// No fetch, no AI call, no state. That keeps the screen-level code
// in charge of orchestration and the renderer testable without
// mocking the cascade.

import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { parseNarrativeSpans } from '../services/ai/trendsNarration';
import { MAX_FONT_SCALE_PROSE } from '../theme/fontScaling';

export interface TrendsLetterHeroProps {
  /**
   * The narrative body, with `_text_` markers indicating italic
   * emphasis. The cascade hands us this string directly.
   */
  body: string;
  /** Eyebrow line above the paragraph. Default: "A letter from Leiko · {range}". */
  eyebrow?: string;
  /**
   * Freshness caption rendered below the paragraph in tertiary mono
   * uppercase. Caller composes from the range + last-computed time.
   */
  freshnessCaption?: string;
  /**
   * Sprint 16.5g — optional sign-off line ("— Leiko") rendered in
   * italic editorial type below the paragraph. Closes the letter
   * metaphor that the eyebrow opens.
   */
  signOff?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TrendsLetterHero({
  body,
  eyebrow,
  freshnessCaption,
  signOff,
  style,
  testID,
}: TrendsLetterHeroProps) {
  const theme = useTheme();
  const spans = parseNarrativeSpans(body);

  return (
    <View style={[styles.root, style]} testID={testID}>
      {eyebrow ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_PROSE}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: 10,
            lineHeight: 14,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
            color: theme.colors.brand.primary,
            marginBottom: theme.spacing.m,
          }}
          testID={testID ? `${testID}-eyebrow` : undefined}
        >
          {eyebrow}
        </Text>
      ) : null}

      <Text
        style={{
          fontFamily: theme.fontFamilies.editorial,
          fontSize: 22,
          lineHeight: 30,
          letterSpacing: -0.1,
          color: theme.colors.text.primary,
        }}
        testID={testID ? `${testID}-paragraph` : undefined}
        accessibilityRole="text"
      >
        {spans.map((span, idx) => (
          <Text
            key={idx}
            style={
              span.em
                ? {
                    fontFamily: theme.fontFamilies.editorialItalic,
                    fontStyle: 'italic',
                    color: theme.colors.brand.primary,
                  }
                : undefined
            }
          >
            {span.text}
          </Text>
        ))}
      </Text>

      {signOff ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_PROSE}
          style={{
            fontFamily: theme.fontFamilies.editorialItalic,
            fontStyle: 'italic',
            fontSize: 16,
            lineHeight: 22,
            color: theme.colors.text.secondary,
            marginTop: theme.spacing.s,
          }}
          testID={testID ? `${testID}-signoff` : undefined}
        >
          {signOff}
        </Text>
      ) : null}

      {freshnessCaption ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_PROSE}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: 10,
            lineHeight: 14,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            color: theme.colors.text.tertiary,
            marginTop: theme.spacing.m,
          }}
          testID={testID ? `${testID}-freshness` : undefined}
        >
          {freshnessCaption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 24, paddingTop: 24 },
});

// Re-export for callers that compose multiple slots without importing
// the renderer directly.
export type { ReactNode };
