// Round 2 candidate 11: the console's one list loader. Each screen used to hand-write a cancel-guarded
// fetch effect, and KIT turned a failure into "none" (`.catch(() => set([]))`). These steps pin the
// hook's interface: errors are visible, stale answers are dropped, RETRY and a reconnect load again.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { StoreCtx } from '../src/store';
import { useResource, type Resource } from '../src/ui/useResource';
import { Kit } from '../src/screens/Kit';
import { demo, makeStore, mount, mountScreen } from './harness';

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

/** A load the test answers by hand, in any order. */
function deferredLoads<T>() {
  const pending: { resolve: (v: T) => void; reject: (e: Error) => void }[] = [];
  const load = () => new Promise<T>((resolve, reject) => { pending.push({ resolve, reject }); });
  return { load, pending };
}

/** Mount a probe that exposes the hook's latest answer. */
async function probe<T>(load: () => Promise<T>, initial: T, opts: { connected?: boolean; deps?: unknown[]; skipOffline?: boolean } = {}) {
  const seen: { r: Resource<T> | null } = { r: null };
  function Probe({ deps }: { deps: unknown[] }) { seen.r = useResource(load, initial, deps, 'failed', { skipOffline: opts.skipOffline }); return null; }
  // ONE store: a fresh makeStore builds a fresh api, and an api change alone reloads, which would hide
  // whether `connected` or `deps` did it.
  const base = makeStore({});
  const store = (connected: boolean) => ({ ...base, connected });
  const m = await mount(<StoreCtx.Provider value={store(opts.connected ?? true)}><Probe deps={opts.deps ?? []} /></StoreCtx.Provider>);
  const rerender = (connected: boolean, deps: unknown[] = opts.deps ?? []) =>
    m.update(<StoreCtx.Provider value={store(connected)}><Probe deps={deps} /></StoreCtx.Provider>);
  return { seen, m, rerender };
}

describe('useResource', () => {
  it('a failure shows as an error and keeps the last good data; RETRY loads again', async () => {
    const { load, pending } = deferredLoads<string[]>();
    const { seen, m } = await probe(load, []);
    await act(async () => { pending[0].resolve(['a']); });
    expect(seen.r!.data).toEqual(['a']);
    await act(async () => { seen.r!.retry(); });
    await act(async () => { pending[1].reject(new Error('socket reset')); });
    expect(seen.r!.error).toBe('socket reset');
    expect(seen.r!.data, 'a failure must not empty the list').toEqual(['a']);
    await act(async () => { seen.r!.retry(); });
    await act(async () => { pending[2].resolve(['a', 'b']); });
    expect(seen.r!.error).toBeNull();
    expect(seen.r!.data).toEqual(['a', 'b']);
    m.unmount();
  });

  it('an older answer that lands after a newer load started is dropped, a success or a failure', async () => {
    const { load, pending } = deferredLoads<string>();
    const { seen, m, rerender } = await probe(load, 'none', { deps: [1] });
    await rerender(true, [2]);                      // deps change: a second load starts
    await rerender(true, [3]);                      // and a third
    expect(pending.length, 'each deps change starts a load').toBe(3);
    await act(async () => { pending[2].resolve('new'); });
    await act(async () => { pending[0].resolve('old'); });
    expect(seen.r!.data).toBe('new');
    await act(async () => { pending[1].reject(new Error('late failure')); });
    expect(seen.r!.error, 'a stale failure must not show either').toBeNull();
    m.unmount();
  });

  it('skipOffline: does not load while the console is known offline, and loads on reconnect', async () => {
    let calls = 0;
    const { seen, m, rerender } = await probe(async () => { calls++; return 'x'; }, 'none', { connected: false, skipOffline: true });
    await settle();
    expect(calls).toBe(0);
    expect(seen.r!.data).toBe('none');
    await rerender(true);
    await settle();
    expect(calls).toBe(1);
    expect(seen.r!.data).toBe('x');
    m.unmount();
  });

  it('by default it loads while the socket is down (HTTP may answer), not on the disconnect, and again on reconnect', async () => {
    let calls = 0;
    const { m, rerender } = await probe(async () => { calls++; return 'x'; }, 'none', { connected: false });
    await settle();
    expect(calls, 'a socket-down mount still asks over HTTP').toBe(1);
    await rerender(true);
    await settle();
    expect(calls, 'the reconnect loads again').toBe(2);
    await rerender(false);
    await settle();
    expect(calls, 'the disconnect itself does not load').toBe(2);
    m.unmount();
  });

  it('reload() resolves only once its load has settled', async () => {
    const { load, pending } = deferredLoads<number>();
    const { seen, m } = await probe(load, 0);
    await act(async () => { pending[0].resolve(1); });
    let done = false;
    let p: Promise<void> = Promise.resolve();
    await act(async () => { p = seen.r!.reload().then(() => { done = true; }); });
    expect(done, 'reload() must wait for its load').toBe(false);
    await act(async () => { pending[1].resolve(2); await p; });
    expect(done).toBe(true);
    expect(seen.r!.data).toBe(2);
    m.unmount();
  });
});

