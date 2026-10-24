import { createContext, useContext, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { F, T } from '../tokens';
import { colourOf } from '../alerts';
import type { RecapSyncRow } from '../api/recapSync';

// F596 + F597: the SYNC STRIP on RECAP. After the whistle, RECAP must not name a winner while a phone bound at
// the whistle has not delivered its results (field 2026-10-17: the winner flipped when the rest arrived). The
// server decides everything here (`recap.sync`: rows, stage, pending, stuck); this file only draws it. There is
// deliberately NO progress bar: the wire cannot prove a transfer, only that data has or has not arrived.

// ---- icons: 16 px, 1.8 stroke, currentColor. Decorative; the row's aria-label carries the words. ----
const svg = (children: ReactNode, size: number, label?: string) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ flex: 'none', display: 'block' }}>{children}</svg>
);
export const Icon = {
  unlinked: (s = 16) => svg(<><path d="M6.5 9.5 5 11a2.2 2.2 0 0 1-3-3l2-2" /><path d="M9.5 6.5 11 5a2.2 2.2 0 0 1 3 3l-2 2" /><path d="M2.5 2.5l11 11" /></>, s, 'not linked'),
  wifi: (s = 16) => svg(<><path d="M1.5 6a9.5 9.5 0 0 1 13 0" /><path d="M4 8.7a6 6 0 0 1 8 0" /><path d="M6.4 11.3a2.6 2.6 0 0 1 3.2 0" /><circle cx="8" cy="13.4" r=".6" fill="currentColor" /></>, s, 'Wi-Fi'),
  cellular: (s = 16) => svg(<><path d="M3 13V11" /><path d="M6.5 13V8.5" /><path d="M10 13V6" /><path d="M13.5 13V2.5" /></>, s, 'cellular'),
  backhaul: (s = 16) => svg(<><circle cx="8" cy="8" r="6" /><path d="M2 8h12" /><path d="M8 2c2.2 1.8 2.2 10.2 0 12" /><path d="M8 2c-2.2 1.8-2.2 10.2 0 12" /></>, s, 'internet backhaul'),
  sending: (s = 16) => svg(<><path d="M8 11V3" /><path d="M4.5 6.5 8 3l3.5 3.5" /><path d="M3 13.5h10" /></>, s, 'sending'),
  check: (s = 16) => svg(<path d="M2.5 8.5 6.3 12.3 13.5 4" />, s, 'received'),
  warn: (s = 16) => svg(<><path d="M8 2 14.5 13.5h-13z" /><path d="M8 6.5v3.2" /><circle cx="8" cy="11.8" r=".5" fill="currentColor" /></>, s, 'incomplete: facts lost'),
  /** END not confirmed: a flag on a pole (the gun may not have been told the match is over) */
  endOpen: (s = 16) => svg(<><path d="M4 14V2" /><path d="M4 3h8l-2 3 2 3H4" /></>, s, 'END not confirmed'),
  clock: (s = 16) => svg(<><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.4 1.6" /></>, s, 'no progress'),
  /** a small flag-less triangle for the team-kill note on a negative score */
  teamKill: (s = 16) => svg(<><circle cx="8" cy="8" r="6" /><path d="M5 8h6" /></>, s, 'team kills counted against this score'),
};
const TRANSPORT_ICON = { wifi: Icon.wifi, cellular: Icon.cellular, backhaul: Icon.backhaul } as const;
const TRANSPORT_WORD = { wifi: 'Wi-Fi', cellular: 'cellular', backhaul: 'internet backhaul' } as const;

/** Which catalogue id colours the END flag: amber while MC still re-delivers, red once the ladder is spent (a gun that may still be live). */
export const EndAlertCtx = createContext<'recap-end-delivery-retrying' | 'recap-end-delivery-spent'>('recap-end-delivery-retrying');

export const plural = (n: number, one: string, many = `${one}S`) => `${n} ${n === 1 ? one : many}`;

/** The row's words, for the aria-label and the hover title. */
export function wordOf(r: RecapSyncRow): string {
  const lost = r.lost ? `, incomplete (${r.lost} facts lost)` : '';
  const end = r.end_unconfirmed ? ', END not confirmed' : '';
  const body = r.stage === 'received' ? 'received'
    : r.stage === 'unlinked' ? 'not linked'
    : r.stage === 'sending' ? `sending${r.transport ? ` over ${TRANSPORT_WORD[r.transport]}` : ''}${r.pending ? `, ${r.pending} left to send` : ''}`
    : `linked${r.transport ? ` over ${TRANSPORT_WORD[r.transport]}` : ''}, data not in yet`;
  return `${r.name}: ${body}${lost}${end}${r.stuck ? ', no progress for a while' : ''}`;
}

// ---- the strip: one generic phone icon per phone, no names. Only a stage the server reported may move:
// SENDING shows travelling dots; everything else is still. A received phone is a still green check. ----
// the keyframes live in styles.css (`.sb-dot`, `.sb-ring`), not in a <style> element in the page text

/** icon width for n tiles: 44 px up to 16, 34 up to 32, then 28 (two rows of 33 at 1280 px) */
export const stripIconW = (n: number) => (n <= 16 ? 44 : n <= 32 ? 34 : 28);

function PhoneShape({ r, w }: { r: RecapSyncRow; w: number }) {
  const h = Math.round(w * 52 / 44);
  const sending = r.stage === 'sending';
  const col = r.stage === 'received' ? T.ok : r.stage === 'unlinked' ? T.dim : sending ? colourOf('recap-sync-sending') : T.body;
  const dotCol = colourOf('recap-sync-sending');
  return (
    <svg width={w} height={h} viewBox="0 0 44 52" fill="none" stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', opacity: r.stage === 'unlinked' ? 0.45 : 1 }}>
      {r.stage === 'received' && <rect x="9" y="2" width="26" height="44" rx="5" fill="rgba(46,204,113,.14)" stroke="none" />}
      <rect x="9" y="2" width="26" height="44" rx="5" />
      <path d="M19 6h6" strokeWidth="2" />
      {r.stage === 'received' && <path data-strip-tick d="M15 26l5.5 6L30 18" stroke={T.ok} strokeWidth="3.4" />}
      {sending && <>
        <rect className="sb-ring" x="9" y="2" width="26" height="44" rx="5" stroke={dotCol} strokeWidth="2" />
        <g data-strip-motion stroke="none" fill={dotCol}><circle className="sb-dot" cx="15" cy="27" r="2.6" /><circle className="sb-dot" cx="22" cy="27" r="2.6" /><circle className="sb-dot" cx="29" cy="27" r="2.6" /></g>
      </>}
    </svg>
  );
}
function StationShape({ r, w }: { r: RecapSyncRow; w: number }) {
  const h = Math.round(w * 52 / 44);
  const synced = r.stage === 'received';
  const col = synced ? T.ok : T.dim;
  return (
    <svg width={w} height={h} viewBox="0 0 44 52" fill="none" stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', opacity: synced ? 1 : 0.45 }}>
      {synced && <path d="M22 4 40 26 22 48 4 26z" fill="rgba(46,204,113,.14)" stroke="none" />}
      <path d="M22 4 40 26 22 48 4 26z" />
      {synced ? <path data-strip-tick d="M14 26l6 6L31 19" stroke={T.ok} strokeWidth="3.4" /> : <circle cx="22" cy="26" r="4" fill={col} stroke="none" />}
    </svg>
  );
}

function StripIcon({ r, w, labelRow, crowded }: { r: RecapSyncRow; w: number; labelRow: boolean; crowded: boolean }) {
  const endId = useContext(EndAlertCtx);
  const b = w >= 40 ? 16 : w >= 32 ? 14 : 12;
  const badge = (pos: CSSProperties, color: string, kids: ReactNode, key: string, attr: Record<string, string>) =>
    <span key={key} {...attr} style={{ position: 'absolute', width: b + 2, height: b + 2, borderRadius: '50%', background: T.panelDeep, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color, ...pos }}>{kids}</span>;
  const phone = r.kind === 'phone';
  const label = r.stuck && !crowded ? r.name : r.pending ? String(r.pending) : null;
  const title = wordOf(r);
  return (
    <div data-strip-icon={r.id} data-kind={r.kind} data-stage={r.stage} data-stuck={r.stuck ? '1' : undefined}
      aria-label={title} title={title} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: w, flex: 'none' }}>
      <div style={{ position: 'relative', opacity: r.stuck ? 0.5 : 1 }}>
        {phone ? <PhoneShape r={r} w={w} /> : <StationShape r={r} w={w} />}
        {r.stage !== 'received' && r.stage !== 'unlinked' && r.transport && badge({ right: -4, bottom: 0 }, T.body, TRANSPORT_ICON[r.transport](b - 2), 't', { 'data-strip-transport': r.transport })}
        {r.stage === 'unlinked' && badge({ right: -4, bottom: 0 }, colourOf('recap-sync-outofrange'), Icon.unlinked(b - 2), 'u', { 'data-strip-unlinked': '1' })}
        {r.end_unconfirmed && badge({ left: -4, top: 0 }, colourOf(endId), Icon.endOpen(b - 2), 'e', { 'data-strip-end': '1' })}
        {!!r.lost && badge({ right: -4, top: 0 }, T.warn, Icon.warn(b - 2), 'w', { 'data-strip-lost': '1' })}
      </div>
      {labelRow && <span data-strip-label style={{ marginTop: 3, minHeight: 14, font: F.mono(700, 11), color: r.stuck ? T.warn : colourOf('recap-sync-sending'), maxWidth: 76, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }} title={r.name}>{label ?? ''}</span>}
    </div>
  );
}

