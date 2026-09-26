// F416 (P0, bench part 1, 2026-09-26): a spawn write that failed at go-live was logged "not re-sent", the gun stayed
// unspawned, and the node booked a death on its 0 pool two seconds later. A blind second `$SPAWN` is unsafe (a refill,
// re-applied protection: pl4, F11), so the node ASKS the gun first: a 0 pool with no `$HIR` since the write means it
// never spawned, and only then is the burst re-sent. These drive the real Engine on a mocked clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';

const { Engine, PROBE_LIFE } = E;
const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

/** A live TDM that reaches T-0 with `fail(frames)` deciding which writes resolve false. `gun` is the fake gun's own
 *  state: `spawned` flips on a `$SPAWN` write that did not fail, and a probe is answered from it. */
function harness({ fail = () => false, profile = true } = {}) {
  const writes = [], logs = []; let clock = 1_000_000; const timers = [];
  const gun = { spawned: false, answer: true };
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 900,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70, max_shield: 0 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' }];
  const replies = [];
  const writer = fr => {
    writes.push(...fr.map(f => ({ f, t: clock })));
    if (fail(fr)) return false;
    if (fr.some(f => f.startsWith('$SPAWN'))) { gun.spawned = true; replies.push('$LCD,45,70,0,0,32,192,*'); }
    if (fr.includes(PROBE_LIFE) && gun.answer) replies.push(gun.spawned ? '$HP,45,70,0,*' : '$HP,0,0,0,*');
    return undefined;
  };
  const eng = new Engine({ writer, emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(),
    log: m => logs.push(String(m)), delay: (ms, fn) => timers.push({ at: clock + ms, fn }), rng: () => 0 });
  const run = () => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > clock) return; timers.shift().fn(); } };
  const flush = () => { while (replies.length) eng.feedFrame(replies.shift()); };
  const h = {
    eng, gun, writes, logs, now: () => clock,
    // async: `_writeLife` settles in a promise callback, so each step lets the microtasks run
    async adv(ms, step = 50) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); run(); flush(); eng.tick(); run(); await new Promise(r => setImmediate(r)); flush(); } return h; },
    spawns() { return writes.filter(w => w.f.startsWith('$SPAWN')).length; },
    probes() { return writes.filter(w => w.f === PROBE_LIFE).length; },
    live() {
      eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
      eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster } });
      const frames = { ...golden, player_id: 'p1' };
      if (!profile) delete frames.respawn_profile;   // an older bundle: the spawn itself carries the protection
      eng.onMcMessage({ kind: 'config', body: { config, frames, roster } });
      eng.feedFrame('$LCD,0,0,0,0,0,0,*');
      eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock + 4000, config_id: golden.config_id, seq: 1, countdown_s: 4 } });
      return h;
    },
  };
  return h;
}
const spawnOnce = () => { let n = 0; return fr => fr.some(f => f.startsWith('$SPAWN')) && n++ === 0; };

test('F416: a spawn write lost at go-live is checked, re-sent once, and the player is NOT booked dead', async () => {
  const h = harness({ fail: spawnOnce() }).live();
  await h.adv(4000 + 3000);
  assert.ok(h.probes() >= 1, 'the node asked the gun after the failed write');
  assert.equal(h.spawns(), 2, 'the burst went again because the gun read an unspawned 0 pool');
  const s = h.eng.state();
  assert.equal(s.alive, true, 'no death for a gun that was never spawned');
  assert.equal(s.hp, 45, 'the re-sent spawn armed the pools');
  assert.ok(!h.logs.some(l => /down —/.test(l)), 'no DOWN in the log');
});

test('F416: a spawn write that failed but DID land is never sent twice (pl4/F11: no refill, no second protection)', async () => {
  let n = 0;
  // the gun takes the spawn, but the write still resolves false (a lost trailing chunk)
  const h = harness({ fail: fr => fr.some(f => f.startsWith('$SPAWN')) && n++ === 0 && (h.gun.spawned = true, h.writes.length >= 0) }).live();
  await h.adv(4000 + 3000);
  assert.ok(h.probes() >= 1, 'the node asked');
  assert.equal(h.spawns(), 1, 'the gun read its pools, so no second spawn');
  assert.equal(h.eng.state().alive, true);
});

test('F416: a hit since the lost write means the 0 pool is a real death, not an unspawned gun', async () => {
  const h = harness({ fail: spawnOnce() }).live();
  h.gun.answer = false;                          // the gun does not answer the probe before the hit lands
  await await h.adv(4000 + 100);
  h.eng.feedFrame('$HIR,4,0,19,2,45,0,3,*'); h.eng.feedFrame('$HP,0,0,0,*');
  await h.adv(3000);
  assert.equal(h.spawns(), 1, 'no re-send over a hit');
  assert.equal(h.eng.state().alive, false, 'the hit is a death');
});

test('F416: two failed re-sends fall back to today\'s death and auto-respawn, never a zombie at 0', async () => {
  let n = 0;   // the first write and both re-sends fail; the revive after the booked death is the cure
  const h = harness({ fail: fr => fr.some(f => f.startsWith('$SPAWN')) && n++ < 3 }).live();
  await h.adv(4000 + 5000);
  assert.equal(h.spawns() >= 3, true, `the first write and two re-sends: ${h.spawns()}`);
  assert.equal(h.eng.state().alive, false, 'after two failed re-sends the 0 pool is booked, so auto-respawn can cure it');
});

