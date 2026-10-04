// Loadout rendering for the phone HUD.
import { esc, roleName, INFO_SVG, perkGlyph, weaponArt, statBlock } from './shared.js';
/** A secondary rule whose kinds hold `sidearm` but not `weapon` is a pistols-only slot (policy.py, 2026-09-04). */
const sidearmOnly = rule => !!(rule && rule.kinds && rule.kinds.includes('sidearm') && !rule.kinds.includes('weapon'));
// S50 (2026-09-19): every perk carries a GAIN and a COST, computed ONCE on the server
// (`mcp/brx_mcp/mc/perks.py` `gain_cost_lines`) and shipped on the catalogue's `PerkView` as
// `gain`/`cost` string arrays -- this file used to derive its own from `effects` and, before the fix,
// ran every multiplier through `1 / m` and called the result "FASTER" regardless of which side of 1 it
// fell on (Body Armor's `reload_mult: 1.25` printed "RELOADS 0.8× FASTER", a penalty read as a buff).
// The console (`webapp/mc/src/screens/Kit.tsx`) reads the SAME two arrays, so the two UIs cannot
// disagree about a perk's trade again. `short` is for the kit plate, which is about 124 px wide: the
// gain only, with the cost in the browser row and the detail pane where there is room for it. A stale
// server that has not shipped `gain`/`cost` yet degrades to an empty line, never a crash.
const perkGain = p => (p && p.gain) || [];
const perkCost = p => (p && p.cost) || [];
const perkEffect = (p, short) => {
  const gain = perkGain(p), cost = perkCost(p);
  if (short) return gain[0] || 'PASSIVE';
  return [...gain, ...cost].join(' · ') || 'PASSIVE'; };
/** Same line as `perkEffect`, but the cost half tinted in the neutral warning colour (never a team
 *  colour, never red) so a gain and a cost read as two different kinds of fact, not one flat list. */
const perkEffectHtml = p => {
  const gain = perkGain(p), cost = perkCost(p);
  if (!gain.length && !cost.length) return 'PASSIVE';
  const g = gain.length ? `<span style="color:var(--perk,#c48bff)">${gain.map(esc).join(' · ')}</span>` : '';
  const c = cost.length ? `<span style="color:var(--warn)">${cost.map(esc).join(' · ')}</span>` : '';
  return [g, c].filter(Boolean).join(' · '); };
const LOCK_SVG = '<svg class="lockg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="9" width="12" height="9"/><path d="M7 9V6a3 3 0 0 1 6 0v3"/></svg>';

  /** A26: the try-out panel is a KITTED-screen takeover, and under A26 every weapon tap arms a try-out — so
   *  inside the browser it would eject the player from the rack on every pick. While the browser is open the
   *  browser stays: the arming shows as the row's ⟳ → ✓ and the "TRY-OUT ARMED" chip in the action bar. The
   *  panel survives for the one case that is still real: MC pushing a try-out at a player on the plates. */
export function _tryoutShown(st) { return !!(st.tutorial && st.tutorialWeapon && st.tryoutSeen !== st.tutorialWeapon.weapon_id && !st.browsing); }

  // ---------- A10 §4.6: the BRIEFING — the chosen game, read at the player's own pace ----------
