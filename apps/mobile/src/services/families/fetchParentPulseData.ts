// services/families/fetchParentPulseData — Sprint 17a.
//
// Family-scoped read-only data layer for the per-person dashboard.
//
// Mirrors the snapshot shape `state/dailyPulse.ts` consumes so the
// VitalDetail screens can swap data sources without conditional logic
// (the same `DailyPulseData` shape comes from either the singleton
// slices for the signed-in self-buyer OR this fetcher for a parent
// the caregiver is viewing).
//
// Why a separate read path: the Zustand slices
// (`useReadings` / `useHR` / `useSpO2` / `useSleep` / `useActivity`)
// are per-app singletons keyed implicitly to the signed-in user.
// Writing the parent's data into them would pollute the caregiver's
// own slice. A caregiver viewing remote family data is inherently
// online — the offline-first contract is for the device-paired user.
//
// This module is intentionally pure-async (no React, no TanStack).
// The hooks in `hooks/useParentDailyPulseData.ts` + `hooks/useParentVitalsRecent.ts`
// wrap it with caching + invalidation.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import {
  composeDailyPulseData,
  type DailyPulseData,
  type DailyPulseSnapshot,
} from '../../state/dailyPulse';
import {
  computeHRRestingToday,
  computeHRRestingRecent,
  computeHRLatestSampleAt,
  computeHRLatestBpm,
  computeSpO2LatestPercent,
  computeSpO2LatestSampleAt,
  computeSpO2OvernightLowsRecent,
  computeSleepLastNight,
  computeActivityToday,
} from '../../utils/vitalAggregators';
import {
  classifyReading,
} from '../../utils/classification';
import {
  seedVitalBaselines,
  resolveBpBaselines,
  type BpBaselinePair,
  type VitalBaselineServerRow,
} from '../../utils/vitalBaselines';
import type { LocalReading } from '../../state/readings';
import type {
  HRSample,
  HRMotionState,
  SpO2Sample,
  SleepSession,
  SleepStage,
  SleepTransition,
  ActivityDay,
  CaloriesDay,
} from '../../types/vitals';

// Caps mirror the per-slice RECENT_*_CAP values so a caregiver gets
// at most the same history depth a self-buyer would have locally.
const BP_LIMIT = 30;
const HR_LIMIT = 200;
const SPO2_LIMIT = 200;
const SLEEP_LIMIT = 60;
const ACTIVITY_LIMIT = 90;
const CALORIES_LIMIT = 90;

export interface ParentVitalsRecent {
  readings: LocalReading[];
  hr: HRSample[];
  spo2: SpO2Sample[];
  sleep: SleepSession[];
  steps: ActivityDay[];
  calories: CaloriesDay[];
}

export interface ParentPulseFetchResult {
  /** Composed `DailyPulseData` — same shape `useDailyPulseData()` returns. */
  pulse: DailyPulseData;
  /** Per-vital recent arrays. Used by parameterized VitalDetail screens. */
  recent: ParentVitalsRecent;
  /**
   * The wearer's (family owner's) IANA timezone, so the caregiver's
   * VitalDetail screens render the wearer's readings in the wearer's
   * local time — not the caregiver's device tz. null when unknown
   * (caller falls back to the viewer's tz, then UTC). Readable under the
   * `users` "same-family read profile" RLS policy.
   */
  wearerTimeZone: string | null;
}

// ----- Server row shapes ------------------------------------------

interface ReadingRow {
  id: string;
  family_id: string;
  device_id: string | null;
  source: string;
  measured_at: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  hidden: boolean;
}

interface VitalsOtherRow {
  id: string;
  family_id: string;
  device_id: string | null;
  vital_type: string;
  measured_at: string;
  value_int: number;
  value_int_2: number | null;
  value_int_3: number | null;
  value_jsonb: Record<string, unknown> | null;
}

// ----- Mappers (mirror the hydration-hook mappers; intentionally
// duplicated here to keep this module self-contained — the hydration
// hooks' mappers are private and one-shot, this fetcher needs the
// same shape for a different orchestration path) -------------------

