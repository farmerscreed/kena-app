// /detect-anomaly — Sprint 15.
//
// Two entry modes:
//
//   { mode: 'reading_inserted', userId, familyId, readingId }
//     Inline trigger from /sync after a successful BP insert. Loads the
//     reading + the parent's BP baseline + the family's
//     anomaly_sensitivity, runs classifyBP, checks the 60-min sustained
//     pattern, writes an anomaly_events row if applicable, dispatches
//     send-push for the new event. Returns the tier (or null).
//
//   { mode: 'cron' }
//     Nightly trigger from pg_cron at 03:00 UTC. For each user with
//     recent watch data: refresh the vital_baselines truth layer (all
//     six baseline vitals over a 28-day window, D13 PR-1), refresh the
//     legacy hr_baselines row, evaluate HR 3-day trend + SpO2 3-night
//     trend, write anomaly_events, dispatch pushes. Pure aggregate
//     path — no per-sample work happens here.
//
// The same /sync request never blocks longer than the BP path because
// HR/SpO2 trends only ever evaluate from the cron. BP gets the
// sub-5-second-latency guarantee per docs/10-anomaly-logic.md §2.
//
// Per CLAUDE.md: never log reading values. Anomaly events store the
// tier + reason + pointer; never the systolic/diastolic numbers.
// PostHog events fired downstream go through phi-scrub.

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { withInternalHeader } from '../_shared/internal-auth.ts';
import {
  classifyBP,
  classifyHR,
  classifySpO2,
  checkSustainedPattern,
  computeHrMedian,
  producesAnomalyEvent,
  shouldDedupAnomaly,
  type ClassificationTier,
  type VitalKind,
} from '../_shared/classification.ts';
import {
  BASELINE_WINDOW_DAYS,
  computeBpBaselineRows,
  computeVitalBaselineRow,
  type BpReadingSample,
  type VitalBaselineRow,
} from '../_shared/baselines.ts';

interface ReadingInsertedRequest {
  mode: 'reading_inserted';
  familyId: string;
  readingId: string;
}

interface CronRequest {
  mode: 'cron';
}

type DetectAnomalyRequest = ReadingInsertedRequest | CronRequest;

interface ReadingInsertedResponse {
  tier: ClassificationTier | null;
  reason: string | null;
  eventId: string | null;
  pushDispatched: boolean;
}

interface CronResponse {
  usersProcessed: number;
  eventsWritten: number;
  pushesDispatched: number;
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const serviceClient = createClient(supabaseUrl, serviceKey);

  let body: DetectAnomalyRequest;
  try {
    body = (await req.json()) as DetectAnomalyRequest;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (body.mode === 'reading_inserted') {
    const result = await handleReadingInserted(serviceClient, body);
    return json(result, 200);
  }
  if (body.mode === 'cron') {
    const result = await handleCron(serviceClient);
    return json(result, 200);
  }
  return json({ error: 'unknown_mode' }, 400);
});

// ─────────────────────────────────────────────────────────────────────
// BP single-reading path.

