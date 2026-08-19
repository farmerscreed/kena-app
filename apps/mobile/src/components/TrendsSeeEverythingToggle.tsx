// TrendsSeeEverythingToggle — Trends v2 "The Letter".
//
// The recessive disclosure row that reveals the full multi-vital
// chart + toggle pills. By default the chart is collapsed because
// the narrative + focal chart already tell the story; this is the
// power-user escape hatch.
//
// Renders a chevron + label + a thin divider line on the right.
// Tappable; rotates the chevron when open. The expanded panel is the
// caller's responsibility (TrendsExpansionPanel below).

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export const TRENDS_SEE_EVERYTHING_LABEL = 'See everything';

export interface TrendsSeeEverythingToggleProps {
  open: boolean;
  onToggle: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TrendsSeeEverythingToggle({
  open,
  onToggle,
  style,
  testID,
}: TrendsSeeEverythingToggleProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={TRENDS_SEE_EVERYTHING_LABEL}
      accessibilityState={{ expanded: open }}
      style={[
        styles.root,
        {
          marginHorizontal: theme.spacing.l,
          marginTop: theme.spacing.xl,
        },
        style,
      ]}
      testID={testID}
    >
      <View
        style={{
          transform: [{ rotate: open ? '90deg' : '0deg' }],
        }}
      >
        <Svg width={12} height={12} viewBox="0 0 24 24">
          <Path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke={theme.colors.text.secondary}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
        style={{
          fontFamily: theme.fontFamilies.numeric,
          fontSize: 10,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: theme.colors.text.secondary,
          marginLeft: 8,
        }}
        testID={testID ? `${testID}-label` : undefined}
      >
        {TRENDS_SEE_EVERYTHING_LABEL}
      </Text>
      <View
        style={{
          flex: 1,
          height: StyleSheet.hairlineWidth,
          backgroundColor: theme.colors.border.subtle,
          marginLeft: 12,
        }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
