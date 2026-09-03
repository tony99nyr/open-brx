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
// A10: human labels for catalog rows (never the raw $WEAP class id — design review round 3)
const ROLE_NAME = { assault: 'ASSAULT', cqb: 'CLOSE RANGE', marksman: 'SNIPER', support: 'SUPPORT', power: 'HEAVY', melee: 'MELEE' };
const roleName = w => ROLE_NAME[w.role] || (w.tags && w.tags[0] ? String(w.tags[0]).toUpperCase() : 'WEAPON');
const perkEffect = p => { const e = (p && p.effects) || {}; const out = [];
  if (e.max_armor_add) out.push(`+${e.max_armor_add} ARMOR`); if (e.ammo_mult) out.push(`×${e.ammo_mult} AMMO`); if (e.reload_mult) out.push(`RELOADS ${+(1 / e.reload_mult).toFixed(1)}× FASTER`); if (e.alt_reload) out.push('SIDE BUTTON RELOADS');
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
    this._moment = null; this._momentTimer = null; this._lastTminus = null;
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
    const sig = [st.phase, st.alive, !!st.killedBy, st.night, this.cam, st.ready, st.tutorial, !!st.resync, st.callsign, st.teamKey, st.weapon, st.endAck, st.ended, st.kills, st.underFire, st.tutorialWeapon && st.tutorialWeapon.weapon_id,
      st.mode, st.gun && st.gun.name, st.switching, st.activeSlot, st.hp <= st.maxHp * .25, (st.mag ? st.ammo / st.mag : 1) <= .15, st.ammo === 0, st.battery != null && st.battery <= 15,
      st.kills != null, st.assists != null, st.accuracy != null, st.reserve != null, this.scan.length, st.bleUp, st.ended,
      st.rejoin, !!st.pendingTeardown, this.sync && this.sync.bound, this.sync && this.sync.pending,
      // A10 loadout browser + slot plates
      st.browsing, st.canPickPrimary, st.canPickSecondary, st.tryoutSeen, this.lo.tab, this.lo.filter, this.lo.focus,
      st.kitOpen, st.briefSeen, st.game && st.game.name, st.game && st.game.loadout_line,
      st.loadoutAck && st.loadoutAck.t, st.pendingPick && st.pendingPick.id, st.pendingPick && st.pendingPick.kind,
      st.loadout && st.loadout.primary && st.loadout.primary.weapon_id, st.loadout && st.loadout.secondary && (st.loadout.secondary.weapon_id || st.loadout.secondary.perk_id),
      !!(st.catalog && st.catalog.weapons && st.catalog.weapons.length)].join('|');   // wsState / synced / headEcho are patched in place (never rebuild while typing the MC URL)
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
        <button class="bigbtn ghost" data-act="onDemo"><span class="unskew">DESKTOP DEMO</span></button></div>
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
    const ammoLine = (_mag == null && _res == null) ? 'GOES TO YOUR GUN AT ARM TIME'
      : `MAG ${_mag != null ? _mag : '—'} · RESERVE ${_res != null ? _res : '—'}`;
    const plates = st.player && mode !== 'setup' ? `${tryout}<div class="plates" ${tw ? 'style="display:none"' : ''}>
        ${this._slotPlate(st, 'primary', mode, ammoLine)}${this._slotPlate(st, 'secondary', mode)}
        <div class="plate"><div class="in"><div class="h tab"><span style="color:var(--health)">HP ${st.maxHp}</span> · <span style="color:var(--armor)">ARMOR ${st.maxArmor}</span></div><div class="s">${esc(st.mode || 'TDM')} LOADOUT${st.playerNum ? ' · #' + st.playerNum : ''}</div></div></div>
        ${mode === 'kitted' && !tw && (st.canPickPrimary || st.canPickSecondary) ? '<div class="platehint">TAP A SLOT TO CHANGE YOUR LOADOUT</div>' : ''}</div>` : '';
    let foot, status;
    if (mode === 'connected') {
      foot = st.wsState === 'bound'
        ? `<div class="mclinked"><span class="unskew">MC LINKED ✓ — WAITING FOR KIT-OUT</span></div><div class="note">Mission Control has this gun. Your callsign and loadout arrive with the kit.</div>`
        : `<div class="mcin"><input id="mcurl" value="${esc(this.mcUrl)}" placeholder="ws://mission-control-ip:8766/ws" inputmode="url"><button data-act="onSetUrl">CONNECT</button></div><button class="qrbtn" data-act="onScanQr">▣ SCAN QR</button><div class="note">Get on the SAME WI-FI as Mission Control — the app finds it by itself. No luck? Scan the QR on the MC screen or type its address above.</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>`;
    } else if (mode === 'setup') {
      // §4.1: calm, not an error — the host hasn't picked the game yet
      foot = `<div class="setup"><div class="pulse"><i></i><i></i><i></i></div><div class="in"><div class="t">MISSION CONTROL IS SETTING UP THE GAME</div><div class="s">Your kit opens as soon as the host picks the game. Nothing to do yet.</div></div></div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, 'kitted')}</div>`;
    } else if (mode === 'kitted') {
      foot = `<button class="ready ${st.ready ? '' : 'off'}" data-act="onReady"><span class="unskew">${st.ready ? 'READY ✓' : 'READY UP'}</span></button><div class="note" id="readynote">${this._readyNote(st)}</div>`;
      status = `<div class="status" id="mcstatus">${this._statusLine(st, mode)}</div>${st.game ? '<button class="briefbtn" data-act="onBriefing"><span class="unskew">▤ BRIEFING</span></button>' : ''}`;
    } else if (mode === 'over') {
      foot = `<button class="ready wait ${st.ready ? 'on' : ''}" data-act="onReady"><span class="unskew">${st.ready ? 'READY ✓ — HOST SEES YOU' : 'MATCH COMPLETE — READY FOR NEXT'}</span></button><div class="note">${st.ready ? 'Standing by — the next match kits you automatically.' : "Scores reconcile at Mission Control. Tap when you're set for the next match."}</div>`;
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
    if (item && item.kind === 'perk') { art = `<div class="thumb perk">${perkGlyph(item.perk_id)}</div>`; h = esc(item.name); sub = 'PERK · ' + esc(perkEffect(item)); }
    else if (item) { art = `<div class="thumb" style="background-image:url('assets/weapons/${esc(item.weapon_id)}.jpg')"></div>`; h = esc(item.name); sub = slot === 'primary' ? (ammoLine || '') : `MAG ${item.clip != null ? item.clip : '—'} · RESERVE ${item.reserve != null ? item.reserve : '—'}`; }
    else { art = '<div class="thumb none"><span>—</span></div>'; h = 'NONE'; sub = rule && rule.choice === 'off' ? 'NO SECONDARY THIS GAME' : 'ALT-FIRE DOES NOTHING'; }
    if (locked) sub = (rule.choice === 'fixed' ? 'FIXED FOR THIS GAME' : rule.choice === 'off' ? 'NO SECONDARY THIS GAME' : 'SET BY THE HOST');
    const lock = locked ? `<span class="lock" aria-label="locked">${LOCK_SVG}</span>` : (can ? '<span class="cue">▸</span>' : '');
    return `<div class="plate wart slot ${can ? 'tap' : ''} ${locked ? 'locked' : ''}" ${can ? `data-act="onOpenLoadout" data-arg="${slot}"` : ''}>${art}<div class="in"><div class="k">${k}${lock}</div><div class="h">${h.toUpperCase()}</div><div class="s">${sub}</div></div></div>`;
  }

  /** Rows for a tab: [{key, kind, id, row, allowed}] in catalog order, filtered to the player's pool. */
  _loRows(st, tab) {
    const cat = st.catalog || { weapons: [], perks: [] }; const rule = st.policy ? st.policy[tab] : null;
    if (tab === 'primary') { const ok = new Set((rule && rule.allowed_ids) || []); return (cat.weapons || []).filter(w => ok.has(w.weapon_id)).map(w => ({ key: 'weapon:' + w.weapon_id, kind: 'weapon', id: w.weapon_id, row: w })); }
    const okW = new Set((rule && rule.allowed_weapon_ids) || []), okP = new Set((rule && rule.allowed_perk_ids) || []);
    const kinds = (rule && rule.kinds) || ['weapon', 'perk'];
    if (this.lo.filter === 'perks') return kinds.includes('perk') ? (cat.perks || []).filter(p => okP.has(p.perk_id) && !p.hidden).map(p => ({ key: 'perk:' + p.perk_id, kind: 'perk', id: p.perk_id, row: p })) : [];
    return kinds.includes('weapon') ? (cat.weapons || []).filter(w => okW.has(w.weapon_id)).map(w => ({ key: 'weapon:' + w.weapon_id, kind: 'weapon', id: w.weapon_id, row: w })) : [];
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
      const filt = tab === 'secondary' ? `<div class="lofilt">${['weapons', 'perks'].filter(f => !rule || !rule.kinds || rule.kinds.includes(f === 'perks' ? 'perk' : 'weapon')).map(f => `<button class="fch ${this.lo.filter === f ? 'on' : ''}" data-act="onLoFilter" data-arg="${f}"><span class="unskew">${f.toUpperCase()} · ${nCount[f]}</span></button>`).join('')}<button class="fch none ${eqKey === 'none' && pend == null ? 'on' : ''} ${pend === 'none' ? 'pend' : ''}" data-act="onLoNone"><span class="unskew">NONE${eqKey === 'none' ? ' ✓' : ''}</span></button></div>` : '';
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
    } else if (can) detail = `<div class="small" style="padding-top:30px">${tab === 'secondary' ? 'Pick a second weapon or a perk — or leave it on NONE.' : 'Pick your main weapon.'}</div>`;
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
        <div class="cell"><b>${v(st.kills)}</b><span>KILLS${st.kills != null ? ' ✓MC' : ''}</span></div>
        <div class="cell"><b>${v(st.deaths)}</b><span>DEATHS</span></div>
        <div class="cell"><b>${v(st.assists)}</b><span>ASSISTS</span></div>
        <div class="cell"><b>${v(st.accuracy == null ? null : Math.round(st.accuracy), '%')}</b><span>ACCURACY</span></div>
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
      <div class="stats tab">${stat('K', st.kills, true)}${stat('D', st.deaths)}${stat('A', st.assists, true)}${stat('ACC', st.accuracy == null ? null : Math.round(st.accuracy) + '%', true)}</div>
      ${st.underFire ? '<div class="takingfire"><span class="r"></span><span class="t">TAKING FIRE</span></div>' : '<div class="reticle"></div>'}
      <div class="vitals"><div class="nums"><span class="hp tab ${low ? 'low' : ''}" id="hp">${st.hp}</span><span class="hplab">HP</span><span class="sh tab ${st.armor === 0 ? 'zero' : ''}" id="sh">${st.armor}</span></div>
        <div class="bar ${low ? 'low' : ''}"><i id="hpbar" style="width:${Math.round(100 * st.hp / st.maxHp)}%"></i></div>
        <div class="bar armor"><i id="shbar" style="width:${Math.round(100 * st.armor / st.maxArmor)}%"></i></div></div>
      <div class="ammo">${lowMag ? `<span class="reload ${st.ammo === 0 ? 'solid' : ''}"><span class="unskew">RELOAD ▸▸</span></span>` : ''}
        <div class="nums"><span class="mag tab ${lowMag ? 'warn' : ''}" id="mag">${pad2(st.ammo)}</span><span class="res tab" id="res">/${st.reserve != null ? st.reserve : '—'}</span></div>
        <div class="pips" id="pips">${this._pips(st)}</div>
        <span class="wn"><span class="slot">${st.activeSlot ? 'SECONDARY' : 'PRIMARY'}</span>${esc(st.weapon)}</span></div>
      ${st.switching ? `<div class="swapping"><div class="big">ALT</div><div class="sub">SWITCHING — CONFIRMS ON YOUR NEXT SHOT</div><div class="track"><i id="swapbar"></i></div></div>` : ''}
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
      set('st-K', st.kills == null ? '—' : st.kills); set('st-D', st.deaths);
      const dot = q('linkdot'); if (dot) { const cls = 'dot ' + (st.bleUp ? (st.wsState === 'bound' ? '' : 'ws') : 'off'); if (dot.className !== cls) dot.className = cls; }
      // swap progress: fills against the assumed ceiling, so the player can SEE the wait elapsing
      const sw = q('swapbar');
      if (sw && st.switchingMs != null && st.switchWindowMs) sw.style.width = `${Math.min(100, Math.round(100 * st.switchingMs / st.switchWindowMs))}%`;
    }
  }

  // ---------- chips (WS / BLE / resync / tutorial) ----------
  _chips(st) {
    const pills = [];
    if (st.wsState === 'rejected') pills.push(`<span class="pill bad"><span class="unskew">ASK THE HOST — COULDN'T JOIN${st.wsReason ? ' (' + esc(String(st.wsReason)).toUpperCase() + ')' : ''}</span></span>`);
    else if (st.phase !== 'idle' && st.phase !== 'connected' && st.wsState !== 'bound') pills.push(`<span class="pill warn"><span class="unskew">RECONNECTING TO MISSION CONTROL…</span></span>`);
    // A tappable pill, not just a status: the retry now runs forever, but a player who has just
    // switched the gun on should not have to wait out a backoff — or go hunting in the debug panel,
    // which is where the only reconnect control used to live (Tony, field 2026-09-01).
    if (st.phase !== 'idle' && !st.bleUp) pills.push(`<button class="pill bad" data-act="onReconnectGun"><span class="unskew">GUN LINK LOST — TAP TO RECONNECT</span></button>`);
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
          <div style="display:flex;flex-direction:column;align-items:center"><span class="n tab" id="rd">${pad2(st.respawnIn)}</span><span class="lab">${st.respawnIn ? 'REDEPLOY IN' : st.respawnType === 'scanner' ? 'GO TO A RESPAWN SCANNER' : st.respawnType === 'none' ? 'NO RESPAWNS THIS MODE' : 'AWAITING REDEPLOY'}</span></div></div></div>`;
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
    this._live = this._live || {};
    const prev = this._live[kind];
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
                  t2: setTimeout(() => { node.remove(); if (this._live[kind] === rec) delete this._live[kind]; }, gone) };
    this._live[kind] = rec;
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
    this._flash();
    this._swap('kill', el, 1800, 2200);   // three confirms 300ms apart used to stack three banners
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

  _redeploy(st) {
    if (this.frame.dataset.env === 'night') return;
    const el = document.createElement('div'); el.className = 'mo redeploy';
    el.innerHTML = `<div class="wipe"></div><div class="slash"></div>
      <div class="r"><span class="t">REDEPLOYED</span><span class="h">WEAPONS HOT ▸▸▸</span><span class="s">${st.maxHp} · ${st.maxArmor} · MAG FULL</span></div>
      <div class="l"><span class="cs">${esc(st.callsign)}</span><span class="sq">${esc(st.teamName)} SQUAD</span></div>`;
    this._swap('redeploy', el, 1100, 1500);
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
