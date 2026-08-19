// FamilyRemovalBanner — Sprint 17b.
//
// Calm informational banner shown when a family the user was a
// member of has disappeared from their family list (typically
// because the family_owner removed them). Backstop for the
// `family_removed` push, which can be suppressed by quiet hours,
// permissions, or a missing token.
//
// Voice rules (docs/05 + D11 §3): factual, not alarming. The user
// already lost access; the banner explains what happened, not why.
// "Have a new invite code?" is the soft re-join affordance.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export interface FamilyRemovalBannerProps {
  /** Human-readable label of the removed family (e.g. "Mum",
   *  "Biebele"). Falls back to "your family member" in the hook when no
   *  label was persisted. */
  label: string;
  /** User taps "Got it" — clears the banner. The hook also wipes the
   *  persisted entry so the same removal doesn't surface again. */
  onDismiss: () => void;
  /** Optional re-join affordance. Wired by the parent screen to open
   *  the AcceptInviteSheet so the user can enter a fresh invite code
   *  if they think the removal was a mistake. */
  onEnterInvite?: () => void;
  testID?: string;
}

export function FamilyRemovalBanner({
  label,
  onDismiss,
  onEnterInvite,
  testID,
}: FamilyRemovalBannerProps) {
  const theme = useTheme();
  const bodyStyle = theme.type('bodyM');
  const labelStyle = theme.type('label');

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.surface.elevated,
          borderColor: theme.colors.border.subtle,
          padding: theme.spacing.l,
          borderRadius: theme.radii.m,
          marginHorizontal: theme.spacing.l,
          marginTop: theme.spacing.m,
        },
      ]}
      testID={testID}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
    >
      <Text
        style={{
          fontFamily: bodyStyle.family,
          fontSize: bodyStyle.size,
          lineHeight: bodyStyle.lineHeight,
          color: theme.colors.text.primary,
          marginBottom: theme.spacing.s,
        }}
        testID={testID ? `${testID}-label` : undefined}
      >
        You&apos;re no longer in {label}
        {'’'}s circle.
      </Text>
      <Text
        style={{
          fontFamily: bodyStyle.family,
          fontSize: bodyStyle.size,
          lineHeight: bodyStyle.lineHeight,
          color: theme.colors.text.secondary,
          marginBottom: theme.spacing.m,
        }}
      >
        They can invite you back any time.
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.l }}>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Got it"
          hitSlop={8}
          testID={testID ? `${testID}-dismiss` : undefined}
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
        >
          <Text
            style={{
              fontFamily: labelStyle.family,
              fontSize: labelStyle.size,
              color: theme.colors.brand.coral,
            }}
          >
            Got it
          </Text>
        </Pressable>
        {onEnterInvite ? (
          <Pressable
            onPress={onEnterInvite}
            accessibilityRole="button"
            accessibilityLabel="I have a new invite code"
            hitSlop={8}
            testID={testID ? `${testID}-enter-invite` : undefined}
            style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
          >
            <Text
              style={{
                fontFamily: labelStyle.family,
                fontSize: labelStyle.size,
                color: theme.colors.text.secondary,
              }}
            >
              I have a new invite code
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderWidth: 0.5 },
});
