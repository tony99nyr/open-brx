// powerup-player.js -- the PLAYER's side of the powerups (docs/spec/powerups.md, contracts A56): the constants, and the
// pure helpers the node engine (engine.js) builds its pickup writes from. A powerup STATION's own decision is the
// other side, in powerup.js; this file is never loaded by a station phone.

// ---------- A56 (S58): powerups (docs/spec/powerups.md) ----------
// Everything below is INERT unless the pushed config carries a powerup station with an `item` (MC sends one
// unless it was started with `--no-powerups`; powerups are ON by default, F372). Tony's defaults (2026-09-24),
// each a named constant so a change is one line:
export const PU_RESERVE = 0;                // a weapon item grants its charges as the MAGAZINE and no reserve
export const PU_LOST_AT_DEATH = true;       // a weapon item's unused charges do not carry into the next life
export const PU_ACTIVE_CARD_MS = 1200;      // F400: the ACTIVE confirm bubble's life after SWITCHING (hud.js `_swap('switched', el, 900, 1200)`)
export const PU_WEAPON_SWAPS = true;        // lead 2026-09-24: a second WEAPON pickup replaces the first (never refused)
export const PU_STACK_CAP_X = 2;            // F381 (Tony, 2026-09-25): the same weapon stacks up to this many times the item's own charges
export const OVERSHIELD_AMOUNT = 75;        // the fallback when an item carries no `amount` (MC normally expands it)
export const OVERSHIELD_DECAY_PER_S = 0;    // Tony: no decay. Not read yet: a non-zero value needs a decay writer first
// `charges` falls back to the weapon's own catalogue magazine (`clip`) when the item carries none: the fifth default.
// Tony 2026-09-24: "straight to trigger. id prefer trigger fires it", then "select should equip it if possible". A mid-life
// `$WEAP,<slot>,…` equips that slot on the trigger at once (bench 2026-09-24, powerups.md "Sitting A 3.3"), so the phone
// equips the heavy itself and no `$BMAP` is ever written: ALT keeps its job, SELECT stays at the head's `$BMAP,3,98`.
export const PU_SELECT_DEBOUNCE_MS = 400;   // a second SELECT press inside this is the same press (a double press toggles once)
export const PU_ANNOUNCE_MS = 2400;         // the spawn card's hold, and the gap between two announcements that land together
export const PU_ANNOUNCE_LATE_MS = 5000;    // a spawn noticed later than this (a frozen webview) is not announced
export const PU_READY_MS = 2500;            // how long the station hint names the item after a grant
export const PU_NEAR_DB = 10;               // GET CLOSER shows only within this of the station's own threshold
// The claim (Tony 2026-09-24, via the brx5 lead): stand about a foot from the station for 1 s, no button. Range is the
// MEDIAN of the last three samples of the station's advert (beacon.js `median`), never the respawn path's EMA.
export const POWERUP_THRESHOLD_DEFAULT = -55;   // byte 14 = 0: a placeholder for ~1 ft until the bench calibrates it
export const POWERUP_EXIT_DB = 3;               // out of range = the median below the threshold minus this
export const POWERUP_DWELL_MS = 1000;           // continuously in range this long = `claim_ready`; leaving range resets it
export const POWERUP_NO_ANSWER_MS = 15000;      // Bench B: Stick confirmation took up to 13 s; no answer at 15 s still allows a later taker advert.
export const POWERUP_READY_LATCH_MS = 15000;    // a `taker` advert still counts this long after the phone was last ready
export const PU_ADVERT_STALE_MS = 8000;     // an advert older than this says nothing about the item
// Tony 2026-09-24: "in halo if you get hit while you are getting overshield the damage is ignored". The grant is one burst
// (spawn protection on, a `$PSET` with the shield max raised, the absolute `$LIFE`), and protection ends this long after it.
export const OVERSHIELD_GRANT_MS = 1000;
export const OVERSHIELD_HIR_WAIT_MS = 1000;  // polish M1: a `$HIR` with no `$HP` after it holds the grant this long at most (a lethal hit in flight)
export const PU_BACK_RETRY_MS = 1500;       // polish M3: a switch-back the gun has not answered with an `$ALCD` for that slot is re-sent after this
export const OVERSHIELD_OFF_RETRIES = 3;   // r2: a protection-off that keeps failing is retried this often, then left to RESYNC GUN
export const PU_BACK_TRIES = 3;             // ...at most this many times
export const OVERSHIELD_ECHO_MS = 1500;     // a pre-grant `$HP` still in flight must not read as the overshield breaking
/** The spawn index at `elapsedMs` on the match clock (0 = the first spawn at `first_at_s`), or -1 before the first. PURE. */
export function puSpawnIndex(item, elapsedMs) {
  const every = Number(item && item.spawn_every_s) * 1000, first = Number(item && item.first_at_s) * 1000;
  if (!(every > 0) || !Number.isFinite(first) || !(elapsedMs >= first)) return -1;
  return Math.floor((elapsedMs - first) / every);
}
/** The match-clock time (ms after go-live) of spawn `k`. PURE. */
export function puSpawnAt(item, k) { return (Number(item.first_at_s) + k * Number(item.spawn_every_s)) * 1000; }

// F417/F418 (bench 2026-09-26): a held heavy's slot reading 0 with no trigger pull is the gun holding counts the node did
// not give it (a lost grant `$AMMO`, a lost or late reconcile write), never a round. The node re-sends the held counts
// this many times before it believes the 0 and ends the item, as it always did.
export const PU_COUNT_REPAIRS = 2;

