// ammo.js -- the gun's AMMUNITION as the node keeps it: the magazine account, the counts per weapon slot, the ammo
// block the HUD shows and the heat lockout (F259, F164, F394, pl4).
//
// Why a module: the magazine had no single interface. The account (`_shotAcct`), the last counts per slot
// (`_prevAmmo`/`_prevReserve`), the echo window and the HUD's ammo block were engine fields, read raw by the spawn,
// the revive, the stun, the reconcile, the operator RESYNC GUN, the F416 spawn check and the powerup module. Now one
// class owns them; the engine holds one instance (`engine.am`), calls its entry points and asks it by name.
//
// PUBLIC SURFACE
//   TRIGGER_NO_FIRE_MS · ACC_ECHO_MS · OVERHEAT_CAP_MS · HEAT_STALE_MS · OVERHEAT_SHOWN_MS
//   Ammo(host)
//     account     acctLive(slot, now) · acctOutstanding(slot, now) · acctEchoing(slot, now) · pressedRounds(slot) ·
//                 acctWrote(slot, mag, res) · acctPress() · acctAmmo(slot, mag, prev)
//     counts      liveAmmo() · spawnAmmo() · ammoBySlot() · setPrev(slot, mag, res) · saved() · restore(saved) ·
//                 forgetCounts()
//     the HUD     publish(slot, mag, reserve) · showSlot(slot) · forgetShown()
//     heat        noteHeat(slot, heat) · heatLockFrame(slot, heat, prev, mag) · heatLockPress() · heatBlocksFire(now) ·
//                 overheatOnHud(now) · heatOf(slot) · heatedEver(slot) · forgetHeat()
//     state       acct · prevAmmo · prevReserve · magBySlot · heatBySlot · heatAt · everHeated · heatLock (read them;
//                 change them through the methods above)
//
// HOST INTERFACE (engine.js `ammoHost`; every member looks the engine up at call time)
//   services    now() · fireIntervalMs(slot) · recoilStep(n)
//   read-only   activeSlot · frames · phase · alive · recoil (the engine's live accuracy model, or null)
//   writes      setAmmo(ammo, mag) · setReserve(reserve)   the ammo block's numbers (`engine.ammo`, `.mag`, `.reserve`)

/** F208: a trigger press on a live, loaded gun gets its `$ALCD` inside ~5 ms (2026-08-26 burst rifle capture).
 *  With no pool report 1500 ms after the press, the pull went unanswered (the same window resync uses). */
