// Canonical vocabulary — D13 PR-2 (§7.4). These tests ARE the table:
// any change to a string here is a product decision, not a refactor.

import { lintVoiceText } from '../voiceLint';
import {
  chipTextForTier,
  sentenceFragmentForTier,
  pushTitleForTier,
  statusRoleForTier,
  subjectFor,
  SELF_SUBJECT,
  FALLBACK_SUBJECT,
} from '../tierVocabulary';
import type { Tier } from '../../../utils/classification';

const TIERS: Tier[] = ['learning', 'in_range', 'worth_a_look', 'talk_to_doctor'];
const mum = subjectFor('Mum', 'her');

describe('the §7.4 table, verbatim', () => {
  it('chips', () => {
    expect(chipTextForTier('learning', mum)).toBe('Learning');
    expect(chipTextForTier('in_range', mum)).toBe('In her usual range');
    expect(chipTextForTier('in_range', SELF_SUBJECT)).toBe('In your usual range');
    expect(chipTextForTier('worth_a_look', mum)).toBe('Worth a look');
    expect(chipTextForTier('talk_to_doctor', mum)).toBe('Talk to a doctor');
  });

  it('sentence fragments', () => {
    expect(sentenceFragmentForTier('learning', mum)).toBe(
      "is still learning what's usual for Mum",
    );
    expect(sentenceFragmentForTier('in_range', mum)).toBe('is in her usual range');
    expect(sentenceFragmentForTier('worth_a_look', mum)).toBe('is a little above her usual');
    expect(sentenceFragmentForTier('talk_to_doctor', mum)).toBe('is well above her usual');
  });

  it('push titles — learning and in_range NEVER push', () => {
    expect(pushTitleForTier('learning', mum)).toBeNull();
    expect(pushTitleForTier('in_range', mum)).toBeNull();
    expect(pushTitleForTier('worth_a_look', mum)).toBe('Worth a look');
    expect(pushTitleForTier('talk_to_doctor', mum)).toBe('Please check on Mum');
  });

  it('status roles', () => {
    expect(statusRoleForTier('learning')).toBe('learning');
    expect(statusRoleForTier('in_range')).toBe('inRange');
    expect(statusRoleForTier('worth_a_look')).toBe('worthALook');
    expect(statusRoleForTier('talk_to_doctor')).toBe('talkToDoctor');
  });
});

describe('subjects', () => {
  it('missing label falls back to the only permitted phrase', () => {
    expect(subjectFor(null)).toEqual(FALLBACK_SUBJECT);
    expect(subjectFor('   ')).toEqual(FALLBACK_SUBJECT);
    expect(FALLBACK_SUBJECT.label).toBe('your family member');
  });

  it('missing possessive defaults to "their" — never inferred from the name', () => {
    expect(subjectFor('Dad').possessive).toBe('their');
    expect(subjectFor('Marian').possessive).toBe('their');
  });

  it('a user-set possessive flows through verbatim', () => {
    expect(subjectFor('Dad', 'his').possessive).toBe('his');
  });
});

describe('voice rules', () => {
  it('every string for every tier × subject passes the voice lint', () => {
    const subjects = [SELF_SUBJECT, mum, subjectFor('Dad', 'his'), FALLBACK_SUBJECT];
    for (const tier of TIERS) {
      for (const s of subjects) {
        for (const text of [
          chipTextForTier(tier, s),
          `${s.label} ${sentenceFragmentForTier(tier, s)}.`,
          pushTitleForTier(tier, s) ?? '',
        ]) {
          const { hardHits } = lintVoiceText(text);
          expect({ tier, text, hardHits }).toEqual({ tier, text, hardHits: [] });
        }
      }
    }
  });

  it('nothing is uppercase-shouted', () => {
    for (const tier of TIERS) {
      const chip = chipTextForTier(tier, mum);
      expect(chip).not.toBe(chip.toUpperCase());
    }
  });
});
