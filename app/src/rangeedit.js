// rangeedit.js: the on-station RANGE edit and its sync to Mission Control (F365, contracts A67).
//
// An operator may change a station's radius (`threshold`, dBm) or its strength (`tx_power`) on the station itself,
// during play, behind a long hold (utility.js wireRangeHold). The edit applies at once. MC hears it on the station's
// next heartbeat `status`, and the LAST edit wins: each field keeps its own source and edit time, and a later
// `station_config` replaces the value only when MC's value is younger than the station's edit.
//
// Pure state, no DOM: utility.js owns the screen and the advert, this owns who set each field, when, and the
// report. Everything persists in its own localStorage key, so an offline edit still syncs after an app restart
// with a correct age. The age is measured on a monotonic clock while the app runs, and on the wall clock (clamped
// to >= 0) after a restart, when the monotonic anchor is gone.
//
// Wire (A67, brx3). These fields are not yet in mcp/brx_mcp/mc/types.py, so contract.gen.js does not carry them;
// regenerate it (mcp/tools/gen_contract.py) once brx3 adds them, and do not hand-edit the generated file.
//   status (station -> MC, every beat):  threshold, threshold_src?, threshold_edit_age_ms?,
//                                        tx_power, tx_power_src?, tx_power_edit_age_ms?, range_edits?
//   station_config (MC -> station):      threshold, threshold_age_ms?, tx_power?, tx_power_age_ms?

export const RANGE_KEY = 'brx.station.range';
export const RANGE_FIELDS = /** @type {const} */ (['threshold', 'tx_power']);
/** The last N edits restated on every beat (A67 addendum 2); MC dedupes them by `seq`. */
export const RANGE_EDITS_MAX = 8;
/** The screen's strength names (utility.js settings.tx) and the wire's (A67: lowercase snake). */
export const TX_TO_WIRE = Object.freeze({ ultraLow: 'ultra_low', low: 'low', medium: 'medium', high: 'high' });
export const TX_FROM_WIRE = Object.freeze({ ultra_low: 'ultraLow', low: 'low', medium: 'medium', high: 'high' });

/** A non-negative age in ms, or null when absent or not a number (an older MC sends no age). */
export function wireAge(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const defaultMono = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : null);
const blank = () => ({ v: 1, seq: 0, sent: 0, f: { threshold: { src: null, seq: 0, at: 0 }, tx_power: { src: null, seq: 0, at: 0 } }, log: [] });

