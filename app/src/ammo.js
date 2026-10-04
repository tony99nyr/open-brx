// ammo.js -- the gun's AMMUNITION as the node keeps it: the magazine account, the counts per weapon slot, the ammo
// block the HUD shows, the heat lockout, the reload takeover, the RELOAD nag and the ALT swap (F259, F164, F394, pl4,
// F123, F379).
//
// Why a module: the magazine had no single interface. The account (`_shotAcct`), the last counts per slot
// (`_prevAmmo`/`_prevReserve`), the echo window and the HUD's ammo block were engine fields, read raw by the spawn,
// the revive, the stun, the reconcile, the operator RESYNC GUN, the F416 spawn check and the powerup module. Now one
// class owns them; the engine holds one instance (`engine.am`), calls its entry points and asks it by name.
//
// PUBLIC SURFACE
//   TRIGGER_NO_FIRE_MS · ACC_ECHO_MS · OVERHEAT_CAP_MS · HEAT_STALE_MS · OVERHEAT_SHOWN_MS · ENERGY_REFILL_MAX_MS
//   Ammo(host)
//     account     acctLive(slot, now) · acctOutstanding(slot, now) · acctEchoing(slot, now) · pressedRounds(slot) ·
//                 acctWrote(slot, mag, res) · acctPress() · acctAmmo(slot, mag, prev)
//     counts      liveAmmo() · spawnAmmo() · ammoBySlot() · lastMag(slot) · setPrev(slot, mag, res) · saved() · restore(saved) ·
//                 forgetCounts()
//     the HUD     publish(slot, mag, reserve) · showSlot(slot) · forgetShown()
//     heat        noteHeat(slot, heat) · heatLockFrame(slot, heat, prev, mag) · heatLockPress() · heatBlocksFire(now) ·
//                 overheatOnHud(now) · heatOf(slot) · heatedEver(slot) · forgetHeat()
//     reload      reloadPulled() · reloadReleased(now) · reloadDeadline() · endReload(why) · reloadTick(now) ·
//                 reloadingMs() · reloadOpen · dropReload()
//     a report    onAmmo(mag, reserve, slot, heat) · dryPull() · endDrySpell()
//     ALT         altPressed() · switchTick(now) · switchingMs() · switchWindowMs() · altCycle() · nextAltSlot() ·
//                 swapOpen · altSwap() · swapFrom · swapTo · setSwitching(card) · cancelSwap() · equipped(slot, mag, res)
//     state       acct · prevAmmo · prevReserve · magBySlot · heatBySlot · heatAt · everHeated · heatLock · reloading ·
//                 reloadOutcome · switching · altPtr · altEvidencePending · lastSwitchMs · dryPulls · lastShot (read them;
//                 change them through the methods above)
//
// HOST INTERFACE (engine.js `ammoHost`; every member looks the engine up at call time)
//   services    now() · log(line, cls) · changed() · event(kind) · fireIntervalMs(slot) · recoilStep(n) · recoilArm(why) ·
//               reloadGlance()
//   lookups     weaponRow(id) · perkRow(id) · slotCount() · easyReload() · switchWindowMs() (the Engine's public
//               `switchWindowMs`, which asks this module back: the swap's own clock reads it there, so a test that
//               stubs the Engine's window is still honoured)
//   read-only   activeSlot · frames · phase · alive · tutorial · resync · stunned · player · ammo · mag · reserve ·
//               rc (the Reconcile instance: disarmed) · pu (the PlayerPowerups instance: onAltPressed · onAssumedSwap ·
//               onConfirmedSwap · isHeldSlot · repairUnpulled · lostEquip · onAmmo · repairLostEquip) ·
//               recoil (the engine's live accuracy model, or null)
//   writes      setAmmo(ammo, mag) · setReserve(reserve)   the ammo block's numbers (`engine.ammo`, `.mag`, `.reserve`)
//               setActiveSlot(slot)                       the trigger slot (`engine.activeSlot`)
//               setMoment(moment)                         the HUD moment (`engine.moment`)
//               clearPull()                               a phone equip retires the last trigger pull (`engine._pull`)
//   the engine's side of one report (`onAmmo`), each one engine method:
//               tryoutAmmo(slot, mag)                     F147: a try-out weapon write's confirming report
//               roundsLeft(slot, prev, mag)               F209 first shot, the pl4 act counter, the match and life `shots`
//               resyncAmmo(prev, mag)                     §3.10 resync evidence

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
// burst. The window now closes on the VALUE -- `acctAmmo` shuts it the moment the gun reports the number
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
const RELOAD_GRACE_MS = 600;     // a reload the gun never echoed still clears the takeover this long after reload_s
// F27 (HANDOFF): handle-pull -> mag-refill on HARDWARE runs consistently LONGER than the catalog
// `reload_ms` — AR 1701 vs 1400, burst 2160 vs 1700, charge 3220 vs 2500, i.e. ~1.22-1.29x. A flat
// 600 ms grace covers the first two and misses the charge rifle by 120 ms, which would end the takeover
// on the frame BEFORE the gun's own echo and book a real reload as failed. The ceiling is therefore
// proportional as well as flat, and `_reloadDeadline` takes the larger of the two.
const RELOAD_OVERRUN = 0.5;      // ...and half the nominal reload on top, which clears every measured overrun
/** pl4 (bench 2026-09-17, Energy Rifle): an energy weapon refills on a HOLD of the lever, the whole cell in one
 *  step, 3.5-3.9 s after the pull starts (catalogue 2400 ms: 2400 + max(600, 1200) = 3600 ms missed the slow
 *  end). An energy weapon's watchdog waits at least this long from the pull, plus RELOAD_GRACE_MS. */
