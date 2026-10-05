// Diag rendering for the phone HUD.
import { esc, discoveredRow, MC_URL_HINT } from './shared.js';
// Polish-loop pass 1+2: every join control that redials/drops the live MC link needs the armed/live
// two-tap guard (`_click` below) — `onJoinDiscovered` (an address the player never typed) and
// `onReconnectMc` (the same teardown, same button row) joined `onSetUrl`/`onScanQr` in pass 2.
const JOIN_ACT_VERB = { onScanQr: 'SCAN A NEW QR', onJoinDiscovered: 'JOIN THAT ADDRESS', onReconnectMc: 'RECONNECT', onSetUrl: 'RECONNECT' };

  /** The panel's chrome, built ONCE. F122: `renderDiag` used to replace the whole panel's innerHTML on
   *  every render (app.js pushes fresh diag data 4x/s), which did three things at once — it reset
   *  `scrollTop` to 0, it destroyed the element under the player's finger so a touch that straddled a
   *  render produced NO click at all, and it kept the action row below a growing log. The chrome and the
   *  buttons are now permanent nodes; only the readouts are rewritten, and only when they changed. */
export function _diagShell() {
    if (this._diagBuilt) return;
    this._diagBuilt = true;
    const sec = (t, id, pre) => `<h3>${t}</h3>${pre ? `<pre id="${id}"></pre>` : `<div class="kv" id="${id}"></div>`}`;
    // F156/F135/ledger#2+#31 (field 2026-09-12): SCAN QR + the typed address, reachable from every phase —
    // before, the join panel was the ONLY door, gun-first only, and once an address was held there was no
    // way back to it short of clearing app data. This is the one door now; `_lobby`'s own pre-join copy
    // (same eventual #mcurl id — `onSetUrl` reads it by that id, app.js is another lane) hides itself while
    // this one is open. This copy is built ONCE and never destroyed (F122: a rebuilt panel eats a mid-tap
    // touch), so it stays in the DOM behind `#diag{display:none}` after the panel closes — `toggleDiag`
    // above claims/releases the `mcurl` id on it (`.mcurlfield` is the stable hook) so there is never a
    // moment with the id on TWO inputs, hidden or not; `getElementById` on a genuine duplicate is
    // browser-defined, not something to lean on across Android WebView / iOS WKWebView.
    // Polish-loop pass 1 (2026-09-12): `dg-discovered` (a LAN-sweep hit MC no longer auto-joins into) and
    // `dg-mcjoinhint` (what these controls are FOR, or — armed/live only — the two-tap warning) are both
    // live-patched by `renderDiag`, never rebuilt structurally, so a tap on them is never eaten by a render.
    // Pass 3 (UX, a11y HIGH): `dg-mcjoinhint`'s text changing in place is the ONLY signal a first tap on
    // JOIN/RELINK MC/SCAN QR/CONNECT did anything while armed/live — with no live region a screen-reader
    // user hears nothing and the tap reads as dead. `role="status"`/`aria-live="assertive"` announce the
    // swap to the warning text immediately (assertive, not polite: it is safety-relevant — the second tap
    // drops the live MC link).
    const mcjoin = `<div class="mcjoin"><div class="mcjoinnote" id="dg-mcjoinnote">MISSION CONTROL</div>
        <div id="dg-discovered"></div>
        <div class="mcjoinhint" id="dg-mcjoinhint" role="status" aria-live="assertive"></div>
        <div class="mcin"><input class="mcurlfield" value="${esc(this.mcUrl)}" placeholder="${MC_URL_HINT}" inputmode="url"><button data-act="onSetUrl">CONNECT</button></div>
        <button class="qrbtn" data-act="onScanQr">▣ SCAN QR</button></div>`;
    const changeGun = !this.diagData.engine || ['idle', 'connected'].includes(this.diagData.engine.phase);
    // QA-24 (2026-09-23): ONE close control. The top ✕ duplicated CLOSE in the action row and cost the join block 30px.
    this.diag.innerHTML = `${mcjoin}
      <div class="dbody" id="dbody">
        <h3>WARNINGS</h3><div class="dgwarn" id="dg-warn">${this._warnHtml || '<span class="mut">NONE</span>'}</div>${sec('PREFLIGHT', 'dg-pf')}${sec('LINK', 'dg-link')}
        <div class="dgdev" id="dg-dev" hidden><h3>DEVELOPER</h3><div class="devrow"><span id="dg-webdebug-state" role="status" aria-live="polite"></span><button data-act="onToggleWebDebug" id="dg-webdebug" aria-describedby="dg-webdebug-state"></button></div></div>${sec('ENGINE', 'dg-eng')}${sec('TIMINGS', 'dg-tim')}
        ${sec('LAST FRAMES', 'dg-frames', true)}${sec('HISTORY', 'dg-hist')}${sec('LOG', 'dg-log', true)}
      </div>
      <div class="gunhint" id="dg-gunhint" role="status" aria-live="assertive"></div>
      <div class="btns"><button data-act="onCloseDiag" class="closex">CLOSE</button><button data-act="onChangeGun" id="dg-changegun" ${changeGun ? '' : 'disabled aria-disabled="true"'}>${changeGun ? 'CHANGE TAGGER' : 'TAGGER LOCKED'}</button><button data-act="onReconnectGun" id="dg-relinkgun">RELINK GUN</button><button data-act="onReconnectMc">RELINK MC</button><button data-act="onShareLog">SHARE LOG</button></div>`;
    // Office test 2026-09-19: the debug NIGHT button was redundant -- the ☾/☀ switch (`#skin`, top right,
    // every screen) already flips the same `onToggleNight` handler, and NIGHT OPS (config.night) sets the
    // default from Mission Control's venue on its own. Removed here, not the handler: `#skin` still calls it.
  }
