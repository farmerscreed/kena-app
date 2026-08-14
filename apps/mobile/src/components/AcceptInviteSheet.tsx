// AcceptInviteSheet — Sprint 16.6 (Issue #1); Connect Phase A 2026-08-14.
//
// Reusable bottom-sheet form for redeeming a 6-digit connect code
// (connect-accept resolves who-follows-whom from watch ownership).
// Extracted from the original inline implementation in SettingsScreen
// so it can also serve the caregiver Home empty-state CTA and the
// FamilyWatch onboarding "Someone invited me" path.
//
// Phase A changes: the email field is gone (the accept-time email-match
// gate was dropped — codes are single-use, expiring, and rate-limited
// server-side), and the success copy now tells the truth per outcome:
// accepter_follows / sharer_follows / pending each say what actually
// happened instead of one join-message for all three.
//
// Three consumers, three slightly different flows:
//   · Settings → shows the in-sheet success state ("You're connected"); the
//     family auto-appears on Home via the realtime channel.
//   · CaregiverHome empty state → same success state, then the empty
//     state unmounts as soon as the family list refresh comes in.
//   · FamilyWatch onboarding → skips the in-sheet success state so the
//     caller can finalize onboarding atomically (familyId from invite
//     result + completeViaInvite).
// `showSuccessState` (default true) controls the in-sheet behaviour;
// `onSuccess` always fires with the resolved familyId so consumers
// can react regardless.
//
// State resets every time the sheet opens (visible: false → true) so a
// dismissed-but-not-completed previous attempt doesn't leak.

import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Pill } from './Pill';
import { acceptConnect } from '../services/families/manageInvites';
import { useTheme } from '../theme';

type RelationshipChip =
  | 'mother'
  | 'father'
  | 'aunt'
  | 'uncle'
  | 'daughter'
  | 'son'
  | 'niece'
  | 'nephew'
  | 'spouse'
  | 'friend'
  | 'other';

const RELATIONSHIP_CHIPS: Array<{ value: RelationshipChip; label: string }> = [
  { value: 'mother', label: 'Mum' },
  { value: 'father', label: 'Dad' },
  { value: 'aunt', label: 'Aunt' },
  { value: 'uncle', label: 'Uncle' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'friend', label: 'Friend' },
  { value: 'other', label: 'Other' },
];

function encodeRelationship(chip: RelationshipChip | null, custom: string): string | null {
  if (!chip) return null;
  if (chip === 'other') {
    const trimmed = custom.trim();
    return trimmed.length > 0 ? `other:${trimmed}` : 'other';
  }
  return chip;
}

export interface AcceptInviteSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** ADR-0006 — pre-fills the 6-digit code field. Used when the sheet is
   *  opened from a tapped invite link that carried the code. */
  initialCode?: string;
  /** Called after a successful invite acceptance with the resolved
   *  familyId. The consumer decides what happens next (close the
   *  sheet, navigate, finalize onboarding, etc.). */
  onSuccess?: (result: { familyId: string; outcome?: string }) => void;
  /** When true (default), the sheet swaps to a per-outcome confirmation
   *  state on success and waits for the user to tap Done. When false,
   *  the sheet closes immediately on success and fires onSuccess —
   *  better for onboarding flows that want to finalize atomically. */
  showSuccessState?: boolean;
  testID?: string;
}

const SHEET_TITLE_IDLE = 'Join a family circle';
const SHEET_TITLE_SUCCESS = "You're connected";

type ConnectOutcome = 'accepter_follows' | 'sharer_follows' | 'pending';

// Truthful per-outcome success copy — the server resolves direction, so
// the sheet must not claim "their readings will appear" when the actual
// result was the reverse (or still pending a watch).
const SUCCESS_COPY: Record<ConnectOutcome, string> = {
  accepter_follows:
    "You've joined the circle. Their readings will appear on your home screen.",
  sharer_follows:
    "You're connected. They can now follow your readings — you choose what they see in Settings.",
  pending:
    "You're connected. Readings will start sharing once one of you pairs a watch.",
};

