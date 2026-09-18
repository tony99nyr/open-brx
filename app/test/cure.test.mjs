// F264 (bench 2026-09-18): a player was dead on the gun and alive on the HUD for 94 s. `poolStale()` said
// `no_fire` 16 s in and again a minute later, and NOTHING acted on it either time. The node now acts, and it
// ASKS the gun first, because `no_fire` has two proven causes and only one of them is a dead gun:
//   the gun died and the killing $HP/$LCD never arrived, or
//   the node's magazine belief is AHEAD of the gun's, so a healthy empty gun looks broken.
// It never revives on no evidence. Every test here breaks one of those rules; the CONTROLs pin the
// neighbouring path that must not move. Mirrors: mcp/tests/test_stage_cure.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, PROBE_LIFE, QUERY_POLL_MS, QUERY_REPLY_MS, CURE_ASKS, CURE_COOLDOWN_MS, NO_FIRE_PULLS } from '../src/engine.js';

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
    /** Only a CURE sends `$LIFE`; the heartbeat poll and the spawn read-back send `$QUERY` alone. So this counts
     *  cures, and `queries()` counts every ask of any kind. */
    cures() { return writes.filter(f => f === PROBE_LIFE).length; },
    askedAt,
    gaps() { return askedAt.slice(1).map((t, i) => t - askedAt[i]); },
    /** Tick until the next probe goes out, and stop on the step it did, so a reply fed straight after is inside
     *  QUERY_REPLY_MS as a real gun's would be. */
    awaitAsk(maxMs = QUERY_POLL_MS * 2) {
      const n = askedAt.length, end = clock + maxMs;
      while (clock < end && askedAt.length === n) { clock = Math.min(end, clock + 250); eng.tick(); }
      assert.ok(askedAt.length > n, 'no probe went out');
      return h;
    },
    since(n) { return writes.slice(n); },
    log(re) { return logs.filter(l => re.test(l)); },
    verdict() { return h.eng.cure && h.eng.cure.verdict; },
    status() { return h.eng.statusBody(); },
  };
  h.adv(10);
  h.f('$LCD,45,70,0,0,30,90,*').adv(3000).shot(29);   // live, the gun has spoken, one shot fired
  h.adv(4000);                                        // ...and past the once-a-life spawn read-back, so it is never the probe under test
  assert.equal(eng.phase, 'live'); assert.equal(eng.alive, true);
  return h;
}

/** The `$QUERY` half of a reply, as a real gun sends it: the status array (pool MAXIMA, deliberately useless
 *  here) and then the `$LCD` carrying the live pools and magazine. */
function queryReply(h, hp, armor = 70, mag = 30, reserve = 90) {
  return h.f('$QUERY,7,1,45,70,0,0,1,*').f(`$LCD,${hp},${armor},0,0,${mag},${reserve},*`);
}
/** The `$LIFE,0,0,0` half, on the reading where a dead gun answers at all. `$HP` carries no magazine. */
function lifeReply(h, hp, armor = 70) { return h.f(`$HP,${hp},${armor},0,*`); }

// ---------------------------------------------------------------- the probe itself

test('F264: the dead-gun probe is byte-exactly all-zero, and a live gun is never revived by it', () => {
  assert.equal(PROBE_LIFE, '$LIFE,0,0,0,*',
    '$LIFE with a NON-ZERO token 1 is the REVIVE path: a dead gun applies it and comes back. If this constant ever '
    + 'grows an argument, the first argument somebody passes will be a heal.');
  const h = harness();
  const n = h.writes.length;
  h.stall();
  const sent = h.since(n).filter(f => f.startsWith('$LIFE'));
  assert.deepEqual(sent, [PROBE_LIFE], `the node sent ${JSON.stringify(sent)}`);
  for (const f of sent) assert.deepEqual(f.split(',').slice(1, 4), ['0', '0', '0'], 'every pool token is zero');
});

