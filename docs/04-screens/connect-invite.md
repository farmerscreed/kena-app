# Screen — Connect (share a code / enter a code)

Sourced from **ADR-0007** (unified "Connect" — one code, backend infers
direction) as completed by **ADR-0012** (Connect one-door simplification,
Phases A–C, founder-approved 2026-08-14). This documents the **shipped**
flow. The whole model is one sentence:

> One person shares a code. The other types it in. Leiko figures out the
> rest.

Two components, two labels, everywhere:
- **ConnectShareSheet** — "Connect with someone". Zero inputs: opening it
  generates a 6-digit code to share.
- **AcceptInviteSheet** — "Enter a code". Code + optional relationship
  chip; success copy tells the truth per outcome.

---

## Audience
- Anyone. Share and accept are both ungated — direction is resolved
  server-side from who wears a watch, so no role, ownership, or
  account_type gate applies to either action.

## Purpose
Link any two accounts with **one code**. The user never declares
who-follows-whom.

---

## Entry points

| Entry | Where | Opens | Calls |
| --- | --- | --- | --- |
| Home action bar "+ Connect" | `CaregiverHome` (`CaregiverActionBar`, always shown when the bar renders) | `ConnectShareSheet` | `createConnect` |
| Home empty state "Enter a code" | `CaregiverHome` empty state (primary) | `AcceptInviteSheet` | `acceptConnect` |
| Home empty state "Or share your own code →" | `CaregiverHome` empty state (secondary) | `ConnectShareSheet` | `createConnect` |
| Removal banner "I have a new invite code" | `FamilyRemovalBanner` on `CaregiverHome` | `AcceptInviteSheet` | `acceptConnect` |
| Settings → Connect → "Connect with someone" | `SettingsScreen`, always-visible **Connect** section | `ConnectShareSheet` | `createConnect` |
| Settings → Connect → "Enter a code" | same section | `AcceptInviteSheet` (`settings-accept`) | `acceptConnect` |
| Onboarding "Someone invited me" | `Onboarding/Caregiver/FamilyWatch.tsx` | `AcceptInviteSheet` (prefilled from the join-link stash when present) | `acceptConnect` |
| Link `leiko.app/join?code=NNNNNN` | website landing page + `deepLinkParser`/`deepLinks` | Settings with the accept sheet auto-opened + prefilled; stashed for onboarding when signed out | `acceptConnect` |

Components: `apps/mobile/src/components/ConnectShareSheet.tsx`,
`apps/mobile/src/components/AcceptInviteSheet.tsx`. Service wrappers:
`apps/mobile/src/services/families/manageInvites.ts` (`createConnect`,
`acceptConnect`, `followBackConnect`). Edge functions:
`supabase/functions/connect-create`, `connect-accept`,
`connect-follow-back`.

Removed in Phase B (do not resurrect): `CareInviteSheet`, the Settings
inline invite sheet (with its never-transmitted permission radios),
`AddSomeoneChooserSheet`, `AddPersonScreen`/`addAnotherFamily`, the four
legacy invite wrappers, and the labels "Add someone you care for" /
"Invite someone to follow" / "Care for another person" / "Join a family
circle".

## Share flow (zero inputs)

Opening `ConnectShareSheet` immediately calls `createConnect()` — no
email, no name, no permission picker. Each open mints a fresh
single-use code. `connect-create`:

1. Requires only a signed-in caller (no owner/wearer check).
2. Generates a 6-digit code (retried ≤6× on collision); 7-day expiry.
3. Records the caller's current watch-circle as a nullable hint
   (`family_id`); direction is still resolved at accept time.
4. `inviteeEmail` is **optional** (Phase B): when an older client sends
   one, the code is also emailed via Resend; the zero-input sheet sends
   nothing.
5. Audits `connect.created` (email domain only, when present).

Share message (code-first AND a working link):

```
Let's stay connected on Leiko.

Tap to join me: https://leiko.app/join?code=<code>

Or open Leiko and enter code <code>. It works for 7 days.
```

The `leiko.app/join?code=` page (website repo, `src/lib/app-links.ts`)
**displays the code on the page** and hands off `leiko://join?code=` —
so the invite survives even if every automated layer fails: worst case
the person installs Leiko and types six digits.

## Accept flow (code only)

`AcceptInviteSheet` collects the **6-digit code** and an optional
"Who are they to you?" relationship chip. There is **no email field**:
the accept-time email-match gate was dropped in Phase A (ADR-0012
decision 1) — it compared a typed email, not the authenticated user,
and its usability cost outweighed its value. Code security = single-use
+ 7-day expiry + a server-side rate limit (10 failed attempts/hour per
authenticated user via `invite_accept_attempts`; error
`too_many_attempts`, 429).

`connect-accept` errors: not found (404), cancelled (410), already
accepted (409 — including a pending accept by a *different* account),
expired (410), self-invite (400), too many attempts (429).

