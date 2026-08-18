// D13 §0 rule 2 (PR-3, closes P0-1's whole class): "No static string in
// any vital-detail screen may contain a digit, a clock time, or a word
// describing an event ('dip', 'spike', 'drop')." A static string is one
// with no data interpolation — anything it asserts about the body was
// invented at authoring time.
//
// Template literals ARE allowed to carry digits inside their SLOTS
// (that's the data); their static fragments are still checked.

import { readFileSync } from 'fs';
import { join } from 'path';
import { extractUserVisibleStrings } from '../../../../tools/copy-lint/scanner';

const SCREENS = [
  'BPDetail.tsx',
  'HRDetail.tsx',
  'SpO2Detail.tsx',
  'SleepDetail.tsx',
  'ActivityDetail.tsx',
];

const EVENT_WORDS = /\b(dip|dips|dipped|dipping|spike|spikes|spiked|spiking|drop|drops|dropped|dropping)\b/i;
const CLOCK_TIME = /\b\d{1,2}:\d{2}\b/;
const DIGITS = /\d/;

/** Digits allowed only inside spec-approved UI chrome, never as a
 *  physiological statement:
 *  - "SpO2" names the sensor channel;
 *  - range-window tokens ("7-day avg", "30d", "Last 24h", "90 days")
 *    name the §7.3 segmented controls and chart windows;
 *  - zone boundaries ("< 60") label the axis, not the person. */
function stripExemptTokens(text: string): string {
  return text
    .replace(/SpO2|SpO₂/gi, '')
    .replace(/\b\d+\s?(?:-day avg|days?|d|D|h)\b/g, '')
    .replace(/[<>]\s?\d+/g, '');
}

describe.each(SCREENS)('%s — static copy states no events', (screen) => {
  const source = readFileSync(join(__dirname, '..', screen), 'utf8');
  const strings = extractUserVisibleStrings(source, screen);

  it('carries no event words in fully static strings', () => {
    // A template's fragments may reference the observation its slots
    // carry ("with a low of {low}. Small, brief dips like this…") —
    // that IS derived from the user's data. A string with no slots has
    // nothing to derive from.
    const offenders = strings.filter((s) => !s.interpolated && EVENT_WORDS.test(s.text));
    expect(offenders).toEqual([]);
  });

  it('carries no clock times', () => {
    const offenders = strings.filter((s) => CLOCK_TIME.test(s.text));
    expect(offenders).toEqual([]);
  });

  it('carries no digits outside data slots', () => {
    const offenders = strings.filter((s) => DIGITS.test(stripExemptTokens(s.text)));
    expect(offenders).toEqual([]);
  });
});
