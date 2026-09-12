import { useEffect, useState } from 'react';
import type { MatchHistoryRow, RecapStationRow, RecapView, ScoreRow } from '../api/types';
import { useStore } from '../store';
import { CHAMFER, F, T, fmtClock, teamColor } from '../tokens';
import { BTN_RESET, Brackets, Num, SectionRule, PrimaryButton } from '../ui';
import { bestStreak } from './Live';
import { columnEdges, type Column } from './columns';

// S24: the same treatment as the live board — wider columns, an 11 px header, and the numeric run
// split into groups with a hairline between them (game test 2026-09-11, D4).
const COLS = 'minmax(140px,1.6fr) 46px 46px 46px 60px 66px 54px minmax(130px,1fr)';
const GAP = '0 14px';
const COLUMNS: Column[] = [
  { key: 'who', head: 'OPERATOR', g: 'who' },
  { key: 'k', head: 'K', g: 'tally', num: true },
  { key: 'd', head: 'D', g: 'tally', num: true },
  { key: 'a', head: 'A', g: 'tally', num: true },
  { key: 'kd', head: 'K/D', g: 'rate', num: true },
  { key: 'acc', head: 'ACC', g: 'rate', num: true },
  { key: 'stk', head: 'STK', g: 'best', num: true },
  { key: 'medals', head: 'MEDALS', g: 'medals' },
];
/** The group rule, asked for BY COLUMN KEY. The cells used to hand-index this list — the K/D cell
 *  passed a literal 4, STK a literal 6 — so inserting or moving a column drew the rules in the wrong
 *  places with nothing to fail. LIVE was fixed first; this is the same defect one file over
 *  (review 2026-09-12). Header and row now read the one lookup. */
const edge = columnEdges(COLUMNS);
const AWARD_COLOR: Record<string, string> = { MVP: '#ffd23f', 'FIRST BLOOD': T.bad, MULTIKILL: T.warn };
const STATION_KIND_LABEL: Record<string, string> = { respawn: 'RESPAWN', powerup: 'POWERUP', extraction: 'EXTRACTION', bomb: 'BOMB SITE', control: 'CONTROL POINT' };
const STATION_TID_NAME: Record<number, string> = { 0: 'RED', 1: 'BLUE', 2: 'YELLOW', 3: 'GREEN', 255: 'ANY' };

