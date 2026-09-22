// A47 (bench 2026-09-17): MC's LIVE board operator menu for ONE player in a bad state. `control{cmd, player_id,
// match_id}` with cmd resync | respawn | relink. Each test pins exactly what the phone writes to the gun and which
// facts it books: a resync keeps the pools and never re-heads, a respawn is a normal revive with no death and no
// kill, a relink calls the app's relink hook, and a command for another match or player does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';
const { PROBE_LIFE } = E;   // F264: the dead-gun probe, asserted byte-exactly

const { Engine } = E;
const CAP = E.SPAWN_PROTECT_MAX_MS ?? 2100;
const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const TAKE = golden.sir_pool[0];
// 2026-09-19: a bundle from an MC before the respawn profiles (protection ends on the first shot or the cap).
const legacyBundle = (({ respawn_profile, ...rest }) => rest)(golden);

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

function live({ legacy = false } = {}) {
  const bundle = legacy ? legacyBundle : golden;
  const writes = []; const facts = []; const logs = []; let clock = 1_000_000; let failWrites = 0, failIf = () => true;
  let deferProbe = false, startProbe = null, settleProbe = null, failProbeSync = false; const batches = [];
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'VIPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: (fr, _why, options) => { writes.push(...fr); batches.push([...fr]); if (failWrites > 0 && failIf(fr)) { failWrites--; return Promise.resolve(false); }
    if (failProbeSync && fr.length === 1 && fr[0] === PROBE_LIFE) { failProbeSync = false; return false; }
    if (deferProbe && fr.length === 1 && fr[0] === PROBE_LIFE) { deferProbe = false; startProbe = options && options.onStart; return new Promise(resolve => { settleProbe = resolve; }); }
    return true; }, emit: f => facts.push(f), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: (l, c) => logs.push([l, c]), delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...bundle, player_id: 'p1' }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, writes, facts, logs,
    adv(ms) { clock += ms; eng.tick(); return h; },
    frame(f) { eng.feedFrame(f); return h; },
    mark() { return writes.length; },
    since(n) { return writes.slice(n); },
    batches,
    deferNextProbe() { deferProbe = true; return h; },
    beginProbe() { const start = startProbe; startProbe = null; if (start) start(); return h; },
    releaseProbe(ok = true) { const resolve = settleProbe; settleProbe = null; if (resolve) resolve(ok); return h; },
    failNextProbeSync() { failProbeSync = true; return h; },
    jump(ms) { clock += ms; return h; },
    failNext(n, pred) { failWrites = n; failIf = pred; return h; },
    op(cmd, extra = {}) { eng.onMcMessage({ kind: 'control', body: { cmd, player_id: 'p1', match_id: 'm1', ...extra } }); return h; },
  };
  h.adv(10); h.adv(CAP);   // live, spawn protection released at the cap
  assert.equal(eng.phase, 'live'); assert.equal(eng.alive, true); assert.equal(eng.spawned, true);
  return h;
}
const heads = w => w.filter(f => /^\$(SPAWN|PSET|CLEAR|START|GSET|WEAP|VOL)/.test(f));

test('A47 resync: waits for a live $HP answer, then writes current state without healing or re-heading', () => {
  const h = live();
  h.frame('$ALCD,20,100,0,150,0,*');   // slot 0 has fired: 20 in the mag, 150 in reserve
  h.frame('$HP,30,10,0,*');            // took a hit: hp 30, armour 10
  const hp = h.eng.hp, armor = h.eng.armor, deaths = h.eng.deaths, nFacts = h.facts.length;
  const n = h.mark();
  h.op('resync');
  assert.deepEqual(h.since(n), [PROBE_LIFE], 'the probe is the only write until the gun answers');
  h.frame('$HP,30,10,0,*');
  const w = h.since(n);
  // F121 rebuild: the resync re-sends the table whatever the node believes (a rebooted gun has none, F11), then t8 = 0.
  assert.deepEqual(w.slice(1), ['$TID,1,*', '$AMMO,0,20,150,1,*', '$AMMO,1,6,24,1,*', '$BMAP,0,0,,,,,*', ...TAKE, golden.spawn_protect_off]);
  assert.deepEqual(heads(w), [], 'no $SPAWN, $PSET or head frame');
  assert.equal(h.eng.hp, hp); assert.equal(h.eng.armor, armor); assert.equal(h.eng.deaths, deaths);
  assert.deepEqual(h.facts.slice(nFacts), [{ type: 'operator_result', cmd: 'resync', ok: true, match_id: 'm1', player_id: 'p1' }], 'no death, kill or respawn fact: only the outcome for MC');
  assert.equal(h.eng.spawned, true, 'still spawned: not a config push');
});

