# Background sync — investigation + fixes, 2026-08-14

**Question asked:** "is the sync feature properly set up — the one that lets the app
sync with the watch even when the app isn't open but the watch is in proximity?"

**Answer as of this session: YES — verified working from a fully cold start.** It was
badly broken in four independent ways; all four are fixed, committed, and confirmed on
the bench. One contained bug remains (§6e). **Read §6 first if you are picking this up.**

The proof, 21:37 with the app killed (`am kill`) and no screen ever rendered:

```
21:37:27  Android wakes the app from nothing (fresh pid)
21:37:31  sync_started            trigger=background
21:37:32  BLE connect  → dumpsys AppRecord(21:37:32 ~ 21:45:04)
21:37:34  sync_completed          trigger=background  pulled=1
21:37:35  hr + 13× spo2 + activity + calories pulled
```

Nothing here is theory: every claim below is backed by a device log, a system
`dumpsys`, or a PostHog event, and the source of each is named.

---

## 1. Bench setup (reproduce before trusting anything)

| Thing | Value |
|---|---|
| Phone | Pixel 8, serial `43230DLJH001YY`, **Android 17** |
| App | `com.leiko.care`, versionName 1.0.0, **versionCode 5** |
| adb | `C:\Users\admin\AppData\Local\Android\Sdk\platform-tools\adb.exe` (on PATH-ish; call by full path) |
| Release env | `. C:\Users\admin\secrets\leiko-release.ps1` |
| Build | `$env:LEIKO_VERSION_CODE='5'; $env:LEIKO_RELEASE_ACK='yes'; $env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'; npm run release:android:apk` (~7 min) |
| Install | `adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk` — same signing key, so it upgrades in place with **no data loss and no re-pairing** |

### PowerShell gotchas hit repeatedly
- `... | Select-String ...` after a native exe → *"Cannot run a document in the middle
  of a pipeline"*. Filter **on the device** instead: `adb shell "... | grep -i leiko"`.
- Jest: the flag is `--testPathPatterns` (plural) on this version, not `--testPathPattern`.
- `adb logcat -d | Out-File ...` then Grep the file — piping logcat through PowerShell
  filters is unreliable.

---

## 2. Observability: analytics were dead, and that hid everything

**`EXPO_PUBLIC_POSTHOG_API_KEY` in `C:\Users\admin\secrets\leiko-release.ps1` was a
`phx_` PERSONAL key.** PostHog rejects personal keys for ingest (401), so **every
locally-built APK had zero analytics** while appearing configured. In the PostHog UI
the key showed as "never used".

`eas.json` already carried the correct `phc_` project key — the June fix
(`V5_RELEASE_2026-06-12.md`) only patched the cloud-build path and never reached the
local release script. **Fixed in the secrets file this session, with a comment.**

Correct project key: `phc_CEDLsBokrpgqiHYvWyzaHioSXnB5VvPDCfTjma9edPRe`
PostHog project id: **445851**. Account: `primethebrain@gmail.com`.

Worse, `services/analytics/posthog.ts` initialises the client whenever ANY key is
present, so `logger.track` believed it had a live client and the MMKV ring-buffer
fallback never engaged. Events went to a 401 void and are unrecoverable.

### Querying PostHog without the UI (this is how the diagnosis was actually done)
The personal `phx_` key is useless for ingest but **works for the read API**:

```bash
curl -s -H "Authorization: Bearer <phx_ key from leiko-release.ps1>" \
  "https://us.posthog.com/api/projects/445851/events/?after=2026-08-14T18:00:00Z&limit=100"
```
Filter one event type with `&event=sync_skipped`. Far faster than clicking the UI.

**Timezone trap:** PostHog timestamps are **UTC**; the phone is **Africa/Lagos
(UTC+1)**. Every "local" time in this doc is phone time.

**Flush behaviour:** events from a background run often do NOT reach PostHog until the
app is next foregrounded. Absence of events shortly after a background fire proves
nothing. **Bluetooth `dumpsys` is the trustworthy, app-independent signal.**

---

## 3. What was already correct (do not "fix" these)

- `LeikoBleForegroundService` — manifest `<service>` with
  `foregroundServiceType="connectedDevice"`, `stopWithTask="false"`, START_STICKY.
  The "KNOWN GAP: no `<service>` tag" warning in `SPRINT_18_VERIFICATION.md` Test 5 is
  **stale — the tag is present**. Update that doc.
