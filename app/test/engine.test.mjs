// Engine tests — node --test (no framework). Covers node.md §3 (A6): arm from a FrameBundle,
// echo→ack_config, start→spawn, hit/death attribution, DEATH_LATCH, respawn, shots counter,
// feedback freshness, timed end→KITTED, the §3.10 resync table, resumeSchedule across T-0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
function harness({ mode = 'tdm', respawn = 'auto', timeLimit = 600, synced = true } = {}) {
  const writes = []; const facts = []; const reports = []; const delays = [];
  let clock = 1_000_000;
  const config = { config_id: golden.config_id, mode, environment: 'outdoor', night: false, time_limit_s: timeLimit,
    respawn: { type: respawn, delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' }];
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: f => facts.push(f), report: (k, b) => reports.push({ k, b }),
    now: () => clock, synced: () => synced, storage: mkStorage(), log: () => {}, delay: (ms, fn) => { delays.push(ms); fn(); } });
  const bundle = { ...golden, player_id: 'p1' };
  const api = {
    eng, writes, facts, reports, delays, bundle, config, player, team, roster,
    adv: t => { clock += t; return clock; }, at: t => { clock = t; },
    kit() { eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); eng.onMcMessage({ kind: 'assign', body: { player, team, roster } }); return api; },
    config_() { eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } }); return api; },
    echo() { eng.feedFrame('$LCD,0,0,0,0,0,0,*'); return api; },
    start(runwayMs = 0) { eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock + runwayMs, config_id: golden.config_id, seq: 1, countdown_s: Math.round(runwayMs / 1000) } }); return api; },
    frame(f) { eng.feedFrame(f); return api; },
  };
  return api;
}

test('arm: config writes head (no $SPAWN), echo → ack_config ok', () => {
  const h = harness().kit().config_();
  assert.equal(h.eng.phase, 'lobby');
  assert.ok(h.writes.includes('$START,*'), 'head has $START');
  assert.ok(h.writes.some(f => f.startsWith('$PSET,7,')), 'head has $PSET with player_num 7');
  assert.ok(!h.writes.includes('$SPAWN,,*'), 'head has NO $SPAWN');
  h.adv(1600); h.echo(); h.eng.tick();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.ok(ack && ack.b.ok === true && ack.b.gun_echo, 'ack_config ok with gun_echo');
});

test('no echo → ack_config no_echo', () => {
  const h = harness().kit().config_();
  h.adv(1600); h.eng.tick();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.ok(ack && ack.b.ok === false && ack.b.err === 'no_echo');
});

test('start → armed, spawn at T-0 → live', () => {
  const h = harness().kit().config_().echo().start(9000);
  assert.equal(h.eng.phase, 'armed');
  h.adv(9000); h.eng.tick();
  assert.equal(h.eng.phase, 'live');
  assert.ok(h.writes.includes('$SPAWN,,*'), 'spawn frames written at T-0');
  assert.ok(h.writes.includes('$SFLASH,*'), 'green-sight flash at spawn');
  assert.equal(h.eng.alive, true);
});

test('hit_taken + death credit the fresh $HIR shooter', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();  // live, alive
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,45,61,0,*');
  const hit = h.facts.find(f => f.type === 'hit_taken');
  assert.equal(hit.shooter_num, 19); assert.equal(hit.shooter_team, 2); assert.equal(hit.dmg, 9);
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  const death = h.facts.find(f => f.type === 'death');
  assert.equal(death.shooter_num, 19); assert.equal(h.eng.alive, false); assert.equal(h.eng.deaths, 1);
});

test('death with a stale latch → shooter_num 0 (DEATH_LATCH_MS)', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.adv(3000);  // latch older than 2 s
  h.frame('$HP,0,0,0,*');
  const death = h.facts.find(f => f.type === 'death');
  assert.equal(death.shooter_num, 0);
});

test('auto respawn writes revive and emits respawn', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  h.adv(8000); h.eng.tick();
  assert.equal(h.eng.alive, true);
  assert.ok(h.facts.some(f => f.type === 'respawn'));
});

test('shots counter: $ALCD decrements count, increases (reload) ignored', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*'); h.frame('$ALCD,31,100,0,384,0,*'); h.frame('$ALCD,30,100,0,384,0,*');
  assert.equal(h.eng.shots, 2);
  h.frame('$ALCD,32,100,0,382,0,*');  // reload — ignored
  assert.equal(h.eng.shots, 2);
  h.frame('$ALCD,31,100,0,382,0,*');
  assert.equal(h.eng.shots, 3);
});

