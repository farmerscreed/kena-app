# 01 — Data Model

Canonical from D7 §3. Every Supabase table, RLS policy, soft-delete rule. Schemas are the source of truth — when this file diverges from `supabase/migrations/`, the migration is the bug. The full DDL is reproduced in `supabase/migrations/0001_initial.sql`.

---

## Entity map

```
auth.users (Supabase managed)
        │ one-to-one
        ▼
public.users  ─────────────┐
   │                       │ created_by
   │  belongs to (M:N)     ▼
   ├──► public.family_members  ──── role  ───────┐
   │       │                                     │
   │       └──► public.families ◄── parent ──────┘
   │              │
   │              ├──► public.devices ──► public.readings ──► public.reading_notes
   │              │                                       └──► public.reading_comments
   │              ├──► public.subscriptions
   │              └──► public.invitations
   │
   ├──► public.ai_conversations ──► public.ai_messages
   └──► public.audit_log
```

---

## Tables

### users
Public-schema profile mirroring `auth.users`. Created on first sign-in via a Postgres trigger.

```sql
create table public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  display_name    text not null,
  photo_url       text,
  preferred_language text not null default 'en',
  timezone        text not null,                       -- IANA, e.g. 'America/New_York'
  year_of_birth   smallint check (year_of_birth between 1900 and 2100),
  account_type    text not null check (account_type in ('caregiver','parent','self_buyer')),
  marketing_opt_in boolean not null default false,
  deleted_at      timestamptz,                          -- soft delete; 30-day grace
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index users_email_idx  on public.users (lower(email)) where deleted_at is null;
create index users_active_idx on public.users (id) where deleted_at is null;
```

**`account_type` is `NOT NULL` and immutable, but as of [ADR-0006](_adr/0006-unified-caregiver-self-buyer-model.md) it is INERT** — retained for existing-row compatibility and analytics history, but it **no longer selects the navigation tree or home screen**. Every new user is onboarded as `self_buyer`. The column is kept, not dropped; the intent is "inert," not "deleted." (The pre-ADR-0006 immutability semantics — "switch = new account, support intervention" — are obsolete: a self-buyer who later cares for someone simply adds them via the Connect invite, with no `account_type` change.)

### Hybrid mode (D8a §1.3) — superseded by ADR-0006
> **RECONCILED 2026-06-02.** The "two parallel root stacks selected by
> `account_type`" design below is **no longer how the app works.** Per
> ADR-0006, the self-buyer and caregiver homes converged into **one
> unified constellation route** where the viewer is a "You" node; the
> runtime does **not** branch the screen tree on `account_type`. The
> data-level mechanics in this section remain accurate (a user who is
> followed gains `family_members` rows with `role = 'caregiver'` on their
> circle; one wearer per circle is a hard invariant). What's obsolete is
> only the *navigation-branching* claim. The original text is kept below
> for history.

A self-buyer who later invites family caregivers does **NOT** become `account_type = 'caregiver'`. They remain `account_type = 'self_buyer'`. The change is at the family level: the family record gains additional `family_members` rows with `role = 'caregiver'`. The self-buyer's own UI continues to show "Your readings"; the invited caregivers see a Family Circle with one member (the self-buyer-now-watched). Each user sees the metaphor that fits their role.

Engineering implication (pre-ADR-0006, obsolete): the runtime selected the screen tree by the viewer's `account_type`, not by family composition — two parallel React Navigation root stacks (caregiver per D8, self-buyer per D8a). **This branching was removed by ADR-0006; both personas now render the one constellation home.**

### families
A family circle — one wearer (`parent_owner`) and 0..N caregivers. The `created_by` user becomes the `family_owner`.

```sql
create table public.families (
  id                  uuid primary key default gen_random_uuid(),
  parent_user_id      uuid references public.users(id) on delete restrict,
  parent_display_name text not null,                  -- 'Mom', 'Mama Linda', 'Dad'
  parent_relationship text not null,                  -- 'mother','father','aunt','other:godmother'
  parent_year_of_birth smallint,
  parent_residence    text,                           -- 'Lagos, Nigeria'
  subscription_status text not null default 'free'
    check (subscription_status in ('free','plus','plus_trial','plus_grace','past_due')),
  subscription_renewal_date timestamptz,
  created_by          uuid not null references public.users(id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index families_created_by_idx  on public.families (created_by);
create index families_parent_user_idx on public.families (parent_user_id);
```

