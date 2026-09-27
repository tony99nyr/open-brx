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
import { BTN_RESET, LockIcon, Micro, OutlineTag, Seg, SEG_PAD_44, ValueBox } from '../../ui';
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

// QA-16 (visual QA round 1): every tappable control in these editors is at least 44px tall.
const CHIP_MIN_HEIGHT = 44;
// `SEG_PAD_44` moved to ui/index.tsx (UX round 1 2026-09-26): PLAY's own Seg rows need the same pad.

function Chip({ label, on, locked, onClick }: { label: string; on: boolean; locked?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="hov-acc" aria-pressed={on} disabled={locked} onClick={onClick}
      title={locked ? 'COVERED BY A TYPE TOGGLE ABOVE — TURN THAT OFF TO EDIT THIS ONE' : undefined}
      style={{ ...BTN_RESET, display: 'flex', alignItems: 'center', gap: 6, font: F.chk(on ? 700 : 600, 11), letterSpacing: '.1em', padding: '7px 11px', minHeight: CHIP_MIN_HEIGHT,
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
      style={{ ...BTN_RESET, font: F.chk(on ? 700 : 600, 11), letterSpacing: '.1em', padding: '7px 11px', minHeight: CHIP_MIN_HEIGHT,
        border: `1px solid ${on || partial ? T.acc : T.line}`, background: on ? 'rgba(57,180,255,.1)' : 'transparent',
        color: on ? T.acc : partial ? T.dim : T.micro, cursor: 'pointer' }}>
      {partial ? `◐ ${label} ${count}/${total}` : label}
    </button>
  );
}

/** A 44px-tall switch, local to BUILD (QA-16: the shared `ui/index.tsx Toggle` is 48×36 and used
 *  across other screens this lane does not own — this is its own control, not a wrapped one, so
 *  clicking it can never double-fire). Same look as `Toggle`, a bigger hit area. */
function BigToggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label}
      style={{ ...BTN_RESET, width: 56, minHeight: CHIP_MIN_HEIGHT, position: 'relative', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
      <span style={{ position: 'relative', width: 40, height: 20, background: T.inset, border: `1px solid ${on ? T.acc : T.line2}`, boxSizing: 'border-box' }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 22 : 2, width: 14, height: 14, background: on ? T.acc : T.micro, transition: 'left .12s' }} />
      </span>
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
        <Seg value={station ? 'scanner' : 'auto'} label="respawn type" pad={SEG_PAD_44}
          options={[{ value: 'auto', label: 'AUTO' }, { value: 'scanner', label: 'STATION' }]} onChange={setType} />
      </Row>
      <Row label="DELAY" note="1S OR 2S IS NOT ALLOWED — IT WEDGES THE HEADSET, SO IT SNAPS UP TO 3S">
        <ValueBox label="respawn delay seconds" unit="S" min={0} max={300}
          value={value.delay_s} onChange={v => onChange({ ...value, delay_s: guardSpawnDelay(v) })} />
      </Row>
      {!station && (
        <>
          <Row label="PROTECTION">
            <Seg value={String(value.protect_s ?? TIMED_PROTECT_S_DEFAULT)} label="respawn protection seconds" pad={SEG_PAD_44}
              options={[{ value: '0', label: '0 S' }, { value: '1', label: '1 S' }, { value: '2', label: '2 S' }]}
              onChange={v => onChange({ ...value, protect_s: Number(v) as TimedProtectS })} />
          </Row>
          <Row label="WEAPON DELAY">
            <Seg value={String(value.weapon_delay_ms ?? WEAPON_DELAY_MS_DEFAULT)} label="respawn weapon delay" pad={SEG_PAD_44}
              options={[{ value: '500', label: '0.5 S' }, { value: '1000', label: '1 S' }, { value: '3000', label: '3 S' }]}
              onChange={v => onChange({ ...value, weapon_delay_ms: Number(v) as WeaponDelayMs })} />
          </Row>
        </>
      )}
      {station && (
        <>
          <Row label="STATION PROTECTION">
            <Seg value={String(value.station_protect_s ?? STATION_PROTECT_S_DEFAULT)} label="station respawn protection seconds" pad={SEG_PAD_44}
              options={[{ value: '0', label: '0 S' }, { value: '2', label: '2 S' }, { value: '3', label: '3 S' }]}
              onChange={v => onChange({ ...value, station_protect_s: Number(v) as StationProtectS })} />
          </Row>
          {/* games-presets.md §13: `gate` is a shipped default, not a bench-proven control — read-only,
              never a segmented choice. */}
          <Row label="GATE" note="NOT YET SUPPORTED — ONLY TRIGGER IS BENCH-PROVEN">
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
        <Seg value={value.choice} label="who picks" options={options} pad={SEG_PAD_44}
          onChange={choice => onChange({
            ...value, kinds: KINDS_FOR[slotKind], choice,
            // QA-14 (visual QA round 1): switching to FIXED with no item picked used to let SAVE
            // through, and the server's own field name ("choice 'fixed' needs a fixed_id") reached
            // the operator verbatim. Preselect the first catalogue item so FIXED never opens empty.
            fixed_id: choice === 'fixed' ? (value.fixed_id ?? catalogue[0]?.id ?? null) : value.fixed_id,
          })} />
      </Row>
      {value.choice === 'fixed' && (
        <Row label="FIXED ITEM" note={!value.fixed_id ? 'PICK ONE TO SAVE THIS PRESET' : undefined}>
          <Seg value={value.fixed_id ?? ''} label="fixed item" wrap pad={SEG_PAD_44}
            options={catalogue.map(c => ({ value: c.id, label: c.name.toUpperCase() }))}
            onChange={id => onChange({ ...value, fixed_id: id })} />
        </Row>
      )}
      {(value.choice === 'player' || value.choice === 'host') && (
        <>
          {types.length > 0 && (
            // QA-23 (visual QA round 1): plain uppercase words, no doc reference on screen (the
            // "why" lives in helpers.ts's own comment, `onlyIdsForClass`/`idsForType`'s snapshot note).
            <Row label="TYPE" testId="slot-type-row" note="A SNAPSHOT — DOES NOT UPDATE IF A NEW WEAPON OF THIS TYPE IS ADDED LATER">
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
        <Seg value={value.hud_select ? 'player' : 'host'} label="who picks" pad={SEG_PAD_44}
          options={[{ value: 'player', label: 'PLAYERS' }, { value: 'host', label: 'HOST' }]}
          onChange={v => onChange({ ...value, hud_select: v === 'player' })} />
      </Row>
      {/* QA-23 (visual QA round 1): plain uppercase words, no `exclude_tags:[heavy]` on screen. The
          "unless that slot already excludes its own" caveat is games-presets.md §3's own rule
          (the slot piece wins over this blanket) -- kept in the note so an operator who picks OFF
          and still sees a heavy is not left guessing why. */}
      <Row label="HEAVIES" note="OFF EXCLUDES HEAVY WEAPONS FROM PRIMARY AND SECONDARY, UNLESS THAT SLOT ALREADY EXCLUDES ITS OWN">
        <BigToggle on={value.heavies} onChange={v => onChange({ ...value, heavies: v })} label="heavies" />
        <span style={{ font: F.chk(600, 11), letterSpacing: '.1em', color: T.dim }}>{value.heavies ? 'ON (PICKUP ONLY)' : 'OFF'}</span>
      </Row>
    </>
  );
}
