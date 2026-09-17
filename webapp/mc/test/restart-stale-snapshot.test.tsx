// Bench 2026-09-16: MC was restarted. The console tab still showed LOBBY with the game loaded, while
// both phones sat on "HOST IS SETTING UP THE GAME". A restart mints a new operator token, so the open
// tab was refused (4401) and the store seeded the board with `prev ?? fresh`: it KEPT the snapshot of
// the process that had just died. The fresh GET must replace it, and the view must follow its phase.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider, useStore } from '../src/store';
import { mount } from './harness';

const OLD = { session_id: 'old-proc', phase: 'lobby', t: 1, live: null, game: { loaded: true, sent: 2, total: 2, config_id: '45783079' } };
const NEW = { session_id: 'new-proc', phase: 'muster', t: 2, live: null, game: { loaded: false, sent: 0, total: 2 } };

/** One socket per `new WebSocket`: the first is the old process (a snapshot, then gone), every later one
 *  is the new process refusing the old token. */
class FakeSocket {
  static opened = 0;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    const n = FakeSocket.opened++;
    setTimeout(() => {
      if (n === 0) {
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ kind: 'snapshot', state: OLD }) });
        this.onclose?.({ code: 1006 });          // the old process exits
      } else {
        this.onopen?.();
        this.onclose?.({ code: 4401 });          // the new process: wrong token
      }
    }, 0);
  }
  close() {}
}

function Probe() {
  const { state, view } = useStore();
  return <span data-probe data-session={state?.session_id ?? ''} data-loaded={String(state?.game?.loaded)} data-view={view} />;
}
const probe = (m: { find(sel: string): HTMLElement[] }) => m.find('[data-probe]')[0];

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('an MC restart behind the token prompt', () => {
  it('replaces the dead process snapshot with the new process state', async () => {
    history.replaceState(null, '', '/');
    FakeSocket.opened = 0;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const body = path === '/api/state' ? NEW : [];
      return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
    }));
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    expect(probe(m).getAttribute('data-session'), 'control: the old process spoke first').toBe('old-proc');
    // the reconnect after the backoff reaches the new process, which refuses the token
    await act(async () => { await new Promise(r => setTimeout(r, 700)); });
    expect(probe(m).getAttribute('data-session'), 'the board must not keep the dead process').toBe('new-proc');
    expect(probe(m).getAttribute('data-loaded')).toBe('false');
    expect(probe(m).getAttribute('data-view'), 'and the view follows the new phase').toBe('muster');
    m.unmount();
  });
});
