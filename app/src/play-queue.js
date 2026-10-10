// The gun's audio, in ONE place (ARCH-3, architecture review 2026-10-10, candidate 3): the model of what the gun holds
// (`GunAudio`, docs/announcer.md "The gun's audio FIFO") and the phone's queue of `$PLAY` writes that feeds it (F347,
// F419). The pacing rule, the stop rule and the stale rule are each written once here. The drain and its predictor
// (`sendAt`) both call `_step`, so a planned send time and the real one cannot follow different rules.
//
// The engine owns everything that is not audio: it builds the frames, applies the deny list and the team, and owns
// the link. It hands the queue a write port (`send`, its `_write` tail) and the length of a clip (`clipLen`).
// Time-driven like the announcer: the clock and the timer are the engine's (`now`, `delay`), so a test moves a mock
// clock. app/test/fixtures/play-queue-cases.json pins the send times and drops; gen-play-queue-cases.mjs writes it.
import { PLAY_GAP_MS, clipId, clipMs } from './announcer.js';
import { PLAY_FILLER_IDS } from './transport/contract.gen.js';

/** The one bench-proven stop-playback frame (engine.js `PLAYX` is the same literal; play-queue.test.mjs checks it). */
export const PLAYX = '$PLAYX,0,*';
/** F347: the filler lines a write drops when it would play inside the PLAY_GAP_MS gap behind another `$PLAY`. */
const FILLER_IDS = new Set(PLAY_FILLER_IDS);   // seams D: the contract's list, shared with the stage

const isPlay = f => typeof f === 'string' && f.startsWith('$PLAY,');

/** F419: a `$PLAY` on the gun's QUEUE slot: token 1 empty, the sound id in token 4 (`$PLAY,,4,6,<id>,,,,*`). PURE. */
export function isQueueSlotPlay(f) {
  if (typeof f !== 'string' || !f.startsWith('$PLAY,')) return false;
  const t = f.split(',');
  return !(t[1] || '').trim() && !!(t[4] || '').trim();
}
/** The clips one `$PLAY` puts on the gun, in play order: its interrupt-slot id (token 1), then its queue-slot id
 *  (token 4). A two-slot frame (engine.js `twoSlotPlay`) gives both, each as its own one-slot frame. PURE. */
export function playSlotFrames(f) {
  if (typeof f !== 'string' || !f.startsWith('$PLAY,')) return [];
  const t = f.split(',');
  if (!(t[1] || '').trim() || !(t[4] || '').trim()) return [f];
  const a = t.slice(), b = t.slice(); a[4] = ''; b[1] = '';
  return [a.join(','), b.join(',')];
}

/**
 * The phone's ONE model of the gun's audio (docs/announcer.md, "The gun's audio FIFO"). Bench 2026-09-24 (brx2,
 * Tactix-FE30): the gun QUEUES clips first in, first out; `$PLAYX,0,*` stops only the clip playing, so N stops flush N
 * clips.
 *
 * Every sound-bearing write the phone makes (and every sound the gun makes on its own that the phone can see: a hit's
 * `$SIR` row sound, the native death scream) goes in with its length, so "the gun's FIFO holds these clips until T"
 * is one question with one answer. It over-counts rather than under-counts before a must-hear line: an extra stop
 * there costs a fragment, and a missing one leaves the line late. An extra stop is NOT harmless everywhere: at my death
 * it lands on the native scream, so `_death` sends none when the scream is known (F439: the scream `interrupt`s).
 */