test('F264: the cure probes at NO_FIRE_PULLS unanswered pulls, and not at one fewer', () => {
  const h = harness();
  const n = h.writes.length, polls = h.queries();
  h.stall(NO_FIRE_PULLS - 1);
  assert.equal(h.eng.poolStale(), null, 'CONTROL: two unanswered pulls are not yet a claim');
  assert.equal(h.queries(), polls, 'and nothing is asked');
  h.pull();
  assert.equal(h.eng.poolStale().why, 'no_fire');
  assert.deepEqual(h.since(n), [PROBE_LIFE, QUERY], `the third pull probes, and probes only: ${JSON.stringify(h.since(n))}`);
  assert.equal(h.verdict(), 'asking');
  assert.equal(h.status().cure, 'asking', 'and the heartbeat carries it, so the board is not left guessing');
  assert.equal(h.eng.refused || 0, 0, 'both probes are known commands, never refused by `_write`');
});

// ---------------------------------------------------------------- the dead gun

test('F264: a $QUERY reply with health 0 books exactly ONE death, marked desync, and the ordinary respawn cures it', () => {
  const h = harness();
  h.stall();
  assert.equal(h.eng.alive, true, 'setup: the node still believes the player is alive');
  queryReply(h, 0, 0, 0, 0);
  const deaths = h.facts.filter(f => f.type === 'death');
  assert.equal(deaths.length, 1, `exactly one death fact: ${JSON.stringify(deaths)}`);
  assert.equal(deaths[0].desync, true, 'the node learned it out of band, from its own question (§3.3)');
  assert.equal(h.eng.alive, false); assert.equal(h.eng.deaths, 1);
  assert.equal(h.verdict(), 'dead');
  assert.equal(h.eng.state().poolStale, null, 'the stale claim is answered');
  const n = h.writes.length;
  h.adv(9000);                                  // past respawn.delay_s
  assert.ok(h.since(n).some(w => w.startsWith('$SPAWN')), `the respawn writes the revive head: ${JSON.stringify(h.since(n))}`);
  assert.equal(h.facts.filter(f => f.type === 'respawn').length, 1, 'an ordinary respawn after a real death');
});

test('F264: a $LIFE,0,0,0 reply of $HP,0 books the death through the same one path, with no new branch', () => {
  const h = harness();
  h.stall();
  lifeReply(h, 0, 0);                           // the reading where a dead gun DOES answer $LIFE (levers §22 settles it)
  const deaths = h.facts.filter(f => f.type === 'death');
  assert.equal(deaths.length, 1, 'the existing `_onHp` death path consumes it: the cure books nothing itself');
  assert.equal(deaths[0].desync, true);
  assert.equal(h.verdict(), 'dead');
  assert.equal(h.eng.alive, false);
});

test('F264: the answer itself writes nothing -- the respawn timer owns the revive', () => {
  const h = harness();
  h.stall();
  const n = h.writes.length;
  queryReply(h, 0, 0, 0, 0);
  const w = h.since(n);
  assert.deepEqual(w.filter(f => !f.startsWith('$GLED') && !f.startsWith('$HLED')), [],
    `nothing but the death's own LED work follows the answer: ${JSON.stringify(w)}`);
  assert.deepEqual(w.filter(f => f.startsWith('$SPAWN') || f.startsWith('$AMMO')), [], 'and certainly no revive and no ammo');
});

// ---------------------------------------------------------------- the live gun, and the false positive

