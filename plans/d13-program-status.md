# D13 Vitals Layer — Program Status & Handoff

Last updated: 2026-08-19 — **PROD RELEASE EXECUTED AND VERIFIED.**
Everything is merged to main (#29) and live on prod; v15 (from main)
on the device.

**Release record (2026-08-19):** `release-d13.sh` could not run as-is
(supabase CLI v2.109 dropped `--project-ref` from `migration list` /
`db push`; also the founder's first PAT belonged to their *other*
Supabase account — leiko-prod lives in the account whose token now
sits in 1Password as the working one). The release was executed via
the management API instead (`tools/prod-sql.py`, PAT from the session
file `~/secrets/leiko-pat`, since deleted):
  - Migrations 0053–0056 + 0058 applied to prod and recorded in
    `supabase_migrations.schema_migrations`.
  - The 19 remote-only timestamp versions (WhatsApp/studio/pg_cron
    hotfixes applied straight to prod) were DELETED from the history
    table — their SQL stays applied — so `db-migrate` on main is
    green from now on. The drift is gone for good.
  - Five functions deployed via `tools/deploy-d13-fns.sh` (founder-run):
    detect-anomaly, sync, compute-correlations, compute-weekly-summary,
    compute-monthly-baseline.
  - detect-anomaly cron invoked twice; first run exposed a real bug —
    prod readings all have `quality_score` null and HR samples carry no
    motion tag, so the good/fair + rest-only filters excluded the whole
    working set (and legacy `hr_baselines` had been writing nothing for
    the same reason). Fixed (commit e733f47), redeployed, re-invoked.
  - VERIFIED: `vital_baselines` now holds bp_systolic / bp_diastolic /
    resting_hr / spo2 / sleep_duration / steps_daily rows for all three
    subjects, `is_sufficient` honest (20-reading subject sufficient on
    BP/SpO₂/steps; sparse subjects in learning). Active crons:
    detect-anomaly-nightly, compute-correlations-hourly,
    compute-weekly-summary-weekly, compute-monthly-baseline-monthly.

**Next:** on-device live pass (server bands, matrix findings, context
segments); first Story letter lands after the Mon 04:00 UTC weekly
cron. Founder may rotate the PAT in Supabase account settings (the
session token file is deleted; rotation is optional hygiene).
This document is the single source of truth for where the D13
programme stands; it is written so any future session (or person) can
continue with nothing missing.

## Where everything lives

- **Spec**: `docs/D13_Leiko_Vitals_Layer_Implementation_Spec.md` — the
  build bible; §0 standing rules, §10 PR order, §13 git workflow.
- **Integration branch**: `redesign/vitals-layer-d13` =
  origin/main (f39f120) + `fix/audit-p0-p1` merged (its 0051 migration
  renumbered to 0053). **`main` is untouched** — the final step is ONE
  reviewed PR from the integration branch to main after the founder
  signs off on-device.
- **Per-PR branches**: `d13/pr-N-…`, all merged into the integration
  branch via PRs #15–#26.

## PR map (all merged into the integration branch)

| PR | # | What landed |
|---|---|---|
| PR-1 baseline truth layer | #15 | `vital_baselines` (0054) + `bp_baselines` compat view; reading_context columns (0055); nightly cron computes all six vitals + BP context rows; client read-through accessor + provisional offline fallback; `classifyVital` (§4.4) + legacy-shaped `classifyReading` adapter; all four call sites threaded |
| PR-2 canonical vocabulary | #16 | `services/voice/tierVocabulary.ts` (§7.4 verbatim); `StatusChip`; competing phrasings deleted incl. comments; `{possessive}` slot ("their" default); server `classifyBP` aligned to §4.4; push titles "Please check on {name}" |
| PR-3 truth in copy | #17 | `apps/mobile/tools/copy-lint/` CI gate (step 5) + `ALLOWED_EXACT`; `staticCopyTruth` digit/clock/event-word test; output-guard 27→37 rules; Layer-2 never fails open silently (`ai.output_guard_skipped` + flagged) |
| PR-4 calibration ladder | #18 | `utils/calibration.ts` (ring fill = sufficiency; unlock ladder days 1/2/4/7/14/21/30; §7.7 copy); learning state end-to-end (chips, caregiver status, hero, BPDetail caption) |
| PR-5 craft pass | #19 | §5.1 colour fork + computed 4.5:1 quarantine test (two spec hexes lightened: talk-to-doctor #B23A48→#E06A7C); §5.2 numeric scale (64/44/28/17/12) + tabular-nums + eyebrow + `fontFamilies.voice`; serif off all values (`voiceFacePolicy` test); canvas gradient on both Homes; glow 0.12→0.20; diastolic → text.secondary; `theme/layout.ts` alias |
| PR-6 RangeBandChart | #20 | Replaces BPTwinLineChart + VitalTrendChart; band ribbon (earned only), shape+dash secondary, density adaptation (0/1–2/3–7/8+), scrub + haptics; slot bucketers deleted; `ViewAsTableLink` on BP/HR/SpO2/Trends |
| PR-7 vital detail rebuild | #21 | Hero StatusChips everywhere; BP Morning/Evening/All segments + `TimeOfDayRing`; HR nightly-resting-first hero (BLE 0x15 payload verified per decisions log #3; sufficiency-gates the range claim); SpO2 overnight-low hero + no-alarm note + honest explainer; Sleep correlation-first + approx-stages caption; Activity 7–9k framing; table links on Sleep/Activity |
| PR-8 Person Overview | #22 | `PersonOverviewScreen` (§7.2a) + `HealthMonitorRow` (§6.4); §7.1 navigation contract (all person taps → PersonOverview, isSelf on the route — closes P2-8); §7.1a attention sort with >48h silence rank; 3-line orb captions |
| PR-9 accessibility core | #23 | 31 labelled Views made explicitly accessible + AST policy test; realtime reading announces itself; DaySpine contrast by colour not alpha + concerned dots size+label; (a11y eslint plugin skipped — eslint-8-only vs pinned eslint 9; AST suites are the CI gates) |
| PR-11 context/meds/correlation | #24 | `ContextTagSheet` (§6.5, time-derived defaults, never blocking) wired post-reading → tags sync into `readings.context_tags`; medications migration 0056 + `MedicationSection` (§7.6 verbatim, self path); §7.5 correlation copy + `CorrelationCountdown` (n≥14 pinned) |
| Story Trends | #25, fix #26 | Founder-commissioned 2026-08-19. Trends opens with Letter → Band River → Chapters. `utils/changePoints.ts` (binary segmentation, ≥3wk sides, ≥4 mmHg, Welch t≥2, honest null); `services/story/bandRiver.ts` (client-computed weekly 28d bands over 6mo — instant backfill); `services/story/chapters.ts` + `storyCopy.ts`; migration 0058 re-enables Tier-C crons (weekly Mon 04:00, monthly 1st 04:15). Fix #26: resilient to prod-before-migrations (context_tags select retries without) + thin-data "Your story starts here" instead of hiding |

**PR-10 (Steadiness) is NOT built** — blocked on written counsel
sign-off per the founder's standing rule. `FF_STEADINESS` does not
exist yet; nothing to flip.

## On-device build state

- Founder's phone (43230DLJH001YY): **versionCode 13** = full
  integration branch. Boots clean, verified via logcat.
- Build recipe: `cd apps/mobile/android && set -a && source
  ~/secrets/leiko-release.env && set +a && LEIKO_VERSION_CODE=<n>
  ./gradlew assembleRelease && adb install -r
  app/build/outputs/apk/release/app-release.apk`. Keystore + creds:
  `~/secrets/leiko-release.{jks,env}`. Env baked from
  `apps/mobile/.env.local` (prod Supabase kqnzxjrpnjnczhgdwdqg).
  Version codes used so far: prod ledger shipped 7; local installs
  8–13. Next: 14.
- **Crash postmortem** (v8): worklets JS/native split-brain — the
  integration merge kept audit's react-native-worklets@0.5.1 pin
  beside main's hoisted 0.8.3. Fixed by matching main (single 0.8.3),
  commit 2583abd. Never re-pin worklets in apps/mobile/package.json.

## Release runbook (when the integration branch merges to main)

1. Migrations 0054–0058 auto-apply (db-migrate.yml, push to main).
2. **Deploy `detect-anomaly` immediately after** — 0054 drops the
   `bp_baselines` table (view replaces it) and the old deployed cron
   would fail its upsert.
3. Run `select public.invoke_detect_anomaly_cron();` once to populate
   `vital_baselines` (no backfill by design — clients ride provisional
   bands until then; PR-2 made the inline path read `vital_baselines`
   directly, so deploy sync + detect-anomaly together).
4. 0058 starts the weekly/monthly Sonnet crons (~5 calls/user/month).
   First Story letter appears after the first run.
5. Deploy `sync` (context_tags passthrough) with the rest.

## Deferrals / open items (v1.1 backlog)

- 1-person Home → renders PersonOverview directly; 6+ people → forced
  list with caption (§7.1a) — field's overflow marker keeps honesty
  meanwhile.
- Monitor-row sparklines for BP/HR/sleep/steps (SpO2 has one).
- Caregiver-side medication WRITES (needs wearer user-id plumbed to
  the client; RLS requires subject_id). Caregiver-side Story letter
  (narration cache is RLS'd to the user) — product/privacy decision.
- Honest-negative correlation rows surfaced in the drivers panel
  (copy exists in `correlationCopy.ts`).
- Reading-detail re-tagging entry point; tag-filtered chart captions.
- Remaining §9.1: announce-site completion, paywall-chip touch-target
  hunt (on-device), component-test a11y assertion template — rides
  the §14 device verification pass.
- Manufacturer-name sweep: 253 occurrences in the BLE layer, some
  functional in pairing — needs its own reviewed change. AI output is
  guarded by a layer-1 rule meanwhile. docs/ occurrences left for the
  founder.
- Activity weeks-vs-BP signature strip (renders the engine's gated
  findings — belongs with the drivers work).

## Founder review flags (need explicit eyes)

1. Story copy in `services/voice/storyCopy.ts` (commissioned
   2026-08-19) — read once on device.
2. Chapter thresholds: ≥4 mmHg, ≥3 weeks each side, Welch t≥2 —
   tuneable in `utils/changePoints.ts`.
3. Two §5.1 hexes lightened to pass the spec's own 4.5:1 floor
   (quarantine test pins relationships, not hexes).
4. "Diagnosed with hypertension?" allowlisted in copy-lint as
   doctor-attribution.
5. `is_sufficient` encodes the stricter §4.3 classification column
   (single boolean; band-only gate derivable from sample_count).

## Founder test round 1 (2026-08-19) — PR #27, merged; v14 on phone

- FIXED: Activity daily-average denominator bug (zero-step not-worn
  days polluted the narration average); BP/HR narration now compares
  against the truth-layer band (same as the chips).
- ADDED: DoctorLinkCard on every page (DetailShell slot); BP segments
  "All times" + tap affordance + caption; TimeOfDayRing compass words +
  caption; correlation-strip legend + how-to-read; HR what-moves
  evidence card; overview hero staged card; meds log subtitle.
- OPEN from the founder's list: item 4 depth (movement×HR strip needs
  a steps series in HRDetail), item 5 (cross-vital AI correlation
  matrix — engine expansion: pairs sleep→BP, sleep→restingHR,
  activity→restingHR, activity→BP, after-meds-tag→BP, each n≥14-gated,
  surfaced per-vital + Story drivers + the letter; brainstorm answer
  delivered, implementation next).

## Release state (2026-08-19) — DONE

- `redesign/vitals-layer-d13` → `main` MERGED as PR #29 (after the
  matrix, #28). versionCode 15, built from main, installed + verified.
- PROD RELEASE EXECUTED AND VERIFIED. See the release record at the top
  of this document for exactly what ran and what was found.
- The migration-history drift is FIXED, not worked around: the 19
  remote-only timestamp versions were removed from
  `supabase_migrations.schema_migrations` (their SQL stays applied) and
  0053–0058 recorded. **Proven green:** the `DB migrate (Supabase)`
  workflow was dispatched on main afterwards and succeeded (run
  32261764217) — the first green db-migrate since the drift appeared.
- `tools/release-d13.sh` is now STALE — supabase CLI v2.109 dropped
  `--project-ref` from `migration list` / `db push`, so its DB steps
  error out. Use `tools/prod-sql.py` (management API; reads LEIKO_PAT
  or the session file `~/secrets/leiko-pat`) and
  `tools/deploy-d13-fns.sh [fn …]` instead. Rewrite or delete the old
  script before anyone trusts it again.

### CI state on main (read before assuming you broke something)

- `lint`, `typecheck`, `test`, `copy lint (voice rules)`, and the Deno
  edge-function tests all PASS on main as of d184434.
- The `Audit (production deps, high+ severity)` step FAILS, and has
  failed continuously since at least 2026-08-14 — it predates every
  D13 commit. Cause: new advisories against toolchain packages
  (`@babel/core`, `brace-expansion`, `image-size` via metro/expo).
  `npm audit fix --force` would install expo@57, a breaking change, so
  it is NOT taken: the stack is pinned in docs/00-tech-stack.md and
  bumping needs a founder decision. **Open question for the founder:**
  bump the toolchain, or scope the audit step to runtime deps only?

## Built (was: approved-but-not-yet-built)

**The cross-vital correlation matrix SHIPPED (#28)**: six engine
pairs (sleep→BP, activity→restingHR, spo2→sleep existed; added
sleep→restingHR, movement→next-morning-BP, after-meds→BP as
point-biserial with per-group min 5), all gated n≥14/|r|≥0.3/p<0.05,
honest negatives persisted. `PersonalFindingsCard` (found / honest
negative / counting; never computes stats client-side) on BPDetail +
HRDetail; Trends cited cards know the new types; the weekly letter
inherits the matrix through the existing context assembler.

## Where new copy lives (for founder voice review)

- `services/voice/tierVocabulary.ts` — §7.4 verdict table.
- `services/voice/correlationCopy.ts` — §7.5 table + countdown.
- `services/voice/storyCopy.ts` — Story page (river caption, chapter
  sentences, steady/building lines).
- `utils/calibration.ts` LEARNING_COPY — §7.7 learning states.
- Inline, founder-commissioned round 1: DoctorLinkCard subtitle,
  MedicationSection subtitle, HRWhatMovesCard body, SpO2 explainer +
  no-alarm note, TimeOfDayRing + segment captions, correlation-strip
  how-to-read line, Activity goal framing.

## Next session, in order

1. **On-device live pass on v15** — now that prod serves real baselines,
   check that the vital pages show server bands (not provisional),
   that PersonalFindingsCard reaches its found / honest-negative /
   counting states on BP + HR, and that the context segments render.
   The first Story letter appears after the Monday 04:00 UTC weekly
   cron; correlations refresh hourly.
2. Decide the `npm audit` question (see CI state above) — it is the
   only red step on main.
3. Remaining founder review flags (§ above): storyCopy.ts strings,
   chapter thresholds (4 mmHg / 3 weeks / t≥2), the lightened §5.1
   hexes, the "Diagnosed with hypertension?" allowlist.
4. v1.1 deferrals as chosen. Version-code ledger: next install is 16.
5. Rewrite or delete `tools/release-d13.sh` (stale CLI flags).
