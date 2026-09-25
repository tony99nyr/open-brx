import { useEffect, useRef, useState } from 'react';
import type { Phase } from '../api/types';
import { useStore, type View } from '../store';
import { clearNotice, useNotice } from '../notice';
import { F, T } from '../tokens';
import { HazardButton, GhostButton, InfoIcon } from '../ui';
import { ReportPanel } from '../ui/ReportPanel';
import { panicReceipt, splitWarning } from './frameText';
import { MC_OFFLINE, MC_OLDER, MC_RESTART_CMD, OPERATOR_TOKEN, alertWords, colourOf, glyphed, operatorTokenLine } from '../alerts';

// LIVE and RECAP are one tab. Tony, 2026-09-02: "one or the other is useful at a time, there is a lot
// of overlap" — a match is either running or finished, never both, and the two screens shared their
// whole scoreboard. The VIEWS stay separate (the store still follows the phase into `recap` on its
// own); only the nav collapses, and MATCH lands you on whichever one is real right now.
const PH: [Phase, string][] = [['muster', 'ARMORY'], ['build', 'GAMES'], ['kit', 'KIT'], ['lobby', 'LOBBY'], ['live', 'MATCH']];
const viewIdx = (p: View) => (p === 'armed' ? 3 : p === 'designer' ? 1 : p === 'recap' ? 4 : PH.findIndex(x => x[0] === p));
// Views that are not phases need their own label: viewIdx() returns -1 for them, and `PH[-1][1]`
// threw, blanking the whole console (the WEAPONS tab rendered a black page, 2026-08-31).

