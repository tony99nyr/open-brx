// Bench 2026-10-02 (option B): a hill phone pressed BACK TO HUD in RECAP, MC dropped its station row by design
// (F184), and after NEXT MATCH the LOAD refusal "KING OF THE HILL NEEDS A HILL" told nobody why. MC now RECORDS the
// departure (`state.py _station_departures`), names it in the refusal and on ITEMS, and offers a one-tap RESTORE
// once the SAME utility node is back. The server half is `mcp/tests/test_mc_stations.py`; this file holds the
// mock's parity with it and what the ITEMS card shows.
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { Games } from '../src/screens/Games';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { makeStore, mount } from './harness';
import type { Api, State } from '../src/api/types';

const NODE = 'util-a1b2c3';

/** The bench walk on the mock: a koth game, the seeded phone assigned as the hill, then BACK TO HUD. */
async function departedHill() {
  const api = new MockBackend();
  await api.putConfig({ mode: 'koth', station_source: 'phone' });
  await api.putStation(NODE, { kind: 'control', team: 'any' });
  const id = (await api.getState()).stations!.find(s => s.node_id === NODE)!.assigned!.id;
  api.confirmStationHud(NODE);   // NetServer's proven `prior_utility` handoff on the first HUD hello
  return { api, id };
}

describe('mock parity with state.py station departures', () => {
  it('BACK TO HUD records the departure with the PUT body RESTORE sends', async () => {
    const { api, id } = await departedHill();
    const st = await api.getState();
    expect(st.stations!.some(s => s.node_id === NODE)).toBe(false);
    expect(st.station_departures).toHaveLength(1);
    const d = st.station_departures![0];
    expect(d).toMatchObject({ node_id: NODE, kind: 'control', id, team: 255, threshold: 0, reason: 'back_to_hud', returned: false,
      label: 'PHONE B2C3', restore: { kind: 'control', team: 255, threshold: 0 } });
    expect(d.line).toMatch(new RegExp(`^HILL ${id} \\(PHONE B2C3\\) WENT BACK TO HUD AT \\d\\d:\\d\\d: SWITCH IT BACK TO UTILITY, THEN TAP RESTORE IN THE ARMORY`));
  });

  it('the LOAD refusal names the hill that left', async () => {
    const { api, id } = await departedHill();
    await expect(api.loadGame()).rejects.toThrow(new RegExp(`^KING OF THE HILL NEEDS A HILL: HILL ${id} \\(PHONE B2C3\\) WENT BACK TO HUD AT`));
  });

  it('a returning node is offered RESTORE and never restored on its own; RESTORE puts the old id back and clears it', async () => {
    const { api, id } = await departedHill();
    api.utilityHello(NODE);
    let st = await api.getState();
    expect(st.stations!.find(s => s.node_id === NODE)!.assigned).toBeNull();
    expect(st.station_departures![0]).toMatchObject({ returned: true });
    expect(st.station_departures![0].line).toMatch(/IT IS BACK, SO TAP RESTORE ON ITS ITEMS CARD/);
    const v = await api.putStation(NODE, st.station_departures![0].restore);
    expect(v.assigned).toMatchObject({ kind: 'control', id });
    st = await api.getState();
    expect(st.station_departures).toEqual([]);
  });

  it('RELEASE records it too, NEXT MATCH keeps it and a FRESH SESSION drops it', async () => {
    const api = new MockBackend();
    await api.putStation(NODE, { kind: 'respawn', team: 'any' });
    await api.releaseStation(NODE);
    expect((await api.getState()).station_departures![0]).toMatchObject({ reason: 'released', kind: 'respawn' });
    api.confirmStationHud(NODE);   // the HUD hello after a release: already unassigned, the record stands
    expect((await api.getState()).station_departures![0].reason).toBe('released');
    await api.newSession(true);
    expect((await api.getState()).station_departures).toHaveLength(1);
    await api.newSession(false);
    expect((await api.getState()).station_departures).toEqual([]);
  });
});

async function armory(api: MockBackend) {
  let state: State = await api.getState();
  const render = () => (<StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api })}><Armory /></StoreCtx.Provider>);
  const m = await mount(render());
  return { m, settle: async () => { state = await api.getState(); await m.update(render()); } };
}

