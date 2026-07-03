/**
 * Shared Gesture Canvas URLs — extension, companion, relay.
 * Update PUBLIC_* when GitHub Pages + hosted relay are deployed.
 */

export const GC_LOCAL_WS = 'wss://localhost:3000/ws';
export const GC_LOCAL_COMPANION = 'https://localhost:3000/companion/';
export const GC_LOCAL_RELAY_PAGE = 'https://localhost:3000/relay-client.html';

/** GitHub Pages project site — enable Pages on the docs/ folder */
export const GC_PUBLIC_COMPANION = 'https://chandanpai.github.io/Gesture_canvas/companion/';

/** Set when relay is deployed (see relay/standalone-relay.mjs). Empty = local dev only */
export const GC_PUBLIC_WS = '';

export const PARTICIPANT_COLORS = [
  '#facc15',
  '#38bdf8',
  '#f472b6',
  '#4ade80',
  '#fb923c',
  '#a78bfa',
];

export function resolveRelayWs(params, { preferPublic = false } = {}) {
  if (params?.get?.('relay')) return params.get('relay');
  if (preferPublic && GC_PUBLIC_WS) return GC_PUBLIC_WS;
  return GC_LOCAL_WS;
}

export function resolveCompanionBase(params, { preferPublic = false } = {}) {
  if (params?.get?.('companion')) {
    const c = params.get('companion');
    return c.endsWith('/') ? c : `${c}/`;
  }
  if (preferPublic && GC_PUBLIC_COMPANION) return GC_PUBLIC_COMPANION;
  return GC_LOCAL_COMPANION;
}

export function companionUrl(sessionId, params, opts) {
  const base = resolveCompanionBase(params, opts);
  const url = new URL(base);
  if (sessionId) url.searchParams.set('session', sessionId);
  const relay = resolveRelayWs(params, opts);
  if (relay && relay !== GC_LOCAL_WS) url.searchParams.set('relay', relay);
  return url.toString();
}

export function relayPageUrl(sessionId, relayWs = GC_LOCAL_WS) {
  const url = new URL(GC_LOCAL_RELAY_PAGE);
  url.searchParams.set('session', sessionId);
  if (relayWs && relayWs !== GC_LOCAL_WS) url.searchParams.set('relay', relayWs);
  return url.toString();
}
