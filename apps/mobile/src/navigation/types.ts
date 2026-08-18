// Route type registry for typed navigation. The full nested shape lives
// here; screens import their specific NativeStackScreenProps from the
// per-stack types below.

import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  AccountTypeFork: undefined;
  SignUp: undefined;
  SignIn: undefined;
  OTPVerify: { email: string; mode: 'signup' | 'signin' };
};

// Sprint 3 — caregiver onboarding stack. Six screens per
// docs/04-screens/caregiver-onboarding.md (3 intros + 3 family-setup).
// Skip from Intro2/Intro3 routes to FamilyYou. Skip is NOT available
// during family-setup screens (4–6) per the spec.
export type CaregiverOnboardingStackParamList = {
  Intro1: undefined;
  Intro2: undefined;
  Intro3: undefined;
  FamilyYou: undefined;
  FamilyParent: undefined;
  FamilyWatch: undefined;
};

// Sprint 5 — added Pairing and Settings to the caregiver home stack.
// Pairing renders its own internal sub-view based on usePairing.phase
// (PowerOn / Searching / Found / Pairing / Success / Failure +
// PermissionPrime / BluetoothOff / PermissionDenied) so we don't push a
// new native stack screen for every state transition. Settings hosts
// the paired-devices list and the forget-watch flow.
export type CaregiverStackParamList = {
  // Sprint 7 — replaces the Sprint 2 placeholder. Family Circle list
  // of parents per docs/04-screens/caregiver-home.md.
  CaregiverHome: undefined;
  // Sprint 17a — per-person immersive dashboard. Replaces the Sprint 7
  // `ParentReadings` placeholder as the canonical tap-on-parent
  // target. Mirrors SelfBuyerHome but family-scoped to the tapped
  // parent's `familyId`.
  ParentDashboard: { familyId: string };
  // D13 PR-8 (§7.1) — level 2 of Home → Person Overview → Vital
  // Detail. Every person tap target routes here; isSelf travels with
  // the route (closes P2-8).
  PersonOverview: { familyId?: string; personName?: string; isSelf?: boolean };
  // Sprint 17a — caregiver entry to the parameterized VitalDetail
  // screens. The `familyId` is always set on this stack (the caregiver
  // is viewing a parent's data, not their own); the self-buyer stack
  // omits it. Reached only from ParentDashboard for now (sprint card
  // §4 — no other natural entry point in this stack).
  VitalDetail: {
    vital: 'bp' | 'hr' | 'spo2' | 'sleep' | 'activity';
    familyId: string;
  };
  // ADR-0008 follow-up — full-window browse for a vital + range ("View
  // all · N" on the detail screens). familyId + the wearer's timeZone are
  // resolved by the detail screen and passed through.
  VitalHistory: {
    vital: 'bp' | 'spo2' | 'sleep' | 'activity';
    range: '7d' | '30d' | '90d';
    familyId: string;
    timeZone: string;
  };
  // 2026-06-05 — in-app preview of the generated doctor PDF; Share hands
  // the local FILE to the OS sheet (the old link expired in 1 hour).
  PdfPreview: {
    fileUri: string;
    title: string;
  };
  Pairing: undefined;
  // Connect — optional invite param so a tapped join-link can deep-link
  // into Settings and auto-open the Enter-a-code sheet, prefilled.
  Settings: { inviteCode?: string } | undefined;
  // Sprint 6 — Take Reading + Reading Detail. ReadingDetail receives
  // the local id of the reading to display (UUIDv4 minted client-side
  // by the readings store; serverId is filled in once /sync acks).
  TakeReading: undefined;
  ReadingDetail: { readingLocalId: string };
  // Sprint 9 — multi-vital trends + correlation cards + doctor PDF
  // export per docs/04-screens/trends.md. Caregiver entry point will
  // be wired into a tab-bar follow-up; the route is registered now so
  // navigation.navigate('Trends') resolves from any caregiver screen.
  Trends: undefined;
  // Trends v2 follow-up — the doctor-PDF prep flow moved off Trends
  // into its own dedicated screen. Entry points: Settings → "For
  // your doctor", and Trends inline link near the bottom.
  ForYourDoctor: { range?: 'all_time' | '7d' | '30d' | '90d' | '1y' } | undefined;
  // Sprint 10b.3 — Activity log read-only viewer (last 90 days of
  // public.audit_log for the actor). Per D6 US-82.
  AuditLog: undefined;
  // Sprint 10c.2 — hybrid-mode caregiver visibility (D13 §13.2).
  // Self-buyer's parent-owner family management surface; caregiver-
  // mode users won't navigate here in v1 (their "shared with caregiver"
  // settings live elsewhere) but the route is registered in both
  // stacks so the navigator type unions are symmetric.
  CaregiverVisibility: undefined;
  // Sprint 10c.2 polish — read-only list of every member of the
  // active family circle, reached from Settings → Family.
  FamilyMembers: undefined;
  // Sprint 10c.2 polish — Learn home (cluster grid). Sprint 13
  // promotes this from a placeholder to the real cluster grid backed
  // by the precompiled article index.
  Learn: undefined;
  // Sprint 13 — article-list view for a single cluster.
  LearnCluster: { category: import('../services/learn/types').ArticleCategory };
  // Sprint 13 — full article reader. articleId matches frontmatter.id.
  Article: { articleId: string };
  // Sprint 11 — minimal "Ask Leiko" surface for the local intent
  // router. Sprint 12 layers Tier-B over the Tier-B placeholder.
  AskLeiko: undefined;
  // Sprint 19 — account switcher. Lists every email that has signed
  // in on this device; tap to sign out + OTP-in another. Reached
  // from Settings → Profile → "Switch account" and from the
  // "Signed in as X" chip at the top of Settings.
  AccountSwitch: undefined;
};

