// Persisted outbox ring for node-observed facts (net.md §4, contracts §5 store-and-forward).
// Bounded by count AND age; oldest-first; seq assigned at enqueue; pruned on MC `ack{seq_hi}`.

/** @typedef {{getItem(key:string): string|null, setItem(key:string, value:string): void, removeItem(key:string): void}} RingStorage */
/** @typedef {Record<string, unknown> & {t?: number, match_id?: string|null, node_id?: string, player_id?: string|null}} RingEvent */
/** @typedef {{seq:number, ev:RingEvent, at:number}} RingItem */
/** @typedef {{storage?: RingStorage, key?: string, maxCount?: number, maxAgeMs?: number, now?: () => number, log?: (line: string) => void}} RingOptions */

/** @returns {RingStorage} */
export function memoryStorage() {
  const m = new Map();
  return { getItem: (/** @type {string} */ k) => (m.has(k) ? /** @type {string} */ (m.get(k)) : null), setItem: (/** @type {string} */ k, /** @type {string} */ v) => { m.set(k, String(v)); }, removeItem: (/** @type {string} */ k) => { m.delete(k); } };
}

export function defaultStorage() {
  try { if (globalThis.localStorage) { globalThis.localStorage.getItem('__brx_probe'); return globalThis.localStorage; } } catch (_) { /* blocked */ }
  return memoryStorage();
}

/** How many matches' drop counts the ring remembers (storage stays small). */
export const MAX_MATCHES = 4;

/** M4: the schema version of the persisted outbox (`_save` writes it as `v`). A blob with no `v` is version 1: every blob an
 *  older build wrote. A blob whose `v` is unknown is not restored. */
export const RING_STORE_V = 1;

