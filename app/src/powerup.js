// powerup.js — a POWERUP station's own decision (kind 2, docs/spec/powerups.md, contracts A56). DOM/BLE-free and
// pure, like control.js, so it runs in node tests, the stage and on a utility phone unchanged.
//
// Tony (2026-09-24): a player takes the item by standing about a foot from the station for 1 s, no button. The
// player's phone advertises `claiming`, then `claim_ready`, with this station's id in `value` (beacon.js). The
// STATION picks the winner: the first `claim_ready` it hears while the item is there, the lower player_num on a
// tie inside one batch. It then advertises TAKEN (state 0), the seconds to the next spawn in `value` and the
// winner in byte 15 (`taker`), which is what the winning phone waits for before it applies the item. The station
// owns taken and untaken; MC's `station_update` only re-anchors its countdown.
import { PLAYER_STATE } from './beacon.js';

export const CLAIM_MIN_RSSI = -80;       // a claim heard weaker than this is somebody across the field, not at the station
export const CLAIM_FRESH_MS = 1500;      // a player advert older than this says nothing about who is standing here now
export const VALUE_MAX_S = 255;          // the advert's one-byte countdown

/** The advert triple for a powerup station's state. `available` null = the station does not know yet (no
 *  `station_update` since it was armed): state 0 with value 0, which a phone reads as "no advert state". PURE. */
export function stationItemAdvert({ available, nextAt = null, taker = 0 }, now) {
  if (available === true) return { state: 1, value: 0, taker: 0 };
  if (available === false) {
    const s = nextAt == null ? 0 : Math.max(1, Math.ceil((nextAt - now) / 1000));
    return { state: 0, value: Math.min(VALUE_MAX_S, s), taker: taker & 0xff };
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
  }
  get everyMs() { const s = Number(this.item && this.item.spawn_every_s); return s > 0 ? s * 1000 : 0; }
  /** MC's `station_update {available, next_spawn_in_ms}`: the time REMAINING, re-anchored on arrival. */
  update(body, now) {
    if (!body || typeof body !== 'object') return;
    if (typeof body.available === 'boolean') {
      if (body.available && this.available !== true) this.taker = 0;
      this.available = body.available;
    }
    if (Number.isFinite(+body.next_spawn_in_ms) && +body.next_spawn_in_ms >= 0) this.nextAt = now + Math.round(+body.next_spawn_in_ms);
  }
  /** One step: the self-spawn on its own countdown, then the claims heard since the last step. `players` are
   *  beacon.js Presence entries (role player) with `raw` (the last sample) and `ageMs`. */
  tick(players, now) {
    const events = []; let changed = false;
    if (this.nextAt != null && now >= this.nextAt) {
      if (this.available !== true) { this.available = true; this.taker = 0; events.push({ type: 'spawned' }); changed = true; }
      const every = this.everyMs;
      if (every > 0) { while (this.nextAt <= now) this.nextAt += every; } else this.nextAt = null;
    }
    const mine = (players || []).filter(p => p && p.role === 'player' && p.value === (this.id & 0xff)
      && Number.isFinite(p.raw) && p.raw >= CLAIM_MIN_RSSI && !(Number.isFinite(p.ageMs) && p.ageMs > CLAIM_FRESH_MS)
      && (p.state & PLAYER_STATE.alive));
    if (this.available === true) {
      const ready = mine.filter(p => p.state & PLAYER_STATE.claim_ready).sort((a, b) => a.id - b.id);
      if (ready.length) {
        this.available = false; this.taker = ready[0].id; this.ringAt = null;
        events.push({ type: 'taken', player_num: this.taker }); changed = true;
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
  snapshot() { return { available: this.available, nextAt: this.nextAt, taker: this.taker, log: this.log.slice(-32) }; }
  restore(s) {
    if (!s || typeof s !== 'object') return this;
    if (s.available === true || s.available === false) this.available = s.available;
    if (Number.isFinite(s.nextAt)) this.nextAt = s.nextAt;
    if (Number.isFinite(s.taker)) this.taker = s.taker;
    if (Array.isArray(s.log)) this.log = s.log;
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
