// Bench 2026-10-02 (option B): a hill phone pressed BACK TO HUD in RECAP, MC dropped its station row by design
// (F184), and after NEXT MATCH the LOAD refusal "KING OF THE HILL NEEDS A HILL" told nobody why. MC now RECORDS the
// departure (`state.py _station_departures`), names it in the refusal and on ITEMS, and offers a one-tap RESTORE
// once the SAME utility node is back. The server half is `mcp/tests/test_mc_stations.py`; this file holds the
// mock's parity with it and what the ITEMS card shows.
import { describe, expect, it, vi } from 'vitest';
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
      label: 'PHONE util-a1b2c3', restore: { kind: 'control', team: 255, threshold: 0 } });
    expect(d.line).toMatch(new RegExp(`^HILL ${id} \\(PHONE util-a1b2c3\\) WENT BACK TO HUD AT \\d\\d:\\d\\d: SWITCH IT BACK TO UTILITY, THEN TAP RESTORE IN THE ARMORY`));
  });

  it('the LOAD refusal names the hill that left', async () => {
    const { api, id } = await departedHill();
    await expect(api.loadGame()).rejects.toThrow(new RegExp(`^KING OF THE HILL NEEDS A HILL: HILL ${id} \\(PHONE util-a1b2c3\\) WENT BACK TO HUD AT`));
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

  it('polish r2: a second departure after a return names its own time and reason; the HUD hello after a RELEASE does not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { api } = await departedHill();
      const first = (await api.getState()).station_departures![0];
      api.utilityHello(NODE);                                   // back
      vi.setSystemTime(first.at_ms + 3_600_000);                // an hour on
      await api.releaseStation(NODE);                           // released this time
      let d = (await api.getState()).station_departures![0];
      expect(d).toMatchObject({ reason: 'released', at_ms: first.at_ms + 3_600_000 });
      api.confirmStationHud(NODE);                              // the HUD hello that follows the release
      d = (await api.getState()).station_departures![0];
      expect(d).toMatchObject({ reason: 'released', at_ms: first.at_ms + 3_600_000 });
    } finally { vi.useRealTimers(); }
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
    expect(lines[0].textContent).toMatch(new RegExp(`HILL ${id} \\(PHONE util-a1b2c3\\) WENT BACK TO HUD AT \\d\\d:\\d\\d`));
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
    expect(line[0].textContent).toMatch(new RegExp(`^HILL ${id} \\(PHONE util-a1b2c3\\) WENT BACK TO HUD AT`));
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

describe('polish round 1 (departures)', () => {
  it('M1: a node that came back and left again unassigned is not back any more (mock parity)', async () => {
    const { api } = await departedHill();
    api.utilityHello(NODE);
    expect((await api.getState()).station_departures![0].returned).toBe(true);
    api.confirmStationHud(NODE);
    const d = (await api.getState()).station_departures![0];
    expect(d.returned).toBe(false);
    expect(d.line).not.toMatch(/IT IS BACK/);
    api.utilityHello(NODE);
    await api.releaseStation(NODE);
    expect((await api.getState()).station_departures![0].returned).toBe(false);
  });

  it('M2(a): another hill assigned drops the hill departure, and only that one', async () => {
    const { api } = await departedHill();
    await api.putStation('util-d4e5f6', { kind: 'respawn', team: 'any' });
    api.confirmStationHud('util-d4e5f6');
    expect((await api.getState()).station_departures!.map(d => d.kind).sort()).toEqual(['control', 'respawn']);
    api.utilityHello('util-new');
    await api.putStation('util-new', { kind: 'control', team: 'any' });
    expect((await api.getState()).station_departures!.map(d => d.kind)).toEqual(['respawn']);
  });

  it('M2(b): DISMISS on the away line drops it; an unknown one is a 404 (mock parity)', async () => {
    const { api } = await departedHill();
    const { m, settle } = await armory(api);
    const dismiss = m.find('[data-testid="station-departure-dismiss"] button');
    expect(dismiss).toHaveLength(1);
    await m.click('DISMISS');
    await settle();
    expect(m.find('[data-testid="station-departure"]')).toHaveLength(0);
    expect((await api.getState()).station_departures).toEqual([]);
    await expect(api.dismissDeparture(NODE)).rejects.toMatchObject({ status: 404 });
    m.unmount();
  });

  it('M3: the label names the player whose HUD the phone now is, once bound', async () => {
    const { api, id } = await departedHill();
    const st = await api.getState();
    const bound = st.players.find(p => p.node_id)!;
    api.utilityHello(NODE);
    api.confirmStationHud(NODE, bound.node_id!);   // M1 path: the successor is still recorded
    const d = (await api.getState()).station_departures![0];
    expect(d.label).toBe(`NOW ${bound.display.toUpperCase()}'S HUD`);
    expect(d.line).toMatch(new RegExp(`^HILL ${id} \\(NOW ${bound.display.toUpperCase()}'S HUD\\)`));
  });

  it('L1: RESTORE names the id only while that id is still free', async () => {
    const { api, id } = await departedHill();
    api.utilityHello(NODE);
    const first = await armory(api);
    expect(first.m.find('[data-testid="station-restore"]')[0].textContent).toBe(`RESTORE ▸ HILL ${id}`);
    first.m.unmount();
    await api.putStation('util-d4e5f6', { kind: 'respawn', team: 'any', id });   // the old number, taken
    const { m } = await armory(api);
    expect((await api.getState()).station_departures![0].id_free).toBe(false);
    expect(m.find('[data-testid="station-restore"]')[0].textContent).toBe('RESTORE ▸ HILL');
    m.unmount();
  });

  it('L2: back but out of Wi-Fi says bring it back, not tap, and offers no RESTORE', async () => {
    const { api } = await departedHill();
    api.utilityHello(NODE);
    (api as unknown as { stations: Record<string, { offline?: boolean }> }).stations[NODE].offline = true;
    const d = (await api.getState()).station_departures![0];
    expect(d.line).toMatch(/BRING IT BACK INTO WI-FI/);
    expect(d.line).not.toMatch(/IT IS BACK, SO TAP RESTORE/);
    const { m } = await armory(api);
    expect(m.find('[data-testid="station-restore"]')).toHaveLength(0);
    m.unmount();
  });
});
