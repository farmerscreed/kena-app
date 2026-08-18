// Sprint 7 — caregiver-home data fetch.
//
// "One ReadingCard per parent" per docs/04-screens/caregiver-home.md.
// In data terms: one ParentSummary per family the signed-in user is
// an active member of. Each summary carries the parent's display
// name + relationship (the families row) and the most recent few
// readings (powering the latest-numeric + 7-day sparkline).
//
// Pure async function — takes a SupabaseClient so it's mockable in
// tests. The React hook in hooks/useFamilyReadings.ts wraps this in
// TanStack Query + a Realtime subscription.
//
// Per docs/01-data-model.md the readings table is family-scoped, not
// user-scoped (parent's reading row joins to family_id, never
// user_id). Membership decides who can read it via RLS; the query
// itself doesn't need to filter by user_id.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  seedVitalBaselines,
  type VitalBaselineServerRow,
} from '../../utils/vitalBaselines';
import type { Database, FamilyRole, VitalType } from '../../types/database';

const PER_PARENT_READING_LIMIT = 14; // ~2 weeks of once-daily; powers 7-day sparkline + buffer
const MULTI_VITAL_LOOKBACK_DAYS = 7; // window for HR / SpO2 / sleep latest-per-vital

export interface ReadingSummary {
  id: string;
  measuredAt: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  qualityScore: 'good' | 'fair' | 'suspect' | null;
}

/** HR latest sample summary — Sprint 7.7b cross-phone read. */
export interface HrSummary {
  measuredAt: string;
  bpm: number;
}

/** SpO2 latest sample summary — Sprint 7.7b cross-phone read. */
export interface Spo2Summary {
  measuredAt: string;
  /** Average percent across the sample window (0-100). */
  percent: number;
}

/** Sleep last-night summary — Sprint 7.7b cross-phone read. */
export interface SleepSummary {
  /** Session-end timestamp (used as the "freshness" anchor). */
  measuredAt: string;
  /** Total session minutes. */
  totalMinutes: number;
  /** Deep-sleep minutes within the session, when reported by the watch. */
  deepMinutes: number | null;
  /** Light-sleep minutes within the session. */
  lightMinutes: number | null;
}

export interface ParentSummary {
  familyId: string;
  parentDisplayName: string;
  parentRelationship: string;
  parentYearOfBirth: number | null;
  /** Sprint 19 — the viewer's role inside THIS family. Sourced from
   *  the same family_members row the membership query already returns.
   *  Drives the "+ Add someone" gate and any owner-only CTA. */
  viewerRole: FamilyRole;
  /** Sprint 19 Block 5 — per-caregiver label for the wearer. When
   *  present, display layers MUST prefer this over `parentRelationship`.
   *  Empty / null means "fall back to families.parent_relationship via
   *  formatRelation()". */
  caregiverRelationshipLabel: string | null;
  /** Most recent BP reading; null if none yet. */
  latestReading: ReadingSummary | null;
  /** Newest-first; up to PER_PARENT_READING_LIMIT entries. Drives the sparkline. */
  recentReadings: ReadingSummary[];
  /** Latest HR sample within MULTI_VITAL_LOOKBACK_DAYS; null if none. */
  latestHr: HrSummary | null;
  /** Latest SpO2 sample within the lookback window; null if none. */
  latestSpo2: Spo2Summary | null;
  /** Latest sleep session within the lookback window; null if none. */
  latestSleep: SleepSummary | null;
}

