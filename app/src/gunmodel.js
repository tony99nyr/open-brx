// A model of the BRX gun's trigger, ALT, lever and button map, fitted to the bench captures of 2026-11-08 (SR1, SR5,
// SR12, SR15, SR17, SR18, the $BMAP A/B/A and the phone-owned swap prototype). fakegun.js answers WRITES the way CI's
// gun does; this module also answers the BUTTONS, which is where the phone and the gun fall out of step on a swap or a
// reload. app/test/gun-model-replay.test.mjs holds it to the captured gun (app/test/fixtures/bench-gun/), and
// app/test/gun-model-phone.test.mjs drives the phone engine against it.
//
// Encoded, each seen at the bench:
// - `$BMAP,0,<slot>` binds the trigger to fire that slot; `$BMAP,0,98` makes the trigger fire nothing (A/B/A).
// - `$BMAP,1,100,<cycle slots>` gives ALT to the gun. The gun keeps an ALT pointer apart from the trigger binding: ALT
//   moves the pointer to the next slot in the cycle and binds the trigger there, but `$BMAP,0,<slot>` moves only the
//   binding (SR18: a re-asserted `$BMAP,0,0` with the pointer on slot 1 rebound the trigger, and the next ALT moved
//   the pointer to 0 with no visible change). `$BMAP,1,99` and `$BMAP,1,98`: ALT is still reported and swaps nothing.
// - After an ALT swap the gun ignores ALT for the tok15 of the slot it swapped TO (SR1), and the trigger and the lever do
//   nothing for the same time (sr17b: a pull 65 ms after ALT fired nothing, pulls from about tok15 on fire; sr5a: a
//   lever 14 ms after ALT reloaded nothing). A pull held across the end of the swap fires as it ends. An ALT taken
//   with the trigger held stops a burst. After a live hold the trigger then waits for the press plus the larger tok15
//   of the two slots (sr17e2: AR to USP-S, refused 729 ms after ALT, fired at 938); after a dry hold it waits for the
//   release plus the dry slot's tok15 (sr17c: refused 351 ms after the release, fired at 808).
//   The emulator (below) confirmed each of these.
// - A trigger pull fires the bound slot if its magazine has a round. Full auto (t20 = 0) keeps firing while held.
// - `$AMMO,<slot>,<mag>,<reserve>` sets that slot outright, and the gun answers with an `$ALCD` that names the slot that
//   FIRED LAST, at that slot's own count (SR5). `$WEAP` loads a slot and answers for it; `$SPAWN` refills every slot
//   and answers `$LCD` plus an `$ALCD` for slot 0; `$QUERY` answers an `$LCD` for the slot that fired last, and a `$TMP`
//   that sets t4 an `$ALCD` for it.
// - The lever reloads the slot that fired last, not the slot in hand, when it has room and reserve (SR12, SR15). The
//   refill lands about 1.25 x t18 later as one `$ALCD`. The gun ignores ALT and the trigger until it lands (SR15).
// - A dry pull (the bound slot is empty) moves the last-fired slot to it (sr1c: the lever then refilled the slot pulled
//   dry, not the slot that fired the last live round), and blocks ALT (SR17, brx5's fit). Semi auto: for the slot's tok15 from the dry
//   trigger-down, held or released. Full auto: while the trigger is held, then for tok15 after the release (the 850 ms
//   AR edge is tok15 by assumption: one after-release press is decidable in the captures). Live fire blocks nothing.
// - A melee button (`$BMAP,<id>,4`) swings slot 4 once per its t14 (MN1: 3 s); the swing spends nothing.
//
// - `$SPAWN` moves neither the trigger binding nor the ALT pointer (emulator: after ALT to the USP-S and a spawn, the
//   trigger fired the USP-S and the next ALT went to the AR). So a spawn and the phone's `$BMAP,0,0` leave the pointer
//   where the last life left it, the SR18 shape.
//
// The rules above marked "emulator" were run on a private emulator of the stock image (2026-11-08, F668); the bench
// still owes their confirmation.
// Assumed, not seen: `$START` puts the ALT pointer and a bound trigger on slot 0. A melee swing does not move the
// last-fired slot. A `$BMAP,0` rebind starts no swap delay.
// Not encoded (each needs a bench): a Shotgun's shell chain; ALT on 97 (Easy Reload); hits, deaths and the pools (the
// `$LCD` and `$HP` pools are the last `$PSET`'s); the trigger floor between pulls (t14).
//
// Time is the caller's: every input carries `t` in ms, and `advance(t)` runs what falls due (a timed auto round, a
// refill). Answers queue in `take()` as `{t, f}`. `decisions` records every timed call with its distance from the edge
// that decided it, because a bench capture's times are when the phone RECEIVED each frame, and BLE delivers some of
// them late in batches: a call within that jitter of its edge cannot be read from a capture.

