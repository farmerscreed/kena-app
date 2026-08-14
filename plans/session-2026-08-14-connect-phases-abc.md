# Session handoff — Connect Phases A–C (2026-08-14)

**One-line summary:** the confusing invite system is gone. The product
model is now *one person shares a code, the other types it in, Leiko
figures out the rest* — two sheets, two labels, everywhere. Decision
record: **ADR-0012** (`docs/_adr/0012-connect-one-door.md`). Current UX
spec: `docs/04-screens/connect-invite.md` (rewritten, reflects code as
of 2026-08-14). Origin: the founder-commissioned "One Door, One Code"
audit; founder approved all recommendations 2026-08-14.

## State at end of session

### LIVE in prod (leiko-prod `kqnzxjrpnjnczhgdwdqg`) — verified

- **Migration 0051** applied + recorded in remote history:
  `pending_accepted_by/_at/_label` on invitations; the
  `devices_resolve_pending_connects` trigger (pending connects complete
  at watch pairing — the gifted-watch fix); `invite_accept_attempts`
  rate-limit table (RLS on, zero policies by design) + daily
  `invite-attempts-prune` cron (job 7, 04:20 UTC).
- **Migration 0052** applied (WITH CHECK on the 0029 inviter-update
  policy — verified in pg_policy) but **NOT yet recorded** in remote
  migration history (founder step 2 below).
- **connect-accept / connect-create at v10** (Phase A): no email gate,
  10-failures/hour rate limit, pending accepts recorded + code
  consumed, real `invited_by` attribution.
- **All four legacy invite functions DELETED** from the hosted project
  (send-family-invite, accept-family-invite, send-care-invite,
  resolve-care-invite — the last accepted a bare code with no identity
  check).

### Committed, NOT yet deployed / shipped

- **kena-app branch `claude/connect-phase-a`** (7 commits, all gates
  green: tsc 0, eslint 0, jest 216 suites / 2515 tests):
  Phase A mobile (truthful per-outcome accept copy, code-only accept)
  + Phase B (zero-input `ConnectShareSheet` replaces CareInviteSheet AND
  the Settings inline sheet; "Connect with someone" / "Enter a code"
  labels everywhere; Settings gets an always-visible Connect section;
  dead code deleted: AddSomeoneChooserSheet, AddPersonScreen,
  addAnotherFamily, legacy wrappers, no-op pending resolver)
  + Phase C mobile (join deep link is code-only; tapped links stash the
  code and prefill "Someone invited me" in onboarding; one-tap
  follow-back UI) + backend not yet deployed: connect-create
  (optional email), connect-accept (invitationId + acceptance push via
  the existing `family` template), **connect-follow-back (new)**.
- **Website branch `claude/join-code-landing`** (leiko repo, 1 commit
  `70d4db7`): `/join?code=NNNNNN` renders the code ON the page and
  hands off `leiko://join?code=`; digits-only validation
  (injection-tested); code-less /join keeps a graceful explainer.

## Founder punch list (in order)

1. ~~Deploy the three functions~~ **DONE 2026-08-14**: connect-create
   v11, connect-accept v11, connect-follow-back v1 — verified deployed.
   (Claude sessions are blocked from `functions deploy/delete`,
   `migration repair`, and `wrangler deploy` by the permission
   classifier — founder runs these.)
2. ~~migration repair 0052~~ **DONE 2026-08-14** — 0051 and 0052 both
   recorded in remote history.
