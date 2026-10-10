// T2 (maintainability review 2026-10-10): the restart snapshot (`Engine._save`/`_load`) is a hand list of fields, and each
// field it missed became its own bug fix (the hold target, the powerup seen map, stun and poison, F164's live counts).
// These tests make the list a checked one:
//   1. The registry: every Engine instance field is either PERSISTED (in the `_save` blob, under its own name or the one
//      `PERSIST_AS` gives it) or TRANSIENT (`PERSIST_TRANSIENT`, with the reason it may be lost on a restart). A new field
//      that is neither fails here, so whoever adds it must decide.
//   2. The round trip: a live match with real events, then a new Engine on the same storage. Every PERSISTED field, and
//      every TRANSIENT one marked DERIVED (rebuilt by `_load`), must come back equal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, PERSIST_TRANSIENT, PERSIST_AS, isPoolProbe } from '../src/engine.js';
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const SRC = readFileSync(fileURLToPath(new URL('../src/engine.js', import.meta.url)), 'utf8');
const KEY = 'brx.engine';
const STAMPS = new Set(['savedAt', 'rawSavedAt', 'clockOffset']);   // `_save` stamps these on the write; no field owns them
const GUN = { name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' };

/** A live TDM match on a fake gun that answers the node's `$LIFE` ticks (as poison.test.mjs does). `restart()` is the app
 *  process dying and relaunching: a new Engine on the same storage and clock. */
function match({ stun = { duration_s: 30 }, start = true } = {}) {
  let clock = 1_000_000;
  const writes = [], facts = [];
  const gun = { hp: 45, armor: 70, shield: 0 };
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 5 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams, stun };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const pending = [];
  const answer = fr => {
    for (const f of fr) {
      const m = /^\$LIFE,(-?\d+),(-?\d+),(-?\d+),\*$/.exec(f);
      if (!m || isPoolProbe(f)) continue;
      const [dh, da, ds] = m.slice(1).map(Number);
      gun.hp = Math.max(0, gun.hp + dh); gun.armor = Math.max(0, gun.armor + da); gun.shield = Math.max(0, gun.shield + ds);
      pending.push(gun.hp === 0 ? '$LCD,0,0,0,0,30,90,*' : `$HP,${gun.hp},${gun.armor},${gun.shield},*`);
    }
  };
  const mk = storage => new Engine({ writer: fr => { writes.push(...fr); answer(fr); }, emit: f => facts.push(f), report: () => {},
    now: () => clock, wallNow: () => clock, synced: () => true, storage, log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  const h = {
    eng: mk(mkStorage()), writes, facts, gun, player, config,
    frame(f) { h.eng.feedFrame(f); return h; },
    adv(ms, step = 250) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); h.eng.tick(); while (pending.length) h.eng.feedFrame(pending.shift()); } return h; },
    get clock() { return clock; },
    restart() { h.eng = mk(h.eng.storage); return h; },
    relink() { h.eng.onBleConnected(GUN); return h; },
  };
  h.relink();
  h.eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  if (!start) return h;   // KITTED: assigned, no game pushed yet
  h.eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1', dot: { 11: { weapon_id: 'toxin_rifle', per_tick: 1, tick_ms: 1000, duration_ms: 20000 } } }, roster: [] } });
  h.frame('$LCD,0,0,0,0,0,0,*');
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  h.adv(10); h.frame('$LCD,45,70,0,0,30,90,*');
  assert.equal(h.eng.phase, 'live'); assert.equal(h.eng.alive, true);
  return h;
}

