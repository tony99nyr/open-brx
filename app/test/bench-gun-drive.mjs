// The two drivers of the bench gun model (src/gunmodel.js) over the fixtures in fixtures/bench-gun/:
// - `replayGun`: the bench's own inputs (the phone's writes and the gun's button edges) into the model, and the model's
//   answers matched against the gun's. Used by gun-model-replay.test.mjs.
// - `runPhone`: the bench's button edges into the REAL phone engine, with the model as its gun. Used by
//   gun-model-phone.test.mjs.
//
// A capture's times are when the phone RECEIVED each frame, and BLE delivers some frames late in batches (a shot's
// `$ALCD` up to 400 ms after its trigger edge). So `replayGun` follows the gun after any difference, and a difference
// is EXCUSED only when the model made a call within NEAR_EDGE_MS of the edge that decided it, in the 3 s before.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';
import { GunModel } from '../src/gunmodel.js';
import { golden, base, buildConfig } from './golden-trace-runner.mjs';
import { mkStorage, flush } from './_helpers.mjs';

export const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/bench-gun/', import.meta.url));
export const fixtureNames = () => readdirSync(FIXTURE_DIR).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).sort();
export const loadFixture = name => JSON.parse(readFileSync(FIXTURE_DIR + name + '.json', 'utf8'));
/** BLE batching: a call this close to its deciding edge cannot be read off a capture. */
export const NEAR_EDGE_MS = 100;
/** A model answer the gun has not matched this long after is a difference. */
const STALE_MS = 1500;

const parse = f => {
  const k = f.replace(/,?\*?$/, '').split(',');
  if (k[0] === '$ALCD') return { kind: 'A', s: +k[3], m: +k[1], r: +k[4] };
  if (k[0] === '$LCD') return { kind: 'L', s: +k[4], m: +k[5], r: +k[6] };
  return null;
};
const key = o => `${o.kind}${o.s}:${o.m}/${o.r}`;
/** The step a fixture time falls in: the first mark (a step's own capture end) at or after it. */
export const stepAt = (fx, t) => Object.entries(fx.marks).sort((a, b) => a[1] - b[1]).find(([, e]) => t <= e)?.[0] ?? 'after';

/** The fixture's inputs into a fresh model (full-auto rounds hinted by the gun's own reports), compared answer by answer.
 *  Returns {agree, diffs: [{t, gun, model, slot, excuse}], decisions}. `opts.model` lets a test break the model. */
