// Bench 2026-11-14 (app 0.4.41): every revive failed. An `onFrameSent` hook in the engine threw on a `$BMAP,0,98` row,
// and the REAL BrxLink turned that observer bug into a transport failure: it dropped the rest of the burst (`$SPAWN`
// never went), lost the stack, and owed the gun a needless parser reset. These guards inject a throw into each hook the
// link runs, on the real BrxLink, and check that the write still sends every frame, reports the bug loudly, and tells
// a code error apart from a Bluetooth failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrxLink, PARSER_RESET } from '../src/brxlink.js';
import { PlayQueue, PLAYX } from '../src/play-queue.js';
import { useClock } from './_helpers.mjs';

const BURST = ['$PSET,1,0,45,70,0,*', '$SPAWN,,*', '$BMAP,0,98,,,,,*'];
const textOf = dv => new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));

/** The real link on a fake radio. `failChunk(i)`: the i-th chunk rejects at once (a Bluetooth error inside the cap). */
function rig({ failChunk = () => false, log = null } = {}) {
  const chunks = [], logs = [];
  const writeChunk = (id, dv) => { const i = chunks.length; chunks.push(textOf(dv)); return failChunk(i) ? Promise.reject(new Error('Writing characteristic failed.')) : Promise.resolve(); };
  const ble = { initialize: async () => {}, disconnect: async () => {}, startNotifications: async () => {}, connect: async () => {} };
  const link = new BrxLink({ ble, writeChunk, log: log || ((m, c) => logs.push([m, c])) });
  const frames = () => { const out = []; let cur = ''; for (const c of chunks) { cur += c; if (c.endsWith('*')) { out.push(cur); cur = ''; } } return out; };
  return { link, chunks, logs, frames, text: () => logs.map(l => l[0]).join('\n') };
}

const HOOKS = {
  onFrameSent: { onFrameSent: frame => { if (frame.startsWith('$BMAP')) null.at; } },   // the 0.4.41 shape: a null read
  onStart: { onStart: () => { throw new TypeError('onStart broke'); } },
  shouldSend: { shouldSend: () => { throw new TypeError('shouldSend broke'); } },
};

for (const [hook, options] of Object.entries(HOOKS)) {
  test(`a throwing ${hook} never aborts the write: every frame goes, the BUG is logged with its stack, and no parser reset is owed`, async ctx => {
    const settle = useClock(ctx, 400);
    const r = rig();
    await r.link.connect('A', 'GUN-A-1111');
    const outcomes = [];
    const done = r.link.write(BURST, 'revive', { ...options, onOutcome: o => outcomes.push(o) });
    await settle();
    assert.equal(await done, true, 'the write reports sent');
    assert.deepEqual(r.frames(), BURST, 'every frame of the burst reached the gun, $SPAWN included');
    const bug = r.logs.find(([m]) => m.startsWith(`BUG in ${hook} during `));
    assert.ok(bug, `a BUG line names the hook:\n${r.text()}`);
    assert.equal(bug[1], 'le', 'logged loudly');
    assert.match(bug[0], /\n\s+at /, 'with its stack');
    assert.doesNotMatch(r.text(), /write err/, 'not reported as a transport failure');
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].kind, 'sent');
    assert.equal(outcomes[0].faults[0].hook, hook, 'the typed outcome carries the code fault');
    assert.equal(r.link.codeFaults >= 1, true);
    const next = r.link.write('$PING,*', 'poll');
    await settle();
    assert.equal(await next, true);
    assert.ok(!r.chunks.includes(PARSER_RESET), 'no parser reset: every frame went whole');
  });
}

test('a throwing log never aborts a write or a chunk-error report', async ctx => {
  const settle = useClock(ctx, 400);
  const r = rig({ log: () => { throw new Error('log broke'); }, failChunk: i => i === 1 });
  await r.link.connect('A', 'GUN-A-1111');
  const outcomes = [];
  assert.equal(await Promise.race([r.link.write(BURST, 'revive', { onOutcome: o => outcomes.push(o) }), settle().then(() => 'hung')]), false);
  assert.equal(outcomes[0].kind, 'ble');
  const next = r.link.write(BURST, 'again');
  await settle();
  assert.equal(await next, true);
  assert.deepEqual(r.frames().slice(-BURST.length), BURST);
});

