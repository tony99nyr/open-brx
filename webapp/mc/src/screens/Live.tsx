import { useEffect, useState } from 'react';
import { setNotice } from '../notice';
import { coverageLine } from '../api/derive';
import { STALE_AFTER_MS, type LiveRow } from '../api/types';
import { useStore } from '../store';
import { F, T, fmtAge, fmtClock, teamColor } from '../tokens';
import { columnEdges, type Column } from './columns';
import { Blink, GhostButton, Num, Tag } from '../ui';

// S24 (game test 2026-09-11, D4): the board was `minmax(130px,1.5fr) 40px 40px 40px 52px 56px 48px …`
// at `gap:'0 10px'` with 9 px headers over 14-16 px values, and K/D/A were three identical right-aligned
// columns with nothing between them — so the eye had to count across to know which number it was on.
// Wider columns, a 14 px gutter, headers at 11 px, and the numeric run split into three GROUPS with a
// hairline rule between them: what you did (K·D·A), how well (K/D·ACC), and the best run (STK).
const COLS = 'minmax(140px,1.6fr) 46px 46px 46px 60px 66px 54px minmax(108px,1fr) 88px';
const GAP = '0 14px';
/** Every column of the live board, in order. `g` is the visual group; a change of group draws the rule. */
const COLUMNS: Column[] = [
  { key: 'who', head: 'OPERATOR', g: 'who' },
  { key: 'k', head: 'K', g: 'tally', num: true },
  { key: 'd', head: 'D', g: 'tally', num: true },
  { key: 'a', head: 'A', g: 'tally', num: true },
  { key: 'kd', head: 'K/D', g: 'rate', num: true },
  { key: 'acc', head: 'ACC', g: 'rate', num: true },
  { key: 'stk', head: 'STK', g: 'best', num: true },
  { key: 'status', head: 'STATUS', g: 'state' },
  { key: 'sync', head: 'SYNC', g: 'state', num: true },
];
/** The group rule, asked for BY COLUMN KEY — header and cells read the same lookup, so they cannot
 *  draw it in different places (see `columns.ts`). */
const edge = columnEdges(COLUMNS);

/** F116: the streak worth showing is the LONGEST of the match. `streak` is the CURRENT one and reads 0
 *  for whoever died last, which is how a 9-kill row showed "streak 0" on the field. An older server
 *  sends no `best_streak` at all, so fall back rather than render a confident 0. */
export const bestStreak = (r: { best_streak?: number; streak: number }) => r.best_streak ?? r.streak;

/** F119: `accuracy` is computed from hits that arrive per EVENT against a shot count that arrives on a
 *  ~2 s heartbeat, so a young row can spike and even exceed 100 %. `acc_provisional` says it has not
 *  settled — render it AS settling (dim, with a mark), never as a fact, and never hide it. */
function Acc({ r }: { r: { accuracy: number | null; acc_provisional?: boolean } }) {
  const prov = !!r.acc_provisional;
  return (
    <span data-cell="acc" data-provisional={prov ? '1' : '0'}
      title={prov ? 'Still settling — hits arrive per event, shots only on the ~2s heartbeat' : undefined}
      style={{ textAlign: 'right', font: F.osw(600, 15), color: prov ? T.micro : T.dim, ...edge('acc') }}>
      {/* the mark LEADS the number: "35%~" reads as a unit nobody uses, "~35%" is how an approximate
          value is written everywhere else (review 2026-09-12) */}
      {r.accuracy == null ? '—' : <>{prov ? '~' : ''}<Num value={Math.round(r.accuracy)} />%</>}
    </span>
  );
}

/** How far a control actually got. An older MC sends no `nodes` at all, and "REACHED 0 OF 0" is a
 *  worse answer than not claiming a number — so the clause is dropped rather than invented. */
type ControlResult = { ok: boolean; ended?: boolean; reached?: number; pushed?: number; nodes?: number };
const reachTxt = (r: ControlResult) =>
  (r.nodes == null ? '' : ` · REACHED ${r.reached ?? 0} OF ${r.nodes} NODE${r.nodes === 1 ? '' : 'S'}`);
/** short of the bound = amber: some node did not hear it */
const short = (r: ControlResult) => r.nodes != null && (r.reached ?? 0) < r.nodes;

