// A47 (bench 2026-09-17): MC's LIVE board operator menu for ONE player in a bad state. `control{cmd, player_id,
// match_id}` with cmd resync | respawn | relink. Each test pins exactly what the phone writes to the gun and which
// facts it books: a resync keeps the pools and never re-heads, a respawn is a normal revive with no death and no
// kill, a relink calls the app's relink hook, and a command for another match or player does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';

const { Engine } = E;
const CAP = E.SPAWN_PROTECT_MAX_MS ?? 2100;
const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const TAKE = golden.sir_pool[0];

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

function live() {
  const writes = []; const facts = []; const logs = []; let clock = 1_000_000; let failWrites = 0, failIf = () => true; const batches = [];
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'VIPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: fr => { writes.push(...fr); batches.push([...fr]); if (failWrites > 0 && failIf(fr)) { failWrites--; return Promise.resolve(false); } return true; }, emit: f => facts.push(f), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: (l, c) => logs.push([l, c]), delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1' }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, writes, facts, logs,
    adv(ms) { clock += ms; eng.tick(); return h; },
    frame(f) { eng.feedFrame(f); return h; },
    mark() { return writes.length; },
    since(n) { return writes.slice(n); },
    batches,
    failNext(n, pred) { failWrites = n; failIf = pred; return h; },
    op(cmd, extra = {}) { eng.onMcMessage({ kind: 'control', body: { cmd, player_id: 'p1', match_id: 'm1', ...extra } }); return h; },
  };
  h.adv(10); h.adv(CAP);   // live, spawn protection released at the cap
  assert.equal(eng.phase, 'live'); assert.equal(eng.alive, true); assert.equal(eng.spawned, true);
  return h;
}
const heads = w => w.filter(f => /^\$(SPAWN|PSET|CLEAR|START|GSET|WEAP|VOL)/.test(f));

test('A47 resync: $TID, the CURRENT ammo, $BMAP,0,0, then the live $SIR take -- and nothing that heals or re-heads', () => {
  const h = live();
  h.frame('$ALCD,20,100,0,150,0,*');   // slot 0 has fired: 20 in the mag, 150 in reserve
  h.frame('$HP,30,10,0,*');            // took a hit: hp 30, armour 10
  const hp = h.eng.hp, armor = h.eng.armor, deaths = h.eng.deaths, nFacts = h.facts.length;
  const n = h.mark();
  h.op('resync');
  const w = h.since(n);
  assert.deepEqual(w, ['$TID,1,*', '$AMMO,0,20,150,1,*', '$AMMO,1,6,24,1,*', '$BMAP,0,0,,,,,*', ...TAKE]);
  assert.deepEqual(heads(w), [], 'no $SPAWN, $PSET or head frame');
  assert.equal(h.eng.hp, hp); assert.equal(h.eng.armor, armor); assert.equal(h.eng.deaths, deaths);
  assert.deepEqual(h.facts.slice(nFacts), [{ type: 'operator_result', cmd: 'resync', ok: true, match_id: 'm1', player_id: 'p1' }], 'no death, kill or respawn fact: only the outcome for MC');
  assert.equal(h.eng.spawned, true, 'still spawned: not a config push');
});

test('A47 resync inside spawn protection leaves the pending take to its own trigger (A44)', () => {
  const h = live();
  h.frame('$HP,0,0,0,*'); h.adv(8010);   // die, auto revive: protection pending again
  assert.equal(h.eng.alive, true); assert.ok(h.eng._armPending, 'setup: protected');
  const n = h.mark();
  h.op('resync');
  assert.equal(h.since(n).filter(f => f.startsWith('$SIR,')).length, 0, 'no table while protected');
  assert.ok(h.eng._armPending, 'still pending');
});

test('A47 resync of a down player writes nothing (FORCE RESPAWN is the cure)', () => {
  const h = live();
  h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.alive, false);
  const n = h.mark();
  h.op('resync');
  assert.deepEqual(h.since(n), []);
});

test('A47 respawn while DOWN: ends the down state at once with a normal revive, books no death and no kill', () => {
  const h = live();
  h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.alive, false); const deaths = h.eng.deaths;
  const nFacts = h.facts.length; const n = h.mark();
  h.op('respawn');
  const w = h.since(n);
  assert.equal(h.eng.alive, true); assert.equal(h.eng.deadAt, 0);
  assert.equal(h.eng.hp, h.eng.maxHp); assert.equal(h.eng.armor, h.eng.maxArmor);
  assert.equal(h.eng.deaths, deaths, 'no extra death');
  for (const f of golden.revive) assert.ok(w.includes(f), `revive frame ${f}`);
  assert.ok(w.includes('$BMAP,0,0,,,,,*'), 'trigger mapped');
  assert.ok(h.eng._armPending, 'spawn protection holds (A44)');
  assert.equal(w.filter(f => f.startsWith('$SIR,') && f.split(',')[4] !== '28').length, 0, 'hits silent until the gun can fire');
  const facts = h.facts.slice(nFacts);
  assert.deepEqual(facts.map(f => f.type), ['respawn', 'operator_result']);
  assert.equal(facts[0].operator, true);
});

