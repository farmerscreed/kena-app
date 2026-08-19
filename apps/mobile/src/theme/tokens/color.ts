// Source of truth: docs/_reference/D12-visual-system-v2.md §2.
// Two layers: raw palette (mode-specific hex), then semantic tokens
// (mode-resolved). Components consume semantic tokens via the theme
// provider — never the raw palette directly.

// ============================================================
// 1. Raw palette — Dark canonical (D12 §2.2)
// ============================================================

export const paletteDark = {
  midnight: {
    950: '#06090F',
    900: '#0A0F1A',
    850: '#11171F',
    800: '#1A2030',
    750: '#222937',
  },
  // Warm charcoal palette — Sprint 7.7 design, caregiver-mode home
  // (`leiko-caregiver-unified.html`). The design's `#0a0908` is
  // rendered as `warmCharcoal.900`; brighter steps (elev/high) are
  // computed from oklch(16% / 20% .015 60) for surface depth.
  // D13 PR-5 (§5.4) — the canvas gradient: #141110 at the top fading
  // to the base by the bottom. "This single change carries most of the
  // expensive-vs-cheap difference" (D11 §9.5). Consumed by
  // CanvasGradient; the flat base remains the fallback colour.
  canvasGradientTop: '#141110',
  warmCharcoal: {
    900: '#0A0908', // base
    850: '#120C07', // subtle
    800: '#1D140D', // elevated
  },
  // Sprint 16.6 — three-tone text gradation tuned per founder's
  // on-device pick: the "No recent reading" StatusPill (offline tone
  // #857F7A) carries the warm-grey character the founder loves for
  // off-white text. Secondary + tertiary are now in that same hue
  // family rather than the cream direction:
  //   bone[50]   #FFFFFF  primary    — focal: orb / person names,
  //                                    headlines, vital values.
  //   bone[100]  #B8B2AA  secondary  — body sentences, italic accents,
  //                                    legend headlines. Warm grey
  //                                    at ~72% luminance — lifted
  //                                    offline tone for paragraph use.
  bone: { 50: '#FFFFFF', 100: '#B8B2AA' },
  //   stone[300] #857F7A tertiary  — recessive labels: relation tags,
  //                                    eyebrows, dates, footers, vital
  //                                    labels. Exact match to the
  //                                    offline status tone.
  stone: { 300: '#857F7A', 500: '#6B6862' },
  // D13 PR-5 — #E8A063 is retired entirely (§5.1). The CTA amber moves
  // to the spec's interactive copper; the ramp neighbours follow.
  amber: { 400: '#F5B47A', 500: '#C96442', 600: '#B0553A' },
  // Sprint 19 (audit D12 P1-1) — colour quarantine.
  //
  // `brand.primary`, `vital.bp` and `state.warning` all resolved to the
  // SAME hex (#E8A063). Contrast between "this is tappable", "this is
  // your blood pressure" and "this is a calm-concerned anomaly" was
  // 1.00:1 — the colour language was ambiguous by construction, so it
  // could not be learned. D12 §2.4 mandated it ("BP ring/tile uses
  // brand accent — BP is the headline vital"), so this reverses a
  // spec-level decision, not implementation drift.
  //
  // The fork stays inside the amber family so the screens keep their
  // warmth; only the ROLE separation is new. Interactive keeps the
  // canonical 500; data goes lighter; the anomaly state goes deeper.
  //
  // [DESIGNER] These two steps are the audit's recommendation, not a
  // designer's. The relationships (data lighter than CTA, warning
  // deeper than CTA) should hold even if the exact hexes move.
  // D13 PR-5 (§5.1) — chart series family: muted, desaturated, only
  // ever inside a plot area. Never on a chip, never on a control.
  vitalBp: '#7EA8C4',
  seriesHr: '#C99AB0',
  seriesSpo2: '#8FBCA8',
  seriesSleep: '#9B93C7',
  seriesActivity: '#C4B07E',
  warningAmber: '#D89150', // anomaly tone — deeper than the CTA amber
  // Coral — caregiver-mode brand accent (Sprint 7.7). Distinct from the
  // existing `coral.500 #D6745A` used for HR vital chromatic; this is
  // brighter / warmer to read as the caregiver brand colour against
  // warm-charcoal surfaces. Resolves the D12 light-mode amber 2:1
  // contrast issue for caregiver surfaces (memory:
  // d12_light_mode_amber_contrast).
  coral: { 500: '#D6745A', warm: '#FF7350' },
  teal: { 500: '#5FA8A8' },
  violet: { 500: '#7C7AAB' },
  sage: { 500: '#7CA56F' },
  success: { 500: '#5BA873' },
  warning: { 500: '#E8B54F' }, // §5.1 worth-a-look family
  crimson: { 700: '#A8403F' },
  // Per-person rotating accents (Sprint 7.7). Three accents drawn from
  // the design's three test personas (Mom coral / Dad amber / Aunt
  // periwinkle). Caregivers with > 3 family members rotate through.
  person: {
    1: '#FF7350', // coral (matches Mom in design fixture)
    2: '#F2A618', // amber (matches Dad)
    3: '#7B67CC', // periwinkle (matches Aunt Joy / sleep)
  },
  // Status semantic colours (Sprint 7.7). Six states drive the
  // StatusPill + PersonOrb glow / dot. `clear` is success-green,
  // `urgent` is the same crimson family as `state.urgent`, the rest
  // are unique caregiver-mode shades from the design.
  // D13 PR-5 (§5.1) — the colour fork. Status is one of exactly three
  // families (interactive / status / chart series) and they never
  // overlap. Status colours apply only to a verdict — chip, icon,
  // ring — never to a vital's identity or a person's accent.
  //
  //   in-range green    #5FA97E   (6.6:1 on surface)
  //   worth-a-look      #E8B54F   (9.8:1)
  //   talk-to-doctor    #E06A7C   — the spec's #B23A48 measures 3.16:1
  //                     on canvas.surface; §5.1 says lighten a failing
  //                     red, never ship it. 5.7:1 here, 4.65:1 on its
  //                     own 16% tint. [DESIGNER] keep ≥4.5:1 if moved.
  //   learning grey     #8A837C   (4.9:1; the §5.1 #6B645E is
  //                     non-text-only and measures 3.2:1)
  status: {
    clear: '#5FA97E',
    watch: '#F2A618', // amber (same as person.2)
    attention: '#E8B54F', // §5.1 worth-a-look — decoupled from person.1 coral
    urgent: '#E06A7C',
    // D13 PR-5 — raised from #857F7A: 4.5:1 against the 14% tint too.
    offline: '#918B84',
    // D13 PR-4 — the learning state: data still accumulating, no
    // verdict claimed. Same muted family as offline (grey is the
    // point); the PR-5 colour fork gives it its own token pair.
    learning: '#948D86',
    // D13 PR-5 — lightened from #7B67CC (4.09:1, failed the §5.1
    // contrast floor) and decoupled from person.3.
    sleeping: '#8F7FD4',
  },
  glass: {
    10: 'rgba(255,255,255,0.04)',
    20: 'rgba(255,255,255,0.08)',
    30: 'rgba(255,255,255,0.16)',
  },
  rim: { 20: 'rgba(255,255,255,0.06)' },
} as const;

