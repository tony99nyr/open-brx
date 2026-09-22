// F121 rebuild (bench 2026-09-18, bench-firmware-levers §23, v4.32): spawn protection is `$TMP` t8, not a table.
// `$SPAWN,,*`, then `$TMP,,,,,,,,-100,,,,*`, then `$TID`: hits register with 0 damage. `$TMP,,,,,,,,0,,,,*` restores
// damage. A `$TMP` sent BEFORE `$SPAWN` is wiped by the spawn. The `$SIR` table survives `$SPAWN` and death; only
// `$CLEAR` zeroes it. So spawn and revive carry no `$SIR` row, and the node ends protection (`_armLife`) on the gun's
// first shot or at SPAWN_PROTECT_MAX_MS with `spawn_protect_off`, putting one `sir_pool` take in front of it only when
// the gun's table is not the live one (after a head) or class sounds are on.
// F209 is still the reason for the window: hit reception must not come back before the trigger does.
// Every cancel case is here: death, match end, a head re-write, a link drop, an infection flip.
// Mirrors: mcp/tests/test_stage_spawn_protect.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';

const { Engine } = E;
const CAP = E.SPAWN_PROTECT_MAX_MS ?? 2100;   // `??` so this file still loads (and fails) against a pre-F209 engine
// 2026-09-19: this file pins the LEGACY path, the one a bundle from an MC before the respawn profiles takes (no
// `respawn_profile`: protection ends on the first shot or the cap). test/respawn-profile.test.mjs pins the profiles.
const golden = (({ respawn_profile, ...rest }) => rest)(JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url)))));
const TAKE = golden.sir_pool[0];
const ON = '$TMP,,,,,,,,-100,,,,*';
const OFF = '$TMP,,,,,,,,0,,,,*';

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
const fnOf = f => f.split(',')[4];
const realRows = w => w.filter(f => f.startsWith('$SIR,') && fnOf(f) !== '28');
const sirRows = w => w.filter(f => f.startsWith('$SIR,'));
const tmps = w => w.filter(f => f.startsWith('$TMP'));
/** The protection frames of a write, in wire order: the take's rows and the off frame. */
const release = w => w.filter(f => f.startsWith('$SIR,') || f.startsWith('$TMP'));

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
/** The bench-proven order, pinned: `$SPAWN,,*`, then t8 = -100, then `$TID`, back to back. */
function assertShieldOrder(w, tid, label) {
  const i = w.indexOf('$SPAWN,,*');
  assert.ok(i >= 0, `${label}: a $SPAWN`);
  assert.deepEqual(w.slice(i, i + 3), ['$SPAWN,,*', ON, `$TID,${tid},*`], `${label}: $SPAWN, then t8 = -100, then $TID (a $TMP before $SPAWN is wiped)`);
  assert.deepEqual(tmps(w), [ON], `${label}: one $TMP, the protection write`);
}

test('F121 fixture: the golden bundle shields every life with $TMP t8 and carries no $SIR row in spawn or revive', () => {
  for (const k of ['spawn', 'revive']) {
    assert.deepEqual(sirRows(golden[k]), [], `${k} carries no $SIR row: the table survives $SPAWN`);
    assertShieldOrder(golden[k], 1, k);
  }
  assert.equal(golden.spawn_protect_off, OFF);
  assert.equal(golden.sir_pool.length, 1); assert.ok(realRows(TAKE).length, 'the take is the real table');
  for (const f of [ON, OFF]) assert.equal(f.split(',').length - 1, 12, `${f}: all twelve commas`);
});

test('F121 T-0: the spawn write turns protection on in order; the cap writes the live table, then turns it off', () => {
  const h = harness();
  h.adv(10);
  assert.equal(h.eng.phase, 'live');
  assertShieldOrder(h.writes.slice(h.writes.lastIndexOf('$PLAYX,0,*')), 1, 'the T-0 write');
  const spawnAt = h.writes.lastIndexOf('$SPAWN,,*');
  assert.ok(h.writes.indexOf('$BMAP,0,0,,,,,*') > spawnAt, 'the trigger is mapped after $SPAWN');
  assert.deepEqual(realRows(h.writes), [], 'no row that moves a pool reached the gun with the spawn');
  const n = h.mark();
  h.adv(CAP - 20);
  assert.deepEqual(release(h.since(n)), [], 'still protected just before the cap');
  h.adv(20);
  assert.deepEqual(release(h.since(n)), [...TAKE, OFF], 'the head left fn 28 on the gun: the live table, THEN protection off');
  const m = h.mark(); h.adv(5000);
  assert.deepEqual(release(h.since(m)), [], 'and never again this life');
});

