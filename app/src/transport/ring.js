// Persisted outbox ring for node-observed facts (net.md §4, contracts §5 store-and-forward).
// Bounded by count AND age; oldest-first; seq assigned at enqueue; pruned on MC `ack{seq_hi}`.

/** @typedef {{getItem(key:string): string|null, setItem(key:string, value:string): void, removeItem(key:string): void}} RingStorage */
/** @typedef {Record<string, unknown> & {t?: number, match_id?: string|null, node_id?: string, player_id?: string|null}} RingEvent */
/** @typedef {{seq:number, ev:RingEvent, at:number}} RingItem */
/** @typedef {{storage?: RingStorage, key?: string, maxCount?: number, maxAgeMs?: number, now?: () => number}} RingOptions */

/** @returns {RingStorage} */
export function memoryStorage() {
  const m = new Map();
  return { getItem: (/** @type {string} */ k) => (m.has(k) ? /** @type {string} */ (m.get(k)) : null), setItem: (/** @type {string} */ k, /** @type {string} */ v) => { m.set(k, String(v)); }, removeItem: (/** @type {string} */ k) => { m.delete(k); } };
}

export function defaultStorage() {
  try { if (globalThis.localStorage) { globalThis.localStorage.getItem('__brx_probe'); return globalThis.localStorage; } } catch (_) { /* blocked */ }
  return memoryStorage();
}

export class Ring {
  /** @param {RingOptions} [options] */
  constructor({ storage = defaultStorage(), key = 'brx.outbox', maxCount = 500, maxAgeMs = 2 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
    this.storage = storage; this.key = key; this.maxCount = maxCount; this.maxAgeMs = maxAgeMs; this.now = now;
    this.seqNext = 1;
    /** @type {RingItem[]} */
    this.items = /** @type {RingItem[]} */ ([]);
    this.dropped = 0; this.droppedSinceStatus = 0;
    this._load();
  }
  _load() {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Number.isInteger(d.seq_next)) this.seqNext = d.seq_next;
      if (Array.isArray(d.items)) this.items = d.items.filter((/** @type {RingItem} */ i) => Number.isInteger(i.seq) && i.ev && typeof i.ev === 'object');
      if (Number.isInteger(d.dropped)) this.dropped = d.dropped;
    } catch (_) { /* corrupt store: start clean, keep seq monotonic via welcome.seq_hi */ }
  }
  _save() {
    try { this.storage.setItem(this.key, JSON.stringify({ seq_next: this.seqNext, items: this.items, dropped: this.dropped })); } catch (_) { /* quota */ }
  }
  get size() { return this.items.length; }
  /** Assign the next seq to a fact and persist it. Returns the seq. */
  /** @param {RingEvent} ev @returns {number} */
  push(ev) {
    const seq = this.seqNext++;
    this.items.push({ seq, ev, at: this.now() });
    this._bound();
    this._save();
    return seq;
  }
  _bound() {
    const cutoff = this.now() - this.maxAgeMs;
    let d = 0;
    while (this.items.length && this.items[0].at < cutoff) { this.items.shift(); d++; }
    while (this.items.length > this.maxCount) { this.items.shift(); d++; }
    if (d) { this.dropped += d; this.droppedSinceStatus += d; }
  }
  /** Oldest-first copies of un-acked facts, each with its seq folded in (the event_batch item shape). */
  pending() { return this.items.map(i => ({ ...i.ev, seq: i.seq })); }
  /** MC durably ingested up to seq_hi — forget those. */
  /** @param {number} seqHi */
  prune(seqHi) {
    const before = this.items.length;
    this.items = this.items.filter(i => i.seq > seqHi);
    if (this.items.length !== before) this._save();
  }
  /** welcome.seq_hi: never reuse a seq MC already holds (wiped-install safety, A4.5). */
  /** @param {number} seqHi */
  adoptSeqHi(seqHi) {
    if (Number.isInteger(seqHi) && seqHi + 1 > this.seqNext) { this.seqNext = seqHi + 1; this._save(); }
  }
  /** Drop count since the last status heartbeat (reported as status.dropped), then reset. */
  takeDropped() { const d = this.droppedSinceStatus; this.droppedSinceStatus = 0; return d; }
  clear() { this.items = []; this._save(); }
}
