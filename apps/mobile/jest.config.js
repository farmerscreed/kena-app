// Two test projects:
//
//   "pure" — ts-jest, runs theme tokens, buildTheme, and any other framework-
//   free TypeScript test (formatters, validators, classification rules). No
//   React, no React Native; cheap to run.
//
//   "rn" — jest-expo, runs React Native component tests against
//   @testing-library/react-native. Workspace-aware via the broadened roots
//   (npm hoists expo/ to the monorepo root).
//
// Pure tests bypass jest-expo entirely because jest-expo's setup.js eagerly
// require()s expo/src/winter, whose lazy getters fire after teardown and
// throw "outside the scope of the test code" — the issue documented in
// memory/jest_expo_deferred.md. Splitting projects sidesteps it: pure tests
// never touch the winter polyfill.

// Pin the test timezone to UTC for every worker, deterministically.
// Set in the config (parent process, before workers fork) so each
// worker inherits TZ=UTC at startup — V8 binds Date's zone once at
// process init, so a setupFile is too late and an explicit host
// `TZ=...` would win. This makes snapshot/date tests render identically
// on CI (UTC) and a dev laptop in any zone. Per-user app timezone
// handling is unaffected — this only governs the test runner's clock.
process.env.TZ = 'UTC';

module.exports = {
  rootDir: __dirname,
  projects: [
    {
      displayName: 'pure',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: __dirname,
      roots: ['<rootDir>'],
      // Sprint 6: sync helpers transitively pull services/supabase
      // (via the readings store → postReading), which throws at module
      // load if EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are unset. Mirror
      // the rn-project's defaults so pure tests don't need a real
      // Supabase running.
      setupFiles: ['<rootDir>/jest.setup.pure.js'],
      // The pure project has no real react-native (it bypasses
      // jest-expo). The BLE foreground-service wrapper is the first
      // pure-graph module to import `react-native` — map it to a
      // minimal stub so ts-jest doesn't choke on RN's untransformed
      // ESM. Scoped to this project only; the rn project keeps the
      // real react-native from jest-expo.
      moduleNameMapper: {
        '^react-native$': '<rootDir>/jest/react-native.pure-mock.js',
      },
      testMatch: [
        '<rootDir>/__tests__/**/*.test.ts?(x)',
        '<rootDir>/src/theme/**/__tests__/**/*.test.ts?(x)',
        '<rootDir>/src/utils/**/__tests__/**/*.test.ts?(x)',
        '<rootDir>/src/services/**/__tests__/**/*.test.ts?(x)',
        '<rootDir>/src/state/**/__tests__/**/*.test.ts?(x)',
        // D13 PR-3 — the copy-lint gate's own tests.
        '<rootDir>/tools/**/__tests__/**/*.test.ts?(x)',
      ],
    },
    {
      displayName: 'rn',
      preset: 'jest-expo',
      rootDir: __dirname,
      roots: ['<rootDir>', '<rootDir>/../../node_modules'],
      setupFiles: ['<rootDir>/jest.setup.rn.js'],
      testMatch: [
        '<rootDir>/src/components/**/__tests__/**/*.test.ts?(x)',
        '<rootDir>/src/screens/**/__tests__/**/*.test.ts?(x)',
        '<rootDir>/src/dev/**/__tests__/**/*.test.ts?(x)',
        // Sprint 7.7a — hooks need React (useState/useEffect/useCallback)
        // so they run under the rn project; existing hooks (useFamilyReadings)
        // had no tests, useCaregiverViewMode is the first.
        '<rootDir>/src/hooks/**/__tests__/**/*.test.ts?(x)',
      ],
      testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
    },
  ],
};
