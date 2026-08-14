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

import { getDeviceMeta, setDeviceMetaProvider } from '../../services/sync/postReading';
import { hydrateForHeadlessRun } from '../hydrateForHeadlessRun';

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
