// Source of truth: docs/_reference/D12-visual-system-v2.md §8.

export const opacity = {
  disabled: 0.4,
  scrim: 0.55,
  muted: 0.7,
  ringBackground: 0.12,
  glassBase: 0.04,
  full: 1,
  /**
   * Pressed-state opacity for bespoke Pressables. Sprint 19 (audit D12
   * P3) — the app previously hardcoded 0.65 / 0.7 / 0.85 at different
   * call sites, so the same gesture gave three different feedbacks.
   */
  pressed: 0.7,
  /**
   * Ambient "breathing" glow behind a hero vital value — rest and peak.
   *
   * Sprint 19 (audit D12 P0-5). These are the values that actually
   * render: the components apply them via an animated style that is
   * composed AFTER the stylesheet, so any `opacity` in `styles.glow` is
   * decorative. The previous animated range (0.55 → 0.75) painted the
   * glow at 3–4× its designed strength and drove `text.tertiary` over
   * the hero down to ~1.1:1, oscillating on a 4.5s cycle.
   *
   * Do not raise `glowPeak` above 0.22 without re-running
   * theme/tokens/__tests__/glowContrast.test.ts — above that the
   * tertiary text over the glow drops below the WCAG 2.2 AA 4.5:1 floor.
   */
  // D13 PR-5 (§5.3) — the designed cycle is 0.12 → 0.20; the 0.22
  // ceiling in glowContrast.test.ts is the WCAG guardrail above it.
  glowRest: 0.12,
  glowPeak: 0.2,
  /** Static glow under reduced motion (§5.3). */
  glowStatic: 0.14,
} as const;

export type OpacityToken = keyof typeof opacity;
