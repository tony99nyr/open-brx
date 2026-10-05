// Phone HUD v2 renderer — a pure function of engine state (node.md §4). Landscape 844×390, scaled to
// the viewport. Structure re-renders only when the state "signature" changes; live numbers patch in
// place so CSS animations don't restart every tick. Moments (T-MINUS, KILL, DOWN, REDEPLOY) live in
// #overlay so they animate independently of the base HUD.
import { mmss, gunDot, hpPct, armorPct, hasArmor, accShown, AMMO_PIP_MAX, chargeCost, AIM_REASON, magText, INFO_SVG } from './shared.js';
const JOIN_GATED_ACTS = new Set(['onSetUrl', 'onScanQr', 'onJoinDiscovered', 'onReconnectMc']);
const SKIN_MOON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M15 3a9 9 0 1 0 6.5 15.2A7.5 7.5 0 0 1 15 3z"/></svg>';
const SKIN_SUN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g></svg>';
import * as SV from './shieldmeter.js';
import * as Lobby from './lobby.js';
import * as Loadout from './loadout.js';
import * as Result from './result.js';
import * as Live from './live.js';
import * as Score from './score.js';
import * as Ammo from './ammo.js';
import * as Chips from './chips.js';
import * as Moments from './moments.js';
import * as Lanes from './lanes.js';
import * as Diag from './diag.js';
export { MEDAL_FALLBACK, MEDAL_LABEL } from './shared.js';
export { RECAP_ICON_PX, recapLegend, recapTilesHidden, recapShotsNote } from './result.js';
export { tagTooLong, connectingText } from './lobby.js';

