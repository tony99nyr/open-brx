import type { ScoreRow } from '../api/types';
import { useStore } from '../store';
import { CHAMFER, F, T, TAB, fmtClock, teamColor } from '../tokens';
import { Brackets, SectionRule, PrimaryButton } from '../ui';

const COLS = 'minmax(130px,1.5fr) 40px 40px 40px 52px 56px 48px minmax(120px,1fr)';
const AWARD_COLOR: Record<string, string> = { MVP: '#ffd23f', 'FIRST BLOOD': T.bad, MULTIKILL: T.warn };

export function Recap() {
  const { state, run, api, setView } = useStore();
  if (!state) return null;
  const rc = state.recap;
  if (!rc) return <div className="screen" style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.micro }}>NO RECAP YET — THE MATCH ENDS AT THE TIME LIMIT ON EVERY NODE.</div>;
  const name = (id: string) => state.players.find(p => p.player_id === id)?.display ?? rc.rows.find(r => r.player_id === id)?.display ?? id;
  const w = rc.winner ?? {};
  const teamLabel = (id: string) => (state.teams.find(t => t.team_id === id)?.name ?? id).toUpperCase();
  const winColor = w.team_id ? teamColor(w.team_id) : T.ink;
  const winnerBlock = w.tie?.length ? { text: `TIE — ${w.tie.map(teamLabel).join(' / ')}`, tail: '' }
    : w.undecided ? { text: `UNDECIDED — ${w.undecided.toUpperCase()}`, tail: ' · HOST DECIDES' }
    : w.player_id ? { text: name(w.player_id), tail: ' WINS' }
    : w.team_id ? { text: teamLabel(w.team_id), tail: ' WINS' }
    : { text: 'NO RESULT', tail: '' };
  const scores = Object.entries(rc.score);
  const rows = [...rc.rows].sort((a, b) => b.kills - a.kills);
  const mvpId = rc.honors.find(h => h.award === 'MVP')?.player_id;
  const csv = api.recapCsvUrl();

  return (
    <div className="screen">
      {rc.provisional && (
        <div style={{ marginBottom: 12, padding: '8px 14px', border: `1px solid ${T.warn}`, borderLeft: `3px solid ${T.warn}`, background: 'rgba(255,176,32,.08)', font: F.mono(500, 10), letterSpacing: '.12em', color: T.warn }}>
          ▲ PROVISIONAL — {rc.missing.length} NODE{rc.missing.length === 1 ? ' HAS' : 'S HAVE'} NOT FLUSHED ({rc.missing.map(name).join(', ')}). KILLS LIVE IN VICTIMS' REPORTS; BRING THEM INTO RANGE TO FINALIZE.
        </div>
      )}
      <div style={{ font: F.mono(500, 10), letterSpacing: '.28em', color: T.dim, marginBottom: 8 }}>[ A8 // MATCH COMPLETE · {state.config.mode.toUpperCase()} · {fmtClock(state.config.time_limit_s ?? 0)} ]</div>
      <Brackets color="#ffd23f" size={18} style={{ background: `linear-gradient(90deg,rgba(255,210,63,.1),transparent 60%),linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, padding: '22px 26px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 44px', marginBottom: 18 }}>
        <div>
          <div style={{ font: F.osw(700, 46), letterSpacing: '.08em', lineHeight: 1.15 }}>
            <span style={{ background: winColor, color: T.accInk, padding: '0 12px' }}>{winnerBlock.text}</span>{winnerBlock.tail}
          </div>
        </div>
        {scores.length >= 2 ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            {scores.sort((a, b) => b[1] - a[1]).map(([id, s], i) => (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 12 }}>
                {i > 0 && <span style={{ font: F.osw(600, 20), color: T.micro }}>—</span>}
                <span style={{ font: F.osw(700, 44), ...TAB, color: teamColor(id) }}>{s}</span>
              </span>
            ))}
          </div>
        ) : (
          <span style={{ font: F.osw(700, 44), ...TAB, color: T.ink }}>{rows[0]?.kills ?? 0} <span style={{ font: F.chk(600, 12), color: T.micro }}>KILLS</span></span>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href={csv} download="brx-recap.csv" className="hov-acc" style={{ font: F.chk(700, 12), letterSpacing: '.18em', padding: '11px 22px', background: 'transparent', border: `1px solid ${T.line2}`, color: T.dim, textDecoration: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>⬇ EXPORT CSV{rc.provisional ? ' (PROVISIONAL)' : ''}</a>
          <PrimaryButton size={13} onClick={async () => { const s = await run(() => api.newSession(true)); if (s) setView('muster'); }}>NEW MATCH ▸</PrimaryButton>
        </div>
      </Brackets>
      {rc.honors.length > 0 && (<>
      <SectionRule label="HONORS" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(168px,1fr))', gap: 8, marginBottom: 22 }}>
        {rc.honors.map(h => {
          const c = AWARD_COLOR[h.award] ?? T.acc;
          return (
            <div key={h.award} style={{ background: T.panel, border: `1px solid ${T.line}`, borderTop: `2px solid ${c}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, clipPath: CHAMFER.br8 }}>
              <span style={{ font: F.mono(500, 9), letterSpacing: '.22em', color: c }}>{h.award}</span>
              <span style={{ font: F.osw(700, 19), letterSpacing: '.08em' }}>{name(h.player_id)}</span>
              <span style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: T.micro }}>{h.stat}</span>
            </div>
          );
        })}
      </div>
      </>)}
      <SectionRule label="DATA SYNC" hint="WHO HAS DELIVERED THEIR MATCH DATA" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
        {state.players.map(pl => {
          const nv = state.nodes.find(n => n.node_id === pl.node_id);
          const missing = rc.missing.includes(pl.player_id);
          const fresh = nv && (nv.last_seen_ms ?? 1e9) < 30000;
          const pend = nv?.pending ?? null;
          const [txt, col] = !missing ? ['SYNCED ✓', T.ok]
            : fresh && pend ? [`SENDING · ${pend} LEFT`, T.warn]
            : fresh ? ['CONNECTED — AWAITING DATA', T.warn]
            : ['OUT OF RANGE — WILL SYNC ON RETURN', T.bad];
          return (
            <span key={pl.player_id} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${col}`, padding: '8px 14px' }}>
              <span style={{ font: F.chk(700, 12), letterSpacing: '.06em' }}>{pl.display}</span>
              <span style={{ font: F.mono(600, 10), letterSpacing: '.12em', color: col }}>{txt}</span>
            </span>
          );
        })}
      </div>
      <SectionRule label="FULL STATS" />
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 640 }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: '0 10px', padding: '8px 14px', background: T.panelAlt, border: `1px solid ${T.line}`, font: F.mono(500, 9), letterSpacing: '.18em', color: T.micro }}>
            <span>OPERATOR</span><R>K</R><R>D</R><R>A</R><R>K/D</R><R>ACC</R><R>STK</R><span>MEDALS</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
            {rows.map(r => <Row key={r.player_id} r={r} mvp={r.player_id === mvpId} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function R({ children }: { children: React.ReactNode }) { return <span style={{ textAlign: 'right' }}>{children}</span>; }
function Row({ r, mvp }: { r: ScoreRow; mvp: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: '0 10px', alignItems: 'center', padding: '9px 14px', background: mvp ? 'rgba(255,210,63,.05)' : T.panel, border: `1px solid ${T.row}`, borderLeft: `3px solid ${teamColor(r.team_id)}` }}>
      <span style={{ font: F.chk(700, 14), letterSpacing: '.1em' }}>{r.display}</span>
      <span style={{ textAlign: 'right', font: F.osw(700, 16), ...TAB }}>{r.kills}</span>
      <span style={{ textAlign: 'right', font: F.osw(600, 15), ...TAB, color: T.dim }}>{r.deaths}</span>
      <span style={{ textAlign: 'right', font: F.osw(600, 15), ...TAB, color: T.dim }}>{r.assists}</span>
      <span style={{ textAlign: 'right', font: F.osw(600, 14), ...TAB }}>{r.kd.toFixed(1)}</span>
      <span style={{ textAlign: 'right', font: F.osw(600, 14), ...TAB, color: T.dim }}>{r.accuracy == null ? '—' : `${Math.round(r.accuracy)}%`}</span>
      <span style={{ textAlign: 'right', font: F.osw(600, 14), ...TAB, color: T.dim }}>{r.streak}</span>
      <span style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: '#ffd23f' }}>{r.medals.length ? r.medals.join(' · ') : '—'}</span>
    </div>
  );
}