test('F287 resync: a dead $HP answer books the death and never sends the re-arm burst', () => {
  const h = live();
  const n = h.mark(), nf = h.facts.length;
  h.op('resync');
  assert.deepEqual(results(h, nf), [], 'the probe being sent is not yet a successful resync');
  assert.deepEqual(h.since(n), [PROBE_LIFE]);
  h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.alive, false);
  assert.deepEqual(h.since(n).filter(f => /^\$(TID|AMMO|BMAP|SIR)/.test(f)), [], 'a gun that answered dead receives no re-arm burst');
  assert.deepEqual(results(h, nf).map(f => [f.ok, f.why]), [[false, 'the gun answered dead']]);
});

test('F287 resync: an unanswered probe times out without sending the re-arm burst', () => {
  const h = live();
  const n = h.mark(), nf = h.facts.length;
  h.op('resync');
  h.adv(E.QUERY_REPLY_MS + 1);
  assert.deepEqual(h.since(n), [PROBE_LIFE]);
  assert.ok(h.logs.some(([line]) => /operator resync.*no answer/i.test(line)), 'the operator can diagnose the refusal');
  assert.deepEqual(results(h, nf).map(f => [f.ok, f.why]), [[false, 'the gun did not answer']]);
  h.frame('$HP,45,70,0,*');
  assert.deepEqual(h.since(n), [PROBE_LIFE], 'a late answer cannot release the expired burst');
});

test('F287 resync: its probe owns the reply window and a phase change cancels it', () => {
  const h = live();
  const n = h.mark(), nf = h.facts.length;
  h.op('resync');
  h.eng._noFirePulls = E.NO_FIRE_PULLS;
  h.adv(100);
  assert.deepEqual(h.since(n), [PROBE_LIFE], 'cure/poll/read-back probes cannot steal the operator reply');
  h.eng.phase = 'kitted';
  h.adv(1);
  assert.deepEqual(results(h, nf).map(f => [f.ok, f.why]), [[false, 'the game moved on before the gun answered']]);
  h.frame('$HP,45,70,0,*');
  assert.deepEqual(h.since(n), [PROBE_LIFE], 'the old reply cannot write into the new phase');
});