function mapReading(
  row: ReadingRow,
  baselines: BpBaselinePair | null,
): LocalReading {
  // D13 PR-1 (P0-2) — the parent's readings are classified against the
  // PARENT's own truth-layer baseline. This is the caregiver path, so
  // the baseline comes from the parent's server rows (or the
  // provisional recompute over the parent's fetched readings), never
  // from the caregiver's own local store. No history: batch
  // re-classification never runs the confirmation rule.
  const classification = classifyReading(
    { systolic: row.systolic, diastolic: row.diastolic, pulse: row.pulse },
    baselines,
  );
  const measuredAtMs = new Date(row.measured_at).getTime();
  return {
    localId: `srv-${row.id}`,
    serverId: row.id,
    measuredAtSec: Math.floor(measuredAtMs / 1000),
    systolic: row.systolic,
    diastolic: row.diastolic,
    pulse: row.pulse,
    source: (row.source as LocalReading['source']) ?? 'watch',
    deviceBleId: null,
    classification,
    capturedAtMs: measuredAtMs,
  };
}

function mapHR(row: VitalsOtherRow): HRSample {
  const j = (row.value_jsonb ?? {}) as {
    sample_window_sec?: number;
    motion_state?: HRMotionState;
    is_spot_check?: boolean;
  };
  return {
    measuredAtSec: Math.floor(new Date(row.measured_at).getTime() / 1000),
    bpm: row.value_int,
    sampleWindowSec: j.sample_window_sec ?? 5 * 60,
    motionState: j.motion_state ?? 'unknown',
    isSpotCheck: j.is_spot_check ?? false,
  };
}

function mapSpO2(row: VitalsOtherRow): SpO2Sample {
  const j = (row.value_jsonb ?? {}) as {
    sample_window_sec?: number;
    is_spot_check?: boolean;
    perfusion_index?: number | null;
  };
  return {
    measuredAtSec: Math.floor(new Date(row.measured_at).getTime() / 1000),
    percent: row.value_int,
    maxInWindow: row.value_int_2 ?? row.value_int,
    minInWindow: row.value_int_3 ?? row.value_int,
    sampleWindowSec: j.sample_window_sec ?? 60 * 60,
    isSpotCheck: j.is_spot_check ?? false,
    perfusionIndex: j.perfusion_index ?? null,
  };
}

function mapSleep(row: VitalsOtherRow): SleepSession {
  const j = (row.value_jsonb ?? {}) as {
    session_start_local?: string;
    session_end_local?: string;
    light_minutes?: number;
    awake_minutes?: number;
    awake_count?: number;
    transitions?: SleepTransition[];
    sleep_score?: number;
  };
  const totalMinutes = row.value_int;
  const deepMinutes = row.value_int_2 ?? 0;
  const remMinutes = row.value_int_3 ?? 0;
  const lightMinutes = j.light_minutes ?? 0;
  const awakeMinutes = j.awake_minutes ?? 0;
  const awakeCount = j.awake_count ?? 0;
  const transitions = j.transitions ?? [];
  const sleepScore = j.sleep_score ?? 0;
  // measured_at is the session END (the constant night key — see
  // mapSleepSessions). Derive the start deterministically as end - total;
  // the actual start epoch is also carried in session_start_local.
  const sessionEndSec = Math.floor(new Date(row.measured_at).getTime() / 1000);
  const sessionStartSec = j.session_start_local
    ? Math.floor(new Date(j.session_start_local).getTime() / 1000)
    : sessionEndSec - (totalMinutes ?? 0) * 60;
  const sessionStartLocal =
    j.session_start_local ?? new Date(sessionStartSec * 1000).toISOString();
  const sessionEndLocal =
    j.session_end_local ?? new Date(sessionEndSec * 1000).toISOString();
  return {
    sessionStartSec,
    sessionEndSec,
    sessionStartLocal,
    sessionEndLocal,
    totalMinutes,
    deepMinutes,
    remMinutes,
    lightMinutes,
    awakeMinutes,
    awakeCount,
    transitions,
    sleepScore,
  };
}

