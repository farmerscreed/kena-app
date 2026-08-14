# Start here — vitals correctness + physical testing + report delivery (2026-06-05)

> **⏩ 2026-08-14 update (read FIRST):** the Connect/invite system was
> simplified end-to-end (Phases A–C, ADR-0012). Prod DB is fully
> migrated (0051 + 0052) and the four legacy invite functions are
> DELETED from the hosted project; the mobile + backend work sits on
> branch **`claude/connect-phase-a`** (7 commits, all gates green)
> awaiting founder deploys + merge + the versionCode 8 build. The
> website's `/join?code=` landing page is on the leiko repo branch
> `claude/join-code-landing`. **Read
> `plans/session-2026-08-14-connect-phases-abc.md`** — it has the
> founder punch list and a ⚠️ critical warning: `db-migrate.yml` will
> break on the next migrations-touching merge to main until remote
> migration history is repaired for 0036–0050 (steps in the handoff).
> This clears the old "dormant invite functions / no join page"
> deferrals below.
>
> **⏩ 2026-06-12 update (read first):** vc5 **built, signed, and validated on
> two real phones** — silent-first remote refresh works end-to-end (silent
> doesn't wake a backgrounded Pixel; the visible "Send a reminder" nudge
> delivers reliably). The **AAB is built** for Google Play. Full results,
> upload steps, and the **upload-key check you must do first**:
> **`plans/V5_RELEASE_2026-06-12.md`**. Next: confirm the upload key →
> upload AAB to Play Internal testing.
>
> **⏩ 2026-06-11 update:** remote refresh is now **silent-first
> with a human-confirmed visible fallback** — caregiver pull-to-refresh stays
> silent; if no fresh data lands in ~20s the caregiver gets a "Send a reminder"
> row that escalates to a visible `sync_nudge` the wearer taps to sync. Server
> is **deployed** (`send-push` v20, `request-sync` v5); client orchestration
> ships in **v5**. Decision: `docs/_adr/0011-silent-first-remote-refresh.md`;
> spec: `docs/11-push-notifications.md` §10; **v5 retest checklist** +
> deploy/state: `plans/V5_BUILD_HANDOFF_2026-06-10.md`.
>
> **⏩ 2026-06-10 update (read first):** remote-refresh investigation +
> fixes landed on `main` (pushed). Push-token registration and the
> send-push `verify_jwt` hop are fixed (② deployed to prod); the silent
> push **still isn't reaching the device** (likely the Expo FCM credential).
> **To build v5:** `plans/V5_BUILD_HANDOFF_2026-06-10.md`.
> Full record: `plans/REMOTE_REFRESH_FIX_2026-06-10.md` + `docs/_adr/0010-send-push-internal-auth.md`.

Last touched: 2026-06-05. Branch `fix/vitals-data-completeness` (pushed,
tracking origin). Supersedes the 2026-06-03 version of this file.

## 60-second context

Two arcs are complete on this branch:

1. **The vitals data-correctness overhaul (2026-06-03)** — full audit +
   fixes, all LIVE in prod. Decision record: **ADR-0008**
   (`docs/_adr/0008-vitals-data-correctness.md`). Working evidence:
   `plans/vitals-data-completeness.md`.
2. **Physical testing + live fixes (2026-06-05)** — the founder ran
   `plans/PHYSICAL_TEST_PLAN_2026-06-03.md` on device `43230DLJH001YY`.
   **Stages 1, 3, 4, 5, 6, 7 PASSED** (results recorded in that file's
   header). Testing surfaced two real defects, both fixed live, plus a
   founder-directed feature set — see below. Decision record for the
   report-delivery work: **ADR-0009**
   (`docs/_adr/0009-doctor-report-delivery.md`).

Standing founder rules (treat as law): **never show fabricated or
placeholder-derived values — rather show nothing**; **verify every data
claim against DB/code/tests**; **document everything for the next
session**.

## What landed 2026-06-05 (all committed + pushed)

1. **Sleep score was a constant-0 placeholder** → "a more restless night
   than your usual" fired for every night. Display now recomputes via
   `classification.sleepScoreForSession()`; ingest stores the real score
   (ADR-0008 amendment D6, commit 02ec8bb).
2. **Doctor report delivery reworked (ADR-0009)**: generation now
   downloads the PDF and opens the new **PdfPreview** screen
   (react-native-pdf) — Share hands the actual FILE (old flow shared a
   text URL that expired in 1 hour), and **"Download to phone"** saves
   into the public Downloads via the MediaStore. All device-verified
   (WhatsApp attachment delivered; file present in /sdcard/Download).
   Commits 1c64550, b55644c, 8fb31f2 (+ docs ee51561).