export class Hud {
  constructor(root, handlers = {}) {
    this.root = root; this.h = handlers;
    this.frame = root.querySelector('#frame'); this.hudEl = root.querySelector('#hud');
    this.overlay = root.querySelector('#overlay'); this.chips = root.querySelector('#chips');
    this.diag = root.querySelector('#diag'); this.info = root.querySelector('#info');
    // QA-28 (2026-09-23): U+24D8 renders as an empty box where the font lacks it (headless Chromium did); draw it.
    if (this.info && !this.info.querySelector('svg')) this.info.innerHTML = INFO_SVG;
    this.skin = root.querySelector('#skin');   // the day/night skin switch (a sibling of #hud, so it needs its own listener)
    if (this.skin) this.skin.addEventListener('click', e => this._click(e));
    this.sig = null; this.scan = []; this.link = {}; this.diagData = {}; this.mcUrl = '';
    this.scanActive = true;   // game day 2026-09-19: app.js sets whether a picker scan really runs
    this.scanOther = false;   // F258: the "other devices" fold on the picker, closed to start with
    // App 0.4.2 (field 2026-09-19, Pixel 5): after a tap on a gun the list emptied and the screen showed
    // nothing for about 4 s while two connects failed and a third linked. `connecting` is
    // `{name, attempt, of, failed}` from the tap until the link is up or the connect gives up, else null.
    this.connecting = null;
    // F211: adapter-off state, app.js-owned (like `mcUrl`/`discovered` below) — the picker's own concern,
    // never round-tripped through the engine. `platform` gates the Android-only enable/settings buttons.
    this.bluetoothOn = true; this.platform = 'web';
    // F340: Location services, app.js-owned like `bluetoothOn`. False only on Android 11 and older with Location
    // off, where a BLE scan finds nothing (location.js). Android 12+, iOS and the web never set it false.
    this.locationOn = true;
    this.discovered = null;   // {url, at} a LAN-sweep hit MC never auto-joined — null once bound or nothing found
    this._joinConfirm = null; // {act, at} the armed/live two-tap guard on CONNECT / SCAN QR (below)
    this._gunConfirm = null;  // {at} the LIVE two-tap guard on RELINK GUN (bench 2026-09-17, below)
    this.lo = { tab: 'primary', filter: 'weapons', focus: null, confirm: null };   // LOADOUT browser UI state (tab / filter / focused row / A14 two-tap confirm {key, drop})
    this._moment = null; this._momentTimer = null; this._lastTminus = null; this.mcPill = false;   // live: the MC-range pill is opt-in (tap the MC label)
    // A24 FINAL RESULTS: which screen the player has reopened after OK (null | 'result' | 'history') and which
    // half of the segmented toggle they are on (null = pick from the mode: teams for a team game, players for FFA).
    this.view = null; this.rtab = null; this._lastSt = null;
    // Bench 2026-09-17: the live scores overlay (null | 'team' | 'player'). A VIEW like `view` above: opening it
    // sends nothing and touches no engine state. `_cueAt` / `_cueT` drive the ammo gauge's shot-ready cue.
    this.board = null; this._cueAt = null; this._cueT = null;
    this.info.addEventListener('click', () => this.toggleDiag());
    this._svFx = { shield: null };   // the shield meter's memory between frames (its one-shot hit flash)
    this.hudEl.addEventListener('click', e => this._click(e));
    this.diag.addEventListener('click', e => this._click(e));
    // The chip bar is a sibling of #hud, so its pill buttons (GUN LINK LOST, RECONNECT NOW) need their own listener:
    // without it a tap on them reached no handler at all (bench 2026-09-17).
    this.chips.addEventListener('click', e => this._click(e));
    let pressT = null;
    // (removed 2026-08-26, critic #9: a resting glove/chin tripped the invisible 900 ms night toggle — NIGHT lives in the diag panel)
    this.hudEl.addEventListener('pointerup', () => { if (pressT) clearTimeout(pressT); pressT = null; });
    this.hudEl.addEventListener('pointerleave', () => { if (pressT) clearTimeout(pressT); pressT = null; });
    // Bench 2026-09-16: a player could not tell whether a tap landed. One delegated pair on #frame (the
    // parent of #hud, #diag and the ⓘ button) covers every tappable thing — a native button, a
    // data-act row/pill/tile, or role="button" — so no control needs its own press handler. pointerdown
    // fires on touch-down on both WKWebView and Android WebView (unlike CSS :active, which iOS can miss);
    // pointerup/cancel always clears it, and a window-level fallback catches a release outside the frame
    // (a drag that ends off-screen). Disabled/aria-disabled controls are skipped so a locked tile never
    // flashes pressed.
    this.frame.addEventListener('pointerdown', e => this._tapDown(e));
    this.frame.addEventListener('pointerup', () => this._tapUp());
    this.frame.addEventListener('pointercancel', () => this._tapUp());
    window.addEventListener('pointerup', () => this._tapUp());
    window.addEventListener('pointercancel', () => this._tapUp());
    window.addEventListener('resize', () => this.fit()); this.fit();
  }
  // See the constructor comment above for why this is one delegated pair, not per-button code.
  _tapDown(e) {
    const el = e.target.closest('button, [data-act], [role="button"]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (this._pressedEl && this._pressedEl !== el) this._pressedEl.classList.remove('tap-press');
    this._pressedEl = el;
    el.classList.add('tap-press');
  }
  _tapUp() {
    if (!this._pressedEl) return;
    this._pressedEl.classList.remove('tap-press');
    this._pressedEl = null;
  }
  fit() {
    // On the phone the OS status bar (clock / battery / signal) is drawn OVER the web view — Android 15 forces
    // edge-to-edge and reports env(safe-area-inset-top) as 0 — so the top-right ⓘ sat under it (Tony, device
    // 2026-09-04). Native builds get a fixed top margin across the whole frame; the frame scales into what is left.
    const st = this.frame.parentElement;
    if (st && !this._nativeInset) {
      this._nativeInset = true;
      try {
        const C = window.Capacitor;
        if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) {
          st.style.paddingTop = 'max(env(safe-area-inset-top, 0px), 28px)';
          st.style.paddingBottom = 'max(env(safe-area-inset-bottom, 0px), 14px)';   // + the gesture-nav pill along the bottom edge (Pixel screenshot 2026-09-04)
        }
      } catch (_) { /* browser */ }
    }
    // the stage's CONTENT box: the viewport minus that padding, so the frame never sits under a bar or a notch
    const w = (st && st.clientWidth) || window.innerWidth, h = (st && st.clientHeight) || window.innerHeight;
    const cs = st && typeof getComputedStyle === 'function' ? getComputedStyle(st) : null;
    const pw = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0, ph = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0;
    const s = Math.min((w - pw) / 844, (h - ph) / 390);
    this.frame.style.transform = `scale(${s})`;
  }
  _click(e) {
    // The scores overlay closes on a tap anywhere outside its panel. The ⓘ, the day/night switch, the diag
    // panel and the chip bar keep their own taps (they are not part of the live screen under the overlay).
    if (this.board && !e.target.closest('.bdpanel, [data-act="onBoard"], #skin, #info, #diag, #chips')) {
      this.board = null; this.sig = null; if (this._lastSt) this.render(this._lastSt);
      return;
    }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, arg = el.dataset.arg;
    // The results / history screens are a VIEW of what the engine already holds — reopening them changes nothing
    // on the gun or the wire, so they are handled here and never round-trip through the app's handler map.
    // Re-rendered from the last state IMMEDIATELY: the app's loop is 250 ms and a toggle that lags a quarter of a
    // second past the tap reads as a dead control.
    // A26: the ⓘ on a rack row only MOVES THE DETAIL PANE. It equips nothing, sends nothing and touches no
    // engine state, so like the results views it is answered here and never round-trips the app's handler map.
    // QA-20: FULL NOTES on the briefing only READS text the phone already holds, so it is answered here too.
    if (act === 'onBriefMore') {
      this.bfMore = !this.bfMore;
      this.sig = null; if (this._lastSt) this.render(this._lastSt);
      return;
    }
    if (act === 'onBriefDone') this.bfMore = false;   // leaving the briefing closes its notes (then the app handler runs)
    if (act === 'onLoInfo') {
      this.lo.focus = arg || null; this.lo.confirm = null;
      this.sig = null; if (this._lastSt) this.render(this._lastSt);
      return;
    }
    // Polish-loop pass 1+2 (2026-09-12, MEDIUM security+UX): CONNECT / SCAN QR / RELINK MC / JOIN (a
    // discovered address, never one the player typed themselves) are reachable in every phase (F156) with
    // nothing stopping a stray tap mid-match — any of the four redials and drops the live MC link, and
    // SCAN QR additionally blacks the HUD out behind the camera. All four stay one-tap everywhere they
    // always were (idle/connected/kitted/lobby/over); only armed/live — an active match — gate them behind
    // a second tap, the same two-tap shape A14's loadout conflict already uses. The warning lives in
    // `dg-mcjoinhint` (`renderDiag`), patched from this state rather than a structural rebuild so it
    // shows on the SAME render the first tap produced.
    if (JOIN_GATED_ACTS.has(act) && this._lastSt && (this._lastSt.phase === 'armed' || this._lastSt.phase === 'live')) {
      const now = Date.now();
      if (this._joinConfirm && this._joinConfirm.act === act && now - this._joinConfirm.at < 4000) { this._joinConfirm = null; this.renderDiag(); }   // second tap: revert the warning now, then let it through below
      else { this._joinConfirm = { act, at: now }; this.renderDiag(); return; }
    } else if (this._joinConfirm) this._joinConfirm = null;   // any other tap (or a phase change) drops a stale confirm
    // Bench 2026-09-17: RELINK GUN takes the phone off the gun, so on a LIVE link it asks for a second tap within 4 s.
    // The GUN LINK LOST pill shares the act, but only shows with the link down, where a tap takes nothing away.
    if (act === 'onReconnectGun' && el.closest('#diag')) {
      if (this.diagData && this.diagData.link && this.diagData.link.relinking) return;   // a relink is running: the button reads RELINKING…
      if (this._lastSt && this._lastSt.phase === 'live' && this._lastSt.bleUp) {
        if (this._gunConfirm && Date.now() - this._gunConfirm.at < 4000) { this._gunConfirm = null; this.renderDiag(); }
        else { this._gunConfirm = { at: Date.now() }; this.renderDiag(); return; }
      }
    } else if (this._gunConfirm) { this._gunConfirm = null; if (this.diag.classList.contains('open')) this.renderDiag(); }
    if (act === 'onBoard' || act === 'onBoardTab' || act === 'onBoardClose') {
      this.board = act === 'onBoardClose' ? null : (arg === 'player' ? 'player' : 'team');
      this.sig = null; if (this._lastSt) this.render(this._lastSt);
      return;
    }
    if (act === 'onEndOk') this.view = null;                                     // OK still acks the end (app handler below)
    else if (act === 'onShowResults' || act === 'onShowHistory' || act === 'onCloseView' || act === 'onResultTab') {
      if (act === 'onShowResults') this.view = 'result';
      else if (act === 'onShowHistory') this.view = 'history';
      else if (act === 'onCloseView') this.view = null;
      else this.rtab = arg === 'player' || arg === 'awards' ? arg : 'team';
      this.sig = null; if (this._lastSt) this.render(this._lastSt);
      return;
    }
    const fn = this.h[act]; if (fn) fn(arg, el);
  }
  // F258 (bench 2026-09-18): this used to clear the structural signature, so every scan hit rebuilt
  // the whole screen and destroyed every row node under the player's finger. A scan hit is not a
  // screen change: `_patchScan` writes the rows in place on the next render, and the picker's empty
  // placeholder and its "other devices" fold are patched the same way. Nothing here is structure.
  setScan(list) { this.scan = list || []; }
  /** Opens or closes the "other devices" fold (F258). A view, like `board`: it sends nothing. */
  setScanOther(open) { this.scanOther = !!open; }
  /** Sets the "Connecting to <gun>" state of the picker (null clears it). */
  setConnecting(c) { this.connecting = c || null; }
  setLink(link) { this.link = link; }
  // Polish-loop pass 1 (2026-09-12): a LAN sweep hit MC is no longer auto-joined (app.js, another lane) — it
  // hands the player the choice instead. `null` clears the row (nothing found, or MC is already bound).
  setDiscovered(d) { this.discovered = d || null; this.sig = null; }
  setDiag(d) { this.diagData = d; if (this.diag.classList.contains('open')) this.renderDiag(); }
  // F156/F135/ledger#31 (field 2026-09-12): the diag panel now carries its own `#mcurl` + SCAN QR (below), the
  // one join control reachable in EVERY phase. The pre-join screen's own copy (same id) must not coexist with
  // it in the DOM at once, so opening/closing the panel claims/releases the id on the diag copy AND forces the
  // underlying screen to rebuild around it (`_lobby` hides its own copy while this one holds the id) — same
  // pattern `onLoInfo` already uses to swap a pane with no engine-state change behind it.
  toggleDiag() {
    this.diag.classList.toggle('open');
    const open = this.diag.classList.contains('open');
    if (open) this.renderDiag();   // builds the shell (and the .mcurlfield input) on first open
    const inp = this.diag.querySelector('.mcurlfield');
    if (inp) { if (open) inp.id = 'mcurl'; else inp.removeAttribute('id'); }
    this.sig = null; if (this._lastSt) this.render(this._lastSt);
  }