test('A47 respawn while ALIVE: full pools, a respawn fact flagged operator, no death', () => {
  const h = live();
  h.frame('$HP,12,0,0,*');
  const nFacts = h.facts.length;
  h.op('respawn');
  assert.equal(h.eng.hp, h.eng.maxHp); assert.equal(h.eng.deaths, 0);
  assert.deepEqual(h.facts.slice(nFacts).map(f => [f.type, f.operator]), [['respawn', true], ['operator_result', undefined]]);
});

test('A47 relink calls the app relink hook and writes nothing itself', () => {
  const h = live();
  let calls = 0; h.eng.onRelink = () => { calls++; return Promise.resolve(); };
  const n = h.mark();
  h.op('relink');
  assert.equal(calls, 1); assert.deepEqual(h.since(n), []);
});

test('A47 a command for another match, another player or no match is ignored', () => {
  const h = live();
  let calls = 0; h.eng.onRelink = () => { calls++; };
  h.frame('$HP,0,0,0,*');
  const n = h.mark(); const nFacts = h.facts.length;
  for (const extra of [{ match_id: 'old' }, { match_id: undefined }, { player_id: 'p2' }]) {
    h.op('respawn', extra); h.op('resync', extra); h.op('relink', extra);
  }
  assert.deepEqual(h.since(n), []); assert.equal(h.facts.length, nFacts); assert.equal(calls, 0);
  assert.equal(h.eng.alive, false, 'still down');
  assert.ok(h.logs.some(([l]) => /not this match/.test(l)), 'the phone logs why');
});

test('A47 respawn and resync are refused while the gun link is down, and logged', () => {
  const h = live();
  h.frame('$HP,0,0,0,*');
  h.eng.onBleDropped();
  const n = h.mark();
  h.op('respawn'); h.op('resync');
  assert.deepEqual(h.since(n), []); assert.equal(h.eng.alive, false);
  assert.ok(h.logs.some(([l]) => /operator respawn ignored — gun link down/.test(l)));
});

// ── pl3 (2026-09-17) ─────────────────────────────────────────────────────────────────────────────
const flush = () => new Promise(r => setImmediate(r));
const results = (h, n) => h.facts.slice(n).filter(f => f.type === 'operator_result');

test('pl3: every operator command tells MC its outcome -- ok when it acted, ok false with the logged reason when refused', () => {
  const h = live();
  let n = h.facts.length;
  h.op('resync');
  assert.deepEqual(results(h, n), [{ type: 'operator_result', cmd: 'resync', ok: true, match_id: 'm1', player_id: 'p1' }]);
  h.frame('$HP,0,0,0,*');
  n = h.facts.length; h.op('resync');
  assert.deepEqual(results(h, n), [{ type: 'operator_result', cmd: 'resync', ok: false, why: 'the player is down', match_id: 'm1', player_id: 'p1' }]);
  n = h.facts.length; h.op('respawn');
  assert.deepEqual(results(h, n).map(f => [f.cmd, f.ok, f.why]), [['respawn', true, undefined]]);
  n = h.facts.length; h.eng.onRelink = () => Promise.resolve(); h.op('relink');
  assert.deepEqual(results(h, n).map(f => [f.cmd, f.ok, f.why]), [['relink', true, undefined]], 'relink: ok = the relink started');
  n = h.facts.length; h.eng.onRelink = null; h.op('relink');
  assert.deepEqual(results(h, n).map(f => [f.cmd, f.ok, f.why]), [['relink', false, 'this build has no relink hook']]);
  h.eng.onBleDropped();
  n = h.facts.length; h.op('respawn');
  assert.deepEqual(results(h, n).map(f => [f.cmd, f.ok, f.why]), [['respawn', false, 'gun link down (RELINK first)']]);
  assert.ok(h.logs.some(([l]) => l === 'operator respawn ignored — gun link down (RELINK first)'), 'the same reason the log shows');
});

test('pl3: an operator respawn or resync never runs while the restart evidence protocol (resync) holds the gun', () => {
  const h = live();
  h.eng._beginResync('test');
  assert.ok(h.eng.resync, 'setup: the evidence protocol is running');
  const n = h.mark(), nf = h.facts.length, hp = h.eng.hp;
  h.op('respawn'); h.op('resync');
  assert.deepEqual(h.since(n), [], 'nothing written to the gun');
  assert.equal(h.eng.hp, hp);
  assert.deepEqual(results(h, nf).map(f => [f.cmd, f.ok, f.why]), [['respawn', false, 'a restart resync is running'], ['resync', false, 'a restart resync is running']]);
});