- BLE permission split across Android versions, incl. `neverForLocation`.
- `expo-background-fetch` registered at 15 min, `stopOnTerminate:false`,
  `startOnBoot:true`. The OS alarm genuinely fires — verified many times.
- Remote-refresh server path (`send-push`, `request-sync`, cron) — untouched here.

---

## 4. The four defects

### D1 — Stale run wedges the engine *(commit `5419e88`, VERIFIED)*
A sync interrupted by backgrounding hangs forever: its connect/idle timeouts are JS
`setTimeout`s and **Android freezes RN timers** once the wake-up's budget expires. So
`status` stays `connecting`/`syncing` and every later trigger skips with
`already_running` until the app is next foregrounded.

Evidence: `sync_skipped {trigger:background, reason:already_running}` at 16:55 and
17:10 after a run wedged at ~16:40; BLE link held open 20 min
(`AppRecord … REASON_BINDER_DIED`). One run held the engine **47 minutes**.

This is almost certainly the mechanism behind the "synced on setup day then went ~23h
dark" report in `DEVICE_MIGRATION_HANDOFF_2026-06-10.md`.

Fix: `_runStartedAt` + `STALE_RUN_RESET_MS` (3 min) in `state/syncOrchestrator.ts`. A
later trigger presumes the run dead, releases device/timers, emits **`sync_stale_reset`**,
and proceeds. **Verified on-device:** a run stuck 795 s was reclaimed, next sync completed.

### D2 — Unbounded upload *(commit `5419e88`, root-caused from events)*
`supabase.functions.invoke` has **no timeout**. Precise trace of the 16:40 run:

```
16:40:45 sync_started background
16:40:47 sync_completed background      ← BP backlog done
16:40:48 vital_persisted hr
16:40:50-51 vital_persisted spo2 ×7
16:40:53 vital_persisted activity
16:40:54 vital_persisted calories       ← every BLE read finished
   …nothing. No vital_sync_accepted. The /sync POST never returned.
```

Fix: `services/sync/withTimeout.ts` (30 s) applied to `postMultiVitals` and
`postReading`. A timeout is not data loss — pending rows stay in MMKV and retry, and
uploads are idempotent.

### D3 — Headless wake had unhydrated stores *(commit `d9b629c`)*
`usePairing.pairedDevice` starts `null` and is only populated by `hydrate()`, called
from RootNavigator's mount effect. A headless run therefore finds no watch.

**Worse — silent data loss.** `useReadings.syncPending()` rewrites `pending` and
`recent` from in-memory state when it finishes. Starting empty it persists **two empty
arrays over MMKV**, destroying offline-captured readings and the cached recent list.
`runSync` calls `syncPending()` *before* the paired-device check, so every headless
fire hit this.

Fix: `state/hydrateForHeadlessRun.ts`, wired into the background task and into
`triggerRemoteRefresh` (which hydrated pairing only and had the same readings exposure).
Vitals slices need no equivalent — their `addPending` appends to an MMKV buffer and
re-reads it, so stale memory cannot clobber them.

### D4 — Tasks were defined inside a UI module *(commit `a76d8a0`, THE ROOT CAUSE)*
`App.tsx` (SEC-1 encrypted storage) only reaches `PostBootShell` — and therefore
`RootNavigator` — via a **dynamic import inside a `useEffect`**. A headless wake never
renders, so that effect never runs, so **`RootNavigator`'s module scope never executes
and `defineBackgroundSyncTask` is never called.** TaskManager fires a task with no
registered runner: nothing happens at all.

Evidence (20:55, after `am kill`):
```
20:55:41 Start proc 29710 … for broadcast {TaskBroadcastReceiver}
20:55:42 TaskService: Handling intent 'leiko.sync.backgroundFetch'
20:55:43-44 RN loads, ExpoModulesCore, NitroModules, RNSentry
20:55:44 RNSentry: currentActivity isn't available          ← no UI, as expected
   …then silence. No BLE. No analytics. No sync.
```

**Every background sync that ever "worked" ran in a process that still had the UI
loaded from an earlier app open.** From a genuinely cold start the feature has never
worked — i.e. after reboot, after OS memory reclaim, overnight. D1–D3 were real but
were all downstream of this.