export class GunAudio {
  /** `clipLen(frame)`: a one-slot `$PLAY` frame's length in ms (the engine's reads the bundle's `cue_ms`). */
  constructor(clipLen = clipMs) { this.clipLen = clipLen; this.clips = []; }
  clear() { this.clips = []; }
  /** One clip entered the FIFO at `now`. */
  add(ms, why, now, id = null) {
    if (!(ms > 0)) return;
    this._prune(now);
    const tail = this.clips.length ? this.clips[this.clips.length - 1].end : now;
    const start = Math.max(now, tail);
    const c = { ms, why, start, end: start + ms, id, at: now };
    this.clips.push(c);
    return c;
  }
  /** The clips one `$PLAY` frame puts on the gun at `now`. F437: a two-slot frame is two clips. */
  addPlay(frame, why, now) {
    for (const one of playSlotFrames(frame)) this.add(this.clipLen(one), why, now, clipId(one));
  }
  /** THE stop rule: `n` `$PLAYX,0,*` in one write. One removes the clip playing; two or more clear the model. */
  stop(n, now) {
    if (n >= 2) this.clear();
    else if (n === 1) { this._prune(now); this.clips.splice(0, 1); }
  }
  /** `_death`: one stop the phone wrote itself cut the front clip at `now`; the clips behind it play on from `now`. */
  cutFront(now) {
    this.clips.shift();
    let tail = now;
    for (const c of this.clips) { c.start = tail; c.end = tail + c.ms; tail = c.end; }
  }
  /** Marks whose line the newest clip is (`item`, an announcer item), when it is `frame`'s clip. See `_death`. */
  tagLast(frame, item) {
    const c = this.clips[this.clips.length - 1];
    if (c && c.id === clipId(frame)) c.item = item;
  }
  /** When the last clip the gun can play ends. */
  playingUntil(now) { this._prune(now); return this.clips.reduce((t, c) => (Number.isFinite(c.end) ? Math.max(t, c.end) : t), now); }
  /** Clips playing or waiting on the gun. */
  outstanding(now) { this._prune(now); return this.clips.length; }
  /** When the gun would next be silent. */
  freeAt(now) { this._prune(now); return this.clips.length ? this.clips[this.clips.length - 1].end : now; }
  /** F439 (bench 2026-10-02): a clip that starts AT ONCE and cuts the clip playing (the native death scream, like a
   *  token-1 clip). The clip playing leaves the model; the clips queued behind it wait behind the new one. Returns the
   *  clip it cut, or null when the gun was quiet. `late(clip)` true = the clip playing in the model in fact reached the
   *  gun after the scream started (its write went out just before the phone heard the death): it is not cut, and waits
   *  behind the new one. */
  interrupt(ms, why, now, id = null, late = () => false) {
    this._prune(now);
    const playing = this.clips.length && this.clips[0].start <= now && !late(this.clips[0]) ? this.clips[0] : null;
    if (playing) this.clips.shift();
    const c = { ms, why, start: now, end: now + ms, id, at: now };
    let tail = c.end;
    for (const q of this.clips) { q.start = tail; q.end = tail + q.ms; tail = q.end; }
    this.clips.unshift(c);
    return playing;
  }
  /** A copy of the clips still sounding at `now`, for a prediction to play forward. PURE. */
  copy(now) {
    const g = new GunAudio(this.clipLen);
    g.clips = this.clips.filter(c => c.end > now).map(c => ({ ...c }));
    return g;
  }
  _prune(now) { this.clips = this.clips.filter(c => c.end > now); }
}

/**
 * The play queue: the gun's audio model above, plus the `$PLAY` writes still on the phone. A write with a `$PLAY` goes
 * in as one job per `$PLAY` (`enqueue`) and leaves one at a time (`drain`): PLAY_GAP_MS after the last `$PLAY` sent,
 * and a queue-slot cue only once the gun is free (F419). A job is a plain object; the engine reads `life`, `started`
 * and `cancelled` on it.
 *
 * Ports: `now()`, `delay(ms, fn)`, `log(message)`, `send(group, why, options, onSent, mustHear)` (the engine's write
 * tail: it resolves true, false, or null for a write the link did not send), `clipLen(frame)`, `staleMs`.
 */
export class PlayQueue extends GunAudio {
  constructor({ now, delay, log = () => {}, send, clipLen = clipMs, staleMs, gapMs = PLAY_GAP_MS }) {
    super(clipLen);
    this._now = now; this._delay = delay; this._log = log; this._send = send;
    this.staleMs = staleMs; this.gapMs = gapMs;
    this.nextAt = 0;              // the earliest the next `$PLAY` may go (after `cancelAll`: the gap behind the last one)
    this.lastAt = null;           // when the last `$PLAY` reached the link
    this.pending = new Set();     // every job not yet settled: queued, waiting on its timer, or on the link
    this.queue = [];              // the jobs not yet planned, in order
    this.waiting = null;          // the job planned for later (`job.sendAt`), on its timer
    this.busy = false;            // a job is planned or on the link: the next one waits
    this.inFlight = false;        // a job is on the link
    this.gen = 0;                 // `cancelAll` moves it on: a timer or a link reply of an older generation is void
  }

