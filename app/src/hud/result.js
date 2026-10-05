// Result rendering for the phone HUD.
import { AWARDS } from '../transport/contract.gen.js';
import { medalChip, medalIcon } from './medalicons.js';
import { TEAM_COLOR, TEAM_INK, TEAM_TID, pad2, mmss, num, esc, accShown, OUTCOME_WORD, MEDAL_LABEL, MEDAL_ROWS } from './shared.js';
const mmssS = s => mmss(Math.max(0, Number(s) || 0) * 1000);   // the wire carries possession in SECONDS
const clock12 = t => { const d = new Date(Number(t) || 0); const h = d.getHours(); return `${h % 12 === 0 ? 12 : h % 12}:${pad2(d.getMinutes())}${h < 12 ? 'AM' : 'PM'}`; };
// Tony 2026-09-25: the RECAP (the AWARDS tab and the PLAYERS medal column) is icon-first, the name on a long press
// (title) and in the accessible label, and a legend teaches the icons. The in-game lanes keep their words, no icons.
const RECAP_ROWS = [...MEDAL_ROWS, ...AWARDS];
// 31 css px is 24 px on screen on the smallest gate frame (iPhone SE, 667×375 scales the 844-wide frame by 0.79).
// The PLAYERS tab hides the stat tiles when my own board row carries the same numbers (recapTilesHidden).
export const RECAP_ICON_PX = 31;
const recapIcon = (key, px, night, label) => medalIcon(key, { size: px, night, label: label || (RECAP_ROWS.find(r => r.key === key) || {}).label || key });
export const recapLegend = (keys, night) => keys.length ? `<div class="mleg" role="list" aria-label="MEDAL LEGEND">${keys.map(k => { const l = (RECAP_ROWS.find(r => r.key === k) || {}).label || k;
  return `<span class="mlg" role="listitem" data-medal="${esc(k)}">${recapIcon(k, RECAP_ICON_PX, night, l)}<em>${esc(l)}</em></span>`; }).join('')}</div>` : '';
/** Review of medal-icons (M1): the stat tiles repeat my own board row, so PLAYERS hides them only when that row is
 *  there (MC may send no rows, or none for me). AWARDS always hides them. */
export const recapTilesHidden = (tab, rows, myId) => tab === 'awards' || (tab === 'player' && !!myId && rows.some(r => r && r.player_id === myId));
/** SHOTS is the one tile no board column carries; with the tiles hidden it goes on the meta line. When the tiles
 *  showed YOUR TEAM HELD instead (a mode with a point), HELD has its own strip and SHOTS was not shown either. */
export const recapShotsNote = (st, hold) => (hold && st.teamKey && hold[st.teamKey] != null) || num(st.shots) == null ? null : `${st.shots} SHOTS`;

  /** Sorted leaderboard rows out of `result.rows` (every player, all modes). `rows` is the only orderable
   *  material on the wire — there is no per-mode objective number in a `ScoreRow` — so the order is kills,
   *  then fewest deaths, then assists, and the heading says so rather than implying a mode ranking. */
export function _resultRows(R) {
    const rows = (R && Array.isArray(R.rows)) ? R.rows.filter(r => r && typeof r === 'object') : [];
    const n = v => num(v) == null ? 0 : v;
    return rows.slice().sort((a, b) => n(b.kills) - n(a.kills) || n(a.deaths) - n(b.deaths) || n(b.assists) - n(a.assists)
      || String(a.display || '').localeCompare(String(b.display || '')));
  }
  /** Possession as {team_id -> seconds}, from `result.possession.by_team` or, failing that, summed out of a
   *  `by_site` map. Null when the mode has no point to hold — the screen then shows no possession at all. */
