// Moments rendering for the phone HUD.
import { redeployOutMs } from '../lanes.js';
import { TEAM_COLOR, TEAM_INK, pad2, digits, mmss, itemColor, esc, perkGlyph, weaponArt } from './shared.js';
import { PHONE_STATION_THRESHOLD_DBM } from '../transport/contract.gen.js';
import * as DS from './deathscreen.js';
import * as SV from './shieldmeter.js';
const HIT_WPN_BIG_MS = 1500, HIT_WPN_GONE_MS = 5000;   // QA-04: the hit weapon name, large then small (`_hitWpn`)

export function _moments(st) {
    // The reload takeover owns the chip bar. Tracked here, before ANY branch returns: dying mid-reload once left the
    // flag set for the whole DOWN screen and hid GUN LINK LOST exactly when it mattered (pass-2 review 2026-09-03).
    // The phase intentionally restores as IDLE until BLE relinks after an app restart. The verdict itself is
    // match-scoped and durable, so it remains the screen truth during that pre-relink gap too.
    const lockedUp = !!st.gunLocked;
    // A full-screen instruction must also be the only interactive/accessibility surface. `inert` blocks
    // keyboard, pointer and assistive-tech traversal; aria-hidden covers older embedded WebViews.
    for (const el of [this.hudEl, this.chips, this.info, this.skin, this.diag]) {
      if (!el) continue;
      el.inert = lockedUp;
      if (lockedUp) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
      else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
    }
    const reloadUp = !!(st.phase === 'live' && st.alive && st.bleUp && st.reloading);
    const switchUp = !!(st.phase === 'live' && st.alive && st.bleUp && st.switching && !reloadUp);
    const reconcileUp = !!(st.phase === 'live' && st.reconciling);
    const tk = lockedUp ? 'gun_locked' : reloadUp ? 'reload' : switchUp ? 'switch' : reconcileUp ? 'reconcile' : '';
    if ((this.frame.dataset.takeover || '') !== tk) { if (tk) this.frame.dataset.takeover = tk; else delete this.frame.dataset.takeover; }
    const downUp = st.phase === 'live' && !st.alive;   // the death screen: `#frame[data-down]` moves the pill bar clear of it
    if (!!this.frame.dataset.down !== downUp) { if (downUp) this.frame.dataset.down = '1'; else delete this.frame.dataset.down; }
    // F272: affirmative MCU lock-up. Durable through the expected power-cycle link drop; only the locked
    // relink recovery clears it and moves this player onto the ordinary DOWN/respawn screen.
    if (lockedUp) {
      const phase = st.gunRecovery || 'power_cycle';
      const key = `gun_locked_${phase}`;
      if (this._moment !== key) {
        this._moment = key;
        const copy = phase === 'rearming'
          ? '<span class="k">YOUR GUN IS RESTARTING</span><span class="t">KEEP POWER ON</span><span class="s">RE-ARMING…</span>'
          : phase === 'retry_exhausted'
            ? '<span class="k">RE-ARMING DID NOT FINISH</span><span class="t">POWER-CYCLE AGAIN</span><span class="s">HOLD POWER 3 s, THEN POWER ON</span>'
            : '<span class="k">YOUR GUN HAS STOPPED</span><span class="t">HOLD POWER <b>3 s</b>, THEN POWER ON</span><span class="s">YOUR PHONE WILL RE-ARM IT.</span>';
        this.overlay.innerHTML = `<div class="mo gunlocked" data-gun-locked data-gun-recovery="${phase}" role="alert" aria-live="assertive"><div class="wash"></div>
          <div class="c">${copy}</div></div>`;
      }
      return;
    }
    if (this._moment && this._moment.startsWith('gun_locked_')) { this._moment = null; this.overlay.innerHTML = ''; }

    // T-MINUS while armed
    if (st.phase === 'armed' && st.tMinusMs != null) {
      const secs = Math.ceil(st.tMinusMs / 1000);
      const big = secs > 99 ? mmss(st.tMinusMs) : pad2(secs);
      if (this._moment !== 'tminus') {
        this._moment = 'tminus';
        // A31: the compiler emits this line ONCE (`assign.game.mc_verify`) so MC and every phone say the same
        // thing. Rendered only when it is there — full coverage, or every phone on cellular through the tunnel (F309), and it is absent.
        const mcv = (st.game && st.game.mc_verify) ? `<div class="mcv"><span>${esc(String(st.game.mc_verify).toUpperCase())}</span></div>` : '';
        this.overlay.innerHTML = `<div class="mo tminus"><div class="hz t"></div><div class="hz b"></div><div class="glow"></div>${mcv}
          <div class="c"><div class="lab"><span class="h">T-MINUS</span><span class="s">WEAPONS ARMING</span><span class="s">STAND BY</span></div>
          <span class="n tab ${secs > 99 ? 'mm' : ''}" id="tm">${big}</span>
          <div class="r"><span class="chip"><span class="unskew">${esc(st.teamName)} · ${esc(st.callsign)}</span></span><span class="s">${esc(st.mode)} · ${mmss(st.clockMs)}</span></div></div></div>`;
        this._lastTminus = null;
      }
      const el = this.overlay.querySelector('#tm');
      if (el && this._lastTminus !== big) {
        this._lastTminus = big; el.textContent = big; el.classList.toggle('mm', secs > 99);
        el.classList.remove('punch'); void el.offsetWidth; el.classList.add('punch');
      }
      if (st.tMinusMs <= 0) this._flash();
      return;
    }
    if (this._moment === 'tminus' && st.phase !== 'armed') { this._moment = null; this.overlay.innerHTML = ''; }

    // DOWN (persistent while dead)
    if (st.phase === 'live' && !st.alive) {
      const kb = st.killedBy || {}; const tk = kb.teamKey;   // F81: null = no identity on the wire, so no team chip
      const recoveryDown = st.downReason === 'gun_recovery';
      const downKey = recoveryDown ? 'down_recovery' : 'down';
      if (this._moment !== downKey) {
        this._moment = downKey;
        const title = recoveryDown
          ? '<span class="tt rec"><span class="t">GUN RESTARTED</span><span class="t t2">REDEPLOYING</span></span><span class="kb">REDEPLOYING</span>'
          : `${st.respawnType === 'scanner' ? '<span class="tt"><span class="t">DOWN</span><span class="t t2">RESPAWN<br>AT STATION</span></span>' : '<span class="t">DOWN</span>'}<span class="kb">${kb.dot ? DS.ICON.drop : DS.ICON.skull}<span class="sr">${kb.dot ? 'POISONED BY' : 'KILLED BY'}</span> <b style="${tk ? `background:${TEAM_COLOR[tk]};color:${TEAM_INK[tk]}` : 'background:var(--mut);color:var(--bg,#000)'}"><span class="unskew">${esc(kb.name || kb.teamName || 'UNKNOWN')}</span></b></span><span id="dnlife">${DS.finalHitLine(st)}</span>${DS.itemLostLine(st)}`;
        this.overlay.innerHTML = `<div class="mo down"><div class="wash"></div>
          <div class="c"><div class="dsx"><div class="l2">${title}</div><div class="dslive" id="dslive">${this._dsLive(st)}</div></div>
          <div class="dn" id="dnhint">${this._downHint(st)}</div></div>
          ${this._downSafe(st)}
          <div class="recap" id="downrecap">${this._downRecap(st)}</div></div>`;
        this._downSafeSig = this._downSafe(st);
        this._flash();
        if ((Number(st.downWarn) || 1) >= 3 && st.respawnType === 'auto') this.h.onHaptic && this.h.onHaptic('down');
      } else {
        const el = this.overlay.querySelector('#rd'); if (el) { const h = digits(st.respawnIn); if (el.innerHTML !== h) el.innerHTML = h; }
        const hk = this._downHintKey(st); if (hk !== this._downHintSig) { const h = this.overlay.querySelector('#dnhint'); if (h) h.innerHTML = this._downHint(st); }
        const sf = this._downSafe(st); if (sf !== this._downSafeSig) { this._downSafeSig = sf; const el = this.overlay.querySelector('#dnsafe'); if (el) el.outerHTML = sf; }
        const rc = this.overlay.querySelector('#downrecap'); if (rc) { const h = this._downRecap(st); if (rc.innerHTML !== h) rc.innerHTML = h; }
        // S56: PARTIAL clears once the death grace is over and a straggling relay can still move DEALT, so re-read it
        const dl = this.overlay.querySelector('#dnlife'); if (dl) { const h = DS.finalHitLine(st); if (dl.innerHTML !== h) dl.innerHTML = h; }
        const ds = this.overlay.querySelector('#dslive'); if (ds) { const h = this._dsLive(st); if (ds.innerHTML !== h) ds.innerHTML = h; }
      }
      return;
    }
    if ((this._moment === 'down' || this._moment === 'down_recovery') && (st.alive || st.phase !== 'live')) { this._moment = null; this.overlay.innerHTML = ''; }

    // RECONCILING (S7.1): a BLE rejoin mid-match holds the gun disarmed for 3 s while the engine reconciles its
    // real pools — it never infers a death and never heals. Tell the player to wait, not to panic or pull anything.
    if (st.phase === 'live' && st.reconciling) {
      if (this._moment !== 'reconcile') {
        this._moment = 'reconcile';
        this.overlay.innerHTML = `<div class="mo reconciling"><div class="c"><span class="k">GUN RELINKED</span><span class="t">SYNCING WITH YOUR GUN</span>
          <div class="track"><i></i></div><span class="s">WEAPON DISARMED FOR A MOMENT · STAND BY</span></div></div>`;
      }
      return;
    }
    if (this._moment === 'reconcile' && !(st.phase === 'live' && st.reconciling)) { this._moment = null; this.overlay.innerHTML = ''; }

    // RELOADING (persistent for the weapon's reload time; the gun will not fire until the mag is back)
    if (reloadUp) {
      // `reloadTotalMs` is only the NOMINAL length, and on a chain weapon it is the PER-SHELL time — a 6-shell
      // tube spends most of its reload past it. Counting "0.0S" down at a bar pinned to 100% for two seconds is
      // a wrong number, so once `reloadOverrun` is up the bar goes indeterminate and the countdown goes away.
      // LATCHED for the takeover: on a chain weapon `reloadOverrun` blinks off at every shell and back on
      // 400 ms later, and a bar that alternates between indeterminate and a wrong number is worse than either.
      // Keyed on WHICH reload this is (`st.reloadAt`), because `_moment` cannot tell two apart: a $ALCD
      // (fired) and a $BUT,2,1 in ONE BLE batch end and re-open the takeover between two renders, so
      // `_moment` never left 'reload' and the new reload opened on the old one's latch — already pulsing,
      // its countdown already gone, at a magazine that had only just started moving (review 2026-09-12).
      const fresh = this._moment !== 'reload' || this._rlAt !== st.reloadAt;
      const over = !!st.reloadOverrun || (!fresh && this._rlOver === true);
      const pct = over ? 100 : Math.min(100, Math.round(100 * st.reloadMs / st.reloadTotalMs)), left = Math.max(0, (st.reloadTotalMs - st.reloadMs) / 1000);
      if (fresh) {
        this._moment = 'reload'; this._rlOver = null; this._rlAt = st.reloadAt;
        this.overlay.innerHTML = `<div class="mo reloading"><div class="c"><span class="t" id="rlt">RELOADING</span><span class="s">${esc(st.weapon)}</span>
          <div class="track"><i id="rlbar" style="width:${pct}%"></i></div><span class="n tab" id="rlleft">${left.toFixed(1)}S</span></div></div>`;
        this.h.onHaptic && this.h.onHaptic('tap');
      }
      if (this._rlOver !== over) {
        this._rlOver = over;
        const mo = this.overlay.querySelector('.mo.reloading'); if (mo) mo.classList.toggle('over', over);
        const t = this.overlay.querySelector('#rlt'); if (t) t.textContent = over ? 'RELOADING…' : 'RELOADING';
      }
      const b = this.overlay.querySelector('#rlbar'); if (b) b.style.width = pct + '%';
      const n = this.overlay.querySelector('#rlleft'); if (n && !over) n.textContent = left.toFixed(1) + 'S';
      // no early return: hits, gains and kills append ABOVE the takeover — reloading is exactly when you get shot (suite audit 2026-09-03)
    } else if (this._moment === 'reload') { this._moment = null; this._rlAt = null; this.overlay.innerHTML = ''; }   // (reloadUp is the single source of truth for the flag AND the overlay)

    // SWITCHING WEAPON (persistent for the assumed swap window; the gun will not fire mid-swap). Ends with a 'switched' moment.
    if (switchUp) {
      const pct = Math.min(100, Math.round(100 * st.switchingMs / st.switchWindowMs));
      if (this._moment !== 'switch') {
        this._moment = 'switch';
        this.overlay.innerHTML = `<div class="mo switching"><div class="c"><span class="t">SWITCHING</span>
          <div class="pair">${this._wtile(this._slotItem(st, st.switchFrom), 'STOWING', 'from')}<span class="arr">▸▸▸</span>${this._wtile(this._slotItem(st, st.switchTo), 'DRAWING', 'to')}</div>
          <div class="track"><i id="swbar" style="width:${pct}%"></i></div></div></div>`;
        this.h.onHaptic && this.h.onHaptic('tap');
      } else { const b = this.overlay.querySelector('#swbar'); if (b) b.style.width = pct + '%'; }
    } else if (this._moment === 'switch') { this._moment = null; this.overlay.innerHTML = ''; }

    this._redeployTick(st);   // 2026-09-19: ACTIVATING WEAPON SYSTEMS… turns to WEAPONS HOT when the trigger goes live
    // transient moments
    // C2 (docs/announcer.md): the kill card and the alert banner come from `st.card`, which only the engine's announcer
    // queue writes, so a hit or a stun landing in the same render cannot swallow them. `st.moment` keeps the rest.
    // docs/announcer.md "The three lanes": the kill, the medals, the lead, the hill, the downs and the pickups. The engine's
    // `st.card` (the announcer queue's own card) still paces the voice; the screen draws each event when it arrives.
    // (`_lanes` runs from `render`, right after this method.)
    const m = st.moment;
    if (m && m.at !== this._momentAt) {
      this._momentAt = m.at;
      if (m.kind === 'kill' || m.kind === 'alert') { /* drawn by the lanes (`_lanes`) */ }
      else if (m.kind === 'redeploy') this._redeploy(st);
      else if (m.kind === 'switched') { const held = st.powerup && st.powerup.held; if (!(held && st.ammo === 0 && st.activeSlot === held.slot && st.activeSlot === (m.data && m.data.slot))) this._switched(st, m); }   // polish r2/r3: no ACTIVE card for an EMPTY PICKUP slot (a loadout swap keeps it)
      else if (m.kind === 'hit') this._hit(st, m);
      else if (m.kind === 'gain') this._gain(st, m);
      else if (m.kind === 'go') this._flash();
    }
  }
  /** Replace the live overlay of this KIND rather than stacking another on top of it.
   *
   * Appending unconditionally is fine for a rare event and wrong for a frequent one: at 10 hits/s
   * eight hit overlays were alive at once, compositing to a near-opaque red wash that hid the HP and
   * ammo readouts at exactly the moment a player is being focused, and stacking two damage numbers
   * at identical coordinates into an unreadable mash. One node per kind, re-triggered.
   */
