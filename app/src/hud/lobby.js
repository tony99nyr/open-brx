// Lobby rendering for the phone HUD.
import { MAX_TAG_LEN } from '../transport/contract.gen.js';
import { esc, OUTCOME_WORD, splitGun, discoveredRow, refusalWords, MC_URL_HINT, roleName, weaponArt, statBlock } from './shared.js';
/** F366: the phone cannot rename a gamertag, only the host can (MC's ARMORY/KIT) — this only decides whether to
 *  show the note. Measured exactly as MC's `_check_tag` does (mcp/brx_mcp/mc/state.py): trimmed, upper-cased,
 *  then a plain character count against the generated MAX_TAG_LEN. A tag this long only reaches the phone at
 *  all because it was stored before F366 (MC refuses a NEW/EDITED tag over the limit, but an older stored one
 *  up to 24 characters still plays) — so this is never a phone-side validation, only a "go ask the host" nudge. */
// H1 (review of d7a132f9): MC's `_check_tag` counts with Python `len()` — code points, not UTF-16 code
// units. `.length` on a surrogate-pair emoji counts 2, so a spread into an array of code points is the
// one that agrees with MC (`[...s].length`), same as Python's `len()` on the same string.
export const tagTooLong = raw => [...String(raw || '').trim().toUpperCase()].length > MAX_TAG_LEN;
/** App 0.4.2: the words of the picker's "Connecting to <gun>" block, from `hud.connecting`. */
export function connectingText(conn) {
  const nm = String((conn && conn.name) || 'your gun');
  // F293 polish (M3): the headset state from BrxLink's `$VERSION` probe, while the pick waits for it
  if (conn && conn.failed && conn.headset === 'not_joined') return { head: `Headset not joined to ${nm}`, line: 'Power-cycle the headset, then tap Scan again.' };
  if (conn && !conn.failed && conn.headset === 'joining') return { head: `Connecting to ${nm}…`, line: 'Headset joining the gun, about 15 s' };
  if (conn && conn.failed) return { head: `Could not connect to ${nm}`, line: 'Turn the gun off and on, then tap Scan again.' };
  // Review 2026-09-19: armed/live makes the loop retry FOREVER (BrxLink.unbounded()), past the `of` it
  // started with -- app.js sends `of: null` for that case, so the count is never printed once `attempt`
  // could run past it ("Retrying (7 of 5)…"). `Math.min` clamps it too, belt and braces, in case a caller
  // ever hands the two mismatched.
  const line = !conn || conn.attempt <= 1 ? 'Keep the gun close and switched on.'
    : conn.of ? `Retrying (${Math.min(conn.attempt, conn.of)} of ${conn.of})…` : 'Retrying…';
  return { head: `Connecting to ${nm}…`, line };
}
// F258: one picker row, built once and then written in place. The signal bars light at these dBm
// thresholds, weakest first; the heights are the design's rising staircase.
const SIG_THRESHOLDS = [-85, -75, -65, -55];
const SCAN_ROW = '<span class="nm"></span><span class="inuse" hidden>IN USE</span><span class="sig">'
  + SIG_THRESHOLDS.map((_, i) => `<i style="height:${6 + i * 4}px"></i>`).join('') + '<b></b></span>';

  // F211: with Bluetooth off the picker used to just sit empty, with no line telling the player why
  // (docs/archive/game-test-2026-09-13.md C2). `bluetoothOn` is app.js-owned (constructor note above) and re-checked
  // on every SET MY GUN tap and on the OS adapter-state notification, so this only ever shows what the
  // phone reports right now. The buttons only appear where the plugin actually offers them (Android).
export function _idleBtOff() {
    const android = this.platform === 'android';
    return `<div class="sc bad"><i></i>BLUETOOTH IS OFF</div>
      <div class="small bad" style="letter-spacing:normal;font-weight:400;line-height:1.5">Turn on Bluetooth to see nearby taggers.</div>
      ${android ? `<button class="bigbtn ghost" data-act="onEnableBluetooth"><span class="unskew">TURN ON BLUETOOTH</span></button>
      <button class="bigbtn ghost" data-act="onOpenBluetoothSettings"><span class="unskew">BLUETOOTH SETTINGS</span></button>` : ''}
      <div class="help">The list fills in on its own once Bluetooth is back on.</div>`;
  }

  // F340 (bench 2026-09-24, Android 11): with Location services off the scan found nothing and the list said
  // "No guns found". This names the cause and the one fix. app.js re-checks on the App resume event and every
  // few seconds, and starts the scan on its own once Location is on, so there is no SCAN AGAIN here.
