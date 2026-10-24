import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { NodeView, Player, RecapView } from '../api/types';
import { F, T, teamColor } from '../tokens';
import { colourOf } from '../alerts';

// F596 + F597: the SYNC BOARD. After the whistle, RECAP must not name a winner while a phone bound
// at the whistle has not delivered its results (field 2026-10-17: the winner flipped when the rest
// arrived). One compact row (or tile) per phone, drawn with icons. Every stage below is a fact MC
// really holds: `state.nodes[].stale` / `transport` / `reach` / `pending` / `outbox_lost` and the
// recap's `missing` and `awaiting`. There is deliberately NO progress bar: the wire cannot prove a
// transfer, only that data has or has not arrived.

export type SyncStage = 'unlinked' | 'waiting' | 'received';
export type Transport = 'wifi' | 'cellular' | 'backhaul' | null;
export interface SyncPhone {
  id: string;
  name: string;
  team: string | null;
  stage: SyncStage;
  transport: Transport;
  pending: number;       // 0 = draw nothing
  lost: number;          // facts the phone's outbox dropped; > 0 on a received phone = incomplete
  idleS: number;         // seconds without progress (stage or pending change); 0 for a received phone
  stuck: boolean;
}

/** After this long with no progress a waiting phone is "stuck" (F596). */
export const STUCK_AFTER_S = 120;

/** The phones bound at the whistle. A roster entry with no node never delivered anything to wait for. */
export function boundPlayers(players: Player[]): Player[] {
  const bound = players.filter(p => p.node_id);
  return bound.length ? bound : players;
}

/** The stage of one phone: the existing DATA SYNC chip's own rule (`Recap.tsx`), without the words. */
export function stageOf(rc: Pick<RecapView, 'missing' | 'awaiting'>, pl: Player, nv: NodeView | undefined): SyncStage {
  const missing = rc.missing.includes(pl.player_id);
  const quiet = (rc.awaiting ?? []).includes(pl.player_id);
  if (!missing && !quiet) return 'received';
  return nv && !nv.stale ? 'waiting' : 'unlinked';
}
function transportOf(nv: NodeView | undefined): Transport {
  if (!nv || nv.stale) return null;
  if (nv.reach === 'backhaul') return 'backhaul';
  if (nv.transport === 'cellular') return 'cellular';
  if (nv.transport === 'wifi' || nv.reach === 'lan') return 'wifi';
  return null;   // an older app that never said: draw nothing rather than guess
}

declare global { interface Window { __brxIdle?: Record<string, number> } }

/** Seconds since each phone last made progress. A phone is first seen when RECAP mounts, so its clock
 *  starts at the whistle (`since_end_ms`) when the server says it, else at the first sighting. The
 *  gallery can pin an age through `window.__brxIdle`; the field never sets it. */
function useIdle(keys: Record<string, string>, t: number, sinceEndMs: number | null | undefined, matchId: string | null): Record<string, number> {
  const seen = useRef<{ match: string | null; at: Record<string, { key: string; at: number }> }>({ match: matchId, at: {} });
  if (seen.current.match !== matchId) seen.current = { match: matchId, at: {} };
  const book = seen.current.at;
  const out: Record<string, number> = {};
  for (const [id, key] of Object.entries(keys)) {
    const prev = book[id];
    if (!prev) book[id] = { key, at: t - (typeof sinceEndMs === 'number' ? sinceEndMs : 0) };
    else if (prev.key !== key) book[id] = { key, at: t };
    out[id] = Math.max(0, Math.round((t - book[id].at) / 1000));
  }
  const pinned = typeof window !== 'undefined' ? window.__brxIdle : undefined;
  if (pinned) for (const id of Object.keys(out)) if (id in pinned) out[id] = pinned[id];
  return out;
}

