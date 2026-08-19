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
// D13 PR-5 (§5.1) — the designer input arrived: person accents come
// from a dedicated ramp used ONLY for avatars and orb rings, never for
// a value or a status. The old pin (person.1 === status.attention ===
// brand.coral) is inverted: the decoupling must not regress.
describe('person accents are decoupled from status (D13 §5.1)', () => {
  it('status.attention no longer borrows the person-1 coral', () => {
    const { brand, person, status } = semanticColorsDark;
    expect(status.attention).not.toBe(person[1]);
    expect(status.attention).not.toBe(brand.coral);
  });
});

// ── D13 PR-5 (§5.1) — the three-family fork, enforced ────────────────
//
// Colour has exactly three families and they never overlap:
//   interactive (copper) · status (verdicts only) · series (plot areas).
// Plus the contrast floor: every status foreground ≥ 4.5:1 against the
// dark surface AND against its own 14–16% tint over that surface.

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const chan = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** fg composited over bg at alpha — the tinted chip background. */
function tintOver(fg: string, bg: string, alpha: number): string {
  const f = fg.replace('#', '');
  const g = bg.replace('#', '');
  const mix = (i: number) =>
    Math.round(
      parseInt(f.slice(i, i + 2), 16) * alpha +
        parseInt(g.slice(i, i + 2), 16) * (1 - alpha),
    )
      .toString(16)
      .padStart(2, '0');
  return `#${mix(0)}${mix(2)}${mix(4)}`;
}

const DARK_SURFACE = '#171310';

describe('the three-family fork (D13 §5.1)', () => {
  const c = semanticColorsDark;
  const interactive = { primary: c.brand.primary, coral: c.brand.coral };
  const status = c.status;
  const series = c.vital;

  it('no hex is shared between interactive, status and series families', () => {
    const families: Array<[string, Record<string, string>]> = [
      ['interactive', interactive],
      ['status', status as unknown as Record<string, string>],
      ['series', series as unknown as Record<string, string>],
    ];
    for (let i = 0; i < families.length; i++) {
      for (let j = i + 1; j < families.length; j++) {
        const [nameA, a] = families[i];
        const [nameB, b] = families[j];
        for (const [ka, va] of Object.entries(a)) {
          for (const [kb, vb] of Object.entries(b)) {
            expect({ pair: `${nameA}.${ka} vs ${nameB}.${kb}`, same: va === vb }).toEqual({
              pair: `${nameA}.${ka} vs ${nameB}.${kb}`,
              same: false,
            });
          }
        }
      }
    }
  });

  it('no series or status colour appears in the interactive family', () => {
    const forbidden = new Set([
      ...Object.values(status as unknown as Record<string, string>),
      ...Object.values(series as unknown as Record<string, string>),
    ]);
    for (const [k, v] of Object.entries(interactive)) {
      expect({ token: k, leaked: forbidden.has(v) }).toEqual({ token: k, leaked: false });
    }
  });

  it('every status foreground meets 4.5:1 against the dark surface and its own tint', () => {
    for (const [k, v] of Object.entries(status as unknown as Record<string, string>)) {
      const vsSurface = contrastRatio(v, DARK_SURFACE);
      const vsTint = contrastRatio(v, tintOver(v, DARK_SURFACE, 0.14));
      expect({ token: k, vsSurface: vsSurface >= 4.5, vsTint: vsTint >= 4.5 }).toEqual({
        token: k,
        vsSurface: true,
        vsTint: true,
      });
    }
  });
});
