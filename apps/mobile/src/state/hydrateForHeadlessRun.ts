// Load the MMKV-backed stores a watch sync depends on, for a run that
// starts without the UI.
//
// RootNavigator hydrates pairing + readings in a mount effect, so every
// store is populated whenever a screen has rendered. An OS-woken run has
// no such guarantee: expo-task-manager spins up a bare JS context, module
// scope evaluates, the task runs, and no component ever mounts. That
// happens after a reboot (the fetch task registers startOnBoot), after
// the OS reclaims the process, and after an app update — i.e. exactly the
// "hasn't opened the app in a day" case background sync exists to serve.
//
// Two things break without this:
//
//   1. usePairing.pairedDevice is null, so runSync takes the
//      no_paired_device branch and never reaches the watch. Observed
//      2026-08-14: a background fetch fired 16 minutes after an app
//      reinstall and made no BLE connection at all.
//
//   2. Worse, useReadings.syncPending() rewrites `pending` and `recent`
//      from in-memory state at the end of its run. Starting empty, it
//      persists two empty arrays over whatever was in MMKV — silently
//      destroying readings captured offline and not yet uploaded.
//
// The vitals slices (hr / spo2 / sleep / activity) need no equivalent:
// their addPending appends to an MMKV buffer and re-reads it, so a stale
// in-memory array can't clobber stored samples.
//
// Idempotent: hydrate() re-reads MMKV, and every store mutation persists
// immediately, so MMKV is always the source of truth. Safe to call on a
// process that the UI already hydrated.

import { supabase } from '../services/supabase';
import { SYNC_UPLOAD_TIMEOUT_MS, withTimeout } from '../services/sync/withTimeout';
import { logger } from '../services/analytics/logger';
import { usePairing } from './pairing';
import { useReadings } from './readings';
import { wireDeviceMetaProvider } from './wireDeviceMetaProvider';

export function hydrateForHeadlessRun(): void {
  // postReading resolves watch-reading device meta through an injected
  // provider that the UI path wires in RootNavigator's module scope —
  // which never evaluates on an OS wake-up. Without this, a headless
  // run pulls the reading off the watch and saves it, but the upload
  // throws "no paired device on file" and worse, syncPending bails on
  // that first failure, so any offline backlog behind it stalls too.
  wireDeviceMetaProvider();
  // Best-effort per store: a corrupt blob in one must not stop the other
  // from loading, and must never take the sync run down with it.
  try {
    usePairing.getState().hydrate();
  } catch {
    // runSync will skip with no_paired_device rather than crash.
  }
  try {
    useReadings.getState().hydrate();
  } catch {
    // syncPending has nothing to flush; the watch pull still runs.
  }
}

// Margin before expiry at which we force a refresh rather than trust the
// token to outlive the run. A full drain can take minutes and there is no
// auto-refresh tick to save us mid-run.
const SESSION_REFRESH_MARGIN_SEC = 5 * 60;

/**
 * Make sure the Supabase client holds a usable access token BEFORE a
 * headless run uploads anything.
 *
 * Two independent reasons a background run would otherwise POST with no
 * (or a dead) token, both observed on-device 2026-08-15:
 *
 *   1. Cold-start race. The client recovers its session from
 *      expo-secure-store asynchronously at module load. Nothing in a
 *      headless run awaits that, so an upload can fire first. The 15:56
 *      and 20:20 runs (both cold — "Creating ReactInstance" in logcat)
 *      failed every upload; the 16:13 run, on a warm process, succeeded.
 *
 *   2. No refresh loop. `autoRefreshToken` is driven by a setInterval
 *      that never fires headless (§9) and by an AppState 'active' event
 *      that a background process never sees. A token older than its TTL
 *      is therefore never renewed — matching the BP reading that sat
 *      unsent from 09:46 to 16:13 while every cycle retried it.
 *
 * Best-effort by design: a failure here must NOT skip the run. The watch
 * pull still persists to MMKV, and the next cycle retries the upload —
 * pulling with a dead token is strictly better than not pulling at all.
 */
export async function ensureSessionForHeadlessRun(): Promise<boolean> {
  try {
    const { data, error } = await withTimeout(
      supabase.auth.getSession(),
      SYNC_UPLOAD_TIMEOUT_MS,
      'auth.getSession',
    );
    if (error || !data.session) {
      logger.track('headless_session_missing', {
        reason: error ? error.message : 'no_session',
      });
      return false;
    }
    const expiresAtSec = data.session.expires_at ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);
    if (expiresAtSec - nowSec > SESSION_REFRESH_MARGIN_SEC) return true;
    // Expiring (or expired): renew explicitly. getSession() only refreshes
    // an ALREADY-expired token, which would leave a run that starts with
    // 30 s of validity uploading into a 401 halfway through.
    const refreshed = await withTimeout(
      supabase.auth.refreshSession(),
      SYNC_UPLOAD_TIMEOUT_MS,
      'auth.refreshSession',
    );
    if (refreshed.error || !refreshed.data.session) {
      logger.track('headless_session_refresh_failed', {
        reason: refreshed.error ? refreshed.error.message : 'no_session',
      });
      return false;
    }
    logger.track('headless_session_refreshed');
    return true;
  } catch (e) {
    logger.track('headless_session_refresh_failed', {
      reason: e instanceof Error ? e.message : 'unknown',
    });
    return false;
  }
}
