// CaregiverVisibilityScreen — Sprint 10c.2.
//
// Hybrid-mode privacy surface per D13 §13.2 + D8a §10.4. The wearer
// (self-buyer / parent_owner) lists every caregiver in their family
// circle and toggles which vitals each one can see. BP is always
// visible — the toggle is rendered but disabled.
//
// Sleep is hidden by default. The screen does NOT mask the toggle's
// initial state — it shows the actual default (off) so the user
// understands the privacy posture before changing it.
//
// Voice rules: every authored string passes docs/05. Empty state +
// loading state are calm, not breathless.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ListRow } from '../../components/ListRow';
import { SettingsSection } from '../../components/SettingsSection';
import {
  listCaregivers,
  setCaregiverVisibility,
  type CaregiverWithVisibility,
} from '../../services/families/visibility';
import { useFamilyReadings } from '../../hooks/useFamilyReadings';
import { useTheme } from '../../theme';
import type { VitalVisibility } from '../../types/database';
import type { CaregiverScreenProps } from '../../navigation/types';

const VITAL_ROWS: Array<{ key: keyof VitalVisibility; title: string; subtitle?: string }> = [
  { key: 'bp', title: 'Blood pressure', subtitle: 'Always visible.' },
  { key: 'hr', title: 'Heart rate' },
  { key: 'spo2', title: 'Oxygen' },
  {
    key: 'sleep',
    title: 'Sleep',
    subtitle: 'Off by default. Sharing sleep is optional.',
  },
  { key: 'activity', title: 'Activity' },
];

type Props =
  | CaregiverScreenProps<'CaregiverVisibility'>
  | { navigation: { goBack: () => void } };

export function CaregiverVisibilityScreen({ navigation }: Props) {
  const theme = useTheme();
  const { parents } = useFamilyReadings();
  const familyId = parents[0]?.familyId ?? null;

  const [caregivers, setCaregivers] = useState<CaregiverWithVisibility[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!familyId) {
      setCaregivers([]);
      return;
    }
    setError(null);
    try {
      const list = await listCaregivers(familyId);
      setCaregivers(list);
    } catch {
      setError("We couldn't load your caregiver list. Pull down to retry.");
    }
  }, [familyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onToggle = useCallback(
    async (caregiverUserId: string, key: keyof VitalVisibility, value: boolean) => {
      if (!familyId || !caregivers) return;
      // BP is always-on. The UI disables the toggle but if a tap somehow
      // races through we still no-op.
      if (key === 'bp') return;

      // Optimistic update.
      const prev = caregivers;
      const next = caregivers.map((c) =>
        c.userId === caregiverUserId
          ? { ...c, visibility: { ...c.visibility, [key]: value } }
          : c,
      );
      setCaregivers(next);
      try {
        const target = next.find((c) => c.userId === caregiverUserId);
        if (!target) return;
        await setCaregiverVisibility(familyId, caregiverUserId, target.visibility);
      } catch {
        // Roll back on failure; surface a quiet error.
        setCaregivers(prev);
        setError("We couldn't save that change. Try again in a moment.");
      }
    },
    [caregivers, familyId],
  );

  const headlineStyle = theme.type('displayM');
  const bodyStyle = theme.type('bodyL');

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.warmBase }]}
      edges={['top', 'bottom']}
      testID="caregiver-visibility-screen"
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={{ paddingHorizontal: theme.spacing.l, paddingTop: theme.spacing.l }}>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={theme.spacing.m}
            testID="caregiver-visibility-back"
            style={{ alignSelf: 'flex-start', marginBottom: theme.spacing.l }}
          >
            <Text
              style={{
                color: theme.colors.brand.primary,
                fontSize: bodyStyle.size,
                fontFamily: bodyStyle.family,
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
              marginBottom: theme.spacing.s,
            }}
          >
            Who sees my readings
          </Text>
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: bodyStyle.size,
              fontFamily: bodyStyle.family,
              marginBottom: theme.spacing.l,
            }}
          >
            Choose what each caregiver can see. Blood pressure is always shared.
          </Text>
        </View>

        {/* Sprint 17b — collapse error + loading into a single
            conditional chain so a thrown error doesn't render
            "Loading…" *and* the error message simultaneously
            (previously the two blocks were independent and both
            could be visible at once). */}
        {error ? (
          <View
            style={{
              paddingHorizontal: theme.spacing.l,
              marginBottom: theme.spacing.l,
            }}
          >
            <Text
              style={{
                color: theme.colors.text.secondary,
                fontSize: bodyStyle.size,
                fontFamily: bodyStyle.family,
              }}
              testID="caregiver-visibility-error"
            >
              {error}
            </Text>
          </View>
        ) : caregivers === null ? (
          <Text
            style={{
              color: theme.colors.text.tertiary,
              fontSize: bodyStyle.size,
              fontFamily: bodyStyle.family,
              textAlign: 'center',
              padding: theme.spacing.l,
            }}
            testID="caregiver-visibility-loading"
          >
            Loading…
          </Text>
        ) : caregivers.length === 0 ? (
          <Text
            style={{
              color: theme.colors.text.tertiary,
              fontSize: bodyStyle.size,
              fontFamily: bodyStyle.family,
              textAlign: 'center',
              padding: theme.spacing.l,
            }}
            testID="caregiver-visibility-empty"
          >
            No one follows your readings yet. Share a code from Settings →
            Connect with someone.
          </Text>
        ) : (
          caregivers.map((caregiver) => (
            <SettingsSection
              key={caregiver.userId}
              title={caregiver.displayName}
              testID={`caregiver-visibility-section-${caregiver.userId}`}
            >
              {VITAL_ROWS.map((row, idx) => (
                <ListRow
                  key={row.key}
                  variant="toggle"
                  title={row.title}
                  subtitle={row.subtitle}
                  switchValue={caregiver.visibility[row.key]}
                  onSwitchChange={(v) => void onToggle(caregiver.userId, row.key, v)}
                  disabled={row.key === 'bp'}
                  showDivider={idx !== VITAL_ROWS.length - 1}
                  testID={`caregiver-visibility-${caregiver.userId}-${row.key}`}
                />
              ))}
            </SettingsSection>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: 32 },
});
