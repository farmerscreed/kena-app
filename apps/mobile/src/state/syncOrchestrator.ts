// Sync orchestrator — Sprint 7.
//
// Runs on the OWNING phone (the one paired to the watch). Owns the
// trigger inventory from the founder-approved Sprint 7 architecture
// intent: app foreground, BT_READY transition, cold start, and the
// manual "force sync now" button. Non-owning phones (caregivers in a
// different city) don't run this — they read from Supabase via
// useFamilyReadings + Realtime.
//
// What it does on each run:
//   1. Push local pending writes via useReadings.syncPending().
//   2. If a paired device is known, connect.
//   3. syncBacklogToCompletion — loops syncBacklog until the watch
//      returns an empty page (handles the >50-reading backlog case).
//   4. Subscribe to 0x73 0x02 (BP-ready) so a live capture during the
//      open window triggers another pull + resets the idle timer.
//   5. Disconnect after IDLE_DISCONNECT_MS of no activity.
//
// Mutex with takeReading: when useTakeReading is mid-flow it owns the
// device; the orchestrator yields. This keeps Sprint 6's connect-on-
// demand capture flow intact while we add scheduled sync.
//
// Per CLAUDE.md: reading values never appear in analytics events. The
// orchestrator only emits counts + outcomes.

import { create } from 'zustand';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import type { State as BluetoothState, Subscription } from 'react-native-ble-plx';
import { connectToUrion, observeBluetoothState } from '../services/ble/bleManager';
import { subscribeToNotifications } from '../services/ble/notify';
import { syncBacklogToCompletion } from '../services/sync/syncBacklogToCompletion';
import { syncMultiVitals } from '../services/sync/syncMultiVitals';
import { applyDeviceConfig } from '../services/sync/applyDeviceConfig';
import { inferModel } from '../services/sync/postReading';
import {
  clearSyncFailure,
  markSyncFailure,
} from '../services/sync/syncFailureTracker';
import { logger } from '../services/analytics/logger';
import type { UrionDevice } from '../services/ble/UrionDevice';
import { usePairing } from './pairing';
import { useReadings } from './readings';
import { useTakeReading } from './takeReading';

// 45s strikes the balance the architecture intent calls out: long
// enough that a parent who took a reading and is about to take another
// keeps the connection warm, short enough that a phone-in-pocket
// background sync doesn't keep the GATT link alive at battery cost.
const IDLE_DISCONNECT_MS = 45_000;

// Don't kick off another sync within this window of the last completed
// one. The orchestrator runs on multiple triggers; without a debounce a
// single user action (background-then-foreground in a few seconds) can
// queue 2-3 redundant runs.
const MIN_SYNC_INTERVAL_MS = 5_000;

// Watchdog for a dead run. Historically a wedged run blocked every later
// trigger with already_running for as long as 47 minutes (2026-08-14).
// Since the §8/§9 fixes (freezer exemption + headless-safe timeouts) a
// run can be LEGITIMATELY long — draining a full day of vitals takes
// minutes — so staleness is measured from the run's last sign of life,
// not its start: every received BLE packet refreshes _runStartedAt (see
// the onNotify heartbeat in runSync). 3 min of SILENCE means every
// io-level timeout (5-15 s) has long since had its chance to recover;
// the run is presumed dead and reaped.
const STALE_RUN_RESET_MS = 3 * 60_000;

export type SyncTrigger =
  | 'cold_start'
  | 'app_foreground'
  | 'bt_ready'
  | 'manual_force'
  | 'live_notify'
  // Sprint 10c.2 polish — OS-scheduled background wake-up. Fired by
  // services/sync/backgroundSync.ts via expo-background-fetch /
  // BGTaskScheduler / WorkManager. Promoted from v1.1 to v1.0 so the
  // app stays "always populated" even when users go a day or two
  // without opening it.
  | 'background'
  // Remote-refresh — a family member asked this (watch-owner's) phone to
  // sync now via a silent push (send-push 'sync_refresh'). Delivered to a
  // background notification task or the foreground received-listener.
  // Bypasses the debounce like manual_force: it's an explicit request.
  | 'remote_refresh';

