// §9 — the headless-safe deadline. In jest the native module is absent,
// so headlessDelay falls back to setTimeout; these tests pin the race
// semantics that every BLE/upload timeout now relies on.

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: {},
}));

import { headlessDelay, raceWithHeadlessTimeout } from '../headlessDelay';

describe('headlessDelay', () => {
  it('resolves after the given wall-clock time (setTimeout fallback)', async () => {
    jest.useFakeTimers();
    const p = headlessDelay(5_000);
    jest.advanceTimersByTime(5_000);
    await expect(p).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});

describe('raceWithHeadlessTimeout', () => {
  afterEach(() => jest.useRealTimers());

  it('returns the promise result when it settles before the deadline', async () => {
    jest.useFakeTimers();
    const result = raceWithHeadlessTimeout(
      Promise.resolve('data'),
      1_000,
      () => new Error('too slow'),
    );
    await expect(result).resolves.toBe('data');
  });

  it('rejects with makeError() when the deadline passes first', async () => {
    jest.useFakeTimers();
    const never = new Promise<string>(() => {});
    const result = raceWithHeadlessTimeout(never, 1_000, () => new Error('too slow'));
    jest.advanceTimersByTime(1_000);
    await expect(result).rejects.toThrow('too slow');
  });

  it('does not invoke makeError when the promise settled in time', async () => {
    jest.useFakeTimers();
    const makeError = jest.fn(() => new Error('too slow'));
    const result = raceWithHeadlessTimeout(Promise.resolve('ok'), 1_000, makeError);
    await expect(result).resolves.toBe('ok');
    // Let the deadline lapse afterwards — the settled flag must gate it.
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(makeError).not.toHaveBeenCalled();
  });

  it('propagates the promise rejection when it loses to no one', async () => {
    jest.useFakeTimers();
    const result = raceWithHeadlessTimeout(
      Promise.reject(new Error('device gone')),
      1_000,
      () => new Error('too slow'),
    );
    await expect(result).rejects.toThrow('device gone');
  });
});
