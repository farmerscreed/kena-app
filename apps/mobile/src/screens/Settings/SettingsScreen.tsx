// SettingsScreen — Sprint 10b.1 + 10b.2.
//
// Sourced from docs/04-screens/settings.md (D8 §4.11 + D8a §10) — the
// new Settings hub. Sprint 10b.1 landed the foundation + Profile +
// Watch + About + Sign-out. Sprint 10b.2 adds Vital streams + Goals +
// Apple Health / Health Connect + AI. Notifications + Privacy land
// in 10b.3.
//
// Voice rules (docs/05-voice-and-claims.md): every authored string is
// sentence-case, plain, never urgent. "Talk to your doctor" not
// "consult a healthcare provider", etc.
//
// Anti-pattern guards (CLAUDE.md):
//   • Cancellation is dignified — Forget watch sheet has no "are you
//     sure" guilt. Sign-out has the same posture.
//   • Hypertension chip is opt-in — three states including "Prefer not
//     to say"; default null leaves the field unset.

import { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { ListRow } from '../../components/ListRow';
import { PaywallSheet } from '../../components/PaywallSheet';
import { SettingsSection } from '../../components/SettingsSection';
import { updateProfile } from '../../services/users/updateProfile';
import {
  deleteAccount,
  exportFamilyData,
} from '../../services/users/accountActions';
import { AcceptInviteSheet } from '../../components/AcceptInviteSheet';
import { ConnectShareSheet } from '../../components/ConnectShareSheet';
import { EditFamilyDetailsSheet } from '../../components/EditFamilyDetailsSheet';
import { listCaregivers } from '../../services/families/visibility';
import { useFamilyReadings } from '../../hooks/useFamilyReadings';
import { isSelfCircle } from '../../utils/constellationNodes';
import { useAuth } from '../../state/auth';
import { useNotifications } from '../../state/notifications';
import { usePairing } from '../../state/pairing';
import {
  SLEEP_TARGET_MAX,
  SLEEP_TARGET_MIN,
  SLEEP_TARGET_STEP,
  STEPS_TARGET_MAX,
  STEPS_TARGET_MIN,
  STEPS_TARGET_STEP,
  useVitalSetup,
} from '../../state/vitalSetup';
import { useHealthPlatformToggles } from '../../services/health-platform/toggles';
import {
  ALL_READ_KINDS,
  ALL_WRITE_KINDS,
  type ReadVitalKind,
  type WriteVitalKind,
} from '../../services/health-platform/types';
import {
  getQuotaSnapshot,
  reconcileFromAuditLog,
} from '../../services/ai/quotaCounter';
import { usePlusEntitlement } from '../../hooks/usePlusEntitlement';
import { useBatteryOptimizationStatus } from '../../hooks/useBatteryOptimizationStatus';
import {
  getLastSyncSec,
  watchTimestampToUtcSec,
} from '../../services/sync/syncBacklog';
import { useTheme } from '../../theme';
import type { CaregiverScreenProps } from '../../navigation/types';
import type { Gender, HypertensionStatus, UserRow, UserUpdate } from '../../types/database';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig: { expo?: { version?: string } } = require('../../../app.json');

type ProfileField = 'yob' | 'gender' | 'height' | 'weight' | 'timezone';

// Sprint 19 Block 7 — read version from app.json at bundle time.
// Pre-Sprint-19 this was a hardcoded '0.0.0' that diverged from the
// real version. expo-application / expo-constants aren't in the
// dependency set, so the cheap path is a static JSON import; the
// bundler inlines the literal. The native versionCode is driven by the
// LEIKO_VERSION_CODE env var at build time (build.gradle), independent
// of this string; the user-facing versionName lives in
// app.json:expo.version and matches what ships in the APK.
const APP_VERSION = appConfig.expo?.version ?? '0.0.0';

const HYPERTENSION_LABEL: Record<HypertensionStatus, string> = {
  yes: 'Yes',
  no: 'No',
  prefer_not_say: 'Prefer not to say',
};

const GENDER_LABEL: Record<Gender, string> = {
  female: 'Female',
  male: 'Male',
  nonbinary: 'Non-binary',
  prefer_not_say: 'Prefer not to say',
};

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OF_BIRTH_MIN = 1900;
const YEAR_OF_BIRTH_MAX = CURRENT_YEAR;
const HEIGHT_CM_MIN = 50;
const HEIGHT_CM_MAX = 250;
const WEIGHT_KG_MIN = 20;
const WEIGHT_KG_MAX = 300;

const WRITE_VITAL_LABEL: Record<WriteVitalKind, string> = {
  bp: 'Blood pressure',
  hr: 'Heart rate',
  spo2: 'Oxygen',
  sleep: 'Sleep',
  steps: 'Steps',
  calories: 'Calories',
};

const READ_VITAL_LABEL: Record<ReadVitalKind, string> = {
  weight: 'Weight',
  height: 'Height',
  blood_glucose: 'Blood glucose',
};

function formatSleepTarget(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatStepsTarget(value: number): string {
  // Sprint 16.5i — device-locale-aware (was hardcoded 'en-US'). Steps
  // are a count; Nigerian + US locales both render this with
  // thousands separators, just different glyphs.
  return `${value.toLocaleString()} steps`;
}

function buildStepsOptions(): number[] {
  const out: number[] = [];
  for (let v = STEPS_TARGET_MIN; v <= STEPS_TARGET_MAX; v += STEPS_TARGET_STEP) {
    out.push(v);
  }
  return out;
}

function buildSleepOptions(): number[] {
  const out: number[] = [];
  for (let v = SLEEP_TARGET_MIN; v <= SLEEP_TARGET_MAX; v += SLEEP_TARGET_STEP) {
    out.push(v);
  }
  return out;
}

const STEPS_OPTIONS = buildStepsOptions();
const SLEEP_OPTIONS = buildSleepOptions();

type Props =
  | CaregiverScreenProps<'Settings'>
  | { navigation: { goBack: () => void; navigate: (route: string) => void } };

// Quiet-hours preset windows. Each is the (start, end) pair that the
// routing layer (Sprint 15) will compare against the recipient's
// local clock. Custom intervals deferred until a date-picker library
// is added; presets cover the common windows.
const QUIET_HOURS_PRESETS: Array<{ label: string; start: string; end: string }> = [
  { label: '10:00 PM to 7:00 AM', start: '22:00', end: '07:00' },
  { label: '10:00 PM to 8:00 AM', start: '22:00', end: '08:00' },
  { label: '11:00 PM to 6:00 AM', start: '23:00', end: '06:00' },
  { label: '9:00 PM to 7:00 AM', start: '21:00', end: '07:00' },
  { label: 'Midnight to 8:00 AM', start: '00:00', end: '08:00' },
];

function formatQuietHours(start: string, end: string): string {
  // Friendly label using "AM/PM" — only used in Settings; routing
  // logic operates on the raw HH:MM strings.
  const friendly = (hhmm: string): string => {
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
  };
  return `${friendly(start)} to ${friendly(end)}`;
}

type NavParamList = {
  AuditLog: undefined;
  CaregiverVisibility: undefined;
  FamilyMembers: undefined;
  ForYourDoctor: { range?: '7d' | '30d' | '90d' | '1y' | 'all_time' } | undefined;
  Pairing: undefined;
  Settings: undefined;
  AccountSwitch: undefined;
};

export function SettingsScreen({ navigation }: Props) {
  const theme = useTheme();
  const stackNavigation = useNavigation<NativeStackNavigationProp<NavParamList>>();
  const profile = useAuth((s) => s.profile);
  const userId = useAuth((s) => s.session?.user.id ?? null);
  const refreshProfile = useAuth((s) => s.refreshProfile);
  const signOut = useAuth((s) => s.signOut);
  const pairedDevice = usePairing((s) => s.pairedDevice);
  const forget = usePairing((s) => s.forget);

  // Sprint 18 bench bug — defensive backstop. Onboarding completion
  // paths in state/onboarding.ts now refresh profile after the DB
  // update, but if any future code path forgets, this still rehydrates
  // the auth-store profile from public.users every time Settings
  // mounts. Cheap, idempotent, prevents the "I filled in my name in
  // onboarding but Settings shows nothing" trap from ever recurring.
  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  // Notifications.
  const notif = useNotifications();
  const flushNotifs = useNotifications((s) => s.flushToSupabase);
  useEffect(() => {
    if (userId) {
      void flushNotifs(userId);
    }
  }, [userId, flushNotifs, notif.dailySummary, notif.weeklySummary, notif.anomalyNotifications,
      notif.anomalyBp, notif.anomalyHr, notif.anomalySpo2,
      notif.watchStatus, notif.familyActivity, notif.subscriptionAccount, notif.marketing,
      notif.quietHoursEnabled, notif.quietHoursStart, notif.quietHoursEnd,
      notif.anomalyBypassQuiet]);

  const [quietHoursSheetOpen, setQuietHoursSheetOpen] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [exportPaywallOpen, setExportPaywallOpen] = useState(false);

  // Connect Phase B — sharing a code lives in the shared zero-input
  // ConnectShareSheet; the only state left here is its visibility.
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);

  // Sprint 16.6 — accept-invite UI lives in the shared AcceptInviteSheet
  // component now. Only `acceptSheetOpen` + `acceptSuccess` remain here:
  // acceptSheetOpen drives mounting; acceptSuccess triggers the
  // post-accept family-list refresh effect at line 317.
  const [acceptSheetOpen, setAcceptSheetOpen] = useState(false);
  const [acceptSuccess, setAcceptSuccess] = useState(false);
  // ADR-0006 — a tapped invite link deep-links to Settings with the code
  // prefilled; this seeds the accept sheet. Phase A: the email gate is
  // gone, so only the code matters here.
  const [acceptPrefillCode, setAcceptPrefillCode] = useState('');
  const route = useRoute();
  useEffect(() => {
    const params = route.params as { inviteCode?: string } | undefined;
    if (params?.inviteCode) {
      setAcceptPrefillCode(params.inviteCode);
      setAcceptSuccess(false);
      setAcceptSheetOpen(true);
    }
  }, [route.params]);

  // Vital setup (auto-HR / auto-SpO2 / goals).
  const autoHrEnabled = useVitalSetup((s) => s.autoHrEnabled);
  const autoSpo2Enabled = useVitalSetup((s) => s.autoSpo2Enabled);
  const stepsTarget = useVitalSetup((s) => s.stepsTarget);
  const sleepTargetMin = useVitalSetup((s) => s.sleepTargetMin);
  const setAutoHr = useVitalSetup((s) => s.setAutoHr);
  const setAutoSpo2 = useVitalSetup((s) => s.setAutoSpo2);
  const setStepsTarget = useVitalSetup((s) => s.setStepsTarget);
  const setSleepTargetMin = useVitalSetup((s) => s.setSleepTargetMin);

  // Health Platform toggles.
  const hpMaster = useHealthPlatformToggles((s) => s.master);
  const hpWrite = useHealthPlatformToggles((s) => s.perVitalWrite);
  const hpRead = useHealthPlatformToggles((s) => s.perVitalRead);
  const setHpMaster = useHealthPlatformToggles((s) => s.setMaster);
  const setHpWrite = useHealthPlatformToggles((s) => s.setWriteVital);
  const setHpRead = useHealthPlatformToggles((s) => s.setReadVital);

  // AI quota — read snapshot synchronously from MMKV cache; reconcile
  // against audit_log on mount so the surface is fresh.
  const { tier } = usePlusEntitlement();
  const [quota, setQuota] = useState(() =>
    userId ? getQuotaSnapshot(userId, tier) : null,
  );
  useEffect(() => {
    if (!userId) {
      setQuota(null);
      return;
    }
    setQuota(getQuotaSnapshot(userId, tier));
    // Best-effort reconcile — failures leave the cached value in place.
    void reconcileFromAuditLog(userId).then(() => {
      setQuota(getQuotaSnapshot(userId, tier));
    }).catch(() => undefined);
  }, [userId, tier]);

  const [confirmingForget, setConfirmingForget] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [hypertensionSheetOpen, setHypertensionSheetOpen] = useState(false);
  const [editingField, setEditingField] = useState<ProfileField | null>(null);
  const [hypertensionWriting, setHypertensionWriting] = useState(false);
  const [picker, setPicker] = useState<'steps' | 'sleep' | null>(null);

  const isSelfBuyer = profile?.account_type === 'self_buyer';
  // Caregivers do not write OR read external vitals (D13 §12.5 + §12.6).
  // The Apple Health / Health Connect section is therefore self-buyer
  // only. Parent (own phone) reuses the same surface; self-buyer is the
  // primary case in this codebase.
  const showHealthPlatform = profile?.account_type !== 'caregiver';

  // Hybrid-mode caregiver visibility row gate (D13 §13.2). Self-buyer
  // only; only shown when at least one caregiver is in the family
  // circle. Re-fetches when an invite is accepted so the row appears
  // without requiring a Settings remount.
  const { parents } = useFamilyReadings();
  const familyId = parents[0]?.familyId ?? null;

  // Sprint 19 Block 3 — owner-only edit affordance. Pick the FIRST
  // family the viewer is family_owner of as the edit target. Single-
  // family users (the common case) just edit "their" family; multi-
  // family caregivers edit the first row (sorted by latest-reading);
  // per-family edit affordances on individual orbs land in a future
  // sprint when the per-orb context menu does.
  const ownedFamily = parents.find((p) => p.viewerRole === 'family_owner') ?? null;
  // ADR-0006 Phase 4 — split circles by the single question that drives
  // the whole unified model: am I the WEARER of this circle, or a
  // FOLLOWER of it? A circle I wear is my own self-circle (relationship
  // 'self', and I family_own it); everything else I'm following.
  const wornCircle = parents.find((p) => isSelfCircle(p)) ?? null;
  const followedCircles = parents.filter((p) => !isSelfCircle(p));
  const [editFamilyOpen, setEditFamilyOpen] = useState(false);
  const [caregiverCount, setCaregiverCount] = useState<number | null>(null);
  useEffect(() => {
    if (!isSelfBuyer || !familyId) {
      setCaregiverCount(0);
      return;
    }
    let cancelled = false;
    void listCaregivers(familyId)
      .then((list) => {
        if (!cancelled) setCaregiverCount(list.length);
      })
      .catch(() => {
        if (!cancelled) setCaregiverCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [isSelfBuyer, familyId, acceptSuccess]);

  const handleForget = useCallback(async () => {
    await forget();
    setConfirmingForget(false);
  }, [forget]);

  const handleSignOut = useCallback(async () => {
    setConfirmingSignOut(false);
    await signOut();
  }, [signOut]);

  const handleHypertensionPick = useCallback(
    async (next: HypertensionStatus) => {
      if (!profile) return;
      setHypertensionWriting(true);
      try {
        await updateProfile(profile.id, { hypertension_status: next });
        await refreshProfile();
        setHypertensionSheetOpen(false);
      } finally {
        setHypertensionWriting(false);
      }
    },
    [profile, refreshProfile],
  );

  const handleFieldSave = useCallback(
    async (patch: UserUpdate) => {
      if (!profile) return;
      await updateProfile(profile.id, patch);
      await refreshProfile();
      setEditingField(null);
    },
    [profile, refreshProfile],
  );

  const lastSyncDisplay = useLastSyncDisplay(pairedDevice?.bleId ?? null);
  const batteryOpt = useBatteryOptimizationStatus();

  const headlineStyle = theme.type('displayM');
  const bodyStyle = theme.type('bodyL');

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.warmBase }]}
      edges={['top', 'bottom']}
      testID="settings-screen"
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: theme.spacing.xxxxl },
        ]}
      >
        {/* Header bar — Back + title.
            Generous breathing room around the title; Settings is a
            destination, not a transient sheet. Tighter kerning gives
            the display-weight title a more confident "premium" feel. */}
        <View
          style={{
            paddingHorizontal: theme.spacing.xl,
            paddingTop: theme.spacing.m,
            paddingBottom: theme.spacing.xl,
          }}
        >
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={theme.spacing.m}
            testID="settings-back"
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
            }}
          >
            Settings
          </Text>
        </View>

        {/* Profile ----------------------------------------------------- */}
        <SettingsSection title="Profile" first testID="settings-section-profile">
          <ListRow
            variant="data"
            title="Name"
            value={profile?.display_name ?? '—'}
            testID="settings-profile-name"
          />
          <ListRow
            variant="select"
            title="Year of birth"
            value={profile?.year_of_birth ? String(profile.year_of_birth) : 'Not set'}
            onPress={() => setEditingField('yob')}
            testID="settings-profile-yob"
          />
          <ListRow
            variant="select"
            title="Gender"
            value={profile?.gender ? GENDER_LABEL[profile.gender] : 'Not set'}
            onPress={() => setEditingField('gender')}
            testID="settings-profile-gender"
          />
          <ListRow
            variant="select"
            title="Height"
            value={formatHeightForRow(profile?.height_cm ?? null)}
            onPress={() => setEditingField('height')}
            testID="settings-profile-height"
          />
          <ListRow
            variant="select"
            title="Weight"
            value={formatWeightForRow(profile?.weight_kg ?? null)}
            onPress={() => setEditingField('weight')}
            testID="settings-profile-weight"
          />
          <ListRow
            variant="select"
            title="Timezone"
            value={profile?.timezone ?? 'Not set'}
            onPress={() => setEditingField('timezone')}
            testID="settings-profile-timezone"
          />
          {isSelfBuyer ? (
            <ListRow
              variant="select"
              title="Diagnosed with hypertension?"
              value={
                profile?.hypertension_status
                  ? HYPERTENSION_LABEL[profile.hypertension_status]
                  : 'Not set'
              }
              onPress={() => setHypertensionSheetOpen(true)}
              showDivider={false}
              testID="settings-profile-hypertension"
            />
          ) : null}
        </SettingsSection>

        {/* Watch ------------------------------------------------------- */}
        <SettingsSection title="Watch" testID="settings-section-watch">
          {pairedDevice ? (
            <>
              <ListRow
                variant="data"
                title={pairedDevice.name ?? 'Leiko Watch'}
                subtitle={`Ending ${pairedDevice.macSuffix}`}
                value="Connected"
                testID="settings-watch-paired"
              />
              <ListRow
                variant="data"
                title="Last sync"
                value={lastSyncDisplay}
                testID="settings-watch-last-sync"
              />
              {/* Without the Doze exemption Android throttles the
                  15-minute background sync and the silent remote-refresh
                  push, so readings only reach the family when the wearer
                  opens the app. The post-pairing nudge is dismissible;
                  this row is where a wearer can still find it. */}
              {batteryOpt.supported && batteryOpt.exempt !== null && (
                <ListRow
                  // 'select' (not 'action') when actionable: only data /
                  // select rows render a trailing value, and the
                  // On/Restricted state is the point of the row.
                  variant={batteryOpt.exempt ? 'data' : 'select'}
                  title="Background updates"
                  subtitle={
                    batteryOpt.exempt
                      ? undefined
                      : 'Battery optimisation is delaying syncs. Tap to allow Leiko to run in the background.'
                  }
                  value={batteryOpt.exempt ? 'On' : 'Restricted'}
                  onPress={batteryOpt.exempt ? undefined : () => void batteryOpt.request()}
                  testID="settings-watch-battery-opt"
                />
              )}
              <ListRow
                variant="action"
                title="Pair another watch"
                onPress={() =>
                  (navigation as { navigate: (r: string) => void }).navigate('Pairing')
                }
                testID="settings-watch-pair-another"
              />
              <ListRow
                variant="action"
                title="Forget this watch"
                destructive
                onPress={() => setConfirmingForget(true)}
                showDivider={false}
                testID="settings-watch-forget"
              />
            </>
          ) : (
            <>
              <ListRow
                variant="data"
                title="No watch paired yet"
                subtitle="Pair a watch to start tracking readings."
                testID="settings-watch-empty"
              />
              <ListRow
                variant="action"
                title="Pair a watch"
                onPress={() =>
                  (navigation as { navigate: (r: string) => void }).navigate('Pairing')
                }
                showDivider={false}
                testID="settings-watch-pair-cta"
              />
            </>
          )}
        </SettingsSection>

        {/* Vital streams ---------------------------------------------- */}
        <SettingsSection title="Vital streams" testID="settings-section-vitals">
          <ListRow
            variant="toggle"
            title="Auto heart rate"
            subtitle="Watch samples your heart rate automatically through the day."
            switchValue={autoHrEnabled}
            onSwitchChange={setAutoHr}
            testID="settings-vitals-auto-hr"
          />
          <ListRow
            variant="toggle"
            title="Auto oxygen"
            subtitle="Watch samples your oxygen overnight. Off by default to save battery."
            switchValue={autoSpo2Enabled}
            onSwitchChange={setAutoSpo2}
            showDivider={false}
            testID="settings-vitals-auto-spo2"
          />
        </SettingsSection>

        {/* Goals ------------------------------------------------------- */}
        <SettingsSection title="Goals" testID="settings-section-goals">
          <ListRow
            variant="navigation"
            title="Steps target"
            value={formatStepsTarget(stepsTarget)}
            onPress={() => setPicker('steps')}
            testID="settings-goals-steps"
          />
          <ListRow
            variant="navigation"
            title="Sleep target"
            value={formatSleepTarget(sleepTargetMin)}
            onPress={() => setPicker('sleep')}
            showDivider={false}
            testID="settings-goals-sleep"
          />
        </SettingsSection>

        {/* Apple Health / Health Connect ------------------------------ */}
        {showHealthPlatform ? (
          <SettingsSection
            title="Apple Health & Health Connect"
            testID="settings-section-health-platform"
          >
            <ListRow
              variant="toggle"
              title="Connect to your phone's health app"
              subtitle="Keeps your numbers in one place across apps."
              switchValue={hpMaster}
              onSwitchChange={setHpMaster}
              showDivider={hpMaster}
              testID="settings-hp-master"
            />
            {hpMaster ? (
              <>
                {ALL_WRITE_KINDS.map((kind) => (
                  <ListRow
                    key={`write-${kind}`}
                    variant="toggle"
                    title={`Share ${WRITE_VITAL_LABEL[kind].toLowerCase()}`}
                    switchValue={hpWrite[kind] ?? false}
                    onSwitchChange={(v) => setHpWrite(kind, v)}
                    testID={`settings-hp-write-${kind}`}
                  />
                ))}
                {ALL_READ_KINDS.map((kind, idx) => (
                  <ListRow
                    key={`read-${kind}`}
                    variant="toggle"
                    title={`Read ${READ_VITAL_LABEL[kind].toLowerCase()}`}
                    switchValue={hpRead[kind] ?? false}
                    onSwitchChange={(v) => setHpRead(kind, v)}
                    showDivider={idx !== ALL_READ_KINDS.length - 1}
                    testID={`settings-hp-read-${kind}`}
                  />
                ))}
              </>
            ) : null}
          </SettingsSection>
        ) : null}

        {/* Notifications --------------------------------------------- */}
        <SettingsSection title="Notifications" testID="settings-section-notifications">
          <ListRow
            variant="toggle"
            title="Daily summary"
            subtitle="A morning recap of yesterday."
            switchValue={notif.dailySummary}
            onSwitchChange={(v) => notif.set('dailySummary', v)}
            testID="settings-notif-daily"
          />
          <ListRow
            variant="toggle"
            title="Weekly summary"
            subtitle="Plus only — sent every Sunday."
            switchValue={notif.weeklySummary}
            onSwitchChange={(v) => notif.set('weeklySummary', v)}
            testID="settings-notif-weekly"
          />
          <ListRow
            variant="toggle"
            title="Anomaly notifications"
            subtitle="Plus only — calm-concerned and urgent reads."
            switchValue={notif.anomalyNotifications}
            onSwitchChange={(v) => notif.set('anomalyNotifications', v)}
            testID="settings-notif-anomaly"
          />
          {/* Sprint 15 — per-vital opt-outs. Gated visually on the
              umbrella anomaly_notifications toggle: when it's off, the
              per-vital toggles are hidden (the umbrella overrides them
              server-side anyway). */}
          {notif.anomalyNotifications ? (
            <>
              <ListRow
                variant="toggle"
                title="Blood pressure"
                subtitle="Worth-a-look and urgent BP notices."
                switchValue={notif.anomalyBp}
                onSwitchChange={(v) => notif.set('anomalyBp', v)}
                testID="settings-notif-anomaly-bp"
              />
              <ListRow
                variant="toggle"
                title="Heart rate"
                subtitle="3-day trend and out-of-range resting heart rate."
                switchValue={notif.anomalyHr}
                onSwitchChange={(v) => notif.set('anomalyHr', v)}
                testID="settings-notif-anomaly-hr"
              />
              <ListRow
                variant="toggle"
                title="Blood oxygen"
                subtitle="Low overnight oxygen patterns."
                switchValue={notif.anomalySpo2}
                onSwitchChange={(v) => notif.set('anomalySpo2', v)}
                testID="settings-notif-anomaly-spo2"
              />
            </>
          ) : null}
          <ListRow
            variant="toggle"
            title="Watch status"
            subtitle="Sync issues and battery low."
            switchValue={notif.watchStatus}
            onSwitchChange={(v) => notif.set('watchStatus', v)}
            testID="settings-notif-watch"
          />
          <ListRow
            variant="toggle"
            title="Family activity"
            subtitle="When someone in your circle joins or leaves a note."
            switchValue={notif.familyActivity}
            onSwitchChange={(v) => notif.set('familyActivity', v)}
            testID="settings-notif-family"
          />
          <ListRow
            variant="toggle"
            title="Subscription and account"
            subtitle="Renewals, trial reminders, account changes."
            switchValue={notif.subscriptionAccount}
            onSwitchChange={(v) => notif.set('subscriptionAccount', v)}
            testID="settings-notif-subscription"
          />
          <ListRow
            variant="toggle"
            title="Marketing"
            subtitle="Tips and product updates. Off by default."
            switchValue={notif.marketing}
            onSwitchChange={(v) => notif.set('marketing', v)}
            testID="settings-notif-marketing"
          />
          <ListRow
            variant="toggle"
            title="Quiet hours"
            subtitle="Hold most notifications overnight."
            switchValue={notif.quietHoursEnabled}
            onSwitchChange={(v) => notif.set('quietHoursEnabled', v)}
            testID="settings-notif-quiet-toggle"
          />
          {notif.quietHoursEnabled ? (
            <>
              <ListRow
                variant="navigation"
                title="Quiet window"
                value={formatQuietHours(notif.quietHoursStart, notif.quietHoursEnd)}
                onPress={() => setQuietHoursSheetOpen(true)}
                testID="settings-notif-quiet-window"
              />
              {/* Sprint 15 — urgent override affirmation. Default is
                  "Hold for morning". The user can flip to "Reach me
                  anyway" if they want urgent BP/HR/SpO2 to wake them. */}
              <ListRow
                variant="toggle"
                title="Urgent overrides quiet"
                subtitle="Send confirmed-urgent notices even during quiet hours."
                switchValue={notif.anomalyBypassQuiet}
                onSwitchChange={(v) => notif.set('anomalyBypassQuiet', v)}
                showDivider={false}
                testID="settings-notif-anomaly-bypass"
              />
            </>
          ) : null}
        </SettingsSection>

        {/* Family ------------------------------------------------------ */}
        {/* ADR-0006 Phase 4 — the family surface collapses from ~6
            persona-gated rows into TWO role-aware sections, driven by the
            single question "am I the wearer of this circle, or a follower?"

            1. "Following your readings" — shown when you WEAR a watch
               (you own a self-circle): invite someone to follow + manage
               what each follower sees + edit your own details.
            2. "People you follow" — a row per circle you follow, opening
               its members/leave surface.

            Plus a single "Join with a code" action for accepting an
            invite to follow someone else. */}
        {/* Connect Phase B — ONE pair of actions, same labels as Home:
            share a code, or enter one. Always visible; direction is
            resolved at accept time by who wears a watch, so neither row
            is gated on being a wearer or an owner. */}
        <SettingsSection title="Connect" testID="settings-section-connect">
          <ListRow
            variant="action"
            title="Connect with someone"
            subtitle="Get a code to share. When they enter it, you're connected."
            onPress={() => setInviteSheetOpen(true)}
            testID="settings-family-invite"
          />
          <ListRow
            variant="action"
            title="Enter a code"
            subtitle="Got a code from someone? Enter it here."
            onPress={() => {
              setAcceptSuccess(false);
              setAcceptSheetOpen(true);
            }}
            showDivider={false}
            testID="settings-family-accept"
          />
        </SettingsSection>

        {wornCircle ? (
          <SettingsSection
            title="Following your readings"
            testID="settings-section-following-you"
          >
            {(caregiverCount ?? 0) > 0 ? (
              <ListRow
                variant="navigation"
                title="Who sees my readings"
                subtitle={
                  caregiverCount === 1
                    ? '1 person follows your readings.'
                    : `${caregiverCount ?? 0} people follow your readings.`
                }
                onPress={() => stackNavigation.navigate('CaregiverVisibility')}
                testID="settings-family-visibility"
              />
            ) : null}
            <ListRow
              variant="action"
              title="Edit my details"
              subtitle="Update your name or year of birth."
              onPress={() => setEditFamilyOpen(true)}
              showDivider={false}
              testID="settings-family-edit-details"
            />
          </SettingsSection>
        ) : null}

        {followedCircles.length > 0 ? (
          <SettingsSection
            title="People you care for"
            testID="settings-section-following"
          >
            {followedCircles.map((c, i) => (
              <ListRow
                key={c.familyId}
                variant="navigation"
                title={c.parentDisplayName || 'Someone you care for'}
                subtitle="You’re following their readings."
                onPress={() => stackNavigation.navigate('FamilyMembers')}
                showDivider={i < followedCircles.length - 1}
                testID={`settings-followed-${c.familyId}`}
              />
            ))}
          </SettingsSection>
        ) : null}

        {/* Share ------------------------------------------------------ */}
        <SettingsSection title="Share" testID="settings-section-share">
          <ListRow
            variant="navigation"
            title={isSelfBuyer ? 'For your doctor' : 'For their doctor'}
            subtitle="A summary you can hand to a doctor visit."
            onPress={() => stackNavigation.navigate('ForYourDoctor')}
            showDivider={false}
            testID="settings-for-your-doctor"
          />
        </SettingsSection>

        {/* Privacy ----------------------------------------------------- */}
        <SettingsSection title="Privacy and data" testID="settings-section-privacy">
          <ListRow
            variant="action"
            title="Export my data"
            subtitle={
              tier === 'free' || tier === 'past_due'
                ? 'Available with Leiko Plus.'
                : 'Sends a CSV you can save or email.'
            }
            onPress={async () => {
              if (tier === 'free' || tier === 'past_due') {
                setExportPaywallOpen(true);
                return;
              }
              setExportError(null);
              setExportPending(true);
              try {
                await exportFamilyData();
              } catch {
                setExportError("We couldn't prepare your export. Try again in a moment.");
              } finally {
                setExportPending(false);
              }
            }}
            disabled={exportPending}
            testID="settings-privacy-export"
          />
          {exportError ? (
            <View style={{ paddingHorizontal: theme.spacing.l, marginTop: theme.spacing.s }}>
              <Text
                style={{
                  color: theme.colors.text.secondary,
                  fontSize: theme.type('label').size,
                  fontFamily: theme.type('label').family,
                }}
                testID="settings-privacy-export-error"
              >
                {exportError}
              </Text>
            </View>
          ) : null}
          <ListRow
            variant="navigation"
            title="Activity log"
            subtitle="The last 90 days of activity on your account."
            onPress={() => stackNavigation.navigate('AuditLog')}
            testID="settings-privacy-audit-log"
          />
          <ListRow
            variant="action"
            title="Delete my account"
            subtitle="Your readings will be removed after 30 days."
            destructive
            onPress={() => {
              setDeleteEmail('');
              setDeleteError(null);
              setDeleteSheetOpen(true);
            }}
            showDivider={false}
            testID="settings-privacy-delete"
          />
        </SettingsSection>

        {/* AI ---------------------------------------------------------- */}
        <SettingsSection title="AI" testID="settings-section-ai">
          <ListRow
            variant="data"
            title="Questions this month"
            subtitle="Resets on the 1st."
            value={
              quota
                ? `${quota.count} of ${quota.limit}`
                : '— of —'
            }
            testID="settings-ai-quota"
          />
          <ListRow
            variant="data"
            title="Your tier"
            value={tier === 'free' || tier === 'past_due' ? 'Free' : 'Plus'}
            subtitle={
              tier === 'free' || tier === 'past_due'
                ? 'Free includes 5 questions a month. Plus brings 100 plus weekly summaries.'
                : 'Plus brings 100 questions a month, weekly summaries, and a doctor-ready PDF.'
            }
            showDivider={false}
            testID="settings-ai-tier"
          />
        </SettingsSection>

        {/* About ------------------------------------------------------- */}
        <SettingsSection title="About" testID="settings-section-about">
          <ListRow
            variant="data"
            title="App version"
            value={APP_VERSION}
            testID="settings-about-version"
          />
          <ListRow
            variant="navigation"
            title="Terms of service"
            onPress={() => void Linking.openURL('https://leiko.health/terms')}
            testID="settings-about-terms"
          />
          <ListRow
            variant="navigation"
            title="Privacy policy"
            onPress={() => void Linking.openURL('https://leiko.health/privacy')}
            testID="settings-about-privacy"
          />
          <ListRow
            variant="navigation"
            title="Help & support"
            onPress={() => void Linking.openURL('https://leiko.health/support')}
            testID="settings-about-help"
          />
          <ListRow
            variant="action"
            title="Email us"
            onPress={() => void Linking.openURL('mailto:support@leiko.health')}
            showDivider={false}
            testID="settings-about-email"
          />
        </SettingsSection>

        {/* Account ----------------------------------------------------- */}
        <SettingsSection title="Account" testID="settings-section-account">
          {/* Sprint 19 Block 4 — switch between accounts saved on
              this device. Tap takes you to AccountSwitchScreen where
              you can pick another known account or sign in with a
              new email + delete the current account. */}
          <ListRow
            variant="navigation"
            title="Switch account"
            subtitle={profile?.email ? `Signed in as ${profile.email}` : 'Manage accounts on this device.'}
            onPress={() => stackNavigation.navigate('AccountSwitch')}
            testID="settings-account-switch"
          />
          <ListRow
            variant="action"
            title="Sign out"
            destructive
            onPress={() => setConfirmingSignOut(true)}
            showDivider={false}
            testID="settings-account-signout"
          />
        </SettingsSection>
      </ScrollView>

      {/* Forget watch — preserved Sprint 5 sheet */}
      <BottomSheet
        visible={confirmingForget}
        onDismiss={() => setConfirmingForget(false)}
        size="compact"
        surface="solid"
        title="Forget this watch?"
        testID="settings-forget-sheet"
      >
        <View style={{ paddingHorizontal: theme.spacing.l, paddingBottom: theme.spacing.l }}>
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: bodyStyle.size,
              lineHeight: bodyStyle.lineHeight,
              fontFamily: bodyStyle.family,
              marginBottom: theme.spacing.xl,
            }}
          >
            The watch will stop syncing with this phone. Past readings stay safe.
          </Text>
          <Button
            variant="primary"
            onPress={() => void handleForget()}
            accessibilityLabel="Yes, forget this watch"
            testID="settings-forget-confirm"
          >
            Yes, forget
          </Button>
          <View style={{ marginTop: theme.spacing.s }}>
            <Button
              variant="ghost"
              onPress={() => setConfirmingForget(false)}
              accessibilityLabel="Keep paired"
              testID="settings-forget-cancel"
            >
              Keep paired
            </Button>
          </View>
        </View>
      </BottomSheet>

      {/* Sign out — dignified, no guilt */}
      <BottomSheet
        visible={confirmingSignOut}
        onDismiss={() => setConfirmingSignOut(false)}
        size="compact"
        surface="solid"
        title="Sign out?"
        testID="settings-signout-sheet"
      >
        <View style={{ paddingHorizontal: theme.spacing.l, paddingBottom: theme.spacing.l }}>
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: bodyStyle.size,
              lineHeight: bodyStyle.lineHeight,
              fontFamily: bodyStyle.family,
              marginBottom: theme.spacing.xl,
            }}
          >
            You can sign back in any time. Your readings stay safe.
          </Text>
          <Button
            variant="primary"
            onPress={() => void handleSignOut()}
            accessibilityLabel="Yes, sign me out"
            testID="settings-signout-confirm"
          >
            Yes, sign me out
          </Button>
          <View style={{ marginTop: theme.spacing.s }}>
            <Button
              variant="ghost"
              onPress={() => setConfirmingSignOut(false)}
              accessibilityLabel="Stay signed in"
              testID="settings-signout-cancel"
            >
              Stay signed in
            </Button>
          </View>
        </View>
      </BottomSheet>

      {/* Steps target picker */}
      <BottomSheet
        visible={picker === 'steps'}
        onDismiss={() => setPicker(null)}
        size="tall"
        surface="solid"
        title="Daily steps target"
        testID="settings-steps-sheet"
      >
        <ScrollView>
          {STEPS_OPTIONS.map((value, idx) => (
            <ListRow
              key={value}
              variant="select"
              title={formatStepsTarget(value)}
              selected={stepsTarget === value}
              onPress={() => {
                setStepsTarget(value);
                setPicker(null);
              }}
              showDivider={idx !== STEPS_OPTIONS.length - 1}
              testID={`settings-steps-option-${value}`}
            />
          ))}
        </ScrollView>
      </BottomSheet>

      {/* Sleep target picker */}
      <BottomSheet
        visible={picker === 'sleep'}
        onDismiss={() => setPicker(null)}
        size="tall"
        surface="solid"
        title="Sleep target"
        testID="settings-sleep-sheet"
      >
        <ScrollView>
          {SLEEP_OPTIONS.map((value, idx) => (
            <ListRow
              key={value}
              variant="select"
              title={formatSleepTarget(value)}
              selected={sleepTargetMin === value}
              onPress={() => {
                setSleepTargetMin(value);
                setPicker(null);
              }}
              showDivider={idx !== SLEEP_OPTIONS.length - 1}
              testID={`settings-sleep-option-${value}`}
            />
          ))}
        </ScrollView>
      </BottomSheet>

      {/* Quiet-hours preset picker */}
      <BottomSheet
        visible={quietHoursSheetOpen}
        onDismiss={() => setQuietHoursSheetOpen(false)}
        size="default"
        surface="solid"
        title="Quiet window"
        testID="settings-quiet-hours-sheet"
      >
        <View style={{ paddingBottom: theme.spacing.l }}>
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: bodyStyle.size,
              fontFamily: bodyStyle.family,
              paddingHorizontal: theme.spacing.l,
              marginBottom: theme.spacing.m,
            }}
          >
            Anomaly and medication notifications still come through during quiet hours.
          </Text>
          {QUIET_HOURS_PRESETS.map((preset, idx) => {
            const selected =
              notif.quietHoursStart === preset.start && notif.quietHoursEnd === preset.end;
            return (
              <ListRow
                key={preset.label}
                variant="select"
                title={preset.label}
                selected={selected}
                onPress={() => {
                  notif.setMany({
                    quietHoursStart: preset.start,
                    quietHoursEnd: preset.end,
                  });
                  setQuietHoursSheetOpen(false);
                }}
                showDivider={idx !== QUIET_HOURS_PRESETS.length - 1}
                testID={`settings-quiet-option-${preset.start}-${preset.end}`}
              />
            );
          })}
        </View>
      </BottomSheet>

      {/* Delete account confirmation — type your email */}
      <BottomSheet
        visible={deleteSheetOpen}
        onDismiss={() => setDeleteSheetOpen(false)}
        size="default"
        surface="solid"
        title="Delete your account"
        testID="settings-delete-sheet"
      >
        <View style={{ paddingHorizontal: theme.spacing.l, paddingBottom: theme.spacing.l }}>
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: bodyStyle.size,
              lineHeight: bodyStyle.lineHeight,
              fontFamily: bodyStyle.family,
              marginBottom: theme.spacing.m,
            }}
          >
            Your readings will be removed after 30 days. To confirm, type the email on your account.
          </Text>
          <TextInput
            value={deleteEmail}
            onChangeText={setDeleteEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder={profile?.email ?? 'your email'}
            placeholderTextColor={theme.colors.text.tertiary}
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
            testID="settings-delete-email-input"
          />
          {deleteError ? (
            <Text
              style={{
                color: theme.colors.text.secondary,
                fontSize: theme.type('label').size,
                fontFamily: theme.type('label').family,
                marginBottom: theme.spacing.m,
              }}
              testID="settings-delete-error"
            >
              {deleteError}
            </Text>
          ) : null}
          <Button
            variant="destructive"
            disabled={deletePending || deleteEmail.trim().length === 0}
            loading={deletePending}
            onPress={async () => {
              setDeleteError(null);
              setDeletePending(true);
              try {
                await deleteAccount(deleteEmail.trim());
                setDeleteSheetOpen(false);
                await signOut();
              } catch (e) {
                setDeleteError(
                  e instanceof Error && e.message === 'email_mismatch'
                    ? 'That email does not match the one on your account.'
                    : "We couldn't delete your account. Try again in a moment.",
                );
              } finally {
                setDeletePending(false);
              }
            }}
            accessibilityLabel="Delete my account"
            testID="settings-delete-confirm"
          >
            Delete my account
          </Button>
          <View style={{ marginTop: theme.spacing.s }}>
            <Button
              variant="ghost"
              onPress={() => setDeleteSheetOpen(false)}
              accessibilityLabel="Keep my account"
              testID="settings-delete-cancel"
            >
              Keep my account
            </Button>
          </View>
        </View>
      </BottomSheet>

      {/* Connect Phase B — the shared zero-input share sheet (same
          component Home uses). Opening it generates a code immediately. */}
      <ConnectShareSheet
        visible={inviteSheetOpen}
        onDismiss={() => setInviteSheetOpen(false)}
        testID="settings-connect"
      />

      {/* Accept invite — Sprint 16.6, extracted into AcceptInviteSheet so
          CaregiverHome empty-state + FamilyWatch onboarding can reuse it.
          testID prefix preserves the existing settings-accept-{slot}
          contract that the Settings tests assert on. */}
      <AcceptInviteSheet
        visible={acceptSheetOpen}
        onDismiss={() => setAcceptSheetOpen(false)}
        initialCode={acceptPrefillCode}
        onSuccess={() => setAcceptSuccess(true)}
        testID="settings-accept"
      />

      {/* Sprint 19 Block 3 — owner-only edit family details. Only
          mounted when there's a family the viewer owns. */}
      {ownedFamily ? (
        <EditFamilyDetailsSheet
          visible={editFamilyOpen}
          onDismiss={() => setEditFamilyOpen(false)}
          familyId={ownedFamily.familyId}
          initialName={ownedFamily.parentDisplayName}
          initialRelationship={ownedFamily.parentRelationship}
          testID="settings-family-edit-sheet"
        />
      ) : null}

      {/* Export paywall — for free users tapping Export my data */}
      <PaywallSheet
        visible={exportPaywallOpen}
        onDismiss={() => setExportPaywallOpen(false)}
        accountType={profile?.account_type ?? 'caregiver'}
        trigger="csv_export"
      />

      {/* Hypertension chip (D8a §10.1) — self-buyer only */}
      <BottomSheet
        visible={hypertensionSheetOpen}
        onDismiss={() => setHypertensionSheetOpen(false)}
        size="compact"
        surface="solid"
        title="Diagnosed with hypertension?"
        testID="settings-hypertension-sheet"
      >
        <View style={{ paddingHorizontal: theme.spacing.l, paddingBottom: theme.spacing.l }}>
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: bodyStyle.size,
              lineHeight: bodyStyle.lineHeight,
              fontFamily: bodyStyle.family,
              marginBottom: theme.spacing.l,
            }}
          >
            Sharing this is optional. We use it to add context to your trends.
          </Text>
          {(['yes', 'no', 'prefer_not_say'] as HypertensionStatus[]).map((value) => (
            <ListRow
              key={value}
              variant="select"
              title={HYPERTENSION_LABEL[value]}
              selected={profile?.hypertension_status === value}
              disabled={hypertensionWriting}
              onPress={() => void handleHypertensionPick(value)}
              testID={`settings-hypertension-${value}`}
            />
          ))}
        </View>
      </BottomSheet>

      {/* Per-field profile editor — one focused sheet per tapped row.
          The Urion watch uses these to calibrate BP measurements; without
          them, some firmwares don't persist BP results to the history
          register that the app reads via 0x14. Sprint 12.5.2. */}
      <ProfileFieldSheet
        field={editingField}
        profile={profile}
        onDismiss={() => setEditingField(null)}
        onSave={handleFieldSave}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------
