// theme/layout — D13 §5.4's stated home for the furniture constants.
//
// The model itself lives in components/homeLayout.ts (Sprint 19 built
// it as a full bottom-anchored stack with per-layer offsets — richer
// than the §5.4 sketch, and already covered by the overlap tests for
// both furniture paths). This module gives it the spec's names so
// future screens reach for `theme/layout` and find one source.

import {
  HOME_TAB_BAR_HEIGHT,
  CAREGIVER_ACTION_BAR_HEIGHT,
  ASK_LEIKO_FAB_HEIGHT,
  homeScrollPaddingBottom,
  type HomeFurniture,
} from '../components/homeLayout';

export const furniture = {
  tabBarHeight: HOME_TAB_BAR_HEIGHT,
  actionBarHeight: CAREGIVER_ACTION_BAR_HEIGHT,
  fabDiameter: ASK_LEIKO_FAB_HEIGHT,
  fabInset: 16,
} as const;

/** §5.4 — scroll padding that clears the rendered furniture. Delegates
 *  to the stack model so the numbers can never drift apart. */
export const scrollPaddingBottom = (opts: HomeFurniture): number =>
  homeScrollPaddingBottom(opts);

export {
  homeScrollPaddingBottom,
  HOME_TAB_BAR_HEIGHT,
  CAREGIVER_ACTION_BAR_HEIGHT,
  ASK_LEIKO_FAB_HEIGHT,
} from '../components/homeLayout';
