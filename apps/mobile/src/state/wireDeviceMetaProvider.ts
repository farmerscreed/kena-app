// Wire postReading's device-meta lookup to the pairing store.
//
// postReading cannot import the pairing store itself — that would drag
// react-native into the pure jest project (see the header comment on
// setDeviceMetaProvider in services/sync/postReading.ts) — so the
// lookup is injected. This module owns the one real implementation.
//
// Two callers, both deliberate:
//
//   - RootNavigator module scope: the UI path, evaluated once per app
//     session when a screen renders.
//   - hydrateForHeadlessRun: the OS-woken path. RootNavigator's module
//     scope never executes on a headless wake (the D4 gap — see
//     services/tasks/registerHeadlessTasks.ts), so without this call
//     the provider stays at its null default and every watch reading's
//     upload throws "no paired device on file" even though pairing
//     hydrated fine. Observed on-device 2026-08-14 21:37:34; the
//     reading only went up at the next app open.
//
// Idempotent: setDeviceMetaProvider assigns a module-level function,
// and the closure resolves the paired device per call — never at wire
// time — so double-wiring (UI after headless, or vice versa) is
// harmless.

import { getOrCreateClientDeviceId } from '../services/storage';
import { inferModel, setDeviceMetaProvider } from '../services/sync/postReading';
import { usePairing } from './pairing';

export function wireDeviceMetaProvider(): void {
  setDeviceMetaProvider(() => {
    const paired = usePairing.getState().pairedDevice;
    if (!paired) return null;
    return {
      bleId: paired.bleId,
      macSuffix: paired.macSuffix,
      name: paired.name,
      model: inferModel(paired.name),
      clientDeviceId: getOrCreateClientDeviceId(),
    };
  });
}