test('feedback freshness: fresh flashes, stale ignored', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: h.eng.now(), cue: golden.cues.kill } });
  assert.ok(h.writes.includes('$SFLASH,*') && h.writes.includes(golden.cues.kill), 'fresh feedback writes flash + cue');
  assert.ok(h.writes.indexOf('$SFLASH,*') < h.writes.indexOf(golden.cues.kill) && h.delays.includes(120), 'flash first, cue after a 120 ms gap');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: h.eng.now() - 5000, cue: golden.cues.kill } });
  assert.equal(h.writes.length, 0, 'stale feedback ignored');
});

test('timed end → writes end + game_over → KITTED', () => {
  const h = harness({ timeLimit: 60 }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.adv(60_000); h.eng.tick();
  assert.equal(h.eng.phase, 'kitted');
  assert.ok(h.writes.includes('$STOP,*'), 'end sequence written');
  assert.ok(h.writes.includes(golden.cues.game_over), 'game_over cue played');
});

test('control end/recall/panic land in KITTED', () => {
  for (const cmd of ['end', 'recall', 'panic']) {
    const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
    h.eng.onMcMessage({ kind: 'control', body: { cmd } });
    assert.equal(h.eng.phase, 'kitted', cmd);
  }
});

test('§3.10 resync: trigger with a shot → alive (no write)', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*');
  h.eng.onBleDropped(); h.eng.onBleConnected();
  assert.ok(h.eng.resync, 'resync started');
  const before = h.writes.length;
  h.frame('$BUT,0,1,*'); h.frame('$ALCD,31,100,0,384,0,*');  // a shot went out
  assert.equal(h.eng.resync, null, 'classified alive');
  assert.equal(h.writes.length, before, 'nothing written');
});

test('§3.10 resync: dead gun (reload refills, trigger no-fire) → desync death', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,10,100,0,384,0,*');            // reserve known > 0, mag not empty
  h.eng.onBleDropped(); h.eng.onBleConnected();
  h.frame('$BUT,0,1,*');                        // step 1 trigger, no $ALCD
  assert.equal(h.eng.resync.step, 2);
  h.frame('$BUT,2,1,*'); h.frame('$ALCD,32,100,0,362,0,*');  // reload refills → configured, mag was low
  assert.equal(h.eng.resync.step, 3);
  h.frame('$BUT,0,1,*'); h.adv(1600); h.eng.tick();          // trigger after reload, no $ALCD → dead
  assert.equal(h.eng.resync, null);
  assert.equal(h.eng.alive, false);
  assert.ok(h.facts.some(f => f.type === 'death' && f.desync === true));
});

test('§3.10 resync in LMS never writes head/spawn', () => {
  const h = harness({ respawn: 'none' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,10,100,0,80,0,*');
  h.eng.onBleDropped(); h.eng.onBleConnected();
  const before = h.writes.length;
  h.frame('$BUT,0,1,*'); h.frame('$BUT,2,1,*'); h.adv(1600); h.eng.tick();  // reload silent, reserve>0 → not-live
  assert.ok(!h.writes.slice(before).includes('$SPAWN,,*'), 'LMS never spawns');
  assert.ok(!h.writes.slice(before).includes('$START,*'), 'LMS never re-writes head');
});

test('resumeSchedule across T-0: within grace spawns; long-past hot-joins', () => {
  const h = harness().kit().config_().echo().start(30000);
  h.adv(30000 + 5000);              // 5 s past T-0, within LATE_ARM_GRACE (8 s)
  const r = h.eng.resumeSchedule();
  assert.equal(h.eng.phase, 'live'); assert.equal(r.reason, 'grace');

  const h2 = harness().kit().config_().echo().start(30000);
  h2.adv(30000 + 60000);            // 60 s past → hot-join
  const r2 = h2.eng.resumeSchedule();
  assert.equal(h2.eng.phase, 'live'); assert.equal(r2.reason, 'hot_join');
});

test('infection: death writes team_flip and emits team_change', () => {
  const b = { ...golden, player_id: 'p1', team_flip: { '2': ['$TID,2,*'] } };
  const writes = []; const facts = []; let clock = 1e6;
  const eng = new Engine({ writer: f => writes.push(...f), emit: f => facts.push(f), report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {} });
  const config = { config_id: 'g', mode: 'infection', environment: 'indoor', night: false, time_limit_s: 300, respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: null, win_by: 'survival' }, health: { max_hp: 45, max_armor: 70 }, teams: [{ team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, { team_id: 'inf', tid: 2, name: 'INFECTED', color: 'red' }] };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'X', team_id: 'human', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' }, team: { team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: b, roster: [] } }); eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm', go_live_t: clock, config_id: 'g', seq: 1, countdown_s: 0 } });
  clock += 10; eng.tick();
  eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*');
  assert.ok(writes.includes('$TID,2,*'), 'team_flip written');
  assert.ok(facts.some(f => f.type === 'team_change' && f.tid === 2));
});

