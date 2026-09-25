// UNROSTERED PHONES (2026-09-13, A39). Field 2026-09-12: "4 guns connected, only 2 in lobby" — a
// connected companion phone with a gun set that nobody on the roster had claimed was invisible
// everywhere but ARMORY, where the claim card actually lives. KIT and LOBBY are where the operator is
// looking while building the roster, so this is the call-to-action on both of them: one line, the
// server's own count (`readiness.unrostered_phones`, mirrors ARMORY's own claim-card matcher), a tap
// straight to the fix. Absent on a server that predates the field (`unrostered_phones` undefined) —
// the console never invents a count of its own.
import { useStore } from '../store';
import { F } from '../tokens';
import { GLYPH, colourOf } from '../alerts';

export function UnrosteredPhonesBanner({ style }: { style?: React.CSSProperties }) {
  const { state, setView } = useStore();
  const n = state?.readiness?.unrostered_phones ?? 0;
  if (!n) return null;
  const sev = colourOf('frame-unrostered-phones');
  return (
    <button type="button" data-unrostered-phones={n} className="hov-acc-ink hit44" onClick={() => setView('muster')}
      title="Connected phones with a gun set that nobody on the roster has claimed yet: pick them up on ARMORY"
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxSizing: 'border-box', textAlign: 'left',
               background: 'rgba(255,193,7,.08)', border: `1px solid ${sev}`, borderLeft: `3px solid ${sev}`,
               padding: '10px 14px', cursor: 'pointer', font: F.chk(700, 12), letterSpacing: '.06em', lineHeight: 1.5, color: sev, minHeight: 44, ...style }}>
      {GLYPH} {n} CONNECTED PHONE{n === 1 ? '' : 'S'} NOT IN THE ROSTER: CLAIM {n === 1 ? 'IT' : 'THEM'} ON ARMORY ▸
    </button>
  );
}
