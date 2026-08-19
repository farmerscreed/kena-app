# D13 — Leiko Vitals Layer: Implementation Specification

**A build-ready specification for the redesign of the vitals surface in `leiko-app`.**

Prepared for: LawOne Cloud LLC · Leiko
Repo: `github.com/farmerscreed/leiko-app`
Date: 18 August 2026
Supersedes: D8 §3.10, D8 §4.6, D8 §4.7 (vitals portions only)
Depends on: D11 §9 (WHOOP adoption playbook), D12 (UI/UX audit), D3 (regulatory), D5 §6.4 (forbidden claims), D9 (Learn module)

---

## 0. How to use this document with Claude Code

This document is written to be executed, not read. It is organised as **eleven pull requests in dependency order**. Do not reorder them — PR-2 through PR-11 all assume PR-1 has landed.

For each PR the spec gives: the files to touch, the exact change, the copy strings, the acceptance criteria, and the tests that must exist before the PR is considered done.

**Standing instructions for the implementing agent:**

1. **Do not invent copy.** Every user-facing string in this build comes from the copy tables in §7. If a string is needed that is not in a table, stop and ask. Do not write health copy from scratch.
2. **Never state a specific physiological event that is not derived from the user's data.** This is the rule that D12 P0-1 was created by breaking. No static string in any vital-detail screen may contain a digit, a clock time, or a word describing an event ("dip", "spike", "drop").
3. **Every claim about a reading must be a statement about the person's own baseline**, never about a clinical category. "Above his usual" is permitted. "High blood pressure", "hypertensive", "stage 2" are not.
4. **The forbidden-words list in D5 §6.4 is absolute** — patient, diagnose, diagnosis, treat, cure, predict, prevent (health context), "silent killer", "dangerous level", "critical level", "medical-grade", "loved one", "smartwatch".
5. **The hardware manufacturer's name must not appear anywhere** — not in code comments, not in commit messages, not in docs.
6. **Do not add a feature that is not in this spec.** If a screen looks empty, it is deliberately empty.

---

## 1. Why this rebuild exists

The audit (D12) found that the personal baseline is computed, displayed, and then ignored. All four client call sites pass `baseline = null`:

- `hooks/useHydrateReadingsFromServer.ts:48`
- `services/families/fetchParentPulseData.ts:120`
- `state/readings.ts:178`
- `utils/caregiverPerson.ts:113`

So every verdict on every vital screen — the tier chip, the ring fill, the hero line, the caregiver status orb — is decided by a fixed ladder (`SOFT 150/95 → STAGE2 160/100 → CRISIS 180/120`, `utils/classification.ts:59-68`) and not by the user's own band. The app renders "YOUR USUAL 123–149" and then calls 158 "within your range".

**Everything in this document is downstream of fixing that.** The visual work in PR-5 through PR-9 is worth doing only because PR-1 and PR-2 make the numbers underneath it true.

Secondary findings this spec closes: P0-1, P0-3, P0-4, P0-5, P1-1, P1-2, P1-5, P1-6, P2-1, P2-5, P2-7, plus the three confirmed gaps (no composite score, no calibration ladder, no correlation disclosure).

---

## 2. Scope

**In scope**

| Area | Screens / modules |
|---|---|
| Vital detail | `screens/VitalDetail/{BPDetail,HRDetail,SpO2Detail,SleepDetail,ActivityDetail}.tsx` |
| New screen | `screens/Health/HealthMonitorScreen.tsx` |
| Home hero | `components/DailyPulseHero.tsx`, `components/VitalHero.tsx` |
| Charts | `components/{BPTwinLineChart,VitalTrendChart,MultiVitalChart,SleepNightlyBars,ActivityWeeklyBars,CorrelationStrip}.tsx` |
| Classification | `utils/classification.ts`, `utils/vitalBaselines.ts`, `supabase/functions/_shared/classification.ts` |
| Tokens | `theme/tokens/{color,typography,layout}.ts` |
| Copy | `services/voice/`, all tier vocabulary |
| New capability | Reading context tags, medication log, Steadiness score, correlation countdown |

**Out of scope for this document** — Family Circle, onboarding, pairing, paywall, Learn module, Doctor PDF layout (it already works; it consumes what this spec produces), i18n.

---

## 3. Non-negotiables and hard stops

### 3.1 Steadiness requires written legal sign-off before merge

PR-10 (Steadiness) must not ship until FDA-savvy counsel has signed off in writing. A bounded score with a colour band is the exact artefact FDA cited in the WHOOP warning letter. The design intent here is explicitly non-diagnostic — it scores **measurement practice and pattern stability, never blood-pressure level** — but the intent must be documented and blessed.

**Build PR-10 behind a feature flag (`FF_STEADINESS`, default off).** Everything else in this spec stands on its own if the answer comes back no.

### 3.2 The app is not a cleared device

The watch is an FDA-listed Class II device. The app is not. No screen, string, or score may imply the app itself is cleared, or bundle the two.

### 3.3 What we are explicitly not building

| Rejected | Reason |
|---|---|
| A sixth vital, or a sixth home card | Densification is WHOOP's most-complained-about decision (D11 §3.8) |
| Colour-banded gauge resembling clinical classification | The specific UI element FDA cited |
| HRV, stress score, "body battery", any derived wellness index | Hardware cannot support it credibly; D11 §11 |
| Streaks, badges, leaderboards, escalating targets | D8 §1.3; fails the obligation/clarity test (D11 §9.4) |
| Person-to-person comparison of any vital | D11 §9.4 |
| Answering vitals questions in prose inside the chat surface | WHOOP's own finding — link to the chart |

### 3.4 The obligation test

Every engagement mechanic added by this spec must pass:

> **Does this create obligation for the wearer, or clarity for the caregiver?**
> Obligation is forbidden. Clarity is required.

The calibration ladder (PR-4) passes because each unlock is real capability arriving, not manufactured achievement. A streak would fail.

---

## 4. Architecture: the truth layer

### 4.1 Baseline source of truth — decision

D12 P0-3 found two incompatible baselines. **Decision, to be implemented as written:**

| Purpose | Source | Window | Statistic | Storage |
|---|---|---|---|---|
| **Classification** (what the app decides) | `supabase/functions/_shared/classification.ts` | **28 days** | mean ± 2σ, with a minimum-n gate | `bp_baselines` table, nightly cron |
| **Display band** (what the user sees) | same table, additional columns | **28 days** | p10–p90 | same row |

Both move to **one server-computed row per person per vital**, so the band shown and the band judged against are computed from the same window over the same readings. This is the change that makes "in your usual range" a true statement.

