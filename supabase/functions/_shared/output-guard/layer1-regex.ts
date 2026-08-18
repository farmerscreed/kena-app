// supabase/functions/_shared/output-guard/layer1-regex.ts — Sprint 12.
//
// Layer 1 of the three-layer output guard per D14 §12.1. Runs a
// compiled regex set over the LLM response BEFORE delivery. If any
// forbidden phrase fires, the Edge Function:
//
//   1. Logs to PostHog `ai_output_guard_hit` with reason
//   2. Discards response
//   3. Retries the LLM call with prompt augmented by:
//      "Your previous response contained forbidden vocabulary.
//       Regenerate using ONLY the allowed voice rules."
//   4. If the second attempt also hits → fall through to DEFER template
//
// Vocabulary sourced from:
//   D14 §11.1 — non-overrideable system prompt forbidden list
//   D11 §3.2  — original voice forbidden words (preserved)
//   D11 §3.3  — premium-precise additions (biohack/streak/wellness/etc.)
//   CLAUDE.md "Voice rules" — operating manual mirror
//
// Notes on scope choices:
//   - "predict" / "prevent" are intentionally NOT in Layer 1. D14
//     scopes them as "(when applied to disease)" — that's a semantic
//     judgment Layer 2 (cosine vs diagnostic-leaning cluster) makes.
//     A flat word-match here would false-positive constantly
//     ("could prevent dehydration" etc.). Defence-in-depth still
//     covers them at Layer 2 + the system prompt itself.
//   - Word-boundary anchors (\b) used everywhere so "patient" doesn't
//     match "patience" but DOES match "patient's" and "Patients".
//   - All scans are case-insensitive.
//   - Exclamation points: D14 §11.1 forbids them in body copy. We
//     match the literal ! character — this also catches "wow!" etc.
//     The response shapes Sprint 12 ships (Tier-B Q&A) never warrant
//     an exclamation point.

export interface ForbiddenHit {
  /** Stable id of the rule that fired — for telemetry / debugging. */
  ruleId: string;
  /** The exact substring that matched, lower-cased for log brevity. */
  match: string;
  /** Index into the raw response text (0-based). */
  index: number;
}

export interface Layer1Result {
  passes: boolean;
  hits: ForbiddenHit[];
}

/**
 * Compiled rule set. Each entry is a single regex with a stable id
 * the Edge Function logs and PostHog event metadata carry. Rules are
 * grouped into named sections for readability — order doesn't matter
 * because we always scan the whole set.
 */