export function replayGun(fx, opts = {}) {
  const m = opts.model || new GunModel({ auto: 'hinted' });
  for (const f of fx.seed || []) m.write(f, -1);
  if (fx.init) Object.assign(m, JSON.parse(JSON.stringify(fx.init)));
  m.take();
  const q = [], diffs = [];
  let agree = 0, lastSpawn = null, lastShotAt = null;
  const drain = () => { for (const o of m.take()) { if (o.f.startsWith('$ALCD')) lastShotAt = o.t; q.push({ t: o.t, ...parse(o.f) }); } };
  const find = g => q.findIndex(x => key(x) === key(g));
  // a model round the gun never reported: the model fired one the gun did not, so the round goes back
  const expire = t => {
    while (q.length && q[0].t < t - STALE_MS) {
      const x = q.shift();
      diffs.push({ t: x.t, gun: null, model: key(x) });
      if (x.kind === 'A' && x.s < 2 && m.mag[x.s] === x.m && x.t === lastShotAt) m.mag[x.s]++;
    }
  };
  for (const [t, dir, f] of fx.frames) {
    expire(t); m.advance(t); drain();
    if (dir === 'tx') { if (f.startsWith('$SPAWN')) lastSpawn = t; m.write(f, t); drain(); continue; }
    const k = f.replace(/,?\*?$/, '').split(',');
    if (k[0] === '$BUT') { m.button(+k[1], +k[2], t); drain(); continue; }
    const g = parse(f);
    if (!g) continue;
    // a death: the gun's own report of hits the model does not see (not the zeroed `$LCD` of a head, before any spawn)
    if (g.kind === 'L' && /^\$LCD,0,0,/.test(f) && lastSpawn != null) { if (!(t - lastSpawn < 500)) m.died(t); continue; }
    let j = find(g);
    // the gun's own timing, where the bench cannot pin it: one more full-auto round in a hold, a refill a little early,
    // a held trigger firing as the swap ends a little early
    if (j < 0 && g.kind === 'A' && g.s === m.bound && g.m === (m.mag[g.s] ?? 0) - 1 && m.autoRound(t)) { drain(); j = find(g); }
    if (j < 0 && g.kind === 'A' && m.reload && m.reload.slot === g.s && m.reload.until <= t + STALE_MS) { m.advance(m.reload.until); drain(); j = find(g); }
    if (j < 0 && g.kind === 'A' && g.s === m.bound && m.heldFireAt != null && m.heldFireAt <= t + NEAR_EDGE_MS) {
      const h = m.heldFireAt; m.heldFireAt = null; m._heldFire(t); m._decide(t, 'held fire before the swap end', h - t); drain(); j = find(g);
    }
    if (j >= 0) {
      for (const x of q.splice(0, j)) diffs.push({ t: x.t, gun: null, model: key(x) });
      q.shift(); agree++;
      // the gun's count is the truth once nothing newer is in flight for that slot (a round the model fired and the gun
      // did not would otherwise leave every later count one off)
      if (g.kind === 'A' && !q.some(x => x.kind === 'A' && x.s === g.s)) { m.mag[g.s] = g.m; m.res[g.s] = g.r; }
      continue;
    }
    // the gun said something the model did not: record it, then follow the gun
    const shot = g.kind === 'A' && g.s < 2 && g.m === (m.mag[g.s] ?? 0) - 1;
    diffs.push({ t, gun: key(g), model: q.length ? key(q[0]) : null, slot: shot && g.s !== m.bound });
    if (shot) {
      // the round the gun fired is a pull the model refused, so that pull is live from here on
      if (m.trigger) m.trigger = { ...m.trigger, live: true, slot: g.s };
      m.heldFireAt = null; m.fireLockUntil = Math.min(m.fireLockUntil, t); m.swapOnRelease = null;
      if (g.s !== m.bound) { m.bound = g.s; m.altPtr = g.s; }
      m.mag[g.s] = g.m; m.res[g.s] = g.r; m.lastFired = g.s;
      for (let i = q.length - 1; i >= 0; i--) if (q[i].kind === 'A' && q[i].s === g.s && q[i].t <= t) diffs.push({ t: q[i].t, gun: null, model: key(q.splice(i, 1)[0]) });
      continue;
    }
    if (q.length && q[0].kind === g.kind) diffs.push({ t: q[0].t, gun: null, model: key(q.shift()) });
    // the model's older answers for this slot are rounds the gun did not fire: drop them, and take the gun's count
    for (let i = q.length - 1; i >= 0; i--) if (g.kind === 'A' && q[i].kind === 'A' && q[i].s === g.s && q[i].t <= t) diffs.push({ t: q[i].t, gun: null, model: key(q.splice(i, 1)[0]) });
    if (g.kind === 'A') { m.mag[g.s] = g.m; m.res[g.s] = g.r; }
  }
  m.advance(Infinity); drain();
  for (const x of q) diffs.push({ t: x.t, gun: null, model: key(x) });
  for (const d of diffs) {
    const near = m.decisions.filter(([u, , margin]) => u <= d.t + 50 && u > d.t - 3000 && margin < NEAR_EDGE_MS);
    d.excuse = near.length ? near[near.length - 1] : null;
    d.step = stepAt(fx, d.t);
  }
  return { agree, diffs, decisions: m.decisions };
}