2b. ~~Website deploy~~ **DONE 2026-08-14** — leiko.app/join?code=
   verified live (page shows the code + leiko://join?code= handoff).
3. ~~db-migrate.yml defused~~ **DONE 2026-08-14** — 0036-0050 repaired
   into remote history (verified: no unrecorded local migrations).
   Original warning kept for the record: **⚠️ BEFORE merging this branch
   to main, defuse `db-migrate.yml`.**
   The workflow runs `supabase db push` on every main push touching
   `supabase/migrations/`. Remote history records 0001–0035 + 0051
   (+0052 after step 2), but **local 0036–0050 were applied to prod
   under timestamped names** (June–August sessions via Management
   API/MCP) and are NOT in remote history — so `db push` will try to
   re-run them and fail (objects already exist). Fix first:
   `npx supabase migration repair --status applied 0036 0037 0038 0039
   0040 0041 0042 0043 0044 0045 0046 0047 0048 0049 0050`
   (repair takes multiple versions). After that, `db push` becomes a
   no-op for everything already applied and the workflow is safe again.
3c. **Merged to main 2026-08-14** (fast-forward, 2ee3f42..da29683,
   pushed). Post-merge workflow status — BOTH failures pre-existing,
   nothing to do with the Connect work:
   - **CI**: Lint/Typecheck/Test all PASSED; only the `npm audit
     --omit=dev --audit-level=high` step fails (pre-existing since at
     least July: @babel/core GHSA-4x5r-pxfx-6jf8 + brace-expansion DoS
     advisories in transitive deps; `npm audit fix` is suggested but
     bumping versions needs founder sign-off per the pin rule).
   - **db-migrate**: fails BEFORE applying anything — the 19
     remote-only TIMESTAMPED history entries (June-Aug live-applies)
     have no local files. DB untouched; 0051/0052 already applied +
     recorded. Fix (founder, one command — the workflow's own
     suggestion): `npx supabase migration repair --status reverted
     20260606201634 20260606201908 20260606211525 20260607235313
     20260608000919 20260608004510 20260608004523 20260608104906
     20260608111951 20260608114818 20260608135604 20260608200916
     20260609214034 20260609231811 20260609231942 20260718125739
     20260720233547 20260808002149 20260808010616` — bookkeeping only
     (deletes history rows, schema untouched; their DDL is codified in
     local 0036-0050 which are recorded as applied). Then re-run the
     workflow via gh run rerun / workflow_dispatch to confirm green.
4. ~~Merge~~ done (see 3c). The June 3-phone connect matrix
   (`plans/comprehensive-test.md`) is now passable end-to-end including
   Stage 4's pending case. Build **versionCode 8** — the new UI ships
   with it; until then installed The June
   3-phone connect matrix (`plans/comprehensive-test.md`) is now
   passable end-to-end including Stage 4's pending case. Build
   clients run the old UI against the new backend (compatible: the
   backend ignores the email field old clients still send).
5. **Website:** merge `claude/join-code-landing` → main, then the
   build-artifact deploy sequence (checkout main → pull → npm install →
   npm run build → `npx wrangler deploy -c dist/server/wrangler.json`;
   retry on wrangler "fetch failed").

## Gotchas a future session must know

- **Never run `supabase db push` interactively on this project** until
  punch-list step 3 is done — remote migration history is drifted.
  Apply single migrations via
  `npx supabase db query --linked -f <file>` then
  `npx supabase migration repair --status applied <n>`.
- The founder had uncommitted `[sync-trace]` debug logging in
  `RootNavigator.tsx` + `syncOrchestrator.ts` (background-sync
  diagnosis, marked TEMP). Preserved uncommitted — do not sweep into
  commits; do not remove without the founder.
- `state/auth.ts` ↔ `state/onboarding.ts` import each other. A jest
  mock factory that calls `requireActual('../../state/onboarding')` at
  factory time can re-enter itself depending on the screen's import
  order — resolve lazily (see `CaregiverFamilyWatch.test.tsx` for the
  pattern; this bit us when FamilyWatch dropped its unused useAuth
  import).
- `invitations.url_token` and `invitee_phone` are vestigial (generated/
  never used). Candidate cleanup migration later; harmless now.
- CLAUDE.md's invite data rule was updated in Phase A — trust it, not
  D8a §10.
- Old handoffs (`session-2026-06-02-adr0006-0007-handoff.md`,
  `comprehensive-test.md` "known limitations") describe the pre-A world
  (dormant legacy functions, no join page, email gate). ADR-0012 and
  `docs/04-screens/connect-invite.md` supersede them on those points.

## Deferred / not done (deliberately)

- SelfBuyerHome (legacy screen) still lacks the removal-banner re-join
  affordance (`onEnterInvite` not passed) — low priority, the unified
  CaregiverHome is every persona's home per ADR-0006.
- Multi-circle `parents[0]` selection in Settings/Visibility/Members
  screens (audit finding) — untouched, pre-existing.
- `users` row RLS is row-level for co-members (email/YOB readable) —
  audit security note, untouched.
- Pending-invites list UI for the sharer ("you have 1 open invite") —
  never specced; the `invitations_pending_by_inviter` index exists if
  wanted.
