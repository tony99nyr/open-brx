// F411 BUILD: the per-kind field editors (games-presets.md §5, brief §2). One component per kind's
// `value` shape — LIFE's three numbers, SPAWN's respawn block, the three slot kinds (PRIMARY/
// SECONDARY/PERKS share one shape, `SlotRule`), and MISC LOADOUTS' blanket. GAME MODE and GAMEPLAY get
// no editor at all (read-only, brief §3).
import { useState, type ReactNode } from 'react';
import type {
  GamePiece, ItemKind, LifePiece, MiscLoadoutsPiece, Respawn, SlotChoice, SlotRule,
  StationProtectS, TimedProtectS, WeaponDelayMs,
} from '../../api/contract.gen';
import { STATION_PROTECT_S_DEFAULT, TIMED_PROTECT_S_DEFAULT, WEAPON_DELAY_MS_DEFAULT } from '../../api/contract.gen';
import { BTN_RESET, LockIcon, Micro, OutlineTag, Seg, Toggle, ValueBox } from '../../ui';
import { F, T } from '../../tokens';
import {
  deriveTypeSelection, guardSpawnDelay, idsCoveredByActiveTypes, idsForType, spawnBuiltinValue,
  toggleManualId, toggleType, typeSelectionIds, typesOf, WEAPON_TYPES, type ClassableItem, type TypeSelection,
} from './helpers';

/** A catalogue row an editor can show (a weapon or a perk) — id, a display name, and whatever
 *  `ClassableItem` needs for the class shortcuts (weapons only; perks carry no `role`). */
export interface CatalogueRow extends ClassableItem { name: string }

function Row({ label, children, note, testId }: { label: string; children: ReactNode; note?: string; testId?: string }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: 6, borderBottom: `1px solid ${T.line}`, padding: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ font: F.chk(600, 11), letterSpacing: '.14em', color: T.micro, minWidth: 150 }}>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{children}</span>
      </div>
      {note && <Micro>{note}</Micro>}
    </div>
  );
}

function Chip({ label, on, locked, onClick }: { label: string; on: boolean; locked?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="hov-acc" aria-pressed={on} disabled={locked} onClick={onClick}
      title={locked ? 'COVERED BY A TYPE TOGGLE ABOVE — TURN THAT OFF TO EDIT THIS ONE' : undefined}
      style={{ ...BTN_RESET, display: 'flex', alignItems: 'center', gap: 6, font: F.chk(on ? 700 : 600, 11), letterSpacing: '.1em', padding: '7px 11px', minHeight: 36,
        border: `1px solid ${on ? T.acc : T.line}`, background: on ? 'rgba(57,180,255,.1)' : 'transparent',
        color: on ? T.acc : T.dim, cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.6 : 1 }}>
      {locked && <LockIcon size={11} />}{label}
    </button>
  );
}

/** A type toggle shows a third, PARTIAL state (ui-build-verify §2: "partial states need their own
 *  look") when some but not all of its ids are already selected by hand — distinct from ON (every id
 *  selected because the toggle itself is active) so the operator never reads "some" as "all". */
function TypeChip({ label, state, count, total, onClick }:
  { label: string; state: 'on' | 'partial' | 'off'; count: number; total: number; onClick: () => void }) {
  const on = state === 'on';
  const partial = state === 'partial';
  return (
    <button type="button" className="hov-acc" aria-pressed={on} onClick={onClick}
      style={{ ...BTN_RESET, font: F.chk(on ? 700 : 600, 11), letterSpacing: '.1em', padding: '7px 11px', minHeight: 36,
        border: `1px solid ${on || partial ? T.acc : T.line}`, background: on ? 'rgba(57,180,255,.1)' : 'transparent',
        color: on ? T.acc : partial ? T.dim : T.micro, cursor: 'pointer' }}>
      {partial ? `◐ ${label} ${count}/${total}` : label}
    </button>
  );
}

export function LifeFields({ value, onChange }: { value: LifePiece; onChange: (v: LifePiece) => void }) {
  return (
    <Row label="HEALTH">
      <ValueBox label="max hp" unit="HP" min={1} max={255} value={value.max_hp} onChange={v => onChange({ ...value, max_hp: v })} />
      <ValueBox label="max armour" unit="AR" min={0} max={255} value={value.max_armor} onChange={v => onChange({ ...value, max_armor: v })} />
      <ValueBox label="max shield" unit="SH" min={0} max={255} value={value.max_shield} onChange={v => onChange({ ...value, max_shield: v })} />
    </Row>
  );
}

