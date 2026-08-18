// Deno tests for notification-templates — Sprint 15.
//
// Each rendered string is fed through voice-lint-push to enforce the
// voice rules at build time. If any template fails the lint, this test
// fails — that's the hard gate per docs/11-push-notifications.md §4.

import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  renderAnomalyNotification,
  renderDailySummary,
  renderWeeklySummary,
  renderWatchLowBattery,
  renderFamilyInviteAccepted,
  renderSubscriptionRenewing,
  type AccountType,
} from './notification-templates.ts';
import {
  lintPushText,
  PUSH_BODY_MAX_IOS,
  PUSH_BODY_MAX_ANDROID,
} from './voice-lint-push.ts';

function assertVoiceClean(text: string, label: string): void {
  const r = lintPushText(text);
  if (!r.passes) {
    throw new Error(
      `${label} failed voice-lint: ${r.hardHits.map((h) => h.match + ' (' + h.why + ')').join(', ')}`,
    );
  }
}

function assertLengthOk(title: string, body: string, label: string): void {
  assert(body.length <= PUSH_BODY_MAX_ANDROID, `${label} body exceeds Android ${PUSH_BODY_MAX_ANDROID}`);
  // iOS limit is a soft target — surface but don't fail the test build.
  if (body.length > PUSH_BODY_MAX_IOS) {
    console.warn(`${label} body exceeds iOS ${PUSH_BODY_MAX_IOS}: ${body.length} chars`);
  }
  assert(title.length <= 60, `${label} title is too long (${title.length})`);
}

const RECIPIENTS: AccountType[] = ['caregiver', 'self_buyer', 'parent'];

// ── BP anomalies ─────────────────────────────────────────────────────

Deno.test('BP crisis-absolute renders for all recipients with clean voice', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderAnomalyNotification(r, {
      vitalKind: 'bp',
      tier: 'confirmed_urgent',
      reason: 'crisis_absolute',
      parentLabel: 'Mum',
    });
    assert(rendered, `${r} should get a render`);
    assertVoiceClean(rendered!.title, `BP crisis title (${r})`);
    assertVoiceClean(rendered!.body, `BP crisis body (${r})`);
    assertLengthOk(rendered!.title, rendered!.body, `BP crisis (${r})`);
  }
});

Deno.test('BP sustained 60min renders for all recipients with clean voice', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderAnomalyNotification(r, {
      vitalKind: 'bp',
      tier: 'confirmed_urgent',
      reason: 'stage2_sustained_60min',
      parentLabel: 'Dad',
    });
    assert(rendered);
    assertVoiceClean(rendered!.title, `BP sustained title (${r})`);
    assertVoiceClean(rendered!.body, `BP sustained body (${r})`);
    assertLengthOk(rendered!.title, rendered!.body, `BP sustained (${r})`);
  }
});

Deno.test('BP single calm-concerned returns null (no push)', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderAnomalyNotification(r, {
      vitalKind: 'bp',
      tier: 'calm_concerned',
      reason: 'outside_band',
      parentLabel: 'Mum',
    });
    assertEquals(rendered, null);
  }
});

Deno.test('BP calm-trend renders for all recipients with clean voice', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderAnomalyNotification(r, {
      vitalKind: 'bp',
      tier: 'calm_concerned',
      reason: 'baseline_3day_trend',
      parentLabel: 'Mum',
    });
    assert(rendered);
    assertVoiceClean(rendered!.title, `BP trend title (${r})`);
    assertVoiceClean(rendered!.body, `BP trend body (${r})`);
    assertLengthOk(rendered!.title, rendered!.body, `BP trend (${r})`);
  }
});

// ── HR anomalies ─────────────────────────────────────────────────────

Deno.test('HR confirmed-urgent renders for all recipients with clean voice', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderAnomalyNotification(r, {
      vitalKind: 'hr',
      tier: 'confirmed_urgent',
      reason: 'extreme_value',
      parentLabel: 'Mum',
    });
    assert(rendered);
    assertVoiceClean(rendered!.title, `HR urgent title (${r})`);
    assertVoiceClean(rendered!.body, `HR urgent body (${r})`);
    assertLengthOk(rendered!.title, rendered!.body, `HR urgent (${r})`);
  }
});

