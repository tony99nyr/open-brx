// F493 (review 2026-10-05): a revive burst that waits in the play queue behind the native death scream.
// An operator respawn about 100 ms after a death queues the revive burst (`$BMAP,0,98 … $SPAWN … $PLAY VAI`) behind the
// scream (`_drainPlayWrites` `waitsForGun`, F419/F478). The weapon delay and the protection release used to run from the
// QUEUE time, so `$BMAP,0,0` (or the station's `$TMP` t8 0) reached the gun BEFORE the burst that holds the trigger (or
// protects): the player could not fire, or stayed protected, for the whole life. The timers now run from the moment the
// burst reaches the gun. Mirrors: mcp/tests/test_stage_respawn_profile.py (the stage twin), golden trace
// `respawn-operator-in-scream`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';
import { redeployOutMs } from '../src/lanes.js';
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const RP = golden.respawn_profile;
const ON = '$TMP,,,,,,,,-100,,,,*', OFF = '$TMP,,,,,,,,0,,,,*';
const HELD = '$BMAP,0,98,,,,,*', LIVE = '$BMAP,0,0,,,,,*';
const TICK = 50;

/** A live match on a clock-driven `delay`, so the play queue really waits for the gun. */
function harness(bundle = golden) {
  const timed = [], timers = [], facts = []; let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: bundle.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'manual' }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new E.Engine({ writer: fr => { for (const f of fr) timed.push([clock, f]); }, emit: f => facts.push([clock, f]), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => timers.push({ at: clock + ms, fn }), rng: () => 0 });
  const runTimers = () => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > clock) return; timers.shift().fn(); } };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...bundle, player_id: 'p1' }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: bundle.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, timed, facts, timers,
    now: () => clock,
    async adv(ms) {
      const end = clock + ms;
      while (clock < end) { clock = Math.min(end, clock + TICK); runTimers(); eng.tick(); runTimers(); await new Promise(r => setImmediate(r)); }
      return h;
    },
    mark: () => timed.length,
    since: n => timed.slice(n),
    die() { eng.feedFrame('$HIR,4,0,19,2,106,0,3,*'); eng.feedFrame('$HP,0,0,0,*'); return h; },
    operatorRespawn() { eng.onMcMessage({ kind: 'control', body: { cmd: 'respawn', match_id: 'm1' } }); return h; },
  };
  return h;
}
const at = (w, frame) => { const e = w.filter(([, f]) => f === frame); return e.length ? e[e.length - 1][0] : null; };
const idx = (w, frame) => w.map(([, f]) => f).lastIndexOf(frame);

async function liveThenDead() {
  const h = harness();
  await h.adv(4000);
  assert.ok(h.eng.alive, 'live after go-live');
  h.die(); await h.adv(TICK);
  assert.ok(!h.eng.alive, 'down');
  return h;
}

test('F493: an operator respawn inside the death scream: the trigger goes live AFTER the burst, trigger_ms after it lands', async () => {
  const h = await liveThenDead();
  await h.adv(100 - TICK);
  const n = h.mark(); h.operatorRespawn();
  await h.adv(5000);
  const w = h.since(n), heldAt = at(w, HELD), liveAt = at(w, LIVE);
  assert.ok(heldAt != null, 'the burst reached the gun');
  assert.ok(heldAt - (h.now() - 5000) > 500, `the burst waited behind the scream (it went out ${heldAt - (h.now() - 5000)} ms in)`);
  assert.ok(liveAt != null, 'the trigger goes live');
  assert.ok(idx(w, LIVE) > idx(w, HELD), `the last trigger write is LIVE: ${JSON.stringify(w.filter(([, f]) => f.startsWith('$BMAP,0,')))}`);
  assert.ok(liveAt - heldAt >= RP.trigger_ms && liveAt - heldAt <= RP.trigger_ms + 2 * TICK, `weapon delay ${liveAt - heldAt} ms from the burst`);
  assert.equal(h.eng._triggerPending, null);
  assert.equal(h.eng.state().weaponArming, null, 'the HUD stops counting');
});

