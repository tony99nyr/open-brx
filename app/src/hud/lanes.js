// Lanes rendering for the phone HUD.
import { LANE_FEED_MS, LANE_HERO_MS, LANE_SETTLE_MS } from '../lanes.js';
import { TEAM_COLOR, itemColor, esc, MEDAL_ROWS, MEDAL_LABEL, AIM_REASON } from './shared.js';
const capMark = team => { const k = TEAM_COLOR[team] ? team : null; return `<b class="ltm" role="img" style="--tc:${k ? TEAM_COLOR[k] : 'var(--mut)'}" aria-label="${esc(k ? k.toUpperCase() : 'A TEAM')}">${esc(k ? k[0].toUpperCase() : '?')}</b>`; };
const HILL_WORD = { hill_captured: 'HILL CAPTURED', hill_lost: 'HILL LOST', hill_capture_started: 'HILL CAPTURE STARTED' };
const ALERT_FAMILY = { objective_taken: 'objective', objective_scored: 'objective', flag_returned: 'objective', point_captured: 'objective', hill_captured: 'objective',
  time_60: 'clock', time_30: 'clock', time_10: 'clock', bomb_planted: 'danger', bomb_detonated: 'danger', vip_hit: 'danger', vip_down: 'danger', infected: 'danger', lead_lost: 'danger',
  lead_taken: 'info', next_kill_wins: 'info', last_survivor: 'info', survivors_win: 'info', bomb_defused: 'info', extraction_called: 'objective', extraction_open: 'objective', extraction_closing: 'objective', extraction_complete: 'objective', extraction_failed: 'danger', extraction_alert: 'danger', loot_picked: 'info', raid_ending: 'danger', raid_over: 'danger' };
import * as DS from './deathscreen.js';

  // ---------- docs/announcer.md "The three lanes" (F351/F352, Tony 2026-09-24) ----------
  /** Every alert the live HUD draws, from `st.lanes` (the engine writes each lane the moment its event ARRIVES; the
   *  announcer queue still says one line at a time). HERO, over the centre: my kill and my newest medal; a spree builds,
   *  the newest medal big, the earlier ones as a fading ladder, with a ×N count; up until `heroUntil` (2.5 s after the
   *  last kill, or longer while that kill's own announcer slot is on air). OBJECTIVE, on the right: the lead and the hill,
   *  each up until the next one of its key replaces it. FEED, on the left: downs, pickups and every other alert (BOMB
   *  PLANTED, ONE MINUTE LEFT), 4 s a row. Each item carries a small source line (MC, IR, BLE); no weapon, no "+1". The down screen
   *  owns a dead phone: the engine's presentation gate gives `st.presented.lanes` as null unless the player is live and alive. */
  /** Keyed sync for one lane: each item is one element's HTML carrying `data-lk`. A kept node takes the new class,
   *  style, data and content in place (so its own entrance animation does not re-run); a new key is inserted; a gone
   *  key is removed. Content is rewritten only when it changed. */
export function _laneSync(box, items) {
    const tpl = document.createElement('template'); tpl.innerHTML = items.join('');
    const want = [...tpl.content.children], have = new Map([...box.children].map(n => [n.dataset.lk, n]));
    want.forEach((w, i) => {
      let n = have.get(w.dataset.lk);
      if (n) {
        have.delete(w.dataset.lk);
        for (const a of [...n.attributes]) if (!w.hasAttribute(a.name)) n.removeAttribute(a.name);
        for (const a of [...w.attributes]) if (n.getAttribute(a.name) !== a.value) n.setAttribute(a.name, a.value);
        if (n.innerHTML !== w.innerHTML) n.innerHTML = w.innerHTML;
      } else n = w;
      if (box.children[i] !== n) box.insertBefore(n, box.children[i] || null);
    });
    for (const n of have.values()) n.remove();
  }
  /** F368 (review H1): the status rail's REAL height (the pills, or `.gunwarn` in their place) as `--rail` on the frame,
   *  so the powerup hint and the NIGHT label ride above it however many lines its sentences wrap to. Layout px, so the
   *  frame's scale does not enter it. */
