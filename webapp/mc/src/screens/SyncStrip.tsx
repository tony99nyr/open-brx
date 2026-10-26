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
/** An unknown transport (a newer server) draws nothing, rather than throwing on an undefined icon. */
const transportIcon = (t: string | null | undefined, size: number) => (t && t in TRANSPORT_ICON ? TRANSPORT_ICON[t as keyof typeof TRANSPORT_ICON](size) : null);
const transportWord = (t: string | null | undefined) => (t && t in TRANSPORT_WORD ? TRANSPORT_WORD[t as keyof typeof TRANSPORT_WORD] : null);

/** The header's wait, by name as the released line does ("WAITING FOR ECHO, HILL 1"), phones first. A count, phones and
 *  hills apart ("WAITING FOR 5 PHONES · 1 HILL"), only when the names do not fit: more than three, or longer than
 *  WAIT_NAMES_MAX characters. SPECTATE passes `byName: false`: the public board lists no player. `waitingNames` is the
 *  full list for the title. Empty when nothing is listed. */
const WAIT_NAMES_MAX = 32;
const waitingRows = (rows: RecapSyncRow[]) => {
  const open = rows.filter(r => r.stage !== 'received');
  return [...open.filter(r => r.kind === 'phone'), ...open.filter(r => r.kind === 'station')];
};
export function waitingNames(rows: RecapSyncRow[]): string {
  return waitingRows(rows).map(r => r.name).join(', ');
}
export function waitingLine(rows: RecapSyncRow[], { byName = true }: { byName?: boolean } = {}): string {
  const open = waitingRows(rows);
  if (!open.length) return '';
  const names = waitingNames(rows);
  if (byName && open.length <= 3 && names.length <= WAIT_NAMES_MAX) return `WAITING FOR ${names}`;
  const ph = open.filter(r => r.kind === 'phone').length, hills = open.length - ph;
  return `WAITING FOR ${[ph ? plural(ph, 'PHONE') : '', hills ? plural(hills, 'HILL') : ''].filter(Boolean).join(' · ')}`;
}

/** Which catalogue id colours the END flag: amber while MC still re-delivers, red once the ladder is spent (a gun that may still be live). */
export const EndAlertCtx = createContext<'recap-end-delivery-retrying' | 'recap-end-delivery-spent'>('recap-end-delivery-retrying');

export const plural = (n: number, one: string, many = `${one}S`) => `${n} ${n === 1 ? one : many}`;
export const shortNames = (names: string[]) => names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;

/** ONE display model per row. The strip icon and the SYNC cell both render from it, so they cannot disagree. */
export interface RowView {
  state: string;                       // e.g. 'sending', 'sending-stuck', 'linked', 'received'
  stage: RecapSyncRow['stage'];
  transport: 'wifi' | 'cellular' | 'backhaul' | null;   // only a known transport, and only where the stage shows one
  count: number | null;                // the facts left to send, shown for a sending row (a stuck one too, dim)
  stuck: boolean;
  linkLost: boolean;                  // receipt stays green when its socket drops
  motion: boolean;                     // only a live (not stuck) sending row moves
  lost: number;
  end: boolean;
}
export function rowView(r: RecapSyncRow): RowView {
  const stuck = r.stuck && r.stage !== 'received';
  const linkLost = r.stage === 'received' && r.kind === 'phone' && r.linked === false;
  const transport = (r.stage === 'linked' || r.stage === 'sending') && r.transport && r.transport in TRANSPORT_ICON ? r.transport : null;
  return { state: stuck ? `${r.stage}-stuck` : r.stage, stage: r.stage, transport, count: r.stage === 'sending' && r.pending ? r.pending : null,
    stuck, linkLost, motion: r.stage === 'sending' && !stuck, lost: r.lost ?? 0, end: r.end_unconfirmed };
}

/** The row's words, for the aria-label and the hover title. */
export function wordOf(r: RecapSyncRow): string {
  const lost = r.lost ? `, incomplete (${r.lost} facts lost)` : '';
  const end = r.end_unconfirmed ? ', END not confirmed' : '';
  const body = r.stage === 'received' ? 'received'
    : r.stage === 'unlinked' ? 'not linked'
    : r.stage === 'sending' ? `sending${transportWord(r.transport) ? ` over ${transportWord(r.transport)}` : ''}${r.pending ? `, ${r.pending} left to send` : ''}`
    : `linked${transportWord(r.transport) ? ` over ${transportWord(r.transport)}` : ''}, data not in yet`;
  return `${r.name}: ${body}${r.stage === 'received' && r.linked === false ? ', phone not linked' : ''}${lost}${end}${r.stuck ? ', no progress for a while' : ''}`;
}

