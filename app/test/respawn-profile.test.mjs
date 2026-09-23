// Respawn profiles (Tony, 2026-09-19; docs/spec/contracts.md §3). A bundle with `respawn_profile`:
//  - GO-LIVE (the T-0 spawn): everyone equal. The live table goes on at T-3 while the head holds every trigger; the
//    spawn write carries no t8 and maps the trigger (Tony, field 2026-09-19).
//  - TIMED (in place: an auto revive, an operator respawn): protection only when the game sets it
//    (default 0 = no `$TMP` at all), the trigger HELD (`$BMAP,0,98`) until `trigger_ms`, then `$BMAP,0,0`. With
//    protection on, the trigger goes live TRIGGER_AFTER_PROTECT_MS after it ends at the earliest. A shot never ends it.
//  - STATION (a revive at a respawn station): protection (default 2 s), the trigger live at once, a shield blink on the
//    headset until protection ends. A shot never ends it.
//  - A death inside SPAWN_KILL_WINDOW_MS of a timed respawn raises the down-screen warning 1 -> 2 -> 3; 3 holds.
// The legacy path (no `respawn_profile`) is pinned by spawn-protect.test.mjs. Mirrors: mcp/tests/test_stage_respawn_profile.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';

const { Engine } = E;
const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const RP = golden.respawn_profile;
const ON = '$TMP,,,,,,,,-100,,,,*';
const OFF = '$TMP,,,,,,,,0,,,,*';
const HELD = '$BMAP,0,98,,,,,*';
const LIVE = '$BMAP,0,0,,,,,*';

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
const tmps = w => w.filter(f => f.startsWith('$TMP'));
const bmap0 = w => w.filter(f => f.startsWith('$BMAP,0,'));
/** A timed list with protection on, as compile.py `life_frames` builds it: t8 right after `$SPAWN`. */
const protectedList = l => { const i = l.indexOf('$SPAWN,,*'); return [...l.slice(0, i + 1), ON, ...l.slice(i + 1)]; };
/** The golden profile with timed protection set to `ms` (compile.py `respawn_settings`: trigger >= protect + 500). */
function timedProtect(ms) {
  return { ...golden, respawn_profile: { ...RP, protect_ms: ms, trigger_ms: Math.max(RP.trigger_ms, ms + 500),
    revive: protectedList(RP.revive) } };   // the T-0 spawn never carries t8
}

function harness({ bundle = golden, mode = 'tdm', respawn = 'auto', leadMs = 0 } = {}) {
  const writes = []; const facts = []; const timed = []; let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: bundle.config_id, mode, environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: respawn, delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: fr => { writes.push(...fr); for (const f of fr) timed.push([clock, f]); }, emit: f => facts.push(f), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...bundle, player_id: 'p1' }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  let match = 0;
  const h = {
    eng, writes, facts, timed, now: () => clock,
    start() { match++; eng.onMcMessage({ kind: 'start', body: { match_id: `m${match}`, go_live_t: clock + leadMs, config_id: bundle.config_id, seq: match, countdown_s: Math.round(leadMs / 1000) } }); return h; },
    adv(ms) { clock += ms; eng.tick(); return h; },
    frame(f) { eng.feedFrame(f); return h; },
    mark() { return writes.length; },
    since(n) { return writes.slice(n); },
    shot(mag) { eng.feedFrame('$BUT,0,1,*'); eng.feedFrame(`$ALCD,${mag},100,0,192,0,*`); eng.feedFrame('$BUT,0,0,*'); return h; },
    die() { eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*'); return h; },
  };
  return h.start();
}
/** Live after T-0, trigger mapped. */
function liveArmed(opts) { const h = harness(opts); h.adv(10); h.adv(5000); return h; }
const stationEntry = () => ({ role: 'station', id: 5, kind: 'respawn', team: 1, state: 1, value: 0, seq: 0, game: 0, threshold: -60, rssi: -50, raw: -50, present: true });
/** Scanner game: dead, past the delay, at the own-team station, pull the trigger (the real station revive path). */
function stationRevive(h) { h.die(); h.adv(9000); h.eng.setStations([stationEntry()]); const n = h.mark(); h.frame('$BUT,0,1,*'); h.frame('$BUT,0,0,*'); assert.equal(h.eng.alive, true, 'setup: revived at the station'); return n; }
/** Down, then back by the 8 s auto respawn. Returns the write index just before the revive. */
function revived(h) { h.die(); h.adv(7990); const n = h.mark(); h.adv(10); assert.equal(h.eng.alive, true, 'setup: revived'); return n; }