// ============================================================
// 2. Raw palette — Light variant (D12 §2.3)
// ============================================================

export const paletteLight = {
  linen: { 50: '#FBF9F5', 100: '#F5F2EC', 200: '#FFFFFF' },
  ink: { 900: '#0F121C', 700: '#2A3040', 500: '#5A6478', 300: '#8C95A8' },
  // Sprint 14.5 task 6 — light-mode amber darkened from #E8A063 to
  // #B4742E to meet D12 §2.6 minimum 3:1 contrast on linen surfaces.
  // The previous shade landed at 2.0–2.2:1 (memory:
  // d12_light_mode_amber_contrast); the dark-palette amber.600
  // (#C5824A) computes to 2.996:1 — just under threshold — so this
  // step goes one notch deeper for a comfortable 3.7:1. Premium-
  // precise tone preserved; not so dark it loses warmth. Designer
  // review pending before launch — single hex to edit if the
  // founder/designer wants a different shade.
  amber: { 500: '#B4742E' },
  // Sprint 19 (audit D12 P1-1) — light-mode counterparts to the dark
  // fork. Same rule: data lighter than the CTA, warning deeper. Both
  // verified >= 3:1 against linen surfaces (the light-mode amber floor
  // that Sprint 14.5 established).
  vitalBp: '#C98A45',
  warningAmber: '#A6641F',
  coral: { 500: '#C95F44' },
  teal: { 500: '#3F8888' },
  violet: { 500: '#5A5887' },
  sage: { 500: '#5C8252' },
  success: { 500: '#3F8054' },
  warning: { 500: '#C5824A' },
  crimson: { 700: '#8C2D2D' },
  glass: {
    10: 'rgba(15,18,28,0.04)',
    20: 'rgba(15,18,28,0.08)',
    30: 'rgba(15,18,28,0.16)',
  },
} as const;