test('(legacy bundle) A47 resync inside spawn protection leaves the pending take to its own trigger (A44)', () => {
  const h = live({ legacy: true });
  h.frame('$HP,0,0,0,*'); h.adv(8010);   // die, auto revive: protection pending again
  assert.equal(h.eng.alive, true); assert.ok(h.eng._armPending, 'setup: protected');
  const n = h.mark();
  h.op('resync');
  h.frame(`$HP,${h.eng.hp},${h.eng.armor},${h.eng.shield},*`);
  assert.ok(h.since(n).some(f => f.startsWith('$TID,')), 'the confirmed resync burst did run');
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

test('(legacy bundle) A47 respawn while DOWN: ends the down state at once with a normal revive, books no death and no kill', () => {
  const h = live({ legacy: true });
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

test('F287: the reply clock starts after the serialized probe write, and an in-write reply is preserved', async () => {
  const h = live().deferNextProbe();
  const n = h.mark(), nf = h.facts.length;
  h.op('resync');
  h.adv(E.QUERY_REPLY_MS + 100);
  assert.deepEqual(results(h, nf), [], 'time queued behind BLE is not answer time');
  h.beginProbe();
  h.frame(`$HP,${h.eng.hp},${h.eng.armor},${h.eng.shield},*`);
  assert.deepEqual(h.since(n), [PROBE_LIFE], 'the answer is held until the probe batch settles');
  h.releaseProbe(); await flush(); await flush();
  assert.ok(h.since(n).some(f => f.startsWith('$TID,')), 'the buffered healthy answer releases one burst');
  assert.deepEqual(results(h, nf).map(f => f.ok), [true]);
});

test('F287: pre-start HP is not proof, expired HP is refused, and a synchronous write failure reports once', async () => {
  const queued = live().deferNextProbe();
  let n = queued.mark(), nf = queued.facts.length;
  queued.op('resync').frame(`$HP,${queued.eng.hp},${queued.eng.armor},${queued.eng.shield},*`);
  queued.beginProbe().releaseProbe();
  await flush();
  assert.deepEqual(queued.since(n), [PROBE_LIFE], 'an older HP before this write starts cannot release it');
  queued.jump(E.QUERY_REPLY_MS + 1).frame(`$HP,${queued.eng.hp},${queued.eng.armor},${queued.eng.shield},*`);
  assert.deepEqual(results(queued, nf).map(f => [f.ok, f.why]), [[false, 'the gun did not answer']]);
  const failed = live().failNextProbeSync();
  nf = failed.facts.length; failed.op('resync');
  assert.deepEqual(results(failed, nf).map(f => [f.ok, f.why]), [[false, 'probe write failed']], 'exactly one terminal result');
  const thrown = live();
  thrown.eng.writer = () => { throw new Error('radio exploded'); };
  nf = thrown.facts.length; thrown.op('resync');
  assert.deepEqual(results(thrown, nf).map(f => [f.ok, f.why]), [[false, 'probe write failed']], 'a synchronous throw is failure too');
});

test('pl3: every operator command tells MC its outcome -- ok when it acted, ok false with the logged reason when refused', () => {
  const h = live();
  let n = h.facts.length;
  h.op('resync');
  assert.deepEqual(results(h, n), [], 'pending until the gun answers');
  h.frame(`$HP,${h.eng.hp},${h.eng.armor},${h.eng.shield},*`);
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
  h.frame('$ALCD,31,100,0,384,98,*');
  assert.equal(h.eng.state().overheatShown, false, 'below the lockout (pl4: the line is 99)');
  h.frame('$ALCD,31,100,0,384,108,*');
  assert.equal(h.eng.state().overheatShown, true);
  h.adv(5900);
  assert.equal(h.eng.state().overheatShown, true, 'the whole ~4.8 s lockout plus its cool-down is covered');
  h.adv(200);
  const st = h.eng.state();
  assert.equal(st.overheatShown, false, 'the word goes once the lockout is certainly over');
  assert.equal(st.overheating, true, 'the no_fire exemption still holds (HEAT_STALE_MS)');
});

// pl4 (brx-weapons bench 2026-09-17): the lockout line is heat >= 99, and OVERHEAT stays while the lockout has
// evidence (a reading at the line, or a press with no shot), ends on a shot or a cool reading, and is capped.
const press = h => h.frame('$BUT,0,1,*').frame('$BUT,0,0,*');
test('pl4: Energy Rifle -- about +3 a shot, firing stops AT 99, locked 10-23 s: OVERHEAT holds while presses get no shot', () => {
  const h = live();
  let mag = 300;
  for (const heat of [90, 93, 96]) h.frame(`$ALCD,${--mag},100,0,600,${heat},*`);
  assert.equal(h.eng.state().overheatShown, false, '96 is still build-up');
  assert.equal(h.eng.state().overheating, false);
  h.frame(`$ALCD,${--mag},100,0,600,99,*`);
  assert.equal(h.eng.state().overheatShown, true, '99 is the lockout: the Energy Rifle never reads above 100');
  assert.equal(h.eng.state().overheating, true, 'and no_fire stays exempt');
  for (let t = 0; t < 23000; t += 2000) { h.adv(2000); press(h); assert.equal(h.eng.state().overheatShown, true, `still locked at ${t + 2000} ms: each press got no shot`); }
  h.frame(`$ALCD,${--mag},100,0,600,40,*`);   // the lockout ends: the first shot after it, cooled
  assert.equal(h.eng.state().overheatShown, false, 'the first shot clears it');
});

test('pl4: Charge Rifle -- stopped at about 103 for 4.8 s: shown through the lockout, cleared by the first shot even with no heat token', () => {
  const h = live();
  h.frame('$ALCD,31,100,0,384,95,*');
  h.frame('$ALCD,30,100,0,384,103,*');
  assert.equal(h.eng.state().overheatShown, true);
  h.adv(4800);
  assert.equal(h.eng.state().overheatShown, true, 'the whole 4.8 s lockout');
  h.frame('$ALCD,29,100,0,384,*');   // a shot with no heat token still proves the gun fires
  assert.equal(h.eng.state().overheatShown, false);
});

test('pl4: OVERHEAT goes 6 s after the last evidence, and never outlasts OVERHEAT_CAP_MS however long presses go unanswered', () => {
  assert.equal(E.OVERHEAT_CAP_MS, 30000);
  const h = live();
  h.frame('$ALCD,31,100,0,384,99,*');
  h.adv(6100);
  assert.equal(h.eng.state().overheatShown, false, 'no reading and no press for 6 s');
  press(h);
  assert.equal(h.eng.state().overheatShown, true, 'a press with no shot shows the lockout is still on');
  for (let t = 0; t < 24000; t += 2000) { h.adv(2000); press(h); }
  assert.equal(h.eng.state().overheatShown, false, 'capped 30 s after the lockout began');
});

const hasSpawn = fr => fr.includes('$SPAWN,,*');
const hasBmap = fr => fr.some(f => f.startsWith('$BMAP,0,0'));

// pl4 (2026-09-17): a spawn or revive write is never sent twice. A repeat refilled a life in play and, on a
// protected bundle, re-sent the protection after it had ended, leaving the gun unhittable (F11). F121 rebuild:
// the protection is `$TMP` t8 = -100, so the lost write's cure is t8 = 0 (the table survived the death).
const OFF = golden.spawn_protect_off;
const tmpRows = w => w.filter(f => f.startsWith('$TMP'));
const sirRows = w => w.filter(f => f.startsWith('$SIR,'));
const isTwin = f => f.split(',')[4] === '28';

test('pl4: a false revive write never re-sends $SPAWN, and the live take is written last', async () => {
  const h = live();
  h.frame('$HP,0,0,0,*');
  const n = h.batches.length, w0 = h.mark();
  h.failNext(1, hasSpawn).op('respawn');
  h.frame('$ALCD,32,100,0,192,0,*').frame('$ALCD,31,100,0,192,0,*');   // first shot arms the take BEFORE the write resolves
  const w1 = h.mark();
  await flush(); await flush();
  assert.deepEqual(tmpRows(h.since(w1)), [OFF], 'protection is ended again once the loss is known');
  assert.equal(h.batches.slice(n).filter(hasSpawn).length, 1, 'the revive went once');
  const t = tmpRows(h.since(w0));
  assert.equal(t[t.length - 1], OFF, 'the last $TMP on the gun is t8 = 0, not the protection');
  assert.ok(sirRows(h.since(w0)).every(f => !isTwin(f)), 'no fn-28 twin reached the live gun');
  assert.ok(h.logs.some(([l, c]) => /\*\*\* write revive.* failed -- not re-sent/.test(l) && c === 'le'));
  assert.equal(h.eng.state().poolStale && h.eng.state().poolStale.why, 'write_lost', 'MC is told');
  h.op('resync');
  h.frame(`$HP,${h.eng.hp},${h.eng.armor},${h.eng.shield},*`);
  assert.equal(h.eng.state().poolStale, null, 'RESYNC GUN clears it');
});

test('(legacy bundle) pl4: a false revive write inside spawn protection keeps the take pending, and never re-sends $SPAWN', async () => {
  const h = live({ legacy: true });
  h.frame('$HP,0,0,0,*');
  const n = h.batches.length;
  h.failNext(5, hasSpawn).op('respawn');
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(h.batches.slice(n).filter(hasSpawn).length, 1, 'no retry');
  assert.ok(h.eng._armPending, 'a live take is still pending');
  const w0 = h.mark(); h.adv(CAP);
  assert.deepEqual(tmpRows(h.since(w0)), [OFF], 'the cap ends protection');
  assert.ok(sirRows(h.since(w0)).every(f => !isTwin(f)), 'and writes no fn-28 twin');
});

test('pl4: a false write for a life that already ended flags nothing', async () => {
  const h = live();
  h.frame('$HP,0,0,0,*');
  h.failNext(1, hasSpawn).op('respawn');
  h.frame('$HP,40,70,0,*').frame('$HP,0,0,0,*');   // down again before the write resolved
  assert.equal(h.eng.alive, false, 'setup: the new life ended');
  await flush(); await flush();
  assert.equal(h.eng._writeLost, null);
});

test('pl4: a stun restore or resync is not repeated once the player fired or took a hit', async () => {
  const h = live();
  let n = h.batches.length;
  h.failNext(1, hasBmap).op('resync');
  h.frame(`$HP,${h.eng.hp},${h.eng.armor},${h.eng.shield},*`);
  h.frame('$ALCD,31,100,0,192,0,*').frame('$ALCD,30,100,0,192,0,*');   // fired before the write resolved
  await flush(); await flush();
  assert.equal(h.batches.slice(n).filter(hasBmap).length, 1, 'a repeat would refill the rounds just fired');
  n = h.batches.length;
  h.failNext(1, hasBmap).op('resync');
  h.frame(`$HP,${h.eng.hp},${h.eng.armor},${h.eng.shield},*`);
  h.frame('$HP,40,70,0,*');   // took a hit
  await flush(); await flush();
  assert.equal(h.batches.slice(n).filter(hasBmap).length, 1, 'nor after a hit');
});

test('pl3: a failed operator resync write is retried, but not once the game moved on (the player died)', async () => {
  const h = live();
  let n = h.batches.length;
  h.failNext(1, hasBmap).op('resync');
  h.frame(`$HP,${h.eng.hp},${h.eng.armor},${h.eng.shield},*`);
  await flush(); await flush();
  assert.equal(h.batches.slice(n).filter(hasBmap).length, 2, 'retried while the life goes on');
  n = h.batches.length;
  h.failNext(1, hasBmap).op('resync');
  h.frame(`$HP,${h.eng.hp},${h.eng.armor},${h.eng.shield},*`);
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

// ---------- maint review 2026-09-17: the refusal STRINGS themselves ----------
// Four of the six (`no bundle`, `a relink reconcile is running`, `a try-out is running`, `the T-0 spawn has
// not run`) appeared in no test at all, so deleting any of them left the suite green. They are what the
// operator reads on the board when a button does nothing, and they are now the `_standDown` table's output,
// so this pins both the strings and the table's ORDER.
const REFUSALS = [
  ['phase', h => { h.eng.phase = 'armed'; }, 'phase is armed'],
  ['spawned', h => { h.eng.spawned = false; }, 'the T-0 spawn has not run'],
  ['bundle', h => { h.eng.frames = null; }, 'no bundle'],
  ['ble', h => { h.eng.bleUp = false; }, 'gun link down (RELINK first)'],
  ['reconciling', h => { h.eng.reconciling = { at: h.eng.now() }; }, 'a relink reconcile is running'],
  ['resync', h => { h.eng.resync = { at: h.eng.now() }; }, 'a restart resync is running'],
  ['tutorial', h => { h.eng.tutorial = { weapon_id: 'assault_rifle' }; }, 'a try-out is running'],
];

for (const [name, set, why] of REFUSALS) {
  for (const cmd of ['resync', 'respawn']) {
    test(`A47/pl3: ${cmd} refused while ${name} says "${why}": to MC, to the log, and with no write`, () => {
      const h = live();
      set(h);
      const n = h.mark(), nFacts = h.facts.length;
      h.op(cmd);
      assert.deepEqual(h.since(n), [], 'a refused operator command must write nothing to the gun');
      assert.deepEqual(h.facts.slice(nFacts),
        [{ type: 'operator_result', cmd, ok: false, why, match_id: 'm1', player_id: 'p1' }]);
      assert.ok(h.logs.some(([l]) => l === `operator ${cmd} ignored — ${why}`),
        `the phone log must carry the reason too: ${JSON.stringify(h.logs.slice(-3))}`);
    });
  }
}

// Polish 2026-09-17: `_operatorAct` used to index the refusal table directly, so a stand-down name with no
// line there threw a TypeError at the operator instead of refusing. The lookup now falls back to the bare
// name. This pins BOTH halves: every name `_operatorAct` asks for has a real sentence, and a name from
// elsewhere in the table still comes back as a string rather than an exception.
test('A47: every stand-down name resolves to something an operator can read, and none of them throws', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/engine.js', import.meta.url)), 'utf8');
  // Find the site by its own contents, not by counting characters back to the method name. `_operatorAct`'s
  // subset is the only one that asks for `bundle` and NOT for `alive`: an operator command is refused on a
  // DEAD player by `_operatorResync`'s own line, with its own message, so `alive` is deliberately absent here.
  // (F264's `_cureTick`/`_pollTick` ask for `bundle` too -- they can write a revive head -- and both name
  // `alive`.) REFUSALS above lists the same seven, so a drift between the two fails here.
  const asked = [...src.matchAll(/_standDown\(\[([^\]]*)\]/gs)]
    .map(m => [...m[1].matchAll(/['"](\w+)['"]/g)].map(x => x[1]))
    .filter(names => names.includes('bundle') && !names.includes('alive'))
    .flat();
  assert.deepEqual(asked, REFUSALS.map(([n]) => n),
    `_operatorAct's subset and this file's REFUSALS table disagree: ${asked.join(', ')}`);
  for (const name of asked) {
    const h = live();
    const why = E.operatorRefusalFor(name, h.eng);
    assert.equal(typeof why, 'string', `${name} must resolve to a string`);
    assert.ok(why.length > 3 && why !== name, `${name} has no written refusal: the operator would read "${why}"`);
  }
  // CONTROL: a name the operator subset does not carry must still answer, not throw.
  const h = live();
  for (const name of E.STAND_DOWN_NAMES) {
    assert.equal(typeof E.operatorRefusalFor(name, h.eng), 'string', `${name} must not throw`);
  }
  assert.equal(E.operatorRefusalFor('switching', h.eng), 'switching', 'a name with no line falls back to itself');
});

test('A47/pl3: the refusals keep their order: the first thing wrong is the one the operator is told about', () => {
  // Every condition true at once, then cleared one at a time: the reasons must come out in table order.
  // CONTROL for the table refactor: reorder `STAND_DOWN` and this walks out in the new order and fails.
  const h = live();
  for (const [, set] of REFUSALS) set(h);
  const seen = [];
  for (const [, , why] of REFUSALS) {
    const nFacts = h.facts.length;
    h.op('resync');
    seen.push(h.facts[nFacts].why);
    const i = REFUSALS.findIndex(([, , w]) => w === seen[seen.length - 1]);
    [() => { h.eng.phase = 'live'; }, () => { h.eng.spawned = true; }, () => { h.eng.frames = {}; },
      () => { h.eng.bleUp = true; }, () => { h.eng.reconciling = null; }, () => { h.eng.resync = null; },
      () => { h.eng.tutorial = null; }][i]();
  }
  assert.deepEqual(seen, REFUSALS.map(([, , why]) => why));
});

test('A47: RESYNC GUN keeps its own two refusals, each with its own cure', () => {
  // These are NOT in `_operatorAct`'s subset: a down player wants FORCE RESPAWN, a stunned one wants to wait.
  const h = live();
  h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.alive, false, 'setup: down');
  let n = h.facts.length;
  h.op('resync');
  assert.equal(h.facts[n].why, 'the player is down');
  h.adv(8010);
  assert.equal(h.eng.alive, true, 'setup: revived');
  h.eng.config.stun = { duration_s: 10 };
  h.eng._stun();
  n = h.facts.length;
  const w = h.mark();
  h.op('resync');
  assert.equal(h.facts[n].why, 'stunned');
  assert.deepEqual(h.since(w), [], 'and still no write');
});
