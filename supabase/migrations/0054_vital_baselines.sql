-- 0054 — vital_baselines: one server-computed row per person per vital.
--
-- D13 §4.1–§4.3 (PR-1, closes audit D12 P0-2 / P0-3). The audit found
-- two incompatible baselines: the client displayed a 30-day p10–p90
-- band while the server judged against a 14-day mean ± 2σ — so the band
-- a user saw and the band their reading was judged against were
-- different numbers over different windows. Both now come from this
-- table: one row per (subject, vital, context), 28-day window, carrying
-- BOTH the display band (p10/p90) and the classification band
-- (mean/sd), computed together from the same readings by the nightly
-- cron (detect-anomaly in cron mode, migration 0018).
--
--   is_sufficient — computed at write time from the D13 §4.3 thresholds
--     (classification column). It is the ONLY field the client consults
--     before showing a coloured verdict; below threshold every surface
--     renders the learning state.
--   context_tag — context-conditioned variants (BP only, D13 decisions
--     log #2); null context = all readings. Rows appear once a tag has
--     ≥ 8 readings in the window.
--
-- bp_baselines becomes a compatibility view over this table so the
-- deployed detect-anomaly single-reading path keeps reading the old
-- shape. hr_baselines (0016) is write-only today — nothing reads it —
-- and is left in place, deprecated; removal is a later cleanup.
--
-- Sourced from:
--   docs/D13_Leiko_Vitals_Layer_Implementation_Spec.md §4.2, §4.3
--   supabase/migrations/0016_anomaly_engine.sql (RLS idiom)

-- 1. Enum + table ---------------------------------------------------------

create type public.baseline_vital as enum
  ('bp_systolic','bp_diastolic','resting_hr','spo2','sleep_duration','steps_daily');

create table public.vital_baselines (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families(id) on delete cascade,
  subject_id     uuid not null references public.users(id) on delete cascade,
  vital          public.baseline_vital not null,
  window_days    smallint not null default 28,
  sample_count   integer not null,
  mean_value     numeric not null,
  sd_value       numeric not null,
  p10_value      numeric not null,
  p90_value      numeric not null,
  -- context-conditioned variants; null context = all readings
  context_tag    text,
  is_sufficient  boolean not null,
  computed_at    timestamptz not null default now()
);

create unique index vital_baselines_key
  on public.vital_baselines (subject_id, vital, coalesce(context_tag, ''));
create index vital_baselines_family on public.vital_baselines (family_id, vital);

-- 2. RLS (0016 idiom: members read, service writes) -----------------------

alter table public.vital_baselines enable row level security;

create policy "members read vital baselines" on public.vital_baselines
  for select using (public.is_family_member(family_id));
create policy "service writes vital baselines" on public.vital_baselines
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- 3. bp_baselines → compatibility view ------------------------------------
--
-- No backfill: old rows carry no p10/p90 and inventing percentiles from
-- mean ± kσ would fabricate a band we never measured. The first nightly
-- cron run repopulates every active subject (release runbook: invoke
-- the cron once right after deploy rather than waiting for 03:00 UTC).
--
-- Column derivations, pinned to the view's one consumer
-- (detect-anomaly's single-reading path):
--   days_of_data — consumed only as the `daysOfData < 14` maturity
--     gate. is_sufficient → 28 / 0 preserves that gate exactly; any
--     future reader wanting real day counts must use vital_baselines.
--   pulse_mean / sigma_pulse — null. Pulse has no baseline_vital row:
--     resting HR is its own vital with its own band. detect-anomaly's
--     pulse-outlier branch is disabled when sigma is null (same PR).

drop table public.bp_baselines;

create view public.bp_baselines
  with (security_invoker = true) as
select
  s.subject_id                                              as user_id,
  s.family_id,
  s.mean_value                                              as sys_mean,
  d.mean_value                                              as dia_mean,
  null::numeric                                             as pulse_mean,
  s.sd_value                                                as sigma_sys,
  d.sd_value                                                as sigma_dia,
  null::numeric                                             as sigma_pulse,
  (case when s.is_sufficient then 28 else 0 end)::smallint  as days_of_data,
  s.sample_count::smallint                                  as reading_count,
  s.computed_at,
  s.computed_at                                             as updated_at
from public.vital_baselines s
join public.vital_baselines d
  on d.subject_id = s.subject_id
 and d.vital = 'bp_diastolic'
 and d.context_tag is null
where s.vital = 'bp_systolic'
  and s.context_tag is null;

comment on view public.bp_baselines is
  'Compatibility shim over vital_baselines (0054). Read-only; the nightly '
  'cron writes vital_baselines directly. Deprecated — new code reads '
  'vital_baselines.';

comment on table public.hr_baselines is
  'Deprecated (0054): superseded by vital_baselines (vital = resting_hr). '
  'Write-only today; removal is a later cleanup.';
