import { useEffect, useState } from 'react';
import type { LiveRow } from '../api/types';
import { useStore } from '../store';
import { F, T, TAB, fmtAge, fmtClock, teamColor } from '../tokens';
import { Blink, GhostButton, Tag } from '../ui';

const COLS = 'minmax(130px,1.5fr) 40px 40px 40px 52px 56px 48px minmax(100px,1fr) 84px';

export function Live() {
  const { state, feed, run, api, serverNow } = useStore();
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 500); return () => clearInterval(id); }, []);
  if (!state) return null;
  const lv = state.live;
  if (!lv) {
    return <div className="screen" style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.micro }}>NO MATCH LIVE — THE BOARD FILLS WHEN NODES GO LIVE AT T-0.</div>;
  }
  const remaining = Math.max(0, lv.ends_t - serverNow()) / 1000;
  const teamIds = state.config.mode === 'ffa' ? [] : state.config.teams.map(t => t.team_id);
  const rows = [...lv.rows].sort((a, b) => b.kills - a.kills);
  const cap = state.config.scoring.frag_limit;

  return (
    <div className="screen">
      {/* score strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 2, marginBottom: 16 }}>
        {teamIds.length >= 2 ? (
          <>
            <TeamScore id={teamIds[0]} score={lv.score[teamIds[0]] ?? 0} side="left" />
            <TimeCell remaining={remaining} sub={`${state.config.mode.toUpperCase()}${cap ? ` · CAP ${cap}` : ''}`} />
            <TeamScore id={teamIds[1]} score={lv.score[teamIds[1]] ?? 0} side="right" />
            {teamIds.slice(2).map(id => <TeamScore key={id} id={id} score={lv.score[id] ?? 0} side="left" />)}
          </>
        ) : (
          <>
            <div style={{ flex: '1 1 220px', background: `linear-gradient(90deg,rgba(232,238,245,.1),transparent)`, border: `1px solid ${T.line}`, borderLeft: `4px solid ${T.ink}`, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 18 }}>
              <span style={{ font: F.chk(700, 15), letterSpacing: '.3em', color: T.ink }}>FFA LEADER</span>
              <span style={{ font: F.osw(700, 40), ...TAB, lineHeight: 1 }}>{rows[0]?.display ?? '—'}</span>
              <span style={{ font: F.osw(700, 64), ...TAB, lineHeight: 1 }}>{rows[0]?.kills ?? 0}</span>
            </div>
            <TimeCell remaining={remaining} sub={`FFA${cap ? ` · CAP ${cap}` : ''}`} />
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 560px', minWidth: 0, overflowX: 'auto' }}>
          <div style={{ minWidth: 640 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: '0 10px', padding: '8px 14px', background: T.panelAlt, border: `1px solid ${T.line}`, font: F.mono(500, 9), letterSpacing: '.18em', color: T.micro }}>
              <span>OPERATOR</span><R>K</R><R>D</R><R>A</R><R>K/D</R><R>ACC</R><R>STK</R><span>STATUS</span><R>SYNC</R>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
              {rows.map(r => <Row key={r.player_id} r={r} />)}
            </div>
            <div style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.micro, marginTop: 8 }}>K / A / ACC ARE MC-DERIVED — RECONCILED AT SYNC POINTS. OUT-OF-RANGE NODES SHOW LAST KNOWN + AGE, NEVER "GONE".</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <GhostButton onClick={() => run(() => api.control('end'))} title="Early end: reaches only nodes in range; the rest end at the time limit">END MATCH EARLY</GhostButton>
              <GhostButton color={T.warn} border={T.warn} hoverClass="hov-warnbg" onClick={() => run(() => api.control('recall'))}>RECALL</GhostButton>
              <span style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.micro }}>EARLY END / RECALL REACH ONLY NODES IN RANGE — THE REST END AT {fmtClock(lv.time_limit_s)}.</span>
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 280px', maxWidth: 400 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: T.panelAlt, border: `1px solid ${T.line}`, borderBottom: 'none' }}>
            <Blink color={T.bad} period={1.6} size={8} />
            <span style={{ font: F.chk(700, 10), letterSpacing: '.28em', color: T.dim }}>EVENT FEED // LIVE</span>
          </div>
          <div style={{ border: `1px solid ${T.line}`, background: T.panelDeep, padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {feed.length === 0 && <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.faint, padding: 6 }}>WAITING FOR THE FIRST SYNC POINT…</div>}
            {feed.map((ev, i) => {
              const color = ev.tag === 'FIRST BLOOD' || ev.tag === 'TEAM KILL' ? T.bad : ev.tag ? T.warn : ev.kind === 'sync' ? T.acc : T.line;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: T.panel, borderLeft: `2px solid ${color}` }}>
                  <span style={{ font: F.mono(500, 9), color: T.micro, ...TAB }}>{fmtClock(ev.t_match_s)}</span>
                  <span style={{ flex: 1, font: F.chk(600, 12), letterSpacing: '.04em', color: T.body }}>{ev.text}</span>
                  {ev.tag && ev.kind !== 'sync' && <Tag color={color} size={8} style={{ letterSpacing: '.16em', padding: '2px 6px' }}>{ev.tag}</Tag>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamScore({ id, score, side }: { id: string; score: number; side: 'left' | 'right' }) {
  const c = teamColor(id);
  const grad = side === 'left' ? `linear-gradient(90deg,${c}29,transparent)` : `linear-gradient(270deg,${c}24,transparent)`;
  return (
    <div style={{ flex: '1 1 220px', background: grad, border: `1px solid ${T.line}`, [side === 'left' ? 'borderLeft' : 'borderRight']: `4px solid ${c}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: side === 'left' ? 'flex-start' : 'flex-end', gap: 18 }}>
      {side === 'left' && <span style={{ font: F.chk(700, 15), letterSpacing: '.3em', color: c }}>{id.toUpperCase()}</span>}
      <span style={{ font: F.osw(700, 64), ...TAB, lineHeight: 1 }}>{score}</span>
      {side === 'right' && <span style={{ font: F.chk(700, 15), letterSpacing: '.3em', color: c }}>{id.toUpperCase()}</span>}
    </div>
  );
}
function TimeCell({ remaining, sub }: { remaining: number; sub: string }) {
  return (
    <div style={{ flex: '0 1 240px', background: T.panel, border: `1px solid ${T.line}`, padding: '14px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <span style={{ font: F.mono(500, 9), letterSpacing: '.26em', color: T.micro }}>TIME REMAINING</span>
      <span style={{ font: F.osw(700, 40), ...TAB, lineHeight: 1 }}>{fmtClock(remaining)}</span>
      <span style={{ font: F.mono(500, 9), letterSpacing: '.2em', color: T.micro }}>{sub}</span>
    </div>
  );
}
function R({ children }: { children: React.ReactNode }) { return <span style={{ textAlign: 'right' }}>{children}</span>; }

function Row({ r }: { r: LiveRow }) {
  const dead = r.status === 'down', stale = r.status === 'stale';
  const syncWarn = stale || r.sync_age_ms > 8000;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: '0 10px', alignItems: 'center', padding: '9px 14px', background: dead ? 'rgba(255,82,82,.05)' : T.panel, border: `1px solid ${T.row}`, borderLeft: `3px solid ${teamColor(r.team_id)}` }}>
      <span style={{ font: F.chk(700, 14), letterSpacing: '.1em' }}>{r.display}</span>
      <span style={{ textAlign: 'right', font: F.osw(700, 16), ...TAB }}>{r.kills}</span>
      <span style={{ textAlign: 'right', font: F.osw(600, 15), ...TAB, color: T.dim }}>{r.deaths}</span>
      <span style={{ textAlign: 'right', font: F.osw(600, 15), ...TAB, color: T.dim }}>{r.assists}</span>
      <span style={{ textAlign: 'right', font: F.osw(600, 14), ...TAB }}>{r.kd.toFixed(1)}</span>
      <span style={{ textAlign: 'right', font: F.osw(600, 14), ...TAB, color: T.dim }}>{r.accuracy == null ? '—' : `${Math.round(r.accuracy)}%`}</span>
      <span style={{ textAlign: 'right', font: F.osw(600, 14), ...TAB, color: r.streak >= 3 ? T.warn : T.dim }}>{r.streak}</span>
      <span style={{ font: F.chk(700, 10), letterSpacing: '.14em', color: stale ? T.warn : dead ? T.bad : T.ok }}>{stale ? 'LAST KNOWN' : dead ? `RESPAWN ${fmtClock(r.respawn_in_s ?? 0).slice(1)}` : 'ALIVE'}</span>
      <span style={{ textAlign: 'right', font: F.mono(500, 10), letterSpacing: '.06em', color: syncWarn ? T.warn : T.faint }}>{fmtAge(r.sync_age_ms)}{stale ? ' AGO' : ''}</span>
    </div>
  );
}
