// FamilyParent — docs/04-screens/caregiver-onboarding.md §4.4.2.
// Captures parent name + relationship + timezone. Writes to the onboarding
// draft; the families row is created at the end of FamilyWatch via the
// create_family RPC.
//
// Sprint 3 timezone picker: a curated short-list covering Nigeria + US +
// common diaspora destinations. Sprint 17 (or earlier if needed) replaces
// this with a full searchable IANA list. The auto-detected device zone
// is the default; the bottom sheet lets the caregiver override it for
// parents living in a different region (a Lagos caregiver setting up the
// watch for a parent in NYC, etc.).

import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../../components/Button';
import { OnboardingEyebrow } from '../../../components/OnboardingEyebrow';
import { OnboardingScaffold } from '../../../components/OnboardingScaffold';
import { Pill } from '../../../components/Pill';
import { TimezonePicker } from '../../../components/TimezonePicker';
import { useTheme } from '../../../theme';
import { useOnboarding, type ParentRelationship } from '../../../state/onboarding';
import type { CaregiverOnboardingScreenProps } from '../../../navigation/types';

interface ChipOption {
  value: ParentRelationship;
  label: string;
}

const CHIPS: ChipOption[] = [
  { value: 'mother', label: 'Mum' },
  { value: 'father', label: 'Dad' },
  { value: 'aunt', label: 'Aunt' },
  { value: 'uncle', label: 'Uncle' },
  { value: 'other', label: 'Other' },
];

export function CaregiverFamilyParentScreen({
  navigation,
}: CaregiverOnboardingScreenProps<'FamilyParent'>) {
  const theme = useTheme();
  const setParent = useOnboarding((s) => s.setParent);
  const draft = useOnboarding((s) => s.parent);

  const [name, setName] = useState(draft.displayName);
  const [relationship, setRelationship] = useState<ParentRelationship | null>(
    draft.relationship,
  );
  const [customLabel, setCustomLabel] = useState(draft.relationshipCustom ?? '');
  const [timezone, setTimezone] = useState(draft.timezone);

  const headline = theme.type('displayM');
  const body = theme.type('bodyL');
  const label = theme.type('label');

  const customRequired = relationship === 'other';
  const customValid = !customRequired || customLabel.trim().length > 0;
  const valid =
    name.trim().length > 0 && relationship !== null && customValid && timezone.length > 0;

  const handleContinue = () => {
    if (!valid || !relationship) return;
    setParent({
      displayName: name.trim(),
      relationship,
      relationshipCustom: relationship === 'other' ? customLabel.trim() : null,
      timezone,
    });
    navigation.navigate('FamilyWatch');
  };

  return (
    <OnboardingScaffold
      onBack={() => navigation.goBack()}
      scrollTestID="family-parent-scroll"
      footer={
        <Button
          variant="primary"
          onPress={handleContinue}
          disabled={!valid}
          testID="family-parent-continue"
          style={{ width: '100%' }}
        >
          Continue
        </Button>
      }
    >
      <OnboardingEyebrow persona="Caregiver" step={2} total={3} />

      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={1.3}
        style={{
          color: theme.colors.text.primary,
          fontSize: headline.size,
          lineHeight: headline.lineHeight,
          fontWeight: headline.weight as '700',
          fontFamily: headline.family,
          marginBottom: theme.spacing.s,
        }}
      >
        Who are you looking after?
      </Text>

      <Text
        maxFontSizeMultiplier={1.5}
        style={{
          color: theme.colors.text.secondary,
          fontSize: body.size,
          lineHeight: body.lineHeight,
          fontFamily: body.family,
          marginBottom: theme.spacing.xxl,
        }}
      >
        We'll use this name in updates so the family circle stays personal.
      </Text>

      <Text
        maxFontSizeMultiplier={1.5}
        style={{
          color: theme.colors.text.secondary,
          fontSize: label.size,
          fontWeight: label.weight as '500',
          fontFamily: label.family,
          marginBottom: theme.spacing.s,
        }}
      >
        Their name
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Mama Linda"
        placeholderTextColor={theme.colors.text.secondary}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="next"
        accessibilityLabel="The name you call them"
        testID="family-parent-name"
        style={{
          backgroundColor: theme.colors.surface.elevated,
          borderRadius: theme.radii.m,
          paddingHorizontal: theme.spacing.l,
          paddingVertical: theme.spacing.m,
          fontSize: body.size,
          fontFamily: body.family,
          color: theme.colors.text.primary,
          borderWidth: 1,
          borderColor: theme.colors.border.default,
          minHeight: theme.minTapTarget,
          marginBottom: theme.spacing.xxl,
        }}
      />

      <Text
        maxFontSizeMultiplier={1.5}
        style={{
          color: theme.colors.text.secondary,
          fontSize: label.size,
          fontWeight: label.weight as '500',
          fontFamily: label.family,
          marginBottom: theme.spacing.s,
        }}
      >
        Who are they to you?
      </Text>
      <View
        accessible
        accessibilityRole="radiogroup"
        accessibilityLabel="Relationship"
        style={styles.chipsRow}
      >
        {CHIPS.map((chip) => {
          const selected = relationship === chip.value;
          return (
            <View
              key={chip.value}
              style={{ marginRight: theme.spacing.s, marginBottom: theme.spacing.s }}
            >
              <Pill
                selected={selected}
                onPress={() => setRelationship(chip.value)}
                accessibilityLabel={chip.label}
                testID={`family-parent-chip-${chip.value}`}
              >
                {chip.label}
              </Pill>
            </View>
          );
        })}
      </View>

      {customRequired ? (
        <TextInput
          value={customLabel}
          onChangeText={setCustomLabel}
          placeholder="Aunt Tola, Godmother, …"
          placeholderTextColor={theme.colors.text.secondary}
          autoCapitalize="words"
          autoCorrect={false}
          accessibilityLabel="Custom relationship"
          testID="family-parent-custom"
          style={{
            backgroundColor: theme.colors.surface.elevated,
            borderRadius: theme.radii.m,
            paddingHorizontal: theme.spacing.l,
            paddingVertical: theme.spacing.m,
            fontSize: body.size,
            fontFamily: body.family,
            color: theme.colors.text.primary,
            borderWidth: 1,
            borderColor: theme.colors.border.default,
            minHeight: theme.minTapTarget,
            marginBottom: theme.spacing.l,
          }}
        />
      ) : null}

      <View style={{ height: theme.spacing.l }} />

      <Text
        maxFontSizeMultiplier={1.5}
        style={{
          color: theme.colors.text.secondary,
          fontSize: label.size,
          fontWeight: label.weight as '500',
          fontFamily: label.family,
          marginBottom: theme.spacing.s,
        }}
      >
        Where do they live?
      </Text>
      <TimezonePicker
        value={timezone}
        onChange={setTimezone}
        fieldA11yPrefix="Their timezone"
        sheetTitle="Choose their timezone"
        testID="family-parent-zone"
      />
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap' },
});
