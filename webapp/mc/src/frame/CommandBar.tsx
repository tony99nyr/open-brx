import { useState } from 'react';
import type { Phase } from '../api/types';
import { useStore, type View } from '../store';
import { clearNotice, useNotice } from '../notice';
import { F, T } from '../tokens';
import { HazardButton, GhostButton, PrimaryButton } from '../ui';

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
  const offline = !mock && !connected && !authRequired;   // the token prompt owns the copy while auth is pending
  const cur = viewIdx(view);

  return (
    <header style={{ background: T.inset, borderBottom: `1px solid ${T.line2}` }}>
      {offline && (
        <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', background: 'rgba(255,82,82,.12)', borderBottom: `1px solid ${T.bad}`, font: F.chk(700, 12), letterSpacing: '.22em', color: T.bad }}>
          <span style={{ width: 8, height: 8, background: T.bad, animation: 'linkBlink 1.2s infinite' }} />
          MC OFFLINE — RECONNECTING
          <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.dim }}>{state ? 'SHOWING THE LAST SNAPSHOT — CLOCKS ARE FROZEN' : 'NO SNAPSHOT YET — IS THE SERVER RUNNING?'}</span>
        </div>
      )}
      {serverOld && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', background: 'rgba(255,176,32,.12)', borderBottom: `1px solid ${T.warn}`, font: F.chk(700, 12), letterSpacing: '.14em', color: T.warn }}>
          ▲ THE MC SERVER PREDATES THIS UI — RESTART IT (<span style={{ font: F.mono(600, 11), letterSpacing: '.06em' }}>python -m brx_mcp.mc</span>)
          <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.dim }}>SAVED GAMES, PERKS AND LOADOUT RULES ARE UNAVAILABLE UNTIL THEN</span>
        </div>
      )}
      {/* A28: a tunnel that dies mid-match is invisible past the ARMORY screen unless it rides in the
          shared frame — every screen reads this, not just the one with the TURN ON/OFF control. The
          ▲ glyph carries the same meaning as the colour, so this still reads on a colour-blind or
          greyscale screen (never colour-only). */}
      {state?.lan.public?.status === 'error' && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', background: 'rgba(255,82,82,.12)', borderBottom: `1px solid ${T.bad}`, font: F.chk(700, 12), letterSpacing: '.14em', color: T.bad }}>
          ▲ INTERNET TUNNEL DOWN — PHONES FELL BACK TO WI-FI
          <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.dim }}>{state.lan.public.error || 'no reason given by the tunnel process'}</span>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 26px', padding: '12px 20px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 230 }}>
          <div style={{ width: 26, height: 26, background: T.acc, clipPath: 'polygon(0 0,100% 0,100% 65%,65% 100%,0 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: F.chk(700, 12), color: T.accInk }}>B</div>
          <div>
            <div style={{ font: F.chk(700, 11), letterSpacing: '.34em', color: T.acc }}>OPEN BRX</div>
            <div style={{ font: F.osw(600, 18), letterSpacing: '.12em' }}>MISSION CONTROL</div>
          </div>
        </div>
        <nav style={{ display: 'flex', gap: 2, flexWrap: 'wrap', flex: 1, minWidth: 340 }}>
          {PH.map(([id, label], i) => {
            const active = i === cur;
            return (
              <button key={id} onClick={() => setView(
                id === 'lobby' && state?.phase === 'armed' ? 'armed'
                  : id === 'live' && (state?.phase === 'recap' || (!state?.live && state?.recap)) ? 'recap'
                  : id)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, fontFamily: "'Chakra Petch'", background: active ? '#0c1420' : 'transparent',
                  border: 'none', borderBottom: `2px solid ${active ? T.acc : 'transparent'}`, padding: '8px 16px 7px', cursor: 'pointer', color: active ? T.ink : T.dim, minHeight: 44 }}>
                <span style={{ font: F.mono(600, 9), letterSpacing: '.2em', color: active ? T.acc : 'rgba(92,113,134,.7)' }}>0{i + 1}</span>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.22em' }}>{label}{id === 'build' && view === 'designer' ? <span style={{ color: T.acc }}> ▸ DESIGNER</span> : ''}</span>
              </button>
            );
          })}
        </nav>
        {/* THE TOASTS, in a row of their own. They used to share the nowrap row below with the phase
            tag, NEW MATCH and the menu, so at 393px a notice took the width and squeezed
            "NEW MATCH ▸" onto three lines — a 72px button, measured (round-2 review 2026-09-12).
            `.cb-notices` keeps them inline on a desk and gives them a full-width row under the bar on
            a phone; the controls beside them wrap rather than compress. */}
        <div className="cb-notices">
          {/* an action that failed must still say so somewhere immediate */}
          {error && (
            // This was one `nowrap` line clipped at 420px with `title="dismiss"`, so the server's most
            // useful refusals were unreadable: a rejected `station_source` answers with the whole legal
            // vocabulary (~250 chars) and the operator saw "▲ station_source must be null or one of: gre…"
            // — a message that names the valid values, with the valid values cut off. It wraps now (up to
            // four lines, then scrolls) and carries the full text as its tooltip.
            <button type="button" role="alert" onClick={clearError} title={error}
              style={{ background: 'rgba(255,82,82,.12)', border: `1px solid ${T.bad}`, color: T.bad,
                       font: F.chk(600, 12), lineHeight: 1.35, padding: '6px 12px', cursor: 'pointer',
                       maxWidth: 520, textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere',
                       maxHeight: '8em', overflowY: 'auto' }}>▲ {error} ✕</button>
          )}
          {notice && (
            <button type="button" onClick={clearNotice} title="dismiss"
              style={{ background: notice.bad ? 'rgba(255,82,82,.12)' : 'transparent', border: `1px solid ${notice.bad ? T.bad : T.line2}`,
                       color: notice.bad ? T.bad : T.dim, font: F.chk(600, 12), padding: '6px 12px', cursor: 'pointer' }}>
              {notice.bad ? '▲ ' : ''}{notice.text} ✕
            </button>
          )}
          {panicked && (
            <button type="button" onClick={() => setPanicked(null)} title="dismiss"
              style={{ background: 'rgba(255,82,82,.12)', border: `1px solid ${T.bad}`, color: T.bad, font: F.chk(600, 12), padding: '6px 12px', cursor: 'pointer' }}>▲ {panicked} ✕</button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          {/* Auth is the one thing that must stay in the header: nothing works without it. */}
          {authRequired && <button type="button" onClick={() => setView('debug')}
            style={{ background: 'transparent', border: `1px solid ${T.warn}`, color: T.warn, font: F.chk(700, 12), padding: '7px 12px', cursor: 'pointer', minHeight: 40 }}>
            Operator token needed ▸</button>}

          <span style={{ font: F.chk(700, 12), letterSpacing: '.16em',
                         color: state?.phase === 'live' ? T.bad : state?.phase === 'armed' ? T.warn : state?.phase === 'recap' ? T.ok : T.dim }}>
            {state?.phase === 'live' ? '● LIVE' : state?.phase === 'armed' ? '▲ ARMED' : state?.phase === 'recap' ? '■ MATCH OVER' : '◇ SETUP'}
          </span>
          {state?.phase === 'recap' && (
            <PrimaryButton size={12} onClick={async () => { const ok = await run(() => api.newSession(true)); if (ok !== undefined) setView('muster'); }}>NEW MATCH ▸</PrimaryButton>
          )}

          {/* One button instead of a red hazard control and a wall of telemetry (Tony, 2026-09-02):
              "the header should be cleaner and simpler. less intimidating and less confusing." */}
          <div style={{ position: 'relative' }}>
            <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)} title="Menu"
              style={{ background: menu ? T.panelAlt : 'transparent', border: `1px solid ${T.line2}`, color: T.dim,
                       font: F.osw(700, 18), padding: '6px 14px', cursor: 'pointer', minHeight: 44, minWidth: 48 }}>☰</button>
            {menu && (
              <div role="menu" onMouseLeave={() => setMenu(false)}
                style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, minWidth: 230,
                         background: T.page, border: `1px solid ${T.line2}`, display: 'flex', flexDirection: 'column' }}>
                <MenuItem onClick={() => { setView('catalog'); setMenu(false); }} label="Arsenal" hint="Every weapon and its real stats" />
                <MenuItem onClick={() => { setView('debug'); setMenu(false); }} label="Debug" hint="Network, nodes, config, session" />
                <div style={{ borderTop: `1px solid ${T.line}` }} />
                {panic ? (
                  <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ font: F.chk(600, 12), color: T.bad, lineHeight: 1.4 }}>Safe every node in range? This clears and stops every gun.</span>
                    <span style={{ display: 'flex', gap: 8 }}>
                      <HazardButton size={11} onClick={async () => { setPanic(false); setMenu(false); const r = await run(() => api.control('panic', true)); setPanicked(r ? `FLEET SAFED (${new Date().toLocaleTimeString()})` : 'PANIC FAILED — CHECK THE SERVER'); }}>CONFIRM</HazardButton>
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
