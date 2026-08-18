// Auth-state gate. Three branches:
//
//   loading         → null (the splash UI takes over until hydrate resolves;
//                     for Sprint 2 we render a quiet placeholder so the
//                     navigator container doesn't blink an empty stack)
//   unauthenticated → AuthStack (fork → signup/signin → OTP)
//   authenticated   → CaregiverStack or SelfBuyerStack, selected by
//                     profile.account_type. Caregivers without a completed
//                     onboarding render the CaregiverOnboardingStack first
//                     (Sprint 3).
//
// `parent` (D8a §1.3 invitation flow) routes to a placeholder for now;
// Sprint 5 covers the parent-pairing handoff.

import { useEffect, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountTypeForkScreen } from '../screens/Onboarding/AccountTypeFork';
import { SignUpScreen } from '../screens/Auth/SignUp';
import { SignInScreen } from '../screens/Auth/SignIn';
import { OTPVerifyScreen } from '../screens/Auth/OTPVerify';
import { CaregiverIntro1Screen } from '../screens/Onboarding/Caregiver/Intro1';
import { CaregiverIntro2Screen } from '../screens/Onboarding/Caregiver/Intro2';
import { CaregiverIntro3Screen } from '../screens/Onboarding/Caregiver/Intro3';
import { CaregiverFamilyYouScreen } from '../screens/Onboarding/Caregiver/FamilyYou';
import { CaregiverFamilyParentScreen } from '../screens/Onboarding/Caregiver/FamilyParent';
import { CaregiverFamilyWatchScreen } from '../screens/Onboarding/Caregiver/FamilyWatch';
import { SelfBuyerIntro1Screen } from '../screens/Onboarding/SelfBuyer/Intro1';
import { SelfBuyerIntro2Screen } from '../screens/Onboarding/SelfBuyer/Intro2';
import { SelfBuyerIntro3Screen } from '../screens/Onboarding/SelfBuyer/Intro3';
import { SelfBuyerYouScreen } from '../screens/Onboarding/SelfBuyer/You';
import { SelfBuyerWatchScreen } from '../screens/Onboarding/SelfBuyer/Watch';
import { CaregiverHome } from '../screens/Home/CaregiverHome';
import { ParentDashboard } from '../screens/Home/ParentDashboard';
import { SelfBuyerHome } from '../screens/Home/SelfBuyerHome';
import { SelfBuyerHomePlaceholder } from '../screens/Placeholders/SelfBuyerHomePlaceholder';
import { VitalDetailRouter } from '../screens/VitalDetail/VitalDetailRouter';
import { VitalHistoryScreen } from '../screens/VitalHistory/VitalHistoryScreen';
import { PdfPreviewScreen } from '../screens/PdfPreview/PdfPreviewScreen';
import { PairingScreen } from '../screens/Pairing/PairingScreen';
import { SettingsScreen } from '../screens/Settings/SettingsScreen';
import { TakeReadingScreen } from '../screens/TakeReading/TakeReadingScreen';
import { ReadingDetailScreen } from '../screens/ReadingDetail/ReadingDetailScreen';
import { Trends } from '../screens/Trends/Trends';
import { ForYourDoctorScreen } from '../screens/ForYourDoctor/ForYourDoctorScreen';
import { AuditLogScreen } from '../screens/AuditLog/AuditLogScreen';
import { CaregiverVisibilityScreen } from '../screens/CaregiverVisibility/CaregiverVisibilityScreen';
import { FamilyMembersScreen } from '../screens/FamilyMembers/FamilyMembersScreen';
import { AccountSwitchScreen } from '../screens/AccountSwitch/AccountSwitchScreen';
import { LearnScreen } from '../screens/Learn/LearnScreen';
import { LearnClusterScreen } from '../screens/Learn/LearnClusterScreen';
import { ArticleScreen } from '../screens/Learn/ArticleScreen';
import { AskLeikoScreen } from '../screens/AskLeiko/AskLeikoScreen';
import { DebugLauncher } from '../dev/DebugLauncher';
import { OfflineBanner } from '../components/OfflineBanner';
import { useEnforceVisibility } from '../hooks/useEnforceVisibility';
import { useTheme } from '../theme';
import { useAuth } from '../state/auth';
import { useOnboarding } from '../state/onboarding';
import { usePairing } from '../state/pairing';
import { useReadings } from '../state/readings';
import { useSyncOrchestrator } from '../state/syncOrchestrator';
import {
  startHealthPlatformBackgroundFetch,
  stopHealthPlatformBackgroundFetch,
} from '../services/health-platform/backgroundFetch';
import { configurePurchases } from '../services/purchases';
import {
  startBackgroundSync,
  stopBackgroundSync,
} from '../services/sync/backgroundSync';
import { mmkv, STORAGE_KEYS } from '../services/storage';
import { wireDeviceMetaProvider } from '../state/wireDeviceMetaProvider';
import { startBleForegroundService } from '../services/ble/foregroundService';
import { scheduleNextLearnedTimeReminder } from '../services/reminders/dispatcher';
import { configureNotificationHandler } from '../services/notifications';
import { startNotificationListeners } from '../services/notifications/listeners';
import { registerRemoteRefreshTask } from '../services/notifications/remoteRefreshTask';
import { usePushRegistration } from '../hooks/usePushRegistration';
import { navigationRef } from './navigationRef';

