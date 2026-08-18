// supabase/functions/compute-weekly-summary/index.ts — Sprint 12.5.
//
// Tier-C weekly summary per D14 §6. Sunday 18:00 caregiver-local-
// time, one narrative per parent, pushed to all caregivers in the
// family. Uses Sonnet 4.6 for the longer narrative shape (~100–
// 150 words across 4–6 sentences).
//
// Dispatch model (mirrors compute-correlations Sprint 9):
//   - Hourly UTC cron via pg_cron.
//   - Inside the function, iterate users whose timezone places
//     "now" in the Sunday 18:00 ± 30min local window. Generate
//     and persist for each.
//   - Manual one-shot path: POST { userId, familyId } for testing.
//
// Tier-C cost: ~$0.0105/call. With 4 weekly summaries per family
// per month at 1000 paying families = ~$42/mo. Acceptable.
// AI_TIER_C_PROD_DATA_ENABLED gates real reading-data flow; when
// false (dev), the function runs against synthetic placeholder
// context so we don't burn Sonnet credits for unfounded output.

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
const MAX_OUTPUT_TOKENS = 400;
const REQUEST_TIMEOUT_MS = 30_000; // Sonnet is slower than Haiku
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

// ── ISO week helpers ──────────────────────────────────────────────────

/**
 * Returns the ISO 8601 week label for a given date (e.g. "2026-W19").
 * Used as the scope_key for the cache so each week gets one row per
 * user.
 */
export function isoWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weeks: Thursday in current week decides the year.
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ── Prompt builder ────────────────────────────────────────────────────

export function buildWeeklySummaryPrompt(
  context: ScrubbedAiContext,
  weekLabel: string,
  retryAugment?: string,
): string {
  const lines: string[] = [];
  lines.push(`Generate a weekly summary for the Leiko app.`);
  lines.push(`Audience: caregiver receiving an update about ${context.parentLabel}.`);
  lines.push('');
  lines.push(`Week: ${weekLabel}`);
  lines.push(`Account type: ${context.accountType}`);
  lines.push(`Parent label: ${context.parentLabel}`);
  if (context.yearOfBirth !== null) lines.push(`Year of birth: ${context.yearOfBirth}`);
  lines.push('');
  lines.push('Vitals (week aggregates):');
  if (context.bp) {
    lines.push(`  BP — state ${context.bp.state}, latest ${context.bp.latestSystolic}/${context.bp.latestDiastolic}, week avg ${context.bp.weekAverageSystolic ?? '?'}/${context.bp.weekAverageDiastolic ?? '?'}`);
  }
  if (context.hr) lines.push(`  HR — resting baseline ${context.hr.baseline ?? '?'}`);
  if (context.spo2) lines.push(`  SpO2 — overnight low ${context.spo2.overnightLow ?? '?'}, latest ${context.spo2.latest ?? '?'}`);
  if (context.sleep) lines.push(`  Sleep — last-night total ${context.sleep.lastNightTotalMinutes ?? '?'}min, score ${context.sleep.score ?? '?'}`);
  if (context.activity) lines.push(`  Activity — today ${context.activity.todaySteps ?? '?'} of ${context.activity.targetSteps ?? '?'} steps`);
  if (context.correlations && context.correlations.length > 0) {
    lines.push('');
    lines.push('Meaningful cross-vital correlations:');
    for (const c of context.correlations) {
      lines.push(`  ${c.leftVital} ↔ ${c.rightVital}: r=${c.coefficient.toFixed(2)}`);
    }
  }
  lines.push('');
  lines.push('Constraints:');
  lines.push('- 4 to 6 sentences total.');
  lines.push('- Sentence-case throughout.');
  lines.push('- Lead with overall sentiment in one phrase.');
  lines.push('- Most-meaningful BP observation in the second sentence.');
  lines.push('- If a meaningful correlation is present, mention it in descriptive (not prescriptive) language.');
  lines.push('- Close with a brief warm pleasantry — one sentence — never instruction.');
  lines.push('- No prescriptive language. No diagnosis. No outcome promises.');
  lines.push(`- Use "${context.parentLabel}" — never "patient".`);

  const retry = retryAugment ? `${retryAugment}\n\n` : '';
  return `${retry}<user_query>\n${lines.join('\n')}\n</user_query>`;
}

