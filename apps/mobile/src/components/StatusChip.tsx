// StatusChip — D13 PR-2 (§6.1). One component, one definition site for
// rendering a verdict tier. Replaces the six competing phrasings the
// audit catalogued (P2-1).
//
// Rules from the spec:
//   · Sentence case, never uppercase (docs/05:182).
//   · Copy comes from services/voice/tierVocabulary — do not re-coin.
//   · Colour is a status role only; identity colours never appear here.
//   · Nested inside a labelled card, the chip is hidden from the
//     accessibility tree — the verdict lives in the parent's composed
//     label, so it is never announced twice and never lost.

import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import {
  CheckIcon,
  WarningCircleIcon,
  PhoneIcon,
  CircleDashedIcon,
} from 'phosphor-react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';
import type { Tier } from '../utils/classification';
import {
  chipTextForTier,
  SELF_SUBJECT,
  type Subject,
} from '../services/voice/tierVocabulary';

export interface StatusChipProps {
  tier: Tier;
  /** Whose verdict this is — never a hardcoded pronoun. */
  subject?: Subject;
  size?: 's' | 'm';
  /** True when the chip sits inside a card that already composes the
   *  verdict into its own accessibility label. */
  nestedInLabelledCard?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const ICON_FOR: Record<Tier, typeof CheckIcon> = {
  learning: CircleDashedIcon,
  in_range: CheckIcon,
  worth_a_look: WarningCircleIcon,
  talk_to_doctor: PhoneIcon,
};

/** Until the PR-5 colour fork lands its dedicated status family, tiers
 *  map onto the existing person-status tones (green / amber / red /
 *  muted grey). PR-5 re-points this at `status[tier]` in one place. */
function toneForTier(
  tier: Tier,
  status: { clear: string; attention: string; urgent: string; offline: string },
): string {
  switch (tier) {
    case 'learning':
      return status.offline;
    case 'in_range':
      return status.clear;
    case 'worth_a_look':
      return status.attention;
    case 'talk_to_doctor':
      return status.urgent;
  }
}

const BG_ALPHA = '24'; // 14%
const BORDER_ALPHA = '3D'; // 24%

export function StatusChip({
  tier,
  subject = SELF_SUBJECT,
  size = 'm',
  nestedInLabelledCard = false,
  testID,
  style,
}: StatusChipProps) {
  const theme = useTheme();
  const tone = toneForTier(tier, theme.colors.status);
  const label = chipTextForTier(tier, subject);
  const Icon = ICON_FOR[tier];
  const fontSize = size === 's' ? 11 : 13;
  const iconSize = size === 's' ? 12 : 14;

  return (
    <View
      accessible={!nestedInLabelledCard}
      accessibilityElementsHidden={nestedInLabelledCard}
      importantForAccessibility={nestedInLabelledCard ? 'no-hide-descendants' : 'auto'}
      accessibilityRole={nestedInLabelledCard ? undefined : 'text'}
      accessibilityLabel={nestedInLabelledCard ? undefined : label}
      testID={testID}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: size === 's' ? 4 : 5,
          paddingVertical: size === 's' ? 3 : 4,
          paddingHorizontal: size === 's' ? 8 : 10,
          borderRadius: 99,
          backgroundColor: tone + BG_ALPHA,
          borderWidth: 0.5,
          borderColor: tone + BORDER_ALPHA,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <Icon size={iconSize} color={tone} weight="bold" />
      <Text
        style={{
          fontFamily: theme.fontFamilies.body,
          fontSize,
          lineHeight: fontSize + 4,
          color: tone,
        }}
        maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
      >
        {label}
      </Text>
    </View>
  );
}
