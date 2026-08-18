// supabase/functions/compute-monthly-baseline/index.ts — Sprint 12.5.
//
// Tier-C monthly baseline per D14 §7. First-of-month, one narrative
// per parent. Surfaced as a collapsed card in Trends; NOT pushed
// (Q-D14-2 — push fatigue concern). Used as input context for
// subsequent Tier-B daily-narration prompts.
//
// Same architecture as compute-weekly-summary; smaller deliverable
// because of shared infrastructure. AI_TIER_C_PROD_DATA_ENABLED
// gates real Sonnet calls.

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { assembleAiContext } from '../_shared/vitals-context-assembler.ts';
import {
  buildSystemPrompt,
  SYSTEM_PROMPT_VERSION,
} from '../_shared/system-prompt.ts';
import {
  scanLayer1,
  buildLayer1RetryAugment,
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

const SONNET_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 600; // monthly is longer than weekly
const REQUEST_TIMEOUT_MS = 45_000;
const LAYER2_TIMEOUT_MS = 3_000;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); reject(err); });
  });
}

/** "YYYY-MM" UTC label — the scope_key for monthly baseline cache. */
export function utcMonthLabel(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function buildMonthlyBaselinePrompt(
  context: ScrubbedAiContext,
  monthLabel: string,
  retryAugment?: string,
): string {
  const lines: string[] = [];
  lines.push(`Generate a monthly baseline narrative for ${context.parentLabel}.`);
  lines.push(`Audience: ${context.accountType === 'caregiver' ? 'caregiver' : 'self_buyer'}.`);
  lines.push('');
  lines.push(`Month: ${monthLabel}`);
  lines.push(`Parent label: ${context.parentLabel}`);
  if (context.yearOfBirth !== null) lines.push(`Year of birth: ${context.yearOfBirth}`);
  lines.push('');
  lines.push('Vitals (month aggregates):');
  if (context.bp) lines.push(`  BP — state ${context.bp.state}, latest ${context.bp.latestSystolic}/${context.bp.latestDiastolic}, week avg ${context.bp.weekAverageSystolic ?? '?'}/${context.bp.weekAverageDiastolic ?? '?'}`);
  if (context.hr) lines.push(`  HR — resting baseline ${context.hr.baseline ?? '?'}`);
  if (context.spo2) lines.push(`  SpO2 — overnight low ${context.spo2.overnightLow ?? '?'}, latest ${context.spo2.latest ?? '?'}`);
  if (context.sleep) lines.push(`  Sleep — last-night total ${context.sleep.lastNightTotalMinutes ?? '?'}min`);
  if (context.activity) lines.push(`  Activity — recent steps ${context.activity.todaySteps ?? '?'}/${context.activity.targetSteps ?? '?'}`);
  if (context.correlations && context.correlations.length > 0) {
    lines.push('');
    lines.push('Cross-vital patterns this month:');
    for (const c of context.correlations) {
      lines.push(`  ${c.leftVital} ↔ ${c.rightVital}: r=${c.coefficient.toFixed(2)}`);
    }
  }
  lines.push('');
  lines.push('Constraints (D14 §7.2 structure):');
  lines.push('- 1 short opening line summarising the month.');
  lines.push('- Per-vital baseline lines: BP, HR, SpO2, sleep, activity.');
  lines.push('- One short paragraph on cross-vital patterns (if any).');
  lines.push('- One short month-over-month observation line.');
  lines.push('- One closing line: "This baseline informs the daily and weekly observations."');
  lines.push('- Sentence-case throughout. No prescription, no diagnosis, no outcome promises.');
  lines.push(`- Use "${context.parentLabel}" — never "patient".`);

  const retry = retryAugment ? `${retryAugment}\n\n` : '';
  return `${retry}<user_query>\n${lines.join('\n')}\n</user_query>`;
}

interface AnthropicResult {
  body: string;
  promptTokens: number;
  completionTokens: number;
}

async function callAnthropic(opts: {
  systemPrompt: string;
  userPrompt: string;
  apiKey: string;
  baseUrl: string;
  signal: AbortSignal;
}): Promise<AnthropicResult | { error: string; detail: string }> {
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
        model: SONNET_MODEL,
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
  };
}

