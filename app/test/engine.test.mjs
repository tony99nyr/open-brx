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

test('Q12: shield-absorbed damage still emits hit_taken (drain order shield->armor->HP)', () => {
  // Bench 2026-08-27: $HP is <hp>,<armor>,<shield> and damage drains the shield first.
  // Before the fix the engine summed only hp+armor, so a shield-absorbed hit computed
  // dmg === 0 and the `dmg > 0` guard dropped the fact entirely -- silent damage.
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HP,45,70,150,*');                       // shield granted (fn-11) up to its cap
  h.frame('$HIR,4,0,19,2,30,0,3,*'); h.frame('$HP,45,70,120,*');
  const hit = h.facts.find(f => f.type === 'hit_taken');
  assert.ok(hit, 'a hit absorbed entirely by the shield must still emit hit_taken');
  assert.equal(hit.dmg, 30);
  assert.equal(h.eng.shield, 120);
  assert.equal(h.eng.hp, 45); assert.equal(h.eng.armor, 70);
});

test('Q12: spawn and respawn zero the shield (it is a capacity, never a starting pool)', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HP,45,70,150,*');
  assert.equal(h.eng.shield, 150);
  // Kill with the SHIELD STILL UP. If the killing $HP carried shield 0, _onHp would zero it and the
  // assertion below would hold even with the respawn fix reverted -- i.e. the test could not fail.
  h.frame('$HIR,4,0,19,2,99,0,3,*'); h.frame('$HP,0,0,120,*');
  assert.equal(h.eng.alive, false);
  assert.equal(h.eng.shield, 120, 'shield must survive the killing blow, or this test proves nothing');
  h.adv(8000); h.eng.tick();                                   // auto-respawn fires
  assert.equal(h.eng.alive, true, 'respawn must actually have happened for this to test anything');
  assert.equal(h.eng.shield, 0, 'respawn must zero the shield; a stale one inflates the next damage calc');
});

test('Q12: a shield does not survive a MATCH BOUNDARY into the next spawn', () => {
  // _endLocal and control{panic} reset spawned/alive but deliberately do NOT touch the pools,
  // so _spawn's `this.shield = 0` is the only thing clearing a shield carried out of match 1.
  // Without it, match 2's first hit computes `before` inflated by the stale shield -- Q12's
  // failure mode across a match boundary. (Found by review: this path had zero coverage.)
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HP,45,70,150,*');
  assert.equal(h.eng.shield, 150);
  h.eng.control({ cmd: 'panic' });                 // ends the match, leaves pools alone
  assert.equal(h.eng.shield, 150, 'precondition: the shield really does survive the match end');
  h.kit().config_().echo().start(0); h.adv(10); h.eng.tick();   // match 2
  assert.equal(h.eng.shield, 0, 'SPAWN must zero the carried-over shield');
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
  // 35 s runway, crossed from above. The bundle deliberately ships runway_30 and runway_20 SILENT —
  // VA85 at 30 AND 20 AND 10 stacked the same counting track on the bench (compile.py, 2026-08-25), so
  // only the 10 s call has a frame. This asserts the AUDIO, which is the thing the bench decided;
  // `cuesFired` only records cues that actually have a frame, so it cannot speak for a silent one.
  const b = harness().kit().config_();
  b.adv(1600); b.echo(); b.eng.tick();
  const va85 = () => b.writes.filter(f => f.includes('VA85')).length;
  b.start(35000); b.eng.tick();
  assert.equal(va85(), 0, 'nothing at T-35');
  b.adv(6000); b.eng.tick();   // T-29
  assert.equal(va85(), 0, 'T-30 is deliberately silent');
  b.adv(10000); b.eng.tick();  // T-19
  assert.equal(va85(), 0, 'T-20 is deliberately silent');
  b.adv(10000); b.eng.tick();  // T-9
  assert.equal(va85(), 1, 'the 10 s call is the only runway cue that speaks');
  assert.ok(b.eng.cuesFired.has('runway_10'));
  b.adv(1000); b.eng.tick();
  assert.equal(va85(), 1, 'and it fires exactly once');
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

// ---------- A10 self-serve kitting (docs/spec/loadout.md §4) ----------
const CAT = { weapons: [{ weapon_id: 'assault_rifle', name: 'Assault Rifle', role: 'assault', tags: ['assault'], clip: 32, reserve: 384 }, { weapon_id: 'smg', name: 'SMG', role: 'cqb', tags: ['cqb'], clip: 72, reserve: 288 }, { weapon_id: 'rocket_launcher', name: 'Rocket Launcher', role: 'power', tags: ['heavy'], clip: 1, reserve: 4 }],
  perks: [{ perk_id: 'body_armor', name: 'Body Armor', mechanism: 'passive', effects: { max_armor_add: 50 }, verified: true, hidden: false }] };
const POL = { hud_select: true, primary: { choice: 'player', allowed_ids: ['assault_rifle', 'smg'] }, secondary: { choice: 'player', kinds: ['weapon', 'perk'], allowed_weapon_ids: ['smg'], allowed_perk_ids: ['body_armor'] } };
function kitA10(policy = POL) { const h = harness(); h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, catalog: CAT, policy } }); return h; }

test('A10: assign carries catalog + policy → state; loadout view resolves names from the catalog', () => {
  const h = kitA10();
  const st = h.eng.state();
  assert.equal(st.catalog.weapons.length, 3); assert.equal(st.policy.primary.choice, 'player');
  assert.equal(st.loadout.primary.name, 'Assault Rifle'); assert.equal(st.loadout.secondary, null);
  assert.equal(st.weapon, 'ASSAULT RIFLE'); assert.ok(st.canPickPrimary && st.canPickSecondary);
});

