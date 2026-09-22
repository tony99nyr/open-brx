// F288: the engine already publishes its gun-health investigation, but the live HUD used to
// ignore both fields. These are intentionally screen-copy tests: a player must see what failed
// and the one useful next action, and a later healthy state must remove the warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Hud } from '../src/hud/hud.js';

const warning = st => Hud.prototype._gunHealthWarning.call(Hud.prototype, st);

test('F288: unanswered cure is a strong, actionable live-HUD warning', () => {
  const html = warning({ alive: true, bleUp: true, cure: { verdict: 'no_answer' }, poolStale: { why: 'no_fire' } });
  assert.match(html, /gunwarn danger/);
  assert.match(html, /GUN NOT ANSWERING/);
  assert.match(html, /HOST: FORCE RESPAWN OR RELINK/);
  assert.doesNotMatch(html, /NOT REPORTING SHOTS/, 'the conclusive warning must replace the preliminary one');
});

test('F288: no-fire evidence is visible while the gun investigation is unresolved', () => {
  const html = warning({ alive: true, bleUp: true, cure: { verdict: 'asking' }, poolStale: { why: 'no_fire' } });
  assert.match(html, /gunwarn warn/);
  assert.match(html, /GUN NOT REPORTING SHOTS/);
  assert.match(html, /PULL TRIGGER AGAIN · THEN TELL HOST/);
});

test('F288: healthy, non-live, and merely silent states do not leave a warning up', () => {
  assert.equal(warning({ alive: true, bleUp: true, cure: { verdict: 'alive' }, poolStale: null }), '');
  assert.equal(warning({ alive: true, bleUp: true, cure: null, poolStale: { why: 'silent' } }), '');
  assert.equal(warning({ alive: false, bleUp: true, cure: { verdict: 'no_answer' }, poolStale: { why: 'no_fire' } }), '');
});

test('F288: connectivity and relink controls take precedence over a persisted verdict', () => {
  const verdict = { alive: true, cure: { verdict: 'no_answer' }, poolStale: { why: 'no_fire' } };
  assert.equal(warning({ ...verdict, bleUp: false }), '');
  assert.equal(warning({ ...verdict, bleUp: true, gunFlapping: { count: 2 } }), '');
  assert.equal(warning({ ...verdict, bleUp: true, resync: { prompt: 'pull trigger' } }), '');
  assert.equal(warning({ ...verdict, bleUp: true, reconciling: true }), '');
});

test('F288: cure and poolStale verdicts invalidate the HUD structure', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../src/hud/hud.js', import.meta.url)), 'utf8');
  const signature = /const sig = \[([\s\S]*?)\]\.join\('\|'\);/.exec(source)?.[1] || '';
  assert.match(signature, /st\.cure\s*&&\s*st\.cure\.verdict/);
  assert.match(signature, /st\.poolStale\s*&&\s*st\.poolStale\.why/);
});
