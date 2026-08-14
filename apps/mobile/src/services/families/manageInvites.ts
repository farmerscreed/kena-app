// services/families/manageInvites — Sprint 10c.1.
//
// Thin wrappers over the /send-family-invite + /accept-family-invite
// Edge Functions. Centralises auth-header passthrough (supabase-js's
// functions.invoke handles it for us) + analytics + error mapping.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '../supabase';
import { logger } from '../analytics/logger';
import type { Database } from '../../types/database';

export interface SendInviteInput {
  inviteeEmail: string;
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

export interface AcceptInviteInput {
  code: string;
  email: string;
  /** Sprint 19 Block 5 — per-caregiver label for the wearer.
   *  Optional; when set, stored on family_members and preferred over
   *  families.parent_relationship for display. Same encoding
   *  convention as families.parent_relationship: 'mother' | 'father'
   *  | 'aunt' | 'uncle' | 'daughter' | 'son' | 'niece' | 'nephew' |
   *  'other' | 'other:<label>'. */
  caregiverRelationshipLabel?: string;
}

export interface AcceptInviteResult {
  familyId: string;
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

export async function sendFamilyInvite(
  input: SendInviteInput,
  client: SupabaseClient<Database> = defaultSupabase,
): Promise<SendInviteResult> {
  logger.track('family_invite_send_started');
  const { data, error } = await client.functions.invoke<SendInviteResult>(
    'send-family-invite',
    { body: input },
  );
  if (error) {
    const reasoned = await withServerReason(error);
    logger.track('family_invite_send_failed', { reason: reasoned.message });
    throw reasoned;
  }
  if (!data?.pairingCode) {
    throw new Error('invalid_response');
  }
  logger.track('family_invite_send_completed');
  return data;
}

export async function acceptFamilyInvite(
  input: AcceptInviteInput,
  client: SupabaseClient<Database> = defaultSupabase,
): Promise<AcceptInviteResult> {
  logger.track('family_invite_accept_started');
  const { data, error } = await client.functions.invoke<AcceptInviteResult>(
    'accept-family-invite',
    { body: input },
  );
  if (error) {
    const reasoned = await withServerReason(error);
    logger.track('family_invite_accept_failed', { reason: reasoned.message });
    throw reasoned;
  }
  if (!data?.familyId) {
    throw new Error('invalid_response');
  }
  logger.track('family_invite_accept_completed', { familyId: data.familyId });
  return data;
}

// ── ADR-0006 caregiver-initiated PENDING invite ──────────────────────

export interface SendCareInviteInput {
  /** Email of the person you want to care for (not yet on Leiko). */
  inviteeEmail: string;
  /** Friendly label for your pending list, e.g. "Mum". */
  inviteeLabel?: string;
}

/** Create a PENDING invite (no circle yet) for someone you want to follow.
 *  Returns a code + url_token to share; resolves when they onboard + pair
 *  and call resolveCareInvite. */
export async function sendCareInvite(
  input: SendCareInviteInput,
  client: SupabaseClient<Database> = defaultSupabase,
): Promise<SendInviteResult> {
  logger.track('care_invite_send_started');
  const { data, error } = await client.functions.invoke<SendInviteResult>(
    'send-care-invite',
    { body: input },
  );
  if (error) {
    const reasoned = await withServerReason(error);
    logger.track('care_invite_send_failed', { reason: reasoned.message });
    throw reasoned;
  }
  if (!data?.pairingCode) throw new Error('invalid_response');
  logger.track('care_invite_send_completed');
  return data;
}

/** WEARER side: resolve a pending care invite after pairing. Attaches the
 *  original inviter as a caregiver of the wearer's circle. */
export async function resolveCareInvite(
  input: { code: string },
  client: SupabaseClient<Database> = defaultSupabase,
): Promise<AcceptInviteResult> {
  logger.track('care_invite_resolve_started');
  const { data, error } = await client.functions.invoke<AcceptInviteResult>(
    'resolve-care-invite',
    { body: input },
  );
  if (error) {
    const reasoned = await withServerReason(error);
    logger.track('care_invite_resolve_failed', { reason: reasoned.message });
    throw reasoned;
  }
  if (!data?.familyId) throw new Error('invalid_response');
  logger.track('care_invite_resolve_completed', { familyId: data.familyId });
  return data;
}

// ── ADR-0007 unified "Connect" ───────────────────────────────────────
// One code; the backend (connect-accept) resolves who-follows-whom from
// who wears a watch. Replaces the four send/accept/resolve functions
// above (kept during the back-compat window).

export interface AcceptConnectResult {
  ok: true;
  familyId: string | null;
  outcome: 'accepter_follows' | 'sharer_follows' | 'pending';
  canFollowBack: boolean;
}

/** Generate a connect code to share. Direction is decided at accept time. */
export async function createConnect(
  input: SendInviteInput,
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
