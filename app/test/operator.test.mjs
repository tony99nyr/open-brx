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
  const writes = []; const facts = []; const logs = []; let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'VIPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: fr => { writes.push(...fr); return true; }, emit: f => facts.push(f), report: () => {}, now: () => clock,
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
  assert.equal(h.facts.length, nFacts, 'no death, kill or respawn fact');
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
  assert.deepEqual(facts.map(f => f.type), ['respawn']);
  assert.equal(facts[0].operator, true);
});

test('A47 respawn while ALIVE: full pools, a respawn fact flagged operator, no death', () => {
  const h = live();
  h.frame('$HP,12,0,0,*');
  const nFacts = h.facts.length;
  h.op('respawn');
  assert.equal(h.eng.hp, h.eng.maxHp); assert.equal(h.eng.deaths, 0);
  assert.deepEqual(h.facts.slice(nFacts).map(f => [f.type, f.operator]), [['respawn', true]]);
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
