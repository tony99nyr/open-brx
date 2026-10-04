// F454: a station's taken report corrects the taker of a TOOK line already in the feed. The server pushes
// `feed_edit` with the corrected row (same id); the store and the mock must each end with ONE row, corrected.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFeedEdit, StoreProvider, useStore } from '../src/store';
import { MockBackend } from '../src/mock/backend';
import type { FeedEntry } from '../src/api/types';
import { mount } from './harness';

const ROW = { id: 7, t_match_s: 61, text: 'P0 TOOK OVERSHIELD · STATION #4', tag: 'POWERUP', kind: 'info' } as const;
const FIXED = { ...ROW, text: 'P1 TOOK OVERSHIELD · STATION #4' };
const LIVE = { session_id: 's1', phase: 'live', t: 1, live: { match_id: 'm1' }, game: { loaded: true, sent: 2, total: 2 } };

class FakeSocket {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    const send = (m: unknown) => this.onmessage?.({ data: JSON.stringify(m) });
    setTimeout(() => {
      this.onopen?.();
      send({ kind: 'snapshot', state: LIVE });
      send({ kind: 'feed', entry: ROW });
      send({ kind: 'feed_edit', entry: { ...FIXED, id: 99, text: 'NOT HELD' } });   // an unknown id: a no-op
      send({ kind: 'feed_edit', entry: FIXED });
    }, 0);
  }
  close() {}
  send() {}
}

function Probe() {
  const { feed } = useStore();
  return <span data-probe data-feed={feed.map(e => e.text).join('|')} />;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('feed_edit', () => {
  it('the store ends with ONE row carrying the corrected taker', async () => {
    history.replaceState(null, '', '/');
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, status: 200, statusText: 'OK', json: async () => (path === '/api/state' ? LIVE : []) } as Response)));
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(m.find('[data-probe]')[0].getAttribute('data-feed')).toBe('P1 TOOK OVERSHIELD · STATION #4');
  });

  it('the pure edit: a row without an id, or an unknown id, is a no-op', () => {
    const feed: FeedEntry[] = [{ t_match_s: 1, text: 'NO ID', kind: 'info' }, { ...ROW }];
    expect(applyFeedEdit(feed, { t_match_s: 1, text: 'X', kind: 'info' })).toEqual(feed);
    expect(applyFeedEdit(feed, { ...FIXED, id: 5 })).toEqual(feed);
    expect(applyFeedEdit(feed, FIXED).map(r => r.text)).toEqual(['NO ID', FIXED.text]);
  });

  it('the mock replaces its row by id and tells subscribers, who fold it the same way', () => {
    const b = new MockBackend();
    const internals = b as unknown as { live_: unknown; feed(e: FeedEntry): void };
    internals.live_ = { rows: [], feed: [], go_live_t: 0, match_id: 'm1' };
    let seen: FeedEntry[] = [];
    b.subscribe(() => {}, (e, edit) => { seen = edit ? applyFeedEdit(seen, e) : [e, ...seen]; });
    internals.feed({ t_match_s: 61, text: 'P0 TOOK OVERSHIELD · STATION #4', tag: 'POWERUP', kind: 'info' });
    const id = seen[0].id!;
    b.feedEdit({ ...seen[0], id: id + 50, text: 'NOT HELD' });
    b.feedEdit({ ...seen[0], text: 'P1 TOOK OVERSHIELD · STATION #4' });
    expect(seen.map(r => r.text)).toEqual(['P1 TOOK OVERSHIELD · STATION #4']);
    expect((internals.live_ as { feed: FeedEntry[] }).feed.map(r => r.text)).toEqual(['P1 TOOK OVERSHIELD · STATION #4']);
  });
});