test('fixture: the golden profile is the defaults (timed 0 s / 0.5 s, station 2 s) and keeps the legacy lists', () => {
  assert.equal(RP.protect_ms, 0); assert.equal(RP.trigger_ms, 500); assert.equal(RP.station_protect_ms, 2000);
  assert.deepEqual(tmps(RP.spawn), [], 'the default timed spawn carries no $TMP');
  assert.deepEqual(tmps(RP.revive), [], 'the default timed revive carries no $TMP');
  assert.deepEqual(bmap0(RP.revive), [HELD], 'the timed revive holds the trigger');
  assert.deepEqual(bmap0(RP.revive_station), [LIVE], 'the station revive maps the trigger');
  assert.deepEqual(tmps(RP.revive_station), [ON], 'the station revive is protected');
  assert.equal(RP.revive_station[RP.revive_station.length - 1], RP.shield_on, 'the shield is the last frame');
  assert.ok(/^\$HLED,6,2,/.test(RP.shield_on), 'the shield is a white blink');
  assert.deepEqual(tmps(golden.revive), [ON], 'the legacy revive is unchanged for an app before 0.4.3');
});

/** What the gun would do with a hit at time `t`, from every frame written up to then (bench facts: `$SPAWN` zeroes
 *  every `$TMP` token; t8 = -100 means 0 damage; a `$SIR` cell on fn 28 registers a hit and moves nothing; the table
 *  survives `$SPAWN`; the trigger row decides whether the gun fires). */
function gunAt(timed, t) {
  let t8 = 0; const cell = {}; let trigger = null; let spawned = false;
  for (const [at, f] of timed) {
    if (at > t) break;
    const k = f.split(',');
    if (f === '$SPAWN,,*') { t8 = 0; spawned = true; }
    else if (f.startsWith('$TMP,')) t8 = Number(k[8] || 0);
    else if (f.startsWith('$SIR,')) cell[`${k[1]},${k[2]}`] = k[4];
    else if (f.startsWith('$CLEAR')) { for (const c of Object.keys(cell)) delete cell[c]; }
    else if (f.startsWith('$BMAP,0,')) trigger = k[2];
  }
  const live = golden.sir_pool[0].map(f => f.split(',')).filter(k => k[4] !== '28');
  const armed = live.length > 0 && live.every(k => cell[`${k[1]},${k[2]}`] === k[4]);
  return { spawned, hitDamages: spawned && t8 !== -100 && armed, canFire: spawned && trigger === '0' };
}

test('go-live is equal for everyone: at T-0 nobody is protected, every trigger is live, and a hit 0.2 s later does damage', () => {
  for (const bundle of [golden, timedProtect(2000)]) {   // whatever the respawn settings say
    const h = harness({ bundle, leadMs: 10000 });
    const goLive = h.now() + 10000;
    while (h.now() < goLive + 200) h.adv(250);
    assert.equal(h.eng.phase, 'live');
    const atGo = gunAt(h.timed, goLive + 250);   // the first tick at or after go-live has spawned the gun
    assert.equal(atGo.canFire, true, 'the trigger is live at go-live');
    assert.equal(atGo.hitDamages, true, 'a hit at go-live does damage');
    assert.equal(gunAt(h.timed, goLive + 450).hitDamages, true, 'and 0.2 s after it');
    const spawnAt = h.timed.find(([, f]) => f === '$SPAWN,,*')[0];
    assert.deepEqual(h.timed.filter(([, f]) => f.startsWith('$TMP')), [], 'no t8 at all at go-live');
    assert.equal(gunAt(h.timed, spawnAt - 1).canFire, false, 'the head held the trigger through the countdown');
    const tableAt = h.timed.find(([, f]) => f === golden.sir_pool[0][0])[0];
    assert.ok(tableAt <= goLive - 2500 && tableAt >= goLive - 3250, `the live table went on at T-3 (${goLive - tableAt} ms before go-live)`);
    assert.equal(h.eng._armPending, null, 'nothing to end after go-live');
    assert.equal(h.eng.state().weaponArming, null, 'no weapon delay at go-live');
  }
});

