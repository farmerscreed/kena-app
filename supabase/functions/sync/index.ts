// /sync — multi-vitals ingest endpoint. Sprint 7.5 expansion of Sprint 6.
//
// Per docs/01-data-model.md: edge functions run with the service_role
// key and bypass RLS by design. This function:
//   1. Validates the caller's JWT (anon-key client, .auth.getUser()).
//   2. Resolves the caller's family via family_members.
//   3. Upserts the device row by mac_address.
//   4. Dispatches on payload shape:
//      • Legacy `{ device, reading }` → single-BP path (Sprint 6, intact)
//      • New MultiVitalsPayload → multi-vitals path (Sprint 7.5)
//
// The legacy shape stays alive so existing mobile callers
// (services/sync/postReading.ts) keep working without coordinated
// rollout. Sprint 7.5 client code (the orchestrator's batch sync) sends
// the new shape.
//
// Per CLAUDE.md voice + data rules: this function does NOT log
// reading values. Errors include codes + non-PHI metadata only.
// Rejected vital samples per D13 §4.4 are silently dropped, written to
// audit_log with `action='sync.invalid_sample'`, and surfaced via the
// response summary so PostHog `multi_vital_invalid_sample` can fire
// client-side.

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  isLegacyPayload,
  type DeviceMeta,
  type LegacyReadingPayload,
  type MultiVitalsPayload,
} from '../_shared/vital-types.ts';
import {
  validateBPReadings,
  validateHRSamples,
  validateSpO2Samples,
  validateSleepSessions,
  validateActivityDays,
  validateCaloriesDays,
  type RejectedSample,
} from '../_shared/vital-validators.ts';
import {
  mapBPReadings,
  mapHRSamples,
  mapSpO2Samples,
  mapSleepSessions,
  mapActivityDays,
  mapCaloriesDays,
  type VitalsOtherRow,
} from '../_shared/vital-row-mappers.ts';

interface LegacyResponse {
  readingId: string;
  deviceId: string;
  duplicate: boolean;
}

interface MultiVitalsCounts {
  bp: number;
  hr: number;
  spo2: number;
  sleep: number;
  steps: number;
  calories: number;
}

interface MultiVitalsResponse {
  deviceId: string;
  inserted: MultiVitalsCounts;
  rejected: MultiVitalsCounts;
  duplicates: MultiVitalsCounts;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
  const userId = userData.user.id;

  const serviceClient = createClient(supabaseUrl, serviceKey);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'invalid_json' }, 400);
  }

  const device = (body as { device?: DeviceMeta }).device;
  if (!device?.bleId) {
    return json({ error: 'missing_fields' }, 400);
  }

  // Family routing is DEVICE-AUTHORITATIVE (ADR-0006 Phase 1). The watch's
  // data goes to the circle its (stable) device is bound to — resolved
  // from the device, not from a non-deterministic membership pick. Family
  // + device are resolved together because family now derives from device.
  const resolved = await resolveFamilyAndDevice(serviceClient, userId, device);
  if ('error' in resolved) {
    return json({ error: resolved.error, detail: resolved.detail }, resolved.status ?? 500);
  }
  const { familyId, deviceId } = resolved;

  if (isLegacyPayload(body)) {
    return handleLegacy(serviceClient, familyId, deviceId, body as LegacyReadingPayload);
  }
  return handleMultiVitals(
    serviceClient,
    userId,
    familyId,
    deviceId,
    body as MultiVitalsPayload,
  );
});

// ────────────────────────────────────────────────────────────────────
// Device-authoritative family + device resolution — shared by both paths.

type ResolveResult =
  | { familyId: string; deviceId: string }
  | { error: string; detail: string; status?: number };

// Is `userId` an active (non-removed) member of `familyId`?
async function isActiveMember(
  serviceClient: SupabaseClient,
  userId: string,
  familyId: string,
): Promise<boolean> {
  const { data } = await serviceClient
    .from('family_members')
    .select('user_id')
    .eq('user_id', userId)
    .eq('family_id', familyId)
    .is('removed_at', null)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

// Deterministic membership fallback for a GENUINELY NEW device (no stable-id
// match). The syncing party is the wearer (a watch only syncs from the
// wearer's own phone), so we bind to the user's OWN self-circle: the oldest
// circle they `family_owner`. role=family_owner ensures a follower membership
// can never capture a wearer's new watch; order(joined_at) makes the choice
// deterministic across calls (vs the previous limit(1)-with-no-order lottery
// that scattered data between circles).
async function resolveOwnCircle(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await serviceClient
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId)
    .eq('role', 'family_owner')
    .is('removed_at', null)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? (data.family_id as string) : null;
}