async function processUser(
  serviceClient: SupabaseClient,
  userId: string,
  familyId: string,
  opts: { apiKey: string; baseUrl: string; allowProdData: boolean; tierCEnabled: boolean },
): Promise<{ status: string; monthLabel: string; body?: string; error?: string }> {
  const monthLabel = utcMonthLabel();

  const { data: existing } = await serviceClient
    .from('ai_narration_cache').select('body')
    .eq('user_id', userId).eq('surface', 'monthly_baseline').eq('scope_key', monthLabel)
    .maybeSingle();
  if (existing) return { status: 'cached', monthLabel, body: existing.body as string };

  if (!opts.tierCEnabled) {
    const placeholder = 'Monthly baseline not yet available — Tier-C is gated in this environment.';
    await serviceClient.from('ai_narration_cache').upsert({
      user_id: userId, family_id: familyId,
      surface: 'monthly_baseline', scope_key: monthLabel,
      body: placeholder, tier: 'C', model: 'placeholder',
      flagged: false, generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,surface,scope_key' });
    return { status: 'tier_c_disabled', monthLabel, body: placeholder };
  }

  const assembled = await assembleAiContext(serviceClient, userId, familyId, {
    allowProdData: opts.allowProdData,
  });
  if ('error' in assembled) return { status: 'no_data', monthLabel, error: assembled.error };
  const { identity, context } = assembled;
  try { assertScrubbed(context); } catch (e) { return { status: 'no_data', monthLabel, error: (e as Error).message }; }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const systemPrompt = buildSystemPrompt({ allowedCardIds: '', userLanguage: identity.preferredLanguage });

  const firstCall = await callAnthropic({
    systemPrompt,
    userPrompt: buildMonthlyBaselinePrompt(context, monthLabel),
    apiKey: opts.apiKey, baseUrl: opts.baseUrl, signal: controller.signal,
  });
  if ('error' in firstCall) {
    clearTimeout(timeout);
    return { status: 'anthropic_error', monthLabel, error: firstCall.error };
  }
  let candidate = firstCall.body;
  let promptTokens = firstCall.promptTokens;
  let completionTokens = firstCall.completionTokens;
  let layer2Cosine = 0;

  const layer1 = scanLayer1(candidate);
  if (!layer1.passes) {
    const retryCall = await callAnthropic({
      systemPrompt,
      userPrompt: buildMonthlyBaselinePrompt(context, monthLabel, buildLayer1RetryAugment(layer1.hits)),
      apiKey: opts.apiKey, baseUrl: opts.baseUrl, signal: controller.signal,
    });
    if ('error' in retryCall) { clearTimeout(timeout); return { status: 'guard_failed', monthLabel }; }
    candidate = retryCall.body;
    promptTokens += retryCall.promptTokens;
    completionTokens += retryCall.completionTokens;
    if (!scanLayer1(candidate).passes) { clearTimeout(timeout); return { status: 'guard_failed', monthLabel }; }
  }

  // D13 §9.2 — a skipped semantic guard is audited and flags the row.
  let guardSkipped = false;
  let embedder;
  try { embedder = createSupabaseEmbedder(); } catch { embedder = null; }
  if (!embedder) {
    guardSkipped = true;
    await serviceClient.from('audit_log').insert({
      actor_user_id: userId, family_id: familyId,
      action: 'ai.output_guard_skipped',
      metadata: { layer: 2, surface: 'monthly_baseline', cause: 'embedder_unavailable', scope_key: monthLabel },
    });
  }
  if (embedder) {
    let layer2;
    try { layer2 = await withTimeout(scanLayer2(candidate, embedder), LAYER2_TIMEOUT_MS, 'layer2'); }
    catch {
      layer2 = null;
      guardSkipped = true;
      await serviceClient.from('audit_log').insert({
        actor_user_id: userId, family_id: familyId,
        action: 'ai.output_guard_skipped',
        metadata: { layer: 2, surface: 'monthly_baseline', cause: 'scan_timeout', scope_key: monthLabel },
      });
    }
    if (layer2) layer2Cosine = layer2.maxCosine;
    if (layer2 && !layer2.passes) {
      const retryCall = await callAnthropic({
        systemPrompt,
        userPrompt: buildMonthlyBaselinePrompt(context, monthLabel, buildLayer2RetryAugment(layer2.matchedPhrase)),
        apiKey: opts.apiKey, baseUrl: opts.baseUrl, signal: controller.signal,
      });
      if ('error' in retryCall) { clearTimeout(timeout); return { status: 'guard_failed', monthLabel }; }
      candidate = retryCall.body;
      promptTokens += retryCall.promptTokens;
      completionTokens += retryCall.completionTokens;
      // §9.2 — recheck the retried response, timeout-protected.
      if (!scanLayer1(candidate).passes) { clearTimeout(timeout); return { status: 'guard_failed', monthLabel }; }
      let recheck2;
      try { recheck2 = await withTimeout(scanLayer2(candidate, embedder), LAYER2_TIMEOUT_MS, 'layer2-recheck'); }
      catch {
        recheck2 = null;
        guardSkipped = true;
        await serviceClient.from('audit_log').insert({
          actor_user_id: userId, family_id: familyId,
          action: 'ai.output_guard_skipped',
          metadata: { layer: 2, surface: 'monthly_baseline', cause: 'recheck_timeout', scope_key: monthLabel },
        });
      }
      if (recheck2) {
        layer2Cosine = recheck2.maxCosine;
        if (!recheck2.passes) { clearTimeout(timeout); return { status: 'guard_failed', monthLabel }; }
      }
    }
  }

  clearTimeout(timeout);

  const flagged = !layer1.passes || layer2Cosine >= LAYER2_THRESHOLD || guardSkipped;
  await serviceClient.from('ai_narration_cache').upsert({
    user_id: userId, family_id: familyId,
    surface: 'monthly_baseline', scope_key: monthLabel,
    body: candidate, tier: 'C', model: SONNET_MODEL,
    prompt_tokens: promptTokens, completion_tokens: completionTokens,
    flagged, generated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,surface,scope_key' });

  await serviceClient.from('audit_log').insert({
    actor_user_id: userId, family_id: familyId,
    action: 'ai.monthly_baseline',
    metadata: {
      tier: 'C', model: SONNET_MODEL, surface: 'monthly_baseline',
      prompt_tokens: promptTokens, completion_tokens: completionTokens,
      layer2_max_cosine: layer2Cosine, prompt_version: SYSTEM_PROMPT_VERSION,
      month_label: monthLabel,
    },
  });

  return { status: 'ok', monthLabel, body: candidate };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ status: 'error', error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return json({ status: 'error', error: 'service_unavailable' }, 503);
  const baseUrl = Deno.env.get('LITELLM_BASE_URL') || 'https://api.anthropic.com';
  const allowProdData = Deno.env.get('AI_TIER_B_PROD_DATA_ENABLED') === 'true';
  const tierCEnabled = Deno.env.get('AI_TIER_C_PROD_DATA_ENABLED') === 'true';

  const serviceClient = createClient(supabaseUrl, serviceKey);

  let body: { mode?: string; userId?: string; familyId?: string };
  try { body = (await req.json()) as any; } catch { body = {}; }

  if (body.mode === 'manual' && body.userId && body.familyId) {
    const r = await processUser(serviceClient, body.userId, body.familyId, {
      apiKey: anthropicKey, baseUrl, allowProdData, tierCEnabled,
    });
    return json({ status: 'ok', mode: 'manual', result: r }, 200);
  }

  // Cron mode: process all families. Cache key dedupe ensures only
  // the first-of-month run does real work; subsequent days hit cache.
  const { data: families } = await serviceClient
    .from('families').select('id, parent_user_id').not('parent_user_id', 'is', null);

  const results = [];
  for (const f of families ?? []) {
    const userId = f.parent_user_id as string | null;
    if (!userId) continue;
    const r = await processUser(serviceClient, userId, f.id as string, {
      apiKey: anthropicKey, baseUrl, allowProdData, tierCEnabled,
    });
    results.push(r);
  }

  return json({
    status: 'ok', mode: 'cron', processed: results.length,
    breakdown: results.reduce<Record<string, number>>((a, r) => {
      a[r.status] = (a[r.status] ?? 0) + 1;
      return a;
    }, {}),
  }, 200);
});
