// §6e (plans/BACKGROUND_SYNC_INVESTIGATION_2026-08-14.md) — the
// device-meta provider must be wireable without RootNavigator, and the
// wired provider must resolve through the REAL postReading get/set pair
// (no mocks on postReading here — the round-trip is the point).

import type { PairedDevice } from '../pairing';

const pairingState: { pairedDevice: PairedDevice | null } = {
  pairedDevice: null,
};

jest.mock('../pairing', () => ({
  usePairing: { getState: () => pairingState },
}));
jest.mock('../../services/storage', () => ({
  getOrCreateClientDeviceId: () => 'client-device-1',
}));

import { getDeviceMeta } from '../../services/sync/postReading';
import { wireDeviceMetaProvider } from '../wireDeviceMetaProvider';

beforeEach(() => {
  pairingState.pairedDevice = null;
});

describe('wireDeviceMetaProvider', () => {
  it('lets postReading resolve device meta from the pairing store', () => {
    pairingState.pairedDevice = {
      bleId: 'AA:BB:CC:DD:EE:FF',
      macSuffix: 'EEFF',
      name: 'U16H-1234',
      pairedAt: 1723600000000,
    };
    wireDeviceMetaProvider();
    expect(getDeviceMeta('AA:BB:CC:DD:EE:FF')).toEqual({
      bleId: 'AA:BB:CC:DD:EE:FF',
      macSuffix: 'EEFF',
      name: 'U16H-1234',
      model: 'U16H',
      clientDeviceId: 'client-device-1',
    });
  });

  it('infers the U19M model from the paired name', () => {
    pairingState.pairedDevice = {
      bleId: 'ble-19',
      macSuffix: '0019',
      name: 'U19M-XY',
      pairedAt: 1723600000000,
    };
    wireDeviceMetaProvider();
    expect(getDeviceMeta('ble-19')?.model).toBe('U19M');
  });

  it('returns null when nothing is paired', () => {
    wireDeviceMetaProvider();
    expect(getDeviceMeta('anything')).toBeNull();
  });

  it('resolves per call, not at wire time — a device paired after wiring is found', () => {
    // The headless path wires before hydrate() populates the store; a
    // wire-time snapshot would permanently capture pairedDevice=null.
    wireDeviceMetaProvider();
    expect(getDeviceMeta('late')).toBeNull();
    pairingState.pairedDevice = {
      bleId: 'late',
      macSuffix: 'la7e',
      name: null,
      pairedAt: 1723600000000,
    };
    expect(getDeviceMeta('late')).not.toBeNull();
  });
});
