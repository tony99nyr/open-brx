// Live rendering for the phone HUD.
import { mmss, poolWrong, gunDot, hpPct, hpLow, armorPct, hasArmor, itemColor, num, esc, accShown, splitGun, isEnergyWeapon, chargeCost, AIM_REASON, WARN, magText } from './shared.js';
import * as SV from './shieldmeter.js';
/** pl4 (bench 2026-09-17, Energy Rifle): an energy weapon's reload is a HOLD of the lever. Taps of 0.15-0.23 s
 *  refilled nothing; a hold of 0.7 s or more refilled the whole cell in one step. So the prompt says how, and it
 *  is always steady (never blinking), whether the cell is empty or only below a charge: one calm rule. The
 *  empty-cell digit already warns, and NOT ENOUGH ENERGY shows only while the cell still reads above 0. */
const HOLD_TO_RECHARGE = 'HOLD TO RECHARGE';
const secsLeft = ms => Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
const pctLeft = (left, total) => Math.max(0, Math.min(100, Math.round(100 * (Number(left) || 0) / (Number(total) || 1))));

export function _live(st) {
    const low = hpLow(st) && st.alive;
    // only nag when genuinely low: live+alive, mag known, not a fresh mag (it blinked constantly on the bench)
    const lowMag = !!(st.alive && st.mag && st.ammo < st.mag && st.ammo / st.mag <= .15);
    // bench 2026-09-17: a reload gives nothing back once the reserve is also empty, so RELOAD is a false
    // promise at that point — say OUT OF AMMO instead. The state the HUD gets from the node has no LIVE
    // round count for the other slot (only its catalogue max), so this never guesses a "swap" hint; it
    // would need that count added to the node's state before it could say so honestly.
    const outOfAmmo = !!(st.alive && st.ammo === 0 && st.reserve === 0);
    const energy = isEnergyWeapon(st);
    // Bench 2026-09-17: a charge weapon only (not a tap-only or bullet weapon) -- a live cell too small for
    // one full charge fires nothing, whether that cell is empty or holds a few rounds. `belowCharge` drives
    // both which big prompt shows (severity depends on the reserve, not the cell) and the small note below.
    // A48: the cost comes from the catalogue (`rounds_per_charge`), so a second charge weapon needs no code.
    const cost = chargeCost(st);
    const belowCharge = !!(st.alive && cost != null && st.ammo != null && st.ammo < cost);
    // F257 (bench 2026-09-18): a cell above 0 but below a charge still fires taps (`t37`), so it is
    // not a dead end -- only a truly empty cell (`ammo === 0`) with no reserve is. `outOfAmmo` above
    // already covers exactly that state and picks the ENERGY wording via `energy`, so this only needs
    // to stop claiming a dead end while ammo is still > 0: the note below says why taps are all it has.
    const energyOut = belowCharge && st.ammo === 0 && !(st.reserve > 0);
    // reserve has something to draw on: one calm prompt, whether the cell reads 0 or a partial charge.
    const energyLow = belowCharge && st.reserve > 0;
    // Bench 2026-09-17: the full-screen OVERHEAT takeover was keyed to `st.overheating`, the MECHANIC's
    // reading, which the node echoes back for up to 25 s after the lockout is over (engine.js
    // `HEAT_STALE_MS`). `st.overheatShown` is the DISPLAY window, about 6 s, and the word, the overlay and
    // the heat bar all read it -- maint review 2026-09-17: the bar still read the mechanic, so it could sit
    // hot for up to 19 s after the word had gone. The engine always sets the field, so there is no fallback.
    const overheating = !!(st.alive && st.overheatShown);
    const [nm] = splitGun(st.gun);
    const stat = (k, v) => `<span>${k}<b class="${v == null ? 'mut' : ''}" id="st-${k}">${v == null ? '—' : v}</b></span>`;
    const kb = st.killedBy ? `` : '';
    // QA-02 (2026-09-23): HP, armour and ammo come from the GUN. With the gun link down they are the last
    // values it sent, so they dim and say STALE; they must never read as live. MC's link does not feed them
    // (the gun keeps reporting over BLE), so an MC drop marks the MC-fed numbers instead: K and A.
    const gunStale = !st.bleUp;
    const mcStale = st.wsState !== 'bound';
    const staleTag = '<span class="staletag" aria-label="stale value">STALE</span>';
    const puActive = !!(st.powerup && st.powerup.held && st.powerup.held.active);
    const sv = SV.meterShown(st);   // the shield meter: a shield game, or an overshield held
    return `<div class="alive${gunStale ? ' gunstale' : ''}${mcStale ? ' mcstale' : ''}${sv ? ' sv' : ''}${poolWrong(st) && !gunStale ? ' poolwrong' : ''}${st.alive && st.stunned ? ' stunned' : ''}"><div class="scan"></div><div class="edgeglow"></div><div class="strip l"></div><div class="strip r"></div>
      ${low ? '<div class="firevig"></div>' : ''}
      ${overheating ? '<div class="heatvig"></div><div class="heatword">OVERHEAT</div>' : ''}
      <div class="clockplate" data-act="onBoard" data-arg="team" role="button" aria-label="Team scores"><div class="in"><span class="t tab" id="clock">${mmss(st.clockMs)}</span><span class="m">${esc(st.mode)}</span></div></div>
      <div class="ident" data-act="onBoard" data-arg="player" role="button" aria-label="Player scores"><span class="arrow"></span><span class="cs">${esc(st.callsign || nm)}</span><span class="sq">${esc(st.teamName)} SQUAD</span></div>
      <div class="topright"><span class="link"><span id="linkdot" class="${gunDot(st)}"></span><span id="linklab">${st.bleUp ? 'GUN' : 'NO GUN'}</span></span><button class="link mclink" data-act="onToggleMcPill" aria-label="Mission Control link"><span id="mcdot" class="dot ${st.wsState === 'bound' ? '' : 'ws'}"></span>MC</button>
        <span class="batt tab"><span class="shell"><span class="fill" id="battfill" style="right:${100 - (st.battery || 0)}%"></span></span><span id="batt">${st.battery != null ? st.battery + '%' : '—'}</span></span></div>
      ${st.battery != null && st.battery <= 15 ? `<div class="battwarn">GUN BATT ${st.battery}% — CHARGE SOON</div>` : ''}
      ${this._gunHealthWarning(st)}
      <div class="stats tab">${st.kills > 0 ? stat('K', st.kills) : ''}${st.deaths > 0 ? stat('D', st.deaths) : ''}${st.assists > 0 ? stat('A', st.assists) : ''}${accShown(st) != null ? stat('ACC', accShown(st) + '%') : ''}${mcStale && (st.kills > 0 || st.assists > 0) ? staleTag : ''}</div>
      ${st.alive && st.stunned ? `<div class="aimfx stun" id="stunfx">${this._stunFx(st)}</div>`
        : st.alive && st.aim && AIM_REASON[st.aim.reason] ? `<div class="aimfx ${esc(st.aim.reason)}${overheating ? ' tight' : ''}" id="aimfx">${this._aimFx(st)}</div>`
        : st.alive && st.shielded ? '<div class="spawnshield" role="status"><span class="k">SPAWN SHIELD</span><span class="s">YOU CANNOT BE HIT</span></div>'
        : st.underFire ? '<div class="takingfire"><span class="r"></span><span class="t">TAKING FIRE</span></div>' : '<div class="reticle"></div>'}
      <div class="fxbar" id="fxbar">${this._fx(st)}</div>${sv ? SV.meterHtml(st, this._svFx) : ''}
      <div class="vitals">${poolWrong(st) && !gunStale ? '<div class="pooltag" role="alert">POOLS WRONG</div>' : ''}<div class="nums"><span class="hp tab ${low ? 'low' : ''}" id="hp">${st.hp}</span><span class="hplab">HP</span>${low ? '<span class="lowtag">LOW</span>' : ''}${gunStale ? staleTag : ''}${hasArmor(st) ? `<span class="sh tab ${st.armor === 0 ? 'zero' : ''}" id="sh">${st.armor}</span><span class="hplab armorlabel">ARMOR</span>` : ''}</div>
        <div class="bar ${low ? 'low' : ''}"><i id="hpbar" style="width:${hpPct(st)}%"></i></div>
        ${hasArmor(st) ? `<div class="bar armor"><i id="shbar" style="width:${armorPct(st, this._armPeak)}%"></i></div>` : ''}</div>
      ${st.powerup ? `<div class="puhint" id="puhint" role="status">${this._puHint(st)}</div>` : ''}
      <div class="ammo">${outOfAmmo ? `<span class="reload out solid"><span class="unskew">${energy ? 'OUT OF ENERGY' : 'OUT OF AMMO'}</span></span>`
          : overheating ? `<span class="reload hot solid"><span class="unskew">OVERHEAT</span></span>`
          : energyOut ? `<span class="reload out solid"><span class="unskew">OUT OF ENERGY</span></span>`
          : energyLow ? `<span class="reload solid"><span class="unskew">${HOLD_TO_RECHARGE}</span></span>`
          : lowMag ? (energy ? `<span class="reload solid"><span class="unskew">${HOLD_TO_RECHARGE}</span></span>`
            : `<span class="reload ${st.ammo === 0 ? 'solid' : ''}"><span class="unskew">RELOAD ▸▸</span></span>`) : ''}
        <div class="nums">${gunStale ? staleTag : ''}<span class="mag tab ${lowMag ? 'warn' : ''}" id="mag">${magText(st)}</span><span class="res tab" id="res">${this._resText(st)}</span></div>
        ${belowCharge && st.ammo > 0 && !overheating ? '<div class="enote">NOT ENOUGH ENERGY</div>' : ''}
        <div class="pips" id="pips">${this._pips(st)}</div>
        ${this._heatBar(st)}
        ${st.powerup ? `<div class="puheld" id="puheld">${this._puHeld(st)}</div>` : ''}
        <span class="wn"><span class="slot">${puActive || st.activeSlot >= 2 ? 'PICKUP' : st.activeSlot ? 'SECONDARY' : 'PRIMARY'}</span>${esc(st.weapon)}</span></div>
      <div class="nightlab${st.powerup && this._puHint(st) ? ' pu' : ''}">NIGHT OPS</div>${kb}${this.board ? this._board(st) : ''}</div>`;
  }
  /** A56 (docs/spec/powerups.md): the powerup station hint, centre-bottom between the vitals and the ammo. A 1 s ring
   *  while the player stands at the station (HOLD STILL), or the item once granted. F425 (2026-09-26): the
   *  always-on TAKEN hint and its countdown to the next spawn are gone; the left-side "<ITEM> AVAILABLE" feed
   *  alert at each spawn is the only signal for an unclaimed or unclaimable station. */
