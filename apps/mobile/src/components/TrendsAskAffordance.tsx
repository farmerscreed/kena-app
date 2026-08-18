// TrendsAskAffordance — Trends v2 "The Letter".
//
// The calm "Ask about this trend" pill that sits under the evidence
// chart. Tier-B-backed via AskLeiko; this component owns only the
// affordance, not the conversation surface. The screen wires the
// onPress to open AskLeikoSheet with the current range + focal vital
// preloaded as context.
//
// Voice rule: the label is fixed copy authored against the design
// brief. Tested in TrendsAskAffordance.test.tsx.

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

export const TRENDS_ASK_LABEL = 'Ask about this trend';

export interface TrendsAskAffordanceProps {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TrendsAskAffordance({
  onPress,
  style,
  testID,
}: TrendsAskAffordanceProps) {
  const theme = useTheme();
  const accent = theme.colors.brand.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={TRENDS_ASK_LABEL}
      style={({ pressed }) => [
        styles.root,
        {
          borderColor: accent,
          marginHorizontal: theme.spacing.l,
          borderRadius: 99,
          paddingVertical: 11,
          paddingHorizontal: 16,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
      testID={testID}
    >
      <View style={styles.row}>
        <View style={styles.leadingGroup}>
          <Svg width={13} height={13} viewBox="0 0 24 24">
            <Path
              d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"
              fill="none"
              stroke={accent}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: theme.fontFamilies.bodyMedium,
              fontSize: 13,
              lineHeight: 18,
              color: accent,
              marginLeft: 8,
              letterSpacing: -0.1,
            }}
            testID={testID ? `${testID}-label` : undefined}
          >
            {TRENDS_ASK_LABEL}
          </Text>
        </View>
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <Path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke={accent}
            strokeOpacity={0.7}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  leadingGroup: { flexDirection: 'row', alignItems: 'center' },
});
