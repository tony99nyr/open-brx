// Golden traces (architecture item #6): the ENGINE runner. It replays one trace file
// (test/fixtures/traces/<name>.json, format in that folder's README.md) through the real `src/engine.js` and
// returns what came out at each checkpoint: the writes since the previous checkpoint and a chosen set of state
// fields. `tools/record-traces.mjs` stores that output as the trace's `expect`; `golden-traces.test.mjs`
// replays and compares. The Python twin is mcp/tests/test_golden_traces.py (GunStage).
//
// Everything here is deterministic: an injected clock from `_base.json`'s `clock0_ms`, `rng: () => 0`, and a
// fake gun whose replies come only from the rules in `TraceGun` (mirrored line for line in the Python runner).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';

export const TRACE_DIR = fileURLToPath(new URL('./fixtures/traces/', import.meta.url));
export const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
export const base = JSON.parse(readFileSync(TRACE_DIR + '_base.json'));

/** Every trace file name (without `.json`), sorted. Files starting with `_` are shared inputs, not traces. */
export function traceNames() {
  return readdirSync(TRACE_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => f.slice(0, -5)).sort();
}
export function loadTrace(name) { return JSON.parse(readFileSync(TRACE_DIR + name + '.json')); }

/** The frames the trace's player gets: the golden bundle, then `setup.frames` (shallow), then `setup.frames_patch`. */
export function buildFrames(setup = {}) {
  const f = { ...JSON.parse(JSON.stringify(golden)), player_id: base.player.player_id, ...(setup.frames || {}) };
  const p = setup.frames_patch || {};
  if (p.head_append) f.head = [...f.head, ...p.head_append];
  if (p.after_last_ammo) {
    // compile.py's pickup-slot shape: every spawn and revive list empties the spare slots behind its last `$AMMO`
    const add = list => { const i = list.map(x => x.startsWith('$AMMO,')).lastIndexOf(true); return i < 0 ? list : [...list.slice(0, i + 1), ...p.after_last_ammo, ...list.slice(i + 1)]; };
    f.spawn = add(f.spawn); f.revive = add(f.revive);
    if (f.respawn_profile) f.respawn_profile = { ...f.respawn_profile, spawn: add(f.respawn_profile.spawn), revive: add(f.respawn_profile.revive), revive_station: add(f.respawn_profile.revive_station) };
  }
  if (p.drop) for (const k of p.drop) delete f[k];
  return f;
}
export function buildConfig(setup = {}) { return { ...JSON.parse(JSON.stringify(base.config)), ...(setup.config || {}) }; }

/** One station advert as beacon.js `Presence` reports it, from the trace's short form. */
export function stationEntry(o) {
  const median = o.median != null ? o.median : -50;
  return { role: 'station', id: o.id, kind: o.kind, team: o.team != null ? o.team : 255, state: o.state || 0, value: o.value || 0,
    taker: o.taker || 0, seq: 0, game: 0, threshold: o.threshold != null ? o.threshold : 0, rssi: median, raw: median, median,
    present: o.present != null ? o.present : median >= -74, ageMs: 0 };
}

// ---- the state fields a checkpoint may record. Each one is named the same in the Python runner. ----
export const FIELDS = {
  phase: (e, s) => s.phase,
  alive: (e, s) => s.alive,
  spawned: e => !!e.spawned,
  hp: (e, s) => s.hp, armor: (e, s) => s.armor, shield: (e, s) => s.shield,
  activeSlot: (e, s) => s.activeSlot,
  ammo: (e, s) => s.ammo, reserve: (e, s) => s.reserve,
  deaths: (e, s) => s.deaths,
  spawnLost: (e, s) => s.spawnLost,
  reconciling: (e, s) => s.reconciling,
  switching: (e, s) => s.switching,
  reloading: (e, s) => s.reloading,
  poison: (e, s) => (s.poison ? { ticks: s.poison.ticks, perTick: s.poison.perTick } : null),
  // the held heavy: the HUD view plus the engine's own record (`trig`: the trigger slot it believes; `suspect`/`unconfirmed`:
  // F436's doubts about the gun having taken the equip; `base`: the charges one item gives)
  held: (e, s) => { const h = s.powerup && s.powerup.held, r = e._puHeld;
    return h ? { weapon_id: h.weapon_id, slot: h.slot, left: h.left, charges: h.charges, active: h.active, back: h.back,
      base: r ? r.base : null, trig: r ? r.trig : null, suspect: !!(r && r.suspect), unconfirmed: !!(r && r.unconfirmed) } : null; },
  // every other powerup surface: the HUD cards, the hint, the overshield, the item a death took and the switch-back
  powerup: (e, s) => { const v = s.powerup;
    return { hint: v ? v.hint : null, overshield: v ? v.overshield : null, grant: s.powerupGrant, swap: s.powerupSwap, spawn: s.powerupSpawn,
      lost: s.puLost, back: e._puBack || null, backPending: e._puBackPending ? { tries: e._puBackPending.tries, equipped: e._puBackPending.equipped } : null }; },
  claim: (e, s) => (s.powerupClaim ? { station: s.powerupClaim.station, ready: s.powerupClaim.ready } : null),
  hill: (e, s) => (s.hill ? { owner: s.hill.owner, contested: !!s.hill.contested, progress: s.hill.progress != null ? s.hill.progress : null } : null),
};
export const DEFAULT_FIELDS = ['phase', 'alive', 'spawned', 'hp', 'armor', 'shield', 'activeSlot', 'ammo', 'reserve', 'deaths'];
export function fieldsOf(trace) { return [...DEFAULT_FIELDS, ...((trace.setup && trace.setup.fields) || [])]; }

