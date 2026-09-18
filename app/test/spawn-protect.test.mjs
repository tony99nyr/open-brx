// F209 (field 2026-09-13, bench 2026-09-16: "you can actually get hit during respawn before you can shoot").
// A23 put the REAL $SIR table ahead of $SPAWN, so hit reception came back in the same write as the respawn
// while the weapon ($AMMO, then $BMAP,0,0) came after it. Now the spawn and revive writes carry the fn-28
// twin, and the node writes one `sir_pool` take (the real table) on the gun's first shot or at
// SPAWN_PROTECT_MAX_MS, whichever is first. Every cancel case is here: death, match end, a head re-write,
// a link drop, an infection flip. Mirrors: mcp/tests/test_stage_spawn_protect.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';

const { Engine } = E;
const CAP = E.SPAWN_PROTECT_MAX_MS ?? 2100;   // `??` so this file still loads (and fails) against a pre-F209 engine
const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const TAKE = golden.sir_pool[0];

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
const fnOf = f => f.split(',')[4];
const realRows = w => w.filter(f => f.startsWith('$SIR,') && fnOf(f) !== '28');
const sirRows = w => w.filter(f => f.startsWith('$SIR,'));

function harness({ mode = 'tdm', bundle = golden, teamFlip } = {}) {
  const writes = []; const facts = []; let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: bundle.config_id, mode, environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: f => facts.push(f), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  const frames = { ...bundle, player_id: 'p1', ...(teamFlip ? { team_flip: teamFlip } : {}) };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: bundle.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, writes, facts,
    adv(ms) { clock += ms; eng.tick(); return h; },
    frame(f) { eng.feedFrame(f); return h; },
    mark() { return writes.length; },
    since(n) { return writes.slice(n); },
    die() { eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*'); return h; },
  };
  return h;
}
/** Live at T-0, with the spawn's own protection already released at the cap. */
function liveArmed(opts) { const h = harness(opts); h.adv(10); h.adv(CAP); return h; }
/** Down, then revived by the 8 s auto respawn. Returns the write index just before the revive. */
function revived(h) { h.die(); h.adv(7990); const n = h.mark(); h.adv(10); assert.equal(h.eng.alive, true, 'setup: revived'); return n; }

test('F209 fixture: the golden bundle is spawn-protected, with the real table as the one sir_pool take', () => {
  for (const k of ['spawn', 'revive']) {
    assert.ok(sirRows(golden[k]).length, `${k} carries the twin`);
    assert.deepEqual(realRows(golden[k]), [], `${k} arms nothing itself`);
  }
  assert.equal(golden.sir_pool.length, 1); assert.ok(realRows(TAKE).length, 'the take is the real table');
});

test('F209 ordering: the spawn write holds hits silent and maps the trigger after $SPAWN; no real row until the cap', () => {
  const h = harness();
  h.adv(10);
  assert.equal(h.eng.phase, 'live');
  const spawnAt = h.writes.indexOf('$SPAWN,,*');
  assert.ok(spawnAt > 0 && h.writes.indexOf('$BMAP,0,0,,,,,*') > spawnAt, 'the trigger is mapped after $SPAWN');
  assert.deepEqual(realRows(h.writes), [], 'no row that moves a pool reached the gun with the spawn');
  const n = h.mark();
  h.adv(CAP - 20);
  assert.deepEqual(realRows(h.since(n)), [], 'still protected just before the cap');
  h.adv(20);
  assert.deepEqual(h.since(n).filter(f => f.startsWith('$SIR,')), TAKE, 'the cap writes the real table, once');
  const m = h.mark(); h.adv(5000);
  assert.deepEqual(sirRows(h.since(m)), [], 'and never again this life');
});

test('F209 revive: the revive write is protected too, and the gun\'s first shot arms at once (before the cap)', () => {
  const h = liveArmed();
  const n = revived(h);
  const rev = h.since(n);
  assert.ok(rev.includes('$SPAWN,,*') && sirRows(rev).length, 'the revive write carries the twin');
  assert.deepEqual(realRows(rev), [], 'and no live row: the last life\'s table is overwritten silent');
  h.frame('$ALCD,32,100,0,192,0,*');   // the $AMMO echo: proves nothing about the trigger
  assert.deepEqual(realRows(h.since(n)), [], 'an echo at a full magazine does not arm');
  h.adv(300);
  h.frame('$BUT,0,1,*'); h.frame('$ALCD,31,100,0,192,0,*');   // a round left the magazine
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'the first shot arms hit reception');
  const m = h.mark(); h.adv(CAP);
  assert.deepEqual(sirRows(h.since(m)), [], 'the cap does not write a second copy');
});

