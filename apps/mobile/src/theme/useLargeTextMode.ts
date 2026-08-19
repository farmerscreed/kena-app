// useLargeTextMode — Sprint 19 (audit D12 P0-6).
//
// Resolves the app's `typeMode` ('caregiver' | 'parent') from the user's
// explicit preference plus the OS font scale.
//
// ── Why this exists ──────────────────────────────────────────────────
//
// `theme.typeMode` has supported a 'parent' large-text scale since
// Sprint 1.5, and nothing could ever reach it. The audit found it
// blocked at four independent layers:
//
//   1. Onboarding/AccountTypeFork.tsx hardcodes every new account to
//      'self_buyer' (UNIFIED_ACCOUNT_TYPE), and `account_type` is
//      immutable after onboarding — so nobody is ever a 'parent'.
//   2. Settings had no accessibility section, so no manual opt-in.
//   3. Nothing read PixelRatio.getFontScale(), so no auto-detect.
//   4. app/PostBootShell.tsx hardcoded <ThemeProvider mode="caregiver">,
//      so even a 'parent' account would not have reached the scale.
//
// This hook fixes 2 and 3; PostBootShell consumes it to fix 4. Fixing 1
// is out of scope — and unnecessary, because keying accessibility off an
// irreversible signup choice was the wrong design anyway. The person who
// needs large text is often not the person who created the account.

import { useEffect, useState } from 'react';
import { AccessibilityInfo, PixelRatio } from 'react-native';
import { mmkv, STORAGE_KEYS } from '../services/storage';
import { LARGE_TEXT_AUTO_THRESHOLD } from './fontScaling';
import type { TypeMode } from './tokens/typography';

export type LargeTextPreference = 'on' | 'off' | 'auto';

export function readLargeTextPreference(): LargeTextPreference {
  const raw = mmkv.getString(STORAGE_KEYS.typeModeLargeText);
  if (raw === 'on' || raw === 'off' || raw === 'auto') return raw;
  return 'auto';
}

export function writeLargeTextPreference(next: LargeTextPreference): void {
  mmkv.set(STORAGE_KEYS.typeModeLargeText, next);
}

/**
 * Current OS font scale, guarded. `PixelRatio.getFontScale()` is
 * synchronous and cheap, but returns 1 on platforms/test envs that don't
 * implement it — which is the safe default (no large text).
 */
export function currentFontScale(): number {
  try {
    const scale = PixelRatio.getFontScale();
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  } catch {
    return 1;
  }
}

export function resolveTypeMode(
  preference: LargeTextPreference,
  fontScale: number,
): TypeMode {
  if (preference === 'on') return 'parent';
  if (preference === 'off') return 'caregiver';
  return fontScale >= LARGE_TEXT_AUTO_THRESHOLD ? 'parent' : 'caregiver';
}

export interface LargeTextModeState {
  typeMode: TypeMode;
  preference: LargeTextPreference;
  setPreference: (next: LargeTextPreference) => void;
  /** The OS scale we resolved against — surfaced so Settings can explain
   *  WHY 'auto' landed where it did. */
  fontScale: number;
}

/**
 * Live large-text state. Re-reads the OS font scale when the user
 * returns from Settings (RN fires `reduceMotionChanged`-style events for
 * several a11y settings but NOT for font scale on either platform, so
 * we re-read on mount and whenever the preference changes; a full
 * re-render happens anyway when the app is backgrounded and restored).
 */
export function useLargeTextMode(): LargeTextModeState {
  const [preference, setPreferenceState] = useState<LargeTextPreference>(
    readLargeTextPreference,
  );
  const [fontScale, setFontScale] = useState<number>(currentFontScale);

  useEffect(() => {
    // Re-read on mount and when the preference flips — covers the
    // common "user changes phone text size, comes back" path.
    setFontScale(currentFontScale());
  }, [preference]);

  useEffect(() => {
    // Best-effort: some platforms surface a change event. Missing API is
    // a no-op, never a crash.
    const sub = AccessibilityInfo.addEventListener?.(
      'change' as never,
      () => setFontScale(currentFontScale()),
    );
    return () => {
      (sub as { remove?: () => void } | undefined)?.remove?.();
    };
  }, []);

  const setPreference = (next: LargeTextPreference): void => {
    writeLargeTextPreference(next);
    setPreferenceState(next);
  };

  return {
    typeMode: resolveTypeMode(preference, fontScale),
    preference,
    setPreference,
    fontScale,
  };
}
