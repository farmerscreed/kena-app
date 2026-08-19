// /compute-correlations — Sprint 9 / D13 §9 + docs/15-correlation-engine.md.
//
// Hourly cron entry-point that fans out to the families whose local
// hour is currently 03:00 (per docs/15-correlation-engine.md §6.1)
// and computes all three v1.0 correlations for each user. Also
// supports a manual mode for testing:
//
//   POST /compute-correlations
//        body: { familyId, userId }
//   →    { mode: 'manual', results: [...] }
//
//   POST /compute-correlations
//        body: {} or {} or { mode: 'cron' }
//   →    iterates families whose local hour is 03 and runs each
//
// Per CLAUDE.md data rule, this function emits no PHI in logs. The
// rejected/inserted summary returned to the caller carries counts +
// type discriminators only.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  fetchSleepXMorningBp,
  fetchActivityXRestingHr,
  fetchSpO2DipXSleepScore,
  localHourFor,
  type PairedObservation,
  fetchSleepXRestingHr,
  fetchActivityXMorningBp,
  fetchAfterMedsXBp,
} from './queries.ts';
import { pearsonR, pearsonP, regressionSlope } from './stats.ts';
import { narrativeFor } from './narratives.ts';
import {
  ALL_CORRELATION_TYPES,
  WINDOW_DAYS,
  MIN_SAMPLE_N,
  R_THRESHOLD,
  P_THRESHOLD,
  type CorrelationType,
  type CorrelationOutput,
  MIN_GROUP_N,
} from './types.ts';

const TARGET_LOCAL_HOUR = 3;

interface RequestBody {
  /** Direct compute for one (family, user) — used by tests + the
   *  Trends "Recompute now" admin path. */
  familyId?: string;
  userId?: string;
  /** Override "now" for tests so the asOf window lands on the fixture. */
  asOfIso?: string;
  /** Force cron-style fan-out regardless of body. Internal sentinel. */
  mode?: 'cron' | 'manual';
}

