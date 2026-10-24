// The EMP perk (Tony 2026-10-24, in place of the Haze weapon). The holder presses LEFT (`$BUT,4,1`; the head maps
// LEFT to 98, so the gun itself does nothing) and the phone throws a host `$IRTX` on cell <8,1>, then waits out a
// match-clock cooldown. A victim's phone treats a `$HIR` on <8,1> as the F15 stun for `frames.emp.duration_s`.
// Mirrors: mcp/tests/test_mc_emp_perk.py (the compiled row), mcp/tests/test_stage_mirror.py (the victim on the stage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const EMP = { cooldown_s: 45, duration_s: 3 };

function harness({ perk = 'emp', emp = EMP, storage = mkStorage() } = {}) {
  const writes = [], logs = [];
  let clock = 1_000_000;
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }], ...(perk ? { perk } : {}) }, voice: 'male' };
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' }];
  const eng = new Engine({ writer: (fr, why) => { const n = writes.push(...fr); return String(why).startsWith('gun liveness probe') ? false : n; }, emit: () => {}, report: () => {},
    now: () => clock, synced: () => true, storage, log: l => logs.push(l), delay: (ms, fn) => fn() });
  const bundle = { ...golden, player_id: 'p1', ...(emp ? { emp } : {}) };
  const h = {
    eng, writes, logs, storage, at: () => clock,
    adv(ms) { clock += ms; eng.tick(); return h; },
    live() {
      eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
      eng.onMcMessage({ kind: 'assign', body: { player, team, roster } });
      eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } });
      eng.feedFrame('$LCD,0,0,0,0,0,0,*'); eng.feedFrame('$ALCD,32,100,0,192,0,*');
      eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
      return h.adv(10);
    },
    left() { const n = writes.length; eng.feedFrame('$BUT,4,1,*'); eng.feedFrame('$BUT,4,0,*'); return writes.slice(n).filter(f => f.startsWith('$IRTX')); },
  };
  return h;
}

test('EMP throw: LEFT on a live holder writes one $IRTX on <8,1>, all domes, own id, own team immune', () => {
  const h = harness().live();
  assert.equal(h.eng.phase, 'live'); assert.equal(h.eng.alive, true);
  // protocol/brx-protocol.md $IRTX: Direction, BulletType, PlayerId, ImmuneTeamColor, Damage, IsCriticalShot, PowerLevel (subtype),
  // IrRange, ToggleIRLoop (1 = once), TimeFireLoop, FlashLED
  assert.deepEqual(h.left(), ['$IRTX,100,8,7,1,1,0,1,100,1,,0,*']);
  const st = h.eng.state().emp;
  assert.ok(st && !st.ready && st.leftMs === 45000 && st.cooldownMs === 45000, JSON.stringify(st));
});

test('EMP throw: a second LEFT inside the cooldown sends nothing; after it, it throws again', () => {
  const h = harness().live();
  assert.equal(h.left().length, 1);
  h.adv(44000);
  assert.deepEqual(h.left(), [], 'inside the cooldown');
  assert.ok(h.logs.some(l => /EMP/.test(l) && /cooldown|recharg/i.test(l)), 'the refusal is logged');
  h.adv(1000);
  assert.equal(h.eng.state().emp.ready, true);
  assert.equal(h.left().length, 1, 'after the cooldown');
});

test('EMP throw: the cooldown runs on the match clock, through a death', () => {
  const h = harness().live();
  h.left();
  h.eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); h.eng.feedFrame('$HP,0,0,0,*');
  assert.equal(h.eng.alive, false);
  h.adv(20000);
  assert.ok(h.eng.alive, 'respawned');
  assert.deepEqual(h.left(), [], 'a respawn does not refill the throw');
  h.adv(25000);
  assert.equal(h.left().length, 1);
});

test('EMP throw: refused while down, stunned, before the match is live, and for a player without the perk', () => {
  const dead = harness().live();
  dead.eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); dead.eng.feedFrame('$HP,0,0,0,*');
  assert.deepEqual(dead.left(), [], 'down');
  const stunned = harness().live();
  stunned.eng.feedFrame('$HIR,4,8,19,2,1,0,1,*');
  assert.ok(stunned.eng.stunned, 'setup: stunned by an enemy EMP');
  assert.deepEqual(stunned.left(), [], 'stunned');
  const lobby = harness();
  lobby.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.deepEqual(lobby.left(), [], 'not live');
  const none = harness({ perk: null }).live();
  assert.deepEqual(none.left(), [], 'no perk');
  assert.equal(none.eng.state().emp, null, 'the HUD shows no EMP');
  const old = harness({ emp: null }).live();
  assert.deepEqual(old.left(), [], 'a bundle with no emp block: the victims carry no <8,1> row');
});

test('EMP victim: a $HIR on <8,1> stuns for frames.emp.duration_s, with no config.stun', () => {
  const h = harness({ perk: null }).live();
  assert.ok(!h.eng.config.stun, 'CONTROL: no host stun in this game');
  const n = h.writes.length;
  h.eng.feedFrame('$HIR,4,8,19,2,1,0,1,*');
  assert.ok(h.eng.stunned, 'stunned');
  assert.equal(h.eng.stunned.until - h.eng.now(), 3000);
  assert.ok(h.writes.slice(n).includes('$AMMO,0,0,0,1,*'), 'the gun is disarmed');
  h.adv(3000);
  assert.equal(h.eng.stunned, null, 'the stun expired');
  // CONTROL: <8,0> without config.stun is still the Charge Rifle's plain damage, no stun
  h.eng.feedFrame('$HIR,4,8,19,2,15,0,0,*');
  assert.equal(h.eng.stunned, null, '<8,0> does not stun without config.stun');
});

test('EMP victim: no emp block in the bundle, a <8,1> word stuns nobody', () => {
  const h = harness({ perk: null, emp: null }).live();
  h.eng.feedFrame('$HIR,4,8,19,2,1,0,1,*');
  assert.equal(h.eng.stunned, null);
});

test('EMP victim: my own word bouncing back never stuns me (F438)', () => {
  const h = harness().live();
  h.eng.feedFrame('$HIR,4,8,7,1,1,0,1,*');
  assert.equal(h.eng.stunned, null);
});

test('EMP throw: a phone restart mid-cooldown keeps the time left (it never hands the throw back early)', () => {
  const h = harness().live();
  h.left(); h.adv(10000);
  h.eng._save();
  const eng2 = new Engine({ writer: () => 1, emit: () => {}, report: () => {}, now: h.at, wallNow: h.at, synced: () => true, storage: h.storage, log: () => {}, delay: (ms, fn) => fn() });
  const st = eng2.state().emp;
  assert.ok(st && !st.ready && st.leftMs > 30000 && st.leftMs <= 35000, JSON.stringify(st));
});
