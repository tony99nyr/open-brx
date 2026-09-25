// F364 (Tony 2026-09-25): MC assigns the station id; the operator never types one. The card shows the id
// read-only, has no id input, and ASSIGN + ARM sends no id. Replaces F343(a)'s client-side pre-fill.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { makeStore, mount } from './harness';
import type { Api, State, StationView } from '../src/api/types';

async function base() {
  const api = new MockBackend();
  const st = await api.getState();
  const proto = st.stations![0];
  const unarmed = (node_id: string): StationView =>
    ({ ...proto, node_id, assigned: null, armed: null, arm_pending: false, attention: [], report: { ...proto.report, station_id: 0 } });
  return { api, st, proto, unarmed };
}

describe('F364: the station id is MC\'s, shown read-only', () => {
  it('an assigned card shows its id, an unassigned one says MC sets it, and neither has an id input', async () => {
    const { st, proto, unarmed } = await base();
    const taken: StationView = { ...proto, node_id: 'util-t', assigned: { kind: 'respawn', team: 255, id: 3, threshold: 0, at: 5 }, armed: null, attention: [] };
    const m = await mount(<StoreCtx.Provider value={makeStore({ state: { ...st, stations: [taken, unarmed('util-x')] }, view: 'muster' })}><Armory /></StoreCtx.Provider>);
    expect(m.find('[data-station-id="util-t"]')[0]?.textContent).toBe('3');
    expect(m.find('[data-station-id="util-x"]')[0]?.textContent).toBe('SET BY MC AT ARM');
    expect(m.find('input[aria-label^="station id for"]'), 'the operator never types a station id').toHaveLength(0);
    m.unmount();
  });

  it('ASSIGN + ARM sends no id, and the mock gives two stations 1 then 2', async () => {
    const { api, st, unarmed } = await base();
    const sent: Parameters<Api['putStation']>[1][] = [];
    const orig = api.putStation.bind(api);
    api.putStation = (async (n, a) => { sent.push(a); return orig(n, a); }) as Api['putStation'];
    const state: State = { ...st, stations: [unarmed('stick-1')] };
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api })}><Armory /></StoreCtx.Provider>);
    const card = m.find('[data-station-card="stick-1"]')[0] as HTMLElement;
    const btn = [...card.querySelectorAll('button')].find(b => b.textContent === 'ASSIGN + ARM') as HTMLButtonElement;
    await act(async () => { btn.click(); });
    expect(sent).toHaveLength(1);
    expect('id' in sent[0], 'the console must leave the id to MC').toBe(false);
    m.unmount();
    const fresh = new MockBackend();
    for (const s of (await fresh.getState()).stations ?? []) if (s.assigned) await fresh.deleteStation(s.node_id);
    expect((await fresh.putStation('util-a', { kind: 'respawn', team: 'any' })).assigned?.id).toBe(1);
    expect((await fresh.putStation('stick-2', { kind: 'respawn', team: 'any' })).assigned?.id).toBe(2);
    await expect(fresh.putStation('util-c', { kind: 'respawn', team: 'any', id: 2 }), 'an explicit id is still checked').rejects.toThrow(/already assigned/);
  });

  it('an MC older than F364 (rebuilt, not restarted) refuses the id-less PUT: the console retries once with the lowest free id', async () => {
    const { api, st, proto, unarmed } = await base();
    const sent: Parameters<Api['putStation']>[1][] = [];
    api.putStation = (async (_n, a) => {
      sent.push(a);
      if (a.id == null) throw new Error('id must be an integer 1..65535 (the station id in the advert)');
      return { ...unarmed('stick-1'), assigned: { kind: a.kind, team: 255, id: a.id, threshold: 0, at: 1 } };
    }) as Api['putStation'];
    const taken: StationView = { ...proto, node_id: 'util-t', assigned: { kind: 'respawn', team: 255, id: 1, threshold: 0, at: 5 }, armed: null, attention: [] };
    const m = await mount(<StoreCtx.Provider value={makeStore({ state: { ...st, stations: [taken, unarmed('stick-1')] }, view: 'muster' }, { api })}><Armory /></StoreCtx.Provider>);
    const card = m.find('[data-station-card="stick-1"]')[0] as HTMLElement;
    await act(async () => { ([...card.querySelectorAll('button')].find(b => b.textContent === 'ASSIGN + ARM') as HTMLButtonElement).click(); });
    expect(sent.map(a => a.id)).toEqual([undefined, 2]);
    m.unmount();
  });

  it('when the older-MC retry is refused too, the console stops after two PUTs and shows the refusal on the card', async () => {
    const { api, st, unarmed } = await base();
    const sent: Parameters<Api['putStation']>[1][] = [];
    api.putStation = (async (_n, a) => {
      sent.push(a);
      throw new Error(a.id == null ? 'id must be an integer 1..65535 (the station id in the advert)'
        : `station id ${a.id} is already assigned to util-z; ids must be unique on the field`);
    }) as Api['putStation'];
    const run: <T,>(fn: () => Promise<T>) => Promise<T | undefined> = async fn => { try { return await fn(); } catch { return undefined; } };
    const m = await mount(<StoreCtx.Provider value={makeStore({ state: { ...st, stations: [unarmed('stick-1')] }, view: 'muster' }, { api, run })}><Armory /></StoreCtx.Provider>);
    const card = () => m.find('[data-station-card="stick-1"]')[0] as HTMLElement;
    await act(async () => { ([...card().querySelectorAll('button')].find(b => b.textContent === 'ASSIGN + ARM') as HTMLButtonElement).click(); });
    expect(sent.map(a => a.id)).toEqual([undefined, 1]);
    expect(card().textContent).toMatch(/already assigned to util-z/);
    m.unmount();
  });
});
