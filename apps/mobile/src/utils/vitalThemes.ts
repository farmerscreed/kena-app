// vitalThemes — Sprint 8.5.
//
// Pure helpers for the per-vital detail screens. Maps a `VitalType` to
// the strings + colors + ring-fill formula every detail screen needs.
//
// Voice rules (docs/05-voice-and-claims.md): all `displayName` /
// `eyebrowLabel` strings are user-visible. No "patient" / "diagnose" /
// "predict" / "dangerous". Plain language ("Blood pressure", "Oxygen").
//
// The fill-formula implementations live here (not in the existing
// `state/dailyPulse.ts`) because they're useful both at the hero level
// (consumed by DailyPulseHero in Sprint 8) and at the per-vital level
// (consumed by VitalHero in Sprint 8.5). Keeping the source-of-truth
// in one pure module avoids drift between the two surfaces.

import type { VitalType } from '../components/VitalRing';
import type { DailyPulseData } from '../state/dailyPulse';
import type { Classification } from './classification';
import { bpRingCalibration } from './calibration';

export interface VitalTheme {
  /** Plain-language label ("Blood pressure", "Heart rate", "Oxygen", "Sleep", "Activity"). */
  displayName: string;
  /** Mono-uppercase eyebrow string used by DetailHeader ("BP", "HR", "OXYGEN", etc.). */
  eyebrowLabel: string;
}

const VITAL_THEMES: Record<VitalType, VitalTheme> = {
  bp: { displayName: 'Blood pressure', eyebrowLabel: 'BP' },
  hr: { displayName: 'Heart rate', eyebrowLabel: 'HR' },
  spo2: { displayName: 'Oxygen', eyebrowLabel: 'OXYGEN' },
  sleep: { displayName: 'Sleep', eyebrowLabel: 'SLEEP' },
  activity: { displayName: 'Activity', eyebrowLabel: 'ACTIVITY' },
};

export function vitalTheme(vital: VitalType): VitalTheme {
  return VITAL_THEMES[vital];
}

// ---------------------------------------------------------------------------
// Ring fill formulas (D13 §7.1)
// ---------------------------------------------------------------------------

/** D13 §6.2 (PR-4) — the BP ring's stroke encodes DATA SUFFICIENCY,
 *  not tier: fill = min(sampleCount / requiredCount, 1). Colour is
 *  what carries the verdict (learning grey → status[tier]). Replaces
 *  the retired tier→fraction mapping, which made a worrying reading
 *  LOOK emptier — encoding severity as absence. */
export function bpRingFill(
  classification: Classification | null | undefined,
): number {
  return bpRingCalibration(classification).fillFraction;
}

/** Clamps any number into [0, 1]. NaN folds to 0. */
export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** D13 §7.1: HR fill = (resting - 40) / 80, clamped 0..1. */
export function hrFill(restingBpm: number | null): number {
  if (restingBpm === null) return 0;
  return clamp01((restingBpm - 40) / 80);
}

/** D13 §7.1: SpO2 fill = (latest - 85) / 15, clamped 0..1. */
export function spo2Fill(latestPercent: number | null): number {
  if (latestPercent === null) return 0;
  return clamp01((latestPercent - 85) / 15);
}

/** D13 §7.1: Sleep fill = sleep_score / 100, clamped 0..1. */
export function sleepFill(sleepScore: number | null): number {
  if (sleepScore === null) return 0;
  return clamp01(sleepScore / 100);
}

/** D13 §7.1: Activity fill = steps / target_steps, clamped 0..1. */
export function activityFill(stepsToday: number, targetSteps: number): number {
  if (targetSteps <= 0) return 0;
  return clamp01(stepsToday / targetSteps);
}

/**
 * Convenience: pull the right fill for a given vital from the composed
 * DailyPulseData snapshot. Mirrors `buildHeroVitals` in
 * screens/Home/SelfBuyerHome.tsx.
 */
export function fillForVital(vital: VitalType, data: DailyPulseData): number {
  switch (vital) {
    case 'bp':
      return bpRingFill(data.bp.classification);
    case 'hr':
      return hrFill(data.hr.displayBpm);
    case 'spo2':
      return spo2Fill(data.spo2.latestPercent);
    case 'sleep':
      return sleepFill(data.sleep.session?.sleepScore ?? null);
    case 'activity':
      return activityFill(data.activity.stepsToday, data.activity.targetSteps);
  }
}
