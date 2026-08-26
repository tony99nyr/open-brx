import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Phase } from '../api/types';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { HazardButton, GhostButton } from '../ui';

const PH: [Phase, string][] = [['muster', 'ARMORY'], ['build', 'BUILD'], ['kit', 'KIT'], ['lobby', 'LOBBY'], ['live', 'LIVE'], ['recap', 'RECAP']];
const viewIdx = (p: Phase) => (p === 'armed' ? 3 : PH.findIndex(x => x[0] === p));

export function CommandBar() {
  const { state, view, setView, run, api, error, clearError, mock, connected, authRequired, hasToken, setToken } = useStore();
  const [panic, setPanic] = useState(false);
  const [panicked, setPanicked] = useState<string | null>(null);
  const [tokDraft, setTokDraft] = useState('');
  const offline = !mock && !connected && !authRequired;   // the token prompt owns the copy while auth is pending
  const cur = viewIdx(view);
  const linked = state?.nodes.filter(n => n.last_seen_ms < 8000).length ?? 0;
  const sync = state?.nodes.length ? (state.nodes.every(n => n.synced) ? 'OK' : 'PARTIAL') : '—';

  return (
    <header style={{ background: T.inset, borderBottom: `1px solid ${T.line2}` }}>
      {offline && (
        <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px', background: 'rgba(255,82,82,.12)', borderBottom: `1px solid ${T.bad}`, font: F.chk(700, 12), letterSpacing: '.22em', color: T.bad }}>
          <span style={{ width: 8, height: 8, background: T.bad, animation: 'linkBlink 1.2s infinite' }} />
          MC OFFLINE — RECONNECTING
          <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.dim }}>{state ? 'SHOWING THE LAST SNAPSHOT — CLOCKS ARE FROZEN' : 'NO SNAPSHOT YET — IS THE SERVER RUNNING?'}</span>
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
              <button key={id} onClick={() => setView(id === 'lobby' && state?.phase === 'armed' ? 'armed' : id)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, fontFamily: "'Chakra Petch'", background: active ? '#0c1420' : 'transparent',
                  border: 'none', borderBottom: `2px solid ${active ? T.acc : 'transparent'}`, padding: '8px 16px 7px', cursor: 'pointer', color: active ? T.ink : T.dim, minHeight: 44 }}>
                <span style={{ font: F.mono(600, 9), letterSpacing: '.2em', color: active ? T.acc : 'rgba(92,113,134,.7)' }}>0{i + 1}</span>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.22em' }}>{label}</span>
              </button>
            );
          })}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {panicked && (
            <button type="button" onClick={() => setPanicked(null)} title="dismiss"
              style={{ background: 'rgba(255,82,82,.12)', border: `1px solid ${T.bad}`, color: T.bad, font: F.mono(600, 11), letterSpacing: '.1em', padding: '6px 12px', cursor: 'pointer' }}>▲ {panicked} ✕</button>
          )}
          {panic ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.bad }}>FLEET-WIDE SAFE ($CLEAR → $SP,99) ON EVERY NODE IN RANGE?</span>
              <HazardButton size={11} onClick={async () => { setPanic(false); const r = await run(() => api.control('panic', true)); setPanicked(r ? `FLEET SAFED — $CLEAR→$SP,99 SENT TO EVERY NODE IN RANGE (${new Date().toLocaleTimeString()})` : 'PANIC FAILED — CHECK THE SERVER'); }}>CONFIRM PANIC</HazardButton>
              <GhostButton onClick={() => setPanic(false)}>CANCEL</GhostButton>
            </span>
          ) : (
            <HazardButton onClick={() => setPanic(true)} title="Fleet-wide safe sequence (confirm step)">PANIC</HazardButton>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 30px', padding: '6px 20px', background: T.panelAlt, borderTop: `1px solid ${T.slot}`, font: F.mono(500, 11.5), letterSpacing: '.12em', color: T.dim, alignItems: 'center' }}>
        <span>NET ▸ <span style={{ color: T.dim }}>{state?.lan.ssid ?? state?.lan.mode?.toUpperCase() ?? '—'}</span> · <span style={{ color: linked ? T.ok : T.warn }}>{linked} NODES LINKED</span></span>
        <span>PHASE ▸ <span style={{ color: T.dim }}>0{cur + 1}/06 {PH[cur][1]}{state?.phase === 'armed' && view === 'armed' ? ' · ARMED' : ''}</span></span>
        <span>UPLINK ▸ <span style={{ color: offline ? T.bad : state ? T.ok : T.bad }}>{offline ? 'DOWN' : state ? 'OK' : 'NO SERVER'}</span> · SYNC {sync}</span>
        <JoinQr />
        {error && <button type="button" role="alert" onClick={clearError} style={{ background: 'transparent', border: 'none', font: 'inherit', letterSpacing: 'inherit', color: T.bad, cursor: 'pointer', padding: 0, minHeight: 44 }} title="dismiss">▲ {error.toUpperCase()}</button>}
        {(authRequired || (!mock && state?.lan.auth_required !== false && !hasToken)) && (
          <form onSubmit={e => { e.preventDefault(); if (tokDraft.trim()) { setToken(tokDraft); setTokDraft(''); } }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.warn }}>
            <span role="alert"><label htmlFor="mc-tok">▲ {authRequired ? 'OPERATOR TOKEN REQUIRED' : 'OPERATOR TOKEN'}</label></span>
            <input id="mc-tok" className="textbox" value={tokDraft} onChange={e => setTokDraft(e.target.value)} placeholder="paste from the MC console"
              autoComplete="off" spellCheck={false} style={{ width: '14ch', borderBottom: `1px solid ${T.warn}`, color: T.ink, minHeight: 32 }} />
            <button type="submit" style={{ background: T.warn, color: T.accInk, border: 'none', font: F.chk(700, 10), letterSpacing: '.16em', padding: '6px 10px', cursor: 'pointer', minHeight: 32 }}>APPLY</button>
          </form>
        )}
        <span style={{ marginLeft: 'auto' }}>{mock ? 'MOCK // ' : ''}SESSION {state?.session_id?.slice(-6).toUpperCase() ?? '——'} // T {state ? new Date(state.t).toLocaleTimeString([], { hour12: false }) : '——:——:——'}</span>
      </div>
    </header>
  );
}

/** Small QR of the node join URL (state.lan.qr) so phones can scan to join. */
function JoinQr() {
  const { state } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const qr = state?.lan.qr;
  useEffect(() => {
    if (!qr) return;
    QRCode.toDataURL(qr, { margin: 0, width: 220, color: { dark: '#e8eef5', light: '#07090d' } }).then(setUrl).catch(() => setUrl(null));
  }, [qr]);
  if (!qr) return null;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className="hov-acc-ink" aria-expanded={open} onClick={() => setOpen(o => !o)} style={{ background: 'transparent', border: 'none', font: 'inherit', letterSpacing: 'inherit', color: 'inherit', cursor: 'pointer', padding: 0, minHeight: 44 }}>JOIN ▸ <span style={{ color: T.dim }}>{state?.lan.ws_url}</span> ▦</button>
      {open && url && (
        <span style={{ position: 'absolute', top: 22, left: 0, zIndex: 20, background: T.page, border: `1px solid ${T.acc}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <img src={url} width={220} height={220} alt="join QR" style={{ display: 'block' }} />
          <span style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.dim }}>SCAN ON THE NODE — {state?.lan.ws_url}</span>
        </span>
      )}
    </span>
  );
}
