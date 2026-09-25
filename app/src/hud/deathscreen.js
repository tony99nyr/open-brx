// The DOWN screen's recap. Tony 2026-09-23: "we can simplify what is shown, what were we killed by and just a few
// callouts, it doesn't have to be a financial report". Pure functions of engine state; `hud.js` places the HTML.
//  - The killer line: who, with what, and the hit that finished you (its damage, and gun or headset).
//  - Four callouts, numbers and icons: damage taken, damage dealt, kills, time alive.
//  - The game strip: the clock, the race, the hill.
// Nothing here invents a number. Dealt and kills come from MC's best-effort relays: a count that may be missing a
// relay carries "+", and nothing reported is "–", never a confident 0.

const TEAM_COLOR = { blue: 'var(--team-blue)', yellow: 'var(--team-yellow)', red: 'var(--team-red)', green: 'var(--team-green)' };
const TEAM_INK = { blue: '#04121e', yellow: '#1a1400', red: '#1a0404', green: '#041a0c' };
const TID_KEY = { 0: 'red', 1: 'blue', 2: 'yellow', 3: 'green' };
const HILL_NEUTRAL_TID = 2;   // engine.js HILL_NEUTRAL_TEAM: a neutral point broadcasts team 2

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
const up = s => esc(String(s == null ? '' : s).toUpperCase());
const pad2 = n => String(Math.max(0, Math.floor(n))).padStart(2, '0');
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
const ordinal = n => { const t = n % 100, o = n % 10; return n + (t >= 11 && t <= 13 ? 'TH' : o === 1 ? 'ST' : o === 2 ? 'ND' : o === 3 ? 'RD' : 'TH'); };

// Inline SVG icons, not emoji: Android's WebView draws ☠ and ⏱ as colour emoji. 16x16, currentColor.
const svg = (d, stroke) => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true" ${stroke ? 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"' : 'fill="currentColor"'}>${d}</svg>`;
export const ICON = {
  skull: svg('<path fill-rule="evenodd" d="M8 1a6 6 0 0 0-6 6c0 2 1 3.4 2.5 4.2V14h7v-2.8C13 10.4 14 9 14 7a6 6 0 0 0-6-6zM5.6 6.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4.8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>'),
  drop: svg('<path d="M8 1S3 7 3 10a5 5 0 0 0 10 0C13 7 8 1 8 1z"/>'),
  down: svg('<path d="M2 4h12L8 13z"/>'),
  up: svg('<path d="M2 12h12L8 3z"/>'),
  kill: svg('<circle cx="8" cy="8" r="5.2"/><path d="M8 1v4M8 11v4M1 8h4M11 8h4"/>', true),
  clock: svg('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.5V8l2.6 1.6"/>', true),
  // not yet in sync with Mission Control: two chasing arrows
  sync: svg('<path d="M13.5 6.5A5.6 5.6 0 0 0 3.2 5"/><path d="M3 2v3.2h3.2"/><path d="M2.5 9.5A5.6 5.6 0 0 0 12.8 11"/><path d="M13 14v-3.2H9.8"/>', true),
  flag: svg('<path d="M3 1v14h1.7V9.2h7.3L10.4 6 12 2.8H4.7V1z"/>'),
};

/** One weapon's name as the screen says it: the name, "A / B" for a two-way ambiguity, WEAPON UNCLEAR past that.
 *  Null when the phone has no claim at all (an older MC, or a poison tick), so the caller prints nothing. */
export function weaponLabel(w) {
  if (!w) return null;
  if (w.ambiguous) { const n = Array.isArray(w.names) ? w.names : []; return n.length && n.length <= 2 ? n.map(up).join(' / ') : 'WEAPON UNCLEAR'; }
  return w.name ? up(w.name) : null;
}

/** The killer line's second half: the weapon that killed you (PICKUP when it came off the wider catalogue, POISON
 *  for a lethal tick). No damage number: Tony 2026-09-23. The killing hit's damage is capped by what you had left, so
 *  it reads small and says little. Shown only when the booked final hit belongs to the named killer (an unknown
 *  killer means a stale latch). Empty when the phone booked no hit this life (a gun restart, a desync, a restart). */
