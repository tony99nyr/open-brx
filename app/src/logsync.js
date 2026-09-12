// Background log sync — contracts A25, node.md §3.14. GAME SYNC HAS PRIORITY.
//
// MC has asked every player node for its log at every recap since A3 (`pull_log`), and until now no
// phone had a handler at all: the only logs that ever arrived were manual SHARE LOG taps. This is the
// answer, and the whole design is "never get in the game's way":
//
//   - answer ONLY when the match cannot be hurt: not ARMED, not LIVE, and the store-and-forward fact
//     ring empty (an unacked hit/death outranks any log, forever);
//   - otherwise PARK the request and retry 5 s -> 60 s until it can be served. Nothing is dropped: a
//     phone that was out of coverage at recap still delivers its log minutes later;
//   - upload ONE chunk at a time and wait for the socket to drain before the next, so a 300 KB log
//     cannot sit in front of a death event;
//   - remember `uploadedThrough` (the absolute log-line count MC already holds) and send only the
//     tail on a later pull.
//
// Log frames stay OFF the fact ring (they are not facts and must never compete for its seq space) —
// the deferred pull IS their retry.
import { byteLength, MAX_LOG_CHUNK_BYTES } from './transport/envelope.js';

/** The chunk size BOTH log routes cut at — the background sync below and app.js's manual SHARE LOG.
 *  It was written out twice (`MAX_LOG_CHUNK_BYTES - 2048` here, a bare `46 * 1024` there), which is
 *  two numbers that must agree and nothing making them. One export, one value. */
export const DEFAULT_CHUNK_BYTES = MAX_LOG_CHUNK_BYTES - 2048;
/** A refused chunk halves down to this and no further: below it the per-frame overhead dominates and a
 *  log that still will not fit is not a chunking problem. */
export const MIN_CHUNK_BYTES = 4 * 1024;

/** Split `text` into pieces of at most `maxBytes` UTF-8 bytes, never splitting a surrogate pair. */
export function chunkByBytes(text, maxBytes) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let n = Math.min(text.length - i, maxBytes);            // 1 char is >= 1 byte, so this is an upper bound
    let s = text.slice(i, i + n);
    let guard = 0;
    while (byteLength(s) > maxBytes && n > 1 && guard++ < 24) {
      n = Math.max(1, Math.floor((n * maxBytes) / byteLength(s)) - 1);
      s = text.slice(i, i + n);
    }
    if (i + n < text.length) {                              // don't end a chunk on a lone high surrogate
      const c = s.charCodeAt(n - 1);
      if (c >= 0xd800 && c <= 0xdbff && n > 1) { n -= 1; s = text.slice(i, i + n); }
    }
    if (!s) break;
    out.push(s);
    i += n;
  }
  return out;
}

export class LogSync {
  /**
   * @param {object} o
   * @param {function} o.transport  () => Transport|null  (the app REPLACES the transport on every join)
   * @param {function} o.snapshot   (fromLine) => { text, through, lines }  the tail MC has not got
   * @param {function} o.phase      () => engine phase ('idle'|'lobby'|'kitted'|'armed'|'live'|...)
   * @param {function} [o.log]      app logger
   */
  constructor({ transport, snapshot, phase, log = () => {}, timers = globalThis, sleep = null,
                minBackoffMs = 5000, maxBackoffMs = 60000, chunkBytes = DEFAULT_CHUNK_BYTES,
                drainBytes = 16 * 1024, drainTimeoutMs = 20000, pollMs = 50 } = {}) {
    this._transport = transport; this._snapshot = snapshot; this._phase = phase; this._log = log;
    this.timers = timers;
    this.sleep = sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.minBackoffMs = minBackoffMs; this.maxBackoffMs = maxBackoffMs;
    this.chunkBytes = chunkBytes; this.drainBytes = drainBytes; this.drainTimeoutMs = drainTimeoutMs; this.pollMs = pollMs;
    this.uploadedThrough = 0;      // absolute log-line count MC already holds
    this.want = null;              // the parked pull reason, null when nothing is owed
    this.queued = null;            // a pull that arrived DURING an upload: served once this one finishes
    this.held = null;              // why we are not serving it right now
    this.busy = false;             // a chunk stream is in flight
    this.attempt = 0;
    this.uploads = 0; this.bytesSent = 0;
    this._timer = null;
    this._inflight = null;         // test hook: await the in-flight upload
  }

