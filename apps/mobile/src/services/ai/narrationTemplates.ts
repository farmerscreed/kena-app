// AI module — narration template library. Sprint 11 task 6.
//
// The Tier-A template library that drives the Daily Pulse narration
// line per docs/_reference/D14-ambient-ai-architecture.md §3.3.
// Sprint 11 ships the LIBRARY; Sprint 12.5 builds the GENERATOR that
// picks a template + substitutes slots. This file ships templates as
// data, voice-locked, with selectors that decide when each applies.
//
// Slot vocabulary:
//   {parent_label}      — "Mum" / "Dad" / "your parent" / "you"
//   {bp_value}          — e.g. "124/79"
//   {bp_week_avg}       — e.g. "121/77"
//   {bp_delta}          — a COMPLETE predicate, e.g. "six above the
//                         week's average" / "higher than usual". Templates
//                         must end at this slot and never add their own
//                         trailing phrase (audit D12 P0-7).
//   {hr_resting}        — e.g. "62"
//   {sleep_total}       — e.g. "7h 24m"
//   {steps_today}       — e.g. "6,200"
//   {steps_target_hits} — e.g. "four days last week"
//
// Slots are filled by the Sprint-12.5 generator. The strings here
// must read clean even before substitution — voice-lint scans them
// with the same engine that gates Learn articles.
//
// Selector design:
//   - A NarrationContext describes the current vital-state tuple.
//   - Each template has `selector(context) → boolean` that returns
//     true when the template applies to the context.
//   - The Sprint-12.5 generator collects all matching templates,
//     sorts by `priority` desc, picks the highest. Ties break by
//     id. The library guarantees coverage: at least one template
//     matches every reachable context.

import type { NarrationTemplate } from './types';

/**
 * Vital classification at the level of the narration generator.
 * Mirrors `ClassificationTier` but renames `in_pattern` to `in_pattern`
 * for explicitness — `in_pattern` is the calm baseline; the other
 * two tiers narrate differently.
 */
export type NarrationTier = 'in_pattern' | 'calm_concerned' | 'confirmed_urgent';

export interface NarrationContext {
  /** D14 §7.2 priority — which vital is the central value. */
  centralVital: 'bp' | 'hr' | 'sleep' | 'activity' | 'spo2' | null;
  bp?: NarrationTier;
  hr?: NarrationTier;
  spo2?: NarrationTier;
  sleep?: NarrationTier;
  activity?: NarrationTier;
  /** True when the active correlation has been flagged meaningful. */
  hasMeaningfulCorrelation?: 'sleep_bp' | 'activity_hr' | 'reading_patterns' | null;
  /** True when the user just hit a multi-day pattern (e.g. 4-of-7 step target). */
  activityStreak?: boolean;
}

/**
 * NarrationTemplate extended with a selector. Kept separate from the
 * shared NarrationTemplate type (in services/ai/types.ts) so other
 * sprint code that reaches in for the bare template shape doesn't
 * have to know about NarrationContext.
 */
export interface NarrationTemplateEntry extends NarrationTemplate {
  selector: (ctx: NarrationContext) => boolean;
}

const t = (
  id: string,
  description: string,
  text: string,
  priority: number,
  selector: NarrationTemplateEntry['selector'],
): NarrationTemplateEntry => ({ id, description, text, priority, selector });

// -----------------------------------------------------------------
// Templates — grouped by primary signal.
// -----------------------------------------------------------------

const ALL_IN_PATTERN: NarrationTemplateEntry[] = [
  t(
    'all-in-pattern.bp-central',
    'Every vital in pattern, BP is the central value',
    '{parent_label} is in pattern. {bp_value} this morning.',
    100,
    (c) =>
      c.centralVital === 'bp' &&
      c.bp === 'in_pattern' &&
      (c.hr ?? 'in_pattern') === 'in_pattern' &&
      (c.spo2 ?? 'in_pattern') === 'in_pattern' &&
      (c.sleep ?? 'in_pattern') === 'in_pattern' &&
      !c.hasMeaningfulCorrelation,
  ),
  t(
    'all-in-pattern.hr-central',
    'Every vital in pattern, HR is the central value',
    '{parent_label} is in pattern. Resting heart rate at {hr_resting}.',
    100,
    (c) =>
      c.centralVital === 'hr' &&
      c.bp === 'in_pattern' &&
      c.hr === 'in_pattern',
  ),
  t(
    'all-in-pattern.sleep-central',
    'Every vital in pattern, sleep is the central value',
    '{parent_label} slept {sleep_total} last night. Numbers in pattern.',
    100,
    (c) =>
      c.centralVital === 'sleep' &&
      c.bp === 'in_pattern' &&
      c.sleep === 'in_pattern',
  ),
];

