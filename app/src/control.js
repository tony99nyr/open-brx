// control.js — the CONTROL POINT (kind 5) state machine: docs/spec/utility.md §5 row `control`,
// FOLLOWUPS K1. DOM/BLE-free and pure, like beacon.js, so it runs in node tests, the desktop stage and
// on the phone unchanged. `utility.js` drives it from `Presence.players()`; the numbers it produces go out
// in three advert bytes and nowhere else, so a control point works with NO LAN and no Mission Control.
//
// THE MODEL (owner's decisions, 2026-09-10):
//
//  1. **Rate is the NET DIFFERENCE of living, PRESENT players** (spec §5d.1). Only a player whose advert
//     says alive (byte 10 bit 0) and whose smoothed RSSI has held the station's threshold for its dwell
//     counts. `net = the leading team's count − the LARGEST SINGLE OTHER team's count`, never the sum of
//     the others: only one rival team of equal size may stall you, so 2v1 converts at the 1v0 rate, 2v0 at
//     twice it, and **2v1v1 converts slowly rather than stalling**. In a two-team game those two readings
//     are identical, which is exactly why the rule has to be written down rather than inferred. A tie for
//     the lead nets zero, `net` is never negative (the leader is by definition the largest), and `net` is
//     clamped to `netCap`. There is deliberately **no freeze-on-contested**: an even fight stalls because
//     the arithmetic says so, and one extra body always moves the needle.
//  2. **Two phases on a 0-100 scale** (so it fits advert byte 11, `value`): an enemy-held point must be
//     DRAINED to 0 — at which moment it goes neutral and its owners have LOST it — and only then BUILT up
//     to 100 for its new owner. Stealing a point is therefore twice the work of taking a neutral one, and
//     there is no instant flip anywhere in the path.
//  3. **Contested is a real, measured state here.** The station counts living bodies of each team inside
//     its own bubble, so "two teams are on this point" is a fact. That is what separates this from the
//     grenade path, where F75 proved a non-capturing IR hit emits nothing at all and "contested" could
//     only ever have been inferred from a miss.
//  4. 🔴 **F82: tid 2 can never hold a point.** A NEUTRAL grenade hill broadcasts team 2, so the phone's
//     shared hill model reads 2 as "nobody", and a tid-2 player cannot tell "nobody holds it" from "we
//     hold it". The station therefore refuses tid 2 outright: those players are counted in the roster and
//     shown, but they contribute nothing and can never be named as the owner. The fix belongs in MC's team
//     assignment (use 0, 1, 3); this is the station refusing to produce a state nobody can read.
//
// What the three advert bytes carry (`advert()`):
//
//   byte  9  team    the team the progress belongs to: the OWNER while it is held, else the team currently
//                    building it up, else 255 (neutral, nobody advancing)
//   byte 10  state   bit0 held · bit1 contested · bit2 rising · bit3 falling
//   byte 11  value   progress 0..100 for that team
//
// `held` is what makes byte 9 unambiguous: team 0 + held means RED owns it, team 0 without held means RED
// is at `value`% of taking it and NOBODY owns it yet. Ownership changes only at 100 (build) and 0 (drain),
// never in between, which is condition 2 expressed on the wire.

import { TEAM_ANY, PLAYER_STATE } from './beacon.js';

/** Advert byte 10 for kind 5. */
export const CONTROL_STATE = { held: 1, contested: 2, rising: 4, falling: 8 };
/** Advert byte 9 when nobody owns the point and nobody is advancing on it. */
export const NEUTRAL = TEAM_ANY;
/** F82: the tid a NEUTRAL hill broadcasts, so it can never mean a real owner. */
export const REFUSED_TID = 2;
/** Seconds ONE net player needs for ONE phase (spec §5d.1: `rate = net * 100 / capture_s`). At 10 s a lone
 *  player takes a neutral point in 10 s and steals a held one in 20; two of them halve both. Operator-tunable. */
