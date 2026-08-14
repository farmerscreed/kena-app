# ADR-0012: Connect one-door simplification (Phases A–C)

- **Status**: Accepted (founder approved 2026-08-14; built same day)
- **Date**: 2026-08-14
- **Amends**: ADR-0007 (completes its unshipped UX half; reverses its
  resolved decision #2, the email-match gate; closes its open question
  on the legacy-function back-compat window)
- **Origin**: the "One Door, One Code" audit (Claude session artifact),
  which found the ADR-0007 backend live behind the pre-ADR-0007 UI:
  eight direction-flavoured entry points, two duplicate share sheets,
  one success message for all outcomes, invite links unredeemable at
  four independent layers, and the gifted-watch flow ("I bought this
  for Mum") ending in a fake success because nothing ever resolved a
  pending connect.

## Decision

The product model is one sentence — *one person shares a code, the
other types it in, Leiko figures out the rest* — expressed as exactly
two components with two labels everywhere: **"Connect with someone"**
(ConnectShareSheet, zero inputs, code minted on open) and **"Enter a
code"** (AcceptInviteSheet, code + optional relationship chip).

### Phase A — stop the bleeding (deployed to prod 2026-08-14)

1. **Pending connects resolve in the database.** connect-accept records
   the pending accepter on the invitation (consuming the code); the
   `devices_resolve_pending_connects` trigger (migration 0051) completes
   the connect the moment either party pairs — whoever pairs first is
   the wearer. Kills the fake-success class entirely; no client
   involvement.
2. **The accept-time email-match gate is DROPPED** (reverses ADR-0007
   resolved decision #2). Rationale: the gate compared a *typed* email
   against the invite, not the authenticated user — near-zero security
   value — while causing typo lockouts and wrong-prefill silent 403s
   (the sheet prefilled the accepter's own email; the gate wanted the
   inviter-typed one). Replaced by what actually protects a code:
   single-use, 7-day expiry, and a server-side rate limit
   (`invite_accept_attempts`, 10 failures/hour/user, 429).
3. Accept success copy branches on the real outcome; share messages
   became code-first; the stale `viewerCanInvite` owner gate and the
   Settings empty-state dead end were removed; the four legacy invite
   functions (`send/accept-family-invite`, `send/resolve-care-invite`)
   were **deleted from the hosted project** — `resolve-care-invite`
   accepted a bare code with no identity check at all.

### Phase B — one door

4. `inviteeEmail` is optional in connect-create (email is a delivery
   channel, not a gate); the share sheet needs zero inputs.
5. One share sheet + one accept sheet everywhere; direction-flavoured
   labels deleted; Settings gets one always-visible **Connect** section;
   dead code removed (AddSomeoneChooserSheet, AddPersonScreen,
   addAnotherFamily, legacy wrappers, the no-op pending resolver);
   helper strings (empty states, Ask Leiko answers, invite email) name
   rows that exist.

### Phase C — links that work, then polish

6. The join link carries the **code as the only credential**
   (`leiko.app/join?code=NNNNNN`; token/email params are dead). The
   website landing page **displays the code** so the invite works even
   if every automated layer fails; the app stashes a code that arrives
   while signed out and prefills the "Someone invited me" onboarding
   path.
7. **Follow-back is one tap** (new `connect-follow-back` function) on
   the accept success screen when both parties wear watches. ADR-0007's
   "ask, don't auto-mutual" stands.
8. A completed accept **pushes the sharer** via the existing `family`
   template. Migration 0052 adds the missing WITH CHECK to the 0029
   inviter-update policy.

## Consequences

- The `invitations.invitee_email` column is now optional metadata;
  `url_token` is vestigial (generated, never read — candidate for
  removal in a future migration).
- Installed clients older than the Phase B build still send an email on
  create/accept; the backend delivers/ignores respectively — no forced
  upgrade.
- Every open of the share sheet mints an invitation row (single-use,
  7-day expiry, 10^6 keyspace with a global-unique `pairing_code`);
  acceptable at current scale, revisit if the keyspace ever matters.

## Rejected

- Keeping the email gate with better copy — the gate's check was
  against the wrong principal; copy could not fix that.
- Auto-resolving pending connects from the client on app-open — the
  post-ADR-0007 no-op proved client-side resolution rots; the DB
  trigger cannot be skipped.
- Auto-mutual follow when both wear watches — re-confirmed ADR-0007's
  explicit-consent stance.
