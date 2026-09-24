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