export async function resolveFamilyAndDevice(
  serviceClient: SupabaseClient,
  userId: string,
  device: DeviceMeta,
): Promise<ResolveResult> {
  const clientDeviceId = device.clientDeviceId ?? null;

  // STEP 1 — Device-authoritative. A stable clientDeviceId that already maps
  // to an active device row IS the route: use that device's family. Looked
  // up globally (not within a family) so a multi-circle user's watch lands
  // in the circle it was bound to, never a sibling circle. The Urion MAC
  // rotates, so we refresh the stored MAC but never key on it here.
  if (clientDeviceId) {
    const { data: byClient } = await serviceClient
      .from('devices')
      .select('id, family_id')
      .eq('client_device_id', clientDeviceId)
      .is('unpaired_at', null)
      .order('paired_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byClient) {
      const famId = byClient.family_id as string;
      // Defence: the caller must belong to the device's family.
      if (!(await isActiveMember(serviceClient, userId, famId))) {
        return { error: 'not_family_member', detail: 'caller not in device family', status: 403 };
      }
      await serviceClient
        .from('devices')
        .update({ mac_address: device.bleId })
        .eq('id', byClient.id as string);
      return { familyId: famId, deviceId: byClient.id as string };
    }
  }

  // STEP 2 — No stable-id match. Resolve the wearer's own circle, then bind
  // the device within it (adopt an existing MAC-keyed row, or insert).
  const familyId = await resolveOwnCircle(serviceClient, userId);
  if (!familyId) return { error: 'no_family', detail: 'no owned circle', status: 403 };

  const deviceResult = await bindDeviceInFamily(serviceClient, familyId, userId, device);
  if ('error' in deviceResult) {
    return { error: deviceResult.error, detail: deviceResult.detail, status: 500 };
  }
  return { familyId, deviceId: deviceResult.deviceId };
}

// ────────────────────────────────────────────────────────────────────
// Device binding within an already-resolved family — adopt or insert.

type DeviceUpsertResult = { deviceId: string } | { error: string; detail: string };