/** The match above with real events in it: shots, a reload, a hit, a poison stack, an EMP stun and a held control point. */
function eventful() {
  const h = match();
  for (let m = 30; m > 20; m--) { h.adv(120, 120); h.frame(`$ALCD,${m},100,0,90,0,*`); }   // ten rounds fired
  h.adv(2000); h.frame('$ALCD,30,100,0,60,0,*');                                          // a reload: the magazine refills from reserve
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.gun.armor -= 9; h.frame(`$HP,${h.gun.hp},${h.gun.armor},0,*`);   // a hit
  h.adv(1000);
  h.frame('$HIR,0,11,3,2,4,0,0,*'); h.gun.armor -= 4; h.frame(`$HP,${h.gun.hp},${h.gun.armor},0,*`);   // a toxin hit: a poison stack
  h.adv(500);
  h.eng._stun(); h.adv(500);                                                              // an EMP stun
  const now = h.eng.now();
  h.eng._accrueHold({ site: 'A', owner: 1, at: now - 800, source: 'station' }, now);      // KOTH: this node saw blue hold point A
  h.adv(250); h.eng._accrueHold({ site: 'A', owner: 1, at: h.eng.now(), source: 'station' }, h.eng.now());
  h.eng._reportPossession(h.eng.now(), true);
  h.eng._save();
  assert.equal(h.eng.alive, true, 'setup: still alive');
  assert.ok(h.eng.stunned && h.eng.poison, 'setup: stunned and poisoned');
  assert.ok(h.eng.shots > 0 && h.eng.deaths === 0, 'setup: shots booked');
  return h;
}

/** Every field the engine may own: what a fresh engine and a live one hold, and every `this.<name> =` (or a module host's
 *  `e.<name> =`) in the source, for a field set only on a path this match does not take. Prototype accessors are views onto a module, not fields. */
function engineFields(...engines) {
  const out = new Set();
  for (const e of engines) for (const k of Object.keys(e)) out.add(k);
  for (const m of SRC.matchAll(/\b(?:this|e)\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=|\|\|=|\?\?=|\+\+|--)/g)) out.add(m[1]);   // `e.`: the module hosts
  for (const k of [...out]) { const d = Object.getOwnPropertyDescriptor(Engine.prototype, k); if (d && (d.get || d.set || typeof d.value === 'function')) out.delete(k); }
  return out;
}

/** The blob keys a field persists under, or null when it is not persisted. A blob key named after a field persists that
 *  field unless `PERSIST_AS` gives the key to another field (`am` owns the blob's `ammo`; the engine's own `ammo` is the
 *  HUD's magazine number). */
function persistedAs(field, blobKeys) {
  if (PERSIST_AS[field]) return PERSIST_AS[field];
  const claimed = new Set(Object.values(PERSIST_AS).flat());
  return blobKeys.has(field) && !claimed.has(field) && !STAMPS.has(field) ? [field] : null;
}

test('T2: every Engine field is either persisted by `_save` or declared transient, with a reason', () => {
  const fresh = new Engine({ writer: () => {}, storage: mkStorage(), now: () => 1_000_000 });
  const h = eventful();
  const blob = JSON.parse(h.eng.storage.getItem(KEY));
  const blobKeys = new Set(Object.keys(blob));
  const fields = engineFields(fresh, h.eng);
  assert.ok(fields.size > 200, `setup: the scan found the engine's fields (${fields.size})`);
  const unclassified = [], both = [], missing = [];
  for (const f of fields) {
    const as = persistedAs(f, blobKeys), why = PERSIST_TRANSIENT[f];
    if (as && why) both.push(f);
    else if (!as && !why) unclassified.push(f);
    if (PERSIST_AS[f]) for (const k of PERSIST_AS[f]) if (!blobKeys.has(k)) missing.push(`${f} -> ${k}`);
  }
  assert.deepEqual(unclassified, [], 'persist these in `_save`/`_load`, or add them to PERSIST_TRANSIENT with the reason a restart may lose them');
  assert.deepEqual(both, [], 'persisted AND declared transient: drop the PERSIST_TRANSIENT entry');
  assert.deepEqual(missing, [], 'PERSIST_AS names a blob key `_save` does not write');
  // The other direction: every blob key belongs to a field, and the table names no field the engine does not have.
  const owned = new Set([...STAMPS]); for (const f of fields) for (const k of persistedAs(f, blobKeys) || []) owned.add(k);
  assert.deepEqual([...blobKeys].filter(k => !owned.has(k)), [], 'a blob key no field owns: add it to PERSIST_AS');
  assert.deepEqual(Object.keys(PERSIST_TRANSIENT).filter(k => !fields.has(k)), [], 'stale PERSIST_TRANSIENT entries: the engine has no such field');
  for (const [k, why] of Object.entries(PERSIST_TRANSIENT)) assert.ok(typeof why === 'string' && why.length >= 8, `PERSIST_TRANSIENT.${k} needs a reason`);
  assert.ok(Object.isFrozen(PERSIST_TRANSIENT) && Object.isFrozen(PERSIST_AS), 'the tables are frozen');
});

