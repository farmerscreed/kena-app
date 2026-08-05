// services/ai/dailyNarration — Sprint 12.5 session 1.
//
// Mobile-side daily narration generator. Wraps Sprint 11's
// `selectNarrationTemplate` (Tier-A) with the slot-substitution
// layer the Sprint 11 close-out memo flagged as Sprint 12.5 work.
//
// Architecture decision (D14 §3.2 routing): Tier-A ALWAYS runs
// client-side because the templates are voice-rule-clean by
// construction and require no network. Free users hit Tier-A
// only; Plus users with a "novel" pattern (multi-vital concerned
// / new correlation / 7d absence / baseline anomaly) escalate to
// Tier-B via the ai-daily-narration Edge Function. The Tier-B
// path is wired in session 2; session 1 ships Tier-A end-to-end
// to replace the PLACEHOLDER_AI_NARRATION strings on Home.
//
// Caching: MMKV-keyed by `daily_narration:${userId}:${YYYY-MM-DD}`
// with a 4h TTL (D14 Q-D14-4). The hook (useDailyNarration) reads
// the cache before regenerating; pull-to-refresh on Home forces
// a fresh render. Server-side ai_narration_cache writes happen
// through the Edge Function in session 2 so audit-log + analytics
// stay aligned with the existing AI surfaces.

import {
  selectNarrationTemplate,
  type NarrationContext,
  type NarrationTier,
} from './narrationTemplates';
import type { DailyPulseData } from '../../state/dailyPulse';
import type { AccountType } from '../../types/database';

export interface NarrationSlots {
  parent_label: string;
  bp_value: string;
  bp_delta: string;
  bp_week_avg: string;
  hr_resting: string;
  sleep_total: string;
  steps_today: string;
  steps_target_hits: string;
}

// ── Slot rendering ────────────────────────────────────────────────────

/**
 * Substitute `{slot_name}` tokens in a template body with values
 * from the slots map. Unknown slots are left in place as-is so a
 * mismatch is loud during development rather than silently shipping
 * partial copy.
 *
 * Post-substitution: capitalise the first letter of the rendered
 * string. Every Sprint 11 template leads with a slot (`{parent_label}`
 * or `{parent_label}'s …`), and `display_name` is stored as the user
 * typed it during onboarding — `biebele` lowercased gets rendered as
 * a lowercase sentence-leading character which fails sentence-case
 * (D11 §3.4). This handles the case purely at the display boundary;
 * the stored name stays user-controlled.
 */
export function renderNarration(
  template: string,
  slots: NarrationSlots,
): string {
  const substituted = template.replace(/\{([a-z_]+)\}/g, (match, key: string) => {
    const value = (slots as unknown as Record<string, string>)[key];
    return typeof value === 'string' && value.length > 0 ? value : match;
  });
  if (substituted.length === 0) return substituted;
  return substituted.charAt(0).toUpperCase() + substituted.slice(1);
}

// ── Slot value derivers ───────────────────────────────────────────────

function formatBpValue(latest: { systolic: number; diastolic: number } | null): string {
  if (!latest) return '—';
  return `${latest.systolic}/${latest.diastolic}`;
}

/**
 * A complete predicate describing where the latest systolic sits against
 * the week's average — e.g. "six above the week's average".
 *
 * Sprint 19 (audit D12 P0-7). This used to return a fragment ("six above
 * her week") into templates that ALSO supplied "above her week",
 * composing to "…is six above her week above her week." and, in the
 * uncomputable case, "…is in pattern above her week." The templates now
 * end at the slot, so this function owns the whole predicate. If you
 * change the shape here, change `BP_CALM_CONCERNED` in
 * narrationTemplates.ts to match — and see the composition test in
 * __tests__/dailyNarration.test.ts, which asserts the rendered sentence
 * rather than the slot in isolation.
 *
 * Gender-neutral by construction: the week belongs to nobody in the
 * copy, so a "Dad" parent_label never collides with "her".
 */
function formatBpDelta(
  latestSys: number | null,
  weekAvgSys: number | null,
): string {
  // Both templates consuming this slot only fire on a calm_concerned BP
  // tier, so "higher than usual" is true by construction when we can't
  // compute a magnitude. We never invent a number.
  if (latestSys === null || weekAvgSys === null) return 'higher than usual';
  const diff = latestSys - weekAvgSys;
  if (Math.abs(diff) < 1) return "in line with the week's average";
  const wordFor = (n: number): string => {
    const map: Record<number, string> = {
      1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
      6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
    };
    return map[n] ?? `${n}`;
  };
  const word = wordFor(Math.abs(diff));
  return diff < 0
    ? `${word} below the week's average`
    : `${word} above the week's average`;
}

function formatBpWeekAvg(weekAvgSys: number | null, weekAvgDia: number | null): string {
  if (weekAvgSys === null || weekAvgDia === null) return '—';
  return `${weekAvgSys}/${weekAvgDia}`;
}

function formatHrResting(restingBpm: number | null): string {
  // Round at the boundary — rollingMinAverage in state/hr.ts returns
  // a float, and unrounded values leak into both the home hero AND
  // the narration template's {hr_resting} slot.
  return restingBpm !== null ? `${Math.round(restingBpm)}` : '—';
}

