// Orchestrator state-machine tests. Mocks the entire BLE +
// syncBacklog layer so this lives in the pure jest project (no
// react-native runtime needed). The integration with real BLE is
// covered by the syncBacklog/syncBacklogToCompletion tests + manual
// e2e on the dev phone.

const mockConnectToUrion: jest.Mock = jest.fn();
const mockObserveBluetoothState: jest.Mock = jest.fn(() => ({
  remove: () => undefined,
}));
const mockSubscribeToNotifications: jest.Mock = jest.fn(() => () => undefined);
const mockSyncBacklogToCompletion: jest.Mock = jest.fn();
const mockSyncMultiVitals: jest.Mock = jest.fn();
const mockUseReadingsSync: jest.Mock = jest.fn(async () => undefined);
const mockTakeReadingPhase = { current: 'idle' as string };

// Pure project has no react-native mock; stub the bits the orchestrator
// imports. AppState.addEventListener returns a NativeEventSubscription
// shape; the orchestrator only ever calls .remove() on it. This local
// factory overrides the pure project's moduleNameMapper react-native
// stub, so it must also carry Platform — the orchestrator transitively
// pulls the BLE foreground-service wrapper (via state/auth), which
// reads Platform.OS at module load.
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: {},
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('../../services/ble/bleManager', () => ({
  connectToUrion: (deviceId: string) => mockConnectToUrion(deviceId),
  observeBluetoothState: (cb: (state: string) => void) =>
    mockObserveBluetoothState(cb),
}));

jest.mock('../../services/ble/notify', () => ({
  subscribeToNotifications: (device: unknown, handlers: unknown) =>
    mockSubscribeToNotifications(device, handlers),
}));

jest.mock('../../services/sync/syncBacklogToCompletion', () => ({
  syncBacklogToCompletion: (device: unknown, deviceBleId: string) =>
    mockSyncBacklogToCompletion(device, deviceBleId),
}));

jest.mock('../../services/sync/syncMultiVitals', () => ({
  syncMultiVitals: (device: unknown, deviceBleId: string, meta: unknown) =>
    mockSyncMultiVitals(device, deviceBleId, meta),
}));

jest.mock('../../services/sync/postReading', () => ({
  inferModel: (name: string | null) => (name?.startsWith('U19') ? 'U19M' : 'U16H'),
}));

jest.mock('../readings', () => ({
  useReadings: {
    getState: () => ({ syncPending: mockUseReadingsSync }),
  },
}));

jest.mock('../pairing', () => ({
  usePairing: {
    getState: () => ({
      pairedDevice: { bleId: 'AA:BB:CC:DD:E4:F2', macSuffix: 'e4f2', name: 'Leiko Watch', pairedAt: 0 },
    }),
  },
}));

jest.mock('../takeReading', () => ({
  useTakeReading: {
    getState: () => ({ phase: mockTakeReadingPhase.current }),
  },
}));

import { useSyncOrchestrator } from '../syncOrchestrator';

