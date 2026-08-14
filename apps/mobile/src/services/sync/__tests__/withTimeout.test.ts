import { SYNC_UPLOAD_TIMEOUT_MS, TimeoutError, withTimeout } from '../withTimeout';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes through a promise that settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'x')).resolves.toBe('ok');
  });

  it('preserves the original rejection rather than masking it', async () => {
    const boom = Promise.reject(new Error('upstream 503'));
    await expect(withTimeout(boom, 1000, 'x')).rejects.toThrow('upstream 503');
  });

  it('rejects with a labelled TimeoutError when the promise never settles', async () => {
    // The real case: an upload whose underlying fetch never returns.
    const assertion = expect(
      withTimeout(new Promise(() => {}), SYNC_UPLOAD_TIMEOUT_MS, '/sync upload'),
    ).rejects.toThrow(TimeoutError);
    jest.advanceTimersByTime(SYNC_UPLOAD_TIMEOUT_MS);
    await assertion;
  });

  it('names the caller in the timeout message so analytics can attribute it', async () => {
    const assertion = expect(
      withTimeout(new Promise(() => {}), 500, '/sync multi-vitals upload'),
    ).rejects.toThrow('/sync multi-vitals upload timed out after 500ms');
    jest.advanceTimersByTime(500);
    await assertion;
  });
});