async function bindDeviceInFamily(
  serviceClient: SupabaseClient,
  familyId: string,
  userId: string,
  device: DeviceMeta,
): Promise<DeviceUpsertResult> {
  const clientDeviceId = device.clientDeviceId ?? null;
  const serial = device.bleId.replace(/[^0-9a-f]/gi, '');

  if (clientDeviceId) {
    // One watch per circle. If the circle already has a single active
    // device, it IS this watch — adopt it and (re)stamp the current stable
    // id + MAC onto it. We deliberately do NOT require client_device_id to
    // be null: a reinstall mints a NEW clientDeviceId (MMKV was wiped), so
    // the existing active device may already carry an OLD stable id. Still
    // the same physical watch — re-stamp rather than insert a duplicate.
    const { data: activeDevices } = await serviceClient
      .from('devices')
      .select('id')
      .eq('family_id', familyId)
      .is('unpaired_at', null)
      .order('paired_at', { ascending: false })
      .limit(2);
    if (activeDevices && activeDevices.length === 1) {
      const adoptId = activeDevices[0].id as string;
      const adopt = await serviceClient
        .from('devices')
        .update({ client_device_id: clientDeviceId, mac_address: device.bleId })
        .eq('id', adoptId)
        .select('id')
        .single();
      if (!adopt.error) return { deviceId: adopt.data.id as string };
      // Fall through to insert if the adopt update raced/failed.
    }
  } else {
    // Legacy clients (no stable id): match by active MAC within the family.
    const { data: byMac } = await serviceClient
      .from('devices')
      .select('id')
      .eq('family_id', familyId)
      .eq('mac_address', device.bleId)
      .is('unpaired_at', null)
      .order('paired_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byMac) return { deviceId: byMac.id as string };
  }

  // Before inserting, reactivate a soft-retired device that already holds
  // this serial. serial_number is GLOBALLY unique (not partial on
  // unpaired_at), so a fresh insert with a previously-seen serial — e.g.
  // the rotated MAC of a device retired during cleanup — would 23505. The
  // rotating Urion MAC means serial isn't a reliable identity, but reusing
  // the existing row avoids the unique violation and keeps history intact.
  const { data: bySerial } = await serviceClient
    .from('devices')
    .select('id')
    .eq('serial_number', serial)
    .limit(1)
    .maybeSingle();
  if (bySerial) {
    const reactivate = await serviceClient
      .from('devices')
      .update({
        family_id: familyId,
        mac_address: device.bleId,
        client_device_id: clientDeviceId,
        unpaired_at: null,
        paired_by_user_id: userId,
      })
      .eq('id', bySerial.id as string)
      .select('id')
      .single();
    if (!reactivate.error) return { deviceId: reactivate.data.id as string };
    return { error: 'device_insert_failed', detail: reactivate.error.message };
  }

  const insertDevice = await serviceClient
    .from('devices')
    .insert({
      family_id: familyId,
      serial_number: serial,
      mac_address: device.bleId,
      client_device_id: clientDeviceId,
      model: device.model,
      paired_by_user_id: userId,
    })
    .select('id')
    .single();
  if (insertDevice.error) {
    return { error: 'device_insert_failed', detail: insertDevice.error.message };
  }
  return { deviceId: insertDevice.data.id as string };
}

// ────────────────────────────────────────────────────────────────────
// Legacy single-BP path — Sprint 6, behaviour preserved exactly.

async function handleLegacy(
  serviceClient: SupabaseClient,
  familyId: string,
  deviceId: string,
  body: LegacyReadingPayload,
): Promise<Response> {
  const { reading } = body;
  if (!reading?.measuredAtSec) {
    return json({ error: 'missing_fields' }, 400);
  }
  // Validate via the shared validators so the legacy gate matches the
  // multi-vitals gate — D13 §4.4 cannot drift between the two paths.
  const { accepted, rejected } = validateBPReadings([reading]);
  if (rejected.length > 0) {
    return json({ error: rejected[0].reason }, 400);
  }
  const r = accepted[0];
  const measuredAt = new Date(r.measuredAtSec * 1000).toISOString();
  const insertReading = await serviceClient
    .from('readings')
    .insert({
      family_id: familyId,
      device_id: deviceId,
      source: r.source,
      measured_at: measuredAt,
      // NULL, not a UTC value mislabeled "local" — see mapBPReadings.
      measured_at_local: null,
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse,
      // D13 PR-11 (§4.5/§6.5) — context tags travel with the reading;
      // absent → the column default '{}' applies.
      ...(r.contextTags && r.contextTags.length > 0
        ? { context_tags: r.contextTags }
        : {}),
    })
    .select('id')
    .single();

  if (insertReading.error) {
    // 23505 = unique_violation (readings_dedupe). Return existing row.
    // Migration 0031: the dedup key is (family_id, measured_at), so the
    // existing-row lookup keys off the family, not the device_id.
    if ((insertReading.error as any).code === '23505') {
      const dup = await serviceClient
        .from('readings')
        .select('id')
        .eq('family_id', familyId)
        .eq('measured_at', measuredAt)
        .single();
      if (dup.error) {
        return json({ error: 'dedupe_lookup_failed', detail: dup.error.message }, 500);
      }
      const resp: LegacyResponse = {
        readingId: dup.data.id as string,
        deviceId,
        duplicate: true,
      };
      return json(resp, 200);
    }
    return json(
      { error: 'reading_insert_failed', detail: insertReading.error.message },
      500,
    );
  }

  const newReadingId = insertReading.data.id as string;
  // Fire detect-anomaly inline — legacy single-reading path mirrors
  // the multi-vitals BP trigger so behaviour is identical regardless
  // of which payload shape the client sent.
  await triggerDetectAnomalyBatch(familyId, [newReadingId]);

  const resp: LegacyResponse = {
    readingId: newReadingId,
    deviceId,
    duplicate: false,
  };
  return json(resp, 200);
}

// ────────────────────────────────────────────────────────────────────
// Multi-vitals path — Sprint 7.5.

async function handleMultiVitals(
  serviceClient: SupabaseClient,
  userId: string,
  familyId: string,
  deviceId: string,
  payload: MultiVitalsPayload,
): Promise<Response> {
  const counts: { inserted: MultiVitalsCounts; rejected: MultiVitalsCounts; duplicates: MultiVitalsCounts } = {
    inserted: { bp: 0, hr: 0, spo2: 0, sleep: 0, steps: 0, calories: 0 },
    rejected: { bp: 0, hr: 0, spo2: 0, sleep: 0, steps: 0, calories: 0 },
    duplicates: { bp: 0, hr: 0, spo2: 0, sleep: 0, steps: 0, calories: 0 },
  };

  // BP — different table (readings), but follows the same accept-then-
  // bulk-upsert pattern. Inserts use `ignoreDuplicates` against the
  // (device_id, measured_at) unique index → idempotent retry.
  const newBpReadingIds: string[] = [];
  if (payload.bpReadings?.length) {
    const { accepted, rejected } = validateBPReadings(payload.bpReadings);
    counts.rejected.bp = rejected.length;
    await logRejected(serviceClient, familyId, userId, 'bp', rejected);
    if (accepted.length > 0) {
      const rows = mapBPReadings(accepted, familyId, deviceId);
      const result = await insertReadings(serviceClient, rows);
      if (result.errored) {
        return json({ error: 'bp_insert_failed', detail: result.errored }, 500);
      }
      counts.inserted.bp = result.inserted;
      counts.duplicates.bp = result.duplicates;
      if (result.insertedReadingIds) newBpReadingIds.push(...result.insertedReadingIds);
    }
  }

  // HR / SpO2 / Sleep / Activity / Calories all land in vitals_other,
  // discriminated by vital_type. Same upsert pattern across all five.
  if (payload.hrSamples?.length) {
    const { accepted, rejected } = validateHRSamples(payload.hrSamples);
    counts.rejected.hr = rejected.length;
    await logRejected(serviceClient, familyId, userId, 'hr', rejected);
    if (accepted.length > 0) {
      const rows = mapHRSamples(accepted, familyId, deviceId);
      const { inserted, duplicates, errored } = await insertVitalRows(serviceClient, rows);
      if (errored) return json({ error: 'hr_insert_failed', detail: errored }, 500);
      counts.inserted.hr = inserted;
      counts.duplicates.hr = duplicates;
    }
  }

  if (payload.spo2Samples?.length) {
    const { accepted, rejected } = validateSpO2Samples(payload.spo2Samples);
    counts.rejected.spo2 = rejected.length;
    await logRejected(serviceClient, familyId, userId, 'spo2', rejected);
    if (accepted.length > 0) {
      const rows = mapSpO2Samples(accepted, familyId, deviceId);
      const { inserted, duplicates, errored } = await insertVitalRows(serviceClient, rows);
      if (errored) return json({ error: 'spo2_insert_failed', detail: errored }, 500);
      counts.inserted.spo2 = inserted;
      counts.duplicates.spo2 = duplicates;
    }
  }

  if (payload.sleepSessions?.length) {
    const { accepted, rejected } = validateSleepSessions(payload.sleepSessions);
    counts.rejected.sleep = rejected.length;
    await logRejected(serviceClient, familyId, userId, 'sleep_session', rejected);
    if (accepted.length > 0) {
      const mapped = mapSleepSessions(accepted, familyId, deviceId);
      // measured_at is now the session END (constant per night). A single
      // sync can carry several rows for the same night (the watch re-reports
      // a night with a drifting total → drifting synthesized start, all
      // sharing one end). Collapse those to the fullest, then drop any that
      // don't exceed the stored total, so a shorter re-read can NEVER shrink
      // a night. Mirrors the steps/calories monotonic guard; mutable upsert
      // then reconciles the surviving (fullest) row.
      const collapsed = collapseToMaxByMeasuredAt(mapped);
      const rows = await dropNonIncreasingDailyRows(serviceClient, collapsed);
      const { inserted, duplicates, errored } = await insertVitalRows(serviceClient, rows, { mutable: true });
      if (errored) return json({ error: 'sleep_insert_failed', detail: errored }, 500);
      counts.inserted.sleep = inserted;
      counts.duplicates.sleep = duplicates;
    }
  }

  if (payload.activityDays?.length) {
    const { accepted, rejected } = validateActivityDays(payload.activityDays);
    counts.rejected.steps = rejected.length;
    await logRejected(serviceClient, familyId, userId, 'steps_day', rejected);
    if (accepted.length > 0) {
      const mapped = mapActivityDays(accepted, familyId, deviceId);
      // Only update when the count increases — never let a purged-day
      // backfill 0 overwrite a real total.
      const rows = await dropNonIncreasingDailyRows(serviceClient, mapped);
      const { inserted, duplicates, errored } = await insertVitalRows(serviceClient, rows, { mutable: true });
      if (errored) return json({ error: 'activity_insert_failed', detail: errored }, 500);
      counts.inserted.steps = inserted;
      counts.duplicates.steps = duplicates;
    }
  }

  if (payload.caloriesDays?.length) {
    const { accepted, rejected } = validateCaloriesDays(payload.caloriesDays);
    counts.rejected.calories = rejected.length;
    await logRejected(serviceClient, familyId, userId, 'calories_day', rejected);
    if (accepted.length > 0) {
      const mapped = mapCaloriesDays(accepted, familyId, deviceId);
      // Only update when kcal increases — same purged-day-0 guard as steps.
      const rows = await dropNonIncreasingDailyRows(serviceClient, mapped);
      const { inserted, duplicates, errored } = await insertVitalRows(serviceClient, rows, { mutable: true });
      if (errored) return json({ error: 'calories_insert_failed', detail: errored }, 500);
      counts.inserted.calories = inserted;
      counts.duplicates.calories = duplicates;
    }
  }

  // Fire detect-anomaly for every newly inserted BP reading. Sprint 15:
  // BP runs on the hot path; HR/SpO2 trends live on the nightly cron.
  // Awaited so the response can carry tier info back to the client.
  if (newBpReadingIds.length > 0) {
    await triggerDetectAnomalyBatch(familyId, newBpReadingIds);
  }

  const resp: MultiVitalsResponse = { deviceId, ...counts };
  return json(resp, 200);
}

// ────────────────────────────────────────────────────────────────────
// detect-anomaly trigger — Sprint 15.
//
// One internal HTTP call per newly inserted BP reading. Fan-out is
// awaited in parallel so the /sync response stays below the 5-second
// latency budget from docs/10-anomaly-logic.md §2 even on a 24h
// backfill sync (typical BP volume: 1-3 readings, ceiling ~20).

async function triggerDetectAnomalyBatch(
  familyId: string,
  readingIds: string[],
): Promise<void> {
  const baseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const calls = readingIds.map((readingId) =>
    fetch(`${baseUrl}/functions/v1/detect-anomaly`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        mode: 'reading_inserted',
        familyId,
        readingId,
      }),
    }).catch(() => undefined),
  );
  await Promise.all(calls);
}

