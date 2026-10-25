// F540 (bench A.7, 2026-10-16): after an MC restart an open tab kept the old operator token. Every write was refused,
// and the console only flickered: the 401 showed the same NEUTRAL "token needed" words the header pill already showed
// (so the toast hid them), and the refused WebSocket was accepted, then closed, so the tab reconnected twice a second
// for ever and the link state toggled each time.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, createHttpApi, getToken, onAuthRequired, onTokenPicked, setToken } from '../src/api/client';
import { ALERTS, operatorTokenLine, tokenRefusedLine } from '../src/alerts';

const json401 = () => new Response('{"error":"operator token required"}', { status: 401, headers: { 'content-type': 'application/json' } });

describe('F540: a refused write says so in its own words', () => {
  const real = globalThis.fetch;
  afterEach(() => { globalThis.fetch = real; setToken(''); });

  it('a 401 on a write names the refusal and the cure; a 401 on a read keeps the neutral prompt', async () => {
    setToken('old-token');
    globalThis.fetch = (async () => json401()) as typeof fetch;
    const api = createHttpApi();
    const write = await api.pick({ pieces: { mode: 'builtin:mode:ffa' } }).then(() => null, e => e as Error);
    expect(write).toBeInstanceOf(AuthError);
    expect(write!.message).toBe(tokenRefusedLine());
    expect(write!.message).not.toBe(operatorTokenLine());
    const read = await api.getState().then(() => null, e => e as Error);
    expect(read).toBeInstanceOf(AuthError);
    expect(read!.message).toBe(operatorTokenLine());
  });
});

