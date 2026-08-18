// Verifies D12 token values match the spec exactly. If D12 changes a hex
// value, ms duration, or font family, this test fails — which is the signal
// to update the corresponding tokens file.

import {
  paletteDark,
  paletteLight,
  getSemanticColors,
  semanticColorsDark,
  semanticColorsLight,
} from '../color';
import { fontFamilies, typeScale, getTypeStyle } from '../typography';
import { spacing } from '../spacing';
import { radii } from '../radii';
import { elevationDark, elevationLight, getElevation } from '../elevation';
import { duration, reducedMotionDuration, easing, spring } from '../motion';
import { opacity } from '../opacity';
import { iconSize, phosphorIconName } from '../icon';

describe('color — raw palette dark (D12 §2.2)', () => {
  it('matches D12 §2.2 hex values exactly', () => {
    expect(paletteDark.midnight[900]).toBe('#0A0F1A');
    expect(paletteDark.midnight[850]).toBe('#11171F');
    expect(paletteDark.midnight[800]).toBe('#1A2030');
    expect(paletteDark.midnight[750]).toBe('#222937');
    // Sprint 16.6 — pure #FFFFFF across all dark-mode text tokens
    // after multiple on-device iterations: warm-cream candidates
    // (#FBF8F4, #F9F6EE, #F5EFE2) all read as dim/off-white on the
    // bench Android device. Pure white removes the perception
    // ambiguity at the cost of editorial warmth.
    expect(paletteDark.bone[50]).toBe('#FFFFFF');
    expect(paletteDark.amber[500]).toBe('#C96442'); // D13 §5.1 interactive copper
    expect(paletteDark.coral[500]).toBe('#D6745A');
    expect(paletteDark.teal[500]).toBe('#5FA8A8');
    expect(paletteDark.violet[500]).toBe('#7C7AAB');
    expect(paletteDark.sage[500]).toBe('#7CA56F');
    expect(paletteDark.crimson[700]).toBe('#A8403F');
  });
});

describe('color — raw palette light (D12 §2.3)', () => {
  it('matches D12 §2.3 hex values exactly', () => {
    expect(paletteLight.linen[50]).toBe('#FBF9F5');
    expect(paletteLight.ink[900]).toBe('#0F121C');
    // Sprint 14.5 task 6 — light-mode amber darkened to meet D12
    // §2.6 contrast minimum on linen. Dark-mode amber stays.
    expect(paletteLight.amber[500]).toBe('#B4742E');
    expect(paletteLight.coral[500]).toBe('#C95F44');
    expect(paletteLight.crimson[700]).toBe('#8C2D2D');
  });
});

describe('color — semantic resolver (D12 §2.4)', () => {
  it('dark mode resolves brand.primary to amber-500', () => {
    expect(getSemanticColors('dark').brand.primary).toBe('#C96442');
  });

  it('light mode resolves brand.primary to the darker amber-500 (Sprint 14.5 contrast fix)', () => {
    expect(getSemanticColors('light').brand.primary).toBe('#B4742E');
  });

  it('dark mode reserves urgent for crimson-700 only', () => {
    expect(semanticColorsDark.state.urgent).toBe('#A8403F');
  });

  it('rim border is dark-mode only — transparent on light', () => {
    expect(semanticColorsDark.border.rim).toBe('rgba(255,255,255,0.06)');
    expect(semanticColorsLight.border.rim).toBe('transparent');
  });

  it('text on amber stays dark in both modes', () => {
    expect(semanticColorsDark.text.onBrand).toBe('#0A0F1A');
    expect(semanticColorsLight.text.onBrand).toBe('#0A0F1A');
  });
});