  render(st) {
    this._lastSt = st;
    // armour granted past a max of 0 has no max to be a share of: the bar measures it against the most this life held
    this._armPeak = st.armor > 0 ? Math.max(this._armPeak || 0, st.armor) : 0;
    if (!st.ended) this.view = null;   // a new match retires a reopened results/history screen
    if (this.board && !(st.phase === 'live' && st.alive)) this.board = null;   // the scores overlay belongs to the live screen only
    this.frame.dataset.team = st.teamKey || 'blue';
    this.frame.dataset.env = st.night ? 'night' : '';
    // F288: gun health owns the top alert lane. Lower-priority chips are hidden by CSS while this flag is
    // present, rather than stacking over the fault or pushing it into the smoke / hit-effect lane.
    if (this._gunHealthActive(st)) this.frame.dataset.gunHealth = '';
    else delete this.frame.dataset.gunHealth;
    if (this.board) this.frame.dataset.board = this.board; else delete this.frame.dataset.board;
    const sig = [st.phase, st.alive, !!st.killedBy, st.night, st.ready, st.tutorial, !!st.resync, st.callsign, st.teamKey, st.weapon, st.endAck, st.ended, st.kills, st.underFire, st.tutorialWeapon && st.tutorialWeapon.weapon_id,
      st.mode, st.gun && st.gun.name, st.switching, st.activeSlot, st.hp <= st.maxHp * .25, (st.mag ? st.ammo / st.mag : 1) <= .15, st.ammo === 0, st.reserve === 0, (st.mag || 0) > AMMO_PIP_MAX, st.battery != null && st.battery <= 15,
      st.heatEverSeen, st.overheatShown, !!(st.alive && st.aim && AIM_REASON[st.aim.reason]), !!st.shielded, !!st.stunned,   // QA 2026-09-23: the spawn shield and the stun take the centre slot   // S53: the smoke tell takes the centre slot from the reticle / TAKING FIRE   // bench 2026-09-17: OVERHEAT prompt/overlay and the heat bar's existence are structural, not patched in place. `st.overheating` (the mechanic) is not read here at all: the HUD draws the display window only
      chargeCost(st) != null && st.ammo != null && st.ammo < chargeCost(st), st.reserve > 0,   // OUT OF ENERGY / RECHARGE prompt + the NOT ENOUGH ENERGY note are structural too
      // F288: both gun-health facts change live markup. Flatten the objects: joining the objects themselves
      // would turn every non-null value into the same "[object Object]" and miss no_fire → no_answer.
      st.poolStale && st.poolStale.why, st.cure && st.cure.verdict, !!st.spawnLost, !!st.gunFlapping, st.headsetJoin && st.headsetJoin.state, !!st.reconciling, !!st.gunLocked, st.gunRecovery, st.downReason,
      // A56: the powerup hint/held slots exist only in a powerup game; the overshield bar and the shield number are structure
      !!st.powerup, !!(st.powerup && st.powerup.overshield), !!(st.powerup && st.powerup.held && st.powerup.held.active),
      SV.meterShown(st), hasArmor(st),   // the shield meter exists or not; the armour number and bar exist or not
      // F258: `this.scan.length` used to sit here, so every scan hit that added a device rebuilt the
      // whole screen. The picker's rows, its empty placeholder and its fold are all patched in place
      // by `_patchScan` now, so nothing about the scan is structure any more.
      st.kills > 0, st.deaths > 0, st.assists > 0, accShown(st) != null, st.reserve != null, st.bleUp, st.ended, this.bluetoothOn, this.locationOn,
      this.discovered && this.discovered.url, this.discovered && this.discovered.text,   // A60: the reason can change on the same url   // Polish-loop pass 1: the discovered-MC row on the pre-join screen (`_joinConfirm` only touches the diag panel, patched directly, not here)
      // F488: normalised, so the first 1 s sync poll (app.js: `hud.sync` goes from unset to {bound:false, pending:0})
      // is not a screen change. Every reader treats the two the same, and the raw values rebuilt the picker's rows ~1 s after boot.
      st.rejoin, !!st.pendingTeardown, !!(this.sync && this.sync.bound), (this.sync && this.sync.pending) || 0,
      // F137 (field 2026-09-12, found verifying the fix below): the pre-kit CONNECTED screen swaps a whole
      // block (the type-address box vs "MC LINKED") on `wsState`, not just text — `_patch` only ever touched
      // `#mcstatus`'s TEXT, so with wsState excluded from the signature that swap needed some UNRELATED field
      // to change too before it would ever rebuild; on the otherwise-static pre-kit screen it often never
      // did, and MC could bind with the player never told. The `typing` guard below already protects the
      // input from a rebuild while it has focus, so this does not reopen the "never rebuild while typing"
      // case the old comment (still true of `synced`/`headEcho`, which stay patched-only) was written for.
      st.wsState,
      // A10 loadout browser + slot plates
      // Pass 3: `tryoutUnconfirmed` is now an object ({tab, kind}) or null — every OTHER object in this join
      // stringifies to the same "[object Object]" too, so it is flattened to its own fields; the join
      // would otherwise never notice a switch from one arm's identity to another's.
      st.browsing, st.canPickPrimary, st.canPickSecondary, st.canPickPerk, st.tryoutSeen, st.tryoutArming,
      st.tryoutUnconfirmed && st.tryoutUnconfirmed.tab, st.tryoutUnconfirmed && st.tryoutUnconfirmed.kind,
      this.lo.tab, this.lo.filter, this.lo.focus, this.lo.confirm && this.lo.confirm.key,
      st.kitOpen, st.briefSeen, st.kitLocked, st.standby, st.game && st.game.name, st.game && st.game.loadout_line,
      st.loadoutAck && st.loadoutAck.t, st.pendingPick && st.pendingPick.id, st.pendingPick && st.pendingPick.kind,
      st.loadout && st.loadout.primary && st.loadout.primary.weapon_id, st.loadout && st.loadout.secondary && st.loadout.secondary.weapon_id, st.loadout && st.loadout.perk && st.loadout.perk.perk_id,
      !!(st.loadout && st.loadout.overrides && st.loadout.overrides.easy_reload),
      !!(st.catalog && st.catalog.weapons && st.catalog.weapons.length),
      // A24 FINAL RESULTS: the headline changes when the result lands and again when the settle window expires,
      // and the toggle/history are structure. `resultWait` is in here because "MC NOT REACHED" appears with NO
      // message arriving — nothing else in the signature moves at that moment.
      this.view, this.rtab, st.resultWait,
      this.board, this.board && st.scoreAt, this.board && st.fragLimit,   // bench 2026-09-17: the scores overlay rebuilds on a new MC push while it is open st.result && st.result.match_id, st.result && st.result.outcome,
      st.result && st.result.provisional, st.result && st.result.rows && st.result.rows.length,
      this.history && this.history.length, this.sessionId, st.game && st.game.mc_verify].join('|');   // synced / headEcho stay patched in place (F137: wsState moved INTO the signature above — see the note there)
    const panel = st.phase === 'kitted' && ((st.ended && (!st.endAck || !!this.view)) || (!st.ended && st.kitOpen && !st.briefSeen && !this._tryoutShown(st)) || (!st.ended && st.browsing && !this._tryoutShown(st)));
    const screen = st.phase === 'live' ? 'live' : st.phase === 'armed' ? 'armed' : st.phase === 'idle' ? 'idle' : panel ? (st.browsing ? 'lo' : 'panel') : 'lobby';
    if (this.frame.dataset.screen !== screen) this.frame.dataset.screen = screen;
    if (sig !== this.sig) {
      const urlEl = this.hudEl.querySelector('#mcurl');
      const typing = urlEl && typeof document !== 'undefined' && document.activeElement === urlEl;
      if (!typing) {
        const lst = this.hudEl.querySelector('.list, .lolist'); const keep = lst ? lst.scrollTop : 0;   // keep the picker's/browser's scroll across re-renders
        this.sig = sig; this.hudEl.innerHTML = this._structure(st);
        if (keep) { const l2 = this.hudEl.querySelector('.list, .lolist'); if (l2) l2.scrollTop = keep; }
        const fo = this.hudEl.querySelector('.lrow.fo'); if (fo && fo.scrollIntoView) { try { fo.scrollIntoView({ block: 'nearest' }); } catch (_) { /* jsdom */ } }
      }
    }
    this._patch(st);
    this._patchScan();   // F258: the picker's rows are written in place, never rebuilt
    this._shotCue(st);
    this._skinSwitch(st);
    this._chips(st);
    this._moments(st);
    // F368: after `_moments`, so a takeover opened on this render (RELOADING, SWITCHING, SYNCING, REDEPLOYED, GUN STOPPED)
    // is already known to the lanes, and a takeover branch that returns early can no longer skip them.
    this._lanes(st);
    this._railFit();
    this._fitBriefing();
    this._fitMcLinked();
    this._fitLoDetailName();
  }