export type SyncStatus =
  | 'idle'
  | 'connecting'
  | 'syncing'
  | 'live'      // connected, idle-window open, listening for 0x73 BP-ready
  | 'error';

export type SyncSkipReason =
  | 'no_paired_device'
  | 'take_reading_active'
  | 'too_recent'
  | 'already_running';

interface SyncOrchestratorState {
  status: SyncStatus;
  lastSyncAt: number | null;
  lastError: string | null;
  /** Set by start(), prevents double-registration of listeners. */
  _started: boolean;
  _device: UrionDevice | null;
  _appStateSub: NativeEventSubscription | null;
  _btStateSub: Subscription | null;
  _idleTimer: ReturnType<typeof setTimeout> | null;
  _unsubNotify: (() => void) | null;
  _lastBtState: BluetoothState | null;
  /** Last known AppStateStatus — drives foreground-edge detection. */
  _lastAppState: AppStateStatus | null;
  /** When the in-flight run claimed the engine — drives the stale watchdog. */
  _runStartedAt: number | null;

  start: () => void;
  stop: () => void;
  /** Returns 'ran' | 'skipped'. Trigger is logged regardless. */
  runSync: (trigger: SyncTrigger) => Promise<'ran' | 'skipped'>;
  /** Test/utility: drop all state without disconnecting. */
  reset: () => void;
}

function nowMs(): number {
  return Date.now();
}

