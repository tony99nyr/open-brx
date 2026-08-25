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
  const writes = []; const facts = []; const reports = [];
  let clock = 1_000_000;
  const config = { config_id: golden.config_id, mode, environment: 'outdoor', night: false, time_limit_s: timeLimit,
    respawn: { type: respawn, delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' }];
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: f => facts.push(f), report: (k, b) => reports.push({ k, b }),
    now: () => clock, synced: () => synced, storage: mkStorage(), log: () => {} });
  const bundle = { ...golden, player_id: 'p1' };
  const api = {
    eng, writes, facts, reports, bundle, config, player, team, roster,
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