The client's `utils/vitalBaselines.ts` stops computing and becomes a **read-through cache + typed accessor** for the server row, with an ephemeral local recompute only as an offline fallback (flagged `provisional: true`, which suppresses the coloured state — see §6.2).

The 14-day window currently used server-side is widened to 28 to match the display window and to give SpO₂/sleep/activity enough samples.

### 4.2 Baseline coverage must extend to all five vitals

Currently `bp_baselines` covers BP and HR only. The Health Monitor (PR-6) cannot exist without bands for SpO₂, sleep and activity.

**New table** (replaces `bp_baselines`; migrate and keep a view for compatibility):

```sql
create type public.baseline_vital as enum ('bp_systolic','bp_diastolic','resting_hr','spo2','sleep_duration','steps_daily');

create table public.vital_baselines (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families(id) on delete cascade,
  subject_id     uuid not null references public.users(id) on delete cascade,
  vital          public.baseline_vital not null,
  window_days    smallint not null default 28,
  sample_count   integer not null,
  mean_value     numeric not null,
  sd_value       numeric not null,
  p10_value      numeric not null,
  p90_value      numeric not null,
  -- context-conditioned variants; null context = all readings
  context_tag    text,
  is_sufficient  boolean not null,
  computed_at    timestamptz not null default now()
);

create unique index vital_baselines_key
  on public.vital_baselines (subject_id, vital, coalesce(context_tag, ''));
create index vital_baselines_family on public.vital_baselines (family_id, vital);
```

`is_sufficient` is computed at write time from the sufficiency thresholds in §4.3 and is the **only** field the client consults to decide whether a coloured state may be shown.

### 4.3 Sufficiency thresholds

These gate the calibration ladder and every coloured verdict. A vital below threshold renders in the learning state and **must not** show a green check, an amber flag, or a filled ring.

| Vital | Minimum for band | Minimum for classification | Notes |
|---|---|---|---|
| BP systolic / diastolic | 10 readings over ≥7 distinct days | same | Split further by `context_tag` when tag has ≥8 readings |
| Resting HR | 7 nights | 7 nights | Nightly minimum-sustained value, not spot HR |
| SpO₂ | 7 nights of overnight series | 10 nights | Higher bar — the noisiest sensor |
| Sleep duration | 7 nights | 10 nights | |
| Steps daily | 7 days | 10 days | |

**Absolute-threshold escalation is retained and is independent of the baseline.** A reading at or above 180/120 always escalates to `confirmed_urgent` regardless of the person's band and regardless of sufficiency. This is a safety floor, not a classification: it is the one place an absolute number is allowed to drive the UI, and its copy is the "talk to your doctor" tier only.

### 4.4 Classification contract

`utils/classification.ts` exports one function, and all four call sites pass a real baseline:

```ts
export type Tier = 'learning' | 'in_range' | 'worth_a_look' | 'talk_to_doctor';

export type Verdict = {
  tier: Tier;
  reason: 'insufficient_data' | 'inside_band' | 'outside_band' | 'absolute_floor';
  band: { low: number; high: number } | null;
  deviation: number | null;   // signed, in units of the vital
  sampleCount: number;
  windowDays: number;
  provisional: boolean;       // true when computed from the offline fallback
};

export function classifyVital(
  input: { vital: BaselineVital; value: number; contextTag?: string | null },
  baseline: VitalBaseline | null,
): Verdict;
```

Rules, in order:

1. `value >= 180 systolic || value >= 120 diastolic` → `talk_to_doctor`, reason `absolute_floor`
2. `baseline == null || !baseline.is_sufficient` → `learning`, reason `insufficient_data`
3. `value` inside `[p10, p90]` → `in_range`, reason `inside_band`
4. `value` outside `[mean ± 2σ]` → `worth_a_look`, reason `outside_band`
5. between p90 and mean+2σ → `in_range` (the band edge is soft; do not flag on the shoulder)

**`talk_to_doctor` from `outside_band` requires confirmation**, not a single reading: three consecutive readings outside `mean ± 2σ` in the same direction within 72 hours, or the absolute floor. A single outlier never escalates past `worth_a_look`.

### 4.5 New tables — reading context and medication

```sql
create type public.reading_context as enum
  ('morning','evening','before_meds','after_meds','after_walking','feeling_unwell','resting','unspecified');

alter table public.readings
  add column context_tags public.reading_context[] not null default '{}',
  add column context_note text check (length(context_note) <= 280);

create table public.medications (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  subject_id   uuid not null references public.users(id) on delete cascade,
  label        text not null check (length(label) <= 80),
  schedule     jsonb not null,          -- { times: ['08:00'], days: [1,2,3,4,5,6,7] }
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.medication_events (
  id             uuid primary key default gen_random_uuid(),
  medication_id  uuid not null references public.medications(id) on delete cascade,
  subject_id     uuid not null references public.users(id) on delete cascade,
  taken_at       timestamptz not null,
  logged_by      uuid not null references public.users(id) on delete restrict,
  created_at     timestamptz not null default now()
);
create index medication_events_subject_time
  on public.medication_events (subject_id, taken_at desc);
```

**Language constraint on this feature.** The medication log is described everywhere in the UI as *"what you take and when"* — never as treatment, adherence, compliance, or dosing. It records that something was taken. It never advises, never reminds in a scolding register, and never reports a "missed" dose as a failure. Copy in §7.6.

RLS: caregivers with an active family membership may read; only the subject or an `owner`-role caregiver may write. Medication labels are free text and must be excluded from any AI prompt payload that leaves the device unless the user has opted in (see §9.3).

---

## 5. Design system changes

### 5.1 The colour fork (closes P1-1)

Three semantic roles currently resolve to identical hex (`theme/tokens/color.ts:198,229,237` and `:201,242,248`), so the contrast between "this is tappable" and "this is your blood pressure" is 1.00:1.

**New rule, enforced by test: colour has exactly three families and they never overlap.**

| Family | Rule |
|---|---|
| **Interactive** | Copper only. Nothing you *read* is ever copper. One primary CTA per screen. |
| **Status** | Green / yellow / crimson / stone. Only ever applied to a verdict — chip, icon, ring. Never to a vital's identity. |
| **Chart series** | Muted, desaturated. Only ever inside a plot area. Never on a chip, never on a control. |