// Profile field editor — one focused sheet per tapped row

interface ProfileFieldSheetProps {
  field: ProfileField | null;
  profile: UserRow | null;
  onDismiss: () => void;
  onSave: (patch: UserUpdate) => Promise<void>;
}

const PROFILE_FIELD_TITLE: Record<ProfileField, string> = {
  yob: 'Year of birth',
  gender: 'Gender',
  height: 'Height',
  weight: 'Weight',
  timezone: 'Timezone',
};

function ProfileFieldSheet({
  field,
  profile,
  onDismiss,
  onSave,
}: ProfileFieldSheetProps): React.ReactElement {
  const theme = useTheme();
  return (
    <BottomSheet
      visible={field !== null}
      onDismiss={onDismiss}
      size="compact"
      surface="solid"
      title={field ? PROFILE_FIELD_TITLE[field] : undefined}
      testID="settings-profile-field-sheet"
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.l,
          paddingBottom: theme.spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {field === 'yob' && profile && (
          <YobBody initial={profile.year_of_birth} onSave={onSave} />
        )}
        {field === 'gender' && profile && (
          <GenderBody initial={profile.gender} onSave={onSave} />
        )}
        {field === 'height' && profile && (
          <HeightBody initial={profile.height_cm} onSave={onSave} />
        )}
        {field === 'weight' && profile && (
          <WeightBody initial={profile.weight_kg} onSave={onSave} />
        )}
        {field === 'timezone' && profile && (
          <TimezoneBody initial={profile.timezone} onSave={onSave} />
        )}
      </ScrollView>
    </BottomSheet>
  );
}

