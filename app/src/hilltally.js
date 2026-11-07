// hilltally.js: A88 (Tony 2026-11-07), the phone relays each hill's Domination tally to MC.
//
// Under A87 MC scores Domination from the phones' `own_change` reports. A capture that no phone in Wi-Fi saw is lost
// from that timeline. A hill (Stick, Android phone) advertises its own `own_ms` tally beside its UUID (beacon.js
// `encodeTally`), and a phone that hears it keeps the latest one per (site, game byte) and sends it to MC as a persisted
// `hill_tally` fact. MC uses it to fill gaps only (contracts A88). After the match the phone keeps listening on the
// way back to MC, because a hill that hears an ended phone ends the game and trims its tally (control.js `endOwn`), and
// that `final` tally is the exact one.
//
// When a fact goes out (brx4, A88):
//  - at once when a `final` tally for a site is new or different;
//  - before that, when a live tally changed, at most once every HILL_TALLY_SEND_MS per (site, game).
// Only for the game bytes of this phone's current and previous match, tagged with that match's id, and only while MC's
// config asks for it (`hill_tally: true`), so a new phone never sends a fact an older MC does not know. PURE: no BLE, no
// DOM; the caller passes decoded scan hits and the clock.

import { decodeUuid, decodeTally, tallyBytes } from './beacon.js';

export const HILL_TALLY_SEND_MS = 30000;
// How long after its end a phone keeps the beacon scan open for the walk back (the end info's own range, about 17 min).
export const HILL_TALLY_LISTEN_MS = 17 * 60000;

export class HillTallyRelay {
  /** `emit(fact)`: the engine's emitFact (persisted and retried by the outbox). `store` ({load() -> json|null, save(json)}):
   *  where the game-byte -> match map survives an app restart, so a final for the previous match still goes out (Codex
   *  review). */
  constructor({ emit, store = null } = {}) {
    this.emit = emit || (() => {});
    this.store = store;
    this.games = new Map();   // game byte -> match_id (the current and the previous match)
    this.tallies = new Map(); // `${site}:${game}` -> { site, game, matchId, ownS, final, partial, heardAt, sent, sentAt, owed }
    try {
      const saved = store && store.load();
      for (const [g, m] of Array.isArray(saved) ? saved.slice(-2) : []) if (Number.isInteger(g) && g >= 1 && g <= 255 && typeof m === 'string' && m) this.games.set(g, m);
    } catch (_) { /* a broken save is no save */ }
  }
  /** The match this phone plays (or played) on `gameByte`. Keeps the newest two. */
  noteMatch(gameByte, matchId) {
    if (!Number.isInteger(gameByte) || gameByte < 1 || gameByte > 255 || !matchId) return;
    if (this.games.get(gameByte) === matchId) return;
    this.games.delete(gameByte);
    this.games.set(gameByte, matchId);
    while (this.games.size > 2) this.games.delete(this.games.keys().next().value);
    try { if (this.store) this.store.save([...this.games]); } catch (_) { /* best-effort */ }
    // a byte that now names another match: its old tallies are another game's
    for (const [k, t] of this.tallies) if (!this.games.has(t.game) || this.games.get(t.game) !== t.matchId) this.tallies.delete(k);
  }
  /** One scan hit `{ uuids, manufacturerData }`. `enabled`: MC's config asked for the fact. Returns the tally it took, or null. */
  observe(hit, now, enabled) {
    if (!enabled || !hit) return null;
    const bytes = tallyBytes(hit.manufacturerData);
    if (!bytes) return null;
    let st = null;
    for (const u of hit.uuids || []) { const d = decodeUuid(u); if (d && d.role === 'station' && d.kind === 'control') { st = d; break; } }
    if (!st || !st.id) return null;   // the tally counts only beside our own control-point UUID (company 0xFFFF is unregistered)
    const t = decodeTally(bytes);
    if (!t || !this.games.has(t.game)) return null;
    const matchId = this.games.get(t.game), key = `${st.id}:${t.game}`;
    const old = this.tallies.get(key);
    if (old && old.final && !t.final) { old.heardAt = now; return old; }   // a final is never replaced by a live one
    const sig = JSON.stringify([t.ownS, t.final, t.partial]);
    const e = old || { site: String(st.id), game: t.game, matchId, sent: null, sentAt: -Infinity };
    Object.assign(e, { ownS: t.ownS, final: t.final, partial: t.partial, heardAt: now, owed: sig !== e.sent });
    this.tallies.set(key, e);
    this.tick(now, enabled);
    return e;
  }
  /** Send what is owed: a new final at once, a changed live tally at most every HILL_TALLY_SEND_MS. `enabled`: MC's config
   *  still asks for the fact (Codex review: a tally owed under one config must not go to an MC that no longer asks). */
  tick(now, enabled) {
    if (!enabled) return;
    for (const e of this.tallies.values()) {
      if (!e.owed || (!e.final && now - e.sentAt < HILL_TALLY_SEND_MS)) continue;
      e.owed = false; e.sentAt = now; e.sent = JSON.stringify([e.ownS, e.final, e.partial]);
      this.emit({ type: 'hill_tally', match_id: e.matchId, site: e.site, game_byte: e.game, own_s: { ...e.ownS },
        final: e.final, partial: e.partial, heard_age_ms: Math.max(0, Math.round(now - e.heardAt)) });
    }
  }
}

/** When this phone's match ended, on the engine's clock (Codex review). `endedAt` is when the phone NOTICED the end: a phone
 *  suspended across its time limit notices minutes late, and its end info would then let a hill keep those minutes. So
 *  the scheduled end (`endT`, go-live + time limit) is remembered while the match runs, and the end is the earlier one. */
export class EndClock {
  constructor() { this.endT = null; this.matchId = null; }
  /** Every tick: `st` is engine.state(), `endT` the engine's scheduled end (null after the end or with no time limit). */
  note(st, endT, matchId) {
    if (matchId !== this.matchId) { this.matchId = matchId; this.endT = null; }
    if (st && !st.ended && Number.isFinite(endT)) this.endT = endT;
  }
  /** The ms since the end, or null when the match has not ended. */
  ageMs(st, now) {
    if (!st || !st.ended || !st.endedAt) return null;
    const at = Number.isFinite(this.endT) ? Math.min(st.endedAt, this.endT) : st.endedAt;
    return now - at;
  }
}

/** True while an ended phone should keep listening for hill tallies on the way back: MC asked for them, the match ended
 *  (not a no-result end) under HILL_TALLY_LISTEN_MS ago, and the game had stations. `endAgeMs` is on the engine's clock. */
export function tallyListening(st, config, endAgeMs) {
  return !!(st && st.ended && config && config.hill_tally === true && Number.isFinite(endAgeMs) && endAgeMs >= 0 && endAgeMs < HILL_TALLY_LISTEN_MS);
}
