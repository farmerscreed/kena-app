// fontScaling — Sprint 19 (audit D12 P0-6).
//
// ── The problem this replaces ─────────────────────────────────────────
//
// The app carried 191 instances of `allowFontScaling={false}` and zero
// set to true. OS Dynamic Type was inert everywhere past onboarding:
// Home, Trends, all five Vital Detail screens, Reading Detail, Settings,
// For Your Doctor, Learn and Take a Reading.
//
// Leiko's wearer persona is 55–80. Someone who has already turned their
// phone's text size up — because they need to — was reading their own
// blood pressure at 10pt under every person's orb, and vital units at
// 8pt. docs/13-testing-standard.md §184 lists "WCAG 2.2 AA scan green on
// all V1 screens" as a release gate; the app would not have passed it.
//
// ── Why a cap rather than uncapped scaling ───────────────────────────
//
// Uncapped scaling breaks this app in a specific way: several surfaces
// place text inside fixed-diameter SVG rings and orbs (VitalRing,
// PersonOrb, the DailyPulseHero satellites, ConstellationField). Those
// containers cannot grow with their contents, so unbounded text either
// clips or overflows its ring. Capping keeps the layout intact while
// still honouring the user's setting across the range that matters —
// iOS's default accessibility sizes land inside 1.6×.
//
// Text that is NOT geometry-trapped uses `MAX_FONT_SCALE`. Text that is
// keeps `allowFontScaling={false}`, and its base size was raised to the
// 11pt floor instead (see the token scale). That is the trade: geometry
// wins where it must, and we pay for it with a bigger starting size.

/**
 * Default ceiling for user font scaling. Applied via
 * `maxFontSizeMultiplier` on Text.
 *
 * 1.6 is chosen because it covers iOS's standard Dynamic Type range up
 * to and including `accessibilityMedium` without letting a single label
 * push a card past a phone viewport. Prose surfaces may raise this
 * locally; nothing should lower it.
 */
export const MAX_FONT_SCALE = 1.6;

/**
 * Ceiling for dense, tabular or chrome contexts — chart axes, legends,
 * table rows, tab-bar labels. These sit in tight horizontal space where
 * 1.6× wraps a label onto three lines.
 */
export const MAX_FONT_SCALE_TIGHT = 1.3;

/**
 * Ceiling for long-form reading surfaces (Learn articles, explainer
 * sheets, empty states). These are single-column prose with room to
 * grow, so they honour more of the user's setting.
 */
export const MAX_FONT_SCALE_PROSE = 2.0;

/**
 * OS font scale at or above which we auto-enable the large-text (parent)
 * type mode, absent an explicit user choice in Settings.
 *
 * 1.3 is deliberately conservative: a user who has nudged their phone
 * one or two steps up is telling us something, and the parent scale is a
 * ~12% bump on top of whatever the OS is already applying. Users who
 * disagree can turn it off in Settings → Accessibility, and that
 * explicit choice always wins.
 */
export const LARGE_TEXT_AUTO_THRESHOLD = 1.3;
