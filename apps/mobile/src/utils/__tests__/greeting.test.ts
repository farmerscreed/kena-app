// timeOfDayGreeting — boundary tests.
//
// The Family home rendered a hard-coded 'Good morning' and so greeted
// the afternoon as morning (found on-device 2026-08-19, 15:12 local).
// Both home screens now share this helper; these pin its boundaries so
// the bug cannot come back silently.

import { timeOfDayGreeting } from '../greeting';

/** Local-time Date at the given hour on a fixed day. */
function at(hour: number, minute = 0): Date {
  return new Date(2026, 7, 19, hour, minute, 0);
}

describe('timeOfDayGreeting', () => {
  it.each([
    [0, 'Good night'],
    [4, 'Good night'],
    [5, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [15, 'Good afternoon'],
    [17, 'Good afternoon'],
    [18, 'Good evening'],
    [23, 'Good evening'],
  ])('%i:00 → %s', (hour, expected) => {
    expect(timeOfDayGreeting(at(hour))).toBe(expected);
  });

  it('flips exactly on the boundary minute, not before', () => {
    expect(timeOfDayGreeting(at(11, 59))).toBe('Good morning');
    expect(timeOfDayGreeting(at(12, 0))).toBe('Good afternoon');
    expect(timeOfDayGreeting(at(17, 59))).toBe('Good afternoon');
    expect(timeOfDayGreeting(at(18, 0))).toBe('Good evening');
  });

  it('the afternoon is never greeted as morning', () => {
    // The exact regression: 15:12 local.
    expect(timeOfDayGreeting(at(15, 12))).toBe('Good afternoon');
  });

  it('defaults to now when no date is given', () => {
    expect(['Good night', 'Good morning', 'Good afternoon', 'Good evening']).toContain(
      timeOfDayGreeting(),
    );
  });
});
