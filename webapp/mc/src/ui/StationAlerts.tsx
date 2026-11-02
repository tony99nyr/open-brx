// A58: tamper-lock alerts for ASSIGNED stations. Separate from Powerups.tsx (the powerup item/RESET
// pieces) because a lock and its RESTARTED/OFFLINE/LOCK EXPIRES lines are a station-wide concern, not a
// powerup-item one -- every kind of station (respawn, extraction, control, ...) can carry one. Reuses the
// same store the LOBBY/ARMED/LIVE screens already poll for `state.stations` (`PowerupStrip` in
// Powerups.tsx reads the identical `useStore().state.stations`, no separate hook or poller).
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { StationView } from '../api/types';
import { F, T } from '../tokens';
import { serverLine } from '../alerts';
import { STATION_NO_HILL } from '../api/contract.gen';
import { FaultPill, ItemChip } from './Compact';
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
      {err && <FaultPill id="frame-station-unlock-error" testid="station-unlock-error" short="Station unlock refused" why={err} />}
    </div>
  );
}

// MC sends each attention line with a reason and action. The compact label opens that line on tap or hover.
// The catalogue (`src/alerts/server.ts` SERVER_LINES) gives each line its severity.

const KIND_WORD: Record<string, string> = { respawn: 'RESPAWN', powerup: 'POWERUP', extraction: 'EXTRACT', bomb: 'BOMB', control: 'CONTROL' };
const KIND_LABEL: Record<string, string> = { respawn: 'Respawn', powerup: 'Powerup', extraction: 'Extract', bomb: 'Bomb', control: 'Hill' };

/** Bench 2026-11-01: two different alerts on one phone both read "Phone b963 needs attention", so the
 *  operator could not tell them apart without opening each. The chip now names its alert. */
const ALERT_WORDS: Record<string, string> = {
  'station-attention-bring-back': 'out of range', 'station-attention-offline': 'offline', 'frame-station-offline': 'offline',
  'station-attention-battery-low': 'battery low', 'station-attention-phone-not-armed': 'not armed',
  'station-attention-armed-older-game': 'armed for an older game', 'station-attention-id-mismatch': 'advertises the wrong ID',
  'station-attention-restarted': 'restarted', 'station-attention-lock-expires': 'lock expires mid-match',
  'station-attention-claims-dropped': 'dropped claim reports', 'station-attention-nvs-fail': 'cannot save its settings',
  'station-attention-stick-fw-old': 'firmware too old',
  'station-attention-follows': 'follows the players', 'station-attention-hill-pace': 'old hill pace',   // F658
};
const alertName = (id: string, line: string): string =>
  line === STATION_NO_HILL ? 'not armed: no hill in this mode' : ALERT_WORDS[id] ?? 'needs attention';

function stationLabel(s: StationView): string {
  if (s.platform === 'android' || s.platform === 'ios') return `Phone ${s.node_id.slice(-4)}`;
  return `${KIND_LABEL[s.assigned!.kind] ?? s.assigned!.kind} ${s.assigned!.id}`;
}

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
            <ItemChip id="armory-stations-locked-banner" short="Stations locked" detail="The loaded game locked the stations. Unlock them before changing their buttons." />
            <UnlockStations />
          </div>
        )}
      </div>
    );
  }
  const all = stations.flatMap(s => s.attention.map(t => ({
    key: `${s.node_id}-${t}`, t,
    label: stationLabel(s),
    // a line that names no station ("BATTERY LOW") says which one it is about
    who: t.startsWith(STATION_PREFIX) ? null : `${KIND_WORD[s.assigned!.kind] ?? s.assigned!.kind.toUpperCase()} ${s.assigned!.id}`,
  })));
  // Bench 2026-11-01: a NEUTRAL line (STRENGTH EDITED ON STATION …) is a note, not an alert: no chip, no
  // glyph, no amber, and it never makes the strip read STATION ALERTS on its own.
  const lines = all.filter(l => serverLine(l.t, 'amber').sev !== 'neutral');
  const notes = all.filter(l => serverLine(l.t, 'amber').sev === 'neutral');
  const lockActive = stations.some(s => !!s.lock_until_ms && s.lock_until_ms > serverNow());   // MC's clock, as the ITEMS card
  if (!lines.length && !notes.length && !(showUnlock && lockActive)) return null;
  const heading = lines.length || (showUnlock && lockActive) ? 'STATION ALERTS' : 'STATION NOTES';
  return (
    <div data-testid="station-alerts" data-compact={compact ? '1' : undefined} style={{ margin: compact ? '0 0 10px' : '0 0 14px' }}>
      {!compact && <SectionRule label={heading} />}
      <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', flexWrap: 'wrap', alignItems: compact ? 'center' : undefined, gap: 6 }}>
        {compact && <span style={{ font: F.chk(700, 11), letterSpacing: '.2em', color: T.dim }}>{heading}</span>}
        {lines.map(({ key, t, who, label }) => {
          let { id, sev } = serverLine(t, 'amber');
          // F221 round 1: MC's own words cannot tell ARMED from LIVE, but this screen knows the phase.
          // A held station going offline is RED (act now) only while the match it is held for is LIVE;
          // in LOBBY or ARMED it is AMBER (fix before the next match), same as every other attention line.
          if (id === 'station-attention-offline' && state?.phase === 'live') { id = 'frame-station-offline'; sev = 'red'; }
          const short = `${label} ${alertName(id, t)}`;
          const detail = `${who ? `${who} · ` : ''}${t}`;
          return (
            <div key={key} data-station-alert={t} style={{ padding: compact ? '2px 0' : '3px 0' }}>
              {sev === 'red' ? <FaultPill id={id} sev={sev} role="status" short={short} why={detail} /> : <ItemChip id={id} sev={sev} short={short} detail={detail} />}
            </div>
          );
        })}
        {notes.map(({ key, t, label }) => (
          <div key={key} data-station-note={t} data-sev="neutral" style={{ font: F.chk(500, 12), color: T.micro, padding: compact ? '2px 0' : '3px 0' }}>
            {label} · {t}
          </div>
        ))}
        {showUnlock && lockActive && <UnlockStations />}
      </div>
    </div>
  );
}
