# CLAUDE.md — Leiko App Operating Manual
 
You are working on Leiko, a caregiver-mode blood pressure monitoring mobile app
built on a Urion U16 family BP smartwatch (FDA-listed, EU MDR Class IIa).
 
## How every session starts
 
1. Read this file (CLAUDE.md) in full.
2. Read the active sprint card in plans/ (the one we're working on).
3. Read the docs/ files referenced by the sprint card. Do not read others.
4. Output a proposal:
   - Ordered list of tasks you'll do, in order
   - Ambiguities or missing info that would block you (ask, don't guess)
   - The verification step you'll run after each task
5. Wait for approval. Do not write code yet.
6. After approval: execute, test against the sprint's acceptance criteria,
   demo, commit.
 
If a sprint feels too big to do in one session, say so before starting.
Better to split than to half-finish.
 
## What you're building
 
A React Native (Expo bare) app that pairs with a BP smartwatch over BLE,
displays readings to caregivers (or self-buyers, or both), tracks trends,
warns about anomalies, educates the user, and keeps families connected
across distance.
 
Two markets: Nigeria and the United States. Three personas: caregiver
(default), self-buyer, parent (the elder being cared for, large-text
mode). All three live in one codebase, switched by an immutable
`account_type` field set during onboarding.
 
## Stack (locked — do not propose alternatives without raising it first)
 
- React Native via Expo bare workflow
- TypeScript strict mode
- Zustand for state, MMKV for local persistence (offline-first)
- Supabase: Postgres, Auth, Storage, Edge Functions
- BLE: react-native-ble-plx, with the Urion U16 protocol in docs/06-ble-protocol.md
- Push: Expo notifications + APNs/FCM
- AI: LiteLLM proxy, Haiku 4.5 for most queries, Sonnet 4.6 for complex
- Payments: RevenueCat (iOS + Android in-app purchases)
- Analytics: PostHog (privacy-respecting, self-hosted option for HIPAA later)
- Test: Jest + React Native Testing Library; Maestro for E2E (Sprint 17 only)
- CI: GitHub Actions
 
Versions are pinned in docs/00-tech-stack.md. If a version doesn't match,
that's a bug. Don't bump.
 
## What lives where
 
- docs/ — the spec, sliced. Concern-per-file. Don't load anything you
  don't need.
- plans/ — sprint cards. The active one is your job; the rest are context
  about what came before and what's next.
- apps/mobile/src/ — the app. Folder structure is fixed; don't invent new
  top-level folders without updating this file.
- supabase/ — migrations, edge functions, seed data.
 
## Voice rules (every user-visible string passes these)
 
The full rules are in docs/05-voice-and-claims.md. The short version:
 
FORBIDDEN words and phrases:
- "patient" (use "Mum" / "Dad" / "your parent" / "you")
- "diagnose", "diagnosis", "diagnostic", "treat", "treatment", "cure"
- "predict", "prevent" (when applied to disease)
- "silent killer", "ticking time bomb", "before it's too late"
- "medical advice" (we don't give it)
- "dangerous level", "critical level"
- Any phrase that promises an outcome ("will lower your BP", "will help
  you live longer")
 
PREFERRED patterns:
- Lead with the answer. First sentence resolves the question.
- Plain language before clinical terms. ("The first number" before "systolic")
- "Talk to your doctor" — not "consult a healthcare provider"
- Calm, warm, dignified. No fear language.
 
If a string fails any of these, fix it before commit. If you're not sure,
ask.
 
## Anti-patterns (Leiko visual & UX)
 
From docs/02-design-tokens.md and docs/04-screens/. Do not:
 
- Use red for normal-state UI. Red is for confirmed-urgent only.
- Show count badges, "new" dots, or unread indicators on Learn cards.
- Add fear-based push notifications.
- Skip the empty state. Every screen has one.
- Use `localStorage` or `sessionStorage` — we use MMKV.
- Auto-fill medical data fields based on prior values.
- Make the "Take a reading" CTA smaller than the spec says.
- Animate anomaly banners aggressively. Calm-before-clever.
 
## Data rules
 
- account_type is IMMUTABLE after onboarding. There is no migration path
  between caregiver and self-buyer; if the user wants to switch, they
  start a new account. Per D8a §14.1.
- Reading values (BP, HR, SpO2) NEVER appear in analytics events. Per
  D7 §7 + D9 §8.6.
- HIPAA scope: we are NOT a covered entity for the DTC path. We still
  encrypt at rest and in transit. Per D3.
- Offline-first: every reading is saved to MMKV before any sync attempt.
  Sync is best-effort. The app must function with no network.
- Connect invites are a single-use 6-digit code: 7-day expiry, accept
  attempts rate-limited server-side (invite_accept_attempts). There is
  NO email-match gate at accept time (founder decision 2026-08-14,
  Connect Phase A — reverses the 2026-06-02 call). Share messages are
  code-first; /join URL-token links are dormant until Phase C fixes the
  whole link chain end-to-end.
 
## Testing standard
 
Every sprint produces tests. The bar is:
 
- Unit tests for any pure function (formatters, validators, classification)
- Component tests for any new component (renders, props, accessibility label)
- Integration tests for any flow that crosses 2+ screens
- E2E tests are Sprint 17 work, not per-sprint
 
A sprint is not done until tests pass in CI.
 
## Commit convention
 
Conventional Commits. The body references the sprint card and any docs/
files that influenced the change.
 
Example:
```
feat(onboarding): add account_type fork screen
 
Implements D6 US-1 and D8a §3. account_type is set here and
becomes immutable after this commit.
 
Sprint: 02
Docs: docs/04-screens/onboarding-fork.md, docs/05-voice-and-claims.md
```
 
One logical change per commit. Don't bundle unrelated work.
 
## Ask, don't guess
 
If a docs/ file says one thing and a sprint card says another, raise it.
If a string isn't in the spec, raise it. If a library would solve the
problem but isn't in the stack, raise it. If you're about to make a data
model change, raise it.
 
The right move is always: stop, summarise the ambiguity, ask. The
founder is faster at resolving ambiguity than you are at recovering from
having guessed wrong.
 
## Agent orchestration

The main thread (this conversation) is the only place context
aggregates. Subagents — `Explore`, `Plan`, `general-purpose`, and any
future custom agents in `.claude/agents/` — are stateless one-shot
workers. They don't see each other; they don't see prior chat; they
only see what the brief tells them. Main thread is the conductor.

### Non-delegable (main thread always)
- The session-start protocol (read CLAUDE.md + the active sprint card +
  the docs/ files the card references). Quality control of agent
  output depends on main-thread context — you can't QA what you
  didn't read.
- Plan proposal + user approval before any code is written.
- Integration: merging agent outputs into the working tree.
- All quality gates: lint, typecheck, test, voice-rule pass on every
  user-visible string.
- All commit messages, commits, and pushes.
- ADRs and any data-model change.

### When to delegate
- **Bounded research** across >3 files → `Explore` agent.
- **Implementation strategy / architecture review** → `Plan` agent
  (one shot, then review + decide).
- **Independent unit implementation** (one component, one screen, one
  edge-function file) → `general-purpose` agent. Fan out 3–5 in
  parallel max; review queue backs up above that.
- **Don't bother** for sprints with ≤3 independent units — coordination
  overhead exceeds gains.

### How to brief an agent
Every brief is self-contained because the agent has no chat history.
Include:
- Exact spec doc(s) to read.
- Voice rules (`docs/05-voice-and-claims.md`) for any user-visible string.
- Relevant stack pin from `docs/00-tech-stack.md` ("RN 0.81.5,
  react-native-ble-plx 3.x — don't propose alternatives").
- Exact file path(s) to write or edit.
- The verification step the agent must report.
- Whether to write tests (yes by default, per the testing standard).

### How to review agent output
- Read the **actual diff**, not the summary. Summaries describe intent.
  Diffs describe reality.
- Run lint + typecheck + test locally. CI is a backstop, not a reviewer.
- Voice check every new user-visible string.
- If the agent invented a token / flag / env var that isn't elsewhere
  in the codebase, that's a bug — fix or reject before commit.

### Sprint shape (the pattern)
1. Main thread reads CLAUDE.md + sprint card + referenced docs.
2. Main thread spawns `Plan` agent (one shot) for ordered task list.
3. Main thread proposes plan + agent split to user; waits for approval.
4. Main thread implements **foundations** sequentially (anything later
   work depends on — tokens, theme provider, schema, base BLE module).
5. Once foundations are committed, fan out parallel `general-purpose`
   agents for the independent units.
6. Main thread reviews + integrates + commits each agent's output.
7. Final pass: full CI gates, voice check, demo recording, sprint card
   to `plans/done/`, next card opened.

### Anti-patterns
- Spawning an agent to read CLAUDE.md or the sprint card on main
  thread's behalf. The startup protocol is non-delegable.
- "Based on your findings, implement X" — pushes synthesis onto the
  agent. Main thread synthesizes; agents execute concrete tasks.
- More than 5 agents in parallel.
- Briefing without the voice rules. An agent without them will write
  "patient" or "diagnose" without thinking.
- Accepting an agent's "task complete" without reading the diff.
 
## What "done" means
 
A sprint is done when:
 
1. Acceptance criteria in the sprint card all pass.
2. Tests pass in CI.
3. Voice rules pass on every user-visible string.
4. The change is demoed (screenshot or screen recording).
5. The commit is on main with the conventional-commits format.
6. The sprint card is moved to plans/done/ and the next card is opened.
 
Anything less is not done. Don't mark a sprint complete to make progress
look better.
