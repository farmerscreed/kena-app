// colorQuarantine — Sprint 19 (audit D12 P1-1).
//
// The rule this enforces: a colour means exactly one thing.
//
// Before the fix, three semantic roles resolved to the identical hex:
//
//   brand.primary  = #E8A063   (things you tap)
//   vital.bp       = #E8A063   (your blood pressure)
//   state.warning  = #E8A063   (a calm-concerned anomaly)
//
// Contrast between "tappable" and "your reading" was 1.00:1. A user
// cannot learn a colour language that is ambiguous by construction, and
// a measurement painted in the interactive colour is a false affordance
// — which is exactly what PersonOrb shipped: a coral BP value inside a
// Pressable, the same coral as the active tab and the FAB.
//
// This test does not assert specific hexes; a designer may move them.
// It asserts the SEPARATION, which is the part that must not regress.

import { semanticColorsDark, semanticColorsLight } from '../color';
import type { SemanticColors } from '../color';

const MODES: Array<[string, SemanticColors]> = [
  ['dark', semanticColorsDark],
  ['light', semanticColorsLight],
];

describe.each(MODES)('colour quarantine (%s)', (_mode, colors) => {
  it('separates the interactive accent from the BP data colour', () => {
    expect(colors.vital.bp).not.toBe(colors.brand.primary);
    expect(colors.vital.bp).not.toBe(colors.brand.coral);
  });

  it('separates the interactive accent from the anomaly state colour', () => {
    expect(colors.state.warning).not.toBe(colors.brand.primary);
    expect(colors.state.warning).not.toBe(colors.brand.coral);
  });

  it('separates the BP data colour from the anomaly state colour', () => {
    // Distinct questions: "this is your blood pressure" vs "this reading
    // is worth a look". They must not look identical.
    expect(colors.vital.bp).not.toBe(colors.state.warning);
  });

  it('keeps every vital chromatic distinct from every other', () => {
    const vitals = Object.entries(colors.vital);
    for (const [aName, a] of vitals) {
      for (const [bName, b] of vitals) {
        if (aName === bName) continue;
        expect(`${aName}:${a}`).not.toBe(`${bName}:${b}`);
      }
    }
  });

  it('keeps no vital chromatic equal to an interactive colour', () => {
    for (const [name, value] of Object.entries(colors.vital)) {
      expect(`${name}:${value}`).not.toBe(`${name}:${colors.brand.primary}`);
      expect(`${name}:${value}`).not.toBe(`${name}:${colors.brand.coral}`);
    }
  });

  it('reserves the urgent colour for state, never for brand or vitals', () => {
    expect(colors.state.urgent).not.toBe(colors.brand.primary);
    expect(colors.state.urgent).not.toBe(colors.brand.coral);
    for (const value of Object.values(colors.vital)) {
      expect(value).not.toBe(colors.state.urgent);
    }
  });
});

// ── Known, deliberately unfixed collisions ───────────────────────────
//
// `brand.coral`, `person[1]` and `status.attention` all resolve to
// #FF7350. Unlike the amber collision this one cannot be fixed in code
// alone: `theme.colors.person` defines exactly three accents, so
// changing person[1] means adding palette entries, and the per-person
// accent rotation (1..3) already means a fourth family member reuses the
// first person's colour. Both are palette decisions.
//
// CLAUDE.md's rule is to raise rather than guess on design, so this is
// documented here rather than silently changed. The test below pins the
// CURRENT state so the day someone does fix it, this fails loudly and
// gets deleted rather than quietly drifting.
describe('known collision — awaiting designer input', () => {
  it('still shares one hex across brand.coral, person 1 and status.attention', () => {
    const { brand, person, status } = semanticColorsDark;
    expect(person[1]).toBe(brand.coral);
    expect(status.attention).toBe(brand.coral);
  });
});