describe('typography (D12 §3 — Inter-only stack)', () => {
  it('uses the expo-google-fonts Inter family names exactly', () => {
    expect(fontFamilies.body).toBe('Inter_400Regular');
    expect(fontFamilies.bodyMedium).toBe('Inter_500Medium');
    expect(fontFamilies.bodySemiBold).toBe('Inter_600SemiBold');
    expect(fontFamilies.bodySemiBoldItalic).toBe('Inter_600SemiBold_Italic');
    expect(fontFamilies.display).toBe('Inter_700Bold');
    expect(fontFamilies.numeric).toBe('JetBrainsMono_500Medium');
  });

  it('caregiver scale matches the D13 §5.2 numeric table + D12 §3.2 display sizes', () => {
    expect(typeScale.caregiver.numericHero.size).toBe(64); // D13 §5.2
    expect(typeScale.caregiver.numericXl.size).toBe(44);
    expect(typeScale.caregiver.numericL.size).toBe(28);
    expect(typeScale.caregiver.numericM.size).toBe(17);
    expect(typeScale.caregiver.numericS.size).toBe(12);
    expect(typeScale.caregiver.eyebrow.size).toBe(11);
    expect(typeScale.caregiver.displayXxl.size).toBe(64);
    expect(typeScale.caregiver.displayXl.size).toBe(48);
    expect(typeScale.caregiver.displayM.size).toBe(28);
    expect(typeScale.caregiver.headline.size).toBe(22);
    expect(typeScale.caregiver.bodyL.size).toBe(17);
    expect(typeScale.caregiver.labelUppercase.size).toBe(11);
  });

  it('parent overrides match D12 §3.3', () => {
    expect(getTypeStyle('parent', 'bodyL').size).toBe(19);
    expect(getTypeStyle('parent', 'bodyM').size).toBe(17);
    expect(getTypeStyle('parent', 'title').size).toBe(20);
    expect(getTypeStyle('parent', 'label').size).toBe(15);
  });

  it('parent falls back to caregiver for tokens with no override (display)', () => {
    expect(getTypeStyle('parent', 'displayXl').size).toBe(48);
    // D13 §5.5 step 5 — the numerics now carry parent overrides.
    expect(getTypeStyle('parent', 'numericHero').size).toBe(72);
  });
});

describe('spacing (D12 §4 — 4pt base scale)', () => {
  it('matches D12 §4 token values', () => {
    expect(spacing.xs).toBe(4);
    expect(spacing.s).toBe(8);
    expect(spacing.m).toBe(12);
    expect(spacing.l).toBe(16);
    expect(spacing.xl).toBe(20);
    expect(spacing.xxl).toBe(24);
    expect(spacing.xxxl).toBe(32);
    expect(spacing.xxxxl).toBe(48);
    expect(spacing.xxxxxl).toBe(64);
    expect(spacing.xxxxxxl).toBe(96);
  });
});

describe('radii (D12 §5)', () => {
  it('default m raised from D8s 12 to 14', () => {
    expect(radii.m).toBe(14);
  });
  it('matches D12 §5 token values', () => {
    expect(radii.none).toBe(0);
    expect(radii.s).toBe(8);
    expect(radii.l).toBe(22);
    expect(radii.xl).toBe(32);
    expect(radii.full).toBe(999);
  });
});

describe('elevation (D12 §6)', () => {
  it('dark mode applies rim light to elevated surfaces', () => {
    expect(elevationDark.low.rimLight).toBe(true);
    expect(elevationDark.medium.rimLight).toBe(true);
    expect(elevationDark.high.rimLight).toBe(true);
    expect(elevationDark.glass.rimLight).toBe(true);
  });

  it('light mode never applies rim light (cast shadow only)', () => {
    expect(elevationLight.low.rimLight).toBe(false);
    expect(elevationLight.medium.rimLight).toBe(false);
    expect(elevationLight.high.rimLight).toBe(false);
    expect(elevationLight.glass.rimLight).toBe(false);
  });

  it('none has zero shadow + zero elevation in both modes', () => {
    expect(elevationDark.none.android.elevation).toBe(0);
    expect(elevationLight.none.android.elevation).toBe(0);
  });

  it('resolver returns the right map per mode', () => {
    expect(getElevation('dark')).toBe(elevationDark);
    expect(getElevation('light')).toBe(elevationLight);
  });
});