test('F264 THE FALSE POSITIVE: a stale ammo belief on a healthy EMPTY gun re-asserts ammo and never revives', () => {
  // Tony, 2026-09-18. `_awaitShot` owes a shot only when the node's own account says the magazine has rounds, so
  // an ordinary empty gun never reaches `no_fire`. This is the case where that BELIEF is wrong: the node was told
  // 12 rounds by a reload that then timed out, the gun actually has none, and the player pulls three times. The
  // gun was never broken. A revive here would hand a live player a free respawn and wipe their magazine state.
  const h = harness();
  h.f('$ALCD,12,100,0,90,0,*');                 // the node's belief: 12 in the magazine
  h.stall();
  assert.equal(h.eng.poolStale().why, 'no_fire', 'setup: a perfectly good gun now reads as broken');
  const n = h.writes.length;
  queryReply(h, 45, 70, 0, 90);                 // the gun: alive, healthy, and EMPTY
  assert.equal(h.eng.alive, true, 'NEVER a revive');
  assert.equal(h.facts.filter(f => f.type === 'respawn').length, 0, 'and never a free life');
  assert.equal(h.verdict(), 'alive');
  const w = h.since(n);
  assert.deepEqual(w.filter(f => f.startsWith('$SPAWN') || f.startsWith('$PSET')), [], `nothing that heals or re-heads: ${JSON.stringify(w)}`);
  assert.deepEqual(w, ['$AMMO,0,0,90,1,*', '$BMAP,0,0,,,,,*'],
    `the re-assert carries the GUN'S OWN numbers, not the node's 12: ${JSON.stringify(w)}`);
  h.pull();
  assert.equal(h.eng._noFirePulls, 0, 'and the corrected count makes the next pull an honest dry pull');
});

test('F264 THE COMPANION: a CORRECT belief of an empty magazine never counts a pull, so the cure never runs', () => {
  // This pins `_awaitShot`'s `_dryPull` guard (engine.js), which nothing else protects. Delete that guard and a
  // player who simply fires dry reaches `no_fire`, and the cure starts probing guns that are working perfectly.
  const h = harness();
  h.f('$ALCD,0,100,0,90,0,*');                  // the gun says empty, and the node believes it: the honest case
  const n = h.writes.length;
  h.stall(NO_FIRE_PULLS + 3);
  assert.equal(h.eng._noFirePulls, 0, 'an empty magazine dry-fires: no shot is owed, ever');
  assert.equal(h.eng.poolStale(), null, 'so there is no claim');
  assert.equal(h.eng.cure, null, 'and no cure');
  assert.deepEqual(h.since(n).filter(f => f === QUERY || f === PROBE_LIFE), [], 'and not one probe frame');
});

test('F264: the re-assert reads the REPLY, not the node belief -- the belief is the thing under suspicion', () => {
  // End to end the two AGREE, because the `$LCD` has already corrected the ammo account by the time the
  // re-assert runs. That makes the end-to-end test above unable to tell them apart, so pin the mechanism
  // directly here: the frame carries the numbers it was HANDED. Build it from `_acctLive` instead and this
  // fails. It matters because the node's belief is exactly what is under suspicion in this fault, and an
  // `$AMMO` built from a stale one would hand out a free magazine.
  const h = harness();
  h.f('$ALCD,12,100,0,90,0,*');                 // the node believes 12 rounds
  assert.equal(h.eng._acctLive(0), 12, 'setup: and its account says so');
  const n = h.writes.length;
  h.eng._cureReassert(0, 90);                   // ...while the gun's reply said 0
  assert.deepEqual(h.since(n), ['$AMMO,0,0,90,1,*', '$BMAP,0,0,,,,,*'], 'the reply wins, always');
});

test('F264: a live gun with a loaded magazine is re-asserted, not revived', () => {
  const h = harness();
  h.stall();
  const n = h.writes.length;
  queryReply(h, 45, 70, 25, 90);                // alive, loaded, and still not answering the trigger
  assert.equal(h.eng.alive, true);
  assert.deepEqual(h.since(n), ['$AMMO,0,25,90,1,*', '$BMAP,0,0,,,,,*'], 'the gun\'s own counts and the trigger map');
  assert.equal(h.verdict(), 'alive');
});

test('F264: a $LIFE reply alone proves alive but carries no magazine, so only the trigger map goes back', () => {
  const h = harness();
  h.stall();
  const n = h.writes.length;
  lifeReply(h, 45, 70);                         // $HP has no ammo tokens at all
  assert.equal(h.eng.alive, true);
  assert.deepEqual(h.since(n), ['$BMAP,0,0,,,,,*'], 'no $AMMO invented from a belief the reply did not carry');
  assert.ok(h.log(/magazine not reported/).length === 1, 'and the log says the magazine was unknown');
});

// ---------------------------------------------------------------- no answer: do nothing, loudly