/** The fake gun. Its rules are the ones the source unit tests used (spawn-lost.test.mjs, poison.test.mjs and
 *  powerups.test.mjs `echo`), switched on per trace by `setup.gun`, and stated once in the README:
 *  - `spawn` (default on): a `$SPAWN` that is not refused fills the pools from the head `$PSET` maxima, puts the gun
 *    on slot 0 with `spawn_ammo`, and answers `$LCD,<pools>,<slot>,<mag>,<reserve>,*`;
 *  - `probe` (default on): `$LIFE,0,0,0,*` answers `$HP,<pools>,*`, `$QUERY,*` answers `$LCD,<pools>,<slot>,<mag>,<res>,*`,
 *    both only while `answer` is true;
 *  - `life`: any other `$LIFE,dh,da,ds,*` moves the pools (floor 0, no spill) and answers `$HP` (or `$LCD,0,…` at 0 hp);
 *  - `ammo`: an `$AMMO` row on the gun's own slot sets its magazine and reserve;
 *  - `alcd_echo`: every `$WEAP` and `$AMMO` write is answered with the `$ALCD` a real gun sends (F259).
 *  A frame the trace feeds that carries pools (`$HP`, `$LCD`) moves the gun's pools too: the trace is the gun talking. */
export class TraceGun {
  constructor(opts = {}, maxima = [45, 70, 0]) {
    this.o = { spawn: true, probe: true, life: false, ammo: false, alcd_echo: false, spawn_ammo: [32, 192], ...opts };
    this.maxima = maxima;
    Object.assign(this, { spawned: false, answer: true, hp: 0, armor: 0, shield: 0, slot: 0, mag: 0, reserve: 0 });
    this.replies = [];
  }
  pools() { return `${this.hp},${this.armor},${this.shield}`; }
  /** One write the node made that the link did NOT refuse. */
  wrote(frames) {
    for (const f of frames) {
      const t = f.split(',');
      if (t[0] === '$SPAWN' && this.o.spawn) {
        [this.hp, this.armor] = this.maxima; this.shield = 0; this.spawned = true; this.slot = 0; [this.mag, this.reserve] = this.o.spawn_ammo;
        this.replies.push(`$LCD,${this.pools()},${this.slot},${this.mag},${this.reserve},*`);
      } else if (f === E.PROBE_LIFE) {
        if (this.o.probe && this.answer) this.replies.push(`$HP,${this.pools()},*`);
      } else if (f === '$QUERY,*') {
        if (this.o.probe && this.answer) this.replies.push(`$LCD,${this.pools()},${this.slot},${this.mag},${this.reserve},*`);
      } else if (t[0] === '$LIFE' && this.o.life && /^\$LIFE,-?\d+,-?\d+,-?\d+,\*$/.test(f)) {
        const [dh, da, ds] = t.slice(1, 4).map(Number);
        this.hp = Math.max(0, Math.min(this.maxima[0], this.hp + dh)); this.armor = Math.max(0, Math.min(this.maxima[1], this.armor + da));
        this.shield = Math.max(0, this.shield + ds);
        this.replies.push(this.hp === 0 ? `$LCD,0,0,0,${this.slot},${this.mag},${this.reserve},*` : `$HP,${this.pools()},*`);
      } else if (t[0] === '$AMMO') {
        if (this.o.ammo && +t[1] === this.slot) { this.mag = +t[2]; this.reserve = +t[3]; }
        if (this.o.alcd_echo) this.replies.push(`$ALCD,${t[2]},100,${t[1]},${t[3]},0,*`);
      } else if (t[0] === '$WEAP' && this.o.alcd_echo) {
        this.replies.push(`$ALCD,${t[17] || 0},100,${t[1]},${t[18] || 0},0,*`);
      }
    }
  }
  /** A frame the trace fed (the gun said it). */
  heard(f) {
    const t = f.split(',');
    if (t[0] === '$HP' && t.length >= 4) { this.hp = +t[1]; this.armor = +t[2]; this.shield = +t[3]; }
    else if (t[0] === '$LCD' && t.length >= 7 && t[1] !== '' ) { this.hp = +t[1]; this.armor = +t[2]; this.shield = +t[3]; }
  }
  take() { const r = this.replies; this.replies = []; return r; }
}

