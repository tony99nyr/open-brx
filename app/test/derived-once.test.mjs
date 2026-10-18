// DRY #4 (review 2026-10-10): gun recovery, T-minus and the respawn countdown are each derived once and read by
// both statusBody() (MC) and state() (HUD). This pins both bodies across the recovery states and the respawn gates,
// so the refactor cannot move a byte. Mirrors: none (the stage keeps its own copy of the arithmetic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

function harness({ respawnType = 'auto' } = {}) {
  let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode: 'ffa', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: respawnType, delay_s: 10 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: () => {}, emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1' }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*'); eng.feedFrame('$ALCD,32,100,0,192,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  eng.tick(); eng.feedFrame('$LCD,45,70,0,0,30,90,*');
  assert.equal(eng.phase, 'live');
  return { eng, now: () => clock, set(t) { clock = t; } };
}

// The seven fields under test, read from both bodies. `undefined` = the key is absent from statusBody.
function read(eng) {
  const s = eng.statusBody(), st = eng.state();
  return { gun_locked: s.gun_locked, t_minus_ms: s.t_minus_ms, deadline_s: s.deadline_s,
    gunRecovery: st.gunRecovery, tMinusMs: st.tMinusMs, respawnIn: st.respawnIn };
}

test('derived once: gun recovery states read the same in statusBody and state()', () => {
  const h = harness(); const { eng } = h;
  const cases = [
    ['no lock, no recovery', null, null, { gun_locked: undefined, gunRecovery: null }],
    ['locked, no recovery', true, null, { gun_locked: true, gunRecovery: null }],
    ['locked, rearming (writing)', true, { attempts: 1, writing: true, nextAt: null }, { gun_locked: undefined, gunRecovery: 'rearming' }],
    ['locked, rearming (retry due)', true, { attempts: 1, writing: false, nextAt: h.now() + 5000 }, { gun_locked: undefined, gunRecovery: 'rearming' }],
    ['locked, retry exhausted', true, { attempts: 3, writing: false, nextAt: null }, { gun_locked: true, gunRecovery: 'retry_exhausted' }],
    ['recovery without lock, exhausted', null, { attempts: 3, writing: false, nextAt: null }, { gun_locked: undefined, gunRecovery: 'retry_exhausted' }],
  ];
  for (const [name, locked, rec, want] of cases) {
    eng.gunLocked = locked; eng._gunRecovery = rec;
    const got = read(eng);
    assert.equal(got.gun_locked, want.gun_locked, `${name}: gun_locked`);
    assert.equal(got.gunRecovery, want.gunRecovery, `${name}: gunRecovery`);
  }
  assert.equal(eng.statusBody().hasOwnProperty('gun_locked'), false);
});

test('derived once: T-minus is present only while armed with a go-live time', () => {
  const h = harness(); const { eng } = h;
  assert.equal(read(eng).t_minus_ms, undefined); assert.equal(read(eng).tMinusMs, null);   // live
  eng.phase = 'armed'; eng.start.go_live_t = h.now() + 3000;
  assert.equal(read(eng).t_minus_ms, 3000); assert.equal(read(eng).tMinusMs, 3000);
  eng.start.go_live_t = h.now() - 50;   // past: clamps at zero
  assert.equal(read(eng).t_minus_ms, 0); assert.equal(read(eng).tMinusMs, 0);
  eng.start.go_live_t = 0;              // no go-live time
  assert.equal(read(eng).t_minus_ms, undefined); assert.equal(read(eng).tMinusMs, null);
  eng.phase = 'lobby';
  assert.equal(read(eng).t_minus_ms, undefined);
});

test('derived once: respawn countdown gates differ (deadline_s: live; respawnIn: timed) and share the arithmetic', () => {
  for (const timed of [true, false]) {
    const h = harness({ respawnType: timed ? 'auto' : 'none' }); const { eng } = h;
    assert.equal(eng.timedRespawn, timed);
    let g = read(eng);   // alive
    assert.equal(g.deadline_s, undefined); assert.equal(g.respawnIn, 0);
    eng.alive = false; eng.deadAt = h.now() - 2500;
    g = read(eng);
    assert.equal(g.deadline_s, 8);                 // ceil((10000 - 2500) / 1000)
    assert.equal(g.respawnIn, timed ? 8 : 0);
    eng.deadAt = h.now() - 20000;                  // past the delay: clamps at zero
    g = read(eng);
    assert.equal(g.deadline_s, 0); assert.equal(g.respawnIn, 0);
    eng.deadAt = 0;                                // no death time
    g = read(eng);
    assert.equal(g.deadline_s, undefined); assert.equal(g.respawnIn, 0);
    eng.deadAt = h.now() - 2500; eng.phase = 'lobby';   // not live
    g = read(eng);
    assert.equal(g.deadline_s, undefined); assert.equal(g.respawnIn, timed ? 8 : 0);
  }
});
