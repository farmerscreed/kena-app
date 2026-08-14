// Analytics logger shim — Sprint 5; PostHog wired post-audit.
//
// Behaviour:
//   • Every track() call still logs to console in __DEV__.
//   • If PostHog is configured (EXPO_PUBLIC_POSTHOG_API_KEY set) the
//     event goes straight to PostHog AND the pre-init MMKV ring
//     buffer is drained the first time we successfully send.
//   • If PostHog is NOT configured, events queue in MMKV exactly as
//     they used to — peekRecent / drainQueue / queueLength still work.
//
// Per CLAUDE.md data rule: reading values (BP, HR, SpO2) NEVER appear
// in analytics events. Pass deviceId / family_id / counts / categories
// only. The AnalyticsEvent union below enforces this at compile time.

import { mmkv } from '../storage';
import { capturePosthog, getPosthog, initPosthog } from './posthog';

const RING_BUFFER_KEY = 'leiko.analytics.queue';
const RING_BUFFER_LIMIT = 200;

export type AnalyticsEvent =
  | { name: 'ble_scan_started'; props?: Record<string, unknown> }
  | { name: 'ble_scan_stopped'; props?: { reason: string } }
  | { name: 'ble_device_found'; props?: { macSuffix: string } }
  | { name: 'ble_pair_attempt'; props?: { macSuffix: string } }
  | { name: 'ble_pair_success'; props?: { macSuffix: string; durationMs: number } }
  | { name: 'ble_pair_failed'; props?: { macSuffix?: string; reason: string } }
  | { name: 'ble_crc_fail'; props?: { deviceId?: string } }
  | { name: 'ble_invalid_reading'; props?: { deviceId?: string; field: string } }
  | { name: 'ble_disconnected'; props?: { deviceId?: string; reason?: string } }
  | { name: 'ble_reconnect_attempt'; props?: { deviceId?: string; retryCount: number } }
  | { name: 'ble_reconnect_gave_up'; props?: { deviceId?: string } }
  | { name: 'ble_permission_denied'; props?: { permission: string } }
  | { name: 'ble_bluetooth_off' }
  | { name: 'ble_forget_device'; props?: { deviceId?: string } }
  // BLE foreground service lifecycle (Android only). Keeps the OS
  // process + connection alive while backgrounded; the persistent
  // notification is required by Play Console for
  // FOREGROUND_SERVICE_CONNECTED_DEVICE. No reading values ever appear.
  | { name: 'ble_fg_started' }
  | { name: 'ble_fg_stopped' }
  | { name: 'ble_fg_unavailable'; props?: { reason: string } }
  | { name: 'ble_fg_start_failed'; props?: { reason: string } }
  | { name: 'ble_fg_stop_failed'; props?: { reason: string } }
  // Battery-optimization (Doze) exemption prompt. No PHI — just whether the
  // system dialog was opened, so we can see how many wearers enable it.
  | { name: 'battery_opt_prompt_shown' }
  | { name: 'battery_opt_prompt_failed'; props?: { reason: string } }
  // Sprint 6 — reading capture lifecycle. Per CLAUDE.md data rule,
  // event payloads NEVER include sys/dia/pulse values, only counts +
  // categories.
  | { name: 'reading_persisted'; props?: { source: 'watch' | 'manual'; tier: 'in_pattern' | 'calm_concerned' | 'confirmed_urgent' } }
  | { name: 'reading_sync_success'; props?: { duplicate: boolean } }
  | { name: 'reading_sync_failed'; props?: { reason: string } }
  | { name: 'take_reading_started'; props?: { trigger: 'fab' | 'manual_sheet' } }
  // `watch_post_disconnect` — the watch severed BLE during cuff inflate
  // (Sprint 12.5.1 fix); we reconnected and pulled the new reading from
  // backlog. Distinct from `watch` to measure how often this path fires.
  | { name: 'take_reading_received'; props?: { source: 'watch' | 'manual' | 'watch_post_disconnect' } }
  | { name: 'take_reading_failed'; props?: { reason: string } }
  // Sprint 12.5.1 — stale BP cursor recovery in syncBacklog. Fired when
  // the watch's newest stored BP is older than our cursor (firmware
  // ring-buffer eviction, watch clock change, manual delete on watch).
  | { name: 'ble_cursor_reset'; props?: { deviceBleId: string; previousCursor: number; newCursor: number; gapSeconds: number } }
  // Sprint 7 — sync orchestrator. Counts + categories only; the reading
  // values themselves never appear in events (CLAUDE.md data rule).
  | { name: 'sync_started'; props?: { trigger: 'cold_start' | 'app_foreground' | 'bt_ready' | 'manual_force' | 'live_notify' | 'background' | 'remote_refresh' } }
  | { name: 'sync_completed'; props?: { trigger: string; batches: number; hitBatchCap: boolean; pulled: number } }
  | { name: 'sync_skipped'; props?: { trigger: string; reason: 'no_paired_device' | 'take_reading_active' | 'too_recent' | 'already_running' } }
  | { name: 'sync_failed'; props?: { trigger: string; reason: string } }
  // Remote-refresh (silent push → background watch sync; or a tapped
  // visible sync-nudge → foreground sync).
  | { name: 'remote_refresh_received'; props?: { source: 'background' | 'foreground' | 'tap' } }
  | { name: 'remote_refresh_failed'; props?: { reason: string } }
  | { name: 'remote_refresh_task_error'; props?: { reason: string } }
  | { name: 'remote_refresh_registered'; props?: Record<string, never> }
  | { name: 'remote_refresh_register_failed'; props?: { reason: string } }
  | { name: 'remote_refresh_requested'; props?: { outcome: string; escalated?: boolean } }
  | { name: 'reading_realtime_received'; props?: { familyId: string } }
  // Sprint 7.7b — multi-vital realtime path. Caregiver home invalidates
  // its query when any vitals_other row is INSERTed for a family the
  // signed-in user belongs to. Counts/categories never carry the value.
  | { name: 'vitals_other_realtime_received'; props?: { familyId: string } }
  // Sprint 7.5 — per-vital persistence + sync lifecycle. Counts +
  // categories only; sample VALUES (bpm, percent, steps, etc.) never
  // appear in analytics. Per CLAUDE.md data rule + D13 §5.1.
  | { name: 'vital_persisted'; props?: { vital_type: 'hr' | 'spo2' | 'sleep' | 'activity' | 'calories'; count?: number } }
  | { name: 'vital_sync_accepted'; props?: { vital_type: 'hr' | 'spo2' | 'sleep' | 'activity' | 'calories'; count: number } }
  // Sprint 16.5b — multi-vitals upload failure. Pre-16.5b syncMultiVitals's
  // return value was ignored by the orchestrator, so /sync upload errors
  // were silent — pending arrays grew for 8+ days at a time without any
  // analytics signal. This event makes the failure visible. Per CLAUDE.md
  // data rule: counts of pending rows + error code only, NEVER values.
  | { name: 'multi_vitals_sync_failed'; props?: { reason: string; hr_pending: number; spo2_pending: number; sleep_pending: number; steps_pending: number; calories_pending: number } }
  // Sprint 9.5 — Apple Health / Health Connect bridge. Counts only,
  // never values. Per D13 §13.4 + CLAUDE.md analytics rule.
  | { name: 'health_platform_write'; props?: { vital_type: 'bp' | 'hr' | 'spo2' | 'sleep' | 'steps' | 'calories'; written: number; rejected: number } }
  | { name: 'health_platform_write_failed'; props?: { vital_type: string; reason: string } }
  | { name: 'health_platform_read_completed'; props?: { inserted: number; duplicates: number; rejected: number } }
  | { name: 'health_platform_read_failed'; props?: { stage: 'platform_read' | 'sync_post'; reason: string } }
  | { name: 'health_platform_read_skipped'; props?: { trigger: 'foreground' | 'manual' | 'background'; reason: string } }
  | { name: 'health_platform_permission_granted'; props?: { platform: string } }
  | { name: 'health_platform_permission_dismissed'; props?: { platform: string } }
  | { name: 'health_platform_permission_skipped'; props?: { platform: string; reason: string } }
  // Sprint 10b.2 — Settings → Vital streams + Goals flush to the watch.
  // Closes memory/multi_vitals_gap.md "setUserParams + setGoals stubbed".
  | { name: 'device_config_flushed'; props?: { steps: number } }
  | { name: 'device_config_failed'; props?: { failedStep: string; completed: number } }
  // Sprint 10b.3 — Settings → Notifications + Privacy.
  | { name: 'notification_prefs_sync_failed'; props?: { reason: string } }
  | { name: 'data_export_started'; props?: { tier: string } }
  | { name: 'data_export_completed'; props?: { rowCount: number } }
  | { name: 'data_export_failed'; props?: { reason: string } }
  | { name: 'account_delete_requested'; props?: { confirmed: boolean } }
  | { name: 'account_delete_failed'; props?: { reason: string } }
  // Sprint 10c.1 — Family invite flow.
  | { name: 'family_invite_send_started' }
  | { name: 'family_invite_send_completed' }
  | { name: 'family_invite_send_failed'; props?: { reason: string } }
  | { name: 'family_invite_accept_started' }
  | { name: 'family_invite_accept_completed'; props?: { familyId: string } }
  | { name: 'family_invite_accept_failed'; props?: { reason: string } }
  // ADR-0006 — caregiver-initiated pending invite (send + wearer-resolve).
  | { name: 'care_invite_send_started' }
  | { name: 'care_invite_send_completed' }
  | { name: 'care_invite_send_failed'; props?: { reason: string } }
  | { name: 'care_invite_resolve_started' }
  | { name: 'care_invite_resolve_completed'; props?: { familyId: string } }
  | { name: 'care_invite_resolve_failed'; props?: { reason: string } }
  // ADR-0007 — unified Connect (one code, backend infers direction).
  | { name: 'connect_create_started' }
  | { name: 'connect_create_completed' }
  | { name: 'connect_create_failed'; props?: { reason: string } }
  | { name: 'connect_accept_started' }
  | { name: 'connect_accept_completed'; props?: { outcome: string } }
  | { name: 'connect_accept_failed'; props?: { reason: string } }
  // Connect Phase C — one-tap follow-back when both parties wear watches.
  | { name: 'connect_follow_back_started' }
  | { name: 'connect_follow_back_completed' }
  | { name: 'connect_follow_back_failed'; props?: { reason: string } }
  // Sprint 19 — Care for another person (caregiver-side create_family).
  | { name: 'family_add_another_started' }
  | { name: 'family_add_another_completed' }
  | { name: 'family_add_another_failed'; props?: { reason: string } }
  // Sprint 19 — Edit family details (owner-only).
  | { name: 'family_details_update_started' }
  | { name: 'family_details_update_completed' }
  | { name: 'family_details_update_failed'; props?: { reason: string } }
  // Sprint 17b — Family member management (owner remove + self leave).
  | { name: 'family_member_removed' }
  | { name: 'family_member_remove_failed'; props?: { reason: string } }
  | { name: 'family_self_left' }
  | { name: 'family_self_leave_failed'; props?: { reason: string } }
  | { name: 'family_removal_push_failed'; props?: { reason: string } }
  | { name: 'family_removal_banner_shown'; props?: { familyId: string } }
  | { name: 'visibility_slice_purged'; props?: { vital: string } }
  // Sprint 10c.2 polish — OS-scheduled background sync lifecycle.
  | { name: 'background_sync_registered'; props?: { intervalMin: number } }
  | { name: 'background_sync_unregistered' }
  | { name: 'background_sync_unavailable'; props?: { reason: string } }
  | { name: 'background_sync_fired'; props?: { result: 'ran' | 'skipped' | 'errored'; reason?: string } }
  // Sprint 12 — Tier-B AI gateway. Body of the LLM response is NEVER
  // included in props per CLAUDE.md / D14 §13.
  | { name: 'ai_tier_b_started'; props?: { length: number } }
  | { name: 'ai_tier_b_ok'; props?: { retries: number; layer1_hits: number; layer2_max_cosine: number } }
  | { name: 'ai_tier_b_defer'; props?: { trigger: string; reason: string } }
  | { name: 'ai_tier_b_quota_exceeded' }
  | { name: 'ai_tier_b_failed'; props?: { reason: string } }
  // Sprint 16 — AI fall-through cascade. Emitted on every step-down
  // (Tier-B → Tier-A or → deterministic, Tier-A → deterministic).
  // `from`/`to` identify the cascade stages; `reason` carries the
  // upstream failure code without ever including the response body.
  | {
      name: 'ai_degraded_fall_through';
      props?: {
        surface:
          | 'ask_leiko'
          | 'daily_narration'
          | 'reading_paragraph'
          | 'weekly_summary'
          | 'vital_insight'
          | 'trends_narrative';
        from: 'tier_b' | 'tier_a';
        to: 'tier_a' | 'deterministic';
        reason: string;
      };
    }
  // Sprint 14.5 — self-buyer family auto-provision (legacy backfill).
  | { name: 'family_auto_provision_started' }
  | { name: 'family_auto_provision_completed' }
  | { name: 'family_auto_provision_failed'; props?: { reason: string } }
  // Sprint 12.5 — ambient AI narrations. tier identifies the path
  // ('A' = local template, 'B' = Tier-B LLM via Edge Function).
  // Body NEVER appears in props per CLAUDE.md / D14 §13.
  | { name: 'daily_narration_generated'; props?: { tier: string; template_id: string } }
  | { name: 'reading_paragraph_generated'; props?: { tier: string; template_id: string } }
  // Sprint 12.5 fix — readings seeded from server when local is empty.
  | { name: 'readings_hydrated_from_server'; props?: { count: number } }
  // Sprint 15 — push notification lifecycle. Token is opaque; no PHI.
  | { name: 'push_permission_prompted'; props?: { granted: boolean } }
  | { name: 'push_permission_denied' }
  | { name: 'push_token_registered'; props?: { platform: 'ios' | 'android' | 'web' } }
  | { name: 'push_token_fetch_failed'; props?: { reason: string } }
  | { name: 'push_token_upsert_failed'; props?: { reason: string } }
  | { name: 'push_token_unregister_failed'; props?: { reason: string } }
  | { name: 'push_received'; props?: { category: string } }
  | { name: 'push_opened'; props?: { category: string; deepLink: string } }
  // Sprint 15 — anomaly events. Reading values NEVER appear here.
  // tier is the classification; vital identifies which engine fired.
  | {
      name: 'anomaly_fired';
      props?: {
        vital: 'bp' | 'hr' | 'spo2';
        tier: 'calm_concerned' | 'confirmed_urgent';
        reason: string;
      };
    }
  | {
      name: 'anomaly_feedback';
      props?: {
        vital: 'bp' | 'hr' | 'spo2';
        tier: 'calm_concerned' | 'confirmed_urgent';
        thumb: -1 | 1;
      };
    }
  | { name: 'anomaly_banner_dismissed'; props?: { vital: 'bp' | 'hr' | 'spo2' } }
  | { name: 'anomaly_banner_tapped'; props?: { vital: 'bp' | 'hr' | 'spo2'; tier: 'calm_concerned' | 'confirmed_urgent' } }
  // "For your doctor" PDF prep flow — Trends v2 follow-up.
  | { name: 'doctor_pdf_requested'; props?: { range: '7d' | '30d' | '90d' | '1y' } }
  | { name: 'doctor_pdf_generated'; props?: { bytes: number } }
  | { name: 'doctor_pdf_failed'; props?: { reason: string } }
  // Sprint 18 / SEC-1 — MMKV encryption-at-rest boot telemetry. `encrypted`
  // is the load-bearing metric: if it stays below 100% in prod we need
  // to investigate which devices are failing the keychain step. Never
  // includes the key or any stored value.
  | {
      name: 'sec1_boot_completed';
      props?: {
        encrypted: boolean;
        status: 'completed' | 'pending' | 'failed';
        attempts: number;
        migrationDurationMs: number;
        keysCopied: number;
      };
    }
  | {
      name: 'sec1_migration_failed';
      props?: { mode: 'keychain' | 'copy' | 'limit_reached'; attempt: number; reason: string };
    }
  | { name: 'sec1_legacy_deleted' };

