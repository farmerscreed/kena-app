// useBatteryOptimizationStatus — always-available view of the Doze
// exemption, for Settings.
//
// Distinct from useBatteryOptimizationPrompt, which is the one-shot
// nudge shown right after pairing and can be dismissed forever. A wearer
// who dismissed that nudge (or who paired before it existed) still needs
// a way to find and fix this, because without the exemption Android
// throttles the background sync and the silent remote-refresh push:
// readings then only reach the family when the wearer opens the app.
//
// Android-only. iOS and the JS-only test workspace have nothing to
// grant, so `supported` is false there and callers hide the row.

import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
} from '../services/power/batteryOptimization';

export interface BatteryOptimizationStatus {
  /** Android with the native module present — elsewhere hide the row. */
  supported: boolean;
  /** null until the first check resolves. */
  exempt: boolean | null;
  /** Open the system exemption dialog. */
  request: () => Promise<void>;
}

export function useBatteryOptimizationStatus(): BatteryOptimizationStatus {
  const supported = Platform.OS === 'android';
  const [exempt, setExempt] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    if (!supported) return;
    void isIgnoringBatteryOptimizations().then(setExempt);
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    refresh();
    // The system dialog leaves the app, so the answer only lands when we
    // come back — re-check on every foreground.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => sub.remove();
  }, [supported, refresh]);

  const request = useCallback(async () => {
    await requestIgnoreBatteryOptimizations();
  }, []);

  return { supported, exempt, request };
}
