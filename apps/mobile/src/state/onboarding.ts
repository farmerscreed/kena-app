// Onboarding store — Sprints 3 & 4.
//
// Holds the in-flight caregiver and self-buyer onboarding drafts and
// exposes the actions that finalise each path. Both paths share the
// same shape:
//
//   1. Update public.users.display_name + timezone (and year_of_birth
//      for self-buyers) — the placeholders stamped by handle_new_user
//      are replaced with the user's real input.
//   2. Call the create_family RPC (SECURITY DEFINER, see migrations
//      0003_create_family_rpc.sql and 0004_create_family_self_buyer.sql)
//      which atomically writes the families row, the family_owner row,
//      and an audit_log entry. The RPC branches on the caller's
//      account_type to set parent_user_id and audit metadata.
//   3. Persist family_id + the appropriate *OnboardingComplete flag to
//      MMKV so the navigator routes the user out of the onboarding
//      stack on the next render.
//
// Why MMKV mirroring: the navigator needs a synchronous read at startup
// (before the Supabase session has hydrated) to decide whether to show
// the onboarding stack. The Zustand state is the runtime source of
// truth; MMKV is the persistent fallback that hydrate() reads on cold
// start.

import { create } from 'zustand';
import { mmkv, STORAGE_KEYS } from '../services/storage';
import { supabase } from '../services/supabase';
import { useAuth } from './auth';

export type CaregiverRelationship =
  | 'daughter'
  | 'son'
  | 'niece'
  | 'nephew'
  | 'other';

export type ParentRelationship =
  | 'mother'
  | 'father'
  | 'aunt'
  | 'uncle'
  | 'other';

export interface CaregiverDraft {
  displayName: string;
  relationship: CaregiverRelationship | null;
}

export interface ParentDraft {
  displayName: string;
  relationship: ParentRelationship | null;
  relationshipCustom: string | null;     // when relationship === 'other'
  timezone: string;                      // IANA, e.g. 'America/New_York'
}

export interface SelfBuyerDraft {
  displayName: string;
  yearOfBirth: number | null;            // optional per D8a §4.1
  timezone: string;                      // IANA, defaults to device zone
}

interface OnboardingState {
  // Drafts (cleared after successful completion).
  caregiver: CaregiverDraft;
  parent: ParentDraft;
  selfBuyer: SelfBuyerDraft;

  // Persisted across launches (mirrors MMKV).
  familyId: string | null;
  caregiverOnboardingComplete: boolean;
  selfBuyerOnboardingComplete: boolean;

  // In-flight call state shared by completeWithWatchInHand (caregiver)
  // and completeSelfBuyer.
  finalizing: boolean;
  finalizeError: string | null;

  setCaregiver: (patch: Partial<CaregiverDraft>) => void;
  setParent: (patch: Partial<ParentDraft>) => void;
  setSelfBuyer: (patch: Partial<SelfBuyerDraft>) => void;
  resetDraft: () => void;
  hydrate: () => void;
  completeWithWatchInHand: () => Promise<void>;
  /** Sprint 16.6 Issue #1 — invited-caregiver onboarding finalization.
   *  Same shape as completeWithWatchInHand but does NOT call the
   *  create_family RPC (no new family record); the familyId comes
   *  from the connect-accept result. Null when the outcome was
   *  'pending' (neither party wears a watch yet) — onboarding still
   *  completes without a current family, and the connect resolves in
   *  the database when either party pairs (migration 0051). */
  completeViaInvite: (familyId: string | null) => Promise<void>;
  completeSelfBuyer: () => Promise<void>;
}

function readBool(key: string): boolean {
  return mmkv.getBoolean(key) === true;
}

function emptyCaregiver(): CaregiverDraft {
  return { displayName: '', relationship: null };
}

function emptyParent(): ParentDraft {
  return {
    displayName: '',
    relationship: null,
    relationshipCustom: null,
    timezone: defaultTimezone(),
  };
}

function emptySelfBuyer(): SelfBuyerDraft {
  return {
    displayName: '',
    yearOfBirth: null,
    timezone: defaultTimezone(),
  };
}

