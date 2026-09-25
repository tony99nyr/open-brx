// beacon.js — the utility-item identity codec and the presence tracker (docs/spec/utility.md).
// DOM/BLE-free and pure so it runs in node tests, the desktop stage and on the phone unchanged.
//
// Identity rides in ONE 128-bit service UUID because that is the only advert field an iOS app can set
// besides the local name (Android could carry manufacturer data, but one format for both keeps the
// scanner simple). 16 bytes, big-endian where wider than a byte:
//
//   0-3  'O','B','R','X'   magic (0x4F 0x42 0x52 0x58)
//   4    version           1
//   5    role              1 = station (a utility item), 2 = player (a HUD phone)
//   6-7  id                station id 1..65535, or the player's player_num
//   8    kind              station: 1 respawn · 2 powerup · 3 extraction · 4 bomb · 5 control  (player: 0)
//   9    team              0..3 = the gun's $TID team, 255 = neutral / any team
//   10   state             kind-specific (respawn: 1 ready · 0 disabled; bomb: 0 idle 1 planted 2 defused 3 detonated;
//                           player: bit0 alive, bit1 planting, bit2 defusing, bit3 extracting, bit4 claiming,
//                           bit5 claim_ready (A56 powerups: standing at a powerup station, then past the 1 s dwell);
//                           powerup: 1 available · 0 taken (value = seconds to the next spawn; 0 with value 0 = unknown)
//   11   value             kind-specific small number (seconds left, cooldown, progress %); a claiming player: the station id
//   12   seq               bumps on every state change so a scanner can tell a fresh advert from a stale one
//   13   game              the match's game byte from MC (station_config.game = config.game_byte); 0 = any game (a station from another match is ignored)
//   14   threshold         the station's own "you are AT me" RSSI in dBm as int8 (0 = use the scanner's default).
//                           Calibrated on the station's screen, so player phones need no per-station config.
//   15   taker             A56: a powerup station's winner, the player_num it granted the item to (0 = none);
//                           cleared at the next spawn. 0 on every other advert.

export const MAGIC = [0x4f, 0x42, 0x52, 0x58];
export const VERSION = 1;
export const ROLE = { station: 1, player: 2 };
export const KIND = { respawn: 1, powerup: 2, extraction: 3, bomb: 4, control: 5 };
export const KIND_NAME = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v, k]));
export const TEAM_ANY = 255;
export const PLAYER_STATE = { alive: 1, planting: 2, defusing: 4, extracting: 8, claiming: 16, claim_ready: 32 };
/** A56: how many raw samples the claim range reads a median over (one wild sample out of three is ignored). */
export const MEDIAN_SAMPLES = 3;
/** The median of a short list of RSSI samples (the lower middle for an even count). PURE. */
export function medianOf(samples) {
  const a = (samples || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.floor((a.length - 1) / 2)];
}

const hex2 = n => (n & 0xff).toString(16).padStart(2, '0');

