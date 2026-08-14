// FamilyMembersScreen — Sprint 10c.2 polish + Sprint 17b extension.
//
// Read + manage view for every member of the user's family circle.
// Reached from Settings → Family → "Family members". Sprint 17b
// added the action sheet for membership removal (owner) and leaving
// (self), plus a link to the CaregiverVisibility screen for owners
// who want to manage per-caregiver sharing.
//
// Per D8 §4.11 + D8a §10.2. Server-side gating lives in the
// `manage-family-membership` Edge Function (sprint 17b).
//
// Role × Target matrix for the tap dispatcher:
//
//   Viewer        Target              Action
//   ─────         ──────              ──────
//   family_owner  family_owner(self)  No sheet — "(you, family owner)"
//   family_owner  caregiver           "Remove from circle" confirm
//   caregiver     family_owner        No sheet — informational
//   caregiver     self                "Leave this circle" confirm
//   caregiver     other caregiver     No sheet — informational

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ListRow } from '../../components/ListRow';
import { SettingsSection } from '../../components/SettingsSection';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import {
  listFamilyMembers,
  type FamilyMember,
} from '../../services/families/listMembers';
import {
  removeMember as removeMemberService,
  leaveFamily as leaveFamilyService,
} from '../../services/families/manageMembers';
import { useFamilyReadings } from '../../hooks/useFamilyReadings';
import { useAuth } from '../../state/auth';
import { useTheme } from '../../theme';
import type { CaregiverScreenProps } from '../../navigation/types';
import type { FamilyRole } from '../../types/database';

const ROLE_LABEL: Record<FamilyRole, string> = {
  family_owner: 'Family owner',
  parent_owner: 'Wearer',
  caregiver: 'Caregiver',
  parent_viewer: 'Family',
};

function formatJoined(iso: string): string {
  // Sprint 16.5i — device-locale-aware (was hardcoded 'en-US').
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  });
}

type Props =
  | CaregiverScreenProps<'FamilyMembers'>
  | { navigation: { goBack: () => void; navigate: (route: string) => void } };

type SheetMode =
  | { kind: 'idle' }
  | { kind: 'remove'; target: FamilyMember }
  | { kind: 'leave'; ownerName: string };

