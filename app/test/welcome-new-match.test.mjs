// T2 review r2 (2026-10-10): a welcome that names a NEW match. MC sends `match_id` and `start` in every welcome while a
// match is scheduled (state.py `_welcome`), and `hydrate` set `matchId` from it BEFORE `startAt` ran, so `startAt` saw no
// new match. A phone that missed match B's `start` push and learned B from a reconnect welcome skipped every new-match
// reset: still LIVE in A, `resumeSchedule` returned early and B got no `$PSET` and no `$SPAWN`, and the HUD carried A's
// shots, deaths and score. The welcome path must run exactly the push path's reset and T-0 writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const GUN = { name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' };
const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
  respawn: { type: 'auto', delay_s: 5 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
const frames = { ...golden, player_id: 'p1' };

/** Live in match A with shots, a death booked and a score from MC. */
function inMatchA() {
  let clock = 1_000_000;
  const writes = [];
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: () => {}, report: () => {}, now: () => clock, wallNow: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  const h = {
    eng, writes,
    get clock() { return clock; },
    adv(ms) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + 250); eng.tick(); } return h; },
    startB(runwayMs = 5000) { return { match_id: 'B', go_live_t: clock + runwayMs, config_id: golden.config_id, seq: 2, countdown_s: Math.round(runwayMs / 1000) }; },
    /** A plain WS reconnect while B is scheduled: the welcome carries the game, `match_id` and `start` (state.py `_welcome`). */
    welcome(start) { eng.hydrate({ player, team: teams[0], roster: [], config, frames, match_id: start.match_id, start }); return h; },
    push(start) { eng.onMcMessage({ kind: 'start', body: start }); return h; },
  };
  eng.onBleConnected(GUN);
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'A', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  h.adv(10); eng.feedFrame('$LCD,45,70,0,0,30,90,*');
  for (let m = 30; m > 25; m--) { h.adv(120); eng.feedFrame(`$ALCD,${m},100,0,90,0,*`); }
  eng.onMcMessage({ kind: 'score', body: { player_id: 'p1', kills: 3, deaths: 1 } });
  h.adv(1000);
  assert.equal(eng.phase, 'live'); assert.equal(eng.matchId, 'A'); assert.ok(eng.shots > 0, 'setup: A has shots');
  return h;
}
const spawnWrites = w => w.filter(f => /^\$(PSET|SPAWN),/.test(f));

test('welcome into B: the T-0 writes are the push path\'s ($PSET and $SPAWN)', () => {
  const push = inMatchA(), welcome = inMatchA();
  const n = [push.writes.length, welcome.writes.length];
  push.push(push.startB()).adv(6000);
  welcome.welcome(welcome.startB()).adv(6000);
  const p = spawnWrites(push.writes.slice(n[0])), w = spawnWrites(welcome.writes.slice(n[1]));
  assert.ok(p.some(f => f.startsWith('$SPAWN')) && p.some(f => f.startsWith('$PSET')), `setup: the push path spawns B: ${JSON.stringify(p)}`);
  assert.deepEqual(w, p, 'the welcome path writes what the push path writes');
  assert.equal(welcome.eng.phase, 'live'); assert.equal(welcome.eng.matchId, 'B');
});

test('welcome into B: A\'s shots, deaths and score do not carry into B', () => {
  const h = inMatchA();
  h.eng.feedFrame('$HIR,4,0,19,2,45,0,3,*'); h.eng.feedFrame('$LCD,0,0,0,0,25,90,*');   // a death in A
  assert.equal(h.eng.deaths, 1, 'setup: a death booked in A');
  h.welcome(h.startB());
  assert.equal(h.eng.shots, 0, 'B starts with no shots');
  assert.equal(h.eng.deaths, 0, 'nor deaths');
  assert.equal(h.eng.score, null, 'nor A\'s score');
});

test('welcome into B while DOWN in A: the push path\'s T-0 writes, and A\'s death is not B\'s', () => {
  const push = inMatchA(), welcome = inMatchA();
  for (const h of [push, welcome]) { h.eng.feedFrame('$HIR,4,0,19,2,45,0,3,*'); h.eng.feedFrame('$LCD,0,0,0,0,25,90,*'); assert.equal(h.eng.alive, false, 'setup: down in A'); }
  const n = [push.writes.length, welcome.writes.length];
  push.push(push.startB()); welcome.welcome(welcome.startB());
  assert.equal(welcome.eng.deaths, 0, 'B starts with no deaths');
  assert.equal(welcome.eng.killedBy, null, 'and no killer from A');
  push.adv(6000); welcome.adv(6000);
  const p = spawnWrites(push.writes.slice(n[0])), w = spawnWrites(welcome.writes.slice(n[1]));
  assert.ok(p.some(f => f.startsWith('$SPAWN')), 'setup: the push path spawns B');
  assert.deepEqual(w, p, 'the welcome path writes what the push path writes');
  assert.equal(welcome.eng.alive, true);
});

