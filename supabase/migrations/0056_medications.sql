-- 0056 — the medication log (D13 §4.5 remainder, PR-11).
--
-- "What you take and when" — never treatment, adherence, compliance or
-- dosing. It records that something was taken; it never advises, never
-- reminds in a scolding register, and never reports a missed dose as a
-- failure (§4.5 language constraint; copy in §7.6).
--
-- RLS: caregivers with an active family membership may read; only the
-- subject or an owner-role caregiver may write. Labels are free text
-- and are EXCLUDED from any AI prompt payload that leaves the device
-- unless the user opts in (§9.3) — the client sends a boolean
-- (medication_logged_today) instead.

create table public.medications (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  subject_id   uuid not null references public.users(id) on delete cascade,
  label        text not null check (length(label) <= 80),
  schedule     jsonb not null,          -- { times: ['08:00'], days: [1..7] }
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.medication_events (
  id             uuid primary key default gen_random_uuid(),
  medication_id  uuid not null references public.medications(id) on delete cascade,
  subject_id     uuid not null references public.users(id) on delete cascade,
  taken_at       timestamptz not null,
  logged_by      uuid not null references public.users(id) on delete restrict,
  created_at     timestamptz not null default now()
);
create index medication_events_subject_time
  on public.medication_events (subject_id, taken_at desc);
create index medications_family on public.medications (family_id, active);

alter table public.medications enable row level security;
alter table public.medication_events enable row level security;

create policy "members read medications" on public.medications
  for select using (public.is_family_member(family_id));
create policy "subject or owner writes medications" on public.medications
  for all using (
    auth.uid() = subject_id
    or exists (
      select 1 from public.family_members fm
      where fm.family_id = medications.family_id
        and fm.user_id = auth.uid()
        and fm.role = 'family_owner'
        and fm.removed_at is null
    )
  ) with check (
    auth.uid() = subject_id
    or exists (
      select 1 from public.family_members fm
      where fm.family_id = medications.family_id
        and fm.user_id = auth.uid()
        and fm.role = 'family_owner'
        and fm.removed_at is null
    )
  );

create policy "members read medication events" on public.medication_events
  for select using (
    exists (
      select 1 from public.medications m
      where m.id = medication_events.medication_id
        and public.is_family_member(m.family_id)
    )
  );
create policy "subject or owner writes medication events" on public.medication_events
  for insert with check (
    auth.uid() = subject_id
    or exists (
      select 1 from public.medications m
      join public.family_members fm on fm.family_id = m.family_id
      where m.id = medication_events.medication_id
        and fm.user_id = auth.uid()
        and fm.role = 'family_owner'
        and fm.removed_at is null
    )
  );
