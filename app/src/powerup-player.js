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
