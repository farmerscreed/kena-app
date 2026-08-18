// Canonical status vocabulary — D13 PR-2 (§7.4, closes P0-4 / P2-1).
//
// ONE definition site for every user-facing rendering of a verdict
// tier. Before this module six phrasings existed for one concept
// (the retired enum-name phrase, the all-clear claim, three range
// variants, "steady") and confirmed-urgent had six distinct push titles.
// The retired phrase was internal enum vocabulary promoted to brand copy —
// it means nothing to a reader who hasn't seen the codebase. Retired.
//
// The §7.4 table, verbatim:
//
//   tier            chip                        in a sentence                        push title
//   learning        Learning                    …still learning what's usual for N   (never pushes)
//   in_range        In {poss} usual range       …is in {poss} usual range            (never pushes)
//   worth_a_look    Worth a look                …is a little above {poss} usual      Worth a look
//   talk_to_doctor  Talk to a doctor            …is well above {poss} usual          Please check on {name}
//
// Pronouns: every template takes a Subject { label, possessive } —
// never a hardcoded pronoun. The possessive is user-set at add-person
// time, defaulting to "their" (capturing it in Add Person needs a
// schema field — deferred to the Person Overview build; "their" is
// always safe). The missing-label fallback is "your family member" —
// NEVER the two-word phrase this replaces, which is a documented HARD
// FAIL in docs/05-voice-and-claims.md.
//
// Verdicts are statements about the person's own baseline, never
// clinical categories. Do not re-coin. Do not add synonyms.

import type { Tier } from '../../utils/classification';

export interface Subject {
  /** How the person is named in copy: "Mum", "Dad", "Marian" — or "you". */
  label: string;
  /** Possessive used in copy: "her", "his", "their" — or "your". */
  possessive: string;
}

/** Second-person subject for self-buyer surfaces. */
export const SELF_SUBJECT: Subject = { label: 'you', possessive: 'your' };

/** The only permitted missing-label fallback (docs/05 hard-fail rule). */
export const FALLBACK_SUBJECT: Subject = {
  label: 'your family member',
  possessive: 'their',
};

/** Build a subject from whatever the caller has, with safe fallbacks. */
export function subjectFor(
  label?: string | null,
  possessive?: string | null,
): Subject {
  const trimmed = label?.trim();
  if (!trimmed) return FALLBACK_SUBJECT;
  return { label: trimmed, possessive: possessive?.trim() || 'their' };
}

/** Chip text — sentence case, never uppercase (docs/05:182). */
export function chipTextForTier(tier: Tier, subject: Subject = SELF_SUBJECT): string {
  switch (tier) {
    case 'learning':
      return 'Learning';
    case 'in_range':
      return `In ${subject.possessive} usual range`;
    case 'worth_a_look':
      return 'Worth a look';
    case 'talk_to_doctor':
      return 'Talk to a doctor';
  }
}

/**
 * The sentence fragment following the subject: "{label} —fragment—."
 * Callers compose `${subject.label} ${sentenceFragmentForTier(...)}`.
 */
export function sentenceFragmentForTier(
  tier: Tier,
  subject: Subject = SELF_SUBJECT,
): string {
  switch (tier) {
    case 'learning':
      return `is still learning what's usual for ${subject.label}`;
    case 'in_range':
      return `is in ${subject.possessive} usual range`;
    case 'worth_a_look':
      return `is a little above ${subject.possessive} usual`;
    case 'talk_to_doctor':
      return `is well above ${subject.possessive} usual`;
  }
}

/**
 * Push title per §7.4 — null means this tier NEVER pushes. When
 * nothing warrants action, Leiko stays quiet.
 */
export function pushTitleForTier(tier: Tier, subject: Subject): string | null {
  switch (tier) {
    case 'learning':
    case 'in_range':
      return null;
    case 'worth_a_look':
      return 'Worth a look';
    case 'talk_to_doctor':
      return `Please check on ${subject.label}`;
  }
}

/** Ring / chip colour role per §7.4 (theme key, not a hex). */
export function statusRoleForTier(
  tier: Tier,
): 'learning' | 'inRange' | 'worthALook' | 'talkToDoctor' {
  switch (tier) {
    case 'learning':
      return 'learning';
    case 'in_range':
      return 'inRange';
    case 'worth_a_look':
      return 'worthALook';
    case 'talk_to_doctor':
      return 'talkToDoctor';
  }
}
