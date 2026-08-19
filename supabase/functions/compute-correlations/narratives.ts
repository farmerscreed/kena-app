// Narrative templates per correlation type — Sprint 9 / D11 §3.6.
//
// Each meaningful row writes both `narrative_short` (a one-line
// headline) and `narrative_long` (a paragraph). Voice rules per
// docs/15-correlation-engine.md §5: described, never prescribed.

import type { CorrelationType } from './types.ts';

export interface NarrativeInputs {
  sampleN: number;
  /** Effect size in user-relatable units. Sign + magnitude both matter. */
  effectSize: number;
}

export function narrativeFor(
  type: CorrelationType,
  inputs: NarrativeInputs,
): { short: string; long: string; effectUnit: string } {
  // Effect size is the regression slope. Direction-aware copy: we
  // describe the EXPECTED-DIRECTION pattern so the headline reads
  // naturally; if the data points the "wrong" way (rare for the three
  // v1.0 correlations) we still describe what the numbers say.
  switch (type) {
    case 'sleep_x_morning_bp': {
      // x = total sleep minutes, y = morning systolic.
      // Effect unit: mmHg per hour of sleep. Negative slope = expected.
      const mmHgPerHour = inputs.effectSize * 60;
      const absMmHg = Math.abs(Math.round(mmHgPerHour));
      const directionShort =
        mmHgPerHour < 0
          ? `Poor sleep ↔ +${absMmHg} mmHg morning systolic`
          : `Longer sleep ↔ +${absMmHg} mmHg morning systolic`;
      const long =
        mmHgPerHour < 0
          ? `On nights you slept under 6 hours, your morning systolic averaged about ${absMmHg} points higher than on full-rest nights. Pattern based on the last ${inputs.sampleN} nights.`
          : `Across the last ${inputs.sampleN} nights, longer sleep tracked alongside slightly higher morning systolic — opposite of what's typical. Worth bringing up with your doctor if it continues.`;
      return { short: directionShort, long, effectUnit: 'mmHg/hour-sleep' };
    }
    case 'activity_x_resting_hr': {
      // x = steps_day, y = resting HR. Negative slope = expected.
      const bpmPer1k = inputs.effectSize * 1000;
      const absBpm = Math.abs(Math.round(bpmPer1k * 10) / 10);
      const short =
        bpmPer1k < 0
          ? `More daily steps ↔ −${absBpm} bpm resting HR`
          : `More daily steps ↔ +${absBpm} bpm resting HR`;
      const long =
        bpmPer1k < 0
          ? `Days with more steps tracked alongside a lower resting heart rate over the last ${inputs.sampleN} days. About ${absBpm} bpm lower per extra 1,000 steps.`
          : `Across the last ${inputs.sampleN} days, more daily steps tracked alongside a slightly higher resting heart rate. Worth raising with your doctor if it continues.`;
      return { short, long, effectUnit: 'bpm/1000-steps' };
    }
    case 'spo2_dip_x_sleep_score': {
      // x = overnight SpO2 minimum, y = sleep total minutes (proxy for score).
      // Positive slope = expected (higher min → more sleep).
      const minPerPercent = inputs.effectSize;
      const absMin = Math.abs(Math.round(minPerPercent));
      const short =
        minPerPercent > 0
          ? `Lower overnight SpO2 dips ↔ lower sleep score`
          : `Lower overnight SpO2 dips ↔ higher sleep score`;
      const long =
        minPerPercent > 0
          ? `On nights your SpO2 dipped further, your sleep totals landed lower over the last ${inputs.sampleN} nights — about ${absMin} fewer minutes per SpO2 percent. The pattern doesn't tell us why; if it persists, it's worth raising with your doctor.`
          : `Across the last ${inputs.sampleN} nights, lower SpO2 dips tracked alongside slightly more sleep — opposite of what's typical. Worth bringing up with your doctor if it continues.`;
      return { short, long, effectUnit: 'min/SpO2-percent' };
    }
    case 'sleep_x_resting_hr': {
      // x = sleep minutes, y = resting HR. Negative slope = expected
      // (more sleep ↔ lower resting rate).
      const bpmPerHour = inputs.effectSize * 60;
      const absBpm = Math.abs(Math.round(bpmPerHour * 10) / 10);
      const short =
        bpmPerHour < 0
          ? `Longer sleep ↔ −${absBpm} bpm resting HR`
          : `Longer sleep ↔ +${absBpm} bpm resting HR`;
      const long =
        bpmPerHour < 0
          ? `On nights with more sleep, your resting heart rate ran about ${absBpm} bpm lower per extra hour. Pattern based on the last ${inputs.sampleN} nights.`
          : `Across the last ${inputs.sampleN} nights, longer sleep tracked alongside a slightly higher resting heart rate — opposite of what's typical. Worth bringing up with your doctor if it continues.`;
      return { short, long, effectUnit: 'bpm/hour-sleep' };
    }
    case 'activity_x_morning_bp': {
      // x = steps, y = NEXT-morning systolic. Negative slope = expected.
      const mmHgPer1k = inputs.effectSize * 1000;
      const absMmHg = Math.abs(Math.round(mmHgPer1k * 10) / 10);
      const short =
        mmHgPer1k < 0
          ? `More daily steps ↔ −${absMmHg} mmHg next morning`
          : `More daily steps ↔ +${absMmHg} mmHg next morning`;
      const long =
        mmHgPer1k < 0
          ? `Mornings after higher-step days ran about ${absMmHg} mmHg lower per extra 1,000 steps, across the last ${inputs.sampleN} paired days.`
          : `Across the last ${inputs.sampleN} paired days, mornings after higher-step days ran slightly higher — opposite of what's typical. Worth raising with your doctor if it continues.`;
      return { short, long, effectUnit: 'mmHg/1k-steps' };
    }
    case 'after_meds_x_bp': {
      // Point-biserial: slope = mean difference (tagged − untagged) in
      // mmHg. Descriptive only — never an efficacy claim.
      const diff = Math.round(Math.abs(inputs.effectSize));
      const lower = inputs.effectSize < 0;
      const short = lower
        ? `After-meds readings ↔ −${diff} mmHg`
        : `After-meds readings ↔ +${diff} mmHg`;
      const long = lower
        ? `Readings tagged "after meds" have averaged about ${diff} mmHg lower than the rest, across ${inputs.sampleN} readings. Worth showing your doctor.`
        : `Readings tagged "after meds" have averaged about ${diff} mmHg higher than the rest, across ${inputs.sampleN} readings. Worth showing your doctor.`;
      return { short, long, effectUnit: 'mmHg-tagged-vs-not' };
    }
  }
}
