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

/** A58: the LOBBY/ARMED/LIVE strip for every ASSIGNED station's `STATION #N ...` attention lines
 *  (restarted, a held station gone offline, a lock due to expire mid-match), plus, where `showUnlock`
 *  is set (ARMED/LIVE only -- unlocking makes no sense before a match holds a lock), UNLOCK STATIONS
 *  while any assigned station still carries a tamper lock. Renders nothing (no header either) when
 *  there is neither an alert line nor, with `showUnlock`, an active lock. */
export function StationAlerts({ showUnlock = false }: { showUnlock?: boolean }) {
  const { state, serverNow } = useStore();
  const stations = (state?.stations ?? []).filter(s => s.assigned);
  const lines = stations.flatMap(s => s.attention.filter(t => t.startsWith(STATION_PREFIX)).map(t => ({ key: `${s.node_id}-${t}`, t })));
  const lockActive = stations.some(s => !!s.lock_until_ms && s.lock_until_ms > serverNow());   // MC's clock, as the ITEMS card
  if (!lines.length && !(showUnlock && lockActive)) return null;
  return (
    <div data-testid="station-alerts" style={{ margin: '0 0 14px' }}>
      <SectionRule label="STATION ALERTS" />
      <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {lines.map(({ key, t }) => (
          <div key={key} style={{ display: 'flex', gap: 8, padding: '7px 10px', background: 'rgba(255,176,32,.08)', borderLeft: `2px solid ${T.warn}` }}>
            <span style={{ font: F.chk(700, 11), color: T.warn }}>▲</span>
            <span style={{ font: F.chk(700, 11.5), letterSpacing: '.06em', color: T.warn }}>{t}</span>
          </div>
        ))}
        {showUnlock && lockActive && <UnlockStations />}
      </div>
    </div>
  );
}
