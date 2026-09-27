// F411 BUILD: pure logic behind the preset editor — no React, no fetch, so these are the fast unit
// tests (see build-helpers.test.ts). Kept separate from editors.tsx so a behaviour change (the delay
// guard, a class snapshot) is one function to break and watch fail (CLAUDE.md "break it once").
import type { GamePiece } from '../../api/contract.gen';

/** A piece's name is 1–24 chars (games-presets.md §1); DraftText's own default maxLength already
 *  matches this, so the input never lets an operator type past it. */
export const MAX_NAME = 24;
/** A piece's note is one line, at most 80 chars, or "" (games-presets.md §1). */
export const MAX_NOTE = 80;

/** F34/F13: 1–2 s wedges the headset relay in its out-blink and the server refuses it with a 400.
 *  QA-15 (visual QA round 1): the DELAY box is a typed number, not a stepper — a direction-sensitive
 *  guard (stepping up from 0 lands on 3, stepping down from 3 lands on 0) read a typed "2" against
 *  whatever delay the piece happened to start at, so typing a FAST respawn could silently snap to NO
 *  respawn at all with no explanation. A typed value has no direction, only an intent: someone who
 *  types 1 or 2 wants the fastest respawn the gun allows, so it always snaps UP to 3, never down to 0.
 *  `SpawnFields` shows why beside the box. */
export function guardSpawnDelay(next: number): number {
  return next > 0 && next < 3 ? 3 : next;
}

/** QA-14 (visual QA round 1): a slot preset with WHO PICKS = FIXED and no item chosen used to reach
 *  SAVE and come back as the server's own field name ("choice 'fixed' needs a fixed_id"). `SlotFields`
 *  preselects an item the moment FIXED is chosen, so this only fires on an editor opened against an
 *  empty catalogue — belt and braces, not the primary defence. */
export function slotNeedsFixedItem(choice: string, fixedId: string | null | undefined): boolean {
  return choice === 'fixed' && !fixedId;
}

/** Draft shape every kind editor works on: a piece's own name/note/value, decoupled from its
 *  piece_id/timestamps so two drafts (the saved piece and the one on screen) compare by content. */
export interface PieceDraft {
  name: string;
  note: string;
  value: Record<string, unknown>;
}

export const draftOf = (p: Pick<GamePiece, 'name' | 'note' | 'value'>): PieceDraft => ({ name: p.name, note: p.note, value: p.value });

/** Has the draft on screen diverged from the piece it started from? Content, not identity — used for
 *  the single "leave with unsaved edits" confirm (games-presets.md §5). A plain JSON compare is enough:
 *  every value here is server JSON (numbers/strings/bools/arrays), never a function or a Date. */
export function isDirty(a: PieceDraft, b: PieceDraft): boolean {
  return a.name !== b.name || a.note !== b.note || JSON.stringify(a.value) !== JSON.stringify(b.value);
}

/** NEW ▸'s suggested name for a copy: "<NAME> COPY", trimmed to fit — a piece name is never the same
 *  as the one it was copied from (the server 409s a clash in the same kind), so the editor never
 *  opens on a name that would refuse itself. */
export function proposeCopyName(name: string): string {
  const suffix = ' COPY';
  const room = MAX_NAME - suffix.length;
  return `${name.slice(0, Math.max(1, room))}${suffix}`.slice(0, MAX_NAME);
}

/** A minimal catalogue row BUILD needs from a weapon or perk: an id plus its `types` (weapons.json
 *  `types`, F411). Perks carry no `types`, so the type-toggle row simply has nothing to build itself
 *  from — the slot editor renders no toggles rather than inventing a vocabulary the catalogue does
 *  not have. */
export interface ClassableItem {
  id: string;
  types?: string[];
}

/** F411: the loadout-preset TYPE vocabulary BUILD's toggles union over (games-presets.md), exactly
 *  the five words weapons.json `types` carries. Order is the row order Tony asked for (RIFLES first,
 *  SIDEARM/SUPPORT last). */
export const WEAPON_TYPES: { id: string; label: string }[] = [
  { id: 'rifle', label: 'RIFLES' },
  { id: 'close', label: 'CLOSE RANGE' },
  { id: 'long', label: 'LONG RANGE' },
  { id: 'sidearm', label: 'SIDEARM' },
  { id: 'support', label: 'SUPPORT' },
];