// Row formatters — what shows up in the Settings list before the user taps.
function formatHeightForRow(cm: number | null): string {
  if (cm === null) return 'Not set';
  return `${cm} cm`;
}

function formatWeightForRow(kg: number | null): string {
  if (kg === null) return 'Not set';
  return `${Math.round(kg)} kg`;
}

// ---------------------------------------------------------------------
// Per-field body components

function YobBody({
  initial,
  onSave,
}: {
  initial: number | null;
  onSave: (patch: UserUpdate) => Promise<void>;
}): React.ReactElement {
  const theme = useTheme();
  const [value, setValue] = useState(initial ? String(initial) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const onSubmit = async () => {
    const trimmed = value.trim();
    if (trimmed === '') {
      setSaving(true);
      try { await onSave({ year_of_birth: null }); } finally { setSaving(false); }
      return;
    }
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < YEAR_OF_BIRTH_MIN || n > YEAR_OF_BIRTH_MAX) {
      setError(`Year of birth must be between ${YEAR_OF_BIRTH_MIN} and ${YEAR_OF_BIRTH_MAX}.`);
      return;
    }
    setSaving(true);
    try { await onSave({ year_of_birth: n }); } finally { setSaving(false); }
  };
  return (
    <FieldFormScaffold
      helper="The year you were born — used to calibrate watch readings."
      error={error}
      saving={saving}
      onSubmit={onSubmit}
    >
      <TextInput
        accessibilityLabel="Year of birth"
        testID="settings-demographics-yob"
        keyboardType="number-pad"
        value={value}
        onChangeText={(t) => { setValue(t); setError(null); }}
        placeholder="1980"
        placeholderTextColor={theme.colors.text.tertiary}
        style={fieldInputStyle(theme)}
        autoFocus
      />
    </FieldFormScaffold>
  );
}