export const BTN_TRIGGER = 0, BTN_ALT = 1, BTN_LEVER = 2;
/** The refill lands this many times t18 after the lever (bench 2026-11-08: USP-S 2200 -> 2752 ms, AR 1400 -> 1735 ms). */
export const RELOAD_SCALE = 1.25;
/** `$BMAP` functions: no action, and the "disabled" chirp; both leave ALT reported and swap nothing. */
export const FN_INERT = 98, FN_CHIRP = 99, FN_ALT_CYCLE = 100, FN_MELEE = 4;

const toks = f => f.replace(/^\$/, '').replace(/,?\*$/, '').split(',');
const int = (t, i) => (/^-?\d+$/.test(t[i] || '') ? +t[i] : null);

export class GunModel {
  /** `auto`: 'timed' fires full-auto rounds every t14 while the trigger is held; 'hinted' fires only the first round
   *  and waits for `autoRound()` (a replay of a capture, where the BLE edge times are too coarse to count rounds). */
  constructor({ auto = 'timed' } = {}) {
    this.auto = auto;
    this.w = {};             // slot -> {t14, t15, clip, carried, reserve, t18, semi}: the `$WEAP` tokens the model reads
    this.mag = {}; this.res = {};
    this.pools = [0, 0, 0];  // the last `$PSET`'s maxima, for the spawn `$LCD`
    this.bound = 0;          // the slot the trigger fires (`$BMAP,0,<slot>`), or null on 98
    this.altFn = FN_ALT_CYCLE;
    this.altCycle = [0, 1];
    this.altPtr = 0;         // the gun's own ALT position, apart from the binding
    this.melee = new Set();  // buttons bound to the melee slot
    this.lastFired = 0;      // the slot a lever reloads and an `$AMMO` answer names
    this.lastSwing = null;
    this.altLockUntil = -Infinity;   // ALT is ignored until then (the tok15 of the slot swapped to, from the press)
    this.fireLockUntil = -Infinity;  // the trigger fires nothing until then (the same tok15, from the release if held)
    this.swapOnRelease = null;       // an ALT taken in a dry hold: {until, dryMs}, finished at the release
    this.heldFireAt = null;          // a full-auto trigger held through the swap fires when the swap ends
    this.lastBindAt = -Infinity;     // the last `$BMAP,0` write, for the margin of a pull just after it
    this.trigger = null;     // {at, live} while held: live = the pull fired
    this.lastPull = null;
    this.dry = null;         // {slot, at, semi, ms, upAt}: the last dry pull, for the ALT block
    this.reload = null;      // {slot, until}
    this.nextAuto = null;    // the due time of the next timed auto round
    this.out = [];
    this.decisions = [];     // [t, what, margin ms from the deciding edge (Infinity when no edge was near)]
  }