export class Ring {
  /** @param {RingOptions} [options] */
  constructor({ storage = defaultStorage(), key = 'brx.outbox', maxCount = 500, maxAgeMs = 2 * 60 * 60 * 1000, now = () => Date.now(), log = (/** @type {string} */ l) => console.warn('[outbox]', l) } = {}) {
    this.log = log; this._saveFailing = false; this._dropLogged = false;
    this.storage = storage; this.key = key; this.maxCount = maxCount; this.maxAgeMs = maxAgeMs; this.now = now;
    this.seqNext = 1;
    /** @type {RingItem[]} */
    this.items = /** @type {RingItem[]} */ ([]);
    this.dropped = 0; this.droppedSinceStatus = 0;
    /** M4 r1: set when the store was dropped this session (unknown `v` or corrupt). Nothing queued since was ever sent to MC. */
    this._wasReset = false;
    /** M4 landed-late r2: a renumber whose save failed. The queue is held from the flush until a save stores the new seqs. */
    this._renumberUnsaved = false;
    /** O6: facts dropped per `match_id` (insertion order, at most MAX_MATCHES kept): the heartbeat reports the count for the match in play, so MC never has to guess which match a loss belongs to. @type {Record<string, number>} */
    this.lost = {};
    this._load();
  }
  _load() {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && d.v !== undefined && d.v !== RING_STORE_V) {
        this.log(`outbox store (${this.key}) has unknown schema v ${JSON.stringify(d.v)}: starting clean, any facts it held are lost`);
        this._wasReset = true;
        return;
      }
      if (Number.isInteger(d.seq_next)) this.seqNext = d.seq_next;
      if (Array.isArray(d.items)) this.items = d.items.filter((/** @type {RingItem} */ i) => Number.isInteger(i.seq) && i.ev && typeof i.ev === 'object');
      if (Number.isInteger(d.dropped)) this.dropped = d.dropped;
      // M4 (landed-late review): a reset not yet spent by a welcome is stored with the ring, so a re-dial or an app restart
      // before the first welcome still renumbers above seq_hi. Written only while set: a normal store keeps its old shape.
      if (d.renumber === true) this._wasReset = true;
      if (d.lost && typeof d.lost === 'object') for (const [k, v] of Object.entries(d.lost)) if (Number.isInteger(v)) this.lost[k] = /** @type {number} */ (v);
    } catch (e) {   // corrupt store: start clean, keep seq monotonic via welcome.seq_hi
      this.log(`outbox store unreadable (corrupt): starting clean, any facts it held are lost (${e instanceof Error ? e.message : e})`);
      this._wasReset = true;
    }
  }
  _save() {
    try {
      this.storage.setItem(this.key, JSON.stringify({ v: RING_STORE_V, seq_next: this.seqNext, items: this.items, dropped: this.dropped, lost: this.lost, renumber: this._wasReset || undefined }));
      this._renumberUnsaved = false;
      this._saveFailing = false;
      return true;
    } catch (e) {   // quota: the facts stay in RAM and still go out, but a restart now loses them. Say so once per streak.
      if (!this._saveFailing) this.log(`outbox not saved (quota): ${this.items.length} facts are in memory only (${e instanceof Error ? e.message : e})`);
      this._saveFailing = true;
      return false;
    }
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
    let age = 0, count = 0;
    while (this.items.length && this.items[0].at < cutoff) { this._lose(/** @type {RingItem} */ (this.items.shift())); age++; }
    while (this.items.length > this.maxCount) { this._lose(/** @type {RingItem} */ (this.items.shift())); count++; }
    const d = age + count;
    if (d) {
      this.dropped += d; this.droppedSinceStatus += d;
      // one line per streak: at the cap EVERY push drops one, and a line per fact would flood the log. `prune` (an ack) ends the streak.
      if (!this._dropLogged) this.log(`outbox dropped ${d} facts (${[age ? `age ${age}` : '', count ? `count ${count}` : ''].filter(Boolean).join(', ')}); ${this.dropped} lost in total; further drops in this streak are counted, not logged`);
      this._dropLogged = true;
    }
  }
  /** @param {RingItem} item */
  _lose(item) {
    const k = typeof item.ev.match_id === 'string' ? item.ev.match_id : '';
    this.lost[k] = (this.lost[k] || 0) + 1;
    const keys = Object.keys(this.lost);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_MATCHES))) delete this.lost[old];
  }
  /** Facts dropped from the match `matchId` (0 when none, or when it is long gone from the bounded map). @param {string|null|undefined} matchId */
  lostFor(matchId) { return matchId ? this.lost[matchId] || 0 : 0; }
  /** Oldest-first copies of un-acked facts, each with its seq folded in (the event_batch item shape). */
  pending() { return this.items.map(i => ({ ...i.ev, seq: i.seq })); }
  /** What the flush may send. MC dedupes by (node_id, seq) only, so a renumbered fact must not go out before its new seq is
   *  stored: a restart that renumbered it again would count it twice. Retry the save here; until it works, send nothing.
   *  pending() still counts the held facts (status.pending, recap finality). */
  flushable() { if (this._renumberUnsaved && !this._save()) return []; return this.pending(); }
  /** True while a renumbered queue is not yet stored: a live fact must queue behind it (an ack for a later seq would prune it unsent). */
  get holding() { return this._renumberUnsaved; }
  /** MC durably ingested up to seq_hi — forget those. */
  /** @param {number} seqHi */
  prune(seqHi) {
    const before = this.items.length;
    this._dropLogged = false;
    this.items = this.items.filter(i => i.seq > seqHi);
    if (this.items.length !== before) this._save();
  }
  /** welcome.seq_hi: never reuse a seq MC already holds (wiped-install safety, A4.5). */
  /** @param {number} seqHi */
  adoptSeqHi(seqHi) {
    if (!Number.isInteger(seqHi)) return;
    let changed = false;
    // M4 landed-late r4: while held (a renumber save failed) nothing in the ring has been sent, so a later welcome with a
    // higher seq_hi renumbers it all again above that, or MC would reject the old seqs outside its reorder window.
    if (this._wasReset || this._renumberUnsaved) {
      // M4 r1/r2: the store was dropped, so seq restarted at 1 and every fact queued before this welcome holds a seq MC may already
      // have (it would discard the fact). Nothing in the ring was ever sent (send and flush run after this), so renumber ALL of
      // it above seq_hi, in order: a queue longer than seq_hi must not keep upper seqs that collide with the new ones.
      let next = seqHi + 1;
      for (const i of this.items) i.seq = next++;
      this.seqNext = Math.max(this.seqNext, next);
      // Renumber once, here, and spend the flag whatever the save does: a later welcome must never renumber facts that were
      // already sent under these seqs (MC would count them twice). A failed save is retried by the next save (every enqueue
      // and ack), which writes the renumbered seqs (and clears the stored `renumber`). Until a save works, flushable() holds
      // the queue back: a restart that still finds `renumber` then renumbers facts that were never sent, so none is lost and
      // none reaches MC twice (MC dedupes by (node_id, seq) only).
      this._wasReset = false;
      if (!this._save()) this._renumberUnsaved = true;
      return;
    }
    if (seqHi + 1 > this.seqNext) { this.seqNext = seqHi + 1; changed = true; }
    if (changed) this._save();
  }
  /** Drop count since the last status heartbeat (reported as status.dropped), then reset. */
  takeDropped() { const d = this.droppedSinceStatus; this.droppedSinceStatus = 0; return d; }
  clear() { this.items = []; this._save(); }
}
