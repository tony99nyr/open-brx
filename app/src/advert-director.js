// Architecture round 2, item 8: the player advert's DECISIONS, out of app.js. PURE: no plugin, no timer, no Date.now().
// app.js (syncPlayerAdvert) keeps the plugin.beacon.start/stop calls, the busy flag that serialises them, and the log().
// Every reason string and log line below is the one app.js printed before the move.
import { encodeUuid, advertChangeReason, advertNeedsSnapshot, configGameByte } from './beacon.js';
import { playerClaimAdvert } from './powerup.js';
import { stationsInPlay } from './scanwatch.js';

/** The director's own small state. `scanOpens`: the last `beaconWatch.opens` it saw (F440). `reassertPending`: the advert
 *  a scan reopen asked to re-assert, kept until a start actually works (P-L3, review 2026-10-03). */
export const newAdvertDirector = () => ({ scanOpens: 0, reassertPending: null });

/** EFF-2: false when there is nothing to decide, so the caller can skip building the engine snapshot (about 4 KB of
 *  garbage per 250 ms tick): no station in play and nothing on air. */
export function advertSnapshotNeeded(config, gate) { return advertNeedsSnapshot(stationsInPlay(config), gate); }

const IDLE = (dir) => ({ action: null, uuid: null, mode: null, reason: null, reassert: false, refreshGate: false, dir, okLog: null });

/**
 * One tick of the decision.
 *   st       engine.state() (phase, playerNum, alive, powerupClaim)
 *   config   engine.config            tid   engine.teamTid
 *   scanOpens  beaconWatch.opens      dir   the director's state (newAdvertDirector)
 *   gate     the AdvertGate (read only: a clone() does the `refresh` and `due`)      now  ms
 *   busy     a plugin call is in flight: decide nothing and keep `dir`, so a scan reopen is not lost
 * Returns { action: 'start'|'stop'|null, uuid, mode, reason, reassert, refreshGate, dir, okLog }.
 *   refreshGate  the caller must call gate.refresh() (the scan reopened while the advert was on air)
 *   dir          the director's next state; keep it even when `action` is null
 *   okLog        the log line for a call that worked
 * Apply the result with settleAdvert().
 */
export function directAdvert({ st, config, tid, scanOpens, dir, gate, now, busy = false }) {
  if (busy) return IDLE(dir);
  const num = st.playerNum;
  const claim = playerClaimAdvert(st.powerupClaim);
  // Only a utility station reads a player advert, so a game with no stations advertises nothing.
  const want = (num != null && tid != null && st.phase !== 'idle' && stationsInPlay(config))
    ? encodeUuid({ role: 'player', id: num, team: tid, state: (st.alive ? 1 : 0) | claim.bits, value: claim.value, game: configGameByte(config) }) : null;
  const g = gate.clone();
  let next = dir, refreshGate = false;
  // F440: the scan reopened (a flood close, a BLE hiccup): re-assert the advert, which could have stopped silently.
  if (scanOpens !== dir.scanOpens) {
    next = { ...dir, scanOpens };
    if (want && g.last === want) { g.refresh(); refreshGate = true; next.reassertPending = want; }
  }
  const prevAdvert = g.last && g.last !== '?' ? g.last : null;
  const action = g.due(want, now);
  if (!action) return { ...IDLE(next), refreshGate };
  const reassert = action === 'start' && next.reassertPending === want;
  const reason = reassert ? 're-assert after the scan reopened' : advertChangeReason(prevAdvert, action === 'start' ? want : null,
    { phase: st.phase, stations: stationsInPlay(config), num, tid });
  const okLog = action === 'start'
    ? `advertising as player ${num} team ${tid}${st.alive ? '' : ' (down)'}${claim.bits ? ` · ${st.powerupClaim.ready ? 'CLAIM READY' : 'claiming'} station ${claim.value}` : ''} · ${claim.mode || 'balanced'} · ${reason}`
    : `player advert stopped (${reason})`;
  return { action, uuid: action === 'start' ? want : null, mode: action === 'start' ? claim.mode : null, reason, reassert, refreshGate, dir: next, okLog };
}

/** What to record once the plugin call returned (ok) or threw (!ok).
 *  { gate: 'started'|'stopped'|'failed', dir, stats: {starts, stops, fails, reasserts} deltas }. The caller then calls
 *  gate.started(uuid, now) / gate.stopped() / gate.failed(action, now). A failed call keeps the pending re-assert. */
export function settleAdvert(decision, ok) {
  const { action, dir, reassert } = decision;
  const stats = { starts: 0, stops: 0, fails: 0, reasserts: 0 };
  if (!ok) { stats.fails = 1; return { gate: 'failed', dir, stats }; }
  const cleared = { ...dir, reassertPending: null };   // any start that worked puts the advert back on air
  if (action === 'start') { stats.starts = 1; if (reassert) stats.reasserts = 1; return { gate: 'started', dir: cleared, stats }; }
  stats.stops = 1; return { gate: 'stopped', dir: cleared, stats };
}

/** The log line for a call that threw. */
export function advertFailLog(e) {
  return 'player advert failed — the phone may still be broadcasting the previous one; retrying: ' + (e && e.message || e);
}
