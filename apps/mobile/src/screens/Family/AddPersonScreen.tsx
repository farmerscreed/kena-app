// AddPersonScreen — Sprint 19 Block 2.
//
// "Care for another person" flow. Stand-alone screen reachable from
// CaregiverHome's action-bar chooser sheet and from Settings → Family.
// Mirrors the onboarding FamilyParent + FamilyYou inputs (wearer name
// + wearer relationship + caller's relationship + timezone) but skips
// the watch-pairing step — pairing for the new family lives in the
// existing Settings → Devices flow.
//
// On submit: calls `addAnotherFamily` service → invalidates the
// family-readings cache → navigates back. The new family appears as
// an additional orb on CaregiverHome.
//
// Voice rules (docs/05-voice-and-claims.md): every authored string
// here is calm + plain. Headline mirrors the onboarding voice ("Who
// else are you looking after?") to feel like a natural extension.

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../state/auth';
import { Button } from '../../components/Button';
import { Pill } from '../../components/Pill';
import { TimezonePicker } from '../../components/TimezonePicker';
import { addAnotherFamily } from '../../services/families/addAnotherFamily';
import { useTheme } from '../../theme';
import { useAnnounceOnChange } from '../../hooks/useAnnounce';
import type { CaregiverScreenProps } from '../../navigation/types';

type ParentRelationship = 'mother' | 'father' | 'aunt' | 'uncle' | 'other';
type CaregiverRelationship = 'daughter' | 'son' | 'niece' | 'nephew' | 'other';

interface ParentChip {
  value: ParentRelationship;
  label: string;
}
interface CaregiverChip {
  value: CaregiverRelationship;
  label: string;
}

const PARENT_CHIPS: ParentChip[] = [
  { value: 'mother', label: 'Mum' },
  { value: 'father', label: 'Dad' },
  { value: 'aunt', label: 'Aunt' },
  { value: 'uncle', label: 'Uncle' },
  { value: 'other', label: 'Other' },
];

const CAREGIVER_CHIPS: CaregiverChip[] = [
  { value: 'daughter', label: 'Daughter' },
  { value: 'son', label: 'Son' },
  { value: 'niece', label: 'Niece' },
  { value: 'nephew', label: 'Nephew' },
  { value: 'other', label: 'Other' },
];

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function encodeParentRelationship(
  value: ParentRelationship,
  customLabel: string,
): string {
  if (value === 'other') {
    const trimmed = customLabel.trim();
    return trimmed.length > 0 ? `other:${trimmed}` : 'other';
  }
  return value;
}