test('F264: no answer means the node does NOTHING, records no_answer, and asks for a human', () => {
  const h = harness();
  const polls = h.queries();
  h.stall();
  assert.equal(h.queries() - polls, 1, 'setup: the cure has probed once');
  const n = h.writes.length;
  h.adv(QUERY_REPLY_MS + 300);
  assert.equal(h.queries() - polls, CURE_ASKS, `a lost notification is ordinary: it probes ${CURE_ASKS} times`);
  h.adv(QUERY_REPLY_MS + 300);
  const w = h.since(n).filter(f => f !== QUERY && f !== PROBE_LIFE);
  assert.deepEqual(w, [], `NOTHING is written on no evidence: ${JSON.stringify(w)}`);
  assert.equal(h.eng.alive, true, 'no revive');
  assert.equal(h.facts.filter(f => f.type === 'respawn').length, 0, 'and no free life');
  assert.equal(h.verdict(), 'no_answer');
  assert.equal(h.status().cure, 'no_answer', 'the heartbeat carries it: a phone log reached nobody on 2026-09-18');
  const loud = h.log(/doing NOTHING and asking for a human/);
  assert.equal(loud.length, 1, 'and the log says so once');
  assert.match(loud[0], /FORCE RESPAWN/, 'naming the thing that works');
  assert.match(loud[0], /hp 45/, 'with the pools it believed');
  assert.match(loud[0], /in the magazine/, 'and the ammo belief at the time');
});

test('F264: a reply the token map does not fit is treated as no reply', () => {
  // transport-hardening.md §6 / levers claim 19: the `$QUERY` token map is confirmed by SHAPE only, on an
  // unconfigured gun. Trusting a reply that does not fit would be worse than ignoring it.
  const h = harness();
  h.stall();
  const n = h.writes.length;
  h.f('$QUERY,7,1,45,70,0,0,1,*').f('$LCD,45,*');   // too few tokens to be the map we have
  assert.equal(h.verdict(), 'asking', 'the cure stays in flight rather than acting on a shape it cannot read');
  assert.ok(h.log(/token map does not fit/).length === 1);
  h.adv((QUERY_REPLY_MS + 300) * (CURE_ASKS + 1));
  assert.equal(h.verdict(), 'no_answer', 'and it ends up at no_answer, not at a guess');
  assert.deepEqual(h.since(n).filter(f => f !== QUERY && f !== PROBE_LIFE), [], 'having written nothing');
});

test('F264: the cure runs once per life, and a new life inside the cooldown still waits', () => {
  const h = harness();
  h.stall();
  h.adv((QUERY_REPLY_MS + 300) * (CURE_ASKS + 1));
  const afterFirst = h.cures();
  assert.equal(afterFirst, CURE_ASKS, 'setup: one cure, which probed twice');
  // Same life: however often the gun speaks and the stall rebuilds, it never cures twice.
  for (let i = 0; i < 3; i++) { h.adv(CURE_COOLDOWN_MS); h.f('$ALCD,29,100,0,192,0,*'); h.stall(); }
  assert.equal(h.cures(), afterFirst, 'one cure per life, full stop, cooldown or no cooldown');
});

test('F264: a new life reopens the cure, but the cooldown still holds the floor across lives', () => {
  // Without this floor a gun that dies and respawns into the same fault cures on every life in a row.
  const h = harness();
  h.stall();
  h.adv((QUERY_REPLY_MS + 300) * (CURE_ASKS + 1));
  const afterFirst = h.cures(), curedAt = h.eng._cureAt;
  h.f('$HIR,4,0,19,2,9,0,3,*').f('$HP,0,0,0,*');
  h.adv(9000);                                  // dead, then the ordinary respawn: a fresh life
  assert.equal(h.eng.alive, true, 'setup: a new life');
  h.f('$ALCD,29,100,0,192,0,*');
  h.stall();
  assert.ok(h.eng.now() - curedAt < CURE_COOLDOWN_MS, `setup: and still inside the cooldown (${h.eng.now() - curedAt} ms in)`);
  assert.equal(h.cures(), afterFirst, 'the cooldown holds across the life boundary');
  h.adv(CURE_COOLDOWN_MS);
  h.f('$ALCD,29,100,0,192,0,*');
  h.stall();
  assert.ok(h.cures() > afterFirst, 'and past the cooldown, in a new life, it may try again');
});