export class RangeEdits {
  /**
   * @param {{ load?: () => any, save?: (s: any) => void, now?: () => number, mono?: () => (number|null) }} [o]
   *   load/save: the persisted state (utility.js: localStorage under RANGE_KEY). now: the wall clock. mono: a
   *   monotonic clock for this run of the app (performance.now), or null where there is none.
   */
  constructor({ load = () => null, save = () => {}, now = () => Date.now(), mono = defaultMono } = {}) {
    this._save = save; this.now = now; this.mono = mono;
    this._anchor = new Map();   // seq -> the monotonic reading at the edit, for edits made in THIS run only
    const s = blank();
    let saved = null; try { saved = load(); } catch (_) { saved = null; }
    if (saved && typeof saved === 'object') {
      if (Number.isInteger(saved.seq) && saved.seq >= 0) s.seq = saved.seq;
      if (Number.isInteger(saved.sent) && saved.sent >= 0) s.sent = Math.min(saved.sent, s.seq);
      for (const k of RANGE_FIELDS) {
        const f = saved.f && saved.f[k];
        if (f && (f.src === 'station' || f.src === 'mc')) s.f[k] = { src: f.src, seq: +f.seq || 0, at: +f.at || 0 };
      }
      if (Array.isArray(saved.log)) s.log = saved.log.filter(e => e && Number.isInteger(e.seq) && RANGE_FIELDS.includes(e.field)).slice(-RANGE_EDITS_MAX);
    }
    this.st = s;
  }
  _persist() { try { this._save(this.st); } catch (_) { /* a full or blocked store must not break the edit */ } }
  /** ms since the edit `seq` made at wall time `at`: monotonic in this run, else the wall clock, never negative. */
  _age(seq, at) {
    const m0 = this._anchor.get(seq), m = m0 == null ? null : this.mono();
    const age = m0 != null && m != null ? m - m0 : this.now() - at;
    return Math.max(0, Math.round(age));
  }
  /** Who set `field` last: 'station', 'mc', or null (nobody yet: the station's own default or a pre-A67 value). */
  src(field) { return this.st.f[field].src; }
  /** ms since the on-station edit of `field`, or null when MC's value (or nobody's) is the one applied. */
  editAge(field) { const f = this.st.f[field]; return f.src === 'station' ? this._age(f.seq, f.at) : null; }
  /** An on-station edit of `field` that no heartbeat has carried to MC yet ("SET HERE · WILL SYNC"). */
  pending(field) { const f = this.st.f[field]; return f.src === 'station' && f.seq > this.st.sent; }
  /** The operator changed `field` on the station, `from` -> `to` (dBm, or the wire strength name). `locked`: an A58
   *  tamper lock was running. Returns the log entry. */
  edit(field, from, to, { locked = false } = {}) {
    const seq = ++this.st.seq, at = this.now(), m = this.mono();
    if (m != null) this._anchor.set(seq, m);
    this.st.f[field] = { src: 'station', seq, at };
    const e = { seq, field, from, to, locked: !!locked, at };
    this.st.log.push(e);
    while (this.st.log.length > RANGE_EDITS_MAX) { const old = this.st.log.shift(); if (old) this._anchor.delete(old.seq); }
    this._persist();
    return e;
  }
  /**
   * MC's `station_config` names a value for `field` with `mcAgeMs` (ms since MC set it; absent from an older MC).
   * The A67 rule: keep the on-station edit when it is YOUNGER than MC's value; otherwise MC's value applies, the
   * edit is dropped and the source becomes 'mc'. No age from MC: MC's value applies, as before A67.
   * @returns {boolean} true when the caller must apply MC's value.
   */
  mcDecides(field, mcAgeMs) {
    const f = this.st.f[field], mcAge = wireAge(mcAgeMs);
    if (f.src === 'station' && mcAge != null && this._age(f.seq, f.at) < mcAge) return false;
    this.st.f[field] = { src: 'mc', seq: 0, at: 0 };
    this._persist();
    return true;
  }
  /** The A67 status fields, computed at send time (ages, not clock times). */
  status() {
    /** @type {Record<string, any>} */ const out = {};
    for (const k of RANGE_FIELDS) {
      const f = this.st.f[k];
      if (f.src) out[`${k}_src`] = f.src;
      if (f.src === 'station') out[`${k}_edit_age_ms`] = this._age(f.seq, f.at);
    }
    if (this.st.log.length) out.range_edits = this.st.log.map(e => ({ seq: e.seq, field: e.field, from: e.from, to: e.to, locked: e.locked, age_ms: this._age(e.seq, e.at) }));
    return out;
  }
  /** A heartbeat carrying `status()` went out on a bound socket: nothing is waiting to sync any more. */
  markSent() { if (this.st.sent !== this.st.seq) { this.st.sent = this.st.seq; this._persist(); } }
}

/**
 * A58 lock -> how long the RANGE hold must last (F365, Tony 2026-09-25). A plain station unlocks with a ~1.5 s hold;
 * a station under an MC tamper lock needs the stronger 5 s hold, so a knock or the normal gesture never overrides it.
 */
export const RANGE_HOLD_MS = 1500;
export const RANGE_OVERRIDE_HOLD_MS = 5000;
export const rangeHoldMs = a58Locked => (a58Locked ? RANGE_OVERRIDE_HOLD_MS : RANGE_HOLD_MS);
/** Editing locks itself again after this long with no touch or keystroke in the RANGE panel. */
export const RANGE_IDLE_MS = 10000;