export function _resultHold(R) {
    const p = R && R.possession && typeof R.possession === 'object' ? R.possession : null;
    if (!p) return null;
    if (p.by_team && typeof p.by_team === 'object' && Object.keys(p.by_team).length) return p.by_team;
    if (p.by_site && typeof p.by_site === 'object') {
      const out = {};
      for (const site of Object.values(p.by_site)) { if (!site || typeof site !== 'object') continue;
        for (const [tid, v] of Object.entries(site)) out[tid] = (out[tid] || 0) + (num(v) || 0); }
      if (Object.keys(out).length) return out;
    }
    return null;
  }
  /** `after_end` (A6.1: facts past `end_t` are RECORDED and never scored). The server sends a MAP, not a list:
   *  `{facts: <count>, by_player: {[player_id]: {kills, deaths}}}`. No display name rides in it, so the name is
   *  resolved out of `result.rows` and falls back to the raw player_id for someone MC never scored — an id on
   *  screen is ugly, an invented name is a lie. Returns `{facts, rows}`; `facts` is the total the recap counted,
   *  which can exceed the rows shown (a fact from a player with no row at all still happened). */
export function _afterEnd(R, rows = []) {
    const a = (R && R.after_end && typeof R.after_end === 'object' && !Array.isArray(R.after_end)) ? R.after_end : null;
    if (!a || !a.by_player || typeof a.by_player !== 'object') return { facts: 0, rows: [] };
    const name = new Map(rows.filter(r => r.player_id).map(r => [r.player_id, r.display]));
    const out = Object.entries(a.by_player)
      .map(([pid, v]) => ({ player_id: pid, display: name.get(pid) || pid, kills: num(v && v.kills) || 0, deaths: num(v && v.deaths) || 0 }))
      .filter(r => r.kills > 0 || r.deaths > 0)
      .sort((x, y) => y.kills - x.kills || y.deaths - x.deaths || String(x.display).localeCompare(String(y.display)));
    return { facts: num(a.facts) != null ? a.facts : out.length, rows: out };
  }
export function _teamChip(t, mine) {
    const k = String(t.team_id == null ? '' : t.team_id).toLowerCase();
    const bg = TEAM_COLOR[k] || 'var(--plate)', ink = TEAM_INK[k] || 'var(--num)';
    return `<span class="tm ${mine ? 'mine' : ''}" style="background:${bg};color:${ink}"><span class="unskew">${esc(String(t.name || k || '—').toUpperCase())} <b>${num(t.score) == null ? '—' : t.score}</b></span></span>`;
  }
  /** The KOTH board's team chip: HOLD TIME (mm:ss), not the kill count `_teamChip` shows — F424. `data-tid`
   *  lets `_patch` update the number in place every tick without a full board rebuild (the hold climbs
   *  continuously, not just on a fresh MC push). */
export function _teamChipKoth(t, ms) {
    const k = String(t.team_id == null ? '' : t.team_id).toLowerCase();
    const bg = TEAM_COLOR[k] || 'var(--plate)', ink = TEAM_INK[k] || 'var(--num)';
    return `<span class="tm koth" data-tid="${TEAM_TID[k] != null ? TEAM_TID[k] : ''}" style="background:${bg};color:${ink}"><span class="unskew">${esc(String(t.name || k || '—').toUpperCase())} <b class="tab">${mmss(ms || 0)}</b></span></span>`;
  }

  /** THE FINAL RESULTS SCREEN.
   *
   *  The one rule that outranks every layout decision here (contracts A24, node.md §3.13, game test D3): **no
   *  branch below writes WIN or LOSE from the absence of a message.** A `victory` cue that never arrived means
   *  "you lost" and "your phone was out of coverage" identically, so with no `result` the screen says the match
   *  is over and the result is PENDING, and — once the settle window has passed with MC still unreachable — that
   *  MC was never reached. The four outcome words live in `OUTCOME_WORD` and are reachable only through
   *  `st.result.outcome`, which MC computes for THIS recipient.
   *
   *  Everything else is mode-aware from `result.mode` / `result.win_by` and the fields that are actually present:
   *  the tiles are built from a list (never five hard-coded cells), the TEAM view appears only when MC sent team
   *  totals, and possession / AFTER THE WHISTLE appear only when their fields do. */
  /** The end-of-match AWARDS (A63), icon-first (Tony 2026-09-25: "lean just on the icon and drop the verbosity"): my own
   *  awards as big icons, then one badge per honour with its icon, its holder and MC's stat (the number that earned it).
   *  The award's name is on a long press (title) and in the accessible label, and the legend below the list teaches the
   *  icons. MC computes them (`scoring.py honors()`, one row per tied holder, keys in `types.AWARDS` order) and the result
   *  push carries them as `honors[] = {medal (the label), key, player_id, display, stat}`. Mine first, then grouped by key
   *  in AWARDS order; nothing is capped. A pre-A63 row with no `key` is placed by its label. Mine carry a star and "YOU",
   *  not only a colour; an award with more than one holder says SHARED. */