```ts
// theme/tokens/color.ts — replace the colliding roles

export const canvas = {
  base:      '#0A0908',
  gradientTop: '#141110',   // vertical gradient top → base at bottom
  surface:   '#171310',
  elevated:  '#1F1A16',
  hairline:  '#221D19',
  outline:   '#322B26',
};

export const text = {
  primary:   '#F5F0EA',   // 19.9:1
  secondary: '#B8B2AA',   //  9.4:1
  tertiary:  '#8A837C',   //  5.1:1 — raised from #857F7A
  faint:     '#6B645E',   //  3.4:1 — non-text only (rules, dashed strokes)
};

export const interactive = {
  primary:      '#C96442',
  primaryPress: '#B0553A',
  onPrimary:    '#FFFFFF',
  quiet:        '#F5F0EA',   // achromatic secondary action
  outline:      '#322B26',
};

export const status = {
  inRange:       '#5FA97E',
  inRangeBg:     'rgba(95,169,126,0.14)',
  worthALook:    '#E8B54F',
  worthALookBg:  'rgba(232,181,79,0.14)',
  talkToDoctor:  '#B23A48',
  talkToDoctorBg:'rgba(178,58,72,0.16)',
  learning:      '#6B645E',
  learningBg:    '#1C1815',
};

export const series = {
  bp:       '#7EA8C4',
  hr:       '#C99AB0',
  spo2:     '#8FBCA8',
  sleep:    '#9B93C7',
  activity: '#C4B07E',
  band:     0.15,   // fill opacity for the personal-range ribbon
};
```

`E8A063` is retired entirely. `brand.coral #FF7350`, `person[n]`, and `status.attention` are decoupled: person accents come from a dedicated `person` ramp used **only** for avatars and orb rings, never for a value.

**Required test — `theme/__tests__/colorQuarantine.test.ts`:**

```ts
it('no hex is shared between interactive, status and series families', () => { /* pairwise distinctness */ });
it('no series or status colour appears in the interactive family', () => { /* ... */ });
it('every status foreground meets 4.5:1 against its own bg token and against canvas.surface', () => { /* ... */ });
```

Contrast floor: every status foreground ≥ 4.5:1 at 11pt against both `canvas.surface` and its own tinted background. `talk_to_doctor` `#B23A48` on `canvas.surface` must be verified and lightened if it fails — do not ship a failing red.

### 5.2 Typography (closes P1-2)

`fontVariant: ['tabular-nums']` currently has **zero occurrences repo-wide**, and 14 value-bearing callsites render numbers in `fontFamilies.editorial` (Instrument Serif), so the same reading appears in a serif on Home and mono on Reading Detail.

**Rules:**

1. **Any glyph that is part of a measured value renders in `fontFamilies.numeric` (JetBrains Mono) with `fontVariant: ['tabular-nums']`.** No exceptions. This includes the systolic/diastolic pair, units, timestamps in metric contexts, band endpoints, sample counts.
2. **Instrument Serif is retained for exactly one role**: the narration voice slot ("What Leiko sees") and the Trends letter. It is registered as `fontFamilies.voice`, documented, and used nowhere else.
3. A new `fontFamilies.eyebrow` token makes mono-for-labels a decision rather than a coincidence.

New / changed numeric tokens:

| Token | Size | Line height | Use |
|---|---|---|---|
| `numericHero` | **64** | 66 | Vital-detail hero value |
| `numericXl` | 44 | 48 | Home hero, state cards |
| `numericL` | 28 | 34 | Health Monitor row values, reading cards |
| `numericM` | 17 | 22 | Band endpoints, table values |
| `numericS` | 12 | 16 | Axis labels, sample counts |
| `eyebrow` | 11 | 14 | All-caps mono labels, `letterSpacing: 0.08em` |

Minimum rendered size anywhere in the app is **11pt**. The 7.5pt, 8pt, 8.5pt and 10pt instances catalogued in D12 P0-6 are all raised.

The diastolic value moves out of `text.tertiary` into `text.secondary`. The second half of a blood pressure reading is not helper text.

### 5.3 The hero glow (closes P0-5)

`styles.glow` declares `opacity: 0.18`; `glowAnimatedStyle` is applied last and cycles `0.55 → 0.75`, so the animated value wins and text behind it drops to 1.08:1 on a 4.5s cycle.

**Fix:** remove `opacity` from the stylesheet and multiply inside the worklet; cycle **0.12 → 0.20**. Under `useReducedMotion()` the glow is static at 0.14. Add a test asserting the composed opacity never exceeds 0.22.

Files: `components/VitalHero.tsx:115-134,290`, `components/DailyPulseHero.tsx:313-332,594`.

### 5.4 Layout constants (closes P1-3)

Create `theme/layout.ts` as the single source for furniture heights:

```ts
export const furniture = {
  tabBarHeight: 60,
  actionBarHeight: 68,
  fabDiameter: 56,
  fabInset: 16,
};
export const scrollPaddingBottom = (opts: { tabBar: boolean; actionBar: boolean }) =>
  (opts.tabBar ? furniture.tabBarHeight : 0) +
  (opts.actionBar ? furniture.actionBarHeight : 0) + 24;
```

Both the "Worth a read" 56pt overlap and the Ask Leiko FAB / tab bar collision are derived from this. Add a test asserting `paddingBottom >= furniture height` for the wearer and caregiver paths.

Canvas: replace the flat `#0A0908` with a vertical gradient `#141110 → #0A0908`. This single change carries most of the "expensive vs cheap" difference (D11 §9.5).

### 5.5 Dynamic Type (closes P0-6)

191 × `allowFontScaling={false}`, zero `true`. The wearer is 55–80 and reads their own blood pressure at 10pt with no way to change it. `docs/13-testing-standard.md:184` lists WCAG 2.2 AA as a release gate; the app would not pass it.

**In dependency order:**

1. Remove the blanket `allowFontScaling={false}`. Replace with per-layout `maxFontSizeMultiplier` — `1.0` **only** where a value is geometrically trapped inside a fixed-diameter ring; `1.6` on dense rows; `2.0` on prose.
2. Raise every sub-11pt size to the 11pt floor.
3. Add **Settings → Accessibility → Large text**, persisted in MMKV. This is necessary because `account_type` is DB-immutable and `AccountTypeFork.tsx:43` hardcodes every account to `self_buyer`.
4. Wire that setting **and** `PixelRatio.getFontScale() >= 1.3` into `ThemeProvider`, replacing the hardcoded `mode="caregiver"` at `app/PostBootShell.tsx:49`.
5. Extend the large-text overrides to the numeric tokens — currently only 5 body tokens are overridden and `numericHero`/`numericXl` are untouched.
6. Route the ~20 bespoke `Pressable`s through `theme.minTapTarget`.

SVG `<Text>` nodes ignore RN font scaling. Every SVG-rendered value must therefore have a non-SVG accessible equivalent, or be re-rendered as RN `<Text>` absolutely positioned over the SVG.

