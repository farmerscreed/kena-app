// /connect-accept — ADR-0007 unified connect, accepter side.
//
// The accepter enters the code. We resolve DIRECTION from who actually
// wears a watch:
//
//   sharer wears, accepter doesn't  -> accepter follows sharer
//   accepter wears, sharer doesn't  -> sharer follows accepter
//   both wear                       -> accepter follows sharer now;
//                                      response flags canFollowBack so the
//                                      sharer can be OFFERED follow-back
//                                      (NOT auto-mutual, per ADR-0007)
//   neither wears                   -> pending: the accepter is recorded
//                                      on the invite (consuming the code)
//                                      and the connect completes in the DB
//                                      the moment either party pairs — see
//                                      resolve_pending_connects_on_pairing
//                                      (migration 0051)
//
// "Following" = a caregiver family_members row on the WEARER's circle.
// The wearer's existing per-vital visibility controls are unchanged.
//
// Connect Phase A (founder decision 2026-08-14): the email-match gate is
// DROPPED — it compared a typed email against the invite, not the
// authenticated user, and its usability cost (typo lockouts, wrong-prefill
// silent 403s) outweighed its value. Codes are single-use, expire in
// 7 days, and guesses are rate-limited per authenticated user via
// invite_accept_attempts.
//
// Replaces accept-family-invite + resolve-care-invite.
// Voice + data rules: no PHI logged.

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface RequestBody {
  code: string;
  /** Ignored since Phase A (gate dropped); optional for back-compat with
   *  clients that still send it. */
  email?: string;
  /** Optional per-relationship label the accepter sets for the wearer. */
  caregiverRelationshipLabel?: string;
}

interface ResponseShape {
  ok: true;
  /** The circle that now has a new follower (the wearer's circle), or null
   *  when the connection is still pending (neither party wears a watch). */
  familyId: string | null;
  /** 'accepter_follows' | 'sharer_follows' | 'pending'. */
  outcome: 'accepter_follows' | 'sharer_follows' | 'pending';
  /** True when BOTH wear watches and the sharer may be offered follow-back. */
  canFollowBack: boolean;
}

// Code-guess rate limit: failures per authenticated user per window.
// Generous for a human retyping a smudged code; hostile to enumeration
// of the 6-digit keyspace.
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
const ATTEMPT_MAX_FAILURES = 10;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Returns the user's active watch-circle id (self-circle with a paired
// device), or null if they don't wear a watch yet.
async function watchCircleOf(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: fams } = await serviceClient
    .from('families')
    .select('id')
    .eq('parent_user_id', userId);
  const ids = (fams ?? []).map((f) => f.id as string);
  if (ids.length === 0) return null;
  const { data: dev } = await serviceClient
    .from('devices')
    .select('family_id')
    .in('family_id', ids)
    .is('unpaired_at', null)
    .limit(1)
    .maybeSingle();
  return dev ? (dev.family_id as string) : null;
}

