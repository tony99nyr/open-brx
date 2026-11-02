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

import { PLAYER_STATE } from './beacon.js';
import { STATION_TEAM_ANY, ADVERT_CONTROL_STATE, HILL_CLAIMABLE_TIDS, HILL_REFUSED_TID, HILL_CAPTURE_S, HILL_DECAY_S, HILL_DECAY_DELAY_MS, HILL_NET_CAP, HILL_MAX_STEP_MS, HILL_RING_SIZE, HILL_RING_STALE_MS } from './transport/contract.gen.js';

// What the contract names mean here (values live in transport/contract.gen.js; this file reads them directly):
//  - ADVERT_CONTROL_STATE: advert byte 10 for kind 5.
//  - STATION_TEAM_ANY: advert byte 9 when nobody owns the point and nobody is advancing on it. Also the owner of a neutral point.
//  - HILL_REFUSED_TID: F82, the tid a NEUTRAL hill broadcasts, so it can never mean a real owner.
//  - HILL_CAPTURE_S: seconds ONE net player needs for ONE phase (spec §5d.1: `rate = net * 100 / capture_s`). At 10 s a lone
//    player takes a neutral point in 10 s and steals a held one in 20; two of them halve both. Operator-tunable.
//  - HILL_NET_CAP: §5d.1, `net` is clamped here so a six-player rush is fast and not instant. Proposed, not measured.
//  - HILL_DECAY_S: F464 (Tony 2026-10-05), seconds a half-built NEUTRAL capture takes to drain from 100 to 0 while nobody is counted on the point.
//  - HILL_DECAY_DELAY_MS: F464 option 1, milliseconds with nobody counted before the drain starts, so a stray sighting or a short step off costs nothing.
//  - HILL_MAX_STEP_MS: a tick longer than this is a backgrounded phone or a paused debugger, not elapsed play: clamp it so a
//    station that was asleep does not hand somebody the point on its first tick back.

/** Can this tid own a point at all? 0..3 are the four $TID teams; 4-7 are colours, not teams; 255 is
 *  "any"; and 2 is refused by F82. */
