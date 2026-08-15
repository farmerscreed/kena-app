// Coverage for the JS wrapper of the BLE foreground service.

// The mock factory is hoisted above all imports by jest, so the native
// stubs must be created inside it (referencing an outer `const` here
// would throw a temporal-dead-zone ReferenceError). We pull typed
// handles to them back out after the import below.
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: {
    LeikoBleForegroundService: {
      start: jest.fn().mockResolvedValue(true),
      stop: jest.fn().mockResolvedValue(true),
    },
  },
}));

// logger pulls in storage + posthog, which reach for react-native
// internals the minimal mock above doesn't provide. The wrapper's
// behaviour under test is the native start/stop calls, not analytics,
// so stub the logger out entirely.
jest.mock('../../analytics/logger', () => ({
  logger: { track: jest.fn() },
}));

import { NativeModules, Platform } from 'react-native';
import {
  _resetBleForegroundServiceForTests,
  isBleForegroundServiceRunning,
  startBleForegroundService,
  stopBleForegroundService,
  withBleForegroundService,
} from '../foregroundService';

const mockStart = NativeModules.LeikoBleForegroundService.start as jest.Mock;
const mockStop = NativeModules.LeikoBleForegroundService.stop as jest.Mock;

beforeEach(() => {
  _resetBleForegroundServiceForTests();
  mockStart.mockClear();
  mockStop.mockClear();
});

describe('ble foreground service wrapper', () => {
  it('starts the native service on android', async () => {
    await startBleForegroundService();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(isBleForegroundServiceRunning()).toBe(true);
  });

  it('start is idempotent — second call does nothing', async () => {
    await startBleForegroundService();
    await startBleForegroundService();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('stop is a no-op if not started', async () => {
    await stopBleForegroundService();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('start then stop calls both', async () => {
    await startBleForegroundService();
    await stopBleForegroundService();
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(isBleForegroundServiceRunning()).toBe(false);
  });

  it('no-ops on iOS', async () => {
    (Platform as { OS: string }).OS = 'ios';
    await startBleForegroundService();
    expect(mockStart).not.toHaveBeenCalled();
    expect(isBleForegroundServiceRunning()).toBe(false);
    (Platform as { OS: string }).OS = 'android';
  });
});

describe('withBleForegroundService', () => {
  // Freezer exemption for headless sync runs: the service must be held
  // for exactly the duration of fn, and released only if this call was
  // the one that started it.

  it('starts before fn, stops after, and returns the result', async () => {
    const fn = jest.fn(async () => {
      expect(isBleForegroundServiceRunning()).toBe(true);
      return 'ran';
    });
    await expect(withBleForegroundService(fn)).resolves.toBe('ran');
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(isBleForegroundServiceRunning()).toBe(false);
  });

  it('leaves the service running when a UI flow already owns it', async () => {
    await startBleForegroundService();
    mockStart.mockClear();
    await withBleForegroundService(async () => undefined);
    expect(mockStop).not.toHaveBeenCalled();
    expect(isBleForegroundServiceRunning()).toBe(true);
  });

  it('stops the service even when fn throws, and rethrows', async () => {
    await expect(
      withBleForegroundService(async () => {
        throw new Error('sync exploded');
      }),
    ).rejects.toThrow('sync exploded');
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(isBleForegroundServiceRunning()).toBe(false);
  });

  it('still runs fn when the native start is denied', async () => {
    // Android 12+ denies background FGS starts for non-battery-exempt
    // apps (ForegroundServiceStartNotAllowedException). The sync must
    // degrade to the freezer-budget behaviour, not skip.
    mockStart.mockRejectedValueOnce(new Error('not allowed'));
    const fn = jest.fn(async () => 'ran');
    await expect(withBleForegroundService(fn)).resolves.toBe('ran');
    expect(fn).toHaveBeenCalledTimes(1);
    // Never started, so nothing to stop.
    expect(mockStop).not.toHaveBeenCalled();
  });
});