// How each persisted field is read for the comparison. Named exceptions:
//  - `phase`: `_load` keeps it in `_pendingPhase` until the gun relinks (resumeSchedule), so that is what is compared.
//  - `am`, `pu`: modules with their own snapshot (`am.saved()`, the ALT pointer and `am.heatSaved()`; `pu.snapshot()`).
//  - `stunned`, `poison`: saved as REMAINING ms and rebuilt on the load's clock, so `at` is the load time. The deadlines
//    (`until`, `nextAt`) match because this restart has no wall-clock gap and no clock offset change.
//  - `hold`, `observed`: persisted as the tally last REPORTED to MC (EFF-1: a growing tally would write every tick), so the
//    match above reports just before its save.
const READ = {
  phase: e => (e._pendingPhase !== undefined && e._pendingPhase !== null ? e._pendingPhase : e.phase),
  am: e => ({ saved: e.am.saved(), altPtr: e.am.altPtr, heat: e.am.heatSaved() }),
  pu: e => e.pu.snapshot(),
  stunned: e => e.stunned && { until: e.stunned.until, ammo: e.stunned.ammo },
  poison: e => e.poison && (({ at, ...rest }) => rest)(e.poison),
};

test('T2: a restart mid-match restores every persisted field, and every DERIVED one', () => {
  const h = eventful();
  const before = h.eng;
  h.restart();
  const after = h.eng;
  // Every field not declared transient is one `_save` must keep, whatever the blob holds today.
  const fields = [...engineFields(before)].filter(f => !PERSIST_TRANSIENT[f] || /^DERIVED/.test(PERSIST_TRANSIENT[f]));
  assert.ok(fields.length >= 40, `setup: ${fields.length} fields to compare`);
  const differ = [];
  for (const f of fields) {
    const read = READ[f] || (e => e[f]);
    try { assert.deepEqual(read(after), read(before)); } catch (_) { differ.push(f); }
  }
  assert.deepEqual(differ, [], 'these fields did not survive the restart');
  // The comparison must not be vacuous: the events above moved these off their fresh values.
  assert.ok(after.shots > 0 && after.hp > 0 && after.stunned && after.poison && Object.keys(after.hold).length, 'the restored match carries its events');
});

// A real loss the registry found: the dual-emitter list was cached when a config ARRIVED, so a restarted engine (which
// restores `frames` but takes no config) kept an empty list, and one trigger pull's body and headset words became two shots.
test('T2: after a restart, a dual-emitter pull still counts as one shot group', () => {
  const h = match({ stun: undefined });
  h.restart().relink(); h.frame('$ALCD,0,100,0,0,0,*'); h.adv(4000);
  assert.equal(h.eng.phase, 'live', 'setup: the relink resumed the match');
  const de = golden.dual_emitters[0];
  h.frame(`$HIR,4,${de.proto},19,2,${de.body},0,${de.subtype},*`).frame('$HP,45,50,0,*');
  h.adv(50, 50);
  h.frame(`$HIR,0,${de.proto},19,2,${de.headset},0,${de.subtype},*`).frame('$HP,45,30,0,*');
  const pair = h.facts.filter(f => f.type === 'hit_taken').slice(-2);
  assert.equal(pair.length, 2, 'setup: both words booked a hit');
  assert.equal(pair[0].shot_group, pair[1].shot_group, 'one physical trigger pull counts once');
});