export function _railFit() {
    const f = this.frame; if (!f || typeof f.querySelectorAll !== 'function' || !f.style) return;
    const els = [...f.querySelectorAll('#chips .chipbar, .alive .gunwarn')].filter(e => e.offsetParent !== null && e.offsetHeight > 0 && (e.classList.contains('gunwarn') || e.children.length));
    const h = els.length ? Math.max(...els.map(e => e.offsetHeight + (parseFloat(getComputedStyle(e).bottom) || 0))) : 0;
    const v = h ? `${Math.ceil(h)}px` : '';
    const hint = f.querySelector('#puhint'), lab = this.hudEl.querySelector('.nightlab');
    if (f.style.getPropertyValue('--rail') !== v) {
      // F396 (bench 2026-09-25): the rail (the warning pills' height) is volatile right after a spawn -- GUN LINK
      // LOST/WEAPONS HOT trade places as the gun link settles -- and `bottom` (index.html `.puhint`/`.nightlab`) snaps
      // to the new value the instant `--rail` does, so neither ever slides THROUGH the QA-04 hit-weapon line's fixed
      // band (a slide would, and did, momentarily overlap it -- UX M1). Instead, whichever of the two is already
      // showing gets a brief opacity dip (`.repin`) so it re-settles quietly rather than teleporting in front of the
      // player; a hint with no value yet (still empty here) or a NIGHT OPS label hidden by day needs no dip -- there
      // is nothing yet on screen to jump from.
      for (const el of [hint, lab]) { if (el && (el === hint ? el.textContent.trim() : el.offsetParent !== null)) el.classList.add('repin'); }
      clearTimeout(this._repinT);
      this._repinT = setTimeout(() => { if (hint && hint.isConnected) hint.classList.remove('repin'); if (lab && lab.isConnected) lab.classList.remove('repin'); }, 140);
      if (v) f.style.setProperty('--rail', v); else f.style.removeProperty('--rail');
    }
    // review r2 M2: the hint rides 12 px above the rail but never over a centre tell (the accuracy pill, the OVERHEAT word,
    // TAKING FIRE: their band reaches frame y 252; RAIL_ROOM_PX is the 390 px frame less that and a 6 px margin). While a
    // tell is up and there is no room, the hint yields: the tell and the rail's warnings outrank it, and the held chip
    // still shows what the player carries. With no tell up the band is empty and the hint may use it.
    const RAIL_ROOM_PX = 390 - 258, tell = !!f.querySelector('.alive .aimfx, .alive .heatword, .alive .takingfire');
    const full = !!(h && hint && tell && h + 12 + hint.offsetHeight > RAIL_ROOM_PX);
    if (!!f.dataset.railfull !== full) { if (full) f.dataset.railfull = '1'; else delete f.dataset.railfull; }
  }