// A regression guard, not a bug: in RECAP MC has cleared `start_info`, so the welcome carries no `match_id` and no `start`,
// only B's result. Nothing in it may arm or spawn the gun.
test('a welcome in B\'s recap never arms or spawns the gun', () => {
  const h = inMatchA();
  const n = h.writes.length;
  h.eng.hydrate({ player, team: teams[0], roster: [], config, frames, result: { match_id: 'B', outcome: 'win' } });
  h.adv(6000);
  assert.deepEqual(spawnWrites(h.writes.slice(n)), [], 'no spawn for an ended match');
  assert.notEqual(h.eng.phase, 'armed');
});

// A regression guard: a plain reconnect mid-match re-delivers the SAME match, which must stay a no-op.
test('a welcome for the SAME match re-runs no reset and re-sends no $PSET or $SPAWN', () => {
  const h = inMatchA();
  const shots = h.eng.shots, n = h.writes.length;
  h.welcome({ match_id: 'A', go_live_t: h.clock - 3000, config_id: golden.config_id, seq: 1, countdown_s: 0 }).adv(3000);
  assert.deepEqual(spawnWrites(h.writes.slice(n)), [], 'no second spawn');
  assert.equal(h.eng.shots, shots, 'the counters stay');
  assert.ok(h.eng.score, 'the score stays');
  assert.equal(h.eng.phase, 'live');
});

// Review r1 #1: the restart path. A phone restores match A's LIVE phase, then B's welcome arrives BEFORE the gun relinks.
// The restored phase belongs to A, so the relink must follow B to its T-0 spawn, not resume A.
test('restart in A, B\'s welcome before the gun relinks: the relink follows B to its T-0 spawn', () => {
  const h = inMatchA();
  h.adv(250);
  const store = h.eng.storage; let clock = h.clock; const writes = [];
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: () => {}, report: () => {}, now: () => clock, wallNow: () => clock,
    synced: () => true, storage: store, log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  assert.equal(eng._pendingPhase, 'live', 'setup: A\'s live phase is restored, waiting for the gun');
  eng.hydrate({ player, team: teams[0], roster: [], config, frames, match_id: 'B', start: { match_id: 'B', go_live_t: clock + 5000, config_id: golden.config_id, seq: 2, countdown_s: 5 } });
  eng.onBleConnected(GUN);
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');   // the head's echo
  for (let t = 0; t < 6000; t += 250) { clock += 250; eng.tick(); }
  assert.ok(writes.includes('$SPAWN,,*'), 'B spawns at T-0');
  assert.equal(eng.phase, 'live'); assert.equal(eng.matchId, 'B');
  assert.equal(eng.shots, 0, 'with none of A\'s shots');
});

// Review r1 #2: MC carries B's current score in a live welcome. B's new-match reset must not wipe it.
test('a welcome into B keeps the score it carries', () => {
  const h = inMatchA();
  h.eng.hydrate({ player, team: teams[0], roster: [], config, frames, match_id: 'B', score: { player_id: 'p1', kills: 2, deaths: 0 },
    start: h.startB() });
  assert.equal(h.eng.score && h.eng.score.kills, 2, 'B\'s score from the welcome');
});

