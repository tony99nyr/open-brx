// Generates play-queue-cases.json: the gun's audio play queue (app/src/play-queue.js, ARCH-3) as data. Jobs go in
// (each write's frames, the must-hear flag, the life flag, its time), and the send times and drops come out, with the
// send time `sendAt` planned for each job when it was first seen queued. app/test/play-queue-cases.test.mjs checks
// the file against a fresh run; the bench stage (mcp/brx_mcp/stage/stage.py) is to run the same file.
//
//   node test/fixtures/gen-play-queue-cases.mjs     (from app/; rewrites the file)
//
// A change to the file is a change to the queue's behaviour: read the diff before you commit it.
//
// How a case runs (a second runner must do the same):
// - The clock starts at 0. `gun` clips enter the model at 0 (`add`), in order. A clip's length is `clip_ms[id]`.
// - The events run in time order. At one time, the queue's due timers fire first (in the order they were set), then
//   the events (in file order). `write`: `enqueue(frames, why)` with `mustHear` and `options.lifeBurst`. `hit`: a hit
//   sound enters the model (`add`). `cancel`: `cancelAll()`.
// - The link sends at once and every write succeeds. It hands a group with a `$PLAY` to `track` frame by frame; a group
//   with none applies its stops at once (`stop`), as the engine's `_write` does.
// - A job is named `<why>:<clip id of its $PLAY>` (`-` when the filler drop took it). `planned` is `sendAt(job)` when the
//   job is first seen waiting (null when it went at once). A drop is `must_hear`, `stale` or `cancel`.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlayQueue, PLAYX } from '../../src/play-queue.js';
import { PLAY_GAP_MS, clipId } from '../../src/announcer.js';
import { PLAY_QUEUE_STALE_MS } from '../../src/engine.js';

const Q = id => `$PLAY,,4,6,${id},,,,*`;    // the queue slot (token 4): waits for the gun (F419)
const I = id => `$PLAY,${id},4,6,,,,,*`;    // the interrupt slot (token 1): keeps only the gap
const CLIPS = { A: 1000, B: 1000, C: 1000, D: 1000, L: 800, M: 1500, X: 2000, VAG: 600 };