test('A10: requestLoadout reports loadout_request (id + try only when set) and holds an optimistic pendingPick', () => {
  const h = kitA10();
  assert.equal(h.eng.requestLoadout('primary', 'weapon', 'smg', true), true);
  const r = h.reports.find(x => x.k === 'loadout_request');
  assert.deepEqual(r.b, { player_id: 'p1', slot: 'primary', kind: 'weapon', id: 'smg', try: true });
  assert.deepEqual(h.eng.state().pendingPick.id, 'smg');
  assert.equal(h.eng.requestLoadout('secondary', 'none'), true);
  const r2 = h.reports.filter(x => x.k === 'loadout_request')[1];
  assert.deepEqual(r2.b, { player_id: 'p1', slot: 'secondary', kind: 'none' }, 'kind none carries no id and no try');
  assert.equal(h.eng.requestLoadout('primary', 'perk', 'body_armor'), false, 'primary is weapons only');
  assert.equal(h.eng.requestLoadout('primary', 'none'), false, 'primary can never be empty');
});

test('A10: policy is the lock — host/fixed/off slots and hud_select=false refuse locally, nothing reported', () => {
  const h = kitA10({ ...POL, primary: { choice: 'fixed', allowed_ids: ['assault_rifle'] }, secondary: { ...POL.secondary, choice: 'off' } });
  assert.equal(h.eng.requestLoadout('primary', 'weapon', 'smg'), false);
  assert.equal(h.eng.requestLoadout('secondary', 'weapon', 'smg'), false);
  assert.equal(h.reports.filter(x => x.k === 'loadout_request').length, 0);
  assert.equal(h.eng.state().canPickPrimary, false);
  const h2 = kitA10({ ...POL, hud_select: false });
  assert.equal(h2.eng.canPick('primary'), false);
});

test('A10: loadout_ack ok applies the echoed loadout (perk in slot 2); reject keeps MC\'s loadout + surfaces the reason; tick() clears it after 4 s', () => {
  const h = kitA10();
  h.eng.requestLoadout('secondary', 'perk', 'body_armor');
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'secondary', ok: true, loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: 'body_armor' } } });
  let st = h.eng.state();
  assert.equal(st.pendingPick, null); assert.equal(st.loadoutAck.ok, true);
  assert.equal(st.loadout.secondary.kind, 'perk'); assert.equal(st.loadout.secondary.name, 'Body Armor'); assert.equal(st.loadout.secondary.effects.max_armor_add, 50);
  h.eng.requestLoadout('primary', 'weapon', 'smg');
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: false, reason: 'Host locked this slot', loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: 'body_armor' } } });
  st = h.eng.state();
  assert.equal(st.loadoutAck.ok, false); assert.equal(st.loadoutAck.reason, 'Host locked this slot');
  assert.equal(st.loadout.primary.weapon_id, 'assault_rifle', 'a reject reverts the optimistic pick to MC\'s echo');
  h.adv(4100); h.eng.tick();
  assert.equal(h.eng.state().loadoutAck, null, 'ack chip expires');
});

test('A10: a secondary WEAPON shows in slot 2; weaponName never breaks with one weapon; unanswered pick expires', () => {
  const h = kitA10();
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'secondary', ok: true, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] } } });
  const st = h.eng.state();
  assert.equal(st.loadout.secondary.kind, 'weapon'); assert.equal(st.loadout.secondary.weapon_id, 'smg');
  h.eng.activeSlot = 1; assert.equal(h.eng.weaponName, 'SMG');
  h.eng.activeSlot = 3; assert.equal(h.eng.weaponName, 'ASSAULT RIFLE', 'unknown slot falls back to the primary');
  h.eng.requestLoadout('primary', 'weapon', 'smg'); h.adv(6100); h.eng.tick();
  assert.equal(h.eng.state().pendingPick, null, 'MC never answered → optimistic row dropped');
});

test('A10: browse(open) reports loadout_browse once per transition; DONE on a try-out hides the panel until the next try-out', () => {
  const h = kitA10();
  h.eng.browse(true); h.eng.browse(true); h.eng.browse(false);
  const b = h.reports.filter(x => x.k === 'loadout_browse').map(x => x.b.open);
  assert.deepEqual(b, [true, false]);
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG' }, frames: ['$START,*'] } });
  assert.equal(h.eng.state().tryoutSeen, null);
  h.eng.dismissTryout(); assert.equal(h.eng.state().tryoutSeen, 'smg');
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'shotgun', name: 'Shotgun' }, frames: ['$START,*'] } });
  assert.equal(h.eng.state().tryoutSeen, null, 'a fresh try-out shows its panel again');
});

test('A10: catalog + policy survive a persisted reload and a welcome re-hydrate', () => {
  const h = kitA10();
  const store = h.eng.storage;
  const e2 = new Engine({ writer: () => {}, now: () => 1_000_500, synced: () => true, storage: store, log: () => {} });
  assert.equal(e2.catalog.weapons.length, 3); assert.equal(e2.policy.hud_select, true);
  e2.hydrate({ player: h.player, catalog: { weapons: [], perks: [] }, policy: { ...POL, hud_select: false } });
  assert.equal(e2.policy.hud_select, false); assert.equal(e2.catalog.weapons.length, 0);
});