test('F209 cancel: a death inside the window never arms the dead gun; the next revive protects and arms again', () => {
  const h = liveArmed();
  revived(h);
  h.adv(500); const n = h.mark();
  h.die();
  assert.equal(h.eng._armPending, null, 'the death drops the pending arm');
  h.adv(CAP);
  assert.deepEqual(realRows(h.since(n)), [], 'no real table written to a dead gun');
  h.adv(8000 - CAP);
  assert.equal(h.eng.alive, true, 'revived again');
  h.adv(CAP);
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'the new life arms once, at its own cap');
});

test('F209 cancel: the match ending inside the window never arms an ended gun', () => {
  const h = liveArmed();
  revived(h);
  const n = h.mark();
  h.eng._endLocal('test');
  assert.equal(h.eng._armPending, null, 'the end drops the pending arm');
  h.adv(CAP * 2);
  assert.deepEqual(realRows(h.since(n)), [], 'nothing armed after the end');
});

test('F209 cancel: a head re-write inside the window drops the pending arm (the revive that follows owns it)', () => {
  const h = liveArmed();
  revived(h);
  const n = h.mark();
  h.eng._writeHead('test head');
  h.adv(CAP);
  assert.deepEqual(realRows(h.since(n)), [], 'a head is fn 28 throughout and starts no arm');
});

test('F209 link drop: no write while down; the relink reconcile always ends with the real table (F11)', () => {
  const h = liveArmed();
  revived(h);
  h.eng.onBleDropped();
  const n = h.mark();
  h.adv(CAP * 2);
  assert.deepEqual(realRows(h.since(n)), [], 'nothing written to a link that is down');
  h.eng.onBleConnected();
  assert.ok(h.eng.reconciling, 'relink reconciles');
  h.adv(1000);
  assert.deepEqual(realRows(h.since(n)), [], 'the cap does not fire through the reconcile');
  h.adv(2000);
  assert.equal(h.eng.reconciling, null, 'reconcile over');
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'hit reception armed exactly once at the reconcile end');
  // an app restart loses `_armPending`: the reconcile still arms
  h.eng._armPending = null; h.eng.onBleDropped(); h.eng.onBleConnected();
  const m = h.mark(); h.adv(3000);
  assert.deepEqual(realRows(h.since(m)), realRows(TAKE), 'a rejoin with no pending arm still re-sends the real table');
});

test('F209 infection flip: the flip write respawns the gun protected, then arms it on the cap', () => {
  const flip = { '2': ['$TID,2,*', ...golden.revive] };
  const h = liveArmed({ mode: 'infection', teamFlip: flip });
  const n = h.mark();
  h.die();
  assert.equal(h.eng.teamTid, 2, 'flipped');
  assert.deepEqual(realRows(h.since(n)), [], 'the flip write arms nothing');
  h.adv(CAP);
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'the flipped gun is armed at the cap');
});

test('F209 class sounds: exactly one carrier -- the revive write has no take, the release writes one', () => {
  const takes = [TAKE.map(f => f.replace(/^(\$SIR,0,0,)[^,]*/, '$1H01')), TAKE.map(f => f.replace(/^(\$SIR,0,0,)[^,]*/, '$1H02'))];
  const h = liveArmed({ bundle: { ...golden, sir_pool: takes } });
  const n = revived(h);
  assert.deepEqual(realRows(h.since(n)), [], 'no take inside the revive write');
  h.adv(CAP);
  const rows = realRows(h.since(n));
  assert.equal(rows.length, TAKE.length, 'one whole take, not two');
  assert.ok(takes.some(t => JSON.stringify(realRows(t)) === JSON.stringify(rows)), 'and it is a pool take');
});

test('F209 control: an older bundle (the live table inside the revive) keeps its old path and gets no extra write', () => {
  const legacy = { ...golden, spawn: [...TAKE, ...golden.spawn.filter(f => !f.startsWith('$SIR,'))],
    revive: [...TAKE, ...golden.revive.filter(f => !f.startsWith('$SIR,'))], sir_pool: [] };
  const h = liveArmed({ bundle: legacy });
  const n = revived(h);
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'armed inside the revive write, as before');
  const m = h.mark(); h.adv(CAP * 2);
  assert.deepEqual(sirRows(h.since(m)), [], 'no second table for a bundle that already armed');
});

test('F11 fix: a failed live-table write (link.write resolves false) re-arms for retry, not immortal for the life', async () => {
  const h = harness();
  h.adv(10);   // spawned, still inside the window
  let fail = true;
  const realWriter = h.eng.writer;
  h.eng.writer = fr => (fail ? Promise.resolve(false) : realWriter(fr));   // `link.write` on a GATT error: resolves false, never rejects
  h.adv(CAP);                          // the cap fires `_armLife('cap')`; the write "fails"
  await new Promise(r => setImmediate(r));   // let the write's `.then()` run
  assert.ok(h.eng._armPending, 'a failed write must re-arm the pending take, not leave the gun on fn 28 for the life');
  fail = false;
  const n = h.mark();
  h.adv(CAP);                          // the re-armed pending's own cap elapses, now against a working writer
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'the retry succeeds once the write goes through');
});