---

## 6. Component specifications

### 6.1 `StatusChip`

One component, one definition site. Replaces the six competing phrasings catalogued in D12 P2-1.

| Prop | Type |
|---|---|
| `tier` | `Tier` |
| `subject` | `{ label: string; possessive: string }` — never a hardcoded pronoun |
| `size` | `'s' \| 'm'` |

Rendering: pill, `status[tier]` foreground on `status[tier]Bg`, leading Phosphor icon (`Check` / `WarningCircle` / `Phone` / `CircleDashed`), sentence case, **never uppercase**. `docs/05:182` forbids all-caps; `StatusPill.tsx:114` currently forces it. `ALL CLEAR` is deleted — "all clear" is itself a claim.

Accessibility: the chip's label is folded into the parent's composed label; the chip itself is `accessibilityElementsHidden` when nested inside a labelled card.

### 6.2 `VitalHero`

| Region | Spec |
|---|---|
| Value | `numericHero` 64pt, `text.primary`; secondary component (`/82`) in `text.secondary` |
| Unit + time | `eyebrow` 11pt mono, `text.tertiary`, e.g. `MMHG · 6:42 AM` |
| Verdict | `StatusChip` directly beneath. **Mandatory** — a hero value never renders without a verdict (closes P1-5) |
| Band caption | `numericM`, only when `is_sufficient`: `USUAL 118–134 / 74–86` |
| Ring | Stroke encodes **data sufficiency**, not tier. Fill fraction = `min(sampleCount / requiredCount, 1)`. Colour = `status.learning` while insufficient, then `status[tier]` |
| Glow | Per §5.3 |

`provisional: true` (offline fallback baseline) renders the learning state, not a colour. We never colour a verdict computed from an unsynced cache.

**Composed accessibility label:** `"{subject} blood pressure, 128 over 82 millimetres of mercury, in his usual range, taken at 6:42 this morning."` The verdict is always inside the label — colour is never the sole channel.

### 6.3 `RangeBandChart` — the core chart component

This replaces the primary BP chart, which D12 P1-6 found renders no line between time slots, encodes systolic vs diastolic by alpha of the same hue, and always emits 8 slots so n=2 renders as two bars on an eight-label axis.

**Anatomy**

| Layer | Spec |
|---|---|
| Band ribbon | `series[vital]` at `series.band` opacity, spanning `[p10, p90]` across the full plot width. **This is the most important element on the screen** — it is the visual form of the product's promise |
| Outer band | Optional, at 0.07 opacity, spanning `mean ± 2σ`, shown only on the "All" range |
| Primary series | Solid 1.6pt polyline, 2.6pt filled circles |
| Secondary series (diastolic) | **Dashed** 1.2pt polyline, 6pt hollow **squares**. Shape and dash, never opacity (WCAG 1.4.1) |
| Latest point | 3.4pt, `text.primary` fill — the "you are here" marker |
| Out-of-band points | 4pt, `status.worthALook`, plus a 1pt ring. Size and ring, not colour alone |
| Axis | `numericS`; band endpoints labelled, not arbitrary ticks |

**Density adaptation — required behaviour**

| Points in range | Render |
|---|---|
| 0 | Empty state (§6.7), no axes |
| 1–2 | **Dot plot** against the band. No polyline, no time axis. Caption: `Two readings so far.` |
| 3–7 | Polyline with every point labelled |
| 8+ | Polyline, sparse labels (first, last, and any out-of-band point) |

`bucketReadingsByHour` is replaced by a range-aware bucketer that never emits empty trailing slots. The eyebrow text and the range pill read from **one** state value — the current "Today" / "7D" disagreement is a symptom of two sources.

`CONNECTOR_WIDTH` drops from 6 to 2.

**Interaction:** horizontal scrub with a vertical rule and a value callout; light haptic on each point detent; suppressed under `useReducedMotion()`. Pinch is not supported.

**Accessibility:** composed label on the chart element (`accessible={true}` explicitly — an `accessibilityLabel` on a bare `<View>` is likely not exposed on iOS); a `ViewAsTableLink` mounted on **every** screen that renders a chart, including `HRDetail` and `Trends`, which currently have no non-visual route to their data at all.

### 6.4 `HealthMonitorRow`

Mounts on `PersonOverviewScreen` (§7.2a) — there is no standalone Health tab.

| Region | Spec |
|---|---|
| Name | `body-m`, `text.primary` |
| Value + band | `numericS` mono, `text.tertiary`: `128/82 · usual 118–134` |
| Sparkline | 54×24, band ribbon + series line. Learning state: dashed grey stub, no band |
| Verdict | Icon only, `status[tier]`. Text lives in the composed label |
| Tap | Pushes the vital detail screen |

Row height ≥ 56pt; scales to `1.6×` before the sparkline is dropped and the row reflows to two lines.

### 6.5 `ContextTagSheet`

Bottom sheet presented after a reading completes and reachable from any reading detail. Multi-select chips from the `reading_context` enum, plus an optional 280-char note.

Default selection is time-derived (`morning` before 12:00 local, `evening` after 17:00) and pre-applied but editable. Never blocking — the sheet is dismissible and a reading with no tags is valid.

### 6.6 `CorrelationCountdown`

Progress rule + one sentence. Shows only when the correlation engine reports `n < 14` for a pair it can compute, and only for pairs where the user has supplied at least one of the two inputs.

The engine already enforces `n≥14`, `|r|≥0.3`, `p<0.05` with a two-tailed Student's-t p-value unit-tested against scipy to ±0.005 (`compute-correlations/stats.test.ts:32-110`). **Do not weaken these thresholds to make a finding appear.** When a pair clears n but fails r or p, the honest-negative copy in §7.5 renders instead of nothing.

### 6.7 `VitalEmptyState`

The shared `EmptyState` component is currently used by two screens; everywhere else was hand-rolled, and `ParentDashboard` has none at all — with a valid `familyId` and zero vitals it renders a full-length screen of em-dashes.

**Rules:** every screen that can render zero data mounts `VitalEmptyState`. Headline is the situation, not the action. Body explains why this is fine. One CTA maximum. Copy in §7.7.

`NO_DATA_FALLBACK` in `components/VitalTile.tsx:100` is currently applied only when `secondary === undefined`, which no home callsite satisfies, so screen readers announce an em-dash. The fallback applies whenever the primary value is null, on every callsite including `DailyPulseHero.tsx:283,524`.

---

## 7. Screen specifications

### 7.1 Information architecture — DECIDED

