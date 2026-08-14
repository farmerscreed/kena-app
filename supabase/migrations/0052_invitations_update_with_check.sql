-- 0052_invitations_update_with_check.sql — Connect Phase C hardening.
--
-- The 0029 policy "inviter cancels pending invites" had USING but no
-- WITH CHECK, so an inviter could rewrite ANY column on their own
-- parent_pairing rows directly from the client — including accepted_by,
-- accepted_at, and family_id. Postgres UPDATE policies need both: USING
-- filters which rows may be targeted, WITH CHECK constrains what the
-- updated row may look like. Mirroring the predicate closes ownership
-- transfer (invited_by must stay the caller) and kind changes; the edge
-- functions run as service_role and are unaffected.

drop policy if exists "inviter cancels pending invites" on public.invitations;

create policy "inviter cancels pending invites" on public.invitations
  for update
  using (
    kind = 'parent_pairing'
    and invited_by = auth.uid()
  )
  with check (
    kind = 'parent_pairing'
    and invited_by = auth.uid()
  );