  /** Bench 2026-09-17: the skin is each player's own choice. The switch shows the skin a tap gives (☾ on day, ☀ on
   *  night). The live night label names NIGHT OPS only when the venue is set to it; otherwise it is just "NIGHT". */
  _skinSwitch(st) {
    const on = !!st.night;
    if (this.skin) {
      if (this.skin.dataset.on !== String(on)) { this.skin.dataset.on = String(on); this.skin.innerHTML = on ? SKIN_SUN : SKIN_MOON; }
      if (this.skin.getAttribute('aria-checked') !== String(on)) this.skin.setAttribute('aria-checked', String(on));
    }
    const lab = this.hudEl.querySelector('.nightlab'), txt = st.nightOps ? 'NIGHT OPS' : 'NIGHT';
    if (lab && lab.textContent !== txt) lab.textContent = txt;
  }

  /** F137 (field 2026-09-12): "MC LINKED ✓ — WAITING FOR KIT-OUT" at the design 28px wrapped to two
   *  uncentred lines inside a padding-less box (the first line ran to the border) at every width this was
   *  checked at — nothing here ever fitted it. Same measure-then-shrink loop as `_fitBriefing`/`_redeploy`;
   *  the CSS gives it `white-space:nowrap` so `scrollWidth` reports the true one-line width to shrink against,
   *  same contract those two already rely on. */
  _fitMcLinked() {
    const nm = this.hudEl.querySelector('.mclinked .unskew');
    if (!nm) { this._mlFit = null; return; }
    const key = nm.textContent + '|' + (nm.parentElement ? nm.parentElement.clientWidth : 0);
    if (this._mlFit !== key) { this._mlFit = key; nm.style.fontSize = ''; }
    if (nm.scrollWidth <= nm.clientWidth + 1) return;
    let fs = parseFloat(getComputedStyle(nm).fontSize) || 28;
    while (nm.scrollWidth > nm.clientWidth + 1 && fs > 15) { fs -= 1; nm.style.fontSize = fs + 'px'; }
  }

