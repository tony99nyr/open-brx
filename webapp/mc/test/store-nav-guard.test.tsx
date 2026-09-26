// Round 2 (2, 3): the unsaved-edit guard (store.tsx's `guardNav`) gates `setView` directly (already
// covered by test/build-screen.test.tsx's CommandBar-tap case) and TWO paths that used to skip it
// entirely: browser back/forward (a hand-edited hash fires the same `hashchange` event), and the
// server's own phase advancing (`followPhase`) while an unsaved BUILD edit is open. `debug` (the
// token screen) is exempt from all three -- auth is never something a "tap again" can be waved past.
//
// Driven against a REAL `StoreProvider` in `?mock` mode (not the `makeStore` fixture, whose `setView`
// is a no-op stub) -- the guard lives inside the provider itself, same pattern as
// test/spectator-latch.test.tsx.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api } from '../src/api/types';
import { StoreProvider, useStore } from '../src/store';
import { mount } from './harness';

function openAt(hash: string) {
  history.replaceState(null, '', `/?mock${hash}`);
}
async function goToHash(hash: string) {
  history.replaceState(null, '', `/?mock${hash}`);
  await act(async () => { window.dispatchEvent(new Event('hashchange')); });
}

function Probe() {
  const { view, navBlockedTo, setDirty, setView } = useStore();
  return (
    <div>
      <span data-testid="view">{view}</span>
      <span data-testid="blocked">{String(navBlockedTo)}</span>
      <button onClick={() => setDirty(true)}>mark dirty</button>
      <button onClick={() => setDirty(false)}>mark clean</button>
      <button onClick={() => setView('kit')}>go kit</button>
      <button onClick={() => setView('debug')}>go debug</button>
    </div>
  );
}
const viewOf = (m: { find(s: string): HTMLElement[] }) => m.find('[data-testid="view"]')[0].textContent;
const blockedOf = (m: { find(s: string): HTMLElement[] }) => m.find('[data-testid="blocked"]')[0].textContent;

describe('round 2 (3): the token screen is exempt from the dirty guard', () => {
  it('setView(\'debug\') goes through in one tap, dirty or not', async () => {
    openAt('#build');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await m.click('mark dirty');
    await m.click('go debug');
    expect(viewOf(m)).toBe('debug');
    m.unmount();
  });
});

describe('round 2 (2): browser back/forward is gated too', () => {
  it('a hash move while dirty is blocked and the address bar is restored', async () => {
    openAt('#build');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await m.click('mark dirty');
    await goToHash('#kit');
    expect(viewOf(m), 'blocked: must not have navigated').toBe('build');
    expect(location.hash, 'the URL must not say a view the guard refused').toBe('#build');
    expect(blockedOf(m)).toBe('kit');
    m.unmount();
  });

  it('the same hash a second time is the confirm', async () => {
    openAt('#build');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await m.click('mark dirty');
    await goToHash('#kit');
    await goToHash('#kit');
    expect(viewOf(m)).toBe('kit');
    expect(location.hash).toBe('#kit');
    m.unmount();
  });
});

describe('round 2 (2): the server phase advancing does not move the screen out from under a dirty edit', () => {
  it('stays on BUILD and names the phase that is waiting', async () => {
    openAt('#build');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await m.click('mark dirty');
    const api = (window as unknown as { __MC_MOCK__: Api }).__MC_MOCK__;
    await act(async () => { await api.setPhase('kit'); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(viewOf(m), 'a phase advance while dirty must not follow silently').toBe('build');
    expect(blockedOf(m)).toBe('kit');
    m.unmount();
  });
});
