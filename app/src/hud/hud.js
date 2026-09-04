// Phone HUD v2 renderer — a pure function of engine state (node.md §4). Landscape 844×390, scaled to
// the viewport. Structure re-renders only when the state "signature" changes; live numbers patch in
// place so CSS animations don't restart every tick. Moments (T-MINUS, KILL, DOWN, REDEPLOY) live in
// #overlay so they animate independently of the base HUD.

const TEAM_COLOR = { blue: 'var(--team-blue)', yellow: 'var(--team-yellow)', red: 'var(--team-red)', green: 'var(--team-green)' };
const TEAM_INK = { blue: '#04121e', yellow: '#1a1400', red: '#1a0404', green: '#041a0c' };
const pad2 = n => String(Math.max(0, Math.floor(n))).padStart(2, '0');
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad2(s / 60)}:${pad2(s % 60)}`; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Accuracy is hits/shots where hits come from the VICTIMS' phones — shown only once MC has counted at least one
 *  hit for this player and ten shots have gone out; otherwise it reads 0% for every player without a phone in range. */
const accShown = st => (st.accuracy != null && st.hits > 0 && st.shots >= 10) ? Math.round(st.accuracy) : null;
/** A11.4: alert families → banner colour. Objective = team colour, clock = amber, danger = red, the rest = glow. */
const ALERT_FAMILY = { objective_taken: 'objective', objective_scored: 'objective', flag_returned: 'objective', point_captured: 'objective', hill_captured: 'objective',
  time_60: 'clock', time_30: 'clock', time_10: 'clock',
  bomb_planted: 'danger', bomb_detonated: 'danger', vip_hit: 'danger', vip_down: 'danger', infected: 'danger', lead_lost: 'danger',
  lead_taken: 'info', next_kill_wins: 'info', last_survivor: 'info', survivors_win: 'info', bomb_defused: 'info',
  extraction_called: 'objective', extraction_open: 'objective', extraction_closing: 'objective', extraction_complete: 'objective', extraction_failed: 'danger', extraction_alert: 'danger',
  loot_picked: 'info', raid_ending: 'danger', raid_over: 'danger' };   // extraction ladder + raid (brx session, 2026-09-04)
const MEDAL_LABEL = { first_blood: 'FIRST BLOOD', double_kill: 'DOUBLE KILL', triple_kill: 'TRIPLE KILL', killtacular: 'KILLTACULAR', killing_spree: 'KILLING SPREE', unstoppable: 'UNSTOPPABLE' };
const splitGun = g => { if (!g) return ['—', '']; return [esc(g.basename || g.name || ''), esc(g.tail || '')]; };
// A10: human labels for catalog rows (never the raw $WEAP class id — design review round 3)
const ROLE_NAME = { assault: 'ASSAULT', cqb: 'CLOSE RANGE', marksman: 'SNIPER', support: 'SUPPORT', power: 'HEAVY', melee: 'MELEE', sidearm: 'SIDEARM' };
/** A secondary rule whose kinds hold `sidearm` but not `weapon` is a pistols-only slot (policy.py, 2026-09-04). */
const sidearmOnly = rule => !!(rule && rule.kinds && rule.kinds.includes('sidearm') && !rule.kinds.includes('weapon'));
const roleName = w => ROLE_NAME[w.role] || (w.tags && w.tags[0] ? String(w.tags[0]).toUpperCase() : 'WEAPON');
const perkEffect = p => { const e = (p && p.effects) || {}; const out = [];
  if (e.max_armor_add) out.push(`+${e.max_armor_add} ARMOR`); if (e.ammo_mult) out.push(`×${e.ammo_mult} AMMO`); if (e.reload_mult) out.push(`RELOADS ${+(1 / e.reload_mult).toFixed(1)}× FASTER`); if (e.alt_reload) out.push('ALT = RELOAD'); if (e.switch_mult) out.push(`SWAPS ${+(1 / e.switch_mult).toFixed(1)}× FASTER`);
  return out.join(' · ') || 'PASSIVE'; };
const PERK_GLYPH = {
  body_armor: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 4 L34 9 V20 C34 29 28 34 20 37 C12 34 6 29 6 20 V9 Z"/><path d="M20 12 V29 M13 20 H27" opacity=".7"/></svg>',
  extended_mags: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 4 H28 L30 36 H10 Z"/><path d="M15 11 H25 M15 17 H25 M15 23 H25 M15 29 H25" opacity=".7"/></svg>',
  quick_hands: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="20" cy="23" r="13"/><path d="M20 15 V24 L26 27 M16 4 H24 M20 4 V9" /></svg>',
  easy_reload: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M31 15 A13 13 0 1 0 33 24"/><path d="M31 6 V15 H22"/></svg>',
};
const LOCK_SVG = '<svg class="lockg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="9" width="12" height="9"/><path d="M7 9V6a3 3 0 0 1 6 0v3"/></svg>';
const perkGlyph = id => PERK_GLYPH[id] || '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 4 L24 15 L36 16 L27 24 L30 36 L20 30 L10 36 L13 24 L4 16 L16 15 Z"/></svg>';


// Field 2026-08-30: the old DMG/ROF meters read `stats.dmg` straight, but that number is "share of a
// 115 pool per hit" -- 7 to 11 for most guns -- so every bar sat near empty and no two weapons looked
// different. MC now ranks each stat ACROSS the arsenal and ships it as `bars`, with the real figures
// alongside. Range is gone: t41 is identical on all 18 guns, so a range meter measured nothing.
function statBlock(r) {
  const st = r && r.stats ? r.stats : (r || {});
  const b = r && r.bars ? r.bars : {};
  const bar = (label, v, note) => v == null ? '' :
    `<div class="tb"><span>${label}${note ? ` <em>${note}</em>` : ''}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"></b></i></div>`;
  const pick = (...xs) => xs.find(x => x != null);
  const dmgHit = pick(r && r.dmg_per_hit, st.dmg_per_hit);
  const htk = pick(r && r.htk, st.htk);
  const ttk = pick(r && r.ttk_ms, st.ttk_ms);
  const pool = pick(r && r.pool, st.pool);
  const reload = pick(r && r.reload_s, st.reload_s, st.reload_ms != null ? st.reload_ms / 1000 : null);
  const facts = [
    dmgHit != null ? `DMG <b>${dmgHit}</b>/HIT` : null,
    // the pool is part of the number: MC quotes htk against the HOST'S health config now, so the
    // same "13" means a different thing between games (API.md GET /api/weapons; the MC screens
    // label it the same way). Printing it bare made it silently drift (review 2026-09-01).
    htk != null ? `HITS TO KILL <b>${htk}</b>${pool != null ? ` · ${pool}` : ''}` : null,
    ttk != null ? `KILL <b>${(ttk / 1000).toFixed(2)}S</b>` : null,
    reload != null ? `RELOAD <b>${(+reload).toFixed(1)}S</b>` : null,
  ].filter(Boolean).join(' · ');
  return `${bar('POWER', pick(b.power, st.dmg, r && r.dmg))}${bar('RATE OF FIRE', pick(b.rof, st.rof, r && r.rpm))}` +
    `${bar('AMMO CARRIED', b.ammo)}${bar('KILL SPEED', b.ttk)}` +
    (facts ? `<div class="facts">${facts}</div>` : '');
}

