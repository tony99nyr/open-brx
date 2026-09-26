// F411 BUILD: pure logic behind the preset editor — no React, no fetch, so these are the fast unit
// tests (see build-helpers.test.ts). Kept separate from editors.tsx so a behaviour change (the delay
// guard, a class snapshot) is one function to break and watch fail (CLAUDE.md "break it once").
import type { GamePiece } from '../../api/contract.gen';

/** A piece's name is 1–24 chars (games-presets.md §1); DraftText's own default maxLength already
 *  matches this, so the input never lets an operator type past it. */
export const MAX_NAME = 24;
/** A piece's note is one line, at most 80 chars, or "" (games-presets.md §1). */
export const MAX_NOTE = 80;

/** F34/F13 (Designer.tsx's own respawn delay control): 1–2 s wedges the headset relay in its
 *  out-blink and the server refuses it with a 400. Skip the band instead of letting the operator step
 *  into a refusal: stepping UP from 0 lands on 3, stepping DOWN from 3 lands on 0 (no respawn). Kept
 *  byte-for-byte the same rule Designer.tsx already applies, so SPAWN presets built here behave
 *  exactly like a game hand-tuned there. */
export function guardSpawnDelay(next: number, prev: number): number {
  return next > 0 && next < 3 ? (next > prev ? 3 : 0) : next;
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

/** A minimal catalogue row BUILD needs from a weapon or perk: an id plus whatever classifies it.
 *  Perks carry no `role`, so the class-shortcut row simply has nothing to build itself from — the
 *  slot editor renders no shortcuts rather than inventing a vocabulary the catalogue does not have. */
export interface ClassableItem {
  id: string;
  role?: string;
  tags?: string[];
}

/** F411 contract gap (games-presets.md §14): "a class preset... needs `only_ids` computed from the
 *  weapon catalogue's class/role tags — `policy.py` has no built-in class vocabulary beyond the
 *  single 'heavy' exclude tag today." Smallest sensible choice: derive the shortcut list from
 *  whatever `role` values the catalogue actually carries (weapons.json's own `role` field, already
 *  the vocabulary `webapp/mc/src/tokens.ts ROLE` labels for the rest of the console), rather than
 *  hand-naming "RIFLES"/"SNIPERS" ourselves. Sorted so the row does not reorder itself between
 *  renders. */
export function classesOf(items: ClassableItem[]): string[] {
  return Array.from(new Set(items.map(i => i.role).filter((r): r is string => !!r))).sort();
}

/** The snapshot BUILD writes when a class shortcut is tapped — every current id of that role. It will
 *  NOT auto-update if the catalogue gains a same-class weapon later (games-presets.md §14); the
 *  editor's own note says so beside the control. */
export function onlyIdsForClass(items: ClassableItem[], role: string): string[] {
  return items.filter(i => i.role === role).map(i => i.id);
}

/** SPAWN's AUTO/STATION switch fills every field from that type's own builtin (games-presets.md §1,
 *  brief §3: "choosing AUTO or STATION first fills every value from that builtin") — never a
 *  hand-copied constant, so a change to the shipped builtin is picked up here for free. `type` is the
 *  piece's own `value.type` ("auto" or "scanner"), not the builtin's id slug. */
export function spawnBuiltinValue(builtins: GamePiece[], type: string): Record<string, unknown> | null {
  const hit = builtins.find(p => p.kind === 'spawn' && p.builtin && (p.value as { type?: string }).type === type);
  return hit ? hit.value : null;
}
