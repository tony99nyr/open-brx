// MC visual QA round 2 (2026-09-24): the console findings H1, H2 and M2-M12, pinned as fast tests.
//
// jsdom lays nothing out, so the layout findings (M3 name cut, M7 board below the fold, M8 overflow) are
// asserted here on the styles and the structure that produce the layout. The pixel half is the browser
// gate `test/e2e/vqa2.mjs`, against a real demo MC with station and phone stand-ins.
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Api, LiveRow, LiveView, RecapView, State, StationView } from '../src/api/types';
import { Armory } from '../src/screens/Armory';
import { Designer } from '../src/screens/Designer';
import { Games } from '../src/screens/Games';
import { Items } from '../src/screens/Items';
import { Kit } from '../src/screens/Kit';
import { Live } from '../src/screens/Live';
import { Lobby } from '../src/screens/Lobby';
import { Recap } from '../src/screens/Recap';
import { StationAlerts } from '../src/ui/StationAlerts';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx, type Store } from '../src/store';
import { T } from '../src/tokens';
import { demo, fixtureApi, makeStore, mount } from './harness';

const REVERSE = "SETUP: A CONTROL STATION IS ASSIGNED BUT THIS GAME'S OBJECTIVE IS THE GRENADE — every phone ignores "
  + "the station's hill; set OBJECTIVE SOURCE to PHONE (a phone station), or clear the CONTROL station in ITEMS";
const NO_CONTROL = "SETUP: NO CONTROL STATION IS ASSIGNED — this game's objective is a Bluetooth control point "
  + '(station_source phone); assign a utility phone as CONTROL in ITEMS and arm it, or nothing on the field is the hill';
const NO_RESPAWN = 'SETUP: NO RESPAWN STATION IS ASSIGNED — respawn is SCANNER, so a downed player can only come '
  + 'back at a station; assign a utility phone as RESPAWN in ITEMS and arm it';

function station(node_id: string, over: Partial<StationView> = {}): StationView {
  return {
    node_id, assigned: { kind: 'respawn', team: 255, id: 1, threshold: 0, at: 0 },
    armed: { game: 1, at: 0, kind: 'respawn', team: 255, id: 1 }, arm_pending: false,
    report: { kind: 'respawn', team: 255, station_id: 1, live: true, armed: true },
    last_seen_ms: 500, online: true, attention: [], game: 1, ...over,
  };
}

/** Mount `screen` against a MockBackend store with `over` layered onto its state. */
async function screen(node: React.ReactNode, over: Partial<State> = {}, api: Partial<Api> = {}, base: Partial<Store> = {}) {
  const d = await demo();
  const state: State = { ...d.state, ...over };
  const store = makeStore({ ...d, state, api }, base);
  const render = () => <StoreCtx.Provider value={store}>{node}</StoreCtx.Provider>;
  const m = await mount(render());
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  await m.update(render());
  return { m, d, state, store };
}

const setInput = async (el: HTMLInputElement, v: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    el.focus();
    set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
    el.blur();
  });
};

describe('H1 · ASSIGN + ARM leaves the BUBBLE to the station unless the host edits it', () => {
  const unassigned = (platform: string | null = 'android') =>
    station('util-x', { assigned: null, armed: null, report: { kind: 'respawn', team: 255, station_id: 0, threshold: -57 }, platform });

  it('shows DEFAULT until edited, and ASSIGN + ARM sends threshold 0', async () => {
    const calls: Record<string, unknown>[] = [];
    const { m } = await screen(<Items />, { phase: 'muster', stations: [unassigned()] },
      { putStation: async (_id: string, a: Record<string, unknown>) => { calls.push(a); return station('util-x'); } } as Partial<Api>);
    const card = m.find('[data-station-card="util-x"]')[0];
    expect(card.textContent).toContain('DEFAULT (-70, phone)');
    expect(m.find('input[aria-label="threshold for util-x"]').length, 'no number box until the host edits').toBe(0);
    await m.click('ASSIGN + ARM');
    expect(calls.length).toBe(1);
    expect(calls[0].threshold ?? 0, `sent ${JSON.stringify(calls[0])}`).toBe(0);
    m.unmount();
  });

  it('sends the edited number once the host edits the BUBBLE', async () => {
    const calls: Record<string, unknown>[] = [];
    const { m } = await screen(<Items />, { phase: 'muster', stations: [unassigned()] },
      { putStation: async (_id: string, a: Record<string, unknown>) => { calls.push(a); return station('util-x'); } } as Partial<Api>);
    await act(async () => { m.find('[data-bubble-edit="util-x"]')[0].click(); });
    const box = m.find('input[aria-label="threshold for util-x"]')[0] as HTMLInputElement;
    expect(box, 'EDIT opens the number box').toBeTruthy();
    await setInput(box, '-66');
    await m.click('ASSIGN + ARM');
    expect(calls[0].threshold).toBe(-66);
    m.unmount();
  });

  it('an assigned station on the default reads DEFAULT, not "0 dBm"', async () => {
    const { m } = await screen(<Items />, { phase: 'muster', stations: [station('util-y')] });
    const card = m.find('[data-station-card="util-y"]')[0];
    expect(card.textContent).toContain('DEFAULT (-70, phone)');
    expect(card.textContent).not.toMatch(/\b0\s*dBm/);
    m.unmount();
  });

  it('the mock (the ?mock demo) accepts 0 as the station default, like the server', async () => {
    const api = new MockBackend();
    const v = await api.putStation('util-a1b2c3', { kind: 'respawn', team: 'any', id: 4 });
    expect(v.assigned?.threshold).toBe(0);
  });
});