The hierarchy is **Home → Person Overview → Vital Detail**, confirmed with the founder. There is no separate Health tab; the five-vital monitor lives inside each person's overview.

| Level | Screen | Contents |
|---|---|---|
| 1 | **Home** (caregiver) | Orb constellation or list, attention-sorted (§7.1a) → family-level "What Leiko sees" → nothing else |
| 1 | **Home** (self-buyer) | **Is** the Person Overview of self. No intermediate |
| 2 | **Person Overview** (`screens/Person/PersonOverviewScreen.tsx`, new) | Everything about one individual: Steadiness ring (flagged), latest reading + `StatusChip`, per-person "What Leiko sees", `HealthMonitorRow` × 5, correlation section, recent readings, doctor-note link (§7.2a) |
| 3 | **Vital Detail** | The five screens per §7.2/§7.3, identical regardless of whether the subject is self or a family member |

**The tab bar does not change.** The shipped structure — **Home / Trends / [+] / Learn / Settings**, with the centre + launching Take a Reading — is retained exactly as is. This entire redesign happens inside screens: Person Overview and Vital Detail are *pushed* screens reached from Home, not tabs. The Health tab proposed in an earlier draft is **withdrawn** — its contents are absorbed into Person Overview, which is cleaner: one screen answers "how is this person", reachable from an orb, a list row, or (for self-buyers) app launch. Do not add, remove, or reorder tabs anywhere in this build.

**Navigation contract.** Every tap target that represents a person — orb, list row, reading card, anomaly banner subject — routes to `PersonOverview({ subjectId })`. Every tap target that represents a vital — monitor row, hero, chart, tile — routes to `VitalDetail({ subjectId, vital })`. `subjectId` is always explicit; the self case is `subjectId === currentUserId` with `isSelf` derived from it, which also closes P2-8 (tapping your own node currently shows "Checking in on {your name}" about yourself because `isSelf` is computed in `utils/constellationNodes.ts:30-35` and never passed through the route).

### 7.1a Multi-person Home

**The existing orb constellation aesthetic is retained.** The founder has confirmed the current look — the warm glow, the breathing animation, the dark canvas — is the desired direction. What changes is correctness and information, not character:

| Element | Spec |
|---|---|
| Glow | Kept, at the **designed** opacity — the worklet cycles 0.12 → 0.20 per §5.3. The current 0.55–0.75 render is the P0-5 bug, not the design; clamping it restores the intended look |
| Orb ring | The universal ring: **colour = tier, sweep = data sufficiency** (§6.2). Person accent colours come off values entirely — identity is carried by initial, photo and position |
| Caption under every orb | Three lines, always present: name (`body-s`), latest reading (`numericS` mono, `text.secondary` — never a person colour, never inside-the-tap-target coral), verdict phrase (`caption`, `status[tier]`). The caption is part of the orb's single tap target and its composed accessibility label |
| Tap | Whole orb group → `PersonOverview` |
| Layout | Data-driven polar ring sized from `useWindowDimensions()`; the top-ranked person (attention sort, below) takes the largest orb and top position. Replaces the hardcoded 360×360 canvas and three fixed slots |
| View toggle | Circle / List, persisted in MMKV |

**Count-adaptive rules — never truncate:**

| People | Behaviour |
|---|---|
| 1 | Home renders `PersonOverview` directly. No circle/list toggle (fixes the lone-orb-in-empty-space state) |
| 2–5 | Circle available; orbs on the polar ring |
| 6+ | Circle disabled, list forced, one-line caption explaining why. `MAX_PEOPLE = 3` and `clampPeople`'s silent drop are deleted (P1-4) |

**Attention sort** — the sort key for the list view and for orb prominence. It orders by *what needs the caregiver's action next*, never by whose numbers are worse — per-person ordering by health value is a leaderboard and is forbidden (D11 §9.4):

1. `talk_to_doctor`
2. `worth_a_look`
3. **No reading in > 48h** — silence outranks a normal number; it is the most actionable state and currently the least visible one
4. `learning`
5. `in_range`, most recent first

**List view row:** 38pt avatar ring (same ring component) · name · verdict phrase + relative time · latest reading in `numericL` mono. Row height ≥ 56pt, whole row is the tap target → `PersonOverview`.

**There is no family-level Steadiness score and none may be added.** Steadiness is per-person only; aggregating a health-adjacent score across people is meaningless and displaying per-person scores side by side is a ranking. The family-level synthesis surface is the "What Leiko sees" sentence, which names at most one person and states plainly when nothing warrants attention.

### 7.2a Person Overview screen

```
[ back (caregiver) / settings (self) · "{name}" ]
[ Steadiness ring, numericXl, tap → breakdown ]   ← FF_STEADINESS; grey until earned
[ latest reading · numericXl · StatusChip · time ]
[ "What Leiko sees" — one derived sentence ]
[ HealthMonitorRow × 5 ]                           ← §6.4; tap → VitalDetail
[ CorrelationCountdown / finding ]                 ← §6.6
[ recent readings (paged) ]
[ "For {possessive} doctor" link ]
```

Self-buyer Home is this screen with `isSelf = true`: header shows settings instead of back, copy switches to second person via the `subject` object (§7.4), and the Take-a-Reading FAB mounts. No other divergence — one component, one test suite.

`ParentDashboard` currently renders **11 sections** and shows the same five values three times — hero rings, tile strip, DaySpine. **Delete the tile strip.** The hero carries the headline vital, the Health tab carries all five, DaySpine carries the day's shape. One dataset, one rendering per purpose.

The five stacked conditional banner slots each sit inside a wrapper that renders even when the child returns null, producing 16pt of dead space on the common path. Collapse to a single `BannerSlot` that renders nothing when empty.

**Home card visibility is user-configurable.** Settings → Home → show/hide and reorder. Persisted in MMKV. Trends vital-visibility toggles move from `useState` to the same store so they stop resetting on mount.

### 7.2 Vital detail — shared skeleton

```
[ back · "{subject} · {vital}" ]
[ VitalHero ]                      ← value, unit·time, StatusChip, band caption
[ segmented control ]              ← per-vital, see below
[ RangeBandChart ]
[ band caption ]
[ context tag row ]                ← BP only
[ "What Leiko sees" narration ]    ← one sentence, derived, voice font
[ signature section ]              ← the per-vital differentiator
[ View all readings · View as table ]
```

### 7.3 Per-vital signatures

Five identical screens will always feel thin. Each vital gets one section that only makes sense for that vital.