export function claimable(tid) { return HILL_CLAIMABLE_TIDS.includes(tid); }

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
  constructor({ captureS = HILL_CAPTURE_S, netCap = HILL_NET_CAP, decayS = HILL_DECAY_S, decayDelayMs = HILL_DECAY_DELAY_MS } = {}) {
    this.captureS = captureS;
    this.decayS = decayS;
    this.decayDelayMs = decayDelayMs;
    this.absentMs = 0;            // F464: how long nobody has been counted on the point (a restored point starts at 0)
    this.netCap = netCap;
    this.owner = STATION_TEAM_ANY;
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
    this.heldBy = null;           // F554: the team counted ALONE on the point at the last update, or null
  }
  /** Progress points per second at net 1 — the spec's `100 / capture_s`. */
  get rate() { return 100 / this.captureS; }
  /** F464: progress points per second a neutral capture drains while its team is not on the point. */
  get decayRate() { return 100 / this.decayS; }

  /** Restore what `snapshot()` saved (localStorage `brx.station.control`, §5d.6): the point survives an app
   *  restart mid-match, including the possession tally and the capture log a recap is built from. */
  restore(s) {
    if (!s || typeof s !== 'object') return this;
    const own = Number.isFinite(+s.owner) ? +s.owner : STATION_TEAM_ANY;
    this.owner = (own === STATION_TEAM_ANY || claimable(own)) ? own : STATION_TEAM_ANY;
    const cap = s.capturing != null && Number.isFinite(+s.capturing) ? +s.capturing : null;   // +null is 0 (red): a null stays null
    this.capturing = cap != null && claimable(cap) ? cap : null;
    this.progress = Math.max(0, Math.min(100, +s.progress || 0));
    const last = s.lastOwner != null && Number.isFinite(+s.lastOwner) ? +s.lastOwner : null;
    this.lastOwner = last != null && claimable(last) ? last : null;
    this.holdMs = (s.holdMs && typeof s.holdMs === 'object') ? { ...s.holdMs } : {};
    this.log = Array.isArray(s.log) ? s.log.slice(-64) : [];
    this.contested = !!s.contested;
    this.dir = [1, 0, -1].includes(s.dir) ? s.dir : 0;
    this.net = 0;                 // F558: no counts or lead are restored, so no net either (the Stick's restore does the same)
    // A restored point is never mid-flip: owner holds it in (0,100], neutral-with-nobody sits at 0.
    if (this.owner !== STATION_TEAM_ANY) this.capturing = null;
    else if (this.capturing == null) this.progress = 0;
    this.at = null;               // the first tick back measures no elapsed time
    this.heldBy = null;           // F554: and no earlier sample saw anybody on the point
    this.absentMs = 0;            // F464: a restored point restarts the decay delay (the conservative choice; not in the snapshot)
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
    const held = this.owner !== STATION_TEAM_ANY;
    const team = held ? this.owner : (this.capturing != null ? this.capturing : STATION_TEAM_ANY);
    let state = held ? ADVERT_CONTROL_STATE.held : 0;
    if (this.contested) state |= ADVERT_CONTROL_STATE.contested;
    if (this.dir > 0) state |= ADVERT_CONTROL_STATE.rising;
    else if (this.dir < 0) state |= ADVERT_CONTROL_STATE.falling;
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
    // F103: two different clocks. `elapsedMs` is real time and feeds POSSESSION (the number the match is
    // scored on -- a station that held the point through a throttled or backgrounded minute held it for a
    // minute); `dtMs` is the same interval clamped to HILL_MAX_STEP_MS and feeds CONVERSION only (a sleeping
    // station must not hand somebody the point on its first tick back). Adding the clamped value to the
    // tally silently under-reported every hold longer than one tick, in the direction nothing reports.
    const elapsedMs = this.at == null ? 0 : Math.max(0, now - this.at);
    const dtMs = Math.min(HILL_MAX_STEP_MS, elapsedMs);
    this.at = now;
    const events = [];
    const before = `${this.owner}:${this.capturing}:${Math.round(this.progress)}:${this.contested}:${this.dir}:${this.net}`;

    // ---- who is standing here, and does it count? ----
    const counts = {}, capCounts = {};
    let refused = 0;
    for (const p of players || []) {
      // F440: in the circle = present (dwell passed, debounced exit) OR a credible sighting in the last PRESENCE_SIGHT_MS, so an
      // arriving opponent contests at once and a sparse advertiser keeps its count. Binary: never weighted by RSSI.
      if (!p || !(p.present || p.inCircle)) continue;       // outside the bubble: not on the point
      if (!(p.state & PLAYER_STATE.alive)) continue;        // DOWN on the point contributes nothing
      if (p.team === HILL_REFUSED_TID) { refused++; continue; }  // F82
      if (!claimable(p.team)) continue;                     // no team / a colour tid: no claim
      counts[p.team] = (counts[p.team] || 0) + 1;
      // C.7 (Tony 2026-10-16: "to cap you have to be close, to contest you can be at edge"): a player under the band for
      // PRESENCE_FADE_AFTER_MS or more, inside the exit grace (`fading`, beacon.js), still contests and stops the decay
      // below, but builds and drains nothing.
      if (!p.fading) capCounts[p.team] = (capCounts[p.team] || 0) + 1;
    }
    this.counts = counts;
    // F103: the F82 banner used to latch for the rest of the match, so reassigning that player off tid 2 in
    // Mission Control never took it down. It now tracks whether a refused player is HERE: the operator is told
    // once per episode (the rising edge), and the banner clears on the first tick with nobody refused.
    if (refused && !this.refusedSeen) { this.refusedSeen = true; events.push({ type: 'refused', team: HILL_REFUSED_TID }); }
    else if (!refused) this.refusedSeen = false;

    const ranked = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a] || a - b);
    this.lead = ranked.length ? ranked[0] : null;
    if (this.lead == null) this.absentMs += elapsedMs; else this.absentMs = 0;   // F464: real time with nobody counted
    const second = ranked.length > 1 ? counts[ranked[1]] : 0;
    // §5d.1: the largest SINGLE other team, never the sum -- so 2v1v1 converts slowly instead of stalling --
    // clamped to `netCap` so a six-player rush is fast and not instant.
    this.net = this.lead == null ? 0 : Math.max(0, Math.min(this.netCap, (capCounts[this.lead] || 0) - second));   // C.7: the lead's close players only
    const contested = ranked.length > 1;
    if (contested !== this.contested) { this.contested = contested; events.push({ type: contested ? 'contested' : 'uncontested', counts: { ...counts } }); }

    // ---- possession time, for the station's own recap (it is self-authoritative, §5c) ----
    // F554 (field 2026-10-17, Tony: "hills should ignore dead players"): an owned point banks only while its owner has a
    // LIVING player counted on it. `counts`, not `capCounts`: a fading owner at the edge still holds what it owns.
    // brx2 review 2026-10-24: the test reads one sample, so a long gap (a throttled station) banks in full only when the
    // owner was counted alone at BOTH ends. A gap whose start did not see it banks at most HILL_MAX_STEP_MS (`dtMs`), so an
    // owner who steps back on just before a stalled tick cannot bank the minute nobody held. At an ordinary tick
    // `dtMs === elapsedMs`, so nothing else changes. A gap whose end does not see the owner banks nothing, as before.
    const sole = this.contested ? null : this.lead;
    if (this.owner !== STATION_TEAM_ANY && sole === this.owner && elapsedMs) this.holdMs[this.owner] = (this.holdMs[this.owner] || 0) + (this.heldBy === this.owner ? elapsedMs : dtMs);
    this.heldBy = sole;

    // ---- the two phases ----
    // `holder` is whose progress the bar shows: the owner while held, else the team building it up. The
    // leading team either BUILDS (it is the holder, or nobody is) or DRAINS (it is not). A step that runs
    // out of bar CARRIES ITS REMAINING WORK INTO THE NEXT PHASE rather than stopping at the boundary --
    // without that, the tick on which a point crossed zero rendered "RED STALLED AT 0%" with RED standing
    // on it (caught on the real screen by tools/screens.mjs #54), and a steal lost a tick of work at the
    // handover. Two phases at most, so the loop is bounded; the guard is belt and braces.
    // ---- F464 (Tony 2026-10-05): a built-up NEUTRAL capture DECAYS while nobody is counted on the point (standard KOTH) ----
    // Stray sightings of a phone outside the circle used to add up: progress never fell, so enough of them captured the hill.
    // Now an abandoned or half-done capture drains at `decayRate` (the rate it builds). Only when NO team is counted:
    // a contested point (two teams, even net 0) neither builds nor decays, as before; a lone other team already drains the
    // bar through the DRAIN phase below; an OWNED point is never decayed (it holds at 100 until an enemy drains it).
    // Option 1: only after nobody has been counted for `decayDelayMs`, so a lone stray sighting (under the delay) or a step off
    // and back costs nothing; the drain runs for the part of this step that lies past the delay.
    const pastDelay = Math.min(dtMs, Math.max(0, this.absentMs - this.decayDelayMs));
    if (this.owner === STATION_TEAM_ANY && this.capturing != null && this.lead == null && pastDelay) {
      this.progress = Math.max(0, this.progress - this.decayRate * (pastDelay / 1000));
      if (this.progress <= 1e-9) this.progress = 0;
    }
    let work = (this.net > 0 && dtMs) ? this.rate * this.net * (dtMs / 1000) : 0;
    for (let guard = 0; work > 1e-9 && guard < 4; guard++) {
      let holder = this.owner !== STATION_TEAM_ANY ? this.owner : this.capturing;
      if (holder == null) { holder = this.capturing = this.lead; }
      if (this.lead === holder) {                           // BUILD, up to 100
        const step = Math.min(work, 100 - this.progress);
        this.progress += step; work -= step;
        // F456: inside the capture tolerance IS 100. Otherwise a step that lands a hair under 100 captured the point and
        // still read `dir` rising (it asks progress < 100) for a tick: the screen showed held + rising, the advert the bit.
        if (this.progress >= 100 - 1e-9) this.progress = 100;
        if (this.progress >= 100 - 1e-9 && this.owner === STATION_TEAM_ANY) {
          this.owner = holder; this.capturing = null;
          events.push({ type: 'captured', team: this.owner, from: this.lastOwner });
          this.log.push({ t: now, from: this.lastOwner, to: this.owner });   // §5d.6: the capture log a recap is built from
          if (this.log.length > 64) this.log.shift();
        }
        break;                                              // 100 is the end of the road: nothing left to convert
      }
      const step = Math.min(work, this.progress);           // DRAIN, down to 0
      this.progress -= step; work -= step;
      if (this.progress <= 1e-9) this.progress = 0;           // F456: the same at the bottom (`dir` asks progress > 0)
      if (this.progress > 1e-9) break;
      if (this.owner !== STATION_TEAM_ANY) {
        // Phase one is over: whoever held it has LOST it, and the point is nobody's.
        this.lastOwner = this.owner;
        events.push({ type: 'neutralised', team: this.owner, by: this.lead });
        this.log.push({ t: now, from: this.owner, to: null });
        if (this.log.length > 64) this.log.shift();
        this.owner = STATION_TEAM_ANY;
      }
      this.capturing = this.lead;                           // the contender now owns the bar, at 0 — and keeps pushing
    }
    if (this.owner === STATION_TEAM_ANY && this.capturing != null && this.progress <= 1e-9 && this.lead !== this.capturing) {
      this.capturing = null;                                // nobody is pushing an empty bar: fully neutral
    }
    // Direction is what is happening NOW (it drives the arrow, the stripe animation and the eta), so it is
    // read off the state the step LEFT BEHIND, not off which way the number happened to move: at a zero
    // crossing the bar fell and is now rising for the other team, and "rising" is the true thing to show.
    this.dir = 0;
    if (this.net > 0) {
      const h = this.owner !== STATION_TEAM_ANY ? this.owner : this.capturing;
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

/**
 * F658, the static hill: a hill set up once plays every following game with no walk-out, no Wi-Fi and no re-arm. Player
 * phones set the `live` bit (byte 10, 128) from go-live to the whistle, and the hill follows the newest live game.
 *
 *  - FOLLOW MODE starts the first time the hill hears any live-bit player, and lasts. Before that (only old phones heard)
 *    the hill keeps today's rules: it counts players of its MC-armed game (`armedGame`, 0 = any) inside MC's window.
 *  - The CURRENT game is the byte of the live players it hears. Another live game takes the hill only with MORE live
 *    players on the point (present or in sight) than the current game; a tie keeps it. A game-0 phone is skipped unless
 *    the hill's own game is 0. The first follow into the hill's own game (or from a game-0 hill) keeps its point.
 *  - Only live-bit players of the current game count. A player without the bit (the countdown, after the whistle) never
 *    counts in follow mode, so the live bit replaces MC's window.
 *  - THE RING: one point state per game byte, at most HILL_RING_SIZE, with the last time the byte was heard. A byte back
 *    after more than HILL_RING_STALE_MS unheard starts fresh (MC wraps 255 to 1, an MC restart that reuses a byte); a
 *    new byte with the ring full evicts the least recently heard one (never the current).
 *
 * `point` is the ONE ControlPoint the station shows and advertises: a switch saves its state into the ring and loads the
 * other game's (or a fresh one) with `restore`, which also restarts its clock, so no time banks across a switch. PURE.
 */
export class HillFollower {
  constructor({ size = HILL_RING_SIZE, staleMs = HILL_RING_STALE_MS } = {}) {
    this.size = size; this.staleMs = staleMs;
    this.follows = false;
    this.current = null;        // the followed game byte, once following
    this.games = new Map();     // byte -> { heardAt, since, snap } (snap: the point's state while not current, null = fresh)
  }
  /** The game byte the hill advertises and counts under: the current one when following, else MC's. */
  game(armedGame = 0) { return this.follows && this.current != null ? this.current : (armedGame || 0); }

  /**
   * One step, before the point's own update. `players` is `Presence.players()` (with `ageMs`, `game`, `state`).
   * Returns `{ players, switched }`: the players the point may count, and `{ from, to, fresh }` when the current game
   * changed this step (else null).
   */
  step(point, players, now, { expiryMs, armedGame = 0 }) {
    // byte -> { at: the newest advert time of a live player, n: its live players on the point (present or in sight) }
    const heard = new Map();
    for (const p of players || []) {
      if (!p || !(p.state & PLAYER_STATE.live)) continue;
      const age = Number.isFinite(p.ageMs) ? p.ageMs : 0;
      if (age > expiryMs) continue;
      const g = p.game || 0, at = now - age;
      if (g === 0 && armedGame !== 0) continue;   // a hand-played phone (game 0) is followed only by a hill of game 0
      const h = heard.get(g) || { at, n: 0 };
      h.at = Math.max(h.at, at);
      if (p.present || p.inCircle) h.n++;
      heard.set(g, h);
    }
    const first = !this.follows && heard.size > 0;
    if (heard.size) this.follows = true;
    if (!this.follows) {
      // Fallback, today's rule: MC's game byte scopes the players (0 on either side = any game).
      return { players: (players || []).filter(p => this.counts(p, armedGame)), switched: null };
    }
    let freshCurrent = false;
    for (const [g, { at }] of heard) {
      let e = this.games.get(g);
      if (e && at - e.heardAt > this.staleMs) { e.snap = null; e.since = at; if (g === this.current) freshCurrent = true; }
      if (!e) {
        if (this.games.size >= this.size) this._evict();
        e = { heardAt: at, since: at, snap: null };
        this.games.set(g, e);
      }
      e.heardAt = Math.max(e.heardAt, at);
    }
    // Review of F658: another live game takes the hill only with MORE live players on the point than the current game
    // (a tie keeps it), so one phone that missed END cannot pin the hill, and a stranger takes an empty hill only until
    // more real players arrive. The first follow takes the game with the most players there (then the newest).
    const n = g => (heard.get(g) || { n: 0 }).n;
    let best = null;
    for (const g of heard.keys()) {
      if (g === this.current) continue;
      const e = this.games.get(g), b = best == null ? null : this.games.get(best);
      if (!e) continue;   // evicted in this same step (more live games than the ring holds)
      if (!b || n(g) > n(best) || (n(g) === n(best) && (e.since > b.since || (e.since === b.since && g > best)))) best = g;
    }
    let next = this.current;
    if (best != null && (this.current == null || n(best) > n(this.current))) next = best;
    let switched = null;
    if (next !== this.current && first && (!armedGame || armedGame === next)) {
      // Review of F658: the first follow into MC's own game (or from a hill of any game) keeps the point it counted
      this.current = next;
      switched = { from: null, to: next, fresh: false, kept: true };
    } else if (next !== this.current) {
      const from = this.current;
      if (from != null && this.games.has(from)) this.games.get(from).snap = point.snapshot();
      const e = this.games.get(next);
      loadPoint(point, e.snap);
      switched = { from, to: next, fresh: !e.snap };
      e.snap = null;
      this.current = next;
    } else if (freshCurrent) {
      loadPoint(point, null);
      switched = { from: this.current, to: this.current, fresh: true };
    }
    return { players: (players || []).filter(p => this.counts(p, armedGame)), switched };
  }
  /** May the point count this player? Following: a live-bit player of the current game. Not following: a player of MC's
   *  game (0 on either side = any game), today's rule. */
  counts(p, armedGame = 0) {
    if (!p) return false;
    if (this.follows) return !!(p.state & PLAYER_STATE.live) && (p.game || 0) === this.current;
    return !armedGame || !p.game || p.game === armedGame;
  }
  /** Forget every game: the operator's point reset. */
  clear() { this.follows = false; this.current = null; this.games = new Map(); }
  _evict() {
    let worst = null;
    for (const [g, e] of this.games) if (g !== this.current && (worst == null || e.heardAt < this.games.get(worst).heardAt)) worst = g;
    if (worst != null) this.games.delete(worst);
  }

  /** The heartbeat's ring summary: byte -> { hold_ms, owner, last_ms } (last_ms = ms since that game was last heard). */
  summary(point, now) {
    const out = {};
    for (const [g, e] of this.games) {
      const s = g === this.current ? point : (e.snap || {});
      out[String(g)] = { hold_ms: { ...(s.holdMs || {}) }, owner: Number.isFinite(+s.owner) ? +s.owner : STATION_TEAM_ANY, last_ms: Math.max(0, now - e.heardAt) };
    }
    return out;
  }
  /** What a restart needs (§5d.6): the mode, the current byte and every other game's saved point. The current game's
   *  point is saved by the caller, as before. */
  snapshot() {
    return { follows: this.follows, current: this.current, games: [...this.games].map(([g, e]) => [g, { heardAt: e.heardAt, since: e.since, snap: e.snap }]) };
  }
  restore(s) {
    if (!s || typeof s !== 'object') return this;
    this.follows = !!s.follows;
    this.current = Number.isInteger(s.current) && s.current >= 0 && s.current <= 255 ? s.current : null;
    this.games = new Map();
    for (const [g, e] of Array.isArray(s.games) ? s.games.slice(0, this.size) : []) {
      if (!Number.isInteger(g) || g < 0 || g > 255 || !e) continue;
      this.games.set(g, { heardAt: +e.heardAt || 0, since: +e.since || 0, snap: e.snap && typeof e.snap === 'object' ? e.snap : null });
    }
    if (this.current != null && !this.games.has(this.current)) this.current = null;
    if (this.current == null) this.follows = this.follows && this.games.size > 0;
    return this;
  }
}

/** Load a saved point state into `point` (null = a fresh, neutral point), with its clock restarted. */
function loadPoint(point, snap) {
  point.restore(snap || { owner: STATION_TEAM_ANY, capturing: null, progress: 0, holdMs: {}, log: [] });
  point.counts = {}; point.lead = null; point.refusedSeen = false;
}