function GenderBody({
  initial,
  onSave,
}: {
  initial: Gender | null;
  onSave: (patch: UserUpdate) => Promise<void>;
}): React.ReactElement {
  const theme = useTheme();
  const [value, setValue] = useState<Gender | null>(initial);
  const [saving, setSaving] = useState(false);
  const submit = async (next: Gender) => {
    setValue(next);
    setSaving(true);
    try { await onSave({ gender: next }); } finally { setSaving(false); }
  };
  return (
    <View>
      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: theme.type('bodyM').size,
          lineHeight: theme.type('bodyM').lineHeight,
          fontFamily: theme.type('bodyM').family,
          marginBottom: theme.spacing.l,
        }}
      >
        Tap to choose — your selection saves immediately.
      </Text>
      <View style={{ marginBottom: theme.spacing.s }}>
        <View style={{ flexDirection: 'row' }}>
          {(['female', 'male'] as Gender[]).map((g, i) => (
            <GenderPill
              key={g}
              value={g}
              selected={value === g}
              onPress={() => void submit(g)}
              marginRight={i === 0 ? theme.spacing.s : 0}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row', marginTop: theme.spacing.s }}>
          {(['nonbinary', 'prefer_not_say'] as Gender[]).map((g, i) => (
            <GenderPill
              key={g}
              value={g}
              selected={value === g}
              onPress={() => void submit(g)}
              marginRight={i === 0 ? theme.spacing.s : 0}
            />
          ))}
        </View>
      </View>
      {saving ? (
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: theme.type('bodyM').size,
            fontFamily: theme.type('bodyM').family,
            marginTop: theme.spacing.l,
          }}
        >
          Saving…
        </Text>
      ) : null}
    </View>
  );
}