test('F264: a verdict retires the moment the gun reports on its own -- the board must not cry wolf', () => {
  const h = harness();
  h.stall();
  h.adv((QUERY_REPLY_MS + 300) * (CURE_ASKS + 1));
  assert.equal(h.status().cure, 'no_answer', 'setup: the board is asking for a human');
  h.adv(30000);
  assert.equal(h.status().cure, 'no_answer', 'and it HOLDS while the gun says nothing: $VOLTS alone is not proof');
  h.f(VOLTS);
  assert.equal(h.status().cure, 'no_answer', 'a battery sample is not the gun working');
  h.f('$ALCD,28,100,0,192,0,*');                 // the gun fires, unasked
  assert.equal(h.status().cure, undefined, 'an unsolicited pool frame retires it');
  assert.ok(h.log(/cleared — the gun is reporting again/).length === 1);
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
    h.eng._cure = null; h.eng._cureLife = null; h.eng._cureAt = 0; h.eng.cure = null;   // ...and the cure has not run yet
    const n = h.writes.length;
    h.advHold((QUERY_REPLY_MS + 300) * (CURE_ASKS + 1), apply);
    const w = h.since(n);
    assert.equal(h.eng._cureLife, null, `${name} must never start a cure`);
    assert.equal(h.eng._cure, null, `${name} must leave no probe in flight`);
    assert.equal(h.eng.cure, null, `${name} must leave no verdict on the board`);
    assert.deepEqual(w.filter(f => f.startsWith('$SPAWN')), [], `${name} must never reach a revive: ${JSON.stringify(w)}`);
    assert.deepEqual(w.filter(f => f.startsWith('$AMMO,') || f.startsWith('$BMAP,')), [], `${name} must never re-assert the arming: ${JSON.stringify(w)}`);
  });
}

test('F264: a probe in flight when the link drops is abandoned, not timed out into a verdict', () => {
  const h = harness();
  h.stall();
  assert.ok(h.eng._cure, 'setup: a probe is outstanding');
  h.eng.onBleDropped();
  // Assert the mechanism, not the outcome: the relink opens a reconcile, which stands the cure down anyway, so an
  // end-to-end "nothing was written" would pass with this line gone.
  assert.equal(h.eng._cure, null, 'no link, no answer: the probe cannot resolve and must not time out into a verdict');
});

// ---------------------------------------------------------------- reading is not inferring

test('F264: the node READS on a relink instead of inferring, inside the window §3.10 forbids WRITES in', () => {
  const h = harness();
  const n = h.writes.length;
  h.eng.onBleDropped();
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  const w = h.since(n);
  assert.ok(w.includes(PROBE_LIFE) && w.includes(QUERY), `the reconcile probes: ${JSON.stringify(w)}`);
  assert.ok(h.eng.reconciling, 'and it is inside the reconcile window, deliberately');
  // ...and the gun may answer that it died while we were away (the S7 gap-death limitation inference cannot see).
  queryReply(h, 0, 0, 0, 0);
  const deaths = h.facts.filter(f => f.type === 'death');
  assert.equal(deaths.length, 1, 'which books the death §3.10 already says to trust verbatim here');
  assert.equal(deaths[0].desync, true);
});

