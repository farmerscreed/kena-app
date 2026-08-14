// POST a MultiVitalsPayload batch to the /sync Edge Function. Sprint 7.5
// expansion of postReading.ts (which keeps the legacy single-BP shape
// alive for Sprint 6 callers).
//
// Per docs/_reference/D13-multi-vitals-constellation-spec.md §4.2: each
// vital array is independently optional — a payload with only HR
// samples is valid, as is sending all five at once. The Edge Function
// shape-discriminates on body and dispatches to the multi-vitals path
// when it sees any of the *Readings/*Samples/*Sessions/*Days arrays.
//
// Idempotency: the dedupe indexes on (device_id, vital_type, measured_at)
// for vitals_other and (device_id, measured_at) for readings make
// retries safe — duplicates are silently absorbed and counted in the
// `duplicates` field of the response. Callers may treat duplicates as
// success (the row is in the database, just not from THIS request).
//
// Per CLAUDE.md voice + data rules: this function does NOT log values.
// Errors carry codes only.

import { supabase } from '../supabase';
import { SYNC_UPLOAD_TIMEOUT_MS, withTimeout } from './withTimeout';
import type { MultiVitalsPayload } from '../../types/vitals';

export interface MultiVitalsCounts {
  bp: number;
  hr: number;
  spo2: number;
  sleep: number;
  steps: number;
  calories: number;
}

export interface MultiVitalsResponse {
  deviceId: string;
  inserted: MultiVitalsCounts;
  rejected: MultiVitalsCounts;
  duplicates: MultiVitalsCounts;
}

export async function postMultiVitals(
  payload: MultiVitalsPayload,
): Promise<MultiVitalsResponse> {
  // Bounded: invoke() never times out on its own, and an unbounded upload
  // wedges the whole sync run (see withTimeout.ts for the 2026-08-14 case).
  const { data, error } = await withTimeout(
    supabase.functions.invoke<MultiVitalsResponse>('sync', { body: payload }),
    SYNC_UPLOAD_TIMEOUT_MS,
    '/sync multi-vitals upload',
  );
  if (error) {
    // Sprint 16.5b — surface the upstream failure so the orchestrator
    // can log it. Pre-16.5b this error was caught further up but never
    // logged; the result was 8 days of HR/SpO2/Sleep/Activity samples
    // accumulating in MMKV pending without anyone knowing why /sync
    // wasn't accepting them. Per CLAUDE.md voice + data rules: include
    // status + name only, never PHI.
    //
    // supabase.functions.invoke wraps the Response in error.context.
    // Surface .status from the context so trace logs show "503" /
    // "504" / "CPU time soft limit reached" rather than just the
    // generic "non-2xx status code" string.
    const ctx = (error as { context?: { status?: number; statusText?: string } }).context;
    const status = ctx?.status;
    const statusText = ctx?.statusText;
    const detail = status
      ? `${status} ${statusText ?? ''} (${error.message})`.trim()
      : error.message;
    // Sample size in the error helps correlate failures with payload
    // size when the CPU soft limit hits a borderline chunk.
    const sizes = [
      payload.bpReadings?.length && `bp=${payload.bpReadings.length}`,
      payload.hrSamples?.length && `hr=${payload.hrSamples.length}`,
      payload.spo2Samples?.length && `spo2=${payload.spo2Samples.length}`,
      payload.sleepSessions?.length && `sleep=${payload.sleepSessions.length}`,
      payload.activityDays?.length && `act=${payload.activityDays.length}`,
      payload.caloriesDays?.length && `cal=${payload.caloriesDays.length}`,
    ].filter(Boolean).join(',');
    throw new Error(`/sync invoke failed: ${detail} [${sizes}]`);
  }
  if (!data) throw new Error('/sync returned no body');
  return data;
}

/** True when the payload carries no rows. Skip the network round-trip
 *  in that case — the orchestrator may run with all reads returning
 *  empty (e.g. mid-day with auto-sample disabled). */
export function isPayloadEmpty(payload: MultiVitalsPayload): boolean {
  return (
    !payload.bpReadings?.length &&
    !payload.hrSamples?.length &&
    !payload.spo2Samples?.length &&
    !payload.sleepSessions?.length &&
    !payload.activityDays?.length &&
    !payload.caloriesDays?.length
  );
}