describe('F540 review: the cure and the diagnosis', () => {
  const real = globalThis.fetch;
  afterEach(() => { globalThis.fetch = real; setToken(''); });

  it('a tab with NO token keeps the neutral prompt on a refused write (nothing is "old or wrong" yet)', async () => {
    setToken('');
    globalThis.fetch = (async () => json401()) as typeof fetch;
    const e = await createHttpApi().pick({ match: { night: true } }).then(() => null, x => x as Error);
    expect(e!.message).toBe(operatorTokenLine());
  });

  it('pasting the #tok= link into the open tab picks the token up (no reload needed)', () => {
    setToken('old');
    location.hash = '#build&tok=fresh';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(getToken()).toBe('fresh');
    expect(location.hash, 'the token leaves the address bar, the view stays').toBe('#build');
  });

  it('a bare #tok= link pasted into the open tab keeps the view the tab was on', () => {
    setToken('old');
    history.replaceState(null, '', location.pathname + '#live');
    const before = location.href;
    history.replaceState(null, '', location.pathname + '#tok=fresh2');
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: before, newURL: location.href }));
    expect(getToken()).toBe('fresh2');
    expect(location.hash).toBe('#live');
  });

  it('F586: a pasted #tok= link tells the store, so it redials at once and clears the refused line', () => {
    setToken('old');
    const picked: string[] = [];
    const un = onTokenPicked(tok => picked.push(tok));
    location.hash = '#live&tok=fresh3';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(picked, 'the store hears the new token').toEqual(['fresh3']);
    location.hash = '#live';                                   // CONTROL: a hash change with no token tells nobody
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(picked).toEqual(['fresh3']);
    un();
  });

  it('the registry row says what the console shows', () => {
    expect(ALERTS['frame-token-refused'].text.replace(/`/g, '')).toBe(tokenRefusedLine());
  });
});

class FakeWs {
  static made: FakeWs[] = [];
  onopen: (() => void) | null = null; onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null; onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) { this.url = url; FakeWs.made.push(this); }
  close() { /* the test drives onclose itself */ }
}

describe('F540 review: a socket MC accepts again clears the token prompt', () => {
  const realWs = globalThis.WebSocket;
  afterEach(() => { globalThis.WebSocket = realWs; FakeWs.made = []; });

  it('refused (4401) asks for the token; a later socket that delivers a frame clears the ask', () => {
    globalThis.WebSocket = FakeWs as unknown as typeof WebSocket;
    const asks: boolean[] = [];
    const un = onAuthRequired(r => asks.push(r));
    const stop = createHttpApi().subscribe(() => {}, () => {}, () => {});
    const ws = FakeWs.made.at(-1)!;
    ws.onopen?.(); ws.onclose?.({ code: 4401 });
    expect(asks.at(-1)).toBe(true);
    const stop2 = createHttpApi().subscribe(() => {}, () => {}, () => {});   // the token valid again (MC restarted with it)
    const live = FakeWs.made.at(-1)!;
    live.onopen?.(); live.onmessage?.({ data: JSON.stringify({ kind: 'feed', entry: { text: 'x' } }) });
    expect(asks.at(-1), 'a live socket means MC took the token').toBe(false);
    stop(); stop2(); un();
  });
});

describe('F540: a WebSocket MC refuses does not flicker the link', () => {
  const realWs = globalThis.WebSocket, realFetch = globalThis.fetch;
  afterEach(() => { vi.useRealTimers(); globalThis.WebSocket = realWs; globalThis.fetch = realFetch; FakeWs.made = []; });

  it('accepted then closed 4401: the link never reads up, and the retries back off', async () => {
    vi.useFakeTimers();
    globalThis.WebSocket = FakeWs as unknown as typeof WebSocket;
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    const links: boolean[] = [];
    const stop = createHttpApi().subscribe(() => {}, () => {}, ok => links.push(ok));
    const refuse = () => { const ws = FakeWs.made.at(-1)!; ws.onopen?.(); ws.onclose?.({ code: 4401 }); };
    refuse();
    for (const wait of [500, 1000, 2000, 4000]) {          // the backoff grows; it does not reset to 500 on each accept
      await vi.advanceTimersByTimeAsync(wait - 1);
      const n = FakeWs.made.length;
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWs.made.length, `a retry after ${wait} ms`).toBe(n + 1);
      refuse();
    }
    expect(links.includes(true), 'the link read up on a socket MC refused').toBe(false);
    // CONTROL: a socket that delivers a frame IS up, and the backoff starts again from 500 ms
    const ok = FakeWs.made.at(-1)!;
    await vi.advanceTimersByTimeAsync(8000);
    const good = FakeWs.made.at(-1)!;
    expect(good).not.toBe(ok);
    good.onopen?.();
    good.onmessage?.({ data: JSON.stringify({ kind: 'feed', entry: { text: 'x' } }) });
    expect(links.at(-1)).toBe(true);
    good.onclose?.({ code: 1006 });
    const n = FakeWs.made.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWs.made.length).toBe(n + 1);
    stop();
  });
});

describe('F586 review: a redial for a new token is not undone by the old socket closing late', () => {
  const realWs = globalThis.WebSocket;
  afterEach(() => { globalThis.WebSocket = realWs; FakeWs.made = []; });

  it('the old live socket closing after the new one is up leaves the link up', () => {
    globalThis.WebSocket = FakeWs as unknown as typeof WebSocket;
    const link: boolean[] = [], onLink = (up: boolean) => link.push(up);
    const stopOld = createHttpApi().subscribe(() => {}, () => {}, onLink);
    const old = FakeWs.made.at(-1)!;
    old.onopen?.(); old.onmessage?.({ data: JSON.stringify({ kind: 'feed', entry: { text: 'x' } }) });
    stopOld();                                                         // the store resubscribes for the new token
    createHttpApi().subscribe(() => {}, () => {}, onLink);
    const now = FakeWs.made.at(-1)!;
    now.onopen?.(); now.onmessage?.({ data: JSON.stringify({ kind: 'feed', entry: { text: 'y' } }) });
    old.onclose?.({ code: 1000 });                                     // the browser reports the old close late
    expect(link.at(-1), 'the new socket is the live one').toBe(true);
    // control: a live socket that drops while its subscription is open still reports the link down
    now.onclose?.({ code: 1006 });
    expect(link.at(-1)).toBe(false);
  });

  it('a late token refusal from a replaced socket leaves accepted authentication intact', () => {
    globalThis.WebSocket = FakeWs as unknown as typeof WebSocket;
    const asks: boolean[] = [];
    const un = onAuthRequired(required => asks.push(required));
    vi.useFakeTimers();
    const stop = createHttpApi().subscribe(() => {}, () => {}, () => {});
    const old = FakeWs.made.at(-1)!;
    old.onopen?.(); old.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(500);
    const current = FakeWs.made.at(-1)!;
    current.onopen?.();
    current.onmessage?.({ data: JSON.stringify({ kind: 'snapshot', state: {} }) });
    expect(asks.at(-1)).toBe(false);
    old.onclose?.({ code: 4401 });
    expect(asks.at(-1)).toBe(false);
    stop(); un(); vi.useRealTimers();
  });
});