export const TRIGGER_NO_FIRE_MS = 1500;
// F259 (bench 2026-09-18): how long the node owns a slot's magazine after it writes one, when the gun has
// not yet echoed the number back. A `$WEAP` + `$AMMO` pair makes the gun send `$ALCD <clip>` then
// `$ALCD <n>`, and that second frame is a decrement of `clip - n` that is NOT fire. The window normally
// closes on the gun reporting `n` (one round trip: the bench measured a write landing in 30-90 ms), so this
// is only the backstop for a write the gun never answers.
//
// Polish review 2026-09-18: it was 400 ms, and BELOW ACC_VERIFY_GRACE_MS on the reasoning that the window
// must not outlive the verify judging the same write. That coupling was wrong -- the verify judges the two
// ACCURACY tokens, this window judges the MAGAZINE, and they are different facts about one write -- and the
// deadline reinstated the whole 2026-09-18 oscillation on any link slower than itself: the `$WEAP` reset
// frame then arrives after the window has lapsed, lands on the ordinary path as a magazine RISE (the HUD
// jumps to the clip, the reload takeover is fed), and the restore behind it books the synthetic drop as a
// burst. The window now closes on the VALUE -- `_acctAmmo` shuts it the moment the gun reports the number
// the node wrote -- so on a working link it lasts one round trip and this number is never reached. It is
// only the horizon past which the node stops waiting for a write the gun never answers.
//
// ⚠ It is a DIAL, and the only number here with no measurement behind it. What it trades: while the window
// is open the node shows its own account instead of the gun, and a round that leaves inside it is not
// booked into `shots`, because its `$ALCD` still reads above what we wrote and cannot be told from the
// reset (F266). 700 ms covers a link seven times slower than anything the bench has seen (30-90 ms) and
// costs about seven rounds of a 100 ms weapon in the worst case.
//
// 700 rather than 1200: a gun can stop talking ENTIRELY. One went silent for 100 s mid-match with its ammo
// frozen at 32 while the node went on reporting the last pools it had heard, so "the gun never answers" is
// neither hypothetical nor rare. When the node is blind it should admit it sooner, and every millisecond of
// horizon is a millisecond the HUD shows an account instead of the gun. Sitting just under
// TRIGGER_NO_FIRE_MS would have been a coincidence, not a reason.
export const ACC_ECHO_MS = 700;
// Bench 2026-09-17 (Tony): weapon heat ($ALCD token 5) rises while firing a heat weapon, and the gun will not
// fire once it reaches the lockout line. Below it, heat is build-up, not a fault; the HUD shows the level either
// way, but only calls it OVERHEAT at or past this line. pl4 (brx-weapons bench, same day): the line is 99, not
// "above 100". The Charge Rifle (about +8 a shot) stopped at about 103-108 and locked for ~4.8 s; the Energy
// Rifle (about +3 a shot) stopped firing AT 99, never above 100, and locked for 10-23 s. `heat >= 99` holds
// both; the old `> 100` never saw the Energy Rifle's lockout at all.
const HEAT_LOCKOUT = 99;
// ---- the three heat windows move together (maint review 2026-09-17) --------------------------------
// OVERHEAT_SHOWN_MS < HEAT_STALE_MS < OVERHEAT_CAP_MS, and engine.test.mjs asserts that order.
//   OVERHEAT_SHOWN_MS  the DISPLAY window: how long the HUD keeps the word and the bar hot after the last
//                      evidence of the lockout (`overheatOnHud`).
//   HEAT_STALE_MS      the MECHANIC's window: how long a heat reading is still trusted to mean "this gun
//                      cannot fire" (`heatBlocksFire`), which exempts a dry pull from `no_fire`.
//   OVERHEAT_CAP_MS    the hard ceiling on the display window, so the word can never sit for a whole life.
// The display must clear BEFORE the mechanic's trust lapses (the lockout itself ends long before a player
// stops trying), and the cap must sit above both or it would cut the other two short.
// ----------------------------------------------------------------------------------------------------
// pl4: the longest OVERHEAT can stay up after the lockout's first reading, whatever else is seen. Above the
// longest measured lockout (Energy Rifle, 23 s) with margin, so the word can never stick for a whole life.
export const OVERHEAT_CAP_MS = 30000;
// Review 2026-09-17: a locked-out weapon sends NO $ALCD while it cools (bench match 592e444eff: "10 pulls,
// no $ALCD"), so a heat reading above HEAT_LOCKOUT can sit unrefreshed forever once the player stops
// pulling the trigger -- OVERHEAT would stick and `no_fire` would never take over from it. The bench-measured
// lockout hold is ~4.8 s and heat decays ~30/unit-per-s once it starts cooling, so the mechanic itself clears
// in a few seconds -- but the field capture pinned in pool-stale.test.mjs (the 02dd94 log) shows a player
// dry-firing a LOCKED weapon for ten pulls (~2 s cadence, ~20 s) before giving up, and the exemption must
// hold for every one of those pulls or the old false-positive "gun not firing" report comes straight back.
// HEAT_STALE_MS sits above that real window with margin, so a genuine lockout (or a player still trying it)
// is never cleared early, and only a reading old enough to be certainly abandoned counts as untrustworthy.
export const HEAT_STALE_MS = 25000;
// pl3 (2026-09-17): HEAT_STALE_MS above is for `no_fire` only. It must outlast a player who dry-fires a locked
// weapon for ~20 s. The HUD's OVERHEAT word must not: the lockout itself ends long before that. The reading that
// tips a weapon over the line arrives with the shot that caused it. The bench-measured lockout holds ~4.8 s,
// and at ~30/s of decay a reading near 106 falls back under the line in well under a second after that. So a
// lockout is over about 5 s after its last reading, and 6 s keeps the word up for the whole lockout with ~1 s of margin.
// pl4: the window runs from the last EVIDENCE of the lockout, not only the last reading: a reading at or past the
// line, or a trigger press that got no shot (the Energy Rifle locks for up to 23 s and sends no $ALCD while it
// does). A shot or a reading below the line ends it at once; OVERHEAT_CAP_MS bounds it.
export const OVERHEAT_SHOWN_MS = 6000;