describe('KIT: a failed load is shown, never read as "none"', () => {
  it('a failed gun list shows the load error with a RETRY that tries again', async () => {
    const d = await demo();
    let calls = 0;
    const armory = async () => { calls++; if (calls === 1) throw new Error('socket reset'); return d.api.armory(); };
    const pid = d.state.players[0].player_id;
    const m = await mountScreen(<Kit />, { ...d, view: 'kit', selPlayer: pid, api: { armory } });
    await settle();
    const strip = m.find('[data-alert="kit-load-error"]');
    expect(strip.length).toBe(1);
    expect(strip[0].textContent).toContain('COULD NOT LOAD THE GUN LIST: SOCKET RESET');
    await act(async () => { m.find('[data-testid="kit-load-retry-0"] button')[0].click(); });
    await settle();
    expect(calls).toBe(2);
    expect(m.find('[data-alert="kit-load-error"]').length, 'RETRY must try again, and this time it lands').toBe(0);
    m.unmount();
  });

  it('a failed voices load names the voices, and the other lists still load', async () => {
    const d = await demo();
    const getVoices = async () => { throw new Error('not found'); };
    const pid = d.state.players[0].player_id;
    const m = await mountScreen(<Kit />, { ...d, view: 'kit', selPlayer: pid, api: { getVoices } });
    await settle();
    const strip = m.find('[data-alert="kit-load-error"]');
    expect(strip.map(s => s.textContent)).toEqual([expect.stringContaining('COULD NOT LOAD THE VOICES: NOT FOUND')]);
    m.unmount();
  });
});

describe('KIT: a range verdict shows only once the server has stored it', () => {
  async function logIssue(rangeVerdict: () => Promise<unknown>) {
    const d = await demo();
    const sp = d.state.players[0];
    const primary = sp.loadout.weapons[0].weapon_id;
    const state = { ...d.state, kit: { ...d.state.kit, trying: { ...d.state.kit.trying, [sp.player_id]: primary } } };
    const prompt = window.prompt;
    window.prompt = () => 'too quiet';
    try {
      const m = await mountScreen(<Kit />, { ...d, state, view: 'kit', selPlayer: sp.player_id, api: { rangeVerdict: rangeVerdict as never } });
      await settle();
      await m.click('LOG ISSUE');
      await settle();
      return m;
    } finally { window.prompt = prompt; }
  }

  it('a stored issue shows on the weapon', async () => {
    const m = await logIssue(async () => ({ weapon_id: 'x', verdict: 'issue', note: 'too quiet', t: 1 }));
    expect(m.text()).toContain('RANGE LOG: TOO QUIET');
    m.unmount();
  });

  it('a failed write shows nothing', async () => {
    const m = await logIssue(async () => { throw new Error('could not write the bench log'); });
    expect(m.text()).not.toContain('RANGE LOG: TOO QUIET');
    m.unmount();
  });
});
