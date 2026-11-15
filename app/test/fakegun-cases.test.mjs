// The e2e rig's fake gun (app/src/fakegun.js) against the gun replies CI models (A9, review 2026-10-10).
// app/test/fixtures/gun-replies.json is GENERATED from mcp/brx_mcp/fake.py FakeTagger by app/test/fixtures/gen_gun_replies.py;
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
    mock.timers.tick(1000);                           // past the 40 ms $ALCD write latency
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

// Polish r1 (brx4; Codex + Opus): brxlink.js logs a throwing `onFrameSent` hook as a code fault and sends the rest of the batch
// (0a64281ef). The fake stopped the batch, so the demo and e2e rig turned a hook bug into a lost `$SPAWN`.
test('fakegun.js: a throwing onFrameSent hook is logged and the rest of the batch still goes, as on the link', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const logs = [], engine = { feedFrame() {}, onBleConnected() {}, onBleDropped() {} };
    const gun = installFakeGun({ engine, log: (m, c) => logs.push([String(m), c]) });
    engine.writer(['$BMAP,0,98,,,,,*', '$SPAWN,,*'], 'revive', { onFrameSent: f => { if (f.startsWith('$BMAP')) throw new Error('hook bug'); } });
    mock.timers.tick(1000);
    assert.deepEqual(gun.writes.slice(-2), ['$BMAP,0,98,,,,,*', '$SPAWN,,*'], 'the $SPAWN still went');
    assert.ok(logs.some(([m, c]) => /^BUG in onFrameSent during revive: Error: hook bug/.test(m) && c === 'le'), JSON.stringify(logs));
  } finally { mock.timers.reset(); }
});
