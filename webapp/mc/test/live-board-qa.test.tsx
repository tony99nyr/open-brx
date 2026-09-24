// Visual QA 2026-09-23, lane B1: the LIVE board and the spectator board.
//
// H2  the KOTH headline was the KILL score ("BLUE -1") and LIVE had no hill panel.
// H3  after an MC restart every row read "LAST KNOWN · 11d13h AGO": the NEVER_SEEN_MS sentinel printed as an age.
// M5  the operator-menu toggle was 18 px tall.
// M6  rows re-sorted under the pointer, even with a menu open.
// M7  offline, rows still read ALIVE with "0s" sync, and END and RECALL stayed live.
// M8  a 24-character name ran under K and D.
// M24 a team kill's K -1 and K/D -1.0 had no explanation.
//
// jsdom has no layout, so M5 and M8 are asserted on the styles that produce the layout; the browser half
// (real pixel heights and edges) is `test/e2e/live-board.mjs`.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { NEVER_SEEN_MS, type LiveRow, type LiveView, type State, type StationView } from '../src/api/types';
import { Live, holdOrder } from '../src/screens/Live';
import { Spectate } from '../src/screens/Spectate';
import { StoreCtx, type Store } from '../src/store';
import { demo, makeStore, mount } from './harness';

const row = (over: Partial<LiveRow> = {}): LiveRow => ({
  player_id: 'p1', display: 'VIPER', team_id: 'blue',
  kills: 9, deaths: 3, assists: 2, shots: 40, hits: 14, accuracy: 35, kd: 3, streak: 0, medals: [],
  status: 'alive', sync_age_ms: 1200, respawn_in_s: null, ...over,
});
const liveView = (rows: LiveRow[], over: Partial<LiveView> = {}): LiveView => ({
  match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 600,
  ends_t: Date.now() + 540_000, score: { blue: -1, green: 2 }, rows, ...over,
});

async function board(screen: 'live' | 'spectate', over: Partial<State> = {}, rows: LiveRow[] = [row()], lvOver: Partial<LiveView> = {}, base: Partial<Store> = {}) {
  const d = await demo();
  const state: State = { ...d.state, phase: 'live', live: liveView(rows, lvOver), ...over };
  const store = makeStore({ ...d, state, view: 'live' }, base);
  const m = await mount(<StoreCtx.Provider value={store}>{screen === 'live' ? <Live /> : <Spectate />}</StoreCtx.Provider>);
  return { m, d, state, store };
}

/** a koth config, blue (tid 1) v green (tid 3), exactly as MC defaults it */
async function kothOver(): Promise<Partial<State>> {
  const d = await demo();
  const teams = [{ team_id: 'blue', name: 'BLUE TEAM', color: 'blue', tid: 1 }, { team_id: 'green', name: 'GREEN TEAM', color: 'green', tid: 3 }];
  return { config: { ...d.state.config, mode: 'koth', teams, scoring: { frag_limit: null, win_by: 'objective' } }, teams };
}
const POSS = { by_team: { blue: 214, green: 131 }, neutral_s: 20, sites: 1, reports: 2, observed_s: 441, of_s: 600 };

