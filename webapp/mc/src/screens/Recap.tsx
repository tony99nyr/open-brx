import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MatchHistoryRow, RecapStationRow, RecapView, ScoreRow, State } from '../api/types';
import { cleanServerLine, endDeliveryLine } from '../api/derive';
import { recapDeliveryText, recapDeliveryOkText } from './recapDelivery';
import { useStore } from '../store';
import { CHAMFER, F, T, fmtDuration, teamColor } from '../tokens';
import { BTN_RESET, Brackets, Num, SectionRule, PrimaryButton } from '../ui';
import { OrphanMatch } from '../ui/OrphanMatch';
import { TEAM_KILL_NOTE, bestStreak } from './Live';
import { isObjectiveScored, objectiveWord } from './objective';
import { columnEdges, type Column } from './columns';
import { AWARDS, MEDALS } from '../api/contract.gen';
import { medalChip, medalIcon } from '../api/medalicons.gen';
import { Alert, alertStyle } from '../ui/Alert';
import { MC_OFFLINE, MC_OLDER, alertWords, colourOf, glyphed, serverLine, sevOf } from '../alerts';

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
// A63: keyed by the AWARDS `key`; a recap stored before A63 has only the label, so it maps through AWARD_KEY.
// F221 round 2: first_blood and multikill were T.bad/T.warn, the ALERT colours, on a medal, not a
// fault. LIVE's own feed already moved FIRST BLOOD to T.ink and every other medal tag to T.acc
// (`live-feed-first-blood-tag`/`live-feed-team-kill-tag`, retired as NOT-ALERT); this matches it.
const AWARD_COLOR: Record<string, string> = { mvp: '#ffd23f', first_blood: T.ink, multikill: T.acc, iron_man: T.ink, wingman: T.ok, objective_hero: T.accHover };
const AWARD_KEY: Record<string, string> = { MVP: 'mvp', 'FIRST BLOOD': 'first_blood', MULTIKILL: 'multikill' };
// Tony 2026-09-25: the recap draws the medal and award icons (the phone's own set, medalicons.gen.ts). MC keeps its
// words beside them, and a legend under FULL STATS teaches the icons. The LIVE screens draw none.
const RECAP_ROWS = [...MEDALS, ...AWARDS];
const labelOf = (k: string) => RECAP_ROWS.find(r => r.key === k)?.label ?? k.replace(/_/g, ' ').toUpperCase();
function MedalIcon({ k, label, size = 24 }: { k: string; label: string; size?: number }) {
  // decorative: MC prints the name beside every icon (the chip, the honour card, the legend)
  return <span data-medal-icon={k} title={label} aria-hidden="true" style={{ display: 'inline-flex', flex: 'none', width: size, height: size }}
    dangerouslySetInnerHTML={{ __html: medalIcon(k, { size, label }) }} />;
}
/** The keys the recap shows an icon for: every honour, then every medal chip on the board. */
function recapKeys(rc: RecapView): string[] {
  const keys = [...rc.honors.map(h => h.key ?? AWARD_KEY[h.award] ?? medalChip(h.award, RECAP_ROWS).key),
    ...rc.rows.flatMap(r => r.medals.map(m => medalChip(m, RECAP_ROWS).key))];
  return [...new Set(keys.filter((k): k is string => !!k))];
}
function MedalLegend({ keys }: { keys: string[] }) {
  if (!keys.length) return null;
  return (
    <div data-testid="medal-legend" role="list" aria-label="Medal legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 10 }}>
      {keys.map(k => (
        <span key={k} role="listitem" data-legend={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: F.mono(500, 11), letterSpacing: '.08em', color: T.dim }}>
          <MedalIcon k={k} label={labelOf(k)} />{labelOf(k)}
        </span>
      ))}
    </div>
  );
}
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
  // Polish 2026-09-23: RECAP inherited LIVE's scroll position (the console scrolls <main>, not the
  // window), so it opened part-way down the board. Every scrolled ancestor goes back to the top once,
  // on mount. A layout effect, so the first painted frame is already at the top.
  const top = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (let el = top.current?.parentElement ?? null; el; el = el.parentElement) {
      if (el.scrollTop) el.scrollTop = 0;
    }
    if (document.scrollingElement?.scrollTop) document.scrollingElement.scrollTop = 0;
  }, []);
  const live = state?.recap ?? null;
  // Keyed on the match id, NOT the recap object: `live` is a fresh object on every poll, which
  // refetched the history several times a second (review 2026-08-31).
  const liveId = state?.live?.match_id ?? null;
  useEffect(() => { api.matchHistory().then(setHistory).catch(() => setHistory([])); }, [api, liveId, state?.phase]);
  // The match still on screen is in the store too — showing it again as an "archived" chip hid its own
  // NEXT MATCH and EXPORT CSV buttons when clicked. THIS MATCH is the only chip for it.
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
    <div className="screen" ref={top}>
      <OrphanMatch />
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
  // F154 polish (field 2026-09-12, pass 1): `winner.tie` holds PLAYER ids in FFA (a frag-cap dead
  // heat has no team to name) and TEAM ids everywhere else — `teamLabel` on a player id falls through
  // to the raw hex id ("TIE — 7F3A2B1C / 4D8E90AB"), since no team in `state.teams` ever matches one.
  const tieLabel = (id: string) => ((past ? past.mode : state.config.mode) === 'ffa' ? name(id) : teamLabel(id));
  const inPlay = !past && (state.phase === 'live' || state.phase === 'armed');   // polish round 2: decided before the wording
  const wins = inPlay ? ' LEADS' : ' WINS';
  const winnerBlock = w.tie?.length ? { text: `TIE — ${w.tie.map(tieLabel).join(' / ')}`, tail: '' }
    : w.undecided ? { text: `UNDECIDED — ${w.undecided.toUpperCase()}`, tail: ' · HOST DECIDES' }
    : w.player_id ? { text: name(w.player_id), tail: wins }
    : w.team_id ? { text: teamLabel(w.team_id), tail: wins }
    : { text: 'NO RESULT', tail: '' };
  const scores = Object.entries(rc.score);
  const rows = [...rc.rows].sort((a, b) => b.kills - a.kills);
  // A63: a level MVP is SHARED, so every holder's row is marked (`key` is absent on a pre-A63 recap).
  const mvpIds = new Set(rc.honors.filter(h => (h.key ?? (h.award === 'MVP' ? 'mvp' : '')) === 'mvp').map(h => h.player_id));
  // W1/F6: `/api/recap.csv` only ever serves the LIVE scorer, so an archived match used to hide its
  // export button rather than hand the operator the wrong game. It has its own endpoint now.
  const csv = past ? api.matchCsvUrl(past.match_id) : api.recapCsvUrl();
  const csvName = past ? `brx-recap-${past.match_id}.csv` : 'brx-recap.csv';
  // A42: whether the END reached every HUD. `state.end_delivery` is about the match MC has in hand, so an
  // ARCHIVED recap gets none of it — the phone it would name was put away hours ago. The ok-case sentence
  // is `recapDeliveryOkText` (recapDelivery.ts), worded to agree with LIVE's `endDeliveryLine`.
  const edv = past ? null : state.end_delivery;
  const edLine = endDeliveryLine(edv);
  const edStragglers = edv?.unconfirmed ?? [];
  const edUnconfirmed = new Set(edStragglers.map(u => u.player_id));
  const edText = edv ? recapDeliveryText(edv) : null;
  // M23 (visual QA 2026-09-23): the header printed the TIME LIMIT, so a match ended early at 2:13 read
  // as 10:00. F319: the server now sends the length itself (`played_s`). Without it (an older MC) the
  // length is read from the server's own clock: `since_end_ms` is `now - scorer.end_t`, `t` is that same
  // `now`, and `live.go_live_t` is the whistle's start, all on one snapshot. Without those either, the
  // header says it is the LIMIT rather than pass the limit off as the length.
  const limitS = (past ? (past.config?.time_limit_s as number | undefined) : state.config.time_limit_s) ?? 0;   // an archived match keeps its own limit
  const playedS = typeof rc.played_s === 'number' ? rc.played_s
    : !past && state.live && typeof rc.since_end_ms === 'number' && typeof state.t === 'number'
      ? Math.min(limitS || Infinity, Math.max(0, Math.round((state.t - rc.since_end_ms - state.live.go_live_t) / 1000)))
      : null;
  // Polish 2026-09-23: RECAP can be reached by URL while a match is still being played. It said MATCH
  // COMPLETE and offered NEXT MATCH, which the server refuses (409) until the match is over.
  // H2 for RECAP (polish 2026-09-23): a hill match is won on held time, so that is the headline, as on
  // LIVE and SPECTATE (the same `objective.ts` helper decides it on all three). With no held time
  // reported the numbers are still the kill score, and are labelled KILLS so nobody reads them as held.
  const scoring = past ? (past.config?.scoring as State['config']['scoring'] | undefined) : state.config.scoring;
  const mode = past ? past.mode : state.config.mode;
  const objective = !!scoring && isObjectiveScored({ scoring }) && scores.length >= 2;
  const heldBy = objective && rc.possession ? rc.possession.by_team : null;
  const anyTeamKill = rows.some(r => r.kills < 0);
  const lengthLabel = playedS == null && past ? ''
    : playedS == null ? (limitS ? ` · LIMIT ${fmtDuration(limitS)}` : '')
    : limitS && playedS < limitS ? ` · ${fmtDuration(playedS)} OF ${fmtDuration(limitS)}`
    : ` · ${fmtDuration(playedS)}`;

  return (
    <div className="screen" ref={top}>
      <OrphanMatch />
      {picker}
      {(past ?? history.find(h => h.match_id === liveId))?.config && <MatchConfig row={(past ?? history.find(h => h.match_id === liveId))!} />}
      {past && (
        <Alert id="recap-archived-banner" testid="recap-archived" role="status"
          style={{ marginBottom: 12, padding: '8px 14px', border: `1px solid ${T.line2}`, borderLeft: `3px solid ${colourOf('recap-archived-banner')}` }}>
          ARCHIVED MATCH{past.ended_t ? `: ENDED ${new Date(past.ended_t).toLocaleString()}` : ''} · READ ONLY
        </Alert>
      )}
      {/* F221: AMBER is one line, never a banner or a filled chip — fix before the next match, not
          act now. */}
      {rc.provisional && (
        <Alert id="recap-provisional-banner" testid="recap-provisional" style={{ marginBottom: 12 }}>
          {rc.missing.length} NODE{rc.missing.length === 1 ? ' HAS' : 'S HAVE'} NOT FLUSHED ({rc.missing.map(name).join(', ')}):
          {/* "bring them into range" is only actionable for the match still in hand */}
          {past ? ' THESE NUMBERS ARE AS RECORDED WHEN THE MATCH WAS ARCHIVED.'
                : " KILLS LIVE IN VICTIMS' REPORTS. BRING THEM INTO RANGE TO FINALIZE."}
        </Alert>
      )}
      {/* F77 / F80: after-the-fact detectors from the scorer. A replayed hit cannot be dropped (it looks exactly
          like real fire), so the recap NAMES the pattern; a wire-0 shooter scored for nobody, and the operator
          should know whether that was a hill or a gun that never got its identity. MC words the line
          (mcp scoring.py); `serverLine` decides which catalogue id and severity it carries, so this call site
          never hard-codes the F74 words or picks a colour of its own. */}
      {(rc.warnings ?? []).map(w => {
        const sl = serverLine(w, 'amber');
        return (
          <Alert key={w} id={sl.id} sev={sl.sev} testid="recap-warning" role="status"
            style={{ marginBottom: 12, font: F.chk(600, 11.5), letterSpacing: '.04em', textTransform: 'none' }}>
            {cleanServerLine(w)}
          </Alert>
        );
      })}
      {/* A8: `settling` means a bound node has not been heard from since the whistle, so the numbers on
          this screen are still moving. `provisional` cannot cover it — a player is marked flushed on
          their FIRST event, so anyone who fired is flushed long before the end (Tony, field 2026-08-30:
          "it kinda was showing the final results as if it was final and then it finally popped up and
          the totals changed"). The server has served this since A8 and nothing rendered it, which for
          an objective mode is the difference between a result and a guess (operator review 2026-09-10). */}
      {/* F221: AMBER is one line, never a banner. */}
      {!past && rc.settling && (
        <Alert id="recap-settling-banner" testid="settling">
          STILL SETTLING: {(rc.awaiting ?? []).length} NODE{(rc.awaiting ?? []).length === 1 ? ' HAS' : 'S HAVE'} NOT REPORTED SINCE THE WHISTLE
          {(rc.awaiting ?? []).length ? ` (${(rc.awaiting ?? []).map(name).join(', ')})` : ''}
          {typeof rc.since_end_ms === 'number' ? ` · ${Math.round(rc.since_end_ms / 1000)}S AGO` : ''}. THESE TOTALS CAN STILL CHANGE.
        </Alert>
      )}
      {/* A42 (field 2026-09-12, twice: a tagger played on after the operator ended the match). Whether an
          END reached a HUD is a fact about DELIVERY, and it is deliberately stated HERE — above the board,
          in its own block, in the operator's own words — and never as a column, a mark or a footnote on
          anybody's score row. A player whose phone dropped off the Wi-Fi did nothing wrong, and a line that
          sits inside the results reads as if they did. Live match only: an archived recap is read long
          after the phone in question was put away, and `end_delivery` is about the match in hand. */}
      {/* M1 (visual QA 2026-09-23): this block said "8 HUDS NEVER CONFIRMED THE END" five seconds after
          the whistle, while MC was still re-delivering, beside a command-bar "REACHED 8 OF 8 NODES" and a
          row of "SYNCED ✓". It now follows the server's own `retrying`: amber and "NOT CONFIRMED YET"
          while MC is still trying, red and "NEVER" only once the ladder is spent. It also says how many
          phones the END REACHED (the socket took it), because reaching a phone is not a confirmation. */}
      {!past && edLine && edv && (() => {
        // F221: RED (spent) is a banner; AMBER (retrying) is one line, never a banner; a clean end is
        // NOT-ALERT (a positive status, T.ok on the accent only, never T.warn/T.bad, no ▲).
        const edId = edLine.ok ? null : edv.retrying ? 'recap-end-delivery-retrying' : 'recap-end-delivery-spent';
        const sev = edId ? sevOf(edId) : null;
        return (
          <div data-testid="end-delivery-recap" data-end-state={edLine.ok ? 'confirmed' : edv.retrying ? 'retrying' : 'spent'}
            data-alert={edId ?? undefined} data-sev={sev ?? undefined}
            role={edLine.ok ? undefined : edv.retrying ? 'status' : 'alert'}
            style={edLine.ok
              ? { marginBottom: 12, padding: '8px 14px', border: `1px solid ${T.line2}`, borderLeft: `3px solid ${T.ok}`, font: F.mono(500, 11), letterSpacing: '.1em', color: T.dim, lineHeight: 1.5 }
              : { marginBottom: 12, ...alertStyle(sev!, sev === 'red' ? 'banner' : 'line', 11) }}>
            {edLine.ok ? `✓ ${recapDeliveryOkText(edv)}` : glyphed(sev!, edText!)}
          </div>
        );
      })()}
      {/* an ARCHIVED match must be described by ITS OWN mode, not the config the host is drafting
          now — the header read "MATCH COMPLETE · TDM · 05:00" over a recap of a 3-minute FFA */}
      {/* the match length is a DURATION (a fixed span, over before this screen shows), not a clock still
          counting down, so it prints unpadded like every other span on this screen (fmtClock would pad
          it to "10:00" beside unpadded possession spans such as "7:21") */}
      <div style={{ font: F.mono(500, 11), letterSpacing: '.22em', color: T.dim, marginBottom: 8 }}>[ A8 // <span data-testid="recap-status" style={inPlay ? { color: colourOf('recap-status-inplay') } : undefined}>{inPlay ? 'IN PLAY · PROVISIONAL' : 'MATCH COMPLETE'}</span> · {mode.toUpperCase()}<span data-testid="recap-length">{lengthLabel}</span> ]</div>
      <Brackets color="#ffd23f" size={18} style={{ background: `linear-gradient(90deg,rgba(255,210,63,.1),transparent 60%),linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, padding: '22px 26px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 44px', marginBottom: 18 }}>
        <div>
          <div style={{ font: F.osw(700, 46), letterSpacing: '.08em', lineHeight: 1.15 }}>
            <span style={{ background: winColor, color: T.accInk, padding: '0 12px' }}>{winnerBlock.text}</span>{winnerBlock.tail}
          </div>
        </div>
        {heldBy ? (
          <div data-testid="recap-headline" data-headline="held" style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ font: F.chk(600, 12), letterSpacing: '.16em', color: T.micro }}>{objectiveWord(mode)} TIME</span>
            {scores.map(([id]) => [id, heldBy[id] ?? 0] as const).sort((a, b) => b[1] - a[1]).map(([id, secs], i) => (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 12 }}>
                {i > 0 && <span style={{ font: F.osw(600, 20), color: T.micro }}>—</span>}
                <span data-headline-team={id} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ font: F.osw(700, 44), color: teamColor(id) }}><Num value={fmtDuration(secs)} /></span>
                  <span style={{ font: F.mono(500, 11), letterSpacing: '.14em', color: T.micro }}>KILLS {rc.score[id] ?? 0}</span>
                </span>
              </span>
            ))}
          </div>
        ) : scores.length >= 2 ? (
          <div data-testid="recap-headline" data-headline="kills" style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            {scores.sort((a, b) => b[1] - a[1]).map(([id, s], i) => (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 12 }}>
                {i > 0 && <span style={{ font: F.osw(600, 20), color: T.micro }}>—</span>}
                <span data-headline-team={id} style={{ font: F.osw(700, 44), color: teamColor(id) }}><Num value={s} /></span>
              </span>
            ))}
            {objective && <span style={{ font: F.chk(600, 12), letterSpacing: '.16em', color: T.micro }}>KILLS</span>}
          </div>
        ) : (
          <span style={{ font: F.osw(700, 44), color: T.ink }}><Num value={rows[0]?.kills ?? 0} /> <span style={{ font: F.chk(600, 12), color: T.micro }}>KILLS</span></span>
        )}
        <span style={{ flex: 1 }} />
        {/* F221: an export failure is fix-before-next, not act-now — amber, never the red a live-safety
            fault gets, though it used to render red here. */}
        {csvErr && <span role="alert" data-alert="recap-csv-err" data-sev="amber" style={{ font: F.mono(600, 11), letterSpacing: '.1em', color: colourOf('recap-csv-err') }}>{glyphed('amber', csvErr)}</span>}
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
                // F221 round 1: both lines re-typed MC_OLDER/MC_OFFLINE in their own words; now the
                // shared facts (one fact, one sentence: src/alerts).
                if (!r.ok) { setCsvErr(r.status === 404 ? alertWords(MC_OLDER.what, MC_OLDER.act) : `EXPORT FAILED (${r.status})`); return; }
                blob = await r.blob();
              } catch {
                // ONLY the fetch is caught here. A broad try around the save below reported a code
                // bug (a missing URL.createObjectURL) to the operator as a network fault — a lie
                // that would have sent them hunting the Wi-Fi (review 2026-09-01).
                setCsvErr(`EXPORT FAILED, MC UNREACHABLE: ${MC_OFFLINE.act}`); return;
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
          {/* NEXT MATCH stays live-only: an archived match is a record, not a place to start from. */}
          {/* 2026-09-16 (Tony: "why? just make a new one"): the primary action starts the next match with
              the roster AND the game kept (`POST /api/match/next`: roll forward, then LOAD the same
              game) and lands on GAMES, which is where LOAD always leaves the operator: the loaded game
              on screen, EDIT beside it, CONTINUE TO KIT one tap away. Bench 2026-09-17: the command
              bar's separate NEW SESSION control was cut — picking a game and pressing LOAD already
              starts the next one (A43), and this button covers the one-tap case. Disabled in flight: a
              double-tap on a slow LAN fired twice. */}
          {!past && !inPlay && (
            <span data-testid="recap-next-match">
              <PrimaryButton size={13} disabled={starting} onClick={async () => {
                if (starting) return;
                setStarting(true);
                try { const s = await run(() => api.nextMatch()); if (s) setView('build'); }
                finally { setStarting(false); }
              }}>{starting ? 'STARTING…' : 'NEXT MATCH ▸'}</PrimaryButton>
            </span>
          )}
        </div>
      </Brackets>
      <AfterWhistle rc={rc} name={name} />
      {rc.possession && <Possession p={rc.possession} label={teamLabel} />}
      {rc.stations && rc.stations.length > 0 && <Stations rows={rc.stations} />}
      {rc.honors.length > 0 && (<>
      <SectionRule label="HONORS" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(168px,1fr))', gap: 8, marginBottom: 22 }}>
        {rc.honors.map(h => {
          const c = AWARD_COLOR[h.key ?? AWARD_KEY[h.award] ?? ''] ?? T.acc;
          return (
            <div key={`${h.key ?? h.award}:${h.player_id}`} style={{ background: T.panel, border: `1px solid ${T.line}`, borderTop: `2px solid ${c}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, clipPath: CHAMFER.br8 }}>
              {/* the icon beside the words (the phone's recap leads with the icon alone) */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {(() => { const k = h.key ?? AWARD_KEY[h.award] ?? medalChip(h.award, RECAP_ROWS).key; return k ? <MedalIcon k={k} label={h.award} size={28} /> : null; })()}
                <span style={{ font: F.mono(500, 11), letterSpacing: '.16em', color: c }}>{h.award}</span>
              </span>
              {/* M8 (visual QA 2026-09-24): the board's long-name rule, so a long name ends in "…", not mid-letter */}
              <span data-honor-name={h.player_id} title={name(h.player_id)} style={{ font: F.osw(700, 19), letterSpacing: '.08em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(h.player_id)}</span>
              <span style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro }}>{h.stat}</span>
            </div>
          );
        })}
      </div>
      </>)}
      {/* DATA SYNC reads the LIVE roster and node link state, so it says nothing true about a match
          that ended hours ago — it would show today's phones against yesterday's game */}
      {!past && <>
      {/* M1: a bare "SYNCED ✓" beside "8 HUDS NEVER CONFIRMED THE END" read as a contradiction. The two
          are different facts, so each chip names its own: the match DATA the phone delivered, and, for a
          HUD still in `end_delivery.unconfirmed`, that its END is not confirmed. A phone MC has not heard
          from since the whistle (`recap.awaiting`) is not called synced at all. */}
      <SectionRule label="DATA SYNC" hint="WHO HAS DELIVERED THEIR MATCH DATA · NOT THE SAME AS CONFIRMING THE END" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
        {state.players.map(pl => {
          const nv = state.nodes.find(n => n.node_id === pl.node_id);
          const missing = rc.missing.includes(pl.player_id);
          const quiet = (rc.awaiting ?? []).includes(pl.player_id);
          const fresh = nv && (nv.last_seen_ms ?? 1e9) < 30000;
          const pend = nv?.pending ?? null;
          // F221: NO REPORT and OUT OF RANGE are AMBER (fix before the next match — a node still
          // reachable, just not yet flushed); a phone still SENDING or newly CONNECTED is the
          // NEUTRAL SENDING/HOLDING family, and a clean sync is NOT-ALERT (T.ok, no glyph).
          const [txt, col] = !missing && quiet ? [glyphed('amber', 'NO REPORT SINCE THE WHISTLE: BRING IT INTO RANGE'), colourOf('recap-sync-no-report')]
            : !missing ? ['DATA SYNCED ✓', T.ok]
            : fresh && pend ? [`SENDING: ${pend} LEFT`, colourOf('recap-sync-sending')]
            : fresh ? ['CONNECTED: AWAITING DATA', colourOf('recap-sync-awaiting')]
            : [glyphed('amber', 'OUT OF RANGE: WILL SYNC ON RETURN'), colourOf('recap-sync-outofrange')];
          const endOpen = edUnconfirmed.has(pl.player_id);
          // A42: this suffix mirrors the end-delivery banner's own severity — amber while MC is still
          // trying, red once the retry ladder is spent (a gun that may still be live is act-now).
          const endId = edv?.retrying ? 'recap-end-delivery-retrying' : 'recap-end-delivery-spent';
          return (
            <span key={pl.player_id} data-sync-chip={pl.player_id} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${endOpen && col === T.ok ? T.warn : col}`, padding: '8px 14px' }}>
              <span style={{ font: F.chk(700, 12), letterSpacing: '.06em' }}>{pl.display}</span>
              <span style={{ font: F.mono(600, 11), letterSpacing: '.1em', color: col }}>{txt}</span>
              {endOpen && <span data-end-open="1" data-alert={endId} data-sev={sevOf(endId)} style={{ font: F.mono(600, 11), letterSpacing: '.1em', color: colourOf(endId) }}>· END NOT CONFIRMED</span>}
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
            {rows.map(r => <Row key={r.player_id} r={r} mvp={mvpIds.has(r.player_id)} />)}
          </div>
        </div>
      </div>
      <MedalLegend keys={recapKeys(rc)} />
      {/* F221: identical wording to LIVE/SPECTATE — a status fact, not a fault, so NEUTRAL. */}
      {anyTeamKill && (
        <div data-testid="team-kill-note" data-alert="recap-team-kill-note" data-sev="neutral"
          style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: colourOf('recap-team-kill-note'), marginTop: 8 }}>
          K BELOW ZERO: {TEAM_KILL_NOTE}
        </div>
      )}
    </div>
  );
}

function Row({ r, mvp }: { r: ScoreRow; mvp: boolean }) {
  // F119: the recap can still be settling (a parked node has not flushed), so ACC keeps the same
  // settling mark it wears on the live board rather than quietly becoming a fact at the whistle.
  const prov = !!r.acc_provisional;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: GAP, alignItems: 'center', padding: '10px 14px', background: mvp ? 'rgba(255,210,63,.05)' : T.panel, border: `1px solid ${T.row}`, borderLeft: `3px solid ${teamColor(r.team_id)}` }}>
      {/* M8 (visual QA 2026-09-24): at 900 px a 24-character name ran over the K number */}
      <span data-recap-name={r.player_id} title={r.display} style={{ font: F.chk(700, 14), letterSpacing: '.1em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.display}</span>
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
      <span data-cell="medals" style={{ font: F.mono(500, 11), letterSpacing: '.06em', color: '#ffd23f', lineHeight: 1.45, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 8px', ...edge('medals') }}>
        {r.medals.length ? r.medals.map((m, i) => { const c = medalChip(m, RECAP_ROWS);
          return <span key={`${m}:${i}`} data-medal-chip={c.key ?? ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{c.key && <MedalIcon k={c.key} label={m} size={20} />}{m}</span>; }) : '—'}
      </span>
    </div>
  );
}

function chip(on: boolean): React.CSSProperties {
  return { font: F.mono(600, 11), letterSpacing: '.1em', padding: '5px 10px', minHeight: 36, cursor: 'pointer',   // F318: was 28 px
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
        <Alert id="recap-after-whistle-count" role="status" style={{ padding: '12px 16px', font: F.chk(600, 12), letterSpacing: '.06em', lineHeight: 1.5 }}>
          RECORDED, NOT COUNTED: THESE LANDED AFTER SCORING FROZE AND ARE NOT IN THE RESULT ABOVE.
          THIS MC SENT THE COUNT WITHOUT THE PER-PLAYER SPLIT, SO THERE IS NONE TO SHOW.
        </Alert>
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
        <Alert id="recap-after-whistle-breakdown" role="status" style={{ font: F.chk(600, 12), letterSpacing: '.06em', lineHeight: 1.5 }}>
          RECORDED, NOT COUNTED: THESE LANDED AFTER SCORING FROZE AND ARE NOT IN THE RESULT ABOVE.
        </Alert>
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
  return (
    <div data-testid="possession" style={{ marginBottom: 18, border: `1px solid ${T.line}`, background: T.panelDeep }}>
      <SectionRule label="POSSESSION // HOW THE HILL WAS HELD" hint={`${p.sites} POINT${p.sites === 1 ? '' : 'S'} · ${p.reports} NODE${p.reports === 1 ? '' : 'S'} REPORTED`} />
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
            <span style={{ font: F.osw(700, 20), minWidth: 72, textAlign: 'right' }}><Num value={fmtDuration(secs)} /></span>
          </div>
        ))}
        {p.neutral_s > 0 && (
          <Alert id="recap-possession-neutral" role="status" style={{ font: F.mono(500, 11), letterSpacing: '.1em' }}>
            NEUTRAL {fmtDuration(p.neutral_s)}: NOBODY HELD THE POINT (A HILL BROADCASTS TEAM 2 WHEN UNOWNED)
          </Alert>
        )}
        {/* F221: a coverage caveat about the MEASUREMENT, not a fault in the match — NEUTRAL, whatever
            `thin` says, though it used to render amber under 75%. */}
        <Alert id="recap-possession-thin" role="status" style={{ font: F.mono(500, 11), letterSpacing: '.08em', lineHeight: 1.5 }}>
          BEST COVERAGE {fmtDuration(p.observed_s)}{p.of_s ? ` OF ${fmtDuration(p.of_s)}` : ''}: A HILL IS ONLY SEEN BY A GUN IN BEACON RANGE, SO THIS IS A FLOOR, NOT A FULL ACCOUNT.
        </Alert>
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
            {/* F221: a station that never heard from anyone is AMBER (fix before the next match — a
                field item may be dead); a station that reported is NOT-ALERT, T.ok, no glyph. */}
            {r.kind === 'respawn' && (
              <span style={{ font: F.mono(600, 11), letterSpacing: '.06em', color: r.revives == null ? colourOf('recap-station-never-heard') : T.ok }}>
                {r.revives == null ? glyphed('amber', 'NEVER HEARD FROM: CHECK THE STATION ON SITE.') : `${r.revives} REVIVE${r.revives === 1 ? '' : 'S'}`}
              </span>
            )}
            {r.kind === 'control' && (
              <span style={{ font: F.mono(600, 11), letterSpacing: '.06em', color: r.owner == null ? colourOf('recap-station-never-heard') : T.ok }}>
                {r.owner == null ? glyphed('amber', 'NEVER HEARD FROM: CHECK THE STATION ON SITE.') : `HELD BY ${r.owner === 255 ? 'NOBODY' : (STATION_TID_NAME[r.owner] ?? r.owner)}`}
                {r.hold_ms && Object.keys(r.hold_ms).length > 0 && ' · ' + Object.entries(r.hold_ms).map(([tid, ms]) => `${STATION_TID_NAME[Number(tid)] ?? tid} ${Math.round(ms / 1000)}s`).join(' · ')}
              </span>
            )}
            {(r.kind === 'extraction' || r.kind === 'powerup' || r.kind === 'bomb') && (
              // F105 (review 2026-09-11): these three kinds have no count of their own -- `heard` is the
              // only thing distinguishing a silent station from a reporting one; without this branch both
              // looked identical (neither rendered anything at all).
              <span style={{ font: F.mono(600, 11), letterSpacing: '.06em', color: r.heard ? T.ok : colourOf('recap-station-never-heard') }}>
                {r.heard ? 'REPORTED' : glyphed('amber', 'NEVER HEARD FROM: CHECK THE STATION ON SITE.')}
              </span>
            )}
            {/* F401: a HELD station can end a timed match on its own clock while out of Wi-Fi range, so
                MC gets its result only once it is brought back. Only for a row that DID report (`heard`):
                a station that never heard from anyone at all already carries its own, stronger alert
                above, and showing both would say the same thing twice. Absent `synced` (an older MC, or
                a match still live) renders nothing. */}
            {r.heard && r.synced === false && (
              <Alert id="recap-station-not-synced" role="status" style={{ font: F.mono(600, 11), letterSpacing: '.06em' }}>
                {STATION_KIND_LABEL[r.kind] ?? r.kind} {r.id} NEEDS SYNC: BRING IT INTO WI-FI
              </Alert>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