test('F121 revive: protected in order, no table re-sent (it survived the death), and the first shot ends protection', () => {
  const h = liveArmed();
  const n = revived(h);
  const rev = h.since(n);
  assertShieldOrder(rev, 1, 'the revive write');
  assert.deepEqual(sirRows(rev), [], 'no $SIR row: the live table is still on the gun');
  h.frame('$ALCD,32,100,0,192,0,*');   // the $AMMO echo: proves nothing about the trigger
  assert.deepEqual(tmps(h.since(n)), [ON], 'an echo at a full magazine does not end protection');
  h.adv(300);
  h.frame('$BUT,0,1,*'); h.frame('$ALCD,31,100,0,192,0,*');   // a round left the magazine
  assert.deepEqual(release(h.since(n)), [ON, OFF], 'the first shot writes t8 = 0 and nothing else');
  const m = h.mark(); h.adv(CAP);
  assert.deepEqual(release(h.since(m)), [], 'the cap does not write a second release');
});

test('F121 frames per life: the revive and its release are 7 frames and no $SIR row (the fn-28 twin path wrote 28)', () => {
  const h = liveArmed();
  const n = revived(h);
  h.adv(CAP);
  const life = h.since(n);
  assert.deepEqual(sirRows(life), [], `no $SIR row this life: ${life.join(' ')}`);
  const core = life.filter(f => golden.revive.includes(f) || f === OFF);   // the voice, LED and scream frames are unchanged
  assert.equal(core.length, 7, `the protection path: ${core.join(' ')}`);
});

test('F121 cancel: a death inside the window writes no release to the dead gun; the next life protects and releases', () => {
  const h = liveArmed();
  revived(h);
  h.adv(500); const n = h.mark();
  h.die();
  assert.equal(h.eng._armPending, null, 'the death drops the pending release');
  h.adv(CAP);
  assert.deepEqual(release(h.since(n)), [], 'nothing written to a dead gun');
  h.adv(8000 - CAP);
  assert.equal(h.eng.alive, true, 'revived again');
  h.adv(CAP);
  assert.deepEqual(release(h.since(n)), [ON, OFF], 'the new life turns protection on, then off at its own cap');
});

test('F121 cancel: the match ending inside the window never writes to an ended gun', () => {
  const h = liveArmed();
  revived(h);
  const n = h.mark();
  h.eng._endLocal('test');
  assert.equal(h.eng._armPending, null, 'the end drops the pending release');
  h.adv(CAP * 2);
  assert.deepEqual(release(h.since(n)), [], 'nothing written after the end');
});

test('F121 head re-write: it drops the pending release, and the next life re-sends the live table (never immortal)', () => {
  const h = liveArmed();
  revived(h);
  let n = h.mark();
  h.eng._writeHead('test head');
  h.adv(CAP);
  assert.deepEqual(realRows(h.since(n)), [], 'a head is fn 28 throughout and starts no release');
  assert.equal(h.eng._sirLive, false, 'the head left fn 28 on the gun');
  n = revived(h);
  h.adv(CAP);
  assert.deepEqual(release(h.since(n)), [ON, ...TAKE, OFF], 'the next release re-arms the table before t8 = 0');
});

test('F121 table tracking: a take overtaken by a head write never claims the table is live', async () => {
  const h = liveArmed();
  revived(h);
  let resolveTake;
  const realWriter = h.eng.writer;
  h.eng._sirLive = false;   // as after a head: the release must carry the take
  h.eng.writer = fr => { realWriter(fr); return new Promise(r => { resolveTake = r; }); };
  h.adv(CAP);                                   // the release: take + OFF, still in flight
  h.eng.writer = realWriter;
  h.eng._writeHead('a head overtakes the take');   // fn 28 lands AFTER the take
  resolveTake(true);
  await new Promise(r => setImmediate(r));
  assert.equal(h.eng._sirLive, false, 'the table on the gun is the head\'s fn 28, not the take');
});