function mapStepsDay(row: VitalsOtherRow): ActivityDay {
  const j = (row.value_jsonb ?? {}) as {
    day_local?: string;
    target_steps?: number;
    last_sample_at?: string;
    hourly?: number[];
  };
  const measuredAtSec = Math.floor(new Date(row.measured_at).getTime() / 1000);
  const dayLocal = j.day_local ?? row.measured_at.slice(0, 10);
  const lastSampleAtSec = j.last_sample_at
    ? Math.floor(new Date(j.last_sample_at).getTime() / 1000)
    : measuredAtSec;
  const hourly =
    Array.isArray(j.hourly) && j.hourly.length === 24
      ? j.hourly
      : Array.from({ length: 24 }, () => 0);
  return {
    dayLocal,
    measuredAtSec,
    totalSteps: row.value_int,
    targetSteps: j.target_steps ?? 6000,
    lastSampleAtSec,
    hourly,
  };
}

function mapCaloriesDay(row: VitalsOtherRow): CaloriesDay {
  const j = (row.value_jsonb ?? {}) as {
    day_local?: string;
    target_kcal?: number | null;
    activity_kcal?: number;
    bmr_kcal?: number;
  };
  const measuredAtSec = Math.floor(new Date(row.measured_at).getTime() / 1000);
  const dayLocal = j.day_local ?? row.measured_at.slice(0, 10);
  return {
    dayLocal,
    measuredAtSec,
    totalKcal: row.value_int,
    activityKcal: j.activity_kcal ?? 0,
    bmrKcal: j.bmr_kcal ?? 0,
    targetKcal: j.target_kcal ?? null,
  };
}

// Marker — keep SleepStage import alive even though only SleepTransition
// directly references it; future call-site type narrowing reaches for it.
// (Plain re-export instead would require an `export type` line, which
// is overkill — this is cheaper.)
const _sleepStageMarker: SleepStage | undefined = undefined;
void _sleepStageMarker;

// ----- Public --------------------------------------------------