/** A hook, so it is called before RECAP's early returns; `rc` null (no recap yet) gives no phones. */
export function useSyncPhones(players: Player[], nodes: NodeView[], rc: RecapView | null, t: number, matchId: string | null): SyncPhone[] {
  const bound = rc ? boundPlayers(players) : [];
  const base = bound.map(pl => {
    const nv = nodes.find(n => n.node_id === pl.node_id);
    const stage = stageOf(rc!, pl, nv);
    const pending = stage === 'waiting' ? Math.max(0, nv?.pending ?? 0) : 0;
    return { pl, nv, stage, pending };
  });
  const idle = useIdle(Object.fromEntries(base.map(b => [b.pl.player_id, `${b.stage}:${b.pending}`])), t, rc?.since_end_ms, matchId);
  return base.map(({ pl, nv, stage, pending }) => {
    const idleS = stage === 'received' ? 0 : idle[pl.player_id] ?? 0;
    return { id: pl.player_id, name: pl.display, team: pl.team_id, stage,
      transport: stage === 'waiting' ? transportOf(nv) : null, pending,
      lost: stage === 'received' ? Math.max(0, nv?.outbox_lost ?? 0) : 0,
      idleS, stuck: stage !== 'received' && idleS >= STUCK_AFTER_S };
  });
}

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
};
const TRANSPORT_ICON = { wifi: Icon.wifi, cellular: Icon.cellular, backhaul: Icon.backhaul } as const;
const TRANSPORT_WORD = { wifi: 'Wi-Fi', cellular: 'cellular', backhaul: 'internet backhaul' } as const;

const word = (p: SyncPhone) => p.stage === 'received' ? (p.lost ? `received, incomplete (${p.lost} facts lost)` : 'received')
  : p.stage === 'unlinked' ? 'not linked'
  : `linked${p.transport ? ` over ${TRANSPORT_WORD[p.transport]}` : ''}, data not in yet${p.pending ? `, ${p.pending} left to send` : ''}`;

function GlyphsBase({ p, size }: { p: SyncPhone; size: number; endOpen?: boolean }) {
  const gap = size >= 20 ? 10 : 8;
  const c = (col: string, kids: ReactNode, key: string) => <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: col }}>{kids}</span>;
  const num = (n: number, col: string) => <span data-sync-num style={{ font: F.mono(700, 12), color: col }}>{n}</span>;
  if (p.stage === 'unlinked') return <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>{c(colourOf('recap-sync-outofrange'), Icon.unlinked(size), 'u')}</span>;
  if (p.stage === 'received') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      {p.lost > 0 && c(T.warn, <span data-sync-lost>{Icon.warn(size)}</span>, 'w')}
      {c(T.ok, Icon.check(size), 'c')}
    </span>
  );
  const link = T.body;   // the path is information, not an alert: plain body ink
  const send = colourOf('recap-sync-sending');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      {p.stuck && c(T.warn, <>{Icon.clock(size)}<span data-sync-idle style={{ font: F.mono(700, 12) }}>{Math.floor(p.idleS / 60)}m</span></>, 'i')}
      {p.transport && c(link, TRANSPORT_ICON[p.transport](size), 't')}
      {c(send, <>{Icon.sending(size)}{p.pending > 0 && num(p.pending, send)}</>, 's')}
    </span>
  );
}

export function Glyphs({ p, size, endOpen }: { p: SyncPhone; size: number; endOpen?: boolean }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><GlyphsBase p={p} size={size} endOpen={endOpen} />{endOpen && <span data-sync-end title="END not confirmed" style={{ display: 'inline-flex', color: colourOf('recap-end-delivery-retrying') }}>{Icon.endOpen(size)}</span>}</span>;
}

export type BoardLayout = 'list' | 'tiles' | 'table' | 'strip';