  // ---------- inputs ----------
  /** One phone write (a frame string) at time `t`. */
  write(f, t) {
    this.advance(t);
    const k = toks(f), cmd = k[0], s = int(k, 1);
    if (cmd === 'START') { this._newLife(); this.altPtr = 0; if (this.bound != null) this.bound = 0; }
    else if (cmd === 'BMAP' && s === BTN_TRIGGER) { this.lastBindAt = t; this._bmap(s, k.slice(2).map(x => (/^\d+$/.test(x) ? +x : null))); }
    else if (cmd === 'PSET') this.pools = [int(k, 3) ?? 0, int(k, 4) ?? 0, 0];
    else if (cmd === 'WEAP' && s != null) {
      const clip = int(k, 17), carried = int(k, 18);
      const reserve = int(k, 41) ?? (carried == null ? 0 : Math.floor(carried / 2));
      this.w[s] = { t14: int(k, 15) ?? 100, t15: int(k, 16) ?? 0, clip: clip ?? 0, carried: carried ?? reserve, reserve,
        t18: int(k, 19) ?? 0, semi: (int(k, 21) ?? 0) !== 0 };
      this.mag[s] = clip ?? 0; this.res[s] = reserve;
      this.lastFired = s;    // the `$LCD` after a head reports the last slot loaded (`$LCD,0,0,0,4,1,0` after slot 4)
      this._alcd(s, t);
    } else if (cmd === 'SPAWN') {
      for (const [slot, w] of Object.entries(this.w)) { this.mag[slot] = w.clip; this.res[slot] = w.carried; }
      this._newLife();
      this._emit(t, `$LCD,${this.pools[0]},${this.pools[1]},0,0,${this.mag[0] ?? 0},${this.res[0] ?? 0},*`);
      this._alcd(0, t);
    } else if (cmd === 'AMMO' && s != null) {
      if (int(k, 2) != null) this.mag[s] = int(k, 2);
      if (int(k, 3) != null) this.res[s] = int(k, 3);
      this._alcd(this.lastFired, t);   // SR5: the answer names the slot that fired last, at its own count
    } else if (cmd === 'LIFE' && [1, 2, 3].every(i => !int(k, i))) {
      // the phone's liveness probe (`$LIFE,0,0,0`): the gun answers its pools (fake.py); hits are not modelled
      this._emit(t, this.dead ? '$HP,0,0,0,*' : `$HP,${this.pools[0]},${this.pools[1]},0,*`);
    } else if (cmd === 'TMP') {
      // sr11 (one sample): `$TMP,,,,0` (t4, the accuracy) was answered by an `$ALCD` for the slot that fired last; a
      // `$TMP` that sets only t8 was not
      if (int(k, 4) != null) this._alcd(this.lastFired, t);
    } else if (cmd === 'QUERY') {
      const s0 = this.lastFired;
      this._emit(t, `$LCD,${this.pools[0]},${this.pools[1]},0,${s0},${this.mag[s0] ?? 0},${this.res[s0] ?? 0},*`);
    } else if (cmd === 'BMAP' && s != null) this._bmap(s, k.slice(2).map(x => (/^\d+$/.test(x) ? +x : null)));
  }

  /** One `$BUT,<id>,<state>` edge at time `t`. */
  button(id, state, t) {
    this.advance(t);
    if (id === BTN_TRIGGER) return state === 1 ? this._pull(t) : this._release(t);
    if (state !== 1) return;
    if (id === BTN_ALT) this._alt(t);
    else if (id === BTN_LEVER) this._lever(t);
    else if (this.melee.has(id)) this._swing(t);
  }

  /** Run what falls due up to `t`: timed auto rounds and a refill, in time order. */
  advance(t) {
    for (;;) {
      const r = this.reload && this.reload.until <= t ? this.reload.until : Infinity;
      const a = this.nextAuto != null && this.nextAuto <= t ? this.nextAuto : Infinity;
      const h = this.heldFireAt != null && this.heldFireAt <= t ? this.heldFireAt : Infinity;
      if (r === Infinity && a === Infinity && h === Infinity) return;
      if (r <= a && r <= h) this._refill();
      else if (h <= a) { this.heldFireAt = null; this._heldFire(h); }
      else { this.nextAuto = null; this.autoRound(a); }
    }
  }

  /** One more full-auto round in the pull that is held (or was just released, inside the BLE edge jitter). Returns
   *  false and fires nothing when the gun could not: a semi-auto slot, a dry pull, or an empty magazine. */
  autoRound(t) {
    const p = this.trigger || this.lastPull, s = p && p.slot, w = this.w[s];
    if (!p || !p.live || s !== this.bound || t < this.fireLockUntil || !w || w.semi || !(this.mag[s] > 0)) return false;
    this._shot(s, t);
    if (this.auto === 'timed' && this.trigger) this.nextAuto = t + w.t14;
    return true;
  }