test('pl3: a revive clears the last life\'s swap and heat -- no stale OVERHEAT and no phantom swap after an operator respawn', () => {
  const h = live();
  h.eng.player = { ...h.eng.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'shotgun' }] } };
  h.frame('$ALCD,31,100,0,384,108,*');   // locked out
  h.frame('$BUT,1,1,*');                 // an ALT swap in flight
  assert.equal(h.eng.state().overheating, true, 'setup: OVERHEAT');
  assert.ok(h.eng.switching, 'setup: a swap in flight');
  h.op('respawn');
  const st = h.eng.state();
  assert.equal(st.overheating, false, 'no OVERHEAT carried into the new life');
  assert.equal(st.overheatShown, false);
  assert.equal(st.heat, null); assert.equal(st.heatEverSeen, false);
  assert.equal(h.eng.switching, null, 'no swap carried into the new life');
  h.adv(6000);
  assert.equal(h.eng.activeSlot, 0, 'the stale swap never lands a phantom slot change');
});

test('pl3: overheatShown holds for OVERHEAT_SHOWN_MS after a lockout reading; overheating keeps the 25 s no_fire window', () => {
  assert.equal(E.OVERHEAT_SHOWN_MS, 6000);
  const h = live();
  h.frame('$ALCD,31,100,0,384,99,*');
  assert.equal(h.eng.state().overheatShown, false, 'below the lockout');
  h.frame('$ALCD,31,100,0,384,108,*');
  assert.equal(h.eng.state().overheatShown, true);
  h.adv(5900);
  assert.equal(h.eng.state().overheatShown, true, 'the whole ~4.8 s lockout plus its cool-down is covered');
  h.adv(200);
  const st = h.eng.state();
  assert.equal(st.overheatShown, false, 'the word goes once the lockout is certainly over');
  assert.equal(st.overheating, true, 'the no_fire exemption still holds (HEAT_STALE_MS)');
});

const hasSpawn = fr => fr.includes('$SPAWN,,*');
const hasBmap = fr => fr.some(f => f.startsWith('$BMAP,0,0'));

test('pl3: a spawn-critical write that resolves false is retried once, with the same frames', async () => {
  const h = live();
  h.frame('$HP,0,0,0,*');
  const n = h.batches.length;
  h.failNext(1, hasSpawn).op('respawn');
  await flush(); await flush();
  const revives = h.batches.slice(n).filter(hasSpawn);
  assert.equal(revives.length, 2, 'the revive write went twice');
  assert.deepEqual(revives[1], revives[0], 'the same frames, whole and in order');
  assert.ok(h.logs.some(([l]) => /write revive.* failed -- retrying once/.test(l)));
});

test('pl3: a second failure is logged loudly and not retried again', async () => {
  const h = live();
  h.frame('$HP,0,0,0,*');
  const n = h.batches.length;
  h.failNext(5, hasSpawn).op('respawn');
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(h.batches.slice(n).filter(hasSpawn).length, 2, 'exactly one retry');
  assert.ok(h.logs.some(([l]) => /\*\*\* write revive.* failed twice/.test(l)));
});

test('pl3: a failed operator resync write is retried, but not once the game moved on (the player died)', async () => {
  const h = live();
  let n = h.batches.length;
  h.failNext(1, hasBmap).op('resync');
  await flush(); await flush();
  assert.equal(h.batches.slice(n).filter(hasBmap).length, 2, 'retried while the life goes on');
  n = h.batches.length;
  h.failNext(1, hasBmap).op('resync');
  h.frame('$HP,0,0,0,*');   // died before the write resolved
  await flush(); await flush();
  assert.equal(h.batches.slice(n).filter(hasBmap).length, 1, 'no retry into a dead life');
  assert.ok(h.logs.some(([l]) => /write operator resync failed -- the game moved on, not retried/.test(l)));
});

test('pl3: a failed stun restore is retried once; a stun restore the next stun overtook is not', async () => {
  const h = live();
  h.eng.config.stun = { duration_s: 10 };
  const isRestore = fr => fr.length > 0 && fr.every(f => /^\$AMMO,\d,[1-9]/.test(f));
  h.eng._stun();
  let n = h.batches.length;
  h.failNext(1, isRestore); h.adv(10_010);
  assert.equal(h.eng.stunned, null, 'setup: the stun expired');
  await flush(); await flush();
  const restores = h.batches.slice(n).filter(isRestore);
  assert.equal(restores.length, 2, 'the restore went again');
  assert.deepEqual(restores[1], restores[0]);
  h.eng._stun();
  n = h.batches.length;
  h.failNext(1, isRestore); h.adv(10_010);
  h.eng._stun();   // a second EMP before the failed restore resolved: the gun is meant to stay disarmed
  await flush(); await flush();
  assert.equal(h.batches.slice(n).filter(isRestore).length, 1, 'no restore that re-arms a stunned gun');
});
