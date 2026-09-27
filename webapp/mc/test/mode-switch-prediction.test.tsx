// T2 INTEGRATION (2026-09-13). F-6's confirm line PREDICTS a reshape; `putConfig`/`set_config` PERFORM
// it. Nothing in either lane compared the two, and they disagreed: `predictedSplit` rebalanced whenever
// the spread came out greater than 1, while `state.py _reteam_for_config` (and `backend.ts
// reteamForConfig`, which mirrors it) rebalances ONLY when `one_team_fault()` holds after the index map
// -- fewer than two populated $TIDs. Uneven is not a fault: a 3/1 plays, and the server leaves it where
// the operator put it. So the confirm line promised a 2/2 the confirming tap would never produce.
//
// These are not tests of the predicate's arithmetic (mode-switch-confirm.test.tsx does that). They ask
// the ONE question that matters about a preview: does it equal what actually happens? Every case runs
// the prediction and then the real mock write, and compares.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import { predictedSplit } from '../src/screens/gameSummary';
import type { Player, Team, TeamColour } from '../src/api/contract.gen';

/** The roster as the screen sees it, and the counts the write actually produced. */
const countsOf = (players: Player[], teams: Team[]): Record<string, number> => {
  const out: Record<string, number> = Object.fromEntries(teams.map(t => [t.team_id, 0]));
  for (const p of players) if (p.team_id && p.team_id in out) out[p.team_id]!++;
  return out;
};

/** Force the demo roster onto an exact split, then answer both questions about a mode switch.
 *  `startTeams`, when given, forces the STARTING mode's own declared pair onto something else first
 *  (a TEAMS-strip pick, F413's own feature) -- needed once TDM and KOTH share the SAME default pair
 *  (team-lead's scope decision, 2026-09-27): the index map would otherwise leave every already-legal
 *  player untouched and only remap the ONE now-illegal colour, which can collapse an intentionally
 *  uneven split into a one-team fault the mock then rebalances away (verified by hand). */
async function predictThenDo(startMode: string, teamOf: (i: number) => string | null, targetMode: string, startTeams?: TeamColour[]) {
  const api = new MockBackend();
  await api.putConfig({ mode: startMode });
  if (startTeams) await api.pick({ match: { teams: startTeams } });
  let st = await api.getState();
  for (let i = 0; i < st.players.length; i++) {
    await api.patchPlayer(st.players[i].player_id, { team_id: teamOf(i) });
  }
  st = await api.getState();
  const modes = await api.getModes();
  const target = modes.find(m => m.mode === targetMode)!;
  const predicted = predictedSplit(st.players, st.config.teams, target.defaults.teams);
  await api.putConfig({ mode: targetMode });
  const after = await api.getState();
  return { predicted, actual: countsOf(after.players, after.config.teams), before: st, after };
}

describe('the GAMES confirm line predicts exactly what the switch then does', () => {
  it('an EVEN TDM split carries across to KOTH by index, predicted and performed alike', async () => {
    const r = await predictThenDo('tdm', i => (i % 2 === 0 ? 'blue' : 'yellow'), 'koth');
    expect(r.actual, 'the mock re-teamed by index, as the server does').toEqual(r.predicted);
    // F413 (2026-09-27): KOTH's own declared pair is blue+red now (blue kept at index 0, matching every
    // other team mode -- team-lead's scope decision), not blue+purple.
    expect(Object.keys(r.actual).sort()).toEqual(['blue', 'red']);
  });

  it('an UNEVEN split is left uneven — the preview must not promise a rebalance that never comes', async () => {
    // The divergence itself: 7/1 over two populated sides is not `one_team_fault()`, so the server
    // leaves it exactly as the operator built it. A preview reading "RED 4 / BLUE 4" here would be a
    // lie the operator only discovers on the LOBBY board. Starts from yellow/purple explicitly (neither
    // is legal on KOTH), not TDM's own bare default -- TDM and KOTH share the SAME red/blue pair now, so
    // an already-legal majority would be left untouched by the index map and only the minority remapped,
    // which cannot produce an uneven-but-still-populated result any more (see `predictThenDo`'s comment).
    const r = await predictThenDo('tdm', i => (i === 0 ? 'purple' : 'yellow'), 'koth', ['yellow', 'purple']);
    expect(r.actual).toEqual(r.predicted);
    const vals = Object.values(r.actual).sort();
    expect(Math.max(...vals) - Math.min(...vals), 'control: this case really is uneven').toBeGreaterThan(1);
  });

  it('ONE-SIDED is the case that DOES rebalance, and the preview says so', async () => {
    // Everyone on one side after the index map is `one_team_fault()`, which both the server and the
    // mock rebalance out of — the only trigger either of them has.
    const r = await predictThenDo('tdm', () => 'blue', 'koth');
    expect(r.actual).toEqual(r.predicted);
    const vals = Object.values(r.actual);
    expect(Math.max(...vals) - Math.min(...vals), 'a one-sided roster is evened out, not left to play').toBeLessThanOrEqual(1);
  });

  it('FFA -> TDM: one declared team becomes two, everyone lands on index 0, and the rebalance fires', async () => {
    const r = await predictThenDo('ffa', () => 'ffa', 'tdm');
    expect(r.actual).toEqual(r.predicted);
    const vals = Object.values(r.actual);
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
  });
});
