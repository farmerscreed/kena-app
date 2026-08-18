// supabase/functions/ai-tier-b/index.ts — Sprint 12.
//
// Tier-B AI gateway. Mobile callers invoke this for the conversational
// "Ask Leiko" surface (D14 §9). The function:
//
//   1. Validates the user's JWT and looks up family + subscription
//      server-side (mobile claim of Plus is untrusted).
//   2. Enforces Tier-B monthly quota by counting audit_log rows.
//   3. Assembles a non-PHI ScrubbedAiContext from public.users +
//      public.families and runs it through phi-scrub + assertScrubbed.
//   4. Builds the prepended D14 §11 system prompt server-side; user
//      content is wrapped in <user_query> tags for anti-injection.
//   5. Calls Anthropic Messages API (Haiku 4.5) — the LiteLLM gateway
//      is one env var away (LITELLM_BASE_URL); for dev we point
//      directly at api.anthropic.com.
//   6. Runs Layer 1 (regex) and Layer 2 (cosine vs diagnostic cluster)
//      output guards. On any guard hit, retries the LLM call once with
//      an augmented prompt; second hit falls through to DEFER:generic.
//   7. Persists the response to ai_conversations + ai_messages,
//      writes the audit_log row, and 10%-samples to
//      ai_clinical_review_queue per D14 §12.3.
//
// Sprint 12 explicitly does NOT ship the ambient surfaces (Sprint 12.5):
//   * No daily-narration / weekly-summary / monthly-baseline / doctor-
//     prep generation.
//   * Vitals context is passed through but not auto-assembled from the
//     reading store — Sprint 12.5 will lift that.
//   * Quota counters use audit_log row counts; no dedicated table.
//
// Sourced from:
//   docs/_reference/D14-ambient-ai-architecture.md §9, §11, §12, §13, §14, §15
//   docs/_reference/D11-brand-repositioning.md §3 (voice rules)
//   docs/00-tech-stack.md (AI Layer, Compliance)

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  scrubAiContext,
  assertScrubbed,
  type ScrubbedAiContext,
  type AccountType,
} from '../_shared/phi-scrub.ts';
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
  buildUserPrompt,
  detectDefer,
  startOfMonthIso,
  startOfNextMonthIso,
} from './helpers.ts';

// ── Constants ──────────────────────────────────────────────────────────

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 200;
const REQUEST_TIMEOUT_MS = 12_000;
const SAMPLE_RATE = 0.10;
// Layer 2 budget. The Supabase.ai gte-small model can cold-start
// slowly (≥ 30s on local edge runtime first call). When that happens
// we skip Layer 2 for THIS request rather than blow past the mobile
// 12s timeout — Layer 1 + the system prompt still gate the response.
const LAYER2_TIMEOUT_MS = 3_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label}: timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

// D14 §14.1
const FREE_TIER_B_MONTHLY = 5;
const PLUS_TIER_B_MONTHLY = 100;

// ── Types ──────────────────────────────────────────────────────────────

interface RequestBody {
  question: string;
}

interface AiTierBSuccessResponse {
  status: 'ok';
  body: string;
  tier: 'B';
  model: string;
  conversationId: string;
  messageId: string;
  guard: {
    layer1Hits: number;
    layer2MaxCosine: number;
    retries: number;
  };
}

interface AiTierBDeferResponse {
  status: 'defer';
  trigger: string;
  reason: string;
}

interface AiTierBErrorResponse {
  status: 'error';
  error: string;
  detail?: string;
}