/** SPAWN: type, delay, protection, weapon delay and gate all live in the one preset (brief §3, Tony:
 *  "I was imagining the protection and weapon delay would be a part of spawning"). `builtins` are the
 *  kind's own builtin pieces, so switching TYPE fills every other field from that type's real shipped
 *  values, never a hand-copied constant (`spawnBuiltinValue`). */
export function SpawnFields({ value, onChange, builtins }: { value: Respawn; onChange: (v: Respawn) => void; builtins: GamePiece[] }) {
  const station = value.type === 'scanner';
  const setType = (t: string) => {
    const filled = spawnBuiltinValue(builtins, t);
    onChange((filled ? { ...filled } : { ...value, type: t }) as Respawn);
  };
  return (
    <>
      <Row label="TYPE">
        <Seg value={station ? 'scanner' : 'auto'} label="respawn type"
          options={[{ value: 'auto', label: 'AUTO' }, { value: 'scanner', label: 'STATION' }]} onChange={setType} />
      </Row>
      <Row label="DELAY">
        <ValueBox label="respawn delay seconds" unit="S" min={0} max={300}
          value={value.delay_s} onChange={v => onChange({ ...value, delay_s: guardSpawnDelay(v, value.delay_s) })} />
      </Row>
      {!station && (
        <>
          <Row label="PROTECTION">
            <Seg value={String(value.protect_s ?? TIMED_PROTECT_S_DEFAULT)} label="respawn protection seconds" pad="5px 11px"
              options={[{ value: '0', label: '0 S' }, { value: '1', label: '1 S' }, { value: '2', label: '2 S' }]}
              onChange={v => onChange({ ...value, protect_s: Number(v) as TimedProtectS })} />
          </Row>
          <Row label="WEAPON DELAY">
            <Seg value={String(value.weapon_delay_ms ?? WEAPON_DELAY_MS_DEFAULT)} label="respawn weapon delay" pad="5px 11px"
              options={[{ value: '500', label: '0.5 S' }, { value: '1000', label: '1 S' }, { value: '3000', label: '3 S' }]}
              onChange={v => onChange({ ...value, weapon_delay_ms: Number(v) as WeaponDelayMs })} />
          </Row>
        </>
      )}
      {station && (
        <>
          <Row label="STATION PROTECTION">
            <Seg value={String(value.station_protect_s ?? STATION_PROTECT_S_DEFAULT)} label="station respawn protection seconds" pad="5px 11px"
              options={[{ value: '0', label: '0 S' }, { value: '2', label: '2 S' }, { value: '3', label: '3 S' }]}
              onChange={v => onChange({ ...value, station_protect_s: Number(v) as StationProtectS })} />
          </Row>
          {/* games-presets.md §13: `gate` is a shipped default, not a bench-proven control — read-only,
              never a segmented choice. */}
          <Row label="GATE" note="NOT YET SUPPORTED — only TRIGGER is bench-proven">
            <OutlineTag color={T.dim} border={T.line2}>TRIGGER</OutlineTag>
          </Row>
        </>
      )}
    </>
  );
}

const OFF: { value: SlotChoice; label: string } = { value: 'off', label: 'OFF' };
const KINDS_FOR: Record<'primary' | 'secondary' | 'perks', ItemKind[]> = {
  primary: ['weapon'], secondary: ['weapon', 'sidearm'], perks: ['perk'],
};

/** PRIMARY / SECONDARY / PERKS share one shape (`SlotRule`, games-presets.md §1). `offAllowed` is
 *  false for PRIMARY: every mode needs a primary weapon (brief §3's "off where legal"). */
/** PRIMARY / SECONDARY / PERKS share one shape (`SlotRule`, games-presets.md §1). `offAllowed` is
 *  false for PRIMARY: every mode needs a primary weapon (brief §3's "off where legal").
 *
 *  F411: the TYPE row replaces the old CLASS shortcut (one mechanism, not two). `sel` is local,
 *  ephemeral toggle state seeded ONCE from the piece's saved `only_ids` on mount (`helpers.ts
 *  deriveTypeSelection`) — a fresh mount happens every time BUILD opens a different piece, since the
 *  whole editor un-renders on close (Build.tsx), so re-opening always starts from a clean read of
 *  what is actually saved. */