export function AcceptInviteSheet({
  visible,
  onDismiss,
  initialCode = '',
  onSuccess,
  showSuccessState = true,
  testID = 'accept-invite-sheet',
}: AcceptInviteSheetProps) {
  const theme = useTheme();
  const bodyStyle = theme.type('bodyM');

  const [code, setCode] = useState(initialCode);
  const [relChip, setRelChip] = useState<RelationshipChip | null>(null);
  const [relCustom, setRelCustom] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [outcome, setOutcome] = useState<ConnectOutcome | null>(null);

  // Reset on open so a dismissed previous attempt doesn't leak.
  useEffect(() => {
    if (visible) {
      setCode(initialCode);
      setRelChip(null);
      setRelCustom('');
      setPending(false);
      setError(null);
      setSuccess(false);
      setOutcome(null);
    }
  }, [visible, initialCode]);

  const handleSubmit = async () => {
    setError(null);
    setPending(true);
    try {
      const labelEncoded = encodeRelationship(relChip, relCustom);
      // ADR-0007 — one unified accept. The backend resolves direction from
      // who wears a watch and returns the outcome.
      const result = await acceptConnect({
        code,
        ...(labelEncoded ? { caregiverRelationshipLabel: labelEncoded } : {}),
      });
      if (showSuccessState) {
        setSuccess(true);
        setOutcome(result.outcome);
      }
      // familyId is null only for the pending case (neither wears a watch
      // yet); consumers that need an id can ignore until it resolves.
      onSuccess?.({ familyId: result.familyId ?? '', outcome: result.outcome });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      setError(
        /invitation_not_found/i.test(msg)
          ? "We couldn't find that code. Double-check and try again."
          : /invitation_expired/i.test(msg)
            ? 'That code has expired. Ask for a new one.'
            : /invitation_already_accepted/i.test(msg)
              ? 'That code has already been used.'
              : /too_many_attempts/i.test(msg)
                ? 'Too many tries for now. Wait a little while, then try again.'
                : "We couldn't connect. Try again in a moment.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      size={success ? 'default' : 'tall'}
      surface="solid"
      title={success ? SHEET_TITLE_SUCCESS : SHEET_TITLE_IDLE}
      testID={testID}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.l,
          paddingBottom: theme.spacing.l,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {success ? (
          <>
            <Text
              style={{
                color: theme.colors.text.secondary,
                fontSize: bodyStyle.size,
                lineHeight: bodyStyle.lineHeight,
                fontFamily: bodyStyle.family,
                marginBottom: theme.spacing.m,
              }}
            >
              {SUCCESS_COPY[outcome ?? 'accepter_follows']}
            </Text>
            <Button
              variant="primary"
              onPress={onDismiss}
              accessibilityLabel="Done"
              testID={`${testID}-done`}
            >
              Done
            </Button>
          </>
        ) : (
          <>
            <Text
              style={{
                color: theme.colors.text.secondary,
                fontSize: bodyStyle.size,
                lineHeight: bodyStyle.lineHeight,
                fontFamily: bodyStyle.family,
                marginBottom: theme.spacing.m,
              }}
            >
              Type the 6-digit code they shared with you.
            </Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="6-digit code"
              placeholderTextColor={theme.colors.text.tertiary}
              keyboardType="number-pad"
              maxLength={6}
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border.subtle,
                borderRadius: theme.radii.m,
                paddingHorizontal: theme.spacing.m,
                paddingVertical: theme.spacing.s,
                color: theme.colors.text.primary,
                fontSize: bodyStyle.size,
                fontFamily: bodyStyle.family,
                marginBottom: theme.spacing.m,
                letterSpacing: 4,
              }}
              testID={`${testID}-code-input`}
            />
            {/* Sprint 19 Block 5 — optional per-caregiver
                relationship label for the wearer. Resolves the
                "TheOne · SELF" leakage at the root by letting the
                joining caregiver pick what THEY call the wearer.
                Optional — empty falls back to families.parent_relationship
                via formatRelation. Editable later from
                Settings → Family. */}
            <Text
              style={{
                color: theme.colors.text.secondary,
                fontSize: theme.type('label').size,
                fontFamily: theme.type('label').family,
                fontWeight: theme.type('label').weight as '500',
                marginBottom: theme.spacing.xs,
              }}
            >
              Who are they to you?  ·  optional
            </Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Your relationship to the wearer"
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                marginBottom: theme.spacing.m,
              }}
              testID={`${testID}-relationship-chips`}
            >
              {RELATIONSHIP_CHIPS.map((chip) => (
                <View
                  key={chip.value}
                  style={{ marginRight: theme.spacing.s, marginBottom: theme.spacing.s }}
                >
                  <Pill
                    selected={relChip === chip.value}
                    onPress={() => setRelChip(chip.value)}
                    accessibilityLabel={chip.label}
                    testID={`${testID}-rel-chip-${chip.value}`}
                  >
                    {chip.label}
                  </Pill>
                </View>
              ))}
            </View>
            {relChip === 'other' ? (
              <TextInput
                value={relCustom}
                onChangeText={setRelCustom}
                placeholder="Godfather, Sibling, Carer, …"
                placeholderTextColor={theme.colors.text.tertiary}
                autoCapitalize="words"
                autoCorrect={false}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border.subtle,
                  borderRadius: theme.radii.m,
                  paddingHorizontal: theme.spacing.m,
                  paddingVertical: theme.spacing.s,
                  color: theme.colors.text.primary,
                  fontSize: bodyStyle.size,
                  fontFamily: bodyStyle.family,
                  marginBottom: theme.spacing.m,
                }}
                testID={`${testID}-rel-custom-input`}
              />
            ) : null}
            {error ? (
              <Text
                style={{
                  color: theme.colors.text.secondary,
                  fontSize: theme.type('label').size,
                  fontFamily: theme.type('label').family,
                  marginBottom: theme.spacing.m,
                }}
                testID={`${testID}-error`}
              >
                {error}
              </Text>
            ) : null}
            <Button
              variant="primary"
              disabled={pending || code.length !== 6}
              loading={pending}
              onPress={handleSubmit}
              accessibilityLabel="Join family circle"
              testID={`${testID}-join`}
            >
              Join family circle
            </Button>
            <View style={{ marginTop: theme.spacing.s }}>
              <Button
                variant="ghost"
                onPress={onDismiss}
                accessibilityLabel="Cancel"
                testID={`${testID}-cancel`}
              >
                Cancel
              </Button>
            </View>
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