interface UserResult {
  familyId: string;
  userId: string;
  outputs: CorrelationOutput[];
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function envOrThrow(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

async function fetchPairs(
  supabase: SupabaseClient,
  familyId: string,
  userId: string,
  type: CorrelationType,
  asOf?: Date,
): Promise<PairedObservation[]> {
  const args = { supabase, familyId, userId, asOf };
  switch (type) {
    case 'sleep_x_morning_bp':
      return fetchSleepXMorningBp(args);
    case 'activity_x_resting_hr':
      return fetchActivityXRestingHr(args);
    case 'spo2_dip_x_sleep_score':
      return fetchSpO2DipXSleepScore(args);
    case 'sleep_x_resting_hr':
      return fetchSleepXRestingHr(args);
    case 'activity_x_morning_bp':
      return fetchActivityXMorningBp(args);
    case 'after_meds_x_bp':
      return fetchAfterMedsXBp(args);
  }
}

async function computeOne(
  supabase: SupabaseClient,
  familyId: string,
  userId: string,
  type: CorrelationType,
  asOf?: Date,
): Promise<CorrelationOutput> {
  const pairs = await fetchPairs(supabase, familyId, userId, type, asOf);
  const sampleN = pairs.length;

  // Two-group types additionally need both groups populated — one
  // lonely tagged reading cannot manufacture a finding.
  const groupGateFails =
    type === 'after_meds_x_bp' &&
    (pairs.filter((p) => p.x === 1).length < MIN_GROUP_N ||
      pairs.filter((p) => p.x === 0).length < MIN_GROUP_N);

  if (sampleN < MIN_SAMPLE_N || groupGateFails) {
    return {
      correlationType: type,
      pearsonR: null,
      effectSize: 0,
      effectUnit: null,
      significance: 1,
      sampleN,
      isMeaningful: false,
      narrativeShort: null,
      narrativeLong: null,
    };
  }

  const xs = pairs.map((p) => p.x);
  const ys = pairs.map((p) => p.y);
  const r = pearsonR(xs, ys);
  if (!Number.isFinite(r)) {
    return {
      correlationType: type,
      pearsonR: null,
      effectSize: 0,
      effectUnit: null,
      significance: 1,
      sampleN,
      isMeaningful: false,
      narrativeShort: null,
      narrativeLong: null,
    };
  }
  const p = pearsonP(r, sampleN);
  const slope = regressionSlope(xs, ys);
  const isMeaningful =
    Math.abs(r) >= R_THRESHOLD && p < P_THRESHOLD && sampleN >= MIN_SAMPLE_N;

  if (!isMeaningful) {
    return {
      correlationType: type,
      pearsonR: r,
      effectSize: slope,
      effectUnit: null,
      significance: p,
      sampleN,
      isMeaningful: false,
      narrativeShort: null,
      narrativeLong: null,
    };
  }

  const narrative = narrativeFor(type, { sampleN, effectSize: slope });
  return {
    correlationType: type,
    pearsonR: r,
    effectSize: slope,
    effectUnit: narrative.effectUnit,
    significance: p,
    sampleN,
    isMeaningful: true,
    narrativeShort: narrative.short,
    narrativeLong: narrative.long,
  };
}

async function persist(
  supabase: SupabaseClient,
  familyId: string,
  userId: string,
  output: CorrelationOutput,
): Promise<void> {
  const row = {
    family_id: familyId,
    user_id: userId,
    correlation_type: output.correlationType,
    window_days: WINDOW_DAYS,
    pearson_r: output.pearsonR,
    effect_size: output.effectSize,
    effect_unit: output.effectUnit,
    significance: output.significance,
    sample_n: output.sampleN,
    is_meaningful: output.isMeaningful,
    narrative_short: output.narrativeShort,
    narrative_long: output.narrativeLong,
  };
  const { error } = await supabase.from('correlations').insert(row);
  if (error) throw error;
}

async function computeAndPersistForUser(
  supabase: SupabaseClient,
  familyId: string,
  userId: string,
  asOf?: Date,
): Promise<UserResult> {
  const outputs: CorrelationOutput[] = [];
  for (const type of ALL_CORRELATION_TYPES) {
    const output = await computeOne(supabase, familyId, userId, type, asOf);
    await persist(supabase, familyId, userId, output);
    outputs.push(output);
  }
  return { familyId, userId, outputs };
}

async function pickFamiliesAtLocalHour(
  supabase: SupabaseClient,
  targetHour: number,
  nowIso: string,
): Promise<{ familyId: string; userId: string }[]> {
  // Pull the (family, user) pairs from family_members joined to users
  // for their timezone, then filter in Deno via Intl.DateTimeFormat —
  // PostgREST can't express the time-zone-cast filter cleanly. The
  // table is small (one row per active membership), so this is
  // acceptable per query at ~hourly cadence.
  const { data, error } = await supabase
    .from('family_members')
    .select('family_id, user_id, users:users!inner(timezone)')
    .is('removed_at', null);
  if (error) throw error;
  const rows = (data ?? []) as unknown as { family_id: string; user_id: string; users: { timezone: string } }[];
  return rows
    .filter((r) => localHourFor(nowIso, r.users.timezone) === targetHour)
    .map((r) => ({ familyId: r.family_id, userId: r.user_id }));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const body: RequestBody = await req.json().catch(() => ({}));
  const supabase = createClient(
    envOrThrow('SUPABASE_URL'),
    envOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );

  const asOf = body.asOfIso ? new Date(body.asOfIso) : undefined;

  // Manual mode: explicit (familyId, userId).
  if (body.familyId && body.userId) {
    try {
      const result = await computeAndPersistForUser(
        supabase,
        body.familyId,
        body.userId,
        asOf,
      );
      return json({ mode: 'manual', result }, 200);
    } catch (e) {
      console.error('compute-correlations manual error', e);
      const message = e instanceof Error ? e.message : 'unknown';
      return json({ mode: 'manual', error: message }, 500);
    }
  }

  // Cron mode: pick families at 03:00 their local time and fan out.
  try {
    const nowIso = (asOf ?? new Date()).toISOString();
    const targets = await pickFamiliesAtLocalHour(
      supabase,
      TARGET_LOCAL_HOUR,
      nowIso,
    );
    const results: UserResult[] = [];
    for (const t of targets) {
      try {
        results.push(
          await computeAndPersistForUser(supabase, t.familyId, t.userId, asOf),
        );
      } catch (e) {
        // One user's failure doesn't poison the rest of the run.
        console.error(
          `compute-correlations user error family=${t.familyId} user=${t.userId}`,
          e,
        );
      }
    }
    return json(
      {
        mode: 'cron',
        targetHour: TARGET_LOCAL_HOUR,
        nowIso,
        targets: targets.length,
        completed: results.length,
        results,
      },
      200,
    );
  } catch (e) {
    console.error('compute-correlations cron error', e);
    const message = e instanceof Error ? e.message : 'unknown';
    return json({ mode: 'cron', error: message }, 500);
  }
});