/** Build the UUID string for a station or a player advert. Unknown/absent fields default to 0. */
export function encodeUuid({ role, id = 0, kind = 0, team = TEAM_ANY, state = 0, value = 0, seq = 0, game = 0, threshold = 0, taker = 0 }) {
  const r = typeof role === 'string' ? ROLE[role] : role;
  if (!r) throw new Error('role required (station|player)');
  const k = typeof kind === 'string' ? (KIND[kind] || 0) : kind;
  const thr = threshold ? (threshold < 0 ? 256 + Math.max(-128, Math.round(threshold)) : Math.min(127, Math.round(threshold))) : 0;
  const b = [...MAGIC, VERSION, r, (id >> 8) & 0xff, id & 0xff, k, team & 0xff, state & 0xff, value & 0xff, seq & 0xff, game & 0xff, thr & 0xff, taker & 0xff];
  const h = b.map(hex2).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Parse a UUID string; null when it is not an Open BRX advert. Accepts either case, with or without dashes. */
export function decodeUuid(s) {
  const h = String(s || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return null;   // strict: parseInt('4g',16) would yield 4, not NaN
  const b = []; for (let i = 0; i < 32; i += 2) b.push(parseInt(h.slice(i, i + 2), 16));
  if (b[0] !== MAGIC[0] || b[1] !== MAGIC[1] || b[2] !== MAGIC[2] || b[3] !== MAGIC[3]) return null;
  if (b[4] !== VERSION) return null;
  const role = b[5] === ROLE.station ? 'station' : b[5] === ROLE.player ? 'player' : null;
  if (!role) return null;
  const thr = b[14] === 0 ? 0 : (b[14] > 127 ? b[14] - 256 : b[14]);
  return { role, id: (b[6] << 8) | b[7], kind: role === 'station' ? (KIND_NAME[b[8]] || `kind${b[8]}`) : null,
    team: b[9], state: b[10], value: b[11], seq: b[12], game: b[13], threshold: thr, taker: b[15] };
}

/** The first Open BRX advert among a scan result's service UUIDs, decoded, or null. */
export function decodeAdvert(uuids) {
  for (const u of uuids || []) { const d = decodeUuid(u); if (d) return d; }
  return null;
}

/**
 * The game byte a PLAYER phone scopes by: presence filtering and its own advert. MC sends `config.game_byte`,
 * the same number it arms its stations with (`station_config.game`), so one match has one byte on both sides.
 * Absent or malformed (an older MC) = 0, "any game": Presence accepts either side's 0, so an older MC still
 * works. Never a hash of `config_id`: no MC-armed station (phone or StickS3) ever carries that number.
 */
export function configGameByte(config) {
  const b = config && config.game_byte;
  return Number.isInteger(b) && b >= 1 && b <= 255 ? b : 0;
}

/**
 * Presence: which stations (or players) are near, by smoothed RSSI against a threshold, with dwell and
 * hysteresis so a reading that flickers at the edge does not flicker the answer (utility.md §3).
 *
 *   observe(uuids, rssi, now)  feed every scan hit (non-Open-BRX adverts are ignored)
 *   tick(now)                  advance dwell / expiry; call it a few times a second
 *   stations() / players()     current entries; each carries { present, rssi (EMA), raw, seenAt, ... }
 *
 * present flips ON after `dwellMs` continuously at/above the threshold and OFF when the EMA falls
 * `hysteresisDb` below it, or when no advert has arrived for `expiryMs`. The threshold is the
 * station's own advertised one when set, else `defaultThreshold`.
 */
export class Presence {
  constructor({ dwellMs = 2000, hysteresisDb = 6, expiryMs = 4000, alpha = 0.35, defaultThreshold = -62, game = 0 } = {}) {
    this.entries = new Map();          // key role:id → entry
    Object.assign(this, { dwellMs, hysteresisDb, expiryMs, alpha, defaultThreshold, game });
  }
  get game() { return this._game || 0; }
  /** X10: a new game byte drops every entry learnt under a different non-zero byte at once. Without this, a
   *  station from the old game stayed present until `expiryMs` ran out. An entry on byte 0 (any game) stays. */
  set game(b) {
    const g = b || 0;
    if (g === this._game) return;
    this._game = g;
    if (!g) return;
    for (const [key, e] of this.entries) if (e.game && e.game !== g) this.entries.delete(key);
  }
  observe(uuids, rssi, now) {
    const d = decodeAdvert(uuids);
    if (!d || typeof rssi !== 'number') return null;
    if (this.game && d.game && d.game !== this.game) return null;   // another match's station
    const key = `${d.role}:${d.id}`;
    let e = this.entries.get(key);
    if (!e) { e = { ...d, rssi: rssi, raw: rssi, seenAt: now, present: false, sinceAbove: null, firstAt: now, samples: [rssi], median: rssi }; this.entries.set(key, e); }
    else {
      const fresh = d.seq !== e.seq || d.state !== e.state || d.team !== e.team || d.value !== e.value || d.threshold !== e.threshold || d.taker !== e.taker;
      Object.assign(e, d, { raw: rssi, seenAt: now, rssi: e.rssi + this.alpha * (rssi - e.rssi) });
      // A56: the powerup claim reads the MEDIAN of the last MEDIAN_SAMPLES raw samples, beside the EMA (which the
      // respawn and control paths keep reading, unchanged): a 1 ft range cannot afford one wild sample.
      e.samples = [...(e.samples || []), rssi].slice(-MEDIAN_SAMPLES); e.median = medianOf(e.samples);
      if (fresh) e.changedAt = now;
    }
    return e;
  }
  thresholdFor(e) { return e.threshold || this.defaultThreshold; }
  tick(now) {
    for (const [key, e] of this.entries) {
      // How long since this advert actually arrived, stamped HERE so it is a duration on ONE clock. A reader
      // must never subtract `seenAt` from a clock of its own: `observe`/`tick` are called with the raw
      // `Date.now()`, while a node's `now()` is `Date.now()` plus the MC clock offset, so a >4 s offset made
      // every advert look stale (or none of them) with no log line saying why. F84's shape, with the clock as
      // the wide constant.
      e.ageMs = now - e.seenAt;
      if (now - e.seenAt > this.expiryMs) { e.present = false; e.sinceAbove = null; if (now - e.seenAt > 2 * this.expiryMs) this.entries.delete(key); continue; }
      const thr = this.thresholdFor(e);
      if (e.present) { if (e.rssi < thr - this.hysteresisDb) { e.present = false; e.sinceAbove = null; } continue; }
      if (e.rssi >= thr) { if (e.sinceAbove == null) e.sinceAbove = now; if (now - e.sinceAbove >= this.dwellMs) e.present = true; }
      else e.sinceAbove = null;
    }
  }
  _list(role) { return [...this.entries.values()].filter(e => e.role === role).sort((a, b) => b.rssi - a.rssi); }
  stations() { return this._list('station'); }
  players() { return this._list('player'); }
  /** Strongest PRESENT station of a kind that admits `team` (its own team, or neutral). */
  presentStation(kind, team) {
    return this.stations().find(e => e.present && e.kind === kind && (e.team === TEAM_ANY || e.team === team)) || null;
  }
  /** Strongest station of a kind for `team`, present or not (the HUD shows how close you are). */
  nearestStation(kind, team) {
    return this.stations().find(e => e.kind === kind && (e.team === TEAM_ANY || e.team === team)) || null;
  }
}

/**
 * The "at me" threshold a station advertises in byte 14 when MC sent 0 (or nothing): its own PLATFORM default
 * (F345, Tony 2026-09-24: a respawn station reaches 3 m at most). Measured at 3 m on the player phone: a phone
 * station -63 to -68 dBm, a StickS3 -53 to -58. The StickS3's value lives in its firmware
 * (`hardware/m5sticks3/station_link.h` STICK_DEFAULT_THRESHOLD_DBM); this table is the record both sides follow.
 * Same shape as the powerup claim's per-platform default (docs/spec/powerups.md "Threshold").
 */
export const RESPAWN_RSSI_DBM = Object.freeze({ phone: -70, sticks3: -57 });   // Tony 2026-09-24, walked at 3-5 m
/** Every other kind on a phone station keeps the 2026-09-04 bench value (about 10 ft at high TX). */
export const STATION_THRESHOLD_DBM = -74;
/** A phone station's own default for `kind` (utility.js, when `settings.threshold` is 0). */
export const POWERUP_RSSI_DBM = Object.freeze({ phone: -55 });   // S58: a phone station's ~1 ft claim range, a placeholder until bench 4.11 (a StickS3 advertises -57)
export function phoneStationThreshold(kind) { return kind === 'respawn' ? RESPAWN_RSSI_DBM.phone : kind === 'powerup' ? POWERUP_RSSI_DBM.phone : STATION_THRESHOLD_DBM; }

/** utility.js `thr()`: what a phone station advertises and measures by, its override or else its platform default. */
export function stationThreshold({ threshold, kind }) { return threshold || phoneStationThreshold(kind); }
/** `station_config.threshold` -> the phone station's stored value. 0 = the platform default (F345; 0.4.11 and older
 *  clamped it to -30 dBm, a bubble of a few cm). Not a number: keep `current`. */
export function applyThreshold(raw, current) {
  if (raw == null || raw === '' || !Number.isFinite(+raw)) return current;
  if (+raw === 0) return 0;
  return Math.max(-100, Math.min(-30, Math.round(+raw)));
}
/** Settings saved before thrV 2 stored the old -74 default as if chosen: read it as 0 (the platform default) once. */
export function migrateThreshold(saved) {
  if (saved.thrV === 2) return saved;
  return { ...saved, threshold: saved.threshold === STATION_THRESHOLD_DBM ? 0 : saved.threshold, thrV: 2 };
}

/**
 * A respawn station's revive count (utility.js tick; F344). A revive is a player whose alive bit went 0 -> 1 while
 * the station heard them NEAR: the median of their last MEDIAN_SAMPLES readings at or above the station's
 * threshold minus REVIVE_MARGIN_DB. It is deliberately NOT `present`. The player decides the revive on the
 * station's HIGH-TX advert; the station hears the player's MEDIUM-TX advert, about 8 dB weaker at the same
 * distance, and `present` adds a 0.8 s dwell behind an EMA. A player who walked in, pulled the trigger and left
 * was never present on the station side (field 2026-09-24: a phone station at -74 counted neither of two
 * revives). The margin covers the TX gap plus 2 dB.
 *
 * Review of a10eed0c: only a player the station serves counts (its own team, or anyone at a TEAM_ANY station; M1),
 * and only a 0 -> 1 edge after the station has SEEN that player die, alive then down (M2). So go-live beside the
 * base station (down in the lobby, alive at the start) and a first-heard-down player coming up (a resync, a reload)
 * never count. `memory` (player id -> { alive, died }) is the caller's, for ONE game: clear it when the game
 * changes. It outlives Presence's expiry on purpose, so a player who died out of earshot and walked in still
 * counts; REVIVE_MEMORY_MAX bounds it. Returns the players counted on this call.
 * The StickS3 copies the old rule (`hardware/m5sticks3/presence.h` ReviveCounter) and needs the same change.
 */
export const REVIVE_MARGIN_DB = 10;
export const REVIVE_MEMORY_MAX = 256;
export function countRevives(presence, memory, { team = TEAM_ANY } = {}) {
  const revived = [];
  for (const p of presence.players()) {
    if (p.ageMs != null && p.ageMs > presence.expiryMs) continue;   // a stale entry says nothing new
    if (team !== TEAM_ANY && p.team !== team) continue;
    const alive = !!(p.state & PLAYER_STATE.alive);
    const m = memory.get(p.id);
    if (!m) {
      if (memory.size >= REVIVE_MEMORY_MAX) memory.delete(memory.keys().next().value);
      memory.set(p.id, { alive, died: false });
      continue;
    }
    if (m.alive && !alive) m.died = true;
    else if (!m.alive && alive && m.died) {
      const level = Number.isFinite(p.median) ? p.median : p.rssi;
      if (level >= presence.thresholdFor(p) - REVIVE_MARGIN_DB) revived.push(p);
      m.died = false;
    }
    m.alive = alive;
  }
  return revived;
}

/** A plain snapshot of a station entry for engine state / diagnostics. */
export function stationView(e) {
  if (!e) return null;
  return { id: e.id, kind: e.kind, team: e.team, state: e.state, value: e.value, rssi: Math.round(e.rssi), threshold: e.threshold, present: !!e.present,
    ...(e.taker ? { taker: e.taker } : {}), ...(Number.isFinite(e.median) ? { median: Math.round(e.median) } : {}),
    ...(Number.isFinite(e.ageMs) ? { ageMs: Math.round(e.ageMs) } : {}) };
}

/** Polish H1: the fewest ms between two restarts that change ONLY the advert's `value` byte (a claim's station id). */
export const ADVERT_VALUE_MIN_MS = 1000;
/** F331: the fewest ms between ANY two advert starts. At the range edge the claim's state bits can flap every 250 ms tick. */
export const ADVERT_START_MIN_MS = 300;
/** F331: how long a failed start waits before it is tried again (it was every 250 ms tick). */
export const ADVERT_FAIL_BACKOFF_MS = 1000;
/**
 * The player advert's restart gate (polish H1). It compares the WHOLE UUID, so a new game byte, player id, team or
 * state always goes out, and it records a start only once the plugin says it worked:
 *   due(want, now) -> 'start' | 'stop' | null     what to do this tick (`want` = the UUID, or null = advertise nothing)
 *   started(uuid, now) / stopped()                 after the plugin call succeeded
 *   failed(action, now)                            after it threw: a failed start is retried, a failed stop too
 * A change of the `value` byte alone is rate-limited to ADVERT_VALUE_MIN_MS (Android throttles restarts). F331: any
 * two starts are at least ADVERT_START_MIN_MS apart (state bits flap at the range edge), and a start waits
 * ADVERT_FAIL_BACKOFF_MS after a failed one. A stop is never held.
 */
export class AdvertGate {
  constructor({ minValueMs = ADVERT_VALUE_MIN_MS, minStartMs = ADVERT_START_MIN_MS, failBackoffMs = ADVERT_FAIL_BACKOFF_MS } = {}) {
    this.minValueMs = minValueMs; this.minStartMs = minStartMs; this.failBackoffMs = failBackoffMs;
    this.last = null; this.lastAt = 0; this.triedAt = -Infinity; this.failedAt = -Infinity;
  }
  due(want, now) {
    if (!want) return this.last ? 'stop' : null;
    if (want === this.last) return null;
    if (now - this.triedAt < this.minStartMs || now - this.failedAt < this.failBackoffMs) return null;
    if (this.last && valueless(want) === valueless(this.last) && now - this.lastAt < this.minValueMs) return null;
    return 'start';
  }
  started(uuid, now) { this.last = uuid; this.lastAt = now; this.triedAt = now; }
  stopped() { this.last = null; }
  // A failed start leaves the radio in an unknown state (maybe still the previous advert): any start is due again, and
  // so is a stop. A failed stop keeps `last`, so the stop is due again.
  failed(action, now = Date.now()) { if (action === 'start') { this.last = UNKNOWN; this.lastAt = 0; this.triedAt = now; this.failedAt = now; } }
}
const UNKNOWN = '?';   // AdvertGate: the radio's state after a failed start
/** The UUID with its `value` byte (byte 11) blanked. */
function valueless(uuid) { const h = String(uuid).replace(/-/g, ''); return h.slice(0, 22) + '00' + h.slice(24); }
