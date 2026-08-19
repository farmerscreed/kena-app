// Paired-observation SQL queries for compute-correlations — Sprint 9.
//
// Each query returns one row per (day) with the two values needed to
// compute the correlation. Days where either side is missing are
// dropped so the engine sees only complete pairs.
//
// Local-time semantics: every query converts UTC `measured_at` to the
// user's local time via `at time zone u.timezone`, then filters/derives
// against the local hour. This is what makes the engine work for a
// Lagos parent and a US-East caregiver in the same family — each user
// gets their own local-time scope per docs/15-correlation-engine.md §6.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface PairedObservation {
  /** Local YYYY-MM-DD for the day this pair represents. */
  day: string;
  /** Independent variable. */
  x: number;
  /** Dependent variable. */
  y: number;
}

const WINDOW_DAYS = 30;

interface QueryArgs {
  supabase: SupabaseClient;
  familyId: string;
  userId: string;
  /** Override "now" for tests. Default: server now(). */
  asOf?: Date;
}

function asOfClause(asOf: Date | undefined): { startIso: string; endIso: string } {
  const end = asOf ?? new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function fetchUserTimezone(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('users')
    .select('timezone')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return (data as { timezone: string }).timezone;
}

/** sleep × morning BP — pairs (sleep total minutes for night ending day D,
 *  mean morning systolic between 06:00 and 12:00 user-local). */
export async function fetchSleepXMorningBp(
  args: QueryArgs,
): Promise<PairedObservation[]> {
  const { supabase, familyId, userId } = args;
  const tz = await fetchUserTimezone(supabase, userId);
  const { startIso, endIso } = asOfClause(args.asOf);

  // PostgREST RPC isn't ideal for date_trunc + at-time-zone joins.
  // We pull both sides separately and pair in Deno — keeps the SQL
  // shape simple + identical across the three correlation types.
  const [readingsRes, sleepRes] = await Promise.all([
    supabase
      .from('readings')
      .select('measured_at, systolic')
      .eq('family_id', familyId)
      .eq('hidden', false)
      .gte('measured_at', startIso)
      .lt('measured_at', endIso),
    supabase
      .from('vitals_other')
      .select('measured_at, value_int')
      .eq('family_id', familyId)
      .eq('vital_type', 'sleep_session')
      .eq('hidden', false)
      .gte('measured_at', startIso)
      .lt('measured_at', endIso),
  ]);
  if (readingsRes.error) throw readingsRes.error;
  if (sleepRes.error) throw sleepRes.error;

  const readings = (readingsRes.data ?? []) as { measured_at: string; systolic: number }[];
  const sleeps = (sleepRes.data ?? []) as { measured_at: string; value_int: number | null }[];

  // Bucket morning systolic by user-local day.
  const morningByDay = new Map<string, number[]>();
  for (const r of readings) {
    const local = toLocal(r.measured_at, tz);
    if (local.hour < 6 || local.hour >= 12) continue;
    const list = morningByDay.get(local.day);
    if (list) list.push(r.systolic);
    else morningByDay.set(local.day, [r.systolic]);
  }
  // Sleep totals by user-local day (the day the session ENDED on).
  const sleepByDay = new Map<string, number>();
  for (const s of sleeps) {
    if (s.value_int === null) continue;
    const local = toLocal(s.measured_at, tz);
    sleepByDay.set(local.day, s.value_int);
  }

  const pairs: PairedObservation[] = [];
  for (const [day, mornings] of morningByDay) {
    const totalMin = sleepByDay.get(day);
    if (totalMin === undefined) continue;
    const meanSys = mornings.reduce((a, b) => a + b, 0) / mornings.length;
    pairs.push({ day, x: totalMin, y: meanSys });
  }
  return pairs.sort((a, b) => a.day.localeCompare(b.day));
}

/** activity × resting HR — pairs (steps_day total, resting HR for the
 *  same day, where resting HR = median of 22:00-06:00 local samples). */
export async function fetchActivityXRestingHr(
  args: QueryArgs,
): Promise<PairedObservation[]> {
  const { supabase, familyId, userId } = args;
  const tz = await fetchUserTimezone(supabase, userId);
  const { startIso, endIso } = asOfClause(args.asOf);

  const [stepsRes, hrRes] = await Promise.all([
    supabase
      .from('vitals_other')
      .select('measured_at, value_int')
      .eq('family_id', familyId)
      .eq('vital_type', 'steps_day')
      .eq('hidden', false)
      .gte('measured_at', startIso)
      .lt('measured_at', endIso),
    supabase
      .from('vitals_other')
      .select('measured_at, value_int')
      .eq('family_id', familyId)
      .eq('vital_type', 'hr')
      .eq('hidden', false)
      .gte('measured_at', startIso)
      .lt('measured_at', endIso),
  ]);
  if (stepsRes.error) throw stepsRes.error;
  if (hrRes.error) throw hrRes.error;

  const steps = (stepsRes.data ?? []) as { measured_at: string; value_int: number | null }[];
  const hrSamples = (hrRes.data ?? []) as { measured_at: string; value_int: number | null }[];

  const stepsByDay = new Map<string, number>();
  for (const s of steps) {
    if (s.value_int === null) continue;
    const local = toLocal(s.measured_at, tz);
    stepsByDay.set(local.day, s.value_int);
  }

  const overnightHrByDay = new Map<string, number[]>();
  const allDayHrByDay = new Map<string, number[]>();
  for (const h of hrSamples) {
    if (h.value_int === null) continue;
    const local = toLocal(h.measured_at, tz);
    if (local.hour >= 22 || local.hour < 6) {
      const list = overnightHrByDay.get(local.day);
      if (list) list.push(h.value_int);
      else overnightHrByDay.set(local.day, [h.value_int]);
    }
    const allList = allDayHrByDay.get(local.day);
    if (allList) allList.push(h.value_int);
    else allDayHrByDay.set(local.day, [h.value_int]);
  }

  const pairs: PairedObservation[] = [];
  for (const [day, steps] of stepsByDay) {
    const overnight = overnightHrByDay.get(day) ?? [];
    const allDay = allDayHrByDay.get(day) ?? [];
    const sample = overnight.length > 0 ? overnight : allDay;
    if (sample.length === 0) continue;
    pairs.push({ day, x: steps, y: median(sample) });
  }
  return pairs.sort((a, b) => a.day.localeCompare(b.day));
}

/** SpO2 night-dip × sleep score — pairs (overnight SpO2 minimum, sleep
 *  total minutes for the same night). Sleep score proxy uses total
 *  minutes for v1.0 (the dominant component of any sleep-score
 *  formula); a real score lands when Sprint 12.5 ships the classifier
 *  server-side. */
export async function fetchSpO2DipXSleepScore(
  args: QueryArgs,
): Promise<PairedObservation[]> {
  const { supabase, familyId, userId } = args;
  const tz = await fetchUserTimezone(supabase, userId);
  const { startIso, endIso } = asOfClause(args.asOf);

  const [spo2Res, sleepRes] = await Promise.all([
    supabase
      .from('vitals_other')
      .select('measured_at, value_int, value_int_3')
      .eq('family_id', familyId)
      .eq('vital_type', 'spo2')
      .eq('hidden', false)
      .gte('measured_at', startIso)
      .lt('measured_at', endIso),
    supabase
      .from('vitals_other')
      .select('measured_at, value_int')
      .eq('family_id', familyId)
      .eq('vital_type', 'sleep_session')
      .eq('hidden', false)
      .gte('measured_at', startIso)
      .lt('measured_at', endIso),
  ]);
  if (spo2Res.error) throw spo2Res.error;
  if (sleepRes.error) throw sleepRes.error;

  const spo2Samples = (spo2Res.data ?? []) as {
    measured_at: string;
    value_int: number | null;
    value_int_3: number | null;
  }[];
  const sleeps = (sleepRes.data ?? []) as { measured_at: string; value_int: number | null }[];

  // Overnight SpO2 minimum per day-the-night-ENDS-on. A sample at
  // 02:00 local on day D belongs to "the night ending on day D"; a
  // sample at 23:00 local on day D belongs to "the night ending on
  // day D+1". Carry the day forward when the local hour is in 22..23.
  const minSpo2ByDay = new Map<string, number>();
  for (const s of spo2Samples) {
    const local = toLocal(s.measured_at, tz);
    let nightEndDay: string;
    if (local.hour >= 22) {
      nightEndDay = addDays(local.day, 1);
    } else if (local.hour < 6) {
      nightEndDay = local.day;
    } else {
      continue;
    }
    // Prefer the per-window minimum (value_int_3) when available; fall
    // back to the per-window average (value_int).
    const minPercent = s.value_int_3 ?? s.value_int;
    if (minPercent === null) continue;
    const prev = minSpo2ByDay.get(nightEndDay);
    if (prev === undefined || minPercent < prev) {
      minSpo2ByDay.set(nightEndDay, minPercent);
    }
  }

  const sleepByDay = new Map<string, number>();
  for (const s of sleeps) {
    if (s.value_int === null) continue;
    const local = toLocal(s.measured_at, tz);
    sleepByDay.set(local.day, s.value_int);
  }

  const pairs: PairedObservation[] = [];
  for (const [day, minSpo2] of minSpo2ByDay) {
    const score = sleepByDay.get(day);
    if (score === undefined) continue;
    pairs.push({ day, x: minSpo2, y: score });
  }
  return pairs.sort((a, b) => a.day.localeCompare(b.day));
}

// ────────────────────────────────────────────────────────────────────
// Helpers.

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

interface LocalTime {
  day: string;
  hour: number;
}

/** Convert a UTC ISO timestamp to the user's local time (day + hour).
 *  Uses Intl.DateTimeFormat with the IANA timezone, which Deno supports
 *  out of the box. Returns YYYY-MM-DD + 0..23 hour. */
export function toLocal(utcIso: string, timezone: string): LocalTime {
  const date = new Date(utcIso);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    // en-CA returns 24h with 24 for midnight in some Node/Deno versions —
    // normalise to 0.
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
  };
}

