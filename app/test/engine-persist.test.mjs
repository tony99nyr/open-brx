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
import { HILL_TRANSIENT } from '../src/hill.js';
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const SRC = readFileSync(fileURLToPath(new URL('../src/engine.js', import.meta.url)), 'utf8');
const KEY = 'brx.engine';
const STAMPS = new Set(['v', 'savedAt', 'rawSavedAt', 'clockOffset']);   // `_save` stamps these on the write (`v`: the schema version, M4); no field owns them
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

// Final-pass Low (2026-10-11): the hill listener's fields moved to hill.js, out of the engine scan above. Every field a
// HillListener assigns is declared in hill.js HILL_TRANSIENT with the reason a restart may lose it; the possession tally it
// reports stays on Engine (PERSIST_AS), and `_possessionSaved` is DERIVED through the Engine accessor.
test('T2: every hill listener field (hill.js) has a persist decision, with a reason', () => {
  const hsrc = readFileSync(fileURLToPath(new URL('../src/hill.js', import.meta.url)), 'utf8');
  const h = eventful();
  const fields = new Set(Object.keys(h.eng.hl));
  for (const m of hsrc.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=|\|\|=|\?\?=|\+\+|--)/g)) fields.add(m[1]);
  fields.delete('host');   // the engine itself, not state
  const proto = Object.getPrototypeOf(h.eng.hl);   // an accessor (`hill` over `_hill`) is a view, not a field, as in engineFields
  for (const k of [...fields]) { const d = Object.getOwnPropertyDescriptor(proto, k); if (d && (d.get || d.set || typeof d.value === 'function')) fields.delete(k); }
  assert.ok(fields.size >= 15, `setup: the scan found the hill listener's fields (${fields.size})`);
  assert.deepEqual([...fields].filter(f => !HILL_TRANSIENT[f]), [], 'declare these in hill.js HILL_TRANSIENT with the reason a restart may lose them (or persist them through the Engine)');
  assert.deepEqual(Object.keys(HILL_TRANSIENT).filter(k => !fields.has(k)), [], 'stale HILL_TRANSIENT entries: the listener has no such field');
  for (const [k, why] of Object.entries(HILL_TRANSIENT)) assert.ok(typeof why === 'string' && why.length >= 8, `HILL_TRANSIENT.${k} needs a reason`);
  assert.ok(Object.isFrozen(HILL_TRANSIENT), 'the table is frozen');
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
  // _possessionSaved is a DERIVED Engine accessor onto the hill listener (hill.js), so engineFields' own-key walk skips it.
  assert.deepEqual(after._possessionSaved, before._possessionSaved, '_possessionSaved did not survive the restart');
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

// Review round 2 H1: `_load` parks the restored phase in `_pendingPhase` until the gun relinks, and `_save` wrote the CURRENT
// phase. So any save in that gap (the transport connecting, a welcome) stored `idle`, and a second restart lost the match:
// no stun, poison, ammo or heat restore, and the relink re-armed the gun with `$SPAWN` at full health. The force-close cheat
// the persistence closes came back with two restarts.
test('H1: two restarts before the gun relinks keep the live phase, the pools and the stun', () => {
  const h = match();
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.gun.hp = 12; h.frame('$HP,12,70,0,*');
  h.eng._stun(); h.adv(250);
  assert.equal(h.eng.hp, 12, 'setup: 12 HP'); assert.ok(h.eng.stunned, 'setup: stunned');
  h.restart();
  h.eng.setWsState('bound');                                                             // the transport connects
  h.eng.hydrate({ match_id: 'm1', player: h.player, start: h.eng.start });               // and MC's welcome for the same match
  h.adv(250); h.restart();
  const from = h.writes.length;
  h.relink(); h.adv(500);
  assert.equal(h.eng.phase, 'live', 'the match resumes');
  assert.deepEqual(h.writes.slice(from).filter(f => f.startsWith('$SPAWN')), [], 'the gun is not re-spawned');
  assert.equal(h.eng.hp, 12, 'the health stays 12');
  assert.ok(h.eng.stunned, 'the stun is restored');
});