export function _awards(honors, rows, myId, night) {
    const order = k => { const i = AWARDS.findIndex(a => a.key === k); return i < 0 ? AWARDS.length : i; };
    const keyOf = h => h.key || (AWARDS.find(a => a.label === h.medal) || {}).key || null;
    const label = h => String((AWARDS.find(a => a.key === keyOf(h)) || {}).label || h.medal || String(h.key || '').replace(/_/g, ' ')).toUpperCase();
    const isMe = h => !!myId && h.player_id === myId;
    const sorted = honors.map((h, i) => ({ h, i })).sort((a, b) => (isMe(b.h) - isMe(a.h)) || (order(keyOf(a.h)) - order(keyOf(b.h))) || (a.i - b.i)).map(x => x.h);
    const mine = sorted.filter(isMe);
    const who = h => { const r = rows.find(x => x.player_id === h.player_id); return { name: String(h.display || (r && r.display) || h.player_id || '—').toUpperCase(), tk: r && TEAM_COLOR[String(r.team_id || '').toLowerCase()] ? String(r.team_id).toLowerCase() : null }; };
    const me = `<div class="awme"><span class="awh">YOUR AWARDS</span>${mine.length
      ? `<div class="awm">${mine.map(h => `<span class="awi" data-award="${esc(keyOf(h) || '')}" title="${esc(label(h))}">${recapIcon(keyOf(h), 40, night, label(h))}</span>`).join('')}</div>`
      : '<span class="awnone">NONE THIS MATCH</span>'}<span class="lsrc">MC</span></div>`;
    const holders = k => honors.filter(x => keyOf(x) === k).length;
    const list = sorted.map(h => { const w = who(h), m = isMe(h), shared = holders(keyOf(h)) > 1;
      return `<div class="aw${m ? ' me' : ''}" data-award="${esc(keyOf(h) || '')}" title="${esc(label(h))}" style="--lc:${w.tk ? TEAM_COLOR[w.tk] : 'var(--glow)'}">${recapIcon(keyOf(h), RECAP_ICON_PX, night, label(h))}<span class="awt">`
        + `<span class="awn">${m ? '★ ' : ''}${esc(w.name)}${m ? ' <b>· YOU</b>' : ''}${shared ? ' <i>· SHARED</i>' : ''}</span>${h.stat != null && h.stat !== '' ? `<span class="aws">${esc(String(h.stat))}</span>` : ''}</span></div>`; }).join('');
    const legend = recapLegend([...new Set(sorted.map(keyOf).filter(Boolean))], night);
    // a list longer than the body scrolls, and says so ("more ↓"), so no honour is silently below the fold
    setTimeout(() => { const l = document.querySelector('.result .awl'), c = document.querySelector('.result .awmore'); if (l && c) c.hidden = !(l.scrollHeight > l.clientHeight + 1 && l.scrollTop + l.clientHeight < l.scrollHeight - 1); }, 0);
    return `<div class="awards">${me}<div class="awl" onscroll="const c=this.parentNode.querySelector('.awmore'); if (c) c.hidden = this.scrollTop + this.clientHeight >= this.scrollHeight - 1">${list}${legend}</div><span class="awmore" hidden>MORE ↓</span></div>`;
  }
