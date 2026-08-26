import type { Api, FeedEntry, GameConfig, Player, State } from './types';

// ---- operator token (server requires it on mutating /api/* and on /ui-ws) ----
const TOK_KEY = 'brx_mc_tok';
function pickupHashToken() {
  try {
    const m = /(?:^#|[#&])tok=([^&]+)/.exec(location.hash);
    if (m) {
      localStorage.setItem(TOK_KEY, decodeURIComponent(m[1]));
      history.replaceState(null, '', location.pathname + location.search);   // don't leave the token in the URL bar
    }
  } catch { /* no storage / no history: ignore */ }
}
pickupHashToken();
export const getToken = (): string => { try { return localStorage.getItem(TOK_KEY) ?? ''; } catch { return ''; } };
export const setToken = (tok: string) => { try { localStorage.setItem(TOK_KEY, tok.trim()); } catch { /* ignore */ } };

/** Listeners told when the server answers 401 (operator token missing/wrong). */
const authListeners = new Set<(required: boolean) => void>();
export const onAuthRequired = (cb: (required: boolean) => void) => { authListeners.add(cb); return () => { authListeners.delete(cb); }; };
const notifyAuth = (required: boolean) => authListeners.forEach(cb => cb(required));

export class AuthError extends Error { constructor() { super('OPERATOR TOKEN REQUIRED'); } }

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (method !== 'GET') { const t = getToken(); if (t) headers.authorization = `Bearer ${t}`; }
  const r = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  if (r.status === 401) { notifyAuth(true); throw new AuthError(); }
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (method !== 'GET') notifyAuth(false);
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}
const post = <T,>(path: string, body: unknown = {}) => j<T>(path, { method: 'POST', body: JSON.stringify(body) });

/** Real client: REST + `/ui-ws` snapshots with exponential-backoff reconnect. */
export function createHttpApi(): Api {
  return {
    getState: () => j<State>('/api/state'),
    subscribe(onSnapshot, onFeed, onLink) {
      let ws: WebSocket | null = null, closed = false, delay = 500;
      const open = () => {
        if (closed) return;
        let opened = false;
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const tok = getToken();
        ws = new WebSocket(`${proto}://${location.host}/ui-ws${tok ? `?tok=${encodeURIComponent(tok)}` : ''}`);
        ws.onmessage = ev => {
          try {
            const m = JSON.parse(ev.data);
            if (m.kind === 'snapshot') onSnapshot(m.state as State);
            else if (m.kind === 'feed') onFeed(m.entry as FeedEntry);
            else if (m.kind === 'error' && m.code === 401) notifyAuth(true);
          } catch { /* malformed frame: ignore */ }
        };
        ws.onopen = () => { opened = true; delay = 500; onLink?.(true); };
        ws.onclose = ev => {
          onLink?.(false);
          if (ev.code === 4401 || ev.code === 1008) notifyAuth(true);     // server refused the token
          else if (!opened && !closed) {
            // Handshake refused before open (browsers report 1006): if the HTTP API answers, the server is up and
            // the WS refusal was auth — show the token prompt instead of "MC OFFLINE".
            fetch('/api/state', { method: 'GET' }).then(r => { if (r.ok) notifyAuth(true); }).catch(() => { /* really offline */ });
          }
          if (!closed) { setTimeout(open, delay); delay = Math.min(delay * 2, 10000); }
        };
        ws.onerror = () => ws?.close();
      };
      open();
      return () => { closed = true; ws?.close(); };
    },
    scan: (duration_s = 6) => post('/api/armory/scan', { duration_s }),
    armory: () => j('/api/armory'),
    getModes: () => j('/api/modes'),
    getWeapons: () => j('/api/weapons'),
    putConfig: (partial: Partial<GameConfig>) => j('/api/config', { method: 'PUT', body: JSON.stringify(partial) }),
    addPlayer: p => post('/api/players', p),
    patchPlayer: (id, patch: Partial<Player>) => j(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deletePlayer: async id => { await j(`/api/players/${id}`, { method: 'DELETE' }); },
    evictNode: async id => { await j(`/api/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    tryout: async (id, weapon_id) => { await post(`/api/players/${id}/tryout`, { weapon_id }); },
    endTryout: async id => { await j(`/api/players/${id}/tryout`, { method: 'DELETE' }); },
    setReady: (id, ready) => post(`/api/players/${id}/ready`, { ready }),
    pushLobby: () => post('/api/lobby/push'),
    start: runway_s => post('/api/start', { runway_s }),
    reschedule: runway_s => post('/api/start/reschedule', { runway_s }),
    abort: () => post('/api/start/abort'),
    control: (cmd, confirm) => post('/api/control', { cmd, confirm }),
    getRecap: () => j('/api/recap'),
    recapCsvUrl: () => '/api/recap.csv',
    newSession: keep_roster => post('/api/session/new', { keep_roster }),
  };
}