  /** MC asked (`pull_log {reason?}`). Serve it now if it is safe, else park it. */
  request(reason = 'pull') {
    const r = String(reason || 'pull');
    // A pull that lands MID-UPLOAD used to be lost: `_try()` returns early while `busy`, and the
    // upload then clears `want` on the way out — so MC's ask (a LOGS tap during a big recap upload,
    // say) vanished with no retry at all. Queue it instead: the lines written since this upload's
    // snapshot are exactly what MC just asked for, and one more pull serves them.
    if (this.busy) { this.queued = r; return; }
    // A fresh ask does NOT reset an existing backoff: MC re-asks on every log_offer and at every
    // recap, and a reset would turn "patient" into a 5 s poll for as long as the phone is ARMED.
    if (!this.want) this.attempt = 0;
    this.want = r;
    this._try();
  }

  /** Transport reached `bound`. A node that reconnects RE-OFFERS so MC asks again (A25). */
  onBound() {
    if (!this.want) return;
    const t = this._transport();
    if (t && t.state === 'bound') {
      const snap = this._peek();
      t.report('log_offer', { bytes: byteLength(snap.text), lines: snap.lines, from: this.uploadedThrough, reason: 'reconnect' });
    }
    this.attempt = 0;
    this._try();
  }

  /** The manual SHARE LOG route uploaded everything up to `through` — don't re-send it in the background. */
  markUploaded(through) {
    if (Number.isFinite(through) && through > this.uploadedThrough) this.uploadedThrough = through;
  }

  /** `none` | `offered` | `pulling` | `held(<reason>)` — the diag line and `status.log` (A25). */
  state() {
    if (this.busy) return 'pulling';
    if (!this.want) return 'none';
    return this.held ? `held(${this.held})` : 'offered';
  }

  stop() { this.want = null; this.queued = null; this._clear(); }

  // ---------- internals ----------
  _clear() { if (this._timer) { this.timers.clearTimeout(this._timer); this._timer = null; } }
  _peek() { try { return this._snapshot(this.uploadedThrough) || { text: '', through: this.uploadedThrough, lines: 0 }; } catch (_) { return { text: '', through: this.uploadedThrough, lines: 0 }; } }

  /** null when the log may go now, else the reason it is held. Game sync outranks the log, always. */
  _hold() {
    const t = this._transport();
    if (!t || t.state !== 'bound') return 'offline';
    const ph = this._phase();
    if (ph === 'armed' || ph === 'live') return ph;
    let pending = 0;
    try { pending = t.ring ? t.ring.pending().length : 0; } catch (_) { pending = 0; }
    if (pending > 0) return `${pending} facts pending`;
    return null;
  }

  _try() {
    this._clear();
    if (!this.want || this.busy) return;
    const hold = this._hold();
    if (hold) { this.held = hold; this._schedule(); return; }
    this.held = null;
    this._inflight = this._upload().catch(e => {
      this._log(`log sync deferred: ${e && e.message || e}`, 'li');
      // Re-read the gate so the diag line names why we stopped ('held(live)' after a START landed
      // between two chunks), not the stale 'offered' it had while the upload was running.
      this.held = this._hold();
      this._schedule();
    }).finally(() => { this.busy = false; this._drainQueued(); });
  }

