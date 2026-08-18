// services/ai/trendsTierC — Sprint 16.5g.
//
// Rich deterministic narrative engine for the Trends "letter" + the
// weekly summary card. Replaces the Sprint 16.5 Tier-A template
// (2-sentence shape) with a multi-sentence, multi-vital, baseline-
// aware paragraph derived from the real aggregated data.
//
// "Tier-C" here means rich-deterministic — not an LLM. It produces
// the same shape of output that an LLM Tier-C engine would, fed by
// the same data, but it's algorithmic. Forward-compatible with a
// future server-side Edge Function: the input/output types match,
// the cascade can swap callbacks without screen-level churn.
//
// The engine also emits structured fields the renderer can use:
//   - body         — the paragraph with `_text_` emphasis markers
//   - focalVital   — which vital the chart below should foreground
//   - citedDayIdx  — index into the focal vital's series for the
//                    annotation pin (when the narrative cites a day)
//   - signOff      — small italicised closing line ("— Leiko")
//
// Voice rules (docs/05-voice-and-claims.md): every string here passes
// voiceLint. Tests exercise edge cases (no BP, no correlations, etc).

import type { TrendsData, TrendsRange } from '../../utils/trends-aggregate';
import type { CorrelationRow, AccountType } from '../../types/database';
import type { VitalType } from '../../components/VitalRing';
import type { BPBaseline, HRBaseline, SpO2Baseline, ActivityBaseline } from '../../utils/vitalBaselines';

export interface BuildTrendsLetterInput {
  data: TrendsData | undefined;
  correlations: CorrelationRow[];
  range: TrendsRange;
  accountType: AccountType;
  /** "Mum" / "Dad" / parent's actual name (NOT the caregiver's name). */
  parentLabel?: string;
  /** Baselines computed from local slice history; null when sample
   *  size is too small to defend a band. */
  baselines?: {
    bp?: BPBaseline | null;
    hr?: HRBaseline | null;
    spo2?: SpO2Baseline | null;
    activity?: ActivityBaseline | null;
  };
}

export interface TrendsLetter {
  /** The paragraph body with `_text_` emphasis markers. */
  body: string;
  /** AI-picked focal vital for the chart below. */
  focalVital: VitalType;
  /** Optional index into the focal vital's series for the annotation
   *  pin. Null when the letter doesn't cite a specific day. */
  citedDayIdx: number | null;
  /** Short closing line, e.g. "— Leiko". Renderer styles italic. */
  signOff: string;
}

const RANGE_WORD: Record<TrendsRange, string> = {
  '7d': 'week',
  '30d': 'month',
  '90d': 'quarter',
  '1y': 'year',
  all_time: 'time',
};

/** Map a correlation row to the primary vital that should be focal
 *  when the letter cites that row. */
function focalForCorrelation(row: CorrelationRow): VitalType {
  switch (row.correlation_type) {
    case 'sleep_x_morning_bp':
      return 'bp';
    case 'activity_x_resting_hr':
      return 'hr';
    case 'spo2_dip_x_sleep_score':
      return 'spo2';
    default:
      return 'bp';
  }
}

/** Pick the focal vital from input. Strategy: top correlation row's
 *  primary vital → BP if there's BP data → first vital with ≥ 3 rows.
 *  Pre-16.5g this was hardcoded to BP on every render. */
export function pickFocalVital(input: BuildTrendsLetterInput): VitalType {
  const top = input.correlations[0];
  if (top) return focalForCorrelation(top);
  if (input.data && input.data.summary.bp.count >= 3) return 'bp';
  if (input.data) {
    const s = input.data.summary;
    if (s.hr.count >= 3) return 'hr';
    if (s.spo2.count >= 3) return 'spo2';
    if (s.sleep.count >= 3) return 'sleep';
    if (s.activity.count >= 3) return 'activity';
  }
  return 'bp';
}

/** Find the day in the focal vital's series most likely to be the
 *  "cited" day — the one with the most extreme deviation from the
 *  range's mean. Returns null when there's no clear outlier or no
 *  data. */
export function pickCitedDayIndex(
  data: TrendsData | undefined,
  focal: VitalType,
): number | null {
  if (!data) return null;
  let values: number[] = [];
  switch (focal) {
    case 'bp':
      values = data.series.bp.map((p) => p.sys);
      break;
    case 'hr':
      values = data.series.hr
        .map((p) => p.restingBpm)
        .filter((v): v is number => v !== null);
      break;
    case 'spo2':
      values = data.series.spo2
        .map((p) => p.avgPercent)
        .filter((v): v is number => v !== null);
      break;
    case 'sleep':
      values = data.series.sleep.map((p) => p.totalMinutes);
      break;
    case 'activity':
      values = data.series.activity.map((p) => p.totalSteps);
      break;
  }
  if (values.length < 4) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let maxIdx = 0;
  let maxDev = 0;
  for (let i = 0; i < values.length; i++) {
    const dev = Math.abs(values[i] - mean);
    if (dev > maxDev) {
      maxDev = dev;
      maxIdx = i;
    }
  }
  // Only surface the annotation when the deviation is meaningful —
  // > 1 standard deviation. Avoids pinning a noisy near-mean day.
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return maxDev > sd ? maxIdx : null;
}

