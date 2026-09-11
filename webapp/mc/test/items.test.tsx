// A13.5 / F104 — the ITEMS panel: a utility phone on the net can be assigned and armed from MUSTER.
//
// The server half is `mcp/tests/test_mc_stations.py`. Asserted here is what a python test cannot see:
// the panel exists where the operator stands at muster, an assignment goes through the api and comes
// back as MC-ARMED · GAME n, and the server's attention flags reach the screen. Mounted against the
// same MockBackend `?mock` uses, which mirrors `Session.stations` including the game-byte rule.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { CommandBar } from '../src/frame/CommandBar';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { makeStore, mount, mountScreen, starved } from './harness';
import type { Api, State } from '../src/api/types';

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

// Review findings (2026-09-11), each asserted against the rendered screen, not internal state.
describe('ITEMS — the ASSIGN + ARM / CLEAR buttons a person actually presses', () => {
  it('ASSIGN + ARM sends the draft, then the button reads ARMED and is disabled', async () => {
    const { m, api, settle } = await muster();
    const panel = () => m.find('[data-testid="items-panel"]')[0];
    // control: unassigned, so the button is live and reads ASSIGN + ARM before anything is sent
    expect(panel().textContent).toMatch(/NOT ASSIGNED/);
    const sent: unknown[] = [];
    const orig = api.putStation.bind(api);
    api.putStation = (async (node_id, a) => { sent.push({ node_id, a }); return orig(node_id, a); }) as Api['putStation'];
    await m.click('ASSIGN + ARM');
    // the draft starts from the phone's own report (kind respawn, team 1, id 1, threshold -74)
    expect(sent).toEqual([{ node_id: 'util-a1b2c3', a: { kind: 'respawn', team: 1, id: 1, threshold: -74 } }]);
    await settle();
    const btn = m.find('[data-testid="items-panel"] button').find(b => b.textContent?.trim() === 'ARMED') as HTMLButtonElement | undefined;
    expect(btn, `expected an ARMED button, saw: ${panel().textContent}`).toBeTruthy();
    expect(btn!.disabled, 'ARMED is not a live control once the server agrees with the draft').toBe(true);
    m.unmount();
  });

  it('choosing CONTROL hides the team control, shows STARTS NEUTRAL, and PUTs team 255', async () => {
    const { m, api } = await muster();
    const panel = () => m.find('[data-testid="items-panel"]')[0];
    // control: the team Seg is present and STARTS NEUTRAL is not, before CONTROL is picked
    expect(m.find('[role="group"][aria-label="team for util-a1b2c3"]').length).toBe(1);
    expect(panel().textContent).not.toMatch(/STARTS NEUTRAL/);
    await m.click('CONTROL');
    expect(m.find('[role="group"][aria-label="team for util-a1b2c3"]').length, 'team choice is moot for a control point').toBe(0);
    expect(panel().textContent).toMatch(/STARTS NEUTRAL/);
    const sent: { kind: string; team: number | string }[] = [];
    const orig = api.putStation.bind(api);
    api.putStation = (async (node_id, a) => { sent.push(a); return orig(node_id, a); }) as Api['putStation'];
    await m.click('ASSIGN + ARM');
    expect(sent).toEqual([{ kind: 'control', team: 255, id: 1, threshold: -74 }]);
    m.unmount();
  });

  it('CLEAR deletes the assignment and the card returns to NOT ASSIGNED', async () => {
    const { m, api, settle } = await muster();
    await api.putStation('util-a1b2c3', { kind: 'respawn', team: 'blue', id: 3, threshold: -70 });
    await settle();
    const panel = () => m.find('[data-testid="items-panel"]')[0];
    // control: the assignment really did land before CLEAR is pressed
    expect(panel().textContent).toMatch(/MC-ARMED/);
    const deleted: string[] = [];
    const orig = api.deleteStation.bind(api);
    api.deleteStation = (async (node_id: string) => { deleted.push(node_id); return orig(node_id); }) as Api['deleteStation'];
    await m.click('CLEAR');
    expect(deleted).toEqual(['util-a1b2c3']);
    await settle();
    expect(panel().textContent).toMatch(/NOT ASSIGNED/);
    m.unmount();
  });

  it('a rejected PUT reaches the operator instead of being swallowed', async () => {
    const api = new MockBackend();
    const REFUSAL = 'id must be an integer 1..65535 (the station id in the advert)';
    api.putStation = (async () => { throw new Error(REFUSAL); }) as Api['putStation'];
    // the store's own run(): catches the throw and surfaces the message, exactly like store.tsx's `run`
    let error: string | null = null;
    const run: <T,>(fn: () => Promise<T>) => Promise<T | undefined> = async fn => {
      try { error = null; return await fn(); } catch (e) { error = (e as Error).message; return undefined; }
    };
    const state = await api.getState();
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api, run })}><Armory /></StoreCtx.Provider>);
    // control: nothing failed yet
    expect(error).toBeNull();
    await m.click('ASSIGN + ARM');
    expect(error, 'a rejected PUT must reach store.error, not vanish into a swallowed catch').toBe(REFUSAL);
    m.unmount();
    // and the other half of the path: what `run` stored is what the CommandBar shows the operator, verbatim,
    // as the role=alert it renders for `store.error` (the strip every screen's refusal lands in)
    const bar = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api, error })}><CommandBar /></StoreCtx.Provider>);
    const alert = bar.find('[role="alert"]').find(el => el.textContent?.includes(REFUSAL));
    expect(alert, 'the refusal must be readable in the command bar, not only held in state').toBeTruthy();
    bar.unmount();
  });

  it('a phone that disagrees (PHONE SAYS NOT ARMED) gets a live RE-ARM button, not a dead ARMED one', async () => {
    const d = new MockBackend();
    const base = await d.getState();
    const flagged: State = { ...base, stations: [{ ...base.stations![0],
      assigned: { kind: 'respawn', team: 1, id: 3, threshold: -74 },
      armed: { game: 1, at: 0, kind: 'respawn', team: 1, id: 3 }, attention: ['PHONE SAYS NOT ARMED'] }], game_no: 1 };
    const puts: unknown[] = []; let arms = 0;
    const api: Partial<Api> = {
      putStation: (async (...args: unknown[]) => { puts.push(args); return flagged.stations![0]; }) as Api['putStation'],
      armStations: async () => { arms++; return { ok: true, armed: 1, pending: [] }; },
    };
    const m = await mountScreen(<Armory />, { state: flagged, view: 'muster', api });
    const buttons = m.find('[data-testid="items-panel"] button');
    // control: the flag itself is shown (already covered above) — this test is about the button next to it
    expect(m.find('[data-testid="station-attention"]')[0].textContent).toMatch(/PHONE SAYS NOT ARMED/);
    const btn = buttons.find(b => /^(RE-ARM|ARMED)$/.test(b.textContent?.trim() ?? '')) as HTMLButtonElement | undefined;
    expect(btn?.textContent?.trim(), 'the phone disagrees, so the fix (RE-ARM) must be offered, not a stale ARMED').toBe('RE-ARM');
    expect(btn!.disabled, 'RE-ARM must be clickable').toBe(false);
    // RE-ARM of an UNCHANGED assignment is the arm endpoint, never a PUT: a PUT is refused while the match is
    // armed/live (it re-pushes config to every HUD), and a station rebooting mid-match is the common case here
    await m.click('RE-ARM');
    expect(arms, 'RE-ARM arms').toBe(1);
    expect(puts, 'and does not PUT the same assignment (400 mid-match)').toEqual([]);
    m.unmount();
  });

  it('a heartbeat that only changes report.station_id must not drop an in-progress edit', async () => {
    const d = new MockBackend();
    const base = await d.getState();
    const render = (state: State) => (<StoreCtx.Provider value={makeStore({ state, view: 'muster' })}><Armory /></StoreCtx.Provider>);
    const idBox = (m: Awaited<ReturnType<typeof mount>>) => m.find('input[aria-label="station id for util-a1b2c3"]')[0] as HTMLInputElement;
    const m = await mount(render({ ...base, stations: [{ ...base.stations![0] }] }));
    // control: the box starts from the phone's own report (station_id 1), same as the other tests here
    expect(idBox(m).value).toBe('1');
    await act(async () => {
      const el = idBox(m);
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '42');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.blur();
    });
    expect(idBox(m).value, 'the operator\'s edit committed').toBe('42');
    // a new snapshot arrives (the phone's 2s heartbeat) reporting a DIFFERENT id — same node, still unassigned
    await m.update(render({ ...base, stations: [{ ...base.stations![0], report: { ...base.stations![0].report, station_id: 2 } }] }));
    expect(idBox(m).value, 'a report-only change must not remount the card and reset the draft').toBe('42');
    m.unmount();
  });
});
