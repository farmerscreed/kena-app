#!/usr/bin/env node
/* eslint-disable no-console */
// Single-shot Android release driver.
//
//   npm run release:android:apk    → APK for sideload smoke tests
//   npm run release:android:aab    → AAB for Play Console upload
//
// What this script does, in order:
//   1) Verifies the four LEIKO_RELEASE_* env vars are set, the
//      keystore file exists, and the SHA-256 fingerprint does NOT
//      match the well-known Android debug keystore. Stops with a
//      readable error if any check fails.
//   2) Verifies EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY
//      are set, since the JS bundle will throw on boot without them.
//   3) Prints a summary the user has to ACK before the build runs.
//   4) Reads expo.version from app.json + LEIKO_VERSION_CODE from env
//      and patches android/app/build.gradle in place (versionName +
//      versionCode). Restores the original on exit so the diff isn't
//      committed by accident.
//   5) Runs the right gradle task and prints the artifact path.
//
// Why a wrapper around `./gradlew assembleRelease`: because the wrong
// keystore in the wrong env var produces an APK that the Play Store
// will silently reject weeks later. Loud-fail at minute zero.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const mode = process.argv[2];
if (mode !== 'apk' && mode !== 'aab') {
  fail('Usage: node scripts/release-android.js <apk|aab>');
}

// Pin Metro's server root to apps/mobile/ instead of letting Expo CLI
// walk up to the monorepo workspace root. Without this, production
// bundling via gradle's export:embed task breaks: the gradle plugin
// passes --entry-file index.js (relative to apps/mobile/) but Expo
// resolves it against the auto-detected workspace root, so it looks
// for kena-app/index.js and dies. The env var is the documented
// escape hatch from @expo/config/build/paths/paths.js:getMetroServerRoot.
process.env.EXPO_NO_METRO_WORKSPACE_ROOT = '1';

const APP_DIR = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(APP_DIR, 'android');
const BUILD_GRADLE = path.join(ANDROID_DIR, 'app', 'build.gradle');
const APP_JSON = path.join(APP_DIR, 'app.json');

// SHA-256 fingerprint of the well-known Android debug keystore that
// ships with every fresh RN project. If the release build comes out
// with this fingerprint, the Play Store will reject it on upload.
const DEBUG_KEYSTORE_SHA256 =
  '61:ED:37:7E:85:D3:86:A8:DF:EE:6B:86:4B:D8:5B:0B:FA:A5:AF:81:F8:69:8E:97:E8:8C:51:7E:BD:53:5B:78';

function fail(msg) {
  console.error(`\n× ${msg}\n`);
  process.exit(1);
}
function step(msg) {
  console.log(`\n→ ${msg}`);
}
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

// ---------- 1) Signing-config preflight --------------------------------------
step('Checking release signing configuration');
const requiredEnv = [
  'LEIKO_RELEASE_STORE_FILE',
  'LEIKO_RELEASE_STORE_PASSWORD',
  'LEIKO_RELEASE_KEY_ALIAS',
  'LEIKO_RELEASE_KEY_PASSWORD',
];
for (const k of requiredEnv) {
  if (!process.env[k]) {
    fail(
      `Env var ${k} is not set. Source your release-signing env (e.g. \`source .env.release\`) and re-run.`,
    );
  }
}
const storeFile = process.env.LEIKO_RELEASE_STORE_FILE;
if (!fs.existsSync(storeFile)) {
  fail(`Keystore file does not exist at LEIKO_RELEASE_STORE_FILE=${storeFile}`);
}
const keystoreBytes = fs.readFileSync(storeFile);
const fingerprint = crypto
  .createHash('sha256')
  .update(keystoreBytes)
  .digest('hex')
  .toUpperCase()
  .match(/.{2}/g)
  .join(':');
if (fingerprint === DEBUG_KEYSTORE_SHA256) {
  fail(
    'LEIKO_RELEASE_STORE_FILE points at the well-known Android debug keystore.\n' +
      'Generate a real keystore with `keytool -genkey -v -keystore leiko-release.jks ...` and try again.',
  );
}
ok(`keystore: ${storeFile}`);
ok(`fingerprint: ${fingerprint.slice(0, 23)}…  (not the debug key)`);

