// Singleton BleManager + scan/connect helpers. Per docs/06-ble-protocol.md.
//
// Imports react-native-ble-plx, so this file is loaded only on a real
// device or under the rn Jest project (where the ble-plx mock is in
// scope via __mocks__/react-native-ble-plx.js). Pure ts-jest tests must
// not import this module.

import {
  BleManager,
  Device,
  State,
  type Subscription,
} from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { URION_ADVERTISING_SERVICE_UUID } from './io';
import { raceWithHeadlessTimeout } from './headlessDelay';
import { UrionDevice } from './UrionDevice';
import { logger } from '../analytics/logger';

let _manager: BleManager | null = null;

export function bleManager(): BleManager {
  if (!_manager) {
    _manager = new BleManager({
      restoreStateIdentifier: 'leiko-bt',
      restoreStateFunction: () => {
        // iOS state restoration: ble-plx hands back the previously
        // tracked devices on cold-launch from a CoreBluetooth event.
        // Sprint 5 wires the listener; persisted reconnect happens
        // through the connectionMachine once we observe a device.
      },
    });
  }
  return _manager;
}

export type BlePermissionResult =
  | { granted: true }
  | { granted: false; denied: string[] };

export async function requestBlePermissions(): Promise<BlePermissionResult> {
  if (Platform.OS !== 'android') return { granted: true };
  // Android 12+ (API 31) uses the runtime BLUETOOTH_{SCAN,CONNECT}
  // permissions; we declare BLUETOOTH_SCAN with neverForLocation so
  // location is not required. Android 6-11 (API 23-30) instead gates
  // BLE scanning on the runtime ACCESS_FINE_LOCATION permission — the
  // legacy BLUETOOTH / BLUETOOTH_ADMIN install-time permissions on
  // their own are not enough; without fine-location, startDeviceScan
  // succeeds but never returns any device. Request the correct set
  // for the OS version we're on.
  const required = Platform.Version >= 31
    ? [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(required);
  const denied: string[] = [];
  for (const p of required) {
    if (result[p] !== PermissionsAndroid.RESULTS.GRANTED) denied.push(p);
  }
  if (denied.length === 0) return { granted: true };
  for (const p of denied) logger.track('ble_permission_denied', { permission: p });
  return { granted: false, denied };
}

export function observeBluetoothState(
  onState: (state: State) => void,
): Subscription {
  return bleManager().onStateChange(onState, true);
}

export type ScanHandler = (device: Device) => void;
export type ScanErrorHandler = (error: Error) => void;

export function scanForUrion(
  onDevice: ScanHandler,
  onError?: ScanErrorHandler,
): () => void {
  const mgr = bleManager();
  logger.track('ble_scan_started');
  mgr.startDeviceScan(
    [URION_ADVERTISING_SERVICE_UUID],
    { allowDuplicates: false },
    (error, device) => {
      if (error) {
        onError?.(error);
        return;
      }
      if (device) onDevice(device);
    },
  );
  return () => {
    mgr.stopDeviceScan();
    logger.track('ble_scan_stopped', { reason: 'caller_stopped' });
  };
}

export async function connectToUrion(
  deviceId: string,
  options: { timeoutMs?: number } = {},
): Promise<UrionDevice> {
  const mgr = bleManager();
  const timeoutMs = options.timeoutMs ?? 15_000;
  // ble-plx's connectToDevice has no platform-uniform timeout; on
  // Android it can sit on a stalled GATT handshake indefinitely. Wrap
  // it so the caller always gets a definite outcome. The race uses the
  // headless-safe delay, NOT setTimeout — RN never dispatches JS timers
  // in an OS-woken process, which made this guard (and every other
  // timeout in the sync stack) a silent no-op during background sync
  // (§9, 2026-08-15).
  const connect = mgr.connectToDevice(deviceId, { autoConnect: false, timeout: timeoutMs });
  const native = await raceWithHeadlessTimeout(
    connect,
    timeoutMs,
    () => new Error(`connect timeout after ${timeoutMs}ms`),
  );
  // Discovery was genuinely unbounded — a stalled GATT session hangs it
  // forever, and 2026-08-15's wedged-watch runs sat exactly here or one
  // step later. Same deadline as the connect.
  await raceWithHeadlessTimeout(
    native.discoverAllServicesAndCharacteristics(),
    timeoutMs,
    () => new Error(`service discovery timeout after ${timeoutMs}ms`),
  );
  const wrapper = new UrionDevice(native);
  await wrapper.startNotify();
  return wrapper;
}

/** Test-only: lets a test inject a custom manager (e.g., the in-memory mock). */
export function __setManagerForTests(manager: BleManager | null): void {
  _manager = manager;
}