type EventName = AnalyticsEvent['name'];

function readQueue(): Array<{ name: EventName; props: unknown; ts: number }> {
  const raw = mmkv.getString(RING_BUFFER_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: Array<{ name: EventName; props: unknown; ts: number }>): void {
  const trimmed = queue.length > RING_BUFFER_LIMIT
    ? queue.slice(-RING_BUFFER_LIMIT)
    : queue;
  mmkv.set(RING_BUFFER_KEY, JSON.stringify(trimmed));
}

type EventProps<N extends EventName> = Extract<AnalyticsEvent, { name: N }> extends {
  props?: infer P;
}
  ? P
  : never;

let drainedBuffer = false;

function drainBufferToPosthog(): void {
  if (drainedBuffer) return;
  const ph = getPosthog();
  if (!ph) return;
  const queue = readQueue();
  if (queue.length === 0) {
    drainedBuffer = true;
    return;
  }
  for (const entry of queue) {
    try {
      ph.capture(entry.name, {
        ...(entry.props && typeof entry.props === 'object' ? entry.props : {}),
        // Stamp the original capture time so a delayed flush doesn't
        // back-date events to "now" in PostHog's UI.
        $timestamp: new Date(entry.ts).toISOString(),
        $is_buffered: true,
      });
    } catch {
      // PostHog SDK swallows transport errors internally; this catch
      // is purely defensive against a malformed entry.
    }
  }
  // Wipe the local buffer on a best-effort basis. If PostHog later
  // turns out to have rejected an event, we lose that one — acceptable
  // given the alternative is the buffer growing unbounded across
  // re-foregrounds.
  mmkv.set(RING_BUFFER_KEY, '[]');
  drainedBuffer = true;
}

export function track<N extends EventName>(name: N, props?: EventProps<N>): void {
  const entry = { name, props: props ?? null, ts: Date.now() };
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[analytics]', name, props ?? '');
  }
  // Kick off init on first track call. Idempotent — only the first
  // caller actually configures the client; everyone else awaits the
  // same promise. We don't await here so analytics call sites stay
  // synchronous.
  void initPosthog().then(drainBufferToPosthog);

  const ph = getPosthog();
  if (ph) {
    drainBufferToPosthog();
    capturePosthog(name, (props ?? {}) as Record<string, unknown>);
    return;
  }
  // Pre-PostHog (or never-PostHog) path: buffer to MMKV. Same shape
  // the dev DebugLauncher already reads via peekRecent / queueLength.
  const queue = readQueue();
  queue.push(entry);
  writeQueue(queue);
}

/** Read the most-recent N events without draining. Used by the dev
 *  debug panel for the sync-event timeline. Returns oldest-first. */
export function peekRecent(n: number): Array<{ name: EventName; props: unknown; ts: number }> {
  const queue = readQueue();
  return queue.slice(-n);
}

export function drainQueue(): Array<{ name: EventName; props: unknown; ts: number }> {
  const queue = readQueue();
  mmkv.set(RING_BUFFER_KEY, '[]');
  return queue;
}

export function queueLength(): number {
  return readQueue().length;
}

export const logger = { track, drainQueue, queueLength };
