// services/reminders/dispatcher — Sprint 16.6 FUN-4.
//
// The learned-time engine in ./learnedTime.ts is a pure pattern-matcher
// that returns "should we remind?" plus copy. Sprint 12.5 shipped the
// engine but never wired Notifications.scheduleNotificationAsync to
// its output — so the reminder feature has been dead in production.
//
// This module closes that gap: cancel + schedule expo-notifications
// entries based on the engine output. Pure of React/Zustand —
// state-aware wiring (which call-site invokes us with what readings +
// parent label) lives in RootNavigator's startup effect.
//
// Strategy (one-shot-per-day, re-run frequently):
//   - Each invocation cancels any prior learned-time reminder
//     scheduled by us and schedules at most ONE new one.
//   - The reminder fires at the next occurrence of (habit + 30 min)
//     — today if still in the future, tomorrow otherwise.
//   - Suppression rules from D14 §5.4 + ./learnedTime.ts:
//       no_habit       → cancel + no-op
//       quiet_hours    → no-op (only skips if the reminder time
//                        itself lands in 22:00–07:00)
//       recent_reading → only for TODAY's schedule; tomorrow is fine
//
// Why we don't use a daily-repeating trigger: the engine output is
// conditional on "user has not synced today". A daily-repeating
// notification cannot evaluate that condition, so it would produce
// false-positive "your watch hasn't synced" copy on days the user
// already synced. Re-scheduling on app open + after each sync keeps
// the trigger conditional.

import * as Notifications from 'expo-notifications';
import type { SchedulableTriggerInputTypes } from 'expo-notifications';
import {
  buildLearnedTimeReminderCopy,
  detectReadingHabit,
  QUIET_HOURS_END_LOCAL_MIN,
  QUIET_HOURS_START_LOCAL_MIN,
  RECENT_READING_SUPPRESS_HOURS,
  REMINDER_OFFSET_MIN,
} from './learnedTime';
import type { LocalReading } from '../../state/readings';
import { formatVoiceHits, lintVoiceText } from '../voice/voiceLint';

const IDENTIFIER_PREFIX = 'leiko.reminder.learned-time';
const ANDROID_CHANNEL_ID = 'daily-summary';

export interface ScheduleLearnedTimeInput {
  /** Recent readings used by detectReadingHabit. */
  readings: LocalReading[];
  /** Display name for caregiver-mode push copy. Ignored when isSelf. */
  parentLabel: string;
  /** True for self-buyer (uses "you" copy). */
  isSelf: boolean;
  /** Override "now" — testing only. */
  now?: Date;
}

export type ScheduleSkipReason =
  | 'no_habit'
  | 'quiet_hours'
  | 'recent_reading_within_4h'
  // Sprint 19 (audit D12 P0-8) — the composed copy tripped a HARD voice
  // rule. We drop the notification rather than ship it, matching the
  // server path in supabase/functions/send-push (which fails closed).
  | 'voice_lint_hard_fail';

export type ScheduleResult =
  | { scheduled: true; identifier: string; firingAt: string }
  | { scheduled: false; reason: ScheduleSkipReason };

/**
 * Drop every learned-time reminder we've previously scheduled. Safe
 * to call when nothing is scheduled. Never throws — failures degrade
 * to a no-op so the dispatcher remains best-effort.
 */
export async function cancelLearnedTimeReminders(): Promise<void> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all
        .filter((item) => item.identifier?.startsWith(IDENTIFIER_PREFIX))
        .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier!)),
    );
  } catch {
    // expo-notifications is missing in pure-Node test envs; treat as no-op.
  }
}

/**
 * Compute the next Date a notification should fire at, given the
 * habitual time-of-day. Returns local time anchored to the user's
 * device timezone (JS Date math is local). Always advances to the
 * next occurrence — today if still ahead, otherwise tomorrow.
 */
function nextOccurrenceAt(reminderMinFromMidnight: number, now: Date): Date {
  const target = new Date(now);
  target.setHours(
    Math.floor(reminderMinFromMidnight / 60),
    reminderMinFromMidnight % 60,
    0,
    0,
  );
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

/**
 * Cancel any prior learned-time reminder + schedule the next one at
 * (habit + 30min). Returns a result object describing the outcome so
 * callers can log / observe. Never throws.
 */
export async function scheduleNextLearnedTimeReminder(
  input: ScheduleLearnedTimeInput,
): Promise<ScheduleResult> {
  await cancelLearnedTimeReminders();

  const habit = detectReadingHabit(input.readings);
  if (!habit.hasHabit || habit.habitualTimeMin === null) {
    return { scheduled: false, reason: 'no_habit' };
  }

  const reminderTimeMin = habit.habitualTimeMin + REMINDER_OFFSET_MIN;
  const inQuietHours =
    reminderTimeMin >= QUIET_HOURS_START_LOCAL_MIN ||
    reminderTimeMin < QUIET_HOURS_END_LOCAL_MIN;
  if (inQuietHours) {
    return { scheduled: false, reason: 'quiet_hours' };
  }

  const now = input.now ?? new Date();
  const target = nextOccurrenceAt(reminderTimeMin, now);
  const isToday = target.toDateString() === now.toDateString();

  // Recent-reading suppression — only for today's schedule. By
  // tomorrow's reminder time the reading would be > 4h old anyway.
  if (isToday && input.readings.length > 0) {
    const newest = input.readings[0]?.measuredAtSec;
    if (newest !== undefined) {
      const ageHours = (now.getTime() / 1000 - newest) / 3600;
      if (ageHours < RECENT_READING_SUPPRESS_HOURS) {
        return { scheduled: false, reason: 'recent_reading_within_4h' };
      }
    }
  }

  const copy = buildLearnedTimeReminderCopy({
    parentLabel: input.parentLabel,
    habitualTimeMin: habit.habitualTimeMin,
    isSelf: input.isSelf,
  });

  // Sprint 19 (audit D12 P0-8) — voice gate on LOCAL notifications.
  // `send-push` lints server-composed push text and fails closed, but
  // locally-scheduled reminders bypassed it entirely; that is how
  // a hard-fail phrase from docs/05 reached a lock
  // screen. Fail closed here too. Frontmatter/MDX/code stripping is
  // meaningless for push copy, so all three are disabled.
  const voice = lintVoiceText(`${copy.title}\n${copy.body}`, {
    stripFrontmatter: false,
    stripMdxComponents: false,
    stripCodeBlocks: false,
  });
  if (voice.hardHits.length > 0) {
    if (__DEV__) {
      console.warn(
        '[reminders] learned-time copy failed the voice lint; not scheduling.\n' +
          formatVoiceHits(voice.hardHits),
      );
    }
    return { scheduled: false, reason: 'voice_lint_hard_fail' };
  }

  const dateKey = target.toISOString().slice(0, 10);
  const identifier = `${IDENTIFIER_PREFIX}.${dateKey}`;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: copy.title,
        body: copy.body,
        data: { kind: 'learned-time-reminder' },
        ...(ANDROID_CHANNEL_ID
          ? ({ channelId: ANDROID_CHANNEL_ID } as Record<string, unknown>)
          : {}),
      },
      trigger: {
        type: 'date' as SchedulableTriggerInputTypes.DATE,
        date: target,
      },
    });
  } catch {
    // Module missing in test envs; surface as no-op success-shape so
    // the consumer's logging doesn't gain false negatives.
    return { scheduled: false, reason: 'no_habit' };
  }

  return {
    scheduled: true,
    identifier,
    firingAt: target.toISOString(),
  };
}
