// Readings store — Sprint 6.
//
// Single source of truth for readings on device. Two MMKV-backed
// arrays:
//   pending — captured locally, NOT yet acknowledged by /sync. Source
//             of truth for the offline-first guarantee.
//   recent  — most-recent-first, server-acknowledged readings shown on
//             home + Reading Detail. Capped at RECENT_READINGS_CAP to
//             keep the JSON blob small (no WatermelonDB until Sprint 7+).
//
// addPendingReading writes to pending SYNCHRONOUSLY before the UI is
// allowed to render success. The async sync then promotes from pending
// → recent on /sync acknowledgement, or leaves it in pending for a
// retry on the next connectivity event.
//
// Per CLAUDE.md data rule: reading values (sys/dia/pulse) NEVER appear
// in PostHog/analytics events. The store does NOT log values; it only
// counts (e.g., "reading_persisted" with no payload beyond a tier).

import { create } from 'zustand';
import { mmkv, STORAGE_KEYS } from '../services/storage';
import { logger } from '../services/analytics/logger';
import { classifyReading, type Classification } from '../utils/classification';
import { resolveBpBaselines } from '../utils/vitalBaselines';
import { postReading } from '../services/sync/postReading';
import { forwardReadingToPlatform } from '../services/health-platform/syncBridge';

const RECENT_READINGS_CAP = 30;

export type ReadingSource = 'watch' | 'manual';

export interface LocalReading {
  /** Stable client-side id (UUIDv4). The server-assigned id is recorded separately. */
  localId: string;
  /** Server-assigned UUID once /sync has acknowledged. null until then. */
  serverId: string | null;
  measuredAtSec: number;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  source: ReadingSource;
  classification: Classification;
  /** ble device MAC for this reading; null for manual entries. */
  deviceBleId: string | null;
  /** D13 PR-11 (§6.5) — reading_context tags. Optional so persisted
   *  pre-tag rows stay valid; a reading with no tags is valid. */
  contextTags?: string[];
  /** ms timestamp of the local insert (used for sort tie-break, debug). */
  capturedAtMs: number;
}

interface ReadingsState {
  pending: LocalReading[];
  recent: LocalReading[];
  syncing: boolean;
  syncError: string | null;

  hydrate: () => void;
  /** Synchronous MMKV write + tier classification. Returns the new row. */
  addPendingReading: (
    input: Omit<LocalReading, 'localId' | 'serverId' | 'classification' | 'capturedAtMs'>,
  ) => LocalReading;
  /** Best-effort sync of every pending row. Idempotent; safe to call repeatedly. */
  syncPending: () => Promise<void>;
  /** D13 PR-11 — attach context tags to a held reading (pre-sync). */
  setContextTags: (localId: string, tags: string[]) => void;
  /** Latest reading regardless of pending/recent. UI helper. */
  latest: () => LocalReading | null;
  /** Lookup by localId (UI deep-link). */
  byLocalId: (id: string) => LocalReading | null;
  /**
   * Sprint 12.5 fix — seed recent from server rows. Used on Home
   * first paint when MMKV is empty but the server has readings
   * (typical after a reinstall or MMKV clear). Idempotent: dedupes
   * by serverId, never touches pending, never re-adds a row whose
   * serverId already exists in recent.
   */
  seedRecentFromServer: (rows: LocalReading[]) => number;
  /** Test/utility: drop all rows (does NOT clear MMKV — use clearAll for that). */
  reset: () => void;
  /** Sprint 17b — visibility-enforcement purge. Clears `recent` and
   *  the persisted MMKV blob but PRESERVES `pending` (the user's
   *  own offline writes must never be wiped by an external toggle). */
  clearRecent: () => void;
}

