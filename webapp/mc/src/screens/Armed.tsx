import { useEffect, useState } from 'react';
import { RUNWAYS, useRunway } from '../runway';
import { coverageLine } from '../api/derive';
import { useStore } from '../store';
import { EvictButton } from '../ui/EvictButton';
import { F, T, TAB, fmtAge, fmtClock } from '../tokens';
import { Brackets, GhostButton, HazardButton, ScreenHeader, Seg, Tag } from '../ui';
import { SetupSteps } from '../ui/SetupSteps';


export function Armed() {
  const { state, run, api, setView, serverNow, connected } = useStore();
  const [, tick] = useState(0);
  const [runway, setRunway] = useRunway();   // survives a tab switch (field 2026-08-30)
  // ...but once a countdown IS armed, show what the SERVER armed. Otherwise a reload (or a second
  // operator's console) offers this browser's stored pick, and CONFIRM restarts everyone at that
  // value instead of the armed one (review 2026-08-31).
  const armedRunway = state?.start?.countdown_s ?? null;
  const shownRunway = armedRunway ?? runway;
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [reschedConfirm, setReschedConfirm] = useState(false);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 250); return () => clearInterval(id); }, []);
  if (!state) return null;
  // A28.4: derived, never asserted — grey the count while the tunnel is off, since it can only be 0.
  const cLine = coverageLine(state);
  const cColor = state.lan.public?.status !== 'up' ? T.micro : state.coverage?.level === 'full' ? T.ok : T.warn;
  const st = state.start;
  if (!st) {
    return (
      <div className="screen">
        <ScreenHeader kicker="[ A6 // DISPERSED START ]" title="Match Arming" right={
          <>
            {cLine && <Tag color={cColor} size={9} style={{ letterSpacing: '.2em', padding: '3px 10px' }}>{cLine}</Tag>}
            <GhostButton onClick={() => setView('lobby')}>◂ BACK TO LOBBY</GhostButton>
          </>} />
        <div style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.micro }}>NO SCHEDULE — PUSH CONFIG &amp; ARM FROM THE LOBBY.</div>
      </div>
    );
  }
  const tMinus = Math.max(0, st.go_live_t - serverNow());
  const nodes = state.players.map(p => ({ p, n: st.per_node[p.player_id], nv: state.nodes.find(x => x.player_id === p.player_id) }));
  const armed = nodes.filter(x => x.n?.arm_state === 'armed' || x.n?.arm_state === 'live').length;
  const inRange = nodes.filter(x => (x.n?.last_seen_ms ?? 1e9) < 8000).length;
  const outOfRange = nodes.length - inRange;

  return (
    <div className="screen">
      <ScreenHeader kicker="[ A6 // DISPERSED START ]" title="Match Arming" right={
        <>
          {cLine && <Tag color={cColor} size={9} style={{ letterSpacing: '.2em', padding: '3px 10px' }}>{cLine}</Tag>}
          <GhostButton onClick={() => setView('lobby')}>◂ BACK TO LOBBY</GhostButton>
          {reschedConfirm ? (<>
            <GhostButton color={T.warn} border={T.warn} onClick={() => { setReschedConfirm(false); run(() => api.reschedule(shownRunway)); }}>CONFIRM — RESTART EVERY COUNTDOWN AT {String(Math.floor(shownRunway / 60)).padStart(2, '0')}:{String(shownRunway % 60).padStart(2, '0')}</GhostButton>
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
        <div style={{ opacity: connected ? 1 : .45 }} title={connected ? undefined : 'MC offline — countdown shown from the last snapshot'}>
          <div role="status" aria-live="polite" style={{ font: F.mono(500, 9), letterSpacing: '.26em', color: T.micro }}>{connected ? 'SYNCED GO-LIVE IN' : 'SYNCED GO-LIVE IN · OFFLINE'}</div>
          <div aria-live="off" style={{ font: F.osw(700, 56), ...TAB, letterSpacing: '.04em', lineHeight: 1 }}>T-{fmtClock(tMinus / 1000)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: F.mono(500, 9), letterSpacing: '.22em', color: T.micro }}>RESCHEDULE TO</span>
          <Seg value={String(shownRunway) as '60'} options={RUNWAYS.map(r => ({ value: String(r) as '60', label: fmtClock(r) }))} onChange={v => setRunway(Number(v))} pad="5px 12px" />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ font: F.chk(600, 12), letterSpacing: '.08em', color: T.body }}>{armed}/{nodes.length} NODES ARMED · {nodes.length - armed} AWAITING ACK · {outOfRange} OUT OF RANGE</div>
          <div style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: T.micro, marginTop: 4 }}>GUNS COUNT DOWN ON THEIR OWN — PLAYERS MAY SCATTER OUT OF RANGE. ALL GO LIVE AT T-0. RESCHEDULE FURTHER OUT <span style={{ color: T.warn }}>BEFORE</span> THE WALK; AN ABORT REACHES ONLY NODES IN RANGE.</div>
          <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.faint, marginTop: 4 }}>MATCH {st.match_id.toUpperCase()} · SEQ {st.seq}</div>
        </div>
      </Brackets>
      {/* still actionable during the runway: the grenade is placed while the players walk */}
      <SetupSteps style={{ marginBottom: 12 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
        {nodes.map(({ p, n, nv }) => {
          const ack = n?.arm_state === 'armed' || n?.arm_state === 'live';
          const live = n?.arm_state === 'live';
          const color = live ? T.acc : ack ? T.ok : T.warn;
          const stale = (n?.last_seen_ms ?? 1e9) > 8000;
          return (
            <div key={p.player_id} style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${color}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ font: F.osw(700, 15), letterSpacing: '.08em' }}>{p.gun_id ?? '—'}</span>
                <Tag color={color} size={9} style={{ letterSpacing: '.16em', padding: '2px 7px' }}>{live ? 'LIVE' : ack ? 'ARMED' : 'NO ACK'}</Tag>
              </div>
              <div style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: T.micro }}>#{p.player_num} {p.display}</div>
              <div style={{ font: F.osw(700, 22), ...TAB, color: ack ? T.ink : T.warn }}>{ack ? (live ? 'LIVE' : `T-${fmtClock(tMinus / 1000)}`) : '——:——'}</div>
              <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: ack && !stale ? T.dim : T.warn }}>
                {ack ? (stale ? `COUNTING · AUTONOMOUS · LAST SEEN ${fmtAge(n!.last_seen_ms)}` : 'COUNTING · AUTONOMOUS') : `RETRYING · LAST SEEN ${fmtAge(n?.last_seen_ms ?? 0)}`}
                {n && !n.synced && ' · UNSYNCED'}
              </div>
              {nv && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><EvictButton nodeId={nv.node_id} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
