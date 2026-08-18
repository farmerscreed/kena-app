// homeLayout — Sprint 19 (audit P1-3).
//
// ── The problem this replaces ─────────────────────────────────────────
//
// Both home screens hardcoded the geometry of their own bottom furniture,
// and the numbers disagreed with each other:
//
//   - CaregiverHome reserved `spacing.xxxxl + spacing.xxl` (72pt) of
//     scroll padding. On the wearer path BOTH the HomeTabBar and the
//     CaregiverActionBar render, which together occupy ~128pt — so the
//     "Worth a read" Learn card sat underneath the tab bar.
//   - CaregiverHome ALSO carried a bare `60` to lift the action bar over
//     the tab bar. That 60 was a copy of HomeTabBar's own height with
//     nothing keeping the two in sync.
//   - SelfBuyerHome positioned the Ask Leiko FAB at bottom 68..124 and
//     its tab bar at 24..84. They overlapped, and because the tab bar
//     renders second it painted over the FAB.
//
// ── The model ────────────────────────────────────────────────────────
//
// The bottom furniture is a single bottom-anchored STACK. Every screen
// and every component that participates reads its height and its `bottom`
// offset from here, so the numbers cannot drift again.
//
// Stack order, closest-to-the-edge first:
//
//     ┌──────────────┐  ← fab        (Ask Leiko, SelfBuyerHome)
//     ├──────────────┤  ← actionBar  (CaregiverActionBar)
//     ├──────────────┤  ← tabBar     (HomeTabBar / SelfBuyerTabBar)
//     └──────────────┘  ← base inset + safe area
//
// `homeScrollPaddingBottom()` returns the scroll padding that clears the
// whole stack for a given combination, so the last card in a ScrollView
// is always fully reachable.

import { spacing } from '../theme/tokens/spacing';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

/**
 * Gap between the bottom edge of the content box and the lowest piece of
 * furniture. Note "content box": on both home screens the furniture is
 * positioned inside a `SafeAreaView edges={['bottom']}`, which already
 * pads the OS inset, so absolutely-positioned children sit above it.
 */
export const HOME_FURNITURE_BASE_INSET = spacing.xxl; // 24

/** Vertical gap between two stacked pieces of furniture. */
export const HOME_FURNITURE_GAP = spacing.m; // 12

/**
 * Breathing room between the last scrollable element and the top of the
 * furniture stack. Without it the final card kisses the tab bar.
 */
export const HOME_SCROLL_BREATHING_ROOM = spacing.xl; // 20

/** HomeTabBar / SelfBuyerTabBar pill height. Consumed by both. */
export const HOME_TAB_BAR_HEIGHT = 60;

// CaregiverActionBar has no fixed height — it is padding + one line of
// text. Rather than guess (and drift), the two inputs live here and the
// component consumes them, so the reserved height is derived from the
// same values that lay the pill out. The line height is multiplied by
// the tight font-scale ceiling because the pill grows with Dynamic Type.
export const CAREGIVER_ACTION_BAR_VERTICAL_PADDING = 10;
export const CAREGIVER_ACTION_BAR_LINE_HEIGHT = 16;
export const CAREGIVER_ACTION_BAR_HEIGHT =
  CAREGIVER_ACTION_BAR_VERTICAL_PADDING * 2 +
  Math.ceil(CAREGIVER_ACTION_BAR_LINE_HEIGHT * MAX_FONT_SCALE_TIGHT);

/** Ask Leiko FAB height (SelfBuyerHome). */
export const ASK_LEIKO_FAB_HEIGHT = 56;

/**
 * Stack order, bottom-most first. Adding a new piece of bottom furniture
 * means adding it here and to HOME_FURNITURE_HEIGHT — nowhere else.
 */
export const HOME_FURNITURE_STACK = ['tabBar', 'actionBar', 'fab'] as const;

export type HomeFurnitureLayer = (typeof HOME_FURNITURE_STACK)[number];

export const HOME_FURNITURE_HEIGHT: Record<HomeFurnitureLayer, number> = {
  tabBar: HOME_TAB_BAR_HEIGHT,
  actionBar: CAREGIVER_ACTION_BAR_HEIGHT,
  fab: ASK_LEIKO_FAB_HEIGHT,
};

export interface HomeFurniture {
  /** HomeTabBar renders (wearer path only on CaregiverHome). */
  tabBar?: boolean;
  /** CaregiverActionBar renders (only when the circle is non-empty). */
  actionBar?: boolean;
  /** Ask Leiko FAB renders. */
  fab?: boolean;
  /**
   * Bottom safe-area inset in pt.
   *
   * Pass 0 — the default — when the furniture is already inside a
   * `SafeAreaView edges={[..., 'bottom']}`, which is the case for both
   * home screens: Yoga positions absolute children inside the parent's
   * padding box, so the inset is already applied and adding it again
   * would open a second gap. Screens that position furniture outside a
   * bottom-inset safe area pass `useSafeAreaInsets().bottom` here.
   */
  safeAreaBottom?: number;
}

/**
 * The `bottom` offset for one layer of the stack, given which other
 * layers render. Everything below it contributes its height plus a gap.
 */
export function homeFurnitureBottom(
  layer: HomeFurnitureLayer,
  furniture: HomeFurniture,
): number {
  let bottom = HOME_FURNITURE_BASE_INSET + (furniture.safeAreaBottom ?? 0);
  for (const below of HOME_FURNITURE_STACK) {
    if (below === layer) break;
    if (furniture[below]) {
      bottom += HOME_FURNITURE_HEIGHT[below] + HOME_FURNITURE_GAP;
    }
  }
  return bottom;
}

/**
 * Total height, measured from the bottom edge of the content box, that
 * the furniture stack occupies. With no furniture at all this is just
 * the safe-area inset the caller told us about.
 */
export function homeFurnitureHeight(furniture: HomeFurniture): number {
  let occupied = 0;
  for (const layer of HOME_FURNITURE_STACK) {
    if (!furniture[layer]) continue;
    occupied = Math.max(
      occupied,
      homeFurnitureBottom(layer, furniture) + HOME_FURNITURE_HEIGHT[layer],
    );
  }
  return occupied === 0 ? (furniture.safeAreaBottom ?? 0) : occupied;
}

/**
 * Scroll `contentContainerStyle.paddingBottom` that clears the whole
 * stack with room to breathe. This is the value both home screens use;
 * it is guaranteed `>= homeFurnitureHeight(furniture)`.
 */
export function homeScrollPaddingBottom(furniture: HomeFurniture): number {
  return homeFurnitureHeight(furniture) + HOME_SCROLL_BREATHING_ROOM;
}