export function _idleLocOff() {
    return `<div class="locoff"><div class="sc bad"><i></i>TURN ON LOCATION TO FIND YOUR TAGGER</div>
      <div class="locwhy">Android 11 and older need Location on for Bluetooth scanning.</div>
      <button class="bigbtn locbtn" data-act="onOpenLocationSettings"><span class="unskew">OPEN LOCATION SETTINGS</span></button>
      <div class="help">The list fills in on its own once Location is on.</div></div>`;
  }

  // F258: the picker's list is now a FIXED structure that `_patchScan` writes into — four boxes that
  // never come and go, so a row node survives every re-render and a tap can land on it.
export function _scanList() {
    return `<div class="list"><div class="taggers"></div>
      <div class="connecting" hidden><div class="cn"></div><div class="cbar"><i></i></div><div class="cst"></div></div>
      <div class="small nonefound">Scanning…</div>
      <button class="bigbtn ghost rescan" data-act="onScanAgain" hidden><span class="unskew">SCAN AGAIN</span></button>
      <button class="othertog" data-act="onScanOther" hidden><span class="unskew"></span></button>
      <div class="others" hidden></div></div>`;
  }

  // F422 (bench 2026-09-26, 11.7): MC can bind this phone before the gun is ever picked (an mDNS
  // auto-join over Wi-Fi, no tap needed — `app.js`'s boot sweep) and the SET MY GUN screen said nothing
  // about it: "no idea, no indication" (Tony). `this.sync.bound` (app.js, the same 1 s poll the results
  // screen's SENDING SCORES line already reads) is the one fact this screen can show with no new wiring;
  // both states are shown, never just the good one, so a phone that has NOT joined says so too.
export function _idleMcLine() {
    const bound = !!(this.sync && this.sync.bound);
    return `<span class="mcline ${bound ? 'on' : ''}"><i class="dot ${bound ? '' : 'off'}"></i>${bound ? 'MC JOINED' : 'MC NOT JOINED'}</span>`;
  }
export function _idle(st = {}) {
    return `<div class="idle"><div class="scan"></div>
      <div class="l"><span class="wm">BRX<b>/</b></span><span class="sub">COMBAT HUD</span>
        ${this._idleMcLine()}
        ${st.rejoin ? '<span class="note" style="color:var(--warn)">MATCH IN PROGRESS — SET YOUR GUN TO REJOIN</span>' : ''}
        <button class="bigbtn" data-act="onSetGun"><span class="unskew">SET MY GUN ▸</span></button>
        <button class="bigbtn ghost" data-act="onDemo"><span class="unskew">DESKTOP DEMO</span></button>
        <button class="bigbtn ghost util" data-act="onUtility"><span class="unskew">▣ UTILITY MODE</span></button></div>
      <div class="r">${this.bluetoothOn === false ? this._idleBtOff() : this.locationOn === false ? this._idleLocOff() :
        `<div class="sc"><i></i>SCANNING FOR TAGGERS</div>${this._scanList()}
        <div class="help">Tagger not listed? Power-cycle it — it'll appear within a couple seconds.</div>`}</div></div>`;
  }

  /** F258 (bench 2026-09-18): a scan hit must never destroy a row. This reconciles the picker's DOM
   *  against `this.scan` — it writes the signal reading into the row that is already on screen, adds
   *  the rows that are new, and moves a row only when its order genuinely changed. Rows the picker
   *  ranked as `other` (neither the assigned gun, nor a Nordic UART advert, nor a tagger-shaped name)
   *  go behind a fold, so a muster does not put a player's own gun at position 12 behind two
   *  televisions and a Hatch Rest. */
