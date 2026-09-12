// S25 — the projector tab is read-only, and the hash cannot get out of it.
//
// The spectator board renders no control (`test/spectate.test.tsx` asserts that literally). That was
// only half the safety: the tab pointed at the room is a normal console tab holding the operator
// token, and the store moved every tab on `hashchange` — so `#kit` typed into that window, a back
// button, or a bookmark turned the projector into the console, PANIC and END MATCH included, with
// the operator elsewhere in the building (review 2026-09-12).
//
// The latch is set at LOAD from the hash the tab opened with and holds for the whole session. A
// RELOAD is the way back to a console — and it has to actually be reachable: the rewrite used to put
// `#spectate` back in the URL bar the instant `#kit` was typed, so the reload that followed reloaded
// the BOARD and the latch could never be released at all (round-2 review 2026-09-12). The typed view
// is kept in the hash as `&want=`, which this tab ignores and the next LOAD honours.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../src/store';
import { mount } from './harness';

/** Load the app at this hash. `?mock` keeps it on the in-browser backend — no fetch, no WebSocket. */
function openAt(hash: string) {
  history.replaceState(null, '', `/?mock${hash}`);
}
/** move the hash the way a typed URL or a back button does */
async function goToHash(hash: string) {
  history.replaceState(null, '', `/?mock${hash}`);
  await act(async () => { window.dispatchEvent(new Event('hashchange')); });
}

function Probe() {
  const { view, wantedView } = useStore();
  return <span data-view={view} data-want={String(wantedView)}>{view}</span>;
}
const viewOf = (m: { find(sel: string): HTMLElement[] }) => m.find('[data-view]')[0].getAttribute('data-view');
/** what a latched tab was last asked for — the board renders this as the way out */
const wantOf = (m: { find(sel: string): HTMLElement[] }) => m.find('[data-view]')[0].getAttribute('data-want');

describe('S25 · the projector tab latch', () => {
  it('a tab opened at #spectate ignores hash navigation away from the board', async () => {
    openAt('#spectate');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    expect(viewOf(m)).toBe('spectate');
    await goToHash('#kit');
    expect(viewOf(m), 'typing #kit at the projector must not open the console').toBe('spectate');
    // The URL still SAYS spectate — it must not lie about what is on screen — and it carries the
    // request, so reloading this exact URL is the way out.
    expect(location.hash).toBe('#spectate&want=kit');
    m.unmount();
  });

  it('a fresh load carrying the request opens the console there, and the latch is gone', async () => {
    // This is the release. Before it, `&want=` did not exist: the operator typed `#kit`, watched the
    // URL snap back to `#spectate`, reloaded THAT, and got the board again — for ever.
    openAt('#spectate&want=kit');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    expect(viewOf(m), 'the reload honours what was typed before it').toBe('kit');
    expect(location.hash, 'and the request is spent, not left in the URL').toBe('#kit');
    await goToHash('#live');
    expect(viewOf(m), 'this tab is an ordinary console now').toBe('live');
    m.unmount();
  });

  it('the board says which screen is waiting, so the way out is on the screen refusing', async () => {
    openAt('#spectate');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    expect(wantOf(m), 'nothing is claimed until somebody actually tries').toBe('null');
    await goToHash('#kit');
    expect(wantOf(m)).toBe('kit');
    m.unmount();
  });

  it('a want= for the board itself is not a way out of the board', async () => {
    // `#spectate&want=spectate` is not a release — it would be a hash a passer-by could type at the
    // projector to unlatch it on the next reload with nothing changing on screen.
    openAt('#spectate&want=spectate');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    expect(viewOf(m)).toBe('spectate');
    await goToHash('#kit');
    expect(viewOf(m), 'still latched').toBe('spectate');
    m.unmount();
  });

  it('every other view is refused too, including the ones with the dangerous controls', async () => {
    openAt('#spectate');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    for (const v of ['live', 'recap', 'muster', 'debug']) {
      await goToHash(`#${v}`);
      expect(viewOf(m), `#${v} from the projector tab`).toBe('spectate');
    }
    m.unmount();
  });

  it('an ordinary console tab still follows the hash', async () => {
    // The control. If this stops passing the latch has been applied to every tab, and the operator
    // has lost back/forward and the URL bar.
    openAt('#live');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    expect(viewOf(m)).toBe('live');
    await goToHash('#kit');
    expect(viewOf(m)).toBe('kit');
    m.unmount();
  });

  it('a console tab can still be sent to the board (it is the tab it becomes)', async () => {
    // Reaching #spectate from a console tab is how the operator previews it; that tab is not latched
    // until it is RELOADED there, which is what the SPECTATE link does (target=_blank, a fresh load).
    openAt('#live');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await goToHash('#spectate');
    expect(viewOf(m)).toBe('spectate');
    await goToHash('#live');
    expect(viewOf(m), 'and it can come back, because it never loaded at the board').toBe('live');
    m.unmount();
  });
});