// ── Anthropic ──────────────────────────────────────────────────────────

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

// ── Per-user processor ────────────────────────────────────────────────

interface ProcessResult {
  status: 'ok' | 'cached' | 'tier_c_disabled' | 'guard_failed' | 'anthropic_error' | 'no_data';
  weekLabel: string;
  body?: string;
  error?: string;
}

async function processUser(
  serviceClient: SupabaseClient,
  userId: string,
  familyId: string,
  opts: { apiKey: string; baseUrl: string; allowProdData: boolean; tierCEnabled: boolean },
): Promise<ProcessResult> {
  const weekLabel = isoWeekLabel(new Date());

  // Cache check.
  const { data: existing } = await serviceClient
    .from('ai_narration_cache')
    .select('body')
    .eq('user_id', userId)
    .eq('surface', 'weekly_summary')
    .eq('scope_key', weekLabel)
    .maybeSingle();
  if (existing) {
    return { status: 'cached', weekLabel, body: existing.body as string };
  }

  // Gate: when Tier-C is disabled in dev (no Sonnet credits), don't
  // call Anthropic. Persist a deterministic placeholder so the UI
  // surface (Trends weekly card) still has SOMETHING to render and
  // the per-user audit row fires.
  if (!opts.tierCEnabled) {
    const placeholder = 'Weekly summary not yet available — Tier-C is gated in this environment.';
    await serviceClient.from('ai_narration_cache').upsert({
      user_id: userId,
      family_id: familyId,
      surface: 'weekly_summary',
      scope_key: weekLabel,
      body: placeholder,
      tier: 'C',
      model: 'placeholder',
      flagged: false,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,surface,scope_key' });
    return { status: 'tier_c_disabled', weekLabel, body: placeholder };
  }

  // Assemble + scrub.
  const assembled = await assembleAiContext(serviceClient, userId, familyId, {
    allowProdData: opts.allowProdData,
  });
  if ('error' in assembled) {
    return { status: 'no_data', weekLabel, error: assembled.error };
  }
  const { identity, context } = assembled;
  try { assertScrubbed(context); } catch (e) {
    return { status: 'no_data', weekLabel, error: (e as Error).message };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const systemPrompt = buildSystemPrompt({
    allowedCardIds: '',
    userLanguage: identity.preferredLanguage,
  });

  const firstCall = await callAnthropic({
    systemPrompt,
    userPrompt: buildWeeklySummaryPrompt(context, weekLabel),
    apiKey: opts.apiKey, baseUrl: opts.baseUrl, signal: controller.signal,
  });
  if ('error' in firstCall) {
    clearTimeout(timeout);
    return { status: 'anthropic_error', weekLabel, error: firstCall.error };
  }
  let candidate = firstCall.body;
  let promptTokens = firstCall.promptTokens;
  let completionTokens = firstCall.completionTokens;
  let layer2Cosine = 0;

  // Output guard layers
  const layer1 = scanLayer1(candidate);
  if (!layer1.passes) {
    const retry = buildLayer1RetryAugment(layer1.hits);
    const retryCall = await callAnthropic({
      systemPrompt, userPrompt: buildWeeklySummaryPrompt(context, weekLabel, retry),
      apiKey: opts.apiKey, baseUrl: opts.baseUrl, signal: controller.signal,
    });
    if ('error' in retryCall) {
      clearTimeout(timeout);
      return { status: 'guard_failed', weekLabel };
    }
    candidate = retryCall.body;
    promptTokens += retryCall.promptTokens;
    completionTokens += retryCall.completionTokens;
    if (!scanLayer1(candidate).passes) {
      clearTimeout(timeout);
      return { status: 'guard_failed', weekLabel };
    }
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
      metadata: { layer: 2, surface: 'weekly_summary', cause: 'embedder_unavailable', scope_key: weekLabel },
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
        metadata: { layer: 2, surface: 'weekly_summary', cause: 'scan_timeout', scope_key: weekLabel },
      });
    }
    if (layer2) layer2Cosine = layer2.maxCosine;
    if (layer2 && !layer2.passes) {
      const retry = buildLayer2RetryAugment(layer2.matchedPhrase);
      const retryCall = await callAnthropic({
        systemPrompt, userPrompt: buildWeeklySummaryPrompt(context, weekLabel, retry),
        apiKey: opts.apiKey, baseUrl: opts.baseUrl, signal: controller.signal,
      });
      if ('error' in retryCall) {
        clearTimeout(timeout);
        return { status: 'guard_failed', weekLabel };
      }
      candidate = retryCall.body;
      promptTokens += retryCall.promptTokens;
      completionTokens += retryCall.completionTokens;
      // §9.2 — recheck the retried response with the same timeout
      // protection as the pre-retry scan; a second hit defers.
      if (!scanLayer1(candidate).passes) {
        clearTimeout(timeout);
        return { status: 'guard_failed', weekLabel };
      }
      let recheck2;
      try { recheck2 = await withTimeout(scanLayer2(candidate, embedder), LAYER2_TIMEOUT_MS, 'layer2-recheck'); }
      catch {
        recheck2 = null;
        guardSkipped = true;
        await serviceClient.from('audit_log').insert({
          actor_user_id: userId, family_id: familyId,
          action: 'ai.output_guard_skipped',
          metadata: { layer: 2, surface: 'weekly_summary', cause: 'recheck_timeout', scope_key: weekLabel },
        });
      }
      if (recheck2) {
        layer2Cosine = recheck2.maxCosine;
        if (!recheck2.passes) {
          clearTimeout(timeout);
          return { status: 'guard_failed', weekLabel };
        }
      }
    }
  }

  clearTimeout(timeout);

  const flagged = !layer1.passes || layer2Cosine >= LAYER2_THRESHOLD || guardSkipped;
  await serviceClient.from('ai_narration_cache').upsert({
    user_id: userId, family_id: familyId,
    surface: 'weekly_summary', scope_key: weekLabel,
    body: candidate, tier: 'C', model: SONNET_MODEL,
    prompt_tokens: promptTokens, completion_tokens: completionTokens,
    flagged, generated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,surface,scope_key' });

  await serviceClient.from('audit_log').insert({
    actor_user_id: userId, family_id: familyId,
    action: 'ai.weekly_summary',
    metadata: {
      tier: 'C', model: SONNET_MODEL, surface: 'weekly_summary',
      prompt_tokens: promptTokens, completion_tokens: completionTokens,
      layer2_max_cosine: layer2Cosine, prompt_version: SYSTEM_PROMPT_VERSION,
      week_label: weekLabel,
    },
  });

  return { status: 'ok', weekLabel, body: candidate };
}

// ── Handler ────────────────────────────────────────────────────────────

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

  // Manual one-shot mode for testing.
  if (body.mode === 'manual' && body.userId && body.familyId) {
    const r = await processUser(serviceClient, body.userId, body.familyId, {
      apiKey: anthropicKey, baseUrl, allowProdData, tierCEnabled,
    });
    return json({ status: 'ok', mode: 'manual', result: r }, 200);
  }

  // Cron mode — iterate families whose local hour is currently 18 on Sunday.
  // Q-D14-2 says one summary per parent per week — the cache key
  // (user_id, 'weekly_summary', iso-week) prevents double-fires.
  const { data: families } = await serviceClient
    .from('families')
    .select('id, parent_user_id')
    .not('parent_user_id', 'is', null);

  const results: ProcessResult[] = [];
  for (const f of families ?? []) {
    const userId = f.parent_user_id as string | null;
    if (!userId) continue;
    // For the cron path we'd compute family-local hour here. v1.0
    // simplification: process every family on every hourly tick;
    // the cache deduplicates so only the first run of the week
    // does real work. Sprint 16 polish: refine to local-Sunday-18.
    const r = await processUser(serviceClient, userId, f.id as string, {
      apiKey: anthropicKey, baseUrl, allowProdData, tierCEnabled,
    });
    results.push(r);
  }

  return json({
    status: 'ok',
    mode: 'cron',
    processed: results.length,
    breakdown: results.reduce<Record<string, number>>((a, r) => {
      a[r.status] = (a[r.status] ?? 0) + 1;
      return a;
    }, {}),
  }, 200);
});