export const INPUTS = [
  { name: 'F347: two interrupt-slot cues in one write go PLAY_GAP_MS apart',
    events: [{ t: 0, write: [I('A'), I('B')], why: 'pair' }] },
  { name: 'F419: a queue-slot cue waits until the clip on the gun has ended',
    events: [{ t: 0, write: [Q('A')], why: 'one' }, { t: 100, write: [Q('B')], why: 'two' }] },
  { name: 'F419: an interrupt-slot cue does not wait for the clip; it keeps only the gap',
    events: [{ t: 0, write: [Q('A')], why: 'long' }, { t: 100, write: [I('B')], why: 'interrupt' }] },
  { name: 'F419: a write that carries its own $PLAYX (the hill preempt) does not wait for the clip it stops',
    events: [{ t: 0, write: [Q('A')], why: 'long' }, { t: 100, write: [PLAYX, Q('B')], why: 'preempt' }, { t: 200, write: [Q('C')], why: 'after' }] },
  { name: 'F419: a must-hear line does not wait for the gun',
    events: [{ t: 0, write: [Q('A')], why: 'long' }, { t: 100, write: [Q('M')], why: 'kill', must_hear: true }] },
  { name: 'F419: three queue-slot cues 300 ms apart each wait for the one before',
    events: [{ t: 0, write: [Q('A')], why: 'one' }, { t: 300, write: [Q('B')], why: 'two' }, { t: 600, write: [Q('C')], why: 'three' }] },
  { name: 'F419 review: a queue-slot cue that would go past the stale limit is dropped, and the next is not stuck',
    gun: [{ ms: 7000, id: 'X' }],
    events: [{ t: 0, write: [Q('A')], why: 'late' }, { t: 7500, write: [Q('B')], why: 'fresh' }] },
  { name: 'F419 review: at exactly the stale limit the cue still goes',
    gun: [{ ms: 6000, id: 'X' }],
    events: [{ t: 0, write: [Q('A')], why: 'edge' }] },
  { name: 'F493 r1: a spawn/revive burst is never stale',
    gun: [{ ms: 7000, id: 'X' }],
    events: [{ t: 0, write: [Q('L'), '$SPAWN,,*'], why: 'revive', life: true }] },
  { name: 'F419: a must-hear line drops the cues still on the phone, but never a life burst',
    gun: [{ ms: 3000, id: 'X' }],
    events: [{ t: 0, write: [Q('A')], why: 'cue' }, { t: 10, write: [Q('B')], why: 'cue2' }, { t: 20, write: [Q('L'), '$SPAWN,,*'], why: 'revive', life: true },
      { t: 30, write: [Q('M')], why: 'kill', must_hear: true }] },
  { name: 'cancel: every job not yet sent settles, and the next cue keeps the gap behind the last one sent',
    events: [{ t: 0, write: [Q('A')], why: 'sent' }, { t: 10, write: [Q('B')], why: 'held' }, { t: 20, write: [I('C')], why: 'held2' },
      { t: 500, cancel: true }, { t: 600, write: [I('D')], why: 'next' }] },
  { name: 'F347: a filler line inside the PLAY gap is dropped from its write',
    events: [{ t: 0, write: [I('A')], why: 'first' }, { t: 50, write: [Q('VAG'), '$LIFE,0,0,1,*'], why: 'filler' }, { t: 2000, write: [Q('VAG')], why: 'filler-ok' }] },
  { name: 'F437: a two-slot $PLAY is two clips, the interrupt slot first',
    events: [{ t: 0, write: ['$PLAY,A,4,6,B,,,,*'], why: 'two-slot' }, { t: 10, write: [Q('C')], why: 'behind' }] },
  { name: 'stop rule: one $PLAYX removes only the clip playing',
    gun: [{ ms: 1000, id: 'A' }, { ms: 1000, id: 'B' }],
    events: [{ t: 0, write: [PLAYX, Q('C')], why: 'stop1' }, { t: 10, write: [Q('D')], why: 'behind' }] },
  { name: 'stop rule: two $PLAYX clear the model',
    gun: [{ ms: 1000, id: 'A' }, { ms: 1000, id: 'B' }],
    events: [{ t: 0, write: [PLAYX, PLAYX, Q('C')], why: 'stop2' }, { t: 10, write: [Q('D')], why: 'behind' }] },
  { name: 'a hit sound joins the model, and a queued cue waits for it',
    events: [{ t: 0, hit: { ms: 2000, id: 'X' } }, { t: 10, write: [Q('A')], why: 'cue' }] },
  { name: 'F498: a life burst behind three queue-slot cues is planned where it goes',
    events: [{ t: 0, write: [Q('A')], why: 'one' }, { t: 10, write: [Q('B')], why: 'two' }, { t: 20, write: [I('C')], why: 'three' },
      { t: 30, write: [Q('L'), '$SPAWN,,*'], why: 'revive', life: true }] },
  { name: 'F498: a stop ahead of a life burst moves its plan as the send moves it',
    gun: [{ ms: 1000, id: 'A' }, { ms: 1000, id: 'B' }],
    events: [{ t: 0, write: [Q('C')], why: 'cue' }, { t: 10, write: [PLAYX, Q('D')], why: 'stop1' }, { t: 20, write: [Q('L'), '$SPAWN,,*'], why: 'revive', life: true }] },
  { name: 'sendAt today: a cue behind a planned cue that goes stale is planned as if that cue were sent',
    plan_differs: 'sendAt plays the planned job forward as sent and does not apply the stale rule to it (ARCH-3 finding)',
    gun: [{ ms: 7000, id: 'X' }],
    events: [{ t: 0, write: [Q('A')], why: 'stale' }, { t: 10, write: [Q('L'), '$SPAWN,,*'], why: 'revive', life: true }] },
];

