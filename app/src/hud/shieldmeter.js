// The shield meter: the Visor (Tony 2026-09-24, picked from three Halo-style candidates: "C but maybe a hair taller").
// A long strip along the top edge that drains from both ends to the centre. Health is NOT on it (Tony: "why do we have
// health displayed in two places?"): it stays bottom left. The clock, the identity block and the chips stay put.
//
// - The meter shows while the game has a shield (`maxShield > 0`) or an overshield is held. The Standard preset without
//   an overshield draws nothing new.
// - No text and no numbers on the meter (Tony: "just the bar is fine like halo"; DOWN means waiting to respawn here).
//   The bar tells it all: a hit flashes it; broken, the empty track pulses red and the frame is tinted red; during
//   the engine's delay a faint fill creeps along the empty track ("charging up"); then the refill rises with a sweep.
// - Day: the shield is Halo blue; the overshield is a lime layer drawn over it that drains first. Health is a thin
//   mint bar bottom left, so the two greens differ in shade, size and place. The overshield never fades: only
//   hits remove it (Tony: "doesnt fade. only hits"; engine OVERSHIELD_DECAY_PER_S = 0).
// - Night (spec B4): red only. The overshield is a brighter, double-railed layer (shape and brightness). No flash,
//   no white and no sweep; the one motion is the broken track's slow red brightness pulse.
// - The timing is the engine's: `st.shieldRegen` (engine.js S29) gives the delay and the grant cadence. The sounds
//   are the engine's too: `shield_down` (N101) and `shield_charging` (N102) already play on the gun. No phone audio.
// - F349 (Tony, field 2026-09-24: "the hud animation is kinda chunky it doesn't grow smoothly"): the refill is drawn
//   from the engine's own recharge clock (`shieldRegen.startedAt/from/fullAt`), a straight line from where it started
//   to full, and never more than one grant ahead of the pool the gun reported. By day it moves at frame rate
//   (`requestAnimationFrame`); at night and under reduced motion it moves only with the HUD's own patch.
const clamp01 = x => (x > 1 ? 1 : x > 0 ? x : 0);
/** HUD QA R2-04: the delay creep is a hint that the refill is coming, never a pool. Drawn across the whole track it
 *  reached 93% on an empty shield and read "nearly full, then empty", so it stops at this share of the track. */
export const DELAY_CREEP_MAX = 0.3;
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
  // BROKEN is the engine's latch (`shieldRegen.down`): a fresh life at 0 has not broken, so it gets no red pulse and no tint
  const down = alive && max > 0 && base === 0 && !os && !!(sr && sr.down);
  const charging = !!(sr && sr.charging) && !os;
  // `paused`: the engine's refill stands down (stunned, resyncing, the link down...), so the creep must not fill and hold
  const waiting = !!(sr && sr.on && !sr.charging && !sr.gaveUp && !sr.paused && !os && alive && base < max);
  const elapsed = waiting ? Math.max(0, now - (sr.quietAt || 0)) : 0;
  const delayPct = waiting ? DELAY_CREEP_MAX * clamp01(elapsed / sr.delayMs) : 0;
  // the refill stands down (a stun, a resync): the creep holds where it was, not empty and not still filling
  const frozen = !!(sr && sr.paused && sr.on && !sr.charging && !sr.gaveUp && !os && alive && base < max);
  const pct = max > 0 ? clamp01(base / max) : 0;
  const state = down ? 'down' : charging ? 'charge' : pct > 0 && pct <= 0.25 ? 'low' : 'ok';
  return {
    base, max, pct, fill: fillPct(st, sr, charging, base, max, pct, now), os: !!os, osLeft, osAmount: os ? os.amount || 0 : 0, osPct: os && os.amount > 0 ? clamp01(osLeft / os.amount) : 0, onlyOs: !!os && max <= 0,
    state, down, charging, waiting, frozen, delayPct, alive,
  };
}

/** F349: the fill the meter draws. At rest it is the pool. During a recharge it is a straight line from `from` at
 *  `startedAt` to the max at `fullAt` (the engine's own grant clock), capped at one grant above the pool the gun has
 *  reported, so a slow link holds the bar back instead of drawing a full shield the gun does not have. PURE. */
function fillPct(st, sr, charging, base, max, pct, now) {
  if (!charging || !(max > 0) || !sr || sr.startedAt == null || sr.fullAt == null) return pct;
  const from = sr.from || 0, span = Math.max(1, sr.fullAt - sr.startedAt);
  const line = from + (max - from) * clamp01((now - sr.startedAt) / span);
  return clamp01(Math.min(line, base + (sr.step || 0)) / max);
}

// A stun freezes the delay creep where it stood (`fx.dl`), stamped with the `quietAt` it was measured from (`fx.dlq`).
// A hit during the stun restamps `quietAt`: the delay starts over, so the old width is stale and the freeze is cleared.
const quietOf = st => (st.shieldRegen && st.shieldRegen.quietAt) || 0;
function frozenAt(m, st, fx) {
  if (!m.frozen || fx.dl == null) return false;
  if (fx.dlq === quietOf(st)) return true;
  fx.dl = m.delayPct; fx.dlq = quietOf(st); return false;
}