/** The head `$PSET` maxima (hp, armour, shield), the way the gun reads them. */
export function headMaxima(frames) {
  const p = (frames.head || []).find(f => f.startsWith('$PSET,'));
  if (!p) return [45, 70, 0];
  const t = p.split(','); return [+t[3] || 0, +t[4] || 0, +t[5] || 0];
}

/** Replay one trace through the real engine. Returns {checkpoints: [{at, writes, state}], logs}. */
export async function runEngine(trace) {
  const setup = trace.setup || {};
  const frames = buildFrames(setup), config = buildConfig(setup);
  const team = config.teams.find(t => t.team_id === base.player.team_id);
  const gun = new TraceGun(setup.gun, headMaxima(frames));
  let clock = base.clock0_ms;
  const out = [], logs = [], timers = [];
  let failRule = null;                       // {prefix, left, lands}
  const writer = fr => {
    out.push(...fr);
    if (failRule && fr.some(f => f.startsWith(failRule.prefix))) {
      const lands = failRule.lands;
      if (--failRule.left <= 0) failRule = null;
      if (lands) gun.wrote(fr);              // the gun took it, but the write still resolves false (a lost trailing chunk)
      return false;
    }
    gun.wrote(fr);
    return undefined;
  };
  const delay = setup.delay === 'timers' ? (ms, fn) => timers.push({ at: clock + ms, fn }) : (ms, fn) => fn();
  const facts = [], reports = [];            // what MC hears: `emit` facts and `report` messages
  const eng = new E.Engine({ writer, emit: f => facts.push(f), report: (k, b) => reports.push({ kind: k, body: b }), now: () => clock, synced: () => true,
    storage: memStorage(), log: m => logs.push(String(m)), delay, rng: () => 0 });
  let stations = null;                       // the sticky advert list, re-pushed every sub-step like app.js's presence tick
  const runTimers = () => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > clock) return; timers.shift().fn(); } };
  // the gun's answers, fed in order; an answer can cause a write, whose answer is fed too (bounded)
  const flush = () => { for (let n = 0; n < 20; n++) { const rs = gun.take(); if (!rs.length) return; for (const r of rs) { gun.heard(r); eng.feedFrame(r); } } };
  const settle = () => new Promise(r => setImmediate(r));
  const step = setup.tick_ms || 250;
  const checkpoints = []; let mark = 0, fmark = 0, rmark = 0;
  const fields = fieldsOf(trace);

  // the MC path to a running match: link, assign, config, the head's echo, start (README "Preamble")
  eng.onBleConnected({ ...base.gun_name });
  eng.onMcMessage({ kind: 'assign', body: { player: base.player, team, roster: base.roster, ...(setup.catalog ? { catalog: setup.catalog } : {}) } });
  eng.onMcMessage({ kind: 'config', body: { config, frames, roster: base.roster } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  const countdown = setup.countdown_s || 0;
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock + countdown * 1000, config_id: config.config_id, seq: 1, countdown_s: countdown } });
  await settle();

  for (const [i, s] of (trace.steps || []).entries()) {
    if (s.frame != null || s.frames) {
      for (const f of (s.frames || [s.frame])) { gun.heard(f); eng.feedFrame(f); }
    } else if (s.advance_ms != null) {
      const end = clock + s.advance_ms;
      while (clock < end) {
        clock = Math.min(end, clock + step);
        runTimers(); flush();
        if (stations) eng.setStations(stations.map(stationEntry));
        eng.tick(); runTimers();
        await settle(); flush();
      }
    } else if (s.stations) {
      stations = s.stations.length ? s.stations : null;
      eng.setStations(s.stations.map(stationEntry));
    } else if (s.mc) {
      eng.onMcMessage(s.mc);
    } else if (s.fail_next_write) {
      failRule = { prefix: s.fail_next_write, left: s.count || 1, lands: !!s.lands };
    } else if (s.gun) {
      Object.assign(gun, s.gun);
    } else if (s.ble === 'drop') {
      eng.onBleDropped();
    } else if (s.ble === 'relink') {
      eng.onBleConnected({ ...base.gun_name });
    } else if (s.check) {
      await settle();
      const st = eng.state(), state = {};
      for (const k of fields) state[k] = FIELDS[k](eng, st);
      checkpoints.push({ at: s.check, step: i, writes: out.slice(mark), state: norm(state), facts: norm(facts.slice(fmark)), reports: norm(reports.slice(rmark)) });
      mark = out.length; fmark = facts.length; rmark = reports.length;
    } else {
      throw new Error(`trace ${trace.name}: step ${i} has no known type: ${JSON.stringify(s)}`);
    }
    if (!s.check) { await settle(); flush(); }   // a real gun answers within a BLE round trip, before the next step
  }
  return { checkpoints, logs };
}

function memStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

/** The `expect` block a recording stores: one entry per checkpoint. */
export function toExpect(run) { return run.checkpoints.map(c => ({ at: c.at, writes: c.writes, state: c.state, facts: c.facts, reports: c.reports })); }

/** Timestamps as ms since the trace's start clock (`_base.json` clock0_ms), so a recording reads as a timeline. Any
 *  number under a time-like key (`at`, `t`, `…At`, `…_at`, `until`) that sits on the trace clock is rebased. The clock is
 *  injected, so the values are deterministic either way; this only makes them readable and start-independent. */
export function norm(v, key = '') {
  if (Array.isArray(v)) return v.map(x => norm(x));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = norm(x, k); return o; }
  if (typeof v === 'number' && /^(at|t|until|due)$|At$|_at$|Until$/.test(key) && v >= base.clock0_ms - 600000) return v - base.clock0_ms;
  if (key === 'shot_group' && typeof v === 'string') return v.replace(/^[^:]*:/, 'epoch:');   // the one random value: the constructor's `Math.random` hit-group epoch
  return v === undefined ? null : v;
}

/** The first difference between a replay and `expect`, as a readable message, or null when they match. */
/** Every difference between a replay and `expect`, one readable message per differing checkpoint (empty when they match). */
export function allDiffs(trace, run) {
  const exp = trace.expect || [], out = [];
  if (exp.length !== run.checkpoints.length) out.push(`checkpoint count: expected ${exp.length}, got ${run.checkpoints.length}`);
  for (let i = 0; i < Math.min(exp.length, run.checkpoints.length); i++) {
    const d = checkpointDiff(exp[i], run.checkpoints[i]);
    if (d) out.push(d);
  }
  return out;
}
/** The first difference, or null when the replay matches. */
export function firstDiff(trace, run) { return allDiffs(trace, run)[0] || null; }

function checkpointDiff(e, g) {
  const where = `checkpoint "${e.at}" (step ${g.step})`;
  if (e.at !== g.at) return `${where}: label ${JSON.stringify(g.at)} != ${JSON.stringify(e.at)}`;
  const n = Math.max(e.writes.length, g.writes.length);
  for (let j = 0; j < n; j++) {
    if (e.writes[j] !== g.writes[j]) {
      return `${where}: write #${j} differs\n  expected: ${e.writes[j] === undefined ? '(none)' : e.writes[j]}\n  got:      ${g.writes[j] === undefined ? '(none)' : g.writes[j]}\n`
        + `  expected writes: ${JSON.stringify(e.writes)}\n  got writes:      ${JSON.stringify(g.writes)}`;
    }
  }
  for (const k of ['facts', 'reports']) {
    if (JSON.stringify(e[k] || []) !== JSON.stringify(g[k] || [])) return `${where}: ${k} expected ${JSON.stringify(e[k] || [])}, got ${JSON.stringify(g[k] || [])}`;
  }
  for (const k of new Set([...Object.keys(e.state), ...Object.keys(g.state)])) {
    if (JSON.stringify(e.state[k]) !== JSON.stringify(g.state[k])) return `${where}: state.${k} expected ${JSON.stringify(e.state[k])}, got ${JSON.stringify(g.state[k])}`;
  }
  return null;
}