export function FamilyMembersScreen({ navigation }: Props) {
  const theme = useTheme();
  const { parents } = useFamilyReadings();
  const familyId = parents[0]?.familyId ?? null;
  const myUserId = useAuth((s) => s.session?.user.id ?? null);

  const [members, setMembers] = useState<FamilyMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetMode>({ kind: 'idle' });
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!familyId) {
      setMembers([]);
      return;
    }
    setError(null);
    try {
      const list = await listFamilyMembers(familyId);
      setMembers(list);
    } catch {
      setError("We couldn't load your family list. Pull down to retry.");
    }
  }, [familyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Derived: viewer's role + the family_owner row.
  const viewerRole: FamilyRole | null = useMemo(() => {
    if (!members || !myUserId) return null;
    return members.find((m) => m.userId === myUserId)?.role ?? null;
  }, [members, myUserId]);

  const owner = useMemo(
    () => members?.find((m) => m.role === 'family_owner') ?? null,
    [members],
  );

  const onRowPress = useCallback(
    (member: FamilyMember) => {
      if (!myUserId || !viewerRole) return;
      const isSelf = member.userId === myUserId;

      // Owner viewer:
      if (viewerRole === 'family_owner') {
        if (isSelf) return; // owner's own row → no sheet
        if (member.role === 'family_owner') return; // shouldn't happen but defensive
        setActionError(null);
        setSheet({ kind: 'remove', target: member });
        return;
      }

      // Caregiver viewer:
      if (viewerRole === 'caregiver') {
        if (isSelf) {
          setActionError(null);
          setSheet({
            kind: 'leave',
            ownerName: owner?.displayName ?? 'the family',
          });
          return;
        }
        // Other rows are informational only.
      }
    },
    [myUserId, viewerRole, owner],
  );

  const dismissSheet = useCallback(() => {
    if (actionPending) return;
    setSheet({ kind: 'idle' });
    setActionError(null);
  }, [actionPending]);

  const confirmRemove = useCallback(async () => {
    if (sheet.kind !== 'remove' || !familyId) return;
    setActionPending(true);
    setActionError(null);
    try {
      await removeMemberService({
        familyId,
        targetUserId: sheet.target.userId,
      });
      setSheet({ kind: 'idle' });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      setActionError(
        /only_owner_can_remove/i.test(msg)
          ? "You don't have permission to do that."
          : /target_not_active_member/i.test(msg)
            ? 'That person is already out of the circle.'
            : "We couldn't remove them. Try again in a moment.",
      );
    } finally {
      setActionPending(false);
    }
  }, [sheet, familyId, refresh]);

  const confirmLeave = useCallback(async () => {
    if (sheet.kind !== 'leave' || !familyId) return;
    setActionPending(true);
    setActionError(null);
    try {
      await leaveFamilyService({ familyId });
      setSheet({ kind: 'idle' });
      // The current screen no longer makes sense — pop back so the
      // caregiver lands on their home, which will refetch and show
      // the empty state.
      navigation.goBack();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      setActionError(
        /owner_cannot_leave/i.test(msg)
          ? 'Family owners can’t leave their own circle.'
          : "We couldn't leave the circle. Try again in a moment.",
      );
    } finally {
      setActionPending(false);
    }
  }, [sheet, familyId, navigation]);

  const headlineStyle = theme.type('displayM');
  const bodyStyle = theme.type('bodyL');

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.warmBase }]}
      edges={['top', 'bottom']}
      testID="family-members-screen"
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.m }}>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={theme.spacing.m}
            testID="family-members-back"
            style={{ alignSelf: 'flex-start', marginBottom: theme.spacing.xxl }}
          >
            <Text
              style={{
                color: theme.colors.brand.primary,
                fontSize: bodyStyle.size,
                fontFamily: bodyStyle.family,
                fontWeight: '500',
              }}
            >
              Back
            </Text>
          </Pressable>
          <Text
            accessibilityRole="header"
            style={{
              color: theme.colors.text.primary,
              fontSize: headlineStyle.size,
              lineHeight: headlineStyle.lineHeight,
              fontWeight: headlineStyle.weight as '700',
              fontFamily: headlineStyle.family,
              letterSpacing: -0.6,
              marginBottom: theme.spacing.s,
            }}
          >
            Family members
          </Text>
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: bodyStyle.size,
              fontFamily: bodyStyle.family,
              marginBottom: theme.spacing.l,
            }}
          >
            Everyone in your circle.
          </Text>
        </View>

        {error ? (
          <View style={{ paddingHorizontal: theme.spacing.l }}>
            <Text
              style={{
                color: theme.colors.text.secondary,
                fontSize: bodyStyle.size,
                fontFamily: bodyStyle.family,
                textAlign: 'center',
                paddingVertical: theme.spacing.l,
              }}
              testID="family-members-error"
            >
              {error}
            </Text>
          </View>
        ) : members === null ? (
          <Text
            style={{
              color: theme.colors.text.tertiary,
              fontSize: bodyStyle.size,
              fontFamily: bodyStyle.family,
              textAlign: 'center',
              padding: theme.spacing.l,
            }}
            testID="family-members-loading"
          >
            Loading…
          </Text>
        ) : members.length === 0 ? (
          <Text
            style={{
              color: theme.colors.text.tertiary,
              fontSize: bodyStyle.size,
              fontFamily: bodyStyle.family,
              textAlign: 'center',
              padding: theme.spacing.l,
            }}
            testID="family-members-empty"
          >
            No one here yet. Connect with someone from Settings → Connect.
          </Text>
        ) : (
          <>
            <SettingsSection title="Members" first testID="family-members-section">
              {members.map((member, idx) => {
                const isYou = member.userId === myUserId;
                const subtitle = `${ROLE_LABEL[member.role]} · joined ${formatJoined(member.joinedAt)}`;
                const tappable = isRowTappable(viewerRole, member.role, isYou);
                const titleSuffix = isYou
                  ? member.role === 'family_owner'
                    ? ' (you, family owner)'
                    : ' (you)'
                  : '';
                return (
                  <ListRow
                    key={member.userId}
                    variant={tappable ? 'navigation' : 'data'}
                    title={`${member.displayName}${titleSuffix}`}
                    subtitle={subtitle}
                    showDivider={idx !== members.length - 1}
                    onPress={tappable ? () => onRowPress(member) : undefined}
                    testID={`family-member-${member.userId}`}
                  />
                );
              })}
            </SettingsSection>

            {viewerRole === 'family_owner' ? (
              <SettingsSection title="Sharing" testID="family-members-sharing-section">
                <ListRow
                  variant="navigation"
                  title="Manage what each caregiver sees"
                  subtitle="Toggle BP, heart rate, oxygen, sleep, activity."
                  showDivider={false}
                  onPress={() => navigation.navigate('CaregiverVisibility')}
                  testID="family-members-link-visibility"
                />
              </SettingsSection>
            ) : null}
          </>
        )}
      </ScrollView>

      <BottomSheet
        visible={sheet.kind === 'remove'}
        onDismiss={dismissSheet}
        size="default"
        surface="solid"
        title={
          sheet.kind === 'remove'
            ? `Remove ${sheet.target.displayName}?`
            : ''
        }
        testID="family-members-remove-sheet"
      >
        <RemoveConfirmBody
          targetName={
            sheet.kind === 'remove' ? sheet.target.displayName : ''
          }
          actionError={actionError}
          actionPending={actionPending}
          onConfirm={confirmRemove}
          onCancel={dismissSheet}
        />
      </BottomSheet>

      <BottomSheet
        visible={sheet.kind === 'leave'}
        onDismiss={dismissSheet}
        size="default"
        surface="solid"
        title={
          sheet.kind === 'leave'
            ? `Leave ${sheet.ownerName}’s circle?`
            : ''
        }
        testID="family-members-leave-sheet"
      >
        <LeaveConfirmBody
          ownerName={sheet.kind === 'leave' ? sheet.ownerName : ''}
          actionError={actionError}
          actionPending={actionPending}
          onConfirm={confirmLeave}
          onCancel={dismissSheet}
        />
      </BottomSheet>
    </SafeAreaView>
  );
}