/** Whether the strip is live, held (everything in, still and green, for 2 s) or collapsed to the green line. */
export type SyncPhase = 'live' | 'holding' | 'line';
/** A hook, so it is called above RECAP's early returns. A recap that already opens all-in goes straight to the line. */
export function useSyncPhase(allIn: boolean): SyncPhase {
  const [phase, setPhase] = useState<SyncPhase>(allIn ? 'line' : 'live');
  useEffect(() => {
    if (allIn && phase === 'live') setPhase('holding');
    else if (!allIn && phase !== 'live') setPhase('live');
  }, [allIn, phase]);
  useEffect(() => {
    if (phase !== 'holding') return;
    const h = setTimeout(() => setPhase('line'), 2000);
    return () => clearTimeout(h);
  }, [phase]);
  // `allIn` flipped this render but the effect has not run yet: say 'live' for that one frame, not a stale 'line'
  return !allIn && phase !== 'live' ? 'live' : phase;
}

/** The strip, or the green line once every row is in. A row with lost facts or an open END keeps its icon even then. */
export function SyncStrip({ rows, phase }: { rows: RecapSyncRow[]; phase: SyncPhase }) {
  const allIn = rows.every(r => r.stage === 'received');
  const phones = rows.filter(r => r.kind === 'phone');
  const stations = rows.filter(r => r.kind === 'station');
  if (allIn && phase === 'line') {
    const keep = rows.filter(r => r.lost || r.end_unconfirmed);
    return (
      <div data-testid="all-synced" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 10, color: T.ok, font: F.mono(600, 12), letterSpacing: '.12em' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{Icon.check(16)}<span>{phones.length} OF {phones.length} PHONES SYNCED</span></span>
        {keep.length > 0 && (
          <span data-testid="sync-kept" style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 10 }}>
            {keep.map(r => <StripIcon key={r.id} r={r} w={30} labelRow={false} crowded />)}
          </span>
        )}
      </div>
    );
  }
  const w = stripIconW(rows.length);
  // Up to 16 icons the stalled one wears its own name. Past that the names would collide, so they go in ONE line.
  const crowded = rows.length > 16;
  const stalled = rows.filter(r => r.stuck);
  const labelRow = rows.some(r => (r.stuck && !crowded) || r.pending);
  return (
    <div data-testid="sync-strip" data-icon-w={w} data-still={allIn ? '1' : undefined} role="list" aria-label="Phone sync"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px 10px', padding: '8px 12px 6px', background: T.panel, border: `1px solid ${T.line}`, marginBottom: 8 }}>
      {phones.map(r => <StripIcon key={r.id} r={r} w={w} labelRow={labelRow} crowded={crowded} />)}
      {stations.length > 0 && <span aria-hidden="true" style={{ alignSelf: 'stretch', width: 1, background: T.line2, margin: '0 4px' }} />}
      {stations.map(r => <StripIcon key={r.id} r={r} w={w} labelRow={labelRow} crowded={crowded} />)}
      {crowded && stalled.length > 0 && (
        <div data-strip-stalled style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 6, color: T.warn, font: F.mono(700, 11), letterSpacing: '.06em' }}>
          {Icon.clock(14)}<span>NO PROGRESS: {stalled.map(r => r.name).join(', ')}</span>
        </div>
      )}
    </div>
  );
}