test('F493 control: a respawn long after the scream keeps its weapon delay from the revive', async () => {
  const h = await liveThenDead();
  await h.adv(3000);
  const n = h.mark(), t0 = h.now(); h.operatorRespawn();
  await h.adv(2000);
  const w = h.since(n);
  assert.equal(at(w, HELD), t0, 'the burst goes at once');
  assert.ok(at(w, LIVE) - t0 >= RP.trigger_ms && at(w, LIVE) - t0 <= RP.trigger_ms + 2 * TICK);
});

test('F493 station twin: a station revive inside the scream ends protection AFTER the burst protected', async () => {
  const bundle = { ...golden, respawn_profile: { ...RP, station_protect_ms: 500 } };
  const h = harness(bundle);
  await h.adv(4000);
  h.die(); await h.adv(100);
  const n = h.mark(); h.eng._revive(false, 3);
  await h.adv(5000);
  const w = h.since(n), onAt = at(w, ON), offAt = at(w, OFF);
  assert.ok(onAt != null && offAt != null, JSON.stringify(w.map(([, f]) => f)));
  assert.ok(idx(w, OFF) > idx(w, ON), `protection ends after it starts: ${JSON.stringify(w.filter(([, f]) => f.startsWith('$TMP')))}`);
  assert.ok(offAt - onAt >= 500 && offAt - onAt <= 500 + 2 * TICK, `protection held ${offAt - onAt} ms from the burst`);
  assert.ok(idx(w, RP.shield_off) > idx(w, RP.shield_on), 'and the shield light goes off after it goes on');
  assert.equal(h.eng._armPending, null);
});

test('F493: the link drops while the burst is queued: no trigger held forever once the gun is back', async () => {
  const h = await liveThenDead();
  await h.adv(100 - TICK);
  const n = h.mark(); h.operatorRespawn();
  await h.adv(300);
  h.eng.onBleDropped();   // cancels the queued burst: it never reached the gun
  await h.adv(3000);
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  await h.adv(2000);
  const deaths = h.eng.deaths;
  h.eng.feedFrame('$HP,0,0,0,*');   // r1 H2: the relink's probe finds what a gun that never got `$SPAWN` holds
  await h.adv(1000);
  let w = h.since(n);
  assert.ok(w.some(([, f]) => f === '$SPAWN,,*'), `r1 H2: the revive burst reaches the gun after the relink: ${JSON.stringify(w.map(([, f]) => f).filter(f => /^\$(SPAWN|BMAP|LIFE)/.test(f)))}`);
  h.eng.feedFrame('$HP,45,70,0,*');   // and the spawned gun answers with its pools, as a real one does
  await h.adv(15000);
  w = h.since(n);
  assert.equal(h.eng.deaths, deaths, 'r1 H2: the unspawned gun\'s 0 pool is no phantom death');
  assert.ok(h.eng.alive);
  const bmaps = w.filter(([, f]) => f.startsWith('$BMAP,0,'));
  assert.ok(!bmaps.length || bmaps[bmaps.length - 1][1] === LIVE, `the gun is never left on a held trigger: ${JSON.stringify(bmaps)}`);
  assert.equal(h.eng._triggerPending, null, 'nothing still waits to free the trigger');
  assert.equal(h.eng._lifeBurst, null, 'the burst hold is released');
});

test('F493: the hold has a cap: a burst that never reports sent cannot hold the timers for ever', async () => {
  const h = await liveThenDead();
  await h.adv(100 - TICK);
  h.operatorRespawn();
  assert.ok(h.eng._lifeBurst, 'the burst is queued behind the scream');
  // A job that never sends and never settles (a lost queue timer): the cap releases the timers.
  h.eng._playQueue.length = 0; if (h.eng._playWaiting) { h.eng._playWaiting.cancelled = true; h.eng._playWaiting = null; }
  const n = h.mark();
  await h.adv(E.LIFE_BURST_HOLD_MAX_MS + 1500);
  assert.equal(h.eng._triggerPending, null, 'the weapon delay ran after the cap');
  assert.ok(h.since(n).some(([, f]) => f === LIVE), 'and freed the trigger');
});