// A real loss: KOTH possession is a per-node CUMULATIVE tally that MC merges by max. A restart zeroed it, so a node
// that held the hill for 60 s, restarted and held 30 s more reported max(60, 30) = 60, not 90.
test('T2: a restart keeps this node\'s possession tally, so the hold time it reports keeps growing from it', () => {
  const h = match();
  const at = h.eng.now();
  h.eng._accrueHold({ site: 'A', owner: 1, at: at - 1000, source: 'station' }, at);
  h.eng._reportPossession(at, true);
  const sent = h.facts.filter(f => f.type === 'possession').pop();
  assert.equal(sent.hold_ms[1], 1000, 'setup: one second held and reported');
  h.adv(250); h.restart();
  assert.deepEqual(h.eng.hold, { A: { 1: 1000 } }, 'the tally survives the restart');
  assert.equal(h.eng.observed.A, 1000);
  h.relink(); h.frame('$ALCD,0,100,0,0,0,*'); h.adv(500);
  const now = h.eng.now();
  h.eng._accrueHold({ site: 'A', owner: 1, at: now - 500, source: 'station' }, now);
  h.eng._reportPossession(now, true);
  assert.equal(h.facts.filter(f => f.type === 'possession').pop().hold_ms[1], 1500, 'the next report adds to it');
});

// A real loss: the panic guard. A WS welcome re-delivers the schedule the operator just panicked, and `_panicked` refuses
// it. The guard lived only in memory, so after a restart the welcome (which can arrive before the gun relinks) armed the
// same start again. The relink's head write ends the guard, with or without a restart, so the test stops short of it.
test('T2: after a panic and a restart, the same schedule re-delivered by a welcome is still refused', () => {
  const h = match();
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'panic' } });
  assert.equal(h.eng.phase, 'kitted', 'setup: the panic stood the gun down');
  h.adv(250); h.restart();
  const same = { match_id: 'm1', go_live_t: h.eng.now() + 5000, config_id: golden.config_id, seq: 1, countdown_s: 5 };
  const r = h.eng.startAt(same);
  assert.equal(r.ok, false, 'the panicked schedule is not re-armed');
  assert.equal(r.reason, 'panicked');
});

// Review r1 #4: the ammo module's heat lockout gates the no-fire verdict. A locked-out gun sends no `$ALCD` while it cools,
// so a restart mid-lockout must not turn the player's dry pulls into GUN NOT FIRING.
test('T2 r1: a restart mid-overheat still exempts the locked gun\'s dry pulls from no_fire', () => {
  for (const restart of [false, true]) {
    const h = match({ stun: undefined });
    h.frame('$ALCD,20,100,0,90,108,*');                                  // the heat weapon locks out
    assert.equal(h.eng.state().overheating, true, 'setup: overheating');
    h.adv(250);
    if (restart) { h.restart().relink(); h.adv(4000); assert.equal(h.eng.phase, 'live', 'setup: resumed'); }
    for (let i = 0; i < 4; i++) { h.frame('$BUT,0,1,*'); h.adv(200, 50); h.frame('$BUT,0,0,*'); h.adv(1800, 50); }   // dry pulls: no `$ALCD` while locked
    assert.equal(h.eng._noFirePulls, 0, `${restart ? 'after a restart' : 'control'}: locked pulls are never counted`);
  }
});