function formatSleepTotal(totalMinutes: number | null): string {
  if (totalMinutes === null || totalMinutes === 0) return '—';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatStepsToday(steps: number | null): string {
  if (steps === null) return '—';
  // Plain locale-free thousands grouping — RN's Intl support varies
  // across Hermes builds and the template is plain English regardless.
  return steps.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatStepsTargetHits(daysHit: number | null): string {
  if (daysHit === null) return '—';
  const map: Record<number, string> = {
    0: 'zero days',
    1: 'one day',
    2: 'two days',
    3: 'three days',
    4: 'four days',
    5: 'five days',
    6: 'six days',
    7: 'seven days',
  };
  return map[daysHit] ?? `${daysHit} days`;
}

// ── NarrationContext + slots from DailyPulseData ──────────────────────

/**
 * Map our finer-grained vital classification tiers into the 3-tier
 * `NarrationTier` Sprint 11 templates use. `confirmed_urgent` is
 * preserved because some templates select on it; the other states
 * collapse to `in_pattern` (true in-pattern OR no-data) or
 * `calm_concerned` (any concerning state).
 */
function classificationToNarrationTier(
  tier: string | undefined | null,
): NarrationTier | undefined {
  if (!tier) return undefined;
  if (tier === 'confirmed_urgent') return 'confirmed_urgent';
  if (tier === 'calm_concerned' || tier === 'watch' || tier === 'act') {
    return 'calm_concerned';
  }
  return 'in_pattern';
}

/**
 * Pick the central vital per D13 §7.2. Mirrors `pickCentralValue`
 * in `utils/dayMoments.ts` but returns the centralVital token the
 * narration context expects.
 */
function pickCentralVital(data: DailyPulseData): NarrationContext['centralVital'] {
  if (data.bp.latest && data.bp.latestSampleSec !== null) return 'bp';
  if (data.hr.restingToday !== null) return 'hr';
  if (data.sleep.session) return 'sleep';
  if (data.activity.stepsToday > 0) return 'activity';
  if (data.spo2.latestPercent !== null) return 'spo2';
  return null;
}

export interface BuildNarrationContextInput {
  data: DailyPulseData;
  /** Top meaningful correlation type, if any. */
  meaningfulCorrelation?: NarrationContext['hasMeaningfulCorrelation'];
  /** True when the user just hit a multi-day pattern (e.g. ≥4-of-7 step target). */
  activityStreak?: boolean;
}

export function buildNarrationContext(
  input: BuildNarrationContextInput,
): NarrationContext {
  const { data } = input;
  return {
    centralVital: pickCentralVital(data),
    bp: classificationToNarrationTier(data.bp.classification?.tier),
    hr: classificationToNarrationTier(data.hr.classification?.tier),
    spo2: classificationToNarrationTier(data.spo2.classification?.tier),
    sleep: classificationToNarrationTier(data.sleep.classification?.tier),
    activity: classificationToNarrationTier(data.activity.classification?.tier),
    hasMeaningfulCorrelation: input.meaningfulCorrelation ?? null,
    activityStreak: input.activityStreak ?? false,
  };
}

export interface BuildNarrationSlotsInput {
  data: DailyPulseData;
  parentLabel: string;
  weekAverageSystolic?: number | null;
  weekAverageDiastolic?: number | null;
  /** Days in last 7 where steps met target. */
  stepsTargetDaysHit?: number | null;
}

export function buildNarrationSlots(
  input: BuildNarrationSlotsInput,
): NarrationSlots {
  const { data, parentLabel } = input;
  const weekAvgSys = input.weekAverageSystolic ?? null;
  const weekAvgDia = input.weekAverageDiastolic ?? null;
  return {
    parent_label: parentLabel,
    bp_value: formatBpValue(data.bp.latest),
    bp_delta: formatBpDelta(data.bp.latest?.systolic ?? null, weekAvgSys),
    bp_week_avg: formatBpWeekAvg(weekAvgSys, weekAvgDia),
    hr_resting: formatHrResting(data.hr.restingToday),
    sleep_total: formatSleepTotal(data.sleep.session?.totalMinutes ?? null),
    steps_today: formatStepsToday(data.activity.stepsToday),
    steps_target_hits: formatStepsTargetHits(input.stepsTargetDaysHit ?? null),
  };
}

// ── Top-level generator ───────────────────────────────────────────────

export interface GenerateDailyNarrationInput {
  data: DailyPulseData;
  parentLabel: string;
  accountType: AccountType;
  meaningfulCorrelation?: NarrationContext['hasMeaningfulCorrelation'];
  activityStreak?: boolean;
  weekAverageSystolic?: number | null;
  weekAverageDiastolic?: number | null;
  stepsTargetDaysHit?: number | null;
}

export interface DailyNarrationResult {
  text: string;
  templateId: string;
  tier: 'A';
}

/**
 * Sprint 12.5 session 1 — Tier-A only. Picks a Sprint 11 template
 * based on the classification context and substitutes slots with
 * formatted values from DailyPulseData. The Tier-B novel-pattern
 * path lands in session 2 via the ai-daily-narration Edge Function.
 *
 * Voice rules (D11 §3 / CLAUDE.md): every template was authored to
 * pass voice-lint at build time (Sprint 11 close-out). This function
 * only fills slot values; the surrounding prose stays voice-clean.
 */
export function generateDailyNarrationTierA(
  input: GenerateDailyNarrationInput,
): DailyNarrationResult {
  const ctx = buildNarrationContext(input);
  const template = selectNarrationTemplate(ctx);
  const slots = buildNarrationSlots(input);
  const text = renderNarration(template.text, slots);
  return {
    text,
    templateId: template.id,
    tier: 'A',
  };
}