test('F11 fix: the retry never fires while the link is down (the tick already gates the cap on bleUp)', async () => {
  const h = harness();
  h.adv(10);
  h.eng.writer = () => Promise.resolve(false);   // every write fails
  h.adv(CAP);
  await new Promise(r => setImmediate(r));
  assert.ok(h.eng._armPending, 'setup: re-armed after the failed write');
  h.eng.onBleDropped();
  const n = h.mark();
  h.adv(CAP * 5);
  assert.deepEqual(realRows(h.since(n)), [], 'no retry write is attempted while the link is down');
});

test('F209/S7.1 reconcile guard: the reconcile disarm echo cannot arm hit reception early', () => {
  const h = liveArmed();
  revived(h);
  assert.ok(h.eng._armPending, 'setup: the revive re-armed a pending take');
  h.frame('$ALCD,30,0,0,,*');          // baseline mag on slot 0, so the next echo reads as a decrease
  h.eng.onBleDropped();
  h.eng.onBleConnected();
  assert.ok(h.eng.reconciling, 'setup: reconciling');
  const n = h.mark();
  // the reconcile's own `$AMMO,0,0,0,1,*` disarm write (`_beginReconcile`) echoes back looking exactly
  // like "a round left the mag" -- it must not arm hit reception early.
  h.frame('$ALCD,0,0,0,,*');
  assert.deepEqual(realRows(h.since(n)), [], 'the reconcile echo must not arm hit reception early');
  assert.ok(h.eng._armPending, 'the pending arm survives, unconsumed, for `_endReconcile` to use');
  h.adv(3000);   // RECONCILE_MS
  assert.equal(h.eng.reconciling, null, 'reconcile over');
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'and it still arms normally once the reconcile ends');
});

test('F209 guard: a release that finds the player down or the match over writes nothing (defence behind each cancel)', () => {
  const h = liveArmed();
  revived(h);
  h.eng.alive = false;   // as if a death had slipped past its cancel
  let n = h.mark(); h.adv(CAP);
  assert.deepEqual(realRows(h.since(n)), [], 'a down player is never armed');
  const g = liveArmed();
  revived(g);
  g.eng.phase = 'kitted';
  n = g.mark(); g.eng._armLife('test');
  assert.deepEqual(realRows(g.since(n)), [], 'a gun that is no longer live is never armed');
});

test('F11 fix: a failed reconcile-end write (link stays up, write resolves false) re-arms for retry, not immortal for the life', async () => {
  const h = liveArmed();
  revived(h);
  h.eng.onBleDropped();
  h.eng.onBleConnected();
  assert.ok(h.eng.reconciling, 'setup: relink reconciles');
  const realWriter = h.eng.writer;
  h.eng.writer = fr => Promise.resolve(false);   // the link stays up, but this write "fails"
  h.adv(3000);   // RECONCILE_MS elapses -- `_endReconcile` fires the sir_pool take, which "fails"
  await new Promise(r => setImmediate(r));   // let the write's `.then()` run
  assert.equal(h.eng.reconciling, null, 'reconcile ended');
  assert.ok(h.eng._armPending, 'a failed reconcile-end write must re-arm the pending take, not leave the gun on fn 28 for the life');
  h.eng.writer = realWriter;
  const n = h.mark();
  h.adv(CAP);                          // the re-armed pending's own cap elapses, now against a working writer
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'the retry succeeds once the write goes through');
});

test('F11 fix: an infection flip retains its flip flag through a failed-write retry (not read as "not live")', async () => {
  const flip = { '2': ['$TID,2,*', ...golden.revive] };
  const h = harness({ mode: 'infection', teamFlip: flip });
  h.adv(10); h.adv(CAP);
  let fail = true;
  h.eng.writer = fr => (fail ? Promise.resolve(false) : (h.writes.push(...fr), Promise.resolve(true)));
  h.die();   // flips team; `alive` is false throughout the flip window -- only `p.flip` keeps the pending arm valid
  assert.equal(h.eng.teamTid, 2, 'flipped');
  h.adv(CAP);
  await new Promise(r => setImmediate(r));
  assert.ok(h.eng._armPending, 'the failed flip-arm write re-arms for retry');
  assert.equal(h.eng._armPending.flip, true, 'the retry must keep flip: true, or the next attempt reads the flipped (not-yet-alive) gun as not live');
  fail = false;
  const n = h.mark();
  h.adv(CAP);
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'the retry succeeds and is not cancelled as "not live"');
});