// ---- markup ----
const pctStr = x => `${Math.round(x * 1000) / 10}%`;
/** For a screen reader only: the meter shows no number (Tony: "just the bar"). The overshield counts on top of the max. */
const ariaVals = m => ({ 'aria-valuemin': '0', 'aria-valuemax': String(m.max + (m.os ? m.osAmount : 0)), 'aria-valuenow': String(m.base + m.osLeft) });
const aria = m => Object.entries(ariaVals(m)).map(([k, v]) => `${k}="${v}"`).join(' ');

/** The markup for the live screen (rebuilt only with the screen's structure; `patchMeter` moves it). The strip drains
 *  from both ends to the centre, so every layer is centred (CSS). */
export function meterHtml(st, fx = {}, now) {
  const m = meterModel(st, now);
  if (frozenAt(m, st, fx)) m.delayPct = fx.dl;   // a rebuild during a stun keeps the creep where it stood
  return `<div class="svm" id="svm" data-s="${m.state}"${m.os ? ' data-os=""' : ''}${m.onlyOs ? ' data-only-os=""' : ''}${m.waiting ? ' data-wait=""' : ''} role="meter" aria-label="shield" ${aria(m)}>`
    + `<div class="svbar"><i class="svgh" data-k="gh" style="--w:${pctStr(m.fill)}"></i><i class="svfl" data-k="fl" style="--w:${pctStr(m.fill)}"></i>`
    // the delay creep comes AFTER the fill and the overshield, so it paints over a part-full shield too
    + `<i class="svos" data-k="os" style="--w:${pctStr(m.osPct)}"></i><i class="svdly" data-k="dl" style="--w:${pctStr(m.delayPct)}"></i><i class="svseg"></i></div></div><div class="svtint" aria-hidden="true"></div>`;
}

/** Moves the meter to `st` in place, and fires the one-shot hit flash. `fx` is the HUD's own memory between frames. */
export function patchMeter(hudEl, st, fx, now = Date.now()) {
  const el = hudEl && hudEl.querySelector('#svm'); if (!el) { fx.shield = null; return; }
  const m = meterModel(st, now);
  const alive = el.closest('.alive');
  if (el.dataset.s !== m.state) el.dataset.s = m.state;
  el.toggleAttribute('data-wait', m.waiting);
  for (const [k, v] of Object.entries(ariaVals(m))) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
  if (alive) alive.classList.toggle('sv-down', m.down);
  if (frozenAt(m, st, fx)) m.delayPct = fx.dl; else { fx.dl = m.delayPct; fx.dlq = quietOf(st); }
  const vals = { gh: m.fill, fl: m.fill, os: m.osPct, dl: m.delayPct };
  for (const n of el.querySelectorAll('[data-k]')) {
    const x = vals[n.dataset.k]; if (x == null) continue;
    const w = pctStr(x); if (n.style.getPropertyValue('--w') !== w) n.style.setProperty('--w', w);
  }
  // A drop in the TOTAL shield (the overshield included) is a hit. The first frame after a rebuild only records, so a
  // re-render never replays a flash.
  const total = st.shield || 0;
  if (fx.shield != null && st.alive && st.phase === 'live') {
    if (total < fx.shield && !m.down) pulse(el, 'hit', 450);   // the break has its own steady pulse (data-s="down")
  }
  fx.shield = total;
  fx.st = st;   // F349: the frame-rate fill reads the latest state
  const smooth = m.charging && !reducedMotion() && !el.closest('[data-env="night"]') && typeof requestAnimationFrame === 'function';
  el.toggleAttribute('data-raf', smooth);   // CSS: no width transition while the fill moves every frame
  if (smooth && !fx.raf) fx.raf = requestAnimationFrame(() => fillFrame(hudEl, fx));
}
const reducedMotion = () => { try { return !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } };
/** F349: one animation frame of the refill. Stops itself when the recharge ends or the meter is gone. */
function fillFrame(hudEl, fx) {
  fx.raf = 0;
  const el = hudEl && hudEl.querySelector('#svm'); if (!el || !fx.st) return;
  const m = meterModel(fx.st, Date.now());
  if (!m.charging || !el.hasAttribute('data-raf')) return;
  const w = pctStr(m.fill);
  for (const n of el.querySelectorAll('[data-k="fl"], [data-k="gh"]')) if (n.style.getPropertyValue('--w') !== w) n.style.setProperty('--w', w);
  fx.raf = requestAnimationFrame(() => fillFrame(hudEl, fx));
}
function pulse(el, cls, ms) {
  el.classList.remove('hit'); void el.offsetWidth; el.classList.add(cls);
  clearTimeout(el._svT); el._svT = setTimeout(() => el.classList.remove(cls), ms);
}