describe('ITEMS shows the departure, and RESTORE only once that node is back', () => {
  it('while the phone is away: the line on the panel, no card for it, no RESTORE', async () => {
    const { api, id } = await departedHill();
    const { m } = await armory(api);
    const lines = m.find('[data-testid="station-departure"]');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toMatch(new RegExp(`HILL ${id} \\(PHONE B2C3\\) WENT BACK TO HUD AT \\d\\d:\\d\\d`));
    expect(m.find(`[data-station-card="${NODE}"]`)).toHaveLength(0);
    expect(m.find('[data-testid="station-restore"]')).toHaveLength(0);
    m.unmount();
  });

  it('once it is back: the line moves onto its card with a RESTORE that re-applies the assignment', async () => {
    const { api, id } = await departedHill();
    api.utilityHello(NODE);
    const { m, settle } = await armory(api);
    const card = m.find(`[data-station-card="${NODE}"]`)[0];
    expect(card.querySelector('[data-testid="station-departure"]')?.textContent).toMatch(/IT IS BACK, SO TAP RESTORE/);
    const btn = card.querySelector('[data-testid="station-restore"] button, button[data-testid="station-restore"]');
    expect(btn, 'RESTORE is on the returned node\'s card').toBeTruthy();
    expect(m.find('[data-testid="station-restore"]')).toHaveLength(1);
    await m.click('RESTORE');
    await settle();
    expect(m.find(`[data-station-title="${NODE}"]`)[0].textContent).toBe(`CONTROL ${id}`);
    expect(m.find('[data-testid="station-departure"]')).toHaveLength(0);
    expect(m.find('[data-testid="station-restore"]')).toHaveLength(0);
    m.unmount();
  });

  it('a RELEASED phone still on its way to the HUD carries the line on its card, but no RESTORE yet', async () => {
    const api = new MockBackend();
    await api.putStation(NODE, { kind: 'respawn', team: 'any' });
    await api.releaseStation(NODE);   // accepted; the card stays until the HUD hello proves the role changed (F184)
    const { m } = await armory(api);
    const card = m.find(`[data-station-card="${NODE}"]`)[0];
    expect(card.querySelector('[data-testid="station-departure"]')?.textContent).toMatch(/WAS RELEASED TO ITS HUD AT/);
    expect(m.find('[data-testid="station-restore"]')).toHaveLength(0);
    m.unmount();
  });

  it('a refused RESTORE shows the server words on the card and keeps the departure', async () => {
    const { api } = await departedHill();
    api.utilityHello(NODE);
    api.putStation = (async () => { throw Object.assign(new Error('item_preset is only for a powerup station'), { status: 400 }); }) as Api['putStation'];
    const { m, settle } = await armory(api);
    await m.click('RESTORE');
    await settle();
    expect(m.find('[data-testid="station-apply-error"]')[0]?.textContent).toMatch(/item_preset is only for a powerup station/);
    expect(m.find('[data-testid="station-restore"]')).toHaveLength(1);
    m.unmount();
  });
});

describe('PLAY names the hill that left in its NO HILL block', () => {
  it('the block carries the departure line; CONTROL: a koth game with no departure does not', async () => {
    const { api, id } = await departedHill();
    const [weapons, perks, modes] = [await api.getWeapons(), await api.getPerks(), await api.getModes()];
    const store = makeStore({ state: await api.getState(), weapons, perks, view: 'build' }, { api, modes });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    const line = m.find('[data-testid="games-hill-departed"]');
    expect(line).toHaveLength(1);
    expect(line[0].textContent).toMatch(new RegExp(`^HILL ${id} \\(PHONE B2C3\\) WENT BACK TO HUD AT`));
    m.unmount();
    const plain = new MockBackend();
    await plain.putConfig({ mode: 'koth', station_source: 'phone' });
    const store2 = makeStore({ state: await plain.getState(), weapons, perks, view: 'build' }, { api: plain, modes });
    const m2 = await mount(<StoreCtx.Provider value={store2}><Games /></StoreCtx.Provider>);
    expect(m2.find('[data-testid="assign-a-hill"]')).toHaveLength(1);
    expect(m2.find('[data-testid="games-hill-departed"]')).toHaveLength(0);
    m2.unmount();
  });
});
