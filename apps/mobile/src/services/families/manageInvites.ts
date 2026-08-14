// services/families/manageInvites — ADR-0007 unified Connect.
//
// Thin wrappers over the /connect-create + /connect-accept Edge
// Functions. Centralises auth-header passthrough (supabase-js's
// functions.invoke handles it) + analytics + error mapping. The four
// pre-ADR-0007 wrappers (send/accept-family-invite, send/resolve-care-
// invite) were deleted in Connect Phase B along with their functions.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../supabase';
import { logger } from '../analytics/logger';
import type { Database } from '../../types/database';

export interface SendInviteInput {
  /** Optional since Phase B — when present the backend also emails the
   *  code via Resend. The zero-input Connect sheet sends nothing. */
  inviteeEmail?: string;
  inviteeLabel?: string;
}

export interface SendInviteResult {
  invitationId: string;
  pairingCode: string;
  /** ADR-0006 — url_token for building a shareable deep link, so a
   *  not-yet-installed recipient can be routed through install → accept.
   *  Optional for back-compat with an older edge-function deployment. */
  urlToken?: string;
  expiresAt: string;
  /** Sprint 16.6 FUN-1: true when the server emailed the code via
   *  Resend. False when the Edge Function's RESEND_API_KEY is unset
   *  or the send failed. Callers may surface different copy
   *  ("We emailed Sarah" vs "Share this code with Sarah"). */
  emailSent?: boolean;
}

// supabase-js functions.invoke wraps a non-2xx response in a
// FunctionsHttpError whose `.message` is the generic "Edge Function
// returned a non-2xx status code" — the actual {error: "..."} body lives
// on `.context` (the Response). This reads that body so callers get the
// real reason (e.g. 'invalid_email', 'not_family_owner', 'no_circle_yet').
// Returns a NEW Error whose message is the server error code when found,
// else the original error.
async function withServerReason(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.clone().json()) as { error?: string };
      if (body?.error) return new Error(body.error);
    } catch {
      // body wasn't JSON / already consumed — fall through
    }
  }
  return error instanceof Error ? error : new Error('unknown');
}

// ── ADR-0007 unified "Connect" ───────────────────────────────────────
// One code; the backend (connect-accept) resolves who-follows-whom from
// who wears a watch.

export interface AcceptConnectResult {
  ok: true;
  familyId: string | null;
  outcome: 'accepter_follows' | 'sharer_follows' | 'pending';
  canFollowBack: boolean;
  /** Phase C — present on current backend deploys; lets the client
   *  offer one-tap follow-back via followBackConnect. */
  invitationId?: string;
}

/** Generate a connect code to share. Direction is decided at accept time. */
export async function createConnect(
  input: SendInviteInput = {},
  client: SupabaseClient<Database> = defaultSupabase,
): Promise<SendInviteResult> {
  logger.track('connect_create_started');
  const { data, error } = await client.functions.invoke<SendInviteResult>(
    'connect-create',
    { body: input },
  );
  if (error) {
    const reasoned = await withServerReason(error);
    logger.track('connect_create_failed', { reason: reasoned.message });
    throw reasoned;
  }
  if (!data?.pairingCode) throw new Error('invalid_response');
  logger.track('connect_create_completed');
  return data;
}

/** Accept a connect code. The backend wires the relationship by watch
 *  ownership and returns the outcome (+ canFollowBack when both wear).
 *  Phase A 2026-08-14: `email` dropped — the accept-time email-match
 *  gate is gone (codes are single-use, expiring, rate-limited). */
export async function acceptConnect(
  input: { code: string; caregiverRelationshipLabel?: string },
  client: SupabaseClient<Database> = defaultSupabase,
): Promise<AcceptConnectResult> {
  logger.track('connect_accept_started');
  const { data, error } = await client.functions.invoke<AcceptConnectResult>(
    'connect-accept',
    { body: input },
  );
  if (error) {
    const reasoned = await withServerReason(error);
    logger.track('connect_accept_failed', { reason: reasoned.message });
    throw reasoned;
  }
  if (!data?.outcome) throw new Error('invalid_response');
  logger.track('connect_accept_completed', { outcome: data.outcome });
  return data;
}

/** Phase C — when both parties wear watches, the accepter can grant the
 *  sharer follow access to their own circle with one tap (ADR-0007:
 *  ask, don't auto-mutual). The backend verifies the caller accepted
 *  the named invitation and owns an active watch-circle. */
export async function followBackConnect(
  input: { invitationId: string },
  client: SupabaseClient<Database> = defaultSupabase,
): Promise<{ ok: true; familyId: string }> {
  logger.track('connect_follow_back_started');
  const { data, error } = await client.functions.invoke<{ ok: true; familyId: string }>(
    'connect-follow-back',
    { body: input },
  );
  if (error) {
    const reasoned = await withServerReason(error);
    logger.track('connect_follow_back_failed', { reason: reasoned.message });
    throw reasoned;
  }
  if (!data?.familyId) throw new Error('invalid_response');
  logger.track('connect_follow_back_completed');
  return data;
}