function isRowTappable(
  viewerRole: FamilyRole | null,
  targetRole: FamilyRole,
  isSelf: boolean,
): boolean {
  if (!viewerRole) return false;
  if (viewerRole === 'family_owner') {
    if (isSelf) return false; // owner's own row
    return targetRole !== 'family_owner';
  }
  if (viewerRole === 'caregiver') {
    return isSelf;
  }
  return false;
}

// ─── Sheet bodies ──────────────────────────────────────────────

interface RemoveConfirmBodyProps {
  targetName: string;
  actionError: string | null;
  actionPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function RemoveConfirmBody({
  targetName,
  actionError,
  actionPending,
  onConfirm,
  onCancel,
}: RemoveConfirmBodyProps) {
  const theme = useTheme();
  const bodyStyle = theme.type('bodyM');
  const labelStyle = theme.type('label');
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.l,
        paddingBottom: theme.spacing.l,
      }}
    >
      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: bodyStyle.size,
          lineHeight: bodyStyle.lineHeight,
          fontFamily: bodyStyle.family,
          marginBottom: theme.spacing.m,
        }}
      >
        {targetName
          ? `${targetName} won’t see your readings anymore. You can invite them back any time.`
          : ''}
      </Text>
      {actionError ? (
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: labelStyle.size,
            fontFamily: labelStyle.family,
            marginBottom: theme.spacing.m,
          }}
          testID="family-members-remove-sheet-error"
        >
          {actionError}
        </Text>
      ) : null}
      <Button
        variant="destructive"
        loading={actionPending}
        disabled={actionPending}
        onPress={onConfirm}
        accessibilityLabel={`Remove ${targetName}`}
        testID="family-members-remove-sheet-confirm"
      >
        Remove
      </Button>
      <View style={{ marginTop: theme.spacing.s }}>
        <Button
          variant="ghost"
          onPress={onCancel}
          accessibilityLabel="Cancel"
          testID="family-members-remove-sheet-cancel"
        >
          Cancel
        </Button>
      </View>
    </View>
  );
}

interface LeaveConfirmBodyProps {
  ownerName: string;
  actionError: string | null;
  actionPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function LeaveConfirmBody({
  ownerName,
  actionError,
  actionPending,
  onConfirm,
  onCancel,
}: LeaveConfirmBodyProps) {
  const theme = useTheme();
  const bodyStyle = theme.type('bodyM');
  const labelStyle = theme.type('label');
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.l,
        paddingBottom: theme.spacing.l,
      }}
    >
      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: bodyStyle.size,
          lineHeight: bodyStyle.lineHeight,
          fontFamily: bodyStyle.family,
          marginBottom: theme.spacing.m,
        }}
      >
        You won&apos;t see {ownerName}
        {'’'}s readings anymore. They can invite you back any time.
      </Text>
      {actionError ? (
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: labelStyle.size,
            fontFamily: labelStyle.family,
            marginBottom: theme.spacing.m,
          }}
          testID="family-members-leave-sheet-error"
        >
          {actionError}
        </Text>
      ) : null}
      <Button
        variant="destructive"
        loading={actionPending}
        disabled={actionPending}
        onPress={onConfirm}
        accessibilityLabel="Leave this circle"
        testID="family-members-leave-sheet-confirm"
      >
        Leave
      </Button>
      <View style={{ marginTop: theme.spacing.s }}>
        <Button
          variant="ghost"
          onPress={onCancel}
          accessibilityLabel="Cancel"
          testID="family-members-leave-sheet-cancel"
        >
          Cancel
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: 32 },
});
