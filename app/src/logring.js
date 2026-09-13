// The diagnostic log ring — split out of app.js for the same reason history.js is: app.js touches
// `document`/`localStorage`/the Capacitor bridge at module scope and cannot be imported in a test.
//
// T1-B (field session 2026-09-12): the ring used to be a flat `LOGMAX` (400) lines, and a long or
// chatty match rolled its OWN early lines out before MC's `pull_log` ever asked for them at the
// whistle — the exact minutes a FAILING match needed were gone by the time anyone could pull them.
// A `LogRing` protects every line written since the last `startMatch()` — and, since the polish
// pass of 2026-09-13 (F-4), the match BEFORE it as well, until that match's log has actually been
// pulled or a second later match starts. Only lines from outside that two-match window are ever
// trimmed for being merely old, and only once they exceed `historyCap`.
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
    this._prevMatchSeq = null; // …and to the one BEFORE it while that one is still owed (see `startMatch`)
    this._started = false;     // has any match started at all? Before the first one there is no history to keep.
  }

  /** The absolute index below which a line is ordinary history. The current match's first line, or
   *  the PREVIOUS match's while that match's log has not been pulled and no second match has begun. */
  _protectedFrom() {
    return this._prevMatchSeq === null ? this._matchStartSeq : this._prevMatchSeq;
  }

  /** Mark "everything from here on belongs to the match in progress" — nothing at or after the
   *  protected boundary is eligible for the historyCap trim, only the hardCap safety valve.
   *
   *  The window is TWO matches, not one. Protecting only the current match (which is what moving
   *  one boundary forward did) means the previous match's lines fall back under the cap the instant
   *  the next match writes its first line — and MC's `pull_log` for the failing match routinely
   *  arrives AFTER the next game has started: the operator presses NEW MATCH, the phones re-join,
   *  and the parked pull is finally served (`logsync.js` holds a pull through ARMED/LIVE and retries
   *  5 s → 60 s). That is the exact 2026-09-12 shape this ring exists to prevent, one match later.
   *  So the previous match stays protected until either its log has actually been pulled
   *  (`pulled()`) or a SECOND later match starts. */
  startMatch() {
    this._prevMatchSeq = this._started ? this._matchStartSeq : null;   // nothing before the FIRST match is a match
    this._started = true;
    this._matchStartSeq = this.seq;
  }

  /** MC now holds every line up to absolute index `through` (an upload completed, or the manual
   *  SHARE LOG route went out). Once that covers the previous match — everything before the current
   *  match's first line — that match no longer needs protecting: it is safely off the phone. */
  pulled(through) {
    if (!Number.isFinite(through) || through < this._matchStartSeq) return;
    this._prevMatchSeq = this._matchStartSeq;
    this._trim();
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
    // Anything from before the PROTECTED WINDOW (the current match and the one before it) is
    // ordinary history: keep at most `historyCap` of it.
    while (this.lines.length > this.historyCap && this._base() < this._protectedFrom()) this.lines.shift();
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