test('F493: a second death while the burst is queued: no stale trigger write for the old life, and the next respawn is clean', async () => {
  const h = await liveThenDead();
  await h.adv(100 - TICK);
  const n = h.mark(); h.operatorRespawn();
  await h.adv(300);
  assert.ok(h.eng._lifeBurst && !h.eng._lifeBurst.sent, 'the burst still waits behind the scream');
  h.eng._death(false);   // the still-dead gun's 0 pool books a death before the burst lands
  assert.ok(!h.eng.alive);
  await h.adv(4000);
  const w = h.since(n);
  assert.ok(!w.some(([, f]) => f === LIVE), `no trigger-live for the old life: ${JSON.stringify(w.map(([, f]) => f).filter(f => f.startsWith('$BMAP')))}`);
  assert.equal(h.eng._triggerPending, null);
  assert.equal(h.eng._lifeBurst, null, 'the old life\'s hold is gone');
  const m = h.mark(), t0 = h.now(); h.operatorRespawn();
  await h.adv(3000);
  const w2 = h.since(m);
  assert.ok(idx(w2, LIVE) > idx(w2, HELD) && idx(w2, HELD) >= 0, 'the next respawn frees the trigger after its burst');
  assert.ok(at(w2, LIVE) - at(w2, HELD) >= RP.trigger_ms, `${at(w2, HELD) - t0} ${at(w2, LIVE) - t0}`);
});

test('F493 r1 H1: a revive burst that waits past PLAY_QUEUE_STALE_MS is never stale-dropped', async () => {
  const h = await liveThenDead();
  await h.adv(100 - TICK);
  h.eng._gun.add(6000, 'synthetic backlog', h.now(), 'X');   // the scream plus 6 s on the gun model: past the stale limit
  const n = h.mark(), t0 = h.now(); h.operatorRespawn();
  await h.adv(12000);
  const w = h.since(n), spawnAt = at(w, '$SPAWN,,*');
  assert.ok(spawnAt != null, 'the burst reaches the gun');
  assert.ok(spawnAt - t0 > E.PLAY_QUEUE_STALE_MS, `it waited ${spawnAt - t0} ms`);
  assert.ok(idx(w, LIVE) > idx(w, HELD) && at(w, LIVE) - at(w, HELD) >= RP.trigger_ms, 'and the trigger goes live after it');
});

test('F493 r1: a must-hear line while the burst is queued never drops the burst', async () => {
  const h = await liveThenDead();
  await h.adv(100 - TICK);
  const n = h.mark(); h.operatorRespawn();
  await h.adv(200);
  h.eng._sayMust('$PLAY,,4,6,VA1,,,,*', 'test kill confirm');
  await h.adv(5000);
  const w = h.since(n);
  assert.ok(w.some(([, f]) => f === '$SPAWN,,*'), 'the burst still reaches the gun');
  assert.ok(idx(w, LIVE) > idx(w, HELD));
});

test('F493 r1 L1: a burst sent after the hold cap re-arms the weapon delay from its send', async () => {
  const h = await liveThenDead();
  await h.adv(100 - TICK);
  h.eng._gun.add(E.LIFE_BURST_HOLD_MAX_MS + 1000, 'synthetic backlog', h.now(), 'X');   // the burst sends after the cap
  const n = h.mark(); h.operatorRespawn();
  await h.adv(E.LIFE_BURST_HOLD_MAX_MS + 6000);
  const w = h.since(n), heldAt = at(w, HELD);
  assert.ok(heldAt != null, 'the burst reaches the gun');
  assert.ok(idx(w, LIVE) > idx(w, HELD), `the last trigger write is LIVE: ${JSON.stringify(w.filter(([, f]) => f.startsWith('$BMAP,0,')))}`);
  assert.ok(at(w, LIVE) - heldAt >= RP.trigger_ms && at(w, LIVE) - heldAt <= RP.trigger_ms + 2 * TICK, `${at(w, LIVE) - heldAt} ms`);
  assert.equal(h.eng._triggerPending, null);
});