  /** A write that carries a `$PLAY`: one job per `$PLAY`, each with the frames before the next one. Resolves when every
   *  job has settled: false when any write failed, true otherwise (a dropped or cancelled job counts as true). */
  enqueue(frames, why, { options = undefined, onSent = null, mustHear = false } = {}) {
    const playIndexes = frames.map((f, i) => isPlay(f) ? i : -1).filter(i => i >= 0);
    const now = this._now(), groups = [];
    let startAt = 0;
    for (const ix of playIndexes.slice(1)) { groups.push(frames.slice(startAt, ix)); startAt = ix; }
    groups.push(frames.slice(startAt));
    groups.forEach((group, i) => {
      const sound = group.find(isPlay);
      const delayed = i > 0 || this.busy || this.queue.length || (this.nextAt || 0) > now || (this.lastAt != null && this.lastAt + this.gapMs > now);
      if (delayed && FILLER_IDS.has(clipId(sound))) {
        this._log(`audio: ${why}: filler dropped inside the ${this.gapMs} ms PLAY gap`);
        group.splice(group.indexOf(sound), 1);
      }
    });
    const pending = groups.filter(group => group.length);
    if (mustHear) this.dropWaiting(why);   // F419: the cues still on the PHONE are what the old FIFO's stops cut
    const writes = pending.map((group, i) => new Promise(resolve => {
      const job = { group, why, options, onSent: i === pending.length - 1 ? onSent : null, mustHear, life: !!(options && options.lifeBurst), resolve, cancelled: false, queuedAt: now };
      this.pending.add(job);
      this.queue.push(job);
    }));
    this.drain();
    return Promise.all(writes).then(results => results.every(ok => ok !== false));
  }

  /** THE pacing rule, for the job about to be planned, from a state `s`: the time `t` it is planned from, the earliest
   *  next `$PLAY` (`next`), the last one sent (`last`) and the gun model (`model`). The drain passes the live state;
   *  `sendAt` passes the state it has played forward. `waits`: the job waits for the gun to be free.
   *
   *  F419 (bench part 1, 2026-09-26): the gun's QUEUE slot (`$PLAY,,4,6,<id>,...`, token 4) is not a deep FIFO. Four
   *  cues fed 300 ms apart were heard 1, 4, 3, with 2 dropped; 3.5 s apart, all four played whole and in order. So a
   *  queue-slot cue goes only once the clip the phone models on the gun has ended (`freeAt`). The INTERRUPT slot
   *  (token 1) cuts the playing clip by design and keeps the plain PLAY_GAP_MS; a must-hear line, and any write that
   *  carries its own `$PLAYX` (the hill callout's preempt), stops the clip itself and must not wait for it to end. */
  _step(job, { t, next, last, model }) {
    const waits = !job.mustHear && !job.group.includes(PLAYX) && job.group.some(isQueueSlotPlay);
    return { waits, at: Math.max(t, next || 0, last == null ? 0 : last + this.gapMs, waits ? model.freeAt(t) : 0) };
  }
  /** THE stale rule (F419 review): a job that waited for the gun is dropped, not played late, once it is sent more than
   *  `staleMs` after it was queued. F493 r1: a spawn/revive burst is never stale. Dropped, the gun never gets its
   *  `$SPAWN` while the node shows the player alive. PURE. */
  _stale(job, waits, at) {
    return waits && !job.life && job.queuedAt != null && at - job.queuedAt > this.staleMs;
  }

  /** Plans the next job, and sends it now or when `_step` says. One job at a time: the next drains when it settles. */
  drain() {
    if (this.busy || !this.queue.length) return;
    const job = this.queue.shift(), generation = this.gen;
    this.busy = true;
    const now = this._now();
    const { waits, at } = this._step(job, { t: now, next: this.nextAt, last: this.lastAt, model: this });
    const send = () => {
      if (this.waiting === job) this.waiting = null;
      if (job.cancelled || generation !== this.gen) return;
      this.nextAt = 0;
      if (this._stale(job, waits, this._now())) {
        this._log(`audio: ${job.why} dropped: it waited ${this._now() - job.queuedAt} ms for the gun (stale past ${this.staleMs} ms)`);
        this.pending.delete(job); job.resolve(true); this.busy = false; this.drain();
        return;
      }
      const finish = ok => {
        this.pending.delete(job);
        job.resolve(ok);
        this.inFlight = false;
        this.busy = false;
        this.drain();
      };
      this.inFlight = true; job.started = true;   // F493 r3: handed to the link, no longer waiting in the queue
      const options = { ...job.options, shouldSend: () => !job.cancelled && generation === this.gen
        && (!job.options || !job.options.shouldSend || job.options.shouldSend()) };
      const result = this._send(job.group, job.why, options, job.onSent, job.mustHear);
      if (result && typeof result.then === 'function') result.then(finish, () => finish(false));
      else finish(result);
    };
    job.sendAt = at;   // F497: the planned send, so a queued life burst's weapon delay can count the wait
    if (at > now) { this.waiting = job; job.timer = this._delay(at - now, send); }
    else send();
  }