export function Recap() {
  const { state, run, api, setView } = useStore();
  // Field 2026-08-30: "the recap doesn't show the previous game once another is started ... we have no
  // way to view previous". Every finished match is already in MC's session store; this reads it back.
  const [history, setHistory] = useState<MatchHistoryRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [csvErr, setCsvErr] = useState<string | null>(null);
  const live = state?.recap ?? null;
  // Keyed on the match id, NOT the recap object: `live` is a fresh object on every poll, which
  // refetched the history several times a second (review 2026-08-31).
  const liveId = state?.live?.match_id ?? null;
  useEffect(() => { api.matchHistory().then(setHistory).catch(() => setHistory([])); }, [api, liveId, state?.phase]);
  // The match still on screen is in the store too — showing it again as an "archived" chip hid its own
  // NEW MATCH and EXPORT CSV buttons when clicked. THIS MATCH is the only chip for it.
  const archive = history.filter(h => h.match_id !== liveId);
  // A selection that no longer exists (new session, or it became the live match) must not silently
  // fall back to the live recap with nothing highlighted — drop it so the UI matches what is shown.
  // NB this sits ABOVE the `!state` early return: a hook after a conditional return changes hook
  // order between renders, which is a React invariant, not a lint preference.
  const stale = sel != null && !archive.some(h => h.match_id === sel);
  useEffect(() => { if (stale) setSel(null); }, [stale]);
  // An export error belongs to the match it was raised for. It used to persist across a selection
  // change, so a failed archived export left "THIS MC IS TOO OLD…" sitting next to the LIVE export
  // link, which works fine — an error about a match the operator is no longer looking at
  // (merge review 2026-09-01). Clearing on `sel` covers the chips and the stale-drop above alike.
  useEffect(() => { setCsvErr(null); }, [sel]);
  if (!state) return null;
  const past = sel && !stale ? archive.find(h => h.match_id === sel) ?? null : null;
  const rc: RecapView | null = past ? past.recap : live;
  const picker = archive.length > 0 ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ font: F.mono(500, 11), letterSpacing: '.16em', color: T.micro }}>MATCH HISTORY ▸</span>
      {live && (
        <button type="button" onClick={() => setSel(null)} style={chip(!sel)}>THIS MATCH</button>
      )}
      {archive.map((h, i) => (
        <button key={h.match_id} type="button" onClick={() => setSel(h.match_id)} style={chip(sel === h.match_id)}
          title={h.ended_t ? new Date(h.ended_t).toLocaleString() : h.match_id}>
          {h.ended_t ? new Date(h.ended_t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `#${archive.length - i}`}
          {' · '}{(h.mode || '').toUpperCase() || 'MATCH'}
        </button>
      ))}
    </div>
  ) : null;
  if (!rc) return (
    <div className="screen">
      {picker}
      <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro }}>
        {archive.length ? 'PICK A MATCH ABOVE TO SEE ITS RESULT.' : 'NO RECAP YET — THE MATCH ENDS AT THE TIME LIMIT ON EVERY NODE.'}
      </div>
    </div>
  );
  // For an ARCHIVED match the recap's OWN rows win: the live roster is today's, so renaming a player
  // between matches made HONORS show the new name while FULL STATS (`r.display`) showed the old one
  // on the same screen (review 2026-09-01). For the live match the roster is the fresher source.
  const name = (id: string) => (past
    ? rc.rows.find(r => r.player_id === id)?.display ?? state.players.find(p => p.player_id === id)?.display
    : state.players.find(p => p.player_id === id)?.display ?? rc.rows.find(r => r.player_id === id)?.display) ?? id;
  const w = rc.winner ?? {};
  // teams can be renamed between matches too; an archived score is labelled by its own id when the
  // live config no longer describes that game
  const teamLabel = (id: string) => ((past ? undefined : state.teams.find(t => t.team_id === id)?.name) ?? id).toUpperCase();
  const winColor = w.team_id ? teamColor(w.team_id) : T.ink;
  const winnerBlock = w.tie?.length ? { text: `TIE — ${w.tie.map(teamLabel).join(' / ')}`, tail: '' }
    : w.undecided ? { text: `UNDECIDED — ${w.undecided.toUpperCase()}`, tail: ' · HOST DECIDES' }
    : w.player_id ? { text: name(w.player_id), tail: ' WINS' }
    : w.team_id ? { text: teamLabel(w.team_id), tail: ' WINS' }
    : { text: 'NO RESULT', tail: '' };
  const scores = Object.entries(rc.score);
  const rows = [...rc.rows].sort((a, b) => b.kills - a.kills);
  const mvpId = rc.honors.find(h => h.award === 'MVP')?.player_id;
  // W1/F6: `/api/recap.csv` only ever serves the LIVE scorer, so an archived match used to hide its
  // export button rather than hand the operator the wrong game. It has its own endpoint now.
  const csv = past ? api.matchCsvUrl(past.match_id) : api.recapCsvUrl();
  const csvName = past ? `brx-recap-${past.match_id}.csv` : 'brx-recap.csv';

  return (
    <div className="screen">
      {picker}
      {(past ?? history.find(h => h.match_id === liveId))?.config && <MatchConfig row={(past ?? history.find(h => h.match_id === liveId))!} />}
      {past && (
        <div style={{ marginBottom: 12, padding: '8px 14px', border: `1px solid ${T.line2}`, borderLeft: `3px solid ${T.dim}`, font: F.mono(500, 11), letterSpacing: '.1em', color: T.dim }}>
          ARCHIVED MATCH{past.ended_t ? ` — ENDED ${new Date(past.ended_t).toLocaleString()}` : ''} · READ ONLY
        </div>
      )}
      {rc.provisional && (
        <div style={{ marginBottom: 12, padding: '8px 14px', border: `1px solid ${T.warn}`, borderLeft: `3px solid ${T.warn}`, background: 'rgba(255,176,32,.08)', font: F.mono(500, 11), letterSpacing: '.1em', color: T.warn }}>
          ▲ PROVISIONAL — {rc.missing.length} NODE{rc.missing.length === 1 ? ' HAS' : 'S HAVE'} NOT FLUSHED ({rc.missing.map(name).join(', ')}).
          {/* "bring them into range" is only actionable for the match still in hand */}
          {past ? ' THESE NUMBERS ARE AS RECORDED WHEN THE MATCH WAS ARCHIVED.'
                : " KILLS LIVE IN VICTIMS' REPORTS; BRING THEM INTO RANGE TO FINALIZE."}
        </div>
      )}
      {/* F77 / F80: after-the-fact detectors from the scorer. A replayed hit cannot be dropped (it looks exactly
          like real fire), so the recap NAMES the pattern; a wire-0 shooter scored for nobody, and the operator
          should know whether that was a hill or a gun that never got its identity. */}
      {(rc.warnings ?? []).map(w => (
        <div key={w} data-testid="recap-warning" style={{ marginBottom: 12, padding: '8px 14px', border: `1px solid ${T.warn}`, borderLeft: `3px solid ${T.warn}`, background: 'rgba(255,176,32,.08)', font: F.chk(600, 11.5), letterSpacing: '.04em', color: T.warn, textTransform: 'none' }}>
          ▲ {w}
        </div>
      ))}
      {/* A8: `settling` means a bound node has not been heard from since the whistle, so the numbers on
          this screen are still moving. `provisional` cannot cover it — a player is marked flushed on
          their FIRST event, so anyone who fired is flushed long before the end (Tony, field 2026-08-30:
          "it kinda was showing the final results as if it was final and then it finally popped up and
          the totals changed"). The server has served this since A8 and nothing rendered it, which for
          an objective mode is the difference between a result and a guess (operator review 2026-09-10). */}
      {!past && rc.settling && (
        <div data-testid="settling" style={{ marginBottom: 12, padding: '8px 14px', border: `1px solid ${T.warn}`, borderLeft: `3px solid ${T.warn}`, font: F.mono(500, 11), letterSpacing: '.1em', color: T.warn }}>
          ▲ STILL SETTLING — {(rc.awaiting ?? []).length} NODE{(rc.awaiting ?? []).length === 1 ? ' HAS' : 'S HAVE'} NOT REPORTED SINCE THE WHISTLE
          {(rc.awaiting ?? []).length ? ` (${(rc.awaiting ?? []).map(name).join(', ')})` : ''}
          {typeof rc.since_end_ms === 'number' ? ` · ${Math.round(rc.since_end_ms / 1000)}S AGO` : ''}. THESE TOTALS CAN STILL CHANGE.
        </div>
      )}
      {/* an ARCHIVED match must be described by ITS OWN mode, not the config the host is drafting
          now — the header read "MATCH COMPLETE · TDM · 05:00" over a recap of a 3-minute FFA */}
      <div style={{ font: F.mono(500, 11), letterSpacing: '.22em', color: T.dim, marginBottom: 8 }}>[ A8 // MATCH COMPLETE · {(past ? past.mode : state.config.mode).toUpperCase()}{past ? '' : ` · ${fmtClock(state.config.time_limit_s ?? 0)}`} ]</div>
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
                <span style={{ font: F.osw(700, 44), color: teamColor(id) }}><Num value={s} /></span>
              </span>
            ))}
          </div>
        ) : (
          <span style={{ font: F.osw(700, 44), color: T.ink }}><Num value={rows[0]?.kills ?? 0} /> <span style={{ font: F.chk(600, 12), color: T.micro }}>KILLS</span></span>
        )}
        <span style={{ flex: 1 }} />
        {csvErr && <span role="alert" style={{ font: F.mono(600, 11), letterSpacing: '.1em', color: T.bad }}>▲ {csvErr}</span>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* An <a download> saves whatever comes back, so against an MC that predates the archived
              route the operator gets the 404's JSON body in a file named .csv. `serverOld` only
              watches /api/perks, so check this route itself before letting the download start
              (review 2026-09-01). The live export needs no check: that route has always existed. */}
          {/* The href stays the REAL url even for an archived match: dropping it would strip the
              link's keyboard focus and context menu to close a middle-click edge case that only
              misfires against a pre-W1 server. The click handler fetches first, so the ordinary
              path never saves a 404 body; "Save link as" on an old MC still would (merge review
              2026-09-01, accepted as the cheaper trade). */}
          <a href={csv} download={csvName} className="hov-acc"
            onClick={past ? async e => {
              e.preventDefault();
              let blob: Blob;
              try {
                const r = await fetch(csv);
                if (!r.ok) { setCsvErr(r.status === 404 ? 'THIS MC IS TOO OLD TO EXPORT AN ARCHIVED MATCH — UPDATE THE SERVER' : `EXPORT FAILED (${r.status})`); return; }
                blob = await r.blob();
              } catch {
                // ONLY the fetch is caught here. A broad try around the save below reported a code
                // bug (a missing URL.createObjectURL) to the operator as a network fault — a lie
                // that would have sent them hunting the Wi-Fi (review 2026-09-01).
                setCsvErr('EXPORT FAILED — MC UNREACHABLE'); return;
              }
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = csvName;
              // attached, and revoked LATE: Safari and Firefox cancel a download from a detached
              // anchor whose object URL is revoked synchronously, and the field host is a MacBook
              document.body.appendChild(a);
              a.click();
              setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
              setCsvErr(null);
            } : undefined}
            style={{ font: F.chk(700, 12), letterSpacing: '.18em', padding: '11px 22px', background: 'transparent', border: `1px solid ${T.line2}`, color: T.dim, textDecoration: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>⬇ EXPORT CSV{rc.provisional ? ' (PROVISIONAL)' : ''}</a>
          {/* NEW MATCH stays live-only: an archived match is a record, not a place to start from */}
          {/* disabled in-flight: newSession() rebuilds the whole session, and a double-tap on a slow
              LAN fired it twice — the second landing on a session the first had already replaced */}
          {!past && <PrimaryButton size={13} disabled={starting} onClick={async () => {
            if (starting) return;
            setStarting(true);
            try { const s = await run(() => api.newSession(true)); if (s) setView('muster'); }
            finally { setStarting(false); }
          }}>{starting ? 'STARTING…' : 'NEW MATCH ▸'}</PrimaryButton>}
        </div>
      </Brackets>
      <AfterWhistle rc={rc} name={name} />
      {rc.possession && <Possession p={rc.possession} label={teamLabel} />}
      {rc.stations && rc.stations.length > 0 && <Stations rows={rc.stations} />}
      {rc.honors.length > 0 && (<>
      <SectionRule label="HONORS" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(168px,1fr))', gap: 8, marginBottom: 22 }}>
        {rc.honors.map(h => {
          const c = AWARD_COLOR[h.award] ?? T.acc;
          return (
            <div key={h.award} style={{ background: T.panel, border: `1px solid ${T.line}`, borderTop: `2px solid ${c}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, clipPath: CHAMFER.br8 }}>
              <span style={{ font: F.mono(500, 11), letterSpacing: '.16em', color: c }}>{h.award}</span>
              <span style={{ font: F.osw(700, 19), letterSpacing: '.08em' }}>{name(h.player_id)}</span>
              <span style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro }}>{h.stat}</span>
            </div>
          );
        })}
      </div>
      </>)}
      {/* DATA SYNC reads the LIVE roster and node link state, so it says nothing true about a match
          that ended hours ago — it would show today's phones against yesterday's game */}
      {!past && <>
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
              <span style={{ font: F.mono(600, 11), letterSpacing: '.1em', color: col }}>{txt}</span>
            </span>
          );
        })}
      </div>
      </>}
      <SectionRule label="FULL STATS" />
      <div style={{ overflowX: 'auto' }}>
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
            {rows.map(r => <Row key={r.player_id} r={r} mvp={r.player_id === mvpId} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ r, mvp }: { r: ScoreRow; mvp: boolean }) {
  // F119: the recap can still be settling (a parked node has not flushed), so ACC keeps the same
  // settling mark it wears on the live board rather than quietly becoming a fact at the whistle.
  const prov = !!r.acc_provisional;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: GAP, alignItems: 'center', padding: '10px 14px', background: mvp ? 'rgba(255,210,63,.05)' : T.panel, border: `1px solid ${T.row}`, borderLeft: `3px solid ${teamColor(r.team_id)}` }}>
      <span style={{ font: F.chk(700, 14), letterSpacing: '.1em' }}>{r.display}</span>
      <span data-cell="k" style={{ textAlign: 'right', font: F.osw(700, 17), ...edge('k') }}><Num value={r.kills} /></span>
      <span data-cell="d" style={{ textAlign: 'right', font: F.osw(600, 16), color: T.dim, ...edge('d') }}><Num value={r.deaths} /></span>
      <span data-cell="a" style={{ textAlign: 'right', font: F.osw(600, 16), color: T.dim, ...edge('a') }}><Num value={r.assists} /></span>
      <span data-cell="kd" style={{ textAlign: 'right', font: F.osw(600, 15), ...edge('kd') }}><Num value={r.kd.toFixed(1)} /></span>
      <span data-cell="acc" data-provisional={prov ? '1' : '0'} title={prov ? 'Still settling — a node has not flushed its shot count' : undefined}
        style={{ textAlign: 'right', font: F.osw(600, 15), color: prov ? T.micro : T.dim, ...edge('acc') }}>
        {/* the mark LEADS the number, exactly as it does on the live board: "35%~" reads as a unit
            nobody uses, "~35%" is how an approximate value is written everywhere else, and the two
            screens must not write the same fact two ways (review 2026-09-12) */}
        {r.accuracy == null ? '—' : <>{prov ? '~' : ''}<Num value={Math.round(r.accuracy)} />%</>}
      </span>
      <span data-cell="stk" style={{ textAlign: 'right', font: F.osw(600, 15), color: T.dim, ...edge('stk') }}><Num value={bestStreak(r)} /></span>
      <span style={{ font: F.mono(500, 11), letterSpacing: '.06em', color: '#ffd23f', lineHeight: 1.45, ...edge('medals') }}>{r.medals.length ? r.medals.join(' · ') : '—'}</span>
    </div>
  );
}

function chip(on: boolean): React.CSSProperties {
  return { font: F.mono(600, 11), letterSpacing: '.1em', padding: '5px 10px', minHeight: 28, cursor: 'pointer',
           background: on ? T.acc : 'transparent', color: on ? T.accInk : T.dim,
           border: `1px solid ${on ? T.acc : T.line2}` };
}


/** Every setting the match actually ran with, and the head we pushed.
 *  Tony, 2026-09-01: "as we debug, you should be able to see every single setting for a game on MC."
 *  A whole evening's theory rested on which venue a match used, and the only way to find out was to
 *  ask him. The compiled head is included because a token is ground truth where a setting is a claim. */
function MatchConfig({ row }: { row: MatchHistoryRow }) {
  const [open, setOpen] = useState(false);
  const cfg = row.config ?? {};
  const heads = (cfg._heads ?? {}) as Record<string, string[]>;
  const head = Object.values(heads)[0] ?? [];
  const skip = new Set(['_heads', 'teams']);
  const rows = Object.entries(cfg).filter(([k]) => !skip.has(k));
  return (
    <div style={{ marginBottom: 12, border: `1px solid ${T.line}`, background: T.panelDeep }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ ...BTN_RESET, width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', minHeight: 40 }}>
        <span style={{ font: F.mono(600, 11), letterSpacing: '.16em', color: T.acc }}>{open ? '▾' : '▸'} GAME SETTINGS AS RUN</span>
        <span style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro }}>
          {String(cfg.mode ?? '').toUpperCase()} · {String(cfg.environment ?? '?').toUpperCase()} · {head.length} HEAD FRAMES
        </span>
      </button>
      {open && (
        <div style={{ padding: '4px 12px 12px', display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 14px', alignItems: 'baseline', minWidth: 260 }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <span style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro }}>{k.toUpperCase()}</span>
                <span style={{ font: F.mono(600, 11), color: T.ink, wordBreak: 'break-word' }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
              </div>
            ))}
          </div>
          {head.length > 0 && (
            <div style={{ flex: '1 1 340px', minWidth: 0 }}>
              <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro, marginBottom: 4 }}>COMPILED HEAD — WHAT THE GUN WAS SENT</div>
              <pre style={{ margin: 0, maxHeight: 240, overflow: 'auto', font: F.mono(500, 11), color: T.dim, background: T.inset, border: `1px solid ${T.line}`, padding: 8 }}>{head.join('\n')}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/** A6.1 — what happened AFTER the whistle.
 *
 *  The scorer freezes at `end_t` and keeps recording: a shot fired a second late is a real fact and it
 *  does NOT count. Tony, field 2026-08-30: the totals "finally popped up and the totals changed" — a
 *  recap that moves without saying why is worse than one that is late. So these are shown as their own
 *  block, plainly marked unofficial, and never folded into the table above.
 *
 *  Rendered only when the server sent the breakdown. An older MC sends `post_end_facts` (a bare count)
 *  and nothing else; there is no way to invent the per-player split from it, so nothing is invented. */
/** How many late facts there are to talk about, and what to call them.
 *
 *  "3 FACTS RECORDED" was wire vocabulary on a screen an operator reads out loud: `facts` is what the
 *  scorer calls a recorded event, and what actually landed after the whistle is kills and deaths
 *  (review 2026-09-12). */
const lateLine = (n: number) => (n === 1 ? '1 LATE KILL / DEATH' : `${n} LATE KILLS / DEATHS`);

/** The A6.1 block, or the count an older MC sends instead, or nothing.
 *
 *  Two bugs lived in the one-line `{rc.after_end && …}` this replaces (review 2026-09-12):
 *  `after_end: {facts: 0, by_player: {}}` — the normal case, a match where nothing landed late —
 *  rendered a whole titled block that said NOTHING ATTRIBUTED TO A PLAYER, and an older MC that
 *  sends only `post_end_facts` rendered nothing at all, dropping a fact it HAD sent. So the gate is
 *  the COUNT, from whichever field carried it, and a count with no breakdown is still said out loud. */
function AfterWhistle({ rc, name }: { rc: RecapView; name: (id: string) => string }) {
  const a = rc.after_end;
  const n = a ? a.facts : (rc.post_end_facts ?? 0);
  if (!n) return null;
  if (!a) {
    return (
      <div data-testid="after-end-count" style={{ marginBottom: 18, border: `1px dashed ${T.line2}`, background: T.panelDeep }}>
        <SectionRule label="AFTER THE WHISTLE" hint={lateLine(n)} />
        <div style={{ padding: '12px 16px', font: F.chk(600, 12), letterSpacing: '.06em', color: T.dim, lineHeight: 1.5 }}>
          RECORDED, NOT COUNTED — THESE LANDED AFTER SCORING FROZE AND ARE NOT IN THE RESULT ABOVE.
          THIS MC SENT THE COUNT WITHOUT THE PER-PLAYER SPLIT, SO THERE IS NONE TO SHOW.
        </div>
      </div>
    );
  }
  return <AfterEnd a={a} name={name} />;
}

function AfterEnd({ a, name }: { a: NonNullable<RecapView['after_end']>; name: (id: string) => string }) {
  const rows = Object.entries(a.by_player).filter(([, v]) => (v.kills || 0) + (v.deaths || 0) > 0);
  // S41 (field 2026-09-12): a titled, dashed section whose only content was "NOTHING ATTRIBUTED TO A
  // PLAYER" read as an empty box to the operator — `facts > 0` with an empty `by_player` is real (a
  // late fact the scorer could not pin on anyone), but it is not something the board can SHOW, so it
  // must not spend a whole section saying so. The bare-count block above (the `!a` branch in
  // `AfterWhistle`) still covers the one case where a count with no breakdown IS all there is to say —
  // that is an older MC's honest shape, not this one.
  if (rows.length === 0) return null;
  return (
    <div data-testid="after-end" style={{ marginBottom: 18, border: `1px dashed ${T.line2}`, background: T.panelDeep }}>
      <SectionRule label="AFTER THE WHISTLE" hint={lateLine(a.facts)} />
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ font: F.chk(600, 12), letterSpacing: '.06em', color: T.dim, lineHeight: 1.5 }}>
          RECORDED, NOT COUNTED — THESE LANDED AFTER SCORING FROZE AND ARE NOT IN THE RESULT ABOVE.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {rows.map(([pid, v]) => (
            <span key={pid} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, background: T.panel, border: `1px solid ${T.line}`, padding: '8px 14px' }}>
              <span style={{ font: F.chk(700, 12), letterSpacing: '.06em' }}>{name(pid)}</span>
              <span style={{ font: F.mono(600, 11), letterSpacing: '.08em', color: T.micro }}>
                {v.kills ? <>+<Num value={v.kills} /> K</> : null}{v.kills && v.deaths ? ' · ' : ''}{v.deaths ? <>+<Num value={v.deaths} /> D</> : null}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** F70 — an objective mode's real scoreboard: seconds of possession per team.
 *
 *  Rendered BESIDE the kills, never instead of them: the kill table is still true, it just is not how
 *  a hill mode is won. `reports`/`observed` are shown because possession from a grenade is a LOWER
 *  BOUND — the beacon is IR and only a gun in range hears it (F92), so a match nobody watched reads 0
 *  and must not be dressed up as the result. */
function Possession({ p, label }: { p: NonNullable<RecapView['possession']>; label: (id: string) => string }) {
  const held = Object.entries(p.by_team).sort((a, b) => b[1] - a[1]);
  const top = held[0]?.[1] ?? 0;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const thin = p.of_s != null && p.observed_s < p.of_s * 0.75;
  return (
    <div data-testid="possession" style={{ marginBottom: 18, border: `1px solid ${T.line}`, background: T.panelDeep }}>
      <SectionRule label="POSSESSION // HOW THE HILL WAS HELD" hint={`${p.sites} POINT${p.sites === 1 ? '' : 'S'} · ${p.reports} PHONE${p.reports === 1 ? '' : 'S'} REPORTED`} />
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {held.map(([id, secs]) => (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ font: F.chk(700, 12), letterSpacing: '.14em', color: teamColor(id), minWidth: 120 }}>{label(id)}</span>
            <span style={{ flex: 1, height: 14, background: T.inset, border: `1px solid ${T.line}` }}>
              {/* named, not matched by shape: the suite used to find these with `span[style*="width"]`,
                  which started matching <Num>'s fixed-width digit cells the moment the seconds beside
                  it became digit cells (2026-09-12). A bar a test can name cannot be confused. */}
              <span data-poss-bar={id} style={{ display: 'block', height: '100%', width: `${top ? Math.round((secs / top) * 100) : 0}%`, background: teamColor(id) }} />
            </span>
            <span style={{ font: F.osw(700, 20), minWidth: 72, textAlign: 'right' }}><Num value={mmss(secs)} /></span>
          </div>
        ))}
        {p.neutral_s > 0 && (
          <div style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro }}>
            NEUTRAL {mmss(p.neutral_s)} — NOBODY HELD THE POINT (A HILL BROADCASTS TEAM 2 WHEN UNOWNED)
          </div>
        )}
        <div style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: thin ? T.warn : T.micro, lineHeight: 1.5 }}>
          {thin ? '▲ ' : ''}BEST COVERAGE {mmss(p.observed_s)}{p.of_s ? ` OF ${mmss(p.of_s)}` : ''} — A HILL IS ONLY SEEN BY A GUN IN BEACON RANGE, SO THIS IS A FLOOR, NOT A FULL ACCOUNT.
        </div>
      </div>
    </div>
  );
}

/** Roadmap A6 — one line per ASSIGNED utility station, from its own self-authoritative heartbeat (utility.md
 *  §5c/§5d.6). A station never heard from still gets a row (its fields null, `heard: false`), so "no
 *  revives" and "never armed" read differently instead of both showing a bare 0 -- and, since extraction/
 *  powerup/bomb have no count of their own, `heard` is what tells them apart at all (F105, 2026-09-11). */
function Stations({ rows }: { rows: RecapStationRow[] }) {
  return (
    <div data-testid="recap-stations" style={{ marginBottom: 18, border: `1px solid ${T.line}`, background: T.panelDeep }}>
      <SectionRule label="STATIONS // WHAT THE FIELD ITEMS REPORTED" hint={`${rows.length} ASSIGNED`} />
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div key={r.node_id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ font: F.chk(700, 12), letterSpacing: '.1em', minWidth: 150 }}>{STATION_KIND_LABEL[r.kind] ?? r.kind} {r.id}</span>
            <span style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: teamColor((STATION_TID_NAME[r.team] ?? 'any').toLowerCase()) }}>{STATION_TID_NAME[r.team] ?? r.team}</span>
            {r.kind === 'respawn' && (
              <span style={{ font: F.mono(600, 11), letterSpacing: '.06em', color: r.revives == null ? T.warn : T.ok }}>
                {r.revives == null ? 'NEVER HEARD FROM' : `${r.revives} REVIVE${r.revives === 1 ? '' : 'S'}`}
              </span>
            )}
            {r.kind === 'control' && (
              <span style={{ font: F.mono(600, 11), letterSpacing: '.06em', color: r.owner == null ? T.warn : T.ok }}>
                {r.owner == null ? 'NEVER HEARD FROM' : `HELD BY ${r.owner === 255 ? 'NOBODY' : (STATION_TID_NAME[r.owner] ?? r.owner)}`}
                {r.hold_ms && Object.keys(r.hold_ms).length > 0 && ' · ' + Object.entries(r.hold_ms).map(([tid, ms]) => `${STATION_TID_NAME[Number(tid)] ?? tid} ${Math.round(ms / 1000)}s`).join(' · ')}
              </span>
            )}
            {(r.kind === 'extraction' || r.kind === 'powerup' || r.kind === 'bomb') && (
              // F105 (review 2026-09-11): these three kinds have no count of their own -- `heard` is the
              // only thing distinguishing a silent station from a reporting one; without this branch both
              // looked identical (neither rendered anything at all).
              <span style={{ font: F.mono(600, 11), letterSpacing: '.06em', color: r.heard ? T.ok : T.warn }}>
                {r.heard ? 'REPORTED' : 'NEVER HEARD FROM'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
