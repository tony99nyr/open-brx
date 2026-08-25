import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Phase } from '../api/types';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { HazardButton, GhostButton } from '../ui';

const PH: [Phase, string][] = [['muster', 'ARMORY'], ['build', 'BUILD'], ['kit', 'KIT'], ['lobby', 'LOBBY'], ['live', 'LIVE'], ['recap', 'RECAP']];
const viewIdx = (p: Phase) => (p === 'armed' ? 3 : PH.findIndex(x => x[0] === p));

export function CommandBar() {
  const { state, view, setView, run, api, error, clearError, mock } = useStore();
  const [panic, setPanic] = useState(false);
  const cur = viewIdx(view);
  const linked = state?.nodes.filter(n => n.last_seen_ms < 8000).length ?? 0;
  const sync = state?.nodes.length ? (state.nodes.every(n => n.synced) ? 'OK' : 'PARTIAL') : '—';

  return (
    <header style={{ background: T.inset, borderBottom: `1px solid ${T.line2}` }}>
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
          {panic ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: T.bad }}>FLEET-WIDE SAFE ($CLEAR → $SP,99) ON EVERY NODE IN RANGE?</span>
              <HazardButton size={11} onClick={() => { setPanic(false); run(() => api.control('panic', true)); }}>CONFIRM PANIC</HazardButton>
              <GhostButton onClick={() => setPanic(false)}>CANCEL</GhostButton>
            </span>
          ) : (
            <HazardButton onClick={() => setPanic(true)} title="Fleet-wide safe sequence (confirm step)">PANIC</HazardButton>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 30px', padding: '6px 20px', background: T.panelAlt, borderTop: `1px solid ${T.slot}`, font: F.mono(500, 10), letterSpacing: '.16em', color: T.micro, alignItems: 'center' }}>
        <span>NET ▸ <span style={{ color: T.dim }}>{state?.lan.ssid ?? state?.lan.mode?.toUpperCase() ?? '—'}</span> · <span style={{ color: linked ? T.ok : T.warn }}>{linked} NODES LINKED</span></span>
        <span>PHASE ▸ <span style={{ color: T.dim }}>0{cur + 1}/06 {PH[cur][1]}{state?.phase === 'armed' && view === 'armed' ? ' · ARMED' : ''}</span></span>
        <span>UPLINK ▸ <span style={{ color: state ? T.ok : T.bad }}>{state ? 'OK' : 'NO SERVER'}</span> · SYNC {sync}</span>
        <JoinQr />
        {error && <span onClick={clearError} style={{ color: T.bad, cursor: 'pointer' }} title="dismiss">▲ {error.toUpperCase()}</span>}
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
      <span className="hov-acc-ink" style={{ cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>JOIN ▸ <span style={{ color: T.dim }}>{state?.lan.ws_url}</span> ▦</span>
      {open && url && (
        <span style={{ position: 'absolute', top: 22, left: 0, zIndex: 20, background: T.page, border: `1px solid ${T.acc}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <img src={url} width={220} height={220} alt="join QR" style={{ display: 'block' }} />
          <span style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.dim }}>SCAN ON THE NODE — {state?.lan.ws_url}</span>
        </span>
      )}
    </span>
  );
}