// H1: the welcome-into-a-new-match path drops a restored phase on purpose. A second restart must not bring it back.
test('H1: a phase a new-match welcome dropped stays dropped after a second restart', () => {
  const h = match();
  h.adv(250); h.restart();
  h.eng.hydrate({ match_id: 'm2' });
  assert.equal(h.eng._pendingPhase, null, 'setup: the welcome dropped m1\'s phase');
  h.adv(250); h.restart();
  assert.notEqual(h.eng._pendingPhase, 'live', 'm1\'s live phase does not come back');
  assert.equal(h.eng.stunned, null, 'nor m1\'s restored-only state');
});

// Review round 2 M1: `_save` writes the tally as last REPORTED (`_possessionSig`), and a restart left that empty. So the first
// save after a restart (a welcome, a link change, any `_changed` while waiting for the gun) stored `possession: null`, and a
// second restart lost the tally that the first one kept.
test('M1: a possession tally survives a save after a restart and a second restart', () => {
  const h = match();
  const at = h.eng.now();
  h.eng._accrueHold({ site: 'A', owner: 1, at: at - 1000, source: 'station' }, at);
  h.eng._reportPossession(at, true);
  h.adv(250); h.restart();
  assert.deepEqual(h.eng.hold, { A: { 1: 1000 } }, 'setup: the first restart keeps the tally');
  h.eng.hydrate({ match_id: 'm1', player: h.player });                 // the welcome saves
  h.adv(250); h.restart();
  assert.deepEqual(h.eng.hold, { A: { 1: 1000 } }, 'the second restart keeps it too');
  assert.equal(h.eng.observed.A, 1000);
});

// Restore fixes review r1: three more ways the match a restored phase belongs to can end, or be replaced, while the phase
// waits for the gun. Each must drop it, or the relink resumes the old match live.
function restoredLive() {
  const h = match();
  h.adv(250); h.restart();
  assert.equal(h.eng._pendingPhase, 'live', 'setup: the live phase waits for the gun');
  return h;
}
const spawns = (h, from) => h.writes.slice(from).filter(f => f.startsWith('$SPAWN'));   // only where no end frames (which carry a bare `$SPAWN`) are due

test('Restore r1 #1: a recap welcome with the held match\'s result drops the restored live phase', () => {
  const h = restoredLive();
  h.eng.hydrate({ player: h.player, result: { match_id: 'm1', outcome: 'win' } });   // MC ended m1: no start, no match id
  const from = h.writes.length;
  h.relink(); h.adv(500);
  assert.notEqual(h.eng.phase, 'live', 'the ended match is not resumed');
  assert.equal(h.eng.ended, true, 'the phone shows the match over');
  assert.equal(h.eng.result && h.eng.result.match_id, 'm1', 'with its result');
  assert.ok(!h.eng.spawned && !h.eng.alive, 'the gun is not spawned into it');
  assert.ok(h.writes.slice(from).includes('$STOP,*'), 'the end frames owed to the gun go out on the relink');
});

test('Restore r1 #2: a config for a new game drops the restored live phase, and the relink writes its head', () => {
  const h = restoredLive();
  h.eng.onMcMessage({ kind: 'config', body: { config: { ...h.config, config_id: 'cfg-B' }, frames: { ...golden, config_id: 'cfg-B', player_id: 'p1' }, roster: [] } });
  const from = h.writes.length;
  h.relink(); h.adv(500);
  assert.notEqual(h.eng.phase, 'live', 'm1 is not resumed');
  assert.ok(h.writes.slice(from).includes('$CLEAR,*'), 'the new game\'s head is written');
  assert.deepEqual(spawns(h, from), []);
});

test('Restore r1 #6: a standby assign drops the restored live phase', () => {
  const h = restoredLive();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.config.teams[0], roster: [], standby: true } });
  const from = h.writes.length;
  h.relink(); h.adv(500);
  assert.notEqual(h.eng.phase, 'live', 'a benched player is not resumed');
  assert.ok(!h.eng.spawned && !h.eng.alive, 'the gun is not spawned');
  assert.ok(h.writes.slice(from).includes('$STOP,*'), 'the end frames go out on the relink');
});

