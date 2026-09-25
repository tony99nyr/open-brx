// A58: tamper-lock alerts for ASSIGNED stations. Separate from Powerups.tsx (the powerup item/RESET
// pieces) because a lock and its RESTARTED/OFFLINE/LOCK EXPIRES lines are a station-wide concern, not a
// powerup-item one -- every kind of station (respawn, extraction, control, ...) can carry one. Reuses the
// same store the LOBBY/ARMED/LIVE screens already poll for `state.stations` (`PowerupStrip` in
// Powerups.tsx reads the identical `useStore().state.stations`, no separate hook or poller).
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { GhostButton, SectionRule } from './index';

const STATION_PREFIX = 'STATION #';

/** UNLOCK STATIONS: two taps (it opens every station's buttons to anyone at the field until the next
 *  START re-locks them). Mirrors `ResetItem` (Powerups.tsx) exactly: confirm line, `run()`, a refusal
 *  shown inline on the row. */
function UnlockStations() {
  const { api, run } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The house rule: a destructive two-tap's confirm expires (Kit.tsx does 8 s), so a stale tap cannot unlock later.
  useEffect(() => {
    if (!confirm) return;
    const h = setTimeout(() => setConfirm(false), 8000);
    return () => clearTimeout(h);
  }, [confirm]);
  const send = async () => {
    setConfirm(false); setErr(null);
    await run(async () => {
      try { return await api.unlockStations(); } catch (e) { setErr((e as Error).message); throw e; }
    });
  };
  return (
    <div data-testid="station-unlock" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {confirm && (
        <span role="status" style={{ font: F.chk(700, 11), letterSpacing: '.08em', color: T.warn }}>
          ▲ UNLOCK LETS ANYONE AT A STATION USE ITS BUTTONS UNTIL THE NEXT START. TAP UNLOCK STATIONS AGAIN TO SEND IT.
        </span>)}
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <GhostButton onClick={() => (confirm ? send() : setConfirm(true))}
          color={confirm ? T.warn : undefined} border={confirm ? T.warn : undefined}
          title={confirm ? 'tap again to confirm: every station tamper lock clears now' : 'clear every station tamper lock now, until the next START re-locks them'}>
          UNLOCK STATIONS
        </GhostButton>
        {confirm && <GhostButton size={11} onClick={() => setConfirm(false)} title="back out: nothing was sent">CANCEL</GhostButton>}
      </span>
      {err && <span data-testid="station-unlock-error" role="alert" style={{ font: F.chk(700, 11), letterSpacing: '.06em', color: T.bad }}>▲ UNLOCK REFUSED: {err}</span>}
    </div>
  );
}

/** M5 (visual QA 2026-09-24): the next step for each attention line the server sends (state.py
 *  `_station_view` and `_station_tamper_flags`). The server's own string is shown as it is; this is the
 *  line under it. A line not on this list still shows, with the generic step. */
