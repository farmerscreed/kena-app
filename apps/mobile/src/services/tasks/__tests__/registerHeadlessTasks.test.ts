// Guards the regression that made background sync a no-op on a cold
// wake: the task bodies must be defined without any component rendering,
// and nothing storage-dependent may be imported until the MMKV key is up.

const defineTask = jest.fn();
const isTaskDefined = jest.fn(() => false);

jest.mock(
  'expo-task-manager',
  () => ({ defineTask, isTaskDefined }),
  { virtual: true },
);
jest.mock(
  'expo-background-fetch',
  () => ({ BackgroundFetchResult: { NoData: 1, NewData: 2, Failed: 3 } }),
  { virtual: true },
);

import {
  BACKGROUND_SYNC_TASK,
  REMOTE_REFRESH_TASK,
} from '../taskNames';
import { registerHeadlessTasks } from '../registerHeadlessTasks';

describe('registerHeadlessTasks', () => {
  it('defines both OS tasks at import time, with no UI mounted', () => {
    registerHeadlessTasks();
    const names = defineTask.mock.calls.map((c) => c[0]);
    expect(names).toContain(BACKGROUND_SYNC_TASK);
    expect(names).toContain(REMOTE_REFRESH_TASK);
  });

  it('is idempotent — a second call does not redefine', () => {
    const before = defineTask.mock.calls.length;
    registerHeadlessTasks();
    expect(defineTask.mock.calls.length).toBe(before);
  });

  it('skips the run while a storage migration is pending', async () => {
    // Half-migrated store: better to do nothing and let the next app open
    // finish the migration than to read/write across both stores.
    jest.doMock('../../secureBoot', () => ({
      acquireMmkvKey: jest.fn(async () => ({ migrationStatus: 'pending' })),
    }));
    const runner = defineTask.mock.calls.find(
      (c) => c[0] === BACKGROUND_SYNC_TASK,
    )?.[1] as () => Promise<number>;
    await expect(runner()).resolves.toBe(1); // NoData
  });
});
