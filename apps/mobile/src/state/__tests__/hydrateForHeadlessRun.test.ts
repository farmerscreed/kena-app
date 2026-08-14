const pairingHydrate = jest.fn();
const readingsHydrate = jest.fn();

jest.mock('../pairing', () => ({
  usePairing: { getState: () => ({ hydrate: pairingHydrate }) },
}));
jest.mock('../readings', () => ({
  useReadings: { getState: () => ({ hydrate: readingsHydrate }) },
}));

import { hydrateForHeadlessRun } from '../hydrateForHeadlessRun';

beforeEach(() => jest.clearAllMocks());

describe('hydrateForHeadlessRun', () => {
  it('loads pairing and readings so an OS-woken run can find the watch', () => {
    hydrateForHeadlessRun();
    expect(pairingHydrate).toHaveBeenCalledTimes(1);
    expect(readingsHydrate).toHaveBeenCalledTimes(1);
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