describe('motion (D12 §7)', () => {
  it('matches D12 §7.1 duration scale', () => {
    expect(duration.instant).toBe(0);
    expect(duration.fast).toBe(120);
    expect(duration.normal).toBe(200);
    expect(duration.slow).toBe(320);
    expect(duration.deliberate).toBe(480);
    expect(duration.cinematic).toBe(720);
    expect(duration.cinematicExtended).toBe(1200);
  });

  it('reduced motion collapses cinematic/deliberate/slow to fast (D12 §7.4)', () => {
    expect(reducedMotionDuration.cinematic).toBe(120);
    expect(reducedMotionDuration.cinematicExtended).toBe(120);
    expect(reducedMotionDuration.deliberate).toBe(120);
    expect(reducedMotionDuration.slow).toBe(120);
  });

  it('reduced motion makes normal a hard cut (D12 §7.4)', () => {
    expect(reducedMotionDuration.normal).toBe(0);
  });

  it('matches D12 §7.2 easing curves', () => {
    expect(easing.standard).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(easing.cinematic).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
  });

  it('matches D12 §7.2 default spring config', () => {
    expect(spring.default).toEqual({ stiffness: 180, damping: 22, mass: 1 });
  });
});

describe('opacity (D12 §8)', () => {
  it('matches D12 §8 token values', () => {
    expect(opacity.disabled).toBe(0.4);
    expect(opacity.scrim).toBe(0.55);
    expect(opacity.muted).toBe(0.7);
    expect(opacity.ringBackground).toBe(0.12);
    expect(opacity.glassBase).toBe(0.04);
    expect(opacity.full).toBe(1);
  });
});

describe('icon (D12 §10)', () => {
  it('matches D12 §10.3 size scale', () => {
    expect(iconSize.xs).toBe(14);
    expect(iconSize.s).toBe(16);
    expect(iconSize.m).toBe(20);
    expect(iconSize.l).toBe(24);
    expect(iconSize.xl).toBe(32);
    expect(iconSize.hero).toBe(56);
  });

  it('Phosphor mapping matches D12 §10.4 contract (v3 *Icon names)', () => {
    expect(phosphorIconName.vitalBp).toBe('DropIcon');
    expect(phosphorIconName.vitalHr).toBe('HeartStraightIcon');
    expect(phosphorIconName.aiNarration).toBe('SparkleIcon');
    expect(phosphorIconName.anomalyConfirmedUrgent).toBe('WarningCircleIcon');
    expect(phosphorIconName.chevronTrailing).toBe('CaretRightIcon');
  });
});

// Sprint 14.5 task 6 — D12 §2.6 minimum-contrast assertion. The
// previous light-mode amber (#E8A063) landed at 2.0–2.2:1 on linen
// surfaces; the contrast lint here pins the new shade above 3:1.
describe('color — light-mode contrast (D12 §2.6)', () => {
  // Standard sRGB→linear→relative-luminance per WCAG.
  function relativeLuminance(hex: string): number {
    const v = hex.replace('#', '');
    const r = parseInt(v.slice(0, 2), 16) / 255;
    const g = parseInt(v.slice(2, 4), 16) / 255;
    const b = parseInt(v.slice(4, 6), 16) / 255;
    const lin = (c: number) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }

  it('brand.primary against linen-50 meets D12 §2.6 minimum 3:1', () => {
    const ratio = contrastRatio(
      semanticColorsLight.brand.primary,
      paletteLight.linen[50],
    );
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  it('brand.primary against linen-100 meets D12 §2.6 minimum 3:1', () => {
    const ratio = contrastRatio(
      semanticColorsLight.brand.primary,
      paletteLight.linen[100],
    );
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