describe('H2 · the KOTH board headlines possession', () => {
  it('LIVE shows held time, not the kill score, and a hill panel with the tally', async () => {
    const { m } = await board('live', await kothOver(), [row(), row({ player_id: 'p2', display: 'GHOST', team_id: 'green' })], { possession: POSS });
    const score = (id: string) => m.find(`[data-team-score="${id}"]`)[0]?.textContent;
    expect(score('blue')).toBe('3:34');
    expect(score('green')).toBe('2:11');
    expect(m.find('[data-team-sub="blue"]')[0]?.textContent, 'the kill score is still there, as a sub-line').toBe('KILLS -1');
    const panel = m.find('[data-testid="hill-panel"]')[0];
    expect(panel, 'LIVE has a hill panel').toBeTruthy();
    expect(panel.textContent).toContain('HILL // POSSESSION');
    expect(m.find('[data-hill-team]').map(e => e.getAttribute('data-hill-team'))).toEqual(['blue', 'green']);
    expect(panel.textContent).toContain('OWNER NOT REPORTED LIVE');
    expect(panel.textContent).toContain('BEST COVERAGE 7:21 OF 10:00');
    m.unmount();
  });

  it('with no possession reported, the headline is a dash and the panel says why', async () => {
    const { m } = await board('live', await kothOver());
    expect(m.find('[data-team-score="blue"]')[0]?.textContent).toBe('—');
    expect(m.find('[data-hill-none]').length).toBe(1);
    expect(m.text()).not.toMatch(/^.*BLUE-1/);
    m.unmount();
  });

  it('names the owner from an assigned control station, and marks a station out of reach', async () => {
    const station = (online: boolean, owner: number): StationView => ({
      node_id: 'st1', assigned: { kind: 'control', team: 255, id: 7 } as StationView['assigned'], armed: null, arm_pending: false,
      report: { control: { owner } }, last_seen_ms: 1000, online, attention: [], game: 1,
    });
    const k = await kothOver();
    let r = await board('live', { ...k, stations: [station(true, 3)] }, [row()], { possession: POSS });
    expect(r.m.find('[data-hill-owner]')[0].textContent).toBe('HELD BY GREEN TEAM');
    r.m.unmount();
    r = await board('live', { ...k, stations: [station(false, 2)] }, [row()], { possession: POSS });
    expect(r.m.find('[data-hill-owner]')[0].textContent).toBe('NOBODY HOLDS IT (LAST REPORT, STATION OUT OF REACH)');
    r.m.unmount();
  });

  it('a kill-scored game keeps the kill headline and has no hill panel', async () => {
    const { m } = await board('live', {}, [row()], { score: { blue: 9, yellow: 4 } });
    expect(m.find('[data-team-score="blue"]')[0]?.textContent).toBe('9');
    expect(m.find('[data-testid="hill-panel"]').length).toBe(0);
    m.unmount();
  });

  it('SPECTATE shows held time and the hill line, never the negative kill score', async () => {
    const { m } = await board('spectate', await kothOver(), [row()], { possession: POSS });
    expect(m.find('[data-spectate="score"]').map(e => e.textContent)).toEqual(['3:34', '2:11']);
    expect(m.find('[data-spectate="hill"]')[0]?.textContent).toBe('HILL: OWNER NOT REPORTED LIVE · BEST COVERAGE 7:21');
    expect(m.text()).toContain('HILL TIME');
    m.unmount();
  });
});

describe('H3 · a never-heard row is not "11d13h ago"', () => {
  it('says NOT HEARD and prints no age', async () => {
    const { m } = await board('live', {}, [row({ status: 'stale', sync_age_ms: NEVER_SEEN_MS })]);
    expect(m.find('[data-cell="status"]')[0].textContent).toBe('NOT HEARD');
    expect(m.find('[data-cell="sync"]')[0].textContent).toBe('—');
    expect(m.text()).not.toMatch(/\d+d\d+h/);
    m.unmount();
  });

  it('a real stale row still reads LAST KNOWN with its age', async () => {
    const { m } = await board('live', {}, [row({ status: 'stale', sync_age_ms: 20_000 })]);
    expect(m.find('[data-cell="status"]')[0].textContent).toBe('LAST KNOWN');
    expect(m.find('[data-cell="sync"]')[0].textContent).toBe('20s AGO');
    m.unmount();
  });
});