// Restore r1 #5: MC replays the stored tallies on its own restart, and a failed replay starts it at zero. So the first tally
// after a phone restart must always be REPORTED, even unchanged; only the SAVE skips it.
test('Restore r1 #5: the first possession tally after a restart is reported, unchanged or not', () => {
  const h = match();
  const at = h.eng.now();
  h.eng._accrueHold({ site: 'A', owner: 1, at: at - 1000, source: 'station' }, at);
  h.eng._reportPossession(at, true);
  h.adv(250); h.restart();
  const before = h.facts.length;
  h.eng._reportPossession(h.eng.now());                                   // not forced
  const sent = h.facts.slice(before).filter(f => f.type === 'possession');
  assert.equal(sent.length, 1, 'the restored tally goes out');
  assert.equal(sent[0].hold_ms[1], 1000);
});

// Restore fixes review r2: the control commands that gate on `this.phase` must see a restored phase that waits for the gun,
// or a restarted phone ignores what a never-restarted phone with its gun down obeys.
function armedIn60s() {
  const h = match({ start: false, stun: undefined });
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: { ...golden, player_id: 'p1' }, roster: [] } });
  h.frame('$LCD,0,0,0,0,0,0,*');
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: h.clock + 60000, config_id: golden.config_id, seq: 1, countdown_s: 60 } });
  h.adv(10);
  assert.equal(h.eng.phase, 'armed', 'setup: armed, T-0 a minute away');
  return h;
}
const t0Writes = (h, from) => h.writes.slice(from).filter(f => /^\$(SPAWN|PSET),/.test(f));

test('Restore r2 #1: an abort_start while a restored ARMED phase waits ends as it does for a phone that never restarted', () => {
  const outcome = restart => {
    const h = armedIn60s();
    if (restart) { h.adv(250); h.restart(); assert.equal(h.eng._pendingPhase, 'armed', 'setup: armed waits for the gun'); }
    else h.eng.onBleDropped();
    h.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1 } });
    if (restart) { h.adv(250); h.restart(); }                            // a second restart before the relink
    h.adv(70000);
    const from = h.writes.length;
    h.relink(); h.adv(1000);
    return { phase: h.eng.phase, spawned: h.eng.spawned, start: h.eng.start, spawn: t0Writes(h, from).filter(f => f.startsWith('$SPAWN')) };
  };
  const never = outcome(false);
  assert.deepEqual(never, { phase: 'lobby', spawned: false, start: null, spawn: [] }, 'setup: the never-restarted phone goes to LOBBY');
  assert.deepEqual(outcome(true), never, 'the restarted phone ends the same way');
});

test('F529: an end that names the match this phone aborted leaves it in the lobby (bench 2026-10-16)', () => {
  // MC aborts, then answers a heartbeat sent just before the abort (still armed in m1) with A34's control{end, m1}.
  const run = abort => {
    const h = armedIn60s();
    if (abort) h.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1 } });
    if (abort) assert.equal(h.eng.phase, 'lobby', 'setup: the abort took the phone to the lobby');
    const from = h.writes.length;
    h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end', match_id: 'm1' } });
    h.adv(500);
    return { phase: h.eng.phase, ended: h.eng.ended, stop: h.writes.slice(from).includes('$STOP,*') };
  };
  assert.deepEqual(run(false), { phase: 'kitted', ended: false, stop: true }, 'CONTROL: an end for the armed match still tears it down (no results: it never went live)');
  assert.deepEqual(run(true), { phase: 'lobby', ended: false, stop: false }, 'the aborted match is not ended on top of the abort');
  const h = armedIn60s();
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1 } });
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.equal(h.eng.phase, 'kitted', 'CONTROL: an end that names no match still tears down a lobby phone, as before');
  const q = armedIn60s();
  q.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1 } });
  q.adv(250); q.restart(); q.relink(); q.adv(500);
  q.eng.onMcMessage({ kind: 'control', body: { cmd: 'end', match_id: 'm1' } });
  assert.equal(q.eng.ended, false, 'a restart keeps the aborted match, so a retried end still finds the phone in the lobby');
  const r = armedIn60s();
  r.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1 } });
  r.eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: r.clock + 60000, config_id: golden.config_id, seq: 2, countdown_s: 60 } });
  r.adv(10);
  assert.equal(r.eng.phase, 'armed', 'setup: the same match re-armed');
  r.eng.onMcMessage({ kind: 'control', body: { cmd: 'end', match_id: 'm1' } });
  assert.equal(r.eng.phase, 'kitted', 'a re-armed match is ended by an end that names it (the `!this.start` guard; MC may never re-arm an aborted id)');
});

