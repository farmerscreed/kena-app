// TakeReadingScreen — Sprint 6 integration tests.
//
// Drives the full flow against the in-memory ble-mock + a stubbed
// /sync (postReading mock). Acceptance criteria covered:
//   - waiting_for_watch → fetching → success on 0x73 0x02 + 0x14 reply
//   - Reading written to MMKV BEFORE success view renders (offline-first)
//   - Manual entry sheet writes a reading without touching the watch
//   - Failure path renders friendly copy from FRIENDLY map

import { type ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme';
import { TakeReadingScreen } from '../TakeReading/TakeReadingScreen';
import { useReadings } from '../../state/readings';
import { useTakeReading } from '../../state/takeReading';
import { usePairing } from '../../state/pairing';
import { mmkv, STORAGE_KEYS } from '../../services/storage';

// ─── BLE wrapper mocks ────────────────────────────────────────────────
//
// We mock at the `bleManager + commands` layer (already proven by the
// Sprint 5 integration tests) rather than the ble-plx auto-mock, so
// the test owns the connect/notify/fetch sequence deterministically.

const mockConnectToUrion = jest.fn();
const mockSyncBacklog = jest.fn();
const mockSubscribeToNotifications = jest.fn();
const mockPostReading = jest.fn();

jest.mock('../../services/ble/bleManager', () => ({
  connectToUrion: (id: string) => mockConnectToUrion(id),
  // unused in these tests — the screen never scans
  scanForUrion: jest.fn(),
  requestBlePermissions: jest.fn(),
  observeBluetoothState: jest.fn(),
}));

jest.mock('../../services/sync/syncBacklog', () => ({
  syncBacklog: (...args: unknown[]) => mockSyncBacklog(...args),
}));

jest.mock('../../services/ble/notify', () => ({
  subscribeToNotifications: (
    device: unknown,
    handlers: { onBP?: () => void },
  ) => mockSubscribeToNotifications(device, handlers),
}));

jest.mock('../../services/sync/postReading', () => ({
  postReading: (...args: unknown[]) => mockPostReading(...args),
  setDeviceMetaProvider: () => undefined,
  getDeviceMeta: () => null,
  inferModel: () => 'U16H',
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
const navigate = jest.fn();
// Sprint 18 — added `replace` to support the new onContinueToDetail
// path that replaces TakeReading with ReadingDetail on the stack
// instead of pushing (so Back from ReadingDetail goes to Home, not
// back into the just-finished TakeReading success view).
const replace = jest.fn();
// The component's Props is a union; using `any` here bypasses a
// TS variance quirk in JSX prop resolution. Tests only exercise
// runtime behaviour, not the type signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nav: any = { goBack, navigate, replace };

beforeEach(() => {
  mockConnectToUrion.mockReset();
  mockSyncBacklog.mockReset();
  // Default: no backlog. Tests that care override per-call.
  mockSyncBacklog.mockResolvedValue({ pulled: 0, latestTimestampSec: null });
  mockSubscribeToNotifications.mockReset();
  mockPostReading.mockReset();
  goBack.mockReset();
  navigate.mockReset();
  mmkv.clearAll();
  useReadings.getState().reset();
  useTakeReading.getState().reset();
  usePairing.setState({
    pairedDevice: {
      bleId: 'AA:BB:CC:DD:E4:F2',
      macSuffix: 'e4f2',
      name: 'U19M_013C',
      pairedAt: Date.now(),
    },
  });
});

function makeFakeDevice() {
  return {
    id: 'AA:BB:CC:DD:E4:F2',
    disconnect: jest.fn().mockResolvedValue(undefined),
    onDisconnected: jest.fn().mockReturnValue(() => undefined),
  };
}

describe('TakeReadingScreen — happy path (watch flow)', () => {
  it('connects → waiting → fetching → success and persists to MMKV before rendering', async () => {
    const fakeDevice = makeFakeDevice();
    mockConnectToUrion.mockResolvedValue(fakeDevice);
    type Handlers = { onBP?: () => void };
    let capturedHandlers: Handlers | null = null;
    mockSubscribeToNotifications.mockImplementation((_d, h: Handlers) => {
      capturedHandlers = h;
      return jest.fn();
    });
    // syncBacklog is the new entry point (replaces readLatestBP).
    // The on-connect call returns 0 readings (no backlog); the
    // on-BP-ready call writes one row to the readings store and
    // returns pulled=1.
    mockSyncBacklog
      .mockImplementationOnce(async () => ({
        pulled: 0,
        latestTimestampSec: null,
      }))
      .mockImplementationOnce(async () => {
        useReadings.getState().addPendingReading({
          measuredAtSec: 1737385351,
          systolic: 124,
          diastolic: 79,
          pulse: 68,
          source: 'watch',
          deviceBleId: 'AA:BB:CC:DD:E4:F2',
        });
        return { pulled: 1, latestTimestampSec: 1737385351 };
      });
    mockPostReading.mockResolvedValue({
      readingId: 'srv-uuid',
      deviceId: 'dev-uuid',
      duplicate: false,
    });

    render(withProviders(<TakeReadingScreen navigation={nav} />));

    // Connecting view appears first (the begin() call resolves the
    // mocked connect synchronously after a microtask).
    expect(await screen.findByTestId('take-reading-waiting')).toBeTruthy();
    const handlers = capturedHandlers as Handlers | null;
    expect(handlers?.onBP).toBeDefined();

    // Simulate the watch firing 0x73 0x02 → handler runs internally:
    // sets phase=fetching, calls readLatestBP, writes MMKV, sets success.
    await act(async () => {
      handlers!.onBP!();
    });

    // Success view should render with the rendered numeric.
    expect(await screen.findByTestId('take-reading-success')).toBeTruthy();
    expect(screen.getByText('124/79')).toBeTruthy();
    expect(screen.getByText('In your usual range')).toBeTruthy();

    // MMKV write must have happened — the spec hard rule.
    const recent = JSON.parse(mmkv.getString(STORAGE_KEYS.recentReadings) ?? '[]');
    const pending = JSON.parse(mmkv.getString(STORAGE_KEYS.pendingReadings) ?? '[]');
    expect([...recent, ...pending]).toHaveLength(1);
    const stored = [...recent, ...pending][0];
    expect(stored).toMatchObject({
      systolic: 124,
      diastolic: 79,
      pulse: 68,
      source: 'watch',
    });

    // Sprint 18 bench bug — Done routes to Reading Detail with the
    // localId, and uses `replace` so the stack ends up as Home →
    // ReadingDetail (no orphaned TakeReading frame between them).
    // Falls back to `navigate` only if the navigator doesn't expose
    // `replace`.
    fireEvent.press(screen.getByTestId('take-reading-done'));
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('ReadingDetail', {
        readingLocalId: stored.localId,
      });
    });
    expect(navigate).not.toHaveBeenCalledWith(
      'ReadingDetail',
      expect.anything(),
    );
  });
});

describe('TakeReadingScreen — manual entry (D6 US-26)', () => {
  it('writes a manual reading without touching the watch', async () => {
    // No connect needed — manual path bypasses the BLE layer.
    mockConnectToUrion.mockResolvedValue(makeFakeDevice());
    mockSubscribeToNotifications.mockReturnValue(jest.fn());
    mockPostReading.mockResolvedValue({
      readingId: 'srv', deviceId: 'dev', duplicate: false,
    });

    render(withProviders(<TakeReadingScreen navigation={nav} />));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('take-reading-manual-cta'));
    });
    fireEvent.changeText(screen.getByTestId('take-reading-manual-sys'), '128');
    fireEvent.changeText(screen.getByTestId('take-reading-manual-dia'), '82');
    fireEvent.changeText(screen.getByTestId('take-reading-manual-pulse'), '74');
    await act(async () => {
      fireEvent.press(screen.getByTestId('take-reading-manual-save'));
    });

    expect(await screen.findByTestId('take-reading-success')).toBeTruthy();
    const all = [
      ...JSON.parse(mmkv.getString(STORAGE_KEYS.recentReadings) ?? '[]'),
      ...JSON.parse(mmkv.getString(STORAGE_KEYS.pendingReadings) ?? '[]'),
    ];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ systolic: 128, diastolic: 82, pulse: 74, source: 'manual' });
  });

  it('rejects out-of-range systolic with friendly copy', async () => {
    mockConnectToUrion.mockResolvedValue(makeFakeDevice());
    mockSubscribeToNotifications.mockReturnValue(jest.fn());

    render(withProviders(<TakeReadingScreen navigation={nav} />));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('take-reading-manual-cta'));
    });
    fireEvent.changeText(screen.getByTestId('take-reading-manual-sys'), '500');
    fireEvent.changeText(screen.getByTestId('take-reading-manual-dia'), '82');
    await act(async () => {
      fireEvent.press(screen.getByTestId('take-reading-manual-save'));
    });
    expect(await screen.findByTestId('take-reading-manual-error')).toBeTruthy();
    expect(screen.getByText(/between 30 and 300/i)).toBeTruthy();
  });
});

describe('TakeReadingScreen — failure path (connect fails)', () => {
  it('lands on failure with the friendly connect copy', async () => {
    mockConnectToUrion.mockRejectedValue(new Error('AUTH_FAIL'));
    render(withProviders(<TakeReadingScreen navigation={nav} />));
    expect(await screen.findByTestId('take-reading-failure')).toBeTruthy();
    expect(screen.getByText(/Bring the phone closer/i)).toBeTruthy();
    expect(screen.getByTestId('take-reading-retry')).toBeTruthy();
  });
});

describe('TakeReadingScreen — no paired device', () => {
  it('lands on failure when usePairing has no paired device', async () => {
    usePairing.setState({ pairedDevice: null });
    render(withProviders(<TakeReadingScreen navigation={nav} />));
    expect(await screen.findByTestId('take-reading-failure')).toBeTruthy();
    expect(screen.getByText(/Pair the watch first/i)).toBeTruthy();
  });
});