3. **Trends rebuilt on exact data (A+B+C package, founder-approved):**
   the screen had the SAME silent 1000-row truncation as the PDF (worse:
   one combined query let HR starve sleep/activity out entirely) and UTC
   day bucketing — the narrative was describing truncated data. Now: the
   `trends_summary` RPC (0035) returns exact per-day aggregates for all
   five vitals in the wearer's tz; a **focal-vital chip row** lets the
   user switch the evidence chart to any vital; the expansion overlay was
   already range-driven. ADR-0008 amendment notes it.
4. **Four new stack pins** (founder-approved, in `docs/00-tech-stack.md`):
   expo-file-system 19.0.x, expo-sharing 14.0.x, react-native-pdf 7.0.x,
   react-native-blob-util 0.24.x. **Native modules → any build older than
   2026-06-05 must be rebuilt** (the dev client was; the release APK
   pipeline will pick them up on next run).

## Earlier (2026-06-03) — summary, full detail in ADR-0008

BP dedupe device-independent (51 prod dupes removed) · all rendering +
day/night bucketing in the **wearer's tz** · sleep night-keyed
(`measured_at` = session END, supersedes D13 §2.4) with never-fabricated
display times · doctor-PDF 1000-row silent truncation fixed (SQL
aggregation RPC 0034 + pagination) · HR range analytics server-windowed
(RPC 0030) · `measured_at_local` nulled (0033) · BottomSheet
cancelled-dismiss touch-eater fixed · **VitalHistory** "View all · N"
screen for BP/SpO2/Sleep/Activity.

## Prod state (leiko-prod `kqnzxjrpnjnczhgdwdqg`)

- Migrations **0029 → 0035** applied (0035 = trends_summary RPC); `sync` + `generate-doctor-pdf`
  edge functions deployed (all of 2026-06-03; nothing server-side changed
  on 06-05 — the delivery rework is client-side).
- Access: `apps/mobile/.env.local` (URL + anon key); Supabase Management
  API PAT reaches this project (curl User-Agent required; the MCP
  supabase tools are authed to a DIFFERENT account — they can NOT reach
  leiko-prod).

## Gates

tsc 0 · jest **208 suites / 2473 tests** · eslint 0 errors · deno check
clean · deno tests 192 pass (2 pre-existing `resolve-routing` failures —
mock fidelity, predate everything here).

## Merge status — MERGING to main (founder green-lit)

Founder green-lit the merge. The new commits since the PR-#9 boundary
(`663ce75`) were **cherry-picked onto current `origin/main`** on branch
`claude/vitals-followups` — cherry-pick, **not** `git merge` (main is
squash-merged, so a merge would conflict everywhere). Gates re-run green
on top of main: **tsc 0 · eslint 0 · jest 208 suites / 2474 tests**.
Opened as a PR to main.

**Accepted-risk carried into the merge (founder decision):** Stage 2
(caregiver cross-tz) and the U16H connect regression were **DEFERRED** —
run them as a follow-up.

**On merge:** pushing main triggers `db-migrate.yml` (`supabase db push`);
migration **0035** is already applied + recorded in prod
`schema_migrations` (0029→0035), so `db push` skips it. Confirm after.

## Backlog after the merge

- HR per-day drill-down for VitalHistory (designed: day list from
  `hr_range_summary.per_day` → tap a day → its samples).
- Release APK rebuild + untethered test (`npm run release:android:apk`,
  needs founder's `LEIKO_RELEASE_*` keystore env).
- iOS verification of the share/download paths once an iOS build exists.
- Pre-existing deferrals from the 2026-06-02 handoff — 2026-08-14: the
  dormant invite functions are now DELETED and the join page EXISTS
  (ADR-0012); only the inert `account_type` column removal remains.

## Hard-won operational notes

- Prod mutations: Management API `database/query` inside guarded
  `DO $$` blocks (abort on unexpected row counts), then record the
  version in `supabase_migrations.schema_migrations` manually.
- Edge deploys: `SUPABASE_ACCESS_TOKEN=<PAT> npx supabase functions
  deploy <fn> --project-ref kqnzxjrpnjnczhgdwdqg --use-api`.
- Deno is installed (`~/.deno/bin`) — `deno check` + tests before any
  edge deploy.
- **Metro stale-cache trap:** a long-running metro can serve a stale
  transform cache — a fix "doesn't take effect" on device even after an
  app restart. Kill metro and restart with `--clear`, then cold-relaunch
  the app. (Cost us a confusing round during Stage 3.)
- Driving the device: `adb shell uiautomator dump` + `input tap` works
  for verification, but a human's three taps beat fifty blind ones —
  hybrid flow (founder taps, assistant verifies via SQL/logcat/screencap)
  is the efficient pattern.
- Git pushes work via `credential.helper store` (configured repo-local).
