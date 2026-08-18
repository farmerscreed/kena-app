// HealthMonitorRow — D13 PR-8 (§6.4). One row per vital on the Person
// Overview: name · latest value + band · sparkline · verdict icon.
// The verdict never travels by colour alone — the icon carries the
// status tone, the text lives in the composed label, and the whole
// row (≥ 56pt) is the tap target through to the vital detail.
//
// Learning state: dashed grey stub instead of a sparkline, no band.

import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Line as SvgLine } from 'react-native-svg';
import {
  CheckIcon,
  WarningCircleIcon,
  PhoneIcon,
  CircleDashedIcon,
} from 'phosphor-react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE, MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';
import { Sparkline } from './Sparkline';
import type { Tier } from '../utils/classification';
import {
  chipTextForTier,
  SELF_SUBJECT,
  type Subject,
} from '../services/voice/tierVocabulary';

export interface HealthMonitorRowProps {
  /** Display name of the vital ("Blood pressure", "Sleep"). */
  name: string;
  /** Pre-formatted latest value ("128/82", "7:42 hrs"); "—" when none. */
  value: string;
  /** Pre-formatted band ("usual 118–134"); null while learning. */
  bandLabel: string | null;
  /** Sparkline series, oldest → newest; empty while learning. */
  series: number[];
  tier: Tier;
  subject?: Subject;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const SPARK_W = 54;
const SPARK_H = 24;

const ICON_FOR: Record<Tier, typeof CheckIcon> = {
  learning: CircleDashedIcon,
  in_range: CheckIcon,
  worth_a_look: WarningCircleIcon,
  talk_to_doctor: PhoneIcon,
};

function toneFor(
  tier: Tier,
  status: { clear: string; attention: string; urgent: string; learning: string },
): string {
  switch (tier) {
    case 'learning':
      return status.learning;
    case 'in_range':
      return status.clear;
    case 'worth_a_look':
      return status.attention;
    case 'talk_to_doctor':
      return status.urgent;
  }
}

export function HealthMonitorRow({
  name,
  value,
  bandLabel,
  series,
  tier,
  subject = SELF_SUBJECT,
  onPress,
  testID,
  style,
}: HealthMonitorRowProps) {
  const theme = useTheme();
  const bodyM = theme.type('bodyM');
  const numericS = theme.type('numericS');
  const tone = toneFor(tier, theme.colors.status);
  const Icon = ICON_FOR[tier];
  const verdictText = chipTextForTier(tier, subject);
  const a11y = `${name}, ${value}${bandLabel ? `, ${bandLabel}` : ''}, ${verdictText}. Opens the detail.`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        {
          minHeight: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.m,
          paddingVertical: theme.spacing.s,
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[bodyM, { color: theme.colors.text.primary }]}
        >
          {name}
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
          style={{
            fontFamily: numericS.family,
            fontVariant: ['tabular-nums'],
            fontSize: numericS.size,
            lineHeight: numericS.lineHeight,
            color: theme.colors.text.tertiary,
            marginTop: 2,
          }}
        >
          {value}
          {bandLabel ? ` · ${bandLabel}` : ''}
        </Text>
      </View>
      {series.length >= 2 ? (
        <Sparkline
          values={series}
          width={SPARK_W}
          height={SPARK_H}
          testID={testID ? `${testID}-spark` : undefined}
        />
      ) : (
        // Learning stub: dashed grey line, no band, no claim.
        <Svg width={SPARK_W} height={SPARK_H} accessibilityElementsHidden>
          <SvgLine
            x1={2}
            y1={SPARK_H / 2}
            x2={SPARK_W - 2}
            y2={SPARK_H / 2}
            stroke={theme.colors.status.learning}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        </Svg>
      )}
      <Icon size={18} color={tone} weight="bold" />
    </Pressable>
  );
}