// ---------- the phone ----------
/** The bench loadout (Assault Rifle and USP-S) in the golden bundle: the fixture's own `$WEAP` rows, and the spawn rows
 *  that fill them. */
export function benchFrames(fx) {
  const weap = new Map();
  for (const f of [...(fx.seed || []), ...fx.frames.filter(r => r[1] === 'tx').map(r => r[2])]) if (f.startsWith('$WEAP,')) weap.set(f.split(',')[1], f);
  const f = JSON.parse(JSON.stringify(golden));
  f.player_id = base.player.player_id;
  f.head = f.head.map(x => (x.startsWith('$WEAP,') && weap.has(x.split(',')[1]) ? weap.get(x.split(',')[1]) : x));
  const fill = s => { const t = weap.get(String(s)).split(','); return `$AMMO,${s},${t[17]},${t[18]},1,*`; };
  const re = list => list.map(x => (/^\$AMMO,[01],/.test(x) ? fill(+x.split(',')[1]) : x));
  for (const k of ['spawn', 'revive']) f[k] = re(f[k]);
  if (f.respawn_profile) for (const k of Object.keys(f.respawn_profile)) if (Array.isArray(f.respawn_profile[k])) f.respawn_profile[k] = re(f.respawn_profile[k]);
  return f;
}

/** The desync lines: the engine's own word that the gun fired a slot the phone did not show or bind. */
export const DESYNC = /gun was on slot \d|gun fired slot \d+, bound \d/;

/** Run the real engine through one life with the model as its gun: start a match, let the phone spawn, then play the
 *  fixture's button edges from `from` to `to` (fixture ms) at their own spacing. Returns the engine's log lines (with
 *  the fixture time), every write, and the model. */
export async function runPhone(fx, { from, to }) {
  const model = new GunModel({ auto: 'timed' });
  let clock = base.clock0_ms;
  const timers = [], logs = [], writes = [];
  const writer = fr => { writes.push(...fr); for (const f of fr) model.write(f, clock); return undefined; };
  const delay = (ms, fn) => timers.push({ at: clock + ms, fn });
  const storage = mkStorage();
  let offset = null;   // fixture time = clock - offset, once the buttons start
  const eng = new E.Engine({ writer, emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage,
    log: m => logs.push([offset == null ? null : clock - offset, String(m)]), delay, rng: () => 0 });
  const runTimers = () => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > clock) return; timers.shift().fn(); } };
  const pump = () => { for (let n = 0; n < 50; n++) { const o = model.take(); if (!o.length) return; for (const x of o) eng.feedFrame(x.f); } };
  const until = async end => {
    while (clock < end) {
      clock = Math.min(end, clock + 25);
      runTimers(); model.advance(clock); pump(); eng.tick(); runTimers(); pump();
      await flush(); pump();
    }
  };
  const frames = benchFrames(fx), config = buildConfig();
  const team = config.teams.find(t => t.team_id === base.player.team_id);
  const player = { ...base.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'usp' }] } };
  eng.onBleConnected({ ...base.gun_name });
  eng.onMcMessage({ kind: 'assign', body: { player, team, roster: base.roster } });
  eng.onMcMessage({ kind: 'config', body: { config, frames, roster: base.roster } });
  await flush(); pump();
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: config.config_id, seq: 1, countdown_s: 0 } });
  await until(clock + 5000);
  offset = clock - from;
  for (const [t, dir, f] of fx.frames) {
    if (t <= from || t > to || dir !== 'rx' || !f.startsWith('$BUT,')) continue;
    await until(t + offset);
    const k = f.replace(/,?\*?$/, '').split(',');
    eng.feedFrame(f);                 // the gun reports the edge, then whatever the edge did
    model.button(+k[1], +k[2], clock);
    pump(); await flush(); pump();
  }
  await until(to + offset + 4000);
  return { logs, writes, model, state: eng.state(), desyncs: logs.filter(([, l]) => DESYNC.test(l)) };
}