export function _lanes(st) {
    let root = this.frame.querySelector('#lanes');
    if (!root) { root = document.createElement('div'); root.id = 'lanes'; this.frame.appendChild(root); }
    const L = st.presented.lanes;   // #5: the engine's presentation gate decides whether the lanes draw (null while down)
    clearTimeout(this._lanesT);
    if (!L) { if (root.firstChild) root.innerHTML = ''; delete this.frame.dataset.hero; this._heroWait = null; return; }
    const now = Date.now(), FADE = 300;
    // F368 (docs/announcer.md "Layering and priority on the phone HUD"): a play-blocking takeover wins the centre. While
    // one is up the kill card is not drawn; a kill that is due WAITS, and draws when the takeover ends with a full
    // LANE_HERO_MS hold from then. Nothing is lost, and the voice is not touched (the queue says the line on time).
    const rd = this._overlays && this._overlays.redeploy;
    const cardUp = !!st.switchCard || this._puCardUp();   // the engine's clock (the ACTIVE bubble's full PU_ACTIVE_CARD_MS), or the DOM
    const takeover = !!this.frame.dataset.takeover || !!(rd && rd.el.isConnected && !rd.el.classList.contains('out')) || cardUp;
    // F400 final (Tony, 2026-09-26): "Not stacked. The weapon switch overlay is on top. When it finishes then the rest of
    // ui is shown." While the card (SWITCHING, then ACTIVE) is up the lanes are hidden, and the engine stops their clocks
    // (`_lanesShown`), so each row and badge still gets its full time once the card has gone. ALT and pickups alike.
    root.classList.toggle('held', cardUp);
    const srcl = t => t ? `<span class="lsrc">${esc(t)}</span>` : '';
    const kindOf = k => { const m = MEDAL_ROWS.find(x => x.key === k); return m ? m.kind : 'multi'; };
    // HERO
    const h = L.hero;
    // a wait for a card that is gone, or whose hold has run out, is dropped (review Low)
    if (this._heroWait && (!h || this._heroWait.id !== h.id || (this._heroWait.until && now > this._heroWait.until + FADE))) this._heroWait = null;
    const w = this._heroWait;
    if (h && h.kills.length && takeover && (w || now < (L.heroUntil || 0))) this._heroWait = { id: h.id, until: 0 };   // due under a takeover: wait
    else if (w && !takeover && !w.until) w.until = now + LANE_HERO_MS;                                                  // the takeover ended: draw now, full hold
    const hw = this._heroWait && h && this._heroWait.id === h.id ? this._heroWait : null;
    const heroUntil = Math.max(L.heroUntil || 0, hw ? hw.until : 0);
    let hero = '';
    if (h && h.kills.length && !takeover && now < heroUntil + FADE) {
      const last = h.kills[h.kills.length - 1], n = h.kills.length;
      const all = h.kills.flatMap(k => (k.medals || []).filter(m => MEDAL_LABEL[m]));
      const big = all.length ? all[all.length - 1] : null, ladder = all.slice(0, -1).reverse(), shown = ladder.slice(0, 2), more = ladder.length - shown.length;
      const vk = last.team ? String(last.team).toLowerCase() : null, tk = vk && TEAM_COLOR[vk] ? vk : null;
      const name = last.victim || `${tk ? tk.toUpperCase() : 'ENEMY'} OPERATIVE`;
      // lanes VQA H1: a centre tell (STUNNED / DISARMED, SMOKED, RECOIL, the OVERHEAT word, TAKING FIRE, a hit's number) is never
      // hidden. While one is up the hero collapses to ONE row above it: KILL ×N and the newest medal.
      const hit = st.moment && st.moment.kind === 'hit' && now - st.moment.at < 700;
      const tell = st.stunned || (st.aim && AIM_REASON[st.aim.reason]) || st.overheatShown || st.underFire || hit;
      if (hit) this._laneTellUntil = st.moment.at + 710;
      hero = `<div class="lh${tell ? ' tight' : ''}${now >= heroUntil ? ' out' : ''}" data-lk="${h.id}" data-id="${h.id}" data-n="${n}"><div class="lhp">`
        + `<div class="lhk">${DS.ICON.kill}<span>KILL</span>${n > 1 ? `<span class="lhx tab">×${n}</span>` : ''}</div>`
        + `<div class="lhn">${tk ? `<i style="background:${TEAM_COLOR[tk]}"></i>` : ''}<span class="vt">${esc(String(name).toUpperCase())}</span></div>`
        + (big ? `<div class="lhm"><span class="medal" data-m="${esc(big)}" data-k="${kindOf(big)}"><span class="unskew">${MEDAL_LABEL[big]}</span></span></div>` : '')
        + '</div>'
        + (shown.length ? `<div class="lhl">${shown.map((m, i) => `<span class="lm" data-m="${esc(m)}" data-k="${kindOf(m)}" style="opacity:${(1 - i * .3).toFixed(2)}">${MEDAL_LABEL[m]}</span>`).join('')}${more > 0 ? `<span class="lm more">+${more}</span>` : ''}</div>` : '')
        + srcl(last.src) + '</div>';
    }
    // OBJECTIVE
    const tk = st.teamKey && TEAM_COLOR[st.teamKey] ? st.teamKey : null, O = L.obj || {}, ours = tk ? TEAM_COLOR[tk] : 'var(--glow)';
    const ICON = { lead: lost => `<svg viewBox="0 0 16 16"><path d="${lost ? 'M2 5h12L8 13z' : 'M2 11h12L8 3z'}"/></svg>`,
      hill: () => '<svg viewBox="0 0 16 16"><path d="M4 1h1.6v14H4zM5.6 2h8l-2.2 3.2 2.2 3.2h-8z"/></svg>' };
    const obj = ['lead', 'hill'].filter(key => O[key]).map(key => {
      const o = O[key], lead = key === 'lead', lost = o.kind === 'lead_lost' || o.kind === 'hill_lost', cap = o.kind === 'hill_capture_started';
      const kick = lead ? (tk ? tk.toUpperCase() : 'YOU') : 'OBJECTIVE', text = lead ? (lost ? 'LOST THE LEAD' : 'TAKES THE LEAD') : (HILL_WORD[o.kind] || 'HILL CAPTURED');
      return `<div class="lo${now - o.at > LANE_SETTLE_MS ? ' settled' : ''}${lost ? ' lost' : ''}" data-lk="${key}:${o.id || o.at}" data-key="${key}" data-kind="${esc(o.kind)}" style="--lc:${lost ? 'var(--bad)' : cap ? 'var(--glow)' : ours}">${ICON[key](lost)}<span class="lot"><span class="lok"><span>${esc(kick)}</span>${srcl(o.src)}</span>${cap ? `<span class="lowr">${capMark(o.team)}<span class="low">${esc(text)}</span></span>` : `<span class="low">${esc(text)}</span>`}</span></div>`;
    });
    // FEED (an alert's family names its colour and its kicker, as the old banner did)
    const FAM = { objective: ['OBJECTIVE', ours], clock: ['CLOCK', 'var(--warn)'], danger: ['ALERT', 'var(--bad)'], info: ['MATCH', 'var(--glow)'] };
    const feed = (L.feed || []).filter(f => now - f.at < LANE_FEED_MS + FADE).slice(0, 3).map(f => {
      const mate = f.kind === 'teammate_down', down = mate || f.kind === 'enemy_down', fam = f.kind === 'alert' ? FAM[ALERT_FAMILY[f.alert] || 'info'] : null;
      const main = down ? `${f.name || `${f.team ? String(f.team).toUpperCase() + ' ' : ''}${mate ? 'TEAMMATE' : 'OPERATIVE'}`} DOWN` : f.text || f.kind;
      const sub = [down && f.by ? `BY ${f.by}` : fam ? fam[0] : f.sub || null, f.src].filter(Boolean).join(' · ');
      const col = mate ? 'var(--warn)' : down ? 'var(--ok)' : fam ? fam[1] : itemColor(f.color);
      return `<div class="lf${now - f.at >= LANE_FEED_MS ? ' out' : ''}" data-lk="${f.id || `${f.at}:${esc(f.kind)}`}" data-kind="${esc(f.kind)}"${fam ? ` data-alert="${esc(f.alert)}" data-fam="${esc(ALERT_FAMILY[f.alert] || 'info')}"` : ''} style="--lc:${col}"><i></i><span class="lft"><span class="lfm">${esc(String(main).toUpperCase())}</span>${srcl(String(sub).toUpperCase())}</span></div>`;
    });
    // lanes VQA H2: sync by key (`data-lk`), never a whole innerHTML rewrite. A node that stays keeps its DOM node, so
    // its entrance animation never re-runs; only a NEW item animates in.
    if (!root.querySelector(':scope > .los')) root.innerHTML = '<div class="lhs"></div><div class="los"></div><div class="lfs"></div>';
    this._laneSync(root.querySelector(':scope > .lhs'), hero ? [hero] : []);
    if (!!hero !== !!this.frame.dataset.hero) { if (hero) this.frame.dataset.hero = '1'; else delete this.frame.dataset.hero; this._railFit(); }   // F368: the rail shows short headlines while a kill card is up
    this._laneSync(root.querySelector(':scope > .los'), obj);
    this._laneSync(root.querySelector(':scope > .lfs'), feed);
    // One flash and one buzz per NEW kill: an MC confirm that names the IR word's row adds no row, so it adds no buzz.
    // A new badge taps, as the banner did.
    const seen = this._laneSeen || (this._laneSeen = { hero: null, n: 0, obj: {} });
    // F368: the buzz is on time (like the voice); the flash waits for the card, so it never lands on a takeover.
    if (h && h.kills.length && now < heroUntil) {
      if (seen.hero !== h.id) { seen.hero = h.id; seen.n = 0; seen.flashed = 0; }
      if (h.kills.length > seen.n) { seen.n = h.kills.length; this.h.onHaptic && this.h.onHaptic('kill'); }
      if (hero && seen.n > (seen.flashed || 0)) { seen.flashed = seen.n; this._flash(); }
    }
    for (const key of ['lead', 'hill']) {
      const o = O[key]; if (!o || seen.obj[key] === (o.id || o.at)) continue;
      seen.obj[key] = o.id || o.at;
      if (now - o.at < 1000) this.h.onHaptic && this.h.onHaptic('tap');
    }
    // draw again at the next change (the hero fading and gone, a feed row leaving, a badge settling or leaving)
    const due = [heroUntil, heroUntil + FADE, this._laneTellUntil || 0,
      takeover && this._heroWait ? now + 200 : 0,   // F368: REDEPLOYED ends on a timer, not a state change
      cardUp ? now + 200 : 0,                       // F400 final: the ACTIVE bubble ends on a timer too
      ...(L.feed || []).flatMap(f => [f.at + LANE_FEED_MS, f.at + LANE_FEED_MS + FADE]),
      ...Object.values(O).map(o => o.at + LANE_SETTLE_MS)].filter(t => t > now);
    if (due.length) this._lanesT = setTimeout(() => this._lanes(this._lastSt || st), Math.min(...due) - now + 10);
  }
export const methods = { _laneSync, _railFit, _lanes };