test('F121 link drop: nothing written while down; the relink reconcile always re-sends the table and ends protection', () => {
  const h = liveArmed();
  revived(h);
  h.eng.onBleDropped();
  const n = h.mark();
  h.adv(CAP * 2);
  assert.deepEqual(release(h.since(n)), [], 'nothing written to a link that is down');
  h.eng.onBleConnected();
  assert.ok(h.eng.reconciling, 'relink reconciles');
  h.adv(1000);
  assert.deepEqual(release(h.since(n)), [], 'the cap does not fire through the reconcile');
  h.adv(2000);
  assert.equal(h.eng.reconciling, null, 'reconcile over');
  assert.deepEqual(release(h.since(n)), [...TAKE, OFF], 'the table (a drop can hide a reboot, F11), then t8 = 0, once');
  // an app restart loses `_armPending`: the reconcile still releases
  h.eng._armPending = null; h.eng.onBleDropped(); h.eng.onBleConnected();
  const m = h.mark(); h.adv(3000);
  assert.deepEqual(release(h.since(m)), [...TAKE, OFF], 'a rejoin with no pending release still ends protection');
});

test('F121 infection flip: the flip write protects in order, then the cap ends protection', () => {
  const flip = { '2': ['$TID,2,*', ...golden.revive.map(f => (f === '$TID,1,*' ? '$TID,2,*' : f))] };
  const h = liveArmed({ mode: 'infection', teamFlip: flip });
  const n = h.mark();
  h.die();
  assert.equal(h.eng.teamTid, 2, 'flipped');
  assertShieldOrder(h.since(n), 2, 'the flip write');
  h.adv(CAP);
  assert.deepEqual(release(h.since(n)), [ON, OFF], 'the flipped gun is released at the cap');
});

test('F121 class sounds: one fresh take per life, written in front of t8 = 0, never inside the revive write', () => {
  const takes = [TAKE.map(f => f.replace(/^(\$SIR,0,0,)[^,]*/, '$1H01')), TAKE.map(f => f.replace(/^(\$SIR,0,0,)[^,]*/, '$1H02'))];
  const h = liveArmed({ bundle: { ...golden, sir_pool: takes } });
  const n = revived(h);
  assert.deepEqual(sirRows(h.since(n)), [], 'no take inside the revive write');
  h.adv(CAP);
  const rel = release(h.since(n));
  assert.equal(rel[rel.length - 1], OFF, 't8 = 0 goes last');
  const rows = realRows(rel);
  assert.equal(rows.length, TAKE.length, 'one whole take, not two');
  assert.ok(takes.some(t => JSON.stringify(realRows(t)) === JSON.stringify(rows)), 'and it is a pool take');
});

test('F121 control: an A44 bundle (fn-28 twin in the revive, no spawn_protect_off) keeps its take-per-life path', () => {
  const twin = TAKE.map(f => { const t = f.split(','); t[3] = ''; t[4] = '28'; return t.join(','); });
  const a44 = { ...golden, spawn: [...twin, ...golden.spawn.filter(f => f !== ON)], revive: [...twin, ...golden.revive.filter(f => f !== ON)] };
  delete a44.spawn_protect_off;
  const h = liveArmed({ bundle: a44 });
  const n = revived(h);
  h.adv(CAP);
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'the twin overwrote the table, so the release must re-send it');
  assert.deepEqual(tmps(h.since(n)), [], 'and it writes no $TMP');
});

test('F209 control: an older bundle (the live table inside the revive) keeps its old path and gets no extra write', () => {
  const legacy = { ...golden, spawn: [...TAKE, ...golden.spawn.filter(f => f !== ON)],
    revive: [...TAKE, ...golden.revive.filter(f => f !== ON)], sir_pool: [] };
  delete legacy.spawn_protect_off;
  const h = liveArmed({ bundle: legacy });
  const n = revived(h);
  assert.deepEqual(realRows(h.since(n)), realRows(TAKE), 'armed inside the revive write, as before');
  const m = h.mark(); h.adv(CAP * 2);
  assert.deepEqual(release(h.since(m)), [], 'no second table and no $TMP for a bundle that already armed');
});

test('F11 fix: a failed release write (link.write resolves false) is retried, so nobody stays invincible for the life', async () => {
  const h = harness();
  h.adv(10);   // spawned, still inside the window
  let fail = true;
  const realWriter = h.eng.writer;
  h.eng.writer = fr => (fail ? Promise.resolve(false) : realWriter(fr));   // `link.write` on a GATT error: resolves false, never rejects
  h.adv(CAP);                          // the cap fires `_armLife('cap')`; the write "fails"
  await new Promise(r => setImmediate(r));   // let the write's `.then()` run
  assert.ok(h.eng._armPending, 'a failed write must re-arm the pending release');
  fail = false;
  const n = h.mark();
  h.adv(CAP);                          // the re-armed pending's own cap elapses, now against a working writer
  assert.deepEqual(release(h.since(n)), [...TAKE, OFF], 'the retry succeeds once the write goes through');
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
  assert.deepEqual(release(h.since(n)), [], 'no retry write is attempted while the link is down');
});