// Define the OS-scheduled background-sync task once at module load.
// TaskManager rejects redefinition, and module load is the only
// guaranteed pre-render hook. The runner reads the orchestrator's
// runSync at fire time — not at definition time — so the latest
// orchestrator instance handles the wake-up.
// Both OS-woken tasks are DEFINED at app entry (index.js →
// services/tasks/registerHeadlessTasks), not here. This module only
// evaluates once a screen renders, which never happens on a headless
// wake-up — defining them here meant a cold background fetch found no
// runner at all. What stays here is REGISTRATION with the OS
// (startBackgroundSync / registerRemoteRefreshTask, in the boot effect
// below): that needs to happen once per install and is fine to do from
// the UI, since the OS persists it across sessions.

// Wire postReading's device-meta provider for the UI path. The shared
// implementation lives in state/wireDeviceMetaProvider so the headless
// path (hydrateForHeadlessRun) can wire it too — this module scope
// never executes on an OS wake-up, and relying on it alone left
// background runs unable to upload watch readings (§6e,
// plans/BACKGROUND_SYNC_INVESTIGATION_2026-08-14.md).
wireDeviceMetaProvider();
import type {
  AuthStackParamList,
  CaregiverOnboardingStackParamList,
  CaregiverStackParamList,
  SelfBuyerOnboardingStackParamList,
  SelfBuyerStackParamList,
} from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const CaregiverStack = createNativeStackNavigator<CaregiverStackParamList>();
const CaregiverOnboardingStack =
  createNativeStackNavigator<CaregiverOnboardingStackParamList>();
const SelfBuyerStack = createNativeStackNavigator<SelfBuyerStackParamList>();
const SelfBuyerOnboardingStack =
  createNativeStackNavigator<SelfBuyerOnboardingStackParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator
      initialRouteName="AccountTypeFork"
      screenOptions={{ headerShown: false }}
    >
      <AuthStack.Screen name="AccountTypeFork" component={AccountTypeForkScreen} />
      <AuthStack.Screen name="SignUp" component={SignUpScreen} />
      <AuthStack.Screen name="SignIn" component={SignInScreen} />
      <AuthStack.Screen name="OTPVerify" component={OTPVerifyScreen} />
    </AuthStack.Navigator>
  );
}

function CaregiverOnboardingNavigator() {
  return (
    <CaregiverOnboardingStack.Navigator
      initialRouteName="Intro1"
      screenOptions={{ headerShown: false, gestureEnabled: false }}
    >
      <CaregiverOnboardingStack.Screen name="Intro1" component={CaregiverIntro1Screen} />
      <CaregiverOnboardingStack.Screen name="Intro2" component={CaregiverIntro2Screen} />
      <CaregiverOnboardingStack.Screen name="Intro3" component={CaregiverIntro3Screen} />
      <CaregiverOnboardingStack.Screen name="FamilyYou" component={CaregiverFamilyYouScreen} />
      <CaregiverOnboardingStack.Screen
        name="FamilyParent"
        component={CaregiverFamilyParentScreen}
      />
      <CaregiverOnboardingStack.Screen
        name="FamilyWatch"
        component={CaregiverFamilyWatchScreen}
      />
    </CaregiverOnboardingStack.Navigator>
  );
}

