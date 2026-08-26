// Phone HUD v2 renderer — a pure function of engine state (node.md §4). Landscape 844×390, scaled to
// the viewport. Structure re-renders only when the state "signature" changes; live numbers patch in
// place so CSS animations don't restart every tick. Moments (T-MINUS, KILL, DOWN, REDEPLOY) live in
// #overlay so they animate independently of the base HUD.

const TEAM_COLOR = { blue: 'var(--team-blue)', yellow: 'var(--team-yellow)', red: 'var(--team-red)', green: 'var(--team-green)' };
const TEAM_INK = { blue: '#04121e', yellow: '#1a1400', red: '#1a0404', green: '#041a0c' };
const pad2 = n => String(Math.max(0, Math.floor(n))).padStart(2, '0');
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad2(s / 60)}:${pad2(s % 60)}`; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const splitGun = g => { if (!g) return ['—', '']; return [esc(g.basename || g.name || ''), esc(g.tail || '')]; };

export class Hud {
  constructor(root, handlers = {}) {
    this.root = root; this.h = handlers;
    this.frame = root.querySelector('#frame'); this.hudEl = root.querySelector('#hud');
    this.overlay = root.querySelector('#overlay'); this.chips = root.querySelector('#chips');
    this.diag = root.querySelector('#diag'); this.info = root.querySelector('#info');
    this.sig = null; this.scan = []; this.link = {}; this.diagData = {}; this.cam = false; this.mcUrl = '';
    this._moment = null; this._momentTimer = null; this._lastTminus = null;
    this.info.addEventListener('click', () => this.toggleDiag());
    this.hudEl.addEventListener('click', e => this._click(e));
    this.diag.addEventListener('click', e => this._click(e));
    let pressT = null;
    this.hudEl.addEventListener('pointerdown', () => { pressT = setTimeout(() => { pressT = null; this.h.onToggleNight && this.h.onToggleNight(); }, 900); });
    this.hudEl.addEventListener('pointerup', () => { if (pressT) clearTimeout(pressT); pressT = null; });
    this.hudEl.addEventListener('pointerleave', () => { if (pressT) clearTimeout(pressT); pressT = null; });
    window.addEventListener('resize', () => this.fit()); this.fit();
  }
  fit() {
    const w = window.innerWidth, h = window.innerHeight;
    const s = Math.min(w / 844, h / 390);
    this.frame.style.transform = `scale(${s})`;
  }
  _click(e) {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, arg = el.dataset.arg;
    const fn = this.h[act]; if (fn) fn(arg, el);
  }
  setScan(list) { this.scan = list; this.sig = null; }
  setLink(link) { this.link = link; }
  setDiag(d) { this.diagData = d; if (this.diag.classList.contains('open')) this.renderDiag(); }
  setCam(on) { this.cam = !!on; this.frame.classList.toggle('cam', this.cam); }
  toggleDiag() { this.diag.classList.toggle('open'); if (this.diag.classList.contains('open')) this.renderDiag(); }

  render(st) {
    this.frame.dataset.team = st.teamKey || 'blue';
    this.frame.dataset.env = st.night ? 'night' : '';
    const sig = [st.phase, st.alive, !!st.killedBy, st.night, this.cam, st.ready, st.tutorial, !!st.resync, st.callsign, st.teamKey, st.weapon, st.endAck, st.ended, st.kills, st.tutorialWeapon && st.tutorialWeapon.weapon_id,
      st.mode, st.gun && st.gun.name, st.hp <= st.maxHp * .25, (st.mag ? st.ammo / st.mag : 1) <= .15, st.ammo === 0, st.battery != null && st.battery <= 15,
      st.kills != null, st.assists != null, st.accuracy != null, st.reserve != null, this.scan.length, st.bleUp, st.ended,
      st.rejoin, !!st.pendingTeardown].join('|');   // wsState / synced / headEcho are patched in place (never rebuild while typing the MC URL)
    if (sig !== this.sig) {
      const urlEl = this.hudEl.querySelector('#mcurl');
      const typing = urlEl && typeof document !== 'undefined' && document.activeElement === urlEl;
      if (!typing) {
        const lst = this.hudEl.querySelector('.list'); const keep = lst ? lst.scrollTop : 0;   // keep the picker's scroll across re-renders
        this.sig = sig; this.hudEl.innerHTML = this._structure(st);
        if (keep) { const l2 = this.hudEl.querySelector('.list'); if (l2) l2.scrollTop = keep; }
      }
    }
    this._patch(st);
    this._chips(st);
    this._moments(st);
  }

  // ---------- structure per phase ----------
  _structure(st) {
    switch (st.phase) {
      case 'idle': return this._idle(st);
      case 'connected': return this._lobby(st, 'connected');
      case 'kitted': return st.ended && !st.endAck ? this._result(st) : this._lobby(st, st.ended ? 'over' : 'kitted');
      case 'lobby': return this._lobby(st, 'lobby');
      case 'armed': return '';
      case 'live': return this._live(st);
      default: return '';
    }
  }

  _idle(st = {}) {
    const rows = this.scan.map(d => {
      const [nm, tail] = splitGun(d);
      const bars = [-85, -75, -65, -55].map((thr, i) => `<i style="height:${6 + i * 4}px" class="${d.rssi != null && d.rssi >= thr ? 'on' : ''}"></i>`).join('');
      return `<div class="tagrow ${d.inUse ? 'used' : ''}" data-act="onPick" data-arg="${esc(d.deviceId)}"><span class="nm">${nm}<b>-${tail}</b></span>` +
        (d.inUse ? `<span class="inuse">IN USE</span>` : `<span class="sig">${bars}<b>${d.rssi != null ? d.rssi : ''}</b></span>`) + `</div>`;
    }).join('');
    return `<div class="idle"><div class="scan"></div>
      <div class="l"><span class="wm">BRX<b>/</b></span><span class="sub">COMBAT HUD</span>
        ${st.rejoin ? '<span class="note" style="color:var(--warn)">MATCH IN PROGRESS — SET YOUR GUN TO REJOIN</span>' : ''}
        <button class="bigbtn" data-act="onSetGun"><span class="unskew">SET MY GUN ▸</span></button>
        <button class="bigbtn ghost" data-act="onDemo"><span class="unskew">DESKTOP DEMO</span></button></div>
      <div class="r"><div class="sc"><i></i>SCANNING FOR TAGGERS</div><div class="list">${rows || '<div class="small">no taggers yet…</div>'}</div>
        <div class="help">Tagger not listed? Power-cycle it — it'll appear within a couple seconds.</div></div></div>`;
  }

  _lobby(st, mode) {
    const [nm, tail] = splitGun(st.gun);
    const cs = esc(st.callsign || (mode === 'connected' ? 'LINKED' : 'OPERATOR'));
    const team = st.teamName ? `<span class="chip"><span class="unskew">${esc(st.teamName)} SQUAD</span></span>` : '';
    const tw = st.tutorial && st.tutorialWeapon ? st.tutorialWeapon : null;
    const twStats = tw && tw.stats ? tw.stats : (tw || {});
    const bar = (label, v) => v == null ? '' : `<div class="tb"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"></b></i></div>`;
    const tryout = tw ? `<div class="tryout">
        <div class="art" style="background-image:url('assets/weapons/${esc(tw.weapon_id)}.jpg')"></div>
        <div class="meta"><div class="lbl">TRY-OUT · FIRE A FEW ROUNDS</div><div class="nm">${esc((tw.name || tw.weapon_id || '').toUpperCase())}</div>
          <div class="ln">MAG ${twStats.mag != null ? twStats.mag : (tw.mag != null ? tw.mag : '—')} · RESERVE ${twStats.reserve != null ? twStats.reserve : (tw.reserve != null ? tw.reserve : '—')}${tw.cls ? ' · CLASS ' + esc(String(tw.cls)) : ''}</div>
          ${bar('DMG', twStats.dmg)}${bar('ROF', twStats.rof != null ? twStats.rof : twStats.rpm)}${bar('RNG', twStats.rng)}</div></div>` : '';
    const plates = st.player ? `${tryout}<div class="plates" ${tw ? 'style="display:none"' : ''}>
        <div class="plate wart"><div class="thumb" style="background-image:url('assets/weapons/${esc(st.weaponId || '')}.jpg')"></div><div class="in"><div class="h">${esc(st.weapon)}</div><div class="s">MAG ${st.loadMag != null ? st.loadMag : (st.mag != null ? st.mag : '—')} · RESERVE ${st.loadReserve != null ? st.loadReserve : (st.reserve != null ? st.reserve : '—')}</div></div></div>
        <div class="plate"><div class="in"><div class="h tab"><span style="color:var(--health)">${st.maxHp}</span> · <span style="color:var(--armor)">${st.maxArmor}</span></div><div class="s">${esc(st.mode || 'TDM')} LOADOUT${st.playerNum ? ' · #' + st.playerNum : ''}</div></div></div></div>` : '';
    let foot, status;
    if (mode === 'connected') {
      foot = st.wsState === 'bound'
        ? `<div class="mclinked"><span class="unskew">MC LINKED ✓ — WAITING FOR KIT-OUT</span></div><div class="note">Mission Control has this gun. Your callsign and loadout arrive with the kit.</div>`
        : `<div class="mcin"><input id="mcurl" value="${esc(this.mcUrl)}" placeholder="ws://mission-control-ip:8766/ws" inputmode="url"><button data-act="onSetUrl">CONNECT</button></div><div class="note">Waiting for kit-out from Mission Control. Scan the QR on the MC screen or type its address.</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    } else if (mode === 'kitted') {
      foot = `<button class="ready ${st.ready ? '' : 'off'}" data-act="onReady"><span class="unskew">${st.ready ? 'READY ✓' : 'READY UP'}</span></button><div class="note" id="readynote">${this._readyNote(st)}</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    } else if (mode === 'over') {
      foot = `<button class="ready wait" data-act="onReady"><span class="unskew">MATCH COMPLETE — READY FOR NEXT</span></button><div class="note">Scores reconcile at Mission Control. Tap when you're set for the next match.</div>`;
      status = `<div class="status">D ${st.deaths} · K ${st.kills != null ? st.kills : '—'}</div>`;
    } else {
      foot = `<button class="ready wait"><span class="unskew">STANDING BY</span></button><div class="note">Loadout is on the gun. Waiting for the host to start the countdown.</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    }
    return `<div class="lobby"><div class="scan"></div><div class="edgeglow"></div>
      <div class="top"><span class="cs">${cs}</span><span class="row">${team}<span class="gid">${nm}-${tail}</span></span></div>${plates}
      <div class="tr">${status}</div><div class="foot">${foot}</div></div>`;
  }

  /** End-of-match result: banner + this player's line, OK -> the 'over' screen (bench request 2026-08-25). */
  _result(st) {
    const v = (x, suf = '') => x == null ? '—' : x + suf;
    const hist = this.history || [];
    const tot = hist.reduce((a, g) => ({ g: a.g + 1, k: a.k + (g.kills || 0), d: a.d + (g.deaths || 0) }), { g: 0, k: 0, d: 0 });
    const sess = tot.g > 1 ? `<div class="sess">TONIGHT · ${tot.g} GAMES · ${tot.k} KILLS · ${tot.d} DEATHS</div>` : '';
    return `<div class="lobby result"><div class="scan"></div><div class="edgeglow"></div>
      <div class="banner"><span class="unskew">GAME OVER</span></div>
      <div class="rstats">
        <div class="cell"><b>${v(st.kills)}</b><span>KILLS${st.kills != null ? ' ✓MC' : ''}</span></div>
        <div class="cell"><b>${v(st.deaths)}</b><span>DEATHS</span></div>
        <div class="cell"><b>${v(st.assists)}</b><span>ASSISTS</span></div>
        <div class="cell"><b>${v(st.accuracy == null ? null : Math.round(st.accuracy * 100), '%')}</b><span>ACCURACY</span></div>
        <div class="cell"><b>${st.shots != null ? st.shots : '—'}</b><span>SHOTS</span></div>
      </div>${sess}
      <div class="foot"><button class="ready" data-act="onEndOk"><span class="unskew">OK</span></button>
      <div class="note">Scores reconcile at Mission Control when you're back in range.</div></div></div>`;
  }

  _live(st) {
    const low = st.hp <= st.maxHp * .25 && st.alive;
    // only nag when genuinely low: live+alive, mag known, not a fresh mag (it blinked constantly on the bench)
    const lowMag = !!(st.alive && st.mag && st.ammo < st.mag && st.ammo / st.mag <= .15);
    const [nm] = splitGun(st.gun);
    const stat = (k, v, mc) => `<span>${k} <b class="${v == null ? 'mut' : ''}" id="st-${k}">${v == null ? '—' : v}</b>${mc && v != null ? '<b class="mc"> ✓MC</b>' : ''}</span>`;
    const kb = st.killedBy ? `` : '';
    return `<div class="alive"><div class="scan"></div><div class="edgeglow"></div><div class="strip l"></div><div class="strip r"></div>
      <div class="scrim-t"></div><div class="scrim-b"></div>
      ${low ? '<div class="firevig"></div>' : ''}
      <div class="clockplate"><div class="in"><span class="t tab" id="clock">${mmss(st.clockMs)}</span><span class="m">${esc(st.mode)}</span></div></div>
      <div class="ident"><span class="arrow"></span><span class="cs">${esc(st.callsign || nm)}</span><span class="sq">${esc(st.teamName)} SQUAD</span></div>
      <div class="topright"><span class="link"><span id="linkdot" class="dot ${st.bleUp ? (st.wsState === 'bound' ? '' : 'ws') : 'off'}"></span>${st.bleUp ? 'LINK' : 'NO GUN'}</span>
        <span class="batt tab"><span class="shell"><span class="fill" id="battfill" style="right:${100 - (st.battery || 0)}%"></span></span><span id="batt">${st.battery != null ? st.battery + '%' : '—'}</span></span>
        <button class="camchip ${this.cam ? 'on' : ''}" data-act="onToggleCam"><span class="unskew10">◉ CAM${this.cam ? ' ON' : ''}</span></button></div>
      ${st.battery != null && st.battery <= 15 ? `<div class="battwarn">GUN BATT ${st.battery}% — CHARGE SOON</div>` : ''}
      <div class="stats tab">${stat('K', st.kills, true)}${stat('D', st.deaths)}${stat('A', st.assists, true)}${stat('ACC', st.accuracy == null ? null : Math.round(st.accuracy * 100) + '%', true)}</div>
      ${low ? '<div class="takingfire"><span class="r"></span><span class="t">TAKING FIRE</span></div>' : '<div class="reticle"></div>'}
      <div class="vitals"><div class="nums"><span class="hp tab ${low ? 'low' : ''}" id="hp">${st.hp}</span><span class="hplab">HP</span><span class="sh tab ${st.armor === 0 ? 'zero' : ''}" id="sh">${st.armor}</span></div>
        <div class="bar ${low ? 'low' : ''}"><i id="hpbar" style="width:${Math.round(100 * st.hp / st.maxHp)}%"></i></div>
        <div class="bar armor"><i id="shbar" style="width:${Math.round(100 * st.armor / st.maxArmor)}%"></i></div></div>
      <div class="ammo">${lowMag ? `<span class="reload ${st.ammo === 0 ? 'solid' : ''}"><span class="unskew">RELOAD ▸▸</span></span>` : ''}
        <div class="nums"><span class="mag tab ${lowMag ? 'warn' : ''}" id="mag">${pad2(st.ammo)}</span><span class="res tab" id="res">/${st.reserve != null ? st.reserve : '—'}</span></div>
        <div class="pips" id="pips">${this._pips(st)}</div><span class="wn">${esc(st.weapon)}</span></div>
      <div class="nightlab">NIGHT OPS</div>${kb}</div>`;
  }
  _pips(st) {
    const n = 12, mag = st.mag || Math.max(st.ammo, 1);
    const lit = Math.round(n * Math.min(1, st.ammo / mag));
    const warn = !!(st.alive && st.mag && st.ammo < st.mag && st.ammo / st.mag <= .15);
    let s = ''; for (let i = 0; i < n; i++) s += `<i class="${i < lit ? (warn ? 'warn' : '') : 'spent'}"></i>`;
    return s;
  }

  // ---------- per-tick patch ----------
  _statusLine(st, mode) {
    const mc = st.wsState === 'bound' ? '<b>LINKED</b>' : '<span class="bad">' + esc(String(st.wsState || 'offline').toUpperCase()) + '</span>';
    const clock = st.synced ? '<b>SYNCED</b>' : '<span class="bad">UNSYNCED</span>';
    if (mode === 'connected') return `GUN <b>LINKED</b> · MC ${mc}`;
    if (mode === 'lobby') return `GUN <b>ARMED-PENDING</b>${st.headEcho ? ' · ECHO <b>OK</b>' : ' · <span class="bad">NO ECHO</span>'} · CLOCK ${clock}`;
    return `${st.tutorial ? '<span style="color:var(--warn)">TRY-OUT ARMED — FIRE A FEW ROUNDS</span><br>' : ''}MC ${mc} · CLOCK ${clock}`;
  }
  _readyNote(st) {
    return st.ready ? 'Waiting for the host to arm the match. Tap again to un-ready.'
      : (st.synced ? 'Tap when you are set. The host pushes the game once everyone is ready.' : 'Syncing clock with Mission Control…');
  }
  _patch(st) {
    const q = id => this.hudEl.querySelector('#' + id);
    const set = (id, v) => { const el = q(id); if (el && el.textContent !== String(v)) el.textContent = v; };
    const setHtml = (id, html) => { const el = q(id); if (el && el.innerHTML !== html) el.innerHTML = html; };
    if (st.phase === 'connected' || st.phase === 'kitted' || st.phase === 'lobby') {
      const mode = st.phase === 'connected' ? 'connected' : st.phase === 'lobby' ? 'lobby' : (st.ended ? 'over' : 'kitted');
      if (mode !== 'over') setHtml('mcstatus', this._statusLine(st, mode));
      if (mode === 'kitted') setHtml('readynote', this._readyNote(st));
    }
    if (st.phase === 'live') {
      set('clock', mmss(st.clockMs)); set('hp', st.hp); set('sh', st.armor); set('mag', pad2(st.ammo)); set('res', `/${st.reserve != null ? st.reserve : '—'}`);
      set('batt', st.battery != null ? st.battery + '%' : '—');
      const hb = q('hpbar'); if (hb) hb.style.width = `${Math.round(100 * st.hp / st.maxHp)}%`;
      const sb = q('shbar'); if (sb) sb.style.width = `${Math.round(100 * st.armor / st.maxArmor)}%`;
      const bf = q('battfill'); if (bf) bf.style.right = `${100 - (st.battery || 0)}%`;
      const pips = q('pips'); if (pips) { const html = this._pips(st); if (pips.innerHTML !== html) pips.innerHTML = html; }
      set('st-K', st.kills == null ? '—' : st.kills); set('st-D', st.deaths);
      const dot = q('linkdot'); if (dot) { const cls = 'dot ' + (st.bleUp ? (st.wsState === 'bound' ? '' : 'ws') : 'off'); if (dot.className !== cls) dot.className = cls; }
    }
  }

  // ---------- chips (WS / BLE / resync / tutorial) ----------
  _chips(st) {
    const pills = [];
    if (st.wsState === 'rejected') pills.push(`<span class="pill bad"><span class="unskew">MC REFUSED: ${esc(String(st.wsReason || 'refused')).toUpperCase()}</span></span>`);
    else if (st.phase !== 'idle' && st.phase !== 'connected' && st.wsState !== 'bound') pills.push(`<span class="pill warn"><span class="unskew">RECONNECTING TO MISSION CONTROL…</span></span>`);
    if (st.phase !== 'idle' && !st.bleUp) pills.push(`<span class="pill bad"><span class="unskew">GUN LINK LOST — RECONNECTING</span></span>`);
    if (st.moment && st.moment.kind === 'go' && st.phase === 'live' && st.bleUp) pills.push(`<span class="pill ok"><span class="unskew">WEAPONS HOT</span></span>`);   // never 'hot' while the gun link is down
    const prompt = st.resync ? `<div class="prompt"><span class="unskew">GUN RELINKED — ${esc(st.resync.prompt).toUpperCase()}</span></div>` : '';
    const html = `<div class="chipbar">${pills.join('')}</div>${prompt}`;
    if (this.chips.innerHTML !== html) this.chips.innerHTML = html;
  }

  // ---------- moments (overlay) ----------
  _moments(st) {
    // T-MINUS while armed
    if (st.phase === 'armed' && st.tMinusMs != null) {
      const secs = Math.ceil(st.tMinusMs / 1000);
      const big = secs > 99 ? mmss(st.tMinusMs) : pad2(secs);
      if (this._moment !== 'tminus') {
        this._moment = 'tminus';
        this.overlay.innerHTML = `<div class="mo tminus"><div class="hz t"></div><div class="hz b"></div><div class="glow"></div>
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
      const kb = st.killedBy || {}; const tk = kb.teamKey || 'red';
      if (this._moment !== 'down') {
        this._moment = 'down';
        this.overlay.innerHTML = `<div class="mo down"><div class="wash"></div>
          <div class="ghost"><div class="l tab">00</div><div class="r tab">${pad2(st.ammo)}<span style="font-size:26px">/${st.reserve != null ? st.reserve : '—'}</span></div></div>
          <div class="c"><div class="l2"><span class="t">DOWN</span><span class="kb">KILLED BY <b style="background:${TEAM_COLOR[tk]};color:${TEAM_INK[tk]}"><span class="unskew">${esc(kb.name || kb.teamName || 'UNKNOWN')}</span></b></span></div>
          <div style="display:flex;flex-direction:column;align-items:center"><span class="n tab" id="rd">${pad2(st.respawnIn)}</span><span class="lab">${st.respawnIn ? 'REDEPLOY IN' : 'AWAITING REDEPLOY'}</span></div></div></div>`;
        this._flash();
      } else { const el = this.overlay.querySelector('#rd'); if (el) el.textContent = pad2(st.respawnIn); }
      return;
    }
    if (this._moment === 'down' && (st.alive || st.phase !== 'live')) { this._moment = null; this.overlay.innerHTML = ''; }

    // transient moments
    const m = st.moment;
    if (m && m.at !== this._momentAt) {
      this._momentAt = m.at;
      if (m.kind === 'kill') this._kill(st, m);
      else if (m.kind === 'redeploy') this._redeploy(st);
      else if (m.kind === 'go') this._flash();
    }
  }
  _flash() { if (this.frame.dataset.env === 'night') return; const w = document.createElement('div'); w.className = 'whiteout'; this.overlay.appendChild(w); setTimeout(() => w.remove(), 120); }
  _kill(st, m) {
    if (this.frame.dataset.env === 'night') return;
    const vt = (m.data && m.data.victim_team) || 'yellow'; const vk = String(vt).toLowerCase();
    const el = document.createElement('div');
    el.className = 'mo kill';
    el.innerHTML = `<div class="rays"></div><div class="ring1"></div><div class="ring2"></div>
      <div class="c"><span class="elim"><span class="unskew">+1 ELIMINATION</span></span><span class="k">KILL</span><span class="cf">CONFIRMED</span>
      <div class="bars"><i style="width:90px;background:var(--warn)"></i><i style="width:34px;background:var(--glow)"></i><i style="width:12px;background:var(--glow);opacity:.5"></i></div></div>
      <div class="foot"><span class="vt" style="background:${TEAM_COLOR[vk] || 'var(--team-yellow)'};color:${TEAM_INK[vk] || '#1a1400'}"><span class="unskew">${esc((m.data && m.data.victim) || (vk.toUpperCase() + ' OPERATIVE'))} DOWN</span></span>
      <span class="by">K ${st.kills != null ? st.kills : ''} · CONFIRMED BY MISSION CONTROL</span></div>`;
    this._flash(); this.overlay.appendChild(el);
    this.h.onHaptic && this.h.onHaptic('kill');
    setTimeout(() => el.classList.add('out'), 1800); setTimeout(() => el.remove(), 2200);
  }
  _redeploy(st) {
    if (this.frame.dataset.env === 'night') return;
    const el = document.createElement('div'); el.className = 'mo redeploy';
    el.innerHTML = `<div class="wipe"></div><div class="slash"></div>
      <div class="r"><span class="t">REDEPLOYED</span><span class="h">WEAPONS HOT ▸▸▸</span><span class="s">${st.maxHp} · ${st.maxArmor} · MAG FULL</span></div>
      <div class="l"><span class="cs">${esc(st.callsign)}</span><span class="sq">${esc(st.teamName)} SQUAD</span></div>`;
    this.overlay.appendChild(el);
    setTimeout(() => el.classList.add('out'), 1100); setTimeout(() => el.remove(), 1500);
  }

  // ---------- diagnostics ----------
  renderDiag() {
    const d = this.diagData || {}; const pf = d.preflight || {};
    const kv = o => Object.entries(o).map(([k, v]) => `<span>${esc(k)}</span><span class="${v === true ? 'ok' : v === false ? 'bad' : ''}">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`).join('');
    this.diag.innerHTML = `<button class="close" data-act="onCloseDiag">✕</button>
      <h3>PREFLIGHT</h3><div class="kv">${kv(pf)}</div>
      <h3>LINK</h3><div class="kv">${kv(d.link || {})}</div>
      <h3>ENGINE</h3><div class="kv">${kv(d.engine || {})}</div>
      <h3>TIMINGS</h3><div class="kv">${kv(d.timings || {})}</div>
      <h3>LAST FRAMES</h3><pre>${esc((d.frames || []).map(f => `${f.dir === 'tx' ? '>>' : '<<'} ${f.f}`).join('\n'))}</pre>
      <h3>LOG</h3><pre>${esc((d.log || []).join('\n'))}</pre>
      <div class="btns"><button data-act="onReconnectGun">RECONNECT GUN</button><button data-act="onReconnectMc">RECONNECT MC</button><button data-act="onShareLog">SHARE LOG</button><button data-act="onToggleNight">NIGHT</button><button class="danger" data-act="onPanic">PANIC</button></div>`;
  }
}