export function _briefing(st) {
    const g = st.game || {};
    const mode = g.mode || st.mode || 'tdm';
    const name = g.name || g.mode_name || String(mode).toUpperCase();
    const mins = g.time_limit_s ? Math.round(g.time_limit_s / 60) : null;
    const rs = g.respawn ? (g.respawn.type === 'none' ? 'NONE · LIVES' : `${g.respawn.type === 'scanner' ? 'AT A SCANNER' : 'AUTO'} · ${g.respawn.delay_s}s`) : (g.respawn_text || '—');
    const hp = g.health ? `${g.health.max_hp} HP${g.health.max_armor > 0 ? ` · ${g.health.max_armor} ARMOR` : ''}${g.health.max_shield > 0 ? ` · ${g.health.max_shield} SHIELD` : ''}` : '—';
    const venue = [g.environment ? String(g.environment).toUpperCase() : null, g.night ? 'NIGHT OPS' : null].filter(Boolean).join(' · ') || '—';
    const rows = [['TEAMS', g.teams_text || '—'], ...(g.team_damage === 'off' ? [['TEAM DAMAGE', 'OFF']] : []), ['WIN', g.win_text || '—'], ['RESPAWN', rs], ['TIME', mins ? `${mins} MIN` : '—'], ['LIFE', hp], ['VENUE', venue]];
    const locked = !st.canPickPrimary && !st.canPickSecondary && !st.canPickPerk;
    const cta = locked ? 'SEE MY KIT ▸' : 'BUILD MY KIT ▸';
    const sub = locked ? 'Your kit is set by the host — take a look.' : 'Pick your weapons when you are ready.';
    // QA-20: the host's notes and loadout line are clamped to fit the frame. When the clamp bites (measured in
    // `_fitBriefing`), FULL NOTES opens a panel over the body with every word the host wrote, the ruleset included.
    const more = this.bfMore && (g.desc || g.loadout_line || g.ruleset) ? `<div class="bfmore" role="dialog" aria-label="Full briefing notes">
        ${g.ruleset ? `<div class="mk">RULES</div><div class="mv">${esc(g.ruleset)}</div>` : ''}
        ${g.desc ? `<div class="mk">HOST NOTES</div><div class="mv">${esc(g.desc)}</div>` : ''}
        ${g.loadout_line ? `<div class="mk">LOADOUT</div><div class="mv">${esc(g.loadout_line)}</div>` : ''}</div>` : '';
    const moreBtn = (g.desc || g.loadout_line || g.ruleset) ? `<button class="bfmorebtn" data-act="onBriefMore" aria-expanded="${!!this.bfMore}" ${this.bfMore ? '' : 'hidden'}><span class="unskew">${this.bfMore ? 'CLOSE NOTES ▴' : 'FULL NOTES ▸'}</span></button>` : '';
    return `<div class="lobby bf ${this.bfMore ? 'more' : ''}" data-mode="${esc(mode)}"><div class="scan"></div><div class="edgeglow"></div>
      <div class="bfart"><img src="assets/modes/${esc(mode)}.jpg" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="bfartfb" data-art="fallback" aria-hidden="true">◆</span></div><div class="bfveil"></div>
      ${moreBtn}${more}
      <div class="bfbody${rows.length > 6 ? ' dense' : ''}">
        <div class="bfk r r0">${g.abbr ? `<span class="chip"><span class="unskew">${esc(g.abbr)}</span></span>` : ''}<span class="lab">GAME BRIEFING${g.ruleset ? ' · ' + esc(g.ruleset) : ''}</span></div>
        <div class="bfname r r1">${esc(String(name).toUpperCase())}</div>
        ${g.desc ? `<div class="bfdesc r r2">${esc(g.desc)}</div>` : ''}
        <div class="bfrules r r3">${rows.map(([k, v]) => `<div class="cell"><span class="k">${k}</span><span class="v">${esc(String(v))}</span></div>`).join('')}</div>
        ${g.loadout_line ? `<div class="bfload r r4"><span class="k">LOADOUT</span><span class="v">${esc(g.loadout_line)}</span></div>` : ''}
        ${g.pickups && g.pickups.length ? `<div class="bfpu r r4b"><span class="k">PICKUPS</span><span class="v">${g.pickups.map(p => `<span class="pun" style="--item:${esc(p.color)}">${esc(String(p.name).toUpperCase())}</span>`).join('')}</span></div>` : ''}
      </div>
      <div class="bffoot r r5"><span class="who"><span class="cs">${esc(st.callsign || '')}</span>${st.playerNum ? `<span class="num">#${st.playerNum}</span>` : ''}</span>
        <div class="cta"><button class="ready go" data-act="onBriefDone"><span class="unskew">${cta}</span></button><div class="note">${sub}</div></div></div></div>`;
  }

  // ---------- A10: slot plates + the LOADOUT browser (docs/spec/loadout.md §4.5) ----------
  /** One KITTED plate. `slot` ∈ primary | secondary | perk (A14: the perk is its own slot). */
export function _slotPlate(st, slot, mode, ammoLine) {
    const lo = st.loadout || {}; const item = lo[slot] || null;
    const rule = st.policy ? st.policy[slot] : null;
    const can = slot === 'primary' ? st.canPickPrimary : slot === 'secondary' ? st.canPickSecondary : st.canPickPerk;
    const locked = mode === 'kitted' && st.policy && !can && rule && rule.choice !== 'player';
    const k = slot.toUpperCase();
    const noneSub = slot === 'perk' ? (rule && rule.choice === 'off' ? 'NO PERKS' : 'NO PERK') : (rule && rule.choice === 'off' ? 'NO SECONDARY' : 'NO ALT-FIRE');
    let art = '', h = '', sub = '';
    if (item && item.kind === 'perk') { art = `<div class="thumb perk">${perkGlyph(item.perk_id)}</div>`; h = esc(item.name); sub = esc(perkEffect(item, true)); }   // the line is ~150px wide: the GAIN only (S50), the cost is in the browser row
    else if (item) { art = `<div class="thumb">${weaponArt(item.weapon_id)}</div>`; h = esc(item.name); sub = slot === 'primary' ? (ammoLine || '') : `<span class="nw">MAG ${item.clip != null ? item.clip : '—'} · RES ${item.reserve != null ? item.reserve : '—'}</span>`; }
    else { art = '<div class="thumb none"><span>—</span></div>'; h = 'NONE'; sub = noneSub; }
    if (locked) sub = (rule.choice === 'fixed' ? 'FIXED BY THE HOST' : rule.choice === 'off' ? noneSub : 'SET BY THE HOST');
    const lock = locked ? `<span class="lock" aria-label="locked">${LOCK_SVG}</span>` : (can ? '<span class="cue">▸</span>' : '');
    return `<div class="plate wart slot ${slot === 'perk' ? 'pk' : ''} ${can ? 'tap' : ''} ${locked ? 'locked' : ''}" data-slot="${slot}" ${can ? `data-act="onOpenLoadout" data-arg="${slot}"` : ''}>${art}<div class="in"><div class="k">${k}${lock}</div><div class="h">${h.toUpperCase()}</div><div class="s">${sub}</div></div></div>`;
  }

  /** Rows for a tab: [{key, kind, id, row, allowed}] in catalog order, filtered to the player's pool. */
export function _loRows(st, tab) {
    const cat = st.catalog || { weapons: [], perks: [] }; const rule = st.policy ? st.policy[tab] : null;
    if (tab === 'primary') { const ok = new Set((rule && rule.allowed_ids) || []); return (cat.weapons || []).filter(w => ok.has(w.weapon_id)).map(w => ({ key: 'weapon:' + w.weapon_id, kind: 'weapon', id: w.weapon_id, row: w })); }
    if (tab === 'perk') { const okP = new Set((rule && rule.allowed_perk_ids) || []); return (cat.perks || []).filter(p => okP.has(p.perk_id) && !p.hidden).map(p => ({ key: 'perk:' + p.perk_id, kind: 'perk', id: p.perk_id, row: p })); }   // A14: its own tab
    const okW = new Set((rule && rule.allowed_weapon_ids) || []);
    const kinds = (rule && rule.kinds) || ['weapon'];
    return (kinds.includes('weapon') || kinds.includes('sidearm')) ? (cat.weapons || []).filter(w => okW.has(w.weapon_id)).map(w => ({ key: 'weapon:' + w.weapon_id, kind: 'weapon', id: w.weapon_id, row: w })) : [];   // a pistol is still requested as kind "weapon"
  }
export function _loadout(st) {
    const tab = this.lo.tab === 'secondary' ? 'secondary' : this.lo.tab === 'perk' ? 'perk' : 'primary';
    const lo = st.loadout || {}; const equipped = lo[tab] || null;
    const eqKey = equipped ? (equipped.kind === 'perk' ? 'perk:' + equipped.perk_id : 'weapon:' + equipped.weapon_id) : (tab === 'primary' ? null : 'none');
    const canOf = t => t === 'primary' ? st.canPickPrimary : t === 'secondary' ? st.canPickSecondary : st.canPickPerk;
    const can = canOf(tab);
    const rule = st.policy ? st.policy[tab] : null;
    const cf = this.lo.confirm && this.lo.confirm.tab === tab ? this.lo.confirm : null;   // A14: the pending two-tap confirm
    const pend = st.pendingPick && st.pendingPick.slot === tab ? (st.pendingPick.kind === 'none' ? 'none' : `${st.pendingPick.kind}:${st.pendingPick.id}`) : null;
    const ack = st.loadoutAck && st.loadoutAck.slot === tab ? st.loadoutAck : null;
    // Polish-loop pass 3 (MEDIUM): `tryoutUnconfirmed` used to be a bare flag applied to whatever row/tab
    // was on screen — a perk picked after a timed-out weapon arm inherited its OWN badge, on a row that
    // never armed anything. It now carries {tab, kind}; only the TAB (and, per row, the KIND) it was
    // actually about may show it.
    const unconfHere = !!(st.tryoutUnconfirmed && st.tryoutUnconfirmed.tab === tab);
    const rows = this._loRows(st, tab);
    const tabBtn = (t, item) => { const on = t === tab; const r = st.policy ? st.policy[t] : null; const lk = st.policy && !canOf(t) && r && r.choice !== 'player';
      const nm = item ? item.name : (t === 'primary' ? '—' : 'NONE');
      return `<button class="lotab ${on ? 'on' : ''} ${lk ? 'locked' : ''}" ${lk ? 'disabled aria-disabled="true"' : ''} data-act="onLoTab" data-arg="${t}"><span class="unskew"><span class="k">${t.toUpperCase()}${lk ? ' ' + LOCK_SVG : ''}</span><span class="v">${esc(nm).toUpperCase()}</span></span></button>`; };
    const name = r => r.kind === 'perk' ? r.row.name : r.row.name;
    const focusKey = (this.lo.focus && rows.some(r => r.key === this.lo.focus)) ? this.lo.focus : (eqKey && rows.some(r => r.key === eqKey) ? eqKey : (rows[0] ? rows[0].key : null));
    const focus = rows.find(r => r.key === focusKey) || null;
    let list = '';
    if (!can) {
      const why = rule && rule.choice === 'fixed' ? 'Fixed for this game — the host set it in Mission Control.' : rule && rule.choice === 'off' ? (tab === 'perk' ? 'No perks this game.' : 'No secondary this game.') : 'The host assigns this slot from Mission Control.';
      list = `<div class="lolock"><div class="big">${LOCK_SVG} SET BY THE HOST</div><div class="s">${why}</div>${equipped ? `<div class="cur">${esc(equipped.name).toUpperCase()}</div>` : ''}</div>`;
    } else {
      // A14: slot 2 is weapons only (its chip reads WEAPONS or SIDEARMS); the perk tab has its own PERKS chip; both carry NONE
      const noneBtn = `<button class="fch none ${eqKey === 'none' && pend == null ? 'on' : ''} ${pend === 'none' ? 'pend' : ''}" data-act="onLoNone" data-arg="${tab}"><span class="unskew">NONE${eqKey === 'none' ? ' ✓' : ''}</span></button>`;
      const filt = tab === 'secondary' ? `<div class="lofilt"><button class="fch on" data-act="onLoFilter" data-arg="weapons"><span class="unskew">${sidearmOnly(rule) ? 'SIDEARMS' : 'WEAPONS'} · ${rows.length}</span></button>${noneBtn}</div>`
        : tab === 'perk' ? `<div class="lofilt"><button class="fch on" data-act="onLoFilter" data-arg="perks"><span class="unskew">PERKS · ${rows.length}</span></button>${noneBtn}</div>` : '';
      const head = tab === 'primary' ? `<div class="locount">${rows.length} WEAPON${rows.length === 1 ? '' : 'S'} · SCROLL FOR MORE</div>` : '';
      list = head + filt + (rows.length ? rows.map(r => {
        // F147: MC acked this row (`eqKey`) but engine.js's `tryoutArming` says the gun has not confirmed the
        // write yet — that row keeps the SAME in-flight look (glow border, blinking ⟳) `pend` already has,
        // never the settled ✓, until the gun's own ammo report closes it out. Polish-loop pass 2: past the
        // 3 s timeout `tryoutArming` clears WITHOUT a confirming report — `tryoutUnconfirmed` marks that
        // honestly (`≈`, muted) instead of the same ✓ a real gun-confirmed pick gets.
        const rowUnconf = unconfHere && st.tryoutUnconfirmed.kind === r.kind;
        const eq = r.key === eqKey && !pend && !st.tryoutArming && !rowUnconf,
          arming = r.key === eqKey && !pend && !!st.tryoutArming,
          unconf = r.key === eqKey && !pend && !st.tryoutArming && rowUnconf,
          pn = r.key === pend, fo = r.key === focusKey, rj = !!(ack && !ack.ok && ack.key === r.key), wn = !!(cf && cf.key === r.key);
        const thumb = r.kind === 'perk' ? `<span class="thumb perk">${perkGlyph(r.id)}</span>` : `<span class="thumb">${weaponArt(r.id)}</span>`;
        const body = r.kind === 'perk' ? `<span class="nm2"><b>${esc(name(r)).toUpperCase()}</b><small>${perkEffectHtml(r.row)}</small></span>` : `<span class="nm">${esc(name(r)).toUpperCase()}</span><span class="role">${esc(roleName(r.row))}</span><span class="mag tab">MAG ${r.row.clip != null ? r.row.clip : '—'}</span>`;
        // A26: ✓ = MC acked this pick AND the gun confirmed the write, ⟳ = still arming (the node's debounce
        // window, waiting on MC's ack, or — F147 — MC acked but the gun has not answered the $WEAP write yet),
        // ≈ = the arming window ran out with no confirming report (pass 2: honest, not a real ✓).
        // The ⓘ is how a row is READ without being equipped — tapping the row itself now commits it.
        const info = `<button class="linfo" data-act="onLoInfo" data-arg="${r.key}" aria-label="Details">${INFO_SVG}</button>`;
        return `<div class="lrow ${eq ? 'eq' : ''} ${(pn || arming) ? 'pend' : ''} ${unconf ? 'unconf' : ''} ${fo ? 'fo' : ''} ${rj ? 'rej' : ''} ${wn ? 'warn' : ''}" data-act="onPickItem" data-arg="${r.key}">${thumb}${body}<span class="st">${eq ? '✓' : (pn || arming) ? '⟳' : unconf ? '≈' : wn ? '▲' : ''}</span>${info}</div>`;
      }).join('') : '<div class="small" style="padding:14px 4px">Nothing to pick here for this game.</div>');
    }
    // detail pane
    let detail = '';
    if (focus) {
      const r = focus.row;
      const bar = (label, v) => v == null ? '' : `<div class="tb"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, v))}%"></b></i></div>`;
      // A26 hero tag: the same ⟳-vs-✓ condition the row uses (`pend` is already scoped to this tab), so the
      // hero pane never claims EQUIPPED while the row it belongs to still reads ⟳ waiting on the host's ack.
      // F147 (field 2026-09-12, "shows EQUIPPED/READY on the send; the gun takes a few more seconds"): MC's ack
      // (`eqKey`) is only the network round-trip. `st.tryoutArming` is engine.js's own confirmation that the
      // gun has ANSWERED the new $WEAP write with a matching ammo report — same family as F123, and the same
      // "never claim what the hardware has not confirmed" rule the live SWITCHING takeover already follows.
      // Polish-loop pass 2: the timeout resolution is honest — EQUIPPED · UNCONFIRMED (muted, its own class)
      // rather than the plain EQUIPPED a gun-confirmed pick earns.
      const heroTag = focus.key === pend ? '<span class="eqtag arming">ARMING…</span>'
        : (focus.key === eqKey && !pend && st.tryoutArming) ? '<span class="eqtag arming">SWITCHING…</span>'
        // Shorter than the ackChip's "EQUIPPED · UNCONFIRMED": this badge sits on the SAME nowrap line as
        // the weapon name + role chip (`.lodetail .nm`, `_fitLoDetailName`'s shrink loop only has so much
        // room before 13px stops being legible), and the weapon name here already says what's equipped.
        // Pass 3: gated the same way the row is (`unconfHere` + kind) — a perk's detail pane must never
        // inherit a weapon arm's stale timeout.
        : (focus.key === eqKey && !pend && unconfHere && st.tryoutUnconfirmed.kind === focus.kind) ? '<span class="eqtag unconf">UNCONFIRMED</span>'
        // QA-09: "EQUIPPED" was cut to "EQUIPPE…" beside a long name on both widths; "✓ ON" says the same thing.
        : (focus.key === eqKey && !pend) ? '<span class="eqtag">✓ ON</span>' : '';
      if (focus.kind === 'perk') detail = `<div class="art perk">${perkGlyph(focus.id)}</div><div class="nm">${esc(r.name).toUpperCase()}${heroTag}</div><div class="ln pk">PERK · ${perkEffectHtml(r)}${r.verified === false ? ' · <span style="color:var(--warn)">NOT YET FIELD-TESTED</span>' : ''}</div><div class="desc">${esc(r.desc || '')}</div>`;
      else detail = `<div class="art">${weaponArt(focus.id)}</div><div class="nm">${esc(r.name).toUpperCase()} <span class="rolechip">${esc(roleName(r))}</span>${heroTag}</div><div class="ln">MAG ${r.clip != null ? r.clip : '—'} · RESERVE ${r.reserve != null ? r.reserve : '—'}${r.reload_s != null ? ' · RELOAD ' + r.reload_s + 'S' : ''}</div>${statBlock(r)}${r.caution ? `<div class="caution">▲ ${esc(r.caution)}</div>` : ''}<div class="desc">${esc(r.desc || '')}</div>`;
    } else if (can) detail = `<div class="small" style="padding-top:30px">${tab === 'secondary' ? (sidearmOnly(rule) ? 'Pick a sidearm — or leave it on NONE.' : 'Pick a second weapon — or leave it on NONE.') : tab === 'perk' ? 'Pick a perk — or leave it on NONE.' : 'Pick your main weapon.'}</div>`;
    // A14: the two-tap confirm outranks everything else in the action bar; an ack that dropped the other slot says so
    // F147: MC's ack alone must not read as EQUIPPED while `st.tryoutArming` says the gun has not answered
    // the write yet — SWITCHING… holds the same slot the acked-but-not-yet-armed row does.
    // Pass 3: `unconfHere` is already tab-scoped (a perk tab can never match a weapon arm's tab), so the
    // action bar — one chip per tab, no row of its own — only needs that check, not `kind` again.
    const ackChip = cf ? `<span class="ackchip warn cf"><span class="unskew">${esc(cf.text).toUpperCase()} · TAP AGAIN</span></span>`
      : ack ? `<span class="ackchip ${!ack.ok ? 'bad' : unconfHere ? 'unconf' : 'ok'}"><span class="unskew">${ack.ok ? (st.tryoutArming ? 'SWITCHING…' : unconfHere ? 'EQUIPPED · UNCONFIRMED' : ('EQUIPPED ✓' + (ack.dropped ? ' · ' + esc(ack.dropped.name).toUpperCase() + ' DROPPED' : ''))) : esc(ack.reason || 'THE HOST SAID NO').toUpperCase()}</span></span>` : (pend ? '<span class="ackchip"><span class="unskew">ASKING THE HOST…</span></span>' : (st.tutorial ? '<span class="ackchip warn"><span class="unskew">TRY-OUT ARMED — FIRE A FEW ROUNDS</span></span>' : ''));
    // A26: TRY IT is gone — the pick IS the try-out. The forward action is REVIEW KIT ▸, which closes the rack
    // onto the three-plate kit summary (PRIMARY · SECONDARY · PERK) where READY UP lives; CLOSE is the same
    // exit without the commitment framing.
    return `<div class="lobby lo"><div class="scan"></div><div class="edgeglow"></div>
      <div class="lotop">${tabBtn('primary', lo.primary)}${tabBtn('secondary', lo.secondary)}${tabBtn('perk', lo.perk)}<span class="who"><span class="cs">${esc(st.callsign || '')}</span>${st.playerNum ? `<span class="num">#${st.playerNum}</span>` : ''}</span></div>
      <div class="lobody"><div class="lolist" data-tab="${tab}">${list}</div><div class="lodetail">${detail}</div></div>
      <div class="lobar"><span class="ackslot">${ackChip}</span><button class="lobtn review" data-act="onLoReview"><span class="unskew">REVIEW KIT ▸</span></button><button class="lobtn done" data-act="onLoDone"><span class="unskew">CLOSE</span></button></div></div>`;
  }

export const methods = { _tryoutShown, _briefing, _slotPlate, _loRows, _loadout };