function CaregiverHomeNavigator() {
  return (
    <CaregiverStack.Navigator screenOptions={{ headerShown: false }}>
      <CaregiverStack.Screen name="CaregiverHome" component={CaregiverHome} />
      <CaregiverStack.Screen name="ParentDashboard" component={ParentDashboard} />
      <CaregiverStack.Screen name="VitalDetail" component={VitalDetailRouter} />
      <CaregiverStack.Screen name="VitalHistory" component={VitalHistoryScreen} />
      <CaregiverStack.Screen name="PdfPreview" component={PdfPreviewScreen} />
      <CaregiverStack.Screen name="Pairing" component={PairingScreen} />
      <CaregiverStack.Screen name="Settings" component={SettingsScreen} />
      <CaregiverStack.Screen name="TakeReading" component={TakeReadingScreen} />
      <CaregiverStack.Screen name="ReadingDetail" component={ReadingDetailScreen} />
      <CaregiverStack.Screen name="Trends" component={Trends} />
      <CaregiverStack.Screen
        name="ForYourDoctor"
        component={ForYourDoctorScreen}
      />
      <CaregiverStack.Screen name="AuditLog" component={AuditLogScreen} />
      <CaregiverStack.Screen
        name="CaregiverVisibility"
        component={CaregiverVisibilityScreen}
      />
      <CaregiverStack.Screen
        name="FamilyMembers"
        component={FamilyMembersScreen}
      />
      <CaregiverStack.Screen name="AccountSwitch" component={AccountSwitchScreen} />
      <CaregiverStack.Screen name="Learn" component={LearnScreen} />
      <CaregiverStack.Screen name="LearnCluster" component={LearnClusterScreen} />
      <CaregiverStack.Screen name="Article" component={ArticleScreen} />
      <CaregiverStack.Screen name="AskLeiko" component={AskLeikoScreen} />
    </CaregiverStack.Navigator>
  );
}

function CaregiverNavigator() {
  const onboardingComplete = useOnboarding((s) => s.caregiverOnboardingComplete);
  return onboardingComplete ? <CaregiverHomeNavigator /> : <CaregiverOnboardingNavigator />;
}

function SelfBuyerOnboardingNavigator() {
  return (
    <SelfBuyerOnboardingStack.Navigator
      initialRouteName="Intro1"
      screenOptions={{ headerShown: false, gestureEnabled: false }}
    >
      <SelfBuyerOnboardingStack.Screen name="Intro1" component={SelfBuyerIntro1Screen} />
      <SelfBuyerOnboardingStack.Screen name="Intro2" component={SelfBuyerIntro2Screen} />
      <SelfBuyerOnboardingStack.Screen name="Intro3" component={SelfBuyerIntro3Screen} />
      <SelfBuyerOnboardingStack.Screen name="You" component={SelfBuyerYouScreen} />
      <SelfBuyerOnboardingStack.Screen name="Watch" component={SelfBuyerWatchScreen} />
    </SelfBuyerOnboardingStack.Navigator>
  );
}