async function handleReadingInserted(
  service: SupabaseClient,
  req: ReadingInsertedRequest,
): Promise<ReadingInsertedResponse> {
  const { familyId, readingId } = req;

  // The analysis subject is the parent (caregiver mode) or the user
  // themself (self_buyer / parent modes). Resolved here so callers
  // can't pass the wrong id — /sync sends the caller's userId, which
  // for caregivers is NOT the analysis subject.
  const userId = await resolveAnalysisUser(service, familyId);
  if (!userId) {
    return { tier: null, reason: 'no_analysis_user', eventId: null, pushDispatched: false };
  }

  const readingRes = await service
    .from('readings')
    .select('id, family_id, systolic, diastolic, pulse, measured_at')
    .eq('id', readingId)
    .single();
  if (readingRes.error || !readingRes.data) {
    return { tier: null, reason: 'reading_not_found', eventId: null, pushDispatched: false };
  }
  const reading = readingRes.data;

  // Fetch baseline + sensitivity in parallel.
  const [baselineRes, familyRes, lastEventRes, recentRes] = await Promise.all([
    service
      .from('bp_baselines')
      .select('sys_mean, dia_mean, pulse_mean, sigma_sys, sigma_dia, sigma_pulse, days_of_data')
      .eq('user_id', userId)
      .maybeSingle(),
    service
      .from('families')
      .select('anomaly_sensitivity')
      .eq('id', familyId)
      .single(),
    service
      .from('anomaly_events')
      .select('triggered_at')
      .eq('user_id', userId)
      .eq('vital_kind', 'bp')
      .order('triggered_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from('readings')
      .select('systolic, diastolic, measured_at')
      .eq('family_id', familyId)
      .gte('measured_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .eq('hidden', false)
      .order('measured_at', { ascending: false })
      .limit(20),
  ]);

  const baseline = baselineRes.data
    ? {
        sys: Number(baselineRes.data.sys_mean),
        dia: Number(baselineRes.data.dia_mean),
        pulse: Number(baselineRes.data.pulse_mean ?? 0),
        sigmaSys: Number(baselineRes.data.sigma_sys),
        sigmaDia: Number(baselineRes.data.sigma_dia),
        // Since 0054 bp_baselines is a view over vital_baselines and has
        // no pulse columns (resting HR is its own vital). A null sigma
        // must DISABLE the pulse-outlier branch, not become sigma=1 —
        // that coalesce would flag every pulse as an outlier.
        sigmaPulse:
          baselineRes.data.sigma_pulse == null
            ? Number.POSITIVE_INFINITY
            : Number(baselineRes.data.sigma_pulse),
        daysOfData: Number(baselineRes.data.days_of_data),
      }
    : null;

  const sensitivity = familyRes.data
    ? Number((familyRes.data as { anomaly_sensitivity: number | string }).anomaly_sensitivity)
    : 1.0;

  // Primary single-reading classification.
  const single = classifyBP(
    { systolic: reading.systolic, diastolic: reading.diastolic, pulse: reading.pulse },
    baseline,
    sensitivity,
  );

  // Rolling-pattern check on the parent's last hour of readings.
  let escalatedToUrgent = false;
  if (single.tier !== 'confirmed_urgent' && recentRes.data && recentRes.data.length >= 3) {
    const nowSec = Math.floor(Date.now() / 1000);
    const sustained = checkSustainedPattern(
      recentRes.data.map((r) => ({
        systolic: r.systolic,
        diastolic: r.diastolic,
        measured_at_sec: Math.floor(new Date(r.measured_at).getTime() / 1000),
      })),
      nowSec,
    );
    if (sustained) escalatedToUrgent = true;
  }

  const finalTier: ClassificationTier = escalatedToUrgent
    ? 'confirmed_urgent'
    : single.tier;
  const finalReason = escalatedToUrgent ? 'stage2_sustained_60min' : single.reason;

  if (!producesAnomalyEvent('bp', finalTier)) {
    return { tier: finalTier, reason: finalReason, eventId: null, pushDispatched: false };
  }

  const lastTriggeredSec = lastEventRes.data
    ? Math.floor(new Date(lastEventRes.data.triggered_at).getTime() / 1000)
    : null;
  if (shouldDedupAnomaly(finalTier, lastTriggeredSec, Math.floor(Date.now() / 1000))) {
    return { tier: finalTier, reason: finalReason, eventId: null, pushDispatched: false };
  }

  const eventRes = await service
    .from('anomaly_events')
    .insert({
      user_id: userId,
      family_id: familyId,
      vital_kind: 'bp',
      tier: finalTier,
      reason: finalReason,
      reading_id: readingId,
    })
    .select('id')
    .single();
  if (eventRes.error || !eventRes.data) {
    return { tier: finalTier, reason: finalReason, eventId: null, pushDispatched: false };
  }
  const eventId = (eventRes.data as { id: string }).id;

  const pushDispatched = await dispatchPushForEvent(service, eventId);
  return { tier: finalTier, reason: finalReason, eventId, pushDispatched };
}

// ─────────────────────────────────────────────────────────────────────
// Nightly cron path — baselines + trend evaluation.

async function handleCron(service: SupabaseClient): Promise<CronResponse> {
  // Find users with any vitals data in the baseline window. Since D13
  // PR-1 the working set unions vitals_other with readings — a family
  // with HR/sleep data but no recent BP was previously skipped
  // entirely, so its non-BP baselines were never refreshed.
  const since = new Date(
    Date.now() - BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const [familiesRes, vitalsFamiliesRes] = await Promise.all([
    service
      .from('readings')
      .select('family_id')
      .gte('measured_at', since)
      .eq('hidden', false)
      .limit(1000),
    service
      .from('vitals_other')
      .select('family_id')
      .gte('measured_at', since)
      .eq('hidden', false)
      .limit(1000),
  ]);
  if (familiesRes.error && vitalsFamiliesRes.error) {
    return { usersProcessed: 0, eventsWritten: 0, pushesDispatched: 0 };
  }
  const familyIds = Array.from(
    new Set(
      [...(familiesRes.data ?? []), ...(vitalsFamiliesRes.data ?? [])].map(
        (r) => r.family_id as string,
      ),
    ),
  );

  // For each family, get the parent_user_id (the user whose readings
  // the engine analyses). Per D13 §11.1 the user-of-analysis is the
  // parent in caregiver mode, or the user themselves in self_buyer /
  // parent modes — resolved via families.parent_user_id with fallback
  // to the family_owner.
  let usersProcessed = 0;
  let eventsWritten = 0;
  let pushesDispatched = 0;

  for (const familyId of familyIds) {
    const userId = await resolveAnalysisUser(service, familyId);
    if (!userId) continue;
    usersProcessed++;

    await refreshVitalBaselines(service, familyId, userId);

    const [hrEvents, hrDispatched] = await refreshHrBaselineAndTrend(
      service,
      familyId,
      userId,
    );
    const [spo2Events, spo2Dispatched] = await evaluateSpO2OvernightTrend(
      service,
      familyId,
      userId,
    );

    eventsWritten += hrEvents + spo2Events;
    pushesDispatched += hrDispatched + spo2Dispatched;
  }

  return { usersProcessed, eventsWritten, pushesDispatched };
}

async function resolveAnalysisUser(
  service: SupabaseClient,
  familyId: string,
): Promise<string | null> {
  const f = await service
    .from('families')
    .select('parent_user_id')
    .eq('id', familyId)
    .single();
  if (!f.error && f.data?.parent_user_id) return f.data.parent_user_id as string;
  const ownerRow = await service
    .from('family_members')
    .select('user_id')
    .eq('family_id', familyId)
    .eq('role', 'family_owner')
    .is('removed_at', null)
    .limit(1)
    .maybeSingle();
  return (ownerRow.data?.user_id as string | undefined) ?? null;
}

// Nightly truth-layer refresh — D13 PR-1 (P0-2 / P0-3). One
// vital_baselines row per (subject, vital, context) over a 28-day
// window, all six vitals, context-conditioned rows for BP only.
//
// Write strategy is delete-then-insert per subject: PostgREST upsert
// cannot target the expression index (subject_id, vital,
// coalesce(context_tag,'')), and the wipe also garbage-collects
// context rows whose tag fell back below CONTEXT_MIN_READINGS. If a
// run dies between the two statements the subject has no rows until
// the next night; the client's provisional offline fallback covers the
// gap and the inline push path degrades to its cold-start rules.
async function refreshVitalBaselines(
  service: SupabaseClient,
  familyId: string,
  userId: string,
): Promise<void> {
  const since = new Date(
    Date.now() - BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [bpRes, hrRes, spo2Res, sleepRes, stepsRes] = await Promise.all([
    service
      .from('readings')
      .select('systolic, diastolic, measured_at, context_tags')
      .eq('family_id', familyId)
      .eq('hidden', false)
      .eq('source', 'watch')
      .in('quality_score', ['good', 'fair'])
      .gte('measured_at', since)
      .limit(1000),
    service
      .from('vitals_other')
      .select('value_int, measured_at, value_jsonb')
      .eq('family_id', familyId)
      .eq('vital_type', 'hr')
      .eq('hidden', false)
      .gte('measured_at', since)
      .limit(5000),
    service
      .from('vitals_other')
      .select('value_int, value_int_3, measured_at')
      .eq('family_id', familyId)
      .eq('vital_type', 'spo2')
      .eq('hidden', false)
      .gte('measured_at', since)
      .limit(5000),
    service
      .from('vitals_other')
      .select('value_int, measured_at')
      .eq('family_id', familyId)
      .eq('vital_type', 'sleep_session')
      .eq('hidden', false)
      .gte('measured_at', since)
      .limit(1000),
    service
      .from('vitals_other')
      .select('value_int, measured_at')
      .eq('family_id', familyId)
      .eq('vital_type', 'steps_day')
      .eq('hidden', false)
      .gte('measured_at', since)
      .limit(1000),
  ]);

  const dayKey = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
  const rows: VitalBaselineRow[] = [];

  // BP — all-readings pair plus context-conditioned pairs (§4.2).
  const bpSamples: BpReadingSample[] = (bpRes.data ?? []).map((r) => ({
    systolic: r.systolic as number,
    diastolic: r.diastolic as number,
    dayKey: dayKey(r.measured_at as string),
    contextTags: ((r.context_tags as string[] | null) ?? []),
  }));
  rows.push(...computeBpBaselineRows(bpSamples));

  // Resting HR — one sample per day: the minimum of resting-tagged
  // samples (same derivation the legacy hr_baselines refresh uses).
  const hrByDay = new Map<string, number>();
  for (const r of hrRes.data ?? []) {
    const motion =
      (r.value_jsonb as { motion_state?: string } | null)?.motion_state ?? 'unknown';
    if (motion !== 'rest') continue;
    const day = dayKey(r.measured_at as string);
    const bpm = r.value_int as number;
    if (!hrByDay.has(day) || hrByDay.get(day)! > bpm) hrByDay.set(day, bpm);
  }
  const hrRow = computeVitalBaselineRow(
    'resting_hr',
    [...hrByDay.entries()].map(([day, v]) => ({ value: v, dayKey: day })),
  );
  if (hrRow) rows.push(hrRow);

  // SpO2 — one sample per night: the overnight low (min-in-window
  // column, falling back to the spot value; same as the trend path).
  const spo2ByDay = new Map<string, number>();
  for (const r of spo2Res.data ?? []) {
    const v = (r.value_int_3 as number | null) ?? (r.value_int as number);
    const day = dayKey(r.measured_at as string);
    if (!spo2ByDay.has(day) || spo2ByDay.get(day)! > v) spo2ByDay.set(day, v);
  }
  const spo2Row = computeVitalBaselineRow(
    'spo2',
    [...spo2ByDay.entries()].map(([day, v]) => ({ value: v, dayKey: day })),
  );
  if (spo2Row) rows.push(spo2Row);

  // Sleep duration — one row per night keyed by session end (0032);
  // if re-read reconciliation ever leaves siblings on a night, keep
  // the fullest (matches the sync path's no-shrink guard).
  const sleepByNight = new Map<string, number>();
  for (const r of sleepRes.data ?? []) {
    const day = dayKey(r.measured_at as string);
    const minutes = r.value_int as number;
    if (!sleepByNight.has(day) || sleepByNight.get(day)! < minutes) {
      sleepByNight.set(day, minutes);
    }
  }
  const sleepRow = computeVitalBaselineRow(
    'sleep_duration',
    [...sleepByNight.entries()].map(([day, v]) => ({ value: v, dayKey: day })),
  );
  if (sleepRow) rows.push(sleepRow);

  // Steps — one daily-total row per day; keep the fullest on dupes.
  const stepsByDay = new Map<string, number>();
  for (const r of stepsRes.data ?? []) {
    const day = dayKey(r.measured_at as string);
    const steps = r.value_int as number;
    if (!stepsByDay.has(day) || stepsByDay.get(day)! < steps) {
      stepsByDay.set(day, steps);
    }
  }
  const stepsRow = computeVitalBaselineRow(
    'steps_daily',
    [...stepsByDay.entries()].map(([day, v]) => ({ value: v, dayKey: day })),
  );
  if (stepsRow) rows.push(stepsRow);

  const del = await service.from('vital_baselines').delete().eq('subject_id', userId);
  if (del.error) return; // keep last night's rows rather than half-replace
  if (rows.length === 0) return;
  await service.from('vital_baselines').insert(
    rows.map((row) => ({
      family_id: familyId,
      subject_id: userId,
      vital: row.vital,
      window_days: row.windowDays,
      sample_count: row.sampleCount,
      mean_value: row.mean,
      sd_value: row.sd,
      p10_value: row.p10,
      p90_value: row.p90,
      context_tag: row.contextTag,
      is_sufficient: row.isSufficient,
      computed_at: new Date().toISOString(),
    })),
  );
}

async function refreshHrBaselineAndTrend(
  service: SupabaseClient,
  familyId: string,
  userId: string,
): Promise<[number, number]> {
  // Fetch the 14-day rolling resting-HR series. Resting HR is the
  // value_int on HR samples where motion_state='rest'. D13 §6.2 says
  // the canonical "resting HR for today" is the lowest 10-min
  // rolling-average across the user's sleep window — we approximate
  // here by taking the daily minimum of resting samples. That's a
  // good-enough proxy for the baseline refresh; per-day sampling
  // detail can be sharpened in a follow-up without changing the
  // anomaly_events shape.
  const since = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  const hrRes = await service
    .from('vitals_other')
    .select('value_int, measured_at, value_jsonb')
    .eq('family_id', familyId)
    .eq('vital_type', 'hr')
    .eq('hidden', false)
    .gte('measured_at', since)
    .limit(5000);
  const rows = hrRes.data ?? [];
  // Group by UTC day (YYYY-MM-DD), keep min resting bpm.
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const motion = (r.value_jsonb as { motion_state?: string } | null)?.motion_state ?? 'unknown';
    if (motion !== 'rest') continue;
    const day = new Date(r.measured_at).toISOString().slice(0, 10);
    const bpm = r.value_int as number;
    if (!byDay.has(day) || byDay.get(day)! > bpm) byDay.set(day, bpm);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (days.length === 0) return [0, 0];

  // Recompute baseline median over days WITHOUT today.
  const todayKey = new Date().toISOString().slice(0, 10);
  const baselineDays = days.filter(([k]) => k < todayKey);
  const todayDay = days.find(([k]) => k === todayKey);
  const median = computeHrMedian(baselineDays.map(([, v]) => v));
  if (median != null && baselineDays.length > 0) {
    await service.from('hr_baselines').upsert(
      {
        user_id: userId,
        family_id: familyId,
        median_bpm: median,
        days_of_data: baselineDays.length,
        sample_count: baselineDays.length,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  }

  if (!todayDay) return [0, 0];

  // Evaluate today's HR with the same classifier the mobile app uses.
  const cls = classifyHR({
    restingBpmToday: todayDay[1],
    restingBpmRecent: baselineDays.map(([, v]) => v),
  });
  if (!producesAnomalyEvent('hr', cls.tier)) return [0, 0];

  const lastEvent = await service
    .from('anomaly_events')
    .select('triggered_at')
    .eq('user_id', userId)
    .eq('vital_kind', 'hr')
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastSec = lastEvent.data
    ? Math.floor(new Date(lastEvent.data.triggered_at).getTime() / 1000)
    : null;
  if (shouldDedupAnomaly(cls.tier, lastSec, Math.floor(Date.now() / 1000))) {
    return [0, 0];
  }

  const inserted = await service
    .from('anomaly_events')
    .insert({
      user_id: userId,
      family_id: familyId,
      vital_kind: 'hr',
      tier: cls.tier,
      reason: cls.reason,
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) return [0, 0];
  const dispatched = await dispatchPushForEvent(service, inserted.data.id as string);
  return [1, dispatched ? 1 : 0];
}

async function evaluateSpO2OvernightTrend(
  service: SupabaseClient,
  familyId: string,
  userId: string,
): Promise<[number, number]> {
  // Overnight-low = min SpO2 percent during sleep window. Approximate
  // by min-per-UTC-day for the last 4 nights (we only need 3 for the
  // sustained-low rule; a 4th gives the "one good night breaks streak"
  // safety).
  const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const spo2Res = await service
    .from('vitals_other')
    .select('value_int, value_int_3, measured_at')
    .eq('family_id', familyId)
    .eq('vital_type', 'spo2')
    .eq('hidden', false)
    .gte('measured_at', since)
    .limit(5000);
  const rows = spo2Res.data ?? [];
  const byDay = new Map<string, number>();
  for (const r of rows) {
    // value_int_3 is min-in-window per the row mapper; fall back to value_int.
    const v = (r.value_int_3 as number | null) ?? (r.value_int as number);
    const day = new Date(r.measured_at).toISOString().slice(0, 10);
    if (!byDay.has(day) || byDay.get(day)! > v) byDay.set(day, v);
  }
  if (byDay.size === 0) return [0, 0];

  const sorted = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const overnightLows = sorted.map(([, v]) => v);
  const latestSpotRes = await service
    .from('vitals_other')
    .select('value_int')
    .eq('family_id', familyId)
    .eq('vital_type', 'spo2')
    .eq('hidden', false)
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestPercent = (latestSpotRes.data?.value_int as number | undefined) ?? 97;

  const cls = classifySpO2({ latestPercent, overnightLowsRecent: overnightLows });
  if (!producesAnomalyEvent('spo2', cls.tier)) return [0, 0];

  const lastEvent = await service
    .from('anomaly_events')
    .select('triggered_at')
    .eq('user_id', userId)
    .eq('vital_kind', 'spo2')
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastSec = lastEvent.data
    ? Math.floor(new Date(lastEvent.data.triggered_at).getTime() / 1000)
    : null;
  if (shouldDedupAnomaly(cls.tier, lastSec, Math.floor(Date.now() / 1000))) {
    return [0, 0];
  }

  const inserted = await service
    .from('anomaly_events')
    .insert({
      user_id: userId,
      family_id: familyId,
      vital_kind: 'spo2',
      tier: cls.tier,
      reason: cls.reason,
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) return [0, 0];
  const dispatched = await dispatchPushForEvent(service, inserted.data.id as string);
  return [1, dispatched ? 1 : 0];
}

// ─────────────────────────────────────────────────────────────────────
// Push dispatch — fan out to every caregiver in the family.

async function dispatchPushForEvent(
  service: SupabaseClient,
  eventId: string,
): Promise<boolean> {
  const evRes = await service
    .from('anomaly_events')
    .select('id, user_id, family_id, vital_kind, tier, reason, reading_id')
    .eq('id', eventId)
    .single();
  if (evRes.error || !evRes.data) return false;
  const ev = evRes.data;

  // Recipients: everyone in the family who is NOT the analysis subject
  // and has an active push token. In self_buyer-only mode that's just
  // the user themself, which we DO want to notify.
  const recipientsRes = await service
    .from('family_members')
    .select('user_id, role')
    .eq('family_id', ev.family_id)
    .is('removed_at', null);
  if (recipientsRes.error) return false;
  const memberRows = recipientsRes.data ?? [];

  let anyDispatched = false;
  for (const member of memberRows) {
    if ((member.user_id as string) === ev.user_id && memberRows.length > 1) continue;
    const ok = await callSendPush(service, {
      eventId,
      recipientUserId: member.user_id as string,
      vitalKind: ev.vital_kind as VitalKind,
      tier: ev.tier as ClassificationTier,
      reason: ev.reason as string,
      readingId: (ev.reading_id as string | null) ?? null,
    });
    if (ok) anyDispatched = true;
  }

  if (anyDispatched) {
    await service
      .from('anomaly_events')
      .update({ push_sent_at: new Date().toISOString(), push_outcome: 'sent' })
      .eq('id', eventId);
  }
  return anyDispatched;
}

async function callSendPush(
  service: SupabaseClient,
  payload: {
    eventId: string;
    recipientUserId: string;
    vitalKind: VitalKind;
    tier: ClassificationTier;
    reason: string;
    readingId: string | null;
  },
): Promise<boolean> {
  const baseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  try {
    const res = await fetch(`${baseUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: withInternalHeader({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      }),
      body: JSON.stringify({
        category: 'anomaly',
        userId: payload.recipientUserId,
        anomalyEventId: payload.eventId,
        vitalKind: payload.vitalKind,
        tier: payload.tier,
        reason: payload.reason,
        readingId: payload.readingId,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
