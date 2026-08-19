// Shared types for compute-correlations — Sprint 9.

export type CorrelationType =
  | 'sleep_x_morning_bp'
  | 'activity_x_resting_hr'
  | 'spo2_dip_x_sleep_score'
  // The cross-vital matrix (founder-commissioned 2026-08-19): every
  // pair behind the same gates, honest negatives persisted.
  | 'sleep_x_resting_hr'
  | 'activity_x_morning_bp'
  | 'after_meds_x_bp';

export const ALL_CORRELATION_TYPES: CorrelationType[] = [
  'sleep_x_morning_bp',
  'activity_x_resting_hr',
  'spo2_dip_x_sleep_score',
  'sleep_x_resting_hr',
  'activity_x_morning_bp',
  'after_meds_x_bp',
];

/** after_meds_x_bp is a two-group (point-biserial) comparison; each
 *  group needs its own minimum so one lonely tagged reading can't
 *  manufacture a finding. */
export const MIN_GROUP_N = 5;

export const WINDOW_DAYS = 30;
export const MIN_SAMPLE_N = 14;
export const R_THRESHOLD = 0.3;
export const P_THRESHOLD = 0.05;

export interface CorrelationOutput {
  correlationType: CorrelationType;
  pearsonR: number | null;
  effectSize: number;
  effectUnit: string | null;
  significance: number;
  sampleN: number;
  isMeaningful: boolean;
  narrativeShort: string | null;
  narrativeLong: string | null;
}