export function _swap(kind, el, outAt, gone) {
    this._overlays = this._overlays || {};   // (was `this._live`, which collided with the _live(st) render method)
    const prev = this._overlays[kind];
    let node = el;
    if (prev && prev.el.isConnected) {
      // REUSE the live node rather than replacing it. Replacing re-ran the entrance animation on
      // every event, so under sustained fire the vignette sawtoothed 0 -> 0.96 -> 0 at the hit rate
      // and the damage number never settled -- a new ~10 Hz modulation, below the hazard threshold
      // but exactly the kind of thing this design exists to avoid.
      clearTimeout(prev.t1); clearTimeout(prev.t2);
      prev.el.classList.remove('out');
      prev.el.innerHTML = el.innerHTML;
      prev.el.className = el.className;
      node = prev.el;
    } else {
      if (prev) { clearTimeout(prev.t1); clearTimeout(prev.t2); prev.el.remove(); }
      this.overlay.appendChild(el);
    }
    const rec = { el: node, t1: setTimeout(() => node.classList.add('out'), outAt),
                  t2: setTimeout(() => { node.remove(); if (this._overlays[kind] === rec) delete this._overlays[kind]; }, gone) };
    this._overlays[kind] = rec;
    return node;   // the node actually on screen (a reused one is NOT `el`)
  }

  /** F400: is the SWITCHING/ACTIVE weapon-switch card on screen right now (ALT's own or a pickup's, the same card)?
   *  `data-takeover="switch"` covers the SWITCHING phase; the brief ACTIVE confirm bubble is checked the same way
   *  `_lanes`' own redeploy check is (connected and not yet `.out`). Used to hide the small hint chip (decision 3). */