/** Which of the five types actually have a weapon in THIS catalogue, in `WEAPON_TYPES` order. PRIMARY's
 *  catalogue never carries a sidearm-only row (the sidearm role is excluded from it upstream), so its
 *  row simply never shows a SIDEARM toggle — nothing here has to know that rule specially. */
export function typesOf(items: ClassableItem[]): string[] {
  const present = new Set(items.flatMap(i => i.types ?? []));
  return WEAPON_TYPES.map(t => t.id).filter(id => present.has(id));
}

/** Every id in this catalogue tagged with `type` — the snapshot a type toggle unions in. It will NOT
 *  auto-update if the catalogue gains a same-type weapon later (games-presets.md §14 applies to this
 *  shortcut too, same as the class shortcut it replaces). */
export function idsForType(items: ClassableItem[], type: string): string[] {
  return items.filter(i => (i.types ?? []).includes(type)).map(i => i.id);
}

/** A type toggle's own ON/OFF state PLUS the individually hand-picked ids, kept apart from the wire's
 *  `only_ids` because `SlotRule` has no room for provenance. `active` types are unioned in on render;
 *  `manual` ids are the ones a "ONLY THESE" chip picked directly, and they always survive a type being
 *  switched off (brief: "toggling a type off removes the weapons that only that type had selected; a
 *  hand-picked weapon stays"). */
export interface TypeSelection { manual: string[]; active: string[] }

/** The `only_ids` a `TypeSelection` computes to: manual picks union every active type's ids, de-duped. */
export function typeSelectionIds(sel: TypeSelection, items: ClassableItem[]): string[] {
  const ids = new Set(sel.manual);
  for (const t of sel.active) for (const id of idsForType(items, t)) ids.add(id);
  return Array.from(ids);
}

/** Reconstructs a `TypeSelection` from a saved piece's `only_ids`. The wire keeps no provenance, so a
 *  type reads as active only when EVERY one of its ids is already selected; whatever is left over is
 *  treated as a hand pick. Round-trips: `typeSelectionIds(deriveTypeSelection(ids, items), items)`
 *  reproduces `ids` (as a set) for any `ids` the catalogue can express. */
export function deriveTypeSelection(onlyIds: string[], items: ClassableItem[]): TypeSelection {
  const active = typesOf(items).filter(t => {
    const ids = idsForType(items, t);
    return ids.length > 0 && ids.every(id => onlyIds.includes(id));
  });
  const covered = new Set(active.flatMap(t => idsForType(items, t)));
  return { manual: onlyIds.filter(id => !covered.has(id)), active };
}

/** Flips one type's active state (a union: several may be active at once). */
export function toggleType(sel: TypeSelection, type: string): TypeSelection {
  const active = sel.active.includes(type) ? sel.active.filter(t => t !== type) : [...sel.active, type];
  return { ...sel, active };
}

/** Flips one id's membership in the hand-picked set (the "ONLY THESE" row's own chip). */
export function toggleManualId(sel: TypeSelection, id: string): TypeSelection {
  const manual = sel.manual.includes(id) ? sel.manual.filter(x => x !== id) : [...sel.manual, id];
  return { ...sel, manual };
}

/** ids selected ONLY because an active type covers them. Their own "ONLY THESE" chip cannot remove
 *  them (turn the type off instead), so the editor shows them locked rather than silently eating the
 *  click (ui-build-verify §2: "a control that legitimately does nothing should say why"). */
export function idsCoveredByActiveTypes(sel: TypeSelection, items: ClassableItem[]): Set<string> {
  return new Set(sel.active.flatMap(t => idsForType(items, t)));
}

/** SPAWN's AUTO/STATION switch fills every field from that type's own builtin (games-presets.md §1,
 *  brief §3: "choosing AUTO or STATION first fills every value from that builtin") — never a
 *  hand-copied constant, so a change to the shipped builtin is picked up here for free. `type` is the
 *  piece's own `value.type` ("auto" or "scanner"), not the builtin's id slug. */
export function spawnBuiltinValue(builtins: GamePiece[], type: string): Record<string, unknown> | null {
  const hit = builtins.find(p => p.kind === 'spawn' && p.builtin && (p.value as { type?: string }).type === type);
  return hit ? hit.value : null;
}
