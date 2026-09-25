import { useEffect, useState } from 'react';
import { STALE_AFTER_MS } from '../api/types';
import { useRunway } from '../runway';
import { useStore } from '../store';
import { EvictButton } from '../ui/EvictButton';
import { F, T, fmtAge, fmtClock } from '../tokens';
import { Brackets, GhostButton, HazardButton, Num, ScreenHeader, Tag, shortCoverageLine, coverageColor } from '../ui';
import { AlertTag } from '../ui/Alert';
import { GLYPH, colourOf } from '../alerts';
import { SetupSteps } from '../ui/SetupSteps';
import { PowerupStrip } from '../ui/Powerups';
import { StationAlerts } from '../ui/StationAlerts';


export function Armed() {
  const { state, run, api, setView, serverNow, connected } = useStore();
  const [, tick] = useState(0);
  const [runway] = useRunway();   // survives a tab switch (field 2026-08-30)
  // ...but once a countdown IS armed, show what the SERVER armed. Otherwise a reload (or a second
  // operator's console) offers this browser's stored pick, and CONFIRM restarts everyone at that
  // value instead of the armed one (review 2026-08-31). The picker itself belongs to the LOBBY's
  // ARM COUNTDOWN control (F160, bench 2026-09-17): once armed, changing this Seg had NO effect
  // (shownRunway always wins over the local pick), so it read as a live control that quietly did
  // nothing. Read-only text is the honest version of the same information.
  const armedRunway = state?.start?.countdown_s ?? null;
  const shownRunway = armedRunway ?? runway;
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [reschedConfirm, setReschedConfirm] = useState(false);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 250); return () => clearInterval(id); }, []);
  if (!state) return null;
  // A28.4: derived, never asserted — grey the count while the tunnel is off, since it can only be 0.
  const cLine = shortCoverageLine(state.coverage);
  // Field feedback 2026-09-19 (Tony): partial coverage is not a fault, so it is neutral, never amber.
  const cColor = coverageColor(state.coverage);   // F309: green only at derived FULL coverage
  const st = state.start;
  if (!st) {
    return (
      <div className="screen">
        <ScreenHeader kicker="[ A6 // DISPERSED START ]" title="Match Arming" right={
          <>
            {cLine && <Tag color={cColor} size={9} style={{ letterSpacing: '.2em', padding: '3px 10px' }}>{cLine}</Tag>}
            <GhostButton onClick={() => setView('lobby')}>◂ BACK TO LOBBY</GhostButton>
          </>} />
        <div style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: colourOf('armed-no-schedule') }}>NO SCHEDULE: PUSH CONFIG AND ARM FROM THE LOBBY.</div>
      </div>
    );
  }
  const tMinus = Math.max(0, st.go_live_t - serverNow());
  const nodes = state.players.map(p => ({ p, n: st.per_node[p.player_id], nv: state.nodes.find(x => x.player_id === p.player_id) }));
  const armed = nodes.filter(x => x.n?.arm_state === 'armed' || x.n?.arm_state === 'live').length;
  const inRange = nodes.filter(x => (x.n?.last_seen_ms ?? 1e9) < STALE_AFTER_MS).length;
  const outOfRange = nodes.length - inRange;

  return (
    <div className="screen">
      <ScreenHeader kicker="[ A6 // DISPERSED START ]" title="Match Arming" right={
        <>
          {cLine && <Tag color={cColor} size={9} style={{ letterSpacing: '.2em', padding: '3px 10px' }}>{cLine}</Tag>}
          <GhostButton onClick={() => setView('lobby')}>◂ BACK TO LOBBY</GhostButton>
          {reschedConfirm ? (<>
            <GhostButton color={T.warn} border={T.warn} onClick={() => { setReschedConfirm(false); run(() => api.reschedule(shownRunway)); }}>CONFIRM — RESTART EVERY COUNTDOWN AT {fmtClock(shownRunway)}</GhostButton>
            <GhostButton onClick={() => setReschedConfirm(false)}>CANCEL</GhostButton>
          </>) : (
            <GhostButton color={T.warn} border={T.warn} hoverClass="hov-warnbg" onClick={() => setReschedConfirm(true)} title="Two-step: pushes a fresh go-live time to every node in range">RESCHEDULE</GhostButton>
          )}
          {confirmAbort ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.bad }}>ABORT REACHES ONLY NODES IN RANGE ({inRange}/{nodes.length}) — RESCHEDULE INSTEAD?</span>
              <HazardButton size={11} stripe={10} pad="9px 14px 9px 12px" onClick={async () => { setConfirmAbort(false); const r = await run(() => api.abort()); if (r) setView('lobby'); }}>CONFIRM ABORT</HazardButton>
              <GhostButton onClick={() => setConfirmAbort(false)}>CANCEL</GhostButton>
            </span>
          ) : (
            <HazardButton size={11} stripe={10} pad="9px 14px 9px 12px" onClick={() => setConfirmAbort(true)}>ABORT</HazardButton>
          )}
        </>
      } />
      <Brackets style={{ padding: '18px 22px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 44px', marginBottom: 16 }}>
        <div style={{ opacity: connected ? 1 : .45 }} title={connected ? undefined : 'MC offline: countdown shown from the last snapshot'}>
          {/* F221 round 2 (Tony): the frame already carries MC_OFFLINE once, RED. A second RED banner
              here said the same fact twice on one screen. This line says only what the countdown
              itself loses (it is the last snapshot, not a live server), folded in and NEUTRAL.
              `armed-offline-synced` (alerts/lobby.ts) is NEUTRAL for that reason. */}
          <div role="status" aria-live="polite" style={{ font: F.mono(500, 9), letterSpacing: '.26em', color: T.micro }}>
            SYNCED GO-LIVE IN{!connected && <span data-testid="armed-mc-offline" data-alert="armed-offline-synced" data-sev="neutral" style={{ color: colourOf('armed-offline-synced') }}> · OFFLINE</span>}
          </div>
          {/* the countdown is the fastest-moving number on the console — a per-digit cell is what keeps
              it from re-laying-out on every tick (the HUD hit exactly this, game test A5) */}
          <div aria-live="off" style={{ font: F.osw(700, 56), letterSpacing: '.04em', lineHeight: 1 }}>T-<Num value={fmtClock(tMinus / 1000)} /></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} data-testid="armed-countdown-length">
          <span style={{ font: F.mono(500, 9), letterSpacing: '.22em', color: T.micro }}>ARMED AT</span>
          <span style={{ font: F.osw(700, 16) }}>{fmtClock(shownRunway)}</span>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ font: F.chk(600, 12), letterSpacing: '.08em', color: colourOf('armed-nodes-summary') }}>{armed}/{nodes.length} NODES ARMED · {nodes.length - armed} AWAITING ACK · {outOfRange} OUT OF RANGE</div>
          {/* F221: this is a standing instructional reminder, not a fault, so it is NEUTRAL, plain
              text throughout — the mid-sentence amber "BEFORE" the audit flagged (an emphasis style
              used nowhere else on these two screens) is gone, and the em dash reads as a full stop. */}
          <div style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: colourOf('armed-reminder-line'), marginTop: 4 }}>GUNS COUNT DOWN ON THEIR OWN. PLAYERS MAY SCATTER OUT OF RANGE. ALL GO LIVE AT T-0. RESCHEDULE FURTHER OUT BEFORE THE WALK. AN ABORT REACHES ONLY NODES IN RANGE.</div>
          <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.faint, marginTop: 4 }}>MATCH {st.match_id.toUpperCase()} · SEQ {st.seq}</div>
        </div>
      </Brackets>
      {/* Match reminders: still actionable during the runway (the grenade is placed while the
          players walk), plus A31's standing "this win is settled at MC" line */}
      <SetupSteps style={{ marginBottom: 12 }} />
      <StationAlerts showUnlock />
      <PowerupStrip />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
        {nodes.map(({ p, n, nv }) => {
          const ack = n?.arm_state === 'armed' || n?.arm_state === 'live';
          const live = n?.arm_state === 'live';
          const color = live ? T.acc : ack ? T.ok : colourOf('armed-node-noack');
          const stale = (n?.last_seen_ms ?? 1e9) > STALE_AFTER_MS;
          // Sweep: a node that acked but has gone stale mid-countdown is the same gun-link risk as one
          // that never acked at all — both get the red RETRYING treatment, not just the unacked one.
          const linkFault = !ack || stale;
          const linkColor = linkFault ? colourOf('armed-retrying') : T.dim;
          return (
            <div key={p.player_id} style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${color}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ font: F.osw(700, 15), letterSpacing: '.08em' }}>{p.gun_id ?? '—'}</span>
                {/* F221 polish r1: NO ACK is a catalogued amber alert (`armed-node-noack`), and AMBER is
                    never a filled chip, so it draws through `<AlertTag>` (outline), not the plain
                    filled `<Tag>` LIVE/ARMED use for their own positive status. */}
                {live || ack
                  ? <Tag color={color} size={9} style={{ letterSpacing: '.16em', padding: '2px 7px' }}>{live ? 'LIVE' : 'ARMED'}</Tag>
                  : <AlertTag id="armed-node-noack">NO ACK</AlertTag>}
              </div>
              <div style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: T.micro }}>#{p.player_num} {p.display}</div>
              <div style={{ font: F.osw(700, 22), color: ack ? T.ink : colourOf('armed-retrying') }}>{ack ? (live ? 'LIVE' : <>T-<Num value={fmtClock(tMinus / 1000)} /></>) : '——:——'}</div>
              <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: linkColor }}>
                {linkFault && <span aria-hidden="true">{GLYPH} </span>}
                {ack ? (stale ? `COUNTING · AUTONOMOUS · LAST SEEN ${fmtAge(n!.last_seen_ms)}` : 'COUNTING · AUTONOMOUS') : `RETRYING · LAST SEEN ${fmtAge(n?.last_seen_ms ?? 0)}`}
                {n && !n.synced && <span style={{ color: colourOf('armed-unsynced-suffix') }}> {GLYPH} UNSYNCED</span>}
              </div>
              {nv && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><EvictButton nodeId={nv.node_id} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
