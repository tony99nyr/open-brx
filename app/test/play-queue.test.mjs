// F419 (bench part 1, 2026-09-26, one gun on the laptop MCP): four queue-slot cues (`$PLAY,,4,6,<id>,,,,*`) fed 300 ms
// apart were heard as 1, 4, 3, with 2 DROPPED; at 3.5 s apart all four played whole and in order. The gun's queue is not
// the deep FIFO the phone modelled. So the node now sends a queue-slot cue only once the gun it models is free. These
// drive the real Engine's write path on a mocked clock against a fake gun that reproduces the bench behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { CLIP_MS, clipId } from '../src/announcer.js';
import { mkStorage } from './_helpers.mjs';
import { PlayQueue, PLAYX as PQ_PLAYX } from '../src/play-queue.js';
import { PLAYX, PLAY_QUEUE_STALE_MS } from '../src/engine.js';
import { PLAY_GAP_MS } from '../src/announcer.js';
import { PLAY_SETTLE_MS } from '../src/transport/contract.gen.js';

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

// ---- ARCH-3: the module's own interface (app/src/play-queue.js), on a mock clock with a link that sends at once ----

function queueHarness() {
  let clock = 0; const timers = [], sent = [], logs = [];
  const q = new PlayQueue({ now: () => clock, delay: (ms, fn) => timers.push({ at: clock + ms, fn }), log: m => logs.push(m),
    clipLen: f => ({ A: 1000, B: 1000, C: 1000 })[clipId(f)] || 0, staleMs: PLAY_QUEUE_STALE_MS,
    send: (group, why, options, onSent) => {
      sent.push({ t: clock, why, group: [...group] });
      const wire = q.track(group, why, onSent);
      for (const f of group) { if (f === PLAYX) wire.stop(); if (f.startsWith('$PLAY,')) wire.play(f); }
      return true;
    } });
  const to = t => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > t) break; const x = timers.shift(); clock = x.at; x.fn(); } clock = t; };
  return { q, sent, logs, to, at: () => clock };
}

test('ARCH-3: the module and the engine stop with the same frame', () => assert.equal(PQ_PLAYX, PLAYX));

test('ARCH-3 pacing: two $PLAY in one write go PLAY_GAP_MS apart, and the write settles true once both are sent', async () => {
  const h = queueHarness();
  const done = h.q.enqueue(['$PLAY,A,4,6,,,,,*', '$PLAY,B,4,6,,,,,*'], 'pair');
  assert.deepEqual(h.sent.map(s => s.t), [0], 'the first goes at once');
  h.to(1000);
  assert.deepEqual(h.sent.map(s => s.t), [0, PLAY_GAP_MS]);
  assert.equal(await done, true);
});

test('ARCH-3 F419: a queue-slot cue waits for the gun model to be free; freeAt and outstanding read the model', () => {
  const h = queueHarness();
  h.q.enqueue([queued('A')], 'one');
  assert.equal(h.q.freeAt(0), 1000); assert.equal(h.q.outstanding(0), 1);
  h.to(100); h.q.enqueue([queued('B')], 'two');
  assert.equal(h.q.waiting && h.q.waiting.why, 'two', 'planned on its timer');
  assert.equal(h.q.sendAt(h.q.waiting), 1000);
  h.to(999); assert.equal(h.sent.length, 1, 'CONTROL: not before the clip ends');
  h.to(1000); assert.equal(h.sent.length, 2);
});

test('ARCH-3 stale: a cue that would wait past PLAY_QUEUE_STALE_MS is dropped and settles true; a life burst is not', async () => {
  for (const life of [false, true]) {
    const h = queueHarness();
    h.q.add(PLAY_QUEUE_STALE_MS + 1, 'backlog', 0, 'X');
    const done = h.q.enqueue([queued('A')], 'late', { options: life ? { lifeBurst: true } : undefined });
    h.to(PLAY_QUEUE_STALE_MS + 10);
    assert.equal(h.sent.length, life ? 1 : 0, life ? 'the life burst goes' : 'the cue is dropped');
    assert.equal(await done, true);
    assert.equal(h.q.holding(), false, 'the queue is free again');
  }
});

test('ARCH-3 must-hear: a must-hear line drops the waiting cues, keeps a life burst, and does not wait for the gun', () => {
  const h = queueHarness();
  h.q.add(3000, 'backlog', 0, 'X');
  h.q.enqueue([queued('A')], 'cue');
  h.q.enqueue([queued('B')], 'revive', { options: { lifeBurst: true } });
  assert.ok(h.q.lifeQueued() && h.q.lifeJob(), 'CONTROL: the burst waits');
  h.q.enqueue([queued('C')], 'kill', { mustHear: true });
  assert.ok(h.logs.some(m => /cue dropped before it reached the gun/.test(m)), h.logs.join('\n'));
  h.to(10000);
  assert.deepEqual(h.sent.map(s => s.why), ['revive', 'kill'], 'the burst, then the must-hear line; the cue never');
});

