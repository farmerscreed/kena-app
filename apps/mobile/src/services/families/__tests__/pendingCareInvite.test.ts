// Connect Phase C — the stash carries a join-link code across the
// signed-out / mid-onboarding gap so "Someone invited me" can prefill.

import {
  stashPendingCareInvite,
  getPendingCareInvite,
  clearPendingCareInvite,
} from '../pendingCareInvite';
import { mmkv, STORAGE_KEYS } from '../../storage';

beforeEach(() => {
  mmkv.remove(STORAGE_KEYS.pendingCareInviteCode);
});

describe('pendingCareInvite stash', () => {
  it('stashes and reads a valid 6-digit code', () => {
    stashPendingCareInvite('123456');
    expect(getPendingCareInvite()).toBe('123456');
  });

  it('ignores a non-6-digit code', () => {
    stashPendingCareInvite('abc');
    expect(getPendingCareInvite()).toBeNull();
  });

  it('clears the stash', () => {
    stashPendingCareInvite('123456');
    clearPendingCareInvite();
    expect(getPendingCareInvite()).toBeNull();
  });
});
