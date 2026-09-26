// F411 (VQA round 1, 2026-09-26, team-lead): the MATCH SETTINGS strip renders from a per-mode ITEM
// LIST, not a fixed set baked into Games.tsx — so a later item (F413 TEAMS, F415 a KOTH hold target)
// is one more key here, never a rewrite of the strip. A pure module: no fetching, no React.
export type MatchItemKey = 'time' | 'kills' | 'countdown' | 'daynight' | 'silenced';

/** Every mode's items, in strip order, before the `kills`-only-when-scored filter below. */
const DEFAULT_ITEMS: MatchItemKey[] = ['time', 'kills', 'countdown', 'daynight', 'silenced'];

/** A mode whose own item list differs from the default. Empty today — every MVP mode uses the
 *  default order — but the shape is here so a future mode (or F413/F415) can override it without
 *  touching the default. */
const MODE_ITEMS: Partial<Record<string, MatchItemKey[]>> = {};

/** The ordered items PLAY's strip shows for this mode. `winBy` (the composed config's own
 *  `scoring.win_by`) is a parameter, not looked up here, so this stays a pure function of its inputs —
 *  KILLS is the one item the games-presets.md brief §5 says depends on it ("shown only when the
 *  mode's win_by is kills"), never a mode-name special case. */
export function matchItems(mode: string, winBy: string): MatchItemKey[] {
  const items = MODE_ITEMS[mode] ?? DEFAULT_ITEMS;
  return items.filter(k => k !== 'kills' || winBy === 'kills');
}