Fix: `services/tasks/registerHeadlessTasks.ts`, called from **`index.js`**. Static
imports limited to task names + the two Expo packages; orchestrator/stores/logger are
**dynamic-imported inside the task bodies after `acquireMmkvKey()` resolves**, honouring
the SEC-1 ordering explicitly. A pending migration **skips** the run rather than working
across a half-migrated store. `RootNavigator` keeps OS-level *registration*
(`startBackgroundSync`, `registerRemoteRefreshTask`) — once-per-install and natively
persisted, so driving it from the UI is fine. Names live in `services/tasks/taskNames.ts`
so entry and owners cannot drift.

### Also changed
- **Background/remote runs no longer hold the live window.** They disconnect
  immediately instead of arming a 45 s idle timer a frozen JS context may never fire
  (which is how the link leaked for 20 min).
- **Settings → Watch → "Background updates"** row shows the Doze exemption state and
  taps through to fix it. The existing prompt appears once after pairing and is
  dismissible forever, so anyone who dismissed it — or paired before it shipped — had
  no way back to it.

---

## 5. Battery-optimisation exemption

Granted on the bench phone: `adb shell "cmd deviceidle whitelist +com.leiko.care"`,
confirmed via `dumpsys deviceidle whitelist | grep leiko` → `user,com.leiko.care,10481`.

Measurable effect: Leiko's alarm flags went **`0x0` → `0x8`**
(`FLAG_ALLOW_WHILE_IDLE_UNRESTRICTED`) — the OS stopped treating the sync as
deferrable. Worth checking on any device that reports missed syncs.

---

## 6. State at end of session — WHAT IS UNVERIFIED

| Item | Status |
|---|---|
| D1 stale-run watchdog | ✅ verified twice — a 795 s run reclaimed, and again unprompted at 21:45 (`sync_stale_reset trigger=cold_start`) |
| D2 upload timeout | ✅ root-caused from events; code + unit tests. No stalled upload observed since |
| D3 headless hydration | ✅ implied by the cold run finding the watch at all — `pairedDevice` came from MMKV with no UI |
| D4 entry registration | ✅ **VERIFIED — see the trace at the top** |
| Normal-boot data check after D4 | ✅ `sec1_boot_completed {encrypted:true, status:completed}` + `sec1_legacy_deleted`; readings/pairing intact |
| Committed + pushed to `main` | ✅ `5419e88`, `d9b629c`, `a76d8a0`, doc `e75bf47` |
| **Headless BP upload (§6e)** | ❌ **open — the one thing still broken** |
| Play/AAB | ❌ not built. Users are still on the old broken build |

Full suite green: **2527 tests / 219 suites**, typecheck clean.

### 6e. THE ONE REMAINING BUG — headless BP upload *(start here)*

In the verified cold run, one line spoils an otherwise clean sweep:

```
21:37:34  reading_sync_failed
          "postReading: no paired device on file for a watch reading"
```

The reading **was** pulled off the watch and saved locally; only its upload failed. It
went up at 21:45 when the app was next opened (`reading_sync_success`), so this is a
delay, not data loss — but it defeats the point of the feature for the BP reading
itself, which is the one thing a caregiver is waiting for.

**Cause — the same root as D4, in a second place I missed.** `services/sync/postReading`
does not read the pairing store directly (its header explains why: importing it would
drag react-native into the pure jest project). Instead it takes an injected lookup via
`setDeviceMetaProvider(...)`, and that injection lives in **RootNavigator's module
scope** — which, per D4, never executes on a headless wake. So the provider is unset,
`postReading` finds no device metadata, and throws. `postMultiVitals` is unaffected
because it receives its metadata as an explicit argument from the orchestrator, which
is why HR/SpO2/activity/calories all uploaded fine.

**Recommended fix** (small, mirrors what already works):

1. Extract the closure currently inlined in `RootNavigator.tsx` into
   `state/wireDeviceMetaProvider.ts` — it needs `usePairing`, `inferModel` and
   `getOrCreateClientDeviceId`, all storage-dependent, so it must stay lazy-imported.
2. Call it from **`state/hydrateForHeadlessRun.ts`**. That function is already the
   single "prepare the stores for a run with no UI" hook and is already invoked by both
   headless paths (background fetch and `triggerRemoteRefresh`), so one call site covers
   both. `setDeviceMetaProvider` just assigns a module-level function, so calling it
   again from RootNavigator is harmless — leave that call in place.
3. Test: assert `hydrateForHeadlessRun()` leaves `postReading` able to resolve device
   meta with no navigator mounted. Then re-run §6b and expect
   `reading_sync_success` **inside** the background run rather than at the next open.

