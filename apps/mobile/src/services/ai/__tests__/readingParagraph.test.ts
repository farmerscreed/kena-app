// readingParagraph tests — Sprint 12.5 session 2.

import { generateReadingParagraphTierA } from '../readingParagraph';
import type { LocalReading } from '../../../state/readings';
import type { Classification } from '../../../utils/classification';

function makeReading(over: Partial<LocalReading> = {}): LocalReading {
  return {
    id: 'r-1',
    measuredAtSec: 1_777_036_401,
    measuredAtLocal: '2026-05-10T07:42',
    systolic: 124,
    diastolic: 79,
    pulse: 64,
    deviceBleId: 'AA:BB',
    source: 'watch',
    classification: { tier: 'in_pattern' } as Classification,
    syncStatus: 'synced',
    ...over,
  } as LocalReading;
}

it('in-pattern + sleep available → reinforcing template with sleep total', () => {
  const r = generateReadingParagraphTierA({
    reading: makeReading(),
    classification: { tier: 'in_pattern' } as Classification,
    parentLabel: 'Mum',
    sleepTotalMinutes: 444,
  });
  expect(r.tier).toBe('A');
  expect(r.text).toContain('Mum');
  expect(r.text).toContain('usual range');
  expect(r.text).toContain('7h 24m');
  expect(r.templateId).toBe('reading.in_pattern.with_sleep');
});

it('in-pattern + no sleep data → bare template', () => {
  const r = generateReadingParagraphTierA({
    reading: makeReading(),
    classification: { tier: 'in_pattern' } as Classification,
    parentLabel: 'Dad',
  });
  expect(r.text).toBe("This reading is in Dad's usual range.");
  expect(r.templateId).toBe('reading.in_pattern.bare');
});

it('calm_concerned + sleep concerning → correlation template', () => {
  const r = generateReadingParagraphTierA({
    reading: makeReading({ systolic: 138, diastolic: 88 }),
    classification: { tier: 'calm_concerned' } as Classification,
    parentLabel: 'Mum',
    weekAverageSystolic: 130,
    sleepTotalMinutes: 300,
    sleepConcerning: true,
  });
  expect(r.text).toContain('eight above the week');
  expect(r.text).toContain('5h');
  expect(r.text).toContain('these often go together');
  expect(r.templateId).toBe('reading.calm_concerned.sleep_poor');
});

it('calm_concerned without sleep context → factual template', () => {
  const r = generateReadingParagraphTierA({
    reading: makeReading({ systolic: 138, diastolic: 88 }),
    classification: { tier: 'calm_concerned' } as Classification,
    parentLabel: 'Mum',
    weekAverageSystolic: 130,
  });
  expect(r.text).toContain('eight above the week');
  expect(r.templateId).toBe('reading.calm_concerned.factual');
});

it('calm_concerned with no week average → falls back to "a little above"', () => {
  const r = generateReadingParagraphTierA({
    reading: makeReading({ systolic: 142 }),
    classification: { tier: 'calm_concerned' } as Classification,
    parentLabel: 'Mum',
  });
  expect(r.text).toContain('a little above the week');
});

it('confirmed_urgent → calm doctor redirect, no alarmism', () => {
  const r = generateReadingParagraphTierA({
    reading: makeReading({ systolic: 165, diastolic: 105 }),
    classification: { tier: 'confirmed_urgent' } as Classification,
    parentLabel: 'Mum',
  });
  expect(r.text).toContain('Worth a calm check-in');
  expect(r.text).toContain('doctor');
  // Voice-rule clean: no fear language
  expect(r.text).not.toMatch(/dangerous|urgent|critical|silent killer/i);
  // No exclamation points (D14 §11.1 forbidden in body copy)
  expect(r.text).not.toContain('!');
  expect(r.templateId).toBe('reading.confirmed_urgent');
});

it('voice-clean across all branches', () => {
  const variants: Array<Parameters<typeof generateReadingParagraphTierA>[0]> = [
    { reading: makeReading(), classification: { tier: 'in_pattern' } as Classification, parentLabel: 'Mum', sleepTotalMinutes: 444 },
    { reading: makeReading(), classification: { tier: 'in_pattern' } as Classification, parentLabel: 'Dad' },
    { reading: makeReading(), classification: { tier: 'calm_concerned' } as Classification, parentLabel: 'Mum', sleepTotalMinutes: 300, sleepConcerning: true, weekAverageSystolic: 122 },
    { reading: makeReading(), classification: { tier: 'calm_concerned' } as Classification, parentLabel: 'Mum' },
    { reading: makeReading(), classification: { tier: 'confirmed_urgent' } as Classification, parentLabel: 'Mum' },
  ];
  const FORBIDDEN = /\bpatient\b|\bdiagnos|critical level|dangerous level|silent killer|will (lower|cure|prevent)|biohack|optimi[sz]e|smash|crush|streak|wellness|smart insights|smart alerts/i;
  for (const v of variants) {
    const r = generateReadingParagraphTierA(v);
    expect(r.text.match(FORBIDDEN)).toBeNull();
    expect(r.text).not.toContain('!');
  }
});
