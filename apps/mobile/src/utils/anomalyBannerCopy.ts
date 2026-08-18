// Banner copy for AnomalyBanner — Sprint 15.
//
// Pure function — produces (title, body) for a given anomaly event,
// in the recipient's voice. Voice rules apply (see docs/05); every
// string here is also run through voice-lint in the test suite to
// catch drift.
//
// The push notification body lives server-side
// (supabase/functions/_shared/notification-templates.ts); this is the
// in-app variant. They're intentionally similar but allowed to differ
// (push has 120-char limit, banner can be longer).

import type { AnomalyEvent } from '../state/anomalies';

export interface BannerCopy {
  title: string;
  body: string;
  /** Severity for the AnomalyBanner component. */
  severity: 'calm-concerned' | 'confirmed-urgent';
}

export type BannerRecipient = 'caregiver' | 'self_buyer' | 'parent';

export function bannerCopyFor(
  event: AnomalyEvent,
  recipient: BannerRecipient,
  parentLabel: string = 'Mum',
): BannerCopy {
  const severity: BannerCopy['severity'] =
    event.tier === 'confirmed_urgent' ? 'confirmed-urgent' : 'calm-concerned';

  if (event.vital === 'bp') {
    if (event.tier === 'confirmed_urgent') {
      if (recipient === 'caregiver') {
        return {
          severity,
          title: `Please call ${parentLabel}`,
          body:
            event.reason === 'crisis_absolute'
              ? `${parentLabel}'s reading just now was very high. We recommend reaching out today.`
              : `Three high readings for ${parentLabel} in the last hour. We recommend reaching out now.`,
        };
      }
      return {
        severity,
        title: 'Please call your doctor',
        body:
          event.reason === 'crisis_absolute'
            ? 'Your reading just now was very high. We recommend talking to your doctor today.'
            : 'Three high readings in the last hour. We recommend talking to your doctor today.',
      };
    }
    if (recipient === 'caregiver') {
      return {
        severity,
        title: 'Worth a look',
        body: `${parentLabel}'s reading was higher than usual. Worth a check-in when you can.`,
      };
    }
    return {
      severity,
      title: 'Worth a look',
      body: 'Your reading was higher than usual. Worth a quiet check-in.',
    };
  }

  if (event.vital === 'hr') {
    if (event.tier === 'confirmed_urgent') {
      if (recipient === 'caregiver') {
        return {
          severity,
          title: `Please call ${parentLabel}`,
          body: `${parentLabel}'s resting heart rate is outside their usual range. We recommend reaching out now.`,
        };
      }
      return {
        severity,
        title: 'Please call your doctor',
        body: 'Your resting heart rate is outside its usual range. Talk to your doctor today.',
      };
    }
    if (recipient === 'caregiver') {
      return {
        severity,
        title: 'Worth a look',
        body: `${parentLabel}'s resting heart rate has run higher than usual the last few days.`,
      };
    }
    return {
      severity,
      title: 'Worth a look',
      body: 'Your resting heart rate has run higher than usual the last few days.',
    };
  }

  // spo2
  if (event.tier === 'confirmed_urgent') {
    if (recipient === 'caregiver') {
      return {
        severity,
        title: `Please call ${parentLabel}`,
        body: `${parentLabel}'s overnight oxygen has dipped low three nights running. Worth a call to their doctor today.`,
      };
    }
    return {
      severity,
      title: 'Please call your doctor',
      body: 'Your overnight oxygen has dipped low three nights running. Worth a call to your doctor today.',
    };
  }
  if (recipient === 'caregiver') {
    return {
      severity,
      title: 'Worth a look',
      body: `${parentLabel}'s blood-oxygen reading was lower than usual.`,
    };
  }
  return {
    severity,
    title: 'Worth a look',
    body: 'Your blood-oxygen reading was lower than usual.',
  };
}