  /** The gun reported a death (an `$LCD` with empty pools): the hits that caused it are not modelled, so a replay
   *  passes the gun's own report in. A dead gun fires nothing until `$SPAWN`. */
  died(t) { this.dead = true; this.trigger = null; this.reload = null; this._decide(t, 'died', Infinity); }

  // ---------- reads ----------
  take() { const o = this.out; this.out = []; return o; }
  state() {
    return { bound: this.bound, altPtr: this.altPtr, lastFired: this.lastFired, mag: { ...this.mag }, res: { ...this.res },
      reloading: this.reload ? this.reload.slot : null };
  }
  /** Would ALT swap at `t`? `[null, margin]` when it would, else `[why, margin]`. PURE. */
  altBlock(t) {
    if (this.altFn !== FN_ALT_CYCLE) return ['ALT unbound', Infinity];
    let margin = Math.abs(t - this.altLockUntil);
    if (t < this.altLockUntil) return ['lockout', margin];
    if (this.reload) return ['reloading', Math.abs(t - this.reload.until)];
    const d = this.dry;
    if (d) {
      const edge = d.semi ? d.at + d.ms : d.upAt == null ? Infinity : d.upAt + d.ms;
      margin = Math.min(margin, Math.abs(t - edge));
      if (t < edge) return [d.semi ? 'dry pull' : 'dry hold', margin];
    }
    return [null, margin];
  }