/** HUD QA R2-17: a death takes a held weapon item with it (powerups.md). The DOWN screen says so, once, beside the kill. */
export function itemLostLine(st) {
  const l = st.puLost; if (!l || !l.name) return '';
  return `<span class="pulost" id="dspulost" role="status">${up(l.name)} LOST</span>`;
}
export function finalHitLine(st) {
  const life = st.lastLife, kb = st.killedBy || {}, fh = life && life.finalHit;
  if (!fh) return '';
  if (kb.unknown ? fh.num !== 0 : kb.num != null && fh.num !== kb.num) return '';
  const w = fh.dot ? 'POISON' : weaponLabel(fh.weapon);
  if (!w) return '';
  const pickup = !fh.dot && fh.weapon && fh.weapon.pickup;
  const crit = !fh.dot && !!fh.crit;   // Tony 2026-09-23: "i like the crit indicator"
  return `<span class="fh" id="dsfinal" role="img" aria-label="${esc(`killed with ${w.replace(' / ', ' or ')}${pickup ? ', a pickup' : ''}${crit ? ', a critical hit' : ''}`)}"><span class="fw">${w}</span>${pickup ? '<i class="pk">PICKUP</i>' : ''}${crit ? '<i class="cr">CRIT</i>' : ''}</span>`;
}

/** The callouts: taken, dealt, kills, time alive. A callout with no value is not drawn (Tony 2026-09-23: "if we
 *  don't have values for these then simply don't render them"): no damage booked, no dealt relay, and no kill confirm
 *  while a relay may still be missing. Dealt and kills come from MC's relays (a kill confirm is dropped when the victim
 *  reports late), so while one may be missing the number that did arrive is drawn greyed (`unsure`) with a small
 *  out-of-sync icon beside it (Tony 2026-09-23: "use an icon ... to indicate out of sync with MC"). */
export function callouts(st) {
  const life = st.lastLife; if (!life) return '';
  const partial = !!life.dealtPartial;
  const kills = num(life.kills) || 0;
  const alive = mmss(num(life.aliveMs) || 0);
  const c = (cls, icon, value, label, said, unsure) => `<span class="co ${cls}${unsure ? ' unsure' : ''}" role="img" aria-label="${esc(said)}">${icon}<b class="tab">${value}${unsure ? `<span class="us" title="not yet in sync with Mission Control">${ICON.sync}</span>` : ''}</b><span class="cl">${label}</span></span>`;
  const out = [];
  if ((life.taken || []).length) out.push(c('tk', ICON.down, life.takenTotal, 'TAKEN', `damage taken ${life.takenTotal}`, false));
  if ((life.dealt || []).length) out.push(c('dl', ICON.up, life.dealtTotal, 'DEALT', `damage dealt ${partial ? 'at least ' : ''}${life.dealtTotal}`, partial));
  if (kills || !partial) out.push(c('ki', ICON.kill, kills, kills === 1 ? 'KILL' : 'KILLS', `kills confirmed ${partial ? 'so far ' : ''}${kills}`, partial));
  out.push(c('al', ICON.clock, alive, 'ALIVE', `alive ${alive}`, false));
  return `<div class="dco" id="dslife">${out.join('')}</div>`;
}

/** The game strip: the clock, the race for the mode (team chips out of the cap, or your FFA place), the hill, and
 *  your kills and deaths. An old board keeps its numbers with a short age tag, never passing as current. */
/** Who holds the hill: `{key}` a team, `{label: 'NEUTRAL'}` nobody, `{label: '–', stale}` a KOTH game with no beacon heard,
 *  null when the game has no hill. The DOWN strip's reading. PURE. */