  /** Polish-loop pass 2 (found verifying "EQUIPPED · UNCONFIRMED"): the rack's detail-pane `.nm` (weapon
   *  name + role chip + heroTag, all on one `white-space:nowrap` line) has no shrink of its own — a long
   *  enough combination overflows and gets clipped by the CSS ellipsis with no visible fallback. Confirmed
   *  pre-existing (a plain "ASSAULT RIFLE" + role chip + "EQUIPPED" already overflowed at some widths,
   *  independent of this pass); the longer UNCONFIRMED badge just made it reliably visible. Same
   *  measure-then-shrink loop as `_fitMcLinked`/`_fitBriefing`. */
  _fitLoDetailName() {
    const nm = this.hudEl.querySelector('.lodetail .nm');
    if (!nm) { this._loNmFit = null; return; }
    const key = nm.textContent + '|' + nm.clientWidth;
    if (this._loNmFit !== key) { this._loNmFit = key; nm.style.fontSize = ''; }
    if (nm.scrollWidth <= nm.clientWidth + 1) return;
    let fs = parseFloat(getComputedStyle(nm).fontSize) || 24;
    while (nm.scrollWidth > nm.clientWidth + 1 && fs > 13) { fs -= 1; nm.style.fontSize = fs + 'px'; }
  }