test('the typed outcome: a chunk error is "ble", an exception in the link\'s own loop is "code" and owes no parser reset', async ctx => {
  const settle = useClock(ctx, 400);
  const ble = rig({ failChunk: i => i === 0 });
  await ble.link.connect('A', 'GUN-A-1111');
  const seen = [];
  assert.equal(await Promise.race([ble.link.write(BURST, 'b', { onOutcome: o => seen.push(o) }), settle().then(() => 'hung')]), false);
  assert.equal(seen[0].kind, 'ble');
  assert.match(seen[0].error, /Writing characteristic failed/);

  const code = rig();
  await code.link.connect('A', 'GUN-A-1111');
  const got = [];
  assert.equal(await Promise.race([code.link.write(['$PING,*', undefined, '$SPAWN,,*'], 'c', { onOutcome: o => got.push(o) }), settle().then(() => 'hung')]), false);
  assert.equal(got[0].kind, 'code', 'a bad frame is our bug, not the radio');
  assert.match(code.text(), /BUG in write during write "c"/);
  const next = code.link.write('$SPAWN,,*', 'next');
  await settle();
  assert.equal(await next, true);
  assert.ok(!code.chunks.includes(PARSER_RESET), 'no frame was cut mid-way, so no reset');
});

test('a skipped write and a refused write are typed too', async ctx => {
  const settle = useClock(ctx, 400);
  const r = rig();
  const seen = [];
  assert.equal(await r.link.write('$PING,*', 'early', { onOutcome: o => seen.push(o) }), false);
  await r.link.connect('A', 'GUN-A-1111');
  const p = r.link.write('$PING,*', 'skip', { shouldSend: () => false, onOutcome: o => seen.push(o) });
  await settle();
  assert.equal(await p, null);
  assert.deepEqual(seen.map(o => o.kind), ['refused', 'skipped']);
});

// ---- the play queue: a send that throws (the engine runs `atSend` inside it) must not strand the queue ----
test('a throwing atSend settles its job false, logs the BUG, and the next $PLAY still goes', async () => {
  let clock = 0; const timers = [], sent = [], logs = [], outcomes = [];
  const q = new PlayQueue({ now: () => clock, delay: (ms, fn) => timers.push({ at: clock + ms, fn }), log: m => logs.push(m), clipLen: () => 0, staleMs: 10_000,
    send: (group, why, options) => {
      if (options && options.atSend) group = options.atSend(group);
      sent.push(why); return true;
    } });
  const bad = q.enqueue(['$PLAY,A,1,6,,,,,*'], 'revive', { options: { atSend: () => { throw new TypeError('atSend broke'); }, onOutcome: o => outcomes.push(o) } });
  assert.equal(await bad, false, 'the job settles: nothing waits on it for ever');
  assert.equal(q.holding(), false, 'the queue is free');
  assert.ok(logs.some(m => /^BUG in send during revive: atSend broke\n\s+at /.test(m)), logs.join('\n'));
  assert.equal(outcomes[0] && outcomes[0].kind, 'code');
  const next = q.enqueue(['$PLAY,B,1,6,,,,,*'], 'next');
  for (const x of timers.splice(0)) { clock = x.at; x.fn(); }
  assert.equal(await next, true);
  assert.deepEqual(sent, ['next']);
  assert.equal(PLAYX, '$PLAYX,0,*');
});

test('a throwing onSent (run as the $PLAY frame goes, the engine path) never cuts the burst on the real link', async ctx => {
  const settle = useClock(ctx, 400);
  const r = rig();
  await r.link.connect('A', 'GUN-A-1111');
  const q = new PlayQueue({ now: () => Date.now(), delay: (ms, fn) => setTimeout(fn, ms), log: () => {}, clipLen: () => 0, staleMs: 10_000,
    send: (group, why, options, onSent) => {
      const wire = q.track(group, why, onSent);
      return r.link.write(group, why, { ...options, onFrameSent: f => { if (f.startsWith('$PLAY,')) wire.play(f); } });
    } });
  const burst = ['$PSET,1,0,45,70,0,*', '$PLAY,A,1,6,,,,,*', '$SPAWN,,*'];
  const done = q.enqueue(burst, 'revive', { onSent: () => { throw new TypeError('onSent broke'); } });
  await settle();
  assert.equal(await done, true);
  assert.deepEqual(r.frames(), burst, '$SPAWN still went');
  assert.match(r.text(), /BUG in onFrameSent during write "revive" \(frame 2 of 3\): onSent broke\n\s+at /);
  assert.equal(q.holding(), false);
});

test('a throwing onOutcome is logged and the write still resolves', async ctx => {
  const settle = useClock(ctx, 400);
  const r = rig();
  await r.link.connect('A', 'GUN-A-1111');
  const done = r.link.write(BURST, 'revive', { onOutcome: () => { throw new TypeError('report broke'); } });
  await settle();
  assert.equal(await done, true);
  assert.match(r.text(), /BUG in onOutcome during /);
});