export function _puCardUp() {
    const sw = this._overlays && this._overlays.switched;
    return this.frame.dataset.takeover === 'switch' || !!(sw && sw.el.isConnected && !sw.el.classList.contains('out'));
  }

export function _flash() {
    if (this.frame.dataset.env === 'night') return;
    const now = Date.now(); if (this._flashAt && now - this._flashAt < 500) return; this._flashAt = now;   // ≤2 flashes/s whatever the event burst (WCAG 2.3.1)
    const w = document.createElement('div'); w.className = 'whiteout'; this.overlay.appendChild(w); setTimeout(() => w.remove(), 120); }
  /** The death screen's callouts (deathscreen.js): damage taken and dealt, kills, time alive. */
export function _dsLive(st) {
    if (st.lastLife) return DS.callouts(st);
    // The ledger is not saved (killedBy is): after an app restart while down, say why the numbers are missing.
    return '<div class="dco" id="dslife"><span class="dnk">THIS LIFE\'S NUMBERS ARE NOT KEPT ACROSS AN APP RESTART</span></div>';
  }
  /** S56: the weapon line under the HIT chip. An ambiguous resolution names up to two candidates with OR
   *  (never a guess); three or more show WEAPON UNCLEAR instead. No line at all when the phone has no
   *  claim (an older MC sends no roster weapons). */
