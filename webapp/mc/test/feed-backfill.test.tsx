// Integration pass 2026-09-23: a console opened (or reloaded) mid-match showed "WAITING FOR THE FIRST SYNC POINT"
// while the server's snapshot already carried the match's feed. The store only ever appended live `feed` pushes;
// the snapshot's `feed` (newest first, the same order the store keeps) now seeds it.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider, useStore } from '../src/store';
import { mount } from './harness';

const FEED = [{ t_match_s: 42, text: 'VIPER killed GHOST', kind: 'kill' }, { t_match_s: 10, text: 'FIRST BLOOD', kind: 'alert' }];
const LIVE = { session_id: 's1', phase: 'live', t: 1, live: { match_id: 'm1' }, game: { loaded: true, sent: 2, total: 2 }, feed: FEED };

class FakeSocket {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ kind: 'snapshot', state: LIVE }) }); }, 0); }
  close() {}
  send() {}
}

function Probe() {
  const { feed } = useStore();
  return <span data-probe data-feed={feed.map(e => e.text).join('|')} />;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the live event feed on a console opened mid-match', () => {
  it('shows the history the snapshot carries, newest first', async () => {
    history.replaceState(null, '', '/');
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, status: 200, statusText: 'OK', json: async () => (path === '/api/state' ? LIVE : []) } as Response)));
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(m.find('[data-probe]')[0].getAttribute('data-feed')).toBe('VIPER killed GHOST|FIRST BLOOD');
  });
});

// MC visual QA 2026-09-23: a tab left open across an MC restart kept the dead process's feed, and never
// showed the new process's "MC RESTARTED" line that every freshly loaded tab shows. The same match id
// comes back (the match resumed), so the old "seed only an empty feed" rule kept the stale list.
describe('the live event feed on a tab that reconnects', () => {
  it('is replaced by the new snapshot feed after the socket reopens', async () => {
    history.replaceState(null, '', '/');
    const RESTARTED = [{ t_match_s: 50, text: 'MC RESTARTED. RESUMED THE MATCH IN PLAY', kind: 'alert' }];
    const sockets: ReconnectSocket[] = [];
    class ReconnectSocket {
      onmessage: ((ev: { data: string }) => void) | null = null;
      onopen: (() => void) | null = null;
      onclose: ((ev: { code: number }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        sockets.push(this);
        // the first connection is the old process; the second is the NEW one: the same match, its own feed
        const state = sockets.length === 1 ? LIVE : { ...LIVE, feed: RESTARTED };
        setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ kind: 'snapshot', state }) }); }, 0);
      }
      close() {}
      send() {}
    }
    vi.stubGlobal('WebSocket', ReconnectSocket);
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, status: 200, statusText: 'OK', json: async () => (path === '/api/state' ? LIVE : []) } as Response)));
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(m.find('[data-probe]')[0].getAttribute('data-feed')).toBe('VIPER killed GHOST|FIRST BLOOD');
    // the old process goes away; the client reconnects on its own after its back-off (500 ms)
    await act(async () => { sockets[0].onclose?.({ code: 1006 }); await new Promise(r => setTimeout(r, 750)); });
    expect(sockets.length, 'the client opened a second socket').toBe(2);
    expect(m.find('[data-probe]')[0].getAttribute('data-feed')).toBe('MC RESTARTED. RESUMED THE MATCH IN PLAY');
  });
});
