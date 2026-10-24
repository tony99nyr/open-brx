// F540 (bench A.7, 2026-10-16): after an MC restart an open tab kept the old operator token. Every write was refused,
// and the console only flickered: the 401 showed the same NEUTRAL "token needed" words the header pill already showed
// (so the toast hid them), and the refused WebSocket was accepted, then closed, so the tab reconnected twice a second
// for ever and the link state toggled each time.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, createHttpApi, setToken } from '../src/api/client';
import { operatorTokenLine, tokenRefusedLine } from '../src/alerts';

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

class FakeWs {
  static made: FakeWs[] = [];
  onopen: (() => void) | null = null; onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null; onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) { this.url = url; FakeWs.made.push(this); }
  close() { /* the test drives onclose itself */ }
}

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
