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
//                           player: bit0 alive, bit1 planting, bit2 defusing, bit3 extracting)
//   11   value             kind-specific small number (seconds left, cooldown, progress %)
//   12   seq               bumps on every state change so a scanner can tell a fresh advert from a stale one
//   13   game              low 8 bits of the game's config hash; 0 = any game (a station from another match is ignored)
//   14   threshold         the station's own "you are AT me" RSSI in dBm as int8 (0 = use the scanner's default).
//                           Calibrated on the station's screen, so player phones need no per-station config.
//   15   reserved          0

export const MAGIC = [0x4f, 0x42, 0x52, 0x58];
export const VERSION = 1;
export const ROLE = { station: 1, player: 2 };
export const KIND = { respawn: 1, powerup: 2, extraction: 3, bomb: 4, control: 5 };
export const KIND_NAME = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v, k]));
export const TEAM_ANY = 255;
export const PLAYER_STATE = { alive: 1, planting: 2, defusing: 4, extracting: 8 };

const hex2 = n => (n & 0xff).toString(16).padStart(2, '0');

/** Build the UUID string for a station or a player advert. Unknown/absent fields default to 0. */
export function encodeUuid({ role, id = 0, kind = 0, team = TEAM_ANY, state = 0, value = 0, seq = 0, game = 0, threshold = 0 }) {
  const r = typeof role === 'string' ? ROLE[role] : role;
  if (!r) throw new Error('role required (station|player)');
  const k = typeof kind === 'string' ? (KIND[kind] || 0) : kind;
  const thr = threshold ? (threshold < 0 ? 256 + Math.max(-128, Math.round(threshold)) : Math.min(127, Math.round(threshold))) : 0;
  const b = [...MAGIC, VERSION, r, (id >> 8) & 0xff, id & 0xff, k, team & 0xff, state & 0xff, value & 0xff, seq & 0xff, game & 0xff, thr & 0xff, 0];
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
    team: b[9], state: b[10], value: b[11], seq: b[12], game: b[13], threshold: thr };
}

/** The first Open BRX advert among a scan result's service UUIDs, decoded, or null. */
export function decodeAdvert(uuids) {
  for (const u of uuids || []) { const d = decodeUuid(u); if (d) return d; }
  return null;
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
    Object.assign(this, { dwellMs, hysteresisDb, expiryMs, alpha, defaultThreshold, game });
    this.entries = new Map();          // key role:id → entry
  }
  observe(uuids, rssi, now) {
    const d = decodeAdvert(uuids);
    if (!d || typeof rssi !== 'number') return null;
    if (this.game && d.game && d.game !== this.game) return null;   // another match's station
    const key = `${d.role}:${d.id}`;
    let e = this.entries.get(key);
    if (!e) { e = { ...d, rssi: rssi, raw: rssi, seenAt: now, present: false, sinceAbove: null, firstAt: now }; this.entries.set(key, e); }
    else {
      const fresh = d.seq !== e.seq || d.state !== e.state || d.team !== e.team || d.value !== e.value || d.threshold !== e.threshold;
      Object.assign(e, d, { raw: rssi, seenAt: now, rssi: e.rssi + this.alpha * (rssi - e.rssi) });
      if (fresh) e.changedAt = now;
    }
    return e;
  }
  thresholdFor(e) { return e.threshold || this.defaultThreshold; }
  tick(now) {
    for (const [key, e] of this.entries) {
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

/** A plain snapshot of a station entry for engine state / diagnostics. */
export function stationView(e) {
  if (!e) return null;
  return { id: e.id, kind: e.kind, team: e.team, state: e.state, value: e.value, rssi: Math.round(e.rssi), threshold: e.threshold, present: !!e.present };
}