// ============================================================
// 3. Semantic tokens — pre-resolved per mode (D12 §2.4)
// ============================================================

export type ColorMode = 'dark' | 'light';

export interface SemanticColors {
  brand: {
    primary: string;
    primaryHover: string;
    primaryPressed: string;
    /** Caregiver-mode warm coral accent (Sprint 7.7). Distinct from
     *  brand.primary (amber) used elsewhere in the app. */
    coral: string;
  };
  surface: {
    base: string;
    subtle: string;
    elevated: string;
    high: string;
    /** Caregiver-mode warm-charcoal background (Sprint 7.7). Consumed
     *  by CaregiverHome only. Light-mode equivalent is intentionally a
     *  follow-up alongside Sprint 1.6 token cleanup. */
    warmBase: string;
    warmSubtle: string;
    warmElevated: string;
    glassLight: string;
    glassMedium: string;
    glassHeavy: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    disabled: string;
    onBrand: string;
    onUrgent: string;
  };
  border: {
    subtle: string;
    strong: string;
    rim: string;
  };
  vital: {
    bp: string;
    hr: string;
    spo2: string;
    sleep: string;
    activity: string;
  };
  state: {
    success: string;
    warning: string;
    urgent: string;
  };
  /** Per-person rotating accents (Sprint 7.7). Caregivers with > 3
   *  family members cycle through these three. */
  person: {
    1: string;
    2: string;
    3: string;
  };
  /** Caregiver-mode status semantics (Sprint 7.7). Six states. */
  status: {
    clear: string;
    watch: string;
    attention: string;
    urgent: string;
    offline: string;
    sleeping: string;
    learning: string;
  };
  focus: { ring: string };
}

export const semanticColorsDark: SemanticColors = {
  brand: {
    primary: paletteDark.amber[500],
    primaryHover: paletteDark.amber[400],
    primaryPressed: paletteDark.amber[600],
    coral: paletteDark.coral.warm,
  },
  surface: {
    base: paletteDark.midnight[900],
    subtle: paletteDark.midnight[850],
    elevated: paletteDark.midnight[800],
    high: paletteDark.midnight[750],
    warmBase: paletteDark.warmCharcoal[900],
    warmSubtle: paletteDark.warmCharcoal[850],
    warmElevated: paletteDark.warmCharcoal[800],
    glassLight: paletteDark.glass[10],
    glassMedium: paletteDark.glass[20],
    glassHeavy: paletteDark.glass[30],
  },
  text: {
    primary: paletteDark.bone[50],
    secondary: paletteDark.bone[100],
    tertiary: paletteDark.stone[300],
    disabled: paletteDark.stone[500],
    onBrand: paletteDark.midnight[900],
    onUrgent: paletteDark.bone[50],
  },
  border: {
    subtle: paletteDark.glass[20],
    strong: paletteDark.bone[100],
    rim: paletteDark.rim[20],
  },
  vital: {
    // Sprint 19 (audit D12 P1-1) — forked off brand.primary.
    bp: paletteDark.vitalBp,
    hr: paletteDark.seriesHr,
    spo2: paletteDark.seriesSpo2,
    sleep: paletteDark.seriesSleep,
    activity: paletteDark.seriesActivity,
  },
  state: {
    success: paletteDark.success[500],
    // Sprint 19 (audit D12 P1-1) — forked off brand.primary.
    warning: paletteDark.warningAmber,
    urgent: paletteDark.crimson[700],
  },
  person: {
    1: paletteDark.person[1],
    2: paletteDark.person[2],
    3: paletteDark.person[3],
  },
  status: {
    clear: paletteDark.status.clear,
    watch: paletteDark.status.watch,
    attention: paletteDark.status.attention,
    urgent: paletteDark.status.urgent,
    offline: paletteDark.status.offline,
    learning: paletteDark.status.learning,
    sleeping: paletteDark.status.sleeping,
  },
  focus: { ring: paletteDark.amber[500] },
};