export class Ammo {
  /** @param {any} host the engine's side (engine.js `ammoHost`) */
  constructor(host) {
    this.host = host;
    /** @type {any} per weapon slot, the node's OWN magazine account: {mag, fired, at, res, echoUntil, echoExpect, echoPending} */
    this.acct = {};
    /** @type {any} per weapon slot ($ALCD token 3): the last magazine seen */
    this.prevAmmo = {};
    /** @type {any} per weapon slot: the last reserve seen ($ALCD token 4); the stun restore needs the LIVE pair, not the frame's (F15/F87) */
    this.prevReserve = {};
    /** @type {any} per weapon slot: the biggest magazine shown this life, the ammo block's denominator when the bundle has none */
    this.magBySlot = {};
    // Bench 2026-09-17: $ALCD token 5 is weapon heat (protocol.py `parse_alcd`), non-zero only on an
    // overheat weapon (§7j). Read straight off the wire, per slot -- no synthetic decay or reload-clear
    // here, because the gun's own next $ALCD already reports the true post-reload/post-cooldown value.
    // OVERHEATING is heat >= HEAT_LOCKOUT (pl4: 99; the charge rifle read 106 mid-lockout, 0 cool;
    // mcp/brx_mcp/protocol.py's own `overheating: bool(heat)` is untested between 1-99 and would light
    // up on the very first rising frame of ordinary fire, which is not what "OVERHEAT" means on the bench).
    this.heatBySlot = {};
    this.heatLock = null;   // pl4: {slot, at, lastAt} from the first reading at or past HEAT_LOCKOUT; see `overheatOnHud`
    // Per slot, the `now()` of the last heat token recorded -- lets `heatBlocksFire()` treat a reading as
    // stale once nothing has refreshed it for HEAT_STALE_MS (review 2026-09-17: see the constant's comment).
    this.heatAt = {};
    // Per slot, true once that slot has reported heat > 0 this life -- the HUD's heat bar exists only for a
    // weapon that actually heats (a bullet weapon's $ALCD always carries heat 0, which is a real "no heat",
    // not "unknown"; reading `heatBySlot[slot] != null` alone would show the bar on every weapon after its
    // first shot).
    this.everHeated = {};
  }

  // ---- state resets ----
  /** A new life or a new head: no slot has reported yet. */
  forgetCounts() { this.prevAmmo = {}; this.prevReserve = {}; this.acct = {}; }
  /** A new match: config echoes carry `$WEAP` clip caps, not spawn mags, so no old denominator survives. */
  forgetShown() { this.magBySlot = {}; }
  /** What a slot holds now, after a write the node made (the reconcile re-arm, a powerup equip, a self-hit revive). A
   *  `res` left undefined keeps the slot's last reserve. */
  setPrev(slot, mag, res) { this.prevAmmo[slot] = mag; if (res !== undefined) this.prevReserve[slot] = res; }
  /** F416 round 2: the rounds the trigger has asked for on `slot` that may still come back (0 once the press expires). */
  pressedRounds(slot) { const a = this.acct[slot]; return this.acctOutstanding(slot) && a ? a.fired : 0; }
  /** A new life: no slot has a heat reading or a lockout. */
  forgetHeat() { this.heatBySlot = {}; this.heatAt = {}; this.everHeated = {}; this.heatLock = null; }