// Review r1 #3: a connected phone (no restored phase) whose welcome makes it KITTED, for a player MC marked ready.
test('a welcome that moves a connected phone to KITTED applies MC\'s READY', () => {
  let clock = 1_000_000;
  const eng = new Engine({ writer: () => {}, emit: () => {}, report: () => {}, now: () => clock, wallNow: () => clock, synced: () => true,
    storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected(GUN);
  assert.equal(eng.phase, 'connected', 'setup: linked, no player yet');
  eng.hydrate({ player: { ...player, ready: true }, team: teams[0], roster: [] });
  assert.equal(eng.phase, 'kitted');
  assert.equal(eng.ready, true, 'MC counts READY, and so does the HUD');
});

// Review r2 #1: a welcome for B that carries B's NEW config (another config_id, another team and weapon in the head). The
// phone missed both B's `config` and `start` pushes while live in A. Before, the welcome wrote no head, so B spawned on
// A's head (A's weapons, A's `$TID`). The welcome path must write what the push path writes: B's head, then B's spawn.
const headB = golden.head.map(f => (f === '$TID,1,*' ? '$TID,2,*' : f.startsWith('$WEAP,0,') ? f.replace(',9,0,', ',12,0,') : f));
const configB = { ...config, config_id: 'golden-b' }, framesB = { ...frames, config_id: 'golden-b', head: headB };
test('welcome into B with B\'s new config: the head and the T-0 writes are the push path\'s', () => {
  assert.notDeepEqual(headB, golden.head, 'setup: B\'s head differs from A\'s');
  const push = inMatchA(), welcome = inMatchA();
  const n = [push.writes.length, welcome.writes.length];
  const startB = h => ({ ...h.startB(), config_id: 'golden-b' });
  push.eng.onMcMessage({ kind: 'config', body: { config: configB, frames: framesB, roster: [] } });
  push.push(startB(push)).adv(6000);
  welcome.eng.hydrate({ player, team: teams[0], roster: [], config: configB, frames: framesB, match_id: 'B', start: startB(welcome) });
  welcome.adv(6000);
  const p = push.writes.slice(n[0]), w = welcome.writes.slice(n[1]);
  assert.ok(p.includes('$TID,2,*') && p.includes('$SPAWN,,*'), 'setup: the push path writes B\'s head and spawns');
  assert.deepEqual(w, p, 'the welcome path writes exactly what the push path writes');
});

// Review r2 #2 and r3: a benched welcome while live in A. MC never benches a player mid-match, so A is over on MC; the push
// path ended A with its end control before the bench `assign` landed. MC's real welcome for a PARKED player (state.py
// `_hydrate`, `_assign_body`) carries the player's context and `standby: true`, and no config, frames, `match_id` or `start`.
const parkedWelcome = () => ({ player, team: teams[0], roster: [], catalog: null, policy: { kit_open: true }, game: null, standby: true });
const view = e => ({ phase: e.phase, spawned: e.spawned, alive: e.alive, ended: e.ended, matchId: e.matchId, standby: e.standby, ready: !!e.ready });
for (const [label, extra, b] of [['MC\'s parked welcome', () => ({}), false], ['a welcome that also carries B\'s start', h => ({ config, frames, match_id: 'B', start: h.startB() }), true]]) {
  test(`benched while live in A (${label}): ends A as the push path does, and arms nothing`, () => {
    const push = inMatchA(), welcome = inMatchA();
    const n = [push.writes.length, welcome.writes.length];
    push.eng.onMcMessage({ kind: 'control', body: { cmd: 'end', match_id: 'A' } });
    push.eng.onMcMessage({ kind: 'assign', body: { ...parkedWelcome() } });
    if (b) push.push(push.startB());
    push.adv(6000);
    welcome.eng.hydrate({ ...parkedWelcome(), ...extra(welcome) });
    welcome.adv(6000);
    assert.equal(push.eng.phase, 'kitted', 'setup: the push path stands the phone down');
    assert.deepEqual(view(welcome.eng), view(push.eng), 'the same state as the push path');
    assert.deepEqual(welcome.writes.slice(n[1]), push.writes.slice(n[0]), 'and the same gun writes');
  });
}

// Review r3 guard: a standby welcome while NOT armed or live (here KITTED in the lobby) changes nothing beyond today.
test('a parked welcome in the lobby ends nothing and writes nothing', () => {
  let clock = 1_000_000; const writes = [];
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: () => {}, report: () => {}, now: () => clock, wallNow: () => clock, synced: () => true,
    storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected(GUN);
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  assert.equal(eng.phase, 'kitted', 'setup: kitted');
  const n = writes.length;
  eng.hydrate(parkedWelcome());
  assert.equal(eng.phase, 'kitted'); assert.equal(eng.ended, false, 'no match ended'); assert.equal(eng.standby, true);
  assert.deepEqual(writes.slice(n), [], 'no gun writes');
});

// Review r3, the restart variant: A's LIVE phase restored and waiting for the gun when the parked welcome arrives. The relink
// must not resume A on a benched phone: A ends, and the gun gets A's end frames on the relink.
test('benched after a restart in A: the relink does not resume A', () => {
  const h = inMatchA();
  h.adv(250);
  let clock = h.clock; const writes = [];
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: () => {}, report: () => {}, now: () => clock, wallNow: () => clock,
    synced: () => true, storage: h.eng.storage, log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  assert.equal(eng._pendingPhase, 'live', 'setup: A\'s live phase restored');
  eng.hydrate(parkedWelcome());
  eng.onBleConnected(GUN);
  for (let t = 0; t < 3000; t += 250) { clock += 250; eng.tick(); }
  assert.equal(eng.phase, 'kitted', 'benched, not live');
  assert.equal(eng.spawned, false); assert.equal(eng.ended, true, 'A ended');
  const end = h.writes.length && frames.end;
  assert.ok(end.every(f => writes.includes(f)), 'the gun got A\'s end frames');
});