// ---------------- polish iteration 1 regressions ----------------
test('shots counter is per weapon slot: a weapon swap is not a shot', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*');
  h.frame('$ALCD,6,100,1,24,0,*');     // swap to the shotgun (slot 1) — NOT 26 shots
  assert.equal(h.eng.shots, 0);
  assert.equal(h.eng.ammo, 6); assert.equal(h.eng.mag, 6);
  h.frame('$ALCD,5,100,1,24,0,*');     // one shotgun round
  assert.equal(h.eng.shots, 1);
  h.frame('$ALCD,32,100,0,384,0,*');   // back to the rifle — not a reload, not a shot
  assert.equal(h.eng.shots, 1);
  h.frame('$ALCD,31,100,0,384,0,*');
  assert.equal(h.eng.shots, 2);
});

test('resumeSchedule without a gun linked never leaves IDLE (launch restore)', () => {
  const h = harness().kit().config_().echo().start(30000);
  // simulate a relaunch: fresh engine on the same storage, gun not linked yet
  const store = h.eng.storage;
  let clock = h.eng.now() + 40000;
  const eng2 = new Engine({ writer: () => {}, now: () => clock, synced: () => true, storage: store, log: () => {} });
  assert.equal(eng2.phase, 'idle');
  eng2.resume();
  assert.equal(eng2.phase, 'idle', 'phase untouched without a gun');
  assert.equal(eng2.resumeSchedule().reason, 'gun_not_linked');
  assert.equal(eng2.state().rejoin, true, 'HUD shows the rejoin hint');
  eng2.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.notEqual(eng2.phase, 'idle', 'phase re-derived once the gun links');
});

test('a start for an already-ended match is a no-op (no re-arm on re-hydration)', () => {
  const h = harness({ timeLimit: 60 }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.adv(60_000); h.eng.tick();
  assert.equal(h.eng.phase, 'kitted');
  const before = h.writes.length;
  const r = h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: h.eng.now() - 70_000, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  assert.equal(r.reason, 'match_ended'); assert.equal(h.eng.phase, 'kitted'); assert.equal(h.writes.length, before);
  h.eng.hydrate({ start: { match_id: 'm1', go_live_t: h.eng.now() - 70_000, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  assert.equal(h.eng.phase, 'kitted', 'hydrate with the ended match is ignored too');
});

test('config that arrives while the gun is unlinked is written on relink and acked', () => {
  const h = harness().kit();
  h.eng.onBleDropped();
  h.config_();
  assert.equal(h.eng.configPending, true);
  assert.ok(!h.writes.includes('$START,*'), 'nothing written while unlinked');
  h.eng.onBleConnected();
  assert.ok(h.writes.includes('$START,*'), 'head written on relink');
  assert.equal(h.eng.phase, 'lobby');
  h.adv(1600); h.echo(); h.eng.tick();
  assert.ok(h.reports.some(r => r.k === 'ack_config' && r.b.ok), 'ack_config after the relink write');
});

test('timed end with the gun unlinked: teardown is owed and written on relink', () => {
  const h = harness({ timeLimit: 60 }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.onBleDropped();
  const n0 = h.writes.length;
  h.adv(60_000); h.eng.tick();
  assert.equal(h.eng.phase, 'kitted'); assert.equal(h.eng.pendingTeardown, 'end');
  assert.ok(!h.writes.slice(n0).includes(golden.cues.game_over), 'end not written while unlinked');
  const n1 = h.writes.length;
  h.eng.onBleConnected();
  assert.ok(h.writes.slice(n1).includes('$STOP,*') && h.writes.slice(n1).includes(golden.cues.game_over), 'end + game_over written on relink');
  assert.equal(h.eng.pendingTeardown, null);
});

test('$HP,0 learned during resync is a desync death', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.onBleDropped(); h.eng.onBleConnected();
  assert.ok(h.eng.resync);
  h.frame('$HP,0,0,0,*');
  const d = h.facts.find(f => f.type === 'death');
  assert.ok(d && d.desync === true);
});

test('infection flip resolves the new team from config.teams by tid', () => {
  const b = { ...golden, player_id: 'p1', team_flip: { '2': ['$TID,2,*'] } };
  let clock = 1e6;
  const eng = new Engine({ writer: () => {}, emit: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {} });
  const config = { config_id: 'g', mode: 'infection', environment: 'indoor', night: false, time_limit_s: 300, respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: null, win_by: 'survival' }, health: { max_hp: 45, max_armor: 70 }, teams: [{ team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, { team_id: 'inf', tid: 2, name: 'INFECTED', color: 'red' }] };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'X', team_id: 'human', loadout: { weapons: [] }, voice: 'male' }, team: config.teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: b, roster: [] } }); eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm', go_live_t: clock, config_id: 'g', seq: 1, countdown_s: 0 } });
  clock += 10; eng.tick();
  eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*');
  assert.equal(eng.team.team_id, 'inf'); assert.equal(eng.team.name, 'INFECTED'); assert.equal(eng.team.tid, 2);
});