/** "A held heavy keeps its charges": `frames` with the held heavy's `$AMMO` row carrying its charges (`held.left`,
 *  PU_RESERVE) in place of whatever the frame said, and every other slot in `zero` (a Set of pickup slots) at 0/0.
 *  Every other frame, `$AMMO` or not, is passed through verbatim, in order. `held` null (nothing held) changes only the
 *  `zero` slots. Used by the F416 burst re-send, the reconcile re-arm, the self-hit revive and the stun restore: each
 *  writes a spawn-shaped burst whose compiled pickup row is the empty one, and a separate restore after it would open
 *  the echo window after the zero had gone out (polish H1). PURE: frames in, frames out. */
export function burstWithHeld(frames, held, zero = null) {
  return frames.map(f => {
    if (typeof f !== 'string' || !f.startsWith('$AMMO,')) return f;
    const s = +f.split(',')[1];
    if (held && s === held.slot) return `$AMMO,${s},${held.left},${PU_RESERVE},1,*`;
    return zero && zero.has(s) ? `$AMMO,${s},0,0,1,*` : f;
  });
}

/** The player's powerup state: one instance per Engine (`engine.pu`). It owns every powerup field; the engine reaches it
 *  only through the methods and accessors below, and it reaches the engine only through `host` (see the file header). */
export class PlayerPowerups {
  constructor(host) {
    this.host = host;
    this.reset();
  }
  /** Every powerup state field back to empty: a new match, a new config, a reset. */
  reset() {
    this.host.show('puLost', null);   // HUD QA R2-17: {name, color, at} the weapon item a death took; cleared by the next life
    this._held = null;          // the weapon item: {station, weapon_id, slot, charges, left, name, color, at, back: {slot, mag, res}, trig}
    this._overshield = null;    // {station, base, amount, name, color, at}: the shield at the grant is `base`
    this._claim = null;         // {station, since, readyAt}: standing in range of a station whose item is there
    this._readyFor = null;      // {station, at}: the last station this phone was claim_ready for (the grant needs it)
    this._osProtectUntil = 0;   // now() at which the overshield grant's spawn protection ends (0 = none owed)
    this._advert = {};          // station id -> {state, value, taker, at}: the station's own last advert
    this._seen = {};            // station id -> the last spawn index the announcer has dealt with
    this._back = null;          // {name, to, at}: a weapon item ran dry and the saved weapon is returning
    this._reequip = false;      // a heavy was held at the death: re-equip slot 0 behind the revive burst
    this._selectAt = 0;         // now() of the last SELECT that acted (the debounce)
    this._backPending = null;   // {slot, mag, res, at, readyAt, equipped, tries}: an empty switch-back waiting for its swap window or a gun answer
    this._going = null;         // F400: {slot, name, color, weapon_id, charges, until} -- a slot losing its identity THIS call
                                // (the empty switch-back's heavy), kept for the HUD's SWITCHING card past the moment `_held` moves on
    this._hpAt = 0;             // now() of the last `$HP` (polish M1: a `$HIR` after it holds the overshield grant)
    this._psetNow = null;       // the `$PSET` the gun holds (the life's pool take); the next spawn sets it
    this._spawnCard = null;     // {name, color, at, station}: the "<ITEM> AVAILABLE" card (presentation only)
    this._grant = null;         // {name, color, kind, at, replaced?}: the grant, for the HUD's READY hint (state, at once)
    this._swapCard = null;      // {name, color, replaced, at}: the "<NEW> REPLACES <OLD>" card, set when the announcer reaches it
  }
  /** The `pu` block of the engine's persisted context (an app restart mid-match must still end a held item, re-equip
   *  slot 0 after a death with a heavy held, and keep the overshield out of the S29 refill's way), or null. */
  snapshot() {
    return this._held || this._overshield || this._reequip || this._backPending ? { held: this._held, overshield: this._overshield, seen: this._seen, reequip: !!this._reequip, osProtectUntil: this._osProtectUntil || 0, psetNow: this._psetNow || null, backPending: this._backPending || null } : null;
  }
  /** `_load`: the `pu` block `snapshot` wrote. */
  restore(p) { this._held = p.held || null; this._overshield = p.overshield || null; this._seen = p.seen || {}; this._reequip = !!p.reequip; this._osProtectUntil = +p.osProtectUntil || 0; this._psetNow = p.psetNow || null; this._backPending = p.backPending || null; }
  /** A spawn or revive wrote this life's `pset_pool` take: the overshield raises THIS frame's shield max, and restores it. */
  setPset(frame) { this._psetNow = frame; }

  // ---- read accessors (the engine, the golden-trace runner and tests read these; nothing writes the fields directly) ----
  /** The held weapon item, or null. A setter exists for tests that stage a held item without a grant. */
  get held() { return this._held; }
  set held(v) { this._held = v; }
  /** The overshield record, or null. A setter exists for tests. */
  get overshield() { return this._overshield; }
  set overshield(v) { this._overshield = v; }
  /** The grant card ({name, color, kind, at, replaced?}), or null. A setter exists for tests. */
  get grant() { return this._grant; }
  set grant(v) { this._grant = v; }
  get back() { return this._back; }
  get backPending() { return this._backPending; }
  get protectUntil() { return this._osProtectUntil; }
  get psetNow() { return this._psetNow; }
  get spawnCard() { return this._spawnCard; }
  get swapCard() { return this._swapCard; }
}