const isPlay = f => typeof f === 'string' && f.startsWith('$PLAY,');

/** Runs one case through a fresh PlayQueue. Returns `{ sends, jobs }` (the shape of a case's `expect`). */
export function runCase(c, clipMs = CLIPS) {
  let clock = 0, seq = 0;
  const timers = [], sends = [], known = new Map();
  const label = job => `${job.why}:${clipId(job.group.find(isPlay)) || '-'}`;
  const record = job => {
    if (!known.has(job)) {
      const name = label(job);
      if ([...known.values()].some(r => r.job === name)) throw new Error(`${c.name}: two jobs named ${name}`);
      known.set(job, { job: name, queued_t: job.queuedAt, planned: null, sent: null, dropped: null });
    }
    return known.get(job);
  };
  const q = new PlayQueue({
    now: () => clock, delay: (ms, fn) => { timers.push({ at: clock + ms, fn, n: seq++ }); }, log: () => {},
    clipLen: f => clipMs[clipId(f)] || 0, staleMs: PLAY_QUEUE_STALE_MS, gapMs: PLAY_GAP_MS,
    send: (group, why, options, onSent) => {
      const job = [...q.pending].find(j => j.group === group);
      record(job).sent = clock;
      sends.push({ t: clock, job: label(job), frames: [...group] });
      if (!group.some(isPlay)) q.stop(group.filter(f => f === PLAYX).length, clock);
      else {
        const wire = q.track(group, why, onSent);
        for (const f of group) { if (f === PLAYX) wire.stop(); if (isPlay(f)) wire.play(f); }
      }
      return true;
    },
  });
  for (const g of c.gun || []) q.add(g.ms, 'on the gun', 0, g.id);
  const settle = cancel => {
    for (const job of [...(q.waiting ? [q.waiting] : []), ...q.queue]) {
      const r = record(job);
      if (r.planned == null) r.planned = q.sendAt(job, clock);
    }
    for (const [job, r] of known) {
      if (r.sent != null || r.dropped || q.pending.has(job)) continue;
      r.dropped = { t: clock, rule: cancel ? 'cancel' : job.cancelled ? 'must_hear' : 'stale' };
    }
  };
  const events = [...c.events];
  for (;;) {
    timers.sort((a, b) => a.at - b.at || a.n - b.n);
    const tNext = timers.length ? timers[0].at : Infinity, eNext = events.length ? events[0].t : Infinity;
    if (tNext === Infinity && eNext === Infinity) break;
    if (tNext <= eNext) { clock = tNext; timers.shift().fn(); settle(false); continue; }
    const e = events.shift();
    clock = e.t;
    if (e.write) q.enqueue(e.write, e.why, { options: e.life ? { lifeBurst: true } : undefined, mustHear: !!e.must_hear });
    else if (e.hit) q.add(e.hit.ms, `hit sound ${e.hit.id}`, clock, e.hit.id);
    else if (e.cancel) q.cancelAll();
    else throw new Error(`${c.name}: unknown event at t=${e.t}`);
    settle(!!e.cancel);
  }
  return { sends, jobs: [...known.values()] };
}

export function buildFile() {
  return {
    about: 'The gun audio play queue (app/src/play-queue.js) as data: writes in, send times and drops out. GENERATED by '
      + 'gen-play-queue-cases.mjs beside this file; do not edit by hand. The rules for running a case are in its header.',
    gap_ms: PLAY_GAP_MS, stale_ms: PLAY_QUEUE_STALE_MS, clip_ms: CLIPS,
    cases: INPUTS.map(c => ({ ...c, expect: runCase(c) })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'play-queue-cases.json');
  writeFileSync(out, JSON.stringify(buildFile(), null, 1) + '\n');
  console.log(`wrote ${out}`);
}
