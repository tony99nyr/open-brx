import type { Api, FeedEntry, GameConfig, OperatorActionResult, Player, ReportResult, State } from './types';

// ---- operator token (server requires it on mutating /api/* and on /ui-ws) ----
const TOK_KEY = 'brx_mc_tok';
function pickupHashToken() {
  try {
    const m = /(?:^#|[#&])tok=([^&]+)/.exec(location.hash);
    if (m) {
      localStorage.setItem(TOK_KEY, decodeURIComponent(m[1]));
      // Strip ONLY the token, keeping any other hash: the hash also carries the current view now, and
      // wiping it wholesale sent every refresh back to the phase screen.
      const rest = location.hash.replace(/(?:^#|&)tok=[^&]*/, '').replace(/^[#&]+/, '');
      history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
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
    let msg = r.statusText, body: unknown;
    try { body = await r.json(); msg = (body as { error?: string }).error ?? msg; } catch { /* not JSON: the status line is all there is */ }
    const err = new Error(msg) as Error & { status?: number; body?: unknown };
    err.status = r.status;   // callers can tell a 404 (route missing) from a 400
    err.body = body;         // A27: the 409 from POST /api/phase carries `not_ready` — the operator needs the LIST, not just the sentence
    throw err;
  }
  if (method !== 'GET') notifyAuth(false);
  if (r.status === 204) return {} as T;   // NEVER `undefined`: callers read undefined as "the call failed" (`store.run`), so a 204 must not look like one
  return (await r.json()) as T;
}
const post = <T,>(path: string, body: unknown = {}) => j<T>(path, { method: 'POST', body: JSON.stringify(body) });

/** Real client: REST + `/ui-ws` snapshots with exponential-backoff reconnect. */
/** A 404 from a route this UI needs is version skew — but ONLY when it is the ROUTE that is missing.
 *  The handler's own 404 ("no such player", the second tap of a double-tap after the first one parked
 *  them) comes back as JSON with an `error` field and is the server's own words; Starlette's missing-route
 *  404 is a plain "Not Found" with no JSON error. Review 2026-09-12: the first cut turned every 404 into
 *  the RESTART banner, so a double-tap told the operator to restart a server that was fine. */
export function skewOr404(e: unknown): never {
  const err = e as Error & { status?: number; body?: unknown };
  const serverSaid = typeof (err?.body as { error?: unknown } | undefined)?.error === 'string';
  if (err?.status === 404 && !serverSaid) {
    const skew = new Error('THE MC SERVER PREDATES THIS UI (no standby route) — RESTART IT: python -m brx_mcp.mc') as Error & { status?: number };
    skew.status = 404;
    throw skew;
  }
  throw e;
}

/** `POST /api/report` on a server that predates the route: a plain 404 (route missing) or a 405
 *  (Starlette's answer when a path exists for another method). Unlike `skewOr404`, there is no
 *  legitimate handler refusal to protect here — this route never rejects with its own 404/405 — so
 *  both statuses are read the same way, in the operator's own words. */
function reportSkewOr404(e: unknown): never {
  const err = e as Error & { status?: number };
  if (err?.status === 404 || err?.status === 405) {
    const skew = new Error('This Mission Control is too old to make reports: update it with ./start.sh') as Error & { status?: number };
    skew.status = err.status;
    throw skew;
  }
  throw e;
}

/** Download a file the server gates the same way as any other operator call (`Authorization: Bearer`),
 *  which a plain `<a href>` cannot send. Fetch → blob → object URL → a real, attached `<a download>`
 *  (Safari/Firefox cancel a download from a detached anchor whose object URL is revoked synchronously). */
export async function downloadWithAuth(url: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const tok = getToken();
  if (tok) headers.authorization = `Bearer ${tok}`;
  const r = await fetch(url, { headers });
  if (r.status === 401) { notifyAuth(true); throw new AuthError(); }
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const blob = await r.blob();
  const obj = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = obj; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(obj); }, 1000);
}

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
    setPhase: (phase: string, force?: boolean) => post('/api/phase', force ? { phase, force: true } : { phase }),
    getModes: () => j('/api/modes'),
    getVoices: () => j('/api/voices'),
    getWeapons: () => j('/api/weapons'),
    getPerks: () => j('/api/perks'),
    getPresets: () => j('/api/presets'),
    savePreset: p => post('/api/presets', p),
    deletePreset: async id => { await j(`/api/presets/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    applyPreset: id => post(`/api/presets/${encodeURIComponent(id)}/apply`),
    updatePreset: (id, p) => j(`/api/presets/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(p) }),
    previewPool: (loadout_policy, mode) => post('/api/loadout/pool', { loadout_policy, mode }),
    getPresentation: () => j('/api/presentation'),
    putConfig: (partial: Partial<GameConfig>) => j('/api/config', { method: 'PUT', body: JSON.stringify(partial) }),
    addPlayer: p => post('/api/players', p),
    patchPlayer: (id, patch: Partial<Player>) => j(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deletePlayer: async id => { await j(`/api/players/${id}`, { method: 'DELETE' }); },
    // STANDBY: a 404 here is the ROUTE missing (an MC older than 2026-09-12), not the player — say so in the
    // strip, in the words the command bar uses for the same condition, instead of a bare "Not Found".
    standbyPlayer: id => j<Player>(`/api/players/${id}/standby`, { method: 'POST' }).catch(skewOr404),
    reinstatePlayer: id => j<Player>(`/api/players/${id}/standby`, { method: 'DELETE' }).catch(skewOr404),
    evictNode: async id => { await j(`/api/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    getOptions: () => j('/api/options'),
    setOptions: opts => j('/api/options', { method: 'PUT', body: JSON.stringify(opts) }),
    pullLog: id => post(`/api/nodes/${encodeURIComponent(id)}/pull_log`),
    setTunnel: on => post('/api/tunnel', { on }),
    getPowerups: () => j('/api/powerups'),
    resetStation: id => post<{ ok?: boolean }>(`/api/stations/${encodeURIComponent(id)}/reset`).catch((e: Error & { status?: number; body?: unknown }) => {
      // a route-less 404 is an OLD server; a 404 carrying the server's own `error` is its words (as `skewOr404`)
      if (e?.status === 404 && typeof (e.body as { error?: unknown } | undefined)?.error !== 'string') {
        throw Object.assign(new Error('THE MC SERVER PREDATES THIS UI (no station reset route). RESTART IT: python -m brx_mcp.mc'), { status: 404 });
      }
      throw e;
    }),
    putStation: (id, a) => j(`/api/stations/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(a) }),
    deleteStation: async id => { await j(`/api/stations/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    armStations: () => post('/api/stations/arm'),
    releaseStation: id => post(`/api/stations/${encodeURIComponent(id)}/release`),
    tryout: async (id, weapon_id) => { await post(`/api/players/${id}/tryout`, { weapon_id }); },
    rangeVerdicts: () => j('/api/range/verdicts'),
    rangeVerdict: (weapon_id, verdict, note) => post('/api/range/verdict', { weapon_id, verdict, note }),
    endTryout: async id => { await j(`/api/players/${id}/tryout`, { method: 'DELETE' }); },
    setReady: (id, ready) => post(`/api/players/${id}/ready`, { ready }),
    readyAll: () => post('/api/lobby/ready_all'),
    // LOAD: tell the phones which game is loaded. NO frames, NO head, no gun write (state.py
    // `load_game`). Deliberately a different route from the push below — that one configures guns.
    loadGame: () => post('/api/games/load', {}),
    pushLobby: (force?: boolean) => post('/api/lobby/push', { force: !!force }),
    start: (runway_s, force) => post('/api/start', { runway_s, force: !!force }),
    reschedule: runway_s => post('/api/start/reschedule', { runway_s }),
    abort: () => post('/api/start/abort'),
    control: (cmd, confirm) => post('/api/control', { cmd, confirm }),
    operatorAction: (id, cmd, match_id) => post<OperatorActionResult>(`/api/players/${encodeURIComponent(id)}/operator`, { cmd, match_id })
      .catch((e: Error & { status?: number; body?: unknown }) => {
        // a route-less 404 is an OLD server; a 404 carrying the server's own `error` is its words (as `skewOr404`)
        if (e?.status === 404 && typeof (e.body as { error?: unknown } | undefined)?.error !== 'string') {
          throw Object.assign(new Error('THE MC SERVER PREDATES THIS UI (no operator route). RESTART IT: python -m brx_mcp.mc'), { status: 404 });
        }
        throw e;
      }),
    getRecap: () => j('/api/recap'),
    matchHistory: () => j('/api/matches'),
    recapCsvUrl: () => '/api/recap.csv',
    matchCsvUrl: (match_id: string) => `/api/matches/${encodeURIComponent(match_id)}.csv`,
    newSession: keep_roster => post('/api/session/new', { keep_roster }),
    // An MC started before 2026-09-16 has no such route: say so. (The command bar's own NEW SESSION
    // control left on 2026-09-17 — LOAD after a match, or RECAP's NEXT MATCH ▸, already cover it — so
    // a restart is the only fallback worth naming here.)
    nextMatch: () => post<State>('/api/match/next', {}).catch((e: Error & { status?: number }) => {
      if (e?.status === 404) throw new Error('THIS MC PREDATES NEXT MATCH: RESTART IT (python -m brx_mcp.mc)');
      throw e;
    }),
    resumeOrphan: match_id => post<State>('/api/match/orphan/resume', { match_id }),
    endOrphan: match_id => post<State>('/api/match/orphan/end', { match_id }),
    makeReport: () => post<ReportResult>('/api/report').catch(reportSkewOr404),
  };
}
