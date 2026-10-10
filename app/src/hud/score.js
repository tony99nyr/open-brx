// Score rendering for the phone HUD.
import { TEAM_TID, num, esc, accShown, BOARD_LIVE_MAX_AGE_MS, engineNow } from './shared.js';

export function _boardStale(st) { return !!st.scoreAt && (st.wsState !== 'bound' || Date.now() - st.lastMcMsgAt > BOARD_LIVE_MAX_AGE_MS); }
  /** Bench 2026-09-17: how old the scores on the overlay are. MC pushes every change to a bound phone, so the
   *  numbers are current while the link is up; off the link they are the last push, and the label gives its age.
   *  Bench 2026-09-18 (F265): a bound phone can stop receiving pushes and still read `wsState === 'bound'`, so
   *  the socket state alone is not proof the board is current. LIVE is only honest for a few seconds: past
   *  `BOARD_LIVE_MAX_AGE_MS`, show the age even while bound, same as an unbound phone would.
   *
   *  Polish review #2: the freshness clock is `st.lastMcMsgAt` (any message heard from MC), not
   *  `st.scoreAt` (the last score CHANGE) -- MC only pushes a new score when one changes, so a quiet
   *  5 s of no kills is normal play, not a dead socket, and must not read as stale. `!!st.scoreAt`
   *  still gates it: no score has ever arrived, there is nothing to call LIVE. */
export function _boardAge(st) {
    if (!st.scoreAt) return 'NO SCORES YET';
    if (!this._boardStale(st)) return 'LIVE';
    const s = Math.max(0, Math.round((engineNow(st) - st.scoreAt) / 1000));   // ARCH-1: `scoreAt` is on the engine clock
    return `AS OF ${s < 60 ? s + ' S' : Math.floor(s / 60) + ' MIN'} AGO`;
  }
  /** Bench 2026-09-17: the live scores overlay, opened from the player name (PLAYERS tab) or the match clock
   *  (TEAMS tab). Everything on it is what the phone already holds: MC's last `score` push (`rows` = every
   *  player's ScoreRow, `board` = team totals, or the top three in FFA) and, before any push, this phone's own
   *  line. It sits between the vitals and the ammo digits, and a tap outside it or on ✕ closes it. */
