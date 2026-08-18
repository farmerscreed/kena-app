// ConstellationLegend — Sprint 7.7a (caregiver Family Constellation).
//
// A semi-glass card sitting beneath the bird's-eye `ConstellationField`.
// One row per person, each row composed of:
//   - leading 8pt accent dot (with a soft accent-coloured glow; sleeping
//     dots are dim + un-glowed because the periwinkle reads as a calm
//     marker, not a live signal),
//   - centre column: first-name in the editorial serif (15pt) + a mono
//     uppercase " · {relation}" tertiary label, with the AI-generated
//     headline below in 11.5pt secondary text (1-line truncation),
//   - trailing `<StatusPill>`.
//
// Source design: `leiko-caregiver-c.jsx` — `ConstellationLegend` —
// translated to RN. The original uses a vertical `linear-gradient`
// background; RN doesn't support multi-stop gradients without
// `react-native-linear-gradient` (not in our pinned stack), so this
// flattens to a single tinted fill (`surface.warmSubtle`) which reads
// close on the warm-charcoal canvas.
//
// Voice rules (docs/05-voice-and-claims.md): the only authored string
// owned by this component is the " · " separator. Headlines + status
// labels come from props / `STATUS_LABEL_FOR` and are voice-checked at
// their source.
//
// Accessibility: each row is a `Pressable` with `accessibilityRole=
// "button"` and a composed label "{firstName}, {relation}, {status
// label}, {headline}" so a screen-reader user gets the same at-a-glance
// signal a sighted user does.

import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';
import { STATUS_LABEL_FOR, StatusPill, type Status } from './StatusPill';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export interface LegendPerson {
  id: string;
  fullName: string;
  /** "Mom" / "Dad" / "Aunt" — voice-rule-checked at the source. */
  relation: string;
  /** Hex (or any RN-acceptable colour string). */
  accent: string;
  status: Status;
  /** Single-line headline, e.g. "A calm morning." — voice-rule-checked
   *  at the source (where the AI narration template lives). */
  headline: string;
}

export interface ConstellationLegendProps {
  people: LegendPerson[];
  onSelectPerson?: (id: string) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const CARD_RADIUS = 18;
const CARD_PAD_VERTICAL = 14;
const CARD_PAD_HORIZONTAL = 18;
const ROW_PAD_VERTICAL = 8;
const ROW_GAP = 12;
const DOT_SIZE = 8;
const HAIRLINE = 0.5;

function firstName(fullName: string): string {
  return fullName.split(' ')[0] ?? fullName;
}

function composeRowAccessibilityLabel(p: LegendPerson): string {
  const fn = firstName(p.fullName);
  const statusLabel = STATUS_LABEL_FOR[p.status];
  return `${fn}, ${p.relation}, ${statusLabel}, ${p.headline}`;
}

export function ConstellationLegend({
  people,
  onSelectPerson,
  testID,
  style,
}: ConstellationLegendProps) {
  const theme = useTheme();

  const containerStyle: ViewStyle = {
    backgroundColor: theme.colors.surface.warmSubtle,
    borderRadius: CARD_RADIUS,
    borderWidth: HAIRLINE,
    borderColor: theme.colors.border.subtle,
    paddingVertical: CARD_PAD_VERTICAL,
    paddingHorizontal: CARD_PAD_HORIZONTAL,
  };

  return (
    <View testID={testID} style={[containerStyle, style]}>
      {people.map((p, i) => {
        const isSleeping = p.status === 'sleeping';
        const dotGlow = isSleeping
          ? null
          : {
              shadowColor: p.accent,
              shadowOpacity: 0.85,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 0 },
              elevation: 0,
            };

        const rowStyle: ViewStyle = {
          flexDirection: 'row',
          alignItems: 'center',
          gap: ROW_GAP,
          paddingVertical: ROW_PAD_VERTICAL,
          ...(i > 0
            ? {
                borderTopWidth: HAIRLINE,
                borderTopColor: theme.colors.border.subtle,
              }
            : {}),
        };

        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={composeRowAccessibilityLabel(p)}
            testID={testID ? `${testID}-row-${p.id}` : undefined}
            onPress={onSelectPerson ? () => onSelectPerson(p.id) : undefined}
            style={({ pressed }) => [
              rowStyle,
              pressed && onSelectPerson ? { opacity: 0.85 } : null,
            ]}
          >
            {/* Leading accent dot (with status-aware glow) */}
            <View
              pointerEvents="none"
              style={[
                {
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_SIZE / 2,
                  backgroundColor: p.accent,
                  opacity: isSleeping ? 0.5 : 1,
                  flexShrink: 0,
                },
                dotGlow,
              ]}
            />

            {/* Centre column — name · relation, headline below */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  gap: 8,
                }}
              >
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                  style={{
                    fontFamily: theme.fontFamilies.editorial,
                    fontSize: 15,
                    lineHeight: 18,
                    color: theme.colors.text.primary,
                    letterSpacing: -0.075, // -0.005em at 15pt
                  }}
                >
                  {firstName(p.fullName)}
                </Text>
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                  style={{
                    fontFamily: theme.fontFamilies.numeric,
                    fontSize: 9,
                    lineHeight: 12,
                    color: theme.colors.text.tertiary,
                    letterSpacing: 0.9,
                    textTransform: 'uppercase',
                  }}
                >
                  {`· ${p.relation}`}
                </Text>
              </View>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{
                  // Secondary token now resolves to a warm cream
                  // #F5EFE2 (~96% luminance) — bright enough to read
                  // cleanly on Android, warm enough to carry the
                  // editorial register.
                  fontFamily: theme.fontFamilies.body,
                  fontSize: 11.5,
                  lineHeight: 16,
                  color: theme.colors.text.secondary,
                  marginTop: 2,
                }}
              >
                {p.headline}
              </Text>
            </View>

            {/* Trailing status pill */}
            <StatusPill status={p.status} />
          </Pressable>
        );
      })}
    </View>
  );
}