  /** F110 (review): `.bfbody` is a fixed 268 px box whose rows are `flex:0 0 auto`, i.e. purely additive — a
   *  game NAME that wraps to two lines at 40 px pushes the rows below it straight through the CTA footer.
   *  The kicker and the loadout line are clamped in CSS; the name is the row that carries a host's arbitrary
   *  text, so it is fitted to whatever room is left, the same measure-then-shrink loop `_redeploy` uses. */
  _fitBriefing() {
    const body = this.hudEl.querySelector('.bf .bfbody');
    if (!body) { this._bfFit = null; return; }
    const nm = body.querySelector('.bfname'); if (!nm) return;
    // QA-20: FULL NOTES shows only when a clamp actually cut the host's text (or while its panel is open).
    const btn = this.hudEl.querySelector('.bf .bfmorebtn');
    if (btn && !this.bfMore) {
      const cut = Array.from(body.querySelectorAll('.bfdesc, .bfload .v, .bfk .lab')).some(e => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1);
      if (btn.hidden === cut) btn.hidden = !cut;
    }
    // Re-checked every render, not memoised on the text: the webfont swaps in AFTER the first paint and a name
    // that fitted on one line in the fallback face wraps to two in Saira Condensed — a one-shot fit measured
    // the wrong font and left the overflow on screen. New content starts again from the design size.
    const key = nm.textContent + '|' + body.clientHeight;
    if (this._bfFit !== key) { this._bfFit = key; nm.style.fontSize = ''; }
    if (body.scrollHeight <= body.clientHeight) return;
    let fs = parseFloat(getComputedStyle(nm).fontSize) || 40;
    while (body.scrollHeight > body.clientHeight && fs > 18) { fs -= 2; nm.style.fontSize = fs + 'px'; }
  }

