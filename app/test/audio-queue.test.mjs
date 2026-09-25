// The measured gun FIFO, burst and stop rules. F375 uses the real engine tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulateGun, GUN_RULES, PLAYX, play } from '../tools/gun-audio-sim.mjs';
import { SCENARIOS, runScenario, summarise, ENGINE_MIRROR } from '../tools/audio-scenarios.mjs';
import { PLAY_GAP_MS } from '../src/announcer.js';

const run = (writes, natives = [], horizonMs = 12000, rules = GUN_RULES) => simulateGun({ writes, natives, horizonMs }, rules);

test('simulator labels each queue rule by evidence status', () => {
  const src = readFileSync(new URL('../tools/gun-audio-sim.mjs', import.meta.url), 'utf8');
  assert.match(src, /MEASURED 2026-09-24: token-4 clips/);
  assert.match(src, /MEASURED 2026-09-25: two or more stops/);
  assert.match(src, /ASSUMPTION: when a zero-gap burst drops a clip/);
  assert.equal(GUN_RULES.playGapMs, PLAY_GAP_MS);
  assert.equal(ENGINE_MIRROR.PLAY_GAP_MS, PLAY_GAP_MS);
});

test('FIFO: clips 3.5 s apart play in order', () => {
  const g = run([{ t: 0, frames: [play('VA6D')] }, { t: 3500, frames: [play('VA6E')] }, { t: 7000, frames: [play('VAA')] }]);
  assert.deepEqual(g.clips.map(c => [c.id, c.status, c.latency]), [['VA6D', 'full', 0], ['VA6E', 'full', 0], ['VAA', 'full', 0]]);
});

test('zero-gap burst: the model assumes the second clip drops, and keeps the other three', () => {
  const g = simulateGun({ writes: [{ t: 0, frames: [play('VA6D'), play('VA6E'), play('VB0P'), play('VAA')] }], horizonMs: 12000 }, { ...GUN_RULES, writeFrameGapMs: 0 });
  assert.deepEqual(g.clips.map(c => [c.id, c.status]), [['VA6D', 'full'], ['VA6E', 'dropped'], ['VB0P', 'full'], ['VAA', 'full']]);
});

test('a 100 ms send_batch gap does not trigger the zero-gap drop rule', () => {
  const g = run([{ t: 0, frames: [play('VA6D')] }, { t: 100, frames: [play('VA6E')] }, { t: 200, frames: [play('VB0P')] }, { t: 300, frames: [play('VAA')] }]);
  assert.ok(g.clips.every(c => c.status !== 'dropped'));
});

test('two or more stops in one write clear the current clip and its entire queue', () => {
  const g = run([{ t: 0, frames: [play('VA6D')] }, { t: 100, frames: [play('VA6E')] }, { t: 200, frames: [play('VB0P')] },
    { t: 300, frames: [play('VAA')] }, { t: 1500, frames: [PLAYX, PLAYX, PLAYX] }]);
  assert.equal(g.clips[0].status, 'cut');
  assert.deepEqual(g.clips.slice(1).map(c => c.status), ['flushed', 'flushed', 'flushed']);
});

test('one stop cuts only the current clip and starts the next queued clip', () => {
  const g = run([{ t: 0, frames: [play('VA6D')] }, { t: 100, frames: [play('VA6E')] }, { t: 500, frames: [PLAYX] }]);
  assert.deepEqual(g.clips.map(c => [c.id, c.status]), [['VA6D', 'cut'], ['VA6E', 'full']]);
  assert.equal(g.clips[1].start, 500);
});

test('death stops spaced one write apart leave the native scream intact', () => {
  const g = run([{ t: 0, frames: [play('VA6D')] }, { t: 50, frames: [play('VA6E')] }, { t: 100, frames: [PLAYX] }, { t: 250, frames: [PLAYX] }], [{ t: 75, id: 'VA3', cue: 'scream' }], 6000);
  const scream = g.clips.find(c => c.native);
  assert.deepEqual(g.stops.map(s => s.t), [100, 250]);
  assert.equal(g.stops[1].t - g.stops[0].t, PLAY_GAP_MS);
  assert.equal(scream.status, 'full');
});

test('breaking the death rule and batching two stops clears the queued scream', () => {
  const g = run([{ t: 0, frames: [play('VA6D')] }, { t: 50, frames: [play('VA6E')] }, { t: 100, frames: [PLAYX, PLAYX] }], [{ t: 75, id: 'VA3', cue: 'scream' }], 6000);
  assert.equal(g.clips.find(c => c.native).status, 'flushed');
});
