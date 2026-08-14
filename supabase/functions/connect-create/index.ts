// /connect-create — ADR-0007 unified "Connect with someone".
//
// One symmetric action: the caller generates a code (+ url_token) to share.
// Direction (who watches whom) is NOT decided here — it's resolved at
// accept time by /connect-accept from who actually wears a watch. We only
// record the inviter + their CURRENT self-circle (if they wear a watch),
// as a hint; the accepter side re-derives ownership at accept time so a
// later pairing is reflected.
//
// Replaces send-family-invite + send-care-invite. No family_owner check —
// anyone can offer to connect. invitee email is required (kept for the
// accept-time email-match guard, per ADR-0007).
//
// Voice + data rules: no PHI logged; audit records only email domain.

// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface RequestBody {
  inviteeEmail: string;
  inviteeLabel?: string;
}

interface ResponseShape {
  invitationId: string;
  pairingCode: string;
  urlToken: string;
  expiresAt: string;
  emailSent: boolean;
}

const CODE_RETRY_LIMIT = 6;
const EXPIRY_DAYS = 7;

async function sendInviteEmail(args: {
  toEmail: string;
  code: string;
  inviterDisplayName: string | null;
  inviteeLabel: string | null;
}): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL');
  if (!apiKey || !fromEmail) return false;

  const inviter = args.inviterDisplayName?.trim() || 'Someone on Leiko';
  const greeting = args.inviteeLabel ? `Hi ${args.inviteeLabel},` : 'Hi,';
  const subject = args.inviterDisplayName
    ? `${inviter} wants to connect with you on Leiko`
    : 'You have been invited to connect on Leiko';

  const text = [
    greeting,
    '',
    `${inviter} would like to connect with you on Leiko so you can keep a gentle eye on each other's readings.`,
    '',
    `Your code: ${args.code}`,
    '',
    'Open the Leiko app, go to Settings → Care for another person, and enter this code. New to Leiko? Choose "Someone invited me" during setup. The code works for 7 days.',
    '',
    "If you weren't expecting this, you can ignore the email.",
    '',
    '— The Leiko team',
  ].join('\n');

  const safeInviter = inviter.replace(/[<>&]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;',
  );
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1A1A1A;">
      <p>${greeting}</p>
      <p><strong>${safeInviter}</strong> would like to connect with you on Leiko so you can keep a gentle eye on each other's readings.</p>
      <p style="margin: 32px 0; padding: 16px 24px; background: #FAF6F0; border-radius: 12px; text-align: center;">
        <span style="font-size: 14px; color: #6B6B6B; display: block;">Your code</span>
        <span style="font-size: 32px; letter-spacing: 4px; font-weight: 600; color: #1A1A1A;">${args.code}</span>
      </p>
      <p>Open the Leiko app, go to <strong>Settings → Care for another person</strong>, and enter this code. New to Leiko? Choose <strong>Someone invited me</strong> during setup. The code works for 7 days.</p>
      <p style="color: #6B6B6B; font-size: 14px;">If you weren't expecting this, you can ignore the email.</p>
      <p style="color: #6B6B6B; font-size: 14px;">— The Leiko team</p>
    </div>
  `.trim();

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: args.toEmail, subject, text, html }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generateCode(): string {
  return Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
}

// The caller "wears a watch" when they own a self-circle (parent_user_id =
// them) that has an active device. Returns that family_id, else null.
async function callerWatchCircle(
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
  const userId = userData.user.id;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const inviteeEmail = (body?.inviteeEmail ?? '').trim();
  if (!inviteeEmail || !inviteeEmail.includes('@')) {
    return json({ error: 'invalid_email' }, 400);
  }
  const inviteeLabel = (body?.inviteeLabel ?? '').trim() || null;

  const serviceClient: SupabaseClient = createClient(supabaseUrl, serviceKey);

  // Record the caller's watch-circle (if any) as the invite's family_id.
  // NULL when the caller has no watch yet — direction is still resolved at
  // accept time, so this is only a hint/optimisation.
  const watchCircle = await callerWatchCircle(serviceClient, userId);

  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  for (let attempt = 0; attempt < CODE_RETRY_LIMIT; attempt += 1) {
    const code = generateCode();
    const insertResult = await serviceClient
      .from('invitations')
      .insert({
        family_id: watchCircle, // nullable per migration 0029
        invited_by: userId,
        kind: 'parent_pairing', // single connect kind; direction is data-driven
        invitee_label: inviteeLabel,
        invitee_email: inviteeEmail,
        pairing_code: code,
        expires_at: expiresAt,
      })
      .select('id, url_token')
      .single();

    if (insertResult.error) {
      if ((insertResult.error as any).code === '23505') continue; // code collision
      return json({ error: 'invite_insert_failed', detail: insertResult.error.message }, 500);
    }

    let inviterName: string | null = null;
    const { data: inviter } = await serviceClient
      .from('users')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();
    inviterName = (inviter?.display_name as string | undefined) ?? null;

    // Phase A: email_attempted previously hard-coded true even when the
    // Resend env vars were unset (sendInviteEmail bails early). Report
    // what actually happened.
    const emailConfigured = Boolean(
      Deno.env.get('RESEND_API_KEY') && Deno.env.get('RESEND_FROM_EMAIL'),
    );
    const emailSent = await sendInviteEmail({
      toEmail: inviteeEmail,
      code,
      inviterDisplayName: inviterName,
      inviteeLabel,
    });

    try {
      await serviceClient.from('audit_log').insert({
        actor_user_id: userId,
        family_id: watchCircle,
        action: 'connect.created',
        metadata: {
          invitee_email_domain: inviteeEmail.split('@')[1] ?? null,
          has_label: inviteeLabel !== null,
          caller_wears_watch: watchCircle !== null,
          email_attempted: emailConfigured,
          email_sent: emailSent,
        },
      });
    } catch {
      // ignore
    }

    const resp: ResponseShape = {
      invitationId: insertResult.data.id as string,
      pairingCode: code,
      urlToken: insertResult.data.url_token as string,
      expiresAt,
      emailSent,
    };
    return json(resp, 200);
  }

  return json({ error: 'code_collision_retry_exhausted' }, 503);
});