export function _hitWeapon(w) {
    if (!w) return '';
    const names = w.ambiguous ? (w.names || []) : [w.name || w.id];
    if (!names.length || names.length > 2) return w.ambiguous ? '<span class="hw">WEAPON UNCLEAR</span>' : '';
    return `<span class="hw">${names.map(x => esc(String(x).toUpperCase())).join(' / ')}</span>`;
  }
  // TAKING A HIT. Deliberately a single fade, never a repeating flicker: this feedback moved off the
  // gun's LEDs precisely because winning that surface needed ~30 Hz repaints that strobe, and
  // flicker in the 10-25 Hz band is the photosensitive-epilepsy trigger range. One transition only.
  // Renders at night too (dimmer, no whiteout) -- knowing you are being shot is not optional.
export function _hit(st, m) {
    const d = (m.data) || {};
    const tk = d.shooter_key || 'red';
    const el = document.createElement('div');
    el.className = 'mo hit';
    const where = d.sensor === 4 ? 'GUN' : d.sensor != null ? 'HEADSET' : '';
    // The team colour stays INLINE and the night stylesheet overrides it with `!important`, which
    // beats a non-important inline style. Stripping the inline style at night instead worked, but
    // made the chip depend on that one CSS rule existing: delete the rule and the chip would have no
    // background at all. This way the day colour is the fallback.
    el.innerHTML = `<div class="vig"></div>
      <div class="hc"><span class="dmg tab">-${esc(d.dmg)}</span>
      <span class="src" style="background:${TEAM_COLOR[tk] || 'var(--bad)'};color:${TEAM_INK[tk] || '#fff'}"><span class="unskew">HIT${where ? ' · ' + where : ''}</span></span></div>`;
    this._swap('hit', el, 260, 700);
    this._hitWpn(this._hitWeapon(d.weapon));
    this.h.onHaptic && this.h.onHaptic('hit');
  }

  /** QA-04 (2026-09-23): the S56 weapon line outlives the hit flash. The flash is gone in 700 ms, far too soon to
   *  read a name in motion, so the name has its own overlay: 16 px for HIT_WPN_BIG_MS, then a small
   *  LAST HIT line until HIT_WPN_GONE_MS. A new hit restarts both. No line when the phone has no claim. */