test('F416: a probe write that fails too shows a HUD warning that names the host\'s cure', async () => {
  const h = harness({ fail: fr => fr.some(f => f.startsWith('$SPAWN')) || fr.includes(PROBE_LIFE) }).live();
  await h.adv(4000 + 2500);
  const s = h.eng.state();
  assert.equal(s.alive, true, 'no death booked on no evidence');
  assert.ok(s.spawnLost, `state().spawnLost says the gun may not be spawned: ${JSON.stringify(s.spawnLost)}`);
  assert.equal(s.poolStale && s.poolStale.why, 'write_lost', 'MC still reads write_lost and offers RESYNC GUN');
});

test('F416 part 2: the radio is quiet from T-3 s until the spawn write settles, so the station scan stays shut', async () => {
  const h = harness().live();
  await h.adv(500);
  assert.equal(h.eng.state().radioQuiet, false, 'not before T-3 s');
  await h.adv(1000);
  assert.equal(h.eng.state().radioQuiet, true, 'from T-3 s');
  await h.adv(2500 + E.RADIO_QUIET_AFTER_MS + 500);   // the write's promise chain settles a few steps after T-0
  assert.equal(h.eng.state().radioQuiet, false, 'reopened once the spawn has settled');
});

test('F416: a gun that takes the probe but never answers is not a silent state: the check goes lost and the scan reopens', async () => {
  const h = harness({ fail: spawnOnce() }).live();
  h.gun.answer = false;
  await h.adv(4000 + 6000);
  const s = h.eng.state();
  assert.equal(h.logs.filter(l => /write F416 spawn check/.test(l)).length, E.SPAWN_ASKS, 'asked twice (the F272 silence probe asks on its own too)');
  assert.equal(s.spawnLost, true, 'GUN MAY NOT BE SPAWNED is up');
  assert.equal(s.radioQuiet, false, 'a lost check does not hold the scan shut');
});

test('F416 x F11: after a re-sent burst lands, spawn protection is ended again (the last $TMP on the gun is OFF)', async () => {
  const h = harness({ fail: spawnOnce(), profile: false }).live();
  await h.adv(4000 + 3000);
  assert.equal(h.spawns(), 2, 'setup: the burst was re-sent');
  const OFF = golden.spawn_protect_off;
  const resentAt = h.writes.filter(w => w.f.startsWith('$SPAWN'))[1].t;
  const tmp = h.writes.filter(w => w.t >= resentAt && w.f.startsWith('$TMP')).map(w => w.f);
  assert.ok(OFF && tmp.some(f => f !== OFF), `setup: the re-sent burst carried the protection: ${JSON.stringify(tmp)}`);
  assert.equal(tmp[tmp.length - 1], OFF, `the last $TMP after the re-send is t8 = 0: ${JSON.stringify(tmp)}`);
});

test('F416 x F11: a re-send AFTER the protection cap has fired still ends the protection it re-applied', async () => {
  const h = harness({ fail: spawnOnce(), profile: false }).live();
  h.gun.answer = false;
  await h.adv(4000 + 2000); h.gun.answer = true;     // the gun answers only after the cap (SPAWN_PROTECT_MAX_MS) has fired
  await h.adv(12000);
  const sp = h.writes.filter(w => w.f.startsWith('$SPAWN'));
  assert.equal(sp.length, 2, 'setup: re-sent once the gun answered');
  assert.ok(sp[1].t - sp[0].t > E.SPAWN_PROTECT_MAX_MS, 'setup: the re-send came after the cap');
  const tmp = h.writes.filter(w => w.t >= sp[1].t && w.f.startsWith('$TMP')).map(w => w.f);
  assert.equal(tmp[tmp.length - 1], golden.spawn_protect_off, `the last $TMP after the late re-send is OFF: ${JSON.stringify(tmp)}`);
  assert.equal(h.eng.state().alive, true);
});

test('F416 r1: past SPAWN_CHECK_MAX_MS a 0 pool books as today (never an undying player); a silent gun keeps the warning up', async () => {
  const h = harness({ fail: spawnOnce() }).live();
  h.gun.answer = false;
  await h.adv(4000 + E.SPAWN_CHECK_MAX_MS + 500);
  assert.equal(h.eng.state().spawnLost, true, 'the gun never answered: the warning stays, never a silent state');
  assert.equal(h.eng.state().radioQuiet, false, 'but an old check does not hold the scan shut');
  h.eng.feedFrame('$HP,0,0,0,*'); await h.adv(300);
  assert.equal(h.spawns(), 1, 'no re-send outside the window');
  assert.equal(h.eng.state().alive, false, 'the late 0 pool is booked, so the auto-respawn is the cure');
});

test('F416 r2: two overlapping quiet writes keep the radio quiet until the LAST one settles', () => {
  const h = harness();
  let settleA, settleB;
  h.eng.writer = fr => new Promise(r => { if (!settleA) settleA = r; else if (!settleB) settleB = r; else r(true); });
  h.eng._quietWrite(['$A,*'], 'a'); h.eng._quietWrite(['$B,*'], 'b');
  return (async () => {
    settleA(true); await new Promise(r => setImmediate(r));
    await h.adv(E.RADIO_QUIET_AFTER_MS + 300);
    assert.equal(h.eng.radioQuiet(), true, 'past the first write\'s window, the second write is still on the radio');
    settleB(true); await new Promise(r => setImmediate(r));
    assert.equal(h.eng.radioQuiet(), true, 'and the window runs its RADIO_QUIET_AFTER_MS from the last settle');
  })();
});