/** Subject + verb + possessive helpers — caregiver/self-buyer aware. */
function pronouns(input: BuildTrendsLetterInput): {
  subject: string;
  verb: string;
  possessive: string;
  parent: string;
} {
  const isCaregiver = input.accountType === 'caregiver';
  const parent = input.parentLabel?.trim() || 'Mum';
  if (isCaregiver) {
    return {
      subject: parent,
      verb: 'is',
      possessive: `${parent}'s`,
      parent,
    };
  }
  return {
    subject: 'You',
    verb: 'are',
    possessive: 'your',
    parent,
  };
}

/** Format a BP comparison line vs the user's baseline band. */
function bpComparisonLine(
  data: TrendsData,
  baseline: BPBaseline | null | undefined,
  possessive: string,
): string {
  const avg = data.summary.bp.avgSys;
  if (avg === null) return '';
  const sysAvg = Math.round(avg);
  const dia = data.summary.bp.avgDia;
  const diaAvg = dia !== null ? Math.round(dia) : null;
  const pair = diaAvg !== null ? `${sysAvg}/${diaAvg}` : `${sysAvg}`;
  if (!baseline) {
    return `${capitalize(possessive)} mornings averaged ${pair}.`;
  }
  const baselineMid = Math.round((baseline.sysLow + baseline.sysHigh) / 2);
  const diff = sysAvg - baselineMid;
  if (Math.abs(diff) <= 3) {
    return `${capitalize(possessive)} mornings averaged ${pair} — _right at the usual band_.`;
  }
  if (diff > 0) {
    return `${capitalize(possessive)} mornings averaged ${pair} — about ${Math.abs(diff)} points _above the usual band_.`;
  }
  return `${capitalize(possessive)} mornings averaged ${pair} — about ${Math.abs(diff)} points below the usual band.`;
}

/** Format a correlation citation clause. */
function correlationClause(
  row: CorrelationRow,
  parentLabel: string,
  isCaregiver: boolean,
): string {
  const possessive = isCaregiver ? `${parentLabel}'s` : 'your';
  switch (row.correlation_type) {
    case 'sleep_x_morning_bp':
      return isCaregiver
        ? `After ${possessive} shorter nights, mornings _ran a little higher_.`
        : `After ${possessive} shorter nights, mornings _ran a little higher_.`;
    case 'activity_x_resting_hr':
      return isCaregiver
        ? `On the walking days, ${possessive} heart _woke calmer_.`
        : `On the walking days, ${possessive} heart _woke calmer_.`;
    case 'spo2_dip_x_sleep_score':
      return isCaregiver
        ? `The nights ${possessive} oxygen dipped were the _lighter nights_.`
        : `The nights ${possessive} oxygen dipped were the _lighter nights_.`;
    default:
      return '';
  }
}