function HeightBody({
  initial,
  onSave,
}: {
  initial: number | null;
  onSave: (patch: UserUpdate) => Promise<void>;
}): React.ReactElement {
  const theme = useTheme();
  const [unit, setUnit] = useState<'cm' | 'ft'>('cm');
  const [cm, setCm] = useState(initial !== null ? String(initial) : '');
  const initFtIn = initial !== null ? cmToFtIn(initial) : null;
  const [ft, setFt] = useState(initFtIn ? String(initFtIn.ft) : '');
  const [inches, setInches] = useState(initFtIn ? String(initFtIn.inches) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const switchUnit = (next: 'cm' | 'ft') => {
    if (next === unit) return;
    if (next === 'ft') {
      const n = Number.parseInt(cm, 10);
      if (Number.isFinite(n)) {
        const r = cmToFtIn(n);
        setFt(String(r.ft));
        setInches(String(r.inches));
      }
    } else {
      const ftN = Number.parseInt(ft, 10);
      const inN = Number.parseInt(inches, 10) || 0;
      if (Number.isFinite(ftN)) setCm(String(ftInToCm(ftN, inN)));
    }
    setUnit(next);
    setError(null);
  };

  const onSubmit = async () => {
    let resolved: number | null = null;
    if (unit === 'cm') {
      const trimmed = cm.trim();
      if (trimmed === '') {
        resolved = null;
      } else {
        const n = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(n)) {
          setError('Height must be a whole number in centimetres.');
          return;
        }
        resolved = n;
      }
    } else {
      const ftRaw = ft.trim();
      const inRaw = inches.trim();
      if (ftRaw === '' && inRaw === '') {
        resolved = null;
      } else {
        const ftN = Number.parseInt(ftRaw || '0', 10);
        const inN = Number.parseInt(inRaw || '0', 10);
        if (!Number.isFinite(ftN) || !Number.isFinite(inN)) {
          setError('Height must be whole numbers in feet and inches.');
          return;
        }
        if (inN < 0 || inN > 11) {
          setError('Inches must be between 0 and 11.');
          return;
        }
        resolved = ftInToCm(ftN, inN);
      }
    }
    if (resolved !== null && (resolved < HEIGHT_CM_MIN || resolved > HEIGHT_CM_MAX)) {
      setError(
        unit === 'cm'
          ? `Height should be between ${HEIGHT_CM_MIN} and ${HEIGHT_CM_MAX} cm.`
          : `Height should be between ${Math.floor(HEIGHT_CM_MIN / CM_PER_FOOT)}' and ${Math.floor(HEIGHT_CM_MAX / CM_PER_FOOT)}'.`,
      );
      return;
    }
    setSaving(true);
    try { await onSave({ height_cm: resolved }); } finally { setSaving(false); }
  };

  return (
    <FieldFormScaffold
      helper="Your height. Switch units anytime — we store the canonical value."
      error={error}
      saving={saving}
      onSubmit={onSubmit}
    >
      <View style={{ marginBottom: theme.spacing.m }}>
        <FieldHeader
          label="Unit"
          unitA="cm"
          unitB="ft"
          selected={unit}
          onSelect={(u) => switchUnit(u as 'cm' | 'ft')}
          testIDPrefix="settings-demographics-height-unit"
        />
      </View>
      {unit === 'cm' ? (
        <TextInput
          accessibilityLabel="Height in centimetres"
          testID="settings-demographics-height"
          keyboardType="number-pad"
          value={cm}
          onChangeText={(t) => { setCm(t); setError(null); }}
          placeholder="170"
          placeholderTextColor={theme.colors.text.tertiary}
          style={fieldInputStyle(theme)}
          autoFocus
        />
      ) : (
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, marginRight: theme.spacing.s }}>
            <TextInput
              accessibilityLabel="Height feet"
              testID="settings-demographics-height-ft"
              keyboardType="number-pad"
              value={ft}
              onChangeText={(t) => { setFt(t); setError(null); }}
              placeholder="5"
              placeholderTextColor={theme.colors.text.tertiary}
              style={fieldInputStyle(theme)}
              autoFocus
            />
            <Text style={fieldUnitLabel(theme)}>ft</Text>
          </View>
          <View style={{ flex: 1 }}>
            <TextInput
              accessibilityLabel="Height inches"
              testID="settings-demographics-height-in"
              keyboardType="number-pad"
              value={inches}
              onChangeText={(t) => { setInches(t); setError(null); }}
              placeholder="9"
              placeholderTextColor={theme.colors.text.tertiary}
              style={fieldInputStyle(theme)}
            />
            <Text style={fieldUnitLabel(theme)}>in</Text>
          </View>
        </View>
      )}
    </FieldFormScaffold>
  );
}

