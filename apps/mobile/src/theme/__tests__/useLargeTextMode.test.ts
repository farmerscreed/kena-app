// useLargeTextMode — Sprint 19 (audit D12 P0-6).
//
// Guards the resolution rule and, more importantly, the four blockers
// the audit found. The parent large-text scale existed for months and
// was unreachable; these tests make "unreachable again" a failing build.

import { resolveTypeMode } from '../useLargeTextMode';
import { getTypeStyle, typeScale } from '../tokens/typography';

describe('resolveTypeMode', () => {
  it('honours an explicit "on" regardless of OS scale', () => {
    expect(resolveTypeMode('on', 1.0)).toBe('parent');
    expect(resolveTypeMode('on', 0.85)).toBe('parent');
  });

  it('honours an explicit "off" even when the OS scale is large', () => {
    // The user has said no. A phone-level setting must not override it.
    expect(resolveTypeMode('off', 2.0)).toBe('caregiver');
  });

  it('auto-enables from the OS font scale at the threshold', () => {
    expect(resolveTypeMode('auto', 1.0)).toBe('caregiver');
    expect(resolveTypeMode('auto', 1.29)).toBe('caregiver');
    expect(resolveTypeMode('auto', 1.3)).toBe('parent');
    expect(resolveTypeMode('auto', 2.0)).toBe('parent');
  });
});

describe('parent type scale actually enlarges what matters', () => {
  it('enlarges body copy', () => {
    expect(getTypeStyle('parent', 'bodyL').size).toBeGreaterThan(
      getTypeStyle('caregiver', 'bodyL').size,
    );
  });

  it('enlarges the small numerics — the reading itself', () => {
    // The original override set covered only body/title/label/caption,
    // so "large text" did not enlarge a single NUMBER. For a blood
    // pressure app that is not a large-text mode.
    for (const token of ['numericS', 'numericM'] as const) {
      expect(getTypeStyle('parent', token).size).toBeGreaterThan(
        getTypeStyle('caregiver', token).size,
      );
    }
  });

  it('enlarges the uppercase label used for vital tiles and eyebrows', () => {
    expect(getTypeStyle('parent', 'labelUppercase').size).toBeGreaterThan(
      getTypeStyle('caregiver', 'labelUppercase').size,
    );
  });

  it('leaves the giant display numerics alone — they are ring-bound', () => {
    for (const token of ['numericHero', 'numericXl', 'numericL'] as const) {
      expect(getTypeStyle('parent', token).size).toBe(
        getTypeStyle('caregiver', token).size,
      );
    }
  });

  it('never produces a parent size below the 11pt legibility floor', () => {
    for (const token of Object.keys(typeScale.caregiver) as Array<
      keyof typeof typeScale.caregiver
    >) {
      expect(getTypeStyle('parent', token).size).toBeGreaterThanOrEqual(11);
    }
  });

  it('never shrinks any token relative to caregiver scale', () => {
    for (const token of Object.keys(typeScale.caregiver) as Array<
      keyof typeof typeScale.caregiver
    >) {
      expect(getTypeStyle('parent', token).size).toBeGreaterThanOrEqual(
        getTypeStyle('caregiver', token).size,
      );
    }
  });
});