export function CommandBar() {
  const notice = useNotice();   // survives the screen that raised it (see notice.ts)
  const [menu, setMenu] = useState(false);
  const { state, view, setView, run, api, error, clearError, mock, connected, authRequired, serverOld } = useStore();
  const [panic, setPanic] = useState(false);
  const [panicked, setPanicked] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const offline = !mock && !connected && !authRequired;   // the token prompt owns the copy while auth is pending
  const cur = viewIdx(view);
  const [lanDetails, setLanDetails] = useState(false);

  // H6: a notice belongs to the stretch of the session that raised it. "MATCH ENDED · REACHED 8 OF 8
  // NODES" has to outlive the unmount of LIVE (that is why notice.ts exists), but not the whole next
  // match: it sat beside ● LIVE in the following game. So the notice remembers the phase it was
  // raised in, and a match arming or going live clears it unless it was raised in the phase just left
  // (LOBBY's own notice survives the move to ARMED; an adopted match's RESUMED survives BUILD → LIVE).
  // A notice from a finished match (raised in LIVE or RECAP) never carries into a new one.
  const phase = state?.phase;
  const noticePhase = useRef<string | undefined>(undefined);
  const prevPhase = useRef<string | undefined>(phase);
  // `prevPhase` is still the OLD phase here when the notice and the phase change in one render, so a
  // notice raised by the very press that moved the phase counts as raised before the move.
  useEffect(() => { noticePhase.current = notice ? prevPhase.current : undefined; }, [notice]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === undefined || prev === phase || (phase !== 'armed' && phase !== 'live')) return;
    setPanicked(null);   // a PANIC receipt is about the guns before they were re-armed
    const raised = noticePhase.current;
    if (notice && (raised !== prev || raised === 'live' || raised === 'recap')) clearNotice();
  }, [phase]);   // eslint-disable-line react-hooks/exhaustive-deps

  // M13: "PHONES FELL BACK TO WI-FI" is only true of a tunnel that was up. The server's `lan.public`
  // carries no history, so this tab remembers whether it has seen the tunnel UP; without that, the
  // banner says what is true either way.
  const [tunnelSeenUp, setTunnelSeenUp] = useState(false);
  if (state?.lan.public?.status === 'up' && !tunnelSeenUp) setTunnelSeenUp(true);   // React's "store information from previous renders" pattern

  return (
    <header style={{ background: T.inset, borderBottom: `1px solid ${T.line2}` }}>
      {offline && (
        <div role="status" aria-live="polite" data-alert="frame-mc-offline" data-sev="red"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', background: 'rgba(255,82,82,.12)', borderBottom: `1px solid ${colourOf('frame-mc-offline')}`, font: F.chk(700, 12), letterSpacing: '.22em', color: colourOf('frame-mc-offline') }}>
          <span style={{ width: 8, height: 8, background: colourOf('frame-mc-offline'), animation: 'linkBlink 1.2s infinite' }} />
          {glyphed('red', MC_OFFLINE.what)}
          <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.dim }}>{state ? MC_OFFLINE.act.toUpperCase() : 'NO SNAPSHOT YET: IS THE SERVER RUNNING?'}</span>
        </div>
      )}
      {serverOld && (
        <div role="alert" data-alert="frame-server-old" data-sev="amber"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', font: F.chk(700, 12), letterSpacing: '.14em', color: colourOf('frame-server-old') }}>
          {glyphed('amber', alertWords(MC_OLDER.what, MC_OLDER.act))} (<code style={{ font: F.mono(600, 11), letterSpacing: '.06em' }}>{MC_RESTART_CMD}</code>)
          <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.dim }}>SAVED GAMES, PERKS AND LOADOUT RULES ARE UNAVAILABLE UNTIL THEN</span>
        </div>
      )}
      {/* A28: a tunnel that dies mid-match is invisible past the ARMORY screen unless it rides in the
          shared frame — every screen reads this, not just the one with the TURN ON/OFF control. The
          ▲ glyph carries the same meaning as the colour, so this still reads on a colour-blind or
          greyscale screen (never colour-only). */}
      {state?.lan.public?.status === 'error' && (
        <div role="alert" data-alert="frame-tunnel-down" data-sev="red"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', background: 'rgba(255,82,82,.12)', borderBottom: `1px solid ${colourOf('frame-tunnel-down')}`, font: F.chk(700, 12), letterSpacing: '.14em', color: colourOf('frame-tunnel-down') }}>
          {glyphed('red', alertWords('INTERNET TUNNEL DOWN', tunnelSeenUp ? 'PHONES FELL BACK TO WI-FI' : 'NOT RUNNING, SO PHONES CAN JOIN OVER WI-FI ONLY'))}
          <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.dim }}>{state.lan.public.error || 'no reason given by the tunnel process'}</span>
        </div>
      )}
      {/* T3-A (field 2026-09-12): MC advertised a WSL2 NAT address in the QR/mDNS, so every phone
          failed to connect and the console never said why -- it looked like the phones were broken.
          Same shared-frame reasoning as the tunnel banner above: every screen (including LOBBY's
          readiness board) reads this, not just the one screen with a network control on it.
          F191 (Tony 2026-09-23): it stands for the whole session on a WSL host, so it goes LAST: a real alert
          above it always wins the operator's eye, and it never replaces one. */}
      {/* M10 (visual QA 2026-09-23): it was a 3-5 line red role=alert on every screen, all session. It is
          advice about the address MC advertises, not an alarm, so it is one neutral line (a status, not
          an alert) with the how-to behind DETAILS. It is never dismissable: the address stays wrong until
          the operator fixes it. */}
      {state?.lan.warning && (() => {
        const { head, rest } = splitWarning(state.lan.warning);
        return (
          <div role="status" data-testid="lan-warning" data-alert="frame-lan-warning-head" data-sev="neutral"
            style={{ background: T.panelAlt, borderBottom: `1px solid ${T.line2}`, padding: '5px 20px', color: colourOf('frame-lan-warning-head') }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 28 }}>
              <InfoIcon size={14} color={T.acc} />
              <span style={{ font: F.chk(700, 11), letterSpacing: '.14em', color: colourOf('frame-lan-warning-head'), flex: '0 1 auto', minWidth: 0 }}>{head}</span>
              {rest && (
                <button type="button" aria-expanded={lanDetails} aria-controls="lan-warning-details" onClick={() => setLanDetails(v => !v)}
                  className="hov-acc"
                  style={{ background: 'transparent', border: `1px solid ${T.line2}`, color: T.dim, font: F.chk(700, 11), letterSpacing: '.16em', padding: '4px 10px', minHeight: 28, cursor: 'pointer', flexShrink: 0 }}>
                  {lanDetails ? 'HIDE ▴' : 'HOW TO FIX ▾'}
                </button>
              )}
            </div>
            {rest && lanDetails && (
              <div id="lan-warning-details" data-alert="frame-lan-warning-details" data-sev="neutral"
                style={{ font: F.mono(500, 11), lineHeight: 1.6, letterSpacing: '.02em', color: colourOf('frame-lan-warning-details'), padding: '4px 0 6px 24px', overflowWrap: 'anywhere' }}>{rest}</div>
            )}
          </div>
        );
      })()}
      {/* M9 (visual QA 2026-09-23): the bar wrapped to three rows at 900 px, and at 1440 px an error
          squeezed in between the tabs and the menu. `.cb-row` holds one row from 900 px up by folding
          the less important parts (the brand words, the tab padding, the long token label; see
          styles.css), and the toasts and errors have a strip of their own under it. */}
      <div className="cb-row">
        <div className="cb-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 26, height: 26, background: T.acc, clipPath: 'polygon(0 0,100% 0,100% 65%,65% 100%,0 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: F.chk(700, 12), color: T.accInk }}>B</div>
          <div className="cb-brand-text">
            <div style={{ font: F.chk(700, 11), letterSpacing: '.34em', color: T.acc }}>OPEN BRX</div>
            <div style={{ font: F.osw(600, 18), letterSpacing: '.12em' }}>MISSION CONTROL</div>
          </div>
        </div>
        <nav className="cb-nav" style={{ display: 'flex', gap: 2, flex: 1 }}>
          {PH.map(([id, label], i) => {
            const active = i === cur;
            return (
              <button key={id} className="cb-tab" onClick={() => setView(
                id === 'lobby' && state?.phase === 'armed' ? 'armed'
                  : id === 'live' && (state?.phase === 'recap' || (!state?.live && state?.recap)) ? 'recap'
                  : id)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, fontFamily: "'Chakra Petch'", background: active ? '#0c1420' : 'transparent',
                  border: 'none', borderBottom: `2px solid ${active ? T.acc : 'transparent'}`, cursor: 'pointer', color: active ? T.ink : T.dim, minHeight: 44, whiteSpace: 'nowrap' }}>
                {/* F318: the step digit is decorative (the label beside it carries the meaning), so 9 px stays and readers skip it. */}
                <span aria-hidden="true" style={{ font: F.mono(600, 9), letterSpacing: '.2em', color: active ? T.acc : 'rgba(92,113,134,.7)' }}>0{i + 1}</span>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.22em' }}>{label}{id === 'build' && view === 'designer' ? <span style={{ color: T.acc }}> ▸ DESIGNER</span> : ''}
                  {/* Bench 2026-09-17: phones are in a match this MC did not start. Only while that is true. */}
                  {id === 'live' && state?.orphan_match && (
                    <span data-testid="match-tab-dot" data-alert="frame-match-tab-dot" data-sev="amber" role="img"
                      aria-label="phones are in a match this MC did not start: open MATCH" title="Phones are in a match this MC did not start: open MATCH"
                      style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colourOf('frame-match-tab-dot'), marginLeft: 8, verticalAlign: 'middle' }} />
                  )}</span>
              </button>
            );
          })}
        </nav>
        <div className="cb-right" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          {/* Auth is the one thing that must stay in the header: nothing works without it (F221: NEUTRAL
              per Tony's rule — a prompt, not a fault; a short "TOKEN ▸" stays as a control label). */}
          {authRequired && <button type="button" onClick={() => setView('debug')}
            data-alert="frame-token-required-app" data-sev="neutral"
            aria-label={operatorTokenLine()}
            style={{ background: 'transparent', border: `1px solid ${T.line2}`, color: colourOf('frame-token-required-app'), font: F.chk(700, 12), padding: '7px 12px', cursor: 'pointer', minHeight: 40, whiteSpace: 'nowrap' }}>
            <span className="cb-long">{OPERATOR_TOKEN.what} ▸</span><span className="cb-short">TOKEN ▸</span></button>}

          {/* F318: offline, the phase is the LAST SNAPSHOT's, not a fact. A red ● LIVE beside MC OFFLINE
              read as "the match is live and fine", so the chip goes grey and says it is the last known.
              F221 round 2: ARMED used ▲ in T.warn, the glyph and colour every amber ALERT uses, on a
              plain phase readout. A phase is NOT-ALERT (data, never T.warn/T.bad): ◆ is its own glyph,
              shared with no alert, in T.ink. */}
          <span data-testid="phase-chip" title={offline ? 'MC is offline: this is the phase in the last snapshot' : undefined}
                style={{ font: F.chk(700, 12), letterSpacing: '.16em', whiteSpace: 'nowrap',
                         color: offline ? T.dim : state?.phase === 'live' ? T.bad : state?.phase === 'armed' ? T.ink : state?.phase === 'recap' ? T.ok : T.dim }}>
            {offline && state ? 'LAST KNOWN: ' : ''}
            {state?.phase === 'live' ? (offline ? '○ LIVE' : '● LIVE') : state?.phase === 'armed' ? '◆ ARMED' : state?.phase === 'recap' ? '■ MATCH OVER' : '◇ SETUP'}
          </span>
          {/* `--bench-volume N`: every gun plays at N, not the venue level. Say it where nobody can miss it. */}
          {state?.bench_volume != null && (
            <span data-testid="bench-volume" data-alert="frame-bench-vol" data-sev="neutral"
              title={`MC was started with --bench-volume ${state.bench_volume}: every gun plays at ${state.bench_volume}, not the venue level. Not for a real game.`}
              style={{ font: F.chk(700, 12), letterSpacing: '.16em', color: colourOf('frame-bench-vol'), border: `1px solid ${T.line2}`, padding: '5px 10px', whiteSpace: 'nowrap' }}>
              BENCH VOL {state.bench_volume}
            </span>
          )}

          {/* One button instead of a red hazard control and a wall of telemetry (Tony, 2026-09-02):
              "the header should be cleaner and simpler. less intimidating and less confusing." */}
          <div style={{ position: 'relative' }}>
            <button ref={menuBtnRef} type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)} title="Menu" aria-label="Menu"
              style={{ background: menu ? T.panelAlt : 'transparent', border: `1px solid ${T.line2}`, color: T.dim,
                       font: F.osw(700, 18), padding: '6px 14px', cursor: 'pointer', minHeight: 44, minWidth: 48 }}>☰</button>
            {menu && (
              <div role="menu" onMouseLeave={() => setMenu(false)}
                style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, minWidth: 230,
                         background: T.page, border: `1px solid ${T.line2}`, display: 'flex', flexDirection: 'column' }}>
                <MenuItem onClick={() => { setView('catalog'); setMenu(false); }} label="Arsenal" hint="Every weapon and its real stats" />
                <MenuItem onClick={() => { setView('debug'); setMenu(false); }} label="Debug" hint="Network, nodes, config, session" />
                {/* Reachable in every phase, on purpose: a bug can happen mid-match, and this control
                    lives beside PANIC in the one part of the shell an operator can always reach — even
                    when the SCREEN under it has crashed (App.tsx's error boundary wraps only <main>). */}
                <MenuItem onClick={() => { setReport(true); setMenu(false); }} label="Report a problem" hint="Session evidence, ready for a GitHub issue" />
                <div style={{ borderTop: `1px solid ${T.line}` }} />
                {panic ? (
                  <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ font: F.chk(600, 12), color: T.bad, lineHeight: 1.4 }}>Safe every node in range? This clears and stops every gun.</span>
                    {/* M21 + CLAUDE.md's panic rule: `$CLEAR` leaves a gun with no `$SIR` table, so nothing can hit it until it is re-armed. */}
                    <span data-testid="panic-warning" style={{ font: F.chk(600, 12), color: T.ink, lineHeight: 1.4 }}>Afterwards no gun can be hit until you re-arm it with PUSH CONFIG in LOBBY.</span>
                    <span style={{ display: 'flex', gap: 8 }}>
                      <HazardButton size={11} onClick={async () => { setPanic(false); setMenu(false); const r = await run(() => api.control('panic', true)); setPanicked(panicReceipt(r, new Date()).text); }}>CONFIRM</HazardButton>
                      <GhostButton onClick={() => setPanic(false)}>Cancel</GhostButton>
                    </span>
                  </div>
                ) : (
                  <MenuItem onClick={() => setPanic(true)} label="Panic" hint="Fleet-wide safe — asks first" danger />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
        {/* THE TOASTS AND ERRORS, in a strip of their own under the bar. At 393px a notice once shared a
          nowrap row with the menu and squeezed a primary button onto three lines (round-2 review
          2026-09-12), and at 1440px a long server refusal squeezed in between the tabs and the menu
          (M9, visual QA 2026-09-23). Under the bar they wrap freely and nothing beside them compresses.
          The strip collapses to nothing when it is empty (styles.css). */}
      <div className="cb-notices" data-testid="cb-notices">
        {/* an action that failed must still say so somewhere immediate */}
        {error && !(authRequired && error === operatorTokenLine()) && (() => {
          // This was one `nowrap` line clipped at 420px with `title="dismiss"`, so the server's most
          // useful refusals were unreadable: a rejected `station_source` answers with the whole legal
          // vocabulary (~250 chars) and the operator saw "▲ station_source must be null or one of: gre…"
          // (a message that names the valid values, with the valid values cut off). It wraps now (up to
          // four lines, then scrolls) and carries the full text as its tooltip.
          // F221 round 2: two fixes. (1) an AuthError's words are `operatorTokenLine()` (NEUTRAL), and
          // the header's own token control already shows them: `authRequired` guards this toast so the
          // one fact never shows twice, once neutral and once red. (2) a version-skew 404 (`MC_OLDER`,
          // via `olderServer()`) is AMBER everywhere else on the console: this toast used to force every
          // failure red, including that one. Detected by the message's own words, `frame-server-old`'s.
          const skew = error.startsWith(MC_OLDER.what);
          const id = skew ? 'frame-server-old' : 'frame-error-toast';
          const sev = skew ? 'amber' : 'red';
          const c = colourOf(id);
          return (
            <button type="button" role="alert" onClick={clearError} title={error} data-alert={id} data-sev={sev}
              style={{ background: skew ? 'rgba(255,176,32,.12)' : 'rgba(255,82,82,.12)', border: `1px solid ${c}`, color: c,
                       font: F.chk(600, 12), lineHeight: 1.35, padding: '6px 12px', cursor: 'pointer',
                       maxWidth: 520, textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere',
                       maxHeight: '8em', overflowY: 'auto' }}>{glyphed(sev, error)} ✕</button>
          );
        })()}
        {notice && (
          <button type="button" onClick={clearNotice} title="dismiss" data-alert="frame-notice-toast" data-sev={notice.bad ? 'red' : 'neutral'}
            style={{ background: notice.bad ? 'rgba(255,82,82,.12)' : 'transparent', border: `1px solid ${notice.bad ? T.bad : T.line2}`,
                     color: notice.bad ? T.bad : colourOf('frame-notice-toast'), font: F.chk(600, 12), padding: '6px 12px', cursor: 'pointer' }}>
            {notice.bad ? glyphed('red', notice.text) : notice.text} ✕
          </button>
        )}
        {panicked && (
          <button type="button" onClick={() => setPanicked(null)} title="dismiss" data-alert="frame-panicked-toast" data-sev="red"
            style={{ background: 'rgba(255,82,82,.12)', border: `1px solid ${colourOf('frame-panicked-toast')}`, color: colourOf('frame-panicked-toast'), font: F.chk(600, 12), padding: '6px 12px', cursor: 'pointer' }}>{glyphed('red', panicked)} ✕</button>
        )}
      </div>
      {report && <ReportPanel onClose={() => { setReport(false); menuBtnRef.current?.focus(); }} />}
    </header>
  );
}

function MenuItem({ label, hint, onClick, danger }: { label: string; hint: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="hov-acc"
      style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', padding: '10px 14px',
               display: 'flex', flexDirection: 'column', gap: 2, minHeight: 48 }}>
      <span style={{ font: F.chk(700, 13), color: danger ? T.bad : T.ink }}>{label}</span>
      <span style={{ font: F.chk(500, 11), color: T.micro }}>{hint}</span>
    </button>
  );
}