function WeightBody({
  initial,
  onSave,
}: {
  initial: number | null;
  onSave: (patch: UserUpdate) => Promise<void>;
}): React.ReactElement {
  const theme = useTheme();
  const [unit, setUnit] = useState<'kg' | 'lbs'>('kg');
  const [kg, setKg] = useState(initial !== null ? String(Math.round(initial)) : '');
  const [lbs, setLbs] = useState(initial !== null ? String(kgToLbs(initial)) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const switchUnit = (next: 'kg' | 'lbs') => {
    if (next === unit) return;
    if (next === 'lbs') {
      const n = Number.parseFloat(kg);
      if (Number.isFinite(n)) setLbs(String(kgToLbs(n)));
    } else {
      const n = Number.parseFloat(lbs);
      if (Number.isFinite(n)) setKg(String(lbsToKg(n)));
    }
    setUnit(next);
    setError(null);
  };

  const onSubmit = async () => {
    const raw = (unit === 'kg' ? kg : lbs).trim();
    let resolved: number | null = null;
    if (raw === '') {
      resolved = null;
    } else {
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) {
        setError(
          unit === 'kg'
            ? 'Weight must be a whole number in kilograms.'
            : 'Weight must be a whole number in pounds.',
        );
        return;
      }
      resolved = unit === 'kg' ? Math.round(n) : lbsToKg(n);
    }
    if (resolved !== null && (resolved < WEIGHT_KG_MIN || resolved > WEIGHT_KG_MAX)) {
      setError(
        unit === 'kg'
          ? `Weight should be between ${WEIGHT_KG_MIN} and ${WEIGHT_KG_MAX} kg.`
          : `Weight should be between ${kgToLbs(WEIGHT_KG_MIN)} and ${kgToLbs(WEIGHT_KG_MAX)} lbs.`,
      );
      return;
    }
    setSaving(true);
    try { await onSave({ weight_kg: resolved }); } finally { setSaving(false); }
  };

  return (
    <FieldFormScaffold
      helper="Your weight. Switch units anytime — we store the canonical value."
      error={error}
      saving={saving}
      onSubmit={onSubmit}
    >
      <View style={{ marginBottom: theme.spacing.m }}>
        <FieldHeader
          label="Unit"
          unitA="kg"
          unitB="lbs"
          selected={unit}
          onSelect={(u) => switchUnit(u as 'kg' | 'lbs')}
          testIDPrefix="settings-demographics-weight-unit"
        />
      </View>
      <TextInput
        accessibilityLabel={unit === 'kg' ? 'Weight in kilograms' : 'Weight in pounds'}
        testID="settings-demographics-weight"
        keyboardType="number-pad"
        value={unit === 'kg' ? kg : lbs}
        onChangeText={(t) => {
          if (unit === 'kg') setKg(t);
          else setLbs(t);
          setError(null);
        }}
        placeholder={unit === 'kg' ? '70' : '155'}
        placeholderTextColor={theme.colors.text.tertiary}
        style={fieldInputStyle(theme)}
        autoFocus
      />
    </FieldFormScaffold>
  );
}

