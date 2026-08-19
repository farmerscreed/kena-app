// DoctorLinkCard — founder-test feedback (2026-08-19, item 2): the
// "For your doctor" link was an underlined caption users scrolled
// past. It is now a proper card — copper accent (the interactive
// family, §5.1), a one-line explanation of what's behind it, a
// chevron, a real tap target.

import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { FileTextIcon, CaretRightIcon } from 'phosphor-react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

export interface DoctorLinkCardProps {
  onPress: () => void;
  /** "your" (self) or the person's possessive ("her", "their"). */
  possessive?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function DoctorLinkCard({
  onPress,
  possessive = 'your',
  testID = 'doctor-link-card',
  style,
}: DoctorLinkCardProps) {
  const theme = useTheme();
  const title = theme.type('title');
  const caption = theme.type('caption');
  const heading =
    possessive === 'your' ? 'For your doctor' : `For ${possessive} doctor`;
  const sub = 'A clean summary of the readings, ready to bring to the next visit.';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${heading}. ${sub}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.m,
          marginHorizontal: 20,
          marginTop: theme.spacing.l,
          padding: theme.spacing.l,
          minHeight: 64,
          borderRadius: theme.radii.l,
          borderWidth: 1,
          borderColor: theme.colors.brand.primary,
          backgroundColor: pressed
            ? theme.colors.surface.warmElevated
            : theme.colors.surface.warmSubtle,
        },
        style,
      ]}
    >
      <FileTextIcon size={22} color={theme.colors.brand.primary} weight="bold" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[title, { color: theme.colors.text.primary }]}
        >
          {heading}
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[caption, { color: theme.colors.text.secondary, marginTop: 2 }]}
        >
          {sub}
        </Text>
      </View>
      <CaretRightIcon size={18} color={theme.colors.brand.primary} weight="bold" />
    </Pressable>
  );
}
