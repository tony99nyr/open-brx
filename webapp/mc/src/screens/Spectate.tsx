// S25 — the spectator board (`#spectate`).
//
// "spectators might watch the score screen. it should be espn quality." (Tony, game test 2026-09-11).
// Two things had to be settled before any broadcast treatment:
//
//  1. SAFETY. `Live.tsx` puts END MATCH EARLY and RECALL directly under the table, and the command bar
//     carries PANIC. None of those may be on a screen pointed at a room, where a stranger will touch
//     it and the operator will not be standing there. So this is a SEPARATE route with no controls at
//     all — not "the controls hidden", none rendered. `test/spectate.test.tsx` asserts that the screen
//     contains no button, link or input whatsoever, which is the assertion that would fail if anyone
//     later dropped a control in here.
//  2. THE TENSION. Tony has pushed MC toward calm and scannable; a broadcast scoreboard wants big and
//     animated. Different jobs, and this is the one that has to be right first: a v1 that is simply
//     LEGIBLE from across a room (nothing under 16 px, the score enormous, high contrast, no chrome).
//     The ESPN pass — motion, sponsors' furniture, a lower third — is a later one, and it belongs on
//     top of a board that is already correct, not instead of it.
//
// Every number goes through <Num> for the same reason the HUD's countdown did (A5): no product font
// has tabular figures, so a value that changes re-lays-out unless each digit has a fixed cell. On a
// projector a jittering score is the most visible defect there is.
//
// THE FIT RULE (review 2026-09-12). A projector cannot scroll: whatever does not fit is simply not on
// the wall, and nobody in the room can do anything about it. Eight rows already ran off the bottom of
// a 1280×800 screen. So on a screen big enough to BE a projector the frame is exactly one viewport
// tall with `overflow:hidden`, the board region takes the space that is left (`flex:1; min-height:0`),
// and the type SCALES with the viewport height — 2.2 vh per row, never under 16 px, never over 26 px —
// so a full roster fits without anything being cut off. The sizes are computed here rather than
// written as a CSS `clamp()` on purpose: jsdom drops `clamp()` silently, which would leave the
// legibility test measuring nothing at all while still passing.
//
// A phone is not a projector — it scrolls, and clipping it at one viewport would hide the feed — so
// the fit rule applies only from 900×500 up, and below that the board grows and the page scrolls.
import { useEffect, useState } from 'react';
import type { LiveRow, ScoreRow } from '../api/types';
import { useStore } from '../store';
import { F, T, fmtClock, teamColor } from '../tokens';
import { Num, ScrollX } from '../ui';
import { bestStreak } from './Live';

/** Type sizes, in px, computed from the viewport the same way `clamp(min, Npx-per-vh, max)` would.
 *  Everything here is deliberately above the console's own scale — this screen is not operated, it is
 *  watched — and nothing resolves below 16 px, which is the floor the legibility test enforces. */
const px = (min: number, perVh: number, max: number, h: number) => Math.round(Math.max(min, Math.min((perVh * h) / 100, max)));
const sizes = (h: number) => ({
  label: px(16, 2.0, 20, h),
  name: px(20, 3.4, 30, h),
  score: px(44, 9.0, 92, h),
  clock: px(36, 7.2, 72, h),
  row: px(16, 2.2, 26, h),
  rowK: px(18, 2.8, 32, h),
  feed: px(16, 1.9, 18, h),
  pad: px(4, 1.0, 12, h),      // a row's own vertical padding: 12 rows of 24 px of padding is a row
  frame: px(10, 2.6, 28, h),   // the page's own top/bottom margin
});
type SZ = ReturnType<typeof sizes>;

/** The font families, taken from the tokens rather than re-typed: these styles set `font-size`
 *  separately (a computed number, not the `font` shorthand, which would reset it). */
const famOf = (f: string) => f.replace(/^\d+\s+[\d.]+px\s+/, '');
const FAM = { chk: famOf(F.chk(400, 16)), osw: famOf(F.osw(400, 16)), mono: famOf(F.mono(400, 16)) };
const chk = (w: number, size: number) => ({ fontFamily: FAM.chk, fontWeight: w, fontSize: size });
const osw = (w: number, size: number) => ({ fontFamily: FAM.osw, fontWeight: w, fontSize: size });
const mono = (w: number, size: number) => ({ fontFamily: FAM.mono, fontWeight: w, fontSize: size });