  // ---------- structure per phase ----------
  _structure(st) {
    switch (st.phase) {
      case 'idle': return this._idle(st);
      case 'connected': return this._lobby(st, 'connected');
      case 'kitted':
        // T2-B item 2: benched overrides everything else on this phase -- no results/briefing/loadout
        // screen should ever race a SITTING OUT one (the server refuses stand_down once a match is
        // armed/live, so `st.ended` and `st.standby` should never actually coincide; this is the order
        // that stays true even if they somehow did).
        if (st.standby) return this._lobby(st, 'standby');
        // A24: the results screen is reachable twice — before OK, and again from RESULTS / HISTORY on the over screen.
        if (st.ended && this.view === 'history') return this._history(st);
        if (st.ended && (!st.endAck || this.view === 'result')) return this._result(st);
        if (!st.ended && !st.kitOpen) return this._lobby(st, 'setup');            // §4.1: MC is still picking the game
        if (!st.ended && !st.briefSeen && !this._tryoutShown(st)) return this._briefing(st);   // §4.6: read the game, then BUILD MY KIT ▸
        if (!st.ended && st.browsing && !this._tryoutShown(st)) return this._loadout(st);
        return this._lobby(st, st.ended ? 'over' : 'kitted');
      case 'lobby':
        // T2 INTEGRATION (A38 x A39): the same override the 'kitted' arm above makes, stated for the
        // one other phase a benched phone could be READ in. It should not be reachable -- `_assign`
        // pulls a benched node back to 'kitted' and `_applyConfig`'s own standby guard refuses the
        // relink re-push that is the only other way back to LOBBY -- so this is the ORDERING rule, not
        // a live path: standby is decided before F-4's lobby READY UP button (below, `mode === 'lobby'
        // && !st.kitOpen && !st.ready`) is ever considered. The two lanes landed those two facts
        // independently; whichever of the three guards is relaxed later, a player MC has taken off the
        // roster must not be shown the control that puts them back on it.
        if (st.standby) return this._lobby(st, 'standby');
        return this._lobby(st, 'lobby');
      case 'armed': return '';
      case 'live': return this._live(st);
      default: return '';
    }
  }