export const useSyncOrchestrator = create<SyncOrchestratorState>((set, get) => ({
  status: 'idle',
  lastSyncAt: null,
  lastError: null,
  _started: false,
  _device: null,
  _appStateSub: null,
  _btStateSub: null,
  _idleTimer: null,
  _unsubNotify: null,
  _lastBtState: null,
  _lastAppState: null,
  _runStartedAt: null,

  start: () => {
    if (get()._started) return;
    // App foreground edge: any transition from background/inactive →
    // active is treated as "user opened the app" and triggers a sync.
    const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = get()._lastAppState;
      set({ _lastAppState: next });
      if (next === 'active' && prev !== null && prev !== 'active') {
        void get().runSync('app_foreground');
      }
    });
    // BT_READY edge: any transition from non-PoweredOn → PoweredOn is
    // a "Bluetooth came back" event, often after the user toggled it
    // or got off a plane. Triggers a sync.
    const btStateSub = observeBluetoothState((state) => {
      const prev = get()._lastBtState;
      set({ _lastBtState: state });
      if (state === 'PoweredOn' && prev !== null && prev !== 'PoweredOn') {
        void get().runSync('bt_ready');
      }
    });
    set({
      _started: true,
      _appStateSub: appStateSub,
      _btStateSub: btStateSub,
      _lastAppState: AppState.currentState,
    });
    // Cold-start sync. Fire-and-forget; UI doesn't wait on this.
    void get().runSync('cold_start');
  },

  stop: () => {
    const { _appStateSub, _btStateSub, _idleTimer, _unsubNotify, _device } = get();
    if (_appStateSub) _appStateSub.remove();
    if (_btStateSub) _btStateSub.remove();
    if (_idleTimer) clearTimeout(_idleTimer);
    if (_unsubNotify) _unsubNotify();
    if (_device) {
      void _device.disconnect().catch(() => {});
    }
    set({
      _started: false,
      _appStateSub: null,
      _btStateSub: null,
      _idleTimer: null,
      _unsubNotify: null,
      _device: null,
      _runStartedAt: null,
      status: 'idle',
    });
  },

  runSync: async (trigger) => {
    // Yield to take-reading: it owns the device while the sheet is
    // open. The take-reading flow itself runs syncBacklog, so we lose
    // nothing by deferring.
    const takePhase = useTakeReading.getState().phase;
    if (takePhase !== 'idle' && takePhase !== 'success' && takePhase !== 'failure') {
      logger.track('sync_skipped', { trigger, reason: 'take_reading_active' });
      return 'skipped';
    }
    if (get().status === 'connecting' || get().status === 'syncing') {
      const startedAt = get()._runStartedAt;
      const stuckForMs = startedAt === null ? null : nowMs() - startedAt;
      if (stuckForMs === null || stuckForMs < STALE_RUN_RESET_MS) {
        logger.track('sync_skipped', { trigger, reason: 'already_running' });
        return 'skipped';
      }
      // The claimed run is past the stale deadline — presume it dead,
      // release its resources, and let this trigger proceed. If it was
      // somehow still alive its device handle is disconnected here, so
      // it fails fast rather than fighting the new run for the GATT link.
      logger.track('sync_stale_reset', {
        trigger,
        stuckStatus: get().status,
        stuckForMs,
      });
      const { _idleTimer, _unsubNotify, _device } = get();
      if (_idleTimer) clearTimeout(_idleTimer);
      if (_unsubNotify) _unsubNotify();
      if (_device) void _device.disconnect().catch(() => {});
      set({
        status: 'idle',
        _device: null,
        _idleTimer: null,
        _unsubNotify: null,
        _runStartedAt: null,
      });
    }
    const last = get().lastSyncAt;
    // Manual force-sync and remote-refresh bypass the debounce — both are
    // explicit "sync now" requests; surface the latest even if we synced
    // a moment ago. (The silent-push side has its own 30s coalesce.)
    if (
      trigger !== 'manual_force' &&
      trigger !== 'remote_refresh' &&
      last !== null &&
      nowMs() - last < MIN_SYNC_INTERVAL_MS
    ) {
      logger.track('sync_skipped', { trigger, reason: 'too_recent' });
      return 'skipped';
    }

    // Always flush local pending writes first — these don't need the
    // watch and have nothing to do with the rest of the run. Cheap.
    await useReadings.getState().syncPending();

    const paired = usePairing.getState().pairedDevice;
    if (!paired) {
      logger.track('sync_skipped', { trigger, reason: 'no_paired_device' });
      // Still mark a successful "run" — local pending was flushed.
      // Clears the 24h reassurance banner since the local-pending leg
      // succeeded.
      clearSyncFailure();
      set({ lastSyncAt: nowMs(), lastError: null });
      return 'ran';
    }

    logger.track('sync_started', { trigger });
    set({ status: 'connecting', lastError: null, _runStartedAt: nowMs() });
    let device: UrionDevice | null = null;
    let unsubHeartbeat: (() => void) | null = null;
    try {
      device = await connectToUrion(paired.bleId);
      set({ status: 'syncing', _device: device });

      // §9 heartbeat — every packet from the watch refreshes the run's
      // claim, so the stale watchdog above measures 3 min of SILENCE
      // rather than 3 min of age. A long healthy drain (full day of
      // vitals) keeps itself alive; a run whose device went quiet is
      // reaped on the next trigger. Guarded on _runStartedAt so a
      // live-window packet after the run ends can't resurrect a claim.
      unsubHeartbeat = device.onNotify(() => {
        if (get()._runStartedAt !== null) set({ _runStartedAt: nowMs() });
      });

      // Sprint 10b.2 — flush user-facing Settings to the watch BEFORE
      // pulling data. setAutoHR / setAutoSpO2 / setUserParams /
      // setGoals. No-op when the vitalSetup store's dirty flag is
      // false. Failures are non-fatal: dirty stays true and the next
      // sync retries; data sync continues regardless.
      try {
        const cfgResult = await applyDeviceConfig(device);
        if (cfgResult.error) {
          logger.track('sync_failed', {
            trigger,
            reason: `device_config:${cfgResult.error}`,
          });
        }
      } catch (e) {
        logger.track('sync_failed', {
          trigger,
          reason: e instanceof Error ? `device_config:${e.message}` : 'device_config:unknown',
        });
      }

      const result = await syncBacklogToCompletion(device, paired.bleId);
      logger.track('sync_completed', {
        trigger,
        batches: result.batches,
        hitBatchCap: result.hitBatchCap,
        // count is non-PHI; reading values stay out of analytics.
        pulled: result.totalPulled,
      });

      // Steps 5–8 of D13 §3.3 — multi-vitals reads + batch /sync.
      // Failures are isolated inside syncMultiVitals (per-vital
      // Promise.allSettled); the BP path's success doesn't depend on
      // these. Sprint 16.5b — return value is now CHECKED so /sync
      // upload failures (which cause pending arrays to accumulate) are
      // visible in analytics. Pre-16.5b the return was ignored and the
      // failures were silent for 8+ days at a time.
      try {
        const meta = {
          bleId: paired.bleId,
          macSuffix: paired.macSuffix,
          name: paired.name,
          model: inferModel(paired.name),
        };
        const mvResult = await syncMultiVitals(device, paired.bleId, meta);
        if (!mvResult.ok) {
          // syncMultiVitals already emitted multi_vitals_sync_failed
          // with details; this is a top-level rollup so trigger-level
          // analytics see the failure too.
          logger.track('sync_failed', {
            trigger,
            reason: `multi_vitals:${Object.keys(mvResult.errors).join(',')}`,
          });
        }
      } catch (e) {
        // Defensive — syncMultiVitals is supposed to never throw, but
        // if an unexpected error escapes, log it here and continue.
        logger.track('sync_failed', {
          trigger,
          reason: e instanceof Error ? `multi_vitals:${e.message}` : 'multi_vitals:unknown',
        });
      }

      // Sprint 16: a successful sync clears the failure streak that
      // drives the 24h reassurance banner.
      clearSyncFailure();

      // An OS-woken run has no user watching, so the live window buys
      // nothing — and it costs. Its 45s disconnect is a JS timer, which
      // Android freezes once the wake-up's budget expires: observed
      // 2026-08-14, a background run left the GATT link open for 20
      // minutes until the OS killed the process. Close the link here and
      // let the next wake-up reconnect.
      if (trigger === 'background' || trigger === 'remote_refresh') {
        await device.disconnect().catch(() => {});
        set({
          status: 'idle',
          _device: null,
          lastSyncAt: nowMs(),
          lastError: null,
          _runStartedAt: null,
        });
        return 'ran';
      }

      // Stay live for the idle window: if the user takes a fresh
      // reading on the watch right now, we catch it via 0x73 0x02
      // and pull immediately instead of waiting for the next trigger.
      const unsub = subscribeToNotifications(device, {
        onBP: () => {
          // Reset the idle timer; pull again.
          void get().runSync('live_notify');
        },
      });
      const idleTimer = setTimeout(() => {
        void get()
          ._device?.disconnect()
          .catch(() => {});
        const u = get()._unsubNotify;
        if (u) u();
        set({
          status: 'idle',
          _device: null,
          _unsubNotify: null,
          _idleTimer: null,
        });
      }, IDLE_DISCONNECT_MS);

      set({
        status: 'live',
        _unsubNotify: unsub,
        _idleTimer: idleTimer,
        lastSyncAt: nowMs(),
        lastError: null,
        _runStartedAt: null,
      });
      return 'ran';
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unknown';
      logger.track('sync_failed', { trigger, reason });
      // Sprint 16: mark the first failure in the streak so the 24h
      // reassurance banner can fire after a day of repeated misses.
      // Idempotent on the second+ failure.
      markSyncFailure();
      // Best-effort cleanup of any half-open device.
      if (device) {
        try {
          await device.disconnect();
        } catch {
          // already gone
        }
      }
      set({
        status: 'error',
        _device: null,
        lastError: reason,
        _runStartedAt: null,
        // lastSyncAt deliberately NOT updated — a failed run shouldn't
        // gate the next trigger on the debounce window.
      });
      return 'ran';
    } finally {
      unsubHeartbeat?.();
    }
  },

  reset: () => {
    const { _idleTimer, _unsubNotify } = get();
    if (_idleTimer) clearTimeout(_idleTimer);
    if (_unsubNotify) _unsubNotify();
    set({
      status: 'idle',
      lastSyncAt: null,
      lastError: null,
      _device: null,
      _idleTimer: null,
      _unsubNotify: null,
      _lastBtState: null,
      _lastAppState: null,
      _runStartedAt: null,
    });
  },
}));

// TS: hide internals from public callers.
export type PublicSyncOrchestratorState = Omit<
  SyncOrchestratorState,
  | '_started'
  | '_device'
  | '_appStateSub'
  | '_btStateSub'
  | '_idleTimer'
  | '_unsubNotify'
  | '_lastBtState'
  | '_lastAppState'
  | '_runStartedAt'
>;