// ---------- 2) Runtime-env preflight -----------------------------------------
step('Checking runtime env vars baked into the JS bundle');
const runtimeRequired = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
];
const runtimeOptional = [
  'EXPO_PUBLIC_SENTRY_DSN',
  'EXPO_PUBLIC_POSTHOG_API_KEY',
  'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY',
];
for (const k of runtimeRequired) {
  if (!process.env[k]) {
    fail(`Required runtime env var ${k} is not set. The app would throw on boot.`);
  }
  ok(`${k}: set`);
}
for (const k of runtimeOptional) {
  if (process.env[k]) ok(`${k}: set`);
  else console.log(`  ⚠ ${k}: NOT set (feature will silently no-op in this build)`);
}
// PostHog accepts only project keys (phc_...) for ingest. A personal
// key (phx_...) initialises the client fine and then 401s on every
// capture — a build that looks instrumented and reports nothing
// (2026-08-14: every locally-built APK shipped blind this way).
const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
if (posthogKey && !posthogKey.startsWith('phc_')) {
  fail(
    `EXPO_PUBLIC_POSTHOG_API_KEY must be a project key (phc_...), got "${posthogKey.slice(0, 4)}...".\n` +
      'A personal (phx_) key is rejected by PostHog ingest with 401 — the build would ship with dead analytics.',
  );
}

// ---------- 3) Resolve versionName / versionCode -----------------------------
step('Resolving version');
const appJson = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
const versionName = appJson.expo.version;
if (!versionName) fail('app.json expo.version is missing');
const versionCode = parseInt(process.env.LEIKO_VERSION_CODE || '', 10);
if (!Number.isFinite(versionCode) || versionCode < 1) {
  fail(
    'LEIKO_VERSION_CODE env var must be set to a positive integer.\n' +
      'It must be strictly greater than the versionCode of every APK/AAB you have ever uploaded.',
  );
}
ok(`versionName: ${versionName}`);
ok(`versionCode: ${versionCode}`);

// ---------- 4) ACK gate ------------------------------------------------------
console.log('\nReady to build:');
console.log(`  • mode:        ${mode.toUpperCase()}`);
console.log(`  • versionName: ${versionName}`);
console.log(`  • versionCode: ${versionCode}`);
console.log(`  • keystore:    ${storeFile}`);
if (process.env.LEIKO_RELEASE_ACK !== 'yes') {
  console.log(
    '\nSet LEIKO_RELEASE_ACK=yes in this command to confirm and run.\n' +
      'Example: LEIKO_RELEASE_ACK=yes npm run release:android:' + mode,
  );
  process.exit(0);
}

// ---------- 5) Patch build.gradle in place (restore on exit) -----------------
step('Patching android/app/build.gradle versionName');
const original = fs.readFileSync(BUILD_GRADLE, 'utf8');
// versionCode is read directly from the LEIKO_VERSION_CODE env var by
// build.gradle (single source of truth) and inherited by the gradle
// subprocess below — so we no longer patch it here; the value validated
// above is passed straight through. We still pin versionName from app.json.
// Guard on pattern PRESENCE so a no-op patch (version already matches) is
// never mistaken for a missing pattern.
const versionNameRe = /versionName\s+"[^"]*"/;
if (!versionNameRe.test(original)) {
  fail('Could not find versionName pattern in build.gradle');
}
const patched = original.replace(versionNameRe, `versionName "${versionName}"`);
fs.writeFileSync(BUILD_GRADLE, patched);
const restore = () => {
  try {
    fs.writeFileSync(BUILD_GRADLE, original);
    console.log('  ✓ restored build.gradle');
  } catch {/* ignore */}
};
process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(130); });

// ---------- 6) Run gradle ----------------------------------------------------
const task = mode === 'aab' ? 'bundleRelease' : 'assembleRelease';
step(`Running ./gradlew ${task}`);
// Resolve the gradle wrapper to an absolute path. On Windows, spawnSync
// does not search the cwd for relative executables; without the absolute
// path it fails with status: null + error: ENOENT and no gradle output.
const gradlewExe = path.join(
  ANDROID_DIR,
  process.platform === 'win32' ? 'gradlew.bat' : 'gradlew',
);
const result = spawnSync(
  gradlewExe,
  [task, '--no-daemon'],
  {
    cwd: ANDROID_DIR,
    stdio: 'inherit',
    // Node 20.12+ refuses to launch .bat / .cmd directly without going
    // through cmd.exe (CVE-2024-27980 hardening). shell: true routes
    // the call through the platform shell which can resolve .bat.
    // Harmless on non-Windows.
    shell: process.platform === 'win32',
  },
);
if (result.error) {
  console.error(`\n  ✗ ${result.error.message}`);
  if (result.error.code === 'ENOENT') {
    console.error(
      `    Tried to launch: ${gradlewExe}\n` +
        `    Confirm the file exists and is executable.`,
    );
  }
  fail(`Gradle ${task} could not start`);
}
if (result.status !== 0) {
  fail(`Gradle ${task} failed with exit code ${result.status}`);
}

const artifactDir = mode === 'aab'
  ? path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'bundle', 'release')
  : path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release');
console.log('\n✓ Build succeeded.');
console.log(`  Artifact dir: ${artifactDir}`);
console.log(`\nNext: verify the signature with`);
const sample = mode === 'aab' ? 'app-release.aab' : 'app-release.apk';
console.log(`  apksigner verify --print-certs ${path.join(artifactDir, sample)}`);
