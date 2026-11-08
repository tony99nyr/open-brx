// The gun model (src/gunmodel.js) held to the real gun: each bench session of 2026-11-08 (fixtures/bench-gun/, made by
// tools/bench-gun-fixture.mjs) replayed through the model, whose every `$ALCD` and `$LCD` answer must match the gun's.
// A difference passes only when the model made a call within NEAR_EDGE_MS of the edge that decided it (bench-gun-drive.mjs
// says why). The counts are pinned, so a rule change that moves them shows here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GunModel, HELD_SWAP_RELEASE_MS } from '../src/gunmodel.js';
import { fixtureNames, loadFixture, replayGun, FIXTURE_DIR } from './bench-gun-drive.mjs';
import { extract, KEEP } from '../tools/bench-gun-fixture.mjs';

// fixture -> [answers that agree, near-edge differences]
const PINNED = {
  '2026-11-08-sr1-sr5': [183, 2],
  '2026-11-08-sr11-sr15': [27, 0],
  '2026-11-08-sr5r-sr12': [115, 4],
  '2026-11-08-sr17-swp1': [142, 3],
};

test('every bench session replays through the model, with differences only at a timing edge', () => {
  assert.deepEqual(fixtureNames(), Object.keys(PINNED).sort());
  for (const name of fixtureNames()) {
    const { agree, diffs } = replayGun(loadFixture(name));
    const bad = diffs.filter(d => !d.excuse).map(d => `${name} @${d.t} [${d.step}]: gun ${d.gun}, model ${d.model}`);
    assert.deepEqual(bad, [], 'differences no timing edge explains');
    assert.deepEqual([agree, diffs.length], PINNED[name], `${name}: [agree, near-edge differences]`);
  }
});

test('the fixtures hold only the frames the model reads, with no names', () => {
  for (const name of fixtureNames()) {
    const raw = readFileSync(FIXTURE_DIR + name + '.json', 'utf8');
    const fx = JSON.parse(raw);
    assert.deepEqual(fx.frames.filter(([, , f]) => !KEEP.test(f)), [], `${name}: a frame outside KEEP`);
    assert.doesNotMatch(raw, /R0B|Tactix|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, `${name}: a gun label or an address`);
    assert.ok(fx.frames.every(([t], i) => i === 0 || t >= fx.frames[i - 1][0]), `${name}: times in order`);
  }
});

test('the extractor keeps the model\'s frames, drops the rest and repeats, and rebases the times', () => {
  const ring = [
    { t: 1000, dir: 'tx', f: '$VERSION,*' }, { t: 1010, dir: 'rx', f: '$VERSION,v4.32,devhost,*' },
    { t: 1020, dir: 'rx', f: '$BUT,0,1,*' }, { t: 1020, dir: 'rx', f: '$BUT,0,1,*' }, { t: 1025, dir: 'rx', f: '$ALCD,31,100,0,384,0,*' },
    { t: 1030, dir: 'rx', f: '$HIR,4,0,19,2,9,0,0,*' }, { t: 1040, dir: 'tx', f: '$AMMO,1,12,240,1,*' }, { t: 2000, dir: 'rx', f: '$BUT,1,1,*' },
  ];
  assert.deepEqual(extract(ring, { until: 1500, marks: { a: 1030 } }), {
    frames: [[0, 'rx', '$BUT,0,1,*'], [5, 'rx', '$ALCD,31,100,0,384,0,*'], [20, 'tx', '$AMMO,1,12,240,1,*']], marks: { a: 10 } });
});

// ---------- each rule on its own, from the bench step that showed it ----------
const AR = '$WEAP,0,,70,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*';
const USP = '$WEAP,1,,100,0,3,10,0,,,,,,,,190,500,12,240,2200,0,7,100,100,,0,2,50,Q04,,,,D08,D07,D06,D18,,,,,12,120,75,*';
/** A spawned gun with the bench loadout and the MC head's button map; `steps` are [t, 'b'|'w', ...]. Returns the answers. */
function run(steps, opts) {
  const g = new GunModel(opts);
  for (const f of [AR, USP, '$BMAP,0,98,,,,,*', '$BMAP,1,100,0,1,99,99,*', '$BMAP,2,97,,,,,*', '$SPAWN,,*', '$BMAP,0,0,,,,,*']) g.write(f, 0);
  g.take();
  for (const [t, kind, a, b] of steps) { if (kind === 'b') g.button(a, b, t); else g.write(a, t); }
  g.advance(1e9);
  return { g, out: g.take().map(o => o.f.replace(/,100,(\d),/, ',$1,').replace(/,0,\*$/, '')) };
}
const tap = (t, id) => [[t, 'b', id, 1], [t + 50, 'b', id, 0]];

test('SR1: ALT is ignored for the tok15 of the slot it swapped to', () => {
  const { out } = run([...tap(1000, 1), ...tap(1450, 1), ...tap(2000, 0), ...tap(3000, 1), ...tap(3800, 1), ...tap(4600, 0)]);
  // 1450 is inside the USP-S's 500: still on slot 1. 3800 is inside the AR's 850: still on slot 0.
  assert.deepEqual(out, ['$ALCD,11,1,240', '$ALCD,31,0,384']);
});

test('sr17b: the trigger fires nothing inside the swap', () => {
  const { out } = run([...tap(1000, 1), ...tap(1065, 0), ...tap(1600, 0)]);
  assert.deepEqual(out, ['$ALCD,11,1,240']);
});

test('SR5: an $AMMO write is answered for the slot that fired last, at its own count', () => {
  const { out } = run([...tap(1000, 0), [2000, 'w', '$AMMO,1,12,240,1,*']]);
  assert.deepEqual(out, ['$ALCD,31,0,384', '$ALCD,31,0,384']);
});

