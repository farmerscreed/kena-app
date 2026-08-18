// supabase/functions/ai-daily-narration/index.ts — Sprint 12.5 session 2.
//
// Tier-B path for the daily narration ambient surface (D14 §3).
// Mobile decides locally whether to even call this — Tier-A renders
// client-side via Sprint 12.5 session 1's `dailyNarration.ts` (free
// users + non-novel days). When mobile detects a novel pattern AND
// the user is on Plus, it POSTs here.
//
// The EF re-loads and re-detects for trust — mobile can't be trusted
// to assert "I'm novel"; the server makes the routing decision
// itself. This costs a duplicate read but keeps the LLM-call gate
// authoritative.
//
// Flow:
//   1. JWT validate → derive user_id + family_id (loadIdentity).
//   2. Quota check (D14 §14.1): free = 5/month, plus = 100/month.
//   3. Cache check on ai_narration_cache (user_id, 'daily_narration',
//      scope_key=today's local-date). Hit + ≤ 4h old → return.
//   4. assembleAiContext (vitals + correlations) + detect novel.
//   5. If not novel → return early with `{status:'tier_a_recommended'}`
//      so mobile renders the local template. We never spend an
//      Anthropic call when the server agrees with mobile that it's
//      not novel.
//   6. Build prompt (D14 §3.4) + Anthropic Haiku 4.5 call.
//   7. Layer 1 regex + Layer 2 cosine guards.
//   8. Persist to ai_narration_cache + audit_log + 10% sample to
//      ai_clinical_review_queue.
//   9. Return body.

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { assembleAiContext } from '../_shared/vitals-context-assembler.ts';
import {
  detectNovelPattern,
  isBpAnomalousVsWeekAverage,
  type NovelReason,
} from '../_shared/novel-pattern.ts';
import {
  buildSystemPrompt,
  SYSTEM_PROMPT_VERSION,
} from '../_shared/system-prompt.ts';
import {
  scanLayer1,
  buildLayer1RetryAugment,
  type ForbiddenHit,
} from '../_shared/output-guard/layer1-regex.ts';
import {
  scanLayer2,
  buildLayer2RetryAugment,
  LAYER2_THRESHOLD,
} from '../_shared/output-guard/layer2-cosine.ts';
import { createSupabaseEmbedder } from '../_shared/output-guard/embedder.ts';
import {
  assertScrubbed,
  type ScrubbedAiContext,
} from '../_shared/phi-scrub.ts';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 120; // D14 §3.4 — daily narration is 1–2 sentences
const REQUEST_TIMEOUT_MS = 12_000;
const LAYER2_TIMEOUT_MS = 3_000;
const SAMPLE_RATE = 0.10;
const FOUR_HOURS_SEC = 4 * 60 * 60;

const FREE_TIER_B_MONTHLY = 5;
const PLUS_TIER_B_MONTHLY = 100;

// ── Helpers ────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function startOfMonthIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label}: timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (err) => { clearTimeout(t); reject(err); },
    );
  });
}

// ── Anthropic ──────────────────────────────────────────────────────────