function fakeDevice(): unknown {
  return {
    disconnect: jest.fn().mockResolvedValue(undefined),
    // §9 heartbeat — runSync subscribes to refresh the stale watchdog on
    // every packet; the fake needs the surface, no packets ever arrive.
    onNotify: jest.fn(() => () => {}),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  useSyncOrchestrator.getState().reset();
  mockTakeReadingPhase.current = 'idle';
  mockConnectToUrion.mockResolvedValue(fakeDevice());
  mockSyncBacklogToCompletion.mockResolvedValue({
    totalPulled: 0,
    batches: 1,
    hitBatchCap: false,
    latestTimestampSec: null,
  });
  mockSyncMultiVitals.mockResolvedValue({
    ok: true,
    errors: {},
    pulled: { hr: 0, spo2: 0, sleep: 0, activity: 0 },
    inserted: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useSyncOrchestrator.runSync', () => {
  it('flushes pending writes, connects, runs the cursor loop, and goes live', async () => {
    const result = await useSyncOrchestrator.getState().runSync('cold_start');
    expect(result).toBe('ran');
    expect(mockUseReadingsSync).toHaveBeenCalledTimes(1);
    expect(mockConnectToUrion).toHaveBeenCalledWith('AA:BB:CC:DD:E4:F2');
    expect(mockSyncBacklogToCompletion).toHaveBeenCalledTimes(1);
    expect(mockSubscribeToNotifications).toHaveBeenCalledTimes(1);
    expect(useSyncOrchestrator.getState().status).toBe('live');
    expect(useSyncOrchestrator.getState().lastError).toBeNull();
  });

  it('skips when take-reading is mid-flow (mutex)', async () => {
    mockTakeReadingPhase.current = 'waiting_for_watch';
    const result = await useSyncOrchestrator.getState().runSync('app_foreground');
    expect(result).toBe('skipped');
    expect(mockConnectToUrion).not.toHaveBeenCalled();
  });

  it('skips when a sync is already in flight', async () => {
    // Block the first sync mid-connect so we can race a second.
    let resolveConnect: ((value: unknown) => void) | null = null;
    mockConnectToUrion.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnect = resolve;
        }),
    );
    const first = useSyncOrchestrator.getState().runSync('cold_start');
    // Let the first run reach 'connecting'.
    await Promise.resolve();
    const second = await useSyncOrchestrator.getState().runSync('app_foreground');
    expect(second).toBe('skipped');
    if (resolveConnect) (resolveConnect as (v: unknown) => void)(fakeDevice());
    await first;
  });

  it('debounces back-to-back triggers within 5s, but manual_force bypasses', async () => {
    await useSyncOrchestrator.getState().runSync('cold_start');
    // Immediate second trigger → skipped (too_recent).
    const second = await useSyncOrchestrator.getState().runSync('app_foreground');
    expect(second).toBe('skipped');
    // Manual force ignores debounce.
    const third = await useSyncOrchestrator.getState().runSync('manual_force');
    expect(third).toBe('ran');
  });

  it('marks status=error and preserves lastSyncAt when connect fails', async () => {
    mockConnectToUrion.mockRejectedValueOnce(new Error('connect timeout'));
    const result = await useSyncOrchestrator.getState().runSync('manual_force');
    expect(result).toBe('ran');
    expect(useSyncOrchestrator.getState().status).toBe('error');
    expect(useSyncOrchestrator.getState().lastError).toBe('connect timeout');
    // lastSyncAt unchanged so the debounce doesn't gate the retry.
    expect(useSyncOrchestrator.getState().lastSyncAt).toBeNull();
  });

  it('marks no_paired_device runs as ran (pending flush still useful)', async () => {
    // Override the pairing mock for this test only.
    const pairingMod = jest.requireMock('../pairing') as {
      usePairing: { getState: () => { pairedDevice: unknown } };
    };
    const orig = pairingMod.usePairing.getState;
    pairingMod.usePairing.getState = () => ({ pairedDevice: null });
    try {
      const result = await useSyncOrchestrator.getState().runSync('cold_start');
      expect(result).toBe('ran');
      expect(mockConnectToUrion).not.toHaveBeenCalled();
      expect(useSyncOrchestrator.getState().lastSyncAt).not.toBeNull();
    } finally {
      pairingMod.usePairing.getState = orig;
    }
  });

  it('reclaims the engine when a prior run is stuck past the stale deadline', async () => {
    // Wedge a run in 'connecting'. Its own timeouts never fire here,
    // mirroring the real case: Android freezes JS timers once a
    // background wake-up's budget expires, so the run hangs forever.
    mockConnectToUrion.mockImplementationOnce(() => new Promise(() => {}));
    void useSyncOrchestrator.getState().runSync('cold_start');
    await Promise.resolve();
    expect(useSyncOrchestrator.getState().status).toBe('connecting');

    // Inside the deadline the mutex still holds.
    jest.advanceTimersByTime(60_000);
    expect(await useSyncOrchestrator.getState().runSync('background')).toBe(
      'skipped',
    );

    // Past it, the new trigger presumes the run dead and proceeds.
    jest.advanceTimersByTime(3 * 60_000);
    expect(await useSyncOrchestrator.getState().runSync('background')).toBe('ran');
    expect(mockSyncBacklogToCompletion).toHaveBeenCalledTimes(1);
  });

  it('disconnects instead of holding the live window on a background run', async () => {
    const device = fakeDevice();
    mockConnectToUrion.mockResolvedValueOnce(device);
    const result = await useSyncOrchestrator.getState().runSync('background');
    expect(result).toBe('ran');
    // No live window: link closed, no notification subscription left open.
    expect((device as { disconnect: jest.Mock }).disconnect).toHaveBeenCalled();
    expect(mockSubscribeToNotifications).not.toHaveBeenCalled();
    expect(useSyncOrchestrator.getState().status).toBe('idle');
  });

  it('idle timer disconnects the device after IDLE_DISCONNECT_MS', async () => {
    const device = fakeDevice();
    mockConnectToUrion.mockResolvedValueOnce(device);
    await useSyncOrchestrator.getState().runSync('cold_start');
    expect(useSyncOrchestrator.getState().status).toBe('live');

    jest.advanceTimersByTime(45_000);
    // Idle timer fired: disconnect was called.
    expect((device as { disconnect: jest.Mock }).disconnect).toHaveBeenCalled();
    expect(useSyncOrchestrator.getState().status).toBe('idle');
  });
});