  /** {slot: [mag, reserve]} the gun holds NOW: the node's magazine account per slot (F259 -- never the last
   *  `$ALCD`, which can be a round behind), else the frame's spawn values (F87: never a refill).
   *  The stun snapshot and the operator RESYNC GUN both restore from this, and neither consults the
   *  `shotInFlight` guard, so the VALUE has to be right on its own. */
  liveAmmo() {
    const spawn = this.spawnAmmo(), live = {};
    for (const slot of Object.keys(spawn)) {
      const mag = this.acctLive(+slot), res = this.prevReserve[slot];
      live[slot] = [mag != null ? mag : spawn[slot][0], res != null ? res : spawn[slot][1]];
    }
    return live;
  }
  /** {slot: [mag, reserve]} straight from the bundle's spawn $AMMO frames -- the counts a slot that has never fired holds. */
  spawnAmmo() {
    const out = {};
    for (const f of (this.host.frames && this.host.frames.spawn) || []) {
      if (f.startsWith('$AMMO,')) { const t = f.split(','); out[+t[1]] = [+t[2] || 0, +t[3] || 0]; }
    }
    return out;
  }

  /** True per-slot mags from the bundle's spawn $AMMO frames — the display/warn denominator. */
  ammoBySlot() {
    const out = {};
    for (const f of (this.host.frames && this.host.frames.spawn) || []) {
      if (f.startsWith('$AMMO,')) { const t = f.split(','); out[+t[1]] = +t[2] || null; }
    }
    return out;
  }

  // ---------- heat: $ALCD token 5 (bench 2026-09-17, pl4) ----------
  /** Record one `$ALCD` heat token for `slot` (null when the frame carries none: `$LCD`'s ammo echo leaves the last
   *  reading alone). Recorded before any guard that drops the frame, so a stun cannot leave a stale lockout. */
  noteHeat(slot, heat) { if (heat != null && !Number.isNaN(heat)) { this.heatBySlot[slot] = heat; this.heatAt[slot] = this.host.now(); if (heat > 0) this.everHeated[slot] = true; } }
  /** The slot's last heat reading, or null before one this life. PURE. */
  heatOf(slot) { return this.heatBySlot[slot] != null ? this.heatBySlot[slot] : null; }
  /** Has the slot reported heat above 0 this life? The HUD's heat bar exists only for a weapon that heats. PURE. */
  heatedEver(slot) { return !!this.everHeated[slot]; }
  /** THE MECHANIC. Bench 2026-09-17 (match 592e444eff): a charge rifle in OVERHEAT lockout will not fire no
   *  matter how many times the trigger is pulled -- that is the mechanic working, not a stale pool. True once
   *  the active slot's last-reported heat ($ALCD token 5) has passed HEAT_LOCKOUT -- UNLESS that reading is
   *  itself stale (review 2026-09-17): the gun sends no $ALCD while locked out or cooling, so a reading
   *  taken while OVERHEAT would otherwise sit above the line forever. Past HEAT_STALE_MS with nothing new
   *  for this slot, treat it as no longer trustworthy and let `poolStale`'s 'no_fire'/'silent' path take over.
   *
   *  ⚠ Named apart from `overheatOnHud` by the 2026-09-17 maint review, which found the two used as if they
   *  were one truth. THIS one decides whether the gun can shoot: it gates the accuracy writer and exempts a
   *  dry pull from `no_fire`, on the 25 s HEAT_STALE_MS trust window. It is NOT what the HUD draws. */
  heatBlocksFire(now = this.host.now()) {
    const slot = this.host.activeSlot;
    if ((this.heatBySlot[slot] || 0) < HEAT_LOCKOUT) return false;
    const at = this.heatAt[slot];
    return at == null || (now - at) < HEAT_STALE_MS;
  }
  /** pl4: one `$ALCD` for `slot`. A reading at or past the line starts or refreshes the lockout; a reading below
   *  it, or a round leaving the slot without such a reading, ends it. `prev` is the slot's last mag (null = none). */
  heatLockFrame(slot, heat, prev, mag) {
    const now = this.host.now(), hot = heat != null && !Number.isNaN(heat) && heat >= HEAT_LOCKOUT, L = this.heatLock;
    if (hot) { if (L && L.slot === slot) L.lastAt = now; else this.heatLock = { slot, at: now, lastAt: now }; return; }
    if (!L || L.slot !== slot) return;
    if ((heat != null && !Number.isNaN(heat)) || (prev != null && mag < prev)) this.heatLock = null;   // cooled, or it fired
  }
  /** pl4: a trigger press on the locked slot. A press the gun can answer gets its `$ALCD` inside ~5 ms and ends the
   *  lockout there, so until then the press is evidence the lockout is still on. */
  heatLockPress() {
    const L = this.heatLock;
    if (L && L.slot === this.host.activeSlot && this.host.phase === 'live' && this.host.alive) L.lastAt = this.host.now();
  }
  /** THE DISPLAY. pl4: the HUD's OVERHEAT word, overlay and hot heat bar -- all three read this one field, so
   *  they cannot disagree (maint review 2026-09-17: the bar read the mechanic and could stay hot for up to 19 s
   *  after the word cleared). True while the active slot's lockout has evidence inside OVERHEAT_SHOWN_MS and
   *  began less than OVERHEAT_CAP_MS ago. Display only: no game rule reads it. PURE. */
  overheatOnHud(now = this.host.now()) {
    const L = this.heatLock;
    return !!(L && L.slot === this.host.activeSlot && now - L.lastAt < OVERHEAT_SHOWN_MS && now - L.at < OVERHEAT_CAP_MS);
  }

