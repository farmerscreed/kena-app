// Time-of-day greeting — shared by both home screens.
//
// The Self-Buyer home has computed this from the clock since Sprint 8;
// the Family (caregiver) home rendered a hard-coded "Good morning" and
// so greeted the afternoon as morning. One helper now, both callers.
//
// Voice rules (docs/05-voice-and-claims.md): four plain, warm strings.
// No claims, no urgency. Boundaries follow the Self-Buyer original:
// before 05:00 is still night, midday flips at noon, evening at 18:00.

export type Greeting = 'Good night' | 'Good morning' | 'Good afternoon' | 'Good evening';

/** Greeting for the given local time (defaults to now). */
export function timeOfDayGreeting(now: Date = new Date()): Greeting {
  const hours = now.getHours();
  if (hours < 5) return 'Good night';
  if (hours < 12) return 'Good morning';
  if (hours < 18) return 'Good afternoon';
  return 'Good evening';
}