describe('H2 · a CONTROL station under a grenade objective is a conflict, not a reminder', () => {
  const control = station('util-c', { assigned: { kind: 'control', team: 255, id: 9, threshold: 0, at: 0 },
    armed: { game: 1, at: 0, kind: 'control', team: 255, id: 9 }, report: { kind: 'control', team: 255, station_id: 9, armed: true, live: true } });

  it('LOBBY shows the line as an amber conflict block', async () => {
    const { m } = await screen(<Lobby />, { phase: 'lobby', config_warnings: [REVERSE], stations: [control] });
    const block = m.find('[data-testid="setup-conflict"]')[0];
    expect(block, 'an amber conflict block on LOBBY').toBeTruthy();
    expect(block.closest('[role="status"]'), 'a standing status, not an alert').toBeTruthy();
    expect(block.getAttribute('style') ?? '').toContain('rgb(255, 176, 32)');
    expect(block.textContent).toMatch(/every phone ignores its hill/);
    const reminders = m.find('[data-testid="setup-steps"]')[0];
    expect(reminders?.textContent ?? '', 'not also a plain reminder').not.toMatch(/every phone ignores/);
    m.unmount();
  });

  it('ITEMS puts the same line on the CONTROL card, which is not green', async () => {
    const { m } = await screen(<Items />, { phase: 'muster', config_warnings: [REVERSE], stations: [control] });
    const card = m.find('[data-station-card="util-c"]')[0];
    const line = card.querySelector('[data-testid="station-setup-conflict"]');
    expect(line, 'the conflict line is on the CONTROL card').toBeTruthy();
    expect(line!.textContent).toMatch(/every phone ignores its hill/);
    expect(card.getAttribute('style') ?? '').not.toContain('rgb(46, 204, 113)');
    m.unmount();
  });
});

describe('M2 · the ITEMS header counts armed stations apart from the ones needing attention', () => {
  it('3 armed, one on BATTERY LOW: "3/3 ARMED · 1 NEED ATTENTION"', async () => {
    const stations = [station('a'), station('b', { assigned: { kind: 'respawn', team: 255, id: 2, threshold: 0 } }),
      station('c', { assigned: { kind: 'respawn', team: 255, id: 3, threshold: 0 }, attention: ['BATTERY LOW'] })];
    const { m } = await screen(<Items />, { phase: 'muster', stations });
    const t = m.find('[data-testid="items-panel"]')[0].textContent ?? '';
    expect(t).toContain('3/3 ARMED');
    expect(t).toContain('1 NEED ATTENTION');
    m.unmount();
  });
});

describe('M3 · the LOCKED tag sits on its own row', () => {
  it('the title row holds the name only; LOCKED and the status are on the row below', async () => {
    const { m } = await screen(<Items />, { phase: 'lobby', stations: [station('a', { lock_until_ms: Date.now() + 600_000 })] });
    const title = m.find('[data-station-title="a"]')[0];
    expect(title.textContent).toBe('RESPAWN 1');
    const locked = m.find('[data-testid="station-locked"]')[0];
    expect(title.contains(locked), 'LOCKED is not in the name row').toBe(false);
    expect(m.find('[data-station-tags="a"]')[0].contains(locked)).toBe(true);
    m.unmount();
  });
});

