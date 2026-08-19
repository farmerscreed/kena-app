# npm audit allowlist

Last audited: **2026-08-19**

## How this works now

The allowlist used to live only in this document while CI ran a bare
`npm audit --omit=dev --audit-level=high`. Nothing connected the two,
so when new high/critical advisories landed on build tooling in
August the gate went red and stayed red — five days of a check that
could no longer tell anyone anything.

The allowlist is now executable: `apps/mobile/tools/audit-gate/`.
CI runs `npm run audit-gate --workspace=apps/mobile`.

- `allowlist.ts` holds the entries, each with a reason and a
  `reviewBy` date. Past that date the gate fails on it again, so a
  suppression cannot outlive its reasoning.
- `index.ts` fails the build on any high/critical advisory filed
  against a package that has no current entry.
- Advisories a package merely *inherits* from a dependency are not
  counted twice. Without that, `react-native` is reported as
  vulnerable because its CLI plugin has a finding — which is how the
  old output reached 33 entries from 11 real ones.

## Why --omit=dev was the wrong question

`--omit=dev` filters *our* devDependencies. It does not filter the
build toolchain, because Expo declares `@expo/cli`, Metro and Babel
as runtime `dependencies` of `expo`. Auditing production dependencies
therefore audits the machine that builds the app, not the app.

The right question is whether an advisory can reach the shipped APK.
The APK contains the emitted JS bundle plus native libraries; Metro,
Babel and the Expo CLI are not in it.

## Never run `npm audit fix --force` on this repo

npm resolves the current findings by **downgrading react-native from
0.81.5 to 0.72.17** and Expo to SDK 57, and by downgrading
`react-native-health-connect` below its current pin. That would
destroy the New Architecture setup the app depends on. Verified
2026-08-19.

`npm audit fix` without `--force` is also unusable here: it tries to
move `expo` and hits peer conflicts across every `expo-*` package.

## Current entries

Nine packages, all build-time or test-time, all expiring 2026-11-30:
`@babel/core`, `brace-expansion`, `image-size`, `js-yaml`, `nanoid`,
`postcss`, `shell-quote`, `tar`, `undici`, `ws`. Each carries its own
reason in `allowlist.ts` — read them there rather than duplicating
them here, so there is one source of truth.

`js-yaml` is the one worth explaining twice. Our own devDependency
was bumped 4.1.1 → 4.3.1 on 2026-08-19, which patches it. The copy
still flagged is `js-yaml@3.14.2` nested under
`@istanbuljs/load-nyc-config`, pulled in by `react-native` →
`babel-jest` → `babel-plugin-istanbul` for coverage runs. npm
`overrides` do not reach it in this workspace layout — package-scoped,
nested and version-scoped forms were all tried and none changed the
resolved version. It parses our own coverage config and never ships.

## The standing remediation

Expo SDK 54 → 57 clears most of the toolchain set at once. That is
scoped work with a device-regression pass, not a dependency bump:
it moves React Native, and the native module pins in
docs/00-tech-stack.md (reanimated 4.1.7, gesture-handler 2.28.0,
MMKV 4.x, ble-plx 3.x, healthkit, health-connect, Sentry) are tied to
SDK 54 by ADR-0002 and ADR-0004. Plan it as its own sprint.

## Adding an entry

Don't, unless you can say why the advisory cannot reach the shipped
app. If you cannot, fix the dependency instead. The allowlist is a
record of decisions, not a backlog.