test('F209/S7.1 reconcile guard: the reconcile disarm echo cannot end protection early', () => {
  const h = liveArmed();
  revived(h);
  assert.ok(h.eng._armPending, 'setup: the revive left a pending release');
  h.frame('$ALCD,30,0,0,,*');          // baseline mag on slot 0, so the next echo reads as a decrease
  h.eng.onBleDropped();
  h.eng.onBleConnected();
  assert.ok(h.eng.reconciling, 'setup: reconciling');
  const n = h.mark();
  // the reconcile's own `$AMMO,0,0,0,1,*` disarm write (`_beginReconcile`) echoes back looking exactly
  // like "a round left the mag" -- it must not end protection early.
  h.frame('$ALCD,0,0,0,,*');
  assert.deepEqual(release(h.since(n)), [], 'the reconcile echo must not end protection early');
  assert.ok(h.eng._armPending, 'the pending release survives, unconsumed, for `_endReconcile` to use');
  h.adv(3000);   // RECONCILE_MS
  assert.equal(h.eng.reconciling, null, 'reconcile over');
  assert.deepEqual(release(h.since(n)), [...TAKE, OFF], 'and it still ends protection once the reconcile ends');
});

test('F209 guard: a release that finds the player down or the match over writes nothing (defence behind each cancel)', () => {
  const h = liveArmed();
  revived(h);
  h.eng.alive = false;   // as if a death had slipped past its cancel
  let n = h.mark(); h.adv(CAP);
  assert.deepEqual(release(h.since(n)), [], 'a down player gets nothing');
  const g = liveArmed();
  revived(g);
  g.eng.phase = 'kitted';
  n = g.mark(); g.eng._armLife('test');
  assert.deepEqual(release(g.since(n)), [], 'a gun that is no longer live gets nothing');
});

test('F11 fix: a failed reconcile-end write (link stays up, write resolves false) is retried', async () => {
  const h = liveArmed();
  revived(h);
  h.eng.onBleDropped();
  h.eng.onBleConnected();
  assert.ok(h.eng.reconciling, 'setup: relink reconciles');
  const realWriter = h.eng.writer;
  h.eng.writer = fr => Promise.resolve(false);   // the link stays up, but this write "fails"
  h.adv(3000);   // RECONCILE_MS elapses -- `_endReconcile` fires the release, which "fails"
  await new Promise(r => setImmediate(r));   // let the write's `.then()` run
  assert.equal(h.eng.reconciling, null, 'reconcile ended');
  assert.ok(h.eng._armPending, 'a failed reconcile-end write must re-arm the pending release');
  h.eng.writer = realWriter;
  const n = h.mark();
  h.adv(CAP);                          // the re-armed pending's own cap elapses, now against a working writer
  assert.deepEqual(release(h.since(n)), [...TAKE, OFF],
    'the retry succeeds and still carries the table; t4 ownership is repaired by the unified accuracy path');
});

test('F11 fix: an infection flip retains its flip flag through a failed-write retry (not read as "not live")', async () => {
  const flip = { '2': ['$TID,2,*', ...golden.revive.map(f => (f === '$TID,1,*' ? '$TID,2,*' : f))] };
  const h = harness({ mode: 'infection', teamFlip: flip });
  h.adv(10); h.adv(CAP);
  let fail = true;
  h.eng.writer = fr => (fail ? Promise.resolve(false) : (h.writes.push(...fr), Promise.resolve(true)));
  h.die();   // flips team; `alive` is false throughout the flip window -- only `p.flip` keeps the pending release valid
  assert.equal(h.eng.teamTid, 2, 'flipped');
  h.adv(CAP);
  await new Promise(r => setImmediate(r));
  assert.ok(h.eng._armPending, 'the failed flip release re-arms for retry');
  assert.equal(h.eng._armPending.flip, true, 'the retry must keep flip: true, or the next attempt reads the flipped (not-yet-alive) gun as not live');
  fail = false;
  const n = h.mark();
  h.adv(CAP);
  assert.deepEqual(release(h.since(n)), [OFF], 'the retry succeeds and is not cancelled as "not live"');
});