test('go-live, late start (no T-3): the T-0 spawn write carries the live table in front of $SPAWN', () => {
  const h = harness();   // countdown 0: the start message itself runs the T-0 spawn
  const i = h.writes.indexOf('$SPAWN,,*');
  assert.ok(i > 0, 'spawned');
  const take = golden.sir_pool[0];
  assert.deepEqual(h.writes.slice(0, i).filter(f => f.startsWith('$SIR,')).slice(-take.length), take, 'the table goes first');
  assert.deepEqual(tmps(h.writes), []);
  assert.deepEqual(bmap0(h.writes.slice(i)), [LIVE]);
  assert.equal(gunAt(h.timed, h.now()).hitDamages, true);
});

test('timed defaults: a revive writes no $TMP, holds the trigger, and maps it at 0.5 s', () => {
  const h = liveArmed();
  const n = revived(h);
  assert.deepEqual(tmps(h.since(n)), []);
  assert.deepEqual(bmap0(h.since(n)), [HELD]);
  h.adv(490); assert.deepEqual(bmap0(h.since(n)), [HELD]);
  h.adv(10); assert.deepEqual(bmap0(h.since(n)), [HELD, LIVE]);
});

test('timed weapon delay 3 s: pulls on the held trigger owe no shot (F208 does not call the gun dead)', () => {
  const h = liveArmed({ bundle: { ...golden, respawn_profile: { ...RP, trigger_ms: 3000 } } });
  const n = revived(h);
  for (let i = 0; i < 4; i++) { h.frame('$BUT,0,1,*'); h.frame('$BUT,0,0,*'); h.adv(600); }
  assert.equal(h.eng._noFirePulls, 0, 'a pull on a held trigger is not a gun that does not fire');
  assert.equal(h.eng.poolStale(), null);
  assert.ok(h.eng.state().weaponArming > 0);
  h.adv(600); assert.deepEqual(bmap0(h.since(n)), [HELD, LIVE], 'live at 3 s');
});

test('review 2026-09-19: operator RESYNC must not release a weapon delay hold ($BMAP,0,0 while _triggerPending is set)', () => {
  const h = liveArmed({ bundle: { ...golden, respawn_profile: { ...RP, trigger_ms: 3000 } } });
  const n = revived(h);
  assert.deepEqual(bmap0(h.since(n)), [HELD], 'setup: the revive holds the trigger');
  assert.ok(h.eng._triggerPending, 'setup: the weapon delay is still running');
  const m = h.mark();
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'resync', player_id: 'p1', match_id: 'm1' } });
  assert.deepEqual(bmap0(h.since(m)), [], 'RESYNC must not write $BMAP,0,0 while the weapon delay holds the trigger');
  assert.ok(h.eng._triggerPending, 'the hold itself must survive the resync');
  h.adv(3000);   // the delay elapses on its own clock, unaffected by the resync
  assert.deepEqual(bmap0(h.since(m)), [LIVE], 'the delay timer still goes live once it is over');
});