const NEXT_STEP: Array<[RegExp, string]> = [
  [/^BATTERY LOW/, 'swap or charge before the whistle'],
  [/^STATION #\d+ RESTARTED/, 'check the station; it restarted during the lock'],
  [/^STATION #\d+ OFFLINE/, 'check the station is powered and in range'],
  [/^STATION #\d+ LOCK EXPIRES MID-MATCH/, 'take it back through muster before the whistle'],
  [/^BRING IT BACK TO RE-ARM/, 'bring it into Wi-Fi range so MC can arm it'],
  [/^ARMED FOR AN OLDER GAME/, 're-arm it from ITEMS on ARMORY'],
  [/^PHONE SAYS NOT ARMED/, 're-arm it from ITEMS on ARMORY'],
  [/^PHONE ADVERTISES ID/, 're-arm it from ITEMS on ARMORY'],
];
export const nextStep = (line: string) => NEXT_STEP.find(([re]) => re.test(line))?.[1] ?? 'check the station on ITEMS (ARMORY)';

const KIND_WORD: Record<string, string> = { respawn: 'RESPAWN', powerup: 'POWERUP', extraction: 'EXTRACT', bomb: 'BOMB', control: 'CONTROL' };

/** The LOBBY/ARMED/LIVE strip: EVERY attention line of an ASSIGNED station (M5: it used to pass only the
 *  `STATION #N ...` lines, so a respawn station on BATTERY LOW showed only on ARMORY), each with its next
 *  step, plus, where `showUnlock` is set, UNLOCK STATIONS while any assigned station still carries a
 *  tamper lock (M4: LOBBY too, since the LOAD lock at the push is the only one a muster Stick gets).
 *  `compact` (M7, LIVE) puts each line on one row so the board stays near the top of the screen.
 *  Renders nothing (no header either) when there is neither an alert line nor, with `showUnlock`, an
 *  active lock. */
export function StationAlerts({ showUnlock = false, compact = false, unlockOnly = false }: { showUnlock?: boolean; compact?: boolean; unlockOnly?: boolean }) {
  const { state, serverNow } = useStore();
  const stations = (state?.stations ?? []).filter(s => s.assigned);
  // F337 (d): a pushed game keeps its stations LOCKED back in MUSTER, BUILD and KIT (only END, RECALL, abort,
  // unlock or a new session unlocks them), so ARMORY, GAMES and KIT carry the way out: the two-tap UNLOCK and
  // one note, only while a lock runs. The attention lines stay on ITEMS (ARMORY) and the match screens.
  if (unlockOnly) {
    const on = stations.some(s => !!s.lock_until_ms && s.lock_until_ms > serverNow());
    // an always-mounted status region (as SetupConflicts): it fills when a lock starts, and never remounts
    return (
      <div role="status" data-unlock-region="1">
        {on && (
          <div data-testid="station-unlock-only" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', margin: '0 0 12px' }}>
            <span style={{ font: F.chk(700, 11.5), letterSpacing: '.12em', color: T.warn }}>▲ STATIONS LOCKED FOR THE LOADED GAME</span>
            <UnlockStations />
          </div>
        )}
      </div>
    );
  }
  const lines = stations.flatMap(s => s.attention.map(t => ({
    key: `${s.node_id}-${t}`, t,
    // a line that names no station ("BATTERY LOW") says which one it is about
    who: t.startsWith(STATION_PREFIX) ? null : `${KIND_WORD[s.assigned!.kind] ?? s.assigned!.kind.toUpperCase()} ${s.assigned!.id}`,
  })));
  const lockActive = stations.some(s => !!s.lock_until_ms && s.lock_until_ms > serverNow());   // MC's clock, as the ITEMS card
  if (!lines.length && !(showUnlock && lockActive)) return null;
  return (
    <div data-testid="station-alerts" data-compact={compact ? '1' : undefined} style={{ margin: compact ? '0 0 10px' : '0 0 14px' }}>
      {!compact && <SectionRule label="STATION ALERTS" />}
      <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', flexWrap: 'wrap', alignItems: compact ? 'center' : undefined, gap: 6 }}>
        {compact && <span style={{ font: F.chk(700, 11), letterSpacing: '.2em', color: T.dim }}>STATION ALERTS</span>}
        {lines.map(({ key, t, who }) => (
          <div key={key} data-station-alert={t} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: compact ? '2px 8px' : '2px 8px',
            padding: compact ? '4px 10px' : '7px 10px', background: 'rgba(255,176,32,.08)', borderLeft: `2px solid ${T.warn}` }}>
            <span style={{ font: F.chk(700, 11), color: T.warn }}>▲</span>
            <span style={{ font: F.chk(700, 11.5), letterSpacing: '.06em', color: T.warn }}>{who ? `${who} · ` : ''}{t}</span>
            <span data-station-step style={{ font: F.chk(500, 11.5), letterSpacing: '.02em', color: T.body }}>{nextStep(t)}</span>
          </div>
        ))}
        {showUnlock && lockActive && <UnlockStations />}
      </div>
    </div>
  );
}