test('F529 (Codex review): an abort while a restored ARMED phase waits, with no seq, still ignores the late end', () => {
  const h = armedIn60s();
  h.adv(250); h.restart();
  assert.equal(h.eng._pendingPhase, 'armed', 'setup: armed waits for the gun');
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start' } });
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end', match_id: 'm1' } });
  h.relink(); h.adv(500);
  assert.equal(h.eng.ended, false, 'the aborted match is not ended');
  assert.equal(h.eng.phase, 'lobby');
});

test('F529 HIGH (bench 2026-10-16): after an end $CLEARs the gun, the next start re-writes the head before it arms', () => {
  // The end frames carry `$CLEAR`, which wipes $START/$GSET/$PSET/$WEAP/$SIR. A next match on the SAME config gets no
  // config push, so the phone armed on a head the gun no longer held, and the match ran with no damage.
  const run = (push, restart) => {
    const h = armedIn60s();
    h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
    assert.ok(h.writes.includes('$CLEAR,*') && h.eng.phase === 'kitted', 'setup: the end tore the gun down');
    if (restart) { h.adv(250); h.restart(); h.relink(); h.adv(500); }
    if (push) h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: { ...golden, player_id: 'p1' }, roster: [] } });
    h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: h.clock + 60000, config_id: golden.config_id, seq: 2, countdown_s: 60 } });
    h.adv(10);
    assert.equal(h.eng.phase, 'armed', 'setup: the next match armed');
    const w = h.writes.slice(h.writes.lastIndexOf('$STOP,*'));   // from the end's own teardown
    return { starts: w.filter(f => f === '$START,*').length, gset: w.some(f => f.startsWith('$GSET,')) };
  };
  assert.deepEqual(run(false), { starts: 1, gset: true }, 'no config push: the start re-writes the head');
  assert.equal(run(true).starts, 1, 'CONTROL: a config push already wrote the head, so the start writes it no second time');
  assert.deepEqual(run(false, true), { starts: 1, gset: true }, 'a restart between the end and the start keeps the cleared head');
});

test('F529 HIGH (Codex review): a head write that fails keeps the head marked cleared, and a re-sent start writes it again', async () => {
  const h = armedIn60s();
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  const orig = h.eng._write.bind(h.eng);
  let fail = true;
  h.eng._write = (fr, why, ...a) => { const r = orig(fr, why, ...a); return fail && /^head( |$)/.test(why) ? Promise.resolve(false) : r; };
  const start = { match_id: 'm2', go_live_t: h.clock + 60000, config_id: golden.config_id, seq: 2, countdown_s: 60 };
  h.eng.onMcMessage({ kind: 'start', body: start });
  await new Promise(r => setImmediate(r));
  assert.equal(h.eng._headCleared, true, 'the failed write leaves the head marked cleared');
  fail = false;
  const from = h.writes.length;
  h.eng.onMcMessage({ kind: 'start', body: start });   // MC's re-send of the same schedule
  assert.equal(h.writes.slice(from).filter(f => f === '$START,*').length, 1, 'the re-sent start writes the head again');
  await new Promise(r => setImmediate(r));
  assert.equal(h.eng._headCleared, false, 'a good write clears the mark');
});

test('F529 HIGH (Codex re-review): a head write that fails while ARMED is retried at once, twice at most', async () => {
  const h = armedIn60s();
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  const orig = h.eng._write.bind(h.eng);
  const heads = [];
  h.eng._write = (fr, why, ...a) => { const r = orig(fr, why, ...a); if (/^head( |$)/.test(why)) { heads.push(why); return Promise.resolve(false); } return r; };
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: h.clock + 60000, config_id: golden.config_id, seq: 2, countdown_s: 60 } });
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(heads, ['head (the last teardown cleared it)', 'head retry (armed)', 'head retry (armed)'], 'two retries, then it stops');
  assert.equal(h.eng._headCleared, true, 'the mark stays for the next start');
});

