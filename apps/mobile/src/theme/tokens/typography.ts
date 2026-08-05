// Source of truth: docs/_reference/D12-visual-system-v2.md §3 (post-2026-05-07
// edit: Inter-only stack + JetBrains Mono Medium for numerics — no Recoleta).
//
// Family values match the names registered with expo-font via
// `@expo-google-fonts/inter` and `@expo-google-fonts/jetbrains-mono` packages.
// These exact strings are what RN's `fontFamily` style prop resolves against.
// The numeric `weight` field is informational — the weight is baked into the
// font file (Inter_700Bold IS the bold weight); RN ignores `fontWeight` when
// the family is a custom-loaded font.

export const fontFamilies = {
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodySemiBoldItalic: 'Inter_600SemiBold_Italic',
  display: 'Inter_700Bold',
  numeric: 'JetBrainsMono_500Medium',
  // Editorial serif — used for the caregiver-mode greeting headlines
  // ("Three you love, checked in.") and the editorial sentences on
  // person cards. Loaded via @expo-google-fonts/instrument-serif in
  // App.tsx. Caregiver-mode-scoped per Sprint 7.7 design.
  editorial: 'InstrumentSerif_400Regular',
  editorialItalic: 'InstrumentSerif_400Regular_Italic',
} as const;

export type TypeStyle = {
  size: number;
  lineHeight: number;
  weight: '400' | '500' | '600' | '700';
  family: string;
  letterSpacing?: number;
};

// Caregiver scale (D12 §3.2).
const caregiver = {
  numericHero: { size: 80, lineHeight: 80, weight: '500', family: fontFamilies.numeric },
  numericXl: { size: 56, lineHeight: 60, weight: '500', family: fontFamilies.numeric },
  numericL: { size: 36, lineHeight: 40, weight: '500', family: fontFamilies.numeric },
  numericM: { size: 22, lineHeight: 28, weight: '500', family: fontFamilies.numeric },
  numericS: { size: 15, lineHeight: 20, weight: '500', family: fontFamilies.numeric },

  displayXxl: { size: 64, lineHeight: 68, weight: '700', family: fontFamilies.display },
  displayXl: { size: 48, lineHeight: 52, weight: '700', family: fontFamilies.display },
  displayL: { size: 36, lineHeight: 42, weight: '700', family: fontFamilies.display },
  displayM: { size: 28, lineHeight: 34, weight: '700', family: fontFamilies.display },

  headline: { size: 22, lineHeight: 28, weight: '600', family: fontFamilies.bodySemiBold },
  title: { size: 18, lineHeight: 24, weight: '600', family: fontFamilies.bodySemiBold },

  bodyL: { size: 17, lineHeight: 26, weight: '400', family: fontFamilies.body },
  bodyM: { size: 15, lineHeight: 22, weight: '400', family: fontFamilies.body },
  bodyS: { size: 13, lineHeight: 18, weight: '400', family: fontFamilies.body },

  label: { size: 13, lineHeight: 16, weight: '500', family: fontFamilies.bodyMedium },
  // letterSpacing +50/1000em ≈ 0.55pt at 11pt size; the only uppercase variant
  // in the system per D12 §3.4 (used for vital tile labels).
  labelUppercase: {
    size: 11,
    lineHeight: 14,
    weight: '500',
    family: fontFamilies.bodyMedium,
    letterSpacing: 0.55,
  },
  caption: { size: 12, lineHeight: 16, weight: '400', family: fontFamilies.body },
} as const satisfies Record<string, TypeStyle>;

// Parent overrides (D12 §3.3) — body steps up ~12%, line height ~10%.
//
// Sprint 19 (audit D12 P0-6): the original override set covered only
// body/title/label/caption. That left `numericS`, `numericM`,
// `labelUppercase` and `caption`-adjacent chrome untouched — i.e. the
// large-text mode did not enlarge a single NUMBER. For an app whose
// wearer persona is 55–80 and whose primary content is a blood-pressure
// reading, a large-text mode that skips the reading is not a large-text
// mode.
//
// The big display numerics (numericHero 80pt, numericXl 56pt, numericL
// 36pt) are deliberately still unchanged: they are already well past
// any legibility floor, and several of them sit inside fixed-diameter
// rings that cannot grow. The small ones — the values in lists, stat
// trios, chart labels and tiles — are where the gain is.
const parent = {
  bodyL: { size: 19, lineHeight: 26, weight: '400', family: fontFamilies.body },
  bodyM: { size: 17, lineHeight: 24, weight: '400', family: fontFamilies.body },
  title: { size: 20, lineHeight: 26, weight: '600', family: fontFamilies.bodySemiBold },
  label: { size: 15, lineHeight: 18, weight: '500', family: fontFamilies.bodyMedium },
  caption: { size: 13, lineHeight: 18, weight: '400', family: fontFamilies.body },
  // Numerics that appear in dense contexts — reading lists, stat trios,
  // chart axes, vital tiles.
  numericS: { size: 17, lineHeight: 22, weight: '500', family: fontFamilies.numeric },
  numericM: { size: 25, lineHeight: 31, weight: '500', family: fontFamilies.numeric },
  // The only uppercase variant in the system; used for vital tile
  // labels, eyebrows and chart legends. 11pt is the floor at caregiver
  // scale, so parent scale lifts it clear of it.
  labelUppercase: {
    size: 13,
    lineHeight: 16,
    weight: '500',
    family: fontFamilies.bodyMedium,
    letterSpacing: 0.65,
  },
} as const satisfies Record<string, TypeStyle>;

export const typeScale = { caregiver, parent } as const;
export type TypeToken = keyof typeof caregiver;

export type TypeMode = 'caregiver' | 'parent';

export function getTypeStyle(mode: TypeMode, token: TypeToken): TypeStyle {
  if (mode === 'parent') {
    const override = (parent as Partial<Record<TypeToken, TypeStyle>>)[token];
    if (override) return override;
  }
  return caregiver[token];
}
