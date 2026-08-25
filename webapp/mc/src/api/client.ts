import type { Api, FeedEntry, GameConfig, Player, State } from './types';

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}
const post = <T,>(path: string, body: unknown = {}) => j<T>(path, { method: 'POST', body: JSON.stringify(body) });

/** Real client: REST + `/ui-ws` snapshots with exponential-backoff reconnect. */
export function createHttpApi(): Api {
  return {
    getState: () => j<State>('/api/state'),
    subscribe(onSnapshot, onFeed) {
      let ws: WebSocket | null = null, closed = false, delay = 500;
      const open = () => {
        if (closed) return;
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${location.host}/ui-ws`);
        ws.onmessage = ev => {
          try {
            const m = JSON.parse(ev.data);
            if (m.kind === 'snapshot') onSnapshot(m.state as State);
            else if (m.kind === 'feed') onFeed(m.entry as FeedEntry);
          } catch { /* malformed frame: ignore */ }
        };
        ws.onopen = () => { delay = 500; };
        ws.onclose = () => { if (!closed) { setTimeout(open, delay); delay = Math.min(delay * 2, 10000); } };
        ws.onerror = () => ws?.close();
      };
      open();
      return () => { closed = true; ws?.close(); };
    },
    scan: (duration_s = 6) => post('/api/armory/scan', { duration_s }),
    getModes: () => j('/api/modes'),
    getWeapons: () => j('/api/weapons'),
    putConfig: (partial: Partial<GameConfig>) => j('/api/config', { method: 'PUT', body: JSON.stringify(partial) }),
    addPlayer: p => post('/api/players', p),
    patchPlayer: (id, patch: Partial<Player>) => j(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deletePlayer: async id => { await j(`/api/players/${id}`, { method: 'DELETE' }); },
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
