// How a match is won, and whether team damage is on: the console's mirrors of the server's own rules.
import type { GameConfig, State } from '../api/types';
import { SOLO_MODES as GEN_SOLO_MODES } from '../api/contract.gen';

/** Missing win_by is the pre-contract kill-game shape. Preserve its cap until the current server normalizes it. */
export const isKillScored = (cfg: Pick<GameConfig, 'scoring'>): boolean =>
  cfg.scoring.win_by == null || cfg.scoring.win_by === 'kills';

/** The match is decided by possession, exactly the branch `Scorer.winner()` takes for win_by "objective". */
export const isObjectiveScored = (cfg: Pick<State['config'], 'scoring'>): boolean => cfg.scoring.win_by === 'objective';

/** A hill mode names its objective "HILL"; any other objective mode gets the generic word. */
export const objectiveWord = (mode: string) => (mode === 'koth' || mode === 'domination' ? 'HILL' : 'OBJECTIVE');

/** Q13: true where compile keeps team damage OFF, the mirror of compile.py `team_damage_on`. Only a
 *  one-team game in a solo mode (FFA, solo LMS or extraction) turns it on, and shows no TEAM DAMAGE row. */
const SOLO_MODES = new Set(GEN_SOLO_MODES);
export function teamDamageOff(cfg: Pick<GameConfig, 'mode' | 'teams'>): boolean {
  return !(SOLO_MODES.has(cfg.mode) && new Set((cfg.teams ?? []).map(t => t.tid)).size < 2);
}