// F493 r2 H-A: the spawn read-back (`_spawnProbeTick`, SPAWN_PROBE_MS after `_spawnAt`) ran from the QUEUE time. A burst
// that waited longer than that behind the scream had the probe read a still-dead gun, whose `$HP,0` booked a second death
// and cancelled the burst. The read-back now runs from the burst's send. A real dead gun answers the probe with `$HP,0`.
const SPAWN_PROBE_MS = 2500;   // engine.js SPAWN_PROBE_MS (not exported)
for (const backlog of [0, 1000, 1500, 2500]) {
  test(`F493 r2: the spawn read-back waits for the burst (backlog ${backlog} ms behind the scream)`, async () => {
    const h = await liveThenDead();
    await h.adv(100 - TICK);
    if (backlog) h.eng._gun.add(backlog, 'synthetic backlog', h.now(), 'X');
    const deaths = h.eng.deaths, n = h.mark(), t0 = h.now();
    h.operatorRespawn();
    let spawnAt = null, probeAt = null;
    for (let i = 0; i < 160; i++) {
      await h.adv(50);
      const w = h.since(n);
      if (spawnAt == null) { const s = w.find(([, f]) => f === '$SPAWN,,*'); if (s) spawnAt = s[0]; }
      const p = w.find(([, f]) => f === E.PROBE_LIFE);
      if (probeAt == null && p) { probeAt = p[0]; h.eng.feedFrame(spawnAt == null ? '$HP,0,0,0,*' : '$HP,45,70,0,*'); }
    }
    assert.ok(spawnAt != null, 'the burst reaches the gun');
    assert.ok(probeAt != null && probeAt > spawnAt, `the read-back follows the burst: read-back at ${probeAt - t0} ms, burst at ${spawnAt - t0} ms`);
    // a burst that landed after the read-back was due gets the full SPAWN_PROBE_MS from its send; else the clock is unchanged
    if (spawnAt - t0 >= SPAWN_PROBE_MS) assert.ok(probeAt >= spawnAt + SPAWN_PROBE_MS, `read-back ${probeAt - spawnAt} ms after the burst`);
    else assert.ok(probeAt - t0 >= SPAWN_PROBE_MS && probeAt - t0 <= SPAWN_PROBE_MS + 2 * TICK, `read-back at ${probeAt - t0} ms`);
    assert.equal(h.eng.deaths, deaths, 'no second death');
    assert.ok(h.eng.alive);
  });
}

// F493 r3: the divergence poll and the F272 liveness probe are not gated, so their answer can reach the node while the
// burst still waits, after B5's settle window (from `_spawnAt`, the queue time). The still-dead gun's 0 pool must be held
// as "not yet spawned", never booked; once the burst lands, the gun's own answer to `$SPAWN` moves the pools.
test('F493 r3: a poll answer of 0 during a 3 s queue wait is held, never booked, and the burst lands', async () => {
  const h = await liveThenDead();
  await h.adv(100 - TICK);
  h.eng._gun.add(1800, 'synthetic backlog', h.now(), 'X');   // with the scream, about 3 s in the queue
  const deaths = h.eng.deaths, n = h.mark();
  h.operatorRespawn();
  await h.adv(2000);
  assert.ok(h.eng._lifeBurst && !h.eng._lifeBurst.reached, 'setup: the burst still waits, past the B5 window');
  h.eng.feedFrame('$HP,0,0,0,*');   // the answer to a divergence poll or a liveness probe
  await h.adv(TICK);
  assert.equal(h.eng.deaths, deaths, 'no second death while the burst waits');
  assert.ok(h.eng.alive);
  let w = h.since(n), spawned = false;
  for (let i = 0; i < 60 && !spawned; i++) { await h.adv(TICK); w = h.since(n); spawned = w.some(([, f]) => f === '$SPAWN,,*'); }
  assert.ok(spawned, 'the burst lands');
  await h.adv(100);   // a BLE round trip before the gun answers `$SPAWN`
  assert.equal(h.eng.deaths, deaths, 'the held zero is not booked when the burst lands');
  h.eng.feedFrame('$LCD,45,70,0,0,32,192,*');   // the spawned gun's answer
  await h.adv(4000);
  assert.equal(h.eng.deaths, deaths);
  assert.ok(h.eng.alive && h.eng.hp > 0);
});