  /** Hand the upload that just finished back to whatever MC asked for while it was running. */
  _drainQueued() {
    const q = this.queued;
    if (!q) return;
    this.queued = null;
    // Still owed (the upload aborted): its backoff timer is already armed — let it carry the NEWER
    // reason rather than restarting the clock, which would turn a queued ask into a 5 s poll.
    if (this.want) { this.want = q; return; }
    this.want = q; this.attempt = 0; this._try();
  }

  _schedule() {
    this._clear();
    const delay = Math.min(this.maxBackoffMs, this.minBackoffMs * 2 ** Math.min(this.attempt, 8));
    this.attempt++;
    this._timer = this.timers.setTimeout(() => { this._timer = null; this._try(); }, delay);
  }

  async _upload() {
    this.busy = true;
    const t = this._transport();
    const snap = this._peek();
    const text = snap.text || '';
    const bytes = byteLength(text);
    if (t.report('log_offer', { bytes, lines: snap.lines, from: this.uploadedThrough, reason: this.want }) === false) {
      throw new Error('the socket refused the offer');
    }
    const chunks = chunkByBytes(text, this.chunkBytes);
    if (!chunks.length) chunks.push('');                       // nothing new: one empty `last` chunk closes MC's stream
    for (let i = 0; i < chunks.length; i++) {
      // Re-check between chunks, never mid-chunk: START and a BLE-fed fact both arrive asynchronously,
      // and half a log is worth less than a match. An abort leaves `uploadedThrough` where it was, so
      // the whole tail is re-sent later — MC only ever assembles a complete `last`-terminated stream.
      if (t.state !== 'bound') throw new Error('link dropped mid-upload');
      const ph = this._phase();
      if (ph === 'armed' || ph === 'live') throw new Error(`match went ${ph} mid-upload`);
      if (t.report('log_data', { seq: i, chunk: chunks[i], last: i === chunks.length - 1 }) === false) {
        // This refusal can be DETERMINISTIC, and then the retry is an infinite loop. `chunkBytes`
        // measures the RAW text, but the envelope measures the JSON: a quote-dense chunk (the log
        // ends in `JSON.stringify(engine.state())`, and every `"` costs a backslash) grows on the
        // way onto the wire, so 46 KB of raw log can encode past MAX_ENVELOPE_BYTES and `encode()`
        // throws every single time. Re-sending the identical chunk parks the whole sync at the 60 s
        // backoff forever. Halve the chunk so the next attempt is a different, smaller frame.
        this._shrink(i);
        throw new Error(`the socket refused chunk ${i}`);
      }
      if (i < chunks.length - 1) await this._drain(t);
    }
    this.uploadedThrough = snap.through;
    this.uploads++; this.bytesSent += bytes;
    this.want = null; this.held = null; this.attempt = 0;
    this._log(`log synced to MC — ${bytes} bytes, ${snap.lines} lines, ${chunks.length} chunk(s) ✓`, 'lk');
  }

  /** A refused chunk halves the cut size (down to MIN_CHUNK_BYTES) so the retry is not the same frame. */
  _shrink(i) {
    const next = Math.max(MIN_CHUNK_BYTES, Math.floor(this.chunkBytes / 2));
    if (next >= this.chunkBytes) { this._log(`log chunk ${i} refused at the ${this.chunkBytes} byte floor`, 'le'); return; }
    this.chunkBytes = next;
    this._log(`log chunk ${i} refused — cutting the log at ${next} bytes from here on`, 'li');
  }

  /** One chunk in flight: wait for the socket's buffer to empty before queueing the next. */
  async _drain(t) {
    const t0 = Date.now();
    for (;;) {
      let buffered = 0;
      try { buffered = typeof t.bufferedAmount === 'function' ? t.bufferedAmount() : 0; } catch (_) { buffered = 0; }
      if (buffered <= this.drainBytes) return;
      if (Date.now() - t0 > this.drainTimeoutMs) throw new Error('socket never drained');
      if (t.state !== 'bound') throw new Error('link dropped while draining');
      await this.sleep(this.pollMs);
    }
  }
}