test('F264: the once-a-life spawn read-back proves the gun took the burst', () => {
  const h = harness();
  h.stall();
  queryReply(h, 0, 0, 0, 0);                    // dead -> the respawn writes the 17-frame burst
  h.adv(9000);
  assert.ok(h.since(0).some(f => f.startsWith('$SPAWN')), 'setup: the burst went out');
  // `$QUERY` alone, not the pair: the burst sets pools and magazine, and that is exactly what `$LCD` carries
  // back. The read-back is timed off the SPAWN, so it lands well inside the 20 s heartbeat cadence -- which is
  // how this test tells it from a poll.
  const tSpawn = h.eng._spawnAt;
  h.adv(3000);
  const readBacks = h.askedAt.filter(t => t - tSpawn >= 2500 && t - tSpawn < 2500 + 300);
  assert.equal(readBacks.length, 1, `exactly one ask lands on the spawn's own clock: ${h.askedAt.map(t => t - tSpawn).join(', ')}`);
  h.adv(20000);
  const later = h.askedAt.filter(t => t - tSpawn >= 2500 && t - tSpawn < 2500 + 300);
  assert.equal(later.length, 1, 'once per life, not a second time');
});

// ---------------------------------------------------------------- the poll

test('F264: the divergence poll runs only in a live match, at QUERY_POLL_MS, one frame at a time', () => {
  const h = harness();
  const n = h.queries();
  h.adv(QUERY_POLL_MS * 3 + 500);
  assert.equal(h.queries() - n, 3, `3 asks in 3 cadences, no more: ${h.queries() - n}`);
  const gaps = h.gaps().slice(n - 1);   // from the marker on: the harness's own setup asks are not the cadence
  for (const g of gaps) assert.ok(g >= QUERY_POLL_MS && g < QUERY_POLL_MS + 250, `every gap is one cadence, not a burst: ${gaps.join(', ')}`);
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
  queryReply(h, 45, 70, 25, 90);
  assert.equal(h.eng._noFirePulls, 2, 'the solicited $LCD leaves the unanswered pulls standing');
  assert.equal(h.eng.state().poolStale, null, 'CONTROL: two is still not a claim');
  // CONTROL: an UNSOLICITED pool frame is the gun answering the trigger, and still clears it.
  h.f('$ALCD,24,100,0,192,0,*');
  assert.equal(h.eng._noFirePulls, 0);
});

test('F264: an $ALCD is never solicited, so a shot inside a poll window still clears its own pull', () => {
  // Widen `_solicited` to `$ALCD` and a shot landing in a poll's 1.5 s window reads as OUR reply. Its pull is
  // never cleared, and three such coincidences manufacture the very fault the poll exists to resolve.
  const h = harness();
  h.pull(); h.pull();
  h.awaitAsk();
  h.f('$ALCD,28,100,0,192,0,*');                 // a real shot, inside the window
  assert.equal(h.eng._noFirePulls, 0, 'the gun answered the trigger, whatever else we happened to be asking');
});

test('F264: a poll that finds the gun dead books the death without anyone pulling a trigger', () => {
  const h = harness();
  h.awaitAsk();
  assert.equal(h.eng._cure, null, 'setup: this is the poll, not a cure');
  queryReply(h, 0, 0, 0, 0);
  const deaths = h.facts.filter(f => f.type === 'death');
  assert.equal(deaths.length, 1, 'the divergence is caught with no dead trigger pulled');
  assert.equal(deaths[0].desync, true);
  assert.equal(h.eng.alive, false);
});

test('F264: the write budget is 3 frames a minute for the heartbeat, and the cure costs 4 more', () => {
  const h = harness();
  const n = h.writes.length;
  h.adv(60000);
  const w = h.since(n);
  assert.deepEqual(w.filter(f => f === QUERY), [QUERY, QUERY, QUERY], `${w.length} frames in a quiet minute`);
  assert.deepEqual(w.filter(f => f === PROBE_LIFE), [], 'the heartbeat sends $QUERY alone: $LIFE buys it nothing');
  assert.equal(QUERY.length, 8); assert.equal(PROBE_LIFE.length, 13);   // the gun reads one serial byte per main-loop pass
  const h2 = harness();
  const m = h2.writes.length;
  h2.stall();
  h2.adv((QUERY_REPLY_MS + 300) * (CURE_ASKS + 1));
  const probes = h2.since(m).filter(f => f === QUERY || f === PROBE_LIFE);
  assert.equal(probes.length, CURE_ASKS * 2, `a whole unanswered cure costs ${probes.length} frames, once per life`);
});