export function _puHint(st) {
    const h = st.presented.hint; if (!h) return '';
    // F400 decision 3: while the switch card is up, hide the small hint chip for a weapon grant or a switch-back --
    // the card says the same thing, louder. The Overshield never gets a card (decision 5), so its own `granted`
    // hint (PICKED UP) is never hidden; the held chip beside the ammo is untouched either way. Read `st.switching`
    // directly (not `this.frame.dataset.takeover`, which `_moments` sets AFTER this same render's `_patch` call --
    // a DOM-attribute check here would lag the card's own opening render by one pass) for the SWITCHING phase; the
    // brief ACTIVE confirm bubble is still read off the overlay, `_puCardUp()`'s own job.
    if ((h.kind === 'switched_back' || (h.kind === 'granted' && h.itemKind !== 'overshield')) && (!!st.switching || this._puCardUp())) return '';
    const name = esc(h.name || ''), c = itemColor(h.color);
    const ring = p => `<span class="puring" style="--p:${Math.max(0, Math.min(1, p)).toFixed(3)}" aria-hidden="true"><i></i></span>`;
    const line = (act, lab, extra = '', ready = false) => `<span class="pu" data-kind="${esc(h.kind)}"${ready ? ' data-ready="1"' : ''} style="--item:${c}">${extra}<span class="put"><span class="pua">${act}</span>${lab ? `<span class="pul">${lab}</span>` : ''}</span></span>`;
    switch (h.kind) {
      case 'claiming': return h.ready ? line('CONFIRMING', name, ring(1), true) : line('HOLD STILL', name, ring(h.progress || 0));
      case 'no_answer': return line('NOT ANSWERING', `${name} STATION`);   // no ring: nothing is filling any more; two short lines, never four
      // Tony 2026-09-24, "straight to trigger": a weapon item is already on the trigger, so the hint says so and how many
      // shots it holds (the callout card already said any swap); the overshield just is
      case 'granted': return h.itemKind === 'overshield' ? line(name, 'PICKED UP')
        : line(`${name} ON TRIGGER`, h.charges != null ? `${h.charges} SHOT${h.charges === 1 ? '' : 'S'}` : '');
      case 'approach': return line('GET CLOSER', name);
      case 'switched_back': return line(`${name} EMPTY`, `BACK TO ${esc(h.to || '')}`);   // the phone put the saved weapon back on the trigger
      default: return '';
    }
  }
  /** A56: the held weapon item beside the ammo, with its charges left, lit while it is on the trigger. SELECT toggles the
   *  trigger between the heavy and the player's weapon (Tony, 2026-09-24), so the chip names the button. One line. */