describe('M4 · UNLOCK STATIONS is offered on LOBBY while a lock runs', () => {
  it('LOBBY with a live lock shows UNLOCK STATIONS', async () => {
    const { m } = await screen(<Lobby />, { phase: 'lobby', stations: [station('a', { lock_until_ms: Date.now() + 600_000 })] });
    expect(m.find('[data-testid="station-unlock"]').length).toBe(1);
    m.unmount();
  });
});

describe('M5 · Station Alerts carry every attention line of an assigned station, each with its next step', () => {
  it('BATTERY LOW and RESTARTED both show, with their steps', async () => {
    const { m } = await screen(<StationAlerts showUnlock />, { phase: 'live', stations: [
      station('a', { attention: ['BATTERY LOW'] }),
      station('b', { assigned: { kind: 'respawn', team: 255, id: 2, threshold: 0 }, attention: ['STATION #2 RESTARTED'] }),
    ] });
    const t = m.text();
    expect(t).toContain('BATTERY LOW');
    expect(t).toContain('swap or charge before the whistle');
    expect(t).toContain('STATION #2 RESTARTED');
    expect(t).toContain('check the station; it restarted during the lock');
    expect(t, 'a line that names no station says which one').toMatch(/RESPAWN 1/);
    m.unmount();
  });
  it('an unassigned station still shows nothing', async () => {
    const { m } = await screen(<StationAlerts />, { phase: 'lobby', stations: [station('a', { assigned: null, attention: ['BATTERY LOW'] })] });
    expect(m.find('[data-testid="station-alerts"]').length).toBe(0);
    m.unmount();
  });
});

const row = (over: Partial<LiveRow> = {}): LiveRow => ({
  player_id: 'p1', display: 'VIPER', team_id: 'blue',
  kills: 9, deaths: 3, assists: 2, shots: 40, hits: 14, accuracy: 35, kd: 3, streak: 0, medals: [],
  status: 'alive', sync_age_ms: 1200, respawn_in_s: null, ...over,
});
const liveView = (rows: LiveRow[]): LiveView => ({
  match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 600, ends_t: Date.now() + 540_000, score: { blue: 1, green: 2 }, rows,
});

describe('M6 · a row whose gun pools are wrong reads POOLS WRONG and sorts first', () => {
  it('amber POOLS WRONG status, a tinted row, first on the board', async () => {
    const rows = [row(), row({ player_id: 'p2', display: 'NOMAD', kills: 1, pool_stale: 'pool_wrong' })];
    const { m } = await screen(<Live />, { phase: 'live', live: liveView(rows) });
    const status = m.find('[data-live-row="p2"] [data-cell="status"]')[0];
    expect(status.textContent).toBe('POOLS WRONG');
    expect(status.getAttribute('style') ?? '').toContain('rgb(255, 176, 32)');
    expect(m.find('[data-live-row="p2"]')[0].getAttribute('data-row-fault')).toBe('pools');
    const order = m.find('[data-live-row]').map(e => e.getAttribute('data-live-row'));
    expect(order[0], `order ${order}`).toBe('p2');
    m.unmount();
  });
});

describe('M7 · LIVE keeps the board and the operator menu in view', () => {
  it('an opened operator menu scrolls itself into view', async () => {
    const spy = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const { m } = await screen(<Live />, { phase: 'live', live: liveView([row()]) });
      await act(async () => { m.find('[data-live-row-toggle="p1"]')[0].click(); });
      expect(spy, 'the menu asked to be scrolled into view').toHaveBeenCalled();
      m.unmount();
    } finally { Element.prototype.scrollIntoView = orig; }
  });
  it('LIVE renders the station alerts compact', async () => {
    const { m } = await screen(<Live />, { phase: 'live', live: liveView([row()]), stations: [station('a', { attention: ['STATION #1 RESTARTED'] })] });
    expect(m.find('[data-testid="station-alerts"]')[0].getAttribute('data-compact')).toBe('1');
    m.unmount();
  });
});

const ellipsised = (el: Element | undefined) => {
  const s = el?.getAttribute('style') ?? '';
  return /overflow: hidden/.test(s) && /text-overflow: ellipsis/.test(s) && /white-space: nowrap/.test(s);
};

