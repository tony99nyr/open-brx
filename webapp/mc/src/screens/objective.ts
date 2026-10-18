// Visual QA H2 (2026-09-23): the KOTH board headlined the KILL score, which is not how a hill match is
// won and can go negative ("BLUE -1"). MC names an objective winner from possession (`scoring.winner`,
// win_by "objective"), so the board headlines the same tally. Nothing here changes a rule: these are
// reads of what the snapshot already carries.
import type { LiveView, State, StationView } from '../api/types';
import { fmtDuration } from '../tokens';
// isObjectiveScored and objectiveWord live in ../rules/scoring (the mock reads them too).

/** Seconds held for one team, or null when no node has reported possession yet (the field is absent). */
export const heldSeconds = (lv: Pick<LiveView, 'possession'>, teamId: string): number | null =>
  lv.possession ? (lv.possession.by_team[teamId] ?? 0) : null;

/** Milestone review 2026-10-18 (brx5, Opus, Codex): where the held time came from. F555 scores a site on its control
 *  station's own tally when it reported one (`station_sites`); that is the authority, not a floor, and `phones_by_team` (the
 *  phones' own merge) is the cross-check, shown when a phone reported. Null when no station counted a site. `label` names a team. */
export function stationSource(p: { sites: number; station_sites?: number; reports: number; phones_by_team?: Record<string, number> },
                              word: string, label: (id: string) => string = id => id.toUpperCase()): string | null {
  const st = p.station_sites ?? 0;
  if (st <= 0) return null;
  const who = st >= p.sites ? (p.sites > 1 ? `EVERY ${word}` : `THE ${word}`) : `${st} OF ${p.sites} ${word}S`;
  const counted = st >= p.sites ? 'COUNTED ITS OWN HOLD TIME' : 'COUNTED THEIR OWN HOLD TIME';
  const seen = Object.entries(p.phones_by_team ?? {}).filter(([, secs]) => secs > 0).sort((a, b) => b[1] - a[1]);
  const check = p.reports > 0 && seen.length
    ? `PHONES SAW ${seen.map(([id, secs]) => `${label(id)} ${fmtDuration(secs)}`).join(' · ')}`
    : 'NO PHONE REPORTED, SO THERE IS NO CROSS-CHECK';
  return `${who} ${counted}. ${check}.`;
}

/** The floor caveat for phone-measured time: the whole tally when no station counted, else only the other sites. */
export function floorSource(p: { sites: number; station_sites?: number }, word: string): string | null {
  const st = p.station_sites ?? 0;
  if (st >= p.sites && st > 0) return null;
  return st > 0 ? `THE OTHER ${word}S ARE A FLOOR: ONLY A GUN IN RANGE SEES THE ${word}.`
    : `ONLY A GUN IN RANGE SEES THE ${word}, SO THIS IS A FLOOR.`;
}

/** F556: `by_team` adds every hill that reported, so with two a team can pass the match length; `of_s` stays the match
 *  length. The note LIVE, RECAP and SPECTATE show then, or null for one hill. `sites` counts the hills that reported.
 *  F572 (Tony 2026-10-18, "It should add both hills"): the hold target counts that same sum, so a set target says so. */
export function sitesNote(p: { sites: number; of_s: number | null } | null | undefined, holdTargetS?: number | null): string | null {
  if (!p || p.sites < 2) return null;
  const most = p.of_s ? `, SO A TEAM CAN HOLD UP TO ${fmtDuration(p.of_s * p.sites)} IN A ${fmtDuration(p.of_s)} MATCH` : '';
  const target = holdTargetS ? ` THE ${fmtDuration(holdTargetS)} HOLD TARGET IS SUMMED ACROSS HILLS.` : '';
  return `HELD TIME ADDS UP OVER THE ${p.sites} HILLS THAT REPORTED${most}.${target}`;
}

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
