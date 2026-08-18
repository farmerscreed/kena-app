// Pure-TS test for buildTheme — no React, no RN. Runs under ts-jest.
// Validates the D12 token surface assembled into a Theme object.

import { buildTheme } from '../buildTheme';

describe('buildTheme — caregiver + dark', () => {
  const theme = buildTheme('dark', 'caregiver', false);

  it('exposes mode dimensions verbatim', () => {
    expect(theme.colorMode).toBe('dark');
    expect(theme.typeMode).toBe('caregiver');
    expect(theme.mode).toBe('caregiver'); // legacy alias
    expect(theme.reduceMotion).toBe(false);
  });

  it('returns the caregiver typography for body-l', () => {
    expect(theme.type('bodyL').size).toBe(17);
    expect(theme.type('bodyL').lineHeight).toBe(26); // D12 §3.2 (was 24 in D8)
  });

  it('uses 48pt as the min tap target', () => {
    expect(theme.minTapTarget).toBe(48);
  });

  it('uses 56pt as the list-row min height', () => {
    expect(theme.listRowMinHeight).toBe(56);
  });

  it('returns full duration when reduceMotion is off', () => {
    expect(theme.duration('normal')).toBe(200);
    expect(theme.duration('cinematic')).toBe(720); // new in D12
  });
});

describe('buildTheme — parent + dark', () => {
  const theme = buildTheme('dark', 'parent', false);

  it('returns 64pt min tap target', () => {
    expect(theme.minTapTarget).toBe(64);
  });

  it('returns 64pt list-row min height', () => {
    expect(theme.listRowMinHeight).toBe(64);
  });

  it('overrides body-l to 19pt', () => {
    expect(theme.type('bodyL').size).toBe(19);
  });

  it('overrides title to 20pt', () => {
    expect(theme.type('title').size).toBe(20);
  });

  it('falls back to caregiver scale for tokens with no parent override', () => {
    expect(theme.type('displayXl').size).toBe(48);
    expect(theme.type('headline').size).toBe(22);
  });
});

describe('buildTheme — colorMode dimension (D12 §2.4)', () => {
  it('dark mode resolves brand.primary to amber-500', () => {
    expect(buildTheme('dark', 'caregiver', false).colors.brand.primary).toBe('#C96442');
  });

  it('light mode resolves brand.primary to the darker amber-500 (Sprint 14.5 contrast fix)', () => {
    expect(buildTheme('light', 'caregiver', false).colors.brand.primary).toBe('#B4742E');
  });

  it('dark mode resolves surface.base to midnight-900', () => {
    expect(buildTheme('dark', 'caregiver', false).colors.surface.base).toBe('#0A0F1A');
  });

  it('light mode resolves surface.base to linen-50', () => {
    expect(buildTheme('light', 'caregiver', false).colors.surface.base).toBe('#FBF9F5');
  });

  it('dark mode applies rim light to elevated surfaces', () => {
    expect(buildTheme('dark', 'caregiver', false).elevation.low.rimLight).toBe(true);
  });

  it('light mode never applies rim light', () => {
    expect(buildTheme('light', 'caregiver', false).elevation.low.rimLight).toBe(false);
  });
});

describe('buildTheme — reduceMotion = true (D12 §7.4)', () => {
  const theme = buildTheme('dark', 'caregiver', true);

  it('collapses normal duration to a hard cut (0ms)', () => {
    expect(theme.duration('normal')).toBe(0);
  });

  it('collapses slow / deliberate / cinematic to fast (120ms)', () => {
    expect(theme.duration('slow')).toBe(120);
    expect(theme.duration('deliberate')).toBe(120);
    expect(theme.duration('cinematic')).toBe(120);
    expect(theme.duration('cinematicExtended')).toBe(120);
  });

  it('keeps fast and instant unchanged', () => {
    expect(theme.duration('fast')).toBe(120);
    expect(theme.duration('instant')).toBe(0);
  });
});

describe('buildTheme — D12 token surface', () => {
  const theme = buildTheme('dark', 'caregiver', false);

  it('exposes new D12 token values', () => {
    expect(theme.spacing.l).toBe(16);
    expect(theme.spacing.xxxxxxl).toBe(96); // new 6xl
    expect(theme.radii.m).toBe(14); // raised from D8s 12
    expect(theme.opacity.disabled).toBe(0.4);
    expect(theme.elevation.none.android.elevation).toBe(0);
  });

  it('fontFamilies use the expo-google-fonts package names', () => {
    expect(theme.fontFamilies.body).toBe('Inter_400Regular');
    expect(theme.fontFamilies.display).toBe('Inter_700Bold');
    expect(theme.fontFamilies.numeric).toBe('JetBrainsMono_500Medium');
  });

  it('exposes spring config for Reanimated', () => {
    expect(theme.spring.default).toEqual({ stiffness: 180, damping: 22, mass: 1 });
  });

  it('exposes the easing curve dictionary', () => {
    expect(theme.easing.standard).toContain('cubic-bezier');
    expect(theme.easing.cinematic).toContain('cubic-bezier');
  });
});

describe('buildTheme — backward-compat shims (deleted in Phase C cleanup)', () => {
  // Each test here doubles as a tombstone — when the Phase B per-component
  // migration is complete and the shim is removed in Phase C, delete the
  // matching test alongside.

  const theme = buildTheme('dark', 'caregiver', false);

  it('legacy theme.fontFamily.{body,display,numeric} aliases the new families', () => {
    expect(theme.fontFamily.body).toBe('Inter_400Regular');
    expect(theme.fontFamily.display).toBe('Inter_700Bold');
    expect(theme.fontFamily.numeric).toBe('JetBrainsMono_500Medium');
  });

  it('legacy colors.brand.accent aliases brand.primary', () => {
    expect(theme.colors.brand.accent).toBe(theme.colors.brand.primary);
  });

  it('legacy colors.brand.primarySoft aliases text.secondary', () => {
    expect(theme.colors.brand.primarySoft).toBe(theme.colors.text.secondary);
  });

  it('legacy colors.border.default aliases border.subtle', () => {
    expect(theme.colors.border.default).toBe(theme.colors.border.subtle);
  });
});
