// Shared by hud-html.test.mjs and tools/hud-html-states.mjs: renders the HUD from a captured engine state.
// `renderHtml` calls the template methods. `renderDom` runs the real Hud (constructor, render, patchers, moments,
// lanes, diagnostics) on the fake DOM and returns what each render left in the page.
import { Hud } from '../src/hud/hud.js';
import { FakeDocument, El } from './hud-fake-dom.mjs';
import fs from 'node:fs';

// The states file stores each distinct `state.catalog` once under `catalogs`, and a state points at it with
// `catalog: '$catalog:<id>'`. Both directions keep the key order, so a render sees exactly the captured state.
const REF = '$catalog:';
export function loadStates(file) {
  const { catalogs = {}, states } = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const fixture of Object.values(states)) {
    const c = fixture.state && fixture.state.catalog;
    if (typeof c === 'string' && c.startsWith(REF)) fixture.state.catalog = catalogs[c.slice(REF.length)];
  }
  return states;
}
export function saveStates(file, fixtures) {
  const catalogs = {}, ids = new Map(), states = {};
  for (const [name, fixture] of Object.entries(fixtures)) {
    const c = fixture.state && fixture.state.catalog;
    if (c === undefined || c === null || typeof c === 'string') { states[name] = fixture; continue; }
    const text = JSON.stringify(c);
    if (!ids.has(text)) { ids.set(text, 'c' + ids.size); catalogs[ids.get(text)] = c; }
    states[name] = { ...fixture, state: { ...fixture.state, catalog: REF + ids.get(text) } };
  }
  fs.writeFileSync(file, JSON.stringify({ catalogs, states }, null, 2) + '\n');
}

const baseHud = () => ({
  lo: { tab: 'primary', filter: 'weapons', focus: null, confirm: null },
  scan: [], scanActive: true, scanOther: false, bluetoothOn: true, locationOn: true,
  platform: 'web', mcUrl: '', history: [], diagData: {},
});

export function renderHtml({ now, state, hud: saved }) {
  const clock = Date.now;
  Date.now = () => now;
  try {
    const h = Object.assign(Object.create(Hud.prototype), {
      ...baseHud(), chips: { innerHTML: '' },
      diag: { innerHTML: '', querySelector: () => null, classList: { contains: () => !!saved.diagOpen } },
    }, saved);
    const screen = h._structure(state);
    h._diagShell();
    h._chips(state);
    return { screen, diag: h.diag.innerHTML, chips: h.chips.innerHTML };
  } finally { Date.now = clock; }
}

const PAGE = '<div id="stage"><div id="frame"><div id="hud"></div><div id="overlay"></div><div id="chips"></div>'
  + '<div id="diag"></div><button id="info"></button><button id="skin"></button></div></div>';
const HUD_FIELDS = ['lo', 'scan', 'scanActive', 'scanOther', 'bluetoothOn', 'locationOn', 'platform', 'connecting',
  'discovered', 'mcUrl', 'history', 'sessionId', 'view', 'rtab', 'board', 'diagData'];

// Heights for the elements the rail measure reads: `step.layout: true` gives them a size, so `_railFit` has something to fit.
const LAYOUT = el => ({ chipbar: 34, gunwarn: 100, puhint: 30, nightlab: 14 })[el._classes().find(c => c in { chipbar: 1, gunwarn: 1, puhint: 1, nightlab: 1 }) || el.id] || 0;

/** One step of a script: `state` and `hud` overlay the captured ones, `after` is a number of ms to advance the clock,
 *  `fire` advances it again and runs the timers that fall due (before the render),
 *  `call` runs a Hud method on the live instance first. Every step renders once and records the page. */
