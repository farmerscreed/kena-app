// Notification templates — Sprint 15.
//
// One module, all eight categories from docs/11-push-notifications.md §1,
// rendered in three account_type variants (caregiver / self_buyer /
// parent). The send-push function selects the variant by the
// recipient's account_type — never the actor's.
//
// Voice rules (docs/05-voice-and-claims.md, D11 §3): every string here
// must pass voice-lint-push. Tests cover each rendered string with
// synthetic payloads.
//
// Title pattern per docs/10-anomaly-logic.md §4: "Worth a look" for
// calm-concerned, "Please call Mum/Dad" / "Please call your doctor"
// for confirmed-urgent. Sentence-case only. ≤ 120 chars iOS / 180
// Android.

import type { VitalKind, ClassificationTier } from './classification.ts';

export type AccountType = 'caregiver' | 'self_buyer' | 'parent';
export type AnomalyReason =
  | 'crisis_absolute'
  | 'stage2_sustained_60min'
  | 'outlier_and_soft_threshold'
  | 'absolute_cold_start'
  | 'extreme_value'
  | 'baseline_3day_trend'
  | 'sustained_high_at_rest'
  | 'cold_start_outside_band'
  | 'overnight_dip_sustained'
  | 'sample_or_overnight_borderline';

export interface RenderedNotification {
  title: string;
  body: string;
}

export interface AnomalyPayload {
  vitalKind: VitalKind;
  tier: ClassificationTier;
  reason: AnomalyReason;
  /** Display label for the parent in caregiver mode, e.g. "Mum"/"Dad". */
  parentLabel: string;
}

/**
 * Render an anomaly push for the given recipient. Returns null when
 * the (vital, tier) combination doesn't produce a push at all (sleep,
 * activity, BP single calm-concerned per D13 §11.3).
 */
export function renderAnomalyNotification(
  recipient: AccountType,
  payload: AnomalyPayload,
): RenderedNotification | null {
  switch (payload.vitalKind) {
    case 'bp':
      return renderBpAnomaly(recipient, payload);
    case 'hr':
      return renderHrAnomaly(recipient, payload);
    case 'spo2':
      return renderSpO2Anomaly(recipient, payload);
    case 'sleep':
    case 'activity':
      return null;
  }
}

// ── BP ────────────────────────────────────────────────────────────────

function renderBpAnomaly(
  recipient: AccountType,
  p: AnomalyPayload,
): RenderedNotification | null {
  // BP single-reading calm-concerned: in-app banner only, no push
  // (D13 §11.3). The send-push call is short-circuited before this
  // function for that case, but defensively return null too.
  if (p.tier === 'calm_concerned' && p.reason === 'outlier_and_soft_threshold') {
    return null;
  }

  if (p.tier === 'confirmed_urgent') {
    if (recipient === 'caregiver') {
      const body =
        p.reason === 'crisis_absolute'
          ? `${p.parentLabel}'s reading just now was very high. We recommend reaching out today.`
          : `Three high readings for ${p.parentLabel} in the last hour. We recommend reaching out now.`;
      return { title: `Please call ${p.parentLabel}`, body };
    }
    const body =
      p.reason === 'crisis_absolute'
        ? 'Your reading just now was very high. We recommend talking to your doctor today.'
        : 'Three high readings in the last hour. We recommend talking to your doctor today.';
    return { title: 'Please call your doctor', body };
  }

  // Calm-concerned BP trend (cold-start absolute or other non-single
  // pathways) → push allowed.
  if (recipient === 'caregiver') {
    return {
      title: 'Worth a look',
      body: `${p.parentLabel}'s morning readings have been higher this week. Worth a check-in when you can.`,
    };
  }
  return {
    title: 'Worth a look',
    body: 'Your readings this week have trended higher. Might be worth a quiet check-in with your doctor.',
  };
}

// ── HR ────────────────────────────────────────────────────────────────

function renderHrAnomaly(
  recipient: AccountType,
  p: AnomalyPayload,
): RenderedNotification {
  if (p.tier === 'confirmed_urgent') {
    if (recipient === 'caregiver') {
      return {
        title: `Please call ${p.parentLabel}`,
        body: `${p.parentLabel}'s resting heart rate is outside their usual range. We recommend reaching out now.`,
      };
    }
    return {
      title: 'Please call your doctor',
      body: 'Your resting heart rate is outside its usual range. We recommend talking to your doctor today.',
    };
  }
  // Calm-concerned (3-day trend or sustained-high-at-rest).
  if (recipient === 'caregiver') {
    return {
      title: 'Worth a look',
      body: `${p.parentLabel}'s resting heart rate has run higher than usual the last few days.`,
    };
  }
  return {
    title: 'Worth a look',
    body: 'Your resting heart rate has run higher than usual the last few days.',
  };
}

// ── SpO2 ──────────────────────────────────────────────────────────────