export function _result(st) {
    const R = (st.result && typeof st.result === 'object') ? st.result : null;
    const wait = st.resultWait || (R ? 'in' : 'pending');
    const reopened = !!st.endAck;
    const rows = this._resultRows(R);
    const teams = (R && Array.isArray(R.team_scores)) ? R.team_scores.filter(t => t && typeof t === 'object' && (t.team_id != null || t.name)) : [];
    const hasTeam = teams.length > 0;
    // A63: MC's end-of-match honours (the result push's `honors`) are the AWARDS tab; a result without any has no tab.
    const awards = (R && Array.isArray(R.honors)) ? R.honors.filter(h => h && typeof h === 'object' && (h.key || h.medal) && h.player_id) : [];
    const tab = this.rtab === 'awards' && awards.length ? 'awards' : hasTeam ? (this.rtab === 'player' ? 'player' : 'team') : 'player';
    const hold = this._resultHold(R);
    const my = (R && R.my && typeof R.my === 'object') ? R.my : null;
    const myId = (my && my.player_id) || (st.player && st.player.player_id) || null;

    // --- headline ---
    const word = R ? (OUTCOME_WORD[R.outcome] || OUTCOME_WORD.undecided) : null;
    const head = word
      ? `<span class="rh1 w ${esc(String(R.outcome || 'undecided'))}"><span class="unskew">${word}</span></span>`
      : `<span class="rh1 p"><span class="unskew">${wait === 'unreached' ? 'MC NOT REACHED · SEE MISSION CONTROL' : 'RESULT PENDING · CONFIRM AT MISSION CONTROL'}</span></span>`;
    const modeName = String((R && R.mode) || st.mode || '').toUpperCase().replace(/_/g, ' ');
    const tilesHidden = recapTilesHidden(tab, rows, myId);
    const meta = [modeName || null,
      (R && R.win_by) ? 'WIN BY ' + String(R.win_by).toUpperCase().replace(/_/g, ' ') : null,
      (R && R.provisional) ? 'PROVISIONAL · SCORES STILL ARRIVING' : null,
      tilesHidden && tab === 'player' ? recapShotsNote(st, hold) : null].filter(Boolean).join(' · ');
    const sgb = (k, label) => `<button class="sg ${tab === k ? 'on' : ''}" aria-pressed="${tab === k}" data-act="onResultTab" data-arg="${k}"><span class="unskew">${label}</span></button>`;
    const seg = hasTeam || awards.length ? `<div class="rseg" role="group">
      ${hasTeam ? sgb('team', 'TEAMS') : ''}${sgb('player', 'PLAYERS')}${awards.length ? sgb('awards', 'AWARDS') : ''}</div>` : '';

    // --- body ---
    let body;
    if (!R) {
      // QA-14: this panel used to repeat the status (walk back into range) that the footer line already says, inside
      // a dashed box that filled the body with nothing. It now says only what the footer does not: who has the result.
      body = `<div class="rwait"><div class="wl">${wait === 'unreached'
        ? 'Your phone never reached Mission Control after the whistle. The host has the scores: read the result there.'
        : 'Mission Control decides how the match ended and sends the result here.'}</div>
        <div class="wl dim">The line below is what this phone counted. It is not the result.</div></div>`;
    } else if (tab === 'awards') {
      body = this._awards(awards, rows, myId, !!st.night);
    } else if (tab === 'team') {
      body = `<div class="rteams" style="grid-template-columns:repeat(${Math.min(4, teams.length)},minmax(0,1fr))">${teams.map(t => {
        const k = String(t.team_id == null ? '' : t.team_id).toLowerCase();
        const mine = !!(st.teamKey && k === st.teamKey);
        const ps = rows.filter(r => String(r.team_id == null ? '' : r.team_id).toLowerCase() === k);
        const h = hold ? hold[t.team_id] != null ? hold[t.team_id] : hold[k] : null;
        return `<div class="rteam ${mine ? 'mine' : ''}">${this._teamChip(t, mine)}
          ${h != null ? `<div class="thold">HELD <b class="tab">${mmssS(h)}</b></div>` : ''}
          <div class="tpl"><div class="tph"><span>PLAYER</span><span class="tab kda"><i>K</i><i>D</i><i>A</i></span></div>
          ${ps.length ? ps.map(r => `<div class="tp ${myId && r.player_id === myId ? 'me' : ''}"><span class="pn">${esc(String(r.display || r.player_id || '—').toUpperCase())}</span><span class="pv tab kda"><i>${num(r.kills) == null ? '—' : r.kills}</i><i>${num(r.deaths) == null ? '—' : r.deaths}</i><i>${num(r.assists) == null ? '—' : r.assists}</i></span></div>`).join('')
            : '<div class="tp none">NO SCORED PLAYERS</div>'}</div></div>`;
      }).join('')}</div>`;
    } else {
      const cell = (r, k) => num(r[k]) == null ? '—' : r[k];
      body = `<div class="rlb"><div class="lbh"><span class="c r">#</span><span class="c n">PLAYER · MOST KILLS FIRST</span><span class="c">K</span><span class="c">D</span><span class="c">A</span><span class="c">KD</span><span class="c">ACC</span><span class="c">BEST</span><span class="c m">MEDALS</span></div>
        <div class="lbrows">${rows.length ? rows.map((r, i) => {
          const k = String(r.team_id == null ? '' : r.team_id).toLowerCase();
          const meds = Array.isArray(r.medals) ? r.medals : [];
          return `<div class="lbr ${myId && r.player_id === myId ? 'me' : ''}"><span class="c r tab">${i + 1}</span>
            <span class="c n">${TEAM_COLOR[k] ? `<i class="dot" style="background:${TEAM_COLOR[k]}"></i>` : ''}${esc(String(r.display || r.player_id || '—').toUpperCase())}</span>
            <span class="c tab">${cell(r, 'kills')}</span><span class="c tab">${cell(r, 'deaths')}</span><span class="c tab">${cell(r, 'assists')}</span>
            <span class="c tab">${num(r.kd) == null ? '—' : Number(r.kd).toFixed(1)}</span>
            <span class="c tab ${r.acc_provisional ? 'prov' : ''}">${num(r.accuracy) == null ? '—' : Math.round(r.accuracy) + '%'}</span>
            <span class="c tab">${num(r.best_streak) == null ? '—' : r.best_streak}</span>
            <span class="c m">${meds.map(m => { const c = medalChip(m, RECAP_ROWS);
              return c.key ? `<span class="mc" data-medal="${esc(c.key)}" title="${esc(c.label)}${c.n > 1 ? ' ×' + c.n : ''}">${recapIcon(c.key, RECAP_ICON_PX, !!st.night, `${c.label}${c.n > 1 ? ' ×' + c.n : ''}`)}${c.n > 1 ? `<b class="tab">×${c.n}</b>` : ''}</span>`
                : `<span class="mt">${esc(String(m).toUpperCase().replace(/_/g, ' '))}</span>`; }).join('')}</span></div>`;
        }).join('') : '<div class="lbnone">MISSION CONTROL SENT NO PLAYER ROWS FOR THIS MATCH</div>'}</div>${recapLegend([...new Set(rows.flatMap(r => (Array.isArray(r.medals) ? r.medals : []).map(m => medalChip(m, RECAP_ROWS).key)).filter(Boolean))], !!st.night)}</div>`;
    }

    // --- strips: possession (player view), the honors roll, and the unofficial post-whistle tally ---
    const holdStrip = (hold && tab !== 'team') ? `<div class="rstrip poss"><span class="k">HELD</span><span class="v">${Object.entries(hold).map(([tid, v]) => {
      const t = teams.find(x => String(x.team_id) === String(tid));
      return `<span class="ch">${esc(String((t && t.name) || tid).toUpperCase())} <b class="tab">${mmssS(v)}</b></span>`; }).join('')}</span></div>` : '';
    const honors = (R && Array.isArray(R.honors)) ? R.honors.filter(h => h && h.medal) : [];
    // `honors[].display` is the PLAYER's name (not the medal's). `stat` is WHAT EARNED IT, and MC writes it as
    // a descriptive STRING, not a number — `scoring.py honors()` sends "11 K · 2.8 K/D · ×5 STREAK", "8
    // ELIMINATIONS", "AT 01:12". The old guard was `num(h.stat) != null`, which is false for every string MC
    // has ever sent, so the stat never reached a real phone; only the demo (which sent integers) ever showed
    // one, and the stage shot of it was fiction. Anything non-empty is printed as MC wrote it.
    const honorStrip = honors.length && tab !== 'awards' ? `<div class="rstrip hon"><span class="k">HONORS</span><span class="v">${honors.map(h =>
      `<span class="ch">${esc(MEDAL_LABEL[h.medal] || String(h.medal).toUpperCase().replace(/_/g, ' '))} <b>${esc(String(h.display || h.player_id || '').toUpperCase())}</b>${h.stat != null && h.stat !== '' ? ` <b class="tab">${esc(String(h.stat))}</b>` : ''}</span>`).join('')}</span></div>` : '';
    const ae = this._afterEnd(R, rows);
    // A6.1: facts after the whistle are RECORDED, not scored. Shown so a player who kept shooting can see where
    // those hits went — and shown as visibly not part of the score above, never mixed into it.
    const afterStrip = ae.rows.length ? `<div class="rstrip after"><span class="k">AFTER THE WHISTLE · ${ae.facts} NOT COUNTED</span><span class="v">${ae.rows.slice(0, 8).map(r =>
      `<span class="ch">${esc(String(r.display).toUpperCase())} <b class="tab">${r.kills}·${r.deaths}</b></span>`).join('')}</span></div>` : '';

    // --- my own line, as tiles: a LIST, so the cell set follows the mode and the fields that arrived ---
    const tiles = this._resultTiles(st, R, hold);

    // --- footer ---
    const all = this.history || []; const sid = this.sessionId || null;
    const hist = sid ? all.filter(g => g.session === sid) : all;
    const tot = hist.reduce((a, g) => ({ g: a.g + 1, k: a.k + (g.kills || 0), d: a.d + (g.deaths || 0) }), { g: 0, k: 0, d: 0 });
    const sess = tot.g > 1 ? `<div class="sess">${sid ? 'THIS SESSION' : 'OVERALL'} · ${tot.g} GAMES · ${tot.k} KILLS · ${tot.d} DEATHS</div>` : '';
    const sync = this.sync && this.sync.bound && this.sync.pending === 0
      ? '<div class="syncline ok">SCORES SENT TO THE HOST ✓</div>'
      : this.sync && this.sync.bound
        ? `<div class="syncline warn">SENDING SCORES… ${this.sync.pending} LEFT</div>`
        : '<div class="syncline warn">OUT OF RANGE — SCORES SEND WHEN YOU ARE BACK</div>';
    // The sheet's ask (D3): blink it while the result is not in — that is exactly when walking back matters.
    // It sat a pixel off the OUT OF RANGE line under it, a stack too tight to read (design-result-pending.png);
    // the room comes from `.fl`'s gap, so no line has to lose its own wording to make space.
    const ret = R ? '' : '<div class="retmc">RETURN TO MISSION CONTROL</div>';
    // QA-14: with no result and no link, RETURN TO MISSION CONTROL is the one status line; OUT OF RANGE under it said
    // the same thing again (and the MC pill a third time: `.pill.mcr` steps aside on this screen, index.html).
    const syncShown = (!R && !(this.sync && this.sync.bound)) ? '' : sync;
    const mcv = (!R && st.game && st.game.mc_verify) ? `<div class="mcvline">${esc(String(st.game.mc_verify).toUpperCase())}</div>` : '';

    return `<div class="lobby result rv"><div class="scan"></div><div class="edgeglow"></div>
      <div class="rhead"><span class="rkick">FINAL RESULTS</span>${head}<span class="rmeta">${esc(meta)}</span>${seg}</div>
      <div class="rbody">${body}</div>
      ${tab === 'awards' ? '' : holdStrip + honorStrip + afterStrip}
      <div class="rstats"${tilesHidden ? ' hidden' : ''} style="grid-template-columns:repeat(${tiles.n},minmax(0,1fr))">${tiles.html}</div>
      <div class="rfoot foot"><div class="fl">${ret}${mcv}${syncShown}${sess}</div>
        <button class="ready ${reopened ? 'ghost' : ''}" data-act="${reopened ? 'onCloseView' : 'onEndOk'}"><span class="unskew">${reopened ? 'CLOSE' : 'OK'}</span></button></div></div>`;
  }

  /** This player's own line as tiles. A LIST, not five fixed cells (game test D3): BEST STREAK appears only once
   *  MC has counted one, HELD replaces SHOTS only in a mode with a point to hold, and every label is ≥11px. */
