// F264 (bench 2026-09-18): a player was dead on the gun and alive on the HUD for 94 s. `poolStale()` said
// `no_fire` 16 s in and again a minute later, and NOTHING acted on it either time. The node now acts -- and it
// asks the gun first, because `no_fire` has two proven causes and only one of them wants a revive:
//   the gun died and the killing $HP/$LCD never arrived (cure: the revive head, which carries $SPAWN), or
//   the node's magazine count is ahead of the gun's after a timed-out reload (cure: nothing, the player reloads).
// Every test here breaks one of those rules; the CONTROLs pin the neighbouring path that must not move.
// Mirrors: mcp/tests/test_stage_cure.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, QUERY_POLL_MS, QUERY_REPLY_MS, CURE_ASKS, CURE_COOLDOWN_MS, CURE_MAX_BLIND, NO_FIRE_PULLS } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const QUERY = '$QUERY,*';
const VOLTS = '$VOLTS,8428,4164,100,100,*';
const HEAT_LOCKOUT = 99;   // engine.js's own constant, not exported: a reading at or past this is a real lockout

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

/** A live, spawned, alive node whose gun has reported a full magazine. `delay_s: 8` so the auto-respawn is
 *  reachable inside a test without a minute of simulated time. */
function harness({ respawn = 'auto' } = {}) {
  let clock = 1_000_000;
  const writes = [], facts = [], logs = [], askedAt = [];
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }];
  const config = { config_id: golden.config_id, mode: 'ffa', environment: 'outdoor', night: false, time_limit_s: 1800,
    respawn: { type: respawn, delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'ROCCO', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: fr => { for (const f of fr) { writes.push(f); if (f === QUERY) askedAt.push(clock); } }, emit: f => facts.push(f), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: l => logs.push(l), delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1' }, roster: [] } });
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, writes, facts, logs,
    adv(ms, step = 250) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); eng.tick(); } return h; },
    /** Advance while HOLDING a state the ordinary tick would clear on its own -- a reload deadline expires, a stun
     *  timer runs out, a heat reading goes stale after HEAT_STALE_MS. Re-applied before every step, so the guard
     *  under test is still true at the moment the cure would have run. */
    advHold(ms, apply, step = 250) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); apply(h); eng.tick(); } return h; },
    f(fr) { eng.feedFrame(fr); return h; },
    shot(mag) { return h.f('$BUT,0,1,*').f(`$ALCD,${mag},100,0,192,0,*`).adv(200).f('$BUT,0,0,*'); },
    /** One trigger pull the gun never answers: press, release, and past TRIGGER_NO_FIRE_MS so the tick books it. */
    pull() { return h.f('$BUT,0,1,*').adv(200).f('$BUT,0,0,*').adv(1800); },
    /** The pulls that make `poolStale()` say `no_fire`, and nothing more. */
    stall(n = NO_FIRE_PULLS) { for (let i = 0; i < n; i++) h.pull(); return h; },
    queries() { return askedAt.length; },
    askedAt,
    gaps() { return askedAt.slice(1).map((t, i) => t - askedAt[i]); },
    /** Tick until the next `$QUERY,*` goes out, and stop on the step it did -- so a reply fed straight after is
     *  inside QUERY_REPLY_MS, as a real gun's would be. */
    awaitAsk(maxMs = QUERY_POLL_MS * 2) {
      const n = askedAt.length, end = clock + maxMs;
      while (clock < end && askedAt.length === n) { clock = Math.min(end, clock + 250); eng.tick(); }
      assert.ok(askedAt.length > n, 'no ask went out');
      return h;
    },
    since(n) { return writes.slice(n); },
    log(re) { return logs.filter(l => re.test(l)); },
  };
  h.adv(10);
  h.f('$LCD,45,70,0,0,30,90,*').adv(3000).shot(29);   // live, the gun has spoken, one shot fired
  assert.equal(eng.phase, 'live'); assert.equal(eng.alive, true);
  return h;
}

/** Answer the ask the node just sent, as a real gun does: the status array (pool MAXIMA, deliberately useless
 *  here) and then the `$LCD` carrying the live pools and magazine. */
function reply(h, hp, armor = 70, mag = 30, reserve = 90) {
  return h.f('$QUERY,7,1,45,70,0,0,1,*').f(`$LCD,${hp},${armor},0,0,${mag},${reserve},*`);
}

// ---------------------------------------------------------------- the trigger