// ────────────────────────────────────────────────────────────────────
// Insert helpers — supabase-js v2 upsert with ignoreDuplicates is the
// idempotency primitive. The dedupe indexes:
//   • readings:      (device_id, measured_at) where device_id is not null
//   • vitals_other:  (device_id, vital_type, measured_at) where device_id is not null
// Calling upsert with these as `onConflict` lets us batch-insert without
// failing the whole batch on a single duplicate.

interface InsertSummary {
  inserted: number;
  duplicates: number;
  errored: string | null;
  insertedReadingIds?: string[];
}

async function insertReadings(
  serviceClient: SupabaseClient,
  rows: ReturnType<typeof mapBPReadings>,
): Promise<InsertSummary> {
  // We need both the inserted count and the inserted ids — the latter
  // feeds the post-insert detect-anomaly trigger. ignoreDuplicates +
  // .select() yields only newly inserted rows; skipped duplicates are
  // counted by subtraction (rows.length - insertedRows.length).
  const { error, data } = await serviceClient
    .from('readings')
    .upsert(rows, {
      // Device-independent dedup (migration 0031): a BP reading is
      // identified by (family_id, measured_at), not the watch that sent it,
      // so a re-pair can't re-import history under a new device_id.
      onConflict: 'family_id,measured_at',
      ignoreDuplicates: true,
    })
    .select('id');
  if (error) return { inserted: 0, duplicates: 0, errored: error.message };
  const insertedRows = data ?? [];
  return {
    inserted: insertedRows.length,
    duplicates: rows.length - insertedRows.length,
    errored: null,
    insertedReadingIds: insertedRows.map((r) => r.id as string),
  };
}