**Blood pressure — time-of-day fingerprint**
Segmented control: `Morning | Evening | All`. Each segment computes against its own context-conditioned band (§4.2 `context_tag`), so a morning reading is judged against morning history. Signature section: a 24-hour ring showing when readings usually land and where today's sits. Context tags are filterable — tapping "After meds" re-renders the band from tagged readings only, with a caption naming the n.

**Heart rate — resting, not instantaneous**
Hero becomes **nightly resting HR**, derived as the minimum sustained value across the sleep window; the day's spot range renders as a faint band behind it. Segmented control: `7D | 30D | 90D`. An instantaneous HR with "within your range" under it is close to meaningless, and today it is also wrong — `HRDetail.tsx:638` gates that string on `baseline !== null` and never reads the tier. Fixed by using `StatusChip` from the shared verdict.

**Oxygen estimate — honest by design**
Overnight series only; a daytime spot value is never promoted to hero. Permanent explainer card, expanded by default on first visit, drawing on D9 `other-002`: wrist optical sensors are less accurate than a clinical oximeter; this is a wellness reference; anyone with a chronic respiratory condition should use the device their doctor recommends. Readings below 92% are shown without alarm and never trigger an anomaly, per D6 US-31 — **and the screen says so**, rather than leaving the silence unexplained. All four hardcoded observation strings at `SpO2Detail.tsx:116-155` are deleted.

**Sleep — the correlation host**
Signature section is the sleep→BP relationship, not the hypnogram. Hypnogram moves below the fold with a caption noting stage estimates are approximate (D9 `other-003`). Correlation copy in §7.5.

**Movement — consistency over intensity**
Goal framing uses the 7,000–9,000 step evidence for older adults, not 10,000 (D9 `other-004`). Signature section: weeks-with-more-movement vs weeks-with-less, against BP, gated by the same statistical rules. No streaks, no escalating targets.

### 7.4 Canonical status vocabulary — the only permitted strings

Currently six phrases exist for one concept, and `confirmed_urgent` has six distinct push titles. `"in pattern"` is internal jargon promoted to brand vocabulary; it means nothing to a 68-year-old in Port Harcourt. **Retire it.** One definition site, everything imports from it.

| Tier | Chip | In a sentence | Push title | Ring |
|---|---|---|---|---|
| `learning` | Learning | *…still learning what's usual for {name}* | *(never pushes)* | grey, partial |
| `in_range` | In {possessive} usual range | *…is in {possessive} usual range* | *(never pushes)* | green |
| `worth_a_look` | Worth a look | *…is a little above {possessive} usual* | Worth a look | amber |
| `talk_to_doctor` | Talk to a doctor | *…is well above {possessive} usual* | Please check on {name} | crimson |

Delete: `"in pattern"`, `"ALL CLEAR"`, `"within your range"`, `"in range"` as separate strings. Delete `SelfBuyerHome.deriveBanner()` (`:1071-1090`) and `CaregiverHome.pickAnomalyForBanner()` (`:942-967`) — duplicate anomaly copy that bypasses canonical `utils/anomalyBannerCopy.ts` and its voice-lint test.

**Pronouns.** Seven files hardcode "her" for a `parentLabel` that may be "Dad", producing *"Dad's resting heart rate is outside her usual range."* Every template takes a `subject: { label, possessive }` object. Possessive is user-set at add-person time, defaulting to `their`. Fallback when the label is missing is **`your family member`** — never "your loved one", which is a documented HARD FAIL and currently ships in two fallback paths including a lock-screen notification title.

### 7.5 Correlation copy

| State | String |
|---|---|
| Counting | `Three more nights and we can tell you whether short sleep is showing up in {possessive} morning numbers.` |
| Found | `On nights after shorter sleep, {name}'s morning readings have run higher. We've seen this across {n} nights.` |
| Honest negative | `We looked at sleep and {name}'s morning readings across {n} nights and didn't find a pattern. That's common, and it isn't a problem.` |
| Not enough of one input | `We'll need a few more readings tagged "after meds" before we can compare.` |

Never imply causation. Never recommend an action from a correlation.

### 7.6 Medication log copy

| Surface | String |
|---|---|
| Section title | `What {name} takes` |
| Empty | `Nothing added yet. Adding what {name} takes helps us show you the fuller picture alongside the readings.` |
| Add CTA | `Add something` |
| Log event | `Log as taken` |
| Confirmation | `Logged, 8:04 am.` |
| Not logged today | `Nothing logged today.` — flat statement. No "missed", no "overdue", no colour, no push |

The log never generates a reminder push in v1. It exists to enrich the doctor note and the correlation inputs.

### 7.7 Empty and learning states

| Screen | Headline | Body |
|---|---|---|
| Vital detail, no data | `No readings yet` | `{name}'s watch will start sending readings as soon as it's paired and worn.` |
| Vital detail, learning | `Still learning` | `We have {n} of the {required} readings we need before we can tell you what's usual for {name}.` |
| Health Monitor, all learning | `Getting to know {name}` | `Each of these fills in as readings come through. Most take about a week.` |
| Correlation section, learning | `Not yet` | `We compare things once there's enough to compare. We'll tell you when there is.` |
| Home, no family | Keep `docs/04-screens/caregiver-home.md:99-104` wording exactly — the shipped copy has drifted from it |

---

## 8. Steadiness (PR-10, behind `FF_STEADINESS`, requires legal sign-off)

### 8.1 What it scores

**Measurement practice and pattern stability. Never blood-pressure level.**

The score can read green for a person with well-managed hypertension who measures reliably, and grey or amber for a person with textbook numbers who stopped wearing the watch. That asymmetry is the entire product and legal argument. If a reviewer can construct a case where a higher blood pressure produces a lower Steadiness score *by way of its level rather than its variability*, the formula is wrong.

### 8.2 Formula

Bounded 0–100, computed server-side nightly over a 28-day window, from three components:

| Component | Weight | Definition |
|---|---|---|
| **Consistency** | 50 | `days_with_at_least_one_reading / 28`, capped at 1.0 |
| **Stability** | 35 | `1 − clamp(σ_28 / σ_reference, 0, 1)` where `σ_reference` is the person's own σ over the preceding 28-day window. Measures whether the pattern is settling or spreading — **relative to themselves, never to a population** |
| **Coverage** | 15 | Proportion of the five vitals with `is_sufficient = true` |

Not computed until Consistency has ≥7 days of data. Before that it renders grey with no number.

### 8.3 Presentation

The ring is the same universal ring component at three sizes: ~150pt with the number inside on Person Overview, 60pt orb on the Home circle, 38pt avatar ring in the list. The **number renders only on Person Overview** — in multi-person views the ring carries tier and sufficiency wordlessly.