/** The viewport, watched. A projector is re-pointed, a laptop is plugged into a bigger screen, and
 *  a browser window is dragged — the fit has to follow, not be decided once at mount. */
function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth || 1280, h: window.innerHeight || 800 }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth || 1280, h: window.innerHeight || 800 });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}
/** big enough to be pointed at a room: below this the page scrolls like any other page */
const isProjector = (vp: { w: number; h: number }) => vp.w >= 900 && vp.h >= 500;

export function Spectate() {
  const { state, feed, serverNow, connected, wantedView } = useStore();
  const [, tick] = useState(0);
  const vp = useViewport();
  const SZ = sizes(vp.h);
  const fit = isProjector(vp);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 500); return () => clearInterval(id); }, []);
  const frame = { fit, frozen: !connected, SZ, wanted: wantedView };
  if (!state) {
    return <Frame {...frame} frozen={false}><Waiting text="CONNECTING TO MISSION CONTROL" SZ={SZ} /></Frame>;
  }
  // The board follows the PHASE, not the presence of a `live` block. Both MCs keep sending `live`
  // through `recap` — `state.py` builds it for phase in (armed, live, recap), and the mock never
  // clears its own — so `if (!state.live)` meant the projector sat on the live table with a frozen
  // clock after the whistle and the result card it has was never shown to the room. Found while
  // measuring the fit of that very card (review 2026-09-12).
  const rc = state.recap;
  const lv = state.phase === 'recap' && rc ? undefined : state.live;
  // A projector must never go blank. Before the horn and after the whistle there is still something
  // true to show: which game is coming, or how the last one ended.
  if (!lv) {
    return (
      <Frame {...frame}>
        {rc ? <FinalCard SZ={SZ} fit={fit} /> : <Waiting text={`${(state.config.mode || 'MATCH').toUpperCase()} — WAITING FOR THE HORN`} SZ={SZ} />}
      </Frame>
    );
  }
  const remaining = Math.max(0, lv.ends_t - serverNow()) / 1000;
  const ffa = state.config.mode === 'ffa';
  const teamIds = ffa ? [] : (state.config.teams ?? []).map(t => t.team_id);
  const rows: LiveRow[] = [...lv.rows].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const cap = state.config.scoring.frag_limit;
  const teamName = (id: string) => (state.teams.find(t => t.team_id === id)?.name ?? id).toUpperCase();

  return (
    <Frame {...frame}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 18, flexWrap: 'wrap', marginBottom: 22 }}>
        {teamIds.length >= 2 ? (
          <>
            <TeamBlock name={teamName(teamIds[0])} color={teamColor(teamIds[0])} score={lv.score[teamIds[0]] ?? 0} side="left" SZ={SZ} />
            <Clock remaining={remaining} sub={`${state.config.mode.toUpperCase()}${cap ? ` · FIRST TO ${cap}` : ''}`} stale={!connected} SZ={SZ} />
            <TeamBlock name={teamName(teamIds[1])} color={teamColor(teamIds[1])} score={lv.score[teamIds[1]] ?? 0} side="right" SZ={SZ} />
          </>
        ) : (
          <>
            <TeamBlock name={rows[0]?.display ?? '—'} color={T.ink} score={rows[0]?.kills ?? 0} side="left" label="LEADER" SZ={SZ} />
            <Clock remaining={remaining} sub={`FFA${cap ? ` · FIRST TO ${cap}` : ''}`} stale={!connected} SZ={SZ} />
          </>
        )}
      </div>
      {/* the rest of a 3+ team game, under the headline pair rather than squeezed into it */}
      {teamIds.length > 2 && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 22 }}>
          {teamIds.slice(2).map(id => (
            <TeamBlock key={id} name={teamName(id)} color={teamColor(id)} score={lv.score[id] ?? 0} side="left" SZ={SZ} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 22, alignItems: 'stretch', flexWrap: 'wrap',
                    ...(fit ? { flex: '1 1 0px', minHeight: 0 } : null) }}>
        <div style={{ flex: '2 1 620px', minWidth: 0, display: 'flex', flexDirection: 'column', ...(fit ? { minHeight: 0 } : null) }}>
          <Board rows={rows} SZ={SZ} fit={fit} />
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', ...(fit ? { minHeight: 0 } : null) }}>
          <Feed entries={feed} SZ={SZ} fit={fit} />
        </div>
      </div>
    </Frame>
  );
}

