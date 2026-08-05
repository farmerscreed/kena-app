// homeLayout — Sprint 19 (audit P1-3).
//
// The regression these tests lock down: both home screens hardcoded a
// scroll paddingBottom that was SHORTER than the bottom furniture they
// render, so the last card sat underneath the tab bar. The invariant is
// simply "padding clears the furniture", asserted for every combination
// of the three layers × a phone with and without a home indicator.

import {
  ASK_LEIKO_FAB_HEIGHT,
  CAREGIVER_ACTION_BAR_HEIGHT,
  HOME_FURNITURE_BASE_INSET,
  HOME_FURNITURE_GAP,
  HOME_FURNITURE_HEIGHT,
  HOME_FURNITURE_STACK,
  HOME_SCROLL_BREATHING_ROOM,
  HOME_TAB_BAR_HEIGHT,
  homeFurnitureBottom,
  homeFurnitureHeight,
  homeScrollPaddingBottom,
  type HomeFurniture,
  type HomeFurnitureLayer,
} from '../homeLayout';

/** Every on/off combination of the three layers. */
const COMBINATIONS: Array<Pick<HomeFurniture, 'tabBar' | 'actionBar' | 'fab'>> =
  [false, true].flatMap((tabBar) =>
    [false, true].flatMap((actionBar) =>
      [false, true].map((fab) => ({ tabBar, actionBar, fab })),
    ),
  );

/** 0 = inside a bottom-inset SafeAreaView; 34 = iPhone home indicator. */
const SAFE_AREAS = [0, 34];

function describeCombination(f: HomeFurniture): string {
  const on = HOME_FURNITURE_STACK.filter((l) => f[l]);
  return `${on.length ? on.join('+') : 'none'} @ safeArea ${f.safeAreaBottom ?? 0}`;
}

describe('homeLayout — scroll padding clears the furniture', () => {
  for (const safeAreaBottom of SAFE_AREAS) {
    for (const combo of COMBINATIONS) {
      const furniture: HomeFurniture = { ...combo, safeAreaBottom };
      it(`padding >= furniture height — ${describeCombination(furniture)}`, () => {
        expect(homeScrollPaddingBottom(furniture)).toBeGreaterThanOrEqual(
          homeFurnitureHeight(furniture),
        );
      });
    }
  }

  it('leaves breathing room on top of the furniture', () => {
    const furniture: HomeFurniture = { tabBar: true, actionBar: true };
    expect(
      homeScrollPaddingBottom(furniture) - homeFurnitureHeight(furniture),
    ).toBe(HOME_SCROLL_BREATHING_ROOM);
  });
});

describe('homeLayout — layers never overlap', () => {
  for (const safeAreaBottom of SAFE_AREAS) {
    for (const combo of COMBINATIONS) {
      const furniture: HomeFurniture = { ...combo, safeAreaBottom };
      const present = HOME_FURNITURE_STACK.filter(
        (l) => furniture[l],
      ) as HomeFurnitureLayer[];
      if (present.length < 2) continue;
      it(`each layer sits above the one below — ${describeCombination(furniture)}`, () => {
        for (let i = 0; i < present.length - 1; i += 1) {
          const lower = present[i];
          const upper = present[i + 1];
          const lowerTop =
            homeFurnitureBottom(lower, furniture) + HOME_FURNITURE_HEIGHT[lower];
          expect(homeFurnitureBottom(upper, furniture)).toBeGreaterThanOrEqual(
            lowerTop,
          );
        }
      });
    }
  }
});

describe('homeLayout — the specific bugs P1-3 reported', () => {
  it('CaregiverHome wearer path (tab bar + action bar) needs more than the old 72pt', () => {
    const furniture: HomeFurniture = { tabBar: true, actionBar: true };
    expect(homeScrollPaddingBottom(furniture)).toBeGreaterThan(72);
  });

  it('CaregiverHome caregiver path (action bar only) still clears it', () => {
    const furniture: HomeFurniture = { actionBar: true };
    expect(homeFurnitureHeight(furniture)).toBe(
      HOME_FURNITURE_BASE_INSET + CAREGIVER_ACTION_BAR_HEIGHT,
    );
    expect(homeScrollPaddingBottom(furniture)).toBeGreaterThanOrEqual(
      homeFurnitureHeight(furniture),
    );
  });

  it('SelfBuyerHome FAB clears the tab bar rather than overlapping it', () => {
    const furniture: HomeFurniture = { tabBar: true, fab: true };
    const tabBarTop =
      homeFurnitureBottom('tabBar', furniture) + HOME_TAB_BAR_HEIGHT;
    const fabBottom = homeFurnitureBottom('fab', furniture);
    expect(fabBottom).toBe(tabBarTop + HOME_FURNITURE_GAP);
    // The old geometry: FAB at 68..124, tab bar at 24..84 — overlapping.
    expect(fabBottom).toBeGreaterThan(68);
    expect(homeScrollPaddingBottom(furniture)).toBeGreaterThanOrEqual(
      fabBottom + ASK_LEIKO_FAB_HEIGHT,
    );
  });
});

describe('homeLayout — degenerate cases', () => {
  it('reserves only the safe area when nothing renders', () => {
    expect(homeFurnitureHeight({})).toBe(0);
    expect(homeFurnitureHeight({ safeAreaBottom: 34 })).toBe(34);
  });

  it('lifts the whole stack by the safe-area inset when one is supplied', () => {
    const flat: HomeFurniture = { tabBar: true, actionBar: true };
    const inset: HomeFurniture = { ...flat, safeAreaBottom: 34 };
    expect(homeFurnitureHeight(inset) - homeFurnitureHeight(flat)).toBe(34);
  });

  it('keeps the stack order tab bar → action bar → fab', () => {
    expect(HOME_FURNITURE_STACK).toEqual(['tabBar', 'actionBar', 'fab']);
  });
});