describe('M8 · long names never push past their box', () => {
  const LONG = 'CAPTAINTHUNDERSTRIKE9000';
  it('the event feed: text may shrink, the medal tag may not', async () => {
    const feed = [{ kind: 'kill', t_match_s: 18, text: `${LONG} drew FIRST BLOOD on VIPER`, tag: 'FIRST BLOOD' }] as Store['feed'];
    const { m } = await screen(<Live />, { phase: 'live', live: liveView([row()]) }, {}, { feed });
    const item = m.find('[data-feed-tag="FIRST BLOOD"]')[0];
    const text = item.querySelector('[data-feed-text]');
    expect(text?.getAttribute('style') ?? '').toMatch(/min-width: 0/);
    expect(item.querySelector('[data-feed-medal]')?.getAttribute('style') ?? '').toMatch(/flex: none|flex: 0 0 auto/);
    m.unmount();
  });
  it('the recap table name and the honours card name ellipsise', async () => {
    const recap: RecapView = {
      winner: { team_id: 'blue' }, score: { blue: 3, yellow: 1 }, provisional: false, missing: [],
      honors: [{ award: 'MVP', player_id: 'p1', stat: '3 KILLS' }],
      rows: [{ player_id: 'p1', display: LONG, team_id: 'blue', kills: 3, deaths: 1, assists: 0,
        shots: 20, hits: 8, accuracy: 40, kd: 3, streak: 3, medals: [] }],
    };
    const d = await demo();
    const players = d.state.players.map((p, i) => (i === 0 ? { ...p, player_id: 'p1', display: LONG } : p));
    const { m } = await screen(<Recap />, { phase: 'recap', players, recap });
    expect(ellipsised(m.find('[data-recap-name]')[0]), 'recap table name').toBe(true);
    expect(ellipsised(m.find('[data-honor-name]')[0]), 'honours card name').toBe(true);
    m.unmount();
  });
});

describe('M9 · LOBBY names the updating player and why ARM waits', () => {
  it('an UPDATING chip on the row, and the blocking reason in amber by the button', async () => {
    const d = await demo();
    const players = d.state.players.map(p => ({ ...p, ready: true }));
    const acks = Object.fromEntries(players.slice(1).map(p => [p.player_id, { ok: true, config_id: d.state.config.config_id }]));
    const { m } = await screen(<Lobby />, { phase: 'lobby', players,
      lobby: { ...d.state.lobby, pushed: true, ready: players.length, updating: 1, acks, all_acked: false } });
    const chips = m.find('[data-updating-chip]');
    expect(chips.map(c => c.getAttribute('data-updating-chip'))).toEqual([players[0].player_id]);
    const why = m.find('[data-arm-why]')[0];
    expect(why, 'the reason is on screen beside ARM').toBeTruthy();
    expect(why.getAttribute('style') ?? '').toContain('rgb(255, 176, 32)');
    expect(why.textContent).toMatch(new RegExp(players[0].display));
    m.unmount();
  });
});

describe('M10 · the DESIGNER objective source', () => {
  async function designer() {
    const d = await demo();
    const modes = await d.api.getModes();
    const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' },
      { api: fixtureApi({}, d.api), modes, designerSeed: { mode: 'koth' } } as Partial<Store>);
    const m = await mount(<StoreCtx.Provider value={store}><Designer /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    return m;
  }
  it('after GRENADE is picked, the card text no longer describes a phone control point', async () => {
    const m = await designer();
    const grp = m.find('[role="group"][aria-label="objective source"]')[0];
    const gren = Array.from(grp.querySelectorAll('button')).find(b => /GRENADE/.test(b.textContent ?? ''))!;
    await act(async () => { gren.click(); });
    const brief = m.find('[data-designer-brief]')[0];
    expect(brief.textContent).not.toMatch(/spare phone in the utility role/);
    expect(brief.textContent).toMatch(/grenade/i);
    expect(gren.getAttribute('style') ?? '', 'the option label does not wrap').toMatch(/white-space: nowrap/);
    m.unmount();
  });
  it('no text in the designer is under the 11 px floor', async () => {
    const m = await designer();
    const small = m.find('[style]').filter(e => /font: \d+ 10(\.5)?px/.test(e.getAttribute('style') ?? ''));
    expect(small.map(e => (e.textContent ?? '').slice(0, 30))).toEqual([]);
    m.unmount();
  });
});