### Server-side direction resolution

Re-derived at accept time from current watch ownership ("wears a
watch" = owns a self-circle with an active paired device):

| Sharer wears? | Accepter wears? | `outcome` | What's wired | `canFollowBack` |
| --- | --- | --- | --- | --- |
| Yes | No | `accepter_follows` | accepter becomes caregiver on sharer's circle | false |
| No | Yes | `sharer_follows` | sharer becomes caregiver on accepter's circle | false |
| Yes | Yes | `accepter_follows` | as above, plus one-tap follow-back offer | **true** |
| No | No | `pending` | accepter recorded on the invite (code consumed); completes at pairing | false |

`family_members.invited_by` records the **other party** (real
attribution, not self-attribution). The response carries
`invitationId` for the follow-back call.

### Success copy tells the truth per outcome

- `accepter_follows`: "You've joined the circle. Their readings will
  appear on your home screen."
- `sharer_follows`: "You're connected. They can now follow your
  readings — you choose what they see in Settings."
- `pending`: "You're connected. Readings will start sharing once one of
  you pairs a watch."
- Sheet title on success: "You're connected".

### Follow-back (both wear watches)

When `canFollowBack` is true the success state offers **"Let them see
your readings too"** — one tap calls `connect-follow-back`
(`followBackConnect({ invitationId })`), which verifies the caller
accepted that invitation and owns an active watch-circle, then adds the
sharer as a caregiver on the caller's circle. ADR-0007's "ask, don't
auto-mutual" stands.

### Pending resolution (neither wears a watch — the gifted-watch flow)

The pending accept is recorded ON the invitation
(`pending_accepted_by/_at/_label`), which consumes the code for anyone
else. The moment **either** party pairs a watch, the database trigger
`devices_resolve_pending_connects` (migration 0051) completes the
connect: whoever paired becomes the wearer, the other becomes their
caregiver follower, the invite is stamped accepted, and
`connect.resolved_on_pairing` is audited. No client involvement — the
old client-side resolver is gone. In onboarding, a pending accept
completes onboarding without a current family (`completeViaInvite(null)`);
home shows its empty state until pairing resolves the connect.

### Acceptance push

A completed (non-pending) accept fires a best-effort `send-push` to the
sharer using the existing **`family`** template ("<name> accepted your
invite" / "<name> can now see your readings" per recipient type), with
its `family_activity` opt-out, voice lint, and rate limits.

## Deep-link `join` route

`https://leiko.app/join?code=NNNNNN` / `leiko://join?code=NNNNNN` — the
**code is the only credential** (exactly 6 digits or the link parses as
`unknown`; legacy `token`/`email` params are ignored). Dispatch always
**stashes the code first** (`stashPendingCareInvite`), then navigates to
Settings `{ inviteCode }`, which auto-opens the accept sheet prefilled.
Signed-out / mid-onboarding: the navigate is a silent no-op but the
stash survives — the "Someone invited me" onboarding path opens the
accept sheet prefilled from it. The sheet clears the stash on any
successful accept.

## Voice (key strings)

- Share sheet body: "Share this code with the person you want to stay
  connected with. When they enter it in their Leiko app, you're
  connected — whoever wears a watch shares their readings, and the
  other follows." + "The code works once and expires in 7 days."
- Accept intro: "Type the 6-digit code they shared with you."
- Rate limit: "Too many tries for now. Wait a little while, then try
  again."
- Email body (when an email is sent): "Open the Leiko app, go to
  Settings → Enter a code…  New to Leiko? Choose 'Someone invited me'
  during setup."

## Data rules

- Codes are single-use, expire in 7 days, and accept attempts are
  rate-limited server-side. No accept-time email gate (ADR-0012).
- Audit logs carry email **domain** only (when an email exists at all);
  reading values never appear in analytics or audit metadata.
- `account_type` is untouched by connect.

## Files (this doc reflects the code as of 2026-08-14)

- `docs/_adr/0012-connect-one-door.md` — the Phase A–C decisions.
- `supabase/functions/connect-create|connect-accept|connect-follow-back`
- `supabase/migrations/0051_connect_pending_resolution.sql` (pending
  columns, pairing trigger, rate-limit table),
  `0052_invitations_update_with_check.sql`
- `apps/mobile/src/components/ConnectShareSheet.tsx`, `AcceptInviteSheet.tsx`
- `apps/mobile/src/services/families/manageInvites.ts`, `pendingCareInvite.ts`
- `apps/mobile/src/services/notifications/deepLinkParser.ts`, `deepLinks.ts`
- `apps/mobile/src/screens/Settings/SettingsScreen.tsx` (Connect section),
  `Home/CaregiverHome.tsx`, `Onboarding/Caregiver/FamilyWatch.tsx`
- Website repo `leiko/src/lib/app-links.ts` + `src/server.ts` — the
  `/join?code=` landing page (branch `claude/join-code-landing`).