export function _hitWpn(html) {
    if (!html) return;
    const el = document.createElement('div'); el.className = 'mo hitwpn';
    el.innerHTML = html;
    const node = this._swap('hitwpn', el, HIT_WPN_GONE_MS - 400, HIT_WPN_GONE_MS);
    clearTimeout(this._hwT);
    this._hwT = setTimeout(() => node.classList.add('last'), HIT_WPN_BIG_MS);
  }

  // GAINING a pool: heal, armour pickup, shield grant. Colour matches the pool so the player learns
  // one mapping across the gun strip and the HUD (poolgauge.py: shield teal, armour purple, health green).
export function _gain(st, m) {
    const d = (m.data) || {};
    // The shield meter shows every shield gain (a recharge is a dozen of them), so no toast on top of it.
    if (d.pool === 'shield' && SV.meterShown(st)) return;
    // HUD QA R2-02 (F341): a pool above the armed maximum is a misread `$PSET`, never a pickup. The engine drops it; so does this.
    if (d.hp > st.maxHp || (st.maxArmor > 0 && d.armor > st.maxArmor)) return;
    const el = document.createElement('div');
    el.className = `mo gain ${esc(d.pool)}`;
    const label = d.pool === 'armor' ? 'ARMOUR' : d.pool === 'shield' ? 'SHIELD' : 'HEALTH';
    el.innerHTML = `<div class="gv"></div>
      <div class="gc"><span class="amt tab">+${esc(d.amount)}</span><span class="lab">${label}</span></div>`;
    this._swap('gain', el, 500, 1000);
    this.h.onHaptic && this.h.onHaptic('gain');   // a pickup you are not looking at should be FELT
  }

  /** One weapon tile for the SWITCHING takeover and the ACTIVE confirm. */
  /** What sits in gun slot `slot`: the loadout's primary/secondary, or (A56) the powerup item the ALT cycle reaches. */