export const ENERGY_REFILL_MAX_MS = 3900;
const isEnergyWeaponId = id => /energy|charge/i.test(String(id || ''));   // the same rule as hud.js `isEnergyWeapon`
const SWITCH_MAX_MS = 850;       // the stock $WEAP tok15 (bench 2026-09-04: 850 ms, linear, no floor) — a fallback; the bundle carries the real value in frames.swap_ms
// THE RELOAD NAG (Tony, bench 2026-09-18). The magazine is empty, the reserve is not, and the
// player keeps pulling the trigger: say RELOAD on the 5th pull of that dry spell and on every 3rd after it
// (5, 8, 11 …). Tony's numbers, verbatim, and they are a taste decision, not a measurement: the first four
// pulls are the player finding out, and one word per three pulls after that is a reminder rather than a
// scold. A reload resets the spell (`onAmmo`), so the count is never carried between magazines.
const RELOAD_NAG_FIRST = 5, RELOAD_NAG_EVERY = 3;

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
    // {at, ms, slot, from, cap, mag, lastGainAt} from the reload-handle pull ($BUT,2) until the gun's OWN
    // $ALCD says the mag came back (review 2026-09-03 #15; reconciled against real ammo for F123).
    this.reloading = null;
    this.reloadOutcome = null;     // F123: how the LAST takeover ended — {ok, filled, from, to, cap, gained, slot, ms, why, at}; null before the first reload of a life
    this.switching = null;          // {at, from} while an ALT weapon swap is in flight (field 2026-08-30)
    this.lastSwitchMs = null;       // measured duration of the last completed swap
    this.altPtr = 0;                  // the gun's BMAP position is separate from the trigger slot
    this.altEvidencePending = null;    // the ALT target awaiting gun evidence (0 is a real slot: test != null)
    this.dryPulls = 0;              // the RELOAD nag: trigger pulls into an empty magazine this dry spell (the RELOAD nag's counter)
    // Bench 2026-09-17: the last round that left a weapon slot, {slot, at, ms}, where `ms` is that slot's
    // `$WEAP` token 14 from the head (null when the head carries no full frame). Display only: the HUD cue.
    this.lastShot = null;
  }

  // ---- state resets ----
  /** A new life or a new head: no slot has reported yet, and the gun's ALT position is back on slot 0. */
  forgetCounts() { this.prevAmmo = {}; this.prevReserve = {}; this.acct = {}; this.altPtr = 0; this.altEvidencePending = null; }
  /** A new match: config echoes carry `$WEAP` clip caps, not spawn mags, so no old denominator survives, and no old
   *  shot-ready cue. */
  forgetShown() { this.magBySlot = {}; this.lastShot = null; }
  /** What a slot holds now, after a write the node made (the reconcile re-arm, a powerup equip, a self-hit revive). A
   *  `res` left undefined keeps the slot's last reserve. */
  setPrev(slot, mag, res) { this.prevAmmo[slot] = mag; if (res !== undefined) this.prevReserve[slot] = res; }
  /** The slot's last magazine seen, or null before one (F147: a try-out's baseline). PURE. */
  lastMag(slot) { return this.prevAmmo[slot] != null ? this.prevAmmo[slot] : null; }
  /** F416 round 2: the rounds the trigger has asked for on `slot` that may still come back (0 once the press expires). */
  pressedRounds(slot) { const a = this.acct[slot]; return this.acctOutstanding(slot) && a ? a.fired : 0; }
  /** A new life, a death or the match end: no takeover follows the player, and no verdict from the last one. */
  dropReload() { this.reloading = null; this.reloadOutcome = null; }
  /** A loaded pull, a new life: the RELOAD nag's dry spell is over. */
  endDrySpell() { this.dryPulls = 0; }
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

  // ---------- one ammo report ($ALCD, or the magazine on an $LCD) ----------
  /** $ALCD,<mag>,100,<slot>,<reserve>,<heat> — counts are per weapon SLOT; a weapon swap is never a shot.
   *  `heat` is null on a frame with no heat token ($LCD's ammo echo) -- leaves the slot's last-known heat alone. */
  onAmmo(mag, reserve, slot = 0, heat = null) {
    slot = Number.isFinite(slot) ? slot : 0;
    // Review 2026-09-17: heat is recorded BEFORE the stunned return below. A stun window can land while a
    // heat weapon is mid-cooldown, and skipping the token here (as the ammo/reserve fields correctly do)
    // would only add to how long a stale-but-locked reading can sit unrefreshed -- see HEAT_STALE_MS.
    this.noteHeat(slot, heat);
    this.heatLockFrame(slot, heat, this.host.stunned || this.host.rc.disarmed ? null : this.prevAmmo[slot], mag);   // F164: a disarm echo's drop is not "it fired", so it must not end a lockout
    // F15: a stunned gun cannot fire, so any $ALCD in the window is the gun echoing OUR `$AMMO,<slot>,0,0` (whether
    // it does is hardware-UNVERIFIED; this guard makes it safe either way). Counting it would book a magazine of
    // phantom shots, and recording it would make the restore re-send 0 -- a gun disarmed for the rest of the life.
    if (this.host.stunned) return;
    // F164 follow-up: the same guard for a reconcile. `rc.begin` disarms with `$AMMO,<slot>,0,0`, and the
    // gun's echo reads as a whole magazine leaving: it booked `shots`, the life's rounds, a shot cue and a recoil
    // burst. Nothing in the window is fire (the gun is disarmed), and `rc.end` re-arms from the counts it
    // snapshotted before the disarm, so the frame is dropped whole. `prevAmmo` and the account stay where they
    // were; the re-arm re-seats both.
    if (this.host.rc.disarmed) return;
    // F259 (bench 2026-09-18): the same shape as the stun guard above, and for the same reason. Inside the
    // ECHO WINDOW this frame is the gun reading back the node's OWN `$WEAP` reset -- it is not evidence of
    // anything. Not a shot (it booked 26 phantom rounds into engine.js `shots` per write), not a try-out
    // confirmation (the reset magazine IS the clip a try-out looks for), not a reload, not resync proof,
    // and not a magazine worth showing: Tony watched the HUD jump to 32 every time he fired. The node
    // already knows the count, because it wrote it -- so book NOTHING, leave `prevAmmo` where it was so
    // the next real frame measures from before the write, and put the ACCOUNT on the screen.
    // F394: the restore landing for a slot that is NOT on the trigger (a switch-back resend, a stun restore of the
    // other slot) is the gun reading back our own write, not the trigger moving. Measured before `acctAmmo` closes it.
    // A report on the slot ALT is switching TO is the player's confirming shot, never an echo (polish round 2).
    const offSlotEcho = slot !== this.host.activeSlot && !(this.switching && slot === this.switching.to)
      && this.acctEchoing(slot) && mag <= this.acct[slot].echoExpect;
    const expectedBefore = slot < 2 && this.host.pu.isHeldSlot(this.host.activeSlot)
      ? this.liveAmmo()[slot]?.[0] : null;   // a first $ALCD can still prove a shot against the spawn count
    let prev = this.acctAmmo(slot, mag, this.prevAmmo[slot]);
    if (prev === null) {
      const a = this.acct[slot];
      // F394: only the slot on the trigger owns the ammo block. A switch-back resend for slot 0 while the player
      // is on the secondary put the primary's number over the secondary's pips (sitting B, 2026-09-25).
      if (slot === this.host.activeSlot) this.publish(slot, this.acctLive(slot), a ? a.res : null);
      return;
    }
    if (offSlotEcho) {
      this.prevAmmo[slot] = mag;
      if (reserve != null && !Number.isNaN(reserve)) this.prevReserve[slot] = reserve;
      return;
    }
    if (this.host.pu.repairUnpulled(slot, mag, prev)) return;   // a stale pickup count is not a round
    this.host.tryoutAmmo(slot, mag);   // F147: a try-out weapon write's confirming report (engine.js `_tryoutAmmo`)
    // F209 (engine.js `_roundsLeft`): a round leaving slot 0 or 1 is the gun's own proof it can fire, so hit reception arms now.
    // F209/S7.1: a reconcile disarms with its own `$AMMO` write (`rc.begin`), and the gun's echo
    // of that looks exactly like "a round left the mag". The `if (this.host.rc.disarmed) return` near the top of this
    // function drops that echo before it gets here, so it cannot arm hit reception early; `rc.end`
    // re-arms explicitly once it is done.
    this.host.roundsLeft(slot, prev, mag);   // F209 first-shot arming, pl4 `_actSeq`, the match and life `shots`
    // Bench 2026-09-17: the shot-ready cue times from THIS frame, the gun's own report of the round, so the
    // cue can only be late, never early. Slots 0/1 and a held heavy's pickup slot (bench 2026-10-02: the Rockets never
    // shone); slot 4 is melee and has no gauge.
    if (prev != null && mag < prev && this.host.phase === 'live' && (slot === 0 || slot === 1 || this.host.pu.isHeldSlot(slot))) this.lastShot = { slot, at: this.host.now(), ms: this.host.fireIntervalMs(slot) };
    this.host.resyncAmmo(prev, mag);   // §3.10: a magazine move is resync evidence (engine.js `_resyncAmmo`)
    // F123: the takeover is reconciled against the REAL magazine, one $ALCD at a time. A rise feeds it
    // (and pushes the deadline out, which is what lets a shell-by-shell chain run to the end instead of
    // clearing on shell #1); reaching the spawn cap finishes it; a round leaving the mag ends it, because
    // the player has started shooting again. It is no longer cleared by "the mag went up" alone.
    if (this.reloading && prev != null && slot === this.reloading.slot) {
      if (mag > prev) {
        this.reloading.mag = mag; this.reloading.lastGainAt = this.host.now();
        if (this.reloading.cap != null && mag >= this.reloading.cap) this.endReload('filled');
      } else if (mag < prev) {
        // Book the outcome from the PRE-SHOT magazine. Overwriting `r.mag` with the post-shot count first
        // made a shotgun chain that loaded two shells and then fired read as `gained:0, ok:false` — the exact
        // false verdict F123 exists to prevent. The shot is not part of what the reload achieved.
        this.endReload('fired');
      }
    }
    // the RELOAD nag: the magazine came back, so the dry spell is over and the RELOAD nag counts from one again. Keyed on
    // the gun's own rising count rather than on `endReload`, because that is what "the player reloaded" means
    // on the wire -- a shell-by-shell shotgun chain, a swap onto a loaded slot and a spawn refill all land here.
    if (prev != null && mag > prev) this.dryPulls = 0;
    // A loadout shot without ALT or SELECT proves that a recent phone equip did not put the held weapon on the trigger.
    // A read-back with no count drop could be an old echo, so only a shot warrants another equip.
    const lostPuEquip = this.host.pu.lostEquip(slot, mag, prev, expectedBefore, this.altEvidencePending);
    const puBack = this.host.pu.onAmmo(slot, mag, prev);   // A56: the held item's magazine; empty ends the item and switches back
    if (this.switching && !this.switching.pu && slot !== this.switching.from && (slot < 2 || this.host.pu.isHeldSlot(slot))) {
      // slot 4 is MELEE and arrives on its own $ALCD — it is not the weapon swap we were waiting for.
      // NB this interval is ALT-press -> next SHOT, so it includes the player's reaction time. It is a
      // lower bound on "the swap had finished by", NOT a measurement of the swap itself (FOLLOWUPS F4).
      this.lastSwitchMs = this.host.now() - this.switching.at;
      this.host.log(`slot ${this.switching.from}->${slot} confirmed ${this.lastSwitchMs}ms after ALT (incl. reaction)`, 'li');
      this.switching = null;
      this.host.setMoment({ kind: 'switched', at: this.host.now(), data: { slot } });   // the HUD flips SWITCHING → ACTIVE
      // ⚠ The slot moves BEFORE the re-arm (polish review 2026-09-18). `_recoilArm` reads `this.host.activeSlot`
      // for both the weapon it looks up (`_activeWeaponId`) and the slot it records, and the assignment used
      // to sit below this block -- so a confirmed swap armed the OLD weapon's profile and filed it under the
      // OLD slot, which is the opposite of what the line below says it does. The assignment after the block
      // is now a no-op on this path and still does the work on every other.
      this.host.setActiveSlot(slot);
      this.host.pu.onConfirmedSwap(slot);   // A56 r2 M2: ALT took the trigger off the heavy, as the assumed-swap path says; r3: it supersedes a pending switch-back
      this.host.recoilArm('swap (confirmed)');   // S42: the new slot's weapon gets its own profile, at its ceiling
    }
    this.prevAmmo[slot] = mag;
    if (slot < 2 && this.altEvidencePending != null && ((prev != null && mag < prev) || slot === this.altEvidencePending)) {
      this.altPtr = slot; this.altEvidencePending = null;
    }
    if (slot < 2 && slot !== this.host.activeSlot && this.host.activeSlot < 2 && !this.switching && this.altEvidencePending == null) this.altPtr = slot;   // ALT r4: a swap the node missed; the pointer follows the gun
    if (puBack != null) {   // A56: the heavy ran dry; keep its empty count until the delayed switch-back
      if (reserve != null && !Number.isNaN(reserve)) this.prevReserve[slot] = reserve;
      this.publish(puBack, this.prevAmmo[puBack], this.prevReserve[puBack]);
      return;
    }
    // KNOWN BUG (bug 3): the trigger follows whichever slot spoke last, with no button pressed. The gun's `$ALCD` echo of
    // the node's own spawn or re-arm `$AMMO` rows therefore moves it too (slot 1 after the spawn's two rows), and a later
    // `$LCD` books its magazine and reserve on this slot (engine.js `feedFrame`, the same KNOWN BUG note). Pinned as it is
    // by the golden trace `ammo-spawn-echo-slot`; the fix belongs here.
    this.host.setActiveSlot(slot);
    // S42/F259: recoil is stepped by `_acctSpent`, off the ACCOUNT above, never off this raw decrement.
    // The node's own `$WEAP` reset and `$AMMO` restore arrive here as a 26-round drop that no player fired
    // (bench 2026-09-18), and reading the frame delta booked it as a burst -- see the echo-window note.
    if (reserve != null && !Number.isNaN(reserve)) this.prevReserve[slot] = reserve;
    this.publish(slot, mag, reserve);
    this.host.pu.repairLostEquip(lostPuEquip, slot, mag);   // F436: the equip re-sent, while the same item is held
    // heat itself is recorded at the top of this function, before the stunned return.
  }
  /** THE RELOAD NAG (Tony, bench 2026-09-18). Reached from `_awaitShot` ONLY, one line below its stand-down table, so every other
   *  reason a pull produced no round -- overheat, a swap, a reload already running, a stun, being down, not
   *  live, the link gone -- has already returned and the empty magazine is the only thing left that can have
   *  stopped it. That is the whole point of hanging it here rather than counting `$BUT` edges: a nag on an
   *  overheated gun would name the wrong fix.
   *
   *  A dry reserve stays SILENT. "Reload" said to a player with nothing to reload to is a lie, and they can
   *  hear the difference the moment they try. The reserve is the slot's OWN last `$ALCD` figure and nothing
   *  else: an unknown reserve counts as no reserve, the same way ammo.js `reloadPulled` refuses a reload it cannot
   *  prove is possible.
   *
   *  ⚠ It used to fall back to `this.reserve`, the last figure reported on ANY slot, which the doc comment
   *  described and then contradicted (polish review 2026-09-18). Melee is the live case: it is slot 4, it
   *  arrives on its own `$ALCD`, and `onAmmo` makes whatever spoke last the active slot -- so after a swing
   *  every pull was nagged to RELOAD against the primary's reserve. */
  dryPull() {
    const slot = this.host.activeSlot;
    const reserve = this.prevReserve[slot];
    if (!(reserve > 0)) return;
    this.dryPulls = (this.dryPulls || 0) + 1;
    if (this.dryPulls < RELOAD_NAG_FIRST || (this.dryPulls - RELOAD_NAG_FIRST) % RELOAD_NAG_EVERY !== 0) return;
    this.host.log(`dry pull ${this.dryPulls} on an empty magazine with ${reserve} in reserve: RELOAD`, 'li');
    this.host.event('reload_nag');
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

  // ---------- the reload takeover (F123) ----------
  /** Is a reload takeover open (whatever the deadline says)? The engine's stand-down table and the HUD lanes ask. */
  get reloadOpen() { return !!this.reloading; }
  /** The reload lever came up. OBSERVATIONAL only: a magazine weapon's handle is let go at once and the reload still
   *  completes about 1.4 s later, so a release never ends a takeover. */
  reloadReleased(now) { if (this.reloading) this.reloading.releasedAt = now; }
  /** Reload handle pulled: the gun refuses fire for the weapon's reload time (catalog reload_s; 1.5 s when unknown). */
  reloadPulled() {
    if (this.host.phase !== 'live' || !this.host.alive || this.host.tutorial || this.host.resync || this.host.rc.disarmed) return;   // resync/reconcile: the gun is disarmed and unverified, no takeover
    // A20/F15: a STUNNED gun is disarmed ($AMMO,<slot>,0,0) and `onAmmo` drops every $ALCD for the whole
    // window, so a takeover started here could never be reconciled: it would run to its deadline and book
    // `ok:false` on a reload the player never asked the gun for. Refuse the pull instead.
    if (this.host.stunned) { this.host.log('reload pull ignored — the gun is stunned', 'li'); return; }
    const cap = this.ammoBySlot()[this.host.activeSlot] ?? this.host.mag;                 // the spawn $AMMO cap, not the biggest count seen so far
    if (cap && this.host.ammo >= cap && (this.host.reserve || 0) > 0) return;             // nothing to reload — the gun ignores the pull
    if (!(this.host.reserve > 0)) return;                                           // dry reserve: no reload happens (whatever is in the mag)
    const ws = this.host.player && this.host.player.loadout && this.host.player.loadout.weapons; const w = ws && (ws[this.host.activeSlot] || ws[0]);
    const row = w && this.host.weaponRow(w.weapon_id); let secs = row && row.reload_s != null ? +row.reload_s : 1.5;
    // The perk's reload multiplier is applied to the gun's $WEAP reload token by MC (compile.py apply_perks), so the
    // takeover must shrink with it too — quick_hands halves the reload (Tony, 2026-09-04).
    const pk = this.host.player && this.host.player.loadout && this.host.player.loadout.perk ? this.host.perkRow(this.host.player.loadout.perk) : null;
    const rm = pk && pk.effects && pk.effects.reload_mult ? +pk.effects.reload_mult : 1;
    if (rm > 0 && rm !== 1 && this.host.activeSlot === 0) secs *= rm;   // compile applies reload_mult to slot 0 only (slot 1 gets swap_mods)
    const now = this.host.now();
    // `from`/`cap`/`mag` are what make this a RECONCILIATION and not an animation: `ms` is only the
    // nominal length, and the takeover ends on what the gun's own $ALCD says the magazine did.
    this.reloading = { at: now, ms: Math.max(300, Math.round(secs * 1000)), slot: this.host.activeSlot,
                       from: this.host.ammo, cap: cap || null, mag: this.host.ammo, lastGainAt: now, releasedAt: null,
                       energy: !!(w && isEnergyWeaponId(w.weapon_id)) };
    this.reloadOutcome = null;
    this.host.reloadGlance();   // A16 §3.1: reload gets a glance at the current readout
    this.host.changed();
  }
  /** When a running takeover gives up waiting for the gun.
   *
   *  F123: `reloadingMs()` used to be a PURE TIMER, so a reload that never happened animated exactly like
   *  one that did — the 2026-09-11 field report ("the hud animates reloading, but the gun doesnt actually
   *  reload") is that timer. The deadline is now measured from the last time the MAGAZINE MOVED, not from
   *  the pull, which covers both real behaviours in one rule:
   *    · a magazine weapon gains its rounds in one $ALCD, late (F27) — the flat+proportional ceiling covers it;
   *    · a shell-by-shell chain (the shotgun: 6 × ~420 ms) feeds one round at a time, and each shell pushes
   *      the deadline out again, so the bar runs for as long as the gun is really loading and no longer.
   *  No per-weapon "is this a chain reload" flag is needed on the phone for this: the gun tells us. */
  reloadDeadline() {
    const r = this.reloading; if (!r) return 0;
    const d = Math.max(r.at, r.lastGainAt || 0) + r.ms + Math.max(RELOAD_GRACE_MS, Math.round(r.ms * RELOAD_OVERRUN));
    return r.energy ? Math.max(d, r.at + ENERGY_REFILL_MAX_MS + RELOAD_GRACE_MS) : d;   // pl4: a held recharge lands late
  }
  /** Book the end of a takeover and record WHAT THE GUN DID, so a failed reload can never read as a success.
   *  `why`: 'filled' (mag reached the spawn cap) · 'fired' (a round left the mag, the reload is over) ·
   *  'swapped' (an ALT swap took the weapon away) · 'timeout' (the gun stopped feeding) · 'dropped' (link lost). */
  endReload(why) {
    const r = this.reloading; if (!r) return;
    this.reloading = null;
    const gained = Math.max(0, (r.mag ?? r.from) - r.from);
    this.reloadOutcome = { ok: gained > 0, filled: r.cap != null ? r.mag >= r.cap : gained > 0,
                            from: r.from, to: r.mag, cap: r.cap, gained, slot: r.slot,
                            ms: this.host.now() - r.at, why, at: this.host.now() };
    // A shot mid-reload is the PLAYER cancelling it, not the gun failing to feed — 'reload did NOT take'
    // read as a defect in the log of every chain weapon anybody fires out of (review 2026-09-12).
    if (why === 'fired' && !this.reloadOutcome.filled) this.host.log(`reload cancelled by a shot: ${r.mag} of ${r.cap ?? r.mag} loaded`, 'li');
    else if (!gained) this.host.log(`reload did NOT take (${why}) — mag still ${r.mag}`, 'le');
    else if (!this.reloadOutcome.filled) this.host.log(`reload partial: ${r.from} → ${r.mag} of ${r.cap} (${why})`, 'li');
    this.host.changed();
  }
  /** tick(): end a takeover the gun has stopped feeding. The decision lives HERE, not in `reloadingMs()`,
   *  which stays pure — but both read the same deadline, so a render between ticks can never disagree. */
  reloadTick(now) {
    if (this.reloading && now > this.reloadDeadline()) this.endReload('timeout');
  }
  /** Milliseconds into the current reload, or null when none is running (PURE, read by state()). */
  reloadingMs() {
    if (!this.reloading) return null;
    const now = this.host.now();
    return now > this.reloadDeadline() ? null : now - this.reloading.at;
  }

  // ---------- the ALT swap (field 2026-08-30, ALT r4, F379, F394, F400) ----------
  /** The ALT swap in flight, or null: a pickup's switch card (`pu`) is not one (F416 round 2's motion check). PURE. */
  altSwap() { return this.switching && !this.switching.pu ? this.switching : null; }
  /** The HUD's SWITCHING from and to: the open swap's own, else the next slot in the ALT cycle; null with no swap. PURE. */
  get swapFrom() { return this.switching ? this.switching.from : null; }
  get swapTo() { return this.switching ? (this.switching.to != null ? this.switching.to : this.nextAltSlot()) : null; }
  /** Is an ALT swap (or a pickup's switch card) open, whatever its window says? The stand-down table asks. */
  get swapOpen() { return !!this.switching; }
  /** F400: a pickup's switch card is this same `switching`, opened by the powerup module. */
  setSwitching(card) { this.switching = card; }
  /** A death, a revive or a lost link: no swap indicator outlives the life or the link. */
  cancelSwap() { this.switching = null; }
  /** A phone equip put `slot` on the trigger (powerup-player.js): it ends a reload, closes a swap, moves the trigger
   *  and shows the new counts before the gun's first `$ALCD`. A pull before it cannot prove the new count was spent,
   *  and a later loadout round is no ALT evidence (F379 r2): a phone equip moves the trigger, not ALT. */
  equipped(slot, mag, res) {
    if (this.reloading) this.endReload('swapped');
    this.switching = null; this.host.setActiveSlot(slot); this.host.clearPull();
    this.altEvidencePending = null;
    this.publish(slot, mag, res);
  }
  /** ALT pressed: a weapon swap has begun. Shooting is disabled until the gun finishes it. */
  altPressed() {
    if (this.host.phase !== 'live' || !this.host.alive || this.host.tutorial) return;
    // A20/F15, the same reason ammo.js `reloadPulled` refuses: a STUNNED gun is disarmed ($AMMO,<slot>,0,0) and
    // `onAmmo` drops every $ALCD for the whole window, so a SWITCHING takeover opened here has nothing
    // that can confirm it — it runs to `switchWindowMs()` and then books an ASSUMED swap, leaving
    // `activeSlot` on a weapon the player is not holding for the rest of the life (review 2026-09-12).
    if (this.host.stunned) { this.host.log('ALT ignored — the gun is stunned', 'li'); return; }
    if (this.host.slotCount() < 2) {
      // Bench 2026-09-17 (match 592e444eff): with an empty slot 1, compile.py maps ALT to fn 98 (inert)
      // UNLESS the player is running easy_reload, which keeps ALT -> fn 97 (RELOAD) on purpose
      // (loadout.md §2 `alt_reload`). Calling `reloadPulled()` for anyone else opened a RELOADING
      // takeover the gun could never complete, since no $ALCD ever answers a no-op button.
      // S50 (merge 2026-09-18): Easy Reload left the perk slot for `loadout.overrides`, where the rest of
      // the per-player accessibility block lives. `compile.py` reads `overrides.easy_reload` and keeps
      // ALT on fn 97 for that player, so the node must ask the same question: reading the retired perk
      // slot left the feature dead on the phone for anyone whose host switched it on. The old perk row
      // is still honoured for a bundle compiled before the move.
      if (this.host.easyReload()) this.reloadPulled();
      return;
    }
    // Bench 2026-10-02 (captured wire, USP-S): the gun IGNORES ALT while a reload runs. The lever at mag 8, ALT 1.16 s
    // later, then `$ALCD,12,100,1,88` on slot 1: the reload took and the trigger never moved. Opening an assumed swap
    // here booked "reload did NOT take (swapped)" and a swap to slot 0 that never happened, so the press is only noted.
    // ALT r4: only while the gun is really reloading (inside reload_s, no gain yet). In the takeover's stale tail the gun
    // takes ALT, so ignoring it left `_altPtr` behind the gun; there the press is a swap and ends the takeover.
    const r = this.reloading;
    if (r && this.host.now() < r.at + r.ms && !(r.lastGainAt > r.at)) { this.host.log(`ALT ignored by the gun mid-reload (slot ${this.host.activeSlot})`, 'li'); return; }
    if (r) this.endReload('swapped');
    this.host.pu.onAltPressed();
    const from = this.altPtr, to = this.nextAltSlot();
    this.altPtr = to;
    this.altEvidencePending = to;
    this.switching = { at: this.host.now(), from, to };
    this.host.changed();
  }

  /** The ALT cycle as the gun runs it right now (for an ASSUMED swap and the HUD's SWITCHING target). A heavy is never in
   *  it: the phone puts the heavy on the trigger with its `$WEAP` and never rewrites ALT (Tony, 2026-09-24). */
  altCycle() { return this.host.slotCount() >= 2 ? [0, 1] : [0]; }
  nextAltSlot() { const c = this.altCycle(), i = c.indexOf(this.altPtr); return i < 0 ? c[0] : c[(i + 1) % c.length]; }
  /** How long the ALT indicator has been up, or null once it has expired.
   *  PURE — it is read from state() on every render and must never mutate engine state. */
  switchingMs() {
    if (!this.switching) return null;
    const ms = this.host.now() - this.switching.at;
    return ms > this.host.switchWindowMs() ? null : ms;
  }
  /** The swap window: MC's `frames.swap_ms` (the tok15 the gun was actually given, perks applied — bench 2026-09-04);
   *  an older MC without it falls back to the stock 850 scaled by an equipped `switch_mult` perk. */
  switchWindowMs() {
    if (this.host.frames && Number(this.host.frames.swap_ms) > 0) return Number(this.host.frames.swap_ms);
    const pk = this.host.player && this.host.player.loadout && this.host.player.loadout.perk ? this.host.perkRow(this.host.player.loadout.perk) : null;
    const sm = pk && pk.effects && pk.effects.switch_mult ? +pk.effects.switch_mult : 1;
    return Math.round(SWITCH_MAX_MS * (sm > 0 ? sm : 1));
  }
  /** tick(): an ALT swap the gun never confirmed with a shot. Past the assumed window the swap is TAKEN as done (the real
   *  duration has never been timed -- FOLLOWUPS F4; the next `$ALCD` corrects the trigger slot if the gun disagrees). */
  switchTick(now) {
    if (this.switching && now - this.switching.at > this.host.switchWindowMs()) {
      const to = this.switching.to != null ? this.switching.to : this.nextAltSlot();
      const pu = !!this.switching.pu; this.switching = null;
      if (!pu) this.host.setActiveSlot(to);   // F400 r2: the powerup equip already moved a pickup card's trigger; a shot since may have moved it again
      if (!pu) this.altPtr = to;   // F400 r1: a pickup card is a phone equip, which moves the trigger and never the gun's ALT pointer
      if (!pu) this.host.pu.onAssumedSwap(to);   // A56: ALT took the trigger off the heavy (the heavy keeps its charges)
      if (!pu) this.host.recoilArm('swap (assumed)');   // S42: the new slot's weapon gets its own profile (the powerup equip already armed a pickup card's)
      if (!pu) this.showSlot(to);   // F394: the gun sends no `$ALCD` on ALT, so the new slot's counts come from the node
      // `pu` rides along so the HUD can tell a pickup's ACTIVE bubble from ALT's own (docs/spec/powerups.md
      // "The switch card"): a pickup switch is never "assumed" the way an unconfirmed ALT swap is -- it is
      // display-only for `onAmmo`'s confirm-by-shot code (powerup-player.js `_switchCard`), so it always closes here, on its
      // own timer, with the equip already a settled fact.
      this.host.setMoment({ kind: 'switched', at: now, data: { slot: to, assumed: true, pu } });
      this.host.log(pu ? `pickup switch card to slot ${to} closed after ${this.host.switchWindowMs()}ms` : `swap to slot ${to} assumed after ${this.host.switchWindowMs()}ms (no shot yet)`, 'li');
    }
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
   *  that function books anything from the frame. Returns the magazine `onAmmo` should measure this frame
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
