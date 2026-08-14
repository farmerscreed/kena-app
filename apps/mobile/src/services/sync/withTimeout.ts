// Bound a promise that carries no timeout of its own.
//
// supabase.functions.invoke — and the fetch beneath it — has no default
// timeout: a request that stalls simply never settles. Observed
// 2026-08-14 on a background sync: every BLE read completed (HR, SpO2,
// activity, calories all persisted locally within 9s), then the /sync
// upload hung. The orchestrator stayed at status 'syncing' and the next
// 15-minute background fetch skipped with already_running; the BLE link
// stayed open for 20 minutes until the OS killed the process.
//
// The race does NOT cancel the underlying request — it frees the caller.
// That is what the sync path needs: the run finishes, its status is
// released, and the still-pending rows go out on the next sync (every
// upload is idempotent, so a late-arriving duplicate is absorbed).

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// 30s is far past a healthy /sync round-trip (1-3s on a normal
// connection) while still leaving room for a slow mobile network with a
// large first-sync payload. A timed-out upload is not data loss: the
// pending rows stay in MMKV and retry on the next sync.
export const SYNC_UPLOAD_TIMEOUT_MS = 30_000;