test('ARCH-3 cancel: every unsent job settles true; the next cue keeps the gap behind the last one sent', async () => {
  const h = queueHarness();
  h.q.enqueue([queued('A')], 'sent');
  const held = h.q.enqueue([queued('B')], 'must', { mustHear: true });
  h.to(50);
  assert.equal(h.q.cancelAll(), true, 'a must-hear line was among them');
  assert.equal(await held, true);
  assert.equal(h.q.holding(), false);
  h.q.enqueue(['$PLAY,C,4,6,,,,,*'], 'next');
  assert.equal(h.sent.length, 1, 'CONTROL: not inside the gap');
  h.to(PLAY_GAP_MS); assert.deepEqual(h.sent.map(s => s.why), ['sent', 'next']);
});

test('F463 review: an interrupt-slot write (a stun) never waits behind a queue-slot cue that waits for the gun', () => {
  const h = queueHarness();
  h.q.add(7883, 'the first stun clip', 0, 'X17');
  h.q.enqueue([queued('D27')], 'reload sound');              // waits for X17 to end
  assert.deepEqual(h.sent, [], 'setup: the reload sound waits for the gun');
  h.to(2000);
  h.q.enqueue(['$AMMO,0,0,0,1,*', '$PLAY,X17,4,6,,,,,*'], 'second stun');
  assert.deepEqual(h.sent.map(s => [s.why, s.t]), [['second stun', 2000]], 'the disarm goes at once');
  h.to(20000);
  assert.deepEqual(h.sent.map(s => s.why), ['second stun'], 'the reload sound, planned again behind both clips, goes stale');
  assert.ok(h.logs.some(l => /reload sound dropped: it waited/.test(l)), h.logs.join(' | '));
  // Review r1: a revive burst waiting for the gun carries gun rows. A stun never passes it, so its armed rows cannot
  // land after the disarm.
  const r = queueHarness();
  r.q.add(3000, 'the death scream', 0, 'S');
  r.q.enqueue(['$AMMO,0,30,192,1,*', '$SPAWN,,*', queued('A')], 'revive', { options: { lifeBurst: true } });
  r.to(500);
  r.q.enqueue(['$AMMO,0,0,0,1,*', '$PLAY,X17,4,6,,,,,*'], 'stun');
  assert.deepEqual(r.sent, [], 'the stun waits behind the revive');
  r.to(20000);
  assert.deepEqual(r.sent.map(s => s.why), ['revive', 'stun']);
  // Codex review: a write that holds a queue-slot cue does not jump, so its own interrupt-slot group keeps its place.
  const g = queueHarness();
  g.q.enqueue([queued('A'), '$PLAY,B,4,6,,,,,*'], 'one write');
  g.to(20000);
  assert.deepEqual(g.sent.map(s => s.group[0]), [queued('A'), '$PLAY,B,4,6,,,,,*'], 'A, then B');
});

test('ARCH-3 sendAt: the plan for every queued job is the time it is sent, and sendAt changes nothing', () => {
  const h = queueHarness();
  h.q.add(500, 'hit', 0, 'X');
  h.q.enqueue([queued('A')], 'a'); h.q.enqueue(['$PLAY,B,4,6,,,,,*'], 'b');
  h.q.enqueue([PLAYX, queued('C')], 'c'); h.q.enqueue([queued('A')], 'd', { options: { lifeBurst: true } });
  // F463 review: the interrupt-slot `b` does not wait behind `a` (which waits for the hit): it is sent at once.
  assert.deepEqual(h.sent.map(s => s.why), ['b']);
  const jobs = [h.q.waiting, ...h.q.queue].filter(Boolean), before = JSON.stringify(h.q.clips);
  const plans = jobs.map(j => h.q.sendAt(j));
  assert.equal(JSON.stringify(h.q.clips), before, 'PURE');
  h.to(20000);
  const later = h.sent.slice(1).map(s => s.t);
  assert.deepEqual(plans, later, `planned ${plans}, sent ${later}`);
});

test('A91 dropNamed: a waiting KIT voice preview is dropped at ARMED, and the job behind it goes at once', () => {
  const h = queueHarness();
  h.q.enqueue(['$PLAY,A,4,6,,,,,*'], 'first');
  h.q.enqueue(['$PLAY,B,4,6,,,,,*'], 'apply preview');       // held by the PLAY gap
  h.q.enqueue(['$PLAY,C,4,6,,,,,*'], 'arm cue');             // behind it
  assert.equal(h.q.waiting && h.q.waiting.why, 'apply preview', 'setup: the preview is the waiting job');
  h.q.dropNamed('apply preview');
  h.to(5000);
  assert.deepEqual(h.sent.map(s => s.why), ['first', 'arm cue'], 'the preview never reaches the gun; the cue behind it is not stranded');
});