/** The whole page: its own dark ground and generous margins, so it fills a projector on its own.
 *
 *  `frozen` is the WHOLE board's treatment, not the clock's. MC going offline used to dim one cell
 *  and leave a full scoreboard of numbers at full strength beside it — a room reads that as the live
 *  score, and it is whatever was true when the link dropped (review 2026-09-12). */
function Frame({ children, fit, frozen, SZ, wanted }: { children: React.ReactNode; fit: boolean; frozen: boolean; SZ: SZ; wanted?: string | null }) {
  const pad = SZ.frame;
  return (
    <div data-spectate="board" data-frozen={frozen ? '1' : '0'}
      style={{ ...(fit ? { height: '100vh', overflow: 'hidden' } : { minHeight: '100vh' }),
               display: 'flex', flexDirection: 'column', background: T.page, color: T.ink,
               padding: `${pad}px 34px ${pad + 8}px`, boxSizing: 'border-box' }}>
      {frozen && (
        <div data-spectate="frozen" role="status"
          style={{ ...chk(700, SZ.label), letterSpacing: '.26em', color: T.bad, border: `1px solid ${T.bad}`,
                   padding: '8px 14px', marginBottom: 14, alignSelf: 'flex-start' }}>
          FROZEN · MC OFFLINE
        </div>
      )}
      {/* the dimming sits INSIDE the frame so the tag above it stays at full strength */}
      <div data-spectate="content"
        style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0px', minHeight: 0,
                 opacity: frozen ? 0.5 : 1, filter: frozen ? 'grayscale(0.5)' : undefined }}>
        {children}
      </div>
      {/* The way OUT of the latch, said on the screen that is refusing. A tab that loaded at
       *  `#spectate` will not leave the board during this session (store.tsx) — which used to mean
       *  the operator typed `#kit`, watched the URL snap back, and had no way of knowing that a
       *  reload would now honour it (round-2 review 2026-09-12). Text only: no control may exist on
       *  a screen a room can touch. */}
      {wanted && (
        <div data-spectate="escape" role="status"
          style={{ ...chk(600, SZ.label), letterSpacing: '.18em', color: T.micro, marginTop: 12, flex: 'none' }}>
          {wanted.toUpperCase()} IS A CONSOLE SCREEN — THIS TAB IS THE BOARD. RELOAD IT TO OPEN {wanted.toUpperCase()}.
        </div>
      )}
    </div>
  );
}

function Waiting({ text, SZ }: { text: string; SZ: SZ }) {
  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  ...chk(700, SZ.name), letterSpacing: '.2em', color: T.dim, textAlign: 'center' }}>{text}</div>
  );
}

function TeamBlock({ name, color, score, side, label, SZ }: { name: string; color: string; score: number; side: 'left' | 'right'; label?: string; SZ: SZ }) {
  return (
    <div style={{ flex: '1 1 300px', minWidth: 0, background: `linear-gradient(${side === 'left' ? 90 : 270}deg,${color}26,transparent)`,
      border: `1px solid ${T.line}`, [side === 'left' ? 'borderLeft' : 'borderRight']: `6px solid ${color}`,
      padding: `${Math.round(SZ.pad * 1.6)}px 26px`, display: 'flex', flexDirection: 'column', alignItems: side === 'left' ? 'flex-start' : 'flex-end', gap: 4 }}>
      {label && <span style={{ ...chk(700, SZ.label), letterSpacing: '.3em', color: T.micro }}>{label}</span>}
      {/* wraps rather than ellipsises: on a projector the name always fits, and on a phone a truncated
          "YELLOW TE…" is worse than two lines (393px walk, 2026-09-12) */}
      <span style={{ ...chk(700, SZ.name), letterSpacing: '.22em', color, maxWidth: '100%', overflowWrap: 'anywhere' }}>{name}</span>
      <span data-spectate="score" style={{ ...osw(700, SZ.score), lineHeight: 1 }}><Num value={score} /></span>
    </div>
  );
}