  // ---------- the rules ----------
  _newLife() {
    this.dead = false;
    this.lastFired = 0; this.altLockUntil = -Infinity; this.fireLockUntil = -Infinity; this.swapOnRelease = null;
    this.heldFireAt = null; this.dry = null; this.reload = null; this.lastSwing = null;
  }
  _bmap(id, fn) {
    if (id === BTN_TRIGGER) { this.bound = fn[0] != null && fn[0] < FN_INERT ? fn[0] : null; return; }
    for (const [b, set] of [[id, this.melee]]) { if (fn[0] === FN_MELEE) set.add(b); else set.delete(b); }
    if (id === BTN_ALT) {
      this.altFn = fn[0];
      if (fn[0] === FN_ALT_CYCLE) { const c = fn.slice(1).filter(x => x != null && x < FN_INERT); if (c.length) this.altCycle = c; }
    }
  }
  _pull(t) {
    const s = this.bound, w = this.w[s];
    const live = p => { this.trigger = { at: t, live: p, slot: s }; };
    if (this.dead) { live(false); return this._decide(t, 'pull: dead', Infinity); }
    if (this.reload) { live(false); return this._decide(t, 'pull refused: reloading', Math.abs(t - this.reload.until)); }
    const bindMargin = t - this.lastBindAt;   // swp1: a pull 13 ms after `$BMAP,0,1` met the old binding
    if (t < this.fireLockUntil) {
      live(false);
      // sr17e2, and the emulator for a semi-auto slot: a pull held through the end of the swap fires as it ends
      if (s != null && w && this.mag[s] > 0 && this.fireLockUntil < Infinity) this.heldFireAt = this.fireLockUntil;
      return this._decide(t, 'pull refused: swapping', Math.min(this.fireLockUntil - t, bindMargin));
    }
    if (s != null && w && this.mag[s] > 0) {
      live(true); this.dry = null;
      this._shot(s, t);
      if (this.auto === 'timed' && !w.semi) this.nextAuto = t + w.t14;
      return this._decide(t, `fired slot ${s}`, Math.min(t - this.fireLockUntil, bindMargin));
    }
    live(false);
    if (s == null) return this._decide(t, 'pull: trigger unbound', bindMargin);
    this.dry = { slot: s, at: t, semi: !!(w && w.semi), ms: w ? w.t15 : 0, upAt: null };
    this.lastFired = s;   // sr1c: after a live AR round, dry pulls on the empty USP-S, then the lever refilled the USP-S
    this._decide(t, `dry pull on slot ${s}`, Infinity);
  }
  _release(t) {
    if (this.dry && this.dry.upAt == null) this.dry.upAt = t;
    this.lastPull = this.trigger;
    this.trigger = null; this.nextAuto = null; this.heldFireAt = null;
    if (this.swapOnRelease) { this.fireLockUntil = Math.max(this.swapOnRelease.until, t + this.swapOnRelease.dryMs); this.swapOnRelease = null; }
  }
  _alt(t) {
    if (this.dead) return this._decide(t, 'ALT: dead', Infinity);
    const [why, margin] = this.altBlock(t);
    if (why) return this._decide(t, `ALT refused: ${why}`, margin);
    const c = this.altCycle, i = c.indexOf(this.altPtr), t15 = s => (this.w[s] ? this.w[s].t15 : 0);
    const from = this.bound;
    this.altPtr = c[(i + 1) % c.length];
    this.bound = this.altPtr;
    const ms = t15(this.altPtr);
    this.altLockUntil = t + ms;
    if (this.trigger && this.trigger.live) {
      // a live hold: the burst stops, and the trigger waits for the larger tok15 of the two slots (sr17e2, emulator)
      this.fireLockUntil = t + Math.max(ms, t15(from)); this.nextAuto = null; this.trigger.live = false;
    } else if (this.trigger && this.dry) {
      // a dry hold: the trigger waits for the release plus the dry slot's tok15 (sr17c, emulator)
      this.fireLockUntil = Infinity; this.swapOnRelease = { until: t + ms, dryMs: this.dry.ms };
    } else this.fireLockUntil = t + ms;
    this.dry = null;
    this._decide(t, `ALT to slot ${this.altPtr}`, margin);
  }
  _lever(t) {
    if (this.reload) return;
    if (t < this.altLockUntil) return this._decide(t, 'lever refused: swapping', this.altLockUntil - t);   // sr5a: 14 ms after ALT
    const s = this.lastFired, w = this.w[s];
    if (!w || !(this.mag[s] < w.clip) || !(this.res[s] > 0)) return this._decide(t, `lever: slot ${s} needs nothing`, Infinity);
    this.reload = { slot: s, until: t + Math.round(w.t18 * RELOAD_SCALE) };
    this._decide(t, `lever reloads slot ${s}`, Infinity);
  }
  _refill() {
    const { slot: s, until } = this.reload, w = this.w[s];
    const take = Math.min(w.clip - this.mag[s], this.res[s]);
    this.mag[s] += take; this.res[s] -= take;
    this.reload = null;
    if (take > 0) this._alcd(s, until);   // sr1c: a phone `$AMMO` that filled the slot first leaves the refill nothing to say
  }
  _swing(t) {
    const w = this.w[4];
    const edge = (this.lastSwing ?? -Infinity) + (w ? w.t14 : 0);
    if (!w || t < edge) return this._decide(t, 'swing refused: cooldown', Math.abs(t - edge));
    this.lastSwing = t;
    this._alcd(4, t);
    this._decide(t, 'swing', Math.abs(t - edge));
  }
  _heldFire(t) {
    const s = this.bound, w = this.w[s];
    if (!this.trigger || this.dead || this.reload || !w || !(this.mag[s] > 0)) return;
    this.trigger = { ...this.trigger, live: true, slot: s }; this.dry = null;
    this._shot(s, t);
    if (this.auto === 'timed') this.nextAuto = t + w.t14;
    this._decide(t, `fired slot ${s} as the swap ended, trigger held`, Infinity);
  }
  _shot(s, t) { this.mag[s]--; this.lastFired = s; this._alcd(s, t); }
  _alcd(s, t) { this._emit(t, `$ALCD,${this.mag[s] ?? 0},100,${s},${this.res[s] ?? 0},0,*`); }
  _emit(t, f) { this.out.push({ t, f }); }
  _decide(t, what, margin) { this.decisions.push([t, what, margin]); }
}
