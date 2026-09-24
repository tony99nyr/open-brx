// Shield HUD pass (Tony 2026-09-24: "a halo style design pass, similar to the hud in halo games").
//
// Three candidate layouts for the shield meter, switched by `?shieldv=a|b|c` so Tony can pick one. With no
// parameter nothing here runs and the HUD is exactly as before. None of them is the default.
//
//   a  CROWN     a thick, flat, 10-segment bar at the top centre that drains right to left (Halo 3 / Reach);
//                a thin health bar under it; the clock drops beneath the meter.
//   b  ARC       a curved band over the clock that drains from both ends to the centre (Halo 5 / Infinite);
//                a thinner health arc under it; the clock drops beneath the meter.
//   c  VISOR     a long, thin, 5-cell strip along the top edge that drains from both ends to the centre; a
//                health line under it; the clock stays where it is.
//
// Shared rules, every variant:
// - The meter shows only while the game has a shield (`maxShield > 0`) or an overshield is held. The Standard
//   preset without an overshield draws nothing new.
// - No text and no numbers on the meter (Tony 2026-09-24: "just the bar is fine like halo"; DOWN means waiting to
//   respawn here). The bar tells it all: a hit flashes it; broken, the empty track pulses red and the frame is
//   tinted red; during the engine's delay a faint fill creeps along the empty track ("charging up"); then the
//   refill rises with a sweep.
// - Day: the shield is Halo blue; the overshield is a lime layer drawn over it that drains first. Health is a
//   thin mint bar under the shield, so the two greens differ in shade, size and place.
// - Night (spec B4): red only. The overshield is a brighter, double-railed layer (shape and brightness). No
//   flash, no white and no sweep; the one motion is the broken track's slow red brightness pulse.
// - The timing is the engine's: `st.shieldRegen` (engine.js S29) gives the delay and the grant cadence.
//   The sounds are the engine's too: `shield_down` (N101) and `shield_charging` (N102) already play on the gun.
//   The HUD adds no audio.
export const SHIELD_VARIANTS = ['a', 'b', 'c'];

/** The `?shieldv=` pick, or null (today's HUD). */
export function shieldVariant(search) {
  try {
    const v = new URLSearchParams(search != null ? search : (typeof location !== 'undefined' ? location.search : '')).get('shieldv');
    return SHIELD_VARIANTS.includes(v) ? v : null;
  } catch (_) { return null; }
}

const clamp01 = x => (x > 1 ? 1 : x > 0 ? x : 0);
const osOf = st => (st.powerup && st.powerup.overshield) || null;

/** Does the live screen draw the meter? A shield game, or any game while an overshield is held. */
export function meterShown(st) { return st.phase === 'live' && (st.maxShield > 0 || !!osOf(st)); }

/** Everything the meter draws, from the engine's state alone. PURE (bar `now`). */
export function meterModel(st, now = Date.now()) {
  const os = osOf(st);
  const osLeft = os ? Math.max(0, os.left) : 0;
  const base = Math.max(0, (st.shield || 0) - osLeft);
  const max = st.maxShield || 0;
  const sr = st.shieldRegen || null;
  const alive = !!st.alive;
  const down = alive && max > 0 && base === 0 && !os;
  const charging = !!(sr && sr.charging) && !os;
  const waiting = !!(sr && sr.on && !sr.charging && !sr.gaveUp && !os && alive && base < max);
  const elapsed = waiting ? Math.max(0, now - (sr.quietAt || 0)) : 0;
  const delayPct = waiting ? clamp01(elapsed / sr.delayMs) : 0;
  const pct = max > 0 ? clamp01(base / max) : 0;
  const state = down ? 'down' : charging ? 'charge' : pct > 0 && pct <= 0.25 ? 'low' : 'ok';
  return {
    base, max, pct, os: !!os, osLeft, osPct: os && os.amount > 0 ? clamp01(osLeft / os.amount) : 0, onlyOs: !!os && max <= 0,
    hpPct: st.maxHp > 0 ? clamp01((st.hp || 0) / st.maxHp) : 0, state, down, charging, waiting, delayPct, alive,
  };
}

// ---- markup ----
const pctStr = x => `${Math.round(x * 1000) / 10}%`;
/** The arc and the strip drain from both ends to the centre: the visible dash is centred on the path. */
const symDash = p => { const v = Math.round(p * 1000) / 10; return `0 ${Math.round((100 - v) / 2 * 10) / 10} ${v} 100`; };

