// Ammo rendering for the phone HUD.
import { AMMO_PIP_MAX, usesCellGauge } from './shared.js';

  /** Bench 2026-09-17: the ammo gauge's shot-ready cue. After a shot from a weapon with at least 400 ms between
   *  rounds the engine reports {at, ms, leftMs}; the gauge dims (`data-cool="on"` on the frame, which survives a
   *  structural rebuild) until `leftMs` has passed, then shines once (`ready`, 250 ms). The timer starts at this
   *  render, after the engine read `leftMs`, so the shine can only be late, never early. Timers only: no per-frame work. */
export function _shotCue(st) {
    const c = st.phase === 'live' ? st.shotCooldown : null;
    const at = c ? c.at : null;
    if (at === this._cueAt) return;
    this._cueAt = at;
    if (this._cueT) { clearTimeout(this._cueT); this._cueT = null; }
    if (!c || !(c.leftMs > 0)) { delete this.frame.dataset.cool; return; }   // no cue, or the render came after the round was due
    this.frame.dataset.cool = 'on';
    this._cueT = setTimeout(() => {
      this.frame.dataset.cool = 'ready';
      this._cueT = setTimeout(() => { this._cueT = null; delete this.frame.dataset.cool; }, 250);
    }, c.leftMs);
  }
  /** Bench 2026-09-17 (Tony): "25% /80" made no sense -- a percentage beside a reserve in ROUNDS, on a
   *  weapon with no rounds. A bullet weapon (and, per F248, a low-cost energy weapon like the Rail Gun)
   *  keeps `/reserve`; a cell-gauge weapon gets one pill per FULL spare cell (floor(reserve / clip)) plus a
   *  dimmer half-filled pill for a part cell (reserve % clip > 0), and nothing at all once the reserve is
   *  empty (the OUT OF ENERGY prompt already says that). */
export function _resText(st) {
    if (!usesCellGauge(st)) return `/${st.reserve != null ? st.reserve : '—'}`;
    const clip = st.mag || Math.max(st.ammo, 1);
    const reserve = st.reserve || 0;
    if (!(reserve > 0)) return '';
    const full = Math.floor(reserve / clip);
    const left = reserve % clip;
    let s = ''; for (let i = 0; i < full; i++) s += '<i class="cell"></i>';
    // Bench 2026-09-18 (Tony): "the little amber shells did not deplete correctly, they appeared to be
    // half full after a reload". The part cell was painted at a FIXED half, so 5 rounds and 39 rounds
    // looked identical. Fill it at its real fraction instead, with a floor so a nearly empty cell is
    // still visible rather than a sliver of nothing.
    if (left > 0) {
      const pct = Math.max(12, Math.round(100 * left / clip));
      s += `<i class="cell partial" style="--fill:${pct}%"></i>`;
    }
    return `<span class="cells">${s}</span>`;
  }
  /** Bench 2026-09-17: the thin build-up bar for a weapon that heats ($ALCD token 5), shown only once the
   *  active slot has reported heat>0 this life (`heatEverSeen`) -- a weapon that never heats never draws
   *  this at all. `hot` reads `overheatShown`, the SAME field as the OVERHEAT prompt and overlay in `_live()`,
   *  so the bar and the word can never disagree (maint review 2026-09-17: it read `st.overheating`, the
   *  mechanic's 25 s window, and stayed hot for up to 19 s after the word cleared). */
export function _heatBar(st) {
    if (!st.heatEverSeen) return '';
    const pct = Math.max(0, Math.min(100, Math.round(st.heat || 0)));
    return `<div class="heat ${st.overheatShown ? 'hot' : ''}" id="heat"><i style="width:${pct}%"></i></div>`;
  }
  /** A cell-gauge weapon (F248: `rounds_per_charge > 1`, see usesCellGauge above) gets the percentage bar
   *  (no round to pip). Everything else -- a bullet weapon, or a low-cost energy weapon like the Rail Gun
   *  -- gets one pip per round up to AMMO_PIP_MAX; above it, a continuous bar (the exact count is already
   *  the digits beside this gauge, in `#mag`/`#res`). Same warn rule throughout: alive, a known mag, at or
   *  under 15% left. */
export function _pips(st) {
    const mag = st.mag || Math.max(st.ammo, 1);
    const warn = !!(st.alive && st.mag && st.ammo < st.mag && st.ammo / st.mag <= .15);
    if (usesCellGauge(st)) {
      const pct = Math.max(0, Math.min(100, Math.round(100 * st.ammo / mag)));
      return `<div class="bar energy ${warn ? 'warn' : ''}"><i style="width:${pct}%"></i></div>`;
    }
    if (mag > AMMO_PIP_MAX) {
      const pct = Math.max(0, Math.min(100, Math.round(100 * st.ammo / mag)));
      // "ammobar" (not "ammo"): the ammo COLUMN also uses `.ammo` (position:absolute;right:36px;bottom:32px),
      // and this bar sits inside `.pips`, which is `position:relative` -- a shared class name here pulled
      // the bar out of flow and made it float over the mag digits (bench 2026-09-17).
      return `<div class="bar ammobar ${warn ? 'warn' : ''}"><i style="width:${pct}%"></i></div>`;
    }
    const lit = Math.max(0, Math.min(mag, Math.round(st.ammo)));
    let s = ''; for (let i = 0; i < mag; i++) s += `<i class="${i < lit ? (warn ? 'warn' : '') : 'spent'}"></i>`;
    return s;
  }

export const methods = { _shotCue, _resText, _heatBar, _pips };