export const DEFAULT_CAPTURE_S = 10;
/** §5d.1: `net` is clamped here so a six-player rush is fast and not instant. Proposed, not measured. */
export const DEFAULT_NET_CAP = 3;
/** A tick longer than this is a backgrounded phone or a paused debugger, not elapsed play: clamp it so a
 *  station that was asleep does not hand somebody the point on its first tick back. */
const MAX_STEP_MS = 1000;

/** Can this tid own a point at all? 0..3 are the four $TID teams; 4-7 are colours, not teams; 255 is
 *  "any"; and 2 is refused by F82. */
export function claimable(tid) { return tid === 0 || tid === 1 || tid === 3; }

/**
 * One control point. `update(players, now)` is the whole state machine; everything else is a reader.
 *
 *   owner      the team that HOLDS it (progress reached 100), or NEUTRAL
 *   capturing  while neutral, the team currently building progress up, else null
 *   progress   0..100, always "how far along the team named by owner-or-capturing is"
 *   lastOwner  who held it before it went neutral — so a capture can name who was robbed
 *   holdMs     per-team milliseconds of possession, for the station's own recap (§5c)
 */
export class ControlPoint {
  constructor({ captureS = DEFAULT_CAPTURE_S, netCap = DEFAULT_NET_CAP } = {}) {
    this.captureS = captureS;
    this.netCap = netCap;
    this.owner = NEUTRAL;
    this.capturing = null;
    this.progress = 0;
    this.lastOwner = null;
    this.holdMs = {};
    this.contested = false;
    this.dir = 0;                 // +1 rising, -1 falling, 0 static
    this.net = 0;                 // the leading team's lead, in players
    this.lead = null;             // the leading team's tid, or null
    this.counts = {};             // tid → living present players, for the screen
    this.refusedSeen = false;     // F82: a tid-2 player has stood here (the operator is told once)
    this.log = [];                // §5d.6: the capture log, {t, from, to} per crossing, for recap
    this.at = null;               // when update() last ran, for dt
  }
  /** Progress points per second at net 1 — the spec's `100 / capture_s`. */
  get rate() { return 100 / this.captureS; }

  /** Restore what `snapshot()` saved (localStorage `brx.station.control`, §5d.6): the point survives an app
   *  restart mid-match, including the possession tally and the capture log a recap is built from. */
  restore(s) {
    if (!s || typeof s !== 'object') return this;
    const own = Number.isFinite(+s.owner) ? +s.owner : NEUTRAL;
    this.owner = (own === NEUTRAL || claimable(own)) ? own : NEUTRAL;
    const cap = Number.isFinite(+s.capturing) ? +s.capturing : null;
    this.capturing = cap != null && claimable(cap) ? cap : null;
    this.progress = Math.max(0, Math.min(100, +s.progress || 0));
    const last = Number.isFinite(+s.lastOwner) ? +s.lastOwner : null;
    this.lastOwner = last != null && claimable(last) ? last : null;
    this.holdMs = (s.holdMs && typeof s.holdMs === 'object') ? { ...s.holdMs } : {};
    this.log = Array.isArray(s.log) ? s.log.slice(-64) : [];
    this.contested = !!s.contested;
    this.dir = [1, 0, -1].includes(s.dir) ? s.dir : 0;
    this.net = Math.max(0, Math.min(this.netCap, +s.net || 0));
    // A restored point is never mid-flip: owner holds it in (0,100], neutral-with-nobody sits at 0.
    if (this.owner !== NEUTRAL) this.capturing = null;
    else if (this.capturing == null) this.progress = 0;
    this.at = null;               // the first tick back measures no elapsed time
    return this;
  }
  /** Everything §5d.6 names: the model as it stands, the possession tally and the capture log. `seq` is the
   *  advertiser's and is folded in by the caller, which owns it. */
  snapshot() {
    return { owner: this.owner, capturing: this.capturing, progress: Math.round(this.progress * 10) / 10,
      lastOwner: this.lastOwner, holdMs: this.holdMs, log: this.log.slice(-64),
      contested: this.contested, dir: this.dir, net: this.net };
  }