/** The clock still says it has stopped — but it no longer carries the offline treatment alone: the
 *  frame dims the whole board, which is the part a room can actually see from the back. */
function Clock({ remaining, sub, stale, SZ }: { remaining: number; sub: string; stale?: boolean; SZ: SZ }) {
  return (
    <div style={{ flex: '0 1 340px', background: T.panel, border: `1px solid ${stale ? T.bad : T.line}`, padding: `${Math.round(SZ.pad * 1.6)}px 26px`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <span style={{ ...chk(700, SZ.label), letterSpacing: '.26em', color: stale ? T.bad : T.micro }}>{stale ? 'CLOCK FROZEN' : 'TIME REMAINING'}</span>
      <span data-spectate="clock" style={{ ...osw(700, SZ.clock), lineHeight: 1 }}><Num value={fmtClock(remaining)} /></span>
      <span style={{ ...chk(600, SZ.label), letterSpacing: '.2em', color: T.micro }}>{sub}</span>
    </div>
  );
}

const BOARD_COLS = 'minmax(200px,2fr) 78px 78px 78px 92px';

function Board({ rows, SZ, fit }: { rows: (LiveRow | ScoreRow)[]; SZ: SZ; fit: boolean }) {
  // The board's own scroll container. A projector never reaches it — the columns total ~530 px and any
  // screen worth pointing at a room is wider than that — but a phone would otherwise cut D, A and STK
  // off with no way to see them, and the PAGE must never scroll sideways (393px walk, 2026-09-12).
  //
  // `overflowY` is pinned to `hidden` under the fit rule because `overflow-x:auto` on its own computes
  // overflow-y to `auto` as well — which would have let the rows scroll vertically inside a frame
  // that is supposed to guarantee they fit.
  //
  // And on a phone it has to SAY it scrolls: 613 px of columns in a 325 px box ended at D with no
  // edge and no scrollbar (393 px walk, 2026-09-12). <ScrollX> fades the cut edge and prints the
  // hint, and only while there is more to the right — so a projector, which never overflows, shows
  // neither. Its hint carries the board's own type size: nothing on this screen goes under 16 px.
  return (
    <ScrollX hint="▸ SCROLL FOR D · A · STK" hintSize={SZ.label} hintStyle={{ letterSpacing: '.18em', padding: '0 0 6px 18px' }}
      style={{ ...(fit ? { overflowY: 'hidden', flex: '1 1 0px', minHeight: 0, display: 'flex', flexDirection: 'column' } : null) }}>
    <div style={{ minWidth: 540, ...(fit ? { flex: '1 1 0px', minHeight: 0, display: 'flex', flexDirection: 'column' } : null) }}>
      <div style={{ display: 'grid', gridTemplateColumns: BOARD_COLS, gap: '0 16px', padding: `${SZ.pad}px 18px`, flex: 'none',
                    background: T.panelAlt, border: `1px solid ${T.line}`, ...chk(700, SZ.label), letterSpacing: '.18em', color: T.dim }}>
        <span>PLAYER</span>
        <span style={{ textAlign: 'right' }}>K</span>
        <span style={{ textAlign: 'right' }}>D</span>
        <span style={{ textAlign: 'right' }}>A</span>
        <span style={{ textAlign: 'right' }}>STK</span>
      </div>
      <div data-spectate="rows" style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 3,
                                         ...(fit ? { flex: '1 1 0px', minHeight: 0, overflow: 'hidden' } : null) }}>
        {rows.length === 0 && (
          <div style={{ ...chk(600, SZ.label), letterSpacing: '.16em', color: T.micro, padding: '16px 18px' }}>NO SCORES YET.</div>
        )}
        {rows.map(r => {
          const down = 'status' in r && r.status === 'down';
          return (
            <div key={r.player_id} data-spectate="row"
              style={{ display: 'grid', gridTemplateColumns: BOARD_COLS, gap: '0 16px', alignItems: 'center', padding: `${SZ.pad}px 18px`,
                       // a roster longer than the wall is tall shrinks its rows rather than running off
                       // the bottom of it; the type is already at its 16 px floor by then
                       ...(fit ? { flex: '0 1 auto', minHeight: 0, overflow: 'hidden' } : null),
                       background: T.panel, border: `1px solid ${T.row}`, borderLeft: `5px solid ${teamColor(r.team_id)}`, opacity: down ? .55 : 1 }}>
              <span style={{ ...chk(700, SZ.row), letterSpacing: '.1em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.display}</span>
              <span style={{ textAlign: 'right', ...osw(700, SZ.rowK) }}><Num value={r.kills} /></span>
              <span style={{ textAlign: 'right', ...osw(600, SZ.row), color: T.dim }}><Num value={r.deaths} /></span>
              <span style={{ textAlign: 'right', ...osw(600, SZ.row), color: T.dim }}><Num value={r.assists} /></span>
              <span style={{ textAlign: 'right', ...osw(600, SZ.row), color: bestStreak(r) >= 3 ? T.warn : T.dim }}><Num value={bestStreak(r)} /></span>
            </div>
          );
        })}
      </div>
    </div>
    </ScrollX>
  );
}

function Feed({ entries, SZ, fit }: { entries: { t_match_s: number; text: string; tag?: string; kind: string }[]; SZ: SZ; fit: boolean }) {
  // Under the fit rule the feed is capped by the height it has, not by a count: whatever does not fit
  // is clipped rather than pushing the board off the bottom of the wall.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...(fit ? { flex: '1 1 0px', minHeight: 0 } : null) }}>
      <div style={{ padding: `${SZ.pad}px 16px`, background: T.panelAlt, border: `1px solid ${T.line}`, flex: 'none',
                    ...chk(700, SZ.label), letterSpacing: '.22em', color: T.dim }}>LATEST</div>
      <div style={{ border: `1px solid ${T.line}`, borderTop: 'none', background: T.panelDeep, padding: 8, display: 'flex', flexDirection: 'column', gap: 3,
                    ...(fit ? { flex: '1 1 0px', minHeight: 0, overflow: 'hidden' } : null) }}>
        {entries.length === 0 && (
          <div style={{ ...chk(600, SZ.feed), letterSpacing: '.1em', color: T.faint, padding: 10 }}>NOTHING YET.</div>
        )}
        {entries.slice(0, 12).map((ev, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${SZ.pad}px 12px`, background: T.panel, flex: '0 1 auto', minHeight: 0, overflow: 'hidden',
                                borderLeft: `3px solid ${ev.kind === 'alert' ? T.acc : ev.tag ? T.warn : T.line}` }}>
            <span style={{ ...mono(500, SZ.feed), color: T.micro }}><Num value={fmtClock(ev.t_match_s)} /></span>
            <span style={{ flex: 1, ...chk(600, SZ.feed), letterSpacing: '.02em', color: T.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** After the whistle: the result, still big, with no way to start anything from here. */
function FinalCard({ SZ, fit }: { SZ: SZ; fit: boolean }) {
  const { state } = useStore();
  const rc = state?.recap;
  if (!rc) return <Waiting text="MATCH OVER" SZ={SZ} />;
  const w = rc.winner ?? {};
  const label = (id: string) => (state?.teams.find(t => t.team_id === id)?.name ?? id).toUpperCase();
  const name = (id: string) => rc.rows.find(r => r.player_id === id)?.display ?? id;
  const headline = w.tie?.length ? `TIE — ${w.tie.map(label).join(' / ')}`
    : w.player_id ? `${name(w.player_id)} WINS`
    : w.team_id ? `${label(w.team_id)} WINS`
    : 'MATCH OVER';
  const color = w.team_id ? teamColor(w.team_id) : T.ink;
  const rows = [...rc.rows].sort((a, b) => b.kills - a.kills);
  return (
    <>
      <div data-spectate="final" style={{ border: `1px solid ${T.line}`, borderLeft: `6px solid ${color}`, padding: '24px 28px', marginBottom: 22, flex: 'none',
                    display: 'flex', alignItems: 'baseline', gap: 26, flexWrap: 'wrap' }}>
        <span style={{ ...osw(700, Math.round(SZ.score * 0.78)), letterSpacing: '.08em', color }}>{headline}</span>
        {rc.provisional && <span style={{ ...chk(700, SZ.label), letterSpacing: '.2em', color: T.warn }}>PROVISIONAL — STILL SETTLING</span>}
      </div>
      <Board rows={rows} SZ={SZ} fit={fit} />
    </>
  );
}
