// The EMP perk (Tony 2026-10-24, in place of the Haze weapon). The holder presses LEFT (`$BUT,4,1`; the head maps
// LEFT to 98, so the gun itself does nothing) and the phone throws a host `$IRTX` on cell <8,1>, then waits out a
// match-clock cooldown. A victim's phone treats a `$HIR` on <8,1> as the F15 stun for `frames.emp.duration_s`.
// Mirrors: mcp/tests/test_mc_emp_perk.py (the compiled row), mcp/tests/test_stage_mirror.py (the victim on the stage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';
import { SMOKE_MS } from '../src/transport/contract.gen.js';
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const EMP = { cooldown_s: 45, duration_s: 6 };

/** `irtx(frames)`: what the link returns for the throw (default: delivered). `est`: the MC offset the transport has installed
 *  over the raw clock (null = no transport yet), as poison.test.mjs models app.js. */
function harness({ perk = 'emp', emp = EMP, storage = mkStorage(), mode = 'tdm', irtx = null } = {}) {
  const writes = [], logs = [];
  let clock = 1_000_000, trueOff = 0, est = 0;
  const raw = () => clock - trueOff, now = () => raw() + (est == null ? 0 : est), off = () => (est == null ? 0 : est);
  const config = { config_id: golden.config_id, mode, environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }], ...(perk ? { perk } : {}) }, voice: 'male' };
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' },
    { player_id: 'p3', player_num: 21, display: 'GHOST', team_id: 'blue' }];
  const mk = () => new Engine({ writer: (fr, why, opts) => { const n = writes.push(...fr); if (why === 'EMP throw' && irtx) return irtx(fr, opts); return String(why).startsWith('gun liveness probe') ? false : n; },
    emit: () => {}, report: () => {}, now, clockOffset: off, wallNow: raw, synced: () => true, storage, log: l => logs.push(l), delay: (ms, fn) => fn() });
  let eng = mk();
  const bundle = { ...golden, player_id: 'p1', ...(emp ? { emp } : {}) };
  const h = {
    eng, writes, logs, storage, at: () => clock,
    setOffset(o) { trueOff = o; est = o; return h; },
    /** The app relaunches with no transport yet (`now()` raw); `attach()` then installs the true offset. */
    restart() { eng._save(); est = null; eng = h.eng = mk(); return h; },
    attach() { est = trueOff; return h; },
    adv(ms) { clock += ms; h.eng.tick(); return h; },
    newMatch(id) { h.eng.onMcMessage({ kind: 'start', body: { match_id: id, go_live_t: clock, config_id: golden.config_id, seq: 2, countdown_s: 0 } }); return h; },
    live() {
      eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
      eng.onMcMessage({ kind: 'assign', body: { player, team, roster } });
      eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } });
      eng.feedFrame('$LCD,0,0,0,0,0,0,*'); eng.feedFrame('$ALCD,32,100,0,192,0,*');
      eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
      return h.adv(10);
    },
    left() { const n = writes.length; h.eng.feedFrame('$BUT,4,1,*'); h.eng.feedFrame('$BUT,4,0,*'); return writes.slice(n).filter(f => f.startsWith('$IRTX')); },
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
  assert.deepEqual(old.eng.state().emp, { off: true, ready: false, leftMs: 0, cooldownMs: 0 }, 'a late joiner sees why: EMP is off this match');
  assert.ok(old.logs.some(l => /EMP not thrown: not in this match/.test(l)), old.logs.filter(l => /EMP/.test(l)));
});

