import { useEffect, useRef, useState, type ReactNode } from 'react';
import { setNotice } from '../notice';
import { cureLabel, endDeliveryLine, gunLockedLabel, poolStaleLabel, possiblyProtectedLabel } from '../api/derive';
import { NEVER_SEEN_MS, STALE_AFTER_MS, type LiveRow, type LiveView, type State } from '../api/types';
import { useStore } from '../store';
import { F, T, fmtAge, fmtClock, fmtDuration, teamColor } from '../tokens';
import { columnEdges, type Column } from './columns';
import { Blink, GhostButton, Num, ScrollX, Tag, shortCoverageLine, coverageColor } from '../ui';
import { OrphanMatch } from '../ui/OrphanMatch';
import { OperatorMenu, operatorMenuId } from './OperatorMenu';
import { isKillScored } from './gameSummary';
import { heldSeconds, hillOwner, isObjectiveScored, objectiveWord } from './objective';
import { PowerupStrip } from '../ui/Powerups';

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

/** Visual QA H3 (2026-09-23): `sync_age_ms` is a SENTINEL (`NEVER_SEEN_MS`) when MC has not heard the
 *  node since it started, e.g. after a restart mid-match. Printing it as an age read "11d13h AGO". */
export const neverHeard = (r: { sync_age_ms: number }) => r.sync_age_ms >= NEVER_SEEN_MS;

/** Visual QA M6 (2026-09-23): the board re-sorted under the pointer on every snapshot, so the row the
 *  operator was reaching for moved, even with its menu open. While `hold` is true the rows keep the
 *  order they last had; a row that is new since then goes to the bottom. `held` says whether that order
 *  now differs from the live ranking, so the screen can say so rather than pretend it is the ranking. */
export function holdOrder<R extends { player_id: string }>(ranked: R[], prev: string[], hold: boolean): { rows: R[]; held: boolean } {
  if (!hold || prev.length === 0) return { rows: ranked, held: false };
  const at = new Map(prev.map((pid, i) => [pid, i]));
  const rows = [...ranked].sort((a, b) => (at.get(a.player_id) ?? Infinity) - (at.get(b.player_id) ?? Infinity));
  return { rows, held: rows.some((r, i) => r.player_id !== ranked[i].player_id) };
}

/** Visual QA M24 (2026-09-23): a team kill costs the shooter one kill (scoring.py), so K and K/D can go
 *  below zero. Said where the number is, not left for the operator to guess. */
export const TEAM_KILL_NOTE = 'A TEAM KILL COSTS THE SHOOTER ONE KILL, SO K AND K/D CAN GO BELOW ZERO.';

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