function uuid(): string {
  // RFC4122 v4. Avoids importing a library; sufficient entropy for client-side ids.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const h = Array.from(bytes, hex);
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

function readJson<T>(key: string, fallback: T): T {
  const raw = mmkv.getString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function persist(state: { pending: LocalReading[]; recent: LocalReading[] }) {
  mmkv.set(STORAGE_KEYS.pendingReadings, JSON.stringify(state.pending));
  mmkv.set(STORAGE_KEYS.recentReadings, JSON.stringify(state.recent));
}

/** Identity tuple for a reading. Two rows with the same source + device +
 *  measured-at second are the same physical reading regardless of localId.
 *  Manual entries are deduped on the same triple (deviceBleId is null). */
function readingKey(r: LocalReading): string {
  return `${r.source}|${r.deviceBleId ?? ''}|${r.measuredAtSec}`;
}

/** Walk pending+recent in order; keep the FIRST occurrence of each
 *  readingKey. Recent is canonical for already-synced rows, so we walk
 *  it first. */
export function dedupeReadings(
  pending: LocalReading[],
  recent: LocalReading[],
): { pending: LocalReading[]; recent: LocalReading[] } {
  const seen = new Set<string>();
  const dedupedRecent: LocalReading[] = [];
  for (const r of recent) {
    const k = readingKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    dedupedRecent.push(r);
  }
  const dedupedPending: LocalReading[] = [];
  for (const r of pending) {
    const k = readingKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    dedupedPending.push(r);
  }
  return { pending: dedupedPending, recent: dedupedRecent };
}

export const useReadings = create<ReadingsState>((set, get) => ({
  pending: [],
  recent: [],
  syncing: false,
  syncError: null,

  hydrate: () => {
    const pending = readJson<LocalReading[]>(STORAGE_KEYS.pendingReadings, []);
    const recent = readJson<LocalReading[]>(STORAGE_KEYS.recentReadings, []);
    // One-shot dedupe — Sprint 12.5.1. Earlier syncBacklog runs (before
    // we understood DIR=1's "records older than TS" semantics) could
    // pile up duplicates from repeated cursor-walks-backward cycles.
    // Identity = (source, deviceBleId, measuredAtSec). Keep the FIRST
    // occurrence (it carries the original capturedAtMs / classification).
    const { pending: dedupedPending, recent: dedupedRecent } = dedupeReadings(pending, recent);
    if (
      dedupedPending.length !== pending.length ||
      dedupedRecent.length !== recent.length
    ) {
      persist({ pending: dedupedPending, recent: dedupedRecent });
    }
    set({ pending: dedupedPending, recent: dedupedRecent });
  },

  addPendingReading: (input) => {
    // Sprint 12.5.1 — dedupe at ingest. The watch's readBPHistory
    // happily returns the same record on multiple syncs (e.g. when
    // the cursor walks across the same ts), and the prior Commit-2
    // recovery branch made that worse. Identity = (source, device,
    // measuredAtSec). If a row already exists, return it as-is.
    const key = `${input.source}|${input.deviceBleId ?? ''}|${input.measuredAtSec}`;
    const existing =
      get().pending.find((r) => readingKey(r) === key) ??
      get().recent.find((r) => readingKey(r) === key);
    if (existing) {
      return existing;
    }
    // D13 PR-1 (P0-2) — classify against the wearer's own 28-day
    // baseline: the server truth-layer row when the cache has one,
    // else a provisional local recompute — so this works offline.
    // `classifyReading` owns the sufficiency gate and renders the
    // learning state until the §4.3 minimums are met. History (this
    // reading first) enables the three-consecutive confirmation rule.
    // The provisional sample set INCLUDES the reading being stored —
    // same batch-inclusive semantics as the hydration path, and the
    // ring's sufficiency fill counts every reading the account holds.
    const held = [...get().pending, ...get().recent];
    const familyId = mmkv.getString(STORAGE_KEYS.currentFamilyId) ?? '';
    const baselines = resolveBpBaselines(familyId, [
      { systolic: input.systolic, diastolic: input.diastolic, measuredAtSec: input.measuredAtSec },
      ...held,
    ]);
    const classification = classifyReading(
      { systolic: input.systolic, diastolic: input.diastolic, pulse: input.pulse },
      baselines,
      [
        { systolic: input.systolic, diastolic: input.diastolic, measuredAtSec: input.measuredAtSec },
        ...held
          .slice()
          .sort((a, b) => b.measuredAtSec - a.measuredAtSec)
          .map((r) => ({
            systolic: r.systolic,
            diastolic: r.diastolic,
            measuredAtSec: r.measuredAtSec,
          })),
      ],
    );
    const row: LocalReading = {
      ...input,
      localId: uuid(),
      serverId: null,
      classification,
      capturedAtMs: Date.now(),
    };
    const pending = [row, ...get().pending];
    const recent = get().recent;
    set({ pending });
    persist({ pending, recent });
    logger.track('reading_persisted', {
      source: row.source,
      tier: classification.tier,
    });
    // Fire-and-forget sync; UI doesn't await this.
    void get().syncPending();
    return row;
  },

  syncPending: async () => {
    if (get().syncing) return;
    set({ syncing: true, syncError: null });
    try {
      // Track sync results by localId rather than snapshotting `pending`
      // up-front. addPendingReading triggers syncPending() synchronously,
      // and the first call's `await postReading(...)` yields control —
      // during which subsequent addPendingReading calls grow `pending`.
      // The naive "snapshot then overwrite" approach loses those new
      // rows. By only removing synced ids at the end, new rows survive.
      const syncedIds = new Set<string>();
      const newRecentRows: LocalReading[] = [];
      let lastError: string | null = null;
      // Multiple passes catch rows added between iterations of the
      // outer loop. Capped to prevent runaway loops in pathological
      // cases (in practice 1-2 passes is enough).
      for (let pass = 0; pass < 5; pass++) {
        const snapshot = get().pending.filter(
          (r) => !syncedIds.has(r.localId),
        );
        if (snapshot.length === 0) break;
        let bailOnError = false;
        for (const row of snapshot) {
          try {
            const res = await postReading(row);
            syncedIds.add(row.localId);
            newRecentRows.unshift({ ...row, serverId: res.readingId });
            logger.track('reading_sync_success', { duplicate: res.duplicate });
            // Forward to Apple Health / Health Connect — Sprint 9.5.
            // Only on first-insert (skip on duplicate to avoid writing the
            // same sample twice on retry). Fire-and-forget; the bridge
            // gates on account_type + master/per-vital toggles.
            if (!res.duplicate) {
              void forwardReadingToPlatform({
                measuredAtSec: row.measuredAtSec,
                systolic: row.systolic,
                diastolic: row.diastolic,
                pulse: row.pulse,
                source: row.source,
              });
            }
          } catch (e) {
            lastError = e instanceof Error ? e.message : 'sync failed';
            logger.track('reading_sync_failed', { reason: lastError });
            // Treat the first failure as a network outage signal —
            // stop trying further rows; they'll be retried on the
            // next sync trigger. Avoids hammering an offline backend.
            bailOnError = true;
            break;
          }
        }
        if (bailOnError) break;
      }
      const finalPending = get().pending.filter(
        (r) => !syncedIds.has(r.localId),
      );
      // Sprint 16.5c — sort by measuredAtSec DESC before capping.
      //
      // Bug fix: pre-16.5c the order was
      //   `[...newRecentRows, ...get().recent].slice(0, 30)`
      // which silently dropped the NEWEST readings whenever a single
      // syncPending batch had > 30 rows. The cause was the iteration
      // order in the loop above: `pending` is newest-first (addPending
      // prepends), the `for` consumes it newest-first, and
      // `newRecentRows.unshift(...)` then inverts that ordering — so
      // `newRecentRows` ends up oldest-first. Concatenating with the
      // existing (newest-first) `recent` produced a non-monotonic
      // array, and `.slice(0, 30)` kept the front (oldest of the
      // newly-synced batch) and discarded the back (newest of the
      // batch + oldest of pre-existing recent).
      //
      // Symptom: after a "Reset cursors + re-sync" that pulled 50 BP
      // records, the 2-20 newest BP readings were silently missing
      // from the detail screen even though they were on the server.
      //
      // Mirrors HR's slice which already sorts before capping.
      const finalRecent = [...newRecentRows, ...get().recent]
        .sort((a, b) => b.measuredAtSec - a.measuredAtSec)
        .slice(0, RECENT_READINGS_CAP);
      set({ pending: finalPending, recent: finalRecent, syncError: lastError });
      persist({ pending: finalPending, recent: finalRecent });
    } finally {
      set({ syncing: false });
    }
  },

  setContextTags: (localId, tags) => {
    const patch = (rows: LocalReading[]) =>
      rows.map((r) => (r.localId === localId ? { ...r, contextTags: tags } : r));
    const pending = patch(get().pending);
    const recent = patch(get().recent);
    set({ pending, recent });
    persist({ pending, recent });
  },

  latest: () => {
    const all = [...get().pending, ...get().recent];
    if (all.length === 0) return null;
    // Order by measuredAtSec (the canonical "when the reading
    // happened"), then capturedAtMs as tiebreak. capturedAtMs alone
    // ties when a backlog batch is added in a tight loop with the
    // same Date.now() value across rows.
    return all.reduce((a, b) => {
      if (b.measuredAtSec !== a.measuredAtSec) {
        return b.measuredAtSec > a.measuredAtSec ? b : a;
      }
      return b.capturedAtMs > a.capturedAtMs ? b : a;
    });
  },

  byLocalId: (id) => {
    return (
      get().pending.find((r) => r.localId === id) ??
      get().recent.find((r) => r.localId === id) ??
      null
    );
  },

  seedRecentFromServer: (rows) => {
    const existing = get().recent;
    const existingServerIds = new Set(
      existing.map((r) => r.serverId).filter((id): id is string => id !== null),
    );
    const newRows = rows.filter(
      (r) => r.serverId !== null && !existingServerIds.has(r.serverId),
    );
    if (newRows.length === 0) return 0;
    // Merge + sort newest-first by measuredAtSec. Persist to MMKV
    // so subsequent app launches don't re-fetch.
    const merged = [...newRows, ...existing].sort(
      (a, b) => b.measuredAtSec - a.measuredAtSec,
    );
    const pending = get().pending;
    set({ recent: merged });
    persist({ pending, recent: merged });
    return newRows.length;
  },

  clearRecent: () => {
    set({ recent: [] });
    mmkv.remove(STORAGE_KEYS.recentReadings);
  },

  reset: () => {
    set({ pending: [], recent: [], syncing: false, syncError: null });
    mmkv.remove(STORAGE_KEYS.pendingReadings);
    mmkv.remove(STORAGE_KEYS.recentReadings);
  },
}));
