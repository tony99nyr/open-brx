// The phone engine against the bench gun model: every step of the 2026-11-08 bench, its button edges played at their own
// spacing into the real Engine (src/engine.js, ammo.js), with src/gunmodel.js as the gun. A step passes when the engine
// never logs that the gun fired a slot the HUD did not show (`DESYNC`). A phone change that would desync a swap or a
// reload at the bench fails here first.
//
// Each step plays one fresh life from its first edge, so the counts are the test's own, not the bench's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureNames, loadFixture, runPhone } from './bench-gun-drive.mjs';

// Steps red on main, each with the change that turns it green. The test fails when one goes green, so drop it here then.
// Tony chose the phone-owned swap (2026-11-08): ALT is bound to 98 and the phone binds the trigger itself.
const SR17_FIX = 'brx5-phone-swap (not landed): the phone owns the swap, so the gun has no ALT pointer to fall out of step with';
const KNOWN = {
  sr17c: SR17_FIX, sr17b: SR17_FIX, sr17cc: SR17_FIX, sr17d: SR17_FIX, sr17e: SR17_FIX, sr17e2: SR17_FIX, sr17f: SR17_FIX,
  b2: SR17_FIX, sr5r: SR17_FIX,
  // SR18: after a missed ALT the cure re-asserts `$BMAP,0,0` while the gun's ALT pointer is on slot 1, and the next ALT
  // moves the pointer, not the trigger.
  sr18t: SR17_FIX, swp1: SR17_FIX,
};

/** Every step as {name, fx, from, to}: from the end of the step before (or the session's first spawn) to its own end. */
function steps() {
  const out = [];
  for (const name of fixtureNames()) {
    const fx = loadFixture(name);
    let from = fx.frames.find(r => r[2].startsWith('$SPAWN'))?.[0] ?? 0;
    for (const [step, to] of Object.entries(fx.marks).sort((a, b) => a[1] - b[1])) { out.push({ step, fx, from, to }); from = to; }
  }
  return out;
}

const results = new Map();
async function desyncs(s) {
  if (!results.has(s.step)) results.set(s.step, (await runPhone(s.fx, s)).desyncs);
  return results.get(s.step);
}

test('the phone never shows a slot the gun model did not fire, on every bench step', async () => {
  const bad = [];
  for (const s of steps()) {
    if (s.step in KNOWN) continue;
    const d = await desyncs(s);
    if (d.length) bad.push(`${s.step}: ${d.map(([t, l]) => `@${t} ${l}`).join(' | ')}`);
  }
  assert.deepEqual(bad, []);
});

test('every KNOWN step is still red (drop it from KNOWN once its fix lands)', async () => {
  const all = steps().map(s => s.step);
  assert.deepEqual(Object.keys(KNOWN).filter(k => !all.includes(k)), [], 'KNOWN names a step no fixture has');
  const green = [];
  for (const s of steps()) if (s.step in KNOWN && !(await desyncs(s)).length) green.push(s.step);
  assert.deepEqual(green, [], 'these steps are green now');
});

test('the drive reaches the gun: the phone spawns, arms and fires through the model', async () => {
  const s = steps().find(x => x.step === 'sr1');
  const r = await runPhone(s.fx, s);
  assert.ok(r.writes.includes('$SPAWN,,*'));
  assert.ok(r.writes.includes('$BMAP,0,0,,,,,*'));
  assert.equal(r.logs.some(([, l]) => /gun locked/.test(l)), false);
  assert.ok(r.model.mag[0] < 32 || r.model.mag[1] < 12, 'the bench pulls fired rounds');
  assert.equal(r.state.activeSlot, r.model.bound, 'the HUD ends on the slot the gun model is bound to');
});
