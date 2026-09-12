// Background log sync — contracts A25 / node.md §3.14. GAME SYNC HAS PRIORITY.
// MC had asked every phone for its log at every recap since A3 and no phone had a handler at all
// (game test 2026-09-11: nine uploads, every one a manual SHARE LOG tap). These pin the gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LogSync, chunkByBytes, DEFAULT_CHUNK_BYTES, MIN_CHUNK_BYTES } from '../src/logsync.js';
import { byteLength, MAX_LOG_CHUNK_BYTES } from '../src/transport/envelope.js';

/** Manual timer queue: the backoff never actually sleeps in a test. */
function fakeTimers() {
  let id = 1; const q = new Map();
  return {
    setTimeout: (fn, ms) => { const k = id++; q.set(k, { fn, ms }); return k; },
    clearTimeout: k => { q.delete(k); },
    delays: () => [...q.values()].map(v => v.ms),
    size: () => q.size,
    fire() { const e = [...q.entries()][0]; if (!e) throw new Error('no timer armed'); q.delete(e[0]); e[1].fn(); },
  };
}

class FakeTransport {
  constructor({ state = 'bound' } = {}) { this.state = state; this.sent = []; this.facts = []; this.buffered = 0; this.refuse = null; this.onReport = null; }
  get ring() { return { pending: () => this.facts }; }
  report(kind, body) {
    if (this.refuse && this.refuse(kind, body)) return false;
    this.sent.push({ kind, body });
    if (this.onReport) this.onReport(kind, body);
    return true;
  }
  bufferedAmount() { return this.buffered; }
  kinds() { return this.sent.map(s => s.kind); }
  chunks() { return this.sent.filter(s => s.kind === 'log_data'); }
}

/** A log of `n` lines, uploaded from `from`; mirrors app.js's logSnapshot contract. */
function snapshotter(lines) {
  return from => {
    const tail = lines.slice(from);
    return { text: tail.join('\n'), through: lines.length, lines: tail.length };
  };
}
const lines = n => Array.from({ length: n }, (_, i) => `[00:00:00] line ${i}`);

function build({ phase = 'lobby', log = lines(20), state = 'bound' } = {}) {
  const timers = fakeTimers();
  const t = new FakeTransport({ state });
  const ph = { v: phase };
  const ls = new LogSync({ transport: () => t, snapshot: snapshotter(log), phase: () => ph.v, timers, sleep: async () => {} });
  return { timers, t, ph, ls };
}

test('logsync: LIVE and ARMED hold the pull; the match ending serves it (A25 gate)', async () => {
  const { timers, t, ph, ls } = build({ phase: 'live' });
  ls.request('recap');
  assert.equal(ls.state(), 'held(live)');
  assert.deepEqual(t.kinds(), [], 'not one frame while the match is live');
  assert.deepEqual(timers.delays(), [5000], 'parked with the 5 s retry');
  ph.v = 'armed'; timers.fire(); await ls._inflight;
  assert.equal(ls.state(), 'held(armed)');
  assert.deepEqual(t.kinds(), [], 'ARMED is just as closed as LIVE');
  assert.deepEqual(timers.delays(), [10000], 'backoff climbs 5 -> 10');
  ph.v = 'recap'; timers.fire(); await ls._inflight;
  assert.deepEqual(t.kinds(), ['log_offer', 'log_data']);
  assert.equal(t.sent[0].body.reason, 'recap', 'MC\'s reason rides the offer');
  assert.equal(t.sent[0].body.lines, 20);
  assert.equal(t.chunks()[0].body.last, true);
  assert.equal(ls.state(), 'none');
  assert.equal(timers.size(), 0, 'nothing left armed once it is delivered');
});

