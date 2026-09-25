// A56 (S58, docs/spec/powerups.md): the powerup pieces shared by the ITEMS card (ARMORY) and the strip on
// the ARMED and LIVE screens. The store follows the phase, so while a match is armed or live the operator
// is on those screens, never on ARMORY (polish r1, M3): the item state and RESET ITEM must be there too.
import { useEffect, useState } from 'react';
import type { StationItem, StationView } from '../api/types';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { schedule, usePowerups } from './powerupData';
import { GhostButton, SectionRule, Tag } from './index';
import { GLYPH, MC_OLDER, colourOf, glyphed, sevOf } from '../alerts';

/** a countdown: floors (never shows a time that has not arrived), clamps a past time to 0:00, minutes unpadded */
const countdown = (ms: number) => { const v = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

export function Swatch({ color }: { color: string }) {
  return <span data-swatch aria-hidden style={{ display: 'inline-block', width: 10, height: 10, flex: '0 0 auto', background: color, border: `1px solid ${T.line}` }} />;
}

/** The item and its live state, from `StationView.item_available` / `next_spawn_at_ms` / `taken_by`. NEXT
 *  shows only while the item is taken (MC sends the next spawn instant while it is available too). An MC
 *  that sends none of them (older, or no match running) gets the schedule instead of a guess. */
export function ItemState({ s, item }: { s: StationView; item: StationItem }) {
  const { serverNow, state } = useStore();
  const takenBy = s.item_available === false && s.taken_by != null
    ? (state?.players.find(p => p.player_num === s.taken_by)?.display ?? `#${s.taken_by}`) : null;
  const next = s.item_available === false ? s.next_spawn_at_ms ?? null : null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (next == null) return;
    const h = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(h);
  }, [next]);
  const live = s.item_available === true ? <Tag color={T.ok} ink={T.accInk}>AVAILABLE</Tag>
    : s.item_available === false ? <span style={{ color: T.dim }}>{next != null ? `NEXT ${countdown(next - serverNow())}` : 'TAKEN'}{takenBy && <span> · TAKEN BY {takenBy.toUpperCase()}</span>}</span>
    : <span style={{ color: T.micro }}>{schedule(item)}</span>;
  return (
    <span data-testid="station-item" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', font: F.chk(600, 12), letterSpacing: '.08em', color: T.dim }}>
      <Swatch color={item.color} /><span style={{ color: item.color }}>{item.name}</span>{live}
    </span>
  );
}

/** RESET ITEM: the item is available at this station NOW, off its schedule. Two taps (it hands out a heavy
 *  mid-match); a refusal lands in the banner AND on this row, since the banner may be off-screen. Absent
 *  while the item is already AVAILABLE: there is nothing to reset. */
function ResetItem({ s, item }: { s: StationView; item: StationItem }) {
  const { api, run } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (s.item_available === true) return null;
  const send = async () => {
    setConfirm(false); setErr(null);
    await run(async () => {
      try { return await api.resetStation(s.node_id); } catch (e) { setErr((e as Error).message); throw e; }
    });
  };
  return (
    <div data-testid="item-reset" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* F221: a two-tap hazard confirm (hands out a heavy mid-match) — UNCHANGED per Tony's rule. */}
      {confirm && (
        <span role="status" style={{ font: F.chk(700, 11), letterSpacing: '.08em', color: T.warn }}>
          ▲ RESET MAKES THE {item.name} AVAILABLE ON THIS STATION NOW, OFF ITS SCHEDULE. TAP RESET ITEM AGAIN TO SEND IT.
        </span>)}
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <GhostButton onClick={() => (confirm ? send() : setConfirm(true))}
          color={confirm ? T.warn : undefined} border={confirm ? T.warn : undefined}
          title={confirm ? 'tap again to confirm: the item becomes available at this station now' : "make this station's item available now, off its schedule"}>
          RESET ITEM
        </GhostButton>
        {confirm && <GhostButton size={11} onClick={() => setConfirm(false)} title="back out: nothing was sent">CANCEL</GhostButton>}
      </span>
      {err && <span data-testid="item-reset-error" role="alert" style={{ font: F.chk(700, 11), letterSpacing: '.06em', color: colourOf('frame-item-reset-error') }}>{GLYPH} RESET REFUSED: {err}</span>}
    </div>
  );
}

/** The item, its state and (in play, flag on) RESET ITEM: one row, used by the ITEMS card and the strip. */
export function ItemStationRow({ s, item, canReset, inline = false }: { s: StationView; item: StationItem; canReset: boolean; inline?: boolean }) {
  return (
    <div data-testid="item-station-row" style={{ display: 'flex', flexDirection: inline ? 'row' : 'column', flexWrap: 'wrap', alignItems: inline ? 'center' : undefined, gap: inline ? 10 : 6 }}>
      <ItemState s={s} item={item} />
      {canReset && <ResetItem s={s} item={item} />}
    </div>
  );
}

/** M3: the compact powerup rows on ARMED and LIVE. Present only when a powerup station holds an item, and
 *  (F331) never when MC says the flag is off: a restored item is inert then, and MC schedules nothing for it. */
export function PowerupStrip({ compact = false }: { compact?: boolean }) {
  const { state } = useStore();
  const pu = usePowerups();
  const rows = (state?.stations ?? []).filter(s => s.assigned?.kind === 'powerup' && s.assigned.item);
  if (!state || !rows.length || (pu.s === 'ok' && !pu.v.enabled)) return null;
  const inPlay = state.phase === 'armed' || state.phase === 'live';
  const enabled = pu.s === 'ok' && pu.v.enabled;
  return (
    <div data-testid="powerup-strip" data-compact={compact ? '1' : undefined} style={{ margin: compact ? '0 0 10px' : '0 0 14px' }}>
      {/* M7 (visual QA 2026-09-24): on LIVE each station is one row, so the board starts near the top */}
      {/* 'frame-powerup-predates' is AMBER (F221 polish, 2026-09-25): the same MC_OLDER fact every other
          screen already shows amber. */}
      {(!compact || pu.s === 'old' || pu.s === 'err') && <SectionRule label={`POWERUPS // ${rows.length} STATION${rows.length === 1 ? '' : 'S'}`}
        hint={pu.s === 'old' ? <span style={{ color: colourOf('frame-powerup-predates') }}>{glyphed(sevOf('frame-powerup-predates'), MC_OLDER.what)}</span>
          : pu.s === 'err' ? <span style={{ color: colourOf('frame-powerup-err') }}>{GLYPH} COULD NOT READ THE ITEM LIST: {pu.msg}</span> : undefined} />}
      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(auto-fill,minmax(min(420px,100%),1fr))' : 'repeat(auto-fill,minmax(260px,1fr))', gap: compact ? 6 : 8 }}>
        {rows.map(s => (
          <div key={s.node_id} data-powerup-row={s.node_id}
            style={{ background: T.panel, border: `1px solid ${T.line}`, borderLeft: `3px solid ${s.assigned!.item!.color}`, padding: compact ? '4px 12px' : '10px 12px',
                     display: 'flex', flexDirection: compact ? 'row' : 'column', flexWrap: 'wrap', alignItems: compact ? 'center' : undefined, gap: compact ? 12 : 6 }}>
            <span style={{ font: F.osw(700, 14), letterSpacing: '.08em' }}>POWERUP {s.assigned!.id}</span>
            <ItemStationRow s={s} item={s.assigned!.item!} canReset={inPlay && enabled} inline={compact} />
          </div>
        ))}
      </div>
    </div>
  );
}