export function _slotItem(st, slot) {
    const lo = st.loadout || {};
    if (slot === 0 || slot === 1) return [lo.primary, lo.secondary][slot] || null;
    const h = st.powerup && st.powerup.held;
    if (h && h.slot === slot) return { kind: 'weapon', weapon_id: h.weapon_id, name: h.name, color: h.color, charges: h.left };
    // F400: a slot the switch-back just left (the empty heavy) -- `_puHeld` is already gone by the time this renders,
    // so the engine keeps its name/colour on `state().powerup.going` for exactly this.
    const g = st.powerup && st.powerup.going;
    if (g && g.slot === slot) return { kind: 'weapon', weapon_id: g.weapon_id, name: g.name, color: g.color, charges: g.charges };
    return slot != null && slot >= 2 ? { kind: 'weapon', weapon_id: st.weaponId, name: st.weapon || 'PICKUP' } : null;
  }
  /** F400 (docs/spec/powerups.md "The switch card"): a powerup tile carries `color` (the item's own colour, an accent)
   *  and `charges` (shown on the card, decision 1); a loadout tile carries neither, so it renders exactly as before. */
export function _wtile(it, label, cls) {
    if (!it) return `<span class="wt ${cls}"><span class="th none">—</span><span class="wl">${label}</span><span class="wn">NONE</span></span>`;
    const th = it.kind === 'perk' ? `<span class="th perk">${perkGlyph(it.perk_id)}</span>` : `<span class="th">${weaponArt(it.weapon_id)}</span>`;
    const pu = it.color != null, style = pu ? ` style="--item:${itemColor(it.color)}"` : '';
    const chg = it.charges != null ? `<span class="wc tab">${esc(it.charges)}</span>` : '';
    return `<span class="wt ${cls}${pu ? ' pu' : ''}"${style}>${th}<span class="wl">${label}</span><span class="wn">${esc(it.name).toUpperCase()}</span>${chg}</span>`;
  }
  /** The swap confirmed (by the next shot's $ALCD) or assumed (window expired): the new weapon, marked ACTIVE.
   *  F400 desk fix (docs/spec/powerups.md "The switch card"): a pickup switch (`m.data.pu`) never reaches this
   *  bubble by the gun's echo -- `powerup-player.js` `_switchCard` sets it display-only, so `_onAmmo`'s confirm-by-shot code skips
   *  it on purpose, and it always closes on its own timer. That is not the same "we're guessing" state ALT's own
   *  READY is: the phone's equip write already settled it. READY would undersell it; CONFIRMED BY YOUR GUN would
   *  claim a mechanism that never ran. CONFIRMED, alone, is the honest word. */