  // ---------- F259: the node's own magazine account ----------
  // The gun's `$ALCD` is the truth about the magazine, but it is always a little late: the round has
  // already left by the time the frame lands. Every `$AMMO` the node writes carries a count, so a write
  // that uses the last `$ALCD` verbatim hands the gun back a round the player has already spent. That is
  // what F259 measured on the bench: the accuracy writer fired every 250-500 ms during a fight, each write
  // restored a stale count, and the magazine NEVER emptied.
  //
  // So the node keeps its own account per weapon slot: `{mag, fired, at}`. `mag` is the magazine the node
  // accepts as true, `fired` is the rounds the trigger has asked for that no `$ALCD` has confirmed yet, and
  // the number any restore should carry is `mag - fired` (`acctLive`). The trigger press is the EARLIEST
  // evidence a round is leaving -- the node sees `$BUT,0,1` before the gun fires -- and engine.js `_awaitShot` already
  // models which presses produce no round (empty, overheat, swapping, reloading, stunned, unspawned).
  //
  // ⚠ The gun always wins. Outside the ECHO WINDOW below, every `$ALCD` re-seats `mag` on the gun's own
  // number, so a drifting account is corrected within one frame instead of fighting the hardware.
  //
  // ⚠⚠ THE ECHO WINDOW (bench 2026-09-18, the oscillation this account nearly caused). When the node writes
  // `$WEAP` + `$AMMO`, the gun answers with TWO frames: `$ALCD <clip>` (the `$WEAP` reset) and then
  // `$ALCD <n>` (our own restore landing). The second is a DECREMENT of `clip - n` -- 26 rounds, on the gun
  // Tony was holding -- and anything reading the raw frame-to-frame delta books it as fire. That fed the
  // recoil burst counter, which crossed its threshold, which wrote again, which reset again: nine seconds of
  // flapping after the player had stopped shooting, and a magazine jumping 11 to 32 and back on the HUD.
  // So from the instant the node writes a magazine count until the gun confirms it (or ACC_ECHO_MS passes),
  // the NODE owns that slot's magazine and every `$ALCD` for it is bookkeeping, not evidence. It cannot be
  // narrower: the reset frame and the restore frame are both inside it, and judging them one at a time is
  // what went wrong. It closes on the gun reporting the number we wrote, so in practice it lasts one round
  // trip, not the full deadline.
  //
  // ⚠ The two signals are SEPARATE, and keeping them apart is the whole design:
  //   the RESTORE VALUE (`acctLive` = mag - fired) is press-aware, because a write must never hand back a
  //     round the trigger has already asked for;
  //   ROUNDS SPENT (`_acctSpent`) is the drop in the account's magazine across one `$ALCD`, and a press does
  //     NOT contribute. Stepping recoil off a press would put the write on the wire before the gun had
  //     fired, and its `$AMMO` would then take the round off a magazine the gun was about to decrement
  //     itself -- charging the player twice, which is the first bug's mirror image.
  // Because the account is what moves, the node's own writes are invisible to recoil BY CONSTRUCTION rather
  // than by a guard someone has to remember, and full-automatic fire -- one press, many rounds -- still
  // steps on every round.

