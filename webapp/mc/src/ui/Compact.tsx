// F599 console copy rule. Keep fault labels short and put the reason behind a button.
//
//   RED faults    -> FaultPill: an icon and at most about six words in sentence case; the why and the
//                    fix sit behind a tap on "Why?".
//   AMBER lines   -> ItemChip: an icon with a short label ON the item it concerns; the detail sits
//                    behind a tap.
//   NEUTRAL notes -> HelpNote: cut, unless `keep`, and then it sits behind the INFO icon.
import { useState, type ReactNode } from 'react';
import { F, T } from '../tokens';
import { InfoIcon } from './index';
import { sevOf, type Severity } from '../alerts';

// `server-line` is the existing id for uncatalogued MC text. Its severity comes from serverLine().
const pillSeverity = (id: string, dynamicSev?: Severity): Severity => id === 'server-line' && dynamicSev ? dynamicSev : sevOf(id);

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
/** `?gallery=copy:a,b`: the injected states the gallery asks for (see `mock/copyGallery.ts`). */
export const galleryHas = (k: string): boolean => (import.meta.env.VITE_MOCK === '1' || import.meta.env.MODE === 'mock' || q.has('mock'))
  && (q.get('gallery') ?? '').startsWith('copy:') && (q.get('gallery') ?? '').slice(5).split(',').includes(k);

type Kind = 'stop' | 'warn' | 'globe' | 'info' | 'lock' | 'wifi';
const RED = T.bad;
const AMBER = T.warn;

function useDetail() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  return {
    open: pinned || (hovered && !suppressed),
    onMouseEnter: () => { setHovered(true); setSuppressed(false); },
    onMouseLeave: () => { setHovered(false); setSuppressed(false); },
    onClick: () => { if (pinned || (hovered && !suppressed)) { setPinned(false); setSuppressed(true); } else setPinned(true); },
  };
}

/** Small original line icons, drawn here so no font has to carry a glyph (the same reason `InfoIcon` is an SVG). */
export function Icon({ kind, size = 16, color }: { kind: Kind; size?: number; color: string }) {
  const p = { fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg data-icon={kind} aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0, display: 'block' }}>
      {kind === 'stop' && <><circle cx="8" cy="8" r="6.6" {...p} /><path d="M4.2 11.8 11.8 4.2" {...p} /></>}
      {kind === 'warn' && <><path d="M8 1.8 15 14H1z" {...p} /><path d="M8 6.2v3.6" {...p} /><circle cx="8" cy="12" r=".6" fill={color} stroke={color} /></>}
      {kind === 'globe' && <><circle cx="8" cy="8" r="6.4" {...p} /><path d="M1.6 8h12.8M8 1.6c-2.6 2.2-2.6 10.6 0 12.8M8 1.6c2.6 2.2 2.6 10.6 0 12.8" {...p} /></>}
      {kind === 'lock' && <><rect x="3" y="7" width="10" height="7" {...p} /><path d="M5 7V5a3 3 0 0 1 6 0v2" {...p} /></>}
      {kind === 'wifi' && <><path d="M1.6 6a9.4 9.4 0 0 1 12.8 0M3.8 8.6a6.2 6.2 0 0 1 8.4 0M6 11.2a3 3 0 0 1 4 0" {...p} /><circle cx="8" cy="13" r=".7" fill={color} stroke={color} /></>}
      {kind === 'info' && <InfoIcon size={size} color={color} />}
    </svg>
  );
}

const btn = (c: string): React.CSSProperties => ({ background: 'transparent', border: `1px solid ${c}`, color: c, font: F.chk(600, 12), padding: '2px 8px', minHeight: 26, cursor: 'pointer', borderRadius: 2 });