export function _puHeld(st) {
    const h = st.powerup && st.powerup.held; if (!h) return '';
    return `<span class="puchip${h.active ? ' on' : ''}" style="--item:${itemColor(h.color)}"><i class="sw"></i><span class="nm">${esc(h.name)}</span><b class="tab" id="puleft">${h.left}</b><span class="sel">SELECT</span></span>`;
  }
  /** F288: a trigger-path failure needs to reach the player, not live only in MC diagnostics. `no_answer`
   *  is conclusive and names the host-side cure. `no_fire` is the earlier, recoverable observation; silence
   *  alone is intentionally omitted because the existing GUN LINK state owns connectivity. */
export function _gunHealthActive(st) {
    if (!st.alive || !st.bleUp || st.gunFlapping || st.resync || st.reconciling) return false;
    return !!(st.spawnLost || (st.cure && st.cure.verdict === 'no_answer') || (st.poolStale && st.poolStale.why === 'no_fire'));
  }
export function _gunHealthWarning(st) {
    if (!this._gunHealthActive(st)) return '';
    if (st.spawnLost) return `<div class="gunwarn danger" role="alert"><b>${WARN.spawn_lost.head}</b> <span>${WARN.spawn_lost.sub}</span></div>`;
    if (st.cure && st.cure.verdict === 'no_answer') {
      return `<div class="gunwarn danger" role="alert"><b>${WARN.no_answer.head}</b> <span>${WARN.no_answer.sub}</span></div>`;
    }
    if (st.poolStale && st.poolStale.why === 'no_fire') {
      return `<div class="gunwarn warn" role="status" aria-live="polite"><b>${WARN.no_fire.head}</b> <span>${WARN.no_fire.sub}</span></div>`;
    }
    return '';
  }
  /** S16: the poison pill, just above the health it is draining. It counts the stack down and names the applier,
   *  because a player watching health fall with no hit on screen otherwise reports a bug (Tony, 2026-09-18). Patched
   *  in place every render, so the countdown moves without a rebuild. Empty when nothing ticks. */
