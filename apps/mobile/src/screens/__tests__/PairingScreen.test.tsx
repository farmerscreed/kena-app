// PairingScreen — Sprint 5 integration tests.
//
// Covers the BLE-mock-driven happy path + 2 failure paths required by
// the sprint card. Each test renders the real PairingScreen, drives the
// pairing store through scripted scan/connect outcomes, and asserts the
// rendered phase + side effects (MMKV write, friendly error copy).

import { type ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme';
import { PairingScreen } from '../Pairing/PairingScreen';
import { usePairing } from '../../state/pairing';
import { mmkv, STORAGE_KEYS } from '../../services/storage';

// ─── BLE service mocks ────────────────────────────────────────────────
//
// We mock the wrapper rather than ble-plx so the test owns scan/connect
// outcomes deterministically. UrionDevice unit tests already cover the
// ble-plx surface (UrionDevice.test.ts).

const mockRequestPermissions = jest.fn();
const mockScanForUrion = jest.fn();
const mockConnectToUrion = jest.fn();
const mockObserveState = jest.fn();
const mockSetTime = jest.fn();
const mockFindWatch = jest.fn();

jest.mock('../../services/ble/bleManager', () => ({
  requestBlePermissions: () => mockRequestPermissions(),
  scanForUrion: (onDevice: unknown, onError: unknown) =>
    mockScanForUrion(onDevice, onError),
  connectToUrion: (id: string) => mockConnectToUrion(id),
  observeBluetoothState: (cb: unknown) => mockObserveState(cb),
}));

jest.mock('../../services/ble/commands/setTime', () => ({
  setTime: (...args: unknown[]) => mockSetTime(...args),
}));

jest.mock('../../services/ble/commands/findWatch', () => ({
  findWatch: (...args: unknown[]) => mockFindWatch(...args),
}));

function withProviders(ui: ReactNode) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider mode="caregiver">{ui}</ThemeProvider>
    </SafeAreaProvider>
  );
}

const goBack = jest.fn();
const nav = { goBack } as unknown as Parameters<typeof PairingScreen>[0]['navigation'];

beforeEach(() => {
  mockRequestPermissions.mockReset();
  mockScanForUrion.mockReset();
  mockConnectToUrion.mockReset();
  mockObserveState.mockReset();
  mockSetTime.mockReset();
  mockFindWatch.mockReset();
  goBack.mockReset();
  mmkv.clearAll();
  usePairing.getState().reset();
});

describe('PairingScreen — happy path', () => {
  it('walks permission_prime → power_on → searching → found → pairing → success', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: true });
    mockObserveState.mockReturnValue({ remove: jest.fn() });

    let scanCb: ((d: { id: string; name: string | null; localName?: string | null }) => void) | null = null;
    mockScanForUrion.mockImplementation((onDevice) => {
      scanCb = onDevice;
      return jest.fn();
    });

    const fakeDevice = {
      id: 'AA:BB:CC:DD:E4:F2',
      name: 'Leiko Watch',
      macSuffix: 'e4f2',
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    mockConnectToUrion.mockResolvedValue(fakeDevice);
    mockSetTime.mockResolvedValue(undefined);

    render(withProviders(<PairingScreen navigation={nav} />));

    // 1. permission_prime
    expect(await screen.findByTestId('pairing-permission-prime')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pairing-permission-continue'));
    });

    // 2. power_on
    expect(await screen.findByTestId('pairing-power-on')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pairing-power-on-confirm'));
    });

    // 3. searching → 4. found (after scan callback fires)
    expect(await screen.findByTestId('pairing-searching')).toBeTruthy();
    expect(scanCb).not.toBeNull();
    act(() => {
      scanCb!({ id: 'AA:BB:CC:DD:E4:F2', name: 'Leiko Watch' });
    });
    const foundCard = await screen.findByTestId('pairing-found-device-e4f2');
    expect(foundCard).toBeTruthy();

    // 5. select + confirm
    await act(async () => {
      fireEvent.press(foundCard);
    });
    const confirm = await screen.findByTestId('pairing-found-confirm');
    await act(async () => {
      fireEvent.press(confirm);
    });

    // 6. success — MMKV row persisted, post-pair setTime called
    await waitFor(() => {
      expect(screen.getByTestId('pairing-success')).toBeTruthy();
    });
    expect(mockSetTime).toHaveBeenCalledTimes(1);
    expect(fakeDevice.disconnect).toHaveBeenCalledTimes(1);
    const persisted = mmkv.getString(STORAGE_KEYS.pairedDevice);
    expect(persisted).toBeTruthy();
    expect(JSON.parse(persisted!)).toMatchObject({
      bleId: 'AA:BB:CC:DD:E4:F2',
      macSuffix: 'e4f2',
      name: 'Leiko Watch',
    });
  });
});

