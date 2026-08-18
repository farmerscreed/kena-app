// Hand-written subset of the public schema we actually query from the app.
// The full generated `Database` type lands when we wire `supabase gen types
// typescript` in a later sprint; until then we type-check just what code
// touches today.
//
// Source of truth: supabase/migrations/0001_initial.sql, updated by
// 0002_account_type_immutable.sql.

// Type aliases (not `interface`) so the Row / Insert / Update shapes
// structurally satisfy postgrest-js's GenericSchema constraint
// (Record<string, unknown>). Interfaces don't carry an implicit
// index signature, so the schema defaults to `any` and `update()` /
// `rpc()` resolve to `never` — see node_modules/@supabase/postgrest-js
// for the GenericTable definition.

export type AccountType = 'caregiver' | 'parent' | 'self_buyer';

export type FamilyRole = 'family_owner' | 'caregiver' | 'parent_owner' | 'parent_viewer';

export type SubscriptionStatus =
  | 'free'
  | 'plus'
  | 'plus_trial'
  | 'plus_grace'
  | 'past_due';

// Sprint 10b.1 (migration 0008): optional profile demographics that
// feed Settings → Profile and the BLE setUserParams writer (per
// memory/multi_vitals_gap.md "setUserParams + setGoals stubbed").
export type Gender = 'female' | 'male' | 'nonbinary' | 'prefer_not_say';

// D8a §10.1 — self-buyer-only Profile chip; optional in onboarding,
// editable in Settings. Caregiver / parent rows leave this null.
export type HypertensionStatus = 'yes' | 'no' | 'prefer_not_say';

