import { useState } from 'react';
import { RUNWAYS, useRunway } from '../runway';
import type { Player } from '../api/types';
import { useStore } from '../store';
import { F, T, TAB, teamColor } from '../tokens';
import { BTN_RESET, OutlineTag, PrimaryButton, Progress, ScreenHeader, Seg, Tag } from '../ui';


export function Lobby() {
  const { state, run, api, setView } = useStore();
  const [runway, setRunway] = useRunway();   // survives a tab switch (field 2026-08-30)
  const [drag, setDrag] = useState<string | null>(null);
  if (!state) return null;
  const { players, lobby, readiness, teams } = state;
  const teamIds = state.config.mode === 'ffa' ? ['ffa'] : state.config.teams.map(t => t.team_id);
  const cols = teamIds.map(id => ({ id, name: teams.find(t => t.team_id === id)?.name ?? `${id.toUpperCase()} TEAM`, color: teamColor(id), members: players.filter(p => p.team_id === id) }));
  const unassigned = players.filter(p => !teamIds.includes(p.team_id ?? ''));
  const counts = cols.map(c => c.members.length);
  const balanced = Math.max(...counts) - Math.min(...counts) <= 1 && unassigned.length === 0;
  const nReady = players.filter(p => p.ready).length;
  const notReady = players.filter(p => !p.ready).map(p => p.display);
  const allReady = nReady === players.length && players.length > 0;
  const acked = Object.values(lobby.acks).filter(a => a.ok).length;
  const allAcked = lobby.pushed && acked === players.length;
  // Field 2026-08-30: the rail said only "E20D RED ON THE BOARD" and the operator read it as MC being
  // stuck — the REASON (GUN LINK LOST) was on the muster board, a screen away. Carry the blocker here.
  const redRows = readiness.board.filter(b => b.status === 'red');
  const waitRows = readiness.board.filter(b => b.status === 'waiting');
  // Both block the push, but they are different situations and must not be described the same way:
  // `red` is a fault, `waiting` is just a phone that has not arrived (field 2026-09-01).
  const reds = redRows.map(b => b.sticker);
  const blockedCount = redRows.length + waitRows.length;
  const redWhy = redRows.map(b => `${b.sticker}: ${(b.blockers ?? []).join(', ') || 'NOT READY'}`).join('  ·  ');
  const waitWhy = waitRows.length
    ? `WAITING FOR ${waitRows.length} PHONE${waitRows.length === 1 ? '' : 'S'} — ${waitRows.map(b => b.sticker).join(' + ')}`
    : '';

  // Two deliberate clicks (design-critic #5): PUSH, verify the acks/echoes land, THEN arm the countdown.
  const pushAndArm = async (force = false) => {
    if (!lobby.pushed) { await run(() => api.pushLobby(force)); return; }   // stop here — the rail's step 2 is real now
    const s = await run(() => api.start(runway, force));
    if (s) setView('armed');
  };
  const reteam = (p: Player, team_id: string) => { if (p.team_id !== team_id) run(() => api.patchPlayer(p.player_id, { team_id })); };

  return (
    <div className="screen">
      <ScreenHeader kicker="[ A5 // LOBBY ]" title="Team Assignment" right={
        <>
          <Tag color={balanced ? T.ok : T.warn} size={9} style={{ letterSpacing: '.2em', padding: '3px 10px' }}>{counts.join(' V ')} — {balanced ? 'BALANCED' : 'UNBALANCED'}</Tag>
          <Progress n={nReady} total={players.length} label="READY" color={T.ok} />
        </>
      } />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {cols.map(col => (
          <div key={col.id} style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column' }}
            onDragOver={e => e.preventDefault()} onDrop={() => { const p = players.find(x => x.player_id === drag); if (p) reteam(p, col.id); setDrag(null); }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: T.panelAlt, border: `1px solid ${T.line}`, borderBottom: 'none', borderTop: `2px solid ${col.color}` }}>
              <span style={{ font: F.chk(700, 13), letterSpacing: '.24em', color: col.color }}>{col.name}</span>
              <span style={{ flex: 1 }} />
              <span style={{ font: F.osw(600, 12), ...TAB, color: T.dim }}>{col.members.length} OPERATORS</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: `1px solid ${drag ? T.acc : T.line}`, padding: 6, background: T.panelDeep, minHeight: 200 }}>
              {col.members.map(mb => <MemberRow key={mb.player_id} p={mb} teamIds={teamIds} onDragStart={() => setDrag(mb.player_id)} onMove={t => reteam(mb, t)} />)}
            </div>
          </div>
        ))}
        {unassigned.length > 0 && (
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ padding: '10px 14px', background: T.panelAlt, border: `1px solid ${T.line}`, borderBottom: 'none', borderTop: `2px solid ${T.warn}`, font: F.chk(700, 13), letterSpacing: '.24em', color: T.warn }}>UNASSIGNED</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: `1px solid ${T.line}`, padding: 6, background: T.panelDeep }}>
              {unassigned.map(mb => <MemberRow key={mb.player_id} p={mb} teamIds={teamIds} onDragStart={() => setDrag(mb.player_id)} onMove={t => reteam(mb, t)} />)}
            </div>
          </div>
        )}
      </div>
      {/* action rail */}
      <div style={{ marginTop: 16, background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`, padding: '14px 18px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 34px' }}>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
          <Step n={1} done={allReady} label={<>ALL READY <span style={{ color: allReady ? T.ok : T.warn }}>{nReady}/{players.length}</span></>} />
          <Step n={2} done={allAcked} label={<>PUSH CONFIG {lobby.pushed && <span style={{ color: allAcked ? T.ok : T.warn }}>{acked}/{players.length} ACKED</span>}</>} />
          <Step n={3} done={false} label={<>ARM COUNTDOWN <Seg value={String(runway) as '60'} options={RUNWAYS.map(r => ({ value: String(r) as '60', label: `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}` }))} onChange={v => setRunway(Number(v))} size={10} pad="3px 9px" /></>} />
        </div>
        <span style={{ flex: 1 }} />
        {reds.length > 0
          ? <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.bad }}>▲ {redWhy} — CLEAR IT, OR PUSH ANYWAY BELOW</span>
          : waitRows.length > 0
            ? <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.micro }}>{waitWhy}</span>
          : notReady.length > 0
            ? <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.warn }}>▲ {notReady.join(' + ')} NOT READY — LAST MOMENT ALL NODES ARE IN RANGE</span>
            : lobby.pushed && !allAcked
              ? <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.warn }}>▲ {Object.entries(lobby.acks).filter(([, a]) => !a.ok).map(([id]) => players.find(p => p.player_id === id)?.display).join(' + ')} DID NOT ECHO — HEADSET? GUN ASLEEP?</span>
              : <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.ok }}>ALL NODES READY &amp; IN RANGE — PUSH, THEN WALK</span>}
        <PrimaryButton onClick={() => pushAndArm()} disabled={blockedCount > 0 || players.length === 0 || (lobby.pushed && !allAcked)} title={lobby.pushed && !allAcked ? 'Waiting for every gun to echo the config' : allReady ? '' : 'Host override: pushing with players not ready'}>
          {lobby.pushed ? 'ARM COUNTDOWN ▸' : 'PUSH CONFIG & ARM ▸'}
        </PrimaryButton>
      </div>
      {blockedCount > 0 && (
        // The override has to cover BOTH steps. Forcing a push does not clear the red — it usually adds
        // one (the gun that could not ack gets GUN DID NOT ANSWER CONFIG) — so an override that stopped
        // at PUSH left the operator with ARM still disabled and no button left to press. (Review, 2026-08-31.)
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', font: F.mono(500, 9), letterSpacing: '.14em', color: T.dim }}>
          HOST OVERRIDE ▸ <button type="button" className="hov-acc-ink hit44" style={{ ...BTN_RESET, cursor: 'pointer', color: T.bad, minHeight: 28 }}
            title={lobby.pushed
              ? 'Arms the countdown anyway. Nodes still red will not be armed — everyone else starts on time.'
              : 'Compiles and pushes to every bound node anyway. A gun that is not linked will simply not ack.'}
            onClick={() => pushAndArm(true)}>
            [ {lobby.pushed ? 'ARM' : 'PUSH'} ANYWAY OVER {[reds.length && `${reds.length} RED`, waitRows.length && `${waitRows.length} MISSING`].filter(Boolean).join(' + ')} ]
          </button>
          <span style={{ color: T.micro }}>{[redWhy, waitWhy].filter(Boolean).join('  ·  ')}</span>
        </div>
      )}
      {!allReady && players.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', font: F.mono(500, 9), letterSpacing: '.14em', color: T.dim }}>
          HOST OVERRIDE ▸ {players.filter(p => !p.ready).map(p => (
            <button key={p.player_id} type="button" className="hov-acc-ink hit44" style={{ ...BTN_RESET, cursor: 'pointer', color: T.dim, minHeight: 28 }} onClick={() => run(() => api.setReady(p.player_id, true))}>[ READY {p.display} ]</button>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberRow({ p, teamIds, onDragStart, onMove }: { p: Player; teamIds: string[]; onDragStart: () => void; onMove: (team_id: string) => void }) {
  const others = teamIds.filter(t => t !== p.team_id);
  return (
    <div className="hov-acc" draggable onDragStart={onDragStart}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: T.panel, border: `1px solid ${T.line}`, cursor: 'grab', minHeight: 44, flexWrap: 'wrap' }}>
      <span aria-hidden style={{ font: F.mono(600, 12), color: T.faint, letterSpacing: '-.1em' }}>⠿</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', font: F.chk(700, 14), letterSpacing: '.14em' }}><span style={{ color: T.micro, font: F.mono(500, 10) }}>#{p.player_num} </span>{p.display}</span>
        <span style={{ display: 'block', font: F.mono(500, 10), color: T.micro }}>{p.gun_id ?? 'NO GUN'}</span>
      </span>
      {/* tap-to-move (tablets have no HTML5 drag): one chip per other team */}
      <span role="group" style={{ display: 'inline-flex', gap: 3 }} aria-label={`move ${p.display} to`}>
        {others.map(t => (
          <button key={t} type="button" className="hit44" onClick={() => onMove(t)} title={`Move ${p.display} to ${t.toUpperCase()}`}
            style={{ ...BTN_RESET, font: F.chk(700, 9), letterSpacing: '.14em', padding: '4px 8px', color: teamColor(t), border: `1px solid ${T.line}`, minHeight: 28, display: 'inline-flex', alignItems: 'center' }}>
            ▸ {t.toUpperCase()}
          </button>
        ))}
      </span>
      {p.ready ? <OutlineTag color={T.ok} border="rgba(46,204,113,.5)">READY</OutlineTag> : <OutlineTag color={T.micro} border={T.line}>WAIT</OutlineTag>}
    </div>
  );
}

function Step({ n, done, label }: { n: number; done: boolean; label: React.ReactNode }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ font: F.osw(700, 11), background: done ? T.ok : T.line, color: done ? T.accInk : T.dim, padding: '1px 7px' }}>{n}</span>
      <span style={{ font: F.chk(600, 11), letterSpacing: '.14em', color: T.dim, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{label}</span>
    </span>
  );
}