test('logsync: an unacked fact outranks the log, and the backoff climbs 5 -> 10 -> 20 -> ... -> 60 s', async () => {
  const { timers, t, ls } = build();
  t.facts = [{ seq: 4, type: 'death' }];
  ls.request('offer');
  assert.equal(ls.state(), 'held(1 facts pending)');
  const seen = [5000];
  for (let i = 0; i < 6; i++) { timers.fire(); await ls._inflight; seen.push(timers.delays()[0]); }
  assert.deepEqual(seen, [5000, 10000, 20000, 40000, 60000, 60000, 60000], 'doubles, then holds at the 60 s cap');
  assert.deepEqual(t.kinds(), [], 'still nothing sent while a fact is unacked');
  t.facts = [];                                   // MC acked the death
  timers.fire(); await ls._inflight;
  assert.deepEqual(t.kinds(), ['log_offer', 'log_data']);
  assert.equal(ls.uploadedThrough, 20);
});

test('logsync: a later pull sends only the tail (uploadedThrough)', async () => {
  const log = lines(10);
  const timers = fakeTimers();
  const t = new FakeTransport();
  const ls = new LogSync({ transport: () => t, snapshot: snapshotter(log), phase: () => 'lobby', timers, sleep: async () => {} });
  ls.request('recap'); await ls._inflight;
  assert.equal(t.chunks()[0].body.chunk.split('\n').length, 10);
  for (let i = 10; i < 14; i++) log.push(`[00:00:00] line ${i}`);
  t.sent = [];
  ls.request('manual'); await ls._inflight;
  assert.equal(t.sent[0].body.from, 10, 'the offer says where MC is up to');
  assert.equal(t.sent[0].body.lines, 4);
  assert.equal(t.chunks()[0].body.chunk, log.slice(10).join('\n'), 'only the new lines');
  assert.equal(ls.uploadedThrough, 14);
  // ...and a manual SHARE LOG upload of the whole ring moves the mark too
  ls.markUploaded(99); assert.equal(ls.uploadedThrough, 99);
});

test('logsync: ONE chunk in flight — the next waits for the socket to drain', async () => {
  const timers = fakeTimers();
  const t = new FakeTransport();
  const big = Array.from({ length: 4000 }, (_, i) => `[00:00:00] ${'x'.repeat(60)} ${i}`);
  let polls = 0;
  const ls = new LogSync({
    transport: () => t, snapshot: snapshotter(big), phase: () => 'lobby', timers,
    chunkBytes: 20 * 1024, drainBytes: 1024,
    sleep: async () => { polls++; assert.equal(t.chunks().length, 1, 'no second chunk is queued while the socket is full'); if (polls >= 3) t.buffered = 0; },
  });
  t.buffered = 64 * 1024;                          // the first chunk is still on the wire
  ls.request('recap');
  assert.equal(ls.state(), 'pulling');
  await ls._inflight;
  assert.equal(polls, 3, 'it waited for bufferedAmount to fall');
  const chunks = t.chunks();
  assert.ok(chunks.length >= 2, `expected a multi-chunk upload, got ${chunks.length}`);
  assert.equal(chunks.filter(c => c.body.last).length, 1);
  assert.equal(chunks[chunks.length - 1].body.last, true);
  assert.deepEqual(chunks.map(c => c.body.seq), chunks.map((_, i) => i));
  for (const c of chunks) assert.ok(byteLength(c.body.chunk) <= 20 * 1024, 'chunk over the cap');
  assert.equal(ls.state(), 'none');
});

