// services/ai/trendsNarration — Trends v2.
//
// Produces a voice-clean Tier-A narrative paragraph for the Trends
// screen. Plugs through the Sprint 16 fall-through cascade so the
// surface never shows an "AI failed" error — Tier-B (when wired) →
// Tier-A template → deterministic copy.
//
// Narrative shape: a plain string with a tiny markup syntax for
// italic emphasis. `_text_` wraps an emphasized clause (rendered in
// italic editorial type). The renderer in TrendsLetterHero splits on
// these markers and styles the spans inline. This is forward-
// compatible with the structured-spans contract the design brief
// flags as an open question — once the Tier-B path emits structured
// spans, we replace the string + regex with a typed array; the
// renderer signature stays the same.
//
// Voice rules (D11 §3 / docs/05-voice-and-claims.md): every authored
// string here passes voiceLint. Tested in trendsNarration.test.ts.

import {
  runSingleStringCascade,
  type SingleStringCascadeResult,
} from './fallThrough';
import type { TrendsData, TrendsRange } from '../../utils/trends-aggregate';
import type { CorrelationRow } from '../../types/database';
import {
  buildTrendsLetter,
  type BuildTrendsLetterInput,
  type TrendsLetter,
} from './trendsTierC';

export type BuildTrendsNarrativeInput = BuildTrendsLetterInput;

const RANGE_LABEL: Record<TrendsRange, string> = {
  '7d': 'week',
  '30d': 'month',
  '90d': 'quarter',
  '1y': 'year',
  all_time: 'time',
};

/**
 * Format a clause that names the average BP value in the user's
 * tracked window. Returns empty string when there's no BP data, so
 * the caller can skip the sentence entirely.
 */
function bpAverageClause(data: TrendsData | undefined): string {
  if (!data) return '';
  const { avgSys, avgDia } = data.summary.bp;
  if (avgSys === null || avgDia === null) return '';
  return `${Math.round(avgSys)}/${Math.round(avgDia)}`;
}

/**
 * Map a correlation row to one short clause that the narrative can
 * cite. Voice-clean, descriptive (never prescriptive).
 */
function correlationClause(row: CorrelationRow): string {
  switch (row.correlation_type) {
    case 'sleep_x_morning_bp':
      return 'after the shorter nights, mornings ran a little higher';
    case 'activity_x_resting_hr':
      return 'on the walking days, your heart wakes calmer';
    case 'spo2_dip_x_sleep_score':
      return 'the nights your oxygen dipped were the lighter nights';
    default:
      return '';
  }
}

/**
 * Caregiver variant — same shape, parent-aware pronouns. Returns the
 * caregiver-flavoured clause from a correlation row.
 */
function correlationClauseCaregiver(
  row: CorrelationRow,
  parentLabel: string,
): string {
  switch (row.correlation_type) {
    case 'sleep_x_morning_bp':
      return `after ${parentLabel}'s shorter nights, mornings ran a little higher`;
    case 'activity_x_resting_hr':
      return `on the walking days, ${parentLabel}'s heart wakes calmer`;
    case 'spo2_dip_x_sleep_score':
      return `the nights ${parentLabel}'s oxygen dipped were the lighter nights`;
    default:
      return '';
  }
}

/**
 * The Tier-A template. Composes a short letter-like paragraph from
 * the trends summary + the strongest correlation, if one exists.
 * Falls back to a softer phrasing when only a subset of data is
 * available.
 *
 * Returns `null` when there isn't enough data to author a meaningful
 * paragraph — the cascade will then fall through to deterministic.
 */
