// S25 — the projector tab is read-only, and the hash cannot get out of it.
//
// The spectator board renders no control (`test/spectate.test.tsx` asserts that literally). That was
// only half the safety: the tab pointed at the room is a normal console tab holding the operator
// token, and the store moved every tab on `hashchange` — so `#kit` typed into that window, a back
// button, or a bookmark turned the projector into the console, PANIC and END MATCH included, with
// the operator elsewhere in the building (review 2026-09-12).
//
// The latch is set at LOAD from the hash the tab opened with, and never cleared: a reload is the
// only way back to a console, which is a deliberate act at a keyboard.
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
  const { view } = useStore();
  return <span data-view={view}>{view}</span>;
}
const viewOf = (m: { find(sel: string): HTMLElement[] }) => m.find('[data-view]')[0].getAttribute('data-view');

describe('S25 · the projector tab latch', () => {
  it('a tab opened at #spectate ignores hash navigation away from the board', async () => {
    openAt('#spectate');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    expect(viewOf(m)).toBe('spectate');
    await goToHash('#kit');
    expect(viewOf(m), 'typing #kit at the projector must not open the console').toBe('spectate');
    expect(location.hash, 'and the URL is put back, so it does not lie about what is on screen').toBe('#spectate');
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