// Monotonic-daily guard for steps_day / calories_day. These accumulate
// through the day, so a later sync legitimately UPDATES the row (0 -> 38).
// But a backfill of a day the watch has purged reports 0, and an
// unconditional update would let that 0 clobber a real count (e.g. a real
// 1529 from when the day was live). Drop incoming rows that do not
// strictly exceed what's already stored; the survivors then update on
// conflict. Homogeneous batch (one device_id + vital_type) per call.
// Collapse rows that share a measured_at to the single one with the largest
// value_int. Used for sleep_session: one sync can carry multiple rows for
// the same night (now keyed on the constant session-end), and the fullest
// is the most-complete read. Without this, a bulk upsert of same-key rows
// would error ("ON CONFLICT cannot affect row a second time").
function collapseToMaxByMeasuredAt(rows: VitalsOtherRow[]): VitalsOtherRow[] {
  const best = new Map<string, VitalsOtherRow>();
  for (const r of rows) {
    const key = new Date(r.measured_at).toISOString();
    const cur = best.get(key);
    if (!cur || (r.value_int ?? 0) > (cur.value_int ?? 0)) best.set(key, r);
  }
  return [...best.values()];
}

async function dropNonIncreasingDailyRows(
  serviceClient: SupabaseClient,
  rows: VitalsOtherRow[],
): Promise<VitalsOtherRow[]> {
  if (rows.length === 0) return rows;
  const deviceId = rows[0].device_id;
  const vitalType = rows[0].vital_type;
  const { data: existing } = await serviceClient
    .from('vitals_other')
    .select('measured_at, value_int')
    .eq('device_id', deviceId)
    .eq('vital_type', vitalType)
    .in('measured_at', rows.map((r) => r.measured_at));
  const storedByAt = new Map<string, number>(
    (existing ?? []).map((e) => [
      new Date(e.measured_at as string).toISOString(),
      (e.value_int as number | null) ?? 0,
    ]),
  );
  return rows.filter((r) => {
    const stored = storedByAt.get(new Date(r.measured_at).toISOString());
    return stored === undefined || (r.value_int ?? 0) > stored;
  });
}

