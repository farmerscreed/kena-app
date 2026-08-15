const pairingHydrate = jest.fn();
const readingsHydrate = jest.fn();
const pairingState: {
  hydrate: jest.Mock;
  pairedDevice: {
    bleId: string;
    macSuffix: string;
    name: string | null;
    pairedAt: number;
  } | null;
} = { hydrate: pairingHydrate, pairedDevice: null };

jest.mock('../pairing', () => ({
  usePairing: { getState: () => pairingState },
}));
jest.mock('../readings', () => ({
  useReadings: { getState: () => ({ hydrate: readingsHydrate }) },
}));
jest.mock('../../services/storage', () => ({
  getOrCreateClientDeviceId: () => 'client-device-1',
}));

const getSession = jest.fn();
const refreshSession = jest.fn();
jest.mock('../../services/supabase', () => ({
  supabase: { auth: { getSession, refreshSession } },
}));
jest.mock('../../services/analytics/logger', () => ({
  logger: { track: jest.fn() },
}));

import { getDeviceMeta, setDeviceMetaProvider } from '../../services/sync/postReading';
import {
  ensureSessionForHeadlessRun,
  hydrateForHeadlessRun,
} from '../hydrateForHeadlessRun';

const FAR_FUTURE = () => Math.floor(Date.now() / 1000) + 3600;
const NEARLY_EXPIRED = () => Math.floor(Date.now() / 1000) + 60;

beforeEach(() => {
  jest.clearAllMocks();
  pairingState.pairedDevice = null;
  // Reset to postReading's null default so each test proves the wiring
  // happened rather than inheriting it from a previous test.
  setDeviceMetaProvider(() => null);
});

describe('hydrateForHeadlessRun', () => {
  it('loads pairing and readings so an OS-woken run can find the watch', () => {
    hydrateForHeadlessRun();
    expect(pairingHydrate).toHaveBeenCalledTimes(1);
    expect(readingsHydrate).toHaveBeenCalledTimes(1);
  });

  it('leaves postReading able to resolve device meta with no navigator mounted', () => {
    // §6e — the provider was wired only in RootNavigator's module scope,
    // which never evaluates on a headless wake, so the background run's
    // BP upload threw "no paired device on file" (2026-08-14 21:37:34).
    pairingState.pairedDevice = {
      bleId: 'AA:BB:CC:DD:EE:FF',
      macSuffix: 'EEFF',
      name: 'U16H-1234',
      pairedAt: 1723600000000,
    };
    hydrateForHeadlessRun();
    expect(getDeviceMeta('AA:BB:CC:DD:EE:FF')).toEqual({
      bleId: 'AA:BB:CC:DD:EE:FF',
      macSuffix: 'EEFF',
      name: 'U16H-1234',
      model: 'U16H',
      clientDeviceId: 'client-device-1',
    });
  });

  it('still loads readings when pairing hydration throws', () => {
    // A corrupt pairing blob must not leave readings empty — an empty
    // readings store makes syncPending persist over stored rows.
    pairingHydrate.mockImplementationOnce(() => {
      throw new Error('corrupt');
    });
    expect(() => hydrateForHeadlessRun()).not.toThrow();
    expect(readingsHydrate).toHaveBeenCalledTimes(1);
  });

  it('never throws out of a background task when readings hydration fails', () => {
    readingsHydrate.mockImplementationOnce(() => {
      throw new Error('corrupt');
    });
    expect(() => hydrateForHeadlessRun()).not.toThrow();
    expect(pairingHydrate).toHaveBeenCalledTimes(1);
  });
});

describe('ensureSessionForHeadlessRun', () => {
  // 2026-08-15: watch reads succeeded in background while EVERY upload
  // failed, because a cold headless process never finishes recovering
  // its Supabase session and nothing refreshes an expired token (no
  // timers, no AppState 'active').

  it('accepts a session with plenty of life left, without refreshing', async () => {
    getSession.mockResolvedValueOnce({
      data: { session: { expires_at: FAR_FUTURE() } },
      error: null,
    });
    await expect(ensureSessionForHeadlessRun()).resolves.toBe(true);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes a token about to expire mid-run', async () => {
    // A full drain takes minutes; 60 s of validity would 401 halfway.
    getSession.mockResolvedValueOnce({
      data: { session: { expires_at: NEARLY_EXPIRED() } },
      error: null,
    });
    refreshSession.mockResolvedValueOnce({
      data: { session: { expires_at: FAR_FUTURE() } },
      error: null,
    });
    await expect(ensureSessionForHeadlessRun()).resolves.toBe(true);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('reports false when no session is stored, without throwing', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(ensureSessionForHeadlessRun()).resolves.toBe(false);
  });

  it('reports false when the refresh itself fails', async () => {
    getSession.mockResolvedValueOnce({
      data: { session: { expires_at: NEARLY_EXPIRED() } },
      error: null,
    });
    refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'network' },
    });
    await expect(ensureSessionForHeadlessRun()).resolves.toBe(false);
  });

  it('never throws out of a background task when getSession rejects', async () => {
    // Must not take the run down — pulling with a dead token still
    // persists to MMKV, and the next cycle retries the upload.
    getSession.mockRejectedValueOnce(new Error('secure store unavailable'));
    await expect(ensureSessionForHeadlessRun()).resolves.toBe(false);
  });
});