### family_members
Membership table. Joins users to families with a role.

For a **self-buyer** family, a single row exists where the user is BOTH `family_owner` AND `parent_owner` (D8a §4 data-model implication). RLS resolves at the membership level, not the user level, so this is supported without new policies. In hybrid mode, additional `caregiver` rows are added to that family.

```sql
create type public.family_role as enum ('family_owner','caregiver','parent_owner','parent_viewer');

create table public.family_members (
  family_id     uuid not null references public.families(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  role          public.family_role not null,
  invited_by    uuid references public.users(id) on delete set null,
  joined_at     timestamptz not null default now(),
  removed_at    timestamptz,                          -- soft removal
  removed_reason text,
  primary key (family_id, user_id)
);
create index family_members_user_idx on public.family_members (user_id) where removed_at is null;

-- exactly one family_owner per family
create unique index family_members_one_owner
  on public.family_members (family_id) where role = 'family_owner' and removed_at is null;

-- exactly one parent_owner per family
create unique index family_members_one_parent_owner
  on public.family_members (family_id) where role = 'parent_owner' and removed_at is null;
```

### devices
```sql
create table public.devices (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references public.families(id) on delete restrict,
  serial_number       text not null unique,           -- last-4-of-MAC visible to user
  mac_address         text not null,
  model               text not null check (model in ('U16H','U19M')),
  firmware_version    text,
  paired_at           timestamptz not null default now(),
  paired_by_user_id   uuid not null references public.users(id),
  unpaired_at         timestamptz,                    -- soft unbind
  last_sync_at        timestamptz,
  last_battery_pct    smallint check (last_battery_pct between 0 and 100),
  created_at          timestamptz not null default now()
);
create index devices_family_idx on public.devices (family_id) where unpaired_at is null;
create unique index devices_active_mac on public.devices (mac_address) where unpaired_at is null;
```

### readings
Core data table. **NEVER hard-deleted** for `source = 'watch'`. Soft delete via `hidden` + `hidden_reason`.

```sql
create type public.reading_source as enum ('watch','manual','clinic','pharmacy','other');
create type public.quality_score  as enum ('good','fair','suspect');
create type public.hidden_reason  as enum (
  'cuff_slipped','measured_someone_else','duplicate_reading',
  'parent_request','caregiver_correction','other'
);

create table public.readings (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references public.families(id) on delete restrict,
  device_id           uuid references public.devices(id) on delete set null,
  source              public.reading_source not null default 'watch',
  measured_at         timestamptz not null,           -- the measurement instant, stored UTC
  measured_at_local   text,                           -- ALWAYS NULL since migration 0033 (ADR-0008):
                                                      -- it used to mirror UTC under a "local" name
                                                      -- (wrong data). Localisation happens app-side
                                                      -- from measured_at + users.timezone.
  systolic            smallint not null check (systolic between 30 and 300),
  diastolic           smallint not null check (diastolic between 20 and 200),
  pulse               smallint check (pulse between 30 and 240),
  quality_score       public.quality_score,
  quality_flags       jsonb not null default '{}',     -- raw bits from BLE 0x14
  motion_detected     boolean,
  hidden              boolean not null default false,
  hidden_reason       public.hidden_reason,
  hidden_by_user_id   uuid references public.users(id),
  hidden_at           timestamptz,
  created_at          timestamptz not null default now()
);

-- DEVICE-INDEPENDENT identity since migration 0031 (ADR-0008): a BP reading
-- is the measurement — (family_id, measured_at) — not the watch that sent
-- it. The original (device_id, measured_at) key let a re-paired second
-- watch re-import the whole history as "new" rows (51 duplicates in prod).
create unique index readings_dedupe on public.readings (family_id, measured_at);
create index readings_family_time on public.readings (family_id, measured_at desc);
create index readings_visible      on public.readings (family_id, measured_at desc) where hidden = false;
-- baseline-eligibility for the anomaly engine
create index readings_for_baseline on public.readings (family_id, measured_at)
  where hidden = false and source = 'watch' and quality_score in ('good','fair');
```

### reading_notes / reading_comments