// ---- the strip: one generic phone icon per phone, no names. Only a stage the server reported may move:
// SENDING shows travelling dots; everything else is still. A received phone is a still green check. ----
// the keyframes live in styles.css (`.sb-dot`, `.sb-ring`), not in a <style> element in the page text

/** icon width for n tiles: 44 px up to 16, 34 up to 32, then 28 (two rows of 33 at 1280 px) */
export const stripIconW = (n: number) => (n <= 16 ? 44 : n <= 32 ? 34 : 28);

function PhoneShape({ r, w }: { r: RecapSyncRow; w: number }) {
  const h = Math.round(w * 52 / 44);
  const v = rowView(r);
  const moving = v.motion;   // a stalled phone is not shown as moving
  const col = r.stage === 'received' ? T.ok : r.stage === 'unlinked' ? T.dim : v.stuck ? T.warn : r.stage === 'sending' ? colourOf('recap-sync-sending') : T.body;
  const dotCol = colourOf('recap-sync-sending');
  return (
    <svg width={w} height={h} viewBox="0 0 44 52" fill="none" stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', opacity: r.stage === 'unlinked' ? 0.45 : 1 }}>
      {r.stage === 'received' && <rect x="9" y="2" width="26" height="44" rx="5" fill="rgba(46,204,113,.14)" stroke="none" />}
      <rect x="9" y="2" width="26" height="44" rx="5" />
      <path d="M19 6h6" strokeWidth="2" />
      {r.stage === 'received' && <path data-strip-tick d="M15 26l5.5 6L30 18" stroke={T.ok} strokeWidth="3.4" />}
      {moving && <>
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

function StripIcon({ r, w, labelRow, crowded, hideLinkLost = false }: { r: RecapSyncRow; w: number; labelRow: boolean; crowded: boolean; hideLinkLost?: boolean }) {
  const endId = useContext(EndAlertCtx);
  const b = w >= 40 ? 16 : w >= 32 ? 14 : 12;
  const badge = (pos: CSSProperties, color: string, kids: ReactNode, key: string, attr: Record<string, string>) =>
    <span key={key} {...attr} style={{ position: 'absolute', width: b + 2, height: b + 2, borderRadius: '50%', background: T.panelDeep, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color, ...pos }}>{kids}</span>;
  const phone = r.kind === 'phone';
  const v = rowView(r);
  const showName = v.stuck && !crowded;
  const title = wordOf(r);
  return (
    <div role="listitem" data-strip-icon={r.id} data-kind={r.kind} data-stage={r.stage} data-state={v.state} data-stuck={v.stuck ? '1' : undefined}
      aria-label={title} title={title} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: w, flex: 'none' }}>
      <div style={{ position: 'relative', opacity: r.stuck ? 0.5 : 1 }}>
        {phone ? <PhoneShape r={r} w={w} /> : <StationShape r={r} w={w} />}
        {v.transport && badge({ right: -4, bottom: 0 }, T.body, transportIcon(v.transport, b - 2), 't', { 'data-strip-transport': v.transport })}
        {(r.stage === 'unlinked' || (v.linkLost && !hideLinkLost)) && badge({ right: -4, bottom: 0 }, colourOf('recap-sync-outofrange'), Icon.unlinked(b - 2), 'u', { 'data-strip-unlinked': '1' })}
        {v.end && badge({ left: -4, top: 0 }, colourOf(endId), Icon.endOpen(b - 2), 'e', { 'data-strip-end': '1' })}
        {!!v.lost && badge({ right: -4, top: 0 }, T.warn, Icon.warn(b - 2), 'w', { 'data-strip-lost': '1' })}
      </div>
      {labelRow && (
        <span data-strip-label style={{ marginTop: 3, minHeight: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: 76, textAlign: 'center' }}>
          {/* a stuck sending row keeps its count, dim and amber, the same as its SYNC cell */}
          {v.count != null && <span data-strip-count style={{ font: F.mono(700, 11), color: v.stuck ? T.warn : colourOf('recap-sync-sending'), opacity: v.stuck ? 0.6 : 1 }}>{v.count}</span>}
          {showName && <span style={{ font: F.mono(700, 11), color: T.warn, maxWidth: 76, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</span>}
        </span>
      )}
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
            {keep.map((r, i) => <StripIcon key={`${r.kind}:${r.id}:${i}`} r={r} w={30} labelRow={false} crowded hideLinkLost />)}
          </span>
        )}
      </div>
    );
  }
  const w = stripIconW(rows.length);
  // With fewer than 12 icons a stalled row wears its own name. Longer lists use one compact line.
  const crowded = rows.length >= 12;
  const stalled = rows.filter(r => r.stuck);
  const labelRow = rows.some(r => (r.stuck && !crowded) || rowView(r).count != null);
  return (
    <div data-testid="sync-strip" data-icon-w={w} data-still={allIn ? '1' : undefined}
      style={{ padding: '8px 12px 6px', background: T.panel, border: `1px solid ${T.line}`, marginBottom: 8 }}>
      <div role="list" aria-label="Phone sync" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px 10px' }}>
      {phones.map(r => <StripIcon key={`phone:${r.id}`} r={r} w={w} labelRow={labelRow} crowded={crowded} />)}
      {stations.length > 0 && <span aria-hidden="true" style={{ alignSelf: 'stretch', width: 1, background: T.line2, margin: '0 4px' }} />}
      {stations.map((r, i) => <StripIcon key={`station:${r.id}:${i}`} r={r} w={w} labelRow={labelRow} crowded={crowded} />)}
      </div>
      {crowded && stalled.length > 0 && (
        <div data-strip-stalled title={stalled.map(r => r.name).join(', ')} style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, color: T.warn, font: F.mono(700, 11), letterSpacing: '.06em' }}>
          {Icon.clock(14)}<span>No progress: {shortNames(stalled.map(r => r.name))}</span>
        </div>
      )}
    </div>
  );
}