function defaultTimezone(): string {
  // Intl.DateTimeFormat is available in Hermes / JSC; the timezone picker
  // on FamilyParent overrides this if the user's chosen parent lives in a
  // different region.
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Resolve the parent_relationship string we send to create_family. For
// 'other' with a custom label, encode as 'other:<label>' per the data
// model convention (see public.families.parent_relationship comment in
// docs/01-data-model.md).
function encodeParentRelationship(p: ParentDraft): string {
  if (p.relationship === 'other') {
    const label = (p.relationshipCustom ?? '').trim();
    return label.length > 0 ? `other:${label}` : 'other';
  }
  return p.relationship ?? '';
}

// Supabase surfaces typed PostgrestError / AuthError objects with a
// .message field rather than Error instances; check both shapes.
function messageFromError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message;
  }
  return "We couldn't finish setup. Try again.";
}

export const useOnboarding = create<OnboardingState>((set, get) => ({
  caregiver: emptyCaregiver(),
  parent: emptyParent(),
  selfBuyer: emptySelfBuyer(),
  familyId: mmkv.getString(STORAGE_KEYS.currentFamilyId) ?? null,
  caregiverOnboardingComplete: readBool(STORAGE_KEYS.caregiverOnboardingComplete),
  selfBuyerOnboardingComplete: readBool(STORAGE_KEYS.selfBuyerOnboardingComplete),
  finalizing: false,
  finalizeError: null,

  setCaregiver(patch) {
    set((s) => ({ caregiver: { ...s.caregiver, ...patch } }));
  },

  setParent(patch) {
    set((s) => ({ parent: { ...s.parent, ...patch } }));
  },

  setSelfBuyer(patch) {
    set((s) => ({ selfBuyer: { ...s.selfBuyer, ...patch } }));
  },

  resetDraft() {
    set({
      caregiver: emptyCaregiver(),
      parent: emptyParent(),
      selfBuyer: emptySelfBuyer(),
      finalizeError: null,
    });
  },

  hydrate() {
    set({
      familyId: mmkv.getString(STORAGE_KEYS.currentFamilyId) ?? null,
      caregiverOnboardingComplete: readBool(STORAGE_KEYS.caregiverOnboardingComplete),
      selfBuyerOnboardingComplete: readBool(STORAGE_KEYS.selfBuyerOnboardingComplete),
    });
  },

  async completeWithWatchInHand() {
    const { caregiver, parent } = get();
    const profile = useAuth.getState().profile;

    if (!profile) {
      throw new Error('Not signed in. Sign in and try again.');
    }
    if (!caregiver.displayName.trim() || !caregiver.relationship) {
      throw new Error('Caregiver profile is incomplete.');
    }
    if (!parent.displayName.trim() || !parent.relationship) {
      throw new Error('Parent profile is incomplete.');
    }

    set({ finalizing: true, finalizeError: null });

    try {
      // 1. Replace the placeholder display_name + timezone stamped by
      //    handle_new_user with the caregiver's real input. The caregiver's
      //    own timezone defaults to the device's; the parent's timezone is
      //    captured in families.parent_residence work in a later sprint.
      const { error: updateError } = await supabase
        .from('users')
        .update({
          display_name: caregiver.displayName.trim(),
          timezone: parent.timezone || defaultTimezone(),
        })
        .eq('id', profile.id);
      if (updateError) throw updateError;

      // 2. Atomic family + family_member + audit_log via the RPC.
      const { data, error: rpcError } = await supabase.rpc('create_family', {
        _parent_display_name: parent.displayName.trim(),
        _parent_relationship: encodeParentRelationship(parent),
        _caregiver_relationship: caregiver.relationship,
      });
      if (rpcError) throw rpcError;

      const familyId = Array.isArray(data) ? data[0]?.family_id : null;
      if (!familyId) {
        throw new Error('create_family returned no family_id');
      }

      // 3. Persist + flip the navigator gate.
      mmkv.set(STORAGE_KEYS.currentFamilyId, familyId);
      mmkv.set(STORAGE_KEYS.caregiverOnboardingComplete, true);

      // Sprint 18 bench bug — the .update() above wrote display_name +
      // timezone to public.users but useAuth.profile is still the stale
      // placeholder hydrated at signup. Refresh BEFORE flipping the
      // navigator gate so the first render of post-onboarding Home (and
      // any Settings → Profile peek) sees the values the user just
      // entered.
      try {
        await useAuth.getState().refreshProfile();
      } catch {
        // Profile refresh failure is non-fatal — DB has the truth; the
        // next app open / refreshProfile call will catch up.
      }

      set({
        familyId,
        caregiverOnboardingComplete: true,
        caregiver: emptyCaregiver(),
        parent: emptyParent(),
        finalizing: false,
      });
    } catch (e) {
      set({ finalizing: false, finalizeError: messageFromError(e) });
      throw e;
    }
  },

  async completeViaInvite(familyId: string | null) {
    const { caregiver } = get();
    const profile = useAuth.getState().profile;

    if (!profile) {
      throw new Error('Not signed in. Sign in and try again.');
    }

    set({ finalizing: true, finalizeError: null });

    try {
      // If the caregiver got as far as filling out their display name
      // (FamilyYou) before taking the invite path, replace the
      // placeholder display_name + timezone stamped by
      // handle_new_user. If they jumped straight to the invite without
      // touching FamilyYou, leave the placeholder alone — the user
      // can edit their profile from Settings later.
      if (caregiver.displayName.trim()) {
        const { error: updateError } = await supabase
          .from('users')
          .update({
            display_name: caregiver.displayName.trim(),
            timezone: defaultTimezone(),
          })
          .eq('id', profile.id);
        if (updateError) throw updateError;
      }

      // Persist + flip the navigator gate. connect-accept has already
      // created the family_members row for this user (or recorded a
      // pending connect), so no additional RPC is needed here. On a
      // 'pending' outcome there is no circle yet — skip currentFamilyId
      // and let home show its empty state until pairing resolves it.
      if (familyId) {
        mmkv.set(STORAGE_KEYS.currentFamilyId, familyId);
      }
      mmkv.set(STORAGE_KEYS.caregiverOnboardingComplete, true);

      // Sprint 18 bench bug — refresh useAuth.profile so Settings →
      // Profile reflects the freshly-written display_name + timezone
      // (or, on the skip-FamilyYou path, the handle_new_user
      // placeholder) instead of whatever was hydrated at signup.
      try {
        await useAuth.getState().refreshProfile();
      } catch {
        // Non-fatal; next refresh will catch up.
      }

      set({
        familyId,
        caregiverOnboardingComplete: true,
        caregiver: emptyCaregiver(),
        parent: emptyParent(),
        finalizing: false,
      });
    } catch (e) {
      set({ finalizing: false, finalizeError: messageFromError(e) });
      throw e;
    }
  },

  async completeSelfBuyer() {
    const { selfBuyer } = get();
    const profile = useAuth.getState().profile;

    if (!profile) {
      throw new Error('Not signed in. Sign in and try again.');
    }
    if (!selfBuyer.displayName.trim()) {
      throw new Error('Profile is incomplete.');
    }

    set({ finalizing: true, finalizeError: null });

    try {
      // 1. Replace placeholder display_name + timezone (and optionally
      //    year_of_birth) on public.users.
      const userPatch: {
        display_name: string;
        timezone: string;
        year_of_birth?: number | null;
      } = {
        display_name: selfBuyer.displayName.trim(),
        timezone: selfBuyer.timezone || defaultTimezone(),
      };
      if (selfBuyer.yearOfBirth !== null) {
        userPatch.year_of_birth = selfBuyer.yearOfBirth;
      }
      const { error: updateError } = await supabase
        .from('users')
        .update(userPatch)
        .eq('id', profile.id);
      if (updateError) throw updateError;

      // 2. Atomic family + family_member + audit_log via the RPC. The
      //    RPC branches on account_type — for self_buyer it sets
      //    parent_user_id = caller and parent_relationship = 'self'.
      //    The third arg is unused on the self_buyer path; we pass
      //    'self' for symmetry.
      const { data, error: rpcError } = await supabase.rpc('create_family', {
        _parent_display_name: selfBuyer.displayName.trim(),
        _parent_relationship: 'self',
        _caregiver_relationship: 'self',
      });
      if (rpcError) throw rpcError;

      const familyId = Array.isArray(data) ? data[0]?.family_id : null;
      if (!familyId) {
        throw new Error('create_family returned no family_id');
      }

      // 3. Persist + flip the navigator gate.
      mmkv.set(STORAGE_KEYS.currentFamilyId, familyId);
      mmkv.set(STORAGE_KEYS.selfBuyerOnboardingComplete, true);

      // Sprint 18 bench bug — refresh useAuth.profile so Settings →
      // Profile reflects the display_name + timezone + year_of_birth
      // the user just entered in onboarding instead of the
      // handle_new_user placeholder hydrated at signup.
      try {
        await useAuth.getState().refreshProfile();
      } catch {
        // Non-fatal; next refresh will catch up.
      }

      set({
        familyId,
        selfBuyerOnboardingComplete: true,
        selfBuyer: emptySelfBuyer(),
        finalizing: false,
      });
    } catch (e) {
      set({ finalizing: false, finalizeError: messageFromError(e) });
      throw e;
    }
  },
}));
