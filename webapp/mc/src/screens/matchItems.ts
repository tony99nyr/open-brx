// F411 (VQA round 1, 2026-09-26, team-lead): the MATCH SETTINGS strip renders from a per-mode ITEM
// LIST, not a fixed set baked into Games.tsx. F413/F415 (games-presets.md §7): that list now comes
// from the SERVER, `GET /api/modes`' own `match_items` on each row -- the console's own DEFAULT_ITEMS
// is only the fallback for an older server that predates the field. A pure module: no fetching, no React.
import type { MatchItemKey, ModeInfo } from '../api/types';
export type { MatchItemKey };

/** The fallback order for a server that predates F415's `match_items` -- every MVP mode used this same
 *  fixed list before F413/F415 existed. */
const DEFAULT_ITEMS: MatchItemKey[] = ['time', 'kills', 'countdown', 'daynight', 'silenced'];

/** The ordered items PLAY's strip shows for this mode. `winBy` (the composed config's own
 *  `scoring.win_by`) is a parameter, not looked up here, so this stays a pure function of its inputs --
 *  KILLS is the one item the games-presets.md brief §5 says depends on it ("shown only when the mode's
 *  win_by is kills"). The server's own `match_items` already leaves `kills` out for a non-kill-scored
 *  mode (KOTH's row carries `hold`, never `kills`), so this filter only ever DOES something on the
 *  fallback list -- harmless, never wrong, to keep it unconditional. */
export function matchItems(modeRow: Pick<ModeInfo, 'match_items'> | undefined, winBy: string): MatchItemKey[] {
  const items = modeRow?.match_items ?? DEFAULT_ITEMS;
  return items.filter(k => k !== 'kills' || winBy === 'kills');
}