export function _patchScan() {
    const list = this.hudEl.querySelector('.idle .list'); if (!list) return;
    const main = list.querySelector('.taggers'), other = list.querySelector('.others');
    const tog = list.querySelector('.othertog'), none = list.querySelector('.nonefound');
    if (!main || !other || !tog || !none) return;
    // App 0.4.2: while a picked gun connects, the rows give way to one "Connecting to <gun>" block.
    const conn = this.connecting, cbox = list.querySelector('.connecting');
    const near = conn ? [] : this.scan.filter(d => !d.other), far = conn ? [] : this.scan.filter(d => d.other);
    this._patchScanRows(main, near);
    this._patchScanRows(other, far);
    if (cbox) {
      if (cbox.hidden !== !conn) cbox.hidden = !conn;
      if (conn) {
        const cn = cbox.querySelector('.cn'), cst = cbox.querySelector('.cst');
        const { head, line } = connectingText(conn);
        if (cn.textContent !== head) cn.textContent = head;
        if (cst.textContent !== line) cst.textContent = line;
        const cls = conn.failed ? 'connecting bad' : 'connecting';
        if (cbox.className !== cls) cbox.className = cls;
      }
    }
    const hideNone = near.length > 0 || !!conn;
    if (none.hidden !== hideNone) none.hidden = hideNone;
    // Game day 2026-09-19: the list showed empty with no scan running, and nothing said so. Now an empty
    // list says whether a scan runs, and always offers SCAN AGAIN.
    const noneTxt = this.scanActive ? 'Scanning…' : 'No guns found. Turn the gun on, then tap Scan again.';
    if (none.textContent !== noneTxt) none.textContent = noneTxt;
    const rescan = list.querySelector('.rescan');
    const hideRescan = conn ? !conn.failed : hideNone;   // a failed connect offers SCAN AGAIN; a running one does not
    if (rescan && rescan.hidden !== hideRescan) rescan.hidden = hideRescan;
    const sc = this.hudEl.querySelector('.idle .sc'), scOn = this.scanActive && !conn;
    if (sc && sc.hidden === scOn) sc.hidden = !scOn;
    if (tog.hidden !== (far.length === 0)) tog.hidden = far.length === 0;
    const lab = `${this.scanOther ? '▾' : '▸'} OTHER DEVICES (${far.length})`;
    const span = tog.firstElementChild;
    if (span && span.textContent !== lab) span.textContent = lab;
    if (other.hidden === this.scanOther) other.hidden = !this.scanOther;
  }

  /** Reconciles one box's `.tagrow` children against `rows`, keyed on `deviceId`. */
export function _patchScanRows(box, rows) {
    const have = new Map();
    for (const el of box.children) if (el.dataset && el.dataset.arg) have.set(el.dataset.arg, el);
    let prev = null;
    for (const d of rows) {
      let el = have.get(d.deviceId);
      if (el) have.delete(d.deviceId);
      else {
        el = this.root.createElement('div');
        el.className = 'tagrow'; el.dataset.act = 'onPick'; el.dataset.arg = d.deviceId;
        el.innerHTML = SCAN_ROW;
      }
      this._writeScanRow(el, d);
      const want = prev ? prev.nextElementSibling : box.firstElementChild;
      if (want !== el) box.insertBefore(el, want);   // only a REAL order change moves a node
      prev = el;
    }
    for (const el of have.values()) el.remove();
  }

  /** Writes one row's visible facts, touching only what actually changed. */
