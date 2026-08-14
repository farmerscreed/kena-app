// Deep-link URL parser — Sprint 15.
//
// Pure-function half of the deep-link system (`./deepLinks.ts` does
// dispatch via the navigation ref, which transitively imports React
// Navigation). Splitting the parser out keeps the test suite runnable
// under the pure Jest project without pulling RN modules in.

export interface ParsedDeepLink {
  category:
    | 'home'
    | 'weekly'
    | 'reading'
    | 'vital'
    | 'settings'
    | 'settings_devices'
    | 'settings_subscription'
    | 'family'
    | 'join'
    | 'unknown';
  readingId?: string;
  vital?: 'bp' | 'hr' | 'spo2' | 'sleep' | 'activity';
  /** Connect — invite acceptance via a shared link.
   *  https://leiko.app/join?code=482913. The code is the whole story:
   *  url_token links were never redeemable (no backend read them) and
   *  the email param died with the accept-time email gate (Phase A). */
  inviteCode?: string;
}

// Minimal query-string parser (URLSearchParams isn't reliably available
// across all RN/Hermes targets). Returns a flat map of decoded params.
function parseQuery(url: string): Record<string, string> {
  const q = url.split('?')[1];
  if (!q) return {};
  const out: Record<string, string> = {};
  for (const pair of q.split('&')) {
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return out;
}

export function parseDeepLink(url: string): ParsedDeepLink {
  const stripped = url
    .replace(/^leiko:\/\//, '')
    .replace(/^https?:\/\/leiko\.app\//, '');
  const [pathRaw] = stripped.split('?');
  const segments = pathRaw.split('/').filter(Boolean);
  const [first, second] = segments;
  switch (first) {
    case 'join': {
      // Invite link — must carry the 6-digit connect code.
      const params = parseQuery(url);
      if (!/^\d{6}$/.test(params.code ?? '')) return { category: 'unknown' };
      return { category: 'join', inviteCode: params.code };
    }
    case 'home':
    case undefined:
      return { category: 'home' };
    case 'weekly':
      return { category: 'weekly' };
    case 'reading':
      return { category: 'reading', readingId: second };
    case 'vital':
      if (
        second === 'bp' ||
        second === 'hr' ||
        second === 'spo2' ||
        second === 'sleep' ||
        second === 'activity'
      ) {
        return { category: 'vital', vital: second };
      }
      return { category: 'unknown' };
    case 'settings':
      if (second === 'devices') return { category: 'settings_devices' };
      if (second === 'subscription') return { category: 'settings_subscription' };
      return { category: 'settings' };
    case 'family':
      return { category: 'family' };
    default:
      return { category: 'unknown' };
  }
}
