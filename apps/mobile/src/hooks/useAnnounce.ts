// useAnnounce — audit finding P1-7.
//
// `accessibilityLiveRegion` is Android-only in React Native. On iOS it is
// parsed and then ignored, so every live region in this app — the urgent
// anomaly banner, the whole take-a-reading state machine, pairing progress,
// and every inline form error — was completely silent for someone using
// VoiceOver. This module is the iOS half of that contract.
//
// `AccessibilityInfo.announceForAccessibility` is the iOS equivalent of a
// live region: it posts the string to VoiceOver, which speaks it without
// moving focus. It is a no-op when VoiceOver is off, so it is always safe
// to call.
//
// It deliberately does NOTHING on Android. The `accessibilityLiveRegion`
// props already in the tree announce there; calling both would read every
// state change twice, which is worse than reading it none.
//
// Usage — imperative, for events (a reading arriving, a save completing):
//
//   const announce = useAnnounce();
//   announce('A new reading just came in. 128 over 82.');
//
// Usage — declarative, for a view whose live region reflects one sentence:
//
//   useAnnounceOnChange('Looking for the watch. This usually takes a few seconds.');
//
// `useAnnounceOnChange` only speaks when the sentence actually changes, so a
// re-render caused by something unrelated does not repeat itself.
//
// Voice rules (docs/05-voice-and-claims.md) apply to every string passed in.
// These are read aloud — they are user-visible copy, and must be complete,
// calm sentences rather than debug strings.

import { useCallback, useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Speak `message` on iOS. No-op on Android (where `accessibilityLiveRegion`
 * already covers it) and no-op for blank messages.
 *
 * Exported as a plain function as well as a hook so it can be called from
 * places that aren't a React render — a Supabase realtime callback, a store
 * subscription, a BLE notification handler.
 */
export function announceForAccessibility(message: string | null | undefined): void {
  if (Platform.OS !== 'ios') return;
  const text = typeof message === 'string' ? message.trim() : '';
  if (text.length === 0) return;
  AccessibilityInfo.announceForAccessibility(text);
}

/**
 * Returns a stable announcer. Pair it with the existing
 * `accessibilityLiveRegion` prop rather than replacing it — between the two,
 * both platforms are covered exactly once.
 */
export function useAnnounce(): (message: string | null | undefined) => void {
  return useCallback((message: string | null | undefined) => {
    announceForAccessibility(message);
  }, []);
}

/**
 * Declarative form: announces `message` whenever it changes to a new,
 * non-blank sentence. Passing `null` clears the memory so the same sentence
 * announces again next time it appears.
 */
export function useAnnounceOnChange(message: string | null | undefined): void {
  const lastSpoken = useRef<string | null>(null);

  useEffect(() => {
    const text = typeof message === 'string' ? message.trim() : '';
    if (text.length === 0) {
      lastSpoken.current = null;
      return;
    }
    if (lastSpoken.current === text) return;
    lastSpoken.current = text;
    announceForAccessibility(text);
  }, [message]);
}
