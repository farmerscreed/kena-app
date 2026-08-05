// services/ai/dailyNarration tests — Sprint 12.5 session 1.

import {
  buildNarrationContext,
  buildNarrationSlots,
  generateDailyNarrationTierA,
  renderNarration,
} from '../dailyNarration';
import type { DailyPulseData } from '../../../state/dailyPulse';

function makeData(overrides: Partial<DailyPulseData> = {}): DailyPulseData {
  return {
    todayDateLocal: '2026-05-10',
    bp: {
      latest: { systolic: 124, diastolic: 79, pulse: 64 },
      latestSampleSec: 1_777_036_401,
      classification: { tier: 'in_pattern' } as never,
      staleness: 'fresh' as never,
    },
    hr: {
      restingToday: 64,
      displayBpm: 64,
      displaySource: 'resting-today',
      latestSampleSec: 1_777_036_401,
      classification: { tier: 'in_pattern' } as never,
      staleness: 'fresh' as never,
    },
    spo2: {
      latestPercent: 96,
      overnightLowsRecent: [91, 92, 93],
      latestSampleSec: 1_777_036_401,
      classification: { tier: 'in_pattern' } as never,
      staleness: 'fresh' as never,
    },
    sleep: {
      session: { totalMinutes: 444 } as never,
      classification: { tier: 'in_pattern' } as never,
      staleness: 'fresh' as never,
    },
    activity: {
      stepsToday: 4112,
      targetSteps: 8000,
      latestSampleSec: 1_777_036_401,
      classification: { tier: 'in_pattern' } as never,
      staleness: 'fresh' as never,
    },
    ...overrides,
  };
}

// ── renderNarration ───────────────────────────────────────────────────

it('renderNarration substitutes known slots', () => {
  const slots = buildNarrationSlots({
    data: makeData(),
    parentLabel: 'Mum',
    weekAverageSystolic: 122,
    weekAverageDiastolic: 78,
    stepsTargetDaysHit: 4,
  });
  const out = renderNarration('{parent_label} is in pattern. {bp_value} this morning.', slots);
  expect(out).toBe('Mum is in pattern. 124/79 this morning.');
});

it('renderNarration leaves unknown slots intact', () => {
  const slots = buildNarrationSlots({ data: makeData(), parentLabel: 'Mum' });
  const out = renderNarration('{parent_label} {nonsense_slot} test', slots);
  expect(out).toBe('Mum {nonsense_slot} test');
});

it('renderNarration capitalises the first letter at the sentence start', () => {
  const slots = buildNarrationSlots({ data: makeData(), parentLabel: 'biebele' });
  const out = renderNarration("{parent_label}'s watch hasn't synced today.", slots);
  // display_name 'biebele' (user-typed lowercase) becomes a proper
  // sentence-leading capital — the user's stored label is preserved
  // elsewhere; sentence-case is a display concern.
  expect(out.startsWith('Biebele')).toBe(true);
});

it('renderNarration leaves mid-sentence content untouched', () => {
  const slots = buildNarrationSlots({ data: makeData(), parentLabel: 'biebele' });
  // The OTHER appearance of parent_label later in a sentence keeps
  // the user's casing — we only capitalise the leading character.
  const out = renderNarration("Hello {parent_label}.", slots);
  expect(out).toBe('Hello biebele.');
});

it('renderNarration handles slots that produce em-dash placeholders cleanly', () => {
  const data = makeData({
    bp: {
      latest: null,
      latestSampleSec: null,
      classification: null,
      staleness: 'never' as never,
    },
  });
  const slots = buildNarrationSlots({ data, parentLabel: 'Dad' });
  const out = renderNarration('{parent_label} {bp_value} reading', slots);
  expect(out).toBe('Dad — reading');
});

// ── slot derivers ─────────────────────────────────────────────────────

it('formats sleep_total as Hh Mm', () => {
  const slots = buildNarrationSlots({
    data: makeData({
      sleep: {
        session: { totalMinutes: 444 } as never,
        classification: { tier: 'in_pattern' } as never,
        staleness: 'fresh' as never,
      },
    }),
    parentLabel: 'Mum',
  });
  expect(slots.sleep_total).toBe('7h 24m');
});

it('formats sleep_total cleanly when minutes are zero', () => {
  const slots = buildNarrationSlots({
    data: makeData({
      sleep: {
        session: { totalMinutes: 480 } as never,
        classification: null,
        staleness: 'fresh' as never,
      },
    }),
    parentLabel: 'Mum',
  });
  expect(slots.sleep_total).toBe('8h');
});

it('formats steps_today with thousands separator', () => {
  const slots = buildNarrationSlots({
    data: makeData({
      activity: {
        stepsToday: 12345,
        targetSteps: 8000,
        latestSampleSec: null,
        classification: null,
        staleness: 'fresh' as never,
      },
    }),
    parentLabel: 'You',
  });
  expect(slots.steps_today).toBe('12,345');
});