export async function fetchParentPulseData(
  client: SupabaseClient<Database>,
  familyId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<ParentPulseFetchResult> {
  // Seven parallel queries — readings table + five vitals_other slices
  // + the parent's vital_baselines truth-layer rows (D13 PR-1). A
  // single vitals_other query with vital_type IN(...) is possible
  // but the per-vital caps diverge wildly (HR/SpO2 dense, sleep/
  // activity per-day), so fanning out keeps the limits tight and the
  // total payload bounded.
  const [
    readingsResult,
    hrResult,
    spo2Result,
    sleepResult,
    stepsResult,
    caloriesResult,
    ownerResult,
    baselinesResult,
  ] = await Promise.all([
    client
      .from('readings')
      .select(
        'id, family_id, device_id, source, measured_at, systolic, diastolic, pulse, hidden',
      )
      .eq('family_id', familyId)
      .eq('hidden', false)
      .order('measured_at', { ascending: false })
      .limit(BP_LIMIT),
    client
      .from('vitals_other')
      .select(
        'id, family_id, device_id, vital_type, measured_at, value_int, value_int_2, value_int_3, value_jsonb',
      )
      .eq('family_id', familyId)
      .eq('vital_type', 'hr')
      .order('measured_at', { ascending: false })
      .limit(HR_LIMIT),
    client
      .from('vitals_other')
      .select(
        'id, family_id, device_id, vital_type, measured_at, value_int, value_int_2, value_int_3, value_jsonb',
      )
      .eq('family_id', familyId)
      .eq('vital_type', 'spo2')
      .order('measured_at', { ascending: false })
      .limit(SPO2_LIMIT),
    client
      .from('vitals_other')
      .select(
        'id, family_id, device_id, vital_type, measured_at, value_int, value_int_2, value_int_3, value_jsonb',
      )
      .eq('family_id', familyId)
      .eq('vital_type', 'sleep_session')
      .order('measured_at', { ascending: false })
      .limit(SLEEP_LIMIT),
    client
      .from('vitals_other')
      .select(
        'id, family_id, device_id, vital_type, measured_at, value_int, value_int_2, value_int_3, value_jsonb',
      )
      .eq('family_id', familyId)
      .eq('vital_type', 'steps_day')
      .order('measured_at', { ascending: false })
      .limit(ACTIVITY_LIMIT),
    client
      .from('vitals_other')
      .select(
        'id, family_id, device_id, vital_type, measured_at, value_int, value_int_2, value_int_3, value_jsonb',
      )
      .eq('family_id', familyId)
      .eq('vital_type', 'calories_day')
      .order('measured_at', { ascending: false })
      .limit(CALORIES_LIMIT),
    // Wearer (family owner) timezone — mirrors the listMembers/visibility
    // FK-join pattern; readable via the `users` same-family RLS policy.
    client
      .from('family_members')
      .select('users!family_members_user_id_fkey(timezone)')
      .eq('family_id', familyId)
      .eq('role', 'family_owner')
      .is('removed_at', null)
      .maybeSingle(),
    client
      .from('vital_baselines')
      .select(
        'vital, window_days, sample_count, mean_value, sd_value, p10_value, p90_value, context_tag, is_sufficient, computed_at',
      )
      .eq('family_id', familyId),
  ]);

  if (readingsResult.error) throw readingsResult.error;
  if (hrResult.error) throw hrResult.error;
  if (spo2Result.error) throw spo2Result.error;
  if (sleepResult.error) throw sleepResult.error;
  if (stepsResult.error) throw stepsResult.error;
  if (caloriesResult.error) throw caloriesResult.error;

  const readingRows = (readingsResult.data ?? []) as ReadingRow[];
  // D13 PR-1 — the PARENT's truth-layer rows, seeded into the shared
  // cache so synchronous consumers (caregiverPerson) read the same
  // band. Baseline failure is non-fatal: the resolver falls back to a
  // provisional recompute over the parent's own fetched window, never
  // the caregiver's local store. Resolved once so the whole batch is
  // judged consistently.
  if (!baselinesResult.error && baselinesResult.data) {
    seedVitalBaselines(
      familyId,
      baselinesResult.data as unknown as VitalBaselineServerRow[],
    );
  }
  const readingBaselines = resolveBpBaselines(
    familyId,
    readingRows.map((r) => ({
      measuredAtSec: Math.floor(new Date(r.measured_at).getTime() / 1000),
      systolic: r.systolic,
      diastolic: r.diastolic,
    })),
    nowSec,
  );
  const readings = readingRows.map((r) => mapReading(r, readingBaselines));
  const hr = ((hrResult.data ?? []) as VitalsOtherRow[]).map(mapHR);
  const spo2 = ((spo2Result.data ?? []) as VitalsOtherRow[]).map(mapSpO2);
  const sleep = ((sleepResult.data ?? []) as VitalsOtherRow[]).map(mapSleep);
  const steps = ((stepsResult.data ?? []) as VitalsOtherRow[]).map(mapStepsDay);
  const calories = ((caloriesResult.data ?? []) as VitalsOtherRow[]).map(
    mapCaloriesDay,
  );

  // Wearer (family owner) tz — drives "today"/"night" boundaries in the
  // aggregators so the caregiver sees the wearer's local days, not UTC. The
  // embedded `users` join may surface as an object or single-element array.
  const ownerUsers = (ownerResult.data as { users?: unknown } | null)?.users;
  const ownerObj = Array.isArray(ownerUsers) ? ownerUsers[0] : ownerUsers;
  const wearerTimeZone =
    (ownerObj as { timezone?: string | null } | undefined)?.timezone ?? null;
  const tz = wearerTimeZone ?? 'UTC';

  const snapshot: DailyPulseSnapshot = {
    bpLatest: readings[0] ?? null,
    hrRestingToday: computeHRRestingToday(hr, nowSec, tz),
    hrRestingRecent: computeHRRestingRecent(hr, nowSec, tz),
    hrLatestSampleAt: computeHRLatestSampleAt(hr),
    hrLatestBpm: computeHRLatestBpm(hr),
    spo2LatestPercent: computeSpO2LatestPercent(spo2),
    spo2OvernightLowsRecent: computeSpO2OvernightLowsRecent(spo2, nowSec, tz),
    spo2LatestSampleAt: computeSpO2LatestSampleAt(spo2),
    sleepSession: computeSleepLastNight(sleep, nowSec, tz),
    activityToday: computeActivityToday(steps, nowSec, tz),
  };

  const pulse = composeDailyPulseData(snapshot, nowSec);

  // wearerTimeZone is best-effort: a failed/empty lookup leaves it null and
  // the screens fall back to the viewer's tz, then UTC.
  return {
    pulse,
    recent: { readings, hr, spo2, sleep, steps, calories },
    wearerTimeZone,
  };
}
