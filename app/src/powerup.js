// powerup.js — a POWERUP station's own decision (kind 2, docs/spec/powerups.md, contracts A56). DOM/BLE-free and
// pure, like control.js, so it runs in node tests, the stage and on a utility phone unchanged.
//
// Tony (2026-09-24): a player takes the item by standing about a foot from the station for 1 s, no button. The
// player's phone advertises `claiming`, then `claim_ready`, with this station's id in `value` (beacon.js). The
// STATION picks the winner: the first `claim_ready` it hears while the item is there, the lower player_num on a
// tie inside one batch. It then advertises TAKEN (state 0), the seconds to the next spawn in `value` and the
// winner in byte 15 (`taker`), which is what the winning phone waits for before it applies the item. The station
// owns taken and untaken; MC's `station_update` only re-anchors its countdown.
import { PLAYER_STATE, inScope } from './beacon.js';
import { POWERUP_DEFAULT_EVERY_S, ADVERT_VALUE_MAX, HILL_RING_STALE_MS } from './transport/contract.gen.js';   // seams D: shared with the Stick

export const CLAIM_FRESH_MS = 1500;      // a player advert older than this says nothing about who is standing here now

/** The advert triple for a powerup station's state. `available` null = the station does not know yet (no
 *  `station_update` since it was armed): state 0 with value 0, which a phone reads as "no advert state". PURE. */
export function stationItemAdvert({ available, nextAt = null, taker = 0 }, now) {
  if (available === true) return { state: 1, value: 0, taker: 0 };
  if (available === false) {
    const s = nextAt == null ? 0 : Math.max(1, Math.ceil((nextAt - now) / 1000));
    return { state: 0, value: Math.min(ADVERT_VALUE_MAX, s), taker: taker & 0xff };
  }
  return { state: 0, value: 0, taker: 0 };
}