// Review r1 #1: a welcome for a NEW match sets `matchId` before its `start` runs, so `startAt` saw no new match and
// `_resetHill` never ran. The tally a restart restored for match A then went to MC as match B's possession.
test('T2 r1: a restored possession tally never reaches MC as another match\'s', () => {
  const h = match();
  const at = h.eng.now();
  h.eng._accrueHold({ site: 'A', owner: 1, at: at - 1000, source: 'station' }, at);
  h.eng._reportPossession(at, true);
  h.adv(250); h.restart();
  assert.deepEqual(h.eng.hold, { A: { 1: 1000 } }, 'setup: the tally is restored for m1');
  h.eng.hydrate({ match_id: 'm2' });                                   // the welcome names the next match
  const before = h.facts.length;
  h.eng._reportPossession(h.eng.now(), true);
  const m1Tally = h.facts.slice(before).filter(f => f.type === 'possession' && f.match_id === 'm2' && f.hold_ms[1] === 1000);
  assert.deepEqual(m1Tally, [], 'm1\'s hold time is not reported as m2\'s');
  assert.deepEqual(h.eng.state().possession.by_site, {}, 'nor shown');
});

// Review r1 #2: the dual-emitter list must follow `frames` wherever they are replaced, not only at a config or a load.
test('T2 r1: frames a welcome replaces carry their own dual-emitter pairs', () => {
  const h = match({ stun: undefined });
  h.adv(250); h.restart();
  const pairB = { proto: 0, subtype: 0, body: 8, headset: 1, cycle_ms: 100 };
  h.eng.hydrate({ frames: { ...h.eng.frames, dual_emitters: [pairB] } });   // idle, waiting for the gun: no config is applied
  h.relink(); h.frame('$ALCD,0,100,0,0,0,*'); h.adv(4000);
  assert.equal(h.eng.phase, 'live', 'setup: resumed');
  h.frame('$HIR,4,0,19,2,8,0,0,*').frame('$HP,45,62,0,*');
  h.adv(50, 50);
  h.frame('$HIR,0,0,19,2,1,0,0,*').frame('$HP,45,61,0,*');
  const pair = h.facts.filter(f => f.type === 'hit_taken').slice(-2);
  assert.equal(pair.length, 2, 'setup: both words booked a hit');
  assert.equal(pair[0].shot_group, pair[1].shot_group, 'the new frames\' pair counts once');
});

// Review r1 #3: `ready` is not persisted because MC states it. The welcome carries `player.ready` too, and must apply it
// the way `assign` does (on only), or a ready player who restarts before the start sees WAIT while MC counts READY.
test('T2 r1: a ready player who restarts before the start is ready again from the welcome', () => {
  const h = match({ start: false });
  assert.equal(h.eng.phase, 'kitted', 'setup: kitted');
  assert.equal(h.eng.setReady(true), true, 'setup: ready');
  h.adv(250); h.restart();
  h.eng.hydrate({ player: { ...h.player, ready: true } });
  h.relink();
  assert.equal(h.eng.ready, true, 'the welcome restores READY');
});

// Review r2: MC keeps `ready: true` through LIVE and RECAP and clears it only at the next lobby. A welcome in the recap
// (a plain WS reconnect) must not set READY again: the next lobby's `assign` says `ready: false`, which never clears it
// (`assign` only turns READY on), so the HUD showed READY while MC counted WAIT.
test('T2 r2: a welcome in the recap does not carry READY into the next lobby', () => {
  const h = match();
  h.eng.control({ cmd: 'end', match_id: 'm1' });
  assert.ok(h.eng.ended, 'setup: the match ended');
  assert.ok(!h.eng.ready, 'setup: the end cleared READY');
  h.eng.hydrate({ player: { ...h.player, ready: true } });             // the recap welcome: MC still says ready
  assert.ok(!h.eng.ready, 'a recap welcome does not set READY');
  h.eng.onMcMessage({ kind: 'assign', body: { player: { ...h.player, ready: false }, team: h.config.teams[0], roster: [] } });
  assert.ok(!h.eng.ready, 'the next lobby starts at WAIT, as MC counts it');
});
