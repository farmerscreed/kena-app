-- 0051_connect_pending_resolution.sql — Connect Phase A.
--
-- Founder-approved 2026-08-14 ("One Door, One Code" audit). Fixes the
-- flagship silent failure: when NEITHER party wore a watch at accept
-- time, connect-accept returned outcome 'pending' and wrote nothing —
-- and no code path ever resolved the pending connect (the client-side
-- resolver has been a documented no-op since ADR-0007). The gifted-watch
-- flow ("I bought this for Mum") therefore ended in a fake success and
-- no connection.
--
-- This migration:
--   1) records the pending accepter ON the invitation row, so the code
--      is consumed by its first accepter and both parties are known;
--   2) resolves pending connects in the database the moment a watch
--      pairs (trigger on public.devices) — whoever pairs first becomes
--      the wearer, the other party is attached as a caregiver follower,
--      per ADR-0007's symmetric-resolution rule. A DB trigger (not a
--      client call) so resolution works no matter which path creates
--      the device row;
--   3) adds invite_accept_attempts, used by connect-accept to
--      rate-limit 6-digit code guessing. Required because the same
--      Phase A change drops the accept-time email-match gate (founder
--      decision 2026-08-14, reversing 2026-06-02: the gate compared a
--      TYPED email, not the authenticated user, and its usability cost
--      — typo lockouts, wrong-prefill silent 403s — outweighed its
--      value). Code security now rests on single-use + 7-day expiry +
--      this rate limit.

-- ── 1) Pending-accept bookkeeping ────────────────────────────────────

alter table public.invitations
  add column if not exists pending_accepted_by uuid references public.users(id),
  add column if not exists pending_accepted_at timestamptz,
  add column if not exists pending_relationship_label text;

comment on column public.invitations.pending_accepted_by is
  'Accepter recorded while outcome=pending (neither party wore a watch). '
  'Consumes the code; the devices trigger completes the connect on pairing.';

-- Pairing-time lookup: open, direction-undecided invites involving a
-- given user on either side. Two partial indexes because the trigger
-- matches on (invited_by = wearer OR pending_accepted_by = wearer).
create index if not exists invitations_pending_open_by_sharer
  on public.invitations (invited_by)
  where kind = 'parent_pairing'
    and accepted_at is null
    and cancelled_at is null
    and pending_accepted_by is not null;

create index if not exists invitations_pending_open_by_accepter
  on public.invitations (pending_accepted_by)
  where kind = 'parent_pairing'
    and accepted_at is null
    and cancelled_at is null
    and pending_accepted_by is not null;

-- ── 2) Resolve pending connects when a watch pairs ───────────────────

create or replace function public.resolve_pending_connects_on_pairing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wearer   uuid;
  v_inv      record;
  v_follower uuid;
  v_inviter  uuid;
  v_label    text;
begin
  -- Only a live pairing creates (or restores) a watch-circle.
  if new.unpaired_at is not null then
    return new;
  end if;

  -- The circle must be a self-circle (parent_user_id = the wearer).
  -- Caregiver-created circles never resolve connects.
  select parent_user_id into v_wearer
  from public.families
  where id = new.family_id;
  if v_wearer is null then
    return new;
  end if;

  for v_inv in
    select id, invited_by, pending_accepted_by, pending_relationship_label
    from public.invitations
    where kind = 'parent_pairing'
      and accepted_at is null
      and cancelled_at is null
      and expires_at > now()
      and pending_accepted_by is not null
      and (invited_by = v_wearer or pending_accepted_by = v_wearer)
  loop
    -- Whoever paired first is the wearer; the OTHER party follows.
    if v_inv.invited_by = v_wearer then
      v_follower := v_inv.pending_accepted_by;
      v_inviter  := v_inv.invited_by;
      -- The accepter's "who are they to you?" answer described the
      -- sharer — now the wearer — so it applies to the accepter's
      -- follower row, same as an accepter_follows outcome.
      v_label := v_inv.pending_relationship_label;
    else
      v_follower := v_inv.invited_by;
      v_inviter  := v_inv.pending_accepted_by;
      -- The stored label described the sharer from the accepter's
      -- side; it does not describe this follower. Omit, same as a
      -- sharer_follows outcome.
      v_label := null;
    end if;

    -- Same shape as connect-accept's addFollower: resurrect a removed
    -- row, never disturb an active one (the conflict update is gated
    -- on removed_at).
    insert into public.family_members
      (family_id, user_id, role, invited_by, joined_at,
       removed_at, removed_reason, caregiver_relationship_label)
    values
      (new.family_id, v_follower, 'caregiver', v_inviter, now(),
       null, null, v_label)
    on conflict (family_id, user_id) do update
      set role = 'caregiver',
          joined_at = now(),
          removed_at = null,
          removed_reason = null,
          caregiver_relationship_label =
            coalesce(excluded.caregiver_relationship_label,
                     public.family_members.caregiver_relationship_label)
      where public.family_members.removed_at is not null;

    update public.invitations
      set family_id  = new.family_id,
          accepted_at = now(),
          accepted_by = v_inv.pending_accepted_by
      where id = v_inv.id
        and accepted_at is null;

    insert into public.audit_log (actor_user_id, family_id, action, metadata)
    values (
      v_wearer,
      new.family_id,
      'connect.resolved_on_pairing',
      jsonb_build_object(
        'invitation_id', v_inv.id,
        'paired_first',
          case when v_inv.invited_by = v_wearer then 'sharer' else 'accepter' end
      )
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists devices_resolve_pending_connects on public.devices;
create trigger devices_resolve_pending_connects
  after insert or update of unpaired_at on public.devices
  for each row
  execute function public.resolve_pending_connects_on_pairing();

-- ── 3) Accept-attempt rate limiting ──────────────────────────────────

create table public.invite_accept_attempts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index invite_accept_attempts_user_time
  on public.invite_accept_attempts (user_id, attempted_at desc);

-- No policies on purpose: only the service role (connect-accept) reads
-- or writes attempt rows; clients have no business here.
alter table public.invite_accept_attempts enable row level security;

-- Attempts are only meaningful inside the 1-hour window connect-accept
-- checks; prune daily. Self-contained (no GUCs / no HTTP), same slot
-- family as the 04:00 hard-delete cron (0020).
create extension if not exists pg_cron;
select cron.schedule(
  'invite-attempts-prune',
  '20 4 * * *',
  $$delete from public.invite_accept_attempts where attempted_at < now() - interval '2 days'$$
);