export class PowerupStation {
  constructor({ id = 1, item = null } = {}) {
    this.id = id; this.item = item;
    this.available = null;   // true = the item is here, false = taken (or not spawned yet), null = unknown
    this.nextAt = null;      // the local-clock instant of the next spawn
    this.taker = 0;          // the player_num the last item went to; cleared at the next spawn
    this.ringAt = null;      // the first `claiming` advert heard for the item that is here (the screen's 1 s ring)
    this.log = [];           // [{t, type, player_num?}], the station's own recap
    this.awardedNext = null; // polish M1: the next-spawn instant when the item was awarded (that spawn is given away)
    this.unsent = [];        // polish M1: `station_action` taken reports MC has not had yet, sent on (re-)bind
    // F658: who may claim. `claimGame` 0 = any game (either side 0, as Presence), else only that byte; `requireLive` (a
    // following station) only a player whose match is live. The scope (A86) always applies: see `claimant`.
    this.claimGame = 0; this.requireLive = false;
  }
  /** F658: the station follows a new live game (PowerupFollower): its item spawns `first_at_s` after `now`, then every
   *  interval. The last game's item, taker and award protection go; queued `taken` reports stay (MC dates them). */
  startGame(now) {
    const first = Number(this.item && this.item.first_at_s);
    this.available = false; this.taker = 0; this.awardedNext = null; this.ringAt = null;
    this.nextAt = now + (first > 0 ? first : 0) * 1000;
  }
  /** May this player advert claim here? A86: the powerup kind bit and this station's id bit (a zero scope, an older APK,
   *  never does), F658: of the claim game and live when following, then A56: alive, fresh, naming this station. */
  claimant(p) {
    return !!p && p.role === 'player' && p.value === (this.id & 0xff)
      && !(Number.isFinite(p.ageMs) && p.ageMs > CLAIM_FRESH_MS)
      && !!(p.state & PLAYER_STATE.alive) && inScope(p, 'powerup', this.id)
      && !(this.claimGame && p.game && p.game !== this.claimGame)
      && !(this.requireLive && !(p.state & PLAYER_STATE.live));
  }
  /** The effective interval. MC always sends `spawn_every_s`; a station that has none repeats at POWERUP_DEFAULT_EVERY_S,
   *  as the Stick firmware does (A2: both read app/test/fixtures/powerup-station-cases.json). */
  get everyMs() { const s = Number(this.item && this.item.spawn_every_s); return (s > 0 ? s : POWERUP_DEFAULT_EVERY_S) * 1000; }
  /** MC's `station_update {available, next_spawn_in_ms, reset?}`: the time REMAINING, re-anchored on arrival. */
  update(body, now) {
    if (!body || typeof body !== 'object') return;
    const hasNext = body.next_spawn_in_ms != null && Number.isFinite(+body.next_spawn_in_ms) && +body.next_spawn_in_ms >= 0;
    const next = hasNext ? now + Math.round(+body.next_spawn_in_ms) : null;
    // Polish M1: MC re-opening the spawn this station already AWARDED means MC never heard `taken` (a lost report, a
    // reconnect re-send, a restarted MC). A LATER spawn instant (about one interval on) is a new item and is accepted.
    // An operator reset carries `reset: true` (A56) and is always accepted: the item is there now.
    if (body.available === true && body.reset !== true && this.available === false && this.taker && this.awardedNext != null) {
      // Half of the effective interval: a new cycle is a whole interval on, an echo is none (same value on the Stick).
      const half = this.everyMs / 2;
      if (next == null || next < this.awardedNext + half) return;
    }
    if (typeof body.available === 'boolean') {
      if (body.available && this.available !== true) { this.taker = 0; this.awardedNext = null; }
      this.available = body.available;
    }
    if (hasNext) this.nextAt = next;
  }
  /** Polish M1: hand every queued `taken` report to `send(body) -> boolean` (true = it left); the rest stay queued. */
  drain(send, now = Date.now()) {
    let n = 0;
    // `age_ms`: how long ago the award was. MC dates the take by it, since a Stick has no synced clock (polish r2).
    while (this.unsent.length) { const b = this.unsent[0]; if (!send({ ...b, age_ms: Math.max(0, now - b.t) })) break; this.unsent.shift(); n++; }
    return n;
  }
  /** One step: the self-spawn on its own countdown, then the claims heard since the last step. `players` are
   *  beacon.js Presence entries (role player) with `raw` (the last sample) and `ageMs`. */
  tick(players, now) {
    const events = []; let changed = false;
    if (this.nextAt != null && now >= this.nextAt) {
      if (this.available !== true) { this.available = true; this.taker = 0; this.awardedNext = null; events.push({ type: 'spawned' }); changed = true; }
      const every = this.everyMs;
      while (this.nextAt <= now) this.nextAt += every;
    }
    const mine = (players || []).filter(p => this.claimant(p));
    if (this.available === true) {
      const ready = mine.filter(p => p.state & PLAYER_STATE.claim_ready).sort((a, b) => a.id - b.id);
      if (ready.length) {
        this.available = false; this.taker = ready[0].id; this.ringAt = null; this.awardedNext = this.nextAt;
        events.push({ type: 'taken', player_num: this.taker }); changed = true;
        this.unsent.push({ id: this.id, action: 'taken', player_num: this.taker, t: now }); if (this.unsent.length > 16) this.unsent.shift();
        this.log.push({ t: now, type: 'taken', player_num: this.taker }); if (this.log.length > 64) this.log.shift();
      } else if (mine.some(p => p.state & PLAYER_STATE.claiming)) { if (this.ringAt == null) { this.ringAt = now; changed = true; } }
      else if (this.ringAt != null) { this.ringAt = null; changed = true; }
    } else if (this.ringAt != null) { this.ringAt = null; changed = true; }
    return { changed, events };
  }
  advert(now) { return stationItemAdvert(this, now); }
  /** What the station's screen shows. */
  view(now) {
    return { available: this.available, taker: this.taker, ringAt: this.ringAt,
      nextInMs: this.nextAt == null ? null : Math.max(0, this.nextAt - now) };
  }
  snapshot() { return { available: this.available, nextAt: this.nextAt, taker: this.taker, awardedNext: this.awardedNext, unsent: this.unsent.slice(), log: this.log.slice(-32) }; }
  restore(s) {
    if (!s || typeof s !== 'object') return this;
    if (s.available === true || s.available === false) this.available = s.available;
    if (Number.isFinite(s.nextAt)) this.nextAt = s.nextAt;
    if (Number.isFinite(s.taker)) this.taker = s.taker;
    if (Array.isArray(s.log)) this.log = s.log;
    if (Number.isFinite(s.awardedNext)) this.awardedNext = s.awardedNext;
    if (Array.isArray(s.unsent)) this.unsent = s.unsent.slice(-16);
    return this;
  }
}

/**
 * F658, the static powerup: a powerup station set up once plays every following game with no walk-out, no Wi-Fi and no
 * re-arm, the way the hill does (control.js HillFollower). The station stays the referee of its item: the spawn clock and
 * the taker are its own.
 *
 *  - FOLLOW MODE starts the first time the station hears an in-scope player with the live bit (byte 10, 128), and lasts.
 *    Before that the station keeps today's rules: MC's `station_update` anchors the schedule and the players of MC's game
 *    claim (`armedGame`, 0 = any).
 *  - IN SCOPE (A86): the powerup kind bit and this station's id bit. A zero scope (an older APK) never counts.
 *  - The CURRENT game is the byte of the in-scope live players it hears, at any signal strength. Another live game takes
 *    the station only with MORE such players heard than the current game; a tie keeps it. A game-0 phone is skipped unless
 *    MC armed the station for game 0, as the hill does.
 *  - A NEW game starts the item's clock at its first sighting: the first spawn `first_at_s` later, then every
 *    `spawn_every_s` (`PowerupStation.startGame`). No MC START is needed. A byte heard again after more than
 *    HILL_RING_STALE_MS unheard starts again too (MC wraps 255 to 1, or reuses a byte after a restart).
 *  - The first follow into MC's own game keeps a schedule MC already anchored: with MC armed and START known, today's
 *    behaviour is the fallback, and MC's later updates still apply (`acceptsMc`).
 *  - Following, only live-bit players of the current game claim (`claimGame`, `requireLive`).
 *
 * Only the current game's spawn state is kept: one item, one game at a time. PURE.
 */
