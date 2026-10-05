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
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const RP = golden.respawn_profile;
const ON = '$TMP,,,,,,,,-100,,,,*', OFF = '$TMP,,,,,,,,0,,,,*';
const HELD = '$BMAP,0,98,,,,,*', LIVE = '$BMAP,0,0,,,,,*';
const TICK = 50;

/** A live match on a clock-driven `delay`, so the play queue really waits for the gun. */
function harness(bundle = golden) {
  const timed = [], timers = []; let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: bundle.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'manual' }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new E.Engine({ writer: fr => { for (const f of fr) timed.push([clock, f]); }, emit: () => {}, report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => timers.push({ at: clock + ms, fn }), rng: () => 0 });
  const runTimers = () => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > clock) return; timers.shift().fn(); } };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...bundle, player_id: 'p1' }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: bundle.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, timed,
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
  await h.adv(15000);
  const w = h.since(n);
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
