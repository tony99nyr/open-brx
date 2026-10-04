// powerup-player.js's pure helpers (refactor #1): frames in, frames out, with no engine behind them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { burstWithHeld, PU_RESERVE } from '../src/powerup-player.js';

const BURST = ['$PSET,1,2,3,4,70,*', '$AMMO,0,30,90,1,*', '$AMMO,1,12,36,1,*', '$AMMO,2,0,0,1,*', '$AMMO,3,0,0,1,*', '$SPAWN,*'];
const ROCKETS = { slot: 2, left: 3 };

test('burstWithHeld: the held slot\'s zero row carries its charges, and nothing else moves', () => {
  const out = burstWithHeld(BURST, ROCKETS);
  assert.deepEqual(out, ['$PSET,1,2,3,4,70,*', '$AMMO,0,30,90,1,*', '$AMMO,1,12,36,1,*', `$AMMO,2,3,${PU_RESERVE},1,*`, '$AMMO,3,0,0,1,*', '$SPAWN,*']);
  // CONTROL: the input is never mutated (the F416 re-send rebuilds from the same original burst every time)
  assert.equal(BURST[3], '$AMMO,2,0,0,1,*');
});

test('burstWithHeld: nothing held leaves every frame verbatim, as a new array', () => {
  const out = burstWithHeld(BURST, null);
  assert.deepEqual(out, BURST);
  assert.notEqual(out, BURST);
});

test('burstWithHeld: a `zero` slot not held goes to 0/0; the held slot wins over `zero`', () => {
  const live = ['$AMMO,0,30,90,1,*', '$AMMO,2,2,0,1,*', '$AMMO,3,4,0,1,*'];
  assert.deepEqual(burstWithHeld(live, ROCKETS, new Set([2, 3])), ['$AMMO,0,30,90,1,*', `$AMMO,2,3,${PU_RESERVE},1,*`, '$AMMO,3,0,0,1,*']);
  // a swap since the last re-send must not leave two pickup slots loaded (F416 r3)
  assert.deepEqual(burstWithHeld(live, { slot: 3, left: 1 }, new Set([2, 3])), ['$AMMO,0,30,90,1,*', '$AMMO,2,0,0,1,*', `$AMMO,3,1,${PU_RESERVE},1,*`]);
  // CONTROL: without `zero` the other pickup slot keeps its row
  assert.deepEqual(burstWithHeld(live, ROCKETS), ['$AMMO,0,30,90,1,*', `$AMMO,2,3,${PU_RESERVE},1,*`, '$AMMO,3,4,0,1,*']);
});

test('burstWithHeld: a held slot with no `$AMMO` row adds none, and a non-string frame passes through', () => {
  const odd = [{ not: 'a frame' }, '$AMMO,0,30,90,1,*', '$WEAP,2,1,*'];
  assert.deepEqual(burstWithHeld(odd, ROCKETS, new Set([2])), odd);
});

test('burstWithHeld: a held heavy at 0 left still writes its own row (0 charges is a count, not "nothing held")', () => {
  assert.deepEqual(burstWithHeld(['$AMMO,2,5,5,1,*'], { slot: 2, left: 0 }), [`$AMMO,2,0,${PU_RESERVE},1,*`]);
});