/** RED: icon + short sentence-case label + "Why?". `why` says what is wrong, `fix` what to do. */
export function FaultPill({ id, short, why, fix, testid, extra, onTap, tapHint, icon = 'stop', role, static: alwaysOpen = false, sev: dynamicSev, size = 14 }: {
  id: string; short: string; why: ReactNode; fix?: ReactNode; testid?: string; extra?: ReactNode; onTap?: () => void; tapHint?: string; icon?: Kind; role?: 'alert' | 'status'; static?: boolean; sev?: Severity; size?: number;
}) {
  const detail = useDetail();
  const sev = pillSeverity(id, dynamicSev);
  const colour = sev === 'amber' ? AMBER : RED;
  return (
    <div data-testid={testid} data-alert={id} data-sev={sev} role={role ?? (sev === 'red' ? 'alert' : 'status')}
      onMouseEnter={alwaysOpen ? undefined : detail.onMouseEnter} onMouseLeave={alwaysOpen ? undefined : detail.onMouseLeave}
      style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignSelf: 'flex-start', maxWidth: 'min(520px, 100%)' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: sev === 'amber' ? 'rgba(255,176,32,.10)' : 'rgba(255,82,82,.12)', border: `1px solid ${colour}`, borderLeft: `3px solid ${colour}` }}>
        <Icon kind={icon} size={16} color={colour} />
        <span style={{ font: F.chk(700, size), color: colour }}>{short}</span>
        {extra}
        {!alwaysOpen && <button type="button" aria-expanded={detail.open} onClick={detail.onClick} style={btn(colour)}>{detail.open ? 'Hide ▴' : 'Why? ▾'}</button>}
        {onTap && <button type="button" onClick={onTap} style={btn(colour)}>{tapHint ?? 'Fix'}</button>}
      </div>
      {(alwaysOpen || detail.open) && (
        <div data-testid="fault-detail" style={{ font: F.chk(500, Math.max(13, size - 1), 1.45), color: T.body, padding: '6px 10px', background: T.panelAlt, border: `1px solid ${T.line2}`, overflowWrap: 'anywhere' }}>
          <div>{why}</div>
          {fix && <div style={{ marginTop: 4, color: T.ink }}><b>What to do:</b> {fix}</div>}
        </div>
      )}
    </div>
  );
}

/** AMBER: a small chip on the item it concerns. Tap opens the detail under it. */
export function ItemChip({ id, short, detail, testid, icon = 'warn', children, inline, role = 'status', static: alwaysOpen = false, sev: dynamicSev, size = 12 }: {
  id: string; short: string; detail?: ReactNode; testid?: string; icon?: Kind; children?: ReactNode; inline?: boolean; role?: 'alert' | 'status'; static?: boolean; sev?: Severity; size?: number;
}) {
  const reveal = useDetail();
  const sev = pillSeverity(id, dynamicSev);
  const colour = sev === 'red' ? RED : AMBER;
  const chipStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', background: sev === 'red' ? 'rgba(255,82,82,.12)' : 'rgba(255,176,32,.10)', border: `1px solid ${colour}`, color: colour,
    font: F.chk(600, size), cursor: detail && !alwaysOpen ? 'pointer' : 'default', minHeight: 26, whiteSpace: 'nowrap' };
  const inner = (
    <>
      {alwaysOpen
        ? <span data-testid={testid} data-alert={id} data-sev={sev} style={chipStyle}><Icon kind={icon} size={14} color={colour} />{short}</span>
        : <button type="button" data-testid={testid} data-alert={id} data-sev={sev} aria-expanded={detail ? reveal.open : undefined}
            onClick={detail ? reveal.onClick : undefined} onMouseEnter={detail ? reveal.onMouseEnter : undefined} onMouseLeave={detail ? reveal.onMouseLeave : undefined}
            title={typeof detail === 'string' ? detail : undefined} style={chipStyle}>
            <Icon kind={icon} size={14} color={colour} />{short}{detail ? <span aria-hidden="true" style={{ opacity: .7 }}>{reveal.open ? '▴' : '▾'}</span> : null}
          </button>}
      {children}
      {(alwaysOpen || reveal.open) && detail && (
        <div data-testid="chip-detail" style={{ flexBasis: '100%', font: F.chk(500, Math.max(12, size - 1), 1.45), color: T.body, padding: '5px 9px', background: T.panelAlt, border: `1px solid ${T.line2}`, overflowWrap: 'anywhere' }}>{detail}</div>
      )}
    </>
  );
  return <div role={role} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', maxWidth: inline ? undefined : '100%' }}>{inner}</div>;
}