export function SlotFields({ slotKind, value, onChange, catalogue, offAllowed }:
  { slotKind: 'primary' | 'secondary' | 'perks'; value: SlotRule; onChange: (v: SlotRule) => void; catalogue: CatalogueRow[]; offAllowed: boolean }) {
  const options = [{ value: 'player', label: 'PLAYERS' }, { value: 'host', label: 'HOST' }, { value: 'fixed', label: 'FIXED' }, ...(offAllowed ? [OFF] : [])] as { value: SlotChoice; label: string }[];
  const types = typesOf(catalogue);
  const [sel, setSel] = useState<TypeSelection>(() => deriveTypeSelection(value.only_ids, catalogue));
  const covered = idsCoveredByActiveTypes(sel, catalogue);

  const applyType = (next: TypeSelection) => {
    setSel(next);
    onChange({ ...value, only_ids: typeSelectionIds(next, catalogue) });
  };
  const toggleOnly = (id: string) => {
    if (covered.has(id)) return;   // locked chip, disabled — belt and braces against a stray click
    applyType(toggleManualId(sel, id));
  };

  return (
    <>
      <Row label="WHO PICKS">
        <Seg value={value.choice} label="who picks" options={options} onChange={choice => onChange({ ...value, kinds: KINDS_FOR[slotKind], choice })} />
      </Row>
      {value.choice === 'fixed' && (
        <Row label="FIXED ITEM">
          <Seg value={value.fixed_id ?? ''} label="fixed item" wrap
            options={catalogue.map(c => ({ value: c.id, label: c.name.toUpperCase() }))}
            onChange={id => onChange({ ...value, fixed_id: id })} />
        </Row>
      )}
      {(value.choice === 'player' || value.choice === 'host') && (
        <>
          {types.length > 0 && (
            <Row label="TYPE" testId="slot-type-row" note="A SNAPSHOT — A TYPE WILL NOT AUTO-UPDATE IF THE CATALOGUE GAINS A WEAPON OF IT LATER (games-presets.md §14)">
              {types.map(t => {
                const meta = WEAPON_TYPES.find(w => w.id === t)!;
                const ids = idsForType(catalogue, t);
                const count = ids.filter(id => value.only_ids.includes(id)).length;
                const state: 'on' | 'partial' | 'off' = sel.active.includes(t) ? 'on' : count > 0 ? 'partial' : 'off';
                return <TypeChip key={t} label={meta.label} state={state} count={count} total={ids.length}
                  onClick={() => applyType(toggleType(sel, t))} />;
              })}
            </Row>
          )}
          <Row label="ONLY THESE" testId="slot-only-row" note={value.only_ids.length === 0 ? 'EMPTY = ANY OF THE ABOVE' : undefined}>
            {catalogue.map(c => (
              <Chip key={c.id} label={c.name.toUpperCase()} on={value.only_ids.includes(c.id)} locked={covered.has(c.id)} onClick={() => toggleOnly(c.id)} />
            ))}
          </Row>
        </>
      )}
    </>
  );
}

export function MiscLoadoutsFields({ value, onChange }: { value: MiscLoadoutsPiece; onChange: (v: MiscLoadoutsPiece) => void }) {
  return (
    <>
      <Row label="WHO PICKS">
        <Seg value={value.hud_select ? 'player' : 'host'} label="who picks"
          options={[{ value: 'player', label: 'PLAYERS' }, { value: 'host', label: 'HOST' }]}
          onChange={v => onChange({ ...value, hud_select: v === 'player' })} />
      </Row>
      <Row label="HEAVIES" note="OFF applies exclude_tags:[heavy] to primary and secondary, unless that slot's own preset already sets exclude tags">
        <Toggle on={value.heavies} onChange={v => onChange({ ...value, heavies: v })} label="heavies" />
        <span style={{ font: F.chk(600, 11), letterSpacing: '.1em', color: T.dim }}>{value.heavies ? 'ON (PICKUP ONLY)' : 'OFF'}</span>
      </Row>
    </>
  );
}