test('timed protection 1 s: t8 -100 after $SPAWN, t8 0 at 1 s (a shot does not end it), trigger live at 1.5 s', () => {
  const h = liveArmed({ bundle: timedProtect(1000) });
  const n = revived(h);
  const rev = h.since(n);
  const i = rev.indexOf('$SPAWN,,*');
  assert.deepEqual(rev.slice(i, i + 3), ['$SPAWN,,*', ON, '$TID,1,*'], 'the bench-proven order');
  h.frame('$ALCD,32,100,0,192,0,*');   // the $AMMO echo, so the next report is a round leaving
  h.adv(300); h.shot(31);
  assert.deepEqual(tmps(h.since(n)), [ON], 'a shot does not end timed protection');
  h.adv(689); assert.deepEqual(tmps(h.since(n)), [ON], 'still protected at 0.99 s');
  h.adv(11); assert.deepEqual(tmps(h.since(n)), [ON, OFF], 't8 0 at 1 s');
  assert.deepEqual(bmap0(h.since(n)), [HELD], 'the trigger is still held when protection ends');
  h.adv(489); assert.deepEqual(bmap0(h.since(n)), [HELD], 'not live at 1.49 s');
  h.adv(11); assert.deepEqual(bmap0(h.since(n)), [HELD, LIVE], 'live at 1.5 s: 0.5 s after protection ended');
});

test('station: t8 -100, trigger live at once, the shield on; a shot does not end it; t8 0 and the shield off at 2 s', () => {
  const h = liveArmed({ respawn: 'scanner' });
  const n = stationRevive(h);
  assert.equal(h.facts.filter(f => f.type === 'respawn').pop().station, 5);
  const rev = h.since(n);
  const i = rev.indexOf('$SPAWN,,*');
  assert.deepEqual(rev.slice(i, i + 3), ['$SPAWN,,*', ON, '$TID,1,*']);
  assert.deepEqual(bmap0(rev), [LIVE], 'the trigger is live in the revive write itself');
  assert.ok(rev.includes(RP.shield_on), 'the shield is on');
  assert.equal(h.eng.state().shielded, true); assert.equal(h.eng.state().weaponArming, null);
  assert.equal(h.since(n).filter(f => f.startsWith('$HLED')).pop(), RP.shield_on, 'no respawn flash paints over the shield');
  h.frame('$ALCD,32,100,0,192,0,*');
  h.adv(300); h.shot(31);
  assert.deepEqual(tmps(h.since(n)), [ON], 'shooting does not end station protection');
  const m = h.mark(); h.adv(300); h.frame('$HIR,1,0,19,2,0,0,3,*');
  assert.deepEqual(h.since(m), [RP.shield_on], 'a hit wipes a painted colour, so the shield is painted again');
  h.adv(1390); assert.deepEqual(tmps(h.since(n)), [ON], 'still protected at 1.99 s');
  const k = h.mark(); h.adv(10);
  assert.deepEqual(h.since(k).filter(f => f.startsWith('$TMP') || f.startsWith('$HLED')), [OFF, RP.shield_off], 't8 0, then the shield off, at 2 s');
  assert.equal(h.eng.state().shielded, false);
  const j = h.mark(); h.adv(5000);
  assert.deepEqual(tmps(h.since(j)), [], 'nothing more');
});

test('escalation: a death inside the window after a timed respawn raises the warning 1 -> 2 -> 3, and 3 holds', () => {
  const h = liveArmed();
  assert.equal(h.eng.state().downWarn, 1);
  h.adv(20000).die();
  assert.equal(h.eng.state().downWarn, 1, 'the T-0 spawn is not a respawn: no escalation');
  h.adv(8000);                      // timed respawn
  h.adv(3000).die();
  assert.equal(h.eng.state().downWarn, 2, 'killed 3 s after a timed respawn');
  h.adv(8000); h.adv(20000).die();
  assert.equal(h.eng.state().downWarn, 2, 'a death after the window leaves the level where it is');
  h.adv(8000); h.adv(9000).die();
  assert.equal(h.eng.state().downWarn, 3);
  h.adv(8000); h.adv(1000).die();
  assert.equal(h.eng.state().downWarn, 3, 'level 3 is the ceiling');
  h.adv(8000); h.adv(60000).die();
  assert.equal(h.eng.state().downWarn, 3, 'and it stays for the rest of the match');
  h.adv(8000);
  h.eng._endLocal('test'); h.start();
  assert.equal(h.eng.state().downWarn, 1, 'a new match starts at level 1');
});

