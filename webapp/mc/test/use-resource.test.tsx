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
async function probe<T>(load: () => Promise<T>, initial: T, opts: { connected?: boolean; deps?: unknown[] } = {}) {
  const seen: { r: Resource<T> | null } = { r: null };
  function Probe({ deps }: { deps: unknown[] }) { seen.r = useResource(load, initial, deps, 'failed'); return null; }
  const store = (connected: boolean) => makeStore({}, { connected });
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

  it('an older answer that lands after a newer load started is dropped', async () => {
    const { load, pending } = deferredLoads<string>();
    const { seen, m, rerender } = await probe(load, 'none', { deps: [1] });
    await rerender(true, [2]);                      // deps change: a second load starts
    await act(async () => { pending[1].resolve('new'); });
    await act(async () => { pending[0].resolve('old'); });
    expect(seen.r!.data).toBe('new');
    await act(async () => { pending[0].reject(new Error('late failure')); });
    expect(seen.r!.error, 'a stale failure must not show either').toBeNull();
    m.unmount();
  });

  it('does not load while the console is known offline, and loads on reconnect', async () => {
    let calls = 0;
    const { seen, m, rerender } = await probe(async () => { calls++; return 'x'; }, 'none', { connected: false });
    await settle();
    expect(calls).toBe(0);
    expect(seen.r!.data).toBe('none');
    await rerender(true);
    await settle();
    expect(calls).toBe(1);
    expect(seen.r!.data).toBe('x');
    m.unmount();
  });

  it('reload() resolves once the new data is in', async () => {
    let n = 0;
    const { seen, m } = await probe(async () => ++n, 0);
    await settle();
    await act(async () => { await seen.r!.reload(); });
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
