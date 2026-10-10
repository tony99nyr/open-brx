// The e2e rig's fake gun (app/src/fakegun.js) against the gun replies CI models (A9, review 2026-10-10).
// app/test/fixtures/gun-replies.json is GENERATED from mcp/brx_mcp/fake.py FakeTagger by mcp/tools/gen_gun_replies.py;
// mcp/tests/test_gun_reply_cases.py fails when fake.py changes until it is regenerated, and this fails until
// fakegun.js answers the same writes with the same frames.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeGun } from '../src/fakegun.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'gun-replies.json'), 'utf8'));

/** Run one case's steps through a fresh fake gun; each step records the gun frames it produced. */
function run(steps) {
  const fed = [];
  const engine = { feedFrame: f => fed.push(f), onBleConnected() {}, onBleDropped() {} };
  const gun = installFakeGun({ engine, log() {} });
  return steps.map(s => {
    fed.length = 0;                                   // the install's own $VOLTS is not a reply
    if (s.write) engine.writer(s.write); else gun.fire(1);
    mock.timers.tick(1000);                           // past the 120 ms reply delay
    // `fire` also feeds the trigger's own $BUT frames, which are the button, not a reply
    return { ...s, replies: fed.filter(f => !f.startsWith('$BUT,')) };
  });
}

test('fakegun.js answers every gun-reply case with the frames fake.py sends', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    assert.ok(FIXTURE.cases.length >= 6);
    for (const c of FIXTURE.cases) {
      assert.ok(c.steps.every(s => s.write || s.fire === 0), `${c.name}: fakegun.js fires slot 0 only`);
      assert.deepEqual(run(c.steps), c.steps, c.name);
    }
  } finally { mock.timers.reset(); }
});