export type UserRow = {
  id: string;
  email: string | null;
  display_name: string;
  photo_url: string | null;
  preferred_language: string;
  timezone: string;
  year_of_birth: number | null;
  account_type: AccountType;
  marketing_opt_in: boolean;
  // Sprint 10b.1 demographics (nullable).
  gender: Gender | null;
  height_cm: number | null;
  weight_kg: number | null;
  hypertension_status: HypertensionStatus | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserUpdate = {
  display_name?: string;
  photo_url?: string | null;
  preferred_language?: string;
  timezone?: string;
  year_of_birth?: number | null;
  marketing_opt_in?: boolean;
  gender?: Gender | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  hypertension_status?: HypertensionStatus | null;
};

export type FamilyRow = {
  id: string;
  parent_user_id: string | null;
  parent_display_name: string;
  parent_relationship: string;
  parent_year_of_birth: number | null;
  parent_residence: string | null;
  subscription_status: SubscriptionStatus;
  subscription_renewal_date: string | null;
  created_by: string;
  // Sprint 15 — per-family anomaly sensitivity multiplier (migration 0016).
  anomaly_sensitivity: number;
  created_at: string;
  updated_at: string;
};

// Sprint 15 — push notification token row (migration 0001 + Sprint 15 use).
export type PushTokenRow = {
  user_id: string;
  device_id: string;
  expo_token: string;
  apns_token: string | null;
  fcm_token: string | null;
  platform: 'ios' | 'android' | 'web';
  app_version: string | null;
  os_version: string | null;
  last_seen_at: string;
};

// Sprint 15 — anomaly_events row (migration 0016).
export type AnomalyVitalKind = 'bp' | 'hr' | 'spo2';
export type AnomalyTierLabel = 'calm_concerned' | 'confirmed_urgent';
export type AnomalyPushOutcome =
  | 'sent'
  | 'suppressed_quiet_hours'
  | 'suppressed_opt_out'
  | 'suppressed_dedup'
  | 'suppressed_rate_limit'
  | 'failed';
export type AnomalyEventRow = {
  id: string;
  user_id: string;
  family_id: string;
  vital_kind: AnomalyVitalKind;
  tier: AnomalyTierLabel;
  reason: string;
  reading_id: string | null;
  vital_row_id: string | null;
  triggered_at: string;
  push_sent_at: string | null;
  push_outcome: AnomalyPushOutcome | null;
  push_dispatch_attempts: number;
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
  feedback_thumb: -1 | 0 | 1;
  feedback_by_user_id: string | null;
  feedback_at: string | null;
  created_at: string;
};

// Sprint 15 — bp_baselines + hr_baselines (migration 0016).
export type BpBaselineRow = {
  user_id: string;
  family_id: string;
  sys_mean: number;
  dia_mean: number;
  pulse_mean: number | null;
  sigma_sys: number;
  sigma_dia: number;
  sigma_pulse: number | null;
  days_of_data: number;
  reading_count: number;
  computed_at: string;
  updated_at: string;
};

export type HrBaselineRow = {
  user_id: string;
  family_id: string;
  median_bpm: number;
  days_of_data: number;
  sample_count: number;
  computed_at: string;
  updated_at: string;
};

// Sprint 10b.3 — notification_preferences row (migration 0009).
// Sprint 15 — extended with per-vital anomaly toggles (migration 0017).
export type NotificationPreferencesRow = {
  user_id: string;
  daily_summary: boolean;
  weekly_summary: boolean;
  anomaly_notifications: boolean;
  anomaly_bp: boolean;
  anomaly_hr: boolean;
  anomaly_spo2: boolean;
  watch_status: boolean;
  family_activity: boolean;
  subscription_account: boolean;
  marketing: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  anomaly_bypass_quiet: boolean;
  medication_bypass_quiet: boolean;
  updated_at: string;
};

// Sprint 10c.2 — per-vital caregiver visibility map (D13 §13.2).
// null = use defaults (BP/HR/SpO2/Activity = visible, Sleep = hidden).
export interface VitalVisibility {
  bp: boolean;
  hr: boolean;
  spo2: boolean;
  sleep: boolean;
  activity: boolean;
}

export type FamilyMemberRow = {
  family_id: string;
  user_id: string;
  role: FamilyRole;
  invited_by: string | null;
  joined_at: string;
  removed_at: string | null;
  removed_reason: string | null;
  vital_visibility: VitalVisibility | null;
  /** Sprint 19 Block 5 — per-caregiver label for the wearer.
   *  Optional; when null the display layer falls back to
   *  families.parent_relationship via formatRelation. Same encoding
   *  convention as parent_relationship ('mother' | 'son' |
   *  'other:<label>' | …). */
  caregiver_relationship_label: string | null;
};

export type QualityScore = 'good' | 'fair' | 'suspect';

export type ReadingSource = 'watch' | 'manual' | 'clinic' | 'pharmacy' | 'other';

export type ReadingRow = {
  id: string;
  family_id: string;
  device_id: string | null;
  source: ReadingSource;
  measured_at: string;
  measured_at_local: string | null;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  quality_score: QualityScore | null;
  quality_flags: Record<string, unknown>;
  motion_detected: boolean | null;
  hidden: boolean;
  hidden_reason: string | null;
  hidden_by_user_id: string | null;
  hidden_at: string | null;
  created_at: string;
};

export type CreateFamilyArgs = {
  _parent_display_name: string;
  _parent_relationship: string;
  _caregiver_relationship: string;
};

// Vitals data-completeness fix (migration 0030). Server-side HR aggregates
// over [_from,_to] in the user's IANA timezone — backs HRDetail's
// range-driven surfaces so they are not capped by the local 200-sample
// slice. `_tz` empty/null → UTC. Type alias (not interface) per the
// postgrest GenericSchema note above so rpc() Returns resolves correctly.
export type HrRangeSummaryArgs = {
  _family_id: string;
  _tz: string;
  _from: string; // ISO timestamptz
  _to: string; // ISO timestamptz
};

export type HrRangeSummary = {
  totals: {
    n: number;
    avg_bpm: number | null;
    min_bpm: number | null;
    max_bpm: number | null;
    first_at: string | null;
    last_at: string | null;
  };
  // Zone counts (bands match HRDetail buildZones): resting <60, calm
  // 60–80, active 80–110, vigorous 110+. `total` is the windowed sample
  // count (== totals.n) for percentage math on the client.
  zones: {
    resting: number;
    calm: number;
    active: number;
    vigorous: number;
    total: number;
  };
  // Per local-day rollups, ascending by day.
  per_day: { day: string; avg: number; min: number; max: number; n: number }[];
  // Per-night resting bpm (10-min rolling-min within 22:00–06:00 local),
  // ascending by night, keyed to the "owning morning" (YYYY-MM-DD).
  resting_by_night: { night: string; resting: number }[];
};


// Trends data-completeness fix (migration 0035, ADR-0008 D4). Exact
// per-day aggregates for all five vitals over [_from, now], day-bucketed
// in the wearer's tz; per-vital visibility enforced server-side via
// can_see_vital (restricted vitals come back as empty sections).
export type TrendsSummaryArgs = {
  _family_id: string;
  _tz: string;
  _from: string; // ISO timestamptz
};

export type TrendsServerSummary = {
  bp: {
    count: number;
    avg_sys: number | null;
    avg_dia: number | null;
    per_day: { day: string; sys: number; dia: number; pulse: number | null; n: number }[];
  };
  hr: {
    count: number;
    // night_median = 22:00–06:00 local (the resting proxy); the client
    // falls back to all_median when no overnight samples exist that day.
    per_day: { day: string; night_median: number | null; all_median: number; n: number }[];
  };
  spo2: {
    count: number;
    per_day: { day: string; avg: number; min: number | null; n: number }[];
  };
  sleep: {
    count: number;
    // The FULLEST session per local night (cross-device shadow guard).
    per_night: { day: string; total: number; deep: number }[];
  };
  activity: {
    count: number;
    per_day: { day: string; steps: number }[];
  };
};

// Multi-vitals (Sprint 7.5) — table is keyed by (family_id, vital_type,
// measured_at). Sprint 7.7b is the first client-side reader; the writes
// flow through the /sync Edge Function (services/sync/postMultiVitals.ts).
//
// Encoding per docs/_reference/D13-multi-vitals-constellation-spec.md
// + supabase/functions/_shared/vital-row-mappers.ts:
//   hr            → value_int = bpm; value_jsonb = { motion_state, ... }
//   spo2          → value_int = avg %; value_int_2 = max; value_int_3 = min
//   sleep_session → value_int = totalMinutes; value_int_2 = deepMinutes;
//                   value_int_3 = lightMinutes
//   steps_day     → value_int = total_steps; value_jsonb.day_local
//   calories_day  → value_int = total_kcal; value_int_2 = activity;
//                   value_int_3 = bmr
export type VitalType = 'hr' | 'spo2' | 'sleep_session' | 'steps_day' | 'calories_day';

export type VitalsOtherRow = {
  id: string;
  family_id: string;
  device_id: string | null;
  vital_type: VitalType;
  measured_at: string;
  value_int: number | null;
  value_int_2: number | null;
  value_int_3: number | null;
  value_jsonb: Record<string, unknown> | null;
  hidden: boolean;
  hidden_reason: string | null;
  created_at: string;
};

// Cross-vital correlation engine output (Sprint 9 / D13 §9.2). One row
// per (family, user, correlation_type) per nightly compute_correlations
// run. Read-only from the client; the Edge Function is the only writer
// (RLS service_role insert policy).
export type CorrelationType =
  | 'sleep_x_morning_bp'
  | 'activity_x_resting_hr'
  | 'spo2_dip_x_sleep_score';

export type CorrelationRow = {
  id: string;
  family_id: string;
  user_id: string;
  correlation_type: CorrelationType;
  window_days: number;
  computed_at: string;
  pearson_r: number | null;
  effect_size: number | null;
  effect_unit: string | null;
  significance: number | null;
  sample_n: number | null;
  is_meaningful: boolean;
  narrative_short: string | null;
  narrative_long: string | null;
  created_at: string;
};

// Shape conforms to @supabase/postgrest-js's GenericSchema constraint
// (Tables / Views / Functions, with Relationships on each table). Without
// Views + Relationships the postgrest-js client falls back to `any`-typed
// builders, and `update()` resolves to `never` instead of the row's
// Update type. See node_modules/@supabase/postgrest-js/src/types/common/common.ts.
export type Database = {
  public: {
    Tables: {
      users: {
        Row: UserRow;
        Insert: UserRow;
        Update: UserUpdate;
        Relationships: [];
      };
      families: {
        Row: FamilyRow;
        // Inserts go through the create_family RPC (SECURITY DEFINER);
        // RLS forbids direct client inserts.
        Insert: FamilyRow;
        Update: Partial<FamilyRow>;
        Relationships: [];
      };
      family_members: {
        Row: FamilyMemberRow;
        Insert: FamilyMemberRow;
        Update: Partial<FamilyMemberRow>;
        Relationships: [];
      };
      readings: {
        Row: ReadingRow;
        Insert: Omit<ReadingRow, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<ReadingRow>;
        Relationships: [];
      };
      vitals_other: {
        Row: VitalsOtherRow;
        // Inserts go through the /sync Edge Function (service_role). RLS
        // forbids direct client inserts; this Insert type exists only so
        // the postgrest-js builder typecheck doesn't fall back to never.
        Insert: Omit<VitalsOtherRow, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<VitalsOtherRow>;
        Relationships: [];
      };
      correlations: {
        Row: CorrelationRow;
        // Inserts go through the compute-correlations Edge Function
        // (service_role). RLS allows only members to read; the Insert
        // type exists for the postgrest-js builder typecheck.
        Insert: Omit<CorrelationRow, 'id' | 'created_at' | 'computed_at'> & {
          id?: string;
          created_at?: string;
          computed_at?: string;
        };
        Update: Partial<CorrelationRow>;
        Relationships: [];
      };
      notification_preferences: {
        Row: NotificationPreferencesRow;
        Insert: Omit<NotificationPreferencesRow, 'updated_at'> & {
          updated_at?: string;
        };
        Update: Partial<NotificationPreferencesRow>;
        Relationships: [];
      };
      // Sprint 15 — push notification token + anomaly engine tables.
      push_tokens: {
        Row: PushTokenRow;
        Insert: Omit<PushTokenRow, 'last_seen_at'> & {
          last_seen_at?: string;
        };
        Update: Partial<PushTokenRow>;
        Relationships: [];
      };
      anomaly_events: {
        Row: AnomalyEventRow;
        Insert: Omit<
          AnomalyEventRow,
          | 'id'
          | 'triggered_at'
          | 'created_at'
          | 'push_dispatch_attempts'
          | 'feedback_thumb'
        > & {
          id?: string;
          triggered_at?: string;
          created_at?: string;
          push_dispatch_attempts?: number;
          feedback_thumb?: -1 | 0 | 1;
        };
        Update: Partial<AnomalyEventRow>;
        Relationships: [];
      };
      bp_baselines: {
        Row: BpBaselineRow;
        Insert: BpBaselineRow;
        Update: Partial<BpBaselineRow>;
        Relationships: [];
      };
      // D13 PR-1/PR-11 — the truth layer + the medication log.
      vital_baselines: {
        Row: VitalBaselineDbRow;
        Insert: VitalBaselineDbRow;
        Update: Partial<VitalBaselineDbRow>;
        Relationships: [];
      };
      medications: {
        Row: MedicationDbRow;
        Insert: Omit<MedicationDbRow, 'id' | 'created_at' | 'active'> &
          Partial<Pick<MedicationDbRow, 'id' | 'created_at' | 'active'>>;
        Update: Partial<MedicationDbRow>;
        Relationships: [];
      };
      medication_events: {
        Row: MedicationEventDbRow;
        Insert: Omit<MedicationEventDbRow, 'id' | 'created_at'> &
          Partial<Pick<MedicationEventDbRow, 'id' | 'created_at'>>;
        Update: Partial<MedicationEventDbRow>;
        Relationships: [];
      };
      hr_baselines: {
        Row: HrBaselineRow;
        Insert: HrBaselineRow;
        Update: Partial<HrBaselineRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_family: {
        Args: CreateFamilyArgs;
        Returns: { family_id: string }[];
      };
      hr_range_summary: {
        Args: HrRangeSummaryArgs;
        Returns: HrRangeSummary;
      };
      trends_summary: {
        Args: TrendsSummaryArgs;
        Returns: TrendsServerSummary;
      };
    };
  };
};


// D13 PR-1 — one truth-layer row per (subject, vital, context).
export type VitalBaselineDbRow = {
  id?: string;
  family_id: string;
  subject_id: string;
  vital: string;
  window_days: number;
  sample_count: number;
  mean_value: number | string;
  sd_value: number | string;
  p10_value: number | string;
  p90_value: number | string;
  context_tag: string | null;
  is_sufficient: boolean;
  computed_at: string;
}

// D13 PR-11 — the medication log (§4.5).
export type MedicationDbRow = {
  id: string;
  family_id: string;
  subject_id: string;
  label: string;
  schedule: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export type MedicationEventDbRow = {
  id: string;
  medication_id: string;
  subject_id: string;
  taken_at: string;
  logged_by: string;
  created_at: string;
}
