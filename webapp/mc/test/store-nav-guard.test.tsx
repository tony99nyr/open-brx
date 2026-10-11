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
import { describe, expect, it, vi } from 'vitest';
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
  const { view, navBlockedTo, setDirty, setView, enterPhase } = useStore();
  return (
    <div>
      <span data-testid="view">{view}</span>
      <span data-testid="blocked">{String(navBlockedTo)}</span>
      <button onClick={() => setDirty(true)}>mark dirty</button>
      <button onClick={() => setDirty(false)}>mark clean</button>
      <button onClick={() => setView('kit')}>go kit</button>
      <button onClick={() => setView('debug')}>go debug</button>
      <button onClick={() => setView('lobby')}>go lobby</button>
      <button onClick={() => enterPhase('kit')}>enter kit</button>
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

  // Round 3 (3): followPhase must never count as the confirming SECOND tap. The exploitable case is an
  // OPERATOR's own attempt blocking on a target, with the SERVER independently (and later) reaching
  // that same phase on its own -- two unrelated events that happen to share a name. Only the operator
  // repeating THEIR OWN action may confirm; the server arriving there is not that.
  it('a phase-follow landing on the operator’s own already-blocked target does not auto-confirm it', async () => {
    openAt('#build');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await m.click('mark dirty');
    await m.click('go kit');   // operator attempt: blocked, navBlockedTo = 'kit'
    expect(viewOf(m)).toBe('build');
    expect(blockedOf(m)).toBe('kit');
    const api = (window as unknown as { __MC_MOCK__: Api }).__MC_MOCK__;
    await act(async () => { await api.setPhase('kit', true); });   // the server independently ALSO reaches 'kit'
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(viewOf(m), 'a phase-follow must not auto-confirm an operator’s own blocked target').toBe('build');
    expect(blockedOf(m)).toBe('kit');
    m.unmount();
  });
});

describe('F503: the operator\u2019s own phase change is not followed a second time', () => {
  it('a late snapshot carrying the phase the operator already entered does not undo a later tap', async () => {
    openAt('#build');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });   // the first snapshot (build) seeds the follow
    // CONTINUE TO KIT's HTTP reply lands first: the screen moves to KIT, then the operator taps LOBBY...
    await m.click('enter kit');
    await m.click('go lobby');
    expect(viewOf(m)).toBe('lobby');
    // ...and only THEN does the snapshot carrying phase kit arrive
    const api = (window as unknown as { __MC_MOCK__: Api }).__MC_MOCK__;
    await act(async () => { await api.setPhase('kit', true); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(viewOf(m), 'the console moved off LOBBY by itself').toBe('lobby');
    m.unmount();
  });
});

// Opus r1: marking the phase followed early opened the opposite race. A snapshot built BEFORE the request (still
// `build`) landing after the reply would now read as an advance away from `kit` and bounce the screen back.
const emitSnapshot = async () => {
  const api = (window as unknown as { __MC_MOCK__: { emit(): void } }).__MC_MOCK__;
  await act(async () => { api.emit(); await new Promise(r => setTimeout(r, 0)); });
};

describe('F503: a snapshot from before the operator\u2019s request is ignored until one confirms it', () => {
  it('a stale snapshot does not bounce the screen back to the phase the operator left', async () => {
    openAt('#build');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('enter kit');          // the reply landed; the mock server never moved
    await emitSnapshot();                // ...and a snapshot taken before the request arrives now
    expect(viewOf(m), 'a stale snapshot moved the screen back').toBe('kit');
    m.unmount();
  });

  it('a held snapshot is followed at the deadline with no further push (Codex r1)', async () => {
    openAt('#build');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      await m.click('enter kit');
      const mock = (window as unknown as { __MC_MOCK__: { emit(): void; phase: string } }).__MC_MOCK__;
      await act(async () => { mock.emit(); });   // the server never reached kit: this one is held, not dropped
      expect(viewOf(m)).toBe('kit');
      await act(async () => { vi.advanceTimersByTime(8_001); });
      expect(mock.phase).not.toBe('kit');
      expect(viewOf(m), 'the held snapshot was dropped: the screen never learned the server phase').toBe(mock.phase);
    } finally { vi.useRealTimers(); }
    m.unmount();
  });

  it('when the snapshot beat the reply, nothing is held and another tab\u2019s move is followed at once (Codex r1)', async () => {
    openAt('#build');
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const api = (window as unknown as { __MC_MOCK__: Api }).__MC_MOCK__;
    await act(async () => { await api.setPhase('kit', true); await new Promise(r => setTimeout(r, 0)); });   // snapshot first
    await m.click('enter kit');                                                                            // then the reply
    await act(async () => { await api.setPhase('lobby', true); await new Promise(r => setTimeout(r, 0)); });  // another tab
    expect(viewOf(m), 'a confirmed phase was held anyway, hiding another tab\u2019s move').toBe('lobby');
    m.unmount();
  });
});
