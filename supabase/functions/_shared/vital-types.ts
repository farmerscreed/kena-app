// Shared payload types for the Edge Function side of the multi-vitals
// pipeline. Mirrors apps/mobile/src/types/vitals.ts (the client-side
// source of truth) — the duplication exists because Deno's edge-function
// bundle cannot import from the React Native workspace. Keep these in
// sync with the client types; D13 §4.2 is the contract.
//
// Wire shape is camelCase (matches Sprint-6 /sync conventions). DB rows
// in vitals_other use snake_case + value_int* columns — see
// supabase/functions/sync/index.ts for the row mappers.

export interface DeviceMeta {
  bleId: string;
  macSuffix: string;
  name: string | null;
  model: 'U16H' | 'U19M';
  // Stable per-install device identity. Optional for backward-compat with
  // older clients that only send the (rotating) BLE MAC; when present the
  // server keys device identity on this so a reconnect/re-pair under a new
  // MAC reuses the same device row instead of minting a duplicate.
  clientDeviceId?: string;
}

export interface BPReading {
  measuredAtSec: number;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  source: 'watch' | 'manual';
  /** D13 PR-11 (§6.5) — reading_context enum values; optional so
   *  pre-tag clients keep syncing untouched. */
  contextTags?: string[];
}

export type HRMotionState = 'rest' | 'light' | 'moderate' | 'vigorous' | 'unknown';

export interface HRSample {
  measuredAtSec: number;
  bpm: number;
  sampleWindowSec: number;
  motionState: HRMotionState;
  isSpotCheck: boolean;
}

export interface SpO2Sample {
  measuredAtSec: number;
  percent: number;
  maxInWindow: number;
  minInWindow: number;
  sampleWindowSec: number;
  isSpotCheck: boolean;
  perfusionIndex: number | null;
}

export type SleepStage = 'light' | 'deep' | 'rem' | 'awake';

export interface SleepTransition {
  atSec: number;
  stage: SleepStage;
}

export interface SleepSession {
  sessionStartSec: number;
  sessionEndSec: number;
  sessionStartLocal: string;
  sessionEndLocal: string;
  totalMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  lightMinutes: number;
  awakeMinutes: number;
  awakeCount: number;
  transitions: SleepTransition[];
  sleepScore: number;
}

export interface ActivityDay {
  dayLocal: string;
  measuredAtSec: number;
  totalSteps: number;
  targetSteps: number;
  lastSampleAtSec: number;
  hourly: number[];
}

export interface CaloriesDay {
  dayLocal: string;
  measuredAtSec: number;
  totalKcal: number;
  activityKcal: number;
  bmrKcal: number;
  targetKcal: number | null;
}

export interface MultiVitalsPayload {
  device: DeviceMeta;
  bpReadings?: BPReading[];
  hrSamples?: HRSample[];
  spo2Samples?: SpO2Sample[];
  sleepSessions?: SleepSession[];
  activityDays?: ActivityDay[];
  caloriesDays?: CaloriesDay[];
  clientSyncedAtSec: number;
  clientAppVersion: string;
}

// Sprint-6 single-reading shape — preserved so existing mobile callers
// keep working without coordinated rollout. New callers should always
// send MultiVitalsPayload. The discriminator is the presence of
// `body.reading` (singular) vs any of the *Readings/*Samples/*Sessions/
// *Days arrays.
export interface LegacyReadingPayload {
  device: DeviceMeta;
  reading: BPReading;
}

export type SyncRequest = MultiVitalsPayload | LegacyReadingPayload;

export function isLegacyPayload(body: unknown): body is LegacyReadingPayload {
  return (
    typeof body === 'object' &&
    body !== null &&
    'reading' in body &&
    typeof (body as { reading: unknown }).reading === 'object' &&
    (body as { reading: unknown }).reading !== null
  );
}