export function _resultTiles(st, R, hold) {
    const my = (R && R.my && typeof R.my === 'object') ? R.my : null;
    const v = x => x == null ? '—' : x;
    const kills = num(my && my.kills) != null ? my.kills : (num(st.kills) != null ? st.kills : null);
    const assists = num(my && my.assists) != null ? my.assists : (num(st.assists) != null ? st.assists : null);
    const acc = num(my && my.accuracy) != null ? Math.round(my.accuracy) : accShown(st);
    const streak = num(my && my.best_streak);
    const myHold = (hold && st.teamKey && hold[st.teamKey] != null) ? hold[st.teamKey] : null;
    // DEATHS is local-real on the live HUD (node.md §4.4), but on the FINAL screen MC's number sits three rows
    // above it on the leaderboard — a tile reading 0 beside a row reading 6 is a screen arguing with itself.
    const deaths = num(my && my.deaths) != null ? my.deaths : st.deaths;
    const cells = [['KILLS', v(kills)], ['DEATHS', v(deaths)], ['ASSISTS', v(assists)],
      ['ACCURACY', acc == null ? '—' : acc + '%']];
    if (streak != null) cells.push(['BEST STREAK', streak]);
    if (myHold != null) cells.push(['YOUR TEAM HELD', mmssS(myHold)]);
    else cells.push(['SHOTS', v(num(st.shots))]);
    // This player's medals are NOT repeated here: they already read on their own leaderboard line and in the
    // HONORS strip, and a third copy cost 24px of body height on a 390px frame.
    return { n: cells.length, html: cells.map(([lab, val]) => `<div class="cell"><b>${val}</b><span>${lab}</span></div>`).join('') };
  }

  /** The MATCH HISTORY list — this MC session's games out of `localStorage['brx.history']` (`app.js` owns the
   *  writes). A24 fields are shown only when they are there: an entry from before the phone learned `outcome`
   *  reads "—", never a guess at how it went. */
