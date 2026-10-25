import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { MockBackend } from '../src/mock/backend';
import * as compact from '../src/ui/Compact';
import type { LiveRow, LiveView, State } from '../src/api/types';
import { Armory } from '../src/screens/Armory';
import { Armed } from '../src/screens/Armed';
import { Build } from '../src/screens/Build';
import { Catalog } from '../src/screens/Catalog';
import { Debug } from '../src/screens/Debug';
import { Items } from '../src/screens/Items';
import { Kit } from '../src/screens/Kit';
import { Live } from '../src/screens/Live';
import { Lobby } from '../src/screens/Lobby';
import { OperatorMenu } from '../src/screens/OperatorMenu';
import { Spectate } from '../src/screens/Spectate';
import { MiscLoadoutsFields, SlotFields, SpawnFields } from '../src/screens/presets/editors';
import { PerkHero, SlotCard, WeaponHero } from '../src/screens/kit/cards';
import { CommandBar } from '../src/frame/CommandBar';
import { ReportPanel } from '../src/ui/ReportPanel';
import { StoreCtx } from '../src/store';
import { demo, makeStore, mount, mountScreen, starved, type Mounted } from './harness';
import notes from './gallery/help2-notes.json';

const note = (id: string) => {
  const found = notes.find(n => n.id === id);
  if (!found) throw new Error(`Missing approved note ${id}`);
  return found;
};

function cut(m: Mounted, id: string, anchor: string) {
  expect(m.find(anchor).length, `${id}: state did not render`).toBeGreaterThan(0);
  const old = note(id).current.split('{')[0].trim();
  expect(old.length, `${id}: no stable old wording`).toBeGreaterThan(5);
  expect(m.text().toLowerCase(), `${id}: old note remains`).not.toContain(old.toLowerCase());
}

function absent(m: Mounted, id: string, successor: string, text: string) {
  const old = note(id).current.split('{')[0].trim();
  expect(old.length, `${id}: no stable old wording`).toBeGreaterThan(5);
  expect(m.text().toLowerCase(), `${id}: old note remains`).not.toContain(old.toLowerCase());
  const next = m.find(successor)[0];
  expect(next, `${id}: replacement did not render`).toBeTruthy();
  expect(next.textContent, `${id}: replacement wording`).toContain(text);
}

function inline(m: Mounted, id: string, anchor: string) {
  const el = m.find(anchor)[0];
  expect(el, `${id}: state did not render`).toBeTruthy();
  expect(el.textContent, `${id}: approved short line`).toContain(note(id).wording.replace('{wanted}', 'KIT'));
}

async function info(m: Mounted, id: string, testid: string) {
  const button = m.find(`[data-testid="${testid}"]`)[0] as HTMLButtonElement | undefined;
  expect(button, `${id}: INFO button`).toBeTruthy();
  expect(button!.tagName, `${id}: a real button`).toBe('BUTTON');
  expect(button!.getAttribute('aria-expanded'), `${id}: detail starts closed`).toBe('false');
  expect(m.text(), `${id}: detail starts hidden`).not.toContain(note(id).wording);
  await act(async () => { button!.click(); });
  expect(button!.getAttribute('aria-expanded'), `${id}: click pins detail`).toBe('true');
  expect(m.text(), `${id}: approved detail`).toContain(note(id).wording);
}

const liveRow = (over: Partial<LiveRow> = {}): LiveRow => ({
  player_id: 'p1', display: 'VIPER', team_id: 'blue', kills: -1, deaths: 1, assists: 0,
  shots: 10, hits: 2, accuracy: 20, kd: -1, streak: 0, medals: [], status: 'alive',
  sync_age_ms: 1000, respawn_in_s: null, ...over,
});
const liveView = (over: Partial<LiveView> = {}): LiveView => ({
  match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 600,
  ends_t: Date.now() + 540_000, score: { blue: -1, purple: 0 }, rows: [liveRow()], ...over,
});