export function _fx(st) {
    const p = st.alive && st.poison;
    if (!p) return '';
    const by = p.by && (p.by.name || (p.by.num ? '#' + p.by.num : ''));
    return `<div class="fx poison" data-fx="poison"><span class="g" aria-hidden="true">☣</span><span class="k">POISONED</span>`
      + `<span class="t tab" id="fxpoison">${secsLeft(p.leftMs)}<small>SEC</small></span><span class="s">-${esc(p.perTick)} EVERY ${esc(secsLeft(p.tickMs))} S${by ? ' · ' + esc(String(by).toUpperCase()) : ''}</span>`
      + `<i class="drain"><b style="width:${pctLeft(p.leftMs, p.durMs)}%"></b></i></div>`;
  }
  /** S53: the accuracy pill's body -- the reason, what it means, and the count to it clearing (the gun holds a
   *  smoke's accuracy at 0 for about 6 s, then gives it back in one step). */
export function _aimFx(st) {
    const a = st.aim; const r = a && AIM_REASON[a.reason];
    if (!r) return '';
    return `<span class="k">${r.word}</span><span class="s">${r.sub}</span><span class="t tab" id="aimleft">${secsLeft(a.leftMs)}<small>SEC</small></span>`
      + `<i class="clr"><b style="width:${pctLeft(a.leftMs, a.totalMs)}%"></b></i>`;
  }
  /** F15 x QA review 2026-09-23: an EMP has disarmed the gun (`st.stunned`, engine `_stun`). The trigger does
   *  nothing until the timer runs out, so the centre slot says so and counts it down. Patched every render. */
export function _stunFx(st) {
    const s = st.stunned; if (!s) return '';
    return `<span class="k">STUNNED</span><span class="s">YOUR GUN IS DISARMED</span><span class="t tab" id="stunleft">${secsLeft(s.leftMs)}<small>SEC</small></span>`;
  }

  /** True when the LAST board MC pushed has this player's team (or, in FFA, this player) one off the cap. The
   *  board may be stale — that is the point: this line makes no claim about the score, only about who confirms it. */
export function _atCapMinusOne(st) {
    const bd = st.board && typeof st.board === 'object' ? st.board : null;
    const cap = num(bd && bd.cap) != null ? bd.cap : num(st.fragLimit);
    if (cap == null || cap < 2) return false;
    const mine = (bd && Array.isArray(bd.teams)) ? bd.teams.find(t => t && String(t.team_id == null ? '' : t.team_id).toLowerCase() === st.teamKey) : null;
    return [num(mine && mine.score), num(st.kills)].some(v => v != null && v >= cap - 1 && v < cap);
  }

export const methods = { _live, _puHint, _puHeld, _gunHealthActive, _gunHealthWarning, _fx, _aimFx, _stunFx, _atCapMinusOne };