export const semanticColorsLight: SemanticColors = {
  brand: {
    primary: paletteLight.amber[500],
    // D12 §2.3 doesn't define separate hover/pressed for light — same hex.
    primaryHover: paletteLight.amber[500],
    primaryPressed: paletteLight.amber[500],
    // Caregiver-mode light variant is intentionally a Sprint 1.6 follow-up
    // (caregiver home is dark-canonical for v1.0). Reuse the dark-mode
    // coral so a misuse against light surfaces is at least a known hex
    // rather than `undefined`.
    coral: paletteDark.coral.warm,
  },
  surface: {
    base: paletteLight.linen[50],
    subtle: paletteLight.linen[100],
    elevated: paletteLight.linen[200],
    // D12 §2.4: light mode has no `surface.high` distinction; reuses elevated.
    high: paletteLight.linen[200],
    // Caregiver warm surfaces — light variant deferred. Reuses dark-mode
    // hexes as a placeholder; the caregiver home doesn't render in light
    // mode in v1.0 so this is never visible.
    warmBase: paletteDark.warmCharcoal[900],
    warmSubtle: paletteDark.warmCharcoal[850],
    warmElevated: paletteDark.warmCharcoal[800],
    glassLight: paletteLight.glass[10],
    glassMedium: paletteLight.glass[20],
    glassHeavy: paletteLight.glass[30],
  },
  text: {
    primary: paletteLight.ink[900],
    secondary: paletteLight.ink[700],
    tertiary: paletteLight.ink[500],
    disabled: paletteLight.ink[300],
    // Both modes: text on amber stays dark; text on crimson stays light.
    onBrand: paletteDark.midnight[900],
    onUrgent: paletteDark.bone[50],
  },
  border: {
    subtle: paletteLight.glass[20],
    strong: paletteLight.ink[700],
    // Rim lighting is dark-mode only per D12 §2.4.
    rim: 'transparent',
  },
  vital: {
    // Sprint 19 (audit D12 P1-1) — forked off brand.primary.
    bp: paletteLight.vitalBp,
    hr: paletteLight.coral[500],
    spo2: paletteLight.teal[500],
    sleep: paletteLight.violet[500],
    activity: paletteLight.sage[500],
  },
  state: {
    success: paletteLight.success[500],
    // Sprint 19 (audit D12 P1-1) — forked off brand.primary.
    warning: paletteLight.warningAmber,
    urgent: paletteLight.crimson[700],
  },
  // Person + status reuse the dark-mode hexes — caregiver home is
  // dark-canonical for v1.0 so these don't render in light mode.
  person: {
    1: paletteDark.person[1],
    2: paletteDark.person[2],
    3: paletteDark.person[3],
  },
  status: {
    clear: paletteDark.status.clear,
    watch: paletteDark.status.watch,
    attention: paletteDark.status.attention,
    urgent: paletteDark.status.urgent,
    offline: paletteDark.status.offline,
    learning: paletteDark.status.learning,
    sleeping: paletteDark.status.sleeping,
  },
  focus: { ring: paletteLight.amber[500] },
};

export function getSemanticColors(mode: ColorMode): SemanticColors {
  return mode === 'dark' ? semanticColorsDark : semanticColorsLight;
}