Deno.test('HR calm-concerned (3-day trend) renders for all recipients', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderAnomalyNotification(r, {
      vitalKind: 'hr',
      tier: 'calm_concerned',
      reason: 'baseline_3day_trend',
      parentLabel: 'Mum',
    });
    assert(rendered);
    assertVoiceClean(rendered!.title, `HR calm title (${r})`);
    assertVoiceClean(rendered!.body, `HR calm body (${r})`);
    assertLengthOk(rendered!.title, rendered!.body, `HR calm (${r})`);
  }
});

// ── SpO2 anomalies ───────────────────────────────────────────────────

Deno.test('SpO2 confirmed-urgent renders for all recipients', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderAnomalyNotification(r, {
      vitalKind: 'spo2',
      tier: 'confirmed_urgent',
      reason: 'overnight_dip_sustained',
      parentLabel: 'Dad',
    });
    assert(rendered);
    assertVoiceClean(rendered!.title, `SpO2 urgent title (${r})`);
    assertVoiceClean(rendered!.body, `SpO2 urgent body (${r})`);
    assertLengthOk(rendered!.title, rendered!.body, `SpO2 urgent (${r})`);
  }
});

Deno.test('SpO2 calm-concerned renders for all recipients', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderAnomalyNotification(r, {
      vitalKind: 'spo2',
      tier: 'calm_concerned',
      reason: 'sample_or_overnight_borderline',
      parentLabel: 'Mum',
    });
    assert(rendered);
    assertVoiceClean(rendered!.title, `SpO2 calm title (${r})`);
    assertVoiceClean(rendered!.body, `SpO2 calm body (${r})`);
    assertLengthOk(rendered!.title, rendered!.body, `SpO2 calm (${r})`);
  }
});

// ── Sleep / activity never produce ───────────────────────────────────

Deno.test('Sleep + activity never produce a push payload', () => {
  for (const r of RECIPIENTS) {
    for (const v of ['sleep', 'activity'] as const) {
      const rendered = renderAnomalyNotification(r, {
        vitalKind: v,
        tier: 'calm_concerned',
        reason: 'baseline_3day_trend',
        parentLabel: 'Mum',
      });
      assertEquals(rendered, null, `${v} ${r} must return null`);
    }
  }
});

// ── Daily / weekly / device / family / subscription ──────────────────

Deno.test('Daily summary with reading renders cleanly', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderDailySummary(r, {
      parentLabel: 'Mum',
      sys: 122,
      dia: 80,
      hadReading: true,
      sleepHours: 7,
    });
    assertVoiceClean(rendered.title, `daily ${r} title`);
    assertVoiceClean(rendered.body, `daily ${r} body`);
    assertLengthOk(rendered.title, rendered.body, `daily ${r}`);
  }
});

Deno.test('Daily summary with no reading prompts gently', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderDailySummary(r, {
      parentLabel: 'Mum',
      hadReading: false,
    });
    assertVoiceClean(rendered.title, `daily-no-reading ${r} title`);
    assertVoiceClean(rendered.body, `daily-no-reading ${r} body`);
  }
});

Deno.test('Weekly summary passes through AI body — assumes Tier-C lint upstream', () => {
  const rendered = renderWeeklySummary('caregiver', {
    parentLabel: 'Mum',
    body: 'Three calm days, one elevated morning. Worth a check-in.',
  });
  assertVoiceClean(rendered.title, 'weekly title');
  assertVoiceClean(rendered.body, 'weekly body');
});

Deno.test('Watch low battery renders cleanly', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderWatchLowBattery(r, {
      parentLabel: 'Dad',
      batteryPct: 12,
    });
    assertVoiceClean(rendered.title, `watch ${r} title`);
    assertVoiceClean(rendered.body, `watch ${r} body`);
  }
});

Deno.test('Family invite accepted renders cleanly', () => {
  for (const r of RECIPIENTS) {
    const rendered = renderFamilyInviteAccepted(r, {
      caregiverName: 'Adaeze',
    });
    assertVoiceClean(rendered.title, `family ${r} title`);
    assertVoiceClean(rendered.body, `family ${r} body`);
  }
});

Deno.test('Subscription renewal renders cleanly', () => {
  const rendered = renderSubscriptionRenewing('self_buyer', { priceUsd: '4.99' });
  assertVoiceClean(rendered.title, 'subscription title');
  assertVoiceClean(rendered.body, 'subscription body');
});
