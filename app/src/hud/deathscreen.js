// The DOWN screen's recap (Tony, 2026-09-23: "a video game death screen like stats ... damage dealt and damage taken
// and from what sources", then "a video game recap of what you did in that life and the current game state").
// Pure functions of engine state: `hud.js` places the HTML they return. Nothing here invents a number.
//  - THIS LIFE reads `st.lastLife` (engine.js `_ledgerSnapshot`): what hit you (per source and weapon), what you
//    dealt (MC's best-effort relays, so PARTIAL or pending rather than a false zero), shots, kills and time alive.
//  - THE GAME NOW reads what the phone already holds: MC's last `score` push (team race, FFA rows, cap), the
//    match clock and the hill as this phone last heard it. An old board is shown with its age, never as current.

const TEAM_COLOR = { blue: 'var(--team-blue)', yellow: 'var(--team-yellow)', red: 'var(--team-red)', green: 'var(--team-green)' };
const TEAM_INK = { blue: '#04121e', yellow: '#1a1400', red: '#1a0404', green: '#041a0c' };
const TID_KEY = { 0: 'red', 1: 'blue', 2: 'yellow', 3: 'green' };
const HILL_NEUTRAL_TID = 2;   // engine.js HILL_NEUTRAL_TEAM: a neutral point broadcasts team 2
const ROWS = 3;               // sources / victims listed before the "+N MORE" line: the screen is read during a timed respawn

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
const up = s => esc(String(s == null ? '' : s).toUpperCase());
const pad2 = n => String(Math.max(0, Math.floor(n))).padStart(2, '0');
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad2(s / 60)}:${pad2(s % 60)}`; };
const ordinal = n => { const t = n % 100, o = n % 10; return n + (t >= 11 && t <= 13 ? 'TH' : o === 1 ? 'ST' : o === 2 ? 'ND' : o === 3 ? 'RD' : 'TH'); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** One weapon's name as the screen says it: the name, "A OR B" for a two-way ambiguity, WEAPON UNCLEAR past that.
 *  Null when the phone has no claim at all (an older MC, or a poison tick), so the caller prints nothing. */
export function weaponLabel(w) {
  if (!w) return null;
  if (w.ambiguous) { const n = Array.isArray(w.names) ? w.names : []; return n.length && n.length <= 2 ? n.map(up).join(' OR ') : 'WEAPON UNCLEAR'; }
  return w.name ? up(w.name) : null;
}

/** A row's second line: its biggest weapon, PICKUP when it came off the wider catalogue, "+N" for the others; the
 *  hit count only when no weapon is named, so the line never wraps at the frame's width. */
function weaponLine(row) {
  const ws = (row.weapons || []).slice().sort((a, b) => b.dmg - a.dmg);
  const top = ws[0], label = weaponLabel(top);
  const parts = [];
  if (label) parts.push(`${label}${top.pickup ? ' <i class="pk">PICKUP</i>' : ''}${ws.length > 1 ? ` +${ws.length - 1}` : ''}`);
  else if (num(row.hits)) parts.push(plural(row.hits, 'HIT', 'HITS'));   // a named weapon fills the line; hits only when nothing is named
  if (num(row.ticks)) parts.push(`POISON ×${row.ticks}`);   // S16 ticks book against the poisoner, never as hits
  return parts.join(' · ');
}

/** The line under KILLED BY: the killing hit's weapon, its damage and where it landed. Only when the booked final
 *  hit belongs to the named killer (or the killer is unknown), so a stale hit from someone else is never shown as
 *  the kill. Empty when the phone booked no hit this life (a gun restart, a desync). */
export function finalHitLine(st) {
  const life = st.lastLife, kb = st.killedBy || {}, fh = life && life.finalHit;
  if (!fh) return '';
  if (kb.unknown ? fh.num !== 0 : kb.num != null && fh.num !== kb.num) return '';   // an unknown killer means a stale latch: its hit is not the kill
  const parts = [];
  const w = fh.dot || kb.dot ? 'POISON' : weaponLabel(fh.weapon);
  if (w) parts.push(`<span class="fw">${w}</span>${fh.weapon && fh.weapon.pickup ? ' <i class="pk">PICKUP</i>' : ''}`);
  parts.push(`${fh.dot ? 'FINAL TICK' : 'FINAL HIT'} <b class="tab">${num(fh.dmg) != null ? fh.dmg : '—'}</b>`);
  if (!fh.dot && fh.sensor != null) parts.push(fh.sensor === 4 ? 'ON YOUR GUN' : 'ON YOUR HEADSET');
  if (fh.crit) parts.push('CRIT');
  return `<span class="fh" id="dsfinal">${parts.map(p => `<span class="nw">${p}</span>`).join(' · ')}</span>`;   // wraps only between parts
}

/** THIS LIFE: time alive, rounds fired and kills. A kill reaches this phone only as MC's confirm, which MC drops when
 *  the victim's report arrives late (scoring.py, FEEDBACK_MAX_AGE_MS), so the count says CONFIRMED: never a claim that
 *  no other kill happened. While `dealtPartial` it reads "N+", or NOT YET CONFIRMED for none. No accuracy: the gun
 *  reports rounds, not trigger pulls, so a charge weapon's hits over rounds would read far too low. */
export function lifeLine(st) {
  const life = st.lastLife; if (!life) return '';
  const partial = !!life.dealtPartial;
  const kills = num(life.kills) || 0, shots = num(life.shots) || 0;
  const k = partial && !kills ? 'KILLS NOT YET CONFIRMED'
    : `<b class="tab">${kills}${partial ? '+' : ''}</b> ${kills === 1 && !partial ? 'KILL' : 'KILLS'} CONFIRMED`;
  const parts = [`<b class="tab">${mmss(num(life.aliveMs) || 0)}</b> ALIVE`, `<b class="tab">${shots}</b> ${shots === 1 ? 'ROUND' : 'ROUNDS'}`, k];
  return `<div class="dsl" id="dslife"><span class="dh">THIS LIFE</span><span class="dv">${parts.join(' · ')}</span></div>`;
}

function rows(list, kind, killerNum) {
  // Three rows fit; a fourth source turns the third row into the "+N MORE" line, so the block never grows past three.
  const cut = list.length > ROWS ? ROWS - 1 : ROWS;
  const shown = list.slice(0, cut), rest = list.slice(cut);
  const html = shown.map(r => {
    const tk = kind === 'taken' ? r.teamKey : null;
    const killer = kind === 'taken' && killerNum != null && r.num === killerNum;
    const name = r.name || (kind === 'taken' && r.num === 0 ? 'NO IDENTITY' : 'UNKNOWN');
    const wl = weaponLine(r);
    return `<div class="dr${killer ? ' killer' : ''}"><span class="tk" style="${tk ? `background:${TEAM_COLOR[tk]}` : 'background:var(--mut)'}"></span>`
      + `<span class="dn1"><span class="nm">${up(name)}${killer ? ' <i class="kx">KILLER</i>' : ''}</span><b class="tab">${num(r.dmg) != null ? r.dmg : '—'}</b></span>`
      + (wl ? `<span class="dn2">${wl}</span>` : '') + '</div>';
  }).join('');
  const more = rest.length ? `<div class="dmore">+${rest.length} MORE · <b class="tab">${rest.reduce((s, r) => s + (num(r.dmg) || 0), 0)}</b></div>` : '';
  return html + more;
}

/** DAMAGE TAKEN and DAMAGE DEALT, side by side, biggest source first. */
export function tables(st) {
  const life = st.lastLife; if (!life) return '';
  const kb = st.killedBy || {};
  const taken = life.taken || [], dealt = life.dealt || [];
  const partial = !!life.dealtPartial;
  const tHead = `<div class="dth"><span>DAMAGE TAKEN</span><b class="tab">${taken.length ? life.takenTotal : '—'}</b></div>`;
  const tBody = taken.length ? rows(taken, 'taken', kb.unknown ? null : kb.num) : '<div class="dnone">NO HITS BOOKED THIS LIFE</div>';
  // Dealt: never a numeral 0. A victim's phone relays each hit through MC, best-effort, so "none reported" is the
  // honest statement, and PARTIAL rides beside a total that may still grow.
  const dVal = dealt.length ? `<b class="tab">${life.dealtTotal}</b>` : '<b>—</b>';
  // PARTIAL qualifies a total that may still grow; with nothing reported, "NO HITS REPORTED YET" already says it.
  const dHead = `<div class="dth"><span>DAMAGE DEALT</span>${partial && dealt.length ? '<i class="pt" id="dspartial">PARTIAL</i>' : ''}${dVal}</div>`;
  const dBody = dealt.length ? rows(dealt, 'dealt', null) : `<div class="dnone">${partial ? 'NO HITS REPORTED YET' : 'NO HITS REPORTED'}</div>`;
  return `<div class="dst" id="dstaken">${tHead}${tBody}</div><div class="dst" id="dsdealt">${dHead}${dBody}</div>`;
}

/** THE GAME NOW: the clock, the race for the mode, and your match line. `stale`/`age` come from hud.js's board
 *  freshness (`_boardStale`/`_boardAge`), so the death screen and the live board agree about what is current. */
export function gameNow(st, { stale, age, resultRows }) {
  const tile = (lab, val, cls = '') => `<span class="rc ${cls}"><span class="rv">${val}</span><span class="rl">${lab}</span></span>`;
  const out = [tile('TIME LEFT', `<b class="tab">${mmss(st.clockMs)}</b>`)];
  const bd = st.board && typeof st.board === 'object' ? st.board : null;
  const cap = bd && num(bd.cap) != null ? bd.cap : num(st.fragLimit);
  const asOf = stale ? ` · ${esc(age)}` : '';
  const ffa = st.mode === 'FFA';
  const rowsList = resultRows(st.scoreRows || []);
  const myId = st.player && st.player.player_id;
  if (ffa && rowsList.length && st.scoreAt) {
    const i = rowsList.findIndex(r => r && r.player_id === myId);
    const lead = rowsList[0];
    const val = i >= 0 ? `<b class="tab">${ordinal(i + 1)}</b> OF ${rowsList.length}${i > 0 && lead ? ` · ${up(lead.display || '—')} <b class="tab">${num(lead.kills) != null ? lead.kills : '—'}</b>` : ' · LEADING'}` : `${up(lead.display || '—')} LEADS <b class="tab">${num(lead.kills) != null ? lead.kills : '—'}</b>`;
    out.push(tile(`${cap != null ? `FIRST TO ${cap}` : 'STANDINGS'}${asOf}`, val, stale ? 'stale' : ''));
  } else if (bd && Array.isArray(bd.teams) && bd.teams.length && st.scoreAt) {
    const chips = bd.teams.filter(t => t && typeof t === 'object').map(t => { const k = String(t.team_id || '').toLowerCase(); const mine = st.teamKey && k === st.teamKey;
      return `<span class="tm ${mine ? 'mine' : ''}" style="background:${TEAM_COLOR[k] || 'var(--plate)'};color:${TEAM_INK[k] || 'var(--num)'}"><span class="unskew">${up(t.name || k)} <b>${t.score != null ? t.score : '—'}</b></span></span>`; }).join('');
    out.push(tile(`${cap != null ? `FIRST TO ${cap}` : 'SCORE'}${asOf}`, `<span class="tms">${chips}</span>`, stale ? 'stale' : ''));
  } else if (cap != null) out.push(tile('SCORE CAP', `<b class="tab">${cap}</b>`));
  // The hill as THIS phone last heard it (engine `state().hill`, null once its beacons stop arriving).
  if (st.hill && num(st.hill.owner) != null) {
    const o = st.hill.owner, k = TID_KEY[o];
    const val = o === HILL_NEUTRAL_TID || !k ? '<b>NEUTRAL</b>' : `<span class="tm" style="background:${TEAM_COLOR[k]};color:${TEAM_INK[k]}"><span class="unskew">${up(k)} HOLDS</span></span>`;
    out.push(tile('THE HILL', val));
  } else if (st.mode === 'KOTH') out.push(tile('THE HILL', '<b>OUT OF RANGE</b>', 'stale'));
  const me = st.kills != null && st.scoreAt
    ? [`<b class="tab">${st.kills}</b> ${st.kills === 1 ? 'KILL' : 'KILLS'}`, `<b class="tab">${st.deaths}</b> ${st.deaths === 1 ? 'DEATH' : 'DEATHS'}`]
    : [`<b class="tab">${st.deaths}</b> ${st.deaths === 1 ? 'DEATH' : 'DEATHS'}`, `<b class="tab">${st.shots}</b> ${st.shots === 1 ? 'SHOT' : 'SHOTS'}`];
  if (st.lives != null) me.push(`<b class="tab">${st.lives}</b> ${st.lives === 1 ? 'LIFE' : 'LIVES'} LEFT`);
  out.push(tile(`YOUR MATCH${st.kills != null && st.scoreAt ? asOf : ''}`, me.join(' · '), st.kills != null && st.scoreAt && stale ? 'stale' : ''));
  return out.join('');
}