export function hillOf(st) {
  if (st.hill && num(st.hill.owner) != null) {
    const o = st.hill.owner, k = TID_KEY[o];
    return o === HILL_NEUTRAL_TID || !k ? { key: null, label: 'NEUTRAL' } : { key: k, label: up(k) };
  }
  return st.mode === 'KOTH' ? { key: null, label: '–', stale: true } : null;
}
export function gameNow(st, { stale, age, resultRows }) {
  const tile = (val, cls = '', said = '') => `<span class="rc ${cls}"${said ? ` role="img" aria-label="${esc(said)}"` : ''}><span class="rv">${val}</span></span>`;
  const ageTag = stale ? `<i class="ag">${esc(String(age).replace(/^AS OF /, ''))}</i>` : '';
  const out = [tile(`${ICON.clock}<b class="tab">${mmss(st.clockMs)}</b>`, '', `time left ${mmss(st.clockMs)}`)];
  const bd = st.board && typeof st.board === 'object' ? st.board : null;
  const cap = bd && num(bd.cap) != null ? bd.cap : num(st.fragLimit);
  const capTag = cap != null ? `<span class="cap">/${cap}</span>` : '';
  const rowsList = resultRows(st.scoreRows || []);
  const myId = st.player && st.player.player_id;
  if (st.mode === 'FFA' && rowsList.length && st.scoreAt) {
    const i = rowsList.findIndex(r => r && r.player_id === myId);
    const lead = rowsList[0];
    const ld = lead ? `<span class="ld">${up(lead.display || '—')} <b class="tab">${num(lead.kills) != null ? lead.kills : '—'}</b></span>` : '';
    const val = i >= 0 ? `<b class="tab">${ordinal(i + 1)}</b><span class="cap">/${rowsList.length}</span>${i > 0 ? ld : ''}` : ld;
    out.push(tile(val + ageTag, stale ? 'stale' : '', `your place ${i >= 0 ? ordinal(i + 1) : 'unknown'} of ${rowsList.length}${cap != null ? ', first to ' + cap : ''}`));
  } else if (bd && Array.isArray(bd.teams) && bd.teams.length && st.scoreAt) {
    const chips = bd.teams.filter(t => t && typeof t === 'object').map(t => { const k = String(t.team_id || '').toLowerCase(); const mine = st.teamKey && k === st.teamKey;
      return `<span class="tm ${mine ? 'mine' : ''}" style="background:${TEAM_COLOR[k] || 'var(--plate)'};color:${TEAM_INK[k] || 'var(--num)'}"><span class="unskew">${up(t.name || k)} <b>${esc(t.score != null ? t.score : '—')}</b></span></span>`; }).join('');
    out.push(tile(`<span class="tms">${chips}</span>${capTag}${ageTag}`, stale ? 'stale' : ''));
  } else if (cap != null) out.push(tile(`<span class="cap">FIRST TO ${cap}</span>`));
  const h = hillOf(st);
  // HUD QA R2-08: the owner is a <b>, so the hill tile has the weight of the score chips beside it (it was about 8 px)
  if (h && h.key) out.push(tile(`<span class="tm" style="background:${TEAM_COLOR[h.key]};color:${TEAM_INK[h.key]}"><span class="unskew">${ICON.flag} <b>${up(h.key)}</b></span></span>`, 'hill', 'hill held by ' + h.key));
  else if (h) out.push(tile(`${ICON.flag}<b>${h.label}</b>`, h.stale ? 'hill stale' : 'hill', h.stale ? 'hill out of range' : 'hill held by nobody'));
  const mcKills = st.kills != null && !!st.scoreAt;
  const me = `${mcKills ? `${ICON.kill}<b class="tab">${st.kills}</b>` : ''}${ICON.skull}<b class="tab">${st.deaths}</b>${mcKills ? ageTag : ''}`;
  out.push(tile(me, mcKills && stale ? 'stale' : '', `your match: ${mcKills ? `${st.kills} ${st.kills === 1 ? 'kill' : 'kills'}, ` : ''}${st.deaths} ${st.deaths === 1 ? 'death' : 'deaths'}`));
  return out.join('');
}