export function buildTierATrendsNarrative(
  input: BuildTrendsNarrativeInput,
): string | null {
  const { data, correlations, range, accountType, parentLabel } = input;
  if (!data) return null;

  const bpCount = data.summary.bp.count;
  // Need at least a few BP readings before authoring a "you are in
  // pattern" sentence — be honest about thinness.
  if (bpCount < 3) return null;

  const isCaregiver = accountType === 'caregiver';
  const subject = isCaregiver ? (parentLabel ?? 'Mum') : 'You';
  const verb = isCaregiver ? 'is' : 'are';
  const possessive = isCaregiver ? `${parentLabel ?? 'Mum'}'s` : 'your';
  const windowLabel = RANGE_LABEL[range];
  const avg = bpAverageClause(data);

  const pieces: string[] = [];

  // Lead clause — pattern + emphasis.
  if (avg) {
    pieces.push(
      `${subject} ${verb} _in ${possessive} usual range_ this ${windowLabel}. ${capitalize(
        possessive,
      )} mornings averaged ${avg}.`,
    );
  } else {
    pieces.push(`${subject} ${verb} _in ${possessive} usual range_ this ${windowLabel}.`);
  }

  // Correlation clause — append the strongest meaningful one.
  const top = correlations[0];
  if (top) {
    const clause = isCaregiver
      ? correlationClauseCaregiver(top, parentLabel ?? 'Mum')
      : correlationClause(top);
    if (clause) pieces.push(`And ${clause}.`);
  }

  return pieces.join(' ');
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Cascade integration ──────────────────────────────────────────────

/**
 * Sprint 16.5g — extended cascade result that also carries the
 * structured fields the renderer uses (focal vital, cited day, sign-
 * off). When the cascade falls through to deterministic copy these
 * fields are best-effort defaults.
 */
export interface TrendsNarrativeResult {
  body: string;
  focalVital: TrendsLetter['focalVital'];
  citedDayIdx: number | null;
  signOff: string;
  /** Tier the renderer should attribute the narrative to. */
  tier: 'C' | 'A' | 'deterministic';
}

/**
 * Generate the trends narrative through the Sprint 16 fall-through
 * cascade. Tier-C is the rich deterministic engine (Sprint 16.5g);
 * Tier-A is the legacy 2-sentence template kept as a backup; Tier-B
 * LLM is not yet wired for the narrative surface (needs an Edge
 * Function path that bypasses the Ask Leiko hash-locked prompt).
 *
 * The result type also carries structured fields for the renderer.
 */
export async function generateTrendsNarrative(
  input: BuildTrendsNarrativeInput,
): Promise<TrendsNarrativeResult> {
  // Tier-C: rich deterministic engine. Tries first.
  const letter = buildTrendsLetter(input);
  if (letter) {
    return {
      body: letter.body,
      focalVital: letter.focalVital,
      citedDayIdx: letter.citedDayIdx,
      signOff: letter.signOff,
      tier: 'C',
    };
  }

  // Tier-A fallback: legacy short template.
  const tierA = buildTierATrendsNarrative(input);
  if (tierA) {
    return {
      body: tierA,
      // Best-effort focal pick when Tier-A is the lead.
      focalVital: input.data && input.data.summary.bp.count >= 3 ? 'bp' : 'bp',
      citedDayIdx: null,
      signOff: '— Leiko',
      tier: 'A',
    };
  }

  // Deterministic — preserve cascade visibility for analytics.
  const cascade = await runSingleStringCascade({
    surface: 'trends_narrative',
    tierA: () => null,
  });
  return {
    body: cascade.body,
    focalVital: 'bp',
    citedDayIdx: null,
    signOff: '— Leiko',
    tier: 'deterministic',
  };
}

/** Compatibility alias for callers that only need the string body
 *  (e.g. analytics, tests). Returns the same fall-through chain. */
export async function generateTrendsNarrativeBody(
  input: BuildTrendsNarrativeInput,
): Promise<SingleStringCascadeResult> {
  const r = await generateTrendsNarrative(input);
  // Map Tier-C → 'tier_a' source so the existing analytics surface
  // (which only knows tier_b / tier_a / deterministic) still reads
  // sensibly. Tier-C is functionally an enriched Tier-A.
  return {
    body: r.body,
    source: r.tier === 'deterministic' ? 'deterministic' : 'tier_a',
  };
}

// ── Span renderer helpers ────────────────────────────────────────────

export interface NarrativeSpan {
  text: string;
  em?: boolean;
}

/**
 * Parse a narrative string with `_text_` italic markers into a list
 * of spans the renderer can apply per-span styling to. The markers
 * are stripped; their content gets `em: true`.
 *
 * Forward-compatible: when Tier-B starts emitting structured spans
 * directly, this function disappears in favour of a typed pass-
 * through. Test coverage exercises mixed plain + emphasized content.
 */
export function parseNarrativeSpans(body: string): NarrativeSpan[] {
  if (!body) return [];
  const spans: NarrativeSpan[] = [];
  // Match `_text_` non-greedily. Underscores inside words remain as-is
  // (the next-character check is enforced by the surrounding word
  // boundary — `_pattern_` matches; `snake_case` does not).
  const re = /_([^_]+?)_/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: body.slice(lastIndex, match.index) });
    }
    spans.push({ text: match[1], em: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    spans.push({ text: body.slice(lastIndex) });
  }
  return spans.length === 0 ? [{ text: body }] : spans;
}
