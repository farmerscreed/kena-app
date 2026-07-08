// FamilyYou — docs/04-screens/caregiver-onboarding.md §4.4.1.
// Captures the caregiver's own name + their relationship to the parent
// (chip-select pronoun). Continue is disabled until both are filled.
// Writes to the onboarding draft; the public.users.display_name update
// is committed at the end of FamilyWatch.

import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../../components/Button';
import { OnboardingEyebrow } from '../../../components/OnboardingEyebrow';
import { OnboardingScaffold } from '../../../components/OnboardingScaffold';
import { Pill } from '../../../components/Pill';
import { useTheme } from '../../../theme';
import { useOnboarding, type CaregiverRelationship } from '../../../state/onboarding';
import type { CaregiverOnboardingScreenProps } from '../../../navigation/types';

interface ChipOption {
  value: CaregiverRelationship;
  label: string;
}

const CHIPS: ChipOption[] = [
  { value: 'daughter', label: 'Daughter' },
  { value: 'son', label: 'Son' },
  { value: 'niece', label: 'Niece' },
  { value: 'nephew', label: 'Nephew' },
  { value: 'other', label: 'Other' },
];

export function CaregiverFamilyYouScreen({
  navigation,
}: CaregiverOnboardingScreenProps<'FamilyYou'>) {
  const theme = useTheme();
  const setCaregiver = useOnboarding((s) => s.setCaregiver);
  const draft = useOnboarding((s) => s.caregiver);

  const [name, setName] = useState(draft.displayName);
  const [relationship, setRelationship] = useState<CaregiverRelationship | null>(
    draft.relationship,
  );

  const headline = theme.type('displayM');
  const body = theme.type('bodyL');
  const label = theme.type('label');

  const valid = name.trim().length > 0 && relationship !== null;

  const handleContinue = () => {
    if (!valid || !relationship) return;
    setCaregiver({ displayName: name.trim(), relationship });
    navigation.navigate('FamilyParent');
  };

  return (
    <OnboardingScaffold
      onBack={() => navigation.goBack()}
      scrollTestID="family-you-scroll"
      footer={
        <Button
          variant="primary"
          onPress={handleContinue}
          disabled={!valid}
          testID="family-you-continue"
          style={{ width: '100%' }}
        >
          Continue
        </Button>
      }
    >
      <OnboardingEyebrow persona="Caregiver" step={1} total={3} />

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
        Tell us about you.
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
        We use your name to address you in the app and in family messages.
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
        What should we call you?
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your first name"
        placeholderTextColor={theme.colors.text.secondary}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="next"
        accessibilityLabel="Your first name"
        testID="family-you-name"
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
        How are you related?
      </Text>
      <View
        accessible
        accessibilityRole="radiogroup"
        accessibilityLabel="How are you related to the person you're caring for?"
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
                testID={`family-you-chip-${chip.value}`}
              >
                {chip.label}
              </Pill>
            </View>
          );
        })}
      </View>
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap' },
});