/** M7: why END and RECALL are off while MC is offline. */
const OFFLINE_WHY = 'END and RECALL need MC, and MC is offline. They come back when it reconnects.';

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
  const [menuFor, setMenuFor] = useState<string | null>(null);   // A47: the row whose operator menu is open
  const [pointerOn, setPointerOn] = useState(false);               // M6: the pointer is on the board
  const order = useRef<string[]>([]);                              // M6: the row order the operator last saw
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 500); return () => clearInterval(id); }, []);
  // M7: a two-step END or RECALL armed before MC dropped must not be waiting when it comes back
  useEffect(() => { if (!connected) { setEndConfirm(false); setRecallConfirm(false); } }, [connected]);
  if (!state) return null;
  const lv = state.live;
  if (!lv) {
    return (
      <div className="screen" style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.micro }}>
        <OrphanMatch />
        NO MATCH LIVE — THE BOARD FILLS WHEN NODES GO LIVE AT T-0.
      </div>
    );
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
  const ranked = [...lv.rows].sort((a, b) => b.kills - a.kills);
  const { rows, held } = holdOrder(ranked, order.current, menuFor != null || pointerOn);
  order.current = rows.map(r => r.player_id);
  const cap = isKillScored(state.config) ? state.config.scoring.frag_limit : null;
  // H2: an objective match is won on possession, not kills, so that is the headline number
  const objective = isObjectiveScored(state.config) && teamIds.length >= 2;
  const objSub = objective ? ` · MOST ${objectiveWord(state.config.mode)} TIME WINS` : '';
  const teamScore = (id: string, side: 'left' | 'right') => objective
    ? <TeamScore key={id} id={id} side={side} value={fmtHeld(heldSeconds(lv, id))} sub={`KILLS ${lv.score[id] ?? 0}`} />
    : <TeamScore key={id} id={id} side={side} value={<Num value={lv.score[id] ?? 0} />} />;
  const anyTeamKill = rows.some(r => r.kills < 0);
  const offline = !connected;
  // A28.4: derived, never asserted — grey the count while the tunnel is off, since it can only be 0.
  // Same readout as LOBBY/ARMED: a tunnel that dies mid-match must not go silent just because the
  // operator moved on to MATCH.
  const cLine = shortCoverageLine(state.coverage);
  // Field feedback 2026-09-19 (Tony): partial coverage is not a fault, so it is neutral, never amber.
  const cColor = coverageColor(state.coverage);   // F309: green only at derived FULL coverage
  // A42 (field 2026-09-12, twice: a tagger played on after the operator ended the match). The retry is
  // the server's half; this is the half that matters on the field — the operator finds out WHILE they are
  // still standing next to the player whose gun is still live. A DELIVERY fact about a phone: it is kept
  // out of the board's numbers, and the row cell says only that the HUD has not answered.
  const ed = state.end_delivery;
  const edLine = endDeliveryLine(ed);
  const edUnconfirmed = new Set((ed?.unconfirmed ?? []).map(u => u.player_id));

  return (
    <div className="screen">
      <OrphanMatch />
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        {/* 11px, not 9: it names how much of the park is covered, which is content, not decoration
            (the console's floor, audit 2026-09-12 — this tag was the one the sweep still caught).
            It also has to FIT: right-aligned and `nowrap`, a full coverage line ran off the LEFT of a
            393px screen ("…GE ZONES — 0 OF 7 ON BACKHAUL"), so the row wraps and the tag may too. */}
        {cLine && <Tag data-coverage="1" color={cColor} size={11}
          style={{ letterSpacing: '.16em', padding: '3px 10px', whiteSpace: 'normal', maxWidth: '100%' }}>{cLine}</Tag>}
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
            {teamScore(teamIds[0], 'left')}
            <TimeCell remaining={remaining} sub={`${state.config.mode.toUpperCase()}${cap ? ` · FIRST TO ${cap}` : ''}${objSub}`} dim={!connected} />
            {teamScore(teamIds[1], 'right')}
            {teamIds.slice(2).map(id => teamScore(id, 'left'))}
          </>
        ) : (
          <>
            <div style={{ flex: '1 1 220px', background: `linear-gradient(90deg,rgba(232,238,245,.1),transparent)`, border: `1px solid ${T.line}`, borderLeft: `4px solid ${T.ink}`, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 18 }}>
              <span style={{ font: F.chk(700, 15), letterSpacing: '.3em', color: T.ink }}>FFA LEADER</span>
              <span style={{ font: F.osw(700, 40), lineHeight: 1 }}>{ranked[0]?.display ?? '—'}</span>
              <span style={{ font: F.osw(700, 64), lineHeight: 1 }}><Num value={ranked[0]?.kills ?? 0} /></span>
            </div>
            <TimeCell remaining={remaining} sub={`FFA${cap ? ` · FIRST TO ${cap}` : ''}`} dim={!connected} />
          </>
        )}
      </div>
      {objective && <HillPanel state={state} lv={lv} teamIds={teamIds} />}
      <PowerupStrip />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 560px', minWidth: 0 }}>
          {offline && (
            // M7: the rows below are the last snapshot, not the field. Said once, above them.
            <div data-testid="live-offline" role="status"
              style={{ marginBottom: 12, padding: '8px 14px', border: `1px solid ${T.bad}`, borderLeft: `3px solid ${T.bad}`,
                font: F.mono(500, 11), letterSpacing: '.1em', color: T.bad, lineHeight: 1.5 }}>
              MC IS OFFLINE: THE BOARD IS FROZEN AT THE LAST SNAPSHOT, SO NOBODY'S STATUS IS KNOWN.
            </div>
          )}
          {lv.phones_ended && (
            // A47 review: an ADOPTED match that every phone has already ended. MC never ends an adopted match
            // on its own guess (it holds no config for it), so the operator is told once, in one line.
            <div data-testid="phones-ended" role="status"
              style={{ marginBottom: 12, padding: '8px 14px', border: `1px solid ${T.line2}`, borderLeft: `3px solid ${T.warn}`,
                font: F.mono(500, 11), letterSpacing: '.1em', color: T.warn, lineHeight: 1.5 }}>
              PHONES HAVE ENDED THIS MATCH: PRESS END
            </div>
          )}
          {edLine && (
            <div data-testid="end-delivery" role={edLine.ok ? undefined : 'alert'}
              style={{ marginBottom: 12, padding: '8px 14px', border: `1px solid ${edLine.ok ? T.line2 : T.bad}`,
                borderLeft: `3px solid ${edLine.ok ? T.ok : T.bad}`, background: edLine.ok ? undefined : 'rgba(255,82,82,.07)',
                font: F.mono(500, 11), letterSpacing: '.1em', color: edLine.ok ? T.dim : T.bad, lineHeight: 1.5 }}>
              {edLine.ok ? '✓ ' : '▲ '}{edLine.text}
            </div>
          )}
          {/* the widened S24 columns total ~780px; the wrapper has to say so or the scroll container
              under-reports how much there is to scroll to on a phone. <ScrollX> is what TELLS the
              operator it was cut: on a 393px phone the board is 783px in a 345px box, and it used to
              end at K/D with nothing on screen saying there was more (393px walk, 2026-09-12). */}
          <ScrollX hint="▸ SCROLL FOR K/D · ACC · STK · STATUS">
          <div style={{ minWidth: 780 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: GAP, padding: '9px 14px', background: T.panelAlt, border: `1px solid ${T.line}`, font: F.mono(600, 11), letterSpacing: '.14em', color: T.dim }}>
              {COLUMNS.map(c => (
                <span key={c.key} data-col-head={c.key} data-group={c.g} title={c.key === 'k' || c.key === 'kd' ? TEAM_KILL_NOTE : undefined}
                  style={{ textAlign: c.num ? 'right' : 'left', ...edge(c.key) }}>{c.head}</span>
              ))}
            </div>
            <div data-live-rows="1" data-order-held={held ? '1' : '0'}
              onPointerEnter={() => setPointerOn(true)} onPointerLeave={() => setPointerOn(false)}
              style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2, opacity: offline ? 0.6 : 1 }}>
              {rows.map(r => (
                <div key={r.player_id} style={{ display: 'contents' }}>
                  <Row r={r} offline={offline} endUnconfirmed={edUnconfirmed.has(r.player_id)} open={menuFor === r.player_id}
                    onToggle={() => setMenuFor(m => (m === r.player_id ? null : r.player_id))} />
                  {menuFor === r.player_id && <OperatorMenu r={r} matchId={lv.match_id} onClose={() => setMenuFor(null)} />}
                </div>
              ))}
            </div>
            {held && (
              <div data-testid="order-held" style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.warn, marginTop: 8 }}>
                ORDER HELD WHILE THE POINTER IS ON THE BOARD OR A MENU IS OPEN. IT RE-SORTS WHEN YOU MOVE AWAY.
              </div>
            )}
            {anyTeamKill && (
              <div data-testid="team-kill-note" style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.warn, marginTop: 8 }}>
                K BELOW ZERO: {TEAM_KILL_NOTE}
              </div>
            )}
            <div style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.dim, marginTop: 8, lineHeight: 1.5 }}>TAP A PLAYER FOR RESYNC, RESPAWN OR RELINK. K / A / ACC ARE MC-DERIVED — RECONCILED AT SYNC POINTS. OUT-OF-RANGE NODES SHOW LAST KNOWN + AGE, NEVER "GONE". NOT HEARD = NO WORD FROM THAT PHONE SINCE MC STARTED. STK IS THE LONGEST STREAK OF THE MATCH; A <span style={{ color: T.micro }}>~</span> BEFORE ACC MEANS IT HAS NOT SETTLED.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {endConfirm ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.bad }}>FREEZE SCORING NOW? LATER KILLS WON'T COUNT.</span>
                  <GhostButton color={T.bad} border={T.bad} onClick={async () => { setEndConfirm(false); const r = await run(() => control('end')); if (r) setNotice(`${r.ended ? 'MATCH ENDED' : 'END SENT'}${reachTxt(r)}`, short(r)); }}>CONFIRM END</GhostButton>
                  <GhostButton onClick={() => setEndConfirm(false)}>CANCEL</GhostButton>
                </span>
              ) : (
                <GhostButton onClick={() => setEndConfirm(true)} disabled={offline}
                  title={offline ? OFFLINE_WHY : 'Early end: reaches only nodes in range; the rest end at the time limit (confirm step)'}>END MATCH EARLY</GhostButton>
              )}
              {recallConfirm ? (<>
                <GhostButton color={T.warn} border={T.warn} onClick={async () => { setRecallConfirm(false); const r = await run(() => control('recall')); if (r) setNotice(`RECALLED${reachTxt(r)}`, short(r)); }}>CONFIRM RECALL — REVIVES &amp; HOLDS EVERYONE IN RANGE</GhostButton>
                <GhostButton onClick={() => setRecallConfirm(false)}>CANCEL</GhostButton>
              </>) : (
                <GhostButton color={T.warn} border={T.warn} hoverClass="hov-warnbg" onClick={() => setRecallConfirm(true)} disabled={offline}
                  title={offline ? OFFLINE_WHY : 'Two-step: revive and hold every node in range'}>RECALL</GhostButton>
              )}
              {offline && <span data-testid="controls-offline" style={{ font: F.mono(600, 11), letterSpacing: '.08em', color: T.bad }}>{OFFLINE_WHY.toUpperCase()}</span>}
              <span style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro }}>EARLY END / RECALL REACH ONLY NODES IN RANGE — THE REST END AT MATCH TIME {fmtClock(lv.time_limit_s)}.</span>
            </div>
          </div>
          </ScrollX>
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

