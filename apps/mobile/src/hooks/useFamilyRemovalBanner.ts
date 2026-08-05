// hooks/useFamilyRemovalBanner — Sprint 17b.
//
// Detects when a family the user was a member of has disappeared
// from `useFamilyReadings().parents` and surfaces a one-shot
// informational banner: "You're no longer in {label}'s circle."
//
// Why this exists:
//   - When the family_owner removes a caregiver, the caregiver
//     loses RLS access immediately. Their constellation just goes
//     empty on the next refetch with no explanation.
//   - The `family_removed` push (Sprint 17b server) is the primary
//     signal but is fragile (push permissions, quiet hours, no
//     token). This hook is the in-app safety net so the change never
//     reads as a bug.
//
// State machine:
//   1. Hook mounts; reads MMKV persisted map { familyId: label }.
//   2. On every `parents` change (post-loading), compares current
//      family_id set against persisted keys.
//   3. If any persisted familyId is missing from `parents`, that
//      family was removed → banner state goes visible with that
//      family's label.
//   4. If no disappearances, the persisted map is refreshed to
//      reflect the current set (covers the "just joined a new
//      family" + "labels changed" cases).
//   5. On `dismiss()`, the dismissed family is removed from the
//      persisted map; the banner hides.
//   6. While the banner is visible, the persisted map is NOT updated
//      — so a background → foreground cycle keeps the banner up
//      until the user acknowledges it.

import { useCallback, useEffect, useState } from 'react';
import { mmkv, STORAGE_KEYS } from '../services/storage';
import { logger } from '../services/analytics/logger';
import type { ParentSummary } from '../services/families/fetchParentSummaries';

export interface RemovedFamily {
  familyId: string;
  /** Human-readable label captured the last time the user was an
   *  active member of this family. */
  label: string;
}

export interface FamilyRemovalBannerState {
  removed: RemovedFamily | null;
  dismiss: () => void;
}

type PersistedMap = Record<string, string>;

function readPersisted(): PersistedMap {
  const raw = mmkv.getString(STORAGE_KEYS.lastKnownFamilyIds);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PersistedMap;
    }
    return {};
  } catch {
    return {};
  }
}

function writePersisted(map: PersistedMap): void {
  mmkv.set(STORAGE_KEYS.lastKnownFamilyIds, JSON.stringify(map));
}

function labelFor(parent: ParentSummary): string {
  // Sprint 19 (audit D12 P0-8) — "loved one" is a HARD FAIL in
  // docs/05-voice-and-claims.md §87 and was reaching the removal banner
  // whenever the display name was missing. "your family member" is the
  // sanctioned generic.
  return parent.parentDisplayName?.trim() || 'your family member';
}

export function buildCurrentMap(parents: ParentSummary[]): PersistedMap {
  const next: PersistedMap = {};
  for (const p of parents) {
    next[p.familyId] = labelFor(p);
  }
  return next;
}

/**
 * Returns the disappeared entries from `persisted` that aren't in
 * `current`. Exported for the hook's test surface.
 */
export function diffDisappeared(
  persisted: PersistedMap,
  current: PersistedMap,
): RemovedFamily[] {
  const out: RemovedFamily[] = [];
  for (const [familyId, label] of Object.entries(persisted)) {
    if (!(familyId in current)) {
      out.push({ familyId, label });
    }
  }
  return out;
}

export function useFamilyRemovalBanner(
  parents: ParentSummary[],
  isLoading: boolean,
): FamilyRemovalBannerState {
  const [removed, setRemoved] = useState<RemovedFamily | null>(null);

  useEffect(() => {
    // Wait for the first non-loading observation. The initial fetch
    // returns isLoading=true with parents=[] which would otherwise
    // be mistaken for a "you were removed from everything" event.
    if (isLoading) return;

    const persisted = readPersisted();
    const current = buildCurrentMap(parents);
    const disappeared = diffDisappeared(persisted, current);

    if (disappeared.length > 0) {
      // Surface the first disappearance. Multi-family removals in
      // the same session are rare; we'll re-evaluate on dismiss.
      const next = disappeared[0];
      setRemoved((prev) => {
        if (prev && prev.familyId === next.familyId) return prev;
        logger.track('family_removal_banner_shown', { familyId: next.familyId });
        return next;
      });
      // Persisted map is NOT updated here — keeping the disappeared
      // entry means a background → foreground cycle still shows the
      // banner until the user dismisses it.
      return;
    }

    // No disappearances — refresh persisted map to match current.
    // This is the "just joined a new family" + "label changed" path.
    writePersisted(current);
    // Clear any stale banner state if the user re-joined the family.
    if (removed && current[removed.familyId]) {
      setRemoved(null);
    }
  }, [parents, isLoading, removed]);

  const dismiss = useCallback(() => {
    setRemoved((prev) => {
      if (!prev) return null;
      const persisted = readPersisted();
      delete persisted[prev.familyId];
      writePersisted(persisted);
      return null;
    });
  }, []);

  return { removed, dismiss };
}