export function renderDiag() {
    this._diagShell();
    const d = this.diagData || {}; const pf = d.preflight || {};
    const kv = o => Object.entries(o).map(([k, v]) => `<span>${esc(k)}</span><span class="${v === true ? 'ok' : v === false ? 'bad' : ''}">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`).join('');
    // F122 (review): read the scroll positions BEFORE the first write. A section that SHRINKS clamps the
    // scroller to its new height, so a position captured afterwards is already the clamped one and "holding
    // the reader's place" would hold the wrong place. The two <pre> scrollers need it as much as the body:
    // they are replaced wholesale ~4x/s and jumped to the top under the reader's thumb.
    const body = this.diag.querySelector('#dbody'), keep = body ? body.scrollTop : 0;
    const pres = ['dg-frames', 'dg-log'].map(id => { const el = this.diag.querySelector('#' + id); if (!el) return null;
      // "was reading the tail" — hold the BOTTOM, so a growing log keeps following; anywhere else, hold the offset.
      return { el, top: el.scrollTop, bottom: el.scrollHeight - el.clientHeight - el.scrollTop <= 4 }; }).filter(Boolean);
    const put = (id, html) => { const el = this.diag.querySelector('#' + id); if (el && el.innerHTML !== html) el.innerHTML = html; };   // an unchanged section is not touched at all
    // MISSION CONTROL join status, one line: never touches the #mcurl input itself (typing survives every push).
    const lk = d.link || {}; const mcs = lk.mc || 'none';
    put('dg-mcjoinnote', mcs === 'bound' ? `MISSION CONTROL · LINKED${lk.reach ? ' · ' + esc(String(lk.reach)).toUpperCase() : ''}`
      : mcs === 'rejected' ? 'MISSION CONTROL · REJECTED — ASK THE HOST'
      : mcs === 'connecting' || mcs === 'open' ? 'MISSION CONTROL · CONNECTING…'
      : lk.mc_url ? 'MISSION CONTROL · NOT CONNECTED' : 'MISSION CONTROL · NO ADDRESS YET — SCAN THE QR');
    // Polish-loop pass 1 (2026-09-12): the discovered-MC row, and the line above CONNECT/SCAN QR — normally
    // what they are FOR, or (armed/live, within the 4 s window `_click` opened) the two-tap warning itself.
    put('dg-discovered', discoveredRow(this.discovered));
    const confirmPending = !!(this._joinConfirm && Date.now() - this._joinConfirm.at < 4000);
    if (this._joinConfirm && !confirmPending) this._joinConfirm = null;
    put('dg-mcjoinhint', confirmPending
      ? `<span class="warn">⚠ TAP AGAIN TO ${JOIN_ACT_VERB[this._joinConfirm.act] || 'RECONNECT'} — THIS DROPS YOUR MISSION CONTROL LINK MID-MATCH</span>`
      : 'NEW MISSION CONTROL ADDRESS? (after a tunnel restart or a different host)');
    // F147-adjacent (pass 1 LOW): this input was built once from `this.mcUrl` and never rebuilt, so a QR
    // rescan (which sets `hud.mcUrl` — app.js, another lane) left the panel showing the address it replaced.
    // Only while the field is not focused — the same rule `render()`'s own `typing` guard already applies.
    // Bench 2026-09-17: RELINK GUN's LIVE confirm line, and RELINKING… (disabled) while `link.relinking`.
    const relinking = !!(d.link && d.link.relinking);
    const gunConfirm = !relinking && !!(this._gunConfirm && Date.now() - this._gunConfirm.at < 4000);
    if (this._gunConfirm && !gunConfirm) this._gunConfirm = null;
    put('dg-gunhint', gunConfirm ? '<span class="warn">RELINK TAKES THE PHONE OFF THE GUN FOR A FEW SECONDS. TAP AGAIN TO RELINK.</span>' : '');
    const rb = this.diag.querySelector('#dg-relinkgun');
    if (rb) { const label = relinking ? 'RELINKING…' : 'RELINK GUN'; if (rb.textContent !== label) rb.textContent = label; if (rb.disabled !== relinking) rb.disabled = relinking; }
    const mcInp = this.diag.querySelector('.mcurlfield');
    if (mcInp && document.activeElement !== mcInp && mcInp.value !== (this.mcUrl || '')) mcInp.value = this.mcUrl || '';
    put('dg-pf', kv(pf));
    put('dg-link', kv(d.link || {}));
    // B21: the WebView debugging switch. `webDebug` is null where there is no switch (the browser stage), so the
    // section stays hidden; 'forced' is a debuggable APK, which Chromium keeps inspectable; 'unsupported' is a real
    // switch this OS/build cannot offer (iOS below 16.4, or a native call that failed) — both disable the button.
    // The button is a permanent node and only its label changes (F122: a rebuilt button eats a tap).
    const dev = this.diag.querySelector('#dg-dev'), wd = d.webDebug;
    if (dev) {
      const show = wd === true || wd === false || wd === 'forced' || wd === 'unsupported';
      if (dev.hidden === show) dev.hidden = !show;
      if (show) {
        put('dg-webdebug-state', wd === 'forced' ? 'WEBVIEW DEBUGGING <span class="ok">ALWAYS ON (DEBUG BUILD)</span>'
          : wd === 'unsupported' ? 'WEBVIEW DEBUGGING <span class="mut">UNSUPPORTED ON THIS PHONE</span>'
          : wd ? 'WEBVIEW DEBUGGING <span class="ok">ON</span>' : 'WEBVIEW DEBUGGING <span class="mut">OFF</span>');
        const wb = this.diag.querySelector('#dg-webdebug'), label = wd === false ? 'TURN ON' : 'TURN OFF', off = wd === 'forced' || wd === 'unsupported';
        if (wb && wb.textContent !== label) wb.textContent = label;
        if (wb && wb.disabled !== off) wb.disabled = off;
      }
    }
    put('dg-eng', kv(d.engine || {}));
    put('dg-tim', kv(d.timings || {}));
    put('dg-frames', esc((d.frames || []).map(f => `${f.dir === 'tx' ? '>>' : '<<'} ${f.f}`).join('\n')));
    const all = this.history || []; const t = all.reduce((a, g) => ({ games: a.games + 1, kills: a.kills + (g.kills || 0), deaths: a.deaths + (g.deaths || 0) }), { games: 0, kills: 0, deaths: 0 });
    put('dg-hist', kv({ 'all-time on this phone': `${t.games} games · ${t.kills} K · ${t.deaths} D`, 'this MC session': this.sessionId || '(not joined)' }));
    put('dg-log', esc((d.log || []).join('\n')));
    if (body && keep && body.scrollTop !== keep) body.scrollTop = keep;   // the LOG grows under the reader's thumb; hold their place
    for (const p of pres) { const want = p.bottom ? p.el.scrollHeight - p.el.clientHeight : p.top; if (p.el.scrollTop !== want) p.el.scrollTop = want; }
  }

export const methods = { _diagShell, renderDiag };