// Sprint 19 (audit D12 P0-7) — bp_delta is a COMPLETE predicate. It used
// to be a fragment ("six below her week") substituted into templates that
// ALSO said "above her week", composing to "…is six below her week above
// her week." The slot-level assertions below are kept, but see the
// composition suite at the bottom of this file: asserting the slot in
// isolation is exactly what let the broken sentence ship green.
it('formats bp_delta as a complete predicate in words', () => {
  const slots = buildNarrationSlots({
    data: makeData(),
    parentLabel: 'Mum',
    weekAverageSystolic: 130,
    weekAverageDiastolic: 80,
  });
  // 124 - 130 = -6
  expect(slots.bp_delta).toBe("six below the week's average");
});

it('formats bp_delta as "in line" when within 1', () => {
  const slots = buildNarrationSlots({
    data: makeData(),
    parentLabel: 'Mum',
    weekAverageSystolic: 124,
    weekAverageDiastolic: 79,
  });
  expect(slots.bp_delta).toBe("in line with the week's average");
});

it('falls back to a non-numeric predicate when there is no week average', () => {
  const slots = buildNarrationSlots({ data: makeData(), parentLabel: 'Mum' });
  // Never invents a magnitude; the templates consuming this slot only
  // fire on a calm_concerned BP tier, so this is true by construction.
  expect(slots.bp_delta).toBe('higher than usual');
});

it('never emits gendered pronouns in bp_delta (parent may be "Dad")', () => {
  for (const weekAvg of [130, 124, 118, undefined]) {
    const slots = buildNarrationSlots({
      data: makeData(),
      parentLabel: 'Dad',
      weekAverageSystolic: weekAvg,
      weekAverageDiastolic: 80,
    });
    expect(slots.bp_delta).not.toMatch(/\b(her|his|she|he)\b/i);
  }
});

it('formats steps_target_hits in words', () => {
  const slots = buildNarrationSlots({
    data: makeData(),
    parentLabel: 'Mum',
    stepsTargetDaysHit: 4,
  });
  expect(slots.steps_target_hits).toBe('four days');
});

// ── buildNarrationContext ─────────────────────────────────────────────

it('picks bp as central vital when bp present', () => {
  const ctx = buildNarrationContext({ data: makeData() });
  expect(ctx.centralVital).toBe('bp');
});

it('falls through to hr → sleep → activity → spo2 when prior vitals missing', () => {
  const data = makeData({
    bp: { latest: null, latestSampleSec: null, classification: null, staleness: 'never' as never },
  });
  const ctx = buildNarrationContext({ data });
  expect(ctx.centralVital).toBe('hr');
});

it('returns null central when nothing populated', () => {
  const data = makeData({
    bp: { latest: null, latestSampleSec: null, classification: null, staleness: 'never' as never },
    hr: { restingToday: null, displayBpm: null, displaySource: null, latestSampleSec: null, classification: null, staleness: 'never' as never },
    spo2: { latestPercent: null, overnightLowsRecent: [], latestSampleSec: null, classification: null, staleness: 'never' as never },
    sleep: { session: null, classification: null, staleness: 'never' as never },
    activity: { stepsToday: 0, targetSteps: 8000, latestSampleSec: null, classification: null, staleness: 'never' as never },
  });
  const ctx = buildNarrationContext({ data });
  expect(ctx.centralVital).toBeNull();
});

// ── generateDailyNarrationTierA ───────────────────────────────────────

it('generates a Tier-A narration for the all-in-pattern bp-central baseline', () => {
  const r = generateDailyNarrationTierA({
    data: makeData(),
    parentLabel: 'Mum',
    accountType: 'caregiver',
  });
  expect(r.tier).toBe('A');
  expect(r.text).toContain('Mum');
  expect(r.text).toContain('124/79');
  // Voice-clean: no forbidden vocabulary
  expect(r.text).not.toMatch(/patient|diagnose|critical level/i);
});

it('routes to a different template when bp is calm_concerned', () => {
  const inPatternResult = generateDailyNarrationTierA({
    data: makeData(),
    parentLabel: 'Mum',
    accountType: 'caregiver',
  });
  const concernedResult = generateDailyNarrationTierA({
    data: makeData({
      bp: {
        latest: { systolic: 145, diastolic: 92, pulse: 72 },
        latestSampleSec: 1_777_036_401,
        classification: { tier: 'calm_concerned' } as never,
        staleness: 'fresh' as never,
      },
    }),
    parentLabel: 'Mum',
    accountType: 'caregiver',
  });
  // Different template ID expected because the selector branches
  // change with the classification tier.
  expect(inPatternResult.templateId).not.toBe(concernedResult.templateId);
});