export function _switched(st, m) {
    const it = this._slotItem(st, m.data && m.data.slot);
    const el = document.createElement('div'); el.className = 'mo switched';
    const sub = m.data && m.data.pu ? 'CONFIRMED' : (m.data && m.data.assumed ? 'READY' : 'CONFIRMED BY YOUR GUN');
    el.innerHTML = `<div class="c"><div class="in">${this._wtile(it, 'ACTIVE ✓', 'to on')}<span class="s">${sub}</span></div></div>`;
    this._swap('switched', el, 900, 1200);
  }

  /** The REDEPLOYED sub-line (2026-09-19): arming while a timed respawn holds the trigger, the shield on a station
   *  respawn, else WEAPONS HOT. */
export function _redeployLine(st) {
    if (st.weaponArming != null) return '<span class="h arming">ACTIVATING WEAPON SYSTEMS…</span>';
    if (st.shielded) return '<span class="h shield">SHIELD UP · WEAPONS HOT ▸▸▸</span>';
    return '<span class="h">WEAPONS HOT ▸▸▸</span>';
  }
  /** Keeps a live REDEPLOYED overlay's sub-line in step with the engine: the trigger goes live under it. */
export function _redeployTick(st) {
    const o = this._overlays && this._overlays.redeploy;
    if (!o || !o.el || !o.el.isConnected) return;
    const h = o.el.querySelector('.r .h'); if (!h) return;
    const want = this._redeployLine(st);
    if (h.outerHTML !== want) h.outerHTML = want;
  }
export function _redeploy(st) {
    if (this.frame.dataset.env === 'night') return;
    const el = document.createElement('div'); el.className = 'mo redeploy';
    const lo = st.loadout || {};
    const ki = (k, it) => !it ? '' : `<span class="ki">${it.kind === 'perk' ? `<span class="th">${perkGlyph(it.perk_id)}</span>` : `<span class="th">${weaponArt(it.weapon_id)}</span>`}<span><span class="kk">${k}</span><br><span class="kn">${esc(it.name).toUpperCase()}</span></span></span>`;
    el.innerHTML = `<div class="wipe"></div><div class="slash"></div><div class="beam"></div>
      <div class="r"><span class="t">REDEPLOYED</span>${this._redeployLine(st)}<span class="s">${st.maxHp} HP${st.maxArmor > 0 ? ` · ${st.maxArmor} ARMOR` : ''} · MAG FULL</span>
        <div class="kit">${ki('PRIMARY', lo.primary)}${ki('SECONDARY', lo.secondary)}${ki('PERK', lo.perk)}</div></div>
      <div class="l"><span class="cs">${esc(st.callsign)}</span><span class="sq">${esc(st.teamName)} SQUAD</span></div>`;
    this._flash();
    // 2026-09-19: a timed respawn holds the trigger for the weapon delay (up to 3 s), so the overlay stays until the
    // weapon is live and a beat after; `_redeployTick` swaps the line to WEAPONS HOT the moment it is.
    const arming = Number(st.weaponArming) || 0;
    const live = this._swap('redeploy', el, redeployOutMs(arming), Math.max(2100, arming + 800));   // F368: the engine's `_laneTakeover` reads the same end
    // fit the headline to its column: font metrics differ per platform and a fixed size ran off the right edge (review #31)
    const t = live.querySelector('.t'); let fs = 56;
    while (t && t.scrollWidth > t.clientWidth + 1 && fs > 28) { fs -= 2; t.style.fontSize = fs + 'px'; }
  }


export function _downHintKey(st) { const s = st.station || {}; return [st.respawnHint, st.respawnType, st.respawnIn, s.id, s.present, s.rssi != null ? Math.round(s.rssi) : null, st.downWarn].join('|'); }
  /** 2026-09-19 (Tony): a TIMED respawn happens where the player stands, so the DOWN screen tells them to move. The
   *  engine's `downWarn` climbs when they are killed soon after a timed respawn: 1 = this line, 2 = larger and
   *  pulsing, 3 = a full-width flashing band that holds for the match. The flash is 1 Hz, well below any flicker band. */
