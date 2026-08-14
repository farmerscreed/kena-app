// Deep-link routing — Sprint 15.
//
// Maps a `leiko://...` URL (or its https://leiko.app/... Universal
// Link variant) to a navigation action. Single registry consumed by:
//
//   1. The Expo Notifications response listener — fires when a user
//      taps a push notification, foreground or background.
//   2. `Linking.addEventListener('url', ...)` — fires when the OS
//      hands us a URL while the app is already running (e.g. tapping
//      an https link in WhatsApp).
//   3. `Linking.getInitialURL()` — cold-start path.
//
// The dispatcher uses a navigation ref so any caller can navigate
// without an active screen scope. The ref is exported from
// `navigation/navigationRef.ts` and attached to NavigationContainer
// in RootNavigator.
//
// Per docs/11-push-notifications.md §3, the supported routes are:
//   leiko://home                       → Home
//   leiko://weekly                     → Trends (weekly view tab)
//   leiko://reading/{readingId}        → Reading Detail
//   leiko://vital/{kind}               → Vital Detail (HR/SpO2/Sleep/Activity)
//   leiko://settings                   → Settings
//   leiko://settings/devices           → Settings (devices section)
//   leiko://settings/subscription      → Settings (subscription section)
//   leiko://family                     → Family Members
//
// Per CLAUDE.md voice rules: the deep-link strings themselves are not
// user-visible, but the destinations are. No copy lives here.

import { logger } from '../analytics/logger';
import { navigationRef } from '../../navigation/navigationRef';
import { stashPendingCareInvite } from '../families/pendingCareInvite';
import { parseDeepLink, type ParsedDeepLink } from './deepLinkParser';

export { parseDeepLink, type ParsedDeepLink };

/**
 * Dispatch a parsed deep-link via the navigation ref. Safe to call
 * when the navigator is still hydrating — falls back to no-op until
 * the ref is ready.
 */
export function dispatchDeepLink(parsed: ParsedDeepLink): void {
  if (!navigationRef.isReady()) return;
  switch (parsed.category) {
    case 'home':
      // Pop to root of the active stack; the Caregiver / SelfBuyer
      // navigator selects which root that is.
      navigationRef.navigate('CaregiverHome' as never);
      return;
    case 'weekly':
      navigationRef.navigate('Trends' as never);
      return;
    case 'reading':
      if (parsed.readingId) {
        // The ReadingDetail screen accepts a local id; server ids
        // come with a `srv-` prefix when seeded from the hydrate hook.
        const localId = parsed.readingId.startsWith('srv-')
          ? parsed.readingId
          : `srv-${parsed.readingId}`;
        (navigationRef as unknown as { navigate: (n: string, p: unknown) => void }).navigate(
          'ReadingDetail',
          { readingLocalId: localId },
        );
      }
      return;
    case 'vital':
      if (parsed.vital) {
        (navigationRef as unknown as { navigate: (n: string, p: unknown) => void }).navigate(
          'VitalDetail',
          { vital: parsed.vital },
        );
      }
      return;
    case 'settings':
    case 'settings_devices':
    case 'settings_subscription':
      navigationRef.navigate('Settings' as never);
      return;
    case 'family':
      navigationRef.navigate('FamilyMembers' as never);
      return;
    case 'join':
      // Connect Phase C — a tapped invite link. Stash the code FIRST:
      // when the user is signed out or mid-onboarding the Settings
      // route below doesn't exist and the navigate is a silent no-op,
      // but the stash survives to prefill the "Someone invited me"
      // onboarding path. Signed-in users on the main stack land in
      // Settings with the Enter-a-code sheet opened and prefilled; the
      // sheet clears the stash on a successful accept.
      if (parsed.inviteCode) stashPendingCareInvite(parsed.inviteCode);
      (navigationRef as unknown as { navigate: (n: string, p: unknown) => void }).navigate(
        'Settings',
        { inviteCode: parsed.inviteCode },
      );
      return;
    case 'unknown':
      return;
  }
}

/** Parse then dispatch in one step. Logs the open event. */
export function handleDeepLink(url: string, category?: string): void {
  const parsed = parseDeepLink(url);
  logger.track('push_opened', { category: category ?? parsed.category, deepLink: url });
  dispatchDeepLink(parsed);
}
