// Visual QA H2 (2026-09-23): the KOTH board headlined the KILL score, which is not how a hill match is
// won and can go negative ("BLUE -1"). MC names an objective winner from possession (`scoring.winner`,
// win_by "objective"), so the board headlines the same tally. Nothing here changes a rule: these are
// reads of what the snapshot already carries.
import type { LiveView, State, StationView } from '../api/types';

/** The match is decided by possession, exactly the branch `Scorer.winner()` takes for win_by "objective". */
export const isObjectiveScored = (cfg: Pick<State['config'], 'scoring'>): boolean => cfg.scoring.win_by === 'objective';

/** A hill mode names its objective "HILL"; any other objective mode gets the generic word. */
export const objectiveWord = (mode: string) => (mode === 'koth' || mode === 'domination' ? 'HILL' : 'OBJECTIVE');

/** Seconds held for one team, or null when no node has reported possession yet (the field is absent). */
export const heldSeconds = (lv: Pick<LiveView, 'possession'>, teamId: string): number | null =>
  lv.possession ? (lv.possession.by_team[teamId] ?? 0) : null;

/** A hill broadcasts tid 2 while nobody owns it (bench 2026-09-10); 255 is a station's "any / nobody". */
const NEUTRAL_TID = 2;
const NOBODY_TID = 255;

export interface HillOwner {
  text: string;
  /** the team that holds it, when one does */
  team_id: string | null;
  /** true when the report is the station's LAST one, not a current one */
  stale: boolean;
}

/** Who holds the point right now, from an assigned CONTROL station's own heartbeat (`report.control`).
 *  A grenade hill reports nothing to MC mid-match, so for that case the answer is null, and the panel
 *  says the owner is not reported rather than guessing one. */
export function hillOwner(state: Pick<State, 'config'> & { stations?: StationView[] }): HillOwner | null {
  const st = (state.stations ?? []).find(s => s.assigned?.kind === 'control' && s.report?.control?.owner != null);
  if (!st) return null;
  const c = st.report.control!;
  const stale = !st.online;
  if (c.contested) return { text: 'CONTESTED', team_id: null, stale };
  const tid = c.owner!;
  if (tid === NEUTRAL_TID || tid === NOBODY_TID) return { text: 'NOBODY HOLDS IT', team_id: null, stale };
  const team = state.config.teams.find(t => t.tid === tid);
  return team ? { text: `HELD BY ${team.name.toUpperCase()}`, team_id: team.team_id, stale }
    : { text: `HELD BY TEAM ${tid}`, team_id: null, stale };
}