Worth a sweep while you are in there: `setDeviceMetaProvider` is one instance of a
general pattern — *anything wired in RootNavigator module scope is invisible to a
headless run*. Grep that file's module scope for other one-time wiring and decide, for
each, whether a background run needs it.

### 6a. Encrypted-storage check — DONE, passed
`a76d8a0` touches the boot path guarding the **MMKV encryption key**, so this was
checked before anything else: PostHog shows
`sec1_boot_completed {encrypted:true, status:completed}` plus `sec1_legacy_deleted` on
the 21:45 open, and readings/pairing/settings were all intact. If a future change to
the entry path is suspected, that event is the authoritative signal; also
`adb logcat -d | grep -iE "sec1|mmkv|secureBoot"`.

### 6b. How to run the cold-start test (the one that matters)
```powershell
adb install -r <apk>                 # same key → upgrade in place
adb shell "am kill com.leiko.care"   # NOT force-stop: force-stop sets FLAG_STOPPED
                                     # and Android then blocks the app's alarms,
                                     # which rigs the test to fail
adb shell "pidof com.leiko.care"     # must be EMPTY
adb shell "dumpsys alarm | grep -A2 'com.leiko.care' | grep origWhen"   # ETA
```
Watch for the fire:
```bash
adb logcat -T 1 -v time | grep -m1 "Handling intent with task name 'leiko.sync"
```
Then judge it by **Bluetooth, not analytics**:
```
adb shell "dumpsys bluetooth_manager | grep 'AppRecord.*leiko' | tail -3"
```
**Pass = a new `AppRecord` with a start time after the fire.** Then foreground the app
to flush telemetry and expect `sync_started` / `sync_completed {trigger:background}`,
ideally `pulled>0`. Keep the watch physically next to the phone — out-of-range produces
the same "no connection" symptom as a code bug and will waste an hour.

### 6c. If a cold run does nothing (kept for reference — this is now the PASSING path)
Ordered suspects, cheapest first:
1. **Was the task actually defined?** `adb shell "dumpsys activity providers | grep -i taskmanager"` is weak;
   better, add a one-line Sentry breadcrumb at the top of the task body — Sentry
   initialises at App module scope and DOES work headless (proven: it logged at 20:55:44),
   so it is the only telemetry that survives a context torn down before PostHog flushes.
2. **BLE from a background process with no foreground service.** After `am kill` the
   BLE foreground service is NOT running (`dumpsys activity services com.leiko.care`
   was empty). Android may throttle or refuse a GATT connect from a bare background
   process. If so, the task should start `LeikoBleForegroundService` *first*, then
   connect. **This is the most likely remaining blocker and was never tested.**
3. Doze — but the exemption is granted and the alarm carries `0x8`, so unlikely.
4. `no_paired_device` — would mean D3's hydration is not taking effect.

### 6d. Known-good reference
Backgrounded-but-alive (process still had the UI loaded):
```
17:26:39 sync_started background
17:26:44 sync_completed background pulled=1
```
Fully cold (process killed, no UI ever rendered) — the case that never worked before:
see the trace at the top of this doc, plus
`dumpsys bluetooth_manager` → `AppRecord(21:37:32 ~ 21:45:04 … com.leiko.care)`.

**Timing trap when judging a run:** at 21:40 that connection did NOT yet appear in the
Bluetooth dump and PostHog was empty, which looked like a failure. Both showed up once
the app was foregrounded at 21:45. Give a cold run a few minutes and flush telemetry by
opening the app before concluding anything.

---

## 7. Follow-ups not done

- **Build + upload a vc6 AAB.** Founder deferred this until the fixes are done. Bump
  `LEIKO_VERSION_CODE` in `leiko-release.ps1` (currently 5; its comment history is
  stale, it says "bump to 5 before the next build after vc4").
- Multi-vitals still freezes mid-phase in background — D2 bounds it, but the run may
  still not finish its vitals leg before the OS pulls the context. HR/sleep catch up on
  the next cycle. Cosmetic, but it is why `vital_sync_accepted` can be missing.
- `SPRINT_18_VERIFICATION.md` Tests 2 + 5 result boxes are still blank and its Test 5
  "KNOWN GAP" is factually wrong now (see §3). `PRODUCTION_READINESS.md` FUN-8 can be
  closed once §6b passes.
- The `phx_`/`phc_` trap deserves a guard: `release-android.js` should reject a
  `EXPO_PUBLIC_POSTHOG_API_KEY` that does not start with `phc_`. Ten-line change,
  would have saved this whole detour.