/** NEUTRAL: gone, unless `keep`; then one INFO icon opens it. */
export function HelpNote({ keep, label, testid, infoTestid = 'help-info' }: { keep?: ReactNode; label?: string; testid?: string; infoTestid?: string }) {
  const detail = useDetail();
  if (!keep) return null;
  return (
    <span onMouseEnter={detail.onMouseEnter} onMouseLeave={detail.onMouseLeave}
      style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <button type="button" data-testid={infoTestid} aria-expanded={detail.open} aria-label={label ?? 'Help'} onClick={detail.onClick}
        style={{ background: 'transparent', border: `1px solid ${T.line2}`, color: T.acc, padding: '3px 8px', minHeight: 26, display: 'inline-flex', alignItems: 'center', gap: 6, font: F.chk(600, 12), cursor: 'pointer' }}>
        <InfoIcon size={14} color={T.acc} />{label ?? 'Help'}
      </button>
      {detail.open && <span data-testid={testid} style={{ font: F.chk(500, 13, 1.45), color: T.body, padding: '6px 10px', background: T.panelAlt, border: `1px solid ${T.line2}`, maxWidth: 520 }}>{keep}</span>}
    </span>
  );
}

/** The backhaul status (brx4): a small globe and a short label; the error sits behind a tap. */
export function BackhaulStatus({ auto, onCellular, error, compact }: { auto: boolean; onCellular: number; error?: string | null; compact?: boolean }) {
  const detail = useDetail();
  const bad = !!error;
  const c = bad ? RED : auto ? T.ok : T.dim;
  const label = bad ? 'Backhaul failed' : auto ? `Backhaul on · ${onCellular} on cellular` : 'Backhaul off';
  return (
    <span data-testid="backhaul-status" data-state={bad ? 'error' : auto ? 'on' : 'off'} onMouseEnter={bad ? detail.onMouseEnter : undefined} onMouseLeave={bad ? detail.onMouseLeave : undefined}
      style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <button type="button" aria-expanded={bad ? detail.open : undefined} onClick={bad ? detail.onClick : undefined}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${bad ? RED : T.line2}`, color: c, font: F.chk(600, compact ? 12 : 13),
                 padding: '3px 9px', minHeight: 28, cursor: bad ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
        <Icon kind="globe" size={15} color={c} />{label}{bad ? <span aria-hidden="true">{detail.open ? ' ▴' : ' ▾'}</span> : null}
      </button>
      {bad && detail.open && <span style={{ font: F.chk(500, 12, 1.45), color: T.body, padding: '5px 9px', background: T.panelAlt, border: `1px solid ${T.line2}`, maxWidth: 420, overflowWrap: 'anywhere' }}>{error}</span>}
    </span>
  );
}

/** The backhaul auto-start status (F595 `lan.public.auto`), gated on the tunnel's own status because `auto` can stay set after the
 *  tunnel fails. Up: on. Error: the error. Anything else (off, starting): nothing to say. */
export const autoOf = (pub: { status?: string; error?: string; auto?: { cellular?: number; error?: string } } | null | undefined): { on: boolean; cellular: number; error: string | null } | undefined => {
  if (!pub?.auto) return undefined;
  if (pub.status === 'up') return { on: true, cellular: pub.auto.cellular ?? 0, error: null };
  if (pub.status === 'error') return { on: true, cellular: 0, error: pub.auto.error ?? pub.error ?? 'The tunnel failed.' };
  return undefined;
};