test('F264: the cure asks at NO_FIRE_PULLS unanswered pulls, and not at one fewer', () => {
  const h = harness();
  h.adv(QUERY_POLL_MS + 1000);                 // let the divergence poll have its turn first, so it is not the ask under test
  const n = h.writes.length, polls = h.queries();
  h.stall(NO_FIRE_PULLS - 1);
  assert.equal(h.eng.poolStale(), null, 'CONTROL: two unanswered pulls are not yet a claim');
  assert.equal(h.queries(), polls, 'and nothing is asked');
  h.pull();
  assert.equal(h.eng.poolStale().why, 'no_fire');
  assert.equal(h.queries(), polls + 1, `the third pull asks the gun exactly once: ${JSON.stringify(h.since(n))}`);
  assert.ok(h.log(/asking the gun what it thinks/).length === 1, 'and says why');
});

test('F264: the ask is ONE frame and it is $QUERY, which the deny list passes', () => {
  const h = harness();
  const n = h.writes.length;
  h.stall();
  assert.deepEqual(h.since(n).filter(w => w !== QUERY), [], `the cure writes nothing but the ask: ${JSON.stringify(h.since(n))}`);
  assert.equal(h.eng.refused || 0, 0, '`$QUERY` is a known command, never refused by `_write`');
});

// ---------------------------------------------------------------- the dead gun

test('F264: a $LCD reply with health 0 books exactly ONE death, marked desync, and the ordinary respawn cures the gun', () => {
  const h = harness();
  h.stall();
  assert.equal(h.eng.alive, true, 'setup: the node still believes the player is alive');
  reply(h, 0, 0, 0, 0);
  const deaths = h.facts.filter(f => f.type === 'death');
  assert.equal(deaths.length, 1, `exactly one death fact: ${JSON.stringify(deaths)}`);
  assert.equal(deaths[0].desync, true, 'the node learned it out of band, from its own question (§3.3)');
  assert.equal(h.eng.alive, false); assert.equal(h.eng.deaths, 1);
  assert.equal(h.eng.state().poolStale, null, 'the stale claim is answered');
  const n = h.writes.length;
  h.adv(9000);                                  // past respawn.delay_s
  assert.ok(h.since(n).some(w => w.startsWith('$SPAWN')), `the respawn writes the revive head: ${JSON.stringify(h.since(n))}`);
  const rs = h.facts.filter(f => f.type === 'respawn');
  assert.equal(rs.length, 1); assert.equal(rs[0].auto, undefined, 'an ordinary respawn after a real death, not the blind cure');
});

test('F264: a dead reply cures nothing by itself -- the cure books no death of its own', () => {
  const h = harness();
  h.stall();
  const n = h.writes.length;
  reply(h, 0, 0, 0, 0);
  assert.deepEqual(h.since(n).filter(w => w.startsWith('$SPAWN')), [], 'the answer itself writes no spawn: the respawn timer owns that');
  assert.equal(h.facts.filter(f => f.type === 'death').length, 1, 'and there is one death, not two');
});

// ---------------------------------------------------------------- the live gun

test('F264: a reply with health above 0 and an EMPTY magazine never revives and never writes ammo', () => {
  const h = harness();
  h.stall();
  const n = h.writes.length;
  reply(h, 45, 70, 0, 90);                      // alive, magazine empty: the timed-out reload, not a death
  assert.equal(h.eng.alive, true, 'no revive');
  assert.deepEqual(h.since(n), [], `no write at all -- an $AMMO here would hand out a free magazine: ${JSON.stringify(h.since(n))}`);
  assert.equal(h.facts.filter(f => f.type === 'respawn').length, 0);
  assert.ok(h.log(/EMPTY magazine/).length === 1, 'and says which case it chose');
  // THE CURE IS THE REPLY ITSELF: the `$LCD` carried the gun's real magazine, so the node's count is no longer
  // ahead of it and the next pull is an honest dry pull. A pull the node still believed was loaded would be
  // owed a shot, and `_noFirePulls` would count it.
  h.pull();
  assert.equal(h.eng._noFirePulls, 0, 'the reply corrected the count, so the next pull owes no shot at all');
});

test('F264: a reply with health above 0 and a loaded magazine re-asserts the arming and does not revive', () => {
  const h = harness();
  h.stall();
  const n = h.writes.length;
  reply(h, 45, 70, 25, 90);                     // alive, loaded, and still not answering the trigger
  assert.equal(h.eng.alive, true, 'no revive');
  assert.equal(h.facts.filter(f => f.type === 'respawn').length, 0, 'and no free life');
  const w = h.since(n);
  assert.deepEqual(w.filter(f => f.startsWith('$SPAWN') || f.startsWith('$PSET')), [], `nothing that heals or re-heads: ${JSON.stringify(w)}`);
  assert.ok(w.some(f => f.startsWith('$AMMO,')), `the live counts go back: ${JSON.stringify(w)}`);
  assert.ok(w.some(f => f.startsWith('$BMAP,0,0')), 'and the trigger mapping');
});