export function _writeScanRow(el, d) {
    const [nm, tail] = splitGun(d);
    // Office test 2026-09-19: the picker repaints every PAINT_MS while a scan runs (gunpicker.js), and a
    // touch's press class (`tap-press`, set by `_tapDown` on pointerdown) can land inside that same window.
    // Setting `className` outright used to wipe it before the browser ever painted it -- a tap straddling a
    // repaint tick showed no press animation at all. `classList.toggle` leaves any class this method does
    // not own alone.
    if (el.classList.contains('used') !== !!d.inUse) el.classList.toggle('used', !!d.inUse);
    const name = el.querySelector('.nm'), html = `${nm}<b>-${tail}</b>`;
    if (name && name.innerHTML !== html) name.innerHTML = html;
    const inuse = el.querySelector('.inuse'), sig = el.querySelector('.sig');
    if (inuse && inuse.hidden !== !d.inUse) inuse.hidden = !d.inUse;
    if (sig && sig.hidden !== !!d.inUse) sig.hidden = !!d.inUse;
    if (!sig) return;
    const bars = sig.querySelectorAll('i');
    SIG_THRESHOLDS.forEach((thr, i) => {
      const on = d.rssi != null && d.rssi >= thr ? 'on' : '';
      if (bars[i] && bars[i].className !== on) bars[i].className = on;
    });
    const num = sig.querySelector('b'), txt = d.rssi != null ? String(d.rssi) : '';
    if (num && num.textContent !== txt) num.textContent = txt;
  }