/** The SYNC column's cell: the strip's stage icons, small, for one player row. */
export function SyncCell({ r }: { r: RecapSyncRow }) {
  const endId = useContext(EndAlertCtx);
  const c = (col: string, kids: ReactNode, key: string) => <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: col }}>{kids}</span>;
  const send = colourOf('recap-sync-sending');
  return (
    <span data-sync-cell={r.id} data-stage={r.stage} title={wordOf(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {r.stage === 'unlinked' && c(colourOf('recap-sync-outofrange'), Icon.unlinked(16), 'u')}
      {(r.stage === 'linked' || r.stage === 'sending') && r.transport && c(T.body, TRANSPORT_ICON[r.transport](16), 't')}
      {r.stage === 'sending' && c(send, <>{Icon.sending(16)}{!!r.pending && <span data-sync-num style={{ font: F.mono(700, 12) }}>{r.pending}</span>}</>, 's')}
      {r.stage === 'received' && c(T.ok, Icon.check(16), 'c')}
      {!!r.lost && c(T.warn, <span data-sync-lost>{Icon.warn(16)}</span>, 'w')}
      {r.end_unconfirmed && c(colourOf(endId), <span data-sync-end>{Icon.endOpen(16)}</span>, 'e')}
    </span>
  );
}

/** FINALISE: an inline two-tap confirm. The first tap arms it for a few seconds; the second posts. A failure shows. */
export function FinaliseButton({ prominent, onFinalise }: { prominent: boolean; onFinalise: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const h = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(h);
  }, [armed]);
  const hot = armed || prominent;
  const tap = async () => {
    if (busy) return;
    if (!armed) { setErr(null); setArmed(true); return; }
    setArmed(false); setBusy(true);
    try { await onFinalise(); setErr(null); }
    catch (e) { setErr((e as Error).message || 'FINALISE FAILED'); }
    finally { setBusy(false); }
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      {err && <span data-testid="finalise-error" role="alert" style={{ font: F.mono(600, 11), letterSpacing: '.08em', color: T.warn }}>{err}</span>}
      <button type="button" data-testid="finalise" data-armed={armed ? '1' : undefined} data-prominent={prominent ? '1' : undefined} disabled={busy}
        onClick={tap}
        style={{ font: F.chk(700, 12), letterSpacing: '.18em', padding: '10px 18px', minHeight: 44, cursor: busy ? 'default' : 'pointer',
          background: hot ? T.warn : 'transparent', color: hot ? T.accInk : T.dim, border: `1px solid ${hot ? T.warn : T.line2}` }}>
        {busy ? 'FINALISING…' : armed ? 'TAP AGAIN TO FINALISE' : 'FINALISE'}
      </button>
    </span>
  );
}
