// services/notifications/remoteRefreshTask — remote-refresh (Phase 2).
//
// Receives the silent 'sync_refresh' push (server: send-push) and triggers
// a background BLE sync via the orchestrator — no app-open, nothing shown.
// Two delivery paths share triggerRemoteRefresh():
//   - App backgrounded/killed → the registered notification task fires.
//   - App foreground → listeners.ts received-listener calls it directly.
//
// Mirrors services/sync/backgroundSync.ts: native modules are loaded via a
// guarded require so the JS workspace / jest (no native side) no-ops.
//
// Per CLAUDE.md: the push carries NO PHI; we read only its { type }.

import { hydrateForHeadlessRun } from '../../state/hydrateForHeadlessRun';
import { useSyncOrchestrator } from '../../state/syncOrchestrator';
import { logger } from '../analytics/logger';

export const REMOTE_REFRESH_TASK = 'leiko.notifications.remoteRefresh';

let nativeAvailable: boolean | null = null;
let defined = false;

interface TaskManagerModule {
  defineTask: (
    name: string,
    runner: (body: { data?: unknown; error?: unknown }) => unknown,
  ) => void;
}
interface NotificationsModule {
  registerTaskAsync: (name: string) => Promise<void>;
}

function load(): { tm: TaskManagerModule | null; notif: NotificationsModule | null } {
  if (nativeAvailable === false) return { tm: null, notif: null };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tm = require('expo-task-manager') as TaskManagerModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notif = require('expo-notifications') as NotificationsModule;
    nativeAvailable = true;
    return { tm, notif };
  } catch {
    nativeAvailable = false;
    return { tm: null, notif: null };
  }
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

function readType(layer: unknown): string | undefined {
  const o = asObject(layer);
  return o && typeof o.type === 'string' ? (o.type as string) : undefined;
}

/**
 * Pull the payload `type` out of whatever shape the platform hands the
 * task. The silent push lands as a data message on Android and a
 * content-available notification on iOS, and the foreground listener
 * passes the already-unwrapped data object — so we check each known layer.
 */
export function extractRefreshType(taskData: unknown): string | undefined {
  const d = asObject(taskData);
  if (!d) return undefined;
  const notif = asObject(d.notification);
  const request = notif ? asObject(notif.request) : undefined;
  const content = request ? asObject(request.content) : undefined;
  return (
    readType(d.data) ?? // Android data message
    readType(notif?.data) ?? // wrapped notification.data
    readType(content?.data) ?? // expo Notification object
    readType(d) // already the data payload (foreground)
  );
}

export function isRemoteRefreshData(taskData: unknown): boolean {
  return extractRefreshType(taskData) === 'sync_refresh';
}

/**
 * Hydrate the stores (a cold headless wake may not have run
 * RootNavigator's hydrate yet) then run the watch sync. Safe to call from
 * either path.
 */
export async function triggerRemoteRefresh(
  source: 'background' | 'foreground' | 'tap',
): Promise<void> {
  logger.track('remote_refresh_received', { source });
  // Covers readings as well as pairing: syncPending() rewrites its
  // pending/recent arrays from in-memory state, so an unhydrated headless
  // run would persist empty arrays over stored readings.
  hydrateForHeadlessRun();
  try {
    await useSyncOrchestrator.getState().runSync('remote_refresh');
  } catch (e) {
    logger.track('remote_refresh_failed', {
      reason: e instanceof Error ? e.message : 'unknown',
    });
  }
}

/** Define the background notification task. Idempotent; no-ops w/o native. */
export function defineRemoteRefreshTask(): void {
  if (defined) return;
  const { tm } = load();
  if (!tm) return;
  tm.defineTask(REMOTE_REFRESH_TASK, async ({ data, error }) => {
    if (error) {
      logger.track('remote_refresh_task_error', { reason: String(error) });
      return;
    }
    if (!isRemoteRefreshData(data)) return;
    await triggerRemoteRefresh('background');
  });
  defined = true;
}

/**
 * Register the task with expo-notifications so it fires on a received
 * (silent) notification while backgrounded/killed. Call once at boot,
 * after defineRemoteRefreshTask().
 */
export async function registerRemoteRefreshTask(): Promise<void> {
  const { notif } = load();
  if (!notif) return;
  try {
    await notif.registerTaskAsync(REMOTE_REFRESH_TASK);
    logger.track('remote_refresh_registered');
  } catch (e) {
    logger.track('remote_refresh_register_failed', {
      reason: e instanceof Error ? e.message : 'unknown',
    });
  }
}

/** Test surface. */
export function _resetRemoteRefreshForTests(): void {
  nativeAvailable = null;
  defined = false;
}
