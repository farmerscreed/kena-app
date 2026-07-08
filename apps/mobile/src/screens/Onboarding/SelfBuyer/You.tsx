// Self-Buyer / You — docs/04-screens/self-buyer-onboarding.md §4.4.1
// (D8a §4.1). Captures the self-buyer's name, optional year of birth,
// and timezone. All copy strings are verified per D8a §4.1.1 and must
// not drift.
//
// Year-of-birth handling: optional, but if entered the value must fall
// in the schema's check range (1900..2100). Invalid input keeps the
// current draft year null and surfaces a subtle helper text — we don't
// raise a hard error since the field is opt-in.

import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { Button } from '../../../components/Button';
import { OnboardingEyebrow } from '../../../components/OnboardingEyebrow';
import { OnboardingScaffold } from '../../../components/OnboardingScaffold';
import { TimezonePicker } from '../../../components/TimezonePicker';
import { useTheme } from '../../../theme';
import { useOnboarding } from '../../../state/onboarding';
import type { SelfBuyerOnboardingScreenProps } from '../../../navigation/types';

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

function parseYearOfBirth(input: string): { value: number | null; valid: boolean } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { value: null, valid: true };  // skip
  if (!/^\d{4}$/.test(trimmed)) return { value: null, valid: false };
  const n = Number(trimmed);
  if (n < YEAR_MIN || n > YEAR_MAX) return { value: null, valid: false };
  return { value: n, valid: true };
}

export function SelfBuyerYouScreen({
  navigation,
}: SelfBuyerOnboardingScreenProps<'You'>) {
  const theme = useTheme();
  const setSelfBuyer = useOnboarding((s) => s.setSelfBuyer);
  const draft = useOnboarding((s) => s.selfBuyer);

  const [name, setName] = useState(draft.displayName);
  const [yearText, setYearText] = useState(
    draft.yearOfBirth !== null ? String(draft.yearOfBirth) : '',
  );
  const [timezone, setTimezone] = useState(draft.timezone);

  const headline = theme.type('displayM');
  const body = theme.type('bodyL');
  const label = theme.type('label');
  const caption = theme.type('caption');

  const yob = parseYearOfBirth(yearText);
  const valid = name.trim().length > 0 && yob.valid && timezone.length > 0;

  const handleContinue = () => {
    if (!valid) return;
    setSelfBuyer({
      displayName: name.trim(),
      yearOfBirth: yob.value,
      timezone,
    });
    navigation.navigate('Watch');
  };

  return (
    <OnboardingScaffold
      onBack={() => navigation.goBack()}
      scrollTestID="self-buyer-you-scroll"
      footer={
        <Button
          variant="primary"
          onPress={handleContinue}
          disabled={!valid}
          testID="self-buyer-you-continue"
          style={{ width: '100%' }}
        >
          Continue
        </Button>
      }
    >
      <OnboardingEyebrow persona="Myself" step={1} total={2} />

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
        Welcome. Let's set you up.
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
        A few quick details. We don't need much.
      </Text>

      {/* Name */}
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
        placeholder="First name is fine"
        placeholderTextColor={theme.colors.text.secondary}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="next"
        accessibilityLabel="Your first name"
        testID="self-buyer-you-name"
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

      {/* Year of birth (optional) */}
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
        Year of birth (optional)
      </Text>
      <TextInput
        value={yearText}
        onChangeText={setYearText}
        placeholder="e.g. 1962"
        placeholderTextColor={theme.colors.text.secondary}
        keyboardType="number-pad"
        maxLength={4}
        accessibilityLabel="Year of birth, optional"
        testID="self-buyer-you-yob"
        style={{
          backgroundColor: theme.colors.surface.elevated,
          borderRadius: theme.radii.m,
          paddingHorizontal: theme.spacing.l,
          paddingVertical: theme.spacing.m,
          fontSize: body.size,
          fontFamily: body.family,
          color: theme.colors.text.primary,
          borderWidth: 1,
          borderColor: yob.valid
            ? theme.colors.border.default
            : theme.colors.state.urgent,
          minHeight: theme.minTapTarget,
          marginBottom: theme.spacing.s,
        }}
      />
      <Text
        maxFontSizeMultiplier={1.5}
        style={{
          color: yob.valid ? theme.colors.text.secondary : theme.colors.state.urgent,
          fontSize: caption.size,
          fontFamily: caption.family,
          marginBottom: theme.spacing.xxl,
        }}
      >
        {yob.valid
          ? 'Helps us frame your readings in context. You can skip this.'
          : `Enter a four-digit year between ${YEAR_MIN} and ${YEAR_MAX}.`}
      </Text>

      {/* Timezone */}
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
        Your timezone
      </Text>
      <TimezonePicker
        value={timezone}
        onChange={setTimezone}
        fieldA11yPrefix="Your timezone"
        sheetTitle="Choose your timezone"
        testID="self-buyer-you-zone"
      />
      <Text
        maxFontSizeMultiplier={1.5}
        style={{
          color: theme.colors.text.secondary,
          fontSize: caption.size,
          fontFamily: caption.family,
          marginTop: theme.spacing.s,
        }}
      >
        Auto-detected. Tap to change.
      </Text>
    </OnboardingScaffold>
  );
}
