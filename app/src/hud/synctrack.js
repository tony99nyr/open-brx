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

/** `sync` is app.js's `hud.sync` ({bound, pending, drainedAt, connType, reach, pendingChangedAt}); `st` the engine state.
 *  Null before the whistle or without a reading. */
export function syncTrack(sync, st, now) {
  if (!sync || !st || !st.ended) return null;
  const endedAt = st.endedAt || 0;
  const via = sync.reach === 'backhaul' || sync.connType === 'cellular' ? 'cell' : 'wifi';
  if (sync.drainedAt && sync.drainedAt >= endedAt) return { stage: 'received', via: null, n: 0, tone: 'ok', reason: 'Mission Control has all your scores', action: null };
  if (!sync.bound) {
    const wifi = sync.connType === 'wifi';
    return { stage: 'unlinked', via: null, n: sync.pending || 0, tone: 'warn',
      reason: wifi ? 'Mission Control is not answering' : 'No Wi-Fi to Mission Control', action: wifi ? 'Tell the host' : WALK };
  }
  if (!(sync.pending > 0)) return { stage: 'linked', via, n: 0, tone: 'mut', reason: 'Checking what is left to send', action: null };
  const stuck = sync.pendingChangedAt != null && now - sync.pendingChangedAt >= SYNC_STUCK_MS;
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