test('A10 §4.1/§4.6: kit_open false → setting-up (no picks); flip true → BRIEFING until BUILD MY KIT; assign.game reaches state', () => {
  const GAME = { name: 'Silenced Sniper', mode: 'ffa', abbr: 'FFA', loadout_line: 'Everyone carries the Sniper Rifle.', ruleset: 'CUSTOM RULES', hud_select: true };
  const h = kitA10({ ...POL, kit_open: false });
  let st = h.eng.state();
  assert.equal(st.kitOpen, false); assert.equal(st.canPickPrimary, false, 'no picks while MC is setting up');
  assert.equal(h.eng.requestLoadout('primary', 'weapon', 'smg'), false);
  assert.equal(h.reports.filter(x => x.k === 'loadout_request').length, 0);
  h.eng.closeBriefing();                                    // a stale "seen" from an earlier game must not skip the new briefing
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: null, roster: [], policy: { ...POL, kit_open: true }, game: GAME } });
  st = h.eng.state();
  assert.equal(st.kitOpen, true); assert.equal(st.briefSeen, false, 'kit just opened → BRIEFING shows'); assert.equal(st.game.name, 'Silenced Sniper');
  assert.ok(st.canPickPrimary, 'picks allowed once the kit is open');
  h.eng.closeBriefing(); assert.equal(h.eng.state().briefSeen, true);
  h.eng.openBriefing(); assert.equal(h.eng.state().briefSeen, false, 'BRIEFING button reopens it');
  h.eng.closeBriefing();
  // MC goes back to setting up (host returned to GAMES): browser closes, no picks; re-opening shows the briefing again
  h.eng.browse(true);
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: null, roster: [], policy: { ...POL, kit_open: false }, game: GAME } });
  assert.equal(h.eng.state().browsing, false); assert.equal(h.eng.state().canPickPrimary, false);
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: null, roster: [], policy: { ...POL, kit_open: true }, game: GAME } });
  assert.equal(h.eng.state().briefSeen, false);
});

test('A10 §4.1: a policy without kit_open (older MC) leaves the kit open', () => {
  const h = kitA10(POL);
  assert.equal(h.eng.state().kitOpen, true); assert.ok(h.eng.canPick('primary'));
});

// ── ALT weapon swap indicator (field 2026-08-30; hardened after review 2026-08-31) ──────────────
function twoWeapons(h) {
  h.eng.player = { ...h.eng.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'shotgun' }] } };
  return h;
}

test('ALT raises the swap indicator only with a real second weapon', () => {
  const h = goLive(harness());
  h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switching, false, 'single-weapon loadout: ALT is a reload, not a swap');
  twoWeapons(h).frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switching, true);
});

test('the indicator EXPIRES without inventing a slot the gun never reported', () => {
  // $BUT,1 is "alt-fire" — it is also the native 3s indoor/outdoor toggle and easy_reload remaps it to
  // RELOAD, so a press is not proof a weapon changed. Guessing a slot showed the WRONG gun and the
  // wrong magazine until the next trigger pull (review 2026-08-31).
  const h = twoWeapons(goLive(harness()));
  h.frame('$ALCD,32,100,0,192,0,*');
  h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switching, true);
  h.adv(5000);
  const st = h.eng.state();
  assert.equal(st.switching, false, 'indicator cleared');
  assert.equal(st.activeSlot, 0, 'slot still what the GUN last reported — never guessed');
  assert.equal(st.ammo, 32, 'ammo still the slot the gun reported');
});

test('switchingMs() is pure — reading state never mutates it', () => {
  const h = twoWeapons(goLive(harness()));
  h.frame('$BUT,1,1,*');
  h.adv(9999);
  const before = h.eng.activeSlot;
  for (let i = 0; i < 5; i++) h.eng.state();
  assert.equal(h.eng.activeSlot, before, 'snapshot() must not move the slot');
});

test('an $ALCD on a new weapon slot confirms the swap; melee (slot 4) does not', () => {
  const h = twoWeapons(goLive(harness()));
  h.frame('$ALCD,32,100,0,192,0,*');
  h.frame('$BUT,1,1,*');
  h.adv(300); h.frame('$ALCD,1,100,4,0,0,*');            // melee reports on its own $ALCD
  assert.equal(h.eng.state().switching, true, 'slot 4 is melee, not the swap we awaited');
  h.adv(200); h.frame('$ALCD,6,100,1,24,0,*');           // the real secondary
  const st = h.eng.state();
  assert.equal(st.switching, false);
  assert.equal(st.activeSlot, 1);
  assert.equal(st.ammo, 6, 'ammo follows the confirmed slot');
  assert.ok(h.eng.lastSwitchMs >= 500, 'records ALT -> confirming shot (includes reaction time)');
});

test('death clears the swap indicator', () => {
  const h = twoWeapons(goLive(harness()));
  h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switching, true);
  h.frame('$HIR,4,0,19,2,24,0,0,*'); h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.state().switching, false, 'indicator must not outlive the player');
});

// ── victim-side low-health alert (capture 2026-08-23-two-tagger-combat, decoded 2026-09-01) ──────
test('the low-health alert fires once per life when armour is gone and HP is dropping', () => {
  const h = goLive(harness());
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,16,0,*');   // armour still up
  assert.equal(h.writes.filter(f => f.includes('VA8B')).length, 0, 'armour up: no alert');
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,43,0,0,*');    // armour gone, HP taking damage
  assert.equal(h.writes.filter(f => f.includes('VA8B')).length, 1, 'alert on the transition');
  assert.equal(h.writes.filter(f => f.includes('$HLED,7,4')).length, 1, 'headset lights with it');
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,34,0,0,*');
  assert.equal(h.writes.filter(f => f.includes('VA8B')).length, 1, 'once per life, not per hit');
});