interface AnthropicCallResult {
  body: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

async function callAnthropic(opts: {
  systemPrompt: string;
  userPrompt: string;
  apiKey: string;
  baseUrl: string;
  signal: AbortSignal;
}): Promise<AnthropicCallResult | { error: string; detail: string }> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl}/v1/messages`, {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: opts.systemPrompt,
        messages: [{ role: 'user', content: opts.userPrompt }],
      }),
    });
  } catch (err) {
    return { error: 'anthropic_fetch_failed', detail: (err as Error).message };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { error: 'anthropic_http_' + res.status, detail: detail.slice(0, 400) };
  }
  const out = (await res.json()) as any;
  return {
    body: ((out.content?.[0]?.text as string | undefined) ?? '').trim(),
    promptTokens: out.usage?.input_tokens ?? 0,
    completionTokens: out.usage?.output_tokens ?? 0,
    durationMs: performance.now() - t0,
  };
}

// ── Quota / cache helpers ──────────────────────────────────────────────

async function countMonthAiCalls(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<number> {
  // Counts BOTH user_question and daily_narration egresses against
  // the same monthly Tier-B quota per D14 §14.1.
  const { count } = await serviceClient
    .from('audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('actor_user_id', userId)
    .in('action', ['ai.user_question', 'ai.daily_narration'])
    .gte('occurred_at', startOfMonthIso());
  return count ?? 0;
}

async function readCache(
  serviceClient: SupabaseClient,
  userId: string,
  scopeKey: string,
): Promise<{ body: string; tier: string; messageId: string } | null> {
  const { data } = await serviceClient
    .from('ai_narration_cache')
    .select('id, body, tier, generated_at')
    .eq('user_id', userId)
    .eq('surface', 'daily_narration')
    .eq('scope_key', scopeKey)
    .maybeSingle();
  if (!data) return null;
  const generatedAtSec = Math.floor(new Date(data.generated_at as string).getTime() / 1000);
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - generatedAtSec > FOUR_HOURS_SEC) return null;
  return {
    body: data.body as string,
    tier: data.tier as string,
    messageId: data.id as string,
  };
}

async function writeCache(
  serviceClient: SupabaseClient,
  opts: {
    userId: string;
    familyId: string;
    scopeKey: string;
    body: string;
    promptTokens: number;
    completionTokens: number;
    flagged: boolean;
  },
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('ai_narration_cache')
    .upsert(
      {
        user_id: opts.userId,
        family_id: opts.familyId,
        surface: 'daily_narration',
        scope_key: opts.scopeKey,
        body: opts.body,
        tier: 'B',
        model: HAIKU_MODEL,
        prompt_tokens: opts.promptTokens,
        completion_tokens: opts.completionTokens,
        flagged: opts.flagged,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,surface,scope_key' },
    )
    .select('id')
    .single();
  if (error || !data) {
    console.error('cache upsert failed', error?.message);
    return null;
  }
  return data.id as string;
}

async function writeAuditLog(
  serviceClient: SupabaseClient,
  opts: {
    actorUserId: string;
    familyId: string;
    action: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await serviceClient.from('audit_log').insert({
    actor_user_id: opts.actorUserId,
    family_id: opts.familyId,
    action: opts.action,
    metadata: opts.metadata,
  });
  if (error) console.error('audit_log insert error', error.message);
}

// ── Prompt builder ─────────────────────────────────────────────────────

export function buildDailyNarrationUserPrompt(
  context: ScrubbedAiContext,
  reasons: NovelReason[],
  todayLocal: string,
  retryAugment?: string,
): string {
  // Mirrors the D14 §3.4 user-prompt shape but adapted to the
  // ScrubbedAiContext field names. Wraps the request in
  // <user_query> tags per D14 §11.2 anti-injection.
  const lines: string[] = [];
  lines.push(`Account type: ${context.accountType}`);
  lines.push(`Parent label: ${context.parentLabel}`);
  if (context.yearOfBirth !== null) lines.push(`Year of birth: ${context.yearOfBirth}`);
  if (context.residenceCity !== null) lines.push(`Residence city: ${context.residenceCity}`);
  lines.push(`Today's date (local): ${todayLocal}`);
  lines.push('');
  lines.push('Vitals:');
  if (context.bp) {
    let bp = `  BP: ${context.bp.state} — latest ${context.bp.latestSystolic}/${context.bp.latestDiastolic}`;
    if (context.bp.weekAverageSystolic !== null) {
      bp += ` — week avg ${context.bp.weekAverageSystolic}/${context.bp.weekAverageDiastolic ?? '?'}`;
    }
    lines.push(bp);
  }
  if (context.hr) {
    lines.push(
      `  HR: ${context.hr.state} — resting today ${context.hr.restingToday ?? '?'} — baseline ${context.hr.baseline ?? '?'}`,
    );
  }
  if (context.spo2) {
    lines.push(
      `  SpO2: ${context.spo2.state} — latest ${context.spo2.latest ?? '?'} — overnight low ${context.spo2.overnightLow ?? '?'}`,
    );
  }
  if (context.sleep) {
    lines.push(
      `  Sleep: ${context.sleep.state} — last night ${context.sleep.lastNightTotalMinutes ?? '?'}min — score ${context.sleep.score ?? '?'}`,
    );
  }
  if (context.activity) {
    lines.push(
      `  Activity: ${context.activity.state} — today ${context.activity.todaySteps ?? '?'} of ${context.activity.targetSteps ?? '?'} steps`,
    );
  }
  if (context.correlations && context.correlations.length > 0) {
    lines.push('');
    lines.push('Notable correlations (rounded r values):');
    for (const c of context.correlations) {
      lines.push(`  ${c.leftVital} ↔ ${c.rightVital}: r=${c.coefficient.toFixed(2)} ${c.meaningful ? '(meaningful)' : ''}`);
    }
  }
  lines.push('');
  lines.push(`Trigger reasons: ${reasons.join(', ') || 'none'}`);
  lines.push('');
  lines.push('Constraints:');
  lines.push('- Maximum 2 sentences. Aim for 1.');
  lines.push(`- Lead with the answer. First sentence resolves "how is ${context.parentLabel}?"`);
  lines.push('- Sentence-case. No exclamation points.');
  lines.push(`- Use "${context.parentLabel}" — never "patient".`);
  lines.push('- Describe data only — never diagnose, predict, or prescribe.');

  const retry = retryAugment ? `${retryAugment}\n\n` : '';
  return `${retry}<user_query>\nGenerate a daily narration for the Leiko Home screen.\n\n${lines.join('\n')}\n</user_query>`;
}