describe('M11 · ARMORY says when the game needs a station that is not assigned', () => {
  it('a SETUP line in the header', async () => {
    const { m } = await screen(<Armory />, { phase: 'muster', config_warnings: [NO_CONTROL] });
    const line = m.find('[data-testid="armory-setup"]')[0];
    expect(line, 'a SETUP line in the ARMORY header').toBeTruthy();
    expect(line.textContent).toMatch(/No control station is assigned/);
    m.unmount();
  });
  it('nothing when every needed station is assigned', async () => {
    const { m } = await screen(<Armory />, { phase: 'muster', config_warnings: [] });
    expect(m.find('[data-testid="armory-setup"]').length).toBe(0);
    m.unmount();
  });
});

describe('M12 · the GAMES rail SETUP warnings are sentence case and name no device the server did not', () => {
  it('renders the friendly line, not the shouted server copy', async () => {
    const { m } = await screen(<Games />, { phase: 'build', config_warnings: [NO_RESPAWN] });
    const t = m.text();
    expect(t).toContain('No respawn station is assigned');
    expect(t).not.toContain('NO RESPAWN STATION IS ASSIGNED');
    expect(t).not.toMatch(/utility phone/i);
    m.unmount();
  });
});

describe('polish round 1 (2026-09-24)', () => {
  it('H1: the default label and the edit start follow the kind and the device', async () => {
    const mk = (id: string, kind: 'respawn' | 'powerup', platform: string) =>
      station(id, { assigned: { kind, team: 255, id: id.length, threshold: 0 }, platform });
    const { m } = await screen(<Items />, { phase: 'muster', stations: [mk('ph-r', 'respawn', 'android'), mk('ph-pu', 'powerup', 'android'), mk('stk-r', 'respawn', 'esp32')] });
    const card = (id: string) => m.find(`[data-station-card="${id}"]`)[0].textContent ?? '';
    expect(card('ph-r')).toContain('DEFAULT (-70, phone)');
    expect(card('ph-pu')).toContain('DEFAULT (-74, phone)');
    expect(card('stk-r')).toContain("DEFAULT (the Stick's own)");
    await act(async () => { m.find('[data-bubble-edit="ph-pu"]')[0].click(); });
    expect((m.find('input[aria-label="threshold for ph-pu"]')[0] as HTMLInputElement).value, 'a phone powerup edit starts at -74').toBe('-74');
    m.unmount();
  });

  it('M9: before the push, ARM says a short count inline and keeps the list in the tooltip', async () => {
    const d = await demo();
    const board = d.state.readiness.board.map((r, i) => (i < 6 ? { ...r, status: 'waiting' as const, blockers: [] } : r));
    const { m } = await screen(<Lobby />, { phase: 'lobby', readiness: { ...d.state.readiness, board }, lobby: { ...d.state.lobby, pushed: false } });
    const why = m.find('[data-arm-why]')[0];
    expect(why, 'a short reason by ARM').toBeTruthy();
    expect((why.textContent ?? '').replace('▲', '').trim()).toBe('6 PHONES NOT ARRIVED');
    expect(why.getAttribute('title') ?? '', 'the full list is in the tooltip').toMatch(new RegExp(board[0].sticker));
    expect(why.getAttribute('role'), 'no live region that re-announces on every arrival').toBeNull();
    m.unmount();
  });

  it('M6: a row sorts first only for a fault it shows', async () => {
    const rows = [row(), row({ player_id: 'p2', display: 'NOMAD', kills: 1, pool_stale: 'pool_wrong', status: 'stale', sync_age_ms: 60_000 })];
    const { m } = await screen(<Live />, { phase: 'live', live: liveView(rows) });
    const order = m.find('[data-live-row]').map(e => e.getAttribute('data-live-row'));
    expect(m.find('[data-live-row="p2"] [data-cell="status"]')[0].textContent).toBe('LAST KNOWN');
    expect(order[0], 'a stale row with a last-known pools claim does not jump the ranking').toBe('p1');
    m.unmount();
  });

  it('H2: the block is titled FIX BEFORE ARM, and SETUP CONFLICT only for the CONTROL-under-grenade line', async () => {
    const a = await screen(<Lobby />, { phase: 'lobby', config_warnings: [NO_CONTROL] });
    const t1 = a.m.find('[data-testid="setup-conflict"]')[0]?.textContent ?? '';
    expect(t1).toContain('SETUP: FIX BEFORE ARM');
    expect(t1).not.toContain('SETUP CONFLICT');
    a.m.unmount();
    const b = await screen(<Lobby />, { phase: 'lobby', config_warnings: [REVERSE, NO_RESPAWN] });
    expect(b.m.find('[data-testid="setup-conflict"]')[0]?.textContent ?? '').toContain('SETUP CONFLICT');
    b.m.unmount();
  });

  it('H2: the standing blocks are role=status regions that stay mounted from 0 to N lines', async () => {
    const d = await demo();
    const base: State = { ...d.state, phase: 'lobby', config_warnings: [] };
    let state = base;
    const store = () => makeStore({ ...d, state });
    const node = () => <StoreCtx.Provider value={store()}><Lobby /></StoreCtx.Provider>;
    const m = await mount(node());
    const region = m.find('[data-setup-region]')[0];
    expect(region, 'the region is there with nothing in it').toBeTruthy();
    expect(region.getAttribute('role')).toBe('status');
    state = { ...base, config_warnings: [NO_CONTROL] };
    await m.update(node());
    expect(m.find('[data-setup-region]')[0], 'the same element, not a remount').toBe(region);
    expect(region.textContent).toContain('No control station is assigned');
    expect(m.find('[role="alert"]').filter(e => /control station/i.test(e.textContent ?? '')).length).toBe(0);
    m.unmount();
  });

  it('H2: the CONTROL card line sits in a role=status region that is always there', async () => {
    const control = station('util-c', { assigned: { kind: 'control', team: 255, id: 9, threshold: 0, at: 0 } });
    const { m } = await screen(<Items />, { phase: 'muster', config_warnings: [], stations: [control] });
    const region = m.find('[data-station-card="util-c"] [data-station-setup-region]')[0];
    expect(region?.getAttribute('role')).toBe('status');
    m.unmount();
  });
});