test('SR12, SR15: the lever reloads the slot that fired last, and ALT waits for it', () => {
  const { out } = run([...tap(1000, 0), ...tap(2000, 1), ...tap(3000, 2), ...tap(3500, 1), ...tap(6000, 0)]);
  // the lever on the USP-S reloads the AR (fired last); ALT at 3500 is ignored while it does; the trigger then fires slot 1
  assert.deepEqual(out, ['$ALCD,31,0,384', '$ALCD,32,0,383', '$ALCD,11,1,240']);
});

test('sr5a: a lever inside the swap reloads nothing', () => {
  const { out } = run([...tap(1000, 0), ...tap(2000, 1), ...tap(2014, 2)]);
  assert.deepEqual(out, ['$ALCD,31,0,384']);
});

test('sr1c: a dry pull moves the last-fired slot, so the lever reloads the slot pulled dry', () => {
  const { out } = run([[500, 'w', '$AMMO,1,0,240,1,*'], ...tap(1000, 0), ...tap(2000, 1), ...tap(3000, 0), ...tap(4000, 2)]);
  assert.deepEqual(out.slice(-1), ['$ALCD,12,1,228']);
});

test('SR17: a dry semi-auto pull blocks ALT for its tok15, held or released; live fire blocks nothing', () => {
  const dry = [[500, 'w', '$AMMO,1,0,240,1,*'], ...tap(1000, 1), ...tap(2000, 0)];
  assert.equal(run([...dry, ...tap(2400, 1)]).g.bound, 1);    // 400 ms after the dry trigger-down: refused
  assert.equal(run([...dry, ...tap(2600, 1)]).g.bound, 0);    // 600 ms: taken
  assert.equal(run([...tap(1000, 1), ...tap(2000, 0), ...tap(2100, 1)]).g.bound, 0);   // after a live round: taken
});

test('SR17 E: a dry full-auto hold blocks ALT until tok15 after the release', () => {
  const held = [[500, 'w', '$AMMO,0,0,384,1,*'], [1000, 'b', 0, 1], ...tap(3000, 1), [4000, 'b', 0, 0]];
  assert.equal(run(held).g.bound, 0);
  assert.equal(run([...held, ...tap(4700, 1)]).g.bound, 0);
  assert.equal(run([...held, ...tap(4900, 1)]).g.bound, 1);
});

test('sr17e2: ALT taken in a held burst stops it, and a full-auto hold through a swap fires as it ends', () => {
  const burst = run([[1000, 'b', 0, 1], ...tap(1250, 1), [1600, 'b', 0, 0]], { auto: 'timed' });
  assert.deepEqual(burst.out, ['$ALCD,31,0,384', '$ALCD,30,0,384', '$ALCD,29,0,384']);
  assert.equal(burst.g.fireLockUntil, Math.max(1250 + 500, 1600 + HELD_SWAP_RELEASE_MS));
  // a pull at 2300 inside the swap back to the AR (850 from 2000), held: the first round leaves as the swap ends
  const g = new GunModel({ auto: 'timed' });
  for (const f of [AR, USP, '$BMAP,1,100,0,1,99,99,*', '$SPAWN,,*', '$BMAP,0,0,,,,,*']) g.write(f, 0);
  g.take();
  for (const [t, id, st] of [[1000, 1, 1], [1050, 1, 0], [2000, 1, 1], [2050, 1, 0], [2300, 0, 1], [3200, 0, 0]]) g.button(id, st, t);
  assert.deepEqual(g.take().map(o => o.t), [2850, 2950, 3050, 3150]);
});

test('bench $BMAP A/B/A and SR18: $BMAP,0 binds the trigger, and the gun\'s ALT pointer stays where it was', () => {
  const { out, g } = run([[500, 'w', '$BMAP,0,1,,,,,*'], ...tap(1000, 0), [1500, 'w', '$BMAP,0,0,,,,,*'], ...tap(2000, 0),
    ...tap(3000, 1), ...tap(4000, 0), ...tap(5000, 1), ...tap(6000, 0)]);
  // the pointer was never moved by the binds: the first ALT moves it 0 -> 1, the second 1 -> 0
  assert.deepEqual(out, ['$ALCD,11,1,240', '$ALCD,31,0,384', '$ALCD,10,1,240', '$ALCD,30,0,384']);
  assert.deepEqual([g.altPtr, g.bound], [0, 0]);
  const sr18 = run([...tap(1000, 1), [2000, 'w', '$BMAP,0,0,,,,,*'], ...tap(2500, 0), ...tap(3500, 1), ...tap(4500, 0)]);
  assert.deepEqual(sr18.out, ['$ALCD,31,0,384', '$ALCD,30,0,384']);   // the ALT after the rebind changed nothing visible
});

test('$BMAP,1,98 or 99: ALT swaps nothing; $BMAP,0,98: the trigger fires nothing', () => {
  for (const fn of [98, 99]) assert.equal(run([[500, 'w', `$BMAP,1,${fn},,,,,*`], ...tap(1000, 1)]).g.bound, 0);
  assert.deepEqual(run([[500, 'w', '$BMAP,0,98,,,,,*'], ...tap(1000, 0)]).out, []);
});

test('MN1: a melee button swings once per the slot-4 t14', () => {
  const g = new GunModel();
  for (const f of ['$WEAP,4,1,60,13,1,60,0,,,,,,,,3000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*', '$BMAP,8,4,,,,,*', '$SPAWN,,*']) g.write(f, 0);
  g.take();
  for (const t of [1000, 2500, 3900, 4100]) g.button(8, 1, t);
  assert.deepEqual(g.take().map(o => [o.t, o.f]), [[1000, '$ALCD,1,100,4,0,0,*'], [4100, '$ALCD,1,100,4,0,0,*']]);
});