  /** The three advert bytes. `team` is the owner while held, else whoever is building it up. */
  advert() {
    const held = this.owner !== NEUTRAL;
    const team = held ? this.owner : (this.capturing != null ? this.capturing : NEUTRAL);
    let state = held ? CONTROL_STATE.held : 0;
    if (this.contested) state |= CONTROL_STATE.contested;
    if (this.dir > 0) state |= CONTROL_STATE.rising;
    else if (this.dir < 0) state |= CONTROL_STATE.falling;
    return { team, state, value: Math.round(this.progress) };
  }

  /** §5d.4: the seconds until the point actually flips, which is the number a defender reads to decide
   *  whether to run. Null while nothing is moving. Rising → seconds to 100 (a capture); falling → seconds
   *  to 0 (the owner loses it, or the claimant is pushed back off their build). */
  timeToChange() {
    if (!this.dir || !this.net) return null;
    const span = this.dir > 0 ? (100 - this.progress) : this.progress;
    return span / (this.rate * this.net);
  }

  /**
   * One step. `players` is `Presence.players()` (entries with team / state / present); `now` is ms.
   * Returns `{ changed, events }` — events are `captured` / `neutralised` / `contested` / `uncontested`
   * / `refused`, each one exactly once at its edge, for the station's log and its recap tally.
   */
  update(players, now) {
    const dtMs = this.at == null ? 0 : Math.max(0, Math.min(MAX_STEP_MS, now - this.at));
    this.at = now;
    const events = [];
    const before = `${this.owner}:${this.capturing}:${Math.round(this.progress)}:${this.contested}:${this.dir}:${this.net}`;

    // ---- who is standing here, and does it count? ----
    const counts = {};
    let refused = 0;
    for (const p of players || []) {
      if (!p || !p.present) continue;                       // outside the bubble: not on the point
      if (!(p.state & PLAYER_STATE.alive)) continue;        // DOWN on the point contributes nothing
      if (p.team === REFUSED_TID) { refused++; continue; }  // F82
      if (!claimable(p.team)) continue;                     // no team / a colour tid: no claim
      counts[p.team] = (counts[p.team] || 0) + 1;
    }
    this.counts = counts;
    if (refused && !this.refusedSeen) { this.refusedSeen = true; events.push({ type: 'refused', team: REFUSED_TID }); }

    const ranked = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a] || a - b);
    this.lead = ranked.length ? ranked[0] : null;
    const second = ranked.length > 1 ? counts[ranked[1]] : 0;
    // §5d.1: the largest SINGLE other team, never the sum -- so 2v1v1 converts slowly instead of stalling --
    // clamped to `netCap` so a six-player rush is fast and not instant.
    this.net = this.lead == null ? 0 : Math.min(this.netCap, counts[this.lead] - second);
    const contested = ranked.length > 1;
    if (contested !== this.contested) { this.contested = contested; events.push({ type: contested ? 'contested' : 'uncontested', counts: { ...counts } }); }

    // ---- possession time, for the station's own recap (it is self-authoritative, §5c) ----
    if (this.owner !== NEUTRAL && dtMs) this.holdMs[this.owner] = (this.holdMs[this.owner] || 0) + dtMs;

    // ---- the two phases ----
    // `holder` is whose progress the bar shows: the owner while held, else the team building it up. The
    // leading team either BUILDS (it is the holder, or nobody is) or DRAINS (it is not). A step that runs
    // out of bar CARRIES ITS REMAINING WORK INTO THE NEXT PHASE rather than stopping at the boundary --
    // without that, the tick on which a point crossed zero rendered "RED STALLED AT 0%" with RED standing
    // on it (caught on the real screen by tools/screens.mjs #54), and a steal lost a tick of work at the
    // handover. Two phases at most, so the loop is bounded; the guard is belt and braces.
    let work = (this.net > 0 && dtMs) ? this.rate * this.net * (dtMs / 1000) : 0;
    for (let guard = 0; work > 1e-9 && guard < 4; guard++) {
      let holder = this.owner !== NEUTRAL ? this.owner : this.capturing;
      if (holder == null) { holder = this.capturing = this.lead; }
      if (this.lead === holder) {                           // BUILD, up to 100
        const step = Math.min(work, 100 - this.progress);
        this.progress += step; work -= step;
        if (this.progress >= 100 - 1e-9 && this.owner === NEUTRAL) {
          this.owner = holder; this.capturing = null;
          events.push({ type: 'captured', team: this.owner, from: this.lastOwner });
          this.log.push({ t: now, from: this.lastOwner, to: this.owner });   // §5d.6: the capture log a recap is built from
          if (this.log.length > 64) this.log.shift();
        }
        break;                                              // 100 is the end of the road: nothing left to convert
      }
      const step = Math.min(work, this.progress);           // DRAIN, down to 0
      this.progress -= step; work -= step;
      if (this.progress > 1e-9) break;
      if (this.owner !== NEUTRAL) {
        // Phase one is over: whoever held it has LOST it, and the point is nobody's.
        this.lastOwner = this.owner;
        events.push({ type: 'neutralised', team: this.owner, by: this.lead });
        this.log.push({ t: now, from: this.owner, to: null });
        if (this.log.length > 64) this.log.shift();
        this.owner = NEUTRAL;
      }
      this.capturing = this.lead;                           // the contender now owns the bar, at 0 — and keeps pushing
    }
    if (this.owner === NEUTRAL && this.capturing != null && this.progress <= 1e-9 && this.lead !== this.capturing) {
      this.capturing = null;                                // nobody is pushing an empty bar: fully neutral
    }
    // Direction is what is happening NOW (it drives the arrow, the stripe animation and the eta), so it is
    // read off the state the step LEFT BEHIND, not off which way the number happened to move: at a zero
    // crossing the bar fell and is now rising for the other team, and "rising" is the true thing to show.
    this.dir = 0;
    if (this.net > 0) {
      const h = this.owner !== NEUTRAL ? this.owner : this.capturing;
      if (h != null) this.dir = this.lead === h ? (this.progress < 100 ? 1 : 0) : (this.progress > 0 ? -1 : 0);
    }
    return { changed: before !== `${this.owner}:${this.capturing}:${Math.round(this.progress)}:${this.contested}:${this.dir}:${this.net}`, events };
  }
}

