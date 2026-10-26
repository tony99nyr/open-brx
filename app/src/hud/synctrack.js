// Phone sync track (Tony 2026-10-25: "MC shows your phone not synced and you wonder wait im right here why"; gallery
// C:/Users/Tony/brx-phone-sync, option A). After the whistle the phone shows MC's own F596 stages (state.py
// `_sync_stage`): NOT LINKED, LINKED, SENDING N LEFT, RECEIVED. RECEIVED needs what MC needs: a status with nothing
// pending sent after the whistle (`transport.drainedAt`), and it latches through a later drop, as MC's does. MC
// confirms the end from that same status (A42 `_note_end_confirm`), so "end not confirmed" is not a separate state here.
// A stuck stage adds one plain reason, and one action when the player can fix it. Players never change phone settings
// (Tony 2026-09-23), so no action asks for that.

/** state.py SYNC_STUCK_S: no progress this long is stuck. */
export const SYNC_STUCK_MS = 120_000;

const WALK = 'Walk back towards Mission Control';
/** Unlinked on Wi-Fi this long before the phone blames MC: a few seconds off is the normal reconnect backoff (review). */
export const MC_SILENT_MS = 30_000;

/** `sync` is app.js's `hud.sync` ({bound, pending, drainedAt, connType, reach, pendingChangedAt, boundAt, unboundAt, whistleAt}); `st` the engine
 *  state. Null before the whistle or without a reading. */
export function syncTrack(sync, st, now) {
  if (!sync || !st || !st.ended) return null;
  // the whistle on the phone's own clock (app.js), which drainedAt and the progress times use; st.endedAt is MC's clock
  const endedAt = sync.whistleAt || st.endedAt || 0;
  const via = sync.reach === 'backhaul' || sync.connType === 'cellular' ? 'cell' : 'wifi';
  // a fact queued after the receipt reopens it, as a late batch reopens MC's row (`_sync_events`)
  if (sync.drainedAt && sync.drainedAt >= endedAt && !(sync.pending > 0)) return { stage: 'received', via: null, n: 0, tone: 'ok', reason: 'Mission Control has all your scores', action: null };
  if (!sync.bound) {
    const n = sync.pending || 0;
    if (sync.connType !== 'wifi') return { stage: 'unlinked', via: null, n, tone: 'warn', reason: 'No Wi-Fi to Mission Control', action: WALK };
    // on Wi-Fi: a short drop is the reconnect backoff, so the phone blames MC only after MC_SILENT_MS off the link
    const off = Math.max(sync.unboundAt || 0, endedAt);
    if (now - off < MC_SILENT_MS) return { stage: 'unlinked', via: null, n, tone: 'mut', reason: 'Reconnecting to Mission Control', action: null };
    return { stage: 'unlinked', via: null, n, tone: 'warn', reason: 'Mission Control is not answering', action: 'Tell the host' };
  }
  if (!(sync.pending > 0)) return { stage: 'linked', via, n: 0, tone: 'mut', reason: 'Checking what is left to send', action: null };
  // progress is measured from the latest of: the count last moving, the whistle, and this link (a count that sat still
  // in play, or while the phone was away, is not stuck the moment the phone links)
  const since = Math.max(sync.pendingChangedAt || 0, endedAt, sync.boundAt || 0);
  const stuck = now - since >= SYNC_STUCK_MS;
  if (stuck) return { stage: 'sending', via, n: sync.pending, tone: 'warn', reason: 'No progress for 2 min', action: WALK };
  return { stage: 'sending', via, n: sync.pending, tone: 'num', reason: via === 'cell' ? 'Over mobile data, slower than the Wi-Fi' : null, action: null };
}

const WIFI = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1.3" fill="currentColor"/></svg>';
const CELL = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><rect x="3" y="15" width="3.5" height="6"/><rect x="8.5" y="11" width="3.5" height="10"/><rect x="14" y="7" width="3.5" height="14"/><rect x="19.5" y="3" width="3.5" height="18" opacity=".35"/></svg>';
const ORDER = { unlinked: 0, linked: 1, sending: 2, received: 3 };

/** The three-step track (gallery option A), or '' for no track. `blink`: the action blinks (the results screen while the
 *  result is not in, the D3 ask that RETURN TO MISSION CONTROL carried before). */
export function trackHtml(t, { blink = false } = {}) {
  if (!t) return '';
  const at = ORDER[t.stage];
  // step 0 is the link (current while unlinked or linked), step 2 sending, step 3 received
  const nd = (cur, done, name) => `<span class="nd ${done ? 'done' : cur ? 'cur' : ''}"><i></i>${name}</span>`;
  const via = t.via ? `<span class="via">${t.via === 'cell' ? CELL + 'MOBILE' : WIFI + 'WI-FI'}</span>` : '';
  const why = t.reason || t.action ? `<div class="why">${t.reason || ''}${t.reason && t.action ? ' · ' : ''}${t.action ? `<span class="act">▸ ${t.action}</span>` : ''}</div>` : '';
  return `<div class="sy ${t.tone}${blink && t.action ? ' blink' : ''}" data-sync="${t.stage}"><div class="trk">${nd(at <= 1, at >= 2, at === 0 ? 'NOT LINKED' : 'LINKED')}${via}<span class="ln"></span>`
    + `${nd(at === 2, at === 3, t.stage === 'sending' ? `SENDING ${t.n} LEFT` : 'SENDING')}<span class="ln"></span>${nd(at === 3, false, 'RECEIVED')}</div>${why}</div>`;
}

/** The compact chip (gallery: back in the lobby): the stage as one label and the reason under it, or '' for no track. */
export function chipHtml(t) {
  if (!t) return '';
  const label = t.stage === 'unlinked' ? 'NOT LINKED' : t.stage === 'linked' ? 'LINKED' : t.stage === 'sending' ? `SENDING · ${t.n} LEFT` : 'RECEIVED';
  const mark = t.tone === 'ok' ? '✓' : t.tone === 'warn' ? '!' : '•';
  const why = t.reason || t.action ? `<div class="why">${t.reason || ''}${t.reason && t.action ? ' · ' : ''}${t.action ? `<span class="act">▸ ${t.action}</span>` : ''}</div>` : '';
  return `<div class="sychip ${t.tone}" data-sync="${t.stage}"><div class="l1">${mark} ${label}</div>${why}</div>`;
}

/** F595: how long after the whistle the phone stays urgent (a beat as soon as its ring empties, redials on a 2 s cap)
 *  while no result has come. Past it the ordinary 10 s cap and the normal beats finish the job without the battery cost. */
export const SYNC_URGENT_MAX_MS = 10 * 60 * 1000;
/** F595: should the transport be urgent? From the end until the result arrives, for at most SYNC_URGENT_MAX_MS.
 *  `es` is engine.state(); `now` is on the engine's clock, as `endedAt` is. */
export function syncUrgent(es, now) {
  return !!(es && es.ended && !es.result && es.endedAt && now - es.endedAt < SYNC_URGENT_MAX_MS);
}