**Self-buyer / hybrid-mode privacy boundary** (D8a §7.3 + §10.4): `reading_notes` carries a `visibility` field so the self-buyer can keep "My notes" private even after inviting caregivers. RLS enforces:
- `visibility = 'private'` rows: SELECT only by `author_id = auth.uid()`.
- `visibility = 'family'` rows: SELECT by any family_member.

In caregiver mode, all notes are `visibility = 'family'` by default.

```sql
create type public.note_visibility as enum ('private','family');

create table public.reading_notes (
  id            uuid primary key default gen_random_uuid(),
  reading_id    uuid not null references public.readings(id) on delete cascade,
  family_id     uuid not null references public.families(id) on delete cascade,
  author_id     uuid not null references public.users(id) on delete restrict,
  body          text not null check (length(body) <= 500),
  visibility    public.note_visibility not null default 'family',
  created_at    timestamptz not null default now()
);

create table public.reading_comments (
  id            uuid primary key default gen_random_uuid(),
  reading_id    uuid not null references public.readings(id) on delete cascade,
  family_id     uuid not null references public.families(id) on delete cascade,
  author_id     uuid not null references public.users(id) on delete restrict,
  body          text not null check (length(body) <= 280),
  emoji         text check (length(emoji) <= 8),
  created_at    timestamptz not null default now()
);
```

### vitals_other (HR, SpO2, sleep, steps)
```sql
create type public.vital_type as enum ('hr','spo2','sleep_session','steps_day','calories_day');

create table public.vitals_other (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete restrict,
  device_id     uuid references public.devices(id),
  vital_type    public.vital_type not null,
  measured_at   timestamptz not null,                -- sleep_session: the session END since
                                                     -- migration 0032 (ADR-0008, supersedes D13
                                                     -- §2.4 "= start"). The watch reports no real
                                                     -- bed/wake; end is the synthesized ~08:00
                                                     -- wake — a CONSTANT per-night identity key,
                                                     -- never displayed as a real time. Real
                                                     -- start/end epochs live in value_jsonb.
  value_int     integer,                             -- HR bpm; steps; calories
  value_int_2   integer,                             -- SpO2 max for sample window
  value_int_3   integer,                             -- SpO2 min, sleep deep min, etc.
  value_jsonb   jsonb,                               -- sleep stages, transitions
  hidden        boolean not null default false,
  hidden_reason text,
  created_at    timestamptz not null default now()
);
create unique index vitals_dedupe on public.vitals_other (device_id, vital_type, measured_at) where device_id is not null;
create index vitals_family_time   on public.vitals_other (family_id, vital_type, measured_at desc);
```

### external_vitals (Apple Health / Health Connect read namespace)
Read-path snapshots of values pulled from Apple HealthKit or Android Health Connect — typically weight from a connected scale, height for BMR context, blood glucose from a CGM. **Never** integrated into Leiko's anomaly engine (D13 §12.6); surfaced on Trends as a separate series so the user keeps their numbers "in one place" without us claiming clinical responsibility for the source.

```sql
create type public.external_vital_platform as enum ('apple_health','health_connect');
create type public.external_vital_type as enum ('weight','height','blood_glucose');

create table public.external_vitals (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families(id) on delete restrict,
  user_id         uuid not null references public.users(id) on delete cascade,
  source_platform public.external_vital_platform not null,
  source_origin   text not null,                -- HK sourceBundleId or HC dataOrigin.packageName
  vital_type      public.external_vital_type not null,
  measured_at     timestamptz not null,
  value_numeric   numeric not null check (value_numeric > 0),
  value_unit      text not null check (value_unit in (
                    'kg','lb','m','cm','in','mg/dL','mmol/L'
                  )),
  hidden          boolean not null default false,
  hidden_reason   text,
  hidden_by_user_id uuid references public.users(id),
  hidden_at       timestamptz,
  created_at      timestamptz not null default now()
);

create unique index external_vitals_dedupe
  on public.external_vitals (user_id, source_platform, source_origin, vital_type, measured_at);
create index external_vitals_family_time
  on public.external_vitals (family_id, user_id, vital_type, measured_at desc) where hidden = false;
```