export function _history(st) {
    const all = this.history || []; const sid = this.sessionId || null;
    const hist = (sid ? all.filter(g => g.session === sid) : all).slice().reverse();
    const tot = hist.reduce((a, g) => ({ g: a.g + 1, k: a.k + (g.kills || 0), d: a.d + (g.deaths || 0) }), { g: 0, k: 0, d: 0 });
    const rows = hist.map(g => {
      const w = g.outcome ? (OUTCOME_WORD[g.outcome] || '—') : null;
      const scores = Array.isArray(g.team_scores) && g.team_scores.length
        ? g.team_scores.map(t => `${esc(String(t.name || t.team_id || '').toUpperCase())} ${num(t.score) == null ? '—' : t.score}`).join(' · ') : '';
      return `<div class="hr"><span class="c t tab">${clock12(g.t)}</span>
        <span class="c m">${esc(String(g.mode || '—').toUpperCase())}</span>
        <span class="c o ${w ? esc(String(g.outcome)) : 'none'}">${w || 'NOT CONFIRMED'}</span>
        <span class="c s">${scores || '—'}</span>
        <span class="c k tab">${num(g.kills) == null ? '—' : g.kills} · ${num(g.deaths) == null ? '—' : g.deaths} · ${num(g.assists) == null ? '—' : g.assists}</span>
        <span class="c b tab">${num(g.best_streak) == null ? '—' : g.best_streak}</span></div>`;
    }).join('');
    return `<div class="lobby result hist"><div class="scan"></div><div class="edgeglow"></div>
      <div class="rhead"><span class="rkick">MATCH HISTORY</span><span class="rh1 p"><span class="unskew">${sid ? 'THIS SESSION' : 'ON THIS PHONE'} · ${tot.g} GAME${tot.g === 1 ? '' : 'S'}</span></span>
        <span class="rmeta">${tot.k} KILLS · ${tot.d} DEATHS</span></div>
      <div class="rbody"><div class="hlist"><div class="hr hh"><span class="c t">TIME</span><span class="c m">MODE</span><span class="c o">RESULT</span><span class="c s">TEAM SCORES</span><span class="c k">K · D · A</span><span class="c b">BEST</span></div>
        ${rows || '<div class="lbnone">NO MATCHES ON THIS PHONE YET</div>'}</div></div>
      <div class="rfoot foot"><div class="fl"><div class="sess">A MATCH IS RECORDED WHEN IT ENDS · THE RESULT FILLS IN WHEN MISSION CONTROL SENDS IT</div></div>
        <button class="ready ghost" data-act="${st.endAck ? 'onCloseView' : 'onShowResults'}"><span class="unskew">${st.endAck ? 'CLOSE' : 'BACK'}</span></button></div></div>`;
  }


export const methods = { _resultRows, _resultHold, _afterEnd, _teamChip, _teamChipKoth, _awards, _result, _resultTiles, _history };