// Add `follower` as a caregiver of `circleId` (idempotent — skips if
// already an active member). `inviterId` is the OTHER party — real
// attribution, not the legacy self-attribution. Optional label.
async function addFollower(
  serviceClient: SupabaseClient,
  circleId: string,
  followerId: string,
  inviterId: string,
  label?: string,
): Promise<string | null> {
  const { data: existing } = await serviceClient
    .from('family_members')
    .select('user_id, removed_at')
    .eq('family_id', circleId)
    .eq('user_id', followerId)
    .maybeSingle();
  if (existing && existing.removed_at === null) return null; // already in
  const row: Record<string, unknown> = {
    family_id: circleId,
    user_id: followerId,
    role: 'caregiver',
    invited_by: inviterId,
    joined_at: new Date().toISOString(),
    removed_at: null,
    removed_reason: null,
  };
  if (label && label.length > 0) row.caregiver_relationship_label = label;
  const up = await serviceClient
    .from('family_members')
    .upsert(row, { onConflict: 'family_id,user_id' });
  return up.error ? up.error.message : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
  const accepterId = userData.user.id;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const code = (body?.code ?? '').trim();
  const label = (body?.caregiverRelationshipLabel ?? '').trim();
  if (!/^\d{6}$/.test(code)) return json({ error: 'invalid_code' }, 400);

  const serviceClient: SupabaseClient = createClient(supabaseUrl, serviceKey);

  // Rate limit BEFORE the lookup so lockout can't be probed around.
  const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  const { count: recentFailures } = await serviceClient
    .from('invite_accept_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', accepterId)
    .gte('attempted_at', windowStart);
  if ((recentFailures ?? 0) >= ATTEMPT_MAX_FAILURES) {
    return json({ error: 'too_many_attempts' }, 429);
  }

  // A failed code probe costs one attempt; a valid accept costs none.
  const recordFailure = async () => {
    try {
      await serviceClient.from('invite_accept_attempts').insert({ user_id: accepterId });
    } catch {
      // Best-effort — never block the real error response on this.
    }
  };

  // Look up the invite by code (connect uses kind 'parent_pairing'; also
  // accept legacy 'caregiver' rows during the back-compat window).
  const { data: invitation, error: lookupErr } = await serviceClient
    .from('invitations')
    .select(
      'id, invited_by, family_id, expires_at, accepted_at, cancelled_at, pending_accepted_by',
    )
    .eq('pairing_code', code)
    .maybeSingle();

  if (lookupErr) return json({ error: 'lookup_failed', detail: lookupErr.message }, 500);
  if (!invitation) {
    await recordFailure();
    return json({ error: 'invitation_not_found' }, 404);
  }
  if (invitation.cancelled_at) {
    await recordFailure();
    return json({ error: 'invitation_cancelled' }, 410);
  }
  if (invitation.accepted_at) {
    await recordFailure();
    return json({ error: 'invitation_already_accepted' }, 409);
  }
  // A pending accept consumed the code for everyone but its own accepter
  // (whose retry stays idempotent).
  if (
    invitation.pending_accepted_by &&
    invitation.pending_accepted_by !== accepterId
  ) {
    await recordFailure();
    return json({ error: 'invitation_already_accepted' }, 409);
  }
  if (
    invitation.expires_at &&
    new Date(invitation.expires_at as string).getTime() < Date.now()
  ) {
    await recordFailure();
    return json({ error: 'invitation_expired' }, 410);
  }

  const sharerId = invitation.invited_by as string;
  if (sharerId === accepterId) return json({ error: 'self_invite' }, 400);

  // Resolve direction from CURRENT watch ownership (re-derived, not trusting
  // the stored family_id — either party may have paired since creation).
  const sharerCircle = await watchCircleOf(serviceClient, sharerId);
  const accepterCircle = await watchCircleOf(serviceClient, accepterId);

  let outcome: ResponseShape['outcome'] = 'pending';
  let familyId: string | null = null;
  let canFollowBack = false;

  if (sharerCircle && !accepterCircle) {
    // Sharer wears, accepter doesn't -> accepter follows sharer.
    const err = await addFollower(serviceClient, sharerCircle, accepterId, sharerId, label);
    if (err) return json({ error: 'membership_insert_failed', detail: err }, 500);
    outcome = 'accepter_follows';
    familyId = sharerCircle;
  } else if (!sharerCircle && accepterCircle) {
    // Accepter wears, sharer doesn't -> sharer follows accepter.
    const err = await addFollower(serviceClient, accepterCircle, sharerId, accepterId);
    if (err) return json({ error: 'membership_insert_failed', detail: err }, 500);
    outcome = 'sharer_follows';
    familyId = accepterCircle;
  } else if (sharerCircle && accepterCircle) {
    // Both wear -> accepter follows sharer now; offer follow-back (ADR-0007:
    // ask, don't auto-mutual). The sharer's follow-back is a separate
    // explicit action (a second connect/accept or an in-app prompt).
    const err = await addFollower(serviceClient, sharerCircle, accepterId, sharerId, label);
    if (err) return json({ error: 'membership_insert_failed', detail: err }, 500);
    outcome = 'accepter_follows';
    familyId = sharerCircle;
    canFollowBack = true;
  }

  if (outcome === 'pending') {
    // Neither wears a watch yet. Record the accepter on the invite so
    // (a) the code is consumed — no other account can claim it — and
    // (b) the devices trigger (migration 0051) completes the connect the
    // moment either party pairs. Whoever pairs first becomes the wearer.
    const upd = await serviceClient
      .from('invitations')
      .update({
        pending_accepted_by: accepterId,
        pending_accepted_at: new Date().toISOString(),
        pending_relationship_label: label || null,
      })
      .eq('id', invitation.id)
      .is('accepted_at', null);
    if (upd.error) {
      return json({ error: 'pending_record_failed', detail: upd.error.message }, 500);
    }
  } else {
    const upd = await serviceClient
      .from('invitations')
      .update({
        family_id: familyId,
        accepted_at: new Date().toISOString(),
        accepted_by: accepterId,
      })
      .eq('id', invitation.id);
    if (upd.error) {
      // Soft failure — membership exists; don't 500.
    }
  }

  try {
    await serviceClient.from('audit_log').insert({
      actor_user_id: accepterId,
      family_id: familyId,
      action: 'connect.accepted',
      metadata: { invitation_id: invitation.id, outcome, can_follow_back: canFollowBack },
    });
  } catch {
    // ignore
  }

  const resp: ResponseShape = { ok: true, familyId, outcome, canFollowBack };
  return json(resp, 200);
});