**Write model** (Sprint 9.5 / Task 7): the device-side health-platform read path POSTs to a future `/sync-external-vitals` Edge Function which inserts via `service_role`. Clients NEVER insert directly — the "service inserts external vitals" RLS policy enforces this. Members SELECT via `is_family_member`, may soft-hide their own rows, and a BEFORE UPDATE trigger blocks any edit to physiological columns post-insert (same posture as `readings`).

**Round-trip prevention**: the client filters HK/HC samples whose `sourceBundleId` / `packageName` matches our own bundle id before POSTing — Leiko's own writes never round-trip back into `external_vitals`.

### subscriptions (denormalised RevenueCat state)
```sql
create table public.subscriptions (
  user_id              uuid primary key references public.users(id) on delete cascade,
  rc_app_user_id       text not null,
  product_id           text,                         -- com.lawonecloud.leiko.plus.monthly
  entitlement          text not null default 'plus',
  status               text not null check (status in ('active','trialing','grace','past_due','cancelled','expired')),
  trial_ends_at        timestamptz,
  current_period_end   timestamptz,
  cancelled_at         timestamptz,
  last_event_at        timestamptz not null default now(),
  raw_event            jsonb
);
```

### invitations
**Connect invites are a single-use 6-digit code** (ADR-0012, 2026-08-14):
7-day expiry, accept attempts rate-limited server-side via
`invite_accept_attempts`, **no accept-time email gate** (dropped by
ADR-0012, reversing ADR-0007 decision #2). `invitee_email` is optional
delivery metadata (Resend); `invitee_phone` and `url_token` are
vestigial — nothing reads them. Direction is resolved at accept time by
`connect-accept` from watch ownership; when neither party wears a watch
the accept is recorded in `pending_accepted_by` (consuming the code) and
the `devices_resolve_pending_connects` trigger (0051) completes the
connect when either party pairs.

```sql
create type public.invitation_kind as enum ('caregiver','parent_pairing');
-- 'caregiver' is legacy (pre-ADR-0007); all connects insert 'parent_pairing'.

create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid references public.families(id) on delete cascade,  -- nullable since 0029; sharer's watch-circle hint or resolution stamp
  invited_by      uuid not null references public.users(id),
  kind            public.invitation_kind not null,
  invitee_label   text,
  invitee_email   text,                              -- optional since ADR-0012 (delivery only)
  invitee_phone   text,                              -- never used
  pairing_code    text unique,                       -- 6-digit connect code (global unique)
  url_token       text not null unique default encode(gen_random_bytes(24),'base64'),  -- vestigial: generated, never read (ADR-0012); join links carry ?code= instead
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references public.users(id),
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  -- 0051 — pending connect (neither party wore a watch at accept time):
  pending_accepted_by         uuid references public.users(id),
  pending_accepted_at         timestamptz,
  pending_relationship_label  text
);
create index invitations_family_active
  on public.invitations (family_id) where accepted_at is null and cancelled_at is null;
-- 0029: invitations_pending_by_inviter; CHECK family_id required for kind='caregiver'.
-- 0051: invitations_pending_open_by_sharer / _by_accepter (pairing-time resolution).
-- 0052: the inviter-update RLS policy carries WITH CHECK mirroring USING.
```

Companion (0051): `invite_accept_attempts (id, user_id, attempted_at)` —
one row per FAILED code probe; `connect-accept` returns 429 after 10
failures/hour/user; pruned daily by the `invite-attempts-prune` cron.
RLS enabled with **no policies** (service-role only by design).

### ai_conversations / ai_messages
```sql
create table public.ai_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  family_id       uuid not null references public.families(id) on delete cascade,
  context         text not null check (context in ('home','reading_detail','weekly_summary','onboarding')),
  created_at      timestamptz not null default now()
);

create table public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role            text not null check (role in ('system','user','assistant')),
  body            text not null,
  tier            text check (tier in ('A','B','C')),
  model           text,                              -- 'claude-haiku-4-5-20251001'
  prompt_tokens   int,
  completion_tokens int,
  flagged         boolean not null default false,    -- forbidden-claims classifier hit
  user_thumb      smallint check (user_thumb in (-1,0,1)),
  created_at      timestamptz not null default now()
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);
```

### audit_log
```sql
create table public.audit_log (
  id              bigint generated always as identity,
  occurred_at     timestamptz not null default now(),
  actor_user_id   uuid references public.users(id),
  family_id       uuid references public.families(id),
  action          text not null,                    -- e.g. 'reading.read', 'family.role_change'
  target_type     text,
  target_id       uuid,
  metadata        jsonb not null default '{}',
  ip_inet         inet,
  user_agent      text,
  primary key (id, occurred_at)                     -- partition column must be in the PK
) partition by range (occurred_at);
-- Sprint 0 ships with a single default partition (`audit_log_default`).
-- Sprint 17's partition-rolling cron Edge Function creates explicit monthly
-- partitions and drops expired ones past the 7-year retention window.
create index audit_actor_idx  on public.audit_log (actor_user_id, occurred_at desc);
create index audit_family_idx on public.audit_log (family_id, occurred_at desc);
```

### push_tokens
```sql
create table public.push_tokens (
  user_id         uuid not null references public.users(id) on delete cascade,
  device_id       text not null,
  expo_token      text not null,
  apns_token      text,
  fcm_token       text,
  platform        text not null check (platform in ('ios','android','web')),
  app_version     text,
  os_version      text,
  last_seen_at    timestamptz not null default now(),
  primary key (user_id, device_id)
);
```

### shopify_orders
```sql
create table public.shopify_orders (
  id                  bigserial primary key,
  user_id             uuid references public.users(id),
  family_id           uuid references public.families(id),
  shopify_order_id    bigint not null unique,
  order_number        text,
  fulfilment_status   text,
  carrier             text,
  tracking_number     text,
  tracking_url        text,
  ship_date           timestamptz,
  estimated_delivery  date,
  delivered_at        timestamptz,
  raw_event           jsonb,
  updated_at          timestamptz not null default now()
);
create index shopify_orders_user_idx on public.shopify_orders (user_id);
```

---

## Row-Level Security

All tables have RLS enabled. The `/sync`, `/check-alerts`, `/generate-doctor-report`, `/revenuecat-webhook`, and `/shopify-webhook` Edge Functions run with the `service_role` key and bypass RLS by design — every other path goes through user-context RLS.

### Helpers
```sql
create or replace function public.is_family_member(_family_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_members
    where family_id = _family_id
      and user_id = auth.uid()
      and removed_at is null
  );
$$;

create or replace function public.is_family_owner(_family_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_members
    where family_id = _family_id
      and user_id = auth.uid()
      and role = 'family_owner'
      and removed_at is null
  );
$$;
```

### Reading policies
```sql
alter table public.readings enable row level security;
create policy "members read" on public.readings
  for select using (public.is_family_member(family_id));
create policy "service inserts" on public.readings
  for insert with check (auth.role() = 'service_role');
create policy "members soft-hide" on public.readings
  for update using (public.is_family_member(family_id))
  with check (hidden_by_user_id = auth.uid());

-- Physiological-value immutability (systolic/diastolic/pulse/measured_at,
-- plus device_id/family_id/source) is enforced by a BEFORE UPDATE trigger
-- (`readings_immutable_columns_trigger`) rather than the WITH CHECK clause,
-- because PostgreSQL does not expose OLD/NEW inside CREATE POLICY. See
-- supabase/migrations/0001_initial.sql.

-- HARD DELETE FORBIDDEN for watch readings
create policy "manual delete only" on public.readings
  for delete using (public.is_family_member(family_id) and source = 'manual');
```

### Family / membership policies
```sql
alter table public.families enable row level security;
create policy "members read family"  on public.families for select using (public.is_family_member(id));
create policy "owner update family"   on public.families for update using (public.is_family_owner(id));
-- inserts via /create-family Edge Function (service_role)

alter table public.family_members enable row level security;
create policy "members see members"   on public.family_members for select using (public.is_family_member(family_id));
create policy "owner edits members"   on public.family_members for update using (public.is_family_owner(family_id));
create policy "self-leave"            on public.family_members
  for update using (user_id = auth.uid()) with check (removed_at is not null);
```

### Reading-related child tables
`reading_comments`, `vitals_other`, `external_vitals` follow the family-scoped pattern: members read; for `external_vitals` only `service_role` inserts (the `/sync-external-vitals` Edge Function), and members may soft-hide their own rows.

`reading_notes` adds the visibility filter (D8a §7.3):
```sql
alter table public.reading_notes enable row level security;

create policy "members read family notes" on public.reading_notes
  for select using (
    public.is_family_member(family_id) and visibility = 'family'
  );

create policy "author reads own private notes" on public.reading_notes
  for select using (
    author_id = auth.uid() and visibility = 'private'
  );

create policy "members write own notes" on public.reading_notes
  for insert with check (
    public.is_family_member(family_id) and author_id = auth.uid()
  );

create policy "author edits own notes" on public.reading_notes
  for update using (author_id = auth.uid());
```

### Audit log
```sql
alter table public.audit_log enable row level security;
create policy "owner reads family audit" on public.audit_log
  for select using (family_id is not null and public.is_family_owner(family_id));
create policy "self reads own audit"     on public.audit_log
  for select using (actor_user_id = auth.uid());
create policy "service inserts audit"    on public.audit_log
  for insert with check (auth.role() = 'service_role');
```

---

## Soft-delete strategy (canonical)

| Entity | Soft-delete column(s) | Hard delete? | Retention |
| --- | --- | --- | --- |
| users (account) | `deleted_at` | After 30-day grace | 30 days grace, then anonymised; 7 years for required audit trail |
| readings (watch) | `hidden`, `hidden_reason`, `hidden_at` | **Never** (forbidden by RLS) | Until family_owner deletes account |
| readings (manual) | `hidden` / direct delete | Allowed (own author) | Same |
| external_vitals | `hidden`, `hidden_reason`, `hidden_by_user_id`, `hidden_at` | Forbidden (no for-delete policy) | Until family_owner deletes account; platform owns source of truth |
| family_members | `removed_at`, `removed_reason` | Never | Persisted for audit even after removal |
| devices | `unpaired_at` | Never | Persisted; same row may re-pair after factory reset |
| invitations | `cancelled_at` | Allowed after 90 days expiry | 90 days then purged by `/retention` cron |
| ai_messages | n/a (immutable) | Bulk delete on user request | 90 days unless user opts longer |
| audit_log | n/a | Partitions dropped after 7 years | 90 days hot, 7 years archive |

---

## Local storage on device

> **Updated by [ADR-0009](_adr/0009-drop-watermelondb.md) (2026-06-02).**
> WatermelonDB was dropped — there is **no on-device relational DB**.
> On-device persistence is **MMKV (encrypted KV) + Zustand (client state)**;
> **Supabase (Postgres)** is the queryable source of truth, read through
> **TanStack Query**. The offline-first guarantee in CLAUDE.md ("every
> reading is saved to MMKV before any sync attempt") is unchanged — the
> pending buffer is MMKV.

### MMKV (encrypted KV)
Used for:
- Auth tokens (Supabase access + refresh, both via platform Keychain/Keystore)
- User preferences (theme override, large-text mode, locale, quiet-hours config)
- Pending readings buffer (raw BLE payloads not yet synced — flushed on connection regain)
- Feature flags / rollout state
- **Never**: full reading history (that lives in Supabase, fetched + cached via TanStack Query)

Per CLAUDE.md: **no `localStorage` or `sessionStorage`** — MMKV only.

### Queryable history (Supabase, not a local relational DB)
Reading history, the other vitals, family/circle membership, and device
pairing state are queried from **Supabase** and cached client-side by
**TanStack Query**. Trends, anomaly look-back, and the dashboards read from
that cache. Conflict resolution stays server-authoritative for reading
values (D7 §9.3 background: server wins for values; client wins for
local-only UI state).

### Sync strategy
1. Reading captured on device → write to MMKV pending buffer **synchronously** before any UI confirmation.
2. Best-effort POST to `/sync` Edge Function. On success: the reading lands in `public.readings`; drop it from the MMKV pending buffer.
3. On failure: keep in MMKV pending buffer; retry on next connectivity event (background fetch, app foreground, BLE reconnect).
4. Reads come from the TanStack Query cache over Supabase; a background refresh reconciles when connectivity returns.

The app must function with no network. If `/sync` has been failing for >24h, show a calm reassurance banner ("Your readings are saved. They'll sync when you're back online.") — never a fear-language alert.

---

## Open data-model questions tracked
- Q1 (vitals_other partitioning by metric_type) — defer until table > 50M rows
- Q3 (audit_log archive cron implementation) — Sprint 17 work

See `plans/backlog.md`.