async function insertVitalRows(
  serviceClient: SupabaseClient,
  rows: VitalsOtherRow[],
  // `mutable` distinguishes the two upsert semantics on the shared
  // (device_id, vital_type, measured_at) dedupe key:
  //
  //   false (default) — immutable POINT samples (hr / spo2). Each has a
  //     unique timestamp, so a conflict is a genuine re-sync duplicate:
  //     ignore it (idempotent).
  //
  //   true — mutable DAILY aggregates (steps_day, calories_day) and
  //     reconciled sleep_session. Their measured_at is the day's
  //     midnight (steps/calories) or the synthesized session start
  //     (sleep) — CONSTANT across the day/night — while the value keeps
  //     changing: steps accumulate, sleep totals + inferred wake get
  //     reconciled. ignoreDuplicates here froze the row at the first
  //     sync of the day (e.g. 0 steps before the user walked), so the
  //     caregiver view — which reads the server — never saw the updated
  //     count even though the device's local store had it. Update on
  //     conflict so the latest read wins.
  options: { mutable?: boolean } = {},
): Promise<InsertSummary> {
  const ignoreDuplicates = !options.mutable;
  const { error, count } = await serviceClient
    .from('vitals_other')
    .upsert(rows, {
      onConflict: 'device_id,vital_type,measured_at',
      ignoreDuplicates,
      count: 'exact',
    });
  if (error) return { inserted: 0, duplicates: 0, errored: error.message };
  const inserted = count ?? 0;
  return { inserted, duplicates: rows.length - inserted, errored: null };
}

// ────────────────────────────────────────────────────────────────────
// Audit-log writer for rejected samples.
//
// Per CLAUDE.md + D13 §13.4: never log values, only counts + reasons +
// the index inside the original batch. The intent is post-hoc ops
// monitoring ("we dropped 3 HR samples for bpm_out_of_range last
// week"), not user-visible diagnostics.
//
// audit_log is partitioned, so writes here go to the default partition
// in pre-Sprint-17 environments. The default partition catches all
// writes until the partition-rolling cron lands.

async function logRejected(
  serviceClient: SupabaseClient,
  familyId: string,
  userId: string,
  vitalType: 'bp' | 'hr' | 'spo2' | 'sleep_session' | 'steps_day' | 'calories_day',
  rejected: RejectedSample[],
): Promise<void> {
  if (rejected.length === 0) return;
  const rows = rejected.map((r) => ({
    actor_user_id: userId,
    family_id: familyId,
    action: 'sync.invalid_sample',
    metadata: {
      vital_type: vitalType,
      reason: r.reason,
      sample_index: r.idx,
    },
  }));
  // Best-effort write — a failed audit-log insert should NOT fail the
  // ingest path. The PostHog event fired client-side already gives ops
  // the rejection signal even if audit_log misses.
  try {
    await serviceClient.from('audit_log').insert(rows);
  } catch {
    // ignore
  }
}
