// Wall-clock delay + timeout race that survive headless contexts.
//
// React Native's TimingModule dispatches setTimeout callbacks off the
// activity lifecycle. An OS-woken process (background fetch, silent
// push) has never had a resumed activity, so its timers are queued and
// NEVER fire — which silently disarmed every timeout in the BLE/sync
// stack exactly where they matter most. Observed 2026-08-15 (Pixel 8,
// Android 17, process unfrozen via the FGS fix): a stalled watch
// exchange hung runs 20+ minutes straight through a 5 s command
// timeout. The pre-freezer-fix "47-minute wedge" (D1) was this too.
//
// The native side is a Handler.postDelayed on the main looper — driven
// by the OS, not by RN — exposed on the LeikoBleForegroundService
// module we already own. Where the native module is absent (iOS, jest,
// dev workspace) this falls back to setTimeout, which is correct in
// every context that has a live activity — and keeps the existing
// fake-timer test suites working untouched.

import { NativeModules, Platform } from 'react-native';

interface NativeApi {
  delay?: (ms: number) => Promise<boolean>;
}

function nativeDelay(): NativeApi['delay'] {
  if (Platform.OS !== 'android') return undefined;
  const mod = NativeModules.LeikoBleForegroundService as NativeApi | undefined;
  return mod?.delay?.bind(mod);
}

export async function headlessDelay(ms: number): Promise<void> {
  const native = nativeDelay();
  if (native) {
    try {
      await native(ms);
      return;
    } catch {
      // Native failure → fall through to the JS timer; in a foreground
      // context it still fires, and in a headless one we are no worse
      // off than before this module existed.
    }
  }
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Race `promise` against a wall-clock deadline. On timeout, rejects
 * with the error produced by `makeError` — the underlying promise is
 * NOT cancelled (BLE writes/reads have no JS-side cancellation), its
 * late settlement is simply ignored.
 */
export async function raceWithHeadlessTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  makeError: () => Error,
): Promise<T> {
  let settled = false;
  return await Promise.race([
    promise.finally(() => {
      settled = true;
    }),
    headlessDelay(timeoutMs).then(() => {
      if (!settled) throw makeError();
      // The main promise settled first; this branch loses the race and
      // its value is discarded. Resolve to a never-used cast.
      return undefined as never;
    }),
  ]);
}