- On Person Overview: number at `numericXl`, label `STEADINESS` in `eyebrow`
- One sentence beneath, derived: `{name} measured on 6 of the last 7 days.`
- **Tap opens the breakdown**: the three components, each with its own value and one line of plain explanation. Showing the derivation is what buys a bounded score its credibility — a number with no visible math reads as arbitrary
- No trend arrow, no comparison to other users, no target, no celebration at thresholds

### 8.4 Copy guardrails

Steadiness is never described as a health score, a risk score, or a measure of how someone is doing. Permitted framing: *"how steady the picture is"*, *"how consistently we're seeing {name}"*. Forbidden: *"{name}'s health score"*, *"improving"*, *"getting worse"*, any language implying a clinical trajectory.

---

## 9. Cross-cutting requirements

### 9.1 Accessibility — release gate

| Requirement | Detail |
|---|---|
| Composed labels | Every hero, chart, tile and row exposes one composed label including the verdict. Add `accessible={true}` explicitly on every `<View>` carrying `accessibilityLabel` — without it the label is likely not exposed on iOS, which currently silences six components |
| Live regions | Build `useAnnounce()` — `AccessibilityInfo.announceForAccessibility` on iOS, `accessibilityLiveRegion` on Android. Apply at all 33 existing sites. **`AnnounceForAccessibility` count today: 0**, so a VoiceOver user on iOS is never told a reading was flagged urgent |
| New-reading announcement | Announce on the Supabase realtime insert handler, which currently re-renders silently |
| Colour never sole channel | `DaySpine` concerned dots get a size change **and** the status in the label. Chart series differ by shape and dash |
| Touch targets | 44pt minimum, 48pt preferred. The 28pt locked chips that open the paywall are the priority — a mistap there costs money |
| Contrast | Every pairing ≥ 4.5:1. `DaySpine` past-moment text at ~2.2:1 is the worst in the app and must be fixed by raising the colour, not the opacity — **never use `opacity` on text** |
| Table view | `ViewAsTableLink` on every chart-bearing screen |
| CI | Add `eslint-plugin-react-native-a11y`; add an a11y assertion requirement to the component test template. Tests are currently 716 `getByTestId` vs 10 `getByLabelText` |

### 9.2 The copy lint must actually exist

`docs/05-voice-and-claims.md:186-196` specifies `apps/mobile/tools/copy-lint/` as a CI gate that blocks merge. **It does not exist** — no `tools/` directory, no husky, no git hooks, and CI runs four steps with no string rules. That is how the two live HARD-FAIL violations shipped.

Build it over the existing 30-rule `services/voice/voiceLint.ts` and add it as a fifth CI step scanning `screens/`, `components/`, `utils/`, `services/`, `state/`, and JSX text nodes.

**Do this first:** `voiceLint.ts:88` hard-fails on `/diagnos/`, which matches the IFU-mandated disclaimer *"It is not a diagnosis."* Add an `ALLOWED_EXACT` allowlist **before** wiring the CI step, or the first run fails on a legally required string and the natural reaction will be to weaken the rule.

Also port `voiceLint` into `services/reminders/dispatcher.ts:155`, which schedules local notifications with no lint at all while the server path fails closed.

Add the ten missing HARD-FAIL rules to `output-guard/layer1-regex.ts` (currently 26 rules; `docs/05` specifies 36), and stop Layer 2 failing open silently — emit `ai.output_guard_skipped` and set `flagged = true` when the semantic guard is skipped, and wrap the post-retry scan in `withTimeout` as the pre-retry scan already is.

### 9.3 AI narration

`formatBpDelta()` returns full phrases into a slot whose template already supplies the surrounding words, producing *"Mum's morning number is six above her week above her week"* and *"…is six below her week above her week"* on any calm-concerned BP day. The test asserts the slot value in isolation and never composes it, so CI is green.

Return a bare signed magnitude. **Add a composition test that renders every template with every slot permutation and asserts the output parses as a single grammatical sentence.**

Narration inputs after this build include context tags and medication labels. Medication labels are free text and are **excluded from any prompt payload** unless the user opts in under Settings → Privacy. Send a boolean (`medication_logged_today`) instead.

Wire the daily-briefing push producer. The pipeline is 100% built — categories, templates, preference columns, Android channels, deep links — with **zero producers**; `grep "category: 'daily'"` returns only the type definition. Anomaly push is currently the entire push value of Plus.

Disable `compute-weekly-summary` and `compute-monthly-baseline` crons, or wire them to a surface. They run hourly, call Sonnet, and write `ai_narration_cache` rows that nothing reads.

Notification policy, added verbatim to the anti-patterns list:

> **When nothing warrants action, Leiko stays quiet.**

---

## 10. The pull requests

| PR | Title | Depends on | Closes |
|---|---|---|---|
| **1** | Baseline as source of truth | — | P0-2, P0-3 |
| **2** | Canonical classification + vocabulary | 1 | P0-4, P2-1 |
| **3** | Truth-in-copy sweep | — | P0-1, P0-7, P0-8 |
| **4** | Calibration ladder + learning state | 1, 2 | gap |
| **5** | Craft pass: glow, type, colour fork, layout | — | P0-5, P1-1, P1-2, P1-3 |
| **6** | `RangeBandChart` | 1, 5 | P1-6 |
| **7** | Vital detail rebuild, five screens | 2, 4, 6 | — |
| **8** | Person Overview + multi-person Home | 1, 2, 6, 7 | P1-4, P2-7, P2-8, gap |
| **9** | Accessibility programme | 5, 7 | P0-6, P1-7, P2-2, P2-3, P2-4, P2-5 |
| **10** | Steadiness *(flagged, blocked on counsel)* | 1, 8 | gap |
| **11** | Context tags, medication log, correlation disclosure | 1, 7 | gap |

### PR-1 — Baseline as source of truth
Migration creating `vital_baselines`; extend the nightly cron to all six baseline vitals; widen the window to 28 days; add `is_sufficient`; add context-conditioned rows for BP. Convert `utils/vitalBaselines.ts` to a read-through accessor. Thread the baseline into all four `classifyVital` call sites.

**Done when:** no call site passes `null` except the deliberate offline fallback; a user whose band is 118–134 sees 140 classified `worth_a_look` and 130 classified `in_range`; a user with 4 readings sees `learning` on every surface; 185/125 escalates regardless of band; integration test covers all four.

### PR-2 — Canonical classification and vocabulary
One `Tier` enum, one `rangeCopyForTier`, one `StatusChip`. Delete the six competing phrasings, the two duplicate banner derivations, and all hardcoded pronouns.