  /** The magazine count a write should restore for `slot`, or null before the gun's first `$ALCD` of the
   *  life (nothing to account from -- `_recoilWrite` falls back to the frame's spawn counts).
   *  A press the gun never answered expires after TRIGGER_NO_FIRE_MS, the same window `_noFireTick` uses
   *  to call a pull unanswered, so a mis-modelled press cannot hold the account down for the whole life.
   *  PURE. */
  acctLive(slot, now = this.host.now()) {
    const a = this.acct[slot];
    if (!a) return null;
    const fired = a.at && now - a.at < TRIGGER_NO_FIRE_MS ? a.fired : 0;
    return Math.max(0, a.mag - fired);
  }
  /** Has the trigger asked for a round the gun has not reported yet? Bounded by the same TRIGGER_NO_FIRE_MS
   *  expiry `acctLive` uses, so a press the gun never answers cannot hold the writer down for a whole life.
   *  PURE. */
  acctOutstanding(slot, now = this.host.now()) {
    const a = this.acct[slot];
    return !!(a && a.fired > 0 && a.at && now - a.at < TRIGGER_NO_FIRE_MS);
  }
  /** Is the node still waiting for the gun to echo a magazine IT wrote for this slot? See the echo-window
   *  note above: while it is, the gun's `$ALCD` says only where the node's own write has got to. PURE. */
  acctEchoing(slot, now = this.host.now()) {
    const a = this.acct[slot];
    return !!(a && a.echoPending > 0 && now < a.echoUntil);
  }
  /** The node has just written `$AMMO,<slot>,<mag>` and knows exactly what the gun will hold. Take the
   *  account there directly and open the echo window, so neither a preceding `$WEAP` reset nor this restore
   *  can come back as fire. Accuracy no longer calls this; spawn/stun/resync and other ammo owners do. */
  acctWrote(slot, mag, res) {
    const a = this.acct[slot] || (this.acct[slot] = { mag, fired: 0, at: 0, res: null, echoUntil: 0, echoExpect: null, echoPending: 0 });
    const now = this.host.now();
    a.mag = mag; a.fired = 0; a.at = 0;
    if (res != null) a.res = res;   // the `$WEAP` resets the RESERVE too, so the screen needs the node's number for that as well
    // ⚠ Polish review 2026-09-18: writes are COUNTED, not just timed. The verify can retry while the first
    // write's frames are still in the air, and then there are two `$WEAP` resets coming back for one window.
    // Closing on the first restore left the second reset to land on the ordinary path as a magazine rise --
    // the same leak the window exists to stop. Each write adds one, each restore answers one.
    if (!(now < a.echoUntil)) a.echoPending = 0;   // the last window lapsed unanswered: do not carry its count
    a.echoPending++;
    a.echoUntil = now + ACC_ECHO_MS; a.echoExpect = mag;
  }
  /** A trigger press that must produce a round (`_awaitShot` has already cleared every reason it would not).
   *  Books it against the account NOW, so a write between this press and the gun's `$ALCD` restores the
   *  post-shot count. Capped at the account's own magazine: a spammed trigger cannot book more rounds than
   *  the gun holds. */
  acctPress() {
    const a = this.acct[this.host.activeSlot]; if (!a) return;
    const now = this.host.now();
    // ⚠ Polish review 2026-09-18, and the reason this is not just `a.fired++`. `a.fired` is given back by
    // ONE thing only -- a confirmed magazine drop in `acctAmmo` -- and `acctLive` merely IGNORED a press
    // past TRIGGER_NO_FIRE_MS rather than dropping it, so the next pull that got through added to a count
    // that was still there. Five shipping weapons carry a 2-round magazine, so two unanswered pulls took the
    // account to zero while the gun was loaded. That matters because `liveAmmo` restores `mag - fired`
    // straight to the gun on a stun or an operator RESYNC GUN, and neither consults `shotInFlight`: the
    // player got `$AMMO,<slot>,0` and a gun that could not fire until the next reload.
    if (a.at && now - a.at >= TRIGGER_NO_FIRE_MS) { a.fired = 0; a.at = 0; }
    // ...and a pull the gun is still cycling through fires nothing at all, so it must not spend a round.
    // `$WEAP` token 14 (`_fireIntervalMs`) is the weapon's own time between rounds, and it is the only
    // signal the node has for "this pull CAN be answered". A weapon whose frame declares no interval keeps
    // the old behaviour and books every press.
    const iv = this.host.fireIntervalMs(this.host.activeSlot);
    if (iv && a.at && now - a.at < iv) return;
    a.fired = Math.min(a.mag, a.fired + 1); a.at = now;
    // ⚠ Deliberately does NOT step recoil. A press books the round for the RESTORE, which must never hand
    // back a round that is already leaving; the burst counter is driven by the gun's own `$ALCD` instead
    // (`acctAmmo` -> `_acctSpent`). Stepping here would put the degrade write on the wire BEFORE the gun
    // had fired, so its `$AMMO` would take the round off a magazine the gun was about to decrement itself,
    // and the player would be charged twice. The shot beats the write in practice -- the gun answers a
    // press in a few ms, and the bench measured a write landing in 30-90 ms.
  }
  /** Every `$ALCD` that reached `_onAmmo` (so: not stunned) feeds the account FIRST, before anything else in
   *  that function books anything from the frame. Returns the magazine `_onAmmo` should measure this frame
   *  against, or NULL when the frame is the node's own write coming back and nothing may be booked from it.
   *
   *  Inside the echo window there are exactly two cases:
   *    above what we wrote   the `$WEAP` reset, on its way back up to the compiled clip. Not news: null.
   *    at or below it        our `$AMMO` has landed. Close the window and measure from the number WE wrote.
   *
   *  ⚠ A round that leaves INSIDE the window is not booked (the window is one round trip, so at most one).
   *  Making it exact needs the node to tell a real round from the reset while both read above the written
   *  count, and the only signal for that is the write's flight time, which the node does not have. See the
   *  slow-link note in FOLLOWUPS: at the measured 30-90 ms the window is narrower than the gap between
   *  rounds and this does not arise -- `state().ammo` and `shots` both come out exact in the tests. */
  acctAmmo(slot, mag, prev) {
    const a = this.acct[slot];
    if (!a) { this.acct[slot] = { mag, fired: 0, at: 0, res: null, echoUntil: 0, echoExpect: null, echoPending: 0 }; return prev; }   // the first frame of a life seeds it
    if (this.acctEchoing(slot)) {
      if (mag > a.echoExpect) return null;
      prev = a.mag;         // the restore has landed: measure from the number the node wrote, not from the reset
      a.echoPending--;      // ...and it answered one write. Another may still be in the air behind it.
    }
    if (!(a.echoPending > 0)) { a.echoPending = 0; a.echoUntil = 0; a.echoExpect = null; }
    const before = a.mag;   // the ACCOUNT's magazine, which the echo window keeps clear of the node's own writes
    const d = prev != null && mag < prev ? prev - mag : 0;
    if (d) { a.fired = Math.max(0, a.fired - d); if (!a.fired) a.at = 0; }   // the gun has answered that many presses
    a.mag = mag;                                                             // the gun wins, always
    a.res = null;                                                            // this frame IS the gun, so it owns the reserve again
    this._acctSpent(slot, before);
    return prev;
  }
  /** The magazine, denominator and reserve the HUD shows. Split out so the echo path can publish the
   *  ACCOUNT while the gun is briefly reporting the magazine the node's own `$WEAP` reset gave it --
   *  Tony, bench 2026-09-18: "it shoots up to 32 while shooting ... it syncs on trigger release". Every
   *  ammo-shaped thing on the screen reads these three: the gauge, the pip count, the `mag` text and the
   *  low-ammo warning, so a warning blinking off because the gun momentarily said "full" is the same bug. */
  publish(slot, mag, reserve) {
    if (mag == null) return;
    this.magBySlot[slot] = Math.max(this.magBySlot[slot] || 0, mag);
    this.host.setAmmo(mag, this.magBySlot[slot]);
    if (reserve != null && !Number.isNaN(reserve)) this.host.setReserve(reserve);
  }
  /** F394: put `slot`'s own counts in the ammo block when the node moves the trigger with no `$ALCD` to say so.
   *  The gun reports nothing on ALT, so before this an assumed swap kept the OLD slot's number until the next
   *  shot while the pips took the new slot's size, and a reload pull was judged against the wrong magazine
   *  (sitting B, 2026-09-25). The counts are `liveAmmo`'s: the account, else the spawn row. */
  showSlot(slot) {
    const l = this.liveAmmo()[slot];
    if (l) this.publish(slot, l[0], l[1]);
  }
  /** Rounds that LEFT the gun: the drop in the ACCOUNT's magazine across one `$ALCD`, and nothing else.
   *  The only thing that drives the recoil burst counter.
   *
   *  ⚠ Not the raw frame-to-frame delta (`prevAmmo`), which counts the node's own `$WEAP` reset and `$AMMO`
   *  restore as a 26-round burst and made the writer oscillate on hardware. The echo window keeps `a.mag`
   *  clear of both, so a write is invisible here BY CONSTRUCTION, not by a guard someone has to remember. */
  _acctSpent(slot, before) {
    const a = this.acct[slot], r = this.host.recoil;
    // ⚠ The model is armed for a SLOT, so that is what the round has to have come out of. This asked
    // `slot === activeSlot`, and `activeSlot` is whatever spoke LAST: melee is slot 4 and arrives on
    // its own `$ALCD` without the model re-arming, so after every swing the next real round out of the
    // primary was judged against the wrong slot and dropped from the burst (polish review 2026-09-18).
    if (!a || !r || before == null || slot !== r.slot || this.host.phase !== 'live') return;
    const n = before - a.mag;
    if (n > 0) this.host.recoilStep(n);
  }