test('ARMED + BLE reconnect re-writes the head and still spawns at T-0', () => {
  const h = harness().kit().config_().echo().start(9000);
  h.eng.onBleDropped(); h.adv(2000); h.eng.onBleConnected();
  assert.equal(h.eng.resync, null, 'no evidence protocol in ARMED');
  assert.ok(h.writes.filter(f => f === '$START,*').length >= 2, 'head re-written');
  h.adv(7000); h.eng.tick();
  assert.equal(h.eng.phase, 'live');
});

// ---------- polish iteration 2 regressions ----------
function goLive(h) { h.kit().config_().echo().start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*'); return h; }

test('resync head re-write: the $LCD,0,… echo adds 0 shots', () => {
  const h = goLive(harness());
  h.frame('$ALCD,34,100,0,216,0,*');
  assert.equal(h.eng.shots, 2);
  h.eng.onBleDropped(); h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.ok(h.eng.resync, 'resync protocol started');
  h.frame('$BUT,0,1,*'); h.frame('$BUT,0,0,*');           // trigger, no $ALCD → step 2
  h.frame('$BUT,2,1,*'); h.adv(1600); h.eng.tick();        // reload silent, reserve > 0 → not a live gun → head re-write
  const headWrites = h.writes.filter(f => f === '$CLEAR,*').length;
  assert.ok(headWrites >= 2, 'head re-written on resync');
  h.frame('$LCD,0,0,0,0,0,0,*');                            // the head echo
  assert.equal(h.eng.shots, 2, 'echo counted as a reset, not a magazine dump');
  h.adv(9000); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  assert.equal(h.eng.shots, 2, 'revive refill is an increase, not shots');
  h.frame('$ALCD,35,100,0,216,0,*');
  assert.equal(h.eng.shots, 3, 'real shots still count');
});

test('restored ARMED past the match end: no spawn, ends cleanly', () => {
  const h = harness({ timeLimit: 60 }).kit().config_().echo().start(5000);
  assert.equal(h.eng.phase, 'armed');
  h.eng.onBleDropped();
  const before = h.writes.length;
  h.adv(5000 + 61_000);                                     // T-0 and the whole match passed while unlinked
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  const after = h.writes.slice(before);
  // frames.end also begins with $SPAWN,, (revive-then-stop), so look for the spawn TAIL ($AMMO / $BMAP,0,0) instead
  assert.ok(!after.some(f => f.startsWith('$AMMO,')), 'never spawns (loads magazines) for an expired match');
  assert.ok(after.includes('$STOP,*'), 'teardown written');
  assert.equal(h.eng.phase, 'kitted');
  assert.ok(h.eng.ended);
});

test('MC-first hydrate (welcome before the gun links) lands in LOBBY with the head written', () => {
  const h = harness();
  h.eng.hydrate({ player: h.player, team: h.team, roster: h.roster, config: h.config, frames: h.bundle });
  assert.ok(!h.writes.includes('$START,*'), 'nothing written while unlinked');
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(h.eng.phase, 'lobby');
  assert.ok(h.writes.includes('$START,*'), 'head written on link');
  h.adv(1600); h.echo(); h.eng.tick();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.ok(ack && ack.b.ok === true, 'acked');
});

test('local panic does not retire the running match_id', () => {
  const h = goLive(harness());
  h.eng.control({ cmd: 'panic' });
  assert.ok(!h.eng.endedMatches.includes('m1'));
  assert.equal(h.eng._resyncRevive, false);
});

test('weaponName follows the active slot', () => {
  const h = goLive(harness());
  h.player.loadout.weapons.push({ weapon_id: 'shotgun' });
  h.frame('$ALCD,6,100,1,24,0,*');
  assert.equal(h.eng.weaponName, 'SHOTGUN');
});

// ---------- polish iteration 3 ----------
test('MC-first late joiner: welcome carries a running start, gun links from LOBBY → ARMED (and LIVE after T-0)', () => {
  const h = harness();
  const T = h.eng.now() + 20_000;
  h.eng.hydrate({ player: h.player, team: h.team, roster: h.roster, config: h.config, frames: h.bundle,
    start: { match_id: 'm1', go_live_t: T, config_id: golden.config_id, seq: 1, countdown_s: 20 } });
  assert.equal(h.eng.phase, 'idle', 'no gun yet → stays idle');
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(h.eng.phase, 'armed', 'schedule reconciled from LOBBY, not stuck');
  h.adv(20_000 + 100); h.eng.tick();
  assert.equal(h.eng.phase, 'live', 'spawned at T-0');
  assert.ok(h.writes.some(f => f.startsWith('$AMMO,')), 'spawn tail written');
});

test('resync head with slot 1 active: echo + refill book 0 shots (activeSlot reset to 0)', () => {
  const h = goLive(harness());
  h.player.loadout.weapons.push({ weapon_id: 'shotgun' });
  h.frame('$ALCD,6,100,1,24,0,*'); h.frame('$ALCD,5,100,1,24,0,*');   // shotgun fired once
  assert.equal(h.eng.activeSlot, 1); assert.equal(h.eng.shots, 1);
  h.eng.onBleDropped(); h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  h.frame('$BUT,0,1,*'); h.frame('$BUT,0,0,*'); h.frame('$BUT,2,1,*'); h.adv(1600); h.eng.tick();   // → head re-write
  assert.equal(h.eng.activeSlot, 0, '$CLEAR puts the gun on slot 0');
  h.frame('$LCD,0,0,0,0,0,0,*');
  h.adv(9000); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  assert.equal(h.eng.shots, 1, 'no phantom shots from the head echo / refill');
  h.frame('$ALCD,6,100,1,24,0,*');
  assert.equal(h.eng.shots, 1, 'first slot-1 reading after the head is a baseline, not 30 shots');
});

test('local panic: the same schedule re-delivered by a welcome is refused; a newer seq re-arms', () => {
  const h = goLive(harness());
  h.eng.control({ cmd: 'panic' });
  assert.equal(h.eng.phase, 'kitted');
  const same = { match_id: 'm1', go_live_t: h.eng.now() + 5000, config_id: golden.config_id, seq: 1, countdown_s: 5 };
  h.eng.hydrate({ start: same });
  assert.notEqual(h.eng.phase, 'armed', 'not re-armed by the stale schedule');
  const r = h.eng.startAt(same); assert.equal(r.ok, false); assert.equal(r.reason, 'panicked');
  h.config_(); h.echo();                                     // MC re-pushes config after a panic → back to LOBBY
  const newer = { ...same, seq: 2 };
  assert.equal(h.eng.startAt(newer).ok, true, 'a newer schedule is accepted');
  assert.equal(h.eng.phase, 'armed');
});

test('KITTED + match over + BLE relink does not re-write the head or clear the match-over screen', () => {
  const h = goLive(harness({ timeLimit: 60 }));
  h.adv(61_000); h.eng.tick();
  assert.ok(h.eng.ended); assert.equal(h.eng.phase, 'kitted');
  const before = h.writes.length;
  h.eng.onBleDropped(); h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.ok(!h.writes.slice(before).includes('$START,*'), 'no head re-write over the match-over screen');
  assert.ok(h.eng.ended, 'still ended');
});

test('runway cues are edge-triggered: stale thresholds never fire, crossed ones fire once', () => {
  // 9 s runway: every runway threshold (30/20/10 s) is already below — NONE may fire (they stacked on the bench).
  const a = harness().kit().config_();
  a.adv(1600); a.echo(); a.eng.tick(); a.writes.length = 0;
  a.start(9000); a.eng.tick();
  a.adv(5000); a.eng.tick(); a.adv(3000); a.eng.tick();
  assert.equal(a.writes.filter(f => f.includes('VA85')).length, 0, 'no VA85 with a 9 s runway');
  assert.ok(!a.eng.cuesFired.has('runway_30') && !a.eng.cuesFired.has('runway_20') && !a.eng.cuesFired.has('runway_10'));
  // 35 s runway: each threshold fires exactly once as it is crossed from above.
  const b = harness().kit().config_();
  b.adv(1600); b.echo(); b.eng.tick();
  b.start(35000); b.eng.tick();
  assert.ok(!b.eng.cuesFired.has('runway_30'), 'nothing at T-35');
  b.adv(6000); b.eng.tick();   // T-29
  assert.ok(b.eng.cuesFired.has('runway_30') && !b.eng.cuesFired.has('runway_20'));
  b.adv(10000); b.eng.tick();  // T-19
  assert.ok(b.eng.cuesFired.has('runway_20') && !b.eng.cuesFired.has('runway_10'));
  b.adv(10000); b.eng.tick();  // T-9
  assert.ok(b.eng.cuesFired.has('runway_10'));
});


test('tutorial end push quiets the gun and clears the try-out state', () => {
  const h = harness().kit();
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG' }, frames: ['$CLEAR,*'] } });
  assert.equal(h.eng.tutorial, true); assert.equal(h.eng.tutorialWeapon.weapon_id, 'smg');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'tutorial', body: { end: true, frames: ['$STOP,*', '$CLEAR,*'] } });
  assert.equal(h.eng.tutorial, false); assert.equal(h.eng.tutorialWeapon, null);
  assert.ok(h.writes.includes('$STOP,*'), 'teardown written to the gun');
});