// ── Main handler ───────────────────────────────────────────────────────

interface RequestBody {
  scopeKey: string; // 'YYYY-MM-DD' local-date
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ status: 'error', error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ status: 'error', error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    return json({ status: 'error', error: 'service_unavailable', detail: 'ANTHROPIC_API_KEY not set' }, 503);
  }
  const baseUrl = Deno.env.get('LITELLM_BASE_URL') || 'https://api.anthropic.com';
  const allowProdData = Deno.env.get('AI_TIER_B_PROD_DATA_ENABLED') === 'true';

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ status: 'error', error: 'unauthorized' }, 401);
  const userId = userData.user.id;

  const serviceClient = createClient(supabaseUrl, serviceKey);

  let body: RequestBody;
  try {
    const parsed = (await req.json()) as Partial<RequestBody>;
    if (typeof parsed.scopeKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.scopeKey)) {
      return json({ status: 'error', error: 'invalid_scope_key' }, 400);
    }
    body = { scopeKey: parsed.scopeKey };
  } catch {
    return json({ status: 'error', error: 'invalid_json' }, 400);
  }

  // Family lookup (single membership at v1.0).
  const { data: membership } = await serviceClient
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId)
    .is('removed_at', null)
    .limit(1)
    .maybeSingle();
  if (!membership) return json({ status: 'error', error: 'no_family' }, 400);
  const familyId = membership.family_id as string;

  // ── Cache hit? ────────────────────────────────────────────────────
  const cached = await readCache(serviceClient, userId, body.scopeKey);
  if (cached) {
    return json({
      status: 'ok',
      body: cached.body,
      tier: cached.tier,
      cached: true,
      messageId: cached.messageId,
    }, 200);
  }

  // ── Assemble context + decide novel ───────────────────────────────
  const assembled = await assembleAiContext(serviceClient, userId, familyId, {
    allowProdData,
  });
  if ('error' in assembled) {
    return json({ status: 'error', error: assembled.error }, 400);
  }
  const { identity, context: scrubbed } = assembled;
  try {
    assertScrubbed(scrubbed);
  } catch (err) {
    return json({ status: 'error', error: 'scrub_failed', detail: (err as Error).message }, 500);
  }

  // Days since last reading — coarse from BP latest. (Other vitals
  // also signal presence, but BP is the most reliable v1.0 cadence.)
  let daysSinceLastReading = 0;
  if (scrubbed.bp) {
    daysSinceLastReading = Math.floor(
      (Math.floor(Date.now() / 1000) - scrubbed.bp.latestMeasuredAtDayUtcSec) / (24 * 60 * 60),
    );
  } else {
    daysSinceLastReading = 999; // No BP at all → behaves as ≥7d absence
  }

  // New correlations in last 24h — server-side query.
  const since24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: newCorrCount } = await serviceClient
    .from('correlations')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_meaningful', true)
    .gte('computed_at', since24hIso);

  const novel = detectNovelPattern({
    context: scrubbed,
    newCorrelationCount: newCorrCount ?? 0,
    daysSinceLastReading,
    isLatestReadingAnomalous: isBpAnomalousVsWeekAverage(scrubbed),
  });

  // ── Not Plus OR not novel → tell mobile to render Tier-A ──────────
  if (!identity.isPlus || !novel.isNovel) {
    return json({
      status: 'tier_a_recommended',
      reason: !identity.isPlus ? 'free_tier' : 'no_novel_pattern',
      novelReasons: novel.reasons,
    }, 200);
  }

  // ── Quota check — Plus only path ──────────────────────────────────
  const monthCount = await countMonthAiCalls(serviceClient, userId);
  if (monthCount >= PLUS_TIER_B_MONTHLY) {
    await writeAuditLog(serviceClient, {
      actorUserId: userId, familyId,
      action: 'ai.refusal',
      metadata: { reason: 'quota_exceeded', tier: 'B', surface: 'daily_narration' },
    });
    // Tell mobile to fall back to Tier-A so Home isn't blank.
    return json({
      status: 'tier_a_recommended',
      reason: 'quota_exceeded',
      novelReasons: novel.reasons,
    }, 200);
  }

  // ── Tier-B LLM call ───────────────────────────────────────────────
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const allowedCardIds = ''; // cosine card-matcher is Sprint 14.5 follow-up
  const systemPrompt = buildSystemPrompt({
    allowedCardIds,
    userLanguage: identity.preferredLanguage,
  });
  const userPrompt = buildDailyNarrationUserPrompt(
    scrubbed,
    novel.reasons,
    body.scopeKey,
  );

  const firstCall = await callAnthropic({
    systemPrompt, userPrompt, apiKey: anthropicKey, baseUrl, signal: controller.signal,
  });
  if ('error' in firstCall) {
    clearTimeout(timeout);
    return json({ status: 'error', error: firstCall.error, detail: firstCall.detail }, 502);
  }
  let candidate = firstCall.body;
  let promptTokens = firstCall.promptTokens;
  let completionTokens = firstCall.completionTokens;
  let retries = 0;
  let layer1Hits: ForbiddenHit[] = [];
  let layer2Cosine = 0;

  // ── Layer 1 ───────────────────────────────────────────────────────
  const layer1 = scanLayer1(candidate);
  if (!layer1.passes) {
    layer1Hits = layer1.hits;
    await writeAuditLog(serviceClient, {
      actorUserId: userId, familyId,
      action: 'ai.output_guard_hit',
      metadata: { layer: 1, surface: 'daily_narration', rule_ids: Array.from(new Set(layer1.hits.map((h) => h.ruleId))) },
    });
    const retryAug = buildLayer1RetryAugment(layer1.hits);
    const retryPrompt = buildDailyNarrationUserPrompt(scrubbed, novel.reasons, body.scopeKey, retryAug);
    retries++;
    const retryCall = await callAnthropic({
      systemPrompt, userPrompt: retryPrompt, apiKey: anthropicKey, baseUrl, signal: controller.signal,
    });
    if ('error' in retryCall) {
      clearTimeout(timeout);
      return json({ status: 'tier_a_recommended', reason: 'guard_retry_failed', novelReasons: novel.reasons }, 200);
    }
    candidate = retryCall.body;
    promptTokens += retryCall.promptTokens;
    completionTokens += retryCall.completionTokens;
    const recheck = scanLayer1(candidate);
    if (!recheck.passes) {
      clearTimeout(timeout);
      await writeAuditLog(serviceClient, {
        actorUserId: userId, familyId,
        action: 'ai.refusal',
        metadata: { reason: 'layer1_double_hit', surface: 'daily_narration' },
      });
      return json({ status: 'tier_a_recommended', reason: 'guard_double_hit', novelReasons: novel.reasons }, 200);
    }
  }

  // ── Layer 2 ───────────────────────────────────────────────────────
  // D13 §9.2 — the semantic guard never fails open silently: any skip
  // is audited (ai.output_guard_skipped) and the output is flagged.
  let guardSkipped = false;
  let embedder;
  try { embedder = createSupabaseEmbedder(); }
  catch (err) { console.warn('embedder unavailable', (err as Error).message); embedder = null; }
  if (!embedder) {
    guardSkipped = true;
    await writeAuditLog(serviceClient, {
      actorUserId: userId, familyId,
      action: 'ai.output_guard_skipped',
      metadata: { layer: 2, surface: 'daily_narration', cause: 'embedder_unavailable' },
    });
  }
  if (embedder) {
    let layer2;
    try {
      layer2 = await withTimeout(scanLayer2(candidate, embedder), LAYER2_TIMEOUT_MS, 'layer2');
    } catch (err) {
      console.warn('layer2 skipped:', (err as Error).message);
      layer2 = null;
      guardSkipped = true;
      await writeAuditLog(serviceClient, {
        actorUserId: userId, familyId,
        action: 'ai.output_guard_skipped',
        metadata: { layer: 2, surface: 'daily_narration', cause: 'scan_timeout' },
      });
    }
    if (layer2) layer2Cosine = layer2.maxCosine;
    if (layer2 && !layer2.passes) {
      await writeAuditLog(serviceClient, {
        actorUserId: userId, familyId,
        action: 'ai.output_guard_hit',
        metadata: { layer: 2, surface: 'daily_narration', max_cosine: layer2.maxCosine, matched_phrase: layer2.matchedPhrase },
      });
      const retryAug = buildLayer2RetryAugment(layer2.matchedPhrase);
      const retryPrompt = buildDailyNarrationUserPrompt(scrubbed, novel.reasons, body.scopeKey, retryAug);
      retries++;
      const retryCall = await callAnthropic({
        systemPrompt, userPrompt: retryPrompt, apiKey: anthropicKey, baseUrl, signal: controller.signal,
      });
      if ('error' in retryCall) {
        clearTimeout(timeout);
        return json({ status: 'tier_a_recommended', reason: 'guard_retry_failed', novelReasons: novel.reasons }, 200);
      }
      candidate = retryCall.body;
      promptTokens += retryCall.promptTokens;
      completionTokens += retryCall.completionTokens;
      const recheck1 = scanLayer1(candidate);
      // §9.2 — the post-retry scan gets the same timeout protection as
      // the pre-retry scan; a hung recheck defers rather than hangs.
      let recheck2;
      try {
        recheck2 = await withTimeout(scanLayer2(candidate, embedder), LAYER2_TIMEOUT_MS, 'layer2-recheck');
      } catch {
        recheck2 = null;
        guardSkipped = true;
        await writeAuditLog(serviceClient, {
          actorUserId: userId, familyId,
          action: 'ai.output_guard_skipped',
          metadata: { layer: 2, surface: 'daily_narration', cause: 'recheck_timeout' },
        });
      }
      if (recheck2) layer2Cosine = recheck2.maxCosine;
      if (!recheck1.passes || (recheck2 && !recheck2.passes)) {
        clearTimeout(timeout);
        await writeAuditLog(serviceClient, {
          actorUserId: userId, familyId,
          action: 'ai.refusal',
          metadata: { reason: 'guard_double_hit', surface: 'daily_narration' },
        });
        return json({ status: 'tier_a_recommended', reason: 'guard_double_hit', novelReasons: novel.reasons }, 200);
      }
    }
  }

  clearTimeout(timeout);

  // ── Persist + audit + sample ──────────────────────────────────────
  const flagged = layer1Hits.length > 0 || layer2Cosine >= LAYER2_THRESHOLD || guardSkipped;
  const messageId = await writeCache(serviceClient, {
    userId, familyId, scopeKey: body.scopeKey, body: candidate,
    promptTokens, completionTokens, flagged,
  });

  await writeAuditLog(serviceClient, {
    actorUserId: userId, familyId,
    action: 'ai.daily_narration',
    metadata: {
      tier: 'B', model: HAIKU_MODEL,
      prompt_tokens: promptTokens, completion_tokens: completionTokens,
      retries, layer2_max_cosine: layer2Cosine,
      latency_ms: Math.round(firstCall.durationMs),
      prompt_version: SYSTEM_PROMPT_VERSION,
      novel_reasons: novel.reasons,
      surface: 'daily_narration',
    },
  });

  // 10% sample to clinical review queue — DEFERRED for ambient
  // surfaces. The Sprint 12 ai_clinical_review_queue.message_id FK
  // points at ai_messages, but ambient narrations live in
  // ai_narration_cache. A schema extension to allow either-table
  // refs is a Sprint 16 polish item; until then we just track the
  // sample dice-roll in telemetry so cost analysis knows what
  // would have been queued.
  if (messageId && Math.random() < SAMPLE_RATE) {
    console.info(JSON.stringify({
      event: 'clinical_review_skipped_ambient',
      surface: 'daily_narration',
      message_id: messageId,
    }));
  }

  return json({
    status: 'ok',
    body: candidate,
    tier: 'B',
    model: HAIKU_MODEL,
    cached: false,
    messageId,
    guard: { layer1Hits: layer1Hits.length, layer2MaxCosine: layer2Cosine, retries },
  }, 200);
});