test('F529 (Tony 2026-10-16): a head write that fails while LIVE is healed in the life: retry, re-arm at the same pools, no death', async () => {
  const h = match({ stun: undefined });
  h.frame('$HP,30,70,0,*');
  const deaths = h.eng.deaths, orig = h.eng._write.bind(h.eng);
  let fails = 1;
  h.eng._write = (fr, why, ...a) => { const r = orig(fr, why, ...a); return /^head( |$)/.test(why) && fails-- > 0 ? Promise.resolve(false) : r; };
  const from = h.writes.length;
  h.eng._writeHead('head');                       // e.g. the start's re-write, still in flight at T-0
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  const w = h.writes.slice(from);
  assert.equal(w.filter(f => f === '$START,*').length, 2, 'the failed head is written again');
  assert.ok(w.lastIndexOf('$SPAWN,,*') > w.lastIndexOf('$START,*'), 'then the life is re-armed on it');
  assert.ok(w.indexOf('$LIFE,-15,0,0,*') > w.lastIndexOf('$SPAWN,,*'), `then drained back to the pools it held (45 - 15 = 30): ${JSON.stringify(w.slice(-10))}`);
  assert.equal(h.eng.deaths, deaths, 'no death is booked: the gun setup failed, the player did not');
  assert.equal(h.eng.alive, true);
});

test('F529 (Tony 2026-10-16): a live head that keeps failing falls back to the recovery path, and then stops', async () => {
  const h = match({ stun: undefined });
  const orig = h.eng._write.bind(h.eng);
  const heads = [];
  h.eng._write = (fr, why, ...a) => { const r = orig(fr, why, ...a); if (/^head( |$)|^resync head/.test(why)) { heads.push(why); return Promise.resolve(false); } return r; };
  h.eng._writeHead('head');
  for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r));
  assert.ok(heads.includes('resync head'), `after the retries, the resync recovery writes the head: ${JSON.stringify(heads)}`);
  assert.ok(heads.length <= 5, `and the retries are bounded: ${heads.length}`);
});

test('F529 (Codex review): when even the recovery head fails, the respawn writes the head before its $SPAWN', async () => {
  const h = match({ stun: undefined });
  const orig = h.eng._write.bind(h.eng);
  let fails = 4;   // the head, two heal retries, the resync head
  h.eng._write = (fr, why, ...a) => { const r = orig(fr, why, ...a); return /^head( |$)|^resync head/.test(why) && fails-- > 0 ? Promise.resolve(false) : r; };
  h.eng._writeHead('head');
  for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r));
  assert.equal(fails, 0, 'setup: every write up to the resync head failed');
  assert.equal(h.eng.alive, false, 'setup: the recovery booked its desync death');
  const from = h.writes.length;
  h.adv(8000);   // the normal respawn timer
  const w = h.writes.slice(from), spawn = w.indexOf('$SPAWN,,*');
  assert.ok(spawn > 0 && w.lastIndexOf('$START,*', spawn) >= 0, `the head goes out before the respawn's $SPAWN: ${JSON.stringify(w.slice(0, 6))}`);
});

test('F529 (Opus review): a head that failed with the link dropping is healed on the relink, at the pools of the first failure', async () => {
  const h = match({ stun: undefined });
  h.frame('$HP,30,70,0,*');
  const deaths = h.eng.deaths, orig = h.eng._write.bind(h.eng);
  let fail = true;
  h.eng._write = (fr, why, ...a) => { const r = orig(fr, why, ...a); return fail && /^head( |$)/.test(why) ? Promise.resolve(false) : r; };
  h.eng.onBleDropped();
  h.eng._headCleared = true;   // the head's $CLEAR landed, then the link went: the write failed with the link down
  fail = false;
  const from = h.writes.length;
  h.relink();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  const w = h.writes.slice(from);
  assert.ok(w.includes('$START,*'), `the relink writes the head: ${JSON.stringify(w.slice(0, 8))}`);
  assert.ok(w.indexOf('$LIFE,-15,0,0,*') > w.lastIndexOf('$SPAWN,,*') && w.lastIndexOf('$SPAWN,,*') > w.lastIndexOf('$START,*'), 'then re-arms the life at its pools');
  assert.equal(h.eng.deaths, deaths, 'with no death');
});

