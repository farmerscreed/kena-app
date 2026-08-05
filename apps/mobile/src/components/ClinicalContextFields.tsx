// ClinicalContextFields — Sprint 19 PDF v2.
//
// Three optional text inputs collected on the For Your Doctor screen
// and rendered as a "Clinical context" block on the doctor PDF cover.
// Each field is independently optional; an empty field is omitted
// server-side. Fields persist to MMKV so a partial draft survives
// nav-away + back (same pattern as DoctorNoteField).
//
// Field rationale (per the 2026-05-24 founder review of the v1 PDF):
//   - Medications: lets the clinician interpret BP trends in light of
//     current antihypertensive therapy.
//   - Recent symptoms: free-text capture of complaints (dizziness,
//     chest discomfort, sleep disruption) that frame the data.
//   - Target BP: the prescriber's current target for the wearer; used
//     by the clinician to judge whether the readings hit goal.
//
// Voice rules: placeholder copy avoids "patient", "diagnose", "treat";
// uses friendly second-person ("you") for self-buyer and the parent's
// label for caregiver.

import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';
import type { AccountType } from '../types/database';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

export const CLINICAL_FIELDS_EYEBROW = 'Clinical context (optional)';
export const CLINICAL_FIELDS_HELPER =
  'Gives the doctor something to interpret the numbers against.';

function placeholderFor(
  field: 'medications' | 'symptoms' | 'targetBp',
  accountType: AccountType,
  parentLabel?: string,
): string {
  const subject =
    accountType === 'caregiver'
      ? (parentLabel?.trim() ?? 'they')
      : 'you';
  const possessive =
    accountType === 'caregiver'
      ? (parentLabel?.trim() ? `${parentLabel.trim()}'s` : 'their')
      : 'your';
  switch (field) {
    case 'medications':
      return `Any medications ${subject} ${subject === 'you' ? 'take' : 'takes'}? (e.g., lisinopril 10mg daily)`;
    case 'symptoms':
      return `Anything ${subject} ${subject === 'you' ? "have" : 'has'} been noticing lately?`;
    case 'targetBp':
      return `${possessive.charAt(0).toUpperCase()}${possessive.slice(1)} target BP, if set (e.g., <130/80)`;
  }
}

export interface ClinicalContextFieldsProps {
  medications: string;
  symptoms: string;
  targetBp: string;
  onChangeMedications: (next: string) => void;
  onChangeSymptoms: (next: string) => void;
  onChangeTargetBp: (next: string) => void;
  accountType: AccountType;
  parentLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ClinicalContextFields({
  medications,
  symptoms,
  targetBp,
  onChangeMedications,
  onChangeSymptoms,
  onChangeTargetBp,
  accountType,
  parentLabel,
  style,
  testID,
}: ClinicalContextFieldsProps) {
  const theme = useTheme();
  const inputStyle = {
    flex: 1,
    fontFamily: theme.fontFamilies.editorial,
    fontSize: 14,
    color: theme.colors.text.primary,
    paddingVertical: 0,
  };
  const fieldRowStyle = {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: theme.radii.m,
    backgroundColor: theme.colors.surface.warmSubtle,
    borderColor: theme.colors.border.subtle,
  };
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
      testID={testID}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: theme.fontFamilies.numeric,
          fontSize: 9,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: theme.colors.text.tertiary,
          marginBottom: 6,
        }}
        testID={testID ? `${testID}-eyebrow` : undefined}
      >
        {CLINICAL_FIELDS_EYEBROW}
      </Text>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: theme.fontFamilies.editorialItalic,
          fontSize: 12,
          fontStyle: 'italic',
          color: theme.colors.text.tertiary,
          marginBottom: 10,
        }}
      >
        {CLINICAL_FIELDS_HELPER}
      </Text>

      <View style={[styles.fieldRow, fieldRowStyle, { marginBottom: 8 }]}>
        <TextInput
          value={medications}
          onChangeText={onChangeMedications}
          placeholder={placeholderFor('medications', accountType, parentLabel)}
          placeholderTextColor={theme.colors.text.tertiary}
          accessibilityLabel="Current medications"
          testID={testID ? `${testID}-medications` : undefined}
          multiline
          style={[inputStyle, { minHeight: 36 }]}
        />
      </View>

      <View style={[styles.fieldRow, fieldRowStyle, { marginBottom: 8 }]}>
        <TextInput
          value={symptoms}
          onChangeText={onChangeSymptoms}
          placeholder={placeholderFor('symptoms', accountType, parentLabel)}
          placeholderTextColor={theme.colors.text.tertiary}
          accessibilityLabel="Recent symptoms"
          testID={testID ? `${testID}-symptoms` : undefined}
          multiline
          style={[inputStyle, { minHeight: 36 }]}
        />
      </View>

      <View style={[styles.fieldRow, fieldRowStyle]}>
        <TextInput
          value={targetBp}
          onChangeText={onChangeTargetBp}
          placeholder={placeholderFor('targetBp', accountType, parentLabel)}
          placeholderTextColor={theme.colors.text.tertiary}
          accessibilityLabel="Target blood pressure"
          testID={testID ? `${testID}-targetBp` : undefined}
          style={inputStyle}
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