export function _board(st) {
    const ffa = st.mode === 'FFA';
    const tab = this.board === 'player' ? 'player' : 'team';
    const rows = this._resultRows({ rows: st.scoreRows || [] });
    const myId = st.player && st.player.player_id;
    const v = x => num(x) == null ? '—' : x;
    const acc = r => num(r.accuracy) == null ? '—' : Math.round(r.accuracy) + '%';
    const name = r => esc(String(r.display || r.player_id || '—').toUpperCase());
    const stale = this._boardStale(st);
    let body;
    if (tab === 'player' || ffa) {
      const list = rows.length ? rows : [{ player_id: myId, display: st.callsign, kills: st.kills, deaths: st.deaths, assists: st.assists, accuracy: accShown(st) }];
      const cols = tab === 'player';
      body = `<div class="bdlist"><div class="bdr bdh ${cols ? '' : 'rank'}"><span>#</span><span class="pn">PLAYER</span>${cols ? '<span>K</span><span>D</span><span>A</span><span>ACC</span>' : '<span>KILLS</span>'}</div>
        ${list.map((r, i) => `<div class="bdr ${cols ? '' : 'rank'} ${myId && r.player_id === myId ? 'me' : ''}"><span class="tab">${i + 1}</span><span class="pn">${name(r)}</span>${cols
          ? `<span class="tab">${v(r.kills)}</span><span class="tab">${v(r.deaths)}</span><span class="tab">${v(r.assists)}</span><span class="tab">${acc(r)}</span>`
          : `<span class="tab">${v(r.kills)}</span>`}</div>`).join('')}
        ${rows.length ? '' : '<div class="bdnone">YOUR OWN LINE · MISSION CONTROL HAS SENT NO SCORES</div>'}</div>`;
    } else {
      // F424: KOTH is not scored on kills, so the board's team chip shows HOLD TIME instead of the
      // (always-kills) `t.score` MC's live push carries — read from THIS phone's own possession tally
      // (`_liveHold`, engine.js `state().possession`), the one number available mid-match without an
      // MC-side change (the merged, all-phones total exists only in the end-of-match recap).
      const koth = st.mode === 'KOTH';
      const holdByTid = koth ? this._liveHold(st) : null;
      const teams = st.board && Array.isArray(st.board.teams) ? st.board.teams.filter(t => t && typeof t === 'object') : [];
      body = teams.length ? `<div class="bdteams">${teams.map(t => {
        const k = String(t.team_id == null ? '' : t.team_id).toLowerCase(); const mine = !!(st.teamKey && k === st.teamKey);
        const ps = rows.filter(r => String(r.team_id == null ? '' : r.team_id).toLowerCase() === k);
        const chip = koth ? this._teamChipKoth(t, holdByTid && TEAM_TID[k] != null ? holdByTid[TEAM_TID[k]] : 0) : this._teamChip(t, mine);
        return `<div class="bdteam ${mine ? 'mine' : ''}">${chip}
          ${ps.map(r => `<div class="bdr tp ${myId && r.player_id === myId ? 'me' : ''}"><span class="pn">${name(r)}</span><span class="tab">${v(r.kills)} · ${v(r.deaths)} · ${v(r.assists)}</span></div>`).join('')}</div>`; }).join('')}</div>
        ${koth ? '<div class="bdcap">HOLD TIME · A LOWER BOUND · K · D · A</div>'
          : st.board && num(st.board.cap) != null ? `<div class="bdcap">FIRST TO ${st.board.cap} · K · D · A</div>` : ''}`
        : '<div class="bdnone">NO TEAM TOTALS FROM MISSION CONTROL YET</div>';
    }
    return `<div class="bdscrim"></div><div class="bdpanel" role="dialog" aria-label="Match scores">
      <div class="bdhead"><div class="bdseg" role="group">
        <button class="sg ${tab === 'team' ? 'on' : ''}" aria-pressed="${tab === 'team'}" data-act="onBoardTab" data-arg="team"><span class="unskew">${ffa ? 'STANDINGS' : 'TEAMS'}</span></button>
        <button class="sg ${tab === 'player' ? 'on' : ''}" aria-pressed="${tab === 'player'}" data-act="onBoardTab" data-arg="player"><span class="unskew">PLAYERS</span></button></div>
        <span class="bdage ${stale ? 'stale' : ''}" id="bdage">${this._boardAge(st)}</span>
        <button class="bdx" data-act="onBoardClose" aria-label="Close scores">✕</button></div>
      <div class="bdbody">${body}</div></div>`;
  }

  /** F424: this phone's own possession tally (engine.js `_accrueHold`), summed across every site into
   *  {tid -> ms}. MC's live `score` push carries KILLS only (`_score_board` always uses `team_scores()`),
   *  never a merged hold total — that only exists in the END-of-match recap (`_resultHold`). Mid-match,
   *  the one number this phone actually has for KOTH is what IT observed, which is why this reads
   *  `st.possession.by_site` (engine.js `state()`) rather than `st.board`: a stated lower bound, same
   *  spirit as the recap's own possession fact, never a guess at what other phones saw. */
export function _liveHold(st) {
    const p = st.possession && typeof st.possession === 'object' ? st.possession : null;
    const bySite = p && p.by_site && typeof p.by_site === 'object' ? p.by_site : null;
    if (!bySite) return null;
    const out = {};
    for (const site of Object.values(bySite)) { if (!site || typeof site !== 'object') continue;
      for (const [tid, v] of Object.entries(site)) out[tid] = (out[tid] || 0) + (num(v) || 0); }
    return out;
  }

export const methods = { _boardStale, _boardAge, _liveHold, _board };