  /** F498: when a queued job is planned to reach the gun, or null. The drain plans only the job it waits on
   *  (`job.sendAt`), so this plays the jobs ahead forward on a copy of the model with the drain's own `_step`: each sent
   *  job's stops act as `stop` applies them and its clips join the model, and a job ahead that goes stale is dropped
   *  and adds nothing. PURE. */
  sendAt(job, now = this._now()) {
    if (!job || job.cancelled || job.started) return null;
    const w = this.waiting;
    if (w === job) return job.sendAt;
    const ix = this.queue.indexOf(job);
    if (ix < 0) return null;
    const model = this.copy(now);
    let last = this.lastAt, next = this.nextAt || 0, t = now;
    const sent = (j, at) => {
      last = at; next = 0;
      model.stop(j.group.filter(f => f === PLAYX).length, at);
      for (const f of j.group) model.addPlay(f, j.why, at);
    };
    if (w && !w.cancelled && w.sendAt != null) { sent(w, w.sendAt); t = w.sendAt; }
    for (const j of [...this.queue.slice(0, ix), job]) {
      if (j.cancelled) continue;
      const { waits, at } = this._step(j, { t, next, last, model });
      if (j === job) return at;
      t = at;
      if (this._stale(j, waits, at)) continue;   // dropped stale
      sent(j, at);
    }
    return null;
  }

  /** The hooks for one write `send` handed to the link, carrying `frames` (its `$PLAY` and any `$PLAYX`). `stop()` as
   *  each `$PLAYX` goes: the first removes one clip (`stopOne`: the engine passes its `_audioWrite([PLAYX])`), and of two
   *  or more, the second clears the model. `play(frame)` as the `$PLAY` goes: any stop not yet applied first, then the
   *  pacing clock restarts, and the clips enter the model once per write. `noted()`: the clips are in. */
  track(frames, why, onSent = null, stopOne = () => this.stop(1, this._now())) {
    let noted = false, stopsApplied = 0;
    const stopsExpected = frames.filter(f => f === PLAYX).length;
    const stop = () => {
      if (stopsExpected >= 2 && stopsApplied === 1) this.clear();
      else stopOne();
      stopsApplied++;
    };
    const play = frame => {
      while (stopsApplied < stopsExpected) stop();
      this.lastAt = this._now();
      if (noted) return;
      noted = true;
      this.addPlay(frame, why, this._now());
      if (onSent) onSent();
    };
    return { stop, play, noted: () => noted };
  }

  /** F419: a must-hear line (`_sayMust`) goes first. With the queue slot now paced by clip length, the cues it would
   *  have cut with `$PLAYX` on the gun are still waiting on the PHONE, so they are dropped here instead, and `_sayMust`
   *  stops only what the gun really holds. Another must-hear line is kept. Never touches a write already on the air. */
  dropWaiting(why) {
    const drop = job => {
      job.cancelled = true; this.pending.delete(job); job.resolve(true);
      this._log(`audio: ${job.why} dropped before it reached the gun: the must-hear line (${why}) goes first (F419)`);
    };
    const keep = [];
    for (const job of this.queue) { if (job.mustHear || job.life) keep.push(job); else drop(job); }   // F493 r1: nor a spawn/revive burst
    this.queue.length = 0; this.queue.push(...keep);
    const w = this.waiting;
    if (w && !w.mustHear && !w.life) { drop(w); this.waiting = null; this.busy = false; }   // its timer finds it cancelled
  }

  /** Every job not yet settled is cancelled and resolves true (a death, a link drop, the end). A job already on the
   *  link keeps the queue busy until it settles; the next `$PLAY` keeps the gap behind the last one. True when a
   *  must-hear line was among them. */
  cancelAll() {
    let mustHear = false;
    for (const job of this.pending) {
      job.cancelled = true;
      mustHear ||= job.mustHear;
      this.pending.delete(job);
      job.resolve(true);
    }
    this.queue.length = 0; this.waiting = null;
    this.gen++;
    this.busy = this.inFlight;
    this.nextAt = this.lastAt == null ? this._now() : this.lastAt + this.gapMs;
    return mustHear;
  }

  /** A job is queued, planned or on the link. PURE. */
  holding() { return this.pending.size > 0 || this.busy; }
  /** F493 r2: a spawn/revive burst is still unsent (not yet handed to the link). PURE. */
  lifeQueued() { return [...this.pending].some(j => j.life && !j.started); }
  /** F497: the spawn/revive burst still waiting (planned or queued), or undefined. PURE. */
  lifeJob() {
    const w = this.waiting;
    return [...(w ? [w] : []), ...this.queue].find(x => x.life && !x.cancelled && !x.started);
  }
}