export function _lobby(st, mode) {
    const [nm, tail] = splitGun(st.gun);
    // QA-13 (2026-09-23): LINKED read as "joined" beside a CONNECTING… line. Before MC binds, the gun is set and nothing more.
    const cs = esc(st.callsign || (mode === 'connected' ? (st.wsState === 'bound' ? 'LINKED' : 'GUN SET') : 'OPERATOR'));
    // F366: an older stored tag can run past MAX_TAG_LEN (MC refuses a new/edited one, but a stored longer tag
    // still plays) — the phone cannot rename it, so this is a nudge to ask the host, never a validation error.
    // `_lobby` is the pre-game/lobby/kit screen only (never live/armed — render() sends those elsewhere).
    // M1 (review of d7a132f9): `mode === 'standby'` is that SAME screen while this player sits benched —
    // MC refuses to arm/live a benched player, but a match is genuinely running for everyone else, so the
    // nudge stays off there too.
    const tagWarn = mode !== 'standby' && tagTooLong(st.callsign) ? `<div class="tagwarn">YOUR TAG IS OVER ${MAX_TAG_LEN} LETTERS · ASK THE HOST TO SHORTEN IT</div>` : '';
    const team = st.teamName ? `<span class="chip"><span class="unskew">${esc(st.teamName)} SQUAD</span></span>` : '';
    const tw = this._tryoutShown(st) ? st.tutorialWeapon : null;
    // MC pushes a WeaponView here (it carries the ranked `bars`), which names the magazine `clip`;
    // older servers push the raw catalog row, where it is `stats.mag`. Accept both.
    const twStats = tw && tw.stats ? tw.stats : (tw || {});
    const twMag = [twStats.mag, tw && tw.clip, tw && tw.mag].find(v => v != null);
    const twRes = [twStats.reserve, tw && tw.reserve].find(v => v != null);
    const bar = (label, v) => v == null ? '' : `<div class="tb"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"></b></i></div>`;
    const tryout = tw ? `<div class="tryout">
        <div class="art">${weaponArt(tw.weapon_id)}</div>
        <div class="meta"><div class="lbl">TRY-OUT · FIRE A FEW ROUNDS</div><div class="nm">${esc((tw.name || tw.weapon_id || '').toUpperCase())}</div>
          <div class="ln">MAG ${twMag != null ? twMag : '—'} · RESERVE ${twRes != null ? twRes : '—'}${tw.role ? ' · ' + esc(roleName(tw)) : ''}</div>
          ${statBlock(tw, { compact: true })}</div>
        <div class="tact"><button class="lobtn ghost" data-act="onTryDone"><span class="unskew">DONE</span></button><div class="small">Keeps the gun armed with this weapon.</div></div></div>` : '';
    // Ammo is unknown until the game is pushed/armed — say so in words instead of showing "MAG — · RESERVE —".
    const _mag = st.loadMag != null ? st.loadMag : (st.mag != null ? st.mag : null);
    const _res = st.loadReserve != null ? st.loadReserve : (st.reserve != null ? st.reserve : null);
    const ammoLine = (_mag == null && _res == null) ? 'SET AT ARM TIME'
      : `<span class="nw">MAG ${_mag != null ? _mag : '—'} · RES ${_res != null ? _res : '—'}</span>`;   // one line, never a dangling separator (breaker 2026-09-03); RES: the A14 plate is 250px
    // A14: three plates — PRIMARY / SECONDARY / PERK; HP · ARMOR moved up into the header line
    const plates = st.player && mode !== 'setup' ? `${tryout}<div class="plates" ${tw ? 'style="display:none"' : ''}>
        ${this._slotPlate(st, 'primary', mode, ammoLine)}${this._slotPlate(st, 'secondary', mode)}${this._slotPlate(st, 'perk', mode)}
        ${mode === 'kitted' && !tw && (st.canPickPrimary || st.canPickSecondary || st.canPickPerk) ? '<div class="platehint">TAP A SLOT TO CHANGE YOUR LOADOUT</div>' : ''}</div>` : '';
    const hpar = st.player && mode !== 'setup' ? `<span class="hpar tab">${[`<span style="color:var(--health)">HP ${st.maxHp}</span>`, st.maxArmor > 0 ? `<span style="color:var(--armor)">ARMOR ${st.maxArmor}</span>` : '',
      st.maxShield > 0 ? `<span style="color:var(--shield)">SHIELD ${st.maxShield}</span>` : '', st.playerNum ? `#${st.playerNum}` : ''].filter(Boolean).join(' · ')}</span>` : '';
    // A27/A30 (loadout.md §4.4): a host advance that lands mid-kit is never a silent screen swap, and a refusal
    // from MC is MC's own copy — shown VERBATIM on whichever screen the player is standing on when it arrives.
    const refusal = st.loadoutAck && !st.loadoutAck.ok && st.loadoutAck.reason ? String(st.loadoutAck.reason) : null;
    const lead = (mode === 'kitted' || mode === 'lobby') && (refusal || st.kitLocked)
      ? `<div class="kitlock">${refusal ? esc(refusal.toUpperCase()) : 'THE HOST LOCKED KITS — you play what you had'}</div>` : '';
    let foot, status;
    // QA-08 (2026-09-23): MC turned this phone away. A READY UP that MC will never hear is disabled; the note says why.
    const refused = st.wsState === 'rejected' ? ' disabled aria-disabled="true"' : '';
    // F156/F135 (field 2026-09-12): the join controls now also live in the ⓘ panel (`_diagShell`), reachable
    // from every phase — same `#mcurl` id, so this copy steps aside rather than duplicate it while that
    // panel is open (`onSetUrl` reads the input by id; app.js is another lane, so there can only be one).
    const diagHasJoin = this.diag.classList.contains('open');
    if (mode === 'connected') {
      foot = st.wsState === 'bound'
        ? `<div class="mclinked"><span class="unskew">MC LINKED ✓ — WAITING FOR KIT-OUT</span></div><div class="note">Mission Control has this gun. Your callsign and loadout arrive with the kit.</div>`
        : diagHasJoin
        ? `<div class="note join">Connecting from the ⓘ panel, top right — it's already open.</div>`
        // Polish-loop pass 2: mDNS no longer auto-joins (app.js review pass 2 — a phone must never hand its
        // takeover key/join secret to whoever answers first), so "it connects by itself" was now FALSE.
        : `${discoveredRow(this.discovered)}<div class="mcin"><input id="mcurl" value="${esc(this.mcUrl)}" placeholder="${MC_URL_HINT}" inputmode="url"><button data-act="onSetUrl">CONNECT</button></div><button class="qrbtn" data-act="onScanQr">▣ SCAN QR</button><div class="note join">Scan the host's QR, or type its address and tap CONNECT. On the same Wi-Fi the host can also show up here: ${this.discovered ? 'tap its row above' : 'tap its row when it appears'}.</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    } else if (mode === 'setup') {
      // §4.1: calm, not an error — the host hasn't picked the game yet
      foot = `<div class="setup"><div class="pulse"><i></i><i></i><i></i></div><div class="in"><div class="t">HOST IS SETTING UP THE GAME</div><div class="s">Your kit opens as soon as the host picks the game. Nothing to do yet.</div></div></div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, 'kitted')}</div>`;
    } else if (mode === 'standby') {
      // T2-B item 2: MC benched this player. Calm, not an error, same shape as `setup` above.
      foot = `<div class="setup"><div class="pulse"><i></i><i></i><i></i></div><div class="in"><div class="t">SITTING OUT — the host puts you back</div><div class="s">Nothing to do for now. Your tagger is STILL LIVE — it can fire, and it can be tagged. The host puts you back in.</div></div></div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, 'kitted')}</div>`;
    } else if (mode === 'kitted') {
      // Bench 2026-09-16: "only the label changes" — `st.ready` already IS the confirmed state (a tap
      // only sets it once `setReady` clears the standby/phase/clock-sync guards, engine.js), so the
      // green treatment below tracks the same flag; `aria-pressed` says so explicitly, for a11y and so
      // a test can read the confirmed state without parsing a colour.
      foot = `${lead}<button class="ready ${st.ready ? '' : 'off'}" data-act="onReady" aria-pressed="${!!st.ready}"${refused}><span class="unskew">${st.ready ? 'READY ✓' : 'READY UP'}</span></button><div class="note" id="readynote">${this._readyNote(st)}</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>${st.game ? '<button class="briefbtn" data-act="onBriefing"><span class="unskew">▤ BRIEFING</span></button>' : ''}`;
    } else if (mode === 'over') {
      // F117: this is the one control gating the next match and it read as a status line — declarative label,
      // muted grey, 20px against the pre-match 26px, and the SAME classes as the genuinely inert STANDING BY
      // button. It now wears the pre-match READY UP treatment exactly, and the note leads with the instruction.
      // The note is `_readyNote`, the same one the kitted screen renders and patches: `setReady` REFUSES while
      // the clock is unsynced, and the hard-coded note said nothing about it — the one control gating the next
      // match went dead with no explanation on screen.
      foot = `<button class="ready ${st.ready ? '' : 'off'}" data-act="onReady" aria-pressed="${!!st.ready}"><span class="unskew">${st.ready ? 'READY ✓' : 'READY FOR NEXT MATCH ▸'}</span></button><div class="note" id="readynote">${this._readyNote(st, 'over')}</div>`;
      // A24 (game test D3: "let players get back to results after OK · maybe a match history"). The outcome word
      // is printed here ONLY out of `st.result` — with no result the line simply does not carry one.
      const rw = st.result ? (OUTCOME_WORD[st.result.outcome] || null) : null;
      status = `<div class="status">${rw ? `<b class="oc ${esc(String(st.result.outcome))}">${rw}</b> · ` : ''}D ${st.deaths} · K ${st.kills != null ? st.kills : '—'}</div>` +
        `<div class="overbtns"><button class="briefbtn" data-act="onShowResults"><span class="unskew">▣ RESULTS</span></button>` +
        `<button class="briefbtn" data-act="onShowHistory"><span class="unskew">▤ HISTORY</span></button></div>`;
    } else if (mode === 'lobby' && !st.kitOpen && !st.ready) {
      // F-4 (2026-09-13): `engine.setReady` now accepts a lobby tap once the kit is closed — for a
      // player whose kit-out window ended (a push or re-push that landed) before they ever hit READY
      // UP, this is the only door left. Same control, same note the kitted screen uses; a player who
      // is already `ready` still reads STANDING BY below, unchanged.
      foot = `${lead}<button class="ready off" data-act="onReady" aria-pressed="false"${refused}><span class="unskew">READY UP</span></button><div class="note" id="readynote">${this._readyNote(st)}</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    } else {
      // Bench 2026-09-16: a READY player in the lobby fell through to this grey STANDING BY button, so readying
      // up only changed the label. A confirmed `st.ready` now wears the green `.ready.wait.on` and says READY.
      // Playtest review 2026-09-13: this button has no `data-act` -- it does nothing on tap -- but it still got
      // `.tap-press` feedback (the delegated handler matches any `<button>`) and `aria-pressed`, so it looked and
      // was announced as a toggle. `aria-disabled="true"` makes the press handler skip it (it already checks
      // this attribute); drop `aria-pressed` since it is not a control. The green `.on` ready state stays.
      foot = `${lead}<button class="ready wait${st.ready ? ' on' : ''}" aria-disabled="true"><span class="unskew">${st.ready ? 'READY ✓ · STANDING BY' : 'STANDING BY'}</span></button><div class="note">${st.kitLocked ? 'The plates above are what you take in. Waiting for the host to start the countdown.' : 'Loadout is on the gun. Waiting for the host to start the countdown.'}</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    }
    return `<div class="lobby"><div class="scan"></div><div class="edgeglow"></div>
      <div class="top"><span class="cs">${cs}</span><span class="row">${team}<span class="gid">${nm}-${tail}</span>${hpar}</span></div>${tagWarn}${plates}
      <div class="tr">${status}</div><div class="foot">${foot}</div></div>`;
  }

export function _statusLine(st, mode) {
    // Player-facing wording; the raw wsState / synced / headEcho / arm_state stay in the diag panel (LINK/ENGINE).
    // QA-08/QA-13 (2026-09-23): a refusal is NOT JOINED (red) and nothing else — no clock claim beside it; a link
    // still in progress is amber, not the error red; a pre-join phone with no address yet is not "connecting".
    const ws = st.wsState;
    if (ws === 'rejected') return mode === 'connected' ? 'GUN <b>CONNECTED ✓</b> · <span class="bad">NOT JOINED</span>' : '<span class="bad">NOT JOINED</span>';
    const mc = ws === 'bound' ? '<b>HOST ✓</b>' : mode === 'connected' && !this.mcUrl ? '<span class="prog">NOT JOINED YET</span>' : '<span class="prog">CONNECTING…</span>';
    const clock = st.synced ? '<b>IN SYNC ✓</b>' : '<span class="prog">SYNCING…</span>';
    if (mode === 'connected') return `GUN <b>CONNECTED ✓</b> · ${mc}`;
    if (mode === 'lobby') return `<b>LOCKED IN ✓</b>${st.headEcho ? '' : ' · <span class="bad">GUN NOT ANSWERING — CHECK HEADSET</span>'} · ${clock}`;
    return `${st.tutorial ? '<span style="color:var(--warn)">TRY-OUT ARMED — FIRE A FEW ROUNDS</span><br>' : ''}${mc} · ${clock}`;
  }
  /** The line under the READY button. The UNSYNCED case is shared by both screens because `engine.setReady`
   *  refuses the tap until the clock is synced — on either of them, and silently. */
export function _readyNote(st, mode) {
    if (st.wsState === 'rejected' && mode !== 'over') {
      const why = refusalWords(st.wsReason);
      return `Mission Control turned this phone away${why ? ': ' + why : ''}. Ask the host, then rejoin from the i button, top right.`;
    }
    if (!st.synced && !st.ready) return 'Syncing clock with Mission Control… you can ready up in a moment.';
    // HUD QA R2-05: READY UP stays live (a headset that never joins must not strand a player out of the match), but
    // the note says what it costs and what fixes it, beside the button the player is about to tap.
    if (st.headsetJoin && st.headsetJoin.state === 'not_joined' && mode !== 'over')
      return '<span class="warnnote">Headset not joined: you cannot be hit until it joins.</span> Power-cycle it, then tap RECONNECT NOW.';
    // NOT "the host cannot start until everyone has": `_all_ready` gates KIT -> LOBBY only, so after a
    // match the host pushes the next one whenever they like. Promising a veto the player does not have is
    // how someone sits out a round waiting to be waited for (review 2026-09-12).
    if (mode === 'over') return st.ready ? 'Standing by — the next match kits you automatically.'
      : 'Tap to ready up for the next match — the host sees who is ready. Scores reconcile at Mission Control.';
    return st.ready ? 'Waiting for the host to arm the match. Tap again to un-ready.'
      : 'Tap when you are set. The host pushes the game once everyone is ready.';
  }

export const methods = { _idleBtOff, _idleLocOff, _scanList, _idleMcLine, _idle, _patchScan, _patchScanRows, _writeScanRow, _lobby, _statusLine, _readyNote };