describe('M5 · M8 · the row toggle', () => {
  it('is at least 36 px tall and ellipsises a 24-character name with the full name on its title', async () => {
    const name = 'ABCDEFGHIJKLMNOPQRSTUVWX';
    const { m } = await board('live', {}, [row({ display: name })]);
    const btn = m.find('[data-live-row-toggle]')[0];
    expect(parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(36);
    expect(btn.style.maxWidth).toBe('100%');
    expect(btn.title).toContain(name);
    const nm = m.find('[data-row-name]')[0];
    expect(nm.textContent).toBe(name);
    expect(nm.style.textOverflow).toBe('ellipsis');
    expect(nm.style.whiteSpace).toBe('nowrap');
    expect(nm.style.overflow).toBe('hidden');
    m.unmount();
  });
});

describe('M6 · the order holds while the operator is on the board', () => {
  it('holdOrder keeps the previous order and says when it differs', () => {
    const a = { player_id: 'a' }, b = { player_id: 'b' }, c = { player_id: 'c' };
    expect(holdOrder([b, a], ['a', 'b'], false)).toEqual({ rows: [b, a], held: false });
    expect(holdOrder([b, a, c], ['a', 'b'], true)).toEqual({ rows: [a, b, c], held: true });
    expect(holdOrder([a, b], ['a', 'b'], true).held).toBe(false);
  });

  it('a new snapshot under the pointer does not move the rows, and moving away re-sorts', async () => {
    const d = await demo();
    const mk = (va: number, gh: number): State => ({ ...d.state, phase: 'live',
      live: liveView([row({ player_id: 'va', display: 'VIPER', kills: va }), row({ player_id: 'gh', display: 'GHOST', kills: gh })]) });
    const store = (s: State) => makeStore({ ...d, state: s, view: 'live' });
    const m = await mount(<StoreCtx.Provider value={store(mk(5, 1))}><Live /></StoreCtx.Provider>);
    const order = () => m.find('[data-live-row]').map(e => e.getAttribute('data-live-row'));
    expect(order()).toEqual(['va', 'gh']);
    const rows = m.find('[data-live-rows]')[0];
    await act(async () => { rows.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); });
    await m.update(<StoreCtx.Provider value={store(mk(5, 9))}><Live /></StoreCtx.Provider>);
    expect(order(), 'held under the pointer').toEqual(['va', 'gh']);
    expect(m.find('[data-testid="order-held"]').length, 'and the screen says so').toBe(1);
    await act(async () => { rows.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })); });
    expect(order(), 're-sorted once the pointer leaves').toEqual(['gh', 'va']);
    expect(m.find('[data-testid="order-held"]').length).toBe(0);
    m.unmount();
  });
});

describe('M7 · MC offline', () => {
  it('rows read UNKNOWN with no sync age, and END and RECALL are disabled with a reason', async () => {
    const { m } = await board('live', {}, [row()], {}, { connected: false });
    expect(m.find('[data-cell="status"]')[0].textContent).toBe('UNKNOWN');
    expect(m.find('[data-cell="sync"]')[0].textContent).toBe('—');
    expect(m.find('[data-testid="live-offline"]').length).toBe(1);
    const btn = (t: string) => (m.find('button') as HTMLButtonElement[]).find(b => b.textContent?.trim() === t)!;
    expect(btn('END MATCH EARLY').disabled).toBe(true);
    expect(btn('RECALL').disabled).toBe(true);
    expect(btn('RECALL').title).toContain('MC is offline');
    expect(m.find('[data-testid="controls-offline"]')[0].textContent).toContain('MC IS OFFLINE');
    m.unmount();
  });

  it('online, the same row reads ALIVE and the controls are live', async () => {
    const { m } = await board('live', {}, [row()]);
    expect(m.find('[data-cell="status"]')[0].textContent).toBe('ALIVE');
    const end = (m.find('button') as HTMLButtonElement[]).find(b => b.textContent?.trim() === 'END MATCH EARLY')!;
    expect(end.disabled).toBe(false);
    m.unmount();
  });
});

describe('M24 · a team-kill penalty is explained', () => {
  it('a negative K carries the note on the cell and in a legend line', async () => {
    const { m } = await board('live', {}, [row({ kills: -1, kd: -1 }), row({ player_id: 'p2', display: 'GHOST' })]);
    const k = m.find('[data-cell="k"]').find(e => e.textContent === '-1')!;
    expect(k.title).toContain('TEAM KILL');
    expect(m.find('[data-cell="kd"]').find(e => e.textContent === '-1.0')!.title).toContain('TEAM KILL');
    expect(m.find('[data-testid="team-kill-note"]')[0]?.textContent).toContain('A TEAM KILL COSTS THE SHOOTER ONE KILL');
    expect(m.find('[data-col-head="k"]')[0].title).toContain('TEAM KILL');
    m.unmount();
  });

  it('no legend line when nobody is below zero', async () => {
    const { m } = await board('live', {}, [row()]);
    expect(m.find('[data-testid="team-kill-note"]').length).toBe(0);
    m.unmount();
  });
});
