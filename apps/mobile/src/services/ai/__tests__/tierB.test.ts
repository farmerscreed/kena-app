// services/ai/tierB tests — Sprint 12.

jest.mock('../../supabase', () => ({
  supabase: {
    functions: { invoke: jest.fn() },
  },
}));
jest.mock('../../analytics/logger', () => ({
  logger: { track: jest.fn() },
}));

import { askTierB, _internals } from '../tierB';
import { supabase } from '../../supabase';
import { logger } from '../../analytics/logger';

const invokeSpy = supabase.functions.invoke as jest.Mock;
const trackSpy = logger.track as jest.Mock;

beforeEach(() => {
  invokeSpy.mockReset();
  trackSpy.mockReset();
});

// ── Input validation ──────────────────────────────────────────────────

it('returns empty_question error and never invokes for empty input', async () => {
  const r = await askTierB({ question: '   ' });
  expect(r.status).toBe('error');
  if (r.status === 'error') expect(r.error).toBe('empty_question');
  expect(invokeSpy).not.toHaveBeenCalled();
});

it('returns question_too_long error and never invokes when > 2000 chars', async () => {
  const r = await askTierB({ question: 'a'.repeat(2001) });
  expect(r.status).toBe('error');
  if (r.status === 'error') expect(r.error).toBe('question_too_long');
  expect(invokeSpy).not.toHaveBeenCalled();
});

it('trims whitespace before sending', async () => {
  invokeSpy.mockResolvedValueOnce({
    data: {
      status: 'ok',
      body: 'ok body',
      conversationId: 'c1',
      messageId: 'm1',
      model: 'haiku',
      guard: { layer1Hits: 0, layer2MaxCosine: 0.1, retries: 0 },
    },
    error: null,
  });
  await askTierB({ question: '   what is bp?   ' });
  expect(invokeSpy).toHaveBeenCalledWith('ai-tier-b', {
    body: { question: 'what is bp?' },
  });
});

// ── OK path ───────────────────────────────────────────────────────────

it('returns ok with body, ids, and guard metadata on a successful response', async () => {
  invokeSpy.mockResolvedValueOnce({
    data: {
      status: 'ok',
      body: 'Mum is in her usual range.',
      conversationId: 'c-123',
      messageId: 'm-456',
      tier: 'B',
      model: 'claude-haiku-4-5-20251001',
      guard: { layer1Hits: 0, layer2MaxCosine: 0.42, retries: 0 },
    },
    error: null,
  });
  const r = await askTierB({ question: 'is 75 bpm normal?' });
  expect(r.status).toBe('ok');
  if (r.status === 'ok') {
    expect(r.body).toBe('Mum is in her usual range.');
    expect(r.conversationId).toBe('c-123');
    expect(r.messageId).toBe('m-456');
    expect(r.guard.layer2MaxCosine).toBe(0.42);
  }
});

it('logs ai_tier_b_started + ai_tier_b_ok on success — without the body', async () => {
  invokeSpy.mockResolvedValueOnce({
    data: {
      status: 'ok',
      body: 'PHI-bearing reply must not be in analytics',
      conversationId: 'c',
      messageId: 'm',
      model: 'haiku',
      guard: { layer1Hits: 0, layer2MaxCosine: 0.41723, retries: 0 },
    },
    error: null,
  });
  await askTierB({ question: 'q' });
  expect(trackSpy).toHaveBeenCalledWith('ai_tier_b_started', { length: 1 });
  expect(trackSpy).toHaveBeenCalledWith('ai_tier_b_ok', {
    retries: 0,
    layer1_hits: 0,
    // Rounded to 2 decimals.
    layer2_max_cosine: 0.42,
  });
  // Per CLAUDE.md / D14 §13: response body is NEVER in analytics.
  for (const call of trackSpy.mock.calls) {
    const payload = JSON.stringify(call[1] ?? {});
    expect(payload.includes('PHI-bearing')).toBe(false);
  }
});

// ── DEFER path ────────────────────────────────────────────────────────

it('returns defer with valid trigger', async () => {
  invokeSpy.mockResolvedValueOnce({
    data: { status: 'defer', trigger: 'medication', reason: 'model_defer' },
    error: null,
  });
  const r = await askTierB({ question: 'should i increase my lisinopril?' });
  expect(r.status).toBe('defer');
  if (r.status === 'defer') expect(r.trigger).toBe('medication');
});