test('escalation: a station revive does not start the spawn-kill window', () => {
  const h = liveArmed({ respawn: 'scanner' });
  stationRevive(h);
  h.adv(2000).die();
  assert.equal(h.eng.state().downWarn, 1);
});

test('escalation: a re-sent start for the SAME match does not reset the level (a bumped seq, a resumed schedule)', () => {
  const h = liveArmed();
  h.adv(20000).die();          // the T-0 life ends
  h.adv(8000);                 // the auto (timed) respawn
  h.adv(3000).die();
  assert.equal(h.eng.state().downWarn, 2, 'setup: escalated once');
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: h.now(), config_id: golden.config_id, seq: 2, countdown_s: 0 } });
  assert.equal(h.eng.state().downWarn, 2, 'a start for the SAME match must not reset the escalation');
});

// 2026-09-19 review findings: a trigger can stay held the rest of the life when `trigger_live` is lost (a BLE drop
// in flight, a GATT-false write refused a retry by `_actSeq`, or an app restart during the delay), and the T-0
// pre-arm write can lose a race with go-live and leave the gun on the head's silent table all life.

test('review: a failed trigger_live write retries even if a shot or hit landed in the same window ($BMAP,0,0 repeats safely)', async () => {
  const h = liveArmed();
  const n = revived(h);
  const realWriter = h.eng.writer;
  h.eng.writer = () => Promise.resolve(false);   // the 0.5 s trigger_live write "fails" (GATT false)
  h.adv(500);
  h.eng._actSeq++;                               // a shot or a hit landed in the same window
  h.eng.writer = realWriter;
  await new Promise(r => setImmediate(r));       // let the retry's own write land
  assert.deepEqual(bmap0(h.since(n)), [HELD, LIVE], 'the retry still lands: a moved _actSeq must not refuse it');
});

test('review: a relink reconcile re-sends trigger_live when the weapon delay has already passed', async () => {
  const h = liveArmed();
  const n = revived(h);
  h.adv(500);   // the weapon delay is over -- trigger_live already sent once
  assert.deepEqual(bmap0(h.since(n)), [HELD, LIVE]);
  assert.equal(h.eng._triggerPending, null, 'setup: nothing pending -- the trigger should already be live');
  const m = h.mark();
  h.eng.onBleDropped();
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.ok(h.eng.reconciling, 'setup: relink reconciles');
  h.adv(3000);   // RECONCILE_MS
  await new Promise(r => setImmediate(r));
  assert.equal(h.eng.reconciling, null, 'reconcile over');
  assert.ok(h.since(m).includes(LIVE), 'the reconcile repairs a trigger_live write that may never have landed');
});

test('review: a pre-arm write that fails AFTER go-live repairs instead of leaving the gun silent all life', async () => {
  const h = harness({ leadMs: 10000 });
  const preArmTake = golden.sir_pool[0];
  const realWriter = h.eng.writer;
  let resolvePreArm = null;
  h.eng.writer = fr => {
    if (resolvePreArm === null && fr.length === preArmTake.length && fr[0] === preArmTake[0]) {
      h.writes.push(...fr);
      return new Promise(r => { resolvePreArm = r; });
    }
    h.writes.push(...fr);
  };
  const goLive = h.now() + 10000;
  while (h.now() < goLive + 200) h.adv(250);   // through T-3 (issues the pre-arm write) and past go-live
  assert.equal(h.eng.phase, 'live');
  assert.equal(h.eng._sirLive, true, 'optimistic: assumed live before the write settled');
  assert.equal(h.eng._armPending, null, 'nothing pending at go-live, as usual');
  assert.ok(resolvePreArm, 'setup: the pre-arm write is still in flight');
  resolvePreArm(false);   // it fails only now, after the T-0 spawn already ran on the optimistic assumption
  await new Promise(r => setImmediate(r));
  h.eng.writer = realWriter;
  assert.ok(h.eng._armPending, 'repaired: nothing else would ever retry a lost pre-arm write once live');
  const before = h.writes.length;
  h.adv(10);
  assert.ok(h.writes.length > before, 'and the repair actually writes the table again');
});