export class PowerupFollower {
  constructor({ staleMs = HILL_RING_STALE_MS } = {}) {
    this.staleMs = staleMs;
    this.follows = false;
    this.current = null;    // the followed game byte
    this.heardAt = null;    // the newest live advert of the current game
    this.since = null;      // when the current game's clock started (its first sighting)
  }
  /** The game byte the station advertises: the followed one when following, else MC's. */
  game(armedGame = 0) { return this.follows && this.current != null ? this.current : (armedGame || 0); }
  /** May MC's `station_update` re-anchor the schedule? Always before following; following, only for MC's own game. */
  acceptsMc(armedGame = 0) { return !this.follows || this.current === (armedGame || 0); }
  /**
   * One step, before the station's tick. `players` is `Presence.players()` (with `ageMs`, `game`, `state`, the scope).
   * Starts a new game's clock on `station` itself, and sets who may claim. Returns `{ switched }`: `{ from, to, fresh,
   * kept }` when the current game changed (or restarted) this step, else null.
   */
  step(station, players, now, { expiryMs, armedGame = 0, stationId }) {
    const heard = new Map();   // byte -> { at, n }: the newest advert time and the in-scope live players heard
    for (const p of players || []) {
      if (!p || !(p.state & PLAYER_STATE.live) || !inScope(p, 'powerup', stationId)) continue;
      const age = Number.isFinite(p.ageMs) ? p.ageMs : 0;
      if (age > expiryMs) continue;
      const g = p.game || 0;
      if (g === 0 && armedGame !== 0) continue;
      const h = heard.get(g) || { at: now - age, n: 0 };
      h.at = Math.max(h.at, now - age); h.n++;
      heard.set(g, h);
    }
    const first = !this.follows && heard.size > 0;
    if (heard.size) this.follows = true;
    let switched = null;
    if (this.follows) {
      const n = g => (heard.get(g) || { n: 0 }).n;
      let best = null;
      for (const [g, h] of heard) {
        if (g === this.current) continue;
        const b = best == null ? null : heard.get(best);
        if (b == null || h.n > b.n || (h.n === b.n && (h.at > b.at || (h.at === b.at && g > best)))) best = g;
      }
      const cur = this.current != null ? heard.get(this.current) : null;
      if (best != null && (this.current == null || n(best) > n(this.current))) {
        const from = this.current;
        this.current = best; this.heardAt = heard.get(best).at; this.since = now;
        // the first follow into MC's own game keeps a schedule MC anchored (its START reached this station)
        const kept = first && from == null && armedGame !== 0 && best === armedGame && station.nextAt != null;
        if (!kept) station.startGame(now);
        switched = { from, to: best, fresh: !kept, kept };
      } else if (cur) {
        if (this.heardAt != null && cur.at - this.heardAt > this.staleMs) { this.since = now; station.startGame(now); switched = { from: this.current, to: this.current, fresh: true, kept: false }; }
        this.heardAt = Math.max(this.heardAt ?? cur.at, cur.at);
      }
    }
    station.claimGame = this.follows ? this.current : (armedGame || 0);
    station.requireLive = this.follows;
    return { switched };
  }
  /** Forget the followed game: the operator's reset, a new kind or id. */
  clear() { this.follows = false; this.current = null; this.heardAt = null; this.since = null; }
  /** The heartbeat's summary, the hill's shape (`games`, keyed by byte; one entry, the current game): the item's state,
   *  its taker, ms to the next spawn (null = unknown), ms since this game's clock started and since it was last heard. */
  summary(station, now) {
    if (!this.follows || this.current == null) return {};
    const v = station.view(now);
    return { [String(this.current)]: { available: v.available === true, taker: v.taker || 0, ...(v.nextInMs != null ? { next_ms: v.nextInMs } : {}),
      since_ms: Math.max(0, now - (this.since ?? now)), last_ms: Math.max(0, now - (this.heardAt ?? now)) } };
  }
  snapshot() { return { follows: this.follows, current: this.current, heardAt: this.heardAt, since: this.since }; }
  restore(s) {
    if (!s || typeof s !== 'object' || !s.follows || !Number.isInteger(s.current) || s.current < 0 || s.current > 255) return this;
    this.follows = true; this.current = s.current;
    this.heardAt = Number.isFinite(s.heardAt) ? s.heardAt : null; this.since = Number.isFinite(s.since) ? s.since : null;
    return this;
  }
}

/** The player advert's share of a claim (A56): the `claiming` / `claim_ready` state bits, the station id in `value`,
 *  and the advertise mode. While claiming, the plugin's low-latency mode (about 100 ms on Android), so the station
 *  hears the claim inside the dwell; 'balanced' again once it clears. `claim` is `state().powerupClaim`. PURE. */
export function playerClaimAdvert(claim) {
  if (!claim || !Number.isFinite(+claim.station)) return { bits: 0, value: 0, mode: 'balanced' };
  return { bits: PLAYER_STATE.claiming | (claim.ready ? PLAYER_STATE.claim_ready : 0), value: +claim.station & 0xff, mode: 'lowLatency' };
}
