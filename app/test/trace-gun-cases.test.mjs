// One gun model, held: the golden traces' gun (golden-trace-runner.mjs `TraceGun`) against CI's gun (mcp/brx_mcp/fake.py
// FakeTagger, recorded in fixtures/gun-replies.json), on every write TraceGun models. The twin of
// mcp/tests/test_trace_gun_cases.py, with the same two normalisations (a step's replies compare as a multiset, because
// TraceGun answers a $WEAP/$AMMO at once where FakeTagger holds the $ALCD 40 ms; and $QUERY's status array, which the
// engine never reads, is left out) and the same KNOWN differences, each of which must still differ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TraceGun } from './golden-trace-runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'gun-replies.json'), 'utf8'));
const ALL_ON = { spawn: true, probe: true, life: true, ammo: true, alcd_echo: true };
// Case name -> [the step where TraceGun first differs, why]: pinned, so a new difference earlier in the case fails.
const KNOWN = {
  '$LIFE token 3 fills the shield up to the $PSET t5 ceiling': [3, 'no shield cap at the $PSET t5 ceiling'],
  '$LIFE mode 1 sets the pools outright, clamped at the maxima, and revives a dead gun': [3, 'only the additive $LIFE is modelled'],
  '$LIFE mode 2 sets the pools outright with no clamp': [2, 'only the additive $LIFE is modelled'],
  'a re-pushed $WEAP,0 with a new clip resets the magazine, and the next spawn refills to the new clip':
    [5, 'a spawn refills to the fixed spawn_ammo option'],
};

const norm = rs => rs.filter(f => !f.startsWith('$QUERY,')).sort();

/** The first differing step as [step, detail], or null. A trigger pull's frames go to `heard`, as in the runner. */
function firstDifference(c) {
  const gun = new TraceGun(ALL_ON, [45, 70, 0]);
  for (const [i, s] of c.steps.entries()) {
    if (!s.write) { for (const f of s.replies) gun.heard(f); gun.take(); continue; }
    gun.wrote(s.write);
    const got = gun.take();
    if (JSON.stringify(norm(got)) !== JSON.stringify(norm(s.replies))) return [i, `step ${i}: FakeTagger ${s.replies} TraceGun ${got}`];
  }
  return null;
}

test('the JS trace gun answers every modelled write as CI\'s gun does', () => {
  const bad = DOC.cases.filter(c => !(c.name in KNOWN)).map(c => [c.name, firstDifference(c)]).filter(([, d]) => d);
  assert.deepEqual(bad, []);
});

test('every KNOWN difference still differs', () => {
  const names = new Map(DOC.cases.map(c => [c.name, c]));
  assert.deepEqual(Object.keys(KNOWN).filter(n => !names.has(n)), [], 'KNOWN names a case gun-replies.json no longer has');
  const seen = Object.keys(KNOWN).map(n => [n, firstDifference(names.get(n))]);
  assert.deepEqual(seen.filter(([, d]) => d === null).map(([n]) => n), [], 'these now agree: drop them from KNOWN');
  assert.deepEqual(seen.filter(([n, d]) => d && d[0] !== KNOWN[n][0]).map(([n, d]) => d[1]), [], 'a new difference comes before the known one');
});
