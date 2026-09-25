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
  it('lists the utility phones that said hello, unassigned, and not among the companion phones', async () => {
    const { m, state } = await muster();
    const panel = m.find('[data-testid="items-panel"]');
    expect(panel.length).toBe(1);
    // F106(i): the mock seeds TWO utility phones so ?mock can demo OUT OF WI-FI / ARM PENDING (below)
    // without live hardware — the panel header count is the cheapest proof both are actually listed.
    expect(panel[0].textContent).toMatch(/ITEMS \/\/ 2 STATIONS/);
    expect(panel[0].textContent).toMatch(/NOT ASSIGNED/);
    expect(panel[0].textContent).toMatch(/GAME 1/);
    // the phone's own report is shown so an assignment that never lands reads as the two disagreeing
    expect(panel[0].textContent).toMatch(/PHONE SAYS/);
    expect(state().stations?.[0].node_id).toBe('util-a1b2c3');
    m.unmount();
  });

  it('F106(i): the seeded second phone shows OUT OF WI-FI and ARM PENDING with no operator action', async () => {
    const { m, state } = await muster();
    expect(state().stations?.[1]).toMatchObject({ node_id: 'util-d4e5f6', online: false, arm_pending: true });
    const panel = m.find('[data-testid="items-panel"]')[0];
    // CONTROL: this is the ONLY station that is offline, so the string is unambiguous evidence the
    // panel actually renders the `online: false` case, not just a hard-coded label.
    expect(panel.textContent).toMatch(/OUT OF WI-FI/);
    expect(panel.textContent).toMatch(/ARM PENDING/);
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
    expect(state().game_byte).toBe(2);
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

  it('X10: the panel reads `game_byte`, and falls back to `game_no` from an older server', async () => {
    const d = new MockBackend();
    const base = await d.getState();
    const panel = async (st: State) => {
      const m = await mountScreen(<Armory />, { state: st, view: 'muster' });
      const text = m.find('[data-testid="items-panel"]')[0].textContent;
      m.unmount();
      return text;
    };
    expect(await panel({ ...base, game_byte: 7, game_no: 3 })).toMatch(/GAME 7/);
    expect(await panel({ ...base, game_byte: undefined, game_no: 3 })).toMatch(/GAME 3/);
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
    expect(sent).toEqual([{ node_id: 'util-a1b2c3', a: { kind: 'respawn', team: 1, threshold: 0 } }]);
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
    expect(sent).toEqual([{ kind: 'control', team: 255, threshold: 0 }]);
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
    const card = (m: Awaited<ReturnType<typeof mount>>) => m.find('[data-station-card="util-a1b2c3"]')[0] as HTMLElement;
    const m = await mount(render({ ...base, stations: [{ ...base.stations![0] }] }));
    // F364: the id is MC's, so the draft that must survive is the kind pick
    await act(async () => { ([...card(m).querySelectorAll('button')].find(b => b.textContent === 'CONTROL') as HTMLButtonElement).click(); });
    expect(card(m).textContent, 'the operator\'s kind pick committed').toMatch(/STARTS NEUTRAL/);
    await m.update(render({ ...base, stations: [{ ...base.stations![0], report: { ...base.stations![0].report, station_id: 2 } }] }));
    expect(card(m).textContent, 'a report-only change must not remount the card and reset the draft').toMatch(/STARTS NEUTRAL/);
    m.unmount();
  });

  // A41 (field 2026-09-12): a phone stuck in utility mode had no MC-side cure at all -- the server half
  // is `mcp/tests/test_mc_stations.py`; this is the button an operator actually presses.
  //
  // Review finding 2026-09-13: RELEASE used to fire on a single tap, styled identically to CLEAR right
  // beside it -- but RELEASE moves the phone off the page holding its own socket, in ANY phase
  // including LIVE, and nothing on this console can reach it again once it lands (the fix is walking
  // to the tagger and doing the seven-tap gesture). CLEAR only drops the assignment and is fully
  // recoverable from here. These three tests are the ones that would have caught the bug: the first
  // FAILS outright against the old single-tap code (it asserts zero calls after one tap, where the old
  // code made exactly one), and the second checks the confirm actually names what tapping again does,
  // not just "are you sure".
  it('one tap on RELEASE ▸ HUD sends nothing — it only raises the confirm', async () => {
    const { m, api } = await muster();
    const sent: string[] = [];
    api.releaseStation = (async (node_id: string) => { sent.push(node_id); return { ok: true }; }) as Api['releaseStation'];
    await m.click('RELEASE ▸ HUD');   // util-a1b2c3 (seeded ONLINE) is the first card in DOM order
    expect(sent, 'a single tap must never move the phone off this page — that is the whole bug').toEqual([]);
    m.unmount();
  });

  it('the RELEASE confirm names the actual consequence, not just "are you sure"', async () => {
    const { m } = await muster();
    await m.click('RELEASE ▸ HUD');
    const confirm = m.find('[data-testid="confirm-switch"]');
    expect(confirm.length, 'the tap-again confirm must appear').toBe(1);
    // the field consequence (blast radius), not a generic warning
    expect(confirm[0].textContent).toMatch(/EVEN LIVE/);
    expect(confirm[0].textContent).toMatch(/NOTHING ON THIS CONSOLE CAN REACH IT AGAIN/);
    expect(confirm[0].textContent).toMatch(/SEVEN-TAP GESTURE/);
    // and it says what the SECOND tap does, so tapping the same button again is not a guess
    expect(confirm[0].textContent).toMatch(/TAP RELEASE ▸ HUD AGAIN/);
    m.unmount();
  });

  it('tapping RELEASE ▸ HUD again (the confirm) calls releaseStation and reports SENT once it lands', async () => {
    const { m, api } = await muster();
    const sent: string[] = [];
    const orig = api.releaseStation.bind(api);
    api.releaseStation = (async (node_id: string) => { sent.push(node_id); return orig(node_id); }) as Api['releaseStation'];
    await m.click('RELEASE ▸ HUD');   // 1st tap: confirm only
    expect(sent).toEqual([]);
    await m.click('RELEASE ▸ HUD');   // 2nd tap, same button: actually sends it
    expect(sent).toEqual(['util-a1b2c3']);
    expect(m.find('[data-testid="items-panel"]')[0].textContent).toMatch(/SENT/);
    // and the confirm is gone again — it does not linger once acted on
    expect(m.find('[data-testid="confirm-switch"]').length).toBe(0);
    m.unmount();
  });

  it('F184: accepted RELEASE clears deployment, then the confirmed HUD snapshot removes the ITEMS card', async () => {
    const { m, api, settle, state } = await muster();
    await api.putStation('util-a1b2c3', { kind: 'respawn', team: 'blue', id: 3 });
    await api.releaseStation('util-a1b2c3');
    await settle();
    expect(state().stations?.find(s => s.node_id === 'util-a1b2c3')?.assigned).toBeNull();
    expect(m.find('[data-testid="items-panel"]')[0].textContent).toMatch(/ITEMS \/\/ 2 STATIONS/);

    api.confirmStationHud('util-a1b2c3');
    await settle();
    expect(state().stations?.some(s => s.node_id === 'util-a1b2c3')).toBe(false);
    expect(m.find('[data-testid="items-panel"]')[0].textContent).toMatch(/ITEMS \/\/ 1 STATION(?!S)/);
    m.unmount();
  });

  it('CANCEL backs out of the RELEASE confirm without ever calling the api', async () => {
    const { m, api } = await muster();
    const sent: string[] = [];
    api.releaseStation = (async (node_id: string) => { sent.push(node_id); return { ok: true }; }) as Api['releaseStation'];
    await m.click('RELEASE ▸ HUD');
    expect(m.find('[data-testid="confirm-switch"]').length).toBe(1);
    await m.click('CANCEL');
    expect(m.find('[data-testid="confirm-switch"]').length, 'CANCEL must drop the confirm').toBe(0);
    expect(sent, 'CANCEL must never send the phone away').toEqual([]);
    // and RELEASE ▸ HUD is back to its first-tap state, not stuck mid-confirm
    await m.click('RELEASE ▸ HUD');
    expect(sent).toEqual([]);
    m.unmount();
  });

  it('RELEASE ▸ HUD is disabled for a station with no live socket (OUT OF WI-FI)', async () => {
    const { m } = await muster();
    const buttons = m.find('[data-testid="items-panel"] button') as HTMLButtonElement[];
    const release = buttons.filter(b => b.textContent?.trim() === 'RELEASE ▸ HUD');
    // F106(i)'s two seeded phones: util-a1b2c3 online, util-d4e5f6 OUT OF WI-FI -- nothing to push to
    expect(release.length).toBe(2);
    expect(release[0].disabled, 'util-a1b2c3 has a live socket').toBe(false);
    expect(release[1].disabled, 'util-d4e5f6 is offline: there is no socket to push a release to').toBe(true);
    m.unmount();
  });
});