function TimezoneBody({
  initial,
  onSave,
}: {
  initial: string | null;
  onSave: (patch: UserUpdate) => Promise<void>;
}): React.ReactElement {
  const theme = useTheme();
  const deviceTz =
    typeof Intl !== 'undefined' && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC';
  const [saving, setSaving] = useState(false);
  const useDevice = async () => {
    setSaving(true);
    try { await onSave({ timezone: deviceTz }); } finally { setSaving(false); }
  };
  const isCurrent = initial === deviceTz;
  return (
    <View>
      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: theme.type('bodyM').size,
          lineHeight: theme.type('bodyM').lineHeight,
          fontFamily: theme.type('bodyM').family,
          marginBottom: theme.spacing.l,
        }}
      >
        Your timezone controls when "today" starts for your trends. Right
        now it&apos;s set to {initial ?? 'not set'}.
      </Text>
      <Button
        variant="primary"
        onPress={() => void useDevice()}
        accessibilityLabel={`Use my device's time zone, ${deviceTz}`}
        testID="settings-demographics-timezone-use-device"
        loading={saving}
        disabled={isCurrent}
      >
        {isCurrent ? `Already set to ${deviceTz}` : `Use my device's time zone (${deviceTz})`}
      </Button>
    </View>
  );
}

// ---------------------------------------------------------------------
// Profile field editor — shared scaffolding