test('F529 (brx3): an abort_start that names another match is ignored; one that names this match or no match aborts', () => {
  const other = armedIn60s();
  other.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1, match_id: 'm0' } });
  assert.equal(other.eng.phase, 'armed', 'an abort for another match (MC restarted, seq reused) leaves this start alone');
  const named = armedIn60s();
  named.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1, match_id: 'm1' } });
  assert.equal(named.eng.phase, 'lobby', 'CONTROL: MC re-sends a missed abort with its match_id');
  const bare = armedIn60s();
  bare.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1 } });
  assert.equal(bare.eng.phase, 'lobby', 'CONTROL: the direct abort carries no match_id');
});

test('F529 (brx3, brx5): an end for a match that never went live tears the gun down and goes to KITTED with no result wait', () => {
  const ends = [];
  const armed = armedIn60s(); armed.eng.onEnd = e => ends.push(e);
  armed.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });   // a late end after a RECALL or PANIC in ARMED
  assert.equal(armed.eng.phase, 'kitted');
  assert.ok(armed.writes.includes('$STOP,*'), 'the gun is still torn down');
  assert.equal(armed.eng.ended, false, 'no results screen and no RESULT PENDING for a match that never started');
  assert.deepEqual(ends, [], 'no history entry for it either');
  const live = match({ stun: undefined }); const liveEnds = []; live.eng.onEnd = e => liveEnds.push(e);
  live.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1 } });   // MC aborted; this phone was already live
  assert.equal(live.eng.phase, 'kitted');
  assert.equal(live.eng.ended, false, 'MC aborted the match, so no result ever comes: no results screen');
  const real = match({ stun: undefined });
  real.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.equal(real.eng.ended, true, 'CONTROL: an end for a match that went live still shows the results screen');
});

test('F529 reviews: a no-result end that guessed wrong still shows the result, and the edges around it', () => {
  const res = { match_id: 'm1', outcome: 'win', provisional: false };
  // Codex High: the phone is still ARMED while MC is live and scoring (clock skew). The result comes after the end.
  const late = armedIn60s(); const lateEnds = []; late.eng.onEnd = e => lateEnds.push(e);
  late.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.equal(late.eng.ended, false, 'setup: a no-result end');
  late.eng.onResultPush(res);
  assert.equal(late.eng.ended, true, 'a result for that match brings the results screen back');
  assert.equal(lateEnds.length, 1, 'and its history entry');
  // ...or the result came first.
  const early = armedIn60s();
  early.eng.onResultPush(res);
  early.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.equal(early.eng.ended, true, 'a match MC already scored is a real end');
  // Opus Medium: MC's first config push after a no-result end is the next lobby, not a host lock.
  const lock = armedIn60s();
  lock.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  lock.eng.onMcMessage({ kind: 'config', body: { config: lock.config, frames: { ...golden, player_id: 'p1' }, roster: [] } });
  assert.equal(lock.eng.kitLocked, false, 'no THE HOST LOCKED KITS after a no-result end');
  // Codex Medium: a named re-send with no seq still stops a live phone.
  const live = match({ stun: undefined });
  live.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', match_id: 'm1' } });
  assert.equal(live.eng.phase, 'kitted', 'a named abort with no seq ends the live phone');
  // Opus Low: a restored LIVE phone keeps its results screen on an end; a restored ARMED ignores another match's abort.
  const rl = match({ stun: undefined }); rl.adv(250); rl.restart();
  assert.equal(rl.eng._pendingPhase, 'live', 'setup: live waits for the gun');
  rl.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.equal(rl.eng.ended, true, 'a restored LIVE phone ended a real match');
  const ra = armedIn60s(); ra.adv(250); ra.restart();
  ra.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1, match_id: 'm0' } });
  assert.equal(ra.eng._pendingPhase, 'armed', 'a restored ARMED ignores an abort for another match');
});