export function _downSafe(st) {
    if (!st.respawnAuto && st.respawnType !== 'auto') return '';
    const lvl = Math.max(1, Math.min(3, Number(st.downWarn) || 1));
    return `<div class="safe w${lvl}" id="dnsafe"><span>GET TO SAFE SPACE FOR REDEPLOY</span></div>`;
  }
  /** The DOWN screen's middle block: the countdown in auto mode, or in scanner mode the respawn LESSON (utility.md
   *  §4.3, live bench 2026-09-04: "the very first time someone dies… the HUD should make it obvious"):
   *  HEAD TO YOUR TEAM'S RESPAWN STATION → GET CLOSER (closeness bar vs the station's threshold) → HOLD… (at the
   *  station, the short delay finishing) → PULL THE TRIGGER TO RESPAWN (green) / RESPAWNING… (presence gate). */
export function _downHint(st) {
    this._downHintSig = this._downHintKey(st);
    let hint = st.respawnHint || (st.respawnType === 'auto' ? 'timer' : st.respawnType === 'none' ? 'out' : 'find_station');
    if (st.respawnType === 'scanner' && !st.respawnAuto && (hint === 'timer' || hint === 'wait')) hint = 'find_station';   // older engine fallback
    if (hint === 'timer') return `<span class="n tab" id="rd">${digits(st.respawnIn)}</span><span class="lab">${st.respawnIn ? 'REDEPLOY IN' : 'AWAITING REDEPLOY'}</span>`;
    if (hint === 'out') return `<span class="n nn">✕</span><span class="lab">NO RESPAWNS THIS MODE</span>`;
    const s = st.station || {}; const thr = s.threshold != null && s.threshold !== 0 ? s.threshold : PHONE_STATION_THRESHOLD_DBM; const rssi = s.rssi != null ? Math.round(s.rssi) : null;   // -74 = the bench-tuned station default (≈10 ft at high TX)
    const pct = rssi == null ? 0 : Math.max(0, Math.min(100, Math.round(100 * (rssi - (thr - 30)) / 30)));   // 30 dB below the threshold = 0, at it = 100
    const bar = (cls, w) => `<div class="near ${cls}"><i style="width:${w}%"></i></div>`;
    const presence = st.respawnGate === 'presence';   // some games revive by just being at the station — never tell those players to pull the trigger (polish round 2026-09-04)
    if (hint === 'find_station') return `<span class="n nn">▣</span><span class="ins">HEAD TO YOUR TEAM'S RESPAWN STATION</span><span class="lab">${presence ? 'AND STAND THERE' : 'THEN PULL THE TRIGGER'}</span>`;
    if (hint === 'approach') return `<span class="n nn">▣</span><span class="ins">GET CLOSER</span>${bar('', pct)}<span class="lab">STATION IN RANGE${rssi != null ? ` · <b class="tab">${rssi}</b> / ${thr} dBm` : ''}</span>`;
    if (hint === 'hold') return `<span class="n nn on">▣</span><span class="ins on">HOLD…</span>${bar('on hold', 100)}<span class="lab on">AT THE STATION · ALMOST THERE</span>`;
    if (hint === 'pull_trigger') return `<span class="n nn on">▣</span><span class="ins on">PULL THE TRIGGER TO RESPAWN</span>${bar('on', 100)}<span class="lab on">AT THE STATION</span>`;
    return `<span class="n nn on">▣</span><span class="ins on">RESPAWNING…</span>${bar('on', 100)}<span class="lab on">AT THE STATION</span>`;
  }
  /** The DOWN screen's THE GAME NOW strip (deathscreen.js `gameNow`): the clock, the race for the mode, the hill and
   *  your match line. An old board keeps its numbers with its age beside them (the live board's own freshness rule). */
export function _downRecap(st) {
    let h = DS.gameNow(st, { stale: this._boardStale(st), age: this._boardAge(st), resultRows: r => this._resultRows({ rows: r }) });
    if (st.wsState !== 'bound' && this._atCapMinusOne(st)) h += '<div class="capwarn"><span class="unskew">MC OUT OF RANGE · A WIN IS CONFIRMED ONLY AT MISSION CONTROL</span></div>';
    return h;
  }

export const methods = { _downHintKey, _downSafe, _downHint, _downRecap, _moments, _swap, _puCardUp, _flash, _dsLive, _hitWeapon, _hit, _hitWpn, _gain, _slotItem, _wtile, _switched, _redeployLine, _redeployTick, _redeploy };