/**
 * When the station must (re)publish its advert, and the `seq` (byte 12) that goes out with it.
 *
 * `seq` bumps on every change, which is what lets a scanner tell a fresh advert from a stale one — but a
 * 4 Hz state machine must not stop+start the Android advertiser four times a second, so a change that is
 * ONLY progress is rate-limited to `minIntervalMs`. Owner, held, contested and direction are the states a
 * player phone acts on, so those go out at once.
 */
export class ControlAdvertiser {
  constructor({ minIntervalMs = 1000 } = {}) { this.minIntervalMs = minIntervalMs; this.seq = 0; this.last = null; this.lastAt = 0; }
  /** Why this advert must go out again ('first' | 'state' | 'progress'), or null to keep the current one. */
  due(view, now) {
    if (!view) return null;
    if (!this.last) return 'first';
    if (this.last.team !== view.team || this.last.state !== view.state) return 'state';
    if (this.last.value !== view.value && (now - this.lastAt) >= this.minIntervalMs) return 'progress';
    return null;
  }
  /** Called when the advert actually went out: bump `seq` and remember what it said. */
  published(view, now) {
    this.seq = (this.seq + 1) & 0xff;
    if (view) { this.last = { team: view.team, state: view.state, value: view.value }; this.lastAt = now; }
    return this.seq;
  }
}
