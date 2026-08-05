// DoctorNoteField — Trends v2 follow-up: "For your doctor" screen.
//
// Optional cover-page note field. Single-line; placeholder copy is
// italic editorial serif. Per the design brief, this was a stretch
// goal at v1.0 — the designer landed it cleanly so we include it.
// Note: the value is NOT YET threaded into the Edge Function
// request; the `generate-doctor-pdf` types don't accept a note in
// v1.0. Wiring lands when the server template gains the slot.

import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme';
import type { AccountType } from '../types/database';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

export const DOCTOR_NOTE_EYEBROW = 'A line for the cover (optional)';

/**
 * Sprint 16.5h — placeholder uses the real parent's name in caregiver
 * mode. Pre-fix it was hardcoded "her" regardless of which parent the
 * caregiver was caring for.
 */
export function doctorNotePlaceholder(
  accountType: AccountType,
  parentLabel?: string,
): string {
  if (accountType === 'caregiver') {
    const name = parentLabel?.trim();
    if (name) return `Anything on ${name}'s mind for this visit?`;
    return 'Anything on their mind for this visit?';
  }
  return 'Anything on your mind for this visit?';
}

export interface DoctorNoteFieldProps {
  value: string;
  onChange: (next: string) => void;
  accountType: AccountType;
  /** Sprint 16.5h — real parent name in caregiver mode. */
  parentLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function DoctorNoteField({
  value,
  onChange,
  accountType,
  parentLabel,
  style,
  testID,
}: DoctorNoteFieldProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.root,
        {
          marginHorizontal: theme.spacing.l,
          marginTop: theme.spacing.l,
        },
        style,
      ]}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: theme.fontFamilies.numeric,
          fontSize: 9,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: theme.colors.text.tertiary,
          marginBottom: 10,
        }}
        testID={testID ? `${testID}-eyebrow` : undefined}
      >
        {DOCTOR_NOTE_EYEBROW}
      </Text>
      <View
        style={[
          styles.fieldRow,
          {
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: theme.radii.m,
            backgroundColor: theme.colors.surface.warmSubtle,
            borderColor: theme.colors.border.subtle,
          },
        ]}
      >
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <Path
            d="M4 20l5-2 11-11a2 2 0 00-3-3L6 15l-2 5z"
            fill="none"
            stroke={theme.colors.brand.primary}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={doctorNotePlaceholder(accountType, parentLabel)}
          placeholderTextColor={theme.colors.text.tertiary}
          accessibilityLabel={doctorNotePlaceholder(accountType, parentLabel)}
          testID={testID ? `${testID}-input` : undefined}
          style={{
            flex: 1,
            marginLeft: 10,
            fontFamily: theme.fontFamilies.editorial,
            fontSize: 14,
            color: theme.colors.text.primary,
            paddingVertical: 0,
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {},
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
});
