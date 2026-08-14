// services/sync/backgroundSync — Sprint 10c.2 polish.
//
// Registers an OS-scheduled task that wakes the app and runs the
// orchestrator's sync flow. Promoted from v1.1 to v1.0 so users who
// go a day or two between opens still see fresh data when they
// return (per CLAUDE.md "offline-first; every reading is saved to
// MMKV before any sync attempt" + the founder-approved sync intent
// in memory/sprint_7_architecture_intent.md).
//
// Implementation details:
//   • expo-task-manager + expo-background-fetch handle the
//     iOS BGTaskScheduler + Android WorkManager wiring for us.
//   • iOS fires roughly every 15 min minimum; the OS decides actual
//     cadence based on user behaviour. Each invocation has ~30s budget.
//   • Android WorkManager is more reliable but also throttled to
//     ~15 min minimum.
//   • The task body is a thin call to runSync('background'). Failures
//     resolve to BackgroundFetchResult.Failed so the OS schedules a
//     shorter retry; success resolves to NewData.
//   • We adapt to the runtime: when expo-background-fetch isn't
//     present (dev workspace without the native side, jest), the
//     module no-ops. The dev-client APK rebuild pulls the native
//     side in.
//
// Per CLAUDE.md voice + data rules: no PHI logged. Telemetry only
// emits {result, reason} pairs.

import { logger } from '../analytics/logger';
import { BACKGROUND_SYNC_TASK } from '../tasks/taskNames';

// Shared with services/tasks/registerHeadlessTasks, which defines the
// task body at entry. Both sides must name the same task.
const TASK_NAME = BACKGROUND_SYNC_TASK;
const MIN_INTERVAL_SECONDS = 15 * 60; // 15 min; OS may delay further

let registered = false;
let nativeModulesAvailable: boolean | null = null;

interface BackgroundFetchModule {
  registerTaskAsync: (
    taskName: string,
    options: { minimumInterval: number; stopOnTerminate?: boolean; startOnBoot?: boolean },
  ) => Promise<void>;
  unregisterTaskAsync: (taskName: string) => Promise<void>;
  BackgroundFetchResult: { NoData: number; NewData: number; Failed: number };
  setMinimumIntervalAsync?: (seconds: number) => Promise<void>;
  getStatusAsync: () => Promise<unknown>;
  BackgroundFetchStatus?: { Available: number; Restricted: number; Denied: number };
}

interface TaskManagerModule {
  defineTask: (
    taskName: string,
    runner: () => Promise<unknown>,
  ) => void;
  isTaskRegisteredAsync: (taskName: string) => Promise<boolean>;
}

function loadModules(): {
  bg: BackgroundFetchModule | null;
  tm: TaskManagerModule | null;
} {
  if (nativeModulesAvailable === false) return { bg: null, tm: null };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bg = require('expo-background-fetch') as BackgroundFetchModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tm = require('expo-task-manager') as TaskManagerModule;
    nativeModulesAvailable = true;
    return { bg, tm };
  } catch {
    nativeModulesAvailable = false;
    return { bg: null, tm: null };
  }
}

let definedRunner: (() => Promise<'ran' | 'skipped' | 'errored'>) | null = null;

/**
 * Define the task with the OS. Called once at app boot before
 * `startBackgroundSync`. Splitting define from start keeps the
 * defineTask call out of the hot reload path — TaskManager rejects
 * redefinition.
 */
export function defineBackgroundSyncTask(
  runner: () => Promise<'ran' | 'skipped' | 'errored'>,
): void {
  definedRunner = runner;
  const { bg, tm } = loadModules();
  if (!bg || !tm) return;

  tm.defineTask(TASK_NAME, async () => {
    const result = definedRunner ? await definedRunner() : 'skipped';
    logger.track('background_sync_fired', { result });
    if (result === 'ran') return bg.BackgroundFetchResult.NewData;
    if (result === 'errored') return bg.BackgroundFetchResult.Failed;
    return bg.BackgroundFetchResult.NoData;
  });
}

/**
 * Register the task with the OS scheduler. Idempotent — re-registering
 * an already-active task is a no-op. Called from RootNavigator once
 * per app session.
 */
export async function startBackgroundSync(): Promise<void> {
  if (registered) return;
  const { bg, tm } = loadModules();
  if (!bg || !tm) {
    logger.track('background_sync_unavailable', { reason: 'native_module_missing' });
    return;
  }

  try {
    const already = await tm.isTaskRegisteredAsync(TASK_NAME);
    if (!already) {
      await bg.registerTaskAsync(TASK_NAME, {
        minimumInterval: MIN_INTERVAL_SECONDS,
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
    registered = true;
    logger.track('background_sync_registered', { intervalMin: MIN_INTERVAL_SECONDS / 60 });
  } catch (e) {
    logger.track('background_sync_unavailable', {
      reason: e instanceof Error ? e.message : 'register_failed',
    });
  }
}

export async function stopBackgroundSync(): Promise<void> {
  if (!registered) return;
  const { bg, tm } = loadModules();
  if (!bg || !tm) return;
  try {
    const already = await tm.isTaskRegisteredAsync(TASK_NAME);
    if (already) {
      await bg.unregisterTaskAsync(TASK_NAME);
    }
    registered = false;
    logger.track('background_sync_unregistered');
  } catch {
    // ignore
  }
}

// Test surface
export const _internals = { TASK_NAME, MIN_INTERVAL_SECONDS };
