// reconcile.js -- the relink RECONCILE (spec/node.md §3.10, S7.1): what the phone does when the gun relinks, or a frozen
// app resumes, in a LIVE match. The gun keeps its config and pools across a BLE drop, so the node does not guess: it holds
// the gun disarmed for RECONCILE_MS, reads it, and re-arms it with the live counts. Inside that window the node INFERS
// nothing and ACTS on nothing of its own; it still READS (F264).
//
// Why a module: the window was one engine field, `reconciling`, read raw at about 35 sites, and each site asked its own
// question of it. Its begin, its end and the F416 spawn-check hold lived in engine.js too. Now one class owns the window
// and every rule that reads it; the engine holds one instance (`engine.rc`), calls its entry points and asks it by
// name. Nothing outside this file reads or writes a `_` field of it.
//
// PUBLIC SURFACE
//   RECONCILE_MS                        how long the window holds the gun disarmed
//   Reconcile(host)
//     lifecycle   begin() · end() · tick(now) · clear()
//     F416        holdSpawnCheck(c, askAfterMs)
//     questions   active · ownsRearm · infersNothing · disarmed · outOfBand
//     state       window (rw: {since, ammo} or null; the setter is the seam tests use to stage a window)
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
//   services    now() · log(line, cls) · changed() · write(frames, why) · delay(ms, fn) · askGun(why)
//   read-only   alive · hp · phase · ended · config · frames · triggerPending · pu (the PlayerPowerups instance:
//               disarmRows · reconcileRearm · isHeldSlot · reequipInRearm · afterRearm)
//   lookups     liveAmmo() · protectsSpawn() · respawnProfile()
//   writes      clearResync() · stunRestore(why) · acctWrote(slot, mag, res) · setPrev(slot, mag, res) ·
//               holdAccuracyWrites(why) · recoilArm(why) · armRepair(why) · setTriggerPending(p) · spawnAsk(c)
//   Each write is one named door into the engine: `armRepair` is the F11 repair arm (the live hit table, then protection
//   off), `stunRestore` ends a stun with no write of its own, `spawnAsk` is the F416 check's next ask.

/** Rejoin: hold the gun disarmed this long while we reconcile state (anti-cheat: a restart is slow and gains nothing;
 *  a real crash costs 3 s, which is rare and fine, Tony 2026-09-04). */
export const RECONCILE_MS = 3000;

export class Reconcile {
  /** @param {any} host the engine's side (engine.js `reconcileHost`) */
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

  // ---- lifecycle ----
  /** A rejoin into a LIVE match. The gun keeps its config + pools across a BLE drop, and `_load` restored
   *  the real alive/hp, so we DON'T guess. Hold a disarmed window (anti-cheat: a restart is slow and
   *  gains nothing), then re-arm to the restored pools with NO $SPAWN/$PSET (so HP is never reset to full).
   *  This replaces the old trigger-first resync, which mis-concluded "dead" on reconnect and let the
   *  auto-respawn HEAL the player: a free respawn on restart (bench 2026-09-04, Tony). */
  begin() {
    const h = this.host;
    if (this._win) return;
    // F164: snapshot the counts before the disarm. They are the last counts seen before the drop: `_onAmmo`
    // ignores every ammo frame while reconciling (the disarm's echo is not fire). Rounds fired while the link was
    // down were never reported, so the re-arm gives them back: a bounded refund, not a free magazine.
    this._win = { since: h.now(), ammo: h.liveAmmo() };
    h.clearResync();                                      // never run the infer-death machine on a rejoin
    h.stunRestore('reconcile');                           // F15: the reconcile owns the disarm/re-arm from here (F164: it re-arms with the live counts snapshotted above)
    h.write(['$AMMO,0,0,0,1,*', '$AMMO,1,0,0,1,*', ...h.pu.disarmRows()], 'reconcile: disarm');   // no shots count while we reconcile; A56: nor a held heavy's
    // F264 (Tony, 2026-09-18): ...and ASK. §3.10's rule is that the node must never INFER inside this window, and
    // the gun may well have died while the app was away (the S7 gap-death limitation, which inference cannot see).
    // A probe is not an inference: it is how the node stops needing one. The reply lands through the ordinary
    // handler, which §3.10 already says to trust verbatim here. Acting still stands down; reading does not.
    h.askGun('reconcile: read the gun rather than infer it');
    h.log('reconnect — reconciling (gun held ' + RECONCILE_MS + ' ms)', 'li');
    h.changed();
  }

  /** The engine's tick: the window ends RECONCILE_MS after it opened. */
  tick(now) {
    const w = this._win;
    if (w && now - w.since >= RECONCILE_MS) this.end();
  }