export class Hud {
  constructor(root, handlers = {}) {
    this.root = root; this.h = handlers;
    this.frame = root.querySelector('#frame'); this.hudEl = root.querySelector('#hud');
    this.overlay = root.querySelector('#overlay'); this.chips = root.querySelector('#chips');
    this.diag = root.querySelector('#diag'); this.info = root.querySelector('#info');
    this.sig = null; this.scan = []; this.link = {}; this.diagData = {}; this.cam = false; this.mcUrl = '';
    this.lo = { tab: 'primary', filter: 'weapons', focus: null };   // LOADOUT browser UI state (which tab / filter / row is in the detail pane)
    this._moment = null; this._momentTimer = null; this._lastTminus = null; this.mcPill = false;   // live: the MC-range pill is opt-in (tap the MC label)
    this.info.addEventListener('click', () => this.toggleDiag());
    this.hudEl.addEventListener('click', e => this._click(e));
    this.diag.addEventListener('click', e => this._click(e));
    let pressT = null;
    // (removed 2026-08-26, critic #9: a resting glove/chin tripped the invisible 900 ms night toggle — NIGHT lives in the diag panel)
    this.hudEl.addEventListener('pointerup', () => { if (pressT) clearTimeout(pressT); pressT = null; });
    this.hudEl.addEventListener('pointerleave', () => { if (pressT) clearTimeout(pressT); pressT = null; });
    window.addEventListener('resize', () => this.fit()); this.fit();
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
    const sig = [st.phase, st.alive, !!st.killedBy, st.night, this.cam, st.ready, st.tutorial, !!st.resync, st.callsign, st.teamKey, st.weapon, st.endAck, st.ended, st.kills, st.underFire, st.tutorialWeapon && st.tutorialWeapon.weapon_id,
      st.mode, st.gun && st.gun.name, st.switching, st.activeSlot, st.hp <= st.maxHp * .25, (st.mag ? st.ammo / st.mag : 1) <= .15, st.ammo === 0, st.battery != null && st.battery <= 15,
      st.kills > 0, st.deaths > 0, st.assists > 0, accShown(st) != null, st.reserve != null, this.scan.length, st.bleUp, st.ended,
      st.rejoin, !!st.pendingTeardown, this.sync && this.sync.bound, this.sync && this.sync.pending,
      // A10 loadout browser + slot plates
      st.browsing, st.canPickPrimary, st.canPickSecondary, st.tryoutSeen, this.lo.tab, this.lo.filter, this.lo.focus,
      st.kitOpen, st.briefSeen, st.game && st.game.name, st.game && st.game.loadout_line,
      st.loadoutAck && st.loadoutAck.t, st.pendingPick && st.pendingPick.id, st.pendingPick && st.pendingPick.kind,
      st.loadout && st.loadout.primary && st.loadout.primary.weapon_id, st.loadout && st.loadout.secondary && (st.loadout.secondary.weapon_id || st.loadout.secondary.perk_id),
      !!(st.catalog && st.catalog.weapons && st.catalog.weapons.length)].join('|');   // wsState / synced / headEcho are patched in place (never rebuild while typing the MC URL)
    const panel = st.phase === 'kitted' && ((st.ended && !st.endAck) || (!st.ended && st.kitOpen && !st.briefSeen && !this._tryoutShown(st)) || (!st.ended && st.browsing && !this._tryoutShown(st)));
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
    this._chips(st);
    this._moments(st);
  }