const SLEEP_LIGHT_BP_OK: NarrationTemplateEntry[] = [
  t(
    'sleep-light.bp-in-pattern',
    'BP in pattern but the night was lighter than usual',
    '{parent_label} slept lightly last night — {bp_value} this morning, in pattern.',
    110,
    (c) =>
      c.bp === 'in_pattern' &&
      c.sleep === 'calm_concerned' &&
      c.hasMeaningfulCorrelation !== 'sleep_bp',
  ),
  t(
    'sleep-light.with-correlation',
    'Sleep was lighter and the BP correlation just became meaningful',
    '{parent_label} slept lightly last night. Morning numbers nudged up — these often go together.',
    115,
    (c) =>
      c.sleep === 'calm_concerned' && c.hasMeaningfulCorrelation === 'sleep_bp',
  ),
];

const BP_CALM_CONCERNED: NarrationTemplateEntry[] = [
  t(
    'bp-cc.single',
    'BP single calm-concerned reading, others in pattern',
    "{parent_label}'s morning number is {bp_delta}. Worth a closer look later.",
    120,
    (c) =>
      c.bp === 'calm_concerned' &&
      (c.hr ?? 'in_pattern') === 'in_pattern' &&
      (c.spo2 ?? 'in_pattern') === 'in_pattern' &&
      (c.sleep ?? 'in_pattern') === 'in_pattern',
  ),
  t(
    'bp-cc.with-light-sleep',
    'BP calm-concerned with a light night',
    "{parent_label}'s morning number is {bp_delta}. Sleep was lighter — these often pair.",
    125,
    (c) => c.bp === 'calm_concerned' && c.sleep === 'calm_concerned',
  ),
];

const BP_CONFIRMED_URGENT: NarrationTemplateEntry[] = [
  t(
    'bp-cu',
    'BP in confirmed-urgent — calm framing, no fear copy',
    "{parent_label}'s morning number sits in a higher range than usual. Worth a quiet check-in later today.",
    200,
    (c) => c.bp === 'confirmed_urgent',
  ),
];

const HR_DRIFT: NarrationTemplateEntry[] = [
  t(
    'hr-cc.resting-high',
    'Resting HR drifting higher across the week',
    "{parent_label}'s resting heart rate has been higher than usual this week.",
    120,
    (c) =>
      c.hr === 'calm_concerned' &&
      (c.bp ?? 'in_pattern') === 'in_pattern' &&
      (c.spo2 ?? 'in_pattern') === 'in_pattern',
  ),
  t(
    'hr-cu.resting-far-from-baseline',
    'HR confirmed-urgent — calm escalation, no alarm copy',
    "{parent_label}'s resting heart rate has lifted further from their baseline this week. Worth mentioning at the next visit.",
    150,
    (c) => c.hr === 'confirmed_urgent',
  ),
];

const SPO2_DIPS: NarrationTemplateEntry[] = [
  t(
    'spo2-cc.overnight-dips',
    'SpO2 calm-concerned — overnight dips noticed',
    "{parent_label}'s overnight oxygen has dipped a little more than usual this week.",
    115,
    (c) => c.spo2 === 'calm_concerned',
  ),
  t(
    'spo2-cu.sustained-low',
    'SpO2 confirmed-urgent — direct to doctor framing',
    "{parent_label}'s overnight oxygen has been lower across several nights. Worth a chat with their doctor.",
    150,
    (c) => c.spo2 === 'confirmed_urgent',
  ),
];