export async function fetchParentSummaries(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<ParentSummary[]> {
  // family_members is the membership join. We fetch the user's active
  // memberships, then for each family pull the parent profile from
  // families and the most-recent N readings. Two round trips total
  // (one for memberships+families, one for readings); a single nested
  // select is also possible but the readings ordering + limit applied
  // per-family is more reliably expressed with two queries.
  const { data: memberships, error: memberErr } = await client
    .from('family_members')
    .select(
      `family_id,
       role,
       caregiver_relationship_label,
       families!inner(id, parent_display_name, parent_relationship, parent_year_of_birth)`,
    )
    .eq('user_id', userId)
    .is('removed_at', null);

  if (memberErr) throw memberErr;
  if (!memberships || memberships.length === 0) return [];

  const familyIds = memberships.map((m) => m.family_id);

  // D13 PR-1 — refresh each parent's truth-layer rows into the shared
  // cache so the synchronous status derivation (utils/caregiverPerson)
  // judges against the server band. One query for all families;
  // failure is non-fatal (the resolver's provisional fallback covers).
  const { data: baselineRows, error: baselineErr } = await client
    .from('vital_baselines')
    .select(
      'family_id, vital, window_days, sample_count, mean_value, sd_value, p10_value, p90_value, context_tag, is_sufficient, computed_at',
    )
    .in('family_id', familyIds);
  if (!baselineErr && baselineRows) {
    for (const familyId of familyIds) {
      seedVitalBaselines(
        familyId,
        (baselineRows as Array<VitalBaselineServerRow & { family_id: string }>).filter(
          (r) => r.family_id === familyId,
        ),
      );
    }
  }

  const { data: readingRows, error: readingsErr } = await client
    .from('readings')
    .select('id, family_id, measured_at, systolic, diastolic, pulse, quality_score')
    .in('family_id', familyIds)
    .eq('hidden', false)
    .order('measured_at', { ascending: false });

  if (readingsErr) throw readingsErr;

  const readingsByFamily = new Map<string, ReadingSummary[]>();
  for (const r of readingRows ?? []) {
    const list = readingsByFamily.get(r.family_id) ?? [];
    if (list.length < PER_PARENT_READING_LIMIT) {
      list.push({
        id: r.id,
        measuredAt: r.measured_at,
        systolic: r.systolic,
        diastolic: r.diastolic,
        pulse: r.pulse,
        qualityScore: r.quality_score,
      });
      readingsByFamily.set(r.family_id, list);
    }
  }

  // Multi-vitals — Sprint 7.7b. Fetch hr / spo2 / sleep_session within
  // the lookback window for all families, then keep the latest row per
  // (family_id, vital_type). Postgres `DISTINCT ON` would express this
  // server-side but isn't exposed by the supabase-js builder; the
  // post-fetch dedupe is fine for v1 (3 families × 3 vital types × ~7d
  // of data = small).
  const lookbackCutoffIso = new Date(
    Date.now() - MULTI_VITAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const trackedVitalTypes: VitalType[] = ['hr', 'spo2', 'sleep_session'];
  const { data: vitalsRows, error: vitalsErr } = await client
    .from('vitals_other')
    .select(
      'id, family_id, vital_type, measured_at, value_int, value_int_2, value_int_3',
    )
    .in('family_id', familyIds)
    .in('vital_type', trackedVitalTypes)
    .eq('hidden', false)
    .gte('measured_at', lookbackCutoffIso)
    .order('measured_at', { ascending: false });

  if (vitalsErr) throw vitalsErr;

  // Group by (family_id, vital_type) keeping the first (latest) row.
  type LatestVitalsForFamily = {
    hr: HrSummary | null;
    spo2: Spo2Summary | null;
    sleep_session: SleepSummary | null;
  };
  const vitalsByFamily = new Map<string, LatestVitalsForFamily>();
  for (const row of vitalsRows ?? []) {
    let bucket = vitalsByFamily.get(row.family_id);
    if (!bucket) {
      bucket = { hr: null, spo2: null, sleep_session: null };
      vitalsByFamily.set(row.family_id, bucket);
    }
    if (row.vital_type === 'hr' && bucket.hr === null && row.value_int !== null) {
      bucket.hr = { measuredAt: row.measured_at, bpm: row.value_int };
    } else if (
      row.vital_type === 'spo2' &&
      bucket.spo2 === null &&
      row.value_int !== null
    ) {
      bucket.spo2 = { measuredAt: row.measured_at, percent: row.value_int };
    } else if (
      row.vital_type === 'sleep_session' &&
      bucket.sleep_session === null &&
      row.value_int !== null
    ) {
      bucket.sleep_session = {
        measuredAt: row.measured_at,
        totalMinutes: row.value_int,
        deepMinutes: row.value_int_2,
        lightMinutes: row.value_int_3,
      };
    }
  }

  const summaries: ParentSummary[] = memberships.map((m) => {
    // Supabase types `families` as a single object via the !inner join,
    // but the runtime can return an array shape if the inferred shape
    // chooses array. Normalise.
    const fam = Array.isArray(m.families) ? m.families[0] : m.families;
    const recent = readingsByFamily.get(m.family_id) ?? [];
    const vitals = vitalsByFamily.get(m.family_id) ?? {
      hr: null,
      spo2: null,
      sleep_session: null,
    };
    const rawLabel = (m as { caregiver_relationship_label?: unknown }).caregiver_relationship_label;
    return {
      familyId: m.family_id,
      parentDisplayName: fam?.parent_display_name ?? '',
      parentRelationship: fam?.parent_relationship ?? '',
      parentYearOfBirth: fam?.parent_year_of_birth ?? null,
      viewerRole: (m.role ?? 'caregiver') as FamilyRole,
      caregiverRelationshipLabel:
        typeof rawLabel === 'string' && rawLabel.trim().length > 0
          ? rawLabel
          : null,
      latestReading: recent[0] ?? null,
      recentReadings: recent,
      latestHr: vitals.hr,
      latestSpo2: vitals.spo2,
      latestSleep: vitals.sleep_session,
    };
  });

  // Most-active parents first (latest reading at top); parents without
  // any readings sink to the bottom so the empty-readings card doesn't
  // dominate above an active one.
  summaries.sort((a, b) => {
    const aMs = a.latestReading ? Date.parse(a.latestReading.measuredAt) : 0;
    const bMs = b.latestReading ? Date.parse(b.latestReading.measuredAt) : 0;
    return bMs - aMs;
  });

  return summaries;
}