export function renderDom({ now, state, hud: saved }, steps = [{}]) {
  const globals = ['document', 'window', 'getComputedStyle', 'setTimeout', 'clearTimeout'];
  const prior = Object.fromEntries(globals.map(k => [k, globalThis[k]]));
  const clock = Date.now, tz = process.env.TZ;
  const timers = [], haptics = [], pending = [];
  let t = now; Date.now = () => t;
  process.env.TZ = 'America/New_York';
  const doc = new FakeDocument(PAGE);
  globalThis.document = doc;
  globalThis.window = { innerWidth: 844, innerHeight: 390, addEventListener() {} };
  globalThis.getComputedStyle = () => ({ bottom: '8px' });
  globalThis.setTimeout = (fn, ms) => { timers.push(Math.round(ms)); pending.push({ fn, due: t + ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  try {
    const hud = new Hud(doc, { onHaptic: kind => haptics.push(kind) });
    Object.assign(hud, baseHud(), Object.fromEntries(HUD_FIELDS.filter(k => saved[k] !== undefined).map(k => [k, saved[k]])));
    if (saved.diagOpen) hud.toggleDiag();
    const out = [];
    for (const step of steps) {
      timers.length = 0; haptics.length = 0;
      if (step.after) t += step.after;
      if (step.fire) fireDue(t += step.fire);
      if ('layout' in step) El.layout = step.layout ? LAYOUT : null;
      if (step.hud) Object.assign(hud, step.hud);
      if (step.call) for (const [name, ...args] of step.call) hud[name](...args);
      const st = typeof step.state === 'function' ? step.state(state) : { ...state, ...step.state };
      hud.render(st);
      if (step.renderDiag) hud.renderDiag();
      out.push(snapshot(hud, doc));
    }
    return out;
  } finally {
    Date.now = clock; El.layout = null;
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    for (const k of globals) { if (prior[k] === undefined) delete globalThis[k]; else globalThis[k] = prior[k]; }
  }

  // Runs the recorded timers that fall due by `until`, oldest first, with the clock at each due time (a callback may set the next one).
  function fireDue(until) {
    const end = t;
    for (;;) {
      const i = pending.findIndex(p => p.due <= until);
      if (i < 0) break;
      const [p] = pending.splice(i, 1);
      t = Math.max(t, p.due); p.fn();
    }
    t = Math.max(end, until);
  }

  function snapshot(h, d) {
    const f = h.frame;
    const attrs = Object.fromEntries([...f._attrs].filter(([k]) => k !== 'id'));
    const css = [...f.style._map].map(([k, v]) => `${k}:${v}`).join(';');
    const lanes = d.querySelector('#lanes');
    return { frame: attrs, frameStyle: css, hud: h.hudEl.innerHTML, overlay: h.overlay.innerHTML, chips: h.chips.innerHTML,
      diag: h.diag.innerHTML, diagClass: h.diag.className, lanes: lanes ? lanes.outerHTML : null,
      skin: h.skin.outerHTML, timers: [...timers], haptics: [...haptics] };
  }
}

// ---- scripts: what the DOM test does with each captured state ----
const tick = () => ({ after: 1000, state: s => ({ ...s, clockMs: Math.max(0, (s.clockMs || 0) - 4000),
  hp: s.alive ? Math.max(0, s.hp - 1) : s.hp, battery: s.battery == null ? s.battery : s.battery - 1,
  tMinusMs: s.tMinusMs == null ? s.tMinusMs : s.tMinusMs - 1000, respawnIn: s.respawnIn == null ? s.respawnIn : Math.max(0, s.respawnIn - 1),
  }) });
/** Every captured state: render, then a second render a second later so the in-place patchers run on a built screen. */
export const defaultSteps = () => [{}, tick()];

const lanesOf = (s, lanes, extra) => ({ ...s, ...extra, presented: { ...s.presented, lanes } });
/** A busy lane set, built from the clock at the step: a three-kill hero with medals, both objective badges (lost), and a feed of every row kind. */
const richLanes = (ago, extra = {}) => s => { const n = Date.now() - ago;
  return lanesOf(s, { heroUntil: n + 2500, hero: { id: 7, t0: n, lastAt: n, kills: [
    { victim: 'VIPER', team: 'yellow', medals: ['first_blood', 'double_kill'], src: 'MC', at: n }, { victim: null, team: 'red', medals: ['killjoy', 'nope', 'triple_kill'], at: n },
    { victim: 'HAVOC', team: 'blue', medals: ['spree', 'headshot', 'revenge', 'avenger'], src: 'IR', at: n }] },
    obj: { lead: { kind: 'lead_lost', id: 8, at: n - 500 }, hill: { kind: 'hill_capture_started', id: 9, at: n - 4000 } },
    feed: [{ kind: 'teammate_down', name: 'ACE', by: 'VIPER', id: 11, at: n - 100, src: 'MC' }, { kind: 'enemy_down', team: 'yellow', at: n - 200 },
      { kind: 'alert', alert: 'time_30', id: 13, at: n - 300 }, { kind: 'alert', alert: 'bomb_planted', id: 14, at: n - 400 }, { kind: 'pickup', text: 'ROCKETS AVAILABLE', color: '#ff7a1a', at: n - 500 }] }, extra); };

/** Synthetic cases: a captured state with its `moment` (or other fields) replaced, to reach branches no stage shows. */
export const cases = {
  'moment-hit-ambiguous': { from: 'live', steps: [{ state: { moment: { kind: 'hit', at: 1, data: { dmg: 12, shooter_key: 'red', sensor: 2,
    weapon: { ambiguous: true, names: ['smg', 'pistol'] } } } } }, { after: 300, state: { moment: { kind: 'hit', at: 2, data: { dmg: 30, shooter_key: 'yellow', sensor: 4,
    weapon: { ambiguous: true, names: ['a', 'b', 'c'] } } } } }, { after: 300, state: { moment: { kind: 'hit', at: 3, data: { dmg: 5, sensor: null, weapon: { name: 'Rifle' } } } } }] },
  'moment-gain': { from: 'live', steps: [{ state: { moment: { kind: 'gain', at: 1, data: { pool: 'armor', amount: 25, armor: 25 } } } },
    { after: 200, state: { moment: { kind: 'gain', at: 2, data: { pool: 'health', amount: 10, hp: 50 } } } },
    { after: 200, state: { moment: { kind: 'gain', at: 3, data: { pool: 'health', amount: 900, hp: 9000 } } } }] },
  'moment-switched': { from: 'live', steps: [{ state: { moment: { kind: 'switched', at: 1, data: { slot: 1, assumed: true } } } },
    { after: 100, state: { moment: { kind: 'switched', at: 2, data: { slot: 0, assumed: false } } } },
    { after: 100, state: { moment: { kind: 'switched', at: 3, data: { slot: 2, pu: true } },
      powerup: { held: { slot: 2, weapon_id: 'rocket_launcher', name: 'ROCKETS', color: '#ff8800', left: 2 } } } }] },
  'moment-redeploy': { from: 'live', steps: [{ state: { moment: { kind: 'redeploy', at: 1 }, weaponArming: 1500, shielded: false } },
    { after: 500, state: { moment: { kind: 'redeploy', at: 1 }, weaponArming: null, shielded: true } },
    { after: 500, state: { moment: { kind: 'redeploy', at: 1 }, shielded: false } }] },
  'moment-redeploy-night': { from: 'live', steps: [{ state: { night: true, moment: { kind: 'redeploy', at: 1 } } }, { after: 100, state: { night: true, moment: { kind: 'go', at: 2 } } }] },
  'moment-go-flash': { from: 'live', steps: [{ state: { moment: { kind: 'go', at: 1 } } }, { after: 100, state: { moment: { kind: 'go', at: 2 } } }, { after: 900, state: { moment: { kind: 'go', at: 3 } } }] },
  'tminus-long': { from: 'armed', steps: [{ state: { tMinusMs: 125000 } }, { after: 1000, state: { tMinusMs: 124000 } }, { after: 1000, state: { tMinusMs: 90000 } },
    { after: 1000, state: { tMinusMs: 0 } }, { after: 500, state: { phase: 'live', tMinusMs: null } }] },
  'gun-locked-phases': { from: 'live', steps: [{ state: { gunLocked: true, gunRecovery: 'rearming' } }, { state: { gunLocked: true, gunRecovery: 'retry_exhausted' } },
    { state: { gunLocked: true, gunRecovery: null } }, { state: { gunLocked: false } }] },
  'reconcile-reload-switch': { from: 'live', steps: [{ state: { reconciling: true } }, { state: { reconciling: false, reloading: true, reloadAt: 0, reloadMs: 2000, reloadTotalMs: 2000 } },
    { after: 1500, state: { reloading: true, reloadAt: 0, reloadMs: 2000, reloadTotalMs: 2000 } }, { after: 2500, state: { reloading: true, reloadAt: 0, reloadMs: 2000, reloadTotalMs: 2000 } },
    { state: { reloading: false, switching: true, switchingMs: 600, switchWindowMs: 1000 } }, { after: 300, state: { switching: true, switchingMs: 600, switchWindowMs: 1000 } }, { state: { switching: false } }] },
  'down-sequence': { from: 'down-full', steps: [{}, { after: 1000, state: { respawnIn: 5 } }, { after: 1000, state: { respawnIn: 0, respawnHint: 'find' } },
    { after: 1000, state: { downReason: 'gun_recovery' } }, { after: 1000, state: { alive: true, hp: 100 } }] },
  'down-timed-vs-station': { from: 'down-full', steps: [{ state: { respawnType: 'scanner', respawnIn: 20 } }, { after: 1000, state: { respawnType: 'scanner', respawnIn: 19, killedBy: null } },
    { after: 1000, state: { respawnType: 'auto', respawnIn: 8, downWarn: 3 } }] },
  'diag-open-rich': { from: 'live', hud: { diagOpen: true, mcUrl: 'ws://10.0.0.5:8766/ws', discovered: { url: 'ws://10.0.0.9/ws', at: 1, source: 'mdns', reason: 'new', text: 'NEW MISSION CONTROL · TAP JOIN' }, history: [{ kills: 3, deaths: 1 }, { kills: 2 }], sessionId: 'sess-1' },
    steps: [{ hud: { diagData: { preflight: { ble: true, mic: false }, link: { mc: 'bound', reach: 'lan', relinking: false }, engine: { phase: 'live', n: 3 }, timings: { rtt: 12 }, frames: [{ dir: 'tx', f: '$A' }, { dir: 'rx', f: '$B' }], log: ['one', 'two <x>'], webDebug: true } }, renderDiag: true },
      { hud: { diagData: { link: { mc: 'rejected', relinking: true }, webDebug: 'forced', log: ['one'] } }, renderDiag: true },
      { hud: { diagData: { link: { mc: 'connecting', mc_url: 'x' }, webDebug: false } }, renderDiag: true },
      { hud: { diagData: { link: { mc: 'open' }, webDebug: 'unsupported' }, _joinConfirm: { act: 'onSetUrl', at: 1791145510683 + 100 } }, renderDiag: true },
      { hud: { diagData: { link: {}, webDebug: null }, _joinConfirm: null, _gunConfirm: { at: 1791145510683 + 200 } }, renderDiag: true }] },
  'board-team-stale': { from: 'live-scores', hud: { board: 'team' }, steps: [{}, { after: 2000, state: { wsState: 'closed', lastMcMsgAt: 1 } },
    { after: 61000, state: { wsState: 'closed', lastMcMsgAt: 1 }, hud: { board: 'player' } }, { hud: { board: null } }] },
  'board-ffa': { from: 'live-scores-ffa', hud: { board: 'team' }, steps: [{}, { hud: { board: 'player' } }, { state: { scoreRows: [], scoreAt: null } }, { state: { board: null, scoreRows: [] }, hud: { board: 'team' } }] },
  'board-koth-hold': { from: 'live-scores-koth', hud: { board: 'team' }, steps: [{ state: { mode: 'KOTH', board: { teams: [{ team_id: 'blue', name: 'BLUE', score: 3 }, { team_id: 'yellow', name: 'YELLOW', score: 1 }, { team_id: 'red', name: 'RED' }] },
    possession: { by_site: { 7: { 0: 42, 1: 30 }, 8: { 0: 8, junk: null }, 9: null }, observed_ms: {}, source: null } } },
    { after: 1000, state: { mode: 'KOTH', board: { teams: [{ team_id: 'blue', name: 'BLUE', score: 3 }, { team_id: 'yellow', name: 'YELLOW', score: 1 }] },
      possession: { by_site: { 7: { 0: 72, 1: 30 } }, observed_ms: {}, source: null } } },
    { state: { mode: 'KOTH', board: null, possession: null } }] },
  'down-cap-minus-one': { from: 'down-full', steps: [{ state: { wsState: 'closed', kills: 3, fragLimit: 4, board: { cap: 10, teams: [{ team_id: 'blue', score: 9 }] } } },
    { after: 1000, state: { wsState: 'closed', kills: 3, fragLimit: 4, board: { cap: 10, teams: [{ team_id: 'blue', score: 9 }] } } },
    { after: 1000, state: { wsState: 'bound', board: { cap: 10, teams: [{ team_id: 'blue', score: 2 }] }, kills: 0, fragLimit: 1 } }] },
  'rail-layout': { from: 'live-pu-rockets', steps: [{ layout: true }, { state: { spawnLost: true } }, { state: { spawnLost: true, underFire: true } },
    { state: { spawnLost: false, underFire: false } }, { layout: false }] },
  'lanes-feed-and-hero': { from: 'live-kill-lead-hill', steps: [{}, { after: 2000 }, { after: 2000, state: { stunned: true } }, { after: 3000 }, { after: 5000 }, { after: 5000, state: { presented: { lanes: null } } }] },
  'lanes-rich': { from: 'live-kill-lead-hill', steps: [{ state: richLanes(0) }, { after: 1500, state: richLanes(0) }, { after: 1500, state: richLanes(0, { stunned: true }) },
    { after: 3000, state: richLanes(0) }, { after: 6000, state: richLanes(0) }, { after: 8000, state: richLanes(0) }] },
  'lanes-takeover-hold': { from: 'live-kill-lead-hill', steps: [{ state: { switchCard: { slot: 1 } } }, { after: 200, state: { switchCard: null } }, { after: 300 }, { after: 4000 }] },
  'picker-bluetooth-off': { from: 'idle', steps: [{ hud: { bluetoothOn: false, platform: 'web' } }, { hud: { platform: 'android' } }, { hud: { bluetoothOn: true } }] },
  'picker-bluetooth-off-android': { from: 'idle', hud: { bluetoothOn: false, platform: 'android' }, steps: [{}] },
  'picker-location-off': { from: 'idle', steps: [{ hud: { locationOn: false } }, { hud: { bluetoothOn: false } }, { hud: { bluetoothOn: true, locationOn: true } }] },
  'lobby-over-after-ack': { from: 'result-win-team', steps: [{ state: { endAck: true } }, { state: { endAck: true, ready: true } }, { state: { endAck: true, result: null } }, { state: { endAck: true, synced: false, ready: false } }] },
  'lobby-ready-up-kit-closed': { from: 'lobby', steps: [{ state: { kitOpen: false, ready: false } }, { state: { kitOpen: false, ready: false, synced: false } }, { state: { kitOpen: false, ready: true } }, { state: { kitOpen: true, ready: false } }] },
  'ready-note-rejected': { from: 'kitted', steps: [{ state: { wsState: 'rejected', wsReason: 'bad_token (4)' } }, { state: { wsState: 'rejected', wsReason: null } },
    { state: { wsState: 'bound', wsReason: null } }] },
  'lobby-rejected': { from: 'lobby', steps: [{ state: { kitOpen: false, ready: false, wsState: 'rejected', wsReason: 'room_full' } }, { state: { wsState: 'rejected', wsReason: 'room_full' } }] },
  'shot-cooldown-timers': { from: 'live', steps: [{ state: { shotCooldown: { at: 1, ms: 600, leftMs: 500 } } }, { fire: 600, state: { shotCooldown: { at: 1, ms: 600, leftMs: 500 } } },
    { fire: 300, state: { shotCooldown: { at: 1, ms: 600, leftMs: 500 } } }, { state: { shotCooldown: { at: 2, ms: 600, leftMs: 0 } } }, { state: { shotCooldown: { at: 3, ms: 600, leftMs: 400 } } },
    { state: { shotCooldown: null } }] },
  'picker-churn': { from: 'idle-noisy-open', steps: [{}, { hud: { scanOther: true } },
    { hud: { scan: [{ deviceId: 'gun2', name: 'BRAVO-9498', basename: 'BRAVO', tail: '9498', rssi: -60, rank: 1, other: false, inUse: true },
      { deviceId: 'gun3', name: 'CHARLIE-1A2B', basename: 'CHARLIE', tail: '1A2B', rssi: -90, rank: 1, other: false },
      { deviceId: 'gun1', name: 'ALPHA-FE30', basename: 'ALPHA', tail: 'FE30', rssi: -45, rank: 1, other: false },
      { deviceId: 'tv2', name: '[LG] webOS TV', basename: '[LG] webOS TV', tail: '2', rssi: -44, rank: 3, other: true }] } },
    { hud: { connecting: { name: 'ALPHA-FE30', attempt: 1, of: 3, failed: false } } },
    { hud: { connecting: { name: 'ALPHA-FE30', attempt: 3, of: 3, failed: true } } },
    { hud: { connecting: null, scanActive: false, scan: [] } }, { hud: { scanActive: true, scanOther: false } }] },
};

/** The DOM golden: every fixture through the default script, then each synthetic case on its base fixture. */
export function domGolden(fixtures) {
  const out = {};
  for (const [name, f] of Object.entries(fixtures)) out[name] = renderDom(f, defaultSteps());
  for (const [name, c] of Object.entries(cases)) out[`case:${name}`] = renderDom({ ...fixtures[c.from], hud: { ...fixtures[c.from].hud, ...c.hud } }, c.steps);
  return out;
}