// F493 r4 (brx3 review): the killing hit's latch is the LAST life's. An operator respawn 100 ms after a death always has it
// inside DEATH_LATCH_MS, and it used to count as "a fresh latch is a real hit", so a 0-pool read during the queued burst
// booked a second death. A latch is a real hit for this life only when it is newer than this life's spawn.
test('F493 r4: the last life\'s latch does not book a 0 pool read while the revive burst is queued', async () => {
  const h = await liveThenDead();
  const deaths = h.eng.deaths;
  await h.adv(100 - TICK);
  const n = h.mark(); h.operatorRespawn();
  await h.adv(300);
  assert.ok(h.eng._lifeBurstQueued(), 'setup: the burst still waits');
  assert.ok(h.now() - h.eng.latch.at <= 2000, 'setup: the killing hit\'s latch is still inside DEATH_LATCH_MS');
  h.eng.feedFrame('$HP,0,0,0,*');   // the unspawned gun's 0 pool (a poll answer)
  await h.adv(TICK);
  assert.ok(h.eng.alive, 'held, never booked');
  assert.equal(h.eng.deaths, deaths, 'no second death');
  await h.adv(5000);
  const w = h.since(n);
  assert.ok(w.some(([, f]) => f === '$SPAWN,,*'), 'the burst lands');
  assert.ok(idx(w, LIVE) > idx(w, HELD), 'and the trigger goes live after it');
  // the held zero was the last life's: the B5 re-examine never books it once the burst is out (here the gun never answers)
  assert.ok(h.eng.alive, 'still alive after the burst');
  assert.equal(h.eng.deaths, deaths, 'still no second death');
});

// F493 r4 (brx3 review): a link drop longer than F416's window, while the burst is queued. The check's clock ran while the
// link was down, so at the relink it was "out of time" and the unspawned gun's 0 pool booked a death. The window now does
// not age while the link is down. The fake gun answers `$LIFE,0,0,0` with the pool it really holds.
function liveGun() {
  let gunAlive = true;
  const h = harness();
  const writer = h.eng.writer;
  const ans = [];
  h.eng.writer = (fr, why, o) => { for (const f of fr) { if (f === HELD) gunAlive = true; if (f === E.PROBE_LIFE) ans.push(gunAlive ? '$HP,45,70,0,*' : '$HP,0,0,0,*'); } return writer(fr, why, o); };
  const adv = h.adv;
  h.adv = async ms => { const end = h.now() + ms; while (h.now() < end) { await adv(Math.min(TICK, end - h.now())); for (const f of ans.splice(0)) h.eng.feedFrame(f); } return h; };
  const die = h.die;
  h.die = () => { gunAlive = false; return die(); };
  h.gunAlive = () => gunAlive;
  return h;
}
for (const downFor of [3000, 10000]) {
  test(`F493 r4: a link drop of ${downFor} ms while the burst is queued ends live, with the burst re-sent`, async () => {
    const h = liveGun();
    await h.adv(4000);
    h.die(); await h.adv(TICK);
    const deaths = h.eng.deaths;
    await h.adv(100 - TICK);
    const n = h.mark(); h.operatorRespawn();
    await h.adv(200);
    h.eng.onBleDropped();
    await h.adv(downFor);
    h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
    await h.adv(15000);
    const w = h.since(n);
    assert.ok(h.eng.alive && h.gunAlive(), `alive ${h.eng.alive}, gun spawned ${h.gunAlive()}`);
    assert.equal(h.eng.deaths, deaths, 'no phantom death');
    assert.ok(idx(w, LIVE) > idx(w, HELD) && idx(w, HELD) >= 0, 'HELD, then LIVE');
  });
}

