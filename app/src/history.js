// Per-match history — the node-local recap the phone keeps after MC has gone home (A24).
//
// This lives in its own module for one reason: it is the only part of app.js with a decision in it, and
// app.js cannot be imported in a test (it touches `document`, `localStorage` and the Capacitor bridge at
// module scope). Two bugs hid behind that: a result patched the OLDEST entry sharing a `match_id`, and a
// result whose entry was not in the list was dropped in silence.

/** The history ring: the newest 50 matches, oldest shifted out. */
export const HISTORY_MAX = 50;

/** Index of the NEWEST entry for `matchId`, or -1. Newest, not oldest: two matches can share a
 *  `match_id` (an MC restarted onto the same id, a match replayed) and the result belongs to the
 *  one just played, not to a game from last week. */
export function findEntry(history, matchId) {
  if (!Array.isArray(history) || !matchId) return -1;
  for (let i = history.length - 1; i >= 0; i--) if (history[i] && history[i].match_id === matchId) return i;
  return -1;
}

/**
 * Fold MC's `result` into the history (A24). Mutates and returns `history`.
 *
 * @param {Array} history            the entry list (newest last)
 * @param {object} r                 the `result` body; `match_id` is required
 * @param {object} o
 * @param {boolean} o.ended          has the whistle already gone for this match?
 * @param {string|null} [o.mode]     for an entry this has to invent
 * @param {string|null} [o.session]  the MC session the match belonged to
 * @param {function} [o.now]
 * @returns {{history: Array, changed: boolean, appended: boolean}}
 */
export function applyResult(history, r, { ended = true, mode = null, session = null, now = Date.now } = {}) {
  const h = Array.isArray(history) ? history : [];
  if (!r || !r.match_id) return { history: h, changed: false, appended: false };
  let i = findEntry(h, r.match_id);
  let appended = false;
  if (i < 0) {
    // The result BEAT the whistle. `engine.historyEntry()` folds it in when the entry is written a
    // moment later, and appending here would leave TWO entries for one match — a second game in the
    // session tally. Leave it to the whistle.
    if (!ended) return { history: h, changed: false, appended: false };
    // After the whistle nothing else will ever write this match down: the entry rolled out of the
    // 50-cap, or its write failed. A dropped result is the one thing A24 forbids, so record what MC
    // said in a minimal entry — missing fields, never wrong ones.
    h.push({ t: now(), match_id: r.match_id, mode, session, deaths: null, shots: null, possession: null });
    i = h.length - 1;
    appended = true;
  }
  const my = r.my && typeof r.my === 'object' ? r.my : null;
  const was = h[i];
  const keep = (v, old) => (v != null ? v : (old != null ? old : null));
  h[i] = { ...was,
    outcome: r.outcome || null, win_by: r.win_by || was.win_by || null,
    team_scores: Array.isArray(r.team_scores) ? r.team_scores : (was.team_scores || null),
    kills: keep(my && my.kills, was.kills), assists: keep(my && my.assists, was.assists),
    accuracy: keep(my && my.accuracy, was.accuracy),
    best_streak: keep(my && my.best_streak, was.best_streak),
    medals: (my && Array.isArray(my.medals) && my.medals.length) ? my.medals : (was.medals || null) };
  while (h.length > HISTORY_MAX) h.shift();
  return { history: h, changed: true, appended };
}
