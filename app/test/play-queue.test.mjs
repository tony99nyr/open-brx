// F419 (bench part 1, 2026-09-26, one gun on the laptop MCP): four queue-slot cues (`$PLAY,,4,6,<id>,,,,*`) fed 300 ms
// apart were heard as 1, 4, 3, with 2 DROPPED; at 3.5 s apart all four played whole and in order. The gun's queue is not
// the deep FIFO the phone modelled. So the node now sends a queue-slot cue only once the gun it models is free. These
// drive the real Engine's write path on a mocked clock against a fake gun that reproduces the bench behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { CLIP_MS, clipId } from '../src/announcer.js';

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

/** The bench's gun, as far as four cues can show it: one clip plays; up to TWO wait, played newest first; a third
 *  waiting clip pushes the oldest one out. Fed 1, 2, 3, 4 at 300 ms it plays 1, 4, 3 and drops 2, as Tony heard. */
function benchGun(sends) {
  const heard = [], waiting = []; let playingUntil = -Infinity;
  const startNext = t => { while (waiting.length && playingUntil <= t) { const id = waiting.pop(); heard.push(id); playingUntil = Math.max(playingUntil, t) + CLIP_MS[id]; t = playingUntil; } };
  for (const { id, t } of sends) {
    startNext(t);
    if (playingUntil <= t) { heard.push(id); playingUntil = t + CLIP_MS[id]; continue; }
    waiting.push(id); if (waiting.length > 2) waiting.shift();
  }
  startNext(Infinity);
  return heard;
}

function harness() {
  let clock = 1_000_000; const timers = [], sends = [];
  const eng = new Engine({ writer: fr => { for (const f of fr) if (f.startsWith('$PLAY,')) sends.push({ id: clipId(f), t: clock }); return true; },
    emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {},
    delay: (ms, fn) => timers.push({ at: clock + ms, fn }), rng: () => 0 });
  const run = () => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > clock) return; timers.shift().fn(); } };
  return {
    eng, sends,
    async adv(ms, step = 50) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); run(); await new Promise(r => setImmediate(r)); } },
  };
}
const CUES = ['VA6D', 'VA6E', 'VB0P', 'VAA'];   // the bench's four: takes the lead, lost the lead, hill lost, kill
const queued = id => `$PLAY,,4,6,${id},,,,*`;

test('control: the fake gun reproduces the bench (1, 4, 3 heard, 2 dropped, at 300 ms)', () => {
  assert.deepEqual(benchGun(CUES.map((id, i) => ({ id, t: i * 300 }))), ['VA6D', 'VAA', 'VB0P']);
  assert.deepEqual(benchGun(CUES.map((id, i) => ({ id, t: i * 3500 }))), CUES, 'and at 3.5 s all four, in order');
});

for (const n of [2, 3]) {
  test(`F419: ${n} queue-slot cues written 300 ms apart are all heard whole and in order`, async () => {
    const h = harness();
    for (const id of CUES.slice(0, n)) { h.eng._write([queued(id)], `cue ${id}`); await h.adv(300); }
    await h.adv(15000);
    assert.deepEqual(h.sends.map(s => s.id), CUES.slice(0, n), 'every cue is sent, in order');
    assert.deepEqual(benchGun(h.sends), CUES.slice(0, n), `the gun hears them all, in order (sent at ${JSON.stringify(h.sends.map(s => s.t - h.sends[0].t))})`);
  });
}

test('F419: 4 cues 300 ms apart: the first three play whole and in order; the fourth, 6.7 s late, is dropped as stale, never reordered', async () => {
  const h = harness();
  for (const id of CUES) { h.eng._write([queued(id)], `cue ${id}`); await h.adv(300); }
  await h.adv(15000);
  assert.deepEqual(h.sends.map(s => s.id), CUES.slice(0, 3), 'the fourth would start past PLAY_QUEUE_STALE_MS');
  assert.deepEqual(benchGun(h.sends), CUES.slice(0, 3), 'what is sent is heard, in order');
});

test('F419: an INTERRUPT-slot $PLAY (token 1) is not held back behind a playing clip', async () => {
  const h = harness();
  h.eng._write([queued('VB0P')], 'long cue'); await h.adv(300);
  h.eng._write(['$PLAY,VAA,4,6,,,,,*'], 'interrupt'); await h.adv(300);
  assert.equal(h.sends.length, 2, 'the interrupt slot keeps the plain PLAY gap');
  assert.ok(h.sends[1].t - h.sends[0].t < CLIP_MS.VB0P, 'it does not wait for the playing clip');
});

test('F419: a write that carries its own $PLAYX (the hill preempt) is not held back behind the clip it stops', async () => {
  const h = harness();
  h.eng._write([queued('VB0P')], 'long cue'); await h.adv(300);
  h.eng._write(['$PLAYX,0,*', queued('VB0N')], 'preempt'); await h.adv(300);
  assert.equal(h.sends.length, 2, 'the preempt went out at once');
});

test('F419 review: a queue-slot cue that would wait past PLAY_QUEUE_STALE_MS behind the gun is dropped, not played late', async () => {
  const { PLAY_QUEUE_STALE_MS } = await import('../src/engine.js');
  const h = harness();
  h.eng._gun.add(CLIP_MS.A10, 'a 15 s clip on the gun', h.eng.now(), 'A10');
  h.eng._write([queued('VB0N')], 'hill captured'); await h.adv(CLIP_MS.A10 + 1000);
  assert.ok(PLAY_QUEUE_STALE_MS < CLIP_MS.A10, 'setup: the clip outlasts the cap');
  assert.equal(h.sends.length, 0, 'the hill line is stale by the time the gun is free: dropped');
  h.eng._write([queued('VAA')], 'a fresh line'); await h.adv(500);
  assert.equal(h.sends.length, 1, 'and the scheduler is not stuck behind it');
});