function barHtml(m) {   // variants a and c: stacked layers in one skewed box
  return `<div class="svbar"><i class="svdly" data-k="dl" style="--w:${pctStr(m.delayPct)}"></i><i class="svgh" data-k="gh" style="--w:${pctStr(m.pct)}"></i><i class="svfl" data-k="fl" style="--w:${pctStr(m.pct)}"></i>`
    + `<i class="svos" data-k="os" style="--w:${pctStr(m.osPct)}"></i><i class="svseg"></i></div>`;
}
// Variant b: one quadratic arc (pathLength 100 so every dash is a percentage), bowed up over the clock.
const ARC = 'M8 38 Q170 -14 332 38', HARC = 'M62 46 Q170 6 278 46';
function arcHtml(m) {
  const p = (cls, k, dash, d = ARC) => `<path class="${cls}" ${k ? `data-k="${k}" ` : ''}d="${d}" pathLength="100"${dash ? ` style="stroke-dasharray:${dash}"` : ''}/>`;
  return `<svg class="svarc" viewBox="0 0 340 50" aria-hidden="true"><defs><mask id="svmask" maskUnits="userSpaceOnUse" x="0" y="-20" width="340" height="80">`
    + `<path d="${ARC}" pathLength="100" stroke="#fff" stroke-width="16" fill="none" stroke-dasharray="9.4 0.6" stroke-dashoffset="-0.3"/></mask>`
    // the recharge sweep runs inside the filled part only: this mask follows the fill (`data-k="fl"`, patched with it)
    + `<mask id="svfillmask" maskUnits="userSpaceOnUse" x="0" y="-20" width="340" height="80"><path data-k="fl" d="${ARC}" pathLength="100" stroke="#fff" stroke-width="16" fill="none" style="stroke-dasharray:${symDash(m.pct)}"/></mask></defs>`
    + p('trk', '', '')
    + `<g mask="url(#svmask)">${p('dl', 'dl', symDash(m.delayPct))}${p('gh', 'gh', symDash(m.pct))}${p('fl', 'fl', symDash(m.pct))}${p('os', 'os', symDash(m.osPct))}${p('os2', 'os2', symDash(m.osPct))}<g mask="url(#svfillmask)">${p('sw', '', '')}</g></g>`
    + p('htrk', '', '', HARC) + p('hp', 'hp', symDash(m.hpPct), HARC) + '</svg>';
}

/** The meter's markup for the live screen (rebuilt only with the screen's structure; `patchMeter` moves it). */
export function meterHtml(st, v, now) {
  const m = meterModel(st, now);
  const hp = v === 'b' ? '' : `<div class="svhp"><i data-k="hp" style="--w:${pctStr(m.hpPct)}"></i></div>`;
  return `<div class="svm sv-${v}" id="svm" data-s="${m.state}"${m.os ? ' data-os=""' : ''}${m.onlyOs ? ' data-only-os=""' : ''} role="meter" aria-label="shield">`
    + (v === 'b' ? arcHtml(m) : barHtml(m))
    + `${hp}</div><div class="svtint" aria-hidden="true"></div>`;
}

/** The `.alive` classes that make room for the meter (and hide the old shield row under the HP). */
export function aliveClass(st, v) { return v && meterShown(st) ? ` sv sv-${v}` : ''; }

/** Moves the meter to `st` in place, and fires the one-shot hit / break flashes on the edges. `fx` is the
 *  HUD's own memory between frames ({shield, base, t}). */
export function patchMeter(hudEl, st, v, fx, now = Date.now()) {
  const el = hudEl && hudEl.querySelector('#svm'); if (!el) { fx.shield = null; return; }
  const m = meterModel(st, now);
  const alive = el.closest('.alive');
  if (el.dataset.s !== m.state) el.dataset.s = m.state;
  el.toggleAttribute('data-wait', m.waiting && !m.charging);
  if (alive) alive.classList.toggle('sv-down', m.down);
  const vals = { gh: m.pct, fl: m.pct, os: m.osPct, os2: m.osPct, hp: m.hpPct, dl: m.delayPct };
  for (const n of el.querySelectorAll('[data-k]')) {
    const x = vals[n.dataset.k]; if (x == null) continue;
    if (n.tagName.toLowerCase() === 'path') { const d = symDash(x); if (n.style.strokeDasharray !== d) n.style.strokeDasharray = d; }
    else { const w = pctStr(x); if (n.style.getPropertyValue('--w') !== w) n.style.setProperty('--w', w); }
  }
  // One-shot flashes: a drop in the TOTAL shield (the overshield included) is a hit; the base pool reaching 0 is
  // the break. The first frame after a rebuild only records, so a re-render never replays a flash.
  const total = st.shield || 0;
  if (fx.shield != null && st.alive && st.phase === 'live') {
    if (total < fx.shield && !m.down) pulse(el, 'hit', 450);   // the break has its own steady pulse (data-s="down")
  }
  fx.shield = total; fx.base = m.base;
}
function pulse(el, cls, ms) {
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add(cls);
  clearTimeout(el._svT); el._svT = setTimeout(() => el.classList.remove(cls), ms);
}
