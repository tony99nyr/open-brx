// KIT's plain helpers, no components: the slot type, a player's pool, override edits, a weapon's short name and
// a locked select's style. Split out of Kit.tsx (round-2 candidate 11).
import type { CSSProperties } from 'react';
import type { LoadoutOverrides, Player } from '../../api/types';

export type Slot = 'primary' | 'secondary' | 'perk';   // A14: the perk is its own slot

/** The pool THIS player's gun is armed with, and whether the host set it deliberately.
 *  `loadout.overrides` (modes §1.1) wins over the game's health block per player: the compiler
 *  reads it in `_to_gc()` and it goes out on that player's `$PSET`. It is the handicap knob -- a
 *  younger player at double health, the solo side of a 2v1 -- so it must never be silent. */
export function poolOf(p: Player | undefined, gameHp: number, gameAr: number) {
  const ov = p?.loadout?.overrides ?? {};
  const hp = ov.max_hp ?? gameHp, armor = ov.max_armor ?? gameAr;
  const gamePool = gameHp + gameAr;
  return {
    hp, armor, set: ov.max_hp != null || ov.max_armor != null,
    hpSet: ov.max_hp != null, armorSet: ov.max_armor != null,
    // vs the pool everyone else is armed with; 2.0 reads as "twice as hard to drop"
    mult: gamePool > 0 ? (hp + armor) / gamePool : 1,
  };
}
/** The per-player block with some switches removed, or `undefined` when none survive.
 *
 *  `undefined` drops the whole `overrides` key from the JSON, which is how the server is told to
 *  clear it. The two switches in the block are INDEPENDENT (S50, loadout.md §2): the POOL handicap
 *  and Easy Reload answer different needs, so a write that clears one must carry the other through.
 *  Clearing the pool used to send the block absent, which took a player's reload button with it. */
export function withoutKeys(ov: LoadoutOverrides | undefined, ...keys: (keyof LoadoutOverrides)[]): LoadoutOverrides | undefined {
  const rest: LoadoutOverrides = { ...(ov ?? {}) };
  for (const k of keys) delete rest[k];
  return Object.keys(rest).length ? rest : undefined;
}

export const shortName = (n: string) => n.replace(/ Rifle$/i, '').replace(/ Launcher$/i, ' LNCHR').toUpperCase();

/** F318: a native `disabled` select looked exactly like a live one on this dark theme in ARMED/LIVE. */
export const lockedSelect = (locked: boolean): CSSProperties =>
  (locked ? { opacity: 0.45, cursor: 'not-allowed' } : { cursor: 'pointer' });