function renderSpO2Anomaly(
  recipient: AccountType,
  p: AnomalyPayload,
): RenderedNotification {
  if (p.tier === 'confirmed_urgent') {
    if (recipient === 'caregiver') {
      return {
        title: `Please call ${p.parentLabel}`,
        body: `${p.parentLabel}'s overnight oxygen has dipped low three nights running. Worth a call to their doctor today.`,
      };
    }
    return {
      title: 'Please call your doctor',
      body: 'Your overnight oxygen has dipped low three nights running. Worth a call to your doctor today.',
    };
  }
  if (recipient === 'caregiver') {
    return {
      title: 'Worth a look',
      body: `${p.parentLabel}'s blood-oxygen reading was lower than usual.`,
    };
  }
  return {
    title: 'Worth a look',
    body: 'Your blood-oxygen reading was lower than usual.',
  };
}

// ── Daily / weekly / device / family / subscription ──────────────────
// Preserved + adapted from docs/11-push-notifications.md §4. The
// anomaly path is the Sprint 15 focus; these are kept stable so
// send-push can route every category without falling through.

export interface DailySummaryPayload {
  parentLabel: string;
  sys?: number;
  dia?: number;
  hadReading: boolean;
  sleepHours?: number | null;
}

export function renderDailySummary(
  recipient: AccountType,
  p: DailySummaryPayload,
): RenderedNotification {
  if (!p.hadReading) {
    if (recipient === 'caregiver') {
      return {
        title: `${p.parentLabel}'s morning`,
        body: `No readings from ${p.parentLabel} yesterday. Want to check in?`,
      };
    }
    return {
      title: 'Your morning',
      body: 'No reading yesterday. Want to take one now?',
    };
  }
  const bp = p.sys != null && p.dia != null ? `${p.sys}/${p.dia}` : '';
  if (recipient === 'caregiver') {
    const sleep = p.sleepHours != null ? ` ${p.parentLabel} slept ${p.sleepHours} hours.` : '';
    return {
      title: 'Good morning',
      body: `${p.parentLabel}'s reading was ${bp}.${sleep}`.trim(),
    };
  }
  return {
    title: 'Your morning reading',
    body: `${bp}, in range. Have a good day.`,
  };
}

export interface WeeklySummaryPayload {
  parentLabel: string;
  body: string;
}

export function renderWeeklySummary(
  recipient: AccountType,
  p: WeeklySummaryPayload,
): RenderedNotification {
  if (recipient === 'caregiver') {
    return { title: `${p.parentLabel}'s week`, body: p.body };
  }
  return { title: 'Your week', body: p.body };
}

export interface WatchStatusPayload {
  parentLabel: string;
  batteryPct: number;
}

export function renderWatchLowBattery(
  recipient: AccountType,
  p: WatchStatusPayload,
): RenderedNotification {
  if (recipient === 'caregiver') {
    return {
      title: 'Watch battery low',
      body: `${p.parentLabel}'s watch is at ${p.batteryPct}%. It will need charging soon.`,
    };
  }
  return {
    title: 'Watch battery low',
    body: `Your watch is at ${p.batteryPct}%. Time to charge.`,
  };
}

export interface FamilyAcceptedPayload {
  caregiverName: string;
}

export function renderFamilyInviteAccepted(
  recipient: AccountType,
  p: FamilyAcceptedPayload,
): RenderedNotification {
  if (recipient === 'caregiver' || recipient === 'parent') {
    return {
      title: 'They joined the family',
      body: `${p.caregiverName} accepted your invite.`,
    };
  }
  return {
    title: 'They joined',
    body: `${p.caregiverName} can now see your readings.`,
  };
}

// Sprint 17b — sent to a caregiver who has just been removed from a
// family circle by the family_owner. Calm informational tone — the
// founder explicitly flagged that silent revocation reads as a bug,
// so the user must know this was a deliberate action.
//
// removerName: the family_owner's display_name (the actor who removed
//   them). Falls back to a calm neutral when display_name isn't
//   available.
// circleLabel: the human-readable circle label, typically the parent's
//   display name (e.g. "Mum") for caregiver-mode families, or the
//   self-buyer's name for hybrid setups.
export interface FamilyRemovedPayload {
  removerName: string;
  circleLabel: string;
}

export function renderFamilyMemberRemoved(
  _recipient: AccountType,
  p: FamilyRemovedPayload,
): RenderedNotification {
  // The recipient is always the removed user. account_type doesn't
  // change the framing — being removed from a circle is the same
  // semantic regardless of whether you're a self-buyer who joined as
  // a caregiver elsewhere or a caregiver-only account.
  return {
    title: `You're no longer in ${p.circleLabel}'s circle`,
    body: `${p.removerName} removed you. They can invite you back any time.`,
  };
}

export interface SubscriptionPayload {
  priceUsd: string;
}

export function renderSubscriptionRenewing(
  _recipient: AccountType,
  p: SubscriptionPayload,
): RenderedNotification {
  return {
    title: 'Leiko Plus renews tomorrow',
    body: `Your subscription will renew for $${p.priceUsd}.`,
  };
}