test('a respawn re-arms the low-health alert', () => {
  const h = goLive(harness());
  h.frame('$HP,43,0,0,*');
  h.writes.length = 0;
  h.frame('$HP,0,0,0,*');                                        // dead
  h.eng._spawn(false);                                           // back on your feet
  h.frame('$HP,43,0,0,*');
  assert.equal(h.writes.filter(f => f.includes('VA8B')).length, 1, 'a new life gets a new alert');
});

// ── empty-mag state, replayed at the REAL cadence (capture 2026-08-26-weapons-smg-plus-amr) ──────
test('emptying a mag leaves ammo 0 and the low-mag prompt armed', () => {
  // The gun sends one $ALCD per shot all the way down to 0 and then nothing on a dry trigger — proven
  // in the SMG capture (9,8,7…1,0 at ~350ms, then $BUT with no $ALCD). Field 2026-08-30 showed no
  // reload prompt and no empty state on the phone, so this pins the two layers we control.
  const h = goLive(harness());
  h.frame('$LCD,45,70,0,0,32,192,*');
  for (let mag = 31; mag >= 0; mag--) {
    h.adv(140); h.frame('$BUT,0,1,*'); h.frame(`$ALCD,${mag},100,0,192,0,*`); h.frame('$BUT,0,0,*');
  }
  const st = h.eng.state();
  assert.equal(st.ammo, 0, 'the engine sees the empty magazine');
  assert.equal(st.mag, 32, 'and keeps the right denominator');
  // the two values hud.js derives the RELOAD prompt and the solid/red empty state from
  assert.ok(st.alive && st.mag && st.ammo < st.mag && st.ammo / st.mag <= 0.15, 'lowMag is armed');
  // a dry trigger after empty must not move anything
  h.adv(140); h.frame('$BUT,0,1,*'); h.frame('$BUT,0,0,*');
  assert.equal(h.eng.state().ammo, 0);
});

test('a hit forwards WHICH sensor caught it', () => {
  // $HIR tok1: 0 = headset FRONT dome, 1 = headset BACK, 4 = gun body. Answering "do the headset
  // domes ever register?" needed the phone's raw frame ring because this field was dropped here.
  const h = goLive(harness());
  h.frame('$HIR,0,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,52,0,*');
  const hits = h.facts.filter(f => f.type === 'hit_taken');
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map(f => f.sensor), [0, 4], 'headset dome then gun body');
});

// ── headset team colour survives hits (bench 2026-09-03: a registered hit WIPES the headset) ─────
test('A11.6 headset: white flash at the whistle then dark; hit flash then dark; respawn flash; carrier blink on the flag alert', () => {
  const h = goLive(harness());
  const hs = golden.headset;
  assert.equal(hs.in_play, 'dark');
  // the spawn wrote the start flash and then the rest (dark) frame — harness delays run inline
  const startFrames = hs.start.map(x => x[0]);
  for (const f of startFrames) assert.ok(h.writes.includes(f), 'start frame missing: ' + f);
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');          // a hit: flash then rest
  assert.deepEqual(h.writes.filter(f => f.startsWith('$HLED')), hs.hit.map(x => x[0]));
  h.writes.length = 0;
  h.frame('$HP,45,61,0,*');                                              // no damage: nothing
  assert.equal(h.writes.filter(f => f.startsWith('$HLED')).length, 0);
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,43,0,0,*');           // low-health alert wins over the hit flash
  assert.equal(h.writes.filter(f => f.includes('$HLED,7,4')).length, 1);
  assert.ok(!h.writes.includes(hs.hit[0][0]), 'no hit flash on the alert hit');
  // carrier: MC says this player took the flag of team 2 -> team-2 blink; a hit keeps it; scoring ends it
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'objective_taken', text: 'FLAG TAKEN', player_id: 'p1', carrier: 'p1', flag_tid: 2, t: h.eng.now() }, t: h.eng.now() });
  assert.ok(h.writes.includes(hs.carrier['2'][0][0]), 'carrier blink in the flag colour');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,34,0,0,*');
  assert.ok(h.writes.includes(hs.carrier['2'][0][0]) && !h.writes.includes(hs.hit[0][0]), 'the flag blink survives a hit');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'objective_scored', text: 'FLAG CAPTURED', player_id: 'p1', carrier: 'p1', t: h.eng.now() }, t: h.eng.now() });
  assert.deepEqual(h.writes.filter(f => f.startsWith('$HLED')), [hs.rest], 'scored -> back to rest');
  // death: paint the out-blink the bundle carries (default is now the green slow-blink — A11.6, presentation.py);
  // respawn: white flash then rest
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  assert.deepEqual(h.writes.filter(f => f.startsWith('$HLED')), hs.death.map(x => x[0]), 'death paints the headset out-blink');
  h.adv(9000); h.writes.length = 0; h.eng.tick();                      // the auto respawn (delay 8 s) fires in this tick
  for (const f of hs.respawn.map(x => x[0])) assert.ok(h.writes.includes(f), 'respawn frame missing: ' + f);
});