export function addDays(dayLocal: string, n: number): string {
  const ms = new Date(`${dayLocal}T00:00:00Z`).getTime() + n * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Compute the user-local hour at the given UTC instant — used for the
 *  cron fan-out to pick families at 03:00 their local time. */
export function localHourFor(utcIso: string, timezone: string): number {
  return toLocal(utcIso, timezone).hour;
}

// ── The matrix additions (2026-08-19) ────────────────────────────────

/** sleep × resting HR — pairs (sleep total minutes for the night
 *  ending day D, resting HR for day D = median of 22:00–06:00 local
 *  samples). Short or fragmented sleep showing up as a higher resting
 *  rate is the textbook association; the pair tests it on THIS person. */
export async function fetchSleepXRestingHr(
  args: QueryArgs,
): Promise<PairedObservation[]> {
  const { supabase, familyId, userId } = args;
  const tz = await fetchUserTimezone(supabase, userId);
  const { startIso, endIso } = asOfClause(args.asOf);

  const [sleepRes, hrRes] = await Promise.all([
    supabase
      .from('vitals_other')
      .select('measured_at, value_int')
      .eq('family_id', familyId)
      .eq('vital_type', 'sleep_session')
      .eq('hidden', false)
      .gte('measured_at', startIso)
      .lt('measured_at', endIso),
    supabase
      .from('vitals_other')
      .select('measured_at, value_int')
      .eq('family_id', familyId)
      .eq('vital_type', 'hr')
      .eq('hidden', false)
      .gte('measured_at', startIso)
      .lt('measured_at', endIso),
  ]);
  if (sleepRes.error) throw sleepRes.error;
  if (hrRes.error) throw hrRes.error;

  const sleepByDay = new Map<string, number>();
  for (const s of (sleepRes.data ?? []) as { measured_at: string; value_int: number | null }[]) {
    if (s.value_int === null) continue;
    const local = toLocal(s.measured_at, tz);
    sleepByDay.set(local.day, s.value_int);
  }
  const hrByDay = new Map<string, number[]>();
  for (const h of (hrRes.data ?? []) as { measured_at: string; value_int: number | null }[]) {
    if (h.value_int === null || h.value_int === 0) continue;
    const local = toLocal(h.measured_at, tz);
    if (local.hour >= 22 || local.hour < 6) {
      const list = hrByDay.get(local.day);
      if (list) list.push(h.value_int);
      else hrByDay.set(local.day, [h.value_int]);
    }
  }

  const pairs: PairedObservation[] = [];
  for (const [day, totalMin] of sleepByDay) {
    const sample = hrByDay.get(day);
    if (!sample || sample.length === 0) continue;
    pairs.push({ day, x: totalMin, y: median(sample) });
  }
  return pairs.sort((a, b) => a.day.localeCompare(b.day));
}

/** movement × NEXT-morning BP — pairs (steps total for day D, mean
 *  morning systolic for day D+1). The day-after pairing matches how
 *  activity is expected to show up in a morning number. */
export async function fetchActivityXMorningBp(
  args: QueryArgs,
): Promise<PairedObservation[]> {
  const { supabase, familyId, userId } = args;
  const tz = await fetchUserTimezone(supabase, userId);
  const { startIso, endIso } = asOfClause(args.asOf);

  const [stepsRes, readingsRes] = await Promise.all([
    supabase
      .from('vitals_other')
      .select('measured_at, value_int')
      .eq('family_id', familyId)
      .eq('vital_type', 'steps_day')
      .eq('hidden', false)
      .gte('measured_at', startIso)
      .lt('measured_at', endIso),
    supabase
      .from('readings')
      .select('measured_at, systolic')
      .eq('family_id', familyId)
      .eq('hidden', false)
      .gte('measured_at', startIso)
      .lt('measured_at', endIso),
  ]);
  if (stepsRes.error) throw stepsRes.error;
  if (readingsRes.error) throw readingsRes.error;

  const stepsByDay = new Map<string, number>();
  for (const s of (stepsRes.data ?? []) as { measured_at: string; value_int: number | null }[]) {
    if (s.value_int === null || s.value_int === 0) continue;
    const local = toLocal(s.measured_at, tz);
    const prev = stepsByDay.get(local.day);
    if (prev === undefined || s.value_int > prev) stepsByDay.set(local.day, s.value_int);
  }
  const morningByDay = new Map<string, number[]>();
  for (const r of (readingsRes.data ?? []) as { measured_at: string; systolic: number }[]) {
    const local = toLocal(r.measured_at, tz);
    if (local.hour < 6 || local.hour >= 12) continue;
    const list = morningByDay.get(local.day);
    if (list) list.push(r.systolic);
    else morningByDay.set(local.day, [r.systolic]);
  }

  const nextDay = (day: string): string => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  const pairs: PairedObservation[] = [];
  for (const [day, steps] of stepsByDay) {
    const mornings = morningByDay.get(nextDay(day));
    if (!mornings || mornings.length === 0) continue;
    const meanSys = mornings.reduce((a, b) => a + b, 0) / mornings.length;
    pairs.push({ day, x: steps, y: meanSys });
  }
  return pairs.sort((a, b) => a.day.localeCompare(b.day));
}

/** after-meds tag × BP — a two-group comparison expressed as a
 *  point-biserial pair set: x = 1 when the reading carries the
 *  after_meds tag, 0 otherwise; y = systolic. The regression slope IS
 *  the mean difference in mmHg between tagged and untagged readings.
 *  The caller enforces MIN_GROUP_N per group on top of the shared
 *  gates. Descriptive only — efficacy is the doctor's question. */
export async function fetchAfterMedsXBp(
  args: QueryArgs,
): Promise<PairedObservation[]> {
  const { supabase, familyId } = args;
  const { startIso, endIso } = asOfClause(args.asOf);

  const res = await supabase
    .from('readings')
    .select('measured_at, systolic, context_tags')
    .eq('family_id', familyId)
    .eq('hidden', false)
    .gte('measured_at', startIso)
    .lt('measured_at', endIso);
  if (res.error) throw res.error;

  const rows = (res.data ?? []) as {
    measured_at: string;
    systolic: number;
    context_tags: string[] | null;
  }[];
  const pairs: PairedObservation[] = rows.map((r) => ({
    day: r.measured_at.slice(0, 10),
    x: (r.context_tags ?? []).includes('after_meds') ? 1 : 0,
    y: r.systolic,
  }));
  // With no tagged readings at all there is nothing to compare —
  // return empty so the pair sits in the counting state, not a fake n.
  if (!pairs.some((p) => p.x === 1)) return [];
  return pairs.sort((a, b) => a.day.localeCompare(b.day));
}