  _patch(st) {
    const q = id => this.hudEl.querySelector('#' + id);
    const set = (id, v) => { const el = q(id); if (el && el.textContent !== String(v)) el.textContent = v; };
    const setHtml = (id, html) => { const el = q(id); if (el && el.innerHTML !== html) el.innerHTML = html; };
    if (st.phase === 'connected' || st.phase === 'kitted' || st.phase === 'lobby') {
      // T2 INTEGRATION: a benched phone renders `_lobby(st, 'standby')` from EITHER phase, and that
      // screen prints `_statusLine(st, 'kitted')` -- so the patch has to agree, or the status line it
      // rewrites every tick contradicts the structure it was rendered into (LOCKED IN on a phone that
      // is sitting out). `readynote` does not exist on that screen; `setHtml` is null-safe.
      const mode = (st.standby && (st.phase === 'kitted' || st.phase === 'lobby')) ? 'kitted' : st.phase === 'connected' ? 'connected' : st.phase === 'lobby' ? 'lobby' : (st.ended ? 'over' : 'kitted');
      if (mode !== 'over') setHtml('mcstatus', this._statusLine(st, mode));
      // F-4: the lobby's own READY UP (kit closed, not yet ready) reads the same live note the kitted
      // screen does — `synced` is patched, never in the render signature.
      if (mode === 'kitted' || mode === 'over' || (mode === 'lobby' && !st.kitOpen && !st.ready)) setHtml('readynote', this._readyNote(st, mode));
    }
    if (st.phase === 'live') {
      set('clock', mmss(st.clockMs));
      set('hp', st.hp); set('sh', st.armor); set('mag', magText(st)); setHtml('res', this._resText(st));
      set('batt', st.battery != null ? st.battery + '%' : '—');
      setHtml('fxbar', this._fx(st));                   // S16: the poison countdown
      setHtml('aimfx', this._aimFx(st));                // S53: the smoke countdown (the slot itself is structural)
      setHtml('stunfx', this._stunFx(st));              // F15: the stun countdown
      const hb = q('hpbar'); if (hb) hb.style.width = `${hpPct(st)}%`;
      const sb = q('shbar'); if (sb) sb.style.width = `${armorPct(st, this._armPeak)}%`;
      SV.patchMeter(this.hudEl, st, this._svFx);   // the shield meter (the overshield drains first, on the same strip)
      if (st.powerup) { const hh = this._puHint(st); setHtml('puhint', hh); setHtml('puheld', this._puHeld(st));
        const nl = this.hudEl.querySelector('.nightlab'); if (nl) nl.classList.toggle('pu', !!hh);
      }   // the hint takes NIGHT OPS's slot
      const bf = q('battfill'); if (bf) bf.style.right = `${100 - (st.battery || 0)}%`;
      const pips = q('pips'); if (pips) { const html = this._pips(st); if (pips.innerHTML !== html) pips.innerHTML = html; }
      const heat = q('heat'); if (heat) {
        const pct = Math.max(0, Math.min(100, Math.round(st.heat || 0)));
        const i = heat.querySelector('i'); if (i && i.style.width !== `${pct}%`) i.style.width = `${pct}%`;
        const cls = 'heat' + (st.overheatShown ? ' hot' : ''); if (heat.className !== cls) heat.className = cls;   // the DISPLAY window, same as `_heatBar`/`_live`
      }
      set('st-K', st.kills == null ? '—' : st.kills); set('st-D', st.deaths); set('st-A', st.assists == null ? '—' : st.assists); if (accShown(st) != null) set('st-ACC', accShown(st) + '%');
      const dot = q('linkdot'); if (dot) { const cls = gunDot(st); if (dot.className !== cls) dot.className = cls; }
      set('linklab', st.bleUp ? 'GUN' : 'NO GUN');
      if (this.board) {
        set('bdage', this._boardAge(st)); const ag = q('bdage'); if (ag) ag.classList.toggle('stale', this._boardStale(st));
        // F424: the hold climbs every tick, not just on a fresh MC score push (which is what the sig
        // watches) — patch it directly so the board's own numbers do not sit stale while it is open.
        if (st.mode === 'KOTH') {
          const holdByTid = this._liveHold(st);
          for (const el of this.hudEl.querySelectorAll('.bdteam .tm.koth[data-tid]')) {
            const tid = el.dataset.tid; if (tid === '') continue;
            const b = el.querySelector('b'); const txt = mmss((holdByTid && holdByTid[tid]) || 0);
            if (b && b.textContent !== txt) b.textContent = txt;
          }
        }
      }
      const md = q('mcdot'); if (md) { const cls = 'dot ' + (st.wsState === 'bound' ? '' : 'ws'); if (md.className !== cls) md.className = cls; }
    }
  }

}

// Keep the descriptors that class methods had before the split.
for (const module of [Lobby, Loadout, Result, Live, Score, Ammo, Chips, Moments, Lanes, Diag]) {
  for (const [name, value] of Object.entries(module.methods)) {
    if (Object.prototype.hasOwnProperty.call(Hud.prototype, name)) throw new Error(`HUD method already exists: ${name}`);
    Object.defineProperty(Hud.prototype, name, { value, writable: true, configurable: true });
  }
}
