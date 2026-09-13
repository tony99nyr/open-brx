// The diagnostic log ring — split out of app.js for the same reason history.js is: app.js touches
// `document`/`localStorage`/the Capacitor bridge at module scope and cannot be imported in a test.
//
// T1-B (field session 2026-09-12): the ring used to be a flat `LOGMAX` (400) lines, and a long or
// chatty match rolled its OWN early lines out before MC's `pull_log` ever asked for them at the
// whistle — the exact minutes a FAILING match needed were gone by the time anyone could pull them.
// A `LogRing` protects every line written since the last `startMatch()`: only lines from BEFORE the
// current match are ever trimmed for being merely old, and only once they exceed `historyCap`.
// `hardCap` is the one absolute ceiling (a runaway per-tick logger must not grow the ring forever,
// even mid-match) — it should be far above anything a real match writes, and is the ONLY thing that
// can evict a current-match line.

const DEFAULT_HISTORY_CAP = 400;      // the old LOGMAX — still the cap on STALE (pre-match) lines
const DEFAULT_HARD_CAP = 20000;       // safety valve only; ~2-3 MB of short lines, still under the

export class LogRing {
  constructor({ historyCap = DEFAULT_HISTORY_CAP, hardCap = DEFAULT_HARD_CAP } = {}) {
    this.historyCap = historyCap;
    this.hardCap = Math.max(hardCap, historyCap);
    this.lines = [];
    this.seq = 0;              // count of every line ever written (absolute index of the NEXT push)
    this._matchStartSeq = 0;   // absolute seq of the first line that belongs to the CURRENT match
  }

  /** Mark "everything from here on belongs to the match in progress" — nothing at or after this
   *  point is eligible for the historyCap trim, only the hardCap safety valve. Call it once, at
   *  go-live; calling it again (a new match) simply moves the protected boundary forward. */
  startMatch() {
    this._matchStartSeq = this.seq;
  }

  push(line) {
    this.lines.push(line);
    this.seq++;
    this._trim();
  }

  _base() {
    return this.seq - this.lines.length;   // absolute index of lines[0]
  }

  _trim() {
    // The hard ceiling is the only thing allowed to touch a current-match line — a genuine runaway
    // logger must still be bounded, but a normal match never gets near it.
    while (this.lines.length > this.hardCap) this.lines.shift();
    // Anything from before the current match is ordinary history: keep at most `historyCap` of it.
    while (this.lines.length > this.historyCap && this._base() < this._matchStartSeq) this.lines.shift();
  }

  /** The same contract `logSnapshot`/A25's upload used: everything from absolute index `from`
   *  onward, plus how many earlier lines the ring had already dropped by the time this was asked. */
  tail(from = 0) {
    const base = this._base();
    const start = Math.max(0, Math.min(this.lines.length, Math.round(from) - base));
    const lost = Math.max(0, base - Math.round(from));
    return { tail: this.lines.slice(start), lost, through: this.seq };
  }
}