test('A11.6 headset in_play=team: the rest frame is the team colour and a hit restores it after the flash', () => {
  const h = harness();
  const teamRest = '$HLED,1,0,,,10,,*';
  const bundle = { ...h.bundle, headset: { ...golden.headset, in_play: 'team', rest: teamRest,
    start: [[golden.headset.start[0][0], 0.6], [teamRest, 0]], hit: [[golden.headset.hit[0][0], 0.5], [teamRest, 0]], respawn: [[golden.headset.respawn[0][0], 0.6], [teamRest, 0]] } };
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: bundle, roster: h.roster } });
  h.eng.feedFrame('$LCD,0,0,0,0,0,0,*'); h.start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  assert.equal(h.writes.filter(f => f === teamRest).length >= 1, true, 'start ends on the team colour');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');
  const hled = h.writes.filter(f => f.startsWith('$HLED'));
  assert.equal(hled[hled.length - 1], teamRest, 'after the hit flash the headset returns to the team colour');
});
test('reload handle pull opens a reload for the weapon\'s reload_s; the mag coming back closes it', () => {
  const h = harness().kit().config_().echo().start(0);
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, catalog: { weapons: [{ weapon_id: 'assault_rifle', name: 'Assault Rifle', clip: 32, reserve: 384, reload_s: 1.4 }], perks: [] } } });
  h.eng.tick();
  assert.equal(h.eng.phase, 'live');
  h.frame('$ALCD,20,100,0,384,0,*');                       // 12 rounds gone
  h.frame('$BUT,2,1,*');
  let s = h.eng.state();
  assert.equal(s.reloading, true, 'reloading after the handle pull');
  assert.equal(s.reloadTotalMs, 1400, 'the catalog reload_s drives the takeover length');
  h.adv(700); s = h.eng.state(); assert.equal(s.reloadMs, 700);
  h.frame('$ALCD,32,100,0,372,0,*');                       // the gun refilled the mag
  assert.equal(h.eng.state().reloading, false, 'the mag coming back ends the reload');
});
test('a reload the gun never echoes still clears after reload_s plus grace; no reload while dead or with a full mag', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*'); h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, false, 'a full mag has nothing to reload');
  h.frame('$ALCD,10,100,0,384,0,*'); h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, true);
  assert.equal(h.eng.state().reloadTotalMs, 1500, 'unknown weapon → 1.5 s default');
  h.adv(1500 + 600 + 1);
  assert.equal(h.eng.state().reloading, false, 'expired without an echo');
  h.frame('$HP,0,0,0,*');
  h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, false, 'dead: no reload');
});
test('score push exposes hits and the board; lives derive from config.respawn.lives minus deaths', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.eng.onMcMessage({ kind: 'score', body: { kills: 4, deaths: 1, assists: 0, accuracy: 40, hits: 8, shots_total: 20, board: { teams: [{ team_id: 'blue', name: 'BLUE', score: 18 }, { team_id: 'yellow', name: 'YELLOW', score: 21 }], cap: 25 } } });
  const s = h.eng.state();
  assert.equal(s.hits, 8); assert.equal(s.board.cap, 25); assert.equal(s.board.teams[1].score, 21);
  assert.equal(s.fragLimit, 25); assert.equal(s.lives, null, 'no lives cap in this config');
  h.eng.config.respawn.lives = 3; h.eng.deaths = 2;
  assert.equal(h.eng.state().lives, 1);
});
test('a new match_id drops the previous match\'s score row; a dry reserve never opens a reload', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.eng.onMcMessage({ kind: 'score', body: { kills: 4, deaths: 1, assists: 0, board: { teams: [], cap: 25 } } });
  assert.equal(h.eng.state().kills, 4);
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  h.config_().echo();
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: h.eng.now(), config_id: golden.config_id, seq: 2, countdown_s: 0 } }); h.eng.tick();
  assert.equal(h.eng.state().kills, null, 'match 2 starts with no score row');
  h.frame('$ALCD,0,100,0,0,0,*'); h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, false, 'nothing to reload from an empty reserve');
});
test('with one weapon loaded, ALT falls back to reload and opens the same takeover', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.frame('$ALCD,10,100,0,384,0,*'); h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().reloading, true, 'ALT with an empty slot 1 is a reload');
  assert.equal(h.eng.state().switching, false, 'and not a weapon swap');
});
test('no reload opens during the resync protocol; a match end clears one in flight', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.frame('$ALCD,10,100,0,384,0,*');
  h.eng.onBleDropped(); h.eng.onBleConnected();
  assert.ok(h.eng.state().resync, 'resync running');
  h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, false, 'resync: the gun is unverified, no takeover');
  h.frame('$LCD,45,70,0,0,10,384,*');                       // state line ends the resync
  assert.equal(h.eng.state().resync, null);
  h.frame('$BUT,2,1,*'); assert.equal(h.eng.state().reloading, true);
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.equal(h.eng.reloading, null, 'end clears the reload');
});
test('ALT with two weapons: switching exposes from/to; the next shot on the new slot confirms with a switched moment', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] };
  h.frame('$ALCD,30,100,0,384,0,*'); h.frame('$BUT,1,1,*');
  let s = h.eng.state(); assert.equal(s.switching, true); assert.equal(s.switchFrom, 0); assert.equal(s.switchTo, 1); assert.equal(s.reloading, false);
  h.adv(400); h.frame('$ALCD,71,100,1,288,0,*');
  s = h.eng.state(); assert.equal(s.switching, false); assert.equal(s.activeSlot, 1); assert.equal(s.moment.kind, 'switched'); assert.equal(s.moment.data.slot, 1);
});
test('a swap the gun never confirms is assumed done at the window; a link drop cancels one', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] };
  h.frame('$ALCD,30,100,0,384,0,*'); h.frame('$BUT,1,1,*');
  h.adv(1201); h.eng.tick();
  let s = h.eng.state(); assert.equal(s.switching, false); assert.equal(s.activeSlot, 1); assert.equal(s.moment.data.assumed, true);
  h.frame('$BUT,1,1,*'); assert.equal(h.eng.state().switching, true);
  h.eng.onBleDropped(); assert.equal(h.eng.state().switching, false);
});

