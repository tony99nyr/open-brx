// reconcile.js -- the relink RECONCILE (spec/node.md §3.10, S7.1): what the phone does when the gun relinks, or a frozen
// app resumes, in a LIVE match. The gun keeps its config and pools across a BLE drop, so the node does not guess: it holds
// the gun disarmed for RECONCILE_MS, reads it, and re-arms it with the live counts. Inside that window the node INFERS
// nothing and ACTS on nothing of its own; it still READS (F264).
//
// Why a module: the window was one engine field, `reconciling`, read raw at about 35 sites, and each site asked its own
// question of it. The engine now holds one instance (`engine.rc`) and asks it by name. Nothing outside this file reads
// or writes a `_` field of it.
//
// PUBLIC SURFACE
//   RECONCILE_MS                        how long the window holds the gun disarmed
//   Reconcile(host)
//     state       window (rw: {since, ammo} or null; the setter is the seam tests use to stage a window) · clear()
//     questions   active · ownsRearm · infersNothing · disarmed · outOfBand
//
// The questions all read the same window today. They are named apart because each site asks a different thing, and a
// later rule (for example a window that keeps reading after the re-arm) must change one answer, not all of them:
//   active         the window is open (the stand-down table, the HUD's SYNCING takeover, the state view)
//   ownsRearm      the window's end re-arms the gun, so no other path arms it now (spawn protection, the weapon delay,
//                  a lost spawn write's repair)
//   infersNothing  §3.10: no death, respawn, revive or lock verdict is inferred now
//   disarmed       the gun is held at `$AMMO,<slot>,0,0`: an ammo frame is the disarm's echo, never fire, and no reload
//                  takeover starts
//   outOfBand      a pool report now is the gun catching the node up: a zero is a real (desync) death, never a B5 echo
//
// HOST INTERFACE (engine.js `reconcileHost`; every member looks the engine up at call time)
//   none yet: the window's state lives here, its begin and end still live in engine.js

/** Rejoin: hold the gun disarmed this long while we reconcile state (anti-cheat: a restart is slow and gains nothing;
 *  a real crash costs 3 s, which is rare and fine, Tony 2026-09-04). */
export const RECONCILE_MS = 3000;

export class Reconcile {
  /** @param {object} host the engine's side (engine.js `reconcileHost`) */
  constructor(host) {
    this.host = host;
    /** @type {any} {since, ammo}: a rejoin's disarmed window (S7.1), or null */
    this._win = null;
  }

  // ---- state ----
  get window() { return this._win; }
  set window(w) { this._win = w; }
  /** Close the window with no re-arm: a new match, the match end and a panic each own the gun from here. */
  clear() { this._win = null; }

  // ---- the questions (see the header for what each one means) ----
  get active() { return !!this._win; }
  get ownsRearm() { return !!this._win; }
  get infersNothing() { return !!this._win; }
  get disarmed() { return !!this._win; }
  get outOfBand() { return !!this._win; }
}