// Sprint 4 — self-buyer onboarding stack. Five screens per
// docs/04-screens/self-buyer-onboarding.md (3 intros + You + Watch).
// Skip available from Intro2 onward (mirrors caregiver pattern).
export type SelfBuyerOnboardingStackParamList = {
  Intro1: undefined;
  Intro2: undefined;
  Intro3: undefined;
  You: undefined;
  Watch: undefined;
};

// Sprint 8 — Self-Buyer Daily Pulse home replaces the Sprint 4 placeholder.
// `VitalDetail` is wired here so the constellation tiles can navigate; the
// real per-vital screens land in Sprint 8.5 (a placeholder is rendered for
// now). The placeholder route name is kept available so existing tests + dev
// flows don't break — it is no longer the initial route.
export type SelfBuyerStackParamList = {
  // ADR-0006 Phase 2/3 — the unified constellation home. Every user
  // (self-buyer included) now lands here; their own self-circle renders
  // as the "You" node. Reuses the caregiver CaregiverHome component +
  // ParentDashboard immersive detail, so both are registered on this
  // stack too. The legacy SelfBuyerHome stays registered as the "You"
  // node's personal detail target.
  CaregiverHome: undefined;
  ParentDashboard: { familyId: string };
  // D13 PR-8 (§7.1) — level 2 of Home → Person Overview → Vital
  // Detail. Every person tap target routes here; isSelf travels with
  // the route (closes P2-8).
  PersonOverview: { familyId?: string; personName?: string; isSelf?: boolean };
  SelfBuyerHome: undefined;
  SelfBuyerHomePlaceholder: undefined;
  Pairing: undefined;
  // Connect — optional invite param so a tapped join-link can deep-link
  // into Settings and auto-open the Enter-a-code sheet, prefilled.
  Settings: { inviteCode?: string } | undefined;
  TakeReading: undefined;
  ReadingDetail: { readingLocalId: string };
  // Sprint 17a — optional `familyId` for caregiver entry. When set, the
  // detail screen sources its data from the parent-scoped query layer
  // (`useParentDailyPulseData` + `useParentVitalsRecent`) instead of the
  // singleton slices. Unset → unchanged self-buyer behavior.
  VitalDetail: {
    vital: 'bp' | 'hr' | 'spo2' | 'sleep' | 'activity';
    familyId?: string;
  };
  // ADR-0008 follow-up — full-window browse for a vital + range ("View
  // all · N" on the detail screens). familyId here is the user's OWN
  // family, resolved by the detail screen; timeZone is the wearer's.
  VitalHistory: {
    vital: 'bp' | 'spo2' | 'sleep' | 'activity';
    range: '7d' | '30d' | '90d';
    familyId: string;
    timeZone: string;
  };
  // 2026-06-05 — in-app preview of the generated doctor PDF; Share hands
  // the local FILE to the OS sheet (the old link expired in 1 hour).
  PdfPreview: {
    fileUri: string;
    title: string;
  };
  // Sprint 9 — multi-vital trends + correlation cards + doctor PDF
  // export. The Self-Buyer Home tab bar's "Trends" entry routes here
  // (was a placeholder in Sprint 8).
  Trends: undefined;
  // Trends v2 follow-up — the doctor-PDF prep flow moved off Trends
  // into its own dedicated screen. Entry points: Settings → "For
  // your doctor", and Trends inline link near the bottom.
  ForYourDoctor: { range?: 'all_time' | '7d' | '30d' | '90d' | '1y' } | undefined;
  // Sprint 10b.3 — Activity log read-only viewer.
  AuditLog: undefined;
  // Sprint 10c.2 — hybrid-mode caregiver visibility (D13 §13.2).
  CaregiverVisibility: undefined;
  // Sprint 10c.2 polish — family members read-only list.
  FamilyMembers: undefined;
  // Sprint 10c.2 polish — Learn tab destination. Sprint 13 promotes
  // this to the real cluster grid backed by the precompiled article
  // index.
  Learn: undefined;
  // Sprint 13 — article-list view for a single cluster.
  LearnCluster: { category: import('../services/learn/types').ArticleCategory };
  // Sprint 13 — full article reader. articleId matches frontmatter.id.
  Article: { articleId: string };
  // Sprint 11 — minimal "Ask Leiko" surface for the local intent
  // router. Sprint 12 layers Tier-B over the Tier-B placeholder.
  AskLeiko: undefined;
  // Sprint 19 — account switcher, mirrored from the caregiver stack.
  AccountSwitch: undefined;
};

export type AuthScreenProps<R extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  R
>;

export type CaregiverScreenProps<R extends keyof CaregiverStackParamList> = NativeStackScreenProps<
  CaregiverStackParamList,
  R
>;

export type CaregiverOnboardingScreenProps<
  R extends keyof CaregiverOnboardingStackParamList,
> = NativeStackScreenProps<CaregiverOnboardingStackParamList, R>;

export type SelfBuyerScreenProps<R extends keyof SelfBuyerStackParamList> = NativeStackScreenProps<
  SelfBuyerStackParamList,
  R
>;

export type SelfBuyerOnboardingScreenProps<
  R extends keyof SelfBuyerOnboardingStackParamList,
> = NativeStackScreenProps<SelfBuyerOnboardingStackParamList, R>;