test('logsync: a socket that refuses, a link that drops, and a match that starts mid-upload all park the pull', async () => {
  // the socket refuses the offer (closing, but `state` has not flipped yet)
  const a = build();
  a.t.refuse = kind => kind === 'log_offer';
  a.ls.request('recap'); await a.ls._inflight;
  assert.equal(a.ls.state(), 'offered', 'still owed');
  assert.deepEqual(a.timers.delays(), [5000]);
  a.t.refuse = null; a.timers.fire(); await a.ls._inflight;
  assert.deepEqual(a.t.kinds(), ['log_offer', 'log_data'], 'retried and delivered');

  // offline: held, and nothing is attempted
  const b = build({ state: 'offline' });
  b.ls.request('reconnect');
  assert.equal(b.ls.state(), 'held(offline)');
  assert.deepEqual(b.t.kinds(), []);
  // the reconnect re-OFFERS so MC asks again (A25), then serves it
  b.t.state = 'bound'; b.ls.onBound(); await b.ls._inflight;
  assert.equal(b.t.sent[0].kind, 'log_offer');
  assert.equal(b.t.sent[0].body.reason, 'reconnect');
  assert.equal(b.ls.state(), 'none');

  // START lands between two chunks: the upload aborts and NOTHING is marked uploaded
  const timers = fakeTimers();
  const t = new FakeTransport();
  const ph = { v: 'lobby' };
  const ls = new LogSync({ transport: () => t, snapshot: snapshotter(lines(2000)), phase: () => ph.v, timers,
                           chunkBytes: 4 * 1024, drainBytes: 1024, sleep: async () => {} });
  t.onReport = kind => { if (kind === 'log_data' && t.chunks().length === 2) ph.v = 'live'; };
  ls.request('recap'); await ls._inflight;
  assert.equal(ls.uploadedThrough, 0, 'a half-sent log is never counted as delivered');
  assert.equal(ls.state(), 'held(live)');
  assert.ok(!t.chunks().some(c => c.body.last), 'MC never saw a `last`, so it assembles nothing');
});

test('logsync: chunkByBytes respects the 48 KB envelope cap and never splits a surrogate pair', () => {
  const text = ('a'.repeat(100) + 'é中🚀').repeat(2000);
  const cap = MAX_LOG_CHUNK_BYTES - 2048;
  const chunks = chunkByBytes(text, cap);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(byteLength(c) <= cap, `${byteLength(c)} > ${cap}`);
  assert.equal(chunks.join(''), text, 'lossless');
  for (const c of chunks) assert.ok(!/[\ud800-\udbff]$/.test(c), 'a lone high surrogate would mangle the JSON');
  assert.deepEqual(chunkByBytes('', 10), []);
});

test('logsync: a chunk the envelope refuses DETERMINISTICALLY shrinks the cut, never an infinite retry', async () => {
  const timers = fakeTimers();
  const t = new FakeTransport();
  const CAP = 10 * 1024;                       // stands in for MAX_ENVELOPE_BYTES, at a sixth of the scale
  // A quote-dense log — exactly the tail app.js appends, `JSON.stringify(engine.state())`. `chunkBytes`
  // measures the RAW text; `encode()` measures the JSON, where every `"` costs a backslash. So a chunk
  // that is inside the cut can still be oversize, and `_sendRaw` then returns false EVERY time: the old
  // code re-sent the identical chunk until the backoff parked at 60 s, forever.
  const log = Array.from({ length: 600 }, (_, i) => JSON.stringify({ i, hp: 100, note: 'q'.repeat(70) }));
  t.refuse = (kind, body) => kind === 'log_data' && byteLength(JSON.stringify(body)) > CAP;
  const ls = new LogSync({ transport: () => t, snapshot: snapshotter(log), phase: () => 'lobby', timers,
                           chunkBytes: 32 * 1024, drainBytes: 1024, sleep: async () => {} });
  ls.request('recap'); await ls._inflight;
  assert.deepEqual(t.chunks(), [], 'the oversize chunk never reached the wire');
  assert.equal(ls.chunkBytes, 16 * 1024, 'the refusal halved the cut before rescheduling');
  assert.equal(ls.state(), 'offered', 'still owed');
  for (let i = 0; i < 6 && ls.want; i++) { timers.fire(); await ls._inflight; }
  assert.equal(ls.state(), 'none', `still owed after six retries at ${ls.chunkBytes} bytes — the retry never changed shape`);
  assert.ok(ls.chunkBytes <= 8 * 1024 && ls.chunkBytes >= MIN_CHUNK_BYTES, `chunkBytes settled at ${ls.chunkBytes}`);
  assert.ok(t.chunks().length > 1, 'the smaller cut delivered the whole log');
  assert.equal(t.chunks().filter(c => c.body.last).length, 1);
  assert.equal(ls.uploadedThrough, log.length);
  for (const c of t.chunks()) assert.ok(byteLength(JSON.stringify(c.body)) <= CAP, 'an oversize frame still went out');
});

