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
