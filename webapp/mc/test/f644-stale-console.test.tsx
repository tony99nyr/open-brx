// F644 (field game 2026-11-01): the console needed manual refreshes to show the latest state. The server half (one
// socket that stopped reading held up every tab) is `mcp/tests/test_mc_ui_ws_stall.py` and `e2e/stalled-tab.mjs`.
// These are the console's half:
//   - a socket that has carried MC's heartbeat and then goes silent is given up, the link reads down, and the tab
//     redials, instead of sitting on a dead path that never fires `onclose`;
//   - a tab whose token MC refuses says, in red, that its board is frozen (the neutral TOKEN prompt alone did not).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINK_SILENT_MS, createHttpApi } from '../src/api/client';
import { CommandBar } from '../src/frame/CommandBar';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

class FakeWs {
  static made: FakeWs[] = [];
  onopen: (() => void) | null = null; onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null; onerror: (() => void) | null = null;
  closed = false;
  url: string;
  constructor(url: string) { this.url = url; FakeWs.made.push(this); }
  close() { this.closed = true; }   // a dead path: no `onclose` follows
  say(m: object) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

describe('F644: a /ui-ws socket that goes silent is given up', () => {
  const realWs = globalThis.WebSocket;
  afterEach(() => { vi.useRealTimers(); globalThis.WebSocket = realWs; FakeWs.made = []; });

  it('after a heartbeat, silence past LINK_SILENT_MS reads the link down and redials; frames keep it up', async () => {
    vi.useFakeTimers();
    globalThis.WebSocket = FakeWs as unknown as typeof WebSocket;
    const links: boolean[] = [];
    const stop = createHttpApi().subscribe(() => {}, () => {}, ok => links.push(ok));
    const ws = FakeWs.made.at(-1)!;
    ws.onopen?.();
    ws.say({ kind: 'snapshot', state: {} });
    ws.say({ kind: 'heartbeat' });
    expect(links).toEqual([true]);
    // CONTROL: a heartbeat every 5 s keeps a quiet link up for a long time
    for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(5000); ws.say({ kind: 'heartbeat' }); }
    expect(FakeWs.made.length, 'a socket that keeps hearing MC is kept').toBe(1);
    expect(links).toEqual([true]);
    // the path dies: nothing arrives and the browser never fires onclose
    await vi.advanceTimersByTimeAsync(LINK_SILENT_MS + 1500);
    expect(ws.closed, 'the silent socket is given up').toBe(true);
    expect(links.at(-1), 'the console says MC is offline').toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWs.made.length, 'and redials').toBe(2);
    // a late onclose from the abandoned socket must not mark the NEW link down
    const next = FakeWs.made.at(-1)!;
    next.onopen?.(); next.say({ kind: 'snapshot', state: {} });
    expect(links.at(-1)).toBe(true);
    ws.onclose?.({ code: 1006 });
    expect(links.at(-1), 'the old socket closing late leaves the new link up').toBe(true);
    stop();
  });

  it('an older MC that sends no heartbeat is never given up for being quiet', async () => {
    vi.useFakeTimers();
    globalThis.WebSocket = FakeWs as unknown as typeof WebSocket;
    const links: boolean[] = [];
    const stop = createHttpApi().subscribe(() => {}, () => {}, ok => links.push(ok));
    const ws = FakeWs.made.at(-1)!;
    ws.onopen?.(); ws.say({ kind: 'snapshot', state: {} });
    await vi.advanceTimersByTimeAsync(LINK_SILENT_MS * 4);
    expect(ws.closed).toBe(false);
    expect(FakeWs.made.length).toBe(1);
    expect(links).toEqual([true]);
    stop();
  });
});

describe('F644: a tab holding a token MC refuses says its board is frozen', () => {
  const bar = async (extra: Parameters<typeof makeStore>[1]) => {
    const d = await demo();
    const api = fixtureApi({}, d.api);
    return mount(<StoreCtx.Provider value={makeStore({ ...d, view: 'muster' }, { api, mock: false, connected: false, ...extra })}><CommandBar /></StoreCtx.Provider>);
  };

  it('red BOARD FROZEN pill, and the phase chip reads LAST KNOWN', async () => {
    const m = await bar({ authRequired: true, hasToken: true });
    const pill = m.find('[data-alert="frame-token-stale"]')[0];
    expect(pill?.getAttribute('data-sev')).toBe('red');
    expect(pill?.textContent).toMatch(/Board frozen/i);
    expect(m.find('[data-testid="phase-chip"]')[0]?.textContent).toMatch(/^LAST KNOWN: /);
    m.unmount();
  });

  it('CONTROL: no token held is the neutral prompt only; a live link shows nothing', async () => {
    const none = await bar({ authRequired: true, hasToken: false });
    expect(none.find('[data-alert="frame-token-stale"]').length).toBe(0);
    expect(none.find('[data-alert="frame-token-required-app"]').length).toBe(1);
    none.unmount();
    const live = await bar({ authRequired: false, hasToken: true, connected: true });
    expect(live.find('[data-alert="frame-token-stale"]').length).toBe(0);
    expect(live.find('[data-testid="phase-chip"]')[0]?.textContent).not.toMatch(/LAST KNOWN/);
    live.unmount();
  });
});