test('C.4b HIGH (bench 2026-10-16): a spawn whose own $LCD shows no weapon (slot 0 at 0/0) writes the head again and re-arms', async () => {
  // brx1's frames, a relink at T-1.2 s: the resync head, a write error, then the spawn: `$LCD,45,70,0,0,0,0` and `$ALCD,0,100,0,0,0`.
  const run = echo => {
    const h = match({ start: false, stun: undefined });
    h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: { ...golden, player_id: 'p1' }, roster: [] } });
    h.frame('$LCD,0,0,0,0,0,0,*');
    h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: h.clock + 1000, config_id: golden.config_id, seq: 1, countdown_s: 1 } });
    h.adv(1250);
    assert.equal(h.eng.phase, 'live', 'setup: live');
    const from = h.writes.length;
    h.frame(echo); h.frame('$ALCD,0,100,0,0,0,*');
    return { h, from };
  };
  const r = run('$LCD,45,70,0,0,0,0,*');
  for (let i = 0; i < 5; i++) await new Promise(res => setImmediate(res));
  const w = r.h.writes.slice(r.from);
  assert.ok(w.includes('$START,*'), `the head goes back: ${JSON.stringify(w.slice(0, 6))}`);
  assert.ok(w.lastIndexOf('$SPAWN,,*') > w.lastIndexOf('$START,*'), 'then the life is re-armed on it');
  assert.equal(r.h.eng.deaths, 0, 'no death');
  assert.ok(w.slice(w.lastIndexOf('$SPAWN,,*')).some(f => /^\$AMMO,0,[1-9]/.test(f)), 'and the healed life gets its spawn ammo: the 0/0 was our fault, not the player\'s');
  const c = run('$LCD,45,70,0,0,32,192,*');
  for (let i = 0; i < 5; i++) await new Promise(res => setImmediate(res));
  assert.ok(!c.h.writes.slice(c.from).includes('$START,*'), 'CONTROL: a spawn echo with its magazine needs nothing');
  const other = run('$LCD,45,70,0,1,0,0,*');   // Codex re-check: an empty slot 1 (an F416 read on the secondary) is not a missing head
  for (let i = 0; i < 5; i++) await new Promise(res => setImmediate(res));
  assert.ok(!other.h.writes.slice(other.from).includes('$START,*'), 'only slot 0 at 0/0 reads as no weapon');
  // Reviews: a gun that stays at 0/0 after each fresh head is healed twice at most, then left to the operator.
  const loop = run('$LCD,45,70,0,0,0,0,*');
  for (let k = 0; k < 4; k++) { for (let i = 0; i < 5; i++) await new Promise(res => setImmediate(res)); loop.h.adv(1500); loop.h.frame('$LCD,45,70,0,0,0,0,*'); }
  for (let i = 0; i < 5; i++) await new Promise(res => setImmediate(res));
  assert.equal(loop.h.writes.slice(loop.from).filter(f => f === '$START,*').length, 2, 'two echo heals per start, no loop');
});

test('Restore r2 #2: an abort_start for the live match while a restored LIVE phase waits ends the match', () => {
  const h = match({ stun: undefined });
  h.adv(250); h.restart();
  assert.equal(h.eng._pendingPhase, 'live', 'setup: live waits for the gun');
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'abort_start', seq: 1 } });
  const from = h.writes.length;
  h.relink(); h.adv(500);
  assert.equal(h.eng.ended, false, 'the match is over, and MC aborted it, so no results screen waits for a result (F529)');
  assert.notEqual(h.eng.phase, 'live');
  const w = h.writes.slice(from);
  assert.ok(w.includes('$STOP,*'), 'the end frames go out on the relink');
  assert.ok(w.lastIndexOf('$START,*') > w.indexOf('$STOP,*'), 'and the head goes back after them (F529: the teardown cleared it)');
});

test('Restore r2: an operator relink reaches a restarted phone whose live phase waits for the gun', () => {
  const h = match({ stun: undefined });
  let relinks = 0;
  h.adv(250); h.restart(); h.eng.onRelink = () => { relinks++; };
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'relink', match_id: 'm1', player_id: 'p1' } });
  assert.equal(relinks, 1, 'the gun relink is asked for, as on a phone that never restarted');
});