  /** End the reconcile: re-arm to the RESTORED pools. Alive: restore the loadout mags so the gun fires
   *  again at its real HP. Down: leave it disarmed (it is out, awaiting a real respawn). Never writes
   *  $SPAWN or $PSET, so a rejoin can never heal. */
  end() {
    const h = this.host, w = this._win, live = (w && w.ammo) || {};
    this._win = null;
    if (h.alive) {
      // F164: re-arm each slot to the LIVE count snapshotted when the reconcile began (`_liveAmmo`: the node's
      // magazine account, else that slot's spawn row). The spawn row alone was a free full magazine plus the
      // spawn reserve on every relink. A pickup slot keeps its spawn row here; `pu.reconcileRearm` owns a held heavy.
      const pu = new Set(((h.config && h.config.powerups) || []).map(p => +p.slot));
      const rows = ((h.frames && h.frames.spawn) || []).filter(f => f.startsWith('$AMMO,')).map(f => {
        const slot = +f.split(',')[1], l = live[slot];
        return l && !pu.has(slot) ? `$AMMO,${slot},${l[0]},${l[1]},1,*` : f;
      });
      // A56: a held heavy keeps its charges, and one on the trigger goes back on it (F436): `pu.reconcileRearm` says how.
      const { reequip, ammo } = h.pu.reconcileRearm(rows);
      if (ammo.length || reequip) {
        // F259: the account takes the re-armed counts and opens the echo window, as the powerup equip does, so the gun's
        // echo of this write is bookkeeping (never a shot, never a refill) and every later restore carries these
        // counts. `pu.reconcileRearm` has already done this for a held heavy's slot: one write, one echo expected.
        for (const f of ammo) {
          const t = f.split(','), slot = +t[1], mag = +t[2] || 0, res = +t[3] || 0;
          if (h.pu.isHeldSlot(slot)) continue;
          h.acctWrote(slot, mag, res); h.setPrev(slot, mag, res);
        }
        if (reequip) h.pu.reequipInRearm(ammo);
        else h.write(ammo, 'reconcile: re-arm');
        h.pu.afterRearm();   // A56 r2 M1: the re-arm is not the switch-back
        // S42/S55: the accuracy writer is `$TMP` t4 only and never writes `$AMMO`, so it cannot put an old
        // magazine back over this re-arm; every other `$AMMO` owner restores from the account set above.
        // Hold it anyway so this write owns the gun until it has answered, and re-arm the model: it returns to
        // the weapon's CRISP value, so nothing is written until the burst that degrades it.
        h.holdAccuracyWrites('reconcile re-arm');
        h.recoilArm('reconcile');
      }
      // F209: the drop may have landed inside spawn protection, or an app restart lost `_armPending`. Re-sending
      // the real table is the F11 repair path, so a rejoin always ends with hit reception armed. Routed through
      // `_armLife` (not a bare `_write`) so a `false` resolve on a link that stays up re-arms for retry instead
      // of silently leaving the gun on fn 28 for the life.
      // F121 rebuild: a drop may hide a reboot, which empties the table (F11), so the take is re-sent here too.
      if (h.protectsSpawn()) h.armRepair('reconcile');
      // 2026-09-19: a respawn profile's `trigger_live` write can be lost the same way -- a BLE drop in flight, or
      // an app restart mid-delay -- and nothing else would ever retry it, holding `$BMAP,0,98` for the rest of
      // the life. `!triggerPending` means the weapon delay is already over (or was never running): the
      // trigger should already be mapped, so re-send it as a repair. A delay still due is left alone -- `tick()`
      // fires it when it is due, and forcing it early would let the player fire while still protected.
      const rp = h.respawnProfile();
      if (rp && !h.triggerPending) {
        const r = h.write([rp.trigger_live], 'reconcile: weapon systems live');
        Promise.resolve(r).then(ok => {
          if (ok !== false || h.phase !== 'live' || h.ended || !h.alive || h.triggerPending) return;
          h.setTriggerPending({ at: h.now(), due: h.now(), flip: false });   // as `_armLife` re-arms its own lost take, not `_writeMust`'s one-shot retry
        });
      }
    }
    h.log(`reconcile done — ${h.alive ? 'live' : 'down'} at hp ${h.hp}`, 'lk');
    h.changed();
  }

  // ---- F416 ----
  /** F416 r4: a positive `$HP` answered the spawn check inside the window. The reconcile disarm is not a lost spawn, so
   *  the check asks again `askAfterMs` after the re-arm is out. F416 r2: the hold does not spend the check's time, it
   *  is counted once however many answers land in one window, and one chain runs per window. False when no window is
   *  open (the caller then decides the check itself). */
  holdSpawnCheck(c, askAfterMs) {
    const w = this._win;
    if (!w) return false;
    const h = this.host;
    const gen = c.gen = (c.gen || 0) + 1; c.heardAt = 0; c.asks = 0; c.queryAt = 0;
    const now = h.now(), until = now + Math.max(0, RECONCILE_MS - (now - w.since)) + askAfterMs;
    c.heldMs = (c.heldMs || 0) + Math.max(0, until - Math.max(now, c.heldTo || 0)); c.heldTo = Math.max(c.heldTo || 0, until);
    h.delay(until - now, () => { if ((c.gen || 0) === gen) h.spawnAsk(c); });
    return true;
  }
}