/** One compact row (A) or tile (B) per phone. A stuck row dims; a received row stays quiet. */
export function SyncBoard({ phones, layout = 'list' }: { phones: SyncPhone[]; layout?: BoardLayout }) {
  const tiles = layout === 'tiles';
  const wrap: CSSProperties = tiles
    ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 6 }
    : { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '4px 8px' };
  return (
    <div data-testid="sync-board" data-layout={layout} role="list" aria-label="Phone sync" style={{ ...wrap, marginBottom: 14 }}>
      {phones.map(p => (
        <div key={p.id} role="listitem" data-sync-row={p.id} data-stage={p.stage} data-stuck={p.stuck ? '1' : undefined}
          aria-label={`${p.name}: ${word(p)}`} title={`${p.name}: ${word(p)}`}
          style={{ display: 'flex', flexDirection: tiles ? 'column' : 'row', alignItems: tiles ? 'flex-start' : 'center', justifyContent: 'space-between',
            gap: tiles ? 6 : 12, minWidth: 0, background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${teamColor(p.team)}`,
            padding: tiles ? '8px 10px 9px' : '0 12px', minHeight: tiles ? 0 : 34, opacity: p.stuck ? 0.5 : 1 }}>
          <span style={{ font: F.chk(700, 12), letterSpacing: '.06em', minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
          <Glyphs p={p} size={tiles ? 20 : 16} />
        </div>
      ))}
    </div>
  );
}

/** FINALISE: an inline two-tap confirm. The first tap arms it for a few seconds; it does not act. */
export function FinaliseButton({ prominent, onFinalise }: { prominent: boolean; onFinalise: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const h = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(h);
  }, [armed]);
  const hot = armed || prominent;
  return (
    <button type="button" data-testid="finalise" data-armed={armed ? '1' : undefined} data-prominent={prominent ? '1' : undefined}
      onClick={() => { if (armed) { setArmed(false); onFinalise(); } else setArmed(true); }}
      style={{ font: F.chk(700, 12), letterSpacing: '.18em', padding: '10px 18px', minHeight: 44, cursor: 'pointer',
        background: hot ? T.warn : 'transparent', color: hot ? T.accInk : T.dim, border: `1px solid ${hot ? T.warn : T.line2}` }}>
      {armed ? 'TAP AGAIN TO FINALISE' : 'FINALISE'}
    </button>
  );
}

/** "RESULT CHANGED" when the winner on show is no longer the winner that was first shown. Mounted only
 *  while a winner is on screen, so its first key is the one the operator saw. */
export function ResultChanged({ winnerKey }: { winnerKey: string }) {
  const first = useRef(winnerKey);
  if (first.current === winnerKey) return null;
  return <div data-testid="result-changed" role="status" style={{ marginTop: 14, font: F.mono(700, 12), letterSpacing: '.14em', color: T.warn }}>RESULT CHANGED</div>;
}

export const plural = (n: number, one: string, many = `${one}S`) => `${n} ${n === 1 ? one : many}`;

// ---- Option D: the STRIP. One generic phone icon per phone, no names. Only a stage the server reported
// may move: a phone with facts left to send (`pending` > 0) shows travelling dots; everything else is
// still. A Received phone is a still green check. No fill, no percentage: the wire cannot prove one. ----
const STRIP_CSS = `
@keyframes sbDot{0%{transform:translateY(7px);opacity:0}25%{opacity:1}100%{transform:translateY(-7px);opacity:0}}
@keyframes sbRing{0%{opacity:.75;transform:scale(.92)}100%{opacity:0;transform:scale(1.22)}}
.sb-dot{animation:sbDot 1.2s linear infinite;transform-box:fill-box}
.sb-dot:nth-child(2){animation-delay:.4s}.sb-dot:nth-child(3){animation-delay:.8s}
.sb-ring{animation:sbRing 1.6s ease-out infinite;transform-box:fill-box;transform-origin:center}
@media (prefers-reduced-motion: reduce){
.sb-dot,.sb-ring{animation:none}
.sb-dot{opacity:1}.sb-dot:nth-child(1){transform:translateY(5px)}.sb-dot:nth-child(3){transform:translateY(-5px)}
.sb-ring{opacity:0}}`;

export interface StripStation { id: string; label: string; synced: boolean }

/** icon width for n tiles: 44 px up to 16, 34 up to 32, then 28 (two rows of 33 at 1280 px) */
export const stripIconW = (n: number) => (n <= 16 ? 44 : n <= 32 ? 34 : 28);

function PhoneShape({ p, w }: { p: SyncPhone; w: number }) {
  const h = Math.round(w * 52 / 44);
  const col = p.stage === 'received' ? T.ok : p.stage === 'unlinked' ? T.dim : p.pending > 0 ? colourOf('recap-sync-sending') : T.body;
  const dotCol = colourOf('recap-sync-sending');
  return (
    <svg width={w} height={h} viewBox="0 0 44 52" fill="none" stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', opacity: p.stage === 'unlinked' ? 0.45 : 1 }}>
      {p.stage === 'received' && <rect x="9" y="2" width="26" height="44" rx="5" fill="rgba(46,204,113,.14)" stroke="none" />}
      <rect x="9" y="2" width="26" height="44" rx="5" />
      <path d="M19 6h6" strokeWidth="2" />
      {p.stage === 'received' && <path data-strip-tick d="M15 26l5.5 6L30 18" stroke={T.ok} strokeWidth="3.4" />}
      {p.stage === 'waiting' && p.pending > 0 && <>
        <rect className="sb-ring" x="9" y="2" width="26" height="44" rx="5" stroke={dotCol} strokeWidth="2" />
        <g data-strip-motion stroke="none" fill={dotCol}><circle className="sb-dot" cx="15" cy="27" r="2.6" /><circle className="sb-dot" cx="22" cy="27" r="2.6" /><circle className="sb-dot" cx="29" cy="27" r="2.6" /></g>
      </>}
    </svg>
  );
}
function StationShape({ synced, w }: { synced: boolean; w: number }) {
  const h = Math.round(w * 52 / 44);
  const col = synced ? T.ok : T.dim;
  return (
    <svg width={w} height={h} viewBox="0 0 44 52" fill="none" stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', opacity: synced ? 1 : 0.45 }}>
      {synced && <path d="M22 4 40 26 22 48 4 26z" fill="rgba(46,204,113,.14)" stroke="none" />}
      <path d="M22 4 40 26 22 48 4 26z" />
      {synced ? <path data-strip-tick d="M14 26l6 6L31 19" stroke={T.ok} strokeWidth="3.4" /> : <circle cx="22" cy="26" r="4" fill={col} stroke="none" />}
    </svg>
  );
}

function StripIcon({ p, st, w, labelRow, endOpen = false, crowded = false }: { p?: SyncPhone; st?: StripStation; w: number; labelRow: boolean; endOpen?: boolean; crowded?: boolean }) {
  const b = w >= 40 ? 16 : w >= 32 ? 14 : 12;
  const badge = (pos: CSSProperties, color: string, kids: ReactNode, key: string, attr: Record<string, string>) =>
    <span key={key} {...attr} style={{ position: 'absolute', width: b + 2, height: b + 2, borderRadius: '50%', background: T.panelDeep, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color, ...pos }}>{kids}</span>;
  const label = p ? (p.stuck && !crowded ? p.name : p.pending > 0 ? String(p.pending) : null) : null;
  const name = p ? p.name : st!.label;
  const stuck = !!p?.stuck;
  const title = p ? `${p.name}: ${word(p)}` : `${st!.label}: ${st!.synced ? 'synced' : 'not synced'}`;
  return (
    <div data-strip-icon={p?.id ?? st!.id} data-kind={p ? 'phone' : 'station'} data-stage={p ? p.stage : st!.synced ? 'received' : 'unlinked'} data-stuck={stuck ? '1' : undefined}
      aria-label={title} title={title} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: w, flex: 'none' }}>
      <div style={{ position: 'relative', opacity: stuck ? 0.5 : 1 }}>
        {p ? <PhoneShape p={p} w={w} /> : <StationShape synced={st!.synced} w={w} />}
        {p && p.stage === 'waiting' && p.transport && badge({ right: -4, bottom: 0 }, T.body, TRANSPORT_ICON[p.transport](b - 2), 't', { 'data-strip-transport': p.transport })}
        {((p && p.stage === 'unlinked') || (st && !st.synced)) && badge({ right: -4, bottom: 0 }, colourOf('recap-sync-outofrange'), Icon.unlinked(b - 2), 'u', { 'data-strip-unlinked': '1' })}
        {endOpen && badge({ left: -4, top: 0 }, colourOf('recap-end-delivery-retrying'), Icon.endOpen(b - 2), 'e', { 'data-strip-end': '1' })}
        {p && p.lost > 0 && badge({ right: -4, top: 0 }, T.warn, Icon.warn(b - 2), 'w', { 'data-strip-lost': '1' })}
      </div>
      {labelRow && <span data-strip-label style={{ marginTop: 3, minHeight: 14, font: F.mono(700, 11), color: stuck ? T.warn : colourOf('recap-sync-sending'), maxWidth: 76, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }} title={name}>{label ?? ''}</span>}
    </div>
  );
}

/** The strip, then the green line once every phone is in. When the last phone arrives the strip stays
 *  up for 2 s, every icon still and green, and only then collapses to the line. */
export function SyncStatus({ phones, stations, endOpen }: { phones: SyncPhone[]; stations: StripStation[]; endOpen: Set<string> }) {
  const allIn = phones.every(p => p.stage === 'received') && stations.every(s => s.synced);
  const [phase, setPhase] = useState<'live' | 'holding' | 'line'>(allIn ? 'line' : 'live');
  useEffect(() => {
    if (allIn && phase === 'live') setPhase('holding');
    else if (!allIn && phase !== 'live') setPhase('live');
  }, [allIn, phase]);
  useEffect(() => {
    if (phase !== 'holding') return;
    const h = setTimeout(() => setPhase('line'), 2000);
    return () => clearTimeout(h);
  }, [phase]);
  if (allIn && phase === 'line') {
    return (
      <div data-testid="all-synced" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: T.ok, font: F.mono(600, 12), letterSpacing: '.12em' }}>
        {Icon.check(16)}<span>{phones.length} OF {phones.length} PHONES SYNCED</span>
      </div>
    );
  }
  const w = stripIconW(phones.length);
  // Up to 16 phones the stalled icon wears its own name. Past that the names would collide, so they
  // go in ONE line under the strip instead.
  const crowded = phones.length > 16;
  const stalled = phones.filter(p => p.stuck);
  const labelRow = phones.some(p => (p.stuck && !crowded) || p.pending > 0);
  return (
    <div data-testid="sync-strip" data-icon-w={w} data-still={allIn ? '1' : undefined} role="list" aria-label="Phone sync"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px 10px', padding: '8px 12px 6px', background: T.panel, border: `1px solid ${T.line}`, marginBottom: 8 }}>
      <style>{STRIP_CSS}</style>
      {phones.map(p => <StripIcon key={p.id} p={p} w={w} labelRow={labelRow} crowded={crowded} endOpen={endOpen.has(p.id)} />)}
      {stations.length > 0 && <span aria-hidden="true" style={{ alignSelf: 'stretch', width: 1, background: T.line2, margin: '0 4px' }} />}
      {stations.map(st => <StripIcon key={st.id} st={st} w={w} labelRow={labelRow} />)}
      {crowded && stalled.length > 0 && (
        <div data-strip-stalled style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 6, color: T.warn, font: F.mono(700, 11), letterSpacing: '.06em' }}>
          {Icon.clock(14)}<span>NO PROGRESS: {stalled.map(p => p.name).join(', ')}</span>
        </div>
      )}
    </div>
  );
}