// F496/F497: under F493 the weapon delay and the protection run from the burst's SEND. The HUD draws REDEPLOYED once,
// from `state().weaponArming` (hud/moments.js `_redeploy`, lanes.js `redeployOutMs`), and the engine's `_redeployOutAt`
// (`_laneTakeover`, F368) must read the same end. So while the burst waits, `weaponArming` counts the planned wait too:
// the card is drawn long enough to see WEAPONS HOT, it counts down without a jump, and the engine agrees with it.
async function scream(h, kind) {
  const n = h.mark(), t0 = h.now();
  if (kind === 'station') h.eng._revive(false, 3); else h.operatorRespawn();
  const arming0 = h.eng.state().weaponArming, out0 = h.eng._redeployOutAt;
  const seen = [];
  for (let k = 0; k < 5000 / TICK; k++) { await h.adv(TICK); seen.push(h.eng.state().weaponArming); }
  return { w: h.since(n), t0, arming0, out0, seen };
}
test('F496/F497: an operator respawn inside the scream: the card is drawn to outlast the weapon delay, and counts down', async () => {
  const h = await liveThenDead();
  await h.adv(100 - TICK);
  const { w, t0, arming0, out0, seen } = await scream(h, 'timed');
  const heldAt = at(w, HELD), liveAt = at(w, LIVE);
  assert.ok(heldAt - t0 > 500, `setup: the burst waited behind the scream (${heldAt - t0} ms)`);
  assert.ok(Math.abs(arming0 - (liveAt - t0)) <= 2 * TICK, `weaponArming at the revive (${arming0}) counts the wait: the trigger went live ${liveAt - t0} ms in`);
  const drawnOut = t0 + redeployOutMs(arming0);   // what hud/moments.js draws
  assert.ok(drawnOut > liveAt, `the drawn card (${drawnOut - t0} ms) outlasts the weapon delay (live at ${liveAt - t0} ms)`);
  assert.equal(out0, drawnOut, 'the engine stamps the same end the HUD draws (F368)');
  const moved = h.eng._redeployOutAt - drawnOut;   // the harness runs timers on TICK steps, so a send can be up to one TICK late
  assert.ok(moved >= 0 && moved < TICK, `and keeps it: the send was not late (moved ${moved} ms)`);
  const nums = seen.filter(v => v != null);
  for (let k = 1; k < nums.length; k++) assert.ok(nums[k] <= nums[k - 1], `weaponArming never jumps up: ${JSON.stringify(nums)}`);
});

test('F496/F497: a station revive inside the scream draws its card from the revive, and the engine agrees', async () => {
  const bundle = { ...golden, respawn_profile: { ...RP, station_protect_ms: 500 } };
  const h = harness(bundle);
  await h.adv(4000);
  h.die(); await h.adv(100);
  const { w, t0, arming0, out0 } = await scream(h, 'station');
  assert.ok(at(w, ON) - t0 > 500, 'setup: the burst waited behind the scream');
  assert.equal(arming0, null, 'a station life holds no trigger');
  assert.equal(out0, t0 + redeployOutMs(0));
  const moved = h.eng._redeployOutAt - out0;   // up to one harness TICK late
  assert.ok(moved >= 0 && moved < TICK, `the send was not late, so the end stays where the card was drawn (moved ${moved} ms)`);
});

test('F497: a burst sent LATER than planned moves the engine end on by the lateness only', async () => {
  const h = await liveThenDead();
  await h.adv(100 - TICK);
  h.operatorRespawn();
  const out0 = h.eng._redeployOutAt, job = h.eng._playWaiting;
  assert.ok(job && job.life && job.sendAt > h.now(), 'setup: the burst waits with a planned send');
  const timer = h.timers.find(x => x.at === job.sendAt);
  assert.ok(timer, 'setup: the play queue timer for the burst');
  timer.at += 300;   // the link was busy: the burst goes 300 ms after the plan
  await h.adv(3000);
  assert.ok(at(h.timed, HELD) >= job.sendAt + 300, 'setup: the burst went late');
  const moved = h.eng._redeployOutAt - out0;
  assert.ok(moved >= 300 && moved < 300 + TICK, `the end moves on by the lateness (${moved} ms), not by the whole wait`);
});

test('F496 control: a respawn long after the scream keeps REDEPLOYED from the revive', async () => {
  const h = await liveThenDead();
  await h.adv(3000);
  const t0 = h.now(); h.operatorRespawn();
  await h.adv(TICK);
  assert.equal(h.eng._redeployOutAt, t0 + redeployOutMs(RP.trigger_ms));
});

test('F496 / F289: a station revive inside the scream tells MC at once, with the full protection window', async () => {
  const h = harness();
  await h.adv(4000);
  h.die(); await h.adv(100);
  const n = h.mark(), t0 = h.now(), f0 = h.facts.length; h.eng._revive(false, 3);
  const fact = h.facts.slice(f0).find(([, f]) => f.type === 'respawn');
  assert.ok(fact, 'the respawn fact goes out with the revive');
  assert.equal(fact[0], t0, 'at once, before the burst reaches the gun');
  assert.equal(fact[1].protect_ms, RP.station_protect_ms, 'the whole window, which runs from the send');
  await h.adv(5000);
  assert.ok(at(h.since(n), ON) - t0 > 500, 'setup: the burst waited behind the scream');
});