test('logsync: the cut never halves below the floor', async () => {
  const timers = fakeTimers();
  const t = new FakeTransport();
  t.refuse = kind => kind === 'log_data';                 // nothing will ever be small enough
  const ls = new LogSync({ transport: () => t, snapshot: snapshotter(lines(500)), phase: () => 'lobby', timers,
                           chunkBytes: 8 * 1024, sleep: async () => {} });
  ls.request('recap'); await ls._inflight;
  for (let i = 0; i < 8; i++) { timers.fire(); await ls._inflight; }
  assert.equal(ls.chunkBytes, MIN_CHUNK_BYTES, 'below the floor the frame overhead dominates — stop halving');
  assert.equal(ls.state(), 'offered', 'and the pull is still owed, on its backoff');
});

test('logsync: a pull that arrives DURING an upload is queued, not lost', async () => {
  const timers = fakeTimers();
  const t = new FakeTransport();
  const log = lines(2000);
  const ls = new LogSync({ transport: () => t, snapshot: snapshotter(log), phase: () => 'lobby', timers,
                           chunkBytes: 4 * 1024, drainBytes: 1024, sleep: async () => {} });
  // MC asks again while chunk 2 is on the wire — the operator's LOGS button during a long recap upload.
  // `_try()` returns early while `busy`, and the finishing upload then cleared `want`: the ask vanished
  // with no retry behind it at all.
  t.onReport = kind => { if (kind === 'log_data' && t.chunks().length === 2) ls.request('logs button'); };
  ls.request('recap');
  await ls._inflight;                     // the first upload
  await ls._inflight;                     // the queued one, started by the first's completion
  const offers = t.sent.filter(s => s.kind === 'log_offer');
  assert.equal(offers.length, 2, 'the pull that landed mid-upload was dropped');
  assert.equal(offers[0].body.reason, 'recap');
  assert.equal(offers[1].body.reason, 'logs button', 'the later reason is the one MC sees');
  assert.equal(offers[1].body.from, log.length, 'the queued pull resumes where the first upload finished');
  assert.equal(ls.state(), 'none');
  assert.equal(ls.queued, null);
  assert.equal(timers.size(), 0, 'nothing left armed');

  // ...and when the upload ABORTS, the queued ask rides the backoff already armed rather than restarting it
  const timers2 = fakeTimers();
  const t2 = new FakeTransport();
  const ph = { v: 'lobby' };
  const ls2 = new LogSync({ transport: () => t2, snapshot: snapshotter(lines(2000)), phase: () => ph.v, timers: timers2,
                            chunkBytes: 4 * 1024, drainBytes: 1024, sleep: async () => {} });
  t2.onReport = kind => { if (kind === 'log_data' && t2.chunks().length === 2) { ph.v = 'live'; ls2.request('logs button'); } };
  ls2.request('recap'); await ls2._inflight;
  assert.equal(ls2.state(), 'held(live)');
  assert.equal(ls2.want, 'logs button', 'the newer reason rides the parked retry');
  assert.deepEqual(timers2.delays(), [5000], 'a queued ask must not restart the backoff clock');
});

test('logsync: both log routes cut at ONE size — the manual SHARE LOG cannot drift', () => {
  assert.equal(DEFAULT_CHUNK_BYTES, MAX_LOG_CHUNK_BYTES - 2048);
  const ls = new LogSync({ transport: () => null, snapshot: () => ({ text: '', through: 0, lines: 0 }), phase: () => 'lobby' });
  assert.equal(ls.chunkBytes, DEFAULT_CHUNK_BYTES, 'the background sync cuts at the shared constant');
  // app.js's SHARE LOG tap had its own `46 * 1024`: two numbers that must agree, with nothing making them.
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /chunkByBytes\(snap\.text, DEFAULT_CHUNK_BYTES\)/, 'SHARE LOG no longer cuts at the shared size');
  assert.doesNotMatch(app, /chunkByBytes\([^)]*\d+\s*\*\s*1024\s*\)/, 'SHARE LOG cuts at a hard-coded size of its own');
});
