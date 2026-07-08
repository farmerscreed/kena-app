# Launch Artifacts Log

Authoritative record of build artifacts produced for v1.0.0 launch.
Each entry captures: artifact URL, build profile, version code, target
backend, and what it gets used for. Sensitive creds (keystore
password / alias / key password) live in 1Password as
"Leiko Android Release Keystore" — never in this file.

Update this log every time a new build artifact is produced.

---

> ⚠️ **PACKAGE MIGRATED — read before using any entry below.**
> On 2026-06-09 (commit `777f26f`) the Android package was renamed
> `com.leiko.app` → **`com.leiko.care`** and the listing moved from the old
> personal `lawone-apps` Play account to the **corporate** Play account.
> `com.leiko.app` is **burned** (can't be reused). The rename created a
> brand-new Play listing, so the Android **versionCode ledger reset** to a
> fresh sequence — corporate codes (2, 3, 4…) are unrelated to the legacy
> `com.leiko.app` codes further down this file.
>
> versionCode is now **env-driven and single-source**: `build.gradle` reads
> `LEIKO_VERSION_CODE` (commit `aea14ce`); `release-android.js` no longer
> patches `build.gradle`. The release path is a local
> `gradlew bundleRelease` / `npm run release:android:aab`, so corporate
> builds have **no EAS artifact URL** — the signed `.aab` lands on the
> founder's build machine. `app.json:android.versionCode` is decorative for
> this path (kept in sync only so an accidental `eas build` can't leap the
> ledger).

## Android — corporate account (`com.leiko.care`) — CURRENT

> Expo owner `primethebrain`, projectId `84da2214-28a4-4605-941b-64662d72c1bc`.
> Signed with the corporate release keystore `~/secrets/leiko-release.jks`
> (1Password "Leiko Android Release Keystore"). Target backend: prod
> Supabase `kqnzxjrpnjnczhgdwdqg`.
>
> **Next upload:** bump `LEIKO_VERSION_CODE` to **8** before the next build — v7 (below) is built and pending upload to the **Open testing** track. (Codes 5 & 6 were already consumed on the corporate account, so this release ships as versionCode 7.)

### v7 — `.aab` · versionCode 7 — onboarding scroll fix + v5 remote-refresh/battery hardening

| Field | Value |
|---|---|
| **Artifact** | local build — `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` (~80 MB, 83,838,382 bytes) on the build machine (no EAS URL) |
| **Package** | `com.leiko.care` |
| **Build type** | `.aab` via `gradlew bundleRelease` (env-driven `LEIKO_VERSION_CODE=7`) |
| **versionName / versionCode** | `1.0.0` / `7` (codes 5 & 6 already consumed on the corporate account) |
| **Built** | 2026-07-08 |
| **Source** | `main` @ `0ff5951` (merge of `fix/vc5-live-bugs`); tree later lint-cleaned at `dae275c` (no app-code change) |
| **Signed** | corporate keystore `~/secrets/leiko-release.jks`, fingerprint `64:3C:19:3A:AA:D1:BE:75…` (not the debug key) |
| **Bundles** | **Onboarding fix** — intro screens now scroll so the CTA is never stranded off-screen on small devices / large OS fonts; all onboarding + auth screens migrated onto a shared `OnboardingScaffold`; font-scaling caps; back-chevron + backward-nav through intros; entrance transition (`687a6a2`→`8c31b54`). **Plus the v5 hardening already on main** — battery-optimization/Doze-exemption prompt after pairing (`156a9f3`/`3211c87`), silent-first remote refresh with visible fallback (`26ad5ed`), `LeikoPowerModule` + release-build fix (`5ff704e`), Expo access-token + Expo-ticket-status push fixes, PostHog project-key fix |
| **On-device** | Onboarding fix verified on Pixel 8 `43230DLJH001YY` (Android 16) at 1.5× font, 2026-07-08 — Welcome, Sign-up, Intro 1/2, and the You form all render with reachable CTAs |
| **Gates** | tsc 0 errors · eslint 0 errors / 0 warnings · 2,519 jest tests + 110 snapshots pass · `gradlew bundleRelease` SUCCESSFUL |
| **Play status** | ⏳ Built; **pending upload to the corporate Open testing track** (versionCode 7) |
| **Used for** | The v5 release — fixes the client-blocking onboarding scroll bug and hardens background/remote-refresh sync |

### v4 — `.aab` · versionCode 4 — remote-refresh silent push + corporate/FCM migration

| Field | Value |
|---|---|
| **Artifact** | local build — `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` on the build machine (no EAS URL) |
| **Package** | `com.leiko.care` |
| **Build type** | `.aab` via `gradlew bundleRelease` (env-driven `LEIKO_VERSION_CODE=4`) |
| **versionName / versionCode** | `1.0.0` / `4` |
| **Built** | 2026-06-10 |
| **Bundles** | Corporate/FCM migration (`777f26f` rename · `18d0ee5` FCM via google-services · `1f6789d` assetlinks fingerprints · `50364cf` Expo projectId link — the root-cause fix for empty `push_tokens`) + remote-refresh silent push (`a390af3`/`fa90c5c`/`d2b0f8d` phases 1-3 · `bc1b3a0` vault-based stale-sync cron + `pg_net`) |
| **Installed** | Sideloaded on both bench phones, both reporting vc4: Pixel 8 `43230DLJH001YY` (`lawonecloud@gmail.com`, wearer) + OnePlus CPH2551 `c4f40da1` (`lawonecloud+caregiver@gmail.com`, caregiver) |
| **Play status** | ✅ Uploaded to the corporate **Open testing** track — confirmed as the highest uploaded versionCode = 4 (Play Console, 2026-07-08). The live open-test build until vc5 is uploaded. |
| **Used for** | On-device validation of remote-refresh — the headline unproven path: does a silent push wake a backgrounded/killed wearer phone and trigger a BLE sync? |

### v3 — versionCode 3 — superseded, do not ship

| Field | Value |
|---|---|
| **Package** | `com.leiko.care` |
| **versionCode** | `3` |
| **Status** | **Superseded by vc4.** Built before the Expo projectId link (`50364cf`) and the remote-refresh receiver wiring, so push-token registration was broken (`push_tokens` was empty → a silent push could never reach a device). Never ship vc3. |

### v2 — `.aab` · versionCode 2 — corporate open testing (live)

| Field | Value |
|---|---|
| **Package** | `com.leiko.care` |
| **versionName / versionCode** | `1.0.0` / `2` |
| **Built** | 2026-06-09 |
| **Play status** | Uploaded to the corporate **Open testing** track (live as of 2026-06-09). Presumed still the live build until vc4's upload is confirmed. |
| **Note** | Predates the remote-refresh silent-push feature. |

---

## Android — legacy personal account (`com.leiko.app`) — HISTORICAL

> ⚠️ These entries are the **OLD** personal `lawone-apps` account ledger for
> the now-burned package `com.leiko.app`. Kept for history only. Their
> versionCodes are **unrelated** to the corporate ledger above, and the EAS
> `appVersionSource: remote` / autoIncrement model described here is no
> longer in use.

### v1.0.0 (versionCode 2) — production `.aab` for Play Console

| Field | Value |
|---|---|
| **Artifact URL** | https://expo.dev/artifacts/eas/5n4GUMxhcrLa5Z6Cgz9Cqr.aab |
| **EAS profile** | `production` |
| **Build type** | `app-bundle` (Android App Bundle) |
| **versionName** | `1.0.0` |
| **versionCode** | `2` (auto-incremented from `1`) |
| **EAS credentials slot** | `Build Credentials 5ZIwDWM1fJ` (default) |
| **Built** | 2026-05-20 |
| **Target backend** | prod Supabase `kqnzxjrpnjnczhgdwdqg.supabase.co` |
| **Anon key (in binary)** | `eyJ...8aSY` (last 4 chars — full key in `eas.json` production env, public by design) |
| **Status** | Awaits upload to Play Console → Internal Testing track |
| **Used for** | Submitting to Play Store via `eas submit` or manual upload. Not directly installable on a phone — `adb install` rejects AAB. |

### v1.0.0 (versionCode 3) — production-apk `.apk` for bench install

| Field | Value |
|---|---|
| **Artifact URL** | https://expo.dev/artifacts/eas/kQ5uMNfwz7P6517WuvkAbW.apk |
| **Build logs** | https://expo.dev/accounts/lawone-apps/projects/leiko/builds/a0941b42-c9bf-47ac-b2b7-6c64d59acf0a |
| **EAS profile** | `production-apk` (extends `production`, overrides `buildType: apk`) |
| **Build type** | `apk` (single-file install) |
| **versionName** | `1.0.0` |
| **versionCode** | `3` (auto-incremented after the AAB's `2`) |
| **EAS credentials slot** | Same as the AAB above |
| **Built** | 2026-05-20 |
| **Target backend** | prod Supabase `kqnzxjrpnjnczhgdwdqg.supabase.co` |
| **Status** | Built; installed on Phone 1; signup walked end-to-end. **Superseded** by v4 below (containing the 9 audit-pass fix buckets). |
| **Used for** | First-pass smoke test on Phone 1. Revealed 9 buckets of bench bugs, all closed in commits `8d8000b` → `316301a`. |

### v1.0.0 (versionCode 11) — production-apk `.apk` with Block 8 onboarding-recovery hotfix

| Field | Value |
|---|---|
| **Artifact URL** | ⏳ Build in progress |
| **Build logs** | https://expo.dev/accounts/lawone-apps/projects/leiko/builds/fae73445-d485-4e6a-b0cb-736b1288aaed |
| **Build ID** | `fae73445-d485-4e6a-b0cb-736b1288aaed` |
| **EAS profile** | `production-apk` |
| **Build type** | `apk` |
| **versionName** | `1.0.0` |
| **versionCode** | `11` (auto-incremented from `10`) |
| **Built** | 2026-05-24 evening (queued) |
| **Target backend** | prod Supabase `kqnzxjrpnjnczhgdwdqg.supabase.co` |
| **Branch tip when built** | `ba90a1d` |
| **Bundles** | Carries everything in v7 (vc10) plus: Block 8 onboarding-recovery hotfix (checkOnboardingState now uses get_user_onboarding_state() SECURITY DEFINER RPC instead of direct family_members query; bypasses RLS timing / supabase-js quirks; also seeds MMKV.currentFamilyId from the server so the user lands in the right family on fresh install) |
| **Migration dependency** | `0026_get_user_onboarding_state.sql` MUST be applied to prod first — applied 2026-05-24 evening |
| **Used for** | Phone 1 fresh-install retest (replaces v7 install which was stuck routing through onboarding for lawonecloud) |

### v1.0.0 (versionCode 10) — production-apk `.apk` bundling Sprint 19 close-out + doctor PDF v2

| Field | Value |
|---|---|
| **Artifact URL** | ⏳ Build in progress |
| **Build logs** | https://expo.dev/accounts/lawone-apps/projects/leiko/builds/6d59adad-530b-42c1-b53a-2e72015afe50 |
| **Build ID** | `6d59adad-530b-42c1-b53a-2e72015afe50` |
| **EAS profile** | `production-apk` |
| **Build type** | `apk` |
| **versionName** | `1.0.0` |
| **versionCode** | `10` (auto-incremented from `9`) |
| **EAS credentials slot** | Same as v3 / v4 / v5 / v6 |
| **Built** | 2026-05-24 (queued) |
| **Target backend** | prod Supabase `kqnzxjrpnjnczhgdwdqg.supabase.co` |
| **Branch tip when built** | `bcde4f9` |
| **Bundles** | Carries everything in v6 (vc9) plus: Android Share.share URL-in-message fix (PDF link actually shares to Android targets now); doctor PDF v2 — all 10 founder-review items (activity steps bug fix, sufficiency flags, per-vital clinical-context paragraphs, cover Executive Summary, BP-flag chips, cross-vital sufficiency footnote, running page header, layout density, reference footnotes, structured clinical-context fields on the For Your Doctor screen) |
| **Migration dependency** | None new (`0024_caregiver_relationship_label.sql` + `0025_storage_reports_bucket.sql` already applied to prod) |
| **Edge Function dependency** | `generate-doctor-pdf` already deployed at v13 carrying the v2 template + rasterizer X-API-Key fix |
| **Used for** | Phone 1 in-place upgrade — bench-test the redesigned doctor PDF end-to-end (generate, share to Android target, open the PDF, verify Executive Summary + clinical-context paragraphs + flag chips render with real data) |

### v1.0.0 (versionCode 9) — production-apk `.apk` bundling Sprint 19 (multi-account + caregiver model)

| Field | Value |
|---|---|
| **Artifact URL** | https://expo.dev/artifacts/eas/25T2boRd5neco7rDC2gYDN.apk |
| **Build logs** | https://expo.dev/accounts/lawone-apps/projects/leiko/builds/08c78e5e-f17b-4122-8419-8ce434659c18 |
| **Build ID** | `08c78e5e-f17b-4122-8419-8ce434659c18` |
| **EAS profile** | `production-apk` |
| **Build type** | `apk` |
| **versionName** | `1.0.0` |
| **versionCode** | `9` (EAS ledger advanced 6 → 9 across retries for transient GraphQL errors before the queue succeeded; vc7 + vc8 never produced artifacts) |
| **EAS credentials slot** | Same as the AAB / APK v3 / APK v4 / APK v5 |
| **Built** | 2026-05-23 |
| **Target backend** | prod Supabase `kqnzxjrpnjnczhgdwdqg.supabase.co` |
| **Branch tip when built** | `ed0179f` |
| **Bundles** | Sprint 18 audit fixes (v4) + Sprint 18 sleep wake-time fix (v5) + Halo Ember icon (v5) + Sprint 19 Blocks 1-7: SELF-label hidden, +Add owner-gate, Care-for-another-person flow, Edit-family-details, Account switcher, Per-caregiver relationship label (with prod migration `0024_caregiver_relationship_label.sql` applied), real APP_VERSION + leiko.health URLs |
| **Migration dependency** | `0024_caregiver_relationship_label.sql` MUST be applied to prod before install — verified 2026-05-23 via SQL probe (column exists, type=text, nullable=YES) |
| **Edge Function redeploy** | `accept-family-invite` SHOULD be redeployed so v6's `caregiverRelationshipLabel` body field is honored; pending founder ops |
| **Used for** | Phone 1 in-place upgrade install; Phone 2 retest of caregiver invite flow with the relationship-label chip |

### v1.0.0 (versionCode 6) — production-apk `.apk` bundling sleep fix + Halo Ember icon

| Field | Value |
|---|---|
| **Artifact URL** | https://expo.dev/artifacts/eas/4VVXDDJ94EJagv53T1ymbw.apk |
| **Build logs** | https://expo.dev/accounts/lawone-apps/projects/leiko/builds/1fd316e9-0e6f-4e1d-9daf-bd157d5aea92 |
| **EAS profile** | `production-apk` |
| **Build type** | `apk` |
| **versionName** | `1.0.0` |
| **versionCode** | `6` (EAS remote ledger bumped from `5` — an interim build burned vc5 between v4 and this one; ledger advances even for cancelled / failed builds) |
| **EAS credentials slot** | Same as the AAB / APK v3 / APK v4 |
| **Built** | 2026-05-22 |
| **Target backend** | prod Supabase `kqnzxjrpnjnczhgdwdqg.supabase.co` |
| **Status** | Queued. Two source commits on `claude/competent-goldberg-737194`: `8959347` (sleep wake-time fix via HR-derived inference) + `49a65fa` (Halo Ember launcher icon + Android adaptive icon). |
| **Branch tip when built** | `49a65fa` |
| **Why we're skipping v4 install** | Phone 1 is on v3; jumping straight to v5 lets us upgrade in one cycle (v3 → v5) instead of two (v3 → v4 → v5). v4 APK was downloaded by founder but never installed. |
| **Bundles** | All 31 audit findings from v4 + Sprint 18 sleep wake-time fix (HR-inferred wake + tz-aware display + Option-B historical backfill) + Halo Ember launcher icon (legacy mipmaps × 5 densities + Android adaptive icon layers + descriptors) |
| **Used for** | Phone 1 in-place upgrade install; full regression of 5 vital detail screens + the 9 audit-pass buckets + sleep wake-time spot-check + launcher icon eyeball |

### v1.0.0 (versionCode 4) — production-apk `.apk` with audit-pass fixes — superseded by v5

| Field | Value |
|---|---|
| **Artifact URL** | https://expo.dev/artifacts/eas/bnwdtRMddqpEgpRsKt9xpS.apk |
| **Build logs** | https://expo.dev/accounts/lawone-apps/projects/leiko/builds (find by tip `316301a`) |
| **EAS profile** | `production-apk` |
| **Build type** | `apk` |
| **versionName** | `1.0.0` |
| **versionCode** | `4` (autoIncrement from previous v3) |
| **EAS credentials slot** | Same as the AAB / APK v3 |
| **Built** | 2026-05-22 |
| **Target backend** | prod Supabase `kqnzxjrpnjnczhgdwdqg.supabase.co` |
| **Status** | Built; **NOT installed** — founder chose to skip ahead to v5 to bundle the sleep wake-time fix + icon in one upgrade cycle. APK file lives at `%USERPROFILE%\Downloads\leiko-v1.0.0-vc4.apk` on the founder's machine in case v5 has issues and we need to fall back. |
| **Branch tip when built** | `316301a` (audit-pass complete; next commit was `2919a71` docs only) |
| **Bundles 31 audit findings** | SelfBuyerHome pair-watch · ReadingDetail back/close · Settings refresh · Sleep/HR/BP/SpO2/Activity full audits · ParentDashboard load/error · ghost-button removal |
| **Used for** | Block 4 re-smoke-test on Phone 1 + full regression of the 5 vital detail screens; if clean, this is the artifact that goes to internal-beta testers via Drive link. |

---

## iOS

_No iOS builds yet — Block 6.1 Apple Developer entitlements + `expo prebuild --platform ios` (needs a Mac) must land first. Track on next addition._

---

## Submission state

| Store | Track / Tier | Status | First submission |
|---|---|---|---|
| Play Store | Internal Testing | ⏳ Not yet uploaded | TBD |
| Play Store | Closed Testing (Alpha) | ⏳ Not yet | TBD |
| Play Store | Production | ⏳ Not yet | TBD |
| App Store | TestFlight Internal | ⏳ Awaits iOS build | TBD |
| App Store | TestFlight External | ⏳ Awaits iOS build | TBD |
| App Store | Production | ⏳ Not yet | TBD |

---

## Notes

- **AAB vs APK:** Play Store wants AAB (smaller install footprint, per-device APK splitting). adb wants APK (single-file install). Same keystore signs both — they're equivalent artifacts from a signing-identity perspective.
- **versionCode source of truth (current):** the `LEIKO_VERSION_CODE` env var, read directly by `build.gradle` at build time. `eas.json` is now `appVersionSource: local` with autoIncrement **dropped** — the old remote-ledger model below this line is historical. Bump `LEIKO_VERSION_CODE` for every Play upload (must exceed the highest code already on the `com.leiko.care` track). `versionName` (`1.0.0`) lives in `app.json:expo.version`; `app.json:android.versionCode` is decorative for the local-gradle path.
- **Anon key in binary is fine:** `EXPO_PUBLIC_SUPABASE_ANON_KEY` ships in every APK; it's a public client key, RLS is the actual security boundary. Service role key, DB password, third-party API keys never enter the binary — they're in supabase secrets (server-side) + GitHub Actions secrets (CI).
- **Keystore loss = nuclear:** the corporate release keystore is the local `~/secrets/leiko-release.jks` (master copy in 1Password "Leiko Android Release Keystore"). Lose both the local file AND the 1Password backup and `com.leiko.care` can never be updated on the Play Store again. A third copy on an encrypted external drive would not be overkill. (The old EAS-managed `Build Credentials 5ZIwDWM1fJ` slot belonged to the burned `com.leiko.app` personal account.)