test('F681: a settleRows write sends its rows at once and its $PLAY PLAY_SETTLE_MS after they settle; plain writes do not wait', () => {
  const h = queueHarness();
  h.q.enqueue(['$AMMO,0,0,0,1,*', '$AMMO,1,0,0,1,*', '$PLAY,X17,4,6,,,,,*'], 'stun', { options: { settleRows: true } });
  assert.deepEqual(h.sent.map(s => [s.group, s.t]), [[['$AMMO,0,0,0,1,*', '$AMMO,1,0,0,1,*'], 0]], 'the zeros go alone, at once');
  h.to(PLAY_SETTLE_MS - 1);
  assert.equal(h.sent.length, 1, 'the clip waits for the zeros to settle');
  h.to(PLAY_SETTLE_MS);
  assert.deepEqual(h.sent.map(s => [s.group, s.t]).slice(1), [[['$PLAY,X17,4,6,,,,,*'], PLAY_SETTLE_MS]], 'then X17, on its own');
  // CONTROL: the same write without the option is one burst, as before.
  const c = queueHarness();
  c.q.enqueue(['$AMMO,0,0,0,1,*', '$PLAY,X17,4,6,,,,,*'], 'stun');
  assert.deepEqual(c.sent.map(s => [s.group, s.t]), [[['$AMMO,0,0,0,1,*', '$PLAY,X17,4,6,,,,,*'], 0]]);
});

test('F678: hold() keeps every $PLAY back until it ends, a job planned before the hold included; sendAt sees it', () => {
  const h = queueHarness();
  h.q.enqueue(['$PLAY,A,4,6,,,,,*'], 'first');
  h.q.enqueue([queued('B')], 'line');              // planned behind A's clip
  const planned = h.q.waiting.sendAt;
  h.q.hold(planned + 500);
  h.to(planned);
  assert.equal(h.sent.length, 1, 'the planned time is inside the hold: not sent');
  h.to(planned + 500);
  assert.deepEqual(h.sent.map(s => [s.why, s.t]).slice(1), [['line', planned + 500]], 'sent when the hold ends');
  const g = queueHarness();
  g.q.hold(400);
  g.q.enqueue(['$PLAY,C,4,6,,,,,*'], 'c');
  assert.equal(g.q.sendAt(g.q.waiting), 400, 'the plan reads the hold');
  g.to(400); assert.deepEqual(g.sent.map(s => s.t), [400]);
  // a write with no $PLAY (gun rows) is not held: holds are about sound
  const r = queueHarness();
  r.q.hold(400);
  r.q.enqueue(['$AMMO,0,0,0,1,*', '$PLAY,X17,4,6,,,,,*'], 'stun', { options: { settleRows: true } });
  assert.deepEqual(r.sent.map(s => s.t), [0], 'the rows go at once');
  r.to(PLAY_SETTLE_MS); assert.equal(r.sent.length, 1, 'the clip waits for the later of the two holds');
  r.to(400); assert.deepEqual(r.sent.map(s => s.t), [0, 400]);
});

test('F681 review: a settleRows write whose rows fail drops its $PLAY, and the write settles false', async () => {
  let clock = 0; const timers = [], sent = [];
  const q = new PlayQueue({ now: () => clock, delay: (ms, fn) => timers.push({ at: clock + ms, fn }), staleMs: PLAY_QUEUE_STALE_MS,
    send: group => { sent.push(group); return group.some(f => f.startsWith('$PLAY,')) ? true : false; } });
  const done = q.enqueue(['$AMMO,0,0,0,1,*', '$PLAY,X17,4,6,,,,,*'], 'stun', { options: { settleRows: true } });
  clock = 1000; for (const t of timers.splice(0)) t.fn();
  assert.deepEqual(sent, [['$AMMO,0,0,0,1,*']], 'the clip never follows a disarm that failed');
  assert.equal(await done, false);
  assert.equal(q.holding(), false, 'the queue is free again');
});

test('F681 review: sendAt counts the hold of a settleRows write whose rows are still on the link', async () => {
  let clock = 0, reply = null; const timers = [], sent = [];
  const q = new PlayQueue({ now: () => clock, delay: (ms, fn) => timers.push({ at: clock + ms, fn }), staleMs: PLAY_QUEUE_STALE_MS,
    clipLen: () => 0,
    send: (group, why, options, onSent) => {
      sent.push({ t: clock, why });
      const wire = q.track(group, why, onSent);
      for (const f of group) if (f.startsWith('$PLAY,')) wire.play(f);
      if (group.some(f => f.startsWith('$PLAY,'))) return true;
      return new Promise(res => { reply = res; });   // the rows: the link answers later
    } });
  const to = t => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > t) break; const x = timers.shift(); clock = x.at; x.fn(); } clock = t; };
  q.enqueue(['$AMMO,0,0,0,1,*', '$PLAY,X17,4,6,,,,,*'], 'stun', { options: { settleRows: true } });
  q.enqueue([queued('A')], 'revive', { options: { lifeBurst: true } });
  const life = q.queue.find(j => j.why === 'revive');
  to(150);
  assert.ok(reply, 'setup: the rows are on the link');
  const plan = q.sendAt(life);
  reply(true); await Promise.resolve(); await Promise.resolve();
  to(5000);
  const real = sent.find(s => s.why === 'revive').t;
  assert.equal(sent.find(s => s.why === 'stun' && s.t > 0).t, 150 + PLAY_SETTLE_MS, 'setup: X17 goes PLAY_SETTLE_MS after the rows settle');
  assert.equal(plan, real, `planned ${plan}, sent ${real}`);
});