// ---------------------------------------------------------------- no reply at all

test('F264: no reply falls back to the revive head ONCE, after CURE_ASKS asks, and flags the fact auto', () => {
  const h = harness();
  const polls = h.queries();
  h.stall();
  assert.equal(h.queries() - polls, 1, 'setup: the cure has asked once');
  h.adv(QUERY_REPLY_MS + 300);
  assert.equal(h.queries() - polls, CURE_ASKS, `a lost notification is ordinary: it asks ${CURE_ASKS} times`);
  assert.equal(h.eng.alive, true, 'and still nothing written blind');
  const n = h.writes.length;
  h.adv(QUERY_REPLY_MS + 300);
  const w = h.since(n);
  assert.equal(w.filter(f => f.startsWith('$SPAWN')).length, 1, `exactly one revive head: ${JSON.stringify(w)}`);
  const rs = h.facts.filter(f => f.type === 'respawn');
  assert.equal(rs.length, 1); assert.equal(rs[0].auto, true, 'MC must be able to tell a blind cure from a real respawn');
  assert.ok(h.log(/taken blind/).length === 1, 'and the log says it was taken blind');
  const n2 = h.writes.length;
  h.stall();                                    // the fresh life goes straight back to not firing
  assert.equal(h.since(n2).filter(f => f === QUERY).length, 0, 'the cooldown refuses a second cure in the same breath');
});

test('F264: a gun that answers $QUERY but sends no $LCD is never revived blind', () => {
  const h = harness();
  h.stall();
  h.f('$QUERY,7,1,45,70,0,0,1,*');               // the array, and nothing behind it
  h.adv((QUERY_REPLY_MS + 300) * 2);
  assert.equal(h.eng.alive, true, 'a gun that is still talking is not guessed at');
  assert.equal(h.facts.filter(f => f.type === 'respawn').length, 0);
  assert.ok(h.log(/still talking/).length === 1);
});

test('F264: blind fallbacks stop at CURE_MAX_BLIND and hand the gun to the operator', () => {
  const h = harness();
  let blind = 0;
  for (let round = 0; round < CURE_MAX_BLIND + 2; round++) {
    h.adv(CURE_COOLDOWN_MS + 1000);
    h.f('$ALCD,29,100,0,192,0,*');               // the gun reports a pool, so `no_fire` can build again
    h.stall();
    h.adv((QUERY_REPLY_MS + 300) * CURE_ASKS);
    blind = h.facts.filter(f => f.type === 'respawn' && f.auto).length;
  }
  assert.equal(blind, CURE_MAX_BLIND, `it gives up after ${CURE_MAX_BLIND}, rather than respawning a dead gun forever`);
  assert.ok(h.log(/FORCE RESPAWN or RELINK/).length >= 1, 'and names the human cure');
});

// ---------------------------------------------------------------- the stand-downs

for (const [name, apply] of [
  ['overheat', h => { h.eng.heatBySlot[0] = HEAT_LOCKOUT + 9; h.eng._heatAt[0] = h.eng.now(); }],
  ['stun', h => { h.eng.stunned = { at: h.eng.now(), until: h.eng.now() + 10000, ammo: { 0: [29, 90] } }; }],
  ['reload', h => { h.eng.reloading = { at: h.eng.now(), slot: 0, ms: 1400 }; }],
  ['switching', h => { h.eng.switching = { at: h.eng.now(), from: 0 }; }],
  ['resync', h => { h.eng.resync = { step: 'await', since: h.eng.now() }; }],
  ['reconcile', h => { h.eng.reconciling = { since: h.eng.now() }; }],
  ['link down', h => { h.eng.onBleDropped(); }],
  ['down', h => { h.eng.alive = false; h.eng.deadAt = h.eng.now(); }],
]) {
  test(`F264: ${name} suppresses the cure entirely -- it is never even started`, () => {
    const h = harness();
    h.stall();
    assert.equal(h.eng.poolStale() && h.eng.poolStale().why, 'no_fire', 'setup: the detector has concluded');
    h.eng._cure = null; h.eng._cureLife = null; h.eng._cureAt = 0;   // ...and the cure has not run yet
    const n = h.writes.length;
    h.advHold((QUERY_REPLY_MS + 300) * (CURE_ASKS + 1), apply);
    const w = h.since(n);
    assert.equal(h.eng._cureLife, null, `${name} must never start a cure`);
    assert.equal(h.eng._cure, null, `${name} must leave no ask in flight`);
    assert.deepEqual(w.filter(f => f.startsWith('$SPAWN')), [], `${name} must never reach a revive: ${JSON.stringify(w)}`);
    assert.deepEqual(w.filter(f => f.startsWith('$AMMO,') || f.startsWith('$BMAP,')), [], `${name} must never re-assert the arming: ${JSON.stringify(w)}`);
    assert.equal(h.facts.filter(f => f.type === 'respawn' && f.auto).length, 0);
  });
}