test('apply.preview plays sound-only frames at the bench; non-preview stays live-only (A9.1)', () => {
  const h = harness().kit();
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'apply', body: { frames: ['$PLAY,,4,6,VAA,,,,*'] } });
  assert.equal(h.writes.length, 0, 'non-preview apply must not write off-live');
  h.eng.onMcMessage({ kind: 'apply', body: { preview: true, frames: ['$PLAY,,4,6,VAA,,,,*'] } });
  assert.ok(h.writes.includes('$PLAY,,4,6,VAA,,,,*'), 'preview sound plays in kitted');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'apply', body: { preview: true, frames: ['$CLEAR,*'] } });
  assert.equal(h.writes.length, 0, 'a preview may never smuggle non-sound frames');
});


test('config-echo $ALCD cannot poison the mag denominator (real-gun reload/pips bug)', () => {
  const h = harness().kit().config_();
  h.frame('$ALCD,24,100,1,12,0,*');            // config-time echo: WEAP clip cap 24 on slot 1
  h.adv(1600); h.echo(); h.eng.tick();
  h.start(0); h.eng.tick();                     // spawn
  h.frame('$ALCD,6,100,1,24,0,*');              // player switches to slot 1: real mag is 6
  const st = h.eng.state();
  assert.equal(st.mag, 6, 'denominator comes from the bundle $AMMO, not the config echo (got ' + st.mag + ')');
  assert.equal(st.ammo, 6);
});


test('a fresh assign after match end leaves the MATCH COMPLETE screen (new-match flow)', () => {
  const h = harness().kit().config_();
  h.adv(1600); h.echo(); h.eng.tick();
  h.start(0); h.eng.tick();
  h.eng._endLocal('test-end');
  h.eng.ackEnd();
  assert.equal(h.eng.ended, true);
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });
  assert.equal(h.eng.ended, false, 'assign resets the over screen');
  assert.equal(h.eng.phase, 'kitted');
});