/** The SYNC column's cell: the strip's stage icons, small, for one player row. */
export function SyncCell({ r }: { r: RecapSyncRow }) {
  const endId = useContext(EndAlertCtx);
  const v = rowView(r);
  const c = (col: string, kids: ReactNode, key: string, o: number = 1) => <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: col, opacity: o }}>{kids}</span>;
  const send = v.stuck ? T.warn : colourOf('recap-sync-sending');
  const dim = v.stuck ? 0.6 : 1;   // the stuck form: dim and amber, no motion (it never had any in the cell)
  return (
    <span data-sync-cell={r.id} data-stage={r.stage} data-state={v.state} data-motion={v.motion ? '1' : '0'} title={wordOf(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {r.stage === 'unlinked' && c(colourOf('recap-sync-outofrange'), Icon.unlinked(16), 'u')}
      {v.linkLost && c(colourOf('recap-sync-outofrange'), <span data-sync-link-lost>{Icon.unlinked(16)}</span>, 'link')}
      {v.transport && c(T.body, <span data-sync-transport={v.transport} style={{ display: 'inline-flex' }}>{transportIcon(v.transport, 16)}</span>, 't', dim)}
      {r.stage === 'sending' && c(send, <>{Icon.sending(16)}{v.count != null && <span data-sync-num style={{ font: F.mono(700, 12) }}>{v.count}</span>}</>, 's', dim)}
      {r.stage === 'received' && c(T.ok, Icon.check(16), 'c')}
      {!!v.lost && c(T.warn, <span data-sync-lost>{Icon.warn(16)}</span>, 'w')}
      {v.end && c(colourOf(endId), <span data-sync-end>{Icon.endOpen(16)}</span>, 'e')}
    </span>
  );
}

/** FINALISE: an inline two-tap confirm. The first tap arms it for a few seconds; the second posts. A failure shows. */
export function FinaliseButton({ prominent, missingPhones, missingHills, onFinalise }: { prominent: boolean; missingPhones: number; missingHills: number; onFinalise: () => Promise<void> }) {
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
        {busy ? 'FINALISING…' : armed ? `TAP AGAIN: FINAL WITHOUT ${[missingPhones ? plural(missingPhones, 'PHONE') : '', missingHills ? plural(missingHills, 'HILL') : ''].filter(Boolean).join(' AND ')}` : 'FINALISE'}
      </button>
    </span>
  );
}