function FieldFormScaffold({
  helper,
  error,
  saving,
  onSubmit,
  children,
}: {
  helper: string;
  error: string | null;
  saving: boolean;
  onSubmit: () => Promise<void>;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View>
      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: theme.type('bodyM').size,
          lineHeight: theme.type('bodyM').lineHeight,
          fontFamily: theme.type('bodyM').family,
          marginBottom: theme.spacing.l,
        }}
      >
        {helper}
      </Text>
      {children}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="settings-demographics-error"
          style={{
            color: theme.colors.state.urgent,
            fontSize: theme.type('bodyM').size,
            fontFamily: theme.type('bodyM').family,
            marginTop: theme.spacing.s,
            marginBottom: theme.spacing.l,
          }}
        >
          {error}
        </Text>
      ) : null}
      <Button
        variant="primary"
        onPress={() => void onSubmit()}
        accessibilityLabel="Save"
        testID="settings-demographics-save"
        loading={saving}
        style={{ marginTop: theme.spacing.l }}
      >
        Save
      </Button>
    </View>
  );
}

function fieldInputStyle(theme: ReturnType<typeof useTheme>) {
  const bodyStyle = theme.type('bodyL');
  return {
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing.l,
    paddingVertical: theme.spacing.m,
    color: theme.colors.text.primary,
    fontSize: bodyStyle.size,
    fontFamily: bodyStyle.family,
  } as const;
}

function fieldUnitLabel(theme: ReturnType<typeof useTheme>) {
  const labelStyle = theme.type('label');
  return {
    color: theme.colors.text.secondary,
    fontSize: labelStyle.size,
    fontFamily: labelStyle.family,
    marginTop: theme.spacing.xs,
  } as const;
}

// ---------------------------------------------------------------------
// Unit-conversion helpers — used by HeightBody and WeightBody.

// 1 ft = 30.48 cm exactly; 1 in = 2.54 cm exactly. Standard NIST.
const CM_PER_INCH = 2.54;
const CM_PER_FOOT = 30.48;
// 1 kg = 2.2046226218 lbs.
const LBS_PER_KG = 2.2046226218;

function cmToFtIn(cm: number): { ft: number; inches: number } {
  const totalInches = cm / CM_PER_INCH;
  const ft = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - ft * 12);
  // Inches can round up to 12 — promote to the next foot.
  if (inches === 12) return { ft: ft + 1, inches: 0 };
  return { ft, inches };
}

function ftInToCm(ft: number, inches: number): number {
  return Math.round(ft * CM_PER_FOOT + inches * CM_PER_INCH);
}

function kgToLbs(kg: number): number {
  return Math.round(kg * LBS_PER_KG);
}

function lbsToKg(lbs: number): number {
  return Math.round(lbs / LBS_PER_KG);
}


// ---------------------------------------------------------------------
// Demographics sheet — sub-components

function GenderPill({
  value,
  selected,
  onPress,
  marginRight,
}: {
  value: Gender;
  selected: boolean;
  onPress: () => void;
  marginRight: number;
}): React.ReactElement {
  const theme = useTheme();
  const bodyStyle = theme.type('bodyL');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={GENDER_LABEL[value]}
      accessibilityState={{ selected }}
      testID={`settings-demographics-gender-${value}`}
      style={({ pressed }) => ({
        flex: 1,
        marginRight,
        borderWidth: 1,
        borderColor: selected ? theme.colors.brand.primary : theme.colors.border.default,
        backgroundColor: selected ? theme.colors.brand.primary : 'transparent',
        borderRadius: theme.radii.s,
        paddingHorizontal: theme.spacing.m,
        paddingVertical: theme.spacing.m,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        numberOfLines={1}
        style={{
          color: selected ? theme.colors.text.onBrand : theme.colors.text.primary,
          fontSize: bodyStyle.size,
          fontFamily: bodyStyle.family,
          fontWeight: selected ? '600' : '400',
        }}
      >
        {GENDER_LABEL[value]}
      </Text>
    </Pressable>
  );
}

function FieldHeader({
  label,
  unitA,
  unitB,
  selected,
  onSelect,
  testIDPrefix,
}: {
  label: string;
  unitA: string;
  unitB: string;
  selected: string;
  onSelect: (unit: string) => void;
  testIDPrefix: string;
}): React.ReactElement {
  const theme = useTheme();
  const labelStyle = theme.type('label');
  const unitChip = (unit: string, isSelected: boolean): React.ReactElement => (
    <Pressable
      key={unit}
      onPress={() => onSelect(unit)}
      accessibilityRole="button"
      accessibilityLabel={`${label} in ${unit}`}
      accessibilityState={{ selected: isSelected }}
      testID={`${testIDPrefix}-${unit}`}
      style={({ pressed }) => ({
        paddingHorizontal: theme.spacing.m,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radii.s,
        backgroundColor: isSelected ? theme.colors.brand.primary : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: isSelected ? theme.colors.text.onBrand : theme.colors.text.secondary,
          fontSize: labelStyle.size,
          fontFamily: labelStyle.family,
          fontWeight: isSelected ? '600' : '500',
        }}
      >
        {unit}
      </Text>
    </Pressable>
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.xs,
      }}
    >
      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: labelStyle.size,
          fontFamily: labelStyle.family,
        }}
      >
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          borderWidth: 1,
          borderColor: theme.colors.border.default,
          borderRadius: theme.radii.s,
          padding: 2,
        }}
      >
        {unitChip(unitA, selected === unitA)}
        {unitChip(unitB, selected === unitB)}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------
// Helpers

function useLastSyncDisplay(bleId: string | null): string {
  if (!bleId) return '—';
  // Pre-Sprint 7.5 the cursor map was Record<string, number> (Unix sec);
  // Sprint 7.5 widened entries to a VitalSyncCursor object. The previous
  // implementation here multiplied the raw object by 1000, yielding NaN
  // and "NaN d ago". `getLastSyncSec` normalises both shapes and returns
  // the BP cursor in RAW watch seconds; convert to actual UTC via
  // watchTimestampToUtcSec so the "ago" math doesn't drift by the
  // China-firmware offset.
  const rawWatchSec = getLastSyncSec(bleId);
  if (!rawWatchSec) return 'Not yet synced';
  const utcMs = watchTimestampToUtcSec(rawWatchSec) * 1000;
  const minutesAgo = Math.floor((Date.now() - utcMs) / 60_000);
  if (minutesAgo < 0) return 'Just now';
  if (minutesAgo < 1) return 'Just now';
  if (minutesAgo < 60) return `${minutesAgo} min ago`;
  const hours = Math.floor(minutesAgo / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
});
