// A13.5 / F104 — the ITEMS panel: a utility phone on the net can be assigned and armed from MUSTER.
//
// The server half is `mcp/tests/test_mc_stations.py`. Asserted here is what a python test cannot see:
// the panel exists where the operator stands at muster, an assignment goes through the api and comes
// back as MC-ARMED · GAME n, and the server's attention flags reach the screen. Mounted against the
// same MockBackend `?mock` uses, which mirrors `Session.stations` including the game-byte rule.
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { makeStore, mount, mountScreen, starved } from './harness';
import type { State } from '../src/api/types';

async function muster() {
  const api = new MockBackend();
  let state: State = await api.getState();
  const render = () => (<StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api })}><Armory /></StoreCtx.Provider>);
  const m = await mount(render());
  return { m, api, settle: async () => { state = await api.getState(); await m.update(render()); }, state: () => state };
}

describe('ITEMS — utility phones at muster', () => {
  it('lists the utility phone that said hello, unassigned, and not among the companion phones', async () => {
    const { m, state } = await muster();
    const panel = m.find('[data-testid="items-panel"]');
    expect(panel.length).toBe(1);
    expect(panel[0].textContent).toMatch(/ITEMS \/\/ 1 UTILITY PHONE/);
    expect(panel[0].textContent).toMatch(/NOT ASSIGNED/);
    expect(panel[0].textContent).toMatch(/GAME 1/);
    // the phone's own report is shown so an assignment that never lands reads as the two disagreeing
    expect(panel[0].textContent).toMatch(/PHONE SAYS/);
    expect(state().stations?.[0].node_id).toBe('util-a1b2c3');
    m.unmount();
  });

  it('assigning through the api arms it: MC-ARMED · GAME 1, the phone reports the assignment, no attention', async () => {
    const { m, api, settle } = await muster();
    const v = await api.putStation('util-a1b2c3', { kind: 'respawn', team: 'blue', id: 3, threshold: -70 });
    expect(v.armed?.game).toBe(1);
    expect(v.assigned).toMatchObject({ kind: 'respawn', team: 1, id: 3, threshold: -70 });
    await settle();
    const panel = m.find('[data-testid="items-panel"]')[0];
    expect(panel.textContent).toMatch(/MC-ARMED · GAME 1/);
    expect(panel.textContent).toMatch(/RESPAWN 3/);   // the card title is the short kind + id
    expect(m.find('[data-testid="station-attention"]').length).toBe(0);
    m.unmount();
  });

  it('a control point must be team ANY, ids are unique, and the errors are in the operator\'s voice', async () => {
    const { api } = await muster();
    await expect(api.putStation('util-a1b2c3', { kind: 'control', team: 'blue', id: 9 })).rejects.toThrow(/NEUTRAL/);
    await api.putStation('util-a1b2c3', { kind: 'control', team: 'any', id: 9 });
    await expect(api.putStation('util-other', { kind: 'respawn', team: 'blue', id: 9 })).rejects.toThrow(/already assigned/);
    await expect(api.putStation('util-other', { kind: 'respawn', team: 'blue', id: 0 })).rejects.toThrow(/1\.\.65535/);
  });

  it('the game byte moves on the first push AFTER a match started, and a station that missed it is flagged', async () => {
    // F104 consequence (c): the phone resets its point only when the ARMED game number changes, so this
    // number is the whole between-match reset. Same rule as `Session._next_game_no()`.
    const { m, api, settle, state } = await muster();
    await api.putStation('util-a1b2c3', { kind: 'control', team: 'any', id: 9 });
    await api.pushLobby(true);
    await api.pushLobby(true);                          // an edit at muster is the same match
    await settle();
    expect(state().game_no).toBe(1);
    await api.start(60, true);
    await api.control('end');
    await api.pushLobby(true);                          // muster for match 2
    await settle();
    expect(state().game_no).toBe(2);
    expect(state().stations?.[0].armed?.game).toBe(2);
    expect(m.find('[data-testid="items-panel"]')[0].textContent).toMatch(/MC-ARMED · GAME 2/);
    m.unmount();
  });

  it('the server\'s attention flags reach the card', async () => {
    const d = new MockBackend();
    const base = await d.getState();
    const flagged: State = { ...base, stations: [{ ...base.stations![0], assigned: { kind: 'respawn', team: 1, id: 3, threshold: -74 },
      armed: { game: 1, at: 0, kind: 'respawn', team: 1, id: 3 }, attention: ['ARMED FOR AN OLDER GAME', 'BATTERY LOW'] }], game_no: 2 };
    const m = await mountScreen(<Armory />, { state: flagged, view: 'muster' });
    const att = m.find('[data-testid="station-attention"]');
    expect(att.length).toBe(1);
    expect(att[0].textContent).toMatch(/ARMED FOR AN OLDER GAME/);
    expect(att[0].textContent).toMatch(/BATTERY LOW/);
    m.unmount();
  });

  it('an older server (no `stations` on the snapshot) simply shows no panel', async () => {
    const d = new MockBackend();
    const m = await mountScreen(<Armory />, { state: { ...starved(await d.getState()), stations: undefined, game_no: undefined }, view: 'muster' });
    expect(m.find('[data-testid="items-panel"]').length).toBe(0);
    m.unmount();
  });
});