it('translates server "pediatric" to mobile-canonical "paediatric"', async () => {
  invokeSpy.mockResolvedValueOnce({
    data: { status: 'defer', trigger: 'pediatric', reason: 'model_defer' },
    error: null,
  });
  const r = await askTierB({ question: 'is bp ok for my 4 year old?' });
  expect(r.status).toBe('defer');
  if (r.status === 'defer') expect(r.trigger).toBe('paediatric');
});

it('also accepts British "paediatric" from the server pass-through', async () => {
  invokeSpy.mockResolvedValueOnce({
    data: { status: 'defer', trigger: 'paediatric', reason: '' },
    error: null,
  });
  const r = await askTierB({ question: 'q' });
  expect(r.status).toBe('defer');
  if (r.status === 'defer') expect(r.trigger).toBe('paediatric');
});

it('rejects an unknown defer trigger as invalid_response', async () => {
  invokeSpy.mockResolvedValueOnce({
    data: { status: 'defer', trigger: 'wizardry', reason: '' },
    error: null,
  });
  const r = await askTierB({ question: 'q' });
  expect(r.status).toBe('error');
  if (r.status === 'error') expect(r.error).toBe('invalid_defer_trigger');
});

// ── Quota path ────────────────────────────────────────────────────────

it('returns quota_exceeded with resetsAt', async () => {
  invokeSpy.mockResolvedValueOnce({
    data: {
      status: 'quota_exceeded',
      tier: 'B',
      remaining: 0,
      resetsAt: '2026-06-01T00:00:00.000Z',
    },
    error: null,
  });
  const r = await askTierB({ question: 'q' });
  expect(r.status).toBe('quota_exceeded');
  if (r.status === 'quota_exceeded') {
    expect(r.resetsAt).toBe('2026-06-01T00:00:00.000Z');
  }
  expect(trackSpy).toHaveBeenCalledWith('ai_tier_b_quota_exceeded');
});

// ── Error paths ───────────────────────────────────────────────────────

it('maps invoke error to status=error invoke_failed', async () => {
  invokeSpy.mockResolvedValueOnce({
    data: null,
    error: { message: 'http 502' },
  });
  const r = await askTierB({ question: 'q' });
  expect(r.status).toBe('error');
  if (r.status === 'error') {
    expect(r.error).toBe('invoke_failed');
    expect(r.detail).toBe('http 502');
  }
});

it('maps thrown network exception to status=error network_error', async () => {
  invokeSpy.mockRejectedValueOnce(new Error('socket hang up'));
  const r = await askTierB({ question: 'q' });
  expect(r.status).toBe('error');
  if (r.status === 'error') expect(r.error).toBe('network_error');
});

it('parses null/garbage data as invalid_response', async () => {
  invokeSpy.mockResolvedValueOnce({ data: null, error: null });
  const r = await askTierB({ question: 'q' });
  expect(r.status).toBe('error');
  if (r.status === 'error') expect(r.error).toBe('invalid_response');
});

// ── parseResponse direct unit coverage ────────────────────────────────

describe('parseResponse', () => {
  const { parseResponse } = _internals;
  it('returns invalid_response for non-object inputs', () => {
    expect(parseResponse(null).status).toBe('error');
    expect(parseResponse(42).status).toBe('error');
    expect(parseResponse('hello').status).toBe('error');
  });
  it('returns invalid_response when ok is missing required fields', () => {
    expect(parseResponse({ status: 'ok' }).status).toBe('error');
    expect(parseResponse({ status: 'ok', body: 'x' }).status).toBe('error');
  });
  it('defaults guard fields when partial', () => {
    const r = parseResponse({
      status: 'ok',
      body: 'b',
      conversationId: 'c',
      messageId: 'm',
      model: 'haiku',
      guard: {},
    });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.guard.layer1Hits).toBe(0);
      expect(r.guard.layer2MaxCosine).toBe(0);
      expect(r.guard.retries).toBe(0);
    }
  });
  it('returns invalid_response on unknown status field', () => {
    expect(parseResponse({ status: 'bonkers' }).status).toBe('error');
  });
});