**Done when:** `grep -r "in pattern\|ALL CLEAR\|within your range\|loved one"` over `apps/mobile/src` returns zero results outside test fixtures and the lint dictionary; a snapshot test renders every tier × every subject label.

### PR-3 — Truth-in-copy sweep
Delete the four fabricated SpO₂ observations. Fix `formatBpDelta`. Port `voiceLint` into the local-notification dispatcher. Build the copy-lint CLI with `ALLOWED_EXACT` and add as CI step 5.

**Done when:** the digit/clock/event-word test passes across all five vital screens; the composition test passes; CI fails on a deliberately introduced HARD FAIL.

### PR-4 — Calibration ladder
Sufficiency-driven ring fill, grey state, staged unlock at days 1/2/4/7/14/21/30, with the copy from §7.7.

**Done when:** a two-reading account shows grey everywhere, no green check, and a partial ring; each unlock is verified to require the data it waits for.

### PR-5 — Craft pass
Glow clamp; single numeric face with `tabular-nums` at all 14 callsites; colour fork with the quarantine test; `theme/layout.ts` and both collision fixes; gradient canvas; diastolic to `text.secondary`.

**Done when:** the quarantine test passes; no rendered value uses `fontFamilies.voice`; composed glow opacity never exceeds 0.22; the overlap test passes for both furniture paths.

### PR-6 — `RangeBandChart`
Per §6.3. Replaces `BPTwinLineChart` and `VitalTrendChart`.

**Done when:** n=1, n=2, n=3, n=8, n=200 each render correctly; band ribbon present whenever `is_sufficient`; shape differentiation verified; composed label present; `ViewAsTableLink` mounted everywhere including HRDetail and Trends.

### PR-7 — Vital detail rebuild
Five screens on the shared skeleton, each with its signature section per §7.3.

### PR-8 — Person Overview and multi-person Home
Build `PersonOverviewScreen` per §7.2a; rework caregiver Home per §7.1a — data-driven orb field with captions, attention sort, list view, count-adaptive rules; delete `MAX_PEOPLE`/`clampPeople`, the tile strip, and the duplicate banner slots; route self-buyer Home through the same component with `isSelf`; thread `subjectId` through every person tap target.

**Done when:** 1, 3, 5 and 7 people each render correctly with no truncation; tapping any orb, row or reading card lands on that person's overview; tapping your own node shows self-framed copy; the attention sort is covered by a unit test including the >48h-silence rank; the orb caption's composed label includes name, reading and verdict.

### PR-9 — Accessibility programme
Per §9.1. **This PR is a release gate, not a nice-to-have** — the app does not currently pass the WCAG 2.2 AA gate its own testing standard requires.

### PR-10 — Steadiness
Blocked on written counsel sign-off. Ship behind `FF_STEADINESS`, default off.

### PR-11 — Context, medication, correlation
Context tag sheet and tag-conditioned bands; medication log; correlation countdown and honest-negative disclosure.

---

## 11. Release grouping against the Q4 2026 ship date

| Milestone | PRs | Rationale |
|---|---|---|
| **v1 — ships with the watch** | 1, 2, 3, 4, 5, 6, 9 | These are repairs to code that already exists. They make the app truthful, legible and accessible without adding a single new feature — and they are the entirety of what stops the vitals feeling basic |
| **v1.1 — 30–60 days post-launch** | 7, 8, 11 | The differentiation layer: vital-detail rebuild, Person Overview + multi-person Home, context/medication/correlation. Needs real user data in the wild to tune |
| **v1.2 — gated** | 10 | Steadiness, on counsel |

Nothing in v1 blocks the Play Console submission track. PR-9 arguably unblocks it, since a WCAG failure on a health app aimed at over-55s is a review risk as well as a correctness one.

---

## 12. Decisions log (resolved with the founder, 18 Aug 2026)

1. **Baseline window: 28 days, unified.** ✅ Approved as written. If the band proves too slow after a medication change, the remedy is a change-point detector, not a shorter window.
2. **Context-conditioned baselines: BP only.** ✅ Approved.
3. **Resting HR derivation.** ✅ Approach approved; the exact BLE payload for nightly minimum-sustained HR must still be verified against the device protocol document before PR-7 begins. This is a PR-7 entry criterion, not an open design question.
4. **`account_type` immutability: MMKV workaround.** ✅ Approved — the accessibility large-text setting lives in MMKV; `account_type` stays immutable.
5. **Steadiness legal review** — start now. It is the longest-lead item and everything else proceeds without it.
6. **Information architecture: Home → Person Overview → Vital Detail.** ✅ Decided. The orb constellation is retained with captions; orbs and list rows drill to Person Overview; Person Overview absorbs the Health Monitor; the standalone Health tab is withdrawn. See §7.1–§7.2a.

---

## 13. Git workflow for this build

All work in this document lands on a dedicated integration branch, reviewed as a whole before anything touches `main`.

1. **Sync first.** Before creating anything: `git fetch origin`, confirm the local checkout matches `origin/main` (`git status` clean, `git pull origin main`). If local has drifted or has uncommitted work, stop and surface it — do not stash silently.
2. **Integration branch:** `redesign/vitals-layer-d13`, cut from up-to-date `main`. This branch is never force-pushed.
3. **One branch per PR**, cut from the integration branch, named `d13/pr-N-short-slug` (e.g. `d13/pr-1-baseline-source-of-truth`). Each merges into `redesign/vitals-layer-d13` via a PR whose description links the D13 section it implements and pastes its "done when" list as checkboxes.
4. **Merge order is the dependency order in §10.** PR-2 does not start until PR-1 is merged into the integration branch.
5. **CI must be green** (including the new copy-lint step once PR-3 lands) before any `d13/pr-N` branch merges.
6. **`main` is untouched** until the founder has run the integration branch on-device and signed off. The final merge to `main` is a single reviewed PR from `redesign/vitals-layer-d13`.
7. Commit messages reference the finding or section (`P0-2`, `§7.1a`). The manufacturer's name never appears in any commit, branch name, or PR description.

---

## 14. What this document does not cover

- Runtime screen-reader behaviour was not verified in the audit this builds on; several accessibility findings are high-confidence static analysis. **Device-verify PR-9 on both platforms.**
- The true composite behind `BlurView` on iOS is unknown; contrast figures for `CaregiverActionBar` and `ViewToggle` assume the solid Android fallback.
- Nothing in the source audit was executed — no build, no test run. Expect the first PR to surface at least one finding that static analysis missed.

---

*Prepared for LawOne Cloud LLC · Leiko · Confidential · August 2026*
*Companion to D11 (WHOOP Teardown) and D12 (UI/UX Audit)*