describe('F337 (d): a pushed game keeps stations LOCKED in MUSTER, BUILD and KIT, so UNLOCK is there too', () => {
  const locked = [station('a', { lock_until_ms: Date.now() + 600_000 })];
  for (const [name, node, phase] of [['ARMORY', <Armory />, 'muster'], ['KIT', <Kit />, 'kit'], ['GAMES', <Games />, 'build']] as const) {
    it(`${name}: UNLOCK STATIONS and the note with an active lock, nothing without one`, async () => {
      const on = await screen(node, { phase, stations: locked });
      const box = on.m.find('[data-testid="station-unlock-only"]');
      expect(box.length, `${name} carries the unlock control`).toBe(1);
      expect(box[0].textContent).toContain('STATIONS LOCKED FOR THE LOADED GAME');
      expect(box[0].querySelector('[data-testid="station-unlock"]')).toBeTruthy();
      on.m.unmount();
      const off = await screen(node, { phase, stations: [station('a')] });
      expect(off.m.find('[data-testid="station-unlock-only"]').length, `${name} shows nothing without a lock`).toBe(0);
      off.m.unmount();
    });
  }
  it('unlockOnly sits in an always-mounted role=status region that fills when a lock starts', async () => {
    const d = await demo();
    let state: State = { ...d.state, phase: 'muster', stations: [station('a')] };
    const node = () => <StoreCtx.Provider value={makeStore({ ...d, state })}><StationAlerts unlockOnly /></StoreCtx.Provider>;
    const m = await mount(node());
    const region = m.find('[data-unlock-region]')[0];
    expect(region?.getAttribute('role'), 'the region is there with no lock').toBe('status');
    state = { ...state, stations: [station('a', { lock_until_ms: Date.now() + 600_000 })] };
    await m.update(node());
    expect(m.find('[data-unlock-region]')[0], 'the same element, not a remount').toBe(region);
    expect(region.querySelector('[data-testid="station-unlock-only"]')).toBeTruthy();
    m.unmount();
  });
  it('unlockOnly renders no attention lines', async () => {
    const { m } = await screen(<StationAlerts unlockOnly />, { phase: 'muster', stations: [station('a', { attention: ['BATTERY LOW'] })] });
    expect(m.text()).toBe('');
    m.unmount();
  });
});

// keep the unused-token lint quiet where a style check reads the raw colour
void T;