export function AddPersonScreen({ navigation }: CaregiverScreenProps<'AddPerson'>) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.session?.user.id ?? null);

  const [parentName, setParentName] = useState('');
  const [parentRel, setParentRel] = useState<ParentRelationship | null>(null);
  const [parentRelCustom, setParentRelCustom] = useState('');
  const [caregiverRel, setCaregiverRel] = useState<CaregiverRelationship | null>(null);
  const [caregiverRelCustom, setCaregiverRelCustom] = useState('');
  const [tz, setTz] = useState(defaultTimezone());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audit P1-7 — accessibilityLiveRegion on the inline error below is
  // Android-only, so on iOS the error was never spoken. This is the iOS half.
  useAnnounceOnChange(error);

  const parentCustomRequired = parentRel === 'other';
  const parentCustomValid = !parentCustomRequired || parentRelCustom.trim().length > 0;
  const caregiverCustomRequired = caregiverRel === 'other';
  const caregiverCustomValid =
    !caregiverCustomRequired || caregiverRelCustom.trim().length > 0;
  const valid =
    parentName.trim().length > 0 &&
    parentRel !== null &&
    parentCustomValid &&
    caregiverRel !== null &&
    caregiverCustomValid &&
    tz.length > 0;

  const headline = theme.type('displayM');
  const body = theme.type('bodyL');
  const label = theme.type('label');

  const handleSubmit = async () => {
    if (!valid || !parentRel || !caregiverRel || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await addAnotherFamily({
        parentDisplayName: parentName,
        parentRelationship: encodeParentRelationship(parentRel, parentRelCustom),
        caregiverRelationship:
          caregiverRel === 'other'
            ? caregiverRelCustom.trim() || 'other'
            : caregiverRel,
      });
      // Invalidate the family-readings cache so CaregiverHome refetches
      // and the new orb appears. Scoped to the current user's key.
      await queryClient.invalidateQueries({ queryKey: ['family-readings', userId] });
      navigation.goBack();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We couldn't add them to your circle. Try again in a moment.",
      );
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.base }]}
      edges={['top', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingHorizontal: theme.spacing.xxl,
              paddingTop: theme.spacing.xxl,
              paddingBottom: theme.spacing.xxl,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={theme.spacing.m}
            style={{ alignSelf: 'flex-start', marginBottom: theme.spacing.xxl }}
            testID="add-person-back"
          >
            <Text
              style={{
                color: theme.colors.brand.primary,
                fontSize: body.size,
                fontFamily: body.family,
              }}
            >
              Back
            </Text>
          </Pressable>

          <Text
            accessibilityRole="header"
            style={{
              color: theme.colors.text.primary,
              fontSize: headline.size,
              lineHeight: headline.lineHeight,
              fontWeight: headline.weight as '700',
              fontFamily: headline.family,
              marginBottom: theme.spacing.s,
            }}
          >
            Who else are you looking after?
          </Text>

          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: body.size,
              lineHeight: body.lineHeight,
              fontFamily: body.family,
              marginBottom: theme.spacing.xxl,
            }}
          >
            We'll set up a new circle for them. You'll be able to pair their watch from Settings when you're ready.
          </Text>

          <Text
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
            value={parentName}
            onChangeText={setParentName}
            placeholder="Papa Tunde"
            placeholderTextColor={theme.colors.text.secondary}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="next"
            accessibilityLabel="The name you call them"
            testID="add-person-name"
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
            accessibilityLabel="Their relationship"
            style={styles.chipsRow}
          >
            {PARENT_CHIPS.map((chip) => (
              <View
                key={chip.value}
                style={{ marginRight: theme.spacing.s, marginBottom: theme.spacing.s }}
              >
                <Pill
                  selected={parentRel === chip.value}
                  onPress={() => setParentRel(chip.value)}
                  accessibilityLabel={chip.label}
                  testID={`add-person-parent-chip-${chip.value}`}
                >
                  {chip.label}
                </Pill>
              </View>
            ))}
          </View>

          {parentCustomRequired ? (
            <TextInput
              value={parentRelCustom}
              onChangeText={setParentRelCustom}
              placeholder="Aunt Tola, Godfather, …"
              placeholderTextColor={theme.colors.text.secondary}
              autoCapitalize="words"
              autoCorrect={false}
              accessibilityLabel="Custom relationship"
              testID="add-person-parent-custom"
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
                marginTop: theme.spacing.s,
                marginBottom: theme.spacing.l,
              }}
            />
          ) : (
            <View style={{ height: theme.spacing.l }} />
          )}

          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: label.size,
              fontWeight: label.weight as '500',
              fontFamily: label.family,
              marginBottom: theme.spacing.s,
            }}
          >
            And you are their…
          </Text>
          <View
            accessible
            accessibilityRole="radiogroup"
            accessibilityLabel="Your relationship to them"
            style={styles.chipsRow}
          >
            {CAREGIVER_CHIPS.map((chip) => (
              <View
                key={chip.value}
                style={{ marginRight: theme.spacing.s, marginBottom: theme.spacing.s }}
              >
                <Pill
                  selected={caregiverRel === chip.value}
                  onPress={() => setCaregiverRel(chip.value)}
                  accessibilityLabel={chip.label}
                  testID={`add-person-caregiver-chip-${chip.value}`}
                >
                  {chip.label}
                </Pill>
              </View>
            ))}
          </View>

          {caregiverCustomRequired ? (
            <TextInput
              value={caregiverRelCustom}
              onChangeText={setCaregiverRelCustom}
              placeholder="Friend, Sibling, Carer, …"
              placeholderTextColor={theme.colors.text.secondary}
              autoCapitalize="words"
              autoCorrect={false}
              accessibilityLabel="Custom caregiver relationship"
              testID="add-person-caregiver-custom"
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
                marginTop: theme.spacing.s,
                marginBottom: theme.spacing.l,
              }}
            />
          ) : (
            <View style={{ height: theme.spacing.l }} />
          )}

          <Text
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
            value={tz}
            onChange={setTz}
            fieldA11yPrefix="Their timezone"
            sheetTitle="Choose their timezone"
            testID="add-person-zone"
          />

          <View style={{ height: theme.spacing.xxxl }} />

          <Button
            variant="primary"
            onPress={() => {
              void handleSubmit();
            }}
            disabled={!valid || submitting}
            testID="add-person-submit"
            style={{ width: '100%' }}
          >
            {submitting ? 'Adding…' : 'Add to my circle'}
          </Button>

          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              testID="add-person-error"
              style={{
                color: theme.colors.state.urgent,
                fontSize: body.size,
                fontFamily: body.family,
                marginTop: theme.spacing.l,
                textAlign: 'center',
              }}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  scroll: { flexGrow: 1 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap' },
});