// ── A11 presentation events: the bundle's LED burst + cue per event ─────────────────────────────
test('a hit plays the bundle\'s hit_taken burst once per second, a death its died burst, a revive its respawned burst', () => {
  const h = goLive(harness());
  const burst = golden.leds.hit_taken;
  assert.ok(burst && burst.length >= 5, 'golden bundle carries an LED burst for hit_taken');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');
  const gled = h.writes.filter(f => f.startsWith('$GLED'));
  assert.equal(gled.length, burst.length, 'every step of the burst is written (harness delays run inline)');
  assert.equal(gled[gled.length - 1], burst[burst.length - 1][0], 'ends on the team colour');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,52,0,*');             // 0 ms later: lights suppressed
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'no second burst inside a second');
  h.adv(1500); h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');              // death
  const died = golden.leds.died;
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), died.map(s => s[0]), 'the died burst, not hit_taken');
  h.adv(9000); h.eng.tick(); h.adv(1000); h.eng.tick();                    // auto respawn (delay 8 s)
  const resp = golden.leds.respawned;
  assert.ok(h.writes.filter(f => f === resp[0][0]).length >= 1, 'respawned burst after the revive frames');
});

test('a silenced bundle (no leds, empty announcer cues) plays nothing extra on a hit', () => {
  const h = harness();
  const silenced = { ...h.bundle, leds: {}, cues: { ...h.bundle.cues, kill: '', multi: '', medal: '' } };
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: silenced, roster: h.roster } });
  h.eng.feedFrame('$LCD,0,0,0,0,0,0,*'); h.start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0);
  h.eng.feedback({ kind: 'kill', player_id: 'p1', t: h.eng.now() }, h.eng.now());
  assert.ok(h.writes.includes('$SFLASH,*'), 'the sight flash still fires');
  assert.equal(h.writes.filter(f => f.startsWith('$PLAY')).length, 0, 'no kill line when the announcer is off');
});

// ── A11.4 alerts, medal stacks, clock callouts ───────────────────────────────────────────────
test('a kill feedback with medals plays each medal cue instead of the plain kill line', () => {
  const h = goLive(harness());
  h.writes.length = 0;
  h.eng.feedback({ kind: 'kill', player_id: 'p1', t: h.eng.now(), medals: ['killtacular', 'killing_spree'] }, h.eng.now());
  const plays = h.writes.filter(f => f.startsWith('$PLAY'));
  assert.deepEqual(plays, [golden.cues.killtacular, golden.cues.killing_spree], 'medals in order (harness delays run inline)');
  assert.ok(!plays.includes(golden.cues.kill), 'no plain kill line under a medal');
  assert.deepEqual(h.eng.state().moment.data.medals, ['killtacular', 'killing_spree']);
  h.writes.length = 0;
  h.eng.feedback({ kind: 'kill', player_id: 'p1', t: h.eng.now(), medals: [] }, h.eng.now());
  assert.deepEqual(h.writes.filter(f => f.startsWith('$PLAY')), [golden.cues.kill], 'no medals: the kill line');
});

test('an MC alert plays this node\'s cue + burst for the event and raises a HUD alert moment', () => {
  const h = goLive(harness());
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'next_kill_wins', text: 'NEXT KILL WINS', player_id: 'p1', t: h.eng.now() }, t: h.eng.now() });
  assert.ok(h.writes.includes(golden.cues.next_kill_wins), 'the announcer line from the bundle');
  const m = h.eng.state().moment;
  assert.equal(m.kind, 'alert'); assert.equal(m.data.kind, 'next_kill_wins'); assert.equal(m.data.text, 'NEXT KILL WINS');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'lead_taken', text: 'LEAD', player_id: 'p1', t: h.eng.now() - 60000 }, t: h.eng.now() - 60000 });
  assert.equal(h.writes.length, 0, 'a stale alert is dropped');
});

test('clock callouts fire once each from the node\'s own end time', () => {
  const h = harness({ timeLimit: 70 }).kit().config_().echo().start(0);
  h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  h.writes.length = 0;
  h.adv(11000); h.eng.tick();                          // 59 s left -> time_60
  assert.ok(h.writes.includes(golden.cues.time_60), 'one minute left');
  h.adv(1000); h.eng.tick();
  assert.equal(h.writes.filter(f => f === golden.cues.time_60).length, 1, 'edge-triggered, once');
  h.adv(29000); h.eng.tick();                          // 29 s left
  assert.ok(h.writes.includes(golden.cues.time_30));
  h.adv(20000); h.eng.tick();                          // 9 s left
  assert.ok(h.writes.includes(golden.cues.time_10));
});