test('F264: an ask in flight when the link drops is abandoned, not timed out into a blind revive', () => {
  const h = harness();
  h.stall();
  assert.ok(h.eng._cure, 'setup: an ask is outstanding');
  h.eng.onBleDropped();
  // The drop itself must drop the ask. Assert the mechanism, not the outcome: the relink opens a reconcile,
  // which stands the cure down anyway, so an end-to-end "no $SPAWN appeared" would pass with this line gone.
  assert.equal(h.eng._cure, null, 'no link, no answer: the ask cannot resolve and must not time out into a revive');
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  const n = h.writes.length;
  h.adv((QUERY_REPLY_MS + 300) * (CURE_ASKS + 1));
  assert.deepEqual(h.since(n).filter(f => f.startsWith('$SPAWN')), [], 'and the relink owes the old ask nothing');
});

// ---------------------------------------------------------------- the poll

test('F264: the divergence poll runs only in a live match, at QUERY_POLL_MS', () => {
  const h = harness();
  assert.equal(h.queries(), 1, 'the first live tick asks once');
  const n = h.queries();
  h.adv(QUERY_POLL_MS * 3 + 500);
  assert.equal(h.queries() - n, 3, `3 asks in 3 cadences, no more: ${h.queries() - n}`);
  for (const g of h.gaps()) assert.ok(g >= QUERY_POLL_MS && g < QUERY_POLL_MS + 250, `every gap is one cadence, not a burst: ${h.gaps().join(', ')}`);
  h.eng._endLocal('time-expiry');
  const w = h.writes.length;
  h.adv(QUERY_POLL_MS * 3);
  assert.deepEqual(h.since(w).filter(f => f === QUERY), [], 'a match that is over polls nothing');
});

test('F264: a lobby gun is never polled, by the call site AND by the guard', () => {
  const h = harness();
  h.eng.phase = 'lobby';
  const n = h.writes.length;
  h.adv(QUERY_POLL_MS * 3);
  assert.deepEqual(h.since(n).filter(f => f === QUERY), [], 'the tick only reaches the poll in a live match');
  // ...and `_pollTick` refuses on its own, reached directly. Without this half the `phase` guard inside it is
  // unfalsifiable: the call site already hides it, so the guard could be deleted and this test would still pass.
  h.eng._pollAt = 0; h.eng._cure = null;
  h.eng._pollTick(h.eng.now());
  assert.deepEqual(h.since(n).filter(f => f === QUERY), [], 'and the guard refuses the phase by itself');
});

test('F264: a poll reply does not clear the no-fire count -- it answered our question, not the trigger', () => {
  const h = harness();
  h.pull(); h.pull();
  assert.equal(h.eng._noFirePulls, 2, 'setup: two unanswered pulls');
  h.awaitAsk();                                  // the next divergence poll, answered inside its window
  reply(h, 45, 70, 25, 90);
  assert.equal(h.eng._noFirePulls, 2, 'the solicited $LCD leaves the unanswered pulls standing');
  assert.equal(h.eng.state().poolStale, null, 'CONTROL: two is still not a claim');
  // CONTROL: an UNSOLICITED pool frame is the gun answering the trigger, and still clears it.
  h.f('$ALCD,24,100,0,192,0,*');
  assert.equal(h.eng._noFirePulls, 0);
});

test('F264: a poll that finds the gun dead books the death without anyone pulling a trigger', () => {
  const h = harness();
  h.awaitAsk();                                 // a poll, with nobody having touched the trigger
  assert.equal(h.eng._cure, null, 'setup: this is the poll, not a cure');
  reply(h, 0, 0, 0, 0);
  const deaths = h.facts.filter(f => f.type === 'death');
  assert.equal(deaths.length, 1, 'the divergence is caught with no dead trigger pulled');
  assert.equal(deaths[0].desync, true);
  assert.equal(h.eng.alive, false);
});

test('F264: the write cost of the poll is 3 frames a minute and nothing else', () => {
  const h = harness();
  const n = h.writes.length;
  h.adv(60000);
  const w = h.since(n).filter(f => f === QUERY);
  assert.equal(w.length, 3, `${w.length} asks in a quiet minute`);
  assert.equal(QUERY.length, 8, 'and each is 8 bytes on a wire the gun reads one byte at a time');
});