  // ---------- structure per phase ----------
  _structure(st) {
    switch (st.phase) {
      case 'idle': return this._idle(st);
      case 'connected': return this._lobby(st, 'connected');
      case 'kitted':
        if (st.ended && !st.endAck) return this._result(st);
        if (!st.ended && !st.kitOpen) return this._lobby(st, 'setup');            // §4.1: MC is still picking the game
        if (!st.ended && !st.briefSeen && !this._tryoutShown(st)) return this._briefing(st);   // §4.6: read the game, then BUILD MY KIT ▸
        if (!st.ended && st.browsing && !this._tryoutShown(st)) return this._loadout(st);
        return this._lobby(st, st.ended ? 'over' : 'kitted');
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
        <button class="bigbtn ghost" data-act="onDemo"><span class="unskew">DESKTOP DEMO</span></button>
        <button class="bigbtn ghost util" data-act="onUtility"><span class="unskew">▣ UTILITY MODE</span></button></div>
      <div class="r"><div class="sc"><i></i>SCANNING FOR TAGGERS</div><div class="list">${rows || '<div class="small">no taggers yet…</div>'}</div>
        <div class="help">Tagger not listed? Power-cycle it — it'll appear within a couple seconds.</div></div></div>`;
  }

  _lobby(st, mode) {
    const [nm, tail] = splitGun(st.gun);
    const cs = esc(st.callsign || (mode === 'connected' ? 'LINKED' : 'OPERATOR'));
    const team = st.teamName ? `<span class="chip"><span class="unskew">${esc(st.teamName)} SQUAD</span></span>` : '';
    const tw = this._tryoutShown(st) ? st.tutorialWeapon : null;
    // MC pushes a WeaponView here (it carries the ranked `bars`), which names the magazine `clip`;
    // older servers push the raw catalog row, where it is `stats.mag`. Accept both.
    const twStats = tw && tw.stats ? tw.stats : (tw || {});
    const twMag = [twStats.mag, tw && tw.clip, tw && tw.mag].find(v => v != null);
    const twRes = [twStats.reserve, tw && tw.reserve].find(v => v != null);
    const bar = (label, v) => v == null ? '' : `<div class="tb"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"></b></i></div>`;
    const tryout = tw ? `<div class="tryout">
        <div class="art" style="background-image:url('assets/weapons/${esc(tw.weapon_id)}.jpg')"></div>
        <div class="meta"><div class="lbl">TRY-OUT · FIRE A FEW ROUNDS</div><div class="nm">${esc((tw.name || tw.weapon_id || '').toUpperCase())}</div>
          <div class="ln">MAG ${twMag != null ? twMag : '—'} · RESERVE ${twRes != null ? twRes : '—'}${tw.role ? ' · ' + esc(roleName(tw)) : ''}</div>
          ${statBlock(tw)}</div>
        <div class="tact"><button class="lobtn ghost" data-act="onTryDone"><span class="unskew">DONE</span></button><div class="small">Keeps the gun armed with this weapon.</div></div></div>` : '';
    // Ammo is unknown until the game is pushed/armed — say so in words instead of showing "MAG — · RESERVE —".
    const _mag = st.loadMag != null ? st.loadMag : (st.mag != null ? st.mag : null);
    const _res = st.loadReserve != null ? st.loadReserve : (st.reserve != null ? st.reserve : null);
    const ammoLine = (_mag == null && _res == null) ? 'SET AT ARM TIME'
      : `<span class="nw">MAG ${_mag != null ? _mag : '—'} · RESERVE ${_res != null ? _res : '—'}</span>`;   // one line, never a dangling separator (breaker 2026-09-03)
    const plates = st.player && mode !== 'setup' ? `${tryout}<div class="plates" ${tw ? 'style="display:none"' : ''}>
        ${this._slotPlate(st, 'primary', mode, ammoLine)}${this._slotPlate(st, 'secondary', mode)}
        <div class="plate"><div class="in"><div class="h tab"><span style="color:var(--health)">HP ${st.maxHp}</span> · <span style="color:var(--armor)">ARMOR ${st.maxArmor}</span></div><div class="s">${esc(st.mode || 'TDM')} LOADOUT${st.playerNum ? ' · #' + st.playerNum : ''}</div></div></div>
        ${mode === 'kitted' && !tw && (st.canPickPrimary || st.canPickSecondary) ? '<div class="platehint">TAP A SLOT TO CHANGE YOUR LOADOUT</div>' : ''}</div>` : '';
    let foot, status;
    if (mode === 'connected') {
      foot = st.wsState === 'bound'
        ? `<div class="mclinked"><span class="unskew">MC LINKED ✓ — WAITING FOR KIT-OUT</span></div><div class="note">Mission Control has this gun. Your callsign and loadout arrive with the kit.</div>`
        : `<div class="mcin"><input id="mcurl" value="${esc(this.mcUrl)}" placeholder="ws://mission-control-ip:8766/ws" inputmode="url"><button data-act="onSetUrl">CONNECT</button></div><button class="qrbtn" data-act="onScanQr">▣ SCAN QR</button><div class="note join">Same Wi-Fi as Mission Control? It connects by itself. Otherwise scan the QR on the MC screen, or type its address.</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    } else if (mode === 'setup') {
      // §4.1: calm, not an error — the host hasn't picked the game yet
      foot = `<div class="setup"><div class="pulse"><i></i><i></i><i></i></div><div class="in"><div class="t">HOST IS SETTING UP THE GAME</div><div class="s">Your kit opens as soon as the host picks the game. Nothing to do yet.</div></div></div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, 'kitted')}</div>`;
    } else if (mode === 'kitted') {
      foot = `<button class="ready ${st.ready ? '' : 'off'}" data-act="onReady"><span class="unskew">${st.ready ? 'READY ✓' : 'READY UP'}</span></button><div class="note" id="readynote">${this._readyNote(st)}</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>${st.game ? '<button class="briefbtn" data-act="onBriefing"><span class="unskew">▤ BRIEFING</span></button>' : ''}`;
    } else if (mode === 'over') {
      foot = `<button class="ready wait ${st.ready ? 'on' : ''}" data-act="onReady"><span class="unskew">${st.ready ? 'READY ✓' : 'MATCH COMPLETE'}</span></button><div class="note">${st.ready ? 'Standing by — the next match kits you automatically.' : "Scores reconcile at Mission Control. Tap when you're set for the next match."}</div>`;
      status = `<div class="status">D ${st.deaths} · K ${st.kills != null ? st.kills : '—'}</div>`;
    } else {
      foot = `<button class="ready wait"><span class="unskew">STANDING BY</span></button><div class="note">Loadout is on the gun. Waiting for the host to start the countdown.</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    }
    return `<div class="lobby"><div class="scan"></div><div class="edgeglow"></div>
      <div class="top"><span class="cs">${cs}</span><span class="row">${team}<span class="gid">${nm}-${tail}</span></span></div>${plates}
      <div class="tr">${status}</div><div class="foot">${foot}</div></div>`;
  }

  _tryoutShown(st) { return !!(st.tutorial && st.tutorialWeapon && st.tryoutSeen !== st.tutorialWeapon.weapon_id); }

  // ---------- A10 §4.6: the BRIEFING — the chosen game, read at the player's own pace ----------
  _briefing(st) {
    const g = st.game || {};
    const mode = g.mode || st.mode || 'tdm';
    const name = g.name || g.mode_name || String(mode).toUpperCase();
    const mins = g.time_limit_s ? Math.round(g.time_limit_s / 60) : null;
    const rs = g.respawn ? (g.respawn.type === 'none' ? 'NONE · LIVES' : `${g.respawn.type === 'scanner' ? 'AT A SCANNER' : 'AUTO'} · ${g.respawn.delay_s}s`) : (g.respawn_text || '—');
    const hp = g.health ? `${g.health.max_hp} HP · ${g.health.max_armor} ARMOR` : '—';
    const venue = [g.environment ? String(g.environment).toUpperCase() : null, g.night ? 'NIGHT OPS' : null].filter(Boolean).join(' · ') || '—';
    const rows = [['TEAMS', g.teams_text || '—'], ['WIN', g.win_text || '—'], ['RESPAWN', rs], ['TIME', mins ? `${mins} MIN` : '—'], ['LIFE', hp], ['VENUE', venue]];
    const locked = !st.canPickPrimary && !st.canPickSecondary;
    const cta = locked ? 'SEE MY KIT ▸' : 'BUILD MY KIT ▸';
    const sub = locked ? 'Your kit is set by the host — take a look.' : 'Pick your weapons when you are ready.';
    return `<div class="lobby bf" data-mode="${esc(mode)}"><div class="scan"></div><div class="edgeglow"></div>
      <div class="bfart" style="background-image:url('assets/modes/${esc(mode)}.jpg')"></div><div class="bfveil"></div>
      <div class="bfbody">
        <div class="bfk r r0">${g.abbr ? `<span class="chip"><span class="unskew">${esc(g.abbr)}</span></span>` : ''}<span class="lab">GAME BRIEFING${g.ruleset ? ' · ' + esc(g.ruleset) : ''}</span></div>
        <div class="bfname r r1">${esc(String(name).toUpperCase())}</div>
        ${g.desc ? `<div class="bfdesc r r2">${esc(g.desc)}</div>` : ''}
        <div class="bfrules r r3">${rows.map(([k, v]) => `<div class="cell"><span class="k">${k}</span><span class="v">${esc(String(v))}</span></div>`).join('')}</div>
        ${g.loadout_line ? `<div class="bfload r r4"><span class="k">LOADOUT</span><span class="v">${esc(g.loadout_line)}</span></div>` : ''}
      </div>
      <div class="bffoot r r5"><span class="who"><span class="cs">${esc(st.callsign || '')}</span>${st.playerNum ? `<span class="num">#${st.playerNum}</span>` : ''}</span>
        <div class="cta"><button class="ready go" data-act="onBriefDone"><span class="unskew">${cta}</span></button><div class="note">${sub}</div></div></div></div>`;
  }

  // ---------- A10: slot plates + the LOADOUT browser (docs/spec/loadout.md §4.5) ----------
  _slotPlate(st, slot, mode, ammoLine) {
    const lo = st.loadout || {}; const item = slot === 'primary' ? lo.primary : lo.secondary;
    const rule = st.policy ? (slot === 'primary' ? st.policy.primary : st.policy.secondary) : null;
    const can = slot === 'primary' ? st.canPickPrimary : st.canPickSecondary;
    const locked = mode === 'kitted' && st.policy && !can && rule && rule.choice !== 'player';
    const k = slot.toUpperCase();
    let art = '', h = '', sub = '';
    if (item && item.kind === 'perk') { art = `<div class="thumb perk">${perkGlyph(item.perk_id)}</div>`; h = esc(item.name); sub = esc(perkEffect(item)); }   // the slot label carries "PERK"; the line is 134px wide
    else if (item) { art = `<div class="thumb" style="background-image:url('assets/weapons/${esc(item.weapon_id)}.jpg')"></div>`; h = esc(item.name); sub = slot === 'primary' ? (ammoLine || '') : `<span class="nw">MAG ${item.clip != null ? item.clip : '—'} · RESERVE ${item.reserve != null ? item.reserve : '—'}</span>`; }
    else { art = '<div class="thumb none"><span>—</span></div>'; h = 'NONE'; sub = rule && rule.choice === 'off' ? 'NO SECONDARY' : 'NO ALT-FIRE'; }
    if (locked) sub = (rule.choice === 'fixed' ? 'FIXED BY THE HOST' : rule.choice === 'off' ? 'NO SECONDARY' : 'SET BY THE HOST');
    const lock = locked ? `<span class="lock" aria-label="locked">${LOCK_SVG}</span>` : (can ? '<span class="cue">▸</span>' : '');
    return `<div class="plate wart slot ${can ? 'tap' : ''} ${locked ? 'locked' : ''}" ${can ? `data-act="onOpenLoadout" data-arg="${slot}"` : ''}>${art}<div class="in"><div class="k">${item && item.kind === 'perk' ? 'PERK' : k}${lock}</div><div class="h">${h.toUpperCase()}</div><div class="s">${sub}</div></div></div>`;
  }

  /** Rows for a tab: [{key, kind, id, row, allowed}] in catalog order, filtered to the player's pool. */
  _loRows(st, tab) {
    const cat = st.catalog || { weapons: [], perks: [] }; const rule = st.policy ? st.policy[tab] : null;
    if (tab === 'primary') { const ok = new Set((rule && rule.allowed_ids) || []); return (cat.weapons || []).filter(w => ok.has(w.weapon_id)).map(w => ({ key: 'weapon:' + w.weapon_id, kind: 'weapon', id: w.weapon_id, row: w })); }
    const okW = new Set((rule && rule.allowed_weapon_ids) || []), okP = new Set((rule && rule.allowed_perk_ids) || []);
    const kinds = (rule && rule.kinds) || ['weapon', 'perk'];
    if (this.lo.filter === 'perks') return kinds.includes('perk') ? (cat.perks || []).filter(p => okP.has(p.perk_id) && !p.hidden).map(p => ({ key: 'perk:' + p.perk_id, kind: 'perk', id: p.perk_id, row: p })) : [];
    return (kinds.includes('weapon') || kinds.includes('sidearm')) ? (cat.weapons || []).filter(w => okW.has(w.weapon_id)).map(w => ({ key: 'weapon:' + w.weapon_id, kind: 'weapon', id: w.weapon_id, row: w })) : [];   // a pistol is still requested as kind "weapon"
  }
  _loadout(st) {
    const tab = this.lo.tab === 'secondary' ? 'secondary' : 'primary';
    const lo = st.loadout || {}; const equipped = tab === 'primary' ? lo.primary : lo.secondary;
    const eqKey = equipped ? (equipped.kind === 'perk' ? 'perk:' + equipped.perk_id : 'weapon:' + equipped.weapon_id) : (tab === 'secondary' ? 'none' : null);
    const can = tab === 'primary' ? st.canPickPrimary : st.canPickSecondary;
    const rule = st.policy ? st.policy[tab] : null;
    const pend = st.pendingPick && st.pendingPick.slot === tab ? (st.pendingPick.kind === 'none' ? 'none' : `${st.pendingPick.kind}:${st.pendingPick.id}`) : null;
    const ack = st.loadoutAck && st.loadoutAck.slot === tab ? st.loadoutAck : null;
    const rows = this._loRows(st, tab);
    const tabBtn = (t, item) => { const on = t === tab; const r = st.policy ? st.policy[t] : null; const lk = st.policy && !(t === 'primary' ? st.canPickPrimary : st.canPickSecondary) && r && r.choice !== 'player';
      const nm = item ? item.name : (t === 'secondary' ? 'NONE' : '—');
      return `<button class="lotab ${on ? 'on' : ''} ${lk ? 'locked' : ''}" ${lk ? 'disabled aria-disabled="true"' : ''} data-act="onLoTab" data-arg="${t}"><span class="unskew"><span class="k">${t.toUpperCase()}${lk ? ' ' + LOCK_SVG : ''}</span><span class="v">${esc(nm).toUpperCase()}</span></span></button>`; };
    const name = r => r.kind === 'perk' ? r.row.name : r.row.name;
    const focusKey = (this.lo.focus && rows.some(r => r.key === this.lo.focus)) ? this.lo.focus : (eqKey && rows.some(r => r.key === eqKey) ? eqKey : (rows[0] ? rows[0].key : null));
    const focus = rows.find(r => r.key === focusKey) || null;
    let list = '';
    if (!can) {
      const why = rule && rule.choice === 'fixed' ? 'Fixed for this game — the host set it in Mission Control.' : rule && rule.choice === 'off' ? 'No secondary this game.' : 'The host assigns this slot from Mission Control.';
      list = `<div class="lolock"><div class="big">${LOCK_SVG} SET BY THE HOST</div><div class="s">${why}</div>${equipped ? `<div class="cur">${esc(equipped.name).toUpperCase()}</div>` : ''}</div>`;
    } else {
      const nCount = { weapons: ((rule && rule.allowed_weapon_ids) || []).length, perks: ((rule && rule.allowed_perk_ids) || []).length };
      const filt = tab === 'secondary' ? `<div class="lofilt">${['weapons', 'perks'].filter(f => !rule || !rule.kinds || (f === 'perks' ? rule.kinds.includes('perk') : (rule.kinds.includes('weapon') || rule.kinds.includes('sidearm')))).map(f => `<button class="fch ${this.lo.filter === f ? 'on' : ''}" data-act="onLoFilter" data-arg="${f}"><span class="unskew">${f === 'weapons' && sidearmOnly(rule) ? 'SIDEARMS' : f.toUpperCase()} · ${nCount[f]}</span></button>`).join('')}<button class="fch none ${eqKey === 'none' && pend == null ? 'on' : ''} ${pend === 'none' ? 'pend' : ''}" data-act="onLoNone"><span class="unskew">NONE${eqKey === 'none' ? ' ✓' : ''}</span></button></div>` : '';
      const head = tab === 'primary' ? `<div class="locount">${rows.length} WEAPON${rows.length === 1 ? '' : 'S'} · SCROLL FOR MORE</div>` : '';
      list = head + filt + (rows.length ? rows.map(r => {
        const eq = r.key === eqKey && !pend, pn = r.key === pend, fo = r.key === focusKey, rj = !!(ack && !ack.ok && ack.key === r.key);
        const thumb = r.kind === 'perk' ? `<span class="thumb perk">${perkGlyph(r.id)}</span>` : `<span class="thumb" style="background-image:url('assets/weapons/${esc(r.id)}.jpg')"></span>`;
        const body = r.kind === 'perk' ? `<span class="nm2"><b>${esc(name(r)).toUpperCase()}</b><small>${esc(perkEffect(r.row))}</small></span>` : `<span class="nm">${esc(name(r)).toUpperCase()}</span><span class="role">${esc(roleName(r.row))}</span><span class="mag tab">MAG ${r.row.clip != null ? r.row.clip : '—'}</span>`;
        return `<div class="lrow ${eq ? 'eq' : ''} ${pn ? 'pend' : ''} ${fo ? 'fo' : ''} ${rj ? 'rej' : ''}" data-act="onPickItem" data-arg="${r.key}">${thumb}${body}<span class="st">${eq ? '✓' : pn ? '…' : ''}</span></div>`;
      }).join('') : '<div class="small" style="padding:14px 4px">Nothing to pick here for this game.</div>');
    }
    // detail pane
    let detail = '';
    if (focus) {
      const r = focus.row;
      const bar = (label, v) => v == null ? '' : `<div class="tb"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"></b></i></div>`;
      if (focus.kind === 'perk') detail = `<div class="art perk">${perkGlyph(focus.id)}</div><div class="nm">${esc(r.name).toUpperCase()}${focus.key === eqKey ? '<span class="eqtag">EQUIPPED</span>' : ''}</div><div class="ln">PERK · ${esc(perkEffect(r))}${r.verified === false ? ' · <span style="color:var(--warn)">NOT YET FIELD-TESTED</span>' : ''}</div><div class="desc">${esc(r.desc || '')}</div>`;
      else detail = `<div class="art" style="background-image:url('assets/weapons/${esc(focus.id)}.jpg')"></div><div class="nm">${esc(r.name).toUpperCase()} <span class="rolechip">${esc(roleName(r))}</span>${focus.key === eqKey ? '<span class="eqtag">EQUIPPED</span>' : ''}</div><div class="ln">MAG ${r.clip != null ? r.clip : '—'} · RESERVE ${r.reserve != null ? r.reserve : '—'}${r.reload_s != null ? ' · RELOAD ' + r.reload_s + 'S' : ''}</div>${statBlock(r)}${r.caution ? `<div class="caution">▲ ${esc(r.caution)}</div>` : ''}<div class="desc">${esc(r.desc || '')}</div>`;
    } else if (can) detail = `<div class="small" style="padding-top:30px">${tab === 'secondary' ? (sidearmOnly(rule) ? 'Pick a sidearm or a perk — or leave it on NONE.' : 'Pick a second weapon or a perk — or leave it on NONE.') : 'Pick your main weapon.'}</div>`;
    const ackChip = ack ? `<span class="ackchip ${ack.ok ? 'ok' : 'bad'}"><span class="unskew">${ack.ok ? 'EQUIPPED ✓' : esc(ack.reason || 'THE HOST SAID NO').toUpperCase()}</span></span>` : (pend ? '<span class="ackchip"><span class="unskew">ASKING THE HOST…</span></span>' : (st.tutorial ? '<span class="ackchip warn"><span class="unskew">TRY-OUT ARMED — FIRE A FEW ROUNDS</span></span>' : ''));
    const canTry = can && focus && focus.kind === 'weapon';
    return `<div class="lobby lo"><div class="scan"></div><div class="edgeglow"></div>
      <div class="lotop">${tabBtn('primary', lo.primary)}${tabBtn('secondary', lo.secondary)}<span class="who"><span class="cs">${esc(st.callsign || '')}</span>${st.playerNum ? `<span class="num">#${st.playerNum}</span>` : ''}</span></div>
      <div class="lobody"><div class="lolist" data-tab="${tab}">${list}</div><div class="lodetail">${detail}</div></div>
      <div class="lobar"><span class="ackslot">${ackChip}</span>${canTry ? `<button class="lobtn try" data-act="onTryIt"><span class="unskew">TRY IT ▸</span></button>` : ''}<button class="lobtn done" data-act="onLoDone"><span class="unskew">CLOSE</span></button></div></div>`;
  }

  /** End-of-match result: banner + this player's line, OK -> the 'over' screen (bench request 2026-08-25). */
  _result(st) {
    const v = (x, suf = '') => x == null ? '—' : x + suf;
    const hist = this.history || [];
    const tot = hist.reduce((a, g) => ({ g: a.g + 1, k: a.k + (g.kills || 0), d: a.d + (g.deaths || 0) }), { g: 0, k: 0, d: 0 });
    const sess = tot.g > 1 ? `<div class="sess">OVERALL · ${tot.g} GAMES · ${tot.k} KILLS · ${tot.d} DEATHS</div>` : '';
    return `<div class="lobby result"><div class="scan"></div><div class="edgeglow"></div>
      <div class="banner"><span class="unskew">GAME OVER</span></div>
      <div class="rstats">
        <div class="cell"><b>${v(st.kills)}</b><span>KILLS</span></div>
        <div class="cell"><b>${v(st.deaths)}</b><span>DEATHS</span></div>
        <div class="cell"><b>${v(st.assists)}</b><span>ASSISTS</span></div>
        <div class="cell"><b>${v(accShown(st), '%')}</b><span>ACCURACY</span></div>
        <div class="cell"><b>${st.shots != null ? st.shots : '—'}</b><span>SHOTS</span></div>
      </div>${sess}
      <div class="foot">${this.sync && this.sync.bound && this.sync.pending === 0
        ? '<div class="syncline ok">SCORES SENT TO THE HOST ✓</div>'
        : this.sync && this.sync.bound
          ? `<div class="syncline warn">SENDING SCORES… ${this.sync.pending} LEFT</div>`
          : '<div class="syncline warn">OUT OF RANGE — SCORES SEND WHEN YOU ARE BACK</div>'}
      <button class="ready" data-act="onEndOk"><span class="unskew">OK</span></button></div></div>`;
  }

  _live(st) {
    const low = st.hp <= st.maxHp * .25 && st.alive;
    // only nag when genuinely low: live+alive, mag known, not a fresh mag (it blinked constantly on the bench)
    const lowMag = !!(st.alive && st.mag && st.ammo < st.mag && st.ammo / st.mag <= .15);
    const [nm] = splitGun(st.gun);
    const stat = (k, v) => `<span>${k}<b class="${v == null ? 'mut' : ''}" id="st-${k}">${v == null ? '—' : v}</b></span>`;
    const kb = st.killedBy ? `` : '';
    return `<div class="alive"><div class="scan"></div><div class="edgeglow"></div><div class="strip l"></div><div class="strip r"></div>
      <div class="scrim-t"></div><div class="scrim-b"></div>
      ${low ? '<div class="firevig"></div>' : ''}
      <div class="clockplate"><div class="in"><span class="t tab" id="clock">${mmss(st.clockMs)}</span><span class="m">${esc(st.mode)}</span></div></div>
      <div class="ident"><span class="arrow"></span><span class="cs">${esc(st.callsign || nm)}</span><span class="sq">${esc(st.teamName)} SQUAD</span></div>
      <div class="topright"><span class="link"><span id="linkdot" class="dot ${st.bleUp ? '' : 'off'}"></span><span id="linklab">${st.bleUp ? 'GUN' : 'NO GUN'}</span></span><button class="link mclink" data-act="onToggleMcPill" aria-label="Mission Control link"><span id="mcdot" class="dot ${st.wsState === 'bound' ? '' : 'ws'}"></span>MC</button>
        <span class="batt tab"><span class="shell"><span class="fill" id="battfill" style="right:${100 - (st.battery || 0)}%"></span></span><span id="batt">${st.battery != null ? st.battery + '%' : '—'}</span></span>
        <button class="camchip ${this.cam ? 'on' : ''}" data-act="onToggleCam"><span class="unskew10">◉ CAM${this.cam ? ' ON' : ''}</span></button></div>
      ${st.battery != null && st.battery <= 15 ? `<div class="battwarn">GUN BATT ${st.battery}% — CHARGE SOON</div>` : ''}
      <div class="stats tab">${st.kills > 0 ? stat('K', st.kills) : ''}${st.deaths > 0 ? stat('D', st.deaths) : ''}${st.assists > 0 ? stat('A', st.assists) : ''}${accShown(st) != null ? stat('ACC', accShown(st) + '%') : ''}</div>
      ${st.underFire ? '<div class="takingfire"><span class="r"></span><span class="t">TAKING FIRE</span></div>' : '<div class="reticle"></div>'}
      <div class="vitals"><div class="nums"><span class="hp tab ${low ? 'low' : ''}" id="hp">${st.hp}</span><span class="hplab">HP</span><span class="sh tab ${st.armor === 0 ? 'zero' : ''}" id="sh">${st.armor}</span></div>
        <div class="bar ${low ? 'low' : ''}"><i id="hpbar" style="width:${Math.round(100 * st.hp / st.maxHp)}%"></i></div>
        <div class="bar armor"><i id="shbar" style="width:${Math.round(100 * st.armor / st.maxArmor)}%"></i></div></div>
      <div class="ammo">${lowMag ? `<span class="reload ${st.ammo === 0 ? 'solid' : ''}"><span class="unskew">RELOAD ▸▸</span></span>` : ''}
        <div class="nums"><span class="mag tab ${lowMag ? 'warn' : ''}" id="mag">${pad2(st.ammo)}</span><span class="res tab" id="res">/${st.reserve != null ? st.reserve : '—'}</span></div>
        <div class="pips" id="pips">${this._pips(st)}</div>
        <span class="wn"><span class="slot">${st.activeSlot ? 'SECONDARY' : 'PRIMARY'}</span>${esc(st.weapon)}</span></div>
      <div class="nightlab">NIGHT OPS</div>${kb}</div>`;
  }
  /** The DOWN screen's middle block: the countdown in auto mode, or in scanner mode the respawn LESSON (utility.md
   *  §4.3, live bench 2026-09-04: "the very first time someone dies… the HUD should make it obvious"):
   *  RUN TO YOUR TEAM'S RESPAWN STATION → GET CLOSER (closeness bar vs the station's threshold) → HOLD… (at the
   *  station, the short delay finishing) → PULL THE TRIGGER TO RESPAWN (green) / RESPAWNING… (presence gate). */
  _downHintKey(st) { const s = st.station || {}; return [st.respawnHint, st.respawnType, st.respawnIn, s.id, s.present, s.rssi != null ? Math.round(s.rssi) : null].join('|'); }
  _downHint(st) {
    this._downHintSig = this._downHintKey(st);
    let hint = st.respawnHint || (st.respawnType === 'auto' ? 'timer' : st.respawnType === 'none' ? 'out' : 'find_station');
    if (st.respawnType === 'scanner' && (hint === 'timer' || hint === 'wait')) hint = 'find_station';   // an older engine: teach from the first second, never a 00
    if (hint === 'timer') return `<span class="n tab" id="rd">${pad2(st.respawnIn)}</span><span class="lab">${st.respawnIn ? 'REDEPLOY IN' : 'AWAITING REDEPLOY'}</span>`;
    if (hint === 'out') return `<span class="n nn">✕</span><span class="lab">NO RESPAWNS THIS MODE</span>`;
    const s = st.station || {}; const thr = s.threshold != null && s.threshold !== 0 ? s.threshold : -74; const rssi = s.rssi != null ? Math.round(s.rssi) : null;   // -74 = the bench-tuned station default (≈10 ft at high TX)
    const pct = rssi == null ? 0 : Math.max(0, Math.min(100, Math.round(100 * (rssi - (thr - 30)) / 30)));   // 30 dB below the threshold = 0, at it = 100
    const bar = (cls, w) => `<div class="near ${cls}"><i style="width:${w}%"></i></div>`;
    const presence = st.respawnGate === 'presence';   // some games revive by just being at the station — never tell those players to pull the trigger (polish round 2026-09-04)
    if (hint === 'find_station') return `<span class="n nn">▣</span><span class="ins">RUN TO YOUR TEAM'S RESPAWN STATION</span><span class="lab">${presence ? 'AND STAND THERE' : 'THEN PULL THE TRIGGER THERE'}</span>`;
    if (hint === 'approach') return `<span class="n nn">▣</span><span class="ins">GET CLOSER</span>${bar('', pct)}<span class="lab">STATION IN RANGE${rssi != null ? ` · <b class="tab">${rssi}</b> / ${thr} dBm` : ''}</span>`;
    if (hint === 'hold') return `<span class="n nn on">▣</span><span class="ins on">HOLD…</span>${bar('on hold', 100)}<span class="lab on">AT THE STATION · ALMOST THERE</span>`;
    if (hint === 'pull_trigger') return `<span class="n nn on">▣</span><span class="ins on">PULL THE TRIGGER TO RESPAWN</span>${bar('on', 100)}<span class="lab on">AT THE STATION</span>`;
    return `<span class="n nn on">▣</span><span class="ins on">RESPAWNING…</span>${bar('on', 100)}<span class="lab on">AT THE STATION</span>`;
  }
  /** The DOWN-screen recap: three labelled tiles — time left · the team race (cap under it) · your own line. */
  _downRecap(st) {
    const tile = (lab, val) => `<span class="rc"><span class="rv">${val}</span><span class="rl">${lab}</span></span>`;
    const out = [tile('TIME LEFT', `<b class="tab">${mmss(st.clockMs)}</b>`)];
    // Team totals and your kills come from Mission Control — shown only while the link is up (a stale board would lie);
    // off-link the recap sticks to what the phone knows for itself: the clock, the cap, your deaths and shots.
    const linked = st.wsState === 'bound';
    const bd = linked ? st.board : null;
    if (bd && bd.teams && bd.teams.length) {
      const chips = bd.teams.map(t => { const k = String(t.team_id || '').toLowerCase(); const mine = st.teamKey && k === st.teamKey;
        return `<span class="tm ${mine ? 'mine' : ''}" style="background:${TEAM_COLOR[k] || 'var(--plate)'};color:${TEAM_INK[k] || 'var(--num)'}"><span class="unskew">${esc(String(t.name || k).toUpperCase())} <b>${t.score != null ? t.score : '—'}</b></span></span>`; }).join('');
      out.push(tile(bd.cap ? `FIRST TO ${bd.cap}` : 'SCORE', `<span class="tms">${chips}</span>`));
    } else if (st.fragLimit) out.push(tile('SCORE CAP', `<b>${st.fragLimit}</b>`));
    const me = linked && st.kills != null ? [`<b>${st.kills}</b> KILL${st.kills === 1 ? '' : 'S'}`, `<b>${st.deaths}</b> DEATH${st.deaths === 1 ? '' : 'S'}`]
      : [`<b>${st.deaths}</b> DEATH${st.deaths === 1 ? '' : 'S'}`, `<b>${st.shots}</b> SHOT${st.shots === 1 ? '' : 'S'}`];
    if (st.lives != null) me.push(`<b>${st.lives}</b> ${st.lives === 1 ? 'LIFE' : 'LIVES'} LEFT`);   // "no respawns" is already the big label above
    out.push(tile('YOU', me.join(' · ')));
    return out.join('');
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
    // Player-facing wording; the raw wsState / synced / headEcho / arm_state stay in the diag panel (LINK/ENGINE).
    const mc = st.wsState === 'bound' ? '<b>HOST ✓</b>' : '<span class="bad">CONNECTING…</span>';
    const clock = st.synced ? '<b>IN SYNC ✓</b>' : '<span class="bad">SYNCING…</span>';
    if (mode === 'connected') return `GUN <b>CONNECTED ✓</b> · ${mc}`;
    if (mode === 'lobby') return `<b>LOCKED IN ✓</b>${st.headEcho ? '' : ' · <span class="bad">GUN NOT ANSWERING — CHECK HEADSET</span>'} · ${clock}`;
    return `${st.tutorial ? '<span style="color:var(--warn)">TRY-OUT ARMED — FIRE A FEW ROUNDS</span><br>' : ''}${mc} · ${clock}`;
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
      set('st-K', st.kills == null ? '—' : st.kills); set('st-D', st.deaths); set('st-A', st.assists == null ? '—' : st.assists); if (accShown(st) != null) set('st-ACC', accShown(st) + '%');
      const dot = q('linkdot'); if (dot) { const cls = 'dot ' + (st.bleUp ? '' : 'off'); if (dot.className !== cls) dot.className = cls; }
      set('linklab', st.bleUp ? 'GUN' : 'NO GUN');
      const md = q('mcdot'); if (md) { const cls = 'dot ' + (st.wsState === 'bound' ? '' : 'ws'); if (md.className !== cls) md.className = cls; }
    }
  }

  // ---------- chips (WS / BLE / resync / tutorial) ----------
  _chips(st) {
    const pills = [];
    if (st.wsState === 'bound') this.mcPill = false;   // the opt-in range pill is per outage, not forever
    if (st.wsState === 'rejected') pills.push(`<span class="pill bad"><span class="unskew">ASK THE HOST — COULDN'T JOIN${st.wsReason ? ' (' + esc(String(st.wsReason)).toUpperCase() + ')' : ''}</span></span>`);
    // Playing out of MC range is the NORMAL case mid-match (Tony, review 2026-09-03 #32): live shows it as the amber MC
    // dot only; a tap on the MC label shows the detail pill. Before the match (kitted/lobby) MC is required, so the pill stays.
    // (night hides the header dots, so there the dim pill is the only off-range signal)
    else if (st.phase !== 'idle' && st.phase !== 'connected' && st.wsState !== 'bound' && (st.phase !== 'live' || this.mcPill || st.night)) pills.push(`<span class="pill warn"><span class="unskew">${st.phase === 'live' ? 'OUT OF MISSION CONTROL RANGE — SCORES SYNC WHEN YOU ARE BACK' : 'RECONNECTING TO MISSION CONTROL…'}</span></span>`);
    // A tappable pill, not just a status: the retry now runs forever, but a player who has just
    // switched the gun on should not have to wait out a backoff — or go hunting in the debug panel,
    // which is where the only reconnect control used to live (Tony, field 2026-09-01).
    if (st.phase !== 'idle' && !st.bleUp) pills.push(`<button class="pill bad" data-act="onReconnectGun"><span class="unskew">GUN LINK LOST — TAP TO RECONNECT</span></button>`);
    if (st.moment && st.moment.kind === 'go' && st.phase === 'live' && st.bleUp) pills.push(`<span class="pill ok"><span class="unskew">WEAPONS HOT</span></span>`);   // never 'hot' while the gun link is down
    const prompt = st.resync ? `<div class="prompt"><span class="unskew"><span class="pl">GUN RELINKED</span><span class="pi">${esc(st.resync.prompt).toUpperCase()}</span></span></div>` : '';
    const html = `<div class="chipbar">${pills.join('')}</div>${prompt}`;
    if (this.chips.innerHTML !== html) this.chips.innerHTML = html;
  }

  // ---------- moments (overlay) ----------
  _moments(st) {
    // The reload takeover owns the chip bar. Tracked here, before ANY branch returns: dying mid-reload once left the
    // flag set for the whole DOWN screen and hid GUN LINK LOST exactly when it mattered (pass-2 review 2026-09-03).
    const reloadUp = !!(st.phase === 'live' && st.alive && st.bleUp && st.reloading);
    const switchUp = !!(st.phase === 'live' && st.alive && st.bleUp && st.switching && !reloadUp);
    const reconcileUp = !!(st.phase === 'live' && st.reconciling);
    const tk = reloadUp ? 'reload' : switchUp ? 'switch' : reconcileUp ? 'reconcile' : '';
    if ((this.frame.dataset.takeover || '') !== tk) { if (tk) this.frame.dataset.takeover = tk; else delete this.frame.dataset.takeover; }
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
          <div class="c"><div class="l2">${st.respawnType === 'scanner' ? '<span class="tt"><span class="t">DOWN</span><span class="t t2">RESPAWN<br>AT STATION</span></span>' : '<span class="t">DOWN</span>'}<span class="kb">KILLED BY <b style="background:${TEAM_COLOR[tk]};color:${TEAM_INK[tk]}"><span class="unskew">${esc(kb.name || kb.teamName || 'UNKNOWN')}</span></b></span></div>
          <div class="dn" id="dnhint">${this._downHint(st)}</div></div>
          <div class="recap" id="downrecap">${this._downRecap(st)}</div></div>`;
        this._flash();
      } else {
        const el = this.overlay.querySelector('#rd'); if (el) el.textContent = pad2(st.respawnIn);
        const hk = this._downHintKey(st); if (hk !== this._downHintSig) { const h = this.overlay.querySelector('#dnhint'); if (h) h.innerHTML = this._downHint(st); }
        const rc = this.overlay.querySelector('#downrecap'); if (rc) { const h = this._downRecap(st); if (rc.innerHTML !== h) rc.innerHTML = h; }
      }
      return;
    }
    if (this._moment === 'down' && (st.alive || st.phase !== 'live')) { this._moment = null; this.overlay.innerHTML = ''; }

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
      const pct = Math.min(100, Math.round(100 * st.reloadMs / st.reloadTotalMs)), left = Math.max(0, (st.reloadTotalMs - st.reloadMs) / 1000);
      if (this._moment !== 'reload') {
        this._moment = 'reload';
        this.overlay.innerHTML = `<div class="mo reloading"><div class="c"><span class="t">RELOADING</span><span class="s">${esc(st.weapon)}</span>
          <div class="track"><i id="rlbar" style="width:${pct}%"></i></div><span class="n tab" id="rlleft">${left.toFixed(1)}S</span></div></div>`;
        this.h.onHaptic && this.h.onHaptic('tap');
      } else { const b = this.overlay.querySelector('#rlbar'); if (b) b.style.width = pct + '%'; const n = this.overlay.querySelector('#rlleft'); if (n) n.textContent = left.toFixed(1) + 'S'; }
      // no early return: hits, gains and kills append ABOVE the takeover — reloading is exactly when you get shot (suite audit 2026-09-03)
    } else if (this._moment === 'reload') { this._moment = null; this.overlay.innerHTML = ''; }   // (reloadUp is the single source of truth for the flag AND the overlay)

    // SWITCHING WEAPON (persistent for the assumed swap window; the gun will not fire mid-swap). Ends with a 'switched' moment.
    if (switchUp) {
      const pct = Math.min(100, Math.round(100 * st.switchingMs / st.switchWindowMs));
      if (this._moment !== 'switch') {
        this._moment = 'switch';
        const lo = st.loadout || {}; const items = [lo.primary, lo.secondary];
        this.overlay.innerHTML = `<div class="mo switching"><div class="c"><span class="t">SWITCHING</span>
          <div class="pair">${this._wtile(items[st.switchFrom], 'STOWING', 'from')}<span class="arr">▸▸▸</span>${this._wtile(items[st.switchTo], 'DRAWING', 'to')}</div>
          <div class="track"><i id="swbar" style="width:${pct}%"></i></div></div></div>`;
        this.h.onHaptic && this.h.onHaptic('tap');
      } else { const b = this.overlay.querySelector('#swbar'); if (b) b.style.width = pct + '%'; }
    } else if (this._moment === 'switch') { this._moment = null; this.overlay.innerHTML = ''; }

    // transient moments
    const m = st.moment;
    if (m && m.at !== this._momentAt) {
      this._momentAt = m.at;
      if (m.kind === 'kill') this._kill(st, m);
      else if (m.kind === 'redeploy') this._redeploy(st);
      else if (m.kind === 'switched') this._switched(st, m);
      else if (m.kind === 'alert') this._alert(st, m);
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
  _swap(kind, el, outAt, gone) {
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

  _flash() {
    if (this.frame.dataset.env === 'night') return;
    const now = Date.now(); if (this._flashAt && now - this._flashAt < 500) return; this._flashAt = now;   // ≤2 flashes/s whatever the event burst (WCAG 2.3.1)
    const w = document.createElement('div'); w.className = 'whiteout'; this.overlay.appendChild(w); setTimeout(() => w.remove(), 120); }
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
    const medals = (m.data && Array.isArray(m.data.medals) ? m.data.medals : []).filter(k => MEDAL_LABEL[k]);
    if (medals.length) el.querySelector('.c').insertAdjacentHTML('beforeend', `<div class="medals">${medals.map((k, i) => `<span class="medal ${esc(k)}" style="animation-delay:${.12 + i * 2}s"><span class="unskew">${MEDAL_LABEL[k]}</span></span>`).join('')}</div>`);
    this._flash();
    const hold = 1800 + Math.max(0, medals.length - 1) * 2000;   // each medal line plays 2 s after the last (engine MEDAL_GAP_MS)
    this._swap('kill', el, hold, hold + 400);   // three confirms 300ms apart used to stack three banners
    this.h.onHaptic && this.h.onHaptic('kill');
  }
  // TAKING A HIT. Deliberately a single fade, never a repeating flicker: this feedback moved off the
  // gun's LEDs precisely because winning that surface needed ~30 Hz repaints that strobe, and
  // flicker in the 10-25 Hz band is the photosensitive-epilepsy trigger range. One transition only.
  // Renders at night too (dimmer, no whiteout) -- knowing you are being shot is not optional.
  _hit(st, m) {
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
    this.h.onHaptic && this.h.onHaptic('hit');
  }

  // GAINING a pool: heal, armour pickup, shield grant. Colour matches the pool so the player learns
  // one mapping across the gun strip and the HUD (poolgauge.py: shield teal, armour purple, health green).
  _gain(st, m) {
    const d = (m.data) || {};
    const el = document.createElement('div');
    el.className = `mo gain ${esc(d.pool)}`;
    const label = d.pool === 'armor' ? 'ARMOUR' : d.pool === 'shield' ? 'SHIELD' : 'HEALTH';
    el.innerHTML = `<div class="gv"></div>
      <div class="gc"><span class="amt tab">+${esc(d.amount)}</span><span class="lab">${label}</span></div>`;
    this._swap('gain', el, 500, 1000);
    this.h.onHaptic && this.h.onHaptic('gain');   // a pickup you are not looking at should be FELT
  }

  /** One weapon tile for the SWITCHING takeover and the ACTIVE confirm. */
  _wtile(it, label, cls) {
    if (!it) return `<span class="wt ${cls}"><span class="th none">—</span><span class="wl">${label}</span><span class="wn">NONE</span></span>`;
    const th = it.kind === 'perk' ? `<span class="th perk">${perkGlyph(it.perk_id)}</span>` : `<span class="th" style="background-image:url('assets/weapons/${esc(it.weapon_id)}.jpg')"></span>`;
    return `<span class="wt ${cls}">${th}<span class="wl">${label}</span><span class="wn">${esc(it.name).toUpperCase()}</span></span>`;
  }
  /** The swap confirmed (by the next shot's $ALCD) or assumed (window expired): the new weapon, marked ACTIVE. */
  _switched(st, m) {
    const lo = st.loadout || {}; const it = [lo.primary, lo.secondary][m.data && m.data.slot] || null;
    const el = document.createElement('div'); el.className = 'mo switched';
    el.innerHTML = `<div class="c"><div class="in">${this._wtile(it, 'ACTIVE ✓', 'to on')}<span class="s">${m.data && m.data.assumed ? 'READY' : 'CONFIRMED BY YOUR GUN'}</span></div></div>`;
    this._swap('switched', el, 900, 1200);
  }

  /** A11.4 game-event alert: a full-width banner, stronger than a hit, weaker than KILL / DOWN, ~2.5 s. Renders at night too (dim). */
  _alert(st, m) {
    const d = (m.data) || {}; const fam = ALERT_FAMILY[d.kind] || 'info';
    const el = document.createElement('div'); el.className = `mo alert ${fam}`;
    el.innerHTML = `<div class="band"><span class="k">${fam === 'objective' ? 'OBJECTIVE' : fam === 'clock' ? 'CLOCK' : fam === 'danger' ? 'ALERT' : 'MATCH'}</span><span class="t">${esc(String(d.text || d.kind || '').toUpperCase())}</span></div>`;
    this._swap('alert', el, 2200, 2600);
    this.h.onHaptic && this.h.onHaptic('tap');
  }

  _redeploy(st) {
    if (this.frame.dataset.env === 'night') return;
    const el = document.createElement('div'); el.className = 'mo redeploy';
    const lo = st.loadout || {};
    const ki = (k, it) => !it ? '' : `<span class="ki">${it.kind === 'perk' ? `<span class="th">${perkGlyph(it.perk_id)}</span>` : `<span class="th" style="background-image:url('assets/weapons/${esc(it.weapon_id)}.jpg')"></span>`}<span><span class="kk">${k}</span><br><span class="kn">${esc(it.name).toUpperCase()}</span></span></span>`;
    el.innerHTML = `<div class="wipe"></div><div class="slash"></div><div class="beam"></div>
      <div class="r"><span class="t">REDEPLOYED</span><span class="h">WEAPONS HOT ▸▸▸</span><span class="s">${st.maxHp} HP · ${st.maxArmor} ARMOR · MAG FULL</span>
        <div class="kit">${ki('PRIMARY', lo.primary)}${ki(lo.secondary && lo.secondary.kind === 'perk' ? 'PERK' : 'SECONDARY', lo.secondary)}</div></div>
      <div class="l"><span class="cs">${esc(st.callsign)}</span><span class="sq">${esc(st.teamName)} SQUAD</span></div>`;
    this._flash();
    const live = this._swap('redeploy', el, 1700, 2100);
    // fit the headline to its column: font metrics differ per platform and a fixed size ran off the right edge (review #31)
    const t = live.querySelector('.t'); let fs = 56;
    while (t && t.scrollWidth > t.clientWidth + 1 && fs > 28) { fs -= 2; t.style.fontSize = fs + 'px'; }
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
      <div class="btns"><button data-act="onCloseDiag" class="closex">CLOSE ✕</button><button data-act="onReconnectGun">RECONNECT GUN</button><button data-act="onReconnectMc">RECONNECT MC</button><button data-act="onShareLog">SHARE LOG</button><button data-act="onToggleNight">NIGHT</button></div>`;
  }
}