interface AiTierBQuotaResponse {
  status: 'quota_exceeded';
  tier: 'B';
  remaining: 0;
  resetsAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface UserDemographics {
  userId: string;
  familyId: string;
  accountType: AccountType;
  preferredLanguage: string;
  parentLabel: string;
  yearOfBirth: number | null;
  residenceCity: string | null;
  isPlus: boolean;
}

async function loadDemographics(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<UserDemographics | { error: string }> {
  // user row + family membership (one membership per user expected at v1.0)
  const { data: userRow, error: userErr } = await serviceClient
    .from('users')
    .select('id, account_type, preferred_language, display_name, year_of_birth')
    .eq('id', userId)
    .maybeSingle();
  if (userErr || !userRow) return { error: 'user_not_found' };

  const { data: membership, error: memberErr } = await serviceClient
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId)
    .is('removed_at', null)
    .order('joined_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (memberErr || !membership) return { error: 'no_family' };
  const familyId = membership.family_id as string;

  const { data: family, error: familyErr } = await serviceClient
    .from('families')
    .select('parent_display_name, parent_year_of_birth, parent_residence, subscription_status')
    .eq('id', familyId)
    .maybeSingle();
  if (familyErr || !family) return { error: 'family_not_found' };

  const accountType = userRow.account_type as AccountType;
  const isPlus =
    family.subscription_status === 'plus' ||
    family.subscription_status === 'plus_trial' ||
    family.subscription_status === 'plus_grace';

  let parentLabel: string;
  let yearOfBirth: number | null;
  let residenceCity: string | null;
  if (accountType === 'caregiver') {
    parentLabel = (family.parent_display_name as string) || 'your parent';
    yearOfBirth = (family.parent_year_of_birth as number | null) ?? null;
    residenceCity = (family.parent_residence as string | null) ?? null;
  } else {
    parentLabel = (userRow.display_name as string) || 'you';
    yearOfBirth = (userRow.year_of_birth as number | null) ?? null;
    residenceCity = null;
  }

  return {
    userId,
    familyId,
    accountType,
    preferredLanguage: (userRow.preferred_language as string) || 'en',
    parentLabel,
    yearOfBirth,
    residenceCity,
    isPlus,
  };
}

async function countMonthTierBCalls(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await serviceClient
    .from('audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('actor_user_id', userId)
    .eq('action', 'ai.user_question')
    .gte('occurred_at', startOfMonthIso());
  if (error) {
    console.error('countMonthTierBCalls error', error);
    return 0;
  }
  return count ?? 0;
}

// ── Anthropic call ─────────────────────────────────────────────────────

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
  const json = (await res.json()) as any;
  const text = (json.content?.[0]?.text as string | undefined) ?? '';
  const usage = json.usage ?? {};
  return {
    body: text,
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
    durationMs: performance.now() - t0,
  };
}

// ── User-prompt builder ────────────────────────────────────────────────

// ── Audit + persistence ────────────────────────────────────────────────

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

async function persistConversation(
  serviceClient: SupabaseClient,
  opts: {
    userId: string;
    familyId: string;
    question: string;
    response: string;
    promptTokens: number;
    completionTokens: number;
    flagged: boolean;
  },
): Promise<{ conversationId: string; messageId: string } | { error: string }> {
  const { data: conv, error: convErr } = await serviceClient
    .from('ai_conversations')
    .insert({
      user_id: opts.userId,
      family_id: opts.familyId,
      context: 'user_question',
    })
    .select('id')
    .single();
  if (convErr || !conv) return { error: 'conversation_insert_failed' };

  const userMsgRes = await serviceClient.from('ai_messages').insert({
    conversation_id: conv.id,
    role: 'user',
    body: opts.question,
  });
  if (userMsgRes.error) return { error: 'user_message_insert_failed' };

  const { data: assistantMsg, error: assistantErr } = await serviceClient
    .from('ai_messages')
    .insert({
      conversation_id: conv.id,
      role: 'assistant',
      body: opts.response,
      tier: 'B',
      model: HAIKU_MODEL,
      prompt_tokens: opts.promptTokens,
      completion_tokens: opts.completionTokens,
      flagged: opts.flagged,
    })
    .select('id')
    .single();
  if (assistantErr || !assistantMsg) return { error: 'assistant_message_insert_failed' };

  return {
    conversationId: conv.id as string,
    messageId: assistantMsg.id as string,
  };
}

async function maybeSampleToReviewQueue(
  serviceClient: SupabaseClient,
  opts: {
    messageId: string;
    familyId: string;
    actorUserId: string;
    scrubbedPrompt: string;
    responseBody: string;
    layer2Cosine: number;
  },
): Promise<void> {
  if (Math.random() >= SAMPLE_RATE) return;
  const { error } = await serviceClient.from('ai_clinical_review_queue').insert({
    message_id: opts.messageId,
    family_id: opts.familyId,
    actor_user_id: opts.actorUserId,
    surface: 'user_question',
    tier: 'B',
    model: HAIKU_MODEL,
    scrubbed_prompt: opts.scrubbedPrompt.slice(0, 8 * 1024),
    response_body: opts.responseBody,
    layer2_cosine: opts.layer2Cosine,
  });
  if (error) console.error('clinical_review_queue insert error', error.message);
}

// ── Main handler ───────────────────────────────────────────────────────

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
    return json(
      { status: 'error', error: 'service_unavailable', detail: 'ANTHROPIC_API_KEY not set' },
      503,
    );
  }
  // LITELLM_BASE_URL is unset in dev → talk directly to Anthropic.
  // When founder stands up the Hetzner gateway, set it; everything
  // downstream is identical because LiteLLM mirrors the Anthropic API.
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
    if (typeof parsed.question !== 'string' || parsed.question.trim().length === 0) {
      return json({ status: 'error', error: 'invalid_question' }, 400);
    }
    if (parsed.question.length > 2000) {
      return json({ status: 'error', error: 'question_too_long' }, 400);
    }
    body = { question: parsed.question };
  } catch {
    return json({ status: 'error', error: 'invalid_json' }, 400);
  }

  const demoOrErr = await loadDemographics(serviceClient, userId);
  if ('error' in demoOrErr) {
    return json({ status: 'error', error: demoOrErr.error }, 400);
  }
  const demo = demoOrErr;

  // ── Quota check (D14 §14.1) ────────────────────────────────────────
  const monthCount = await countMonthTierBCalls(serviceClient, userId);
  const cap = demo.isPlus ? PLUS_TIER_B_MONTHLY : FREE_TIER_B_MONTHLY;
  if (monthCount >= cap) {
    await writeAuditLog(serviceClient, {
      actorUserId: userId,
      familyId: demo.familyId,
      action: 'ai.refusal',
      metadata: {
        reason: 'quota_exceeded',
        tier: 'B',
        cap,
        is_plus: demo.isPlus,
      },
    });
    const resp: AiTierBQuotaResponse = {
      status: 'quota_exceeded',
      tier: 'B',
      remaining: 0,
      resetsAt: startOfNextMonthIso(),
    };
    return json(resp, 200);
  }

  // ── Build context and scrub ────────────────────────────────────────
  // Sprint 12 ships the user-question path; vitals context is NOT
  // auto-assembled from reading data here — that's Sprint 12.5.
  // When AI_TIER_B_PROD_DATA_ENABLED=false we strip the residence too,
  // so dev with synthetic users never leaks ambient identifying info.
  let scrubbed: ScrubbedAiContext;
  try {
    scrubbed = scrubAiContext({
      parentLabel: demo.parentLabel,
      yearOfBirth: allowProdData ? demo.yearOfBirth : null,
      residenceCity: allowProdData ? demo.residenceCity : null,
      accountType: demo.accountType,
    });
    assertScrubbed(scrubbed);
  } catch (err) {
    return json(
      {
        status: 'error',
        error: 'scrub_failed',
        detail: (err as Error).message,
      },
      500,
    );
  }

  const systemPrompt = buildSystemPrompt({
    allowedCardIds: '', // cosine card-matcher lights up in 14.5; for now no citations
    userLanguage: demo.preferredLanguage,
  });

  // ── First LLM call ─────────────────────────────────────────────────
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const userPrompt = buildUserPrompt({ question: body.question, context: scrubbed });

  const firstCall = await callAnthropic({
    systemPrompt,
    userPrompt,
    apiKey: anthropicKey,
    baseUrl,
    signal: controller.signal,
  });
  if ('error' in firstCall) {
    clearTimeout(timeout);
    await writeAuditLog(serviceClient, {
      actorUserId: userId,
      familyId: demo.familyId,
      action: 'ai.refusal',
      metadata: { reason: firstCall.error, detail: firstCall.detail },
    });
    return json(
      { status: 'error', error: firstCall.error, detail: firstCall.detail } satisfies
        AiTierBErrorResponse,
      502,
    );
  }

  let candidate = firstCall.body.trim();
  let promptTokens = firstCall.promptTokens;
  let completionTokens = firstCall.completionTokens;
  let retries = 0;
  let layer1Hits: ForbiddenHit[] = [];
  let layer2Cosine = 0;
  let layer2Matched: string | null = null;

  // ── DEFER short-circuit ────────────────────────────────────────────
  const deferDetect = detectDefer(candidate);
  if (deferDetect.isDefer) {
    clearTimeout(timeout);
    await writeAuditLog(serviceClient, {
      actorUserId: userId,
      familyId: demo.familyId,
      action: 'ai.refusal',
      metadata: {
        trigger: deferDetect.trigger,
        tier: 'B',
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        prompt_version: SYSTEM_PROMPT_VERSION,
      },
    });
    const resp: AiTierBDeferResponse = {
      status: 'defer',
      trigger: deferDetect.trigger,
      reason: 'model_defer',
    };
    return json(resp, 200);
  }

  // ── Layer 1 ────────────────────────────────────────────────────────
  const layer1 = scanLayer1(candidate);
  if (!layer1.passes) {
    layer1Hits = layer1.hits;
    await writeAuditLog(serviceClient, {
      actorUserId: userId,
      familyId: demo.familyId,
      action: 'ai.output_guard_hit',
      metadata: {
        layer: 1,
        rule_ids: Array.from(new Set(layer1.hits.map((h) => h.ruleId))),
        attempt: 1,
      },
    });
    const retryAugment = buildLayer1RetryAugment(layer1.hits);
    const retryPrompt = buildUserPrompt({
      question: body.question,
      context: scrubbed,
      retryAugment,
    });
    retries++;
    const retryCall = await callAnthropic({
      systemPrompt,
      userPrompt: retryPrompt,
      apiKey: anthropicKey,
      baseUrl,
      signal: controller.signal,
    });
    if ('error' in retryCall) {
      clearTimeout(timeout);
      const resp: AiTierBDeferResponse = {
        status: 'defer',
        trigger: 'generic',
        reason: 'guard_retry_failed',
      };
      return json(resp, 200);
    }
    candidate = retryCall.body.trim();
    promptTokens += retryCall.promptTokens;
    completionTokens += retryCall.completionTokens;
    const retryDefer = detectDefer(candidate);
    if (retryDefer.isDefer) {
      clearTimeout(timeout);
      await writeAuditLog(serviceClient, {
        actorUserId: userId,
        familyId: demo.familyId,
        action: 'ai.refusal',
        metadata: { trigger: retryDefer.trigger, tier: 'B', after_retry: true },
      });
      const resp: AiTierBDeferResponse = {
        status: 'defer',
        trigger: retryDefer.trigger,
        reason: 'model_defer',
      };
      return json(resp, 200);
    }
    const layer1Retry = scanLayer1(candidate);
    if (!layer1Retry.passes) {
      // Two consecutive Layer-1 hits → DEFER:generic per D14 §12.1
      clearTimeout(timeout);
      await writeAuditLog(serviceClient, {
        actorUserId: userId,
        familyId: demo.familyId,
        action: 'ai.refusal',
        metadata: {
          reason: 'layer1_double_hit',
          rule_ids: Array.from(new Set(layer1Retry.hits.map((h) => h.ruleId))),
        },
      });
      const resp: AiTierBDeferResponse = {
        status: 'defer',
        trigger: 'generic',
        reason: 'output_guard_double_hit',
      };
      return json(resp, 200);
    }
  }

  // ── Layer 2 ────────────────────────────────────────────────────────
  // Embedder is created once per Edge Function isolate and lazily
  // embeds the diagnostic cluster on first scanLayer2 call.
  // D13 §9.2 — the semantic guard never fails open silently: any skip
  // is audited as ai.output_guard_skipped (now canonical vocabulary,
  // superseding the earlier D14 §15 objection) and the cached output
  // is flagged for the sampling review queue.
  let guardSkipped = false;
  let embedder;
  try {
    embedder = createSupabaseEmbedder();
  } catch (err) {
    console.error('embedder unavailable', (err as Error).message);
    embedder = null;
  }
  if (!embedder) {
    guardSkipped = true;
    await writeAuditLog(serviceClient, {
      actorUserId: userId,
      familyId: demo.familyId,
      action: 'ai.output_guard_skipped',
      metadata: { layer: 2, surface: 'tier_b', cause: 'embedder_unavailable' },
    });
  }

  if (embedder) {
    let layer2;
    try {
      layer2 = await withTimeout(
        scanLayer2(candidate, embedder),
        LAYER2_TIMEOUT_MS,
        'layer2',
      );
    } catch (err) {
      console.warn('layer2 skipped:', (err as Error).message);
      layer2 = null;
      guardSkipped = true;
      await writeAuditLog(serviceClient, {
        actorUserId: userId,
        familyId: demo.familyId,
        action: 'ai.output_guard_skipped',
        metadata: { layer: 2, surface: 'tier_b', cause: 'scan_timeout' },
      });
    }
    if (layer2) {
      layer2Cosine = layer2.maxCosine;
      layer2Matched = layer2.matchedPhrase;
    }
    if (layer2 && !layer2.passes) {
      await writeAuditLog(serviceClient, {
        actorUserId: userId,
        familyId: demo.familyId,
        action: 'ai.output_guard_hit',
        metadata: {
          layer: 2,
          max_cosine: layer2.maxCosine,
          matched_phrase: layer2.matchedPhrase,
          attempt: retries + 1,
        },
      });
      const retryAugment = buildLayer2RetryAugment(layer2.matchedPhrase);
      const retryPrompt = buildUserPrompt({
        question: body.question,
        context: scrubbed,
        retryAugment,
      });
      retries++;
      const retryCall = await callAnthropic({
        systemPrompt,
        userPrompt: retryPrompt,
        apiKey: anthropicKey,
        baseUrl,
        signal: controller.signal,
      });
      if ('error' in retryCall) {
        clearTimeout(timeout);
        const resp: AiTierBDeferResponse = {
          status: 'defer',
          trigger: 'generic',
          reason: 'guard_retry_failed',
        };
        return json(resp, 200);
      }
      candidate = retryCall.body.trim();
      promptTokens += retryCall.promptTokens;
      completionTokens += retryCall.completionTokens;
      const retryDefer = detectDefer(candidate);
      if (retryDefer.isDefer) {
        clearTimeout(timeout);
        const resp: AiTierBDeferResponse = {
          status: 'defer',
          trigger: retryDefer.trigger,
          reason: 'model_defer',
        };
        return json(resp, 200);
      }
      // Re-check both layers on the retried response. §9.2 — the
      // post-retry scan gets the same timeout protection as pre-retry.
      const recheck1 = scanLayer1(candidate);
      let recheck2;
      try {
        recheck2 = await withTimeout(
          scanLayer2(candidate, embedder),
          LAYER2_TIMEOUT_MS,
          'layer2-recheck',
        );
      } catch {
        recheck2 = null;
        guardSkipped = true;
        await writeAuditLog(serviceClient, {
          actorUserId: userId,
          familyId: demo.familyId,
          action: 'ai.output_guard_skipped',
          metadata: { layer: 2, surface: 'tier_b', cause: 'recheck_timeout' },
        });
      }
      if (recheck2) {
        layer2Cosine = recheck2.maxCosine;
        layer2Matched = recheck2.matchedPhrase;
      }
      if (!recheck1.passes || (recheck2 && !recheck2.passes)) {
        clearTimeout(timeout);
        await writeAuditLog(serviceClient, {
          actorUserId: userId,
          familyId: demo.familyId,
          action: 'ai.refusal',
          metadata: {
            reason: 'guard_double_hit',
            layer1_passes: recheck1.passes,
            layer2_passes: recheck2?.passes ?? null,
          },
        });
        const resp: AiTierBDeferResponse = {
          status: 'defer',
          trigger: 'generic',
          reason: 'output_guard_double_hit',
        };
        return json(resp, 200);
      }
    }
  }

  clearTimeout(timeout);

  // ── Persist + audit + sample ──────────────────────────────────────
  const persisted = await persistConversation(serviceClient, {
    userId,
    familyId: demo.familyId,
    question: body.question,
    response: candidate,
    promptTokens,
    completionTokens,
    flagged: layer1Hits.length > 0 || layer2Cosine >= LAYER2_THRESHOLD || guardSkipped,
  });
  if ('error' in persisted) {
    return json({ status: 'error', error: persisted.error }, 500);
  }

  await writeAuditLog(serviceClient, {
    actorUserId: userId,
    familyId: demo.familyId,
    action: 'ai.user_question',
    metadata: {
      tier: 'B',
      model: HAIKU_MODEL,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      surface: 'user_question',
      retries,
      layer2_max_cosine: layer2Cosine,
      latency_ms: Math.round(firstCall.durationMs),
      prompt_version: SYSTEM_PROMPT_VERSION,
    },
  });

  await maybeSampleToReviewQueue(serviceClient, {
    messageId: persisted.messageId,
    familyId: demo.familyId,
    actorUserId: userId,
    scrubbedPrompt: userPrompt,
    responseBody: candidate,
    layer2Cosine,
  });

  const resp: AiTierBSuccessResponse = {
    status: 'ok',
    body: candidate,
    tier: 'B',
    model: HAIKU_MODEL,
    conversationId: persisted.conversationId,
    messageId: persisted.messageId,
    guard: {
      layer1Hits: layer1Hits.length,
      layer2MaxCosine: layer2Cosine,
      retries,
    },
  };
  return json(resp, 200);
});

// Suppress unused-export warning for layer2Matched (kept for future telemetry).
export const _unused = { layer2Matched: null as string | null };
