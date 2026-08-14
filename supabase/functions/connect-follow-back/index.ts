// /connect-follow-back — Connect Phase C (ADR-0007 "ask, don't
// auto-mutual").
//
// When BOTH parties wear watches, connect-accept wires accepter→follows→
// sharer and flags canFollowBack. This function is the one-tap other
// half: the ACCEPTER (who owns their own circle and is consenting as its
// wearer) grants the sharer follow access to it. No second code dance.
//
// Guards: the caller must be the accepter of the named invitation (so a
// third party can't use someone else's invitationId), and must own an
// active watch-circle to grant access to.
//
// Voice + data rules: no PHI logged.

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface RequestBody {
  invitationId: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Same shape as connect-accept: the user's active watch-circle
// (self-circle with a paired device), or null.
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
  const callerId = userData.user.id;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const invitationId = (body?.invitationId ?? '').trim();
  if (!invitationId) return json({ error: 'invalid_invitation_id' }, 400);

  const serviceClient: SupabaseClient = createClient(supabaseUrl, serviceKey);

  const { data: invitation, error: lookupErr } = await serviceClient
    .from('invitations')
    .select('id, invited_by, accepted_at, accepted_by, cancelled_at')
    .eq('id', invitationId)
    .maybeSingle();
  if (lookupErr) return json({ error: 'lookup_failed', detail: lookupErr.message }, 500);
  if (!invitation || invitation.cancelled_at) {
    return json({ error: 'invitation_not_found' }, 404);
  }
  // Only the person who accepted this invite may follow back from it.
  if (!invitation.accepted_at || invitation.accepted_by !== callerId) {
    return json({ error: 'not_accepter' }, 403);
  }

  const sharerId = invitation.invited_by as string;
  const callerCircle = await watchCircleOf(serviceClient, callerId);
  if (!callerCircle) return json({ error: 'no_circle_yet' }, 409);

  // Grant the sharer follow access to the caller's circle. Mirrors
  // connect-accept's addFollower: resurrect a removed row, never
  // disturb an active one.
  const { data: existing } = await serviceClient
    .from('family_members')
    .select('user_id, removed_at')
    .eq('family_id', callerCircle)
    .eq('user_id', sharerId)
    .maybeSingle();
  if (!existing || existing.removed_at !== null) {
    const up = await serviceClient.from('family_members').upsert(
      {
        family_id: callerCircle,
        user_id: sharerId,
        role: 'caregiver',
        invited_by: callerId,
        joined_at: new Date().toISOString(),
        removed_at: null,
        removed_reason: null,
      },
      { onConflict: 'family_id,user_id' },
    );
    if (up.error) return json({ error: 'membership_insert_failed', detail: up.error.message }, 500);
  }

  try {
    await serviceClient.from('audit_log').insert({
      actor_user_id: callerId,
      family_id: callerCircle,
      action: 'connect.follow_back',
      metadata: { invitation_id: invitation.id },
    });
  } catch {
    // ignore
  }

  return json({ ok: true, familyId: callerCircle }, 200);
});