export function Live() {
  const { state, feed, run, api, serverNow, connected } = useStore();
  const [endConfirm, setEndConfirm] = useState(false);
  const [recallConfirm, setRecallConfirm] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 500); return () => clearInterval(id); }, []);
  if (!state) return null;
  const lv = state.live;
  if (!lv) {
    return <div className="screen" style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.micro }}>NO MATCH LIVE — THE BOARD FILLS WHEN NODES GO LIVE AT T-0.</div>;
  }
  // POST /api/control answers 200 with `ok:false` when it REFUSES — an END with no scorer, or a
  // second END after the recap is written (state.py `control`). The old handler read `reached`/`nodes`
  // and threw `error` away, so the one press that did nothing reported "END REACHED 0 OF 8 NODE(S)":
  // a number, where the server had sent a sentence saying nothing was ended and what to press instead.
  // Throwing puts that sentence in the red strip, the way every other refusal reaches the operator,
  // and `run()` returns undefined so no success notice fires behind it.
  const control = async (cmd: 'end' | 'recall') => {
    const r = await api.control(cmd);
    if (r.ok === false) {
      const also = r.pushed ? ` (${r.pushed} node${r.pushed === 1 ? ' was' : 's were'} still told to stop)` : '';
      throw new Error(`${r.error || `THE SERVER REFUSED ${cmd.toUpperCase()}`}${also}`);
    }
    return r;
  };
  const remaining = Math.max(0, lv.ends_t - serverNow()) / 1000;
  const teamIds = state.config.mode === 'ffa' ? [] : state.config.teams.map(t => t.team_id);
  const rows = [...lv.rows].sort((a, b) => b.kills - a.kills);
  const cap = state.config.scoring.frag_limit;
  // A28.4: derived, never asserted — grey the count while the tunnel is off, since it can only be 0.
  // Same readout as LOBBY/ARMED: a tunnel that dies mid-match must not go silent just because the
  // operator moved on to MATCH.
  const cLine = coverageLine(state);
  const cColor = state.lan.public?.status !== 'up' ? T.micro : state.coverage?.level === 'full' ? T.ok : T.warn;

  return (
    <div className="screen">
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        {cLine && <Tag color={cColor} size={9} style={{ letterSpacing: '.2em', padding: '3px 10px' }}>{cLine}</Tag>}
        {/* S25: the way to the room-facing board. A NEW TAB on purpose — the operator keeps this console on the
            laptop and drags the other window to the projector; navigating this one away would take END and RECALL
            with it. `search` is carried so `?mock` opens a mock spectator board. */}
        <a data-spectate-link="1" href={`${location.pathname}${location.search}#spectate`} target="_blank" rel="noopener"
          className="hov-acc" title="Open the read-only spectator board in a new tab — no controls, safe on a projector"
          style={{ font: F.chk(700, 12), letterSpacing: '.16em', color: T.dim, textDecoration: 'none',
                   border: `1px solid ${T.line2}`, padding: '9px 16px', minHeight: 40, display: 'inline-flex', alignItems: 'center' }}>
          SPECTATE ↗
        </a>
      </div>
      {/* score strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 2, marginBottom: 16 }}>
        {teamIds.length >= 2 ? (
          <>
            <TeamScore id={teamIds[0]} score={lv.score[teamIds[0]] ?? 0} side="left" />
            <TimeCell remaining={remaining} sub={`${state.config.mode.toUpperCase()}${cap ? ` · FIRST TO ${cap}` : ''}`} dim={!connected} />
            <TeamScore id={teamIds[1]} score={lv.score[teamIds[1]] ?? 0} side="right" />
            {teamIds.slice(2).map(id => <TeamScore key={id} id={id} score={lv.score[id] ?? 0} side="left" />)}
          </>
        ) : (
          <>
            <div style={{ flex: '1 1 220px', background: `linear-gradient(90deg,rgba(232,238,245,.1),transparent)`, border: `1px solid ${T.line}`, borderLeft: `4px solid ${T.ink}`, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 18 }}>
              <span style={{ font: F.chk(700, 15), letterSpacing: '.3em', color: T.ink }}>FFA LEADER</span>
              <span style={{ font: F.osw(700, 40), lineHeight: 1 }}>{rows[0]?.display ?? '—'}</span>
              <span style={{ font: F.osw(700, 64), lineHeight: 1 }}><Num value={rows[0]?.kills ?? 0} /></span>
            </div>
            <TimeCell remaining={remaining} sub={`FFA${cap ? ` · FIRST TO ${cap}` : ''}`} dim={!connected} />
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 560px', minWidth: 0, overflowX: 'auto' }}>
          {/* the widened S24 columns total ~780px; the wrapper has to say so or the scroll container
              under-reports how much there is to scroll to on a phone */}
          <div style={{ minWidth: 780 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: GAP, padding: '9px 14px', background: T.panelAlt, border: `1px solid ${T.line}`, font: F.mono(600, 11), letterSpacing: '.14em', color: T.dim }}>
              {COLUMNS.map(c => (
                <span key={c.key} data-col-head={c.key} data-group={c.g}
                  style={{ textAlign: c.num ? 'right' : 'left', ...edge(c.key) }}>{c.head}</span>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
              {rows.map(r => <Row key={r.player_id} r={r} />)}
            </div>
            <div style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.dim, marginTop: 8, lineHeight: 1.5 }}>K / A / ACC ARE MC-DERIVED — RECONCILED AT SYNC POINTS. OUT-OF-RANGE NODES SHOW LAST KNOWN + AGE, NEVER "GONE". STK IS THE LONGEST STREAK OF THE MATCH; A <span style={{ color: T.micro }}>~</span> BEFORE ACC MEANS IT HAS NOT SETTLED.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {endConfirm ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.bad }}>FREEZE SCORING NOW? LATER KILLS WON'T COUNT.</span>
                  <GhostButton color={T.bad} border={T.bad} onClick={async () => { setEndConfirm(false); const r = await run(() => control('end')); if (r) setNotice(`${r.ended ? 'MATCH ENDED' : 'END SENT'}${reachTxt(r)}`, short(r)); }}>CONFIRM END</GhostButton>
                  <GhostButton onClick={() => setEndConfirm(false)}>CANCEL</GhostButton>
                </span>
              ) : (
                <GhostButton onClick={() => setEndConfirm(true)} title="Early end: reaches only nodes in range; the rest end at the time limit (confirm step)">END MATCH EARLY</GhostButton>
              )}
              {recallConfirm ? (<>
                <GhostButton color={T.warn} border={T.warn} onClick={async () => { setRecallConfirm(false); const r = await run(() => control('recall')); if (r) setNotice(`RECALLED${reachTxt(r)}`, short(r)); }}>CONFIRM RECALL — REVIVES &amp; HOLDS EVERYONE IN RANGE</GhostButton>
                <GhostButton onClick={() => setRecallConfirm(false)}>CANCEL</GhostButton>
              </>) : (
                <GhostButton color={T.warn} border={T.warn} hoverClass="hov-warnbg" onClick={() => setRecallConfirm(true)} title="Two-step: revive and hold every node in range">RECALL</GhostButton>
              )}
              <span style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro }}>EARLY END / RECALL REACH ONLY NODES IN RANGE — THE REST END AT {fmtClock(lv.time_limit_s)}.</span>
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 280px', maxWidth: 400 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: T.panelAlt, border: `1px solid ${T.line}`, borderBottom: 'none' }}>
            <Blink color={T.bad} period={1.6} size={8} />
            <span style={{ font: F.chk(700, 11), letterSpacing: '.24em', color: T.dim }}>EVENT FEED // LIVE</span>
          </div>
          <div role="status" aria-live="polite" aria-relevant="additions" style={{ border: `1px solid ${T.line}`, background: T.panelDeep, padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {feed.length === 0 && <div style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.faint, padding: 6 }}>WAITING FOR THE FIRST SYNC POINT…</div>}
            {feed.map((ev, i) => {
              // F118: an `alert` is MC's own global-state call, in the OPERATOR's third-person copy —
              // a different KIND of line from a kill, and it has to look like one. WITHHELD is the
              // one mc_confidence refused to push: it must not read as a call the players heard.
              const withheld = ev.tag === 'WITHHELD';
              const alert = ev.kind === 'alert';
              const color = withheld ? T.micro
                : ev.tag === 'FIRST BLOOD' || ev.tag === 'TEAM KILL' ? T.bad
                : alert ? T.acc : ev.tag ? T.warn : ev.kind === 'sync' ? T.acc : T.line;
              return (
                <div key={i} data-feed-kind={ev.kind} data-feed-tag={ev.tag ?? ''}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    background: alert && !withheld ? 'rgba(57,180,255,.07)' : T.panel,
                    borderLeft: `${alert ? 3 : 2}px solid ${color}`,
                    borderTop: withheld ? `1px dashed ${T.line2}` : undefined,
                    borderBottom: withheld ? `1px dashed ${T.line2}` : undefined }}>
                  <span style={{ font: F.mono(500, 11), color: T.micro }}><Num value={fmtClock(ev.t_match_s)} /></span>
                  <span style={{ flex: 1, font: F.chk(alert ? 700 : 600, 12), letterSpacing: '.04em', color: withheld ? T.dim : alert ? T.ink : T.body }}>{ev.text}</span>
                  {ev.tag && ev.kind !== 'sync' && <Tag color={color} ink={withheld ? T.page : undefined} size={11} style={{ letterSpacing: '.14em', padding: '2px 7px' }}>{ev.tag}</Tag>}
                </div>
              );
            })}
            {/* WITHHELD is a fact about DELIVERY, not about the game — say so once, under the feed,
                rather than train the operator to read a dashed row as noise. */}
            {feed.some(e => e.tag === 'WITHHELD') && (
              <div style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro, padding: '6px 10px', lineHeight: 1.5 }}>
                WITHHELD = MC RECORDED IT BUT DID NOT CALL IT TO THE PLAYERS.
              </div>
            )}
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
      <span style={{ font: F.osw(700, 64), lineHeight: 1 }}><Num value={score} /></span>
      {side === 'right' && <span style={{ font: F.chk(700, 15), letterSpacing: '.3em', color: c }}>{id.toUpperCase()}</span>}
    </div>
  );
}
function TimeCell({ remaining, sub, dim }: { remaining: number; sub: string; dim?: boolean }) {
  return (
    <div role="status" aria-live="off" title={dim ? 'MC offline — clock frozen at the last snapshot' : undefined}
      style={{ flex: '0 1 240px', background: T.panel, border: `1px solid ${dim ? T.bad : T.line}`, padding: '14px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, opacity: dim ? .45 : 1 }}>
      <span style={{ font: F.mono(500, 11), letterSpacing: '.2em', color: T.micro }}>{dim ? 'TIME REMAINING · OFFLINE' : 'TIME REMAINING'}</span>
      {/* the clock is the one number that changes every second — a per-digit cell is what stops it
          re-centring on every tick (the HUD's A5 defect, same cause) */}
      <span style={{ font: F.osw(700, 40), lineHeight: 1 }}><Num value={fmtClock(remaining)} /></span>
      <span style={{ font: F.mono(500, 11), letterSpacing: '.16em', color: T.micro }}>{sub}</span>
    </div>
  );
}

function Row({ r }: { r: LiveRow }) {
  const dead = r.status === 'down', stale = r.status === 'stale';
  const syncWarn = stale || r.sync_age_ms > STALE_AFTER_MS;   // contracts §9, generated from types.py
  const stk = bestStreak(r);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: GAP, alignItems: 'center', padding: '10px 14px', background: dead ? 'rgba(255,82,82,.05)' : T.panel, border: `1px solid ${T.row}`, borderLeft: `3px solid ${teamColor(r.team_id)}` }}>
      <span style={{ font: F.chk(700, 14), letterSpacing: '.1em' }}>{r.display}</span>
      <span data-cell="k" style={{ textAlign: 'right', font: F.osw(700, 17), ...edge('k') }}><Num value={r.kills} /></span>
      <span data-cell="d" style={{ textAlign: 'right', font: F.osw(600, 16), color: T.dim }}><Num value={r.deaths} /></span>
      <span data-cell="a" style={{ textAlign: 'right', font: F.osw(600, 16), color: T.dim }}><Num value={r.assists} /></span>
      <span data-cell="kd" style={{ textAlign: 'right', font: F.osw(600, 15), ...edge('kd') }}><Num value={r.kd.toFixed(1)} /></span>
      <Acc r={r} />
      <span data-cell="stk" style={{ textAlign: 'right', font: F.osw(600, 15), color: stk >= 3 ? T.warn : T.dim, ...edge('stk') }}><Num value={stk} /></span>
      <span style={{ font: F.chk(700, 11), letterSpacing: '.12em', color: stale ? T.warn : dead ? T.bad : T.ok, ...edge('status') }}>{stale ? 'LAST KNOWN' : dead ? `RESPAWN ${fmtClock(r.respawn_in_s ?? 0).slice(1)}` : 'ALIVE'}</span>
      <span style={{ textAlign: 'right', font: F.mono(500, 11), letterSpacing: '.04em', color: syncWarn ? T.warn : T.faint }}>{fmtAge(r.sync_age_ms)}{stale ? ' AGO' : ''}</span>
    </div>
  );
}