/** What's worth watching — a small forward-looking line. Always calm. */
function watchLine(
  data: TrendsData,
  baseline: BPBaseline | null | undefined,
): string {
  if (!baseline) return '';
  const avg = data.summary.bp.avgSys;
  if (avg === null) return '';
  const diff = Math.round(avg) - Math.round((baseline.sysLow + baseline.sysHigh) / 2);
  if (Math.abs(diff) <= 3) {
    return 'Numbers are tracking the way they usually do.';
  }
  if (diff > 8) {
    return 'Worth a calm look at the week ahead.';
  }
  if (diff > 0) {
    return 'Worth keeping an eye on the next few days.';
  }
  return 'Numbers are sitting on the quieter side.';
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Build the Trends letter — rich deterministic narrative + structured
 * fields the renderer uses. Returns null when there isn't enough data
 * to author a meaningful paragraph; cascade then falls through to the
 * deterministic stand-by copy.
 */
export function buildTrendsLetter(
  input: BuildTrendsLetterInput,
): TrendsLetter | null {
  const { data, correlations, range } = input;
  if (!data) return null;

  // Need at least one vital with ≥ 3 entries — multi-vital empty gate.
  const summary = data.summary;
  const anyHasData =
    summary.bp.count >= 3 ||
    summary.hr.count >= 3 ||
    summary.spo2.count >= 3 ||
    summary.sleep.count >= 3 ||
    summary.activity.count >= 3;
  if (!anyHasData) return null;

  const { subject, verb, possessive, parent } = pronouns(input);
  const isCaregiver = input.accountType === 'caregiver';
  const windowLabel = RANGE_WORD[range];
  const baseline = input.baselines?.bp ?? null;

  const focalVital = pickFocalVital(input);
  const citedDayIdx = pickCitedDayIndex(data, focalVital);

  // Compose the letter. 3-4 short sentences, never more.
  const pieces: string[] = [];

  // 1. Lead — pattern declaration.
  pieces.push(`${subject} ${verb} _in ${possessive} usual range_ this ${windowLabel}.`);

  // 2. BP comparison — uses baseline when available.
  if (summary.bp.count >= 3) {
    const cmp = bpComparisonLine(data, baseline, possessive);
    if (cmp) pieces.push(cmp);
  }

  // 3. Strongest correlation — cited.
  const top = correlations[0];
  if (top) {
    const clause = correlationClause(top, parent, isCaregiver);
    if (clause) pieces.push(clause);
  }

  // 4. Watch line — forward-looking.
  if (summary.bp.count >= 3) {
    const watch = watchLine(data, baseline);
    if (watch) pieces.push(watch);
  }

  const body = pieces.join(' ');
  const signOff = isCaregiver ? '— Leiko' : '— Leiko';

  return { body, focalVital, citedDayIdx, signOff };
}

// ── Weekly summary engine ──────────────────────────────────────────

export interface BuildWeeklySummaryInput
  extends Omit<BuildTrendsLetterInput, 'range'> {
  /** Always 7d for weekly summary. */
  range?: TrendsRange;
}

export interface WeeklySummary {
  /** Short eyebrow shown above the card body. */
  eyebrow: string;
  /** 2-3 sentence body — a "what your week did" recap. */
  body: string;
}

/**
 * Build the weekly summary card body — a "letter every Sunday" recap.
 * Different shape from the main Trends letter: present-tense recap,
 * no forward-looking watch line, no correlation citation. Returns
 * null when there's no meaningful week to summarise.
 */
export function buildWeeklySummary(
  input: BuildWeeklySummaryInput,
): WeeklySummary | null {
  const { data } = input;
  if (!data) return null;
  const summary = data.summary;
  const anyHasData =
    summary.bp.count >= 3 ||
    summary.hr.count >= 3 ||
    summary.sleep.count >= 3 ||
    summary.activity.count >= 3;
  if (!anyHasData) return null;

  const { possessive } = pronouns({ ...input, range: input.range ?? '7d' });
  const baseline = input.baselines?.bp ?? null;

  const pieces: string[] = [];

  // Lead: BP highlight or quieter vital if BP is thin.
  if (summary.bp.count >= 3 && summary.bp.avgSys !== null) {
    const avg = Math.round(summary.bp.avgSys);
    const dia = summary.bp.avgDia !== null ? Math.round(summary.bp.avgDia) : null;
    const pair = dia !== null ? `${avg}/${dia}` : `${avg}`;
    const pctInRange = summary.bp.pctInRange;
    let lead = `This week ${possessive} mornings averaged ${pair}`;
    if (pctInRange !== null) {
      const pct = Math.round(pctInRange * 100);
      if (pct >= 80) lead += `, with most days in range.`;
      else if (pct >= 50) lead += `, with about half the days in range.`;
      else lead += `, with a few days running higher than usual.`;
    } else {
      lead += '.';
    }
    pieces.push(lead);
  } else if (summary.sleep.count >= 3 && summary.sleep.avgTotalMinutes !== null) {
    const mins = Math.round(summary.sleep.avgTotalMinutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    pieces.push(
      `This week ${possessive} sleep averaged ${h}h ${m}m a night.`,
    );
  }

  // Secondary: pull a calm contrast from a non-BP vital.
  if (summary.activity.count >= 3 && summary.activity.avgSteps !== null) {
    const steps = Math.round(summary.activity.avgSteps);
    pieces.push(
      `Step days averaged ${steps.toLocaleString()} — a ${steps >= 6000 ? 'comfortable' : 'gentle'} pace.`,
    );
  } else if (summary.hr.count >= 3 && summary.hr.avgResting !== null) {
    pieces.push(
      `Resting heart rate held around ${Math.round(summary.hr.avgResting)} bpm.`,
    );
  }

  // Sign-off — calm, brief.
  const baselineAware =
    baseline !== null && summary.bp.avgSys !== null
      ? Math.abs(
          Math.round(summary.bp.avgSys) -
            Math.round((baseline.sysLow + baseline.sysHigh) / 2),
        ) <= 4
      : false;
  if (baselineAware) {
    pieces.push('A steady week. Talk to your doctor at the next visit if anything’s on your mind.');
  } else {
    pieces.push('Talk to your doctor at the next visit if anything’s on your mind.');
  }

  return {
    eyebrow: 'Your week, in short',
    body: pieces.join(' '),
  };
}

/** Mirror parentLabel resolution to keep callers consistent. Useful
 *  for unit tests that exercise both letter + weekly summary against
 *  the same input shape. */
export function resolveParentLabel(profileDisplayName?: string | null): string {
  return profileDisplayName?.trim() || 'Mum';
}