  /** F164: {slot: [mag, reserve]} for each slot the gun has reported this life (mag from the account, so a round in
   *  flight is not handed back), or null when none has. A null half is a count not seen yet. PURE. */
  saved() {
    const out = {};
    for (const slot of new Set([...Object.keys(this.acct || {}), ...Object.keys(this.prevReserve || {})])) {
      const mag = this.acctLive(+slot), res = this.prevReserve[slot];
      if (mag != null || res != null) out[slot] = [mag != null ? mag : null, res != null ? res : null];
    }
    return Object.keys(out).length ? out : null;
  }
  /** F164: seed the account and the last-seen counts from `saved()`'s shape, so `liveAmmo()` reads them. */
  restore(saved) {
    for (const [slot, pair] of Object.entries(saved)) {
      if (!Array.isArray(pair)) continue;
      const mag = pair[0] != null && Number.isFinite(+pair[0]) ? +pair[0] : null, res = pair[1] != null && Number.isFinite(+pair[1]) ? +pair[1] : null;
      if (mag != null) { this.acct[slot] = { mag, fired: 0, at: 0, res: null, echoUntil: 0, echoExpect: null, echoPending: 0 }; this.prevAmmo[slot] = mag; }
      if (res != null) this.prevReserve[slot] = res;
    }
  }
}