const SLEEP_PATTERNS: NarrationTemplateEntry[] = [
  t(
    'sleep-cc.short-week',
    'Sleep calm-concerned — week of short nights',
    "{parent_label}'s sleep has been lighter across the week.",
    110,
    (c) =>
      c.sleep === 'calm_concerned' &&
      (c.bp ?? 'in_pattern') === 'in_pattern',
  ),
  t(
    'sleep-cu.fragmented',
    'Sleep confirmed-urgent — sustained pattern',
    "{parent_label}'s sleep has been short and fragmented across the week. The chart shows it in the morning numbers too.",
    140,
    (c) => c.sleep === 'confirmed_urgent',
  ),
];

const ACTIVITY_PATTERNS: NarrationTemplateEntry[] = [
  t(
    'activity.streak-positive',
    'Step target hit several days in a row',
    "{parent_label} hit their step goal {steps_target_hits}. Resting heart rate is two below the week's average.",
    120,
    (c) =>
      c.activityStreak === true &&
      c.bp === 'in_pattern' &&
      c.hr === 'in_pattern',
  ),
  t(
    'activity-cc.low-week',
    'Activity calm-concerned — quieter week',
    "{parent_label}'s movement has been quieter this week.",
    105,
    (c) =>
      c.activity === 'calm_concerned' &&
      (c.bp ?? 'in_pattern') === 'in_pattern',
  ),
];

const CORRELATION_LEAD: NarrationTemplateEntry[] = [
  t(
    'corr.sleep-bp',
    'Lead with the sleep-and-BP correlation',
    "{parent_label}'s shorter nights this week have shown up in the morning numbers — these often go together.",
    130,
    (c) => c.hasMeaningfulCorrelation === 'sleep_bp',
  ),
  t(
    'corr.activity-hr',
    'Lead with the activity-and-HR correlation',
    "{parent_label}'s consistent walking this week has nudged their resting heart rate down.",
    130,
    (c) => c.hasMeaningfulCorrelation === 'activity_hr',
  ),
  t(
    'corr.reading-patterns',
    'Lead with the multi-week reading pattern',
    "{parent_label}'s readings have been settling into a steadier pattern across the past few weeks.",
    130,
    (c) => c.hasMeaningfulCorrelation === 'reading_patterns',
  ),
];

const RETURNING_USER: NarrationTemplateEntry[] = [
  t(
    'returning.no-data-today',
    'No fresh data today — the watch hasn\'t synced yet',
    "{parent_label}'s watch hasn't synced today. The chart will fill in once it does.",
    50,
    (c) => c.centralVital === null,
  ),
];

const FALLBACK: NarrationTemplateEntry[] = [
  t(
    'fallback.calm',
    'Always-applicable safety net so coverage never drops to zero',
    "{parent_label} is in pattern.",
    1,
    () => true,
  ),
];

export const NARRATION_TEMPLATES: ReadonlyArray<NarrationTemplateEntry> = [
  ...CORRELATION_LEAD,
  ...BP_CONFIRMED_URGENT,
  ...HR_DRIFT,
  ...SPO2_DIPS,
  ...BP_CALM_CONCERNED,
  ...SLEEP_LIGHT_BP_OK,
  ...SLEEP_PATTERNS,
  ...ACTIVITY_PATTERNS,
  ...ALL_IN_PATTERN,
  ...RETURNING_USER,
  ...FALLBACK,
];

/**
 * Returns the highest-priority template that applies to the given
 * context. Sprint 12.5's generator will substitute slots; here we
 * just pick.
 */
export function selectNarrationTemplate(
  ctx: NarrationContext,
): NarrationTemplateEntry {
  let best: NarrationTemplateEntry | null = null;
  for (const template of NARRATION_TEMPLATES) {
    if (template.selector(ctx)) {
      if (best === null || template.priority > best.priority) {
        best = template;
      }
    }
  }
  // FALLBACK guarantees we never return null — its selector is `() => true`.
  return best ?? NARRATION_TEMPLATES[NARRATION_TEMPLATES.length - 1];
}

/**
 * Sanity helper for the test that asserts coverage across every
 * reachable state combination.
 */
export function listMatchingTemplates(
  ctx: NarrationContext,
): NarrationTemplateEntry[] {
  return NARRATION_TEMPLATES.filter(t => t.selector(ctx));
}