test('EMP victim: a $HIR on <8,1> stuns for frames.emp.duration_s, with no config.stun', () => {
  const h = harness({ perk: null }).live();
  assert.ok(!h.eng.config.stun, 'CONTROL: no host stun in this game');
  const n = h.writes.length;
  h.eng.feedFrame('$HIR,4,8,19,2,1,0,1,*');
  assert.ok(h.eng.stunned, 'stunned');
  assert.equal(h.eng.stunned.until - h.eng.now(), 6000);
  assert.ok(h.writes.slice(n).includes('$AMMO,0,0,0,1,*'), 'the gun is disarmed');
  h.adv(6000);
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

test('EMP victim: the jam lasts at least the native fn-23 blind (SMOKE_MS), even when emp.duration_s is shorter', () => {
  const h = harness({ perk: null, emp: { cooldown_s: 45, duration_s: 3 } }).live();
  h.eng.feedFrame('$HIR,4,8,19,2,1,0,1,*');
  assert.equal(SMOKE_MS, 6000);
  assert.equal(h.eng.stunned.until - h.eng.now(), SMOKE_MS, 'the gun stays blind 6 s, so the phone holds it that long');
  const long = harness({ perk: null, emp: { cooldown_s: 45, duration_s: 9 } }).live();
  long.eng.feedFrame('$HIR,4,8,19,2,1,0,1,*');
  assert.equal(long.eng.stunned.until - long.eng.now(), 9000, 'a longer jam is kept');
});

test('EMP throw: a restored cooldown keeps its time when the transport installs a +6 s or -6 s offset after the load', () => {
  for (const o of [6000, -6000]) {
    const h = harness().setOffset(o).live();
    h.left(); h.adv(10000);                                   // 35 s left
    h.restart();
    assert.equal(h.eng.state().emp.leftMs, 35000, `35 s left on the raw clock (offset ${o})`);
    h.attach(); h.eng.tick();
    assert.equal(h.eng.state().emp.leftMs, 35000, `still 35 s once the offset is installed (offset ${o})`);
  }
});

test('EMP throw: a write the link fails gives the throw back; a delivered one spends it', async () => {
  const sync = harness({ irtx: () => false }).live();
  assert.equal(sync.left().length, 1, 'setup: the frame was offered to the link');
  assert.equal(sync.eng.state().emp.ready, true, 'a failed write does not spend the cooldown');
  assert.ok(sync.logs.some(l => /EMP throw failed/.test(l)));
  const late = harness({ irtx: () => Promise.resolve(false) }).live();
  late.left(); await Promise.resolve(); await Promise.resolve();
  assert.equal(late.eng.state().emp.ready, true, 'a write that resolves false gives it back');
  const rej = harness({ irtx: () => Promise.reject(new Error('gatt')) }).live();
  rej.left(); await new Promise(r => setImmediate(r));
  assert.equal(rej.eng.state().emp.ready, true, 'a rejected write gives it back');
  const ok = harness({ irtx: () => Promise.resolve(true) }).live();
  ok.left(); await Promise.resolve(); await Promise.resolve();
  assert.equal(ok.eng.state().emp.leftMs, 45000, 'a delivered write spends it');
  assert.deepEqual(ok.left(), [], 'and a second press waits it out');
});

test('EMP victim: spawn protection blocks the EMP stun', () => {
  const h = harness({ perk: null }).live();
  h.eng._armPending = { at: h.eng.now(), flip: false, until: 2000, shotEnds: false, off: true, shield: true };
  assert.ok(h.eng._protectOwedMs() > 0, 'setup: the victim is protected');
  h.eng.feedFrame('$HIR,4,8,19,2,1,0,1,*');
  assert.equal(h.eng.stunned, null, 'protected: no jam');
  h.eng._armPending = null;
  h.eng.feedFrame('$HIR,4,8,19,2,1,0,1,*');
  assert.ok(h.eng.stunned, 'CONTROL: the same word stuns once protection is over');
});

test('EMP victim: a teammate\'s word is ignored in a team match; in FFA everyone but me is an enemy', () => {
  const team = harness({ perk: null }).live();
  team.eng.feedFrame('$HIR,4,8,21,1,1,0,1,*');               // GHOST, blue, my team
  assert.equal(team.eng.stunned, null, 'a teammate\'s EMP does not jam me');
  team.eng.feedFrame('$HIR,4,8,19,2,1,0,1,*');
  assert.ok(team.eng.stunned, 'CONTROL: an enemy\'s does');
  const ffa = harness({ perk: null, mode: 'ffa' }).live();
  ffa.eng.feedFrame('$HIR,4,8,21,1,1,0,1,*');
  assert.ok(ffa.eng.stunned, 'FFA: the same player is an enemy');
});

test('EMP throw: a write that sent the frame keeps the cooldown even when the link then reports failure (lost chunk acks)', async () => {
  const sentFalse = harness({ irtx: (fr, o) => { o && o.onFrameSent && o.onFrameSent(fr[0]); return Promise.resolve(false); } }).live();
  sentFalse.left(); await new Promise(r => setImmediate(r));
  assert.equal(sentFalse.eng.state().emp.leftMs, 45000, 'the frame left the phone: the throw is spent');
  const sentRej = harness({ irtx: (fr, o) => { o && o.onFrameSent && o.onFrameSent(fr[0]); return Promise.reject(new Error('ack lost')); } }).live();
  sentRej.left(); await new Promise(r => setImmediate(r));
  assert.equal(sentRej.eng.state().emp.leftMs, 45000, 'a rejection after the frame went out keeps it spent');
  const unsent = harness({ irtx: () => Promise.resolve(false) }).live();
  unsent.left(); await new Promise(r => setImmediate(r));
  assert.equal(unsent.eng.state().emp.ready, true, 'CONTROL: nothing left the phone, the throw is back');
});

test('EMP throw: a failure that resolves after a new match started refunds nothing into it', async () => {
  let settle;
  const h = harness({ irtx: () => new Promise(r => { settle = r; }) }).live();
  h.left();
  const spent = h.eng._emp;
  h.newMatch('m2');
  settle(false); await new Promise(r => setImmediate(r));
  assert.equal(h.eng._emp, spent, 'the old match\'s record is left alone, not refunded');
  assert.ok(!h.logs.some(l => /the throw is back/.test(l)), 'no refund line');
});

test('EMP victim: the word\'s own team (token 4) decides a teammate, over a stale roster', () => {
  const flipped = harness({ perk: null }).live();
  flipped.eng.feedFrame('$HIR,4,8,21,2,1,0,1,*');            // the roster says GHOST is blue; the wire says yellow
  assert.ok(flipped.eng.stunned, 'token 4 = 2: an enemy, whatever the roster says');
  const turned = harness({ perk: null }).live();
  turned.eng.feedFrame('$HIR,4,8,19,1,1,0,1,*');             // the roster says VIPER is yellow; the wire says my team
  assert.equal(turned.eng.stunned, null, 'token 4 = my tid: a teammate');
  const blank = harness({ perk: null }).live();
  blank.eng.feedFrame('$HIR,4,8,21,,1,0,1,*');               // no team on the wire: the roster says blue, my team
  assert.equal(blank.eng.stunned, null, 'token 4 missing: the roster decides');
});
