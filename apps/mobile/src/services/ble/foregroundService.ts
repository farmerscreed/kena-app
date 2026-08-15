// Foreground service wrapper. Keeps the BLE link to the Leiko watch
// alive while the app is backgrounded, with a persistent system
// notification ("Leiko · Connected to your watch") visible to the
// user. Required by Play Console policy for the
// FOREGROUND_SERVICE_CONNECTED_DEVICE permission, and structurally
// important because the Family Circle feature depends on near-
// real-time syncing while the user isn't actively in the app.
//
// On iOS this whole module is a no-op — iOS background BLE is
// handled differently (Core Bluetooth background mode + state
// preservation/restoration). The wrapper signature stays the same
// across platforms so call sites don't need Platform checks.

import { NativeModules, Platform } from 'react-native';
import { logger } from '../analytics/logger';

interface NativeApi {
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
}

const native: NativeApi | undefined =
  Platform.OS === 'android'
    ? (NativeModules.LeikoBleForegroundService as NativeApi | undefined)
    : undefined;

let running = false;

/** Idempotent — calling start() twice in a row is safe. */
export async function startBleForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (running) return;
  if (!native) {
    logger.track('ble_fg_unavailable', { reason: 'native_module_missing' });
    return;
  }
  try {
    await native.start();
    running = true;
    logger.track('ble_fg_started');
  } catch (e) {
    logger.track('ble_fg_start_failed', {
      reason: e instanceof Error ? e.message : 'unknown',
    });
  }
}

export async function stopBleForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!running) return;
  if (!native) return;
  try {
    await native.stop();
    running = false;
    logger.track('ble_fg_stopped');
  } catch (e) {
    logger.track('ble_fg_stop_failed', {
      reason: e instanceof Error ? e.message : 'unknown',
    });
  }
}

export function isBleForegroundServiceRunning(): boolean {
  return running;
}

// Number of in-flight withBleForegroundService scopes. A stale reset
// (state/syncOrchestrator) hands the sync engine to a NEW run while the
// old run's finally-block is still pending — a boolean was-running guard
// let whichever scope finished first stop the service under the
// survivor. The hold-count releases only when the LAST scope exits.
let holds = 0;
// True when the service was started outside any scope (RootNavigator's
// boot effect); scopes then never stop it — the UI owns its lifetime.
let uiOwned = false;

/**
 * Run `fn` while holding the foreground service, releasing it when the
 * last concurrent holder exits — unless a UI flow started the service
 * first, in which case it is left untouched.
 *
 * Why: Android freezes cached processes shortly after a background
 * wake — observed on Pixel 8 / Android 17: frozen 9–18 s in, every
 * cycle, even on USB power. That is enough for the BP-backlog leg but
 * starves the multi-vitals leg (a full day of HR/steps/sleep chunks
 * over BLE), so heavy-wear days never drain in the background. A
 * process hosting a foreground service is exempt from the freezer for
 * the service's lifetime.
 *
 * Failure mode: on Android 12+ a background start is only permitted
 * for battery-exempt apps (Settings → Watch → "Background updates"
 * steers users there). startBleForegroundService never throws — a
 * denied start is tracked as ble_fg_start_failed and the sync simply
 * runs under today's freezer budget instead.
 */
export async function withBleForegroundService<T>(fn: () => Promise<T>): Promise<T> {
  // Re-evaluated whenever a new scope-group begins (holds 0 → 1), so a
  // UI stop between groups doesn't leave a stale ownership latch.
  if (holds === 0) uiOwned = isBleForegroundServiceRunning();
  holds++;
  await startBleForegroundService();
  try {
    return await fn();
  } finally {
    holds--;
    if (holds === 0 && !uiOwned) await stopBleForegroundService();
  }
}

/** Test surface */
export function _resetBleForegroundServiceHoldsForTests(): void {
  holds = 0;
  uiOwned = false;
}

/** Test surface */
export function _resetBleForegroundServiceForTests(): void {
  running = false;
}