test('an infection survivor plays survivors_win itself at time-expiry; a turned player plays game_over', () => {
  const h = harness({ mode: 'infection', timeLimit: 20 }).kit().config_().echo().start(0);
  h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  h.adv(21000); h.writes.length = 0; h.eng.tick();
  assert.ok(h.writes.includes(golden.cues.survivors_win), 'never turned -> survivors line');
  assert.ok(!h.writes.includes(golden.cues.game_over));
  const t = harness({ mode: 'infection', timeLimit: 20 }).kit().config_().echo().start(0);
  t.adv(10); t.eng.tick(); t.frame('$LCD,45,70,0,0,36,216,*');
  t.eng._turned = true;                                   // what a team_flip sets
  t.adv(21000); t.writes.length = 0; t.eng.tick();
  assert.ok(t.writes.includes(golden.cues.game_over) && !t.writes.includes(golden.cues.survivors_win));
});
test('a reload-speed perk shortens the RELOADING takeover to match the gun', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.eng.onMcMessage({ kind: 'assign', body: { player: { ...h.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: 'quick_hands' } }, team: h.team, roster: h.roster,
    catalog: { weapons: [{ weapon_id: 'assault_rifle', name: 'Assault Rifle', clip: 32, reserve: 384, reload_s: 1.4 }], perks: [{ perk_id: 'quick_hands', name: 'Quick Hands', effects: { reload_mult: 0.5 } }] } } });
  h.frame('$ALCD,20,100,0,384,0,*'); h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloadTotalMs, 700, '1.4 s × 0.5');
});
test('the Quick Switch perk halves the swap window: the assumed swap lands at 425 ms', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.eng.onMcMessage({ kind: 'assign', body: { player: { ...h.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }], perk: 'quick_switch' } }, team: h.team, roster: h.roster,
    catalog: { weapons: [], perks: [{ perk_id: 'quick_switch', name: 'Quick Switch', effects: { switch_mult: 0.5 } }] } } });
  delete h.eng.frames.swap_ms;                       // an older MC: no enforced value in the bundle → the node applies the perk itself
  h.frame('$ALCD,30,100,0,384,0,*'); h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switchWindowMs, 425);   // 850 stock × 0.5
  h.adv(426); h.eng.tick();
  const s = h.eng.state(); assert.equal(s.switching, false); assert.equal(s.activeSlot, 1); assert.equal(s.moment.data.assumed, true);
});
test('the bundle\'s swap_ms is the SWITCHING window; without it the node assumes the stock 850 × perk', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] };
  assert.equal(h.eng.state().switchWindowMs, 850, 'no swap_ms in the golden bundle → stock 850');
  h.eng.frames = { ...h.eng.frames, swap_ms: 425 };
  assert.equal(h.eng.state().switchWindowMs, 425, 'MC said 425');
  h.frame('$ALCD,30,100,0,384,0,*'); h.frame('$BUT,1,1,*'); h.adv(426); h.eng.tick();
  assert.equal(h.eng.state().activeSlot, 1, 'assumed done right after the real delay');
});

// ---------- utility items: scanner respawn at a station (docs/spec/utility.md §4) ----------
function stationEntry(o = {}) { return { role: 'station', id: 5, kind: 'respawn', team: 1, state: 1, value: 0, seq: 0, game: 0, threshold: -60, rssi: -50, raw: -50, present: true, ...o }; }
function scannerHarness(gate) {
  const h = harness({ respawn: 'scanner' });
  if (gate) h.config.respawn.gate = gate;
  h.kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.alive, false, 'precondition: dead');
  return h;
}

test('scanner + trigger gate: dead past the delay, at own-team station, trigger pull → revive with the station id', () => {
  const h = scannerHarness();
  h.adv(9000); h.eng.tick();
  assert.equal(h.eng.alive, false, 'scanner never auto-revives on the timer alone');
  assert.equal(h.eng.state().respawnHint, 'find_station');
  h.eng.setStations([stationEntry()]);
  assert.equal(h.eng.state().respawnHint, 'pull_trigger');
  assert.equal(h.eng.state().station.id, 5);
  h.eng.tick(); assert.equal(h.eng.alive, false, 'presence alone is not the trigger gate');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true);
  const r = h.facts.filter(f => f.type === 'respawn').pop();
  assert.equal(r.station, 5);
  assert.ok(h.writes.includes('$SPAWN,,*'));
});

test('scanner: the trigger does nothing before the delay, away from the station, or at the wrong team\'s station', () => {
  const h = scannerHarness();
  h.eng.setStations([stationEntry()]);
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, false, 'delay not elapsed');
  assert.equal(h.eng.state().respawnHint, 'hold', 'at the station but the delay is not up yet → HOLD');
  h.eng.setStations([]);
  assert.equal(h.eng.state().respawnHint, 'find_station', 'no station in range → guidance shows immediately, during the delay');
  h.adv(9000); h.eng.setStations([stationEntry({ present: false, rssi: -80 })]);
  assert.equal(h.eng.state().respawnHint, 'approach');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, false, 'not present');
  h.eng.setStations([stationEntry({ team: 2 })]);
  assert.equal(h.eng.state().station, null, 'a team-2 station is not mine');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, false, 'wrong team');
  h.eng.setStations([stationEntry({ team: 255 })]);
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true, 'a neutral station admits every team');
});