function SelfBuyerHomeNavigator() {
  // Sprint 8 — Self-Buyer Daily Pulse home replaces the placeholder as the
  // initial route. The placeholder route is kept registered so any in-flight
  // dev tooling that deep-links to it still resolves; it is no longer
  // surfaced to the user.
  //
  // ADR-0006 — consume the one-shot pairOnLaunch flag. Onboarding's "I have
  // the watch" sets it; Pairing lives on THIS (home) stack, so we open it
  // right after the onboarding gate flips and this navigator mounts.
  useEffect(() => {
    if (!mmkv.getBoolean(STORAGE_KEYS.pairOnLaunch)) return;
    mmkv.remove(STORAGE_KEYS.pairOnLaunch);
    // Defer until the navigator is ready, then push Pairing over the home.
    const t = setTimeout(() => {
      if (navigationRef.isReady()) {
        navigationRef.navigate('Pairing' as never);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <SelfBuyerStack.Navigator
      initialRouteName="CaregiverHome"
      screenOptions={{ headerShown: false }}
    >
      {/* ADR-0006 Phase 2/3 — unified constellation home is the landing
          screen for every persona. The self-buyer's own self-circle shows
          as the "You" node; tapping it opens the immersive personal view
          (ParentDashboard). The legacy SelfBuyerHome stays registered as
          that detail target and for deep-links. */}
      <SelfBuyerStack.Screen name="CaregiverHome" component={CaregiverHome} />
      <SelfBuyerStack.Screen name="ParentDashboard" component={ParentDashboard} />
      <SelfBuyerStack.Screen name="SelfBuyerHome" component={SelfBuyerHome} />
      <SelfBuyerStack.Screen
        name="SelfBuyerHomePlaceholder"
        component={SelfBuyerHomePlaceholder}
      />
      <SelfBuyerStack.Screen name="Pairing" component={PairingScreen} />
      <SelfBuyerStack.Screen name="Settings" component={SettingsScreen} />
      <SelfBuyerStack.Screen name="TakeReading" component={TakeReadingScreen} />
      <SelfBuyerStack.Screen name="ReadingDetail" component={ReadingDetailScreen} />
      <SelfBuyerStack.Screen name="VitalDetail" component={VitalDetailRouter} />
      <SelfBuyerStack.Screen name="VitalHistory" component={VitalHistoryScreen} />
      <SelfBuyerStack.Screen name="PdfPreview" component={PdfPreviewScreen} />
      <SelfBuyerStack.Screen name="Trends" component={Trends} />
      <SelfBuyerStack.Screen
        name="ForYourDoctor"
        component={ForYourDoctorScreen}
      />
      <SelfBuyerStack.Screen name="AuditLog" component={AuditLogScreen} />
      <SelfBuyerStack.Screen
        name="CaregiverVisibility"
        component={CaregiverVisibilityScreen}
      />
      <SelfBuyerStack.Screen
        name="FamilyMembers"
        component={FamilyMembersScreen}
      />
      <SelfBuyerStack.Screen name="AccountSwitch" component={AccountSwitchScreen} />
      <SelfBuyerStack.Screen name="Learn" component={LearnScreen} />
      <SelfBuyerStack.Screen name="LearnCluster" component={LearnClusterScreen} />
      <SelfBuyerStack.Screen name="Article" component={ArticleScreen} />
      <SelfBuyerStack.Screen name="AskLeiko" component={AskLeikoScreen} />
    </SelfBuyerStack.Navigator>
  );
}

function SelfBuyerNavigator() {
  const onboardingComplete = useOnboarding((s) => s.selfBuyerOnboardingComplete);
  return onboardingComplete ? <SelfBuyerHomeNavigator /> : <SelfBuyerOnboardingNavigator />;
}

function HydratingFallback() {
  const theme = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: theme.colors.surface.base }]}>
      <ActivityIndicator color={theme.colors.brand.primary} />
    </View>
  );
}

/**
 * Sprint 16.6 FUN-4 — wire the learned-time reminder dispatcher to
 * current app state. Pure-ish: reads the store snapshots directly so
 * it does not depend on React rendering. Self-buyer fires "you"
 * copy; caregiver fires a neutral label until per-parent resolution is
 * wired through useCaregiverFamily (TODO follow-up).
 * The "parent" persona route is read-only by spec, so we skip it.
 *
 * Sprint 19 (audit D12 P0-8) — the caregiver fallback was "your loved
 * one", a HARD FAIL in docs/05-voice-and-claims.md §87, and it reached
 * the lock screen because local notifications bypass the voice gate the
 * server path enforces. `dispatcher.ts` now lints too, but the correct
 * label matters more than the safety net.
 */
const CAREGIVER_REMINDER_FALLBACK_LABEL = 'your family member';

function scheduleLearnedTimeFromCurrentState(): Promise<unknown> | void {
  const accountType = useAuth.getState().profile?.account_type;
  if (!accountType || accountType === 'parent') return;
  const isSelf = accountType === 'self_buyer';
  const readings = useReadings.getState().recent ?? [];
  const parentLabel = isSelf ? '' : CAREGIVER_REMINDER_FALLBACK_LABEL;
  return scheduleNextLearnedTimeReminder({ readings, parentLabel, isSelf });
}