/** H2: held time as the headline. `null` = no node has reported possession yet: a dash, never a 0:00
 *  that reads as "nobody held it". */
export const fmtHeld = (secs: number | null): ReactNode => (secs == null ? '—' : <Num value={fmtDuration(secs)} />);

function TeamScore({ id, value, side, sub }: { id: string; value: ReactNode; side: 'left' | 'right'; sub?: string }) {
  const c = teamColor(id);
  const grad = side === 'left' ? `linear-gradient(90deg,${c}29,transparent)` : `linear-gradient(270deg,${c}24,transparent)`;
  const name = (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: side === 'left' ? 'flex-start' : 'flex-end', gap: 4 }}>
      <span style={{ font: F.chk(700, 15), letterSpacing: '.3em', color: c }}>{id.toUpperCase()}</span>
      {sub && <span data-team-sub={id} style={{ font: F.mono(500, 11), letterSpacing: '.14em', color: T.micro }}>{sub}</span>}
    </span>
  );
  return (
    <div style={{ flex: '1 1 220px', background: grad, border: `1px solid ${T.line}`, [side === 'left' ? 'borderLeft' : 'borderRight']: `4px solid ${c}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: side === 'left' ? 'flex-start' : 'flex-end', gap: 18 }}>
      {side === 'left' && name}
      <span data-team-score={id} style={{ font: F.osw(700, 64), lineHeight: 1 }}>{value}</span>
      {side === 'right' && name}
    </div>
  );
}

/** H2: the objective, which the board never showed. Everything here is a read of what MC already has:
 *  the merged possession tally (`live.possession`, the recap's own numbers) and, when a CONTROL station
 *  is assigned, that station's last heartbeat for the owner. A grenade hill reports no owner to MC, so
 *  the panel says so rather than guessing. */
function HillPanel({ state, lv, teamIds }: { state: State; lv: LiveView; teamIds: string[] }) {
  const word = objectiveWord(state.config.mode);
  const p = lv.possession;
  const owner = hillOwner(state);
  const name = (id: string) => (state.teams.find(t => t.team_id === id)?.name ?? id).toUpperCase();
  const top = Math.max(0, ...teamIds.map(id => p?.by_team[id] ?? 0));
  return (
    <div data-testid="hill-panel" style={{ marginBottom: 16, border: `1px solid ${T.line}`, background: T.panelDeep }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '9px 14px', background: T.panelAlt, borderBottom: `1px solid ${T.line}` }}>
        <span style={{ font: F.chk(700, 12), letterSpacing: '.24em', color: T.dim }}>{word} // POSSESSION</span>
        <span data-hill-owner="1" style={{ font: F.mono(600, 11), letterSpacing: '.1em',
          color: owner?.team_id ? teamColor(owner.team_id) : T.micro }}>
          {owner ? `${owner.text}${owner.stale ? ' (LAST REPORT, STATION OUT OF REACH)' : ''}` : `OWNER NOT REPORTED LIVE`}
        </span>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {p ? teamIds.map(id => {
          const secs = p.by_team[id] ?? 0;
          return (
            <div key={id} data-hill-team={id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ font: F.chk(700, 12), letterSpacing: '.14em', color: teamColor(id), minWidth: 110 }}>{name(id)}</span>
              <span style={{ flex: 1, height: 10, background: T.inset, border: `1px solid ${T.line}` }}>
                <span style={{ display: 'block', height: '100%', width: `${top ? Math.round((secs / top) * 100) : 0}%`, background: teamColor(id) }} />
              </span>
              <span style={{ font: F.osw(700, 17), minWidth: 64, textAlign: 'right' }}><Num value={fmtDuration(secs)} /></span>
            </div>
          );
        }) : (
          <div data-hill-none="1" style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro, lineHeight: 1.5 }}>
            NO PHONE HAS REPORTED POSSESSION YET. THE {word} TIME SHOWS HERE WHEN ONE DOES; UNTIL THEN THE WINNER IS THE HOST'S CALL.
          </div>
        )}
        {p && (
          <div style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro, lineHeight: 1.5 }}>
            {p.neutral_s > 0 ? `NEUTRAL ${fmtDuration(p.neutral_s)} · ` : ''}BEST COVERAGE {fmtDuration(p.observed_s)}{p.of_s ? ` OF ${fmtDuration(p.of_s)}` : ''} · {p.reports} PHONE{p.reports === 1 ? '' : 'S'} REPORTED. ONLY A GUN IN RANGE SEES THE {word}, SO THIS IS A FLOOR.
          </div>
        )}
      </div>
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

function Row({ r, endUnconfirmed, open, onToggle, offline }: { r: LiveRow; endUnconfirmed?: boolean; open?: boolean; onToggle?: () => void; offline?: boolean }) {
  const dead = r.status === 'down', stale = r.status === 'stale';
  const never = neverHeard(r);                                       // H3: a sentinel, not an age
  const syncWarn = stale || r.sync_age_ms > STALE_AFTER_MS;   // contracts §9, generated from types.py
  const stk = bestStreak(r);
  const silent = poolStaleLabel(r.pool_stale, r.pool_stale_ms);      // F208: grey, beside the name, never a status
  const cure = cureLabel(r.cure);                                    // F264: the node's own outcome; no_answer needs a human
  const locked = !syncWarn ? gunLockedLabel(r.gun_locked) : null;     // F272: never render a last-known verdict as current
  const shielded = possiblyProtectedLabel(r);                        // F289: the one flag that is FOR a stale row
  // longhand sides, not `border` + `borderLeft`: React warns when the shorthand changes on a rerender (A47 opens the row)
  const rim = `1px solid ${endUnconfirmed ? T.bad : open ? T.acc : T.row}`;
  return (
    <div data-end-unconfirmed={endUnconfirmed ? r.player_id : undefined} data-live-row={r.player_id}
      onClick={onToggle}
      style={{ cursor: 'pointer', display: 'grid', gridTemplateColumns: COLS, gap: GAP, alignItems: 'center', padding: '4px 14px', background: dead ? 'rgba(255,82,82,.05)' : T.panel, borderTop: rim, borderRight: rim, borderBottom: rim, borderLeft: `3px solid ${teamColor(r.team_id)}` }}>
      <span style={{ font: F.chk(700, 14), letterSpacing: '.1em', minWidth: 0, overflow: 'hidden' }}>
        {/* A47 review: the row is a control, so it has to look like one. M5: 36 px tall at least, the
            console's tap floor (it was 18); the row's own padding went from 10 to 4 px so the board
            does not grow by the same amount. M8: a 24-character name ellipsises inside its own column
            instead of running under K and D, and the full name is on the title. */}
        <button type="button" data-live-row-toggle={r.player_id} aria-expanded={!!open} aria-controls={operatorMenuId(r.player_id)}
          aria-label={`${r.display} operator actions`} title={`${r.display}: operator actions (resync, respawn or relink this player's gun)`}
          style={{ appearance: 'none', background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', font: 'inherit', letterSpacing: 'inherit',
                   padding: 0, textAlign: 'left', minHeight: 36, maxWidth: '100%', display: 'inline-flex', alignItems: 'center' }}>
          <span data-row-affordance="1" aria-hidden="true" style={{ color: open ? T.acc : T.dim, marginRight: 6, display: 'inline-block', flex: 'none',
            transform: open ? 'rotate(90deg)' : undefined }}>▸</span>
          <span data-row-name={r.player_id} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.display}</span>
        </button>
        {locked && <span data-gun-locked={r.player_id} role="alert" title="The player's phone proved that the gun stopped answering."
          style={{ display: 'block', font: F.mono(700, 11), letterSpacing: '.08em', color: T.bad }}>{locked}</span>}
        {shielded && <span data-possibly-protected={r.player_id} role="status"
          title="This phone went quiet before it ended spawn protection. Hits on this player may do no damage until the phone reconnects."
          style={{ display: 'block', font: F.mono(700, 11), letterSpacing: '.08em', color: T.warn }}>{shielded} · HITS MAY NOT COUNT</span>}
        {silent && <span data-gun-silent={r.player_id} title="The phone says this gun's health and ammo readout may be out of date."
          style={{ display: 'block', font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro }}>{silent}</span>}
        {cure && <span data-gun-cure={r.player_id} title="The node's own outcome after it probed the gun."
          style={{ display: 'block', font: F.mono(500, 11), letterSpacing: '.08em', color: r.cure === 'no_answer' ? T.warn : T.micro }}>{cure}</span>}
      </span>
      <span data-cell="k" title={r.kills < 0 ? TEAM_KILL_NOTE : undefined}
        style={{ textAlign: 'right', font: F.osw(700, 17), color: r.kills < 0 ? T.warn : undefined, ...edge('k') }}><Num value={r.kills} /></span>
      <span data-cell="d" style={{ textAlign: 'right', font: F.osw(600, 16), color: T.dim }}><Num value={r.deaths} /></span>
      <span data-cell="a" style={{ textAlign: 'right', font: F.osw(600, 16), color: T.dim }}><Num value={r.assists} /></span>
      <span data-cell="kd" title={r.kd < 0 ? TEAM_KILL_NOTE : undefined}
        style={{ textAlign: 'right', font: F.osw(600, 15), color: r.kd < 0 ? T.warn : undefined, ...edge('kd') }}><Num value={r.kd.toFixed(1)} /></span>
      <Acc r={r} />
      <span data-cell="stk" style={{ textAlign: 'right', font: F.osw(600, 15), color: stk >= 3 ? T.warn : T.dim, ...edge('stk') }}><Num value={stk} /></span>
      {/* A42: the END overrides ALIVE/LAST KNOWN here on purpose. Once the match is over, whether this
          player was alive is history; whether their HUD took the end is the only live question about
          them, and it is the one the operator is standing on the field trying to answer. */}
      {/* The respawn countdown is a duration (unpadded minutes), not a clock — `fmtClock(...).slice(1)`
          only looked right under ten minutes (it turned "00:05" into "0:05") and broke at ten minutes
          or more ("10:00" became "0:00"). `fmtDuration` gives the same unpadded reading directly. */}
      {/* M7: while MC is offline nothing on this row is current, so the state cells say UNKNOWN rather
          than a confident ALIVE with a "0s" sync that stopped counting when the link dropped. */}
      <span data-cell="status" data-end-confirm={endUnconfirmed ? 'pending' : undefined}
        title={offline ? 'MC is offline: this is the last snapshot, not the current state'
          : endUnconfirmed ? 'This HUD has not confirmed the end — that tagger may still be in the match'
          : never ? 'MC has not heard from this phone since MC started' : undefined}
        style={{ font: F.chk(700, 11), letterSpacing: '.12em', color: offline ? T.micro : endUnconfirmed ? T.bad : stale ? T.warn : dead ? T.bad : T.ok, ...edge('status') }}>
        {offline ? 'UNKNOWN' : endUnconfirmed ? 'END NOT CONFIRMED' : never ? 'NOT HEARD' : stale ? 'LAST KNOWN' : dead ? `RESPAWN ${fmtDuration(r.respawn_in_s ?? 0)}` : 'ALIVE'}</span>
      <span data-cell="sync" style={{ textAlign: 'right', font: F.mono(500, 11), letterSpacing: '.04em', color: offline ? T.micro : syncWarn ? T.warn : T.faint }}>
        {offline || never ? '—' : <>{fmtAge(r.sync_age_ms)}{stale ? ' AGO' : ''}</>}</span>
    </div>
  );
}