test('review: a retried protection-off write pushes the trigger due so it never goes live while t8 is still -100', async () => {
  const h = liveArmed({ bundle: timedProtect(1000) });   // protect_ms 1000 ms, trigger_ms 1500 ms
  const n = revived(h);
  const realWriter = h.eng.writer;
  h.eng.writer = () => Promise.resolve(false);   // the 1 s cap's off write "fails"
  h.adv(1000);
  await new Promise(r => setImmediate(r));
  h.eng.writer = realWriter;
  assert.ok(h.eng._armPending, 'setup: the failed off write re-arms for retry (1 s on)');
  h.adv(490);   // 1.49 s since revive -- past the ORIGINAL 1.5 s due, but protection never really ended
  assert.deepEqual(bmap0(h.since(n)), [HELD], 'must not go live while t8 is still -100');
  h.adv(20);    // 1.51 s -- still short of the retry at 2 s
  assert.deepEqual(bmap0(h.since(n)), [HELD], 'still held past the original 1.5 s due');
  h.adv(500);   // 2.01 s -- the retry has now run and succeeded
  assert.deepEqual(tmps(h.since(n)).slice(-1), [OFF], 'the retry landed');
  h.adv(500);   // 2.51 s -- retry (2 s) + TRIGGER_AFTER_PROTECT_MS (0.5 s)
  assert.deepEqual(bmap0(h.since(n)), [HELD, LIVE], 'live only once safely past the retried protection-off');
});

// F289: only the phone ends spawn protection, so a phone that dies inside the window leaves the gun unhittable. The
// node tells MC the window at once (`protect_ms` on the respawn fact) and while it lasts (status `protected`), so MC
// can flag an OFFLINE player as possibly protected.
test('F289: a station life reports its protection window at once and while the phone still owes the end write', () => {
  const h = liveArmed({ respawn: 'scanner' });
  assert.equal(h.eng.statusBody().protected, undefined, 'no claim before the respawn');
  stationRevive(h);
  assert.equal(h.facts.filter(f => f.type === 'respawn').pop().protect_ms, RP.station_protect_ms);
  assert.equal(h.eng.statusBody().protected, true, 'protected while the end write is owed');
  h.eng.onBleDropped(); h.adv(5000);
  assert.equal(h.eng.statusBody().protected, true, 'a link that stays down cannot end it, so the claim stays');
  const k = h.mark(); h.eng.onBleConnected(); h.adv(3000);
  assert.ok(tmps(h.since(k)).includes(OFF), 'the reconnect ends protection');
  assert.equal(h.eng.statusBody().protected, undefined, 'no claim once the end write went out');
});
test('F289: a timed life with no protection claims nothing', () => {
  const h = liveArmed();
  h.die(); h.adv(9000);
  assert.equal(h.eng.alive, true, 'setup: auto revive');
  assert.equal(h.facts.filter(f => f.type === 'respawn').pop().protect_ms, undefined);
  assert.equal(h.eng.statusBody().protected, undefined);
});
test('F289: a timed life with protection on reports its window', () => {
  const h = liveArmed({ bundle: timedProtect(1000) });
  h.die(); h.adv(9000);
  assert.equal(h.facts.filter(f => f.type === 'respawn').pop().protect_ms, 1000);
  assert.equal(h.eng.statusBody().protected, true);
  h.adv(1000);
  assert.equal(h.eng.statusBody().protected, undefined, 'ended on the clock');
});