test('scanner: config.stations is an allow-list; a disabled station (state 0) does not count', () => {
  const h = scannerHarness();
  h.config.stations = [{ id: 9, kind: 'respawn' }];
  h.adv(9000);
  h.eng.setStations([stationEntry({ id: 5 })]);
  assert.equal(h.eng.state().station, null, 'id 5 is not in this game');
  h.eng.setStations([stationEntry({ id: 9, state: 0 })]);
  assert.equal(h.eng.state().station, null, 'a disabled station is invisible');
  h.eng.setStations([stationEntry({ id: 9 })]);
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true);
});

test('scanner + presence gate: dwelling at the station past the delay revives on the tick, no trigger needed', () => {
  const h = scannerHarness('presence');
  h.eng.setStations([stationEntry()]);
  h.eng.tick(); assert.equal(h.eng.alive, false, 'delay first');
  h.adv(9000); h.eng.tick();
  assert.equal(h.eng.alive, true);
  assert.equal(h.facts.filter(f => f.type === 'respawn').pop().station, 5);
});

test('auto respawn ignores stations entirely; a live gun\'s trigger is not a revive', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.setStations([stationEntry()]);
  assert.equal(h.eng.state().respawnHint, null);
  h.frame('$BUT,0,1,*');
  assert.equal(h.facts.filter(f => f.type === 'respawn').length, 0);
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.state().respawnHint, 'timer');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, false, 'auto mode: the trigger does not revive');
  h.adv(8000); h.eng.tick();
  assert.equal(h.eng.alive, true, 'the timer does');
  assert.equal(h.facts.filter(f => f.type === 'respawn').pop().station, undefined);
});

test('setStations re-renders only when the shown station changes', () => {
  const h = scannerHarness();
  let changes = 0; h.eng.onChange = () => changes++;
  h.eng.setStations([stationEntry({ rssi: -50 })]); const a = changes;
  h.eng.setStations([stationEntry({ rssi: -50.3 })]);
  assert.equal(changes, a, 'same rounded RSSI, same id, same presence: no re-render');
  h.eng.setStations([stationEntry({ rssi: -58 })]);
  assert.equal(changes, a + 1);
});

test('recovery: down after a cold boot with no death time stamps deadAt so scanner respawn works', () => {
  // Simulate the resync outcome: live match, gun observed dead, but deadAt lost across the reload.
  const h = harness({ respawn: 'scanner' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.alive = false; h.eng.deadAt = 0;                 // the stuck state seen on hardware 2026-09-04
  assert.equal(h.eng.state().respawnHint, null, 'precondition: no death time → no hint (the bug)');
  h.eng.tick();
  assert.ok(h.eng.deadAt > 0, 'the tick stamps a death time');
  assert.equal(h.eng.state().respawnHint, 'find_station', 'now the respawn logic runs — station guidance immediately');
  h.adv(9000); h.eng.setStations([stationEntry()]);
  assert.equal(h.eng.state().respawnHint, 'pull_trigger', 'delay elapsed at the station');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true, 'and the station revive works after recovery');
});

test('scanner: at the station during the delay shows HOLD, then PULL TRIGGER once the delay is up', () => {
  const h = harness({ respawn: 'scanner' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  h.eng.setStations([stationEntry()]);
  assert.equal(h.eng.state().respawnHint, 'hold', 'present but delay not elapsed → hold, not pull_trigger');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, false, 'the trigger does nothing during the delay');
  h.adv(9000); h.eng.setStations([stationEntry()]);
  assert.equal(h.eng.state().respawnHint, 'pull_trigger');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true);
});

// ---------- A11.6: the headset out-blink re-asserts through a long DOWN (utility.md §7, respawn LEDs) ----------
const OUTBLINK = '$HLED,3,2,400,400,10,200,*';   // green slow-blink, ~160 s; what presentation.py emits for death

test('death paints the headset out-blink, and it re-asserts while the player stays down', () => {
  const h = harness({ respawn: 'scanner' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.frames.headset = { ...(h.eng.frames.headset || {}), death: [[OUTBLINK, 0.0]] };
  const count = () => h.writes.filter(f => f === OUTBLINK).length;
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  assert.equal(count(), 1, 'the out-blink is painted once on death');
  h.adv(4000); h.eng.tick();
  assert.equal(count(), 1, 'no re-assert inside the 5 s F13 settle window');
  h.adv(2000); h.eng.tick();
  assert.equal(count(), 1, 'still down 6 s in — the ~160 s blink has not run out, no re-assert yet');
  h.adv(120000); h.eng.tick();
  assert.equal(count(), 2, 'past the re-blink interval, the out-blink is re-painted so a long walk stays lit');
  h.adv(120000); h.eng.tick();
  assert.equal(count(), 3, 'and again');
});

test('the out-blink is a no-op when the game opted out (death: [] = "native")', () => {
  const h = harness({ respawn: 'scanner' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.frames.headset = { ...(h.eng.frames.headset || {}), death: [] };
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  h.adv(200000); h.eng.tick();
  assert.equal(h.writes.filter(f => f === OUTBLINK).length, 0, 'nothing painted, no re-assert — the firmware/native path');
});

test('a revive stops the out-blink re-assert (no longer down)', () => {
  const h = harness({ respawn: 'scanner' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.frames.headset = { ...(h.eng.frames.headset || {}), death: [[OUTBLINK, 0.0]] };
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  h.adv(9000); h.eng.setStations([stationEntry()]); h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true, 'revived at the station');
  const after = h.writes.filter(f => f === OUTBLINK).length;
  h.adv(200000); h.eng.tick();
  assert.equal(h.writes.filter(f => f === OUTBLINK).length, after, 'alive again → no more out-blink writes');
});