describe('PairingScreen — failure: permission denied', () => {
  it('lands on permission_denied with the friendly copy and Open Settings CTA', async () => {
    mockRequestPermissions.mockResolvedValue({
      granted: false,
      denied: ['android.permission.BLUETOOTH_SCAN'],
    });
    render(withProviders(<PairingScreen navigation={nav} />));

    expect(await screen.findByTestId('pairing-permission-prime')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pairing-permission-continue'));
    });

    expect(await screen.findByTestId('pairing-permission-denied')).toBeTruthy();
    expect(screen.getByTestId('pairing-permission-settings')).toBeTruthy();
    expect(screen.getByText(/turn it on in Settings/i)).toBeTruthy();
    expect(mockScanForUrion).not.toHaveBeenCalled();
  });
});

describe('PairingScreen — failure: bluetooth off', () => {
  it('flips to bluetooth_off when the state observer fires PoweredOff', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: true });
    let stateCb: ((s: string) => void) | null = null;
    mockObserveState.mockImplementation((cb) => {
      stateCb = cb;
      return { remove: jest.fn() };
    });
    mockScanForUrion.mockReturnValue(jest.fn());

    render(withProviders(<PairingScreen navigation={nav} />));

    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-permission-continue'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-power-on-confirm'));
    });
    expect(await screen.findByTestId('pairing-searching')).toBeTruthy();

    expect(stateCb).not.toBeNull();
    act(() => {
      stateCb!('PoweredOff');
    });

    expect(await screen.findByTestId('pairing-bluetooth-off')).toBeTruthy();
    expect(screen.getByText(/Bluetooth is off/i)).toBeTruthy();
  });
});

describe('PairingScreen — failure: connect error', () => {
  it('lands on failure with friendly copy when connectToUrion rejects', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: true });
    mockObserveState.mockReturnValue({ remove: jest.fn() });

    let scanCb: ((d: { id: string; name: string | null }) => void) | null = null;
    mockScanForUrion.mockImplementation((onDevice) => {
      scanCb = onDevice;
      return jest.fn();
    });
    mockConnectToUrion.mockRejectedValue(new Error('AUTH_FAIL'));

    render(withProviders(<PairingScreen navigation={nav} />));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-permission-continue'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-power-on-confirm'));
    });
    act(() => {
      scanCb!({ id: 'AA:BB:CC:DD:E4:F2', name: 'Leiko Watch' });
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-found-device-e4f2'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-found-confirm'));
    });

    expect(await screen.findByTestId('pairing-failure')).toBeTruthy();
    expect(screen.getByText(/Bring the phone closer/i)).toBeTruthy();
    expect(screen.getByTestId('pairing-failure-retry')).toBeTruthy();
  });
});

// ── Audit P1-7 ───────────────────────────────────────────────────────
// The pairing phases carried Android-only accessibilityLiveRegion props,
// so on iOS the whole flow ran silently: no "we're looking", no "it's
// paired", no "we couldn't reach it". These tests pin the iOS half.

describe('PairingScreen — live-region announcements (audit P1-7)', () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    announce.mockRestore();
  });

  it('announces the searching phase, and the label reads as a sentence', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: true });
    mockObserveState.mockReturnValue({ remove: jest.fn() });
    mockScanForUrion.mockReturnValue(jest.fn());

    render(withProviders(<PairingScreen navigation={nav} />));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-permission-continue'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-power-on-confirm'));
    });

    const searching = await screen.findByTestId('pairing-searching');
    expect(searching.props.accessibilityLabel).toBe(
      'Looking for the watch. This usually takes a few seconds.',
    );
    expect(announce).toHaveBeenCalledWith(
      'Looking for the watch. This usually takes a few seconds.',
    );
  });

  it('announces the failure phase, which previously had no live region at all', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: true });
    mockObserveState.mockReturnValue({ remove: jest.fn() });

    let scanCb: ((d: { id: string; name: string | null }) => void) | null = null;
    mockScanForUrion.mockImplementation((onDevice) => {
      scanCb = onDevice as typeof scanCb;
      return jest.fn();
    });
    mockConnectToUrion.mockRejectedValue(new Error('connect failed'));

    render(withProviders(<PairingScreen navigation={nav} />));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-permission-continue'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-power-on-confirm'));
    });
    await screen.findByTestId('pairing-searching');
    act(() => {
      scanCb!({ id: 'AA:BB:CC:DD:E4:F2', name: 'Leiko Watch' });
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-found-device-e4f2'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByTestId('pairing-found-confirm'));
    });

    const failure = await screen.findByTestId('pairing-failure');
    expect(failure.props.accessibilityLiveRegion).toBe('assertive');
    expect(failure.props.accessibilityLabel).toMatch(/^We couldn't reach the watch\. .+/);
    expect(announce).toHaveBeenCalledWith(failure.props.accessibilityLabel);
  });
});