export function RootNavigator() {
  const status = useAuth((s) => s.status);
  const accountType = useAuth((s) => s.profile?.account_type);
  const hydrate = useAuth((s) => s.hydrate);
  const hydratePairing = usePairing((s) => s.hydrate);
  const hydrateReadings = useReadings((s) => s.hydrate);
  const syncPending = useReadings((s) => s.syncPending);
  const startOrchestrator = useSyncOrchestrator((s) => s.start);
  const stopOrchestrator = useSyncOrchestrator((s) => s.stop);

  // Single QueryClient instance for the app's lifetime. MMKV remains
  // the offline source of truth (per docs/01-data-model.md "Sync
  // strategy"); Query holds the in-memory server-state cache only —
  // no disk persistence configured.
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );

  useEffect(() => {
    void hydrate();
    hydratePairing();
    // If a watch was already paired in a prior session, re-arm the
    // Android foreground service on cold start so background BLE sync
    // survives Doze. hydratePairing() above populates pairedDevice
    // synchronously from MMKV. No-op on iOS / when no watch is paired.
    if (usePairing.getState().pairedDevice) {
      void startBleForegroundService();
    }
    hydrateReadings();
    // Best-effort: try to sync any pending readings on app cold start
    // (offline captures from a previous session).
    void syncPending();
    // Sprint 7: register the sync orchestrator's AppState + BT
    // listeners and fire the cold-start sync. Idempotent.
    startOrchestrator();
    // Sprint 9.5 / Task 7: register the health-platform read trigger.
    // Fires on every app foreground; internally debounced to 24h.
    // Caregiver / master-off / no-toggles short-circuit silently.
    startHealthPlatformBackgroundFetch();
    // Sprint 10a: configure RevenueCat once per app session. No-ops
    // when EXPO_PUBLIC_RC_API_KEY_* env vars aren't set; the auth
    // store calls identifyPurchaser separately on session change.
    void configurePurchases();
    // Sprint 10c.2 polish — register the OS-scheduled watch sync.
    // No-ops when expo-background-fetch / expo-task-manager aren't
    // present (dev workspace without the native side). The dev-client
    // APK rebuild pulls them in.
    void startBackgroundSync();
    // Sprint 15 — push notifications. Configure the foreground display
    // behaviour + Android channels (idempotent). Token REGISTRATION is
    // handled by the auth-driven effect below, not here: registering at
    // mount raced auth hydration and returned no_user for anyone who
    // signed in after this mounted, leaving push_tokens empty. Listener
    // handles tap → deep-link routing.
    void configureNotificationHandler();
    // Attach the remote-refresh background notification task (defined at
    // module load above). No-ops without the native side / on iOS sandbox.
    void registerRemoteRefreshTask();
    // Sprint 16.6 FUN-4 — learned-time reminder dispatcher. Reads
    // current readings + persona from the stores and schedules the
    // next one-shot reminder. The dispatcher cancel-and-reschedules,
    // so re-running on foreground (when the orchestrator does its
    // own re-fire) keeps the schedule fresh as readings come in.
    void scheduleLearnedTimeFromCurrentState();
    const notifListeners = startNotificationListeners();
    return () => {
      stopOrchestrator();
      stopHealthPlatformBackgroundFetch();
      void stopBackgroundSync();
      notifListeners.stop();
    };
  }, [
    hydrate,
    hydratePairing,
    hydrateReadings,
    syncPending,
    startOrchestrator,
    stopOrchestrator,
  ]);

  // Push-token registration — auth-driven + on foreground (see hook).
  // Replaces the Sprint 15 mount-only call that raced auth hydration and
  // left public.push_tokens empty for users who signed in post-mount.
  usePushRegistration(status === 'authenticated');

  let content: React.ReactNode;
  if (status === 'loading') {
    content = <HydratingFallback />;
  } else if (status === 'unauthenticated') {
    content = <AuthNavigator />;
  } else if (accountType === 'self_buyer') {
    content = <SelfBuyerNavigator />;
  } else {
    // caregiver and parent both render the caregiver placeholder for
    // Sprint 2; Sprint 5 splits parent off.
    content = <CaregiverNavigator />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      {/* Sprint 17b — visibility enforcement. Subscribes to UPDATEs
          on the signed-in user's family_members row and purges
          singleton-slice `recent` + TanStack caches when a vital
          flips visible → hidden. Must be inside QueryClientProvider
          because it uses useQueryClient. */}
      <VisibilityEnforcer />
      {/* navigationRef is typed loosely so jest-expo's mock can stand
          in for it in tests. Cast here so NavigationContainer's
          stricter ref shape accepts it. */}
      <NavigationContainer ref={navigationRef as never}>{content}</NavigationContainer>
      {/* Sprint 16 — global offline banner. Renders only when the
          network-status hook (5s debounce on offline transitions)
          reports an unambiguous offline state. Mounted outside the
          NavigationContainer so it overlays every screen including
          the auth + onboarding stacks. */}
      <OfflineBanner testID="root-offline-banner" />
      {/* Sprint 10c.2 polish — DEV-only floating sync-debug launcher.
          Production builds strip __DEV__; the component returns null. */}
      <DebugLauncher />
    </QueryClientProvider>
  );
}

// Sprint 17b — single-purpose wrapper so the hook is called inside
// the QueryClientProvider tree (useQueryClient requires it). Returns
// null; pure side-effect.
function VisibilityEnforcer(): null {
  useEnforceVisibility();
  return null;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