describe('F599 phase 2 approved help copy', () => {
  it('LIVE empty state removes the old explanation', async () => {
    const d = await demo();
    const m = await mountScreen(<Live />, { ...d, state: starved(d.state), view: 'live' });
    expect(m.text()).toContain('No match is live.');
    absent(m, 'live-no-match', '.screen p', 'No match is live.');
    m.unmount();
  });

  it('LIVE board and feed remove the old notes and open feed INFO', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'live', live: liveView() };
    const store = makeStore({ ...d, state, view: 'live' }, {
      feed: [
        { t_match_s: 22, text: 'MC withheld a call', kind: 'alert', tag: 'WITHHELD' },
        { t_match_s: 25, text: 'VIPER eliminated GHOST', kind: 'kill', tag: 'AFTER WHISTLE' },
      ],
    });
    const m = await mount(<StoreCtx.Provider value={store}><Live /></StoreCtx.Provider>);
    expect(m.find('[data-live-row="p1"]').length).toBe(1);
    expect(m.find('[data-feed-kind]').length).toBeGreaterThan(0);
    absent(m, 'live-team-kill', '[data-cell="k"]', '-1');
    expect(m.find('[data-feed-tag="AFTER WHISTLE"]').length).toBe(1);
    absent(m, 'live-after-whistle', '[data-feed-tag="AFTER WHISTLE"]', 'AFTER WHISTLE');
    await info(m, 'live-withheld', 'help2-live-feed-info');
    m.unmount();
    const empty = await mount(<StoreCtx.Provider value={makeStore({ ...d, state, view: 'live' })}><Live /></StoreCtx.Provider>);
    expect(empty.text()).toContain('EVENT FEED // LIVE');
    cut(empty, 'live-first-sync', '[role="status"][aria-live="polite"]');
    empty.unmount();
  });

  it('LIVE keeps the row order while a menu is open without the old sorting note', async () => {
    const d = await demo();
    const first: State = { ...d.state, phase: 'live', live: liveView({ rows: [liveRow({ kills: 9 }), liveRow({ player_id: 'p2', display: 'GHOST', kills: 1 })] }) };
    const render = (state: State) => <StoreCtx.Provider value={makeStore({ ...d, state, view: 'live' })}><Live /></StoreCtx.Provider>;
    const m = await mount(render(first));
    await act(async () => { m.find('[data-live-row-toggle="p1"]')[0].click(); });
    const second = { ...first, live: liveView({ rows: [liveRow({ kills: 1 }), liveRow({ player_id: 'p2', display: 'GHOST', kills: 9 })] }) };
    await m.update(render(second));
    expect(m.find('[data-live-rows="1"][data-order-held="1"]').length).toBe(1);
    absent(m, 'live-order-held', '[data-live-row="p1"]', 'VIPER');
    m.unmount();
  });

  it('LIVE hill keeps the winner rule in a closed INFO detail', async () => {
    const d = await demo();
    const teams = [{ team_id: 'blue', name: 'BLUE TEAM', color: 'blue', tid: 1 }, { team_id: 'purple', name: 'PURPLE TEAM', color: 'purple', tid: 3 }];
    const state: State = { ...d.state, phase: 'live',
      config: { ...d.state.config, mode: 'koth', teams, scoring: { frag_limit: null, win_by: 'objective' } },
      teams, live: liveView() };
    const m = await mountScreen(<Live />, { ...d, state, view: 'live' });
    expect(m.find('[data-hill-none]').length).toBe(1);
    await info(m, 'live-hill-none', 'help2-live-hill-info');
    m.unmount();
  });

  it('ARMED with no schedule shows navigation without the old note', async () => {
    const d = await demo();
    const m = await mountScreen(<Armed />, { ...d, state: { ...d.state, phase: 'armed', start: undefined }, view: 'armed' });
    expect(m.text()).toContain('BACK TO LOBBY');
    cut(m, 'armed-no-schedule', '.screen');
    m.unmount();
  });

  it('KIT empty slot shows its short action and hides the old hero and metric caveats', async () => {
    const slot = await mount(<SlotCard label="PERK" slot="perk" active onClick={() => {}} kind="none" />);
    expect(slot.text()).toContain('NO PERK');
    inline(slot, 'kit-empty-slot', '[role="button"]');
    expect(slot.text()).not.toContain('Rides beside the weapons');
    slot.unmount();
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, state: { ...d.state, phase: 'kit' }, view: 'kit', selPlayer: 'p2' });
    const perkCard = m.find('[role="button"]').find(el => (el.textContent ?? '').startsWith('PERK'));
    expect(perkCard, 'the empty perk slot is available').toBeTruthy();
    await act(async () => { perkCard!.click(); });
    expect(m.text()).toContain('NO PERK');
    cut(m, 'kit-empty-hero', '.screen');
    m.unmount();
  });

  it('KIT weapon and perk heroes omit the old card notes', async () => {
    const d = await demo();
    const weapon = { ...d.weapons[0], verified: false, dual_emitter: true, dmg_per_hit: d.weapons[0].dmg_per_hit ?? 10 };
    const w = await mount(<StoreCtx.Provider value={makeStore(d)}><WeaponHero w={weapon} slot="primary" sp={d.state.players[0]} pushed={false} verdicts={{}} setVerdicts={() => {}} /></StoreCtx.Provider>);
    expect(w.text()).toContain('DAMAGE / PULL');
    expect(w.find('span[title]').find(e => e.textContent === 'TUNED · NOT STOCK')?.title).toBe('Retuned from the captured Callsign frame for balance, not the stock numbers');
    cut(w, 'kit-dual-emitter', 'div');
    w.unmount();
    const p = await mount(<PerkHero k={d.perks[0]} />);
    expect(p.text()).toContain(d.perks[0].name);
    cut(p, 'kit-passive-perk', 'div');
    p.unmount();
  });

  it('ITEMS shows disabled power-ups behind INFO and the short lock reason', async () => {
    const d = await demo();
    const api = new Proxy(d.api, { get(target, key, receiver) {
      if (key === 'getPowerups') return async () => ({ enabled: false, presets: [] });
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const state: State = { ...d.state, phase: 'armed' };
    const m = await mountScreen(<Items />, { ...d, state, api, view: 'muster' });
    await m.click('POWERUP');
    expect(m.find('[data-testid="item-note"]').length).toBe(1);
    expect(m.find('[data-testid="item-picker"]').length).toBe(0);
    await info(m, 'items-powerups-off', 'help2-items-picker-info');
    m.unmount();

    const locked = await mountScreen(<Items />, { ...d, state, view: 'muster' });
    await locked.click('POWERUP');
    expect(locked.find('[data-testid="item-picker"]').length).toBe(1);
    inline(locked, 'items-locked', '[data-testid="item-locked"]');
    locked.unmount();
  });

  it('ITEMS leaves the item-list loading note empty while the request is pending', async () => {
    const d = await demo();
    const pending = new Promise<Awaited<ReturnType<typeof d.api.getPowerups>>>(() => {});
    const m = await mountScreen(<Items />, { ...d, api: { getPowerups: () => pending }, view: 'muster' });
    await m.click('POWERUP');
    expect(m.find('[data-testid="item-picker"]').length).toBe(0);
    expect(m.find('[data-testid="item-note"]').length, 'loading has no empty note stub').toBe(0);
    expect(m.find('[data-testid="item-picker"]').length, 'loading does not show stale choices').toBe(0);
    m.unmount();
  });

  it('ITEMS hill setup distinguishes no station from a station ready to assign', async () => {
    const d = await demo();
    const none = await mount(<StoreCtx.Provider value={makeStore({ ...d, state: { ...d.state, stations: [] } }, { focusHill: true })}><Items /></StoreCtx.Provider>);
    expect(none.find('[data-testid="items-hill-focus"]').length).toBe(1);
    await info(none, 'items-focus-hill-no-station', 'help2-items-hill-info');
    expect(none.text()).toContain('tap an idle phone seven times to switch it to utility station mode.');
    none.unmount();
    const some = await mount(<StoreCtx.Provider value={makeStore(d, { focusHill: true })}><Items /></StoreCtx.Provider>);
    inline(some, 'items-focus-hill-assign', '[data-testid="items-hill-focus"]');
    cut(some, 'items-section-hint', '[data-testid="items-panel"]');
    some.unmount();
  });

  it('BUILD removes the title note and opens the spawn and loadout explanations', async () => {
    const d = await demo();
    const build = await mountScreen(<Build />, { ...d, view: 'designer' });
    expect(build.text()).toContain('BUILD');
    cut(build, 'build-title-note', '[data-testid="build-tab-life"]');
    build.unmount();

    const spawn = await mount(<SpawnFields value={{ type: 'scanner', delay_s: 15 }} builtins={[]} onChange={() => {}} />);
    expect(spawn.text()).toContain('GATE');
    await info(spawn, 'spawn-delay', 'help2-spawn-info');
    expect(spawn.text()).toContain(note('spawn-gate').wording);
    await act(async () => { spawn.find('[data-testid="help2-spawn-info"]')[0].click(); });
    await info(spawn, 'spawn-gate', 'help2-spawn-info');
    spawn.unmount();

    const loadout = await mount(<MiscLoadoutsFields value={{ hud_select: true, heavies: false }} onChange={() => {}} />);
    expect(loadout.find('[role="switch"][aria-label="heavies"]')[0].getAttribute('aria-checked')).toBe('false');
    await info(loadout, 'heavies-rule', 'help2-loadout-info');
    loadout.unmount();
  });

  it('BUILD slot editor keeps the save requirement short and opens the empty selection rule', async () => {
    const d = await demo();
    const catalogue = d.weapons.slice(0, 2).map(w => ({ id: w.weapon_id, name: w.name, types: w.types, role: w.role, cls: w.cls }));
    const base = { choice: 'player' as const, kinds: ['weapon' as const], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: null };
    const selected = await mount(<SlotFields slotKind="primary" value={base} onChange={() => {}} catalogue={catalogue} offAllowed={false} />);
    expect(selected.find('[data-testid="slot-only-row"]').length).toBe(1);
    cut(selected, 'type-snapshot', '[data-testid="slot-type-row"]');
    await info(selected, 'only-these-empty', 'help2-only-these-info');
    selected.unmount();
    const fixed = await mount(<SlotFields slotKind="primary" value={{ ...base, choice: 'fixed' }} onChange={() => {}} catalogue={[]} offAllowed={false} />);
    expect(fixed.text()).toContain('FIXED ITEM');
    expect(fixed.text()).toContain(note('fixed-item-required').wording);
    fixed.unmount();
  });

  it('CATALOGUE cuts both metric caveats and opens its read-only explanation', async () => {
    const d = await demo();
    const m = await mountScreen(<Catalog />, { ...d, view: 'catalog' });
    expect(m.text()).toContain('ARSENAL');
    cut(m, 'catalogue-pool', '.screen');
    cut(m, 'catalogue-dual', '.screen');
    await info(m, 'catalogue-intro', 'help2-catalogue-info');
    m.unmount();
  });

  it('LOBBY cuts the operator note while the TDM reminder exists', async () => {
    const d = await demo();
    const m = await mountScreen(<Lobby />, { ...d, state: { ...d.state, phase: 'lobby', config: { ...d.state.config, mode: 'tdm' } }, view: 'lobby' });
    expect(m.text()).toContain('PUSH CONFIG');
    expect(m.find('[data-testid="operator-note"]').length).toBe(0);
    m.unmount();
  });

  it('LOBBY cuts the no-override note when a pushed gun fails its read-back proof', async () => {
    const d = await demo();
    await d.api.pushLobby(true);
    const pushed = await d.api.getState();
    const board = pushed.readiness.board.map((r, i) => ({ ...r, status: i === 0 ? 'red' : 'green',
      blockers: i === 0 ? ['GUN CONFIG ≠ PUSHED HEAD (TEAM 0 READ BACK, 1 PUSHED): RE-PUSH'] : [], ambers: [] })) as State['readiness']['board'];
    const players = pushed.players.map(p => ({ ...p, ready: true }));
    const acks = Object.fromEntries(players.map(p => [p.player_id,
      { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: pushed.config.config_id }]));
    const state: State = { ...pushed, phase: 'lobby', players,
      readiness: { ...pushed.readiness, board, go: false, roster_faults: [] },
      lobby: { ...pushed.lobby, acks, ready: players.length, pushed: true, all_acked: true } };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.find('[data-override="1"]').length).toBe(0);
    expect(m.text()).toContain('RE-PUSH CONFIG');
    expect(m.find('[data-no-override-reason]').length).toBe(0);
    m.unmount();
  });

  it('LOBBY cuts the ready gate note while MC is still in BUILD', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'build',
      players: d.state.players.map((p, i) => ({ ...p, ready: i !== 0 })),
      lobby: { ...d.state.lobby, pushed: false } };
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    expect(m.find('[data-mark-all-ready="1"]').length).toBe(0);
    expect(m.find('[data-mark-ready="1"]').length).toBe(1);
    const reason = m.find('[data-mark-all-ready-reason="1"]')[0];
    expect(reason?.textContent).toBe('Push config first.');
    expect(reason?.parentElement?.parentElement?.textContent).toContain('Team Assignment');
    absent(m, 'lobby-ready-closed', '[data-mark-all-ready-reason="1"]', 'Push config first.');
    m.unmount();
  });

  it('Operator menu cuts the closed-phase explanation and opens the armed timing rule', async () => {
    const d = await demo();
    const row = liveRow({ kills: 1 });
    const render = (phase: State['phase']) => <StoreCtx.Provider value={makeStore({ ...d, state: { ...d.state, phase } })}>
      <OperatorMenu r={row} matchId="m1" onClose={() => {}} />
    </StoreCtx.Provider>;
    const closed = await mount(render('lobby'));
    expect(closed.find('[data-operator-menu="p1"]')[0]?.textContent).toContain('OPERATOR · VIPER');
    expect(closed.find('[data-op-close="1"]')[0]?.textContent).toBe('CLOSE');
    expect(closed.text()).not.toContain(note('operator-not-in-play').current);
    closed.unmount();
    const armed = await mount(render('armed'));
    expect(armed.find('[data-op="relink"]').length).toBe(1);
    await info(armed, 'operator-wait-t0', 'help2-operator-info');
    armed.unmount();
  });

  it('Spectate offers the approved reload instruction after an attempted escape', async () => {
    const d = await demo();
    const m = await mount(<StoreCtx.Provider value={makeStore({ ...d, view: 'spectate' }, { wantedView: 'kit' })}><Spectate /></StoreCtx.Provider>);
    inline(m, 'spectate-escape', '[data-spectate="escape"]');
    m.unmount();
  });

  it('ARMORY removes three section hints, gives unclaimed guns a short action, and opens log sync INFO', async () => {
    const d = await demo();
    const ghost = 'GUN-D';
    const stray = { ...d.state.nodes[0], node_id: 'stray-phone', player_id: undefined, gun_tail: undefined };
    const state: State = { ...d.state, nodes: [...d.state.nodes, stray], readiness: { ...d.state.readiness,
      board: d.state.readiness.board.filter(r => r.gun_id !== ghost),
      unclaimed: [{ gun_id: 'u1', basename: 'GHOST', name: 'GHOST-1234', tail: '1234', rssi: -60, identity: 'ok', t: Date.now() }] } };
    const m = await mountScreen(<Armory />, { ...d, state, view: 'muster' });
    expect(m.text()).toContain('UNCLAIMED');
    expect(m.text()).toContain('PHONES ON THE NET');
    cut(m, 'armory-section-hint', '[data-nodes]');
    expect(m.text()).toContain('KNOWN GUNS · NOT SEEN');
    expect(m.text()).toContain('GUN-D-22E8');
    cut(m, 'armory-known-guns-hint', '.screen');
    inline(m, 'armory-unclaimed-hint', '.screen');
    await info(m, 'armory-log-sync-tooltip', 'help2-log-sync-info');
    m.unmount();
  });

  it('Game editor puts mode reasons behind INFO and removes the volume note', async () => {
    const d = await demo();
    const store = makeStore({ ...d, state: { ...d.state, phase: 'lobby' }, view: 'lobby' }, { modes: await d.api.getModes() });
    const m = await mount(<StoreCtx.Provider value={store}><Lobby /></StoreCtx.Provider>);
    await act(async () => { m.find('[data-testid="game-edit-toggle"]')[0].click(); });
    expect(m.find('[data-testid="game-edit-volume"]').length).toBe(1);
    cut(m, 'game-edit-volume', '[data-testid="game-edit-volume"]');
    await info(m, 'game-edit-mode-change', 'help2-game-settings-info');
    await act(async () => { m.find('[data-testid="health-advanced-toggle"]')[0].click(); });
    expect(m.find('[data-testid="help2-health-info"]').length).toBe(0);
    expect(m.find('[data-testid="help2-game-settings-info"]').length).toBe(1);
    expect(m.text()).toContain('The shield recharges only when the game has no armour.');
    m.unmount();
  });

  it('Report panel removes the idle explanation and opens the privacy warning', async () => {
    const d = await demo();
    const m = await mount(<StoreCtx.Provider value={makeStore(d)}><ReportPanel onClose={() => {}} /></StoreCtx.Provider>);
    expect(m.find('[data-testid="report-panel"][data-report-phase="idle"]').length).toBe(1);
    cut(m, 'report-idle', '[data-testid="report-panel"]');
    await info(m, 'report-privacy-summary', 'help2-report-info');
    expect(m.text()).toContain('Names you typed in the console stay in the report, and it goes to a public GitHub issue.');
    m.unmount();
  });

  it('Command bar keeps the bench marker without its old tooltip', async () => {
    const d = await demo();
    const m = await mount(<StoreCtx.Provider value={makeStore({ ...d, state: { ...d.state, bench_volume: 65 } })}><CommandBar /></StoreCtx.Provider>);
    cut(m, 'bench-volume-tooltip', '[data-testid="bench-volume"]');
    expect(m.find('[data-testid="bench-volume"]')[0].getAttribute('title') ?? '').not.toContain('MC was started with --bench-volume');
    m.unmount();
  });

  it('Debug token prompt uses the approved short line', async () => {
    const d = await demo();
    const m = await mount(<StoreCtx.Provider value={makeStore({ ...d, view: 'debug' }, { authRequired: true })}><Debug /></StoreCtx.Provider>);
    inline(m, 'debug-token-prompt', '[data-alert="frame-token-required-app"]');
    m.unmount();
  });

  it('the frame shows its short connecting instruction before a snapshot arrives', async () => {
    const previous = `${location.pathname}${location.search}${location.hash}`;
    const subscribe = vi.spyOn(MockBackend.prototype, 'subscribe').mockImplementation(() => () => {});
    history.replaceState(null, '', '/?mock#lobby');
    let m: Mounted | undefined;
    try {
      m = await mount(<App />);
      inline(m, 'frame-connecting', '[data-alert="frame-connecting"]');
    } finally {
      m?.unmount();
      subscribe.mockRestore();
      history.replaceState(null, '', previous);
    }
  });

  it('the frame shows its short token instruction before a snapshot arrives', async () => {
    const previous = `${location.pathname}${location.search}${location.hash}`;
    const subscribe = vi.spyOn(MockBackend.prototype, 'subscribe').mockImplementation(() => () => {});
    const gallery = vi.spyOn(compact, 'galleryHas').mockImplementation(k => k === 'token');
    history.replaceState(null, '', '/?mock#lobby');
    let m: Mounted | undefined;
    try {
      m = await mount(<App />);
      inline(m, 'frame-token-prompt', 'main [data-alert="frame-token-required-app"]');
    } finally {
      m?.unmount();
      gallery.mockRestore();
      subscribe.mockRestore();
      history.replaceState(null, '', previous);
    }
  });
});