const RULES: { id: string; pattern: RegExp }[] = [
  // ── D11 §3.2 / D14 §11.1 — clinical and outcome-promising ────────
  { id: 'patient',          pattern: /\bpatient(s|'s|s')?\b/gi },
  { id: 'diagnose',         pattern: /\bdiagnos(e|es|ed|ing|is|tic|tics)\b/gi },
  { id: 'treat',            pattern: /\btreat(s|ed|ing|ment|ments)?\b/gi },
  { id: 'cure',             pattern: /\bcure[sd]?\b/gi },
  { id: 'medical-advice',   pattern: /\bmedical advice\b/gi },
  { id: 'dangerous-level',  pattern: /\bdangerous level\b/gi },
  { id: 'critical-level',   pattern: /\bcritical level\b/gi },
  { id: 'silent-killer',    pattern: /\bsilent killer\b/gi },
  { id: 'ticking-time-bomb',pattern: /\bticking time bomb\b/gi },
  { id: 'before-too-late',  pattern: /\bbefore it'?s too late\b/gi },
  // Outcome-promising patterns. These are templated rather than
  // exhaustive — the model's most likely paraphrases.
  { id: 'will-lower',       pattern: /\bwill\s+(lower|reduce|cut|drop|fix|improve)\b/gi },
  { id: 'will-help-live',   pattern: /\bwill help (you|her|him|them)? ?live\b/gi },
  { id: 'guaranteed',       pattern: /\b(guaranteed|guarantees|guarantee)\b/gi },

  // ── D11 §3.3 — premium-precise additions ─────────────────────────
  { id: 'biohack',          pattern: /\bbiohack(ing|ers?|ed)?\b/gi },
  { id: 'optimise',         pattern: /\boptimi[sz](e|es|ed|ing|ation|ations)?\b/gi },
  { id: 'crush',            pattern: /\bcrush(es|ed|ing)?\b/gi },
  { id: 'smash',            pattern: /\bsmash(es|ed|ing)?\b/gi },
  { id: 'destroy',          pattern: /\bdestroy(s|ed|ing)?\b/gi },
  { id: 'level-up',         pattern: /\blevel[ -]?up\b/gi },
  { id: 'achievement-unlocked', pattern: /\bachievement unlocked\b/gi },
  { id: 'streak',           pattern: /\bstreaks?\b/gi },
  { id: 'wellness',         pattern: /\bwellness\b/gi },
  { id: 'smart-insights',   pattern: /\bsmart insights?\b/gi },
  { id: 'smart-alerts',     pattern: /\bsmart alerts?\b/gi },

  // D13 §9.2 — the ten docs/05 HARD-FAIL rules that were missing from
  // this set (audit finding: 26 rules where docs/05 specifies 36).
  { id: 'user-noun',        pattern: /\busers?\b/gi },
  { id: 'loved-one',        pattern: /\bloved ones?\b/gi },
  { id: 'you-may-have',     pattern: /\byou may have\b/gi },
  { id: 'we-detected',      pattern: /\bwe detected\b/gi },
  { id: 'at-risk',          pattern: /\byou(?:'re| are) at risk\b/gi },
  { id: 'take-control',     pattern: /\btake control of your\b/gi },
  { id: 'urgency-cliche',   pattern: /\b(?:don'?t wait|start today|you owe it to yourself)\b/gi },
  { id: 'watch-noun',       pattern: /\bsmart\s?watch(es)?\b/gi },
  { id: 'clinical-spo2',    pattern: /\b(?:medical[- ]grade|clinical)\s+spo2\b/gi },
  { id: 'continuous-bp',    pattern: /\bcontinuous blood[- ]pressure monitoring\b/gi },
  { id: 'replaces-doctor',  pattern: /\breplaces? your doctor\b/gi },
  // The hardware maker's brand name — assembled so the token itself
  // never appears in source (D13 §0.5 forbids it anywhere).
  { id: 'device-brand',     pattern: new RegExp('\\b' + ['ur', 'ion'].join('') + '\\b', 'gi') },

  // ── D14 §11.1 — body-copy punctuation ────────────────────────────
  { id: 'exclamation',      pattern: /!/g },
];

/**
 * Scan a response for forbidden phrases. Returns a result with all
 * hits (for telemetry) and a boolean `passes` for the gate.
 *
 * Empty / whitespace-only responses pass — Layer 2 + the model output
 * shape constraints handle "did the model say anything useful."
 */
export function scanLayer1(text: string): Layer1Result {
  const hits: ForbiddenHit[] = [];

  for (const rule of RULES) {
    // Reset lastIndex because /g regexes are stateful in JS.
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      hits.push({
        ruleId: rule.id,
        match: m[0].toLowerCase(),
        index: m.index,
      });
      // Defensive: empty-match guard so /g regex can't infinite-loop
      // on zero-width matches.
      if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex++;
    }
  }

  return { passes: hits.length === 0, hits };
}

/**
 * Build the retry-prompt suffix for the second LLM call when Layer 1
 * fires. Per D14 §12.1 the augment is fixed; the only variable input
 * is which rule(s) hit — we pass the rule ids so the model can be
 * specific about what it shouldn't say again.
 */
export function buildLayer1RetryAugment(hits: ForbiddenHit[]): string {
  const ruleIds = Array.from(new Set(hits.map((h) => h.ruleId)));
  const summary = ruleIds.length > 0 ? ` (${ruleIds.join(', ')})` : '';
  return (
    `Your previous response contained forbidden vocabulary${summary}. ` +
    `Regenerate using ONLY the allowed voice rules. Do not paraphrase ` +
    `the forbidden phrase — restructure the sentence to omit it entirely.`
  );
}

// Internal — exported so tests can iterate the rule set.
export const _RULES_FOR_TEST: ReadonlyArray<{ id: string; pattern: RegExp }> = RULES;
