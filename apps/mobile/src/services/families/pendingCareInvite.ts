// pendingCareInvite — the join-link code stash (Connect Phase C).
//
// A tapped leiko.app/join?code= link can arrive before the app can act
// on it: signed out, or mid-onboarding, where the Settings route the
// dispatcher targets doesn't exist yet. The deep-link handler stashes
// the code here; the "Someone invited me" onboarding path reads it to
// prefill the Enter-a-code sheet, and clears it once the code is
// accepted. Signed-in users on the main stack never need the stash —
// the dispatcher routes them straight to Settings with the code.

import { mmkv, STORAGE_KEYS } from '../storage';

export function stashPendingCareInvite(code: string): void {
  if (/^\d{6}$/.test(code)) {
    mmkv.set(STORAGE_KEYS.pendingCareInviteCode, code);
  }
}

export function getPendingCareInvite(): string | null {
  return mmkv.getString(STORAGE_KEYS.pendingCareInviteCode) ?? null;
}

export function clearPendingCareInvite(): void {
  mmkv.remove(STORAGE_KEYS.pendingCareInviteCode);
}
