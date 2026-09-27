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

  // HIGH (brx1 review of e8811fea; server d6643ecf): a MODE switch that keeps the SAME declared team
  // SET no longer has anywhere to hide an uneven split behind -- TDM and INFECTION both declare
  // red+blue (the only two MVP-adjacent rows that genuinely share a set without a colour-strip pick),
  // so this is the one mode-switch scenario left where "uneven survives" is still provable: the team
  // SET does not change, so the new rebalance-on-teams-changed trigger never fires, and (since both
  // red and blue stay populated) neither does the old one-team-fault trigger.
  it('an UNEVEN split survives a mode switch that keeps the SAME team set (TDM -> INFECTION, both red+blue)', async () => {
    const api = new MockBackend();
    // `predictThenDo`'s own `putConfig({mode:'tdm'})` is a NO-OP the FIRST time (a fresh backend
    // already starts on tdm), so it never actually resets teams away from the DEMO's own opening
    // override (blue/yellow) -- a genuine round trip through a different mode first establishes TDM's
    // OWN real default (red+blue) instead, which is what this case needs to be a true same-set switch.
    await api.putConfig({ mode: 'koth' });
    await api.putConfig({ mode: 'tdm' });
    let st = await api.getState();
    expect(st.config.teams.map(t => t.team_id), 'control: TDM really is on its own red+blue now').toEqual(['red', 'blue']);
    await Promise.all(st.players.map((p, i) => api.patchPlayer(p.player_id, { team_id: i === 0 ? 'red' : 'blue' })));
    st = await api.getState();
    const modes = await api.getModes();
    const target = modes.find(m => m.mode === 'infection')!;
    const predicted = predictedSplit(st.players, st.config.teams, target.defaults.teams);
    await api.putConfig({ mode: 'infection' });
    const after = await api.getState();
    const actual = countsOf(after.players, after.config.teams);
    expect(actual, 'the mock re-teamed by index, as the server does').toEqual(predicted);
    const vals = Object.values(actual).sort();
    expect(Math.max(...vals) - Math.min(...vals), 'control: this case really is uneven').toBeGreaterThan(1);
  });

  // The mirror image: a mode switch that changes to a DIFFERENT set now always evens out at the mode
  // switch itself, whatever the numbers were before -- not just when the index map happens to collapse
  // everyone onto one side (this file's own OLD "uneven split" case, retired above: TDM(yellow/purple)
  // -> KOTH(red/blue) IS a set change, so it rebalances now regardless of whether it also one-sides).
  it('a mode switch to a DIFFERENT team set rebalances too, not only when it one-sides', async () => {
    const r = await predictThenDo('tdm', i => (i === 0 ? 'purple' : 'yellow'), 'koth', ['yellow', 'purple']);
    expect(r.actual, 'the mock re-teamed by index THEN rebalanced, as the server does').toEqual(r.predicted);
    const vals = Object.values(r.actual).sort();
    expect(Math.max(...vals) - Math.min(...vals), 'the team-SET change alone rebalances this to spread <= 1').toBeLessThanOrEqual(1);
  });

  // Team-lead's own proof cases (brx1 review of e8811fea), through a TEAMS-strip pick rather than a
  // mode switch -- the same trigger, a different caller. A 2-team 4/4 roster growing a team used to
  // stay 4/4/0 (every existing player was ALREADY legal in the bigger set, so the index map's own
  // "already legal, skip" rule left them exactly where they were, and 4/4/0 is not a one-team fault
  // either -- both original sides stay populated).
  it('4/4 on 2 teams + a 3rd team in one change -> 3/3/2, not 4/4/0, predicted and performed alike', async () => {
    const api = new MockBackend();
    await api.pick({ match: { teams: ['red', 'blue'] } });
    let st = await api.getState();
    await Promise.all(st.players.map((p, i) => api.patchPlayer(p.player_id, { team_id: i % 2 === 0 ? 'red' : 'blue' })));
    st = await api.getState();
    const newTeams = [{ team_id: 'red' }, { team_id: 'blue' }, { team_id: 'yellow' }];
    const predicted = predictedSplit(st.players, st.config.teams, newTeams);
    await api.pick({ match: { teams: ['red', 'blue', 'yellow'] } });
    const after = await api.getState();
    const actual = countsOf(after.players, after.config.teams);
    expect(actual, 'the mock re-teamed and rebalanced, as predicted').toEqual(predicted);
    expect(Object.values(actual).sort()).toEqual([2, 3, 3]);
  });

  it('4/4 + 2 more teams in one change -> 2/2/2/2, predicted and performed alike', async () => {
    const api = new MockBackend();
    await api.pick({ match: { teams: ['red', 'blue'] } });
    let st = await api.getState();
    await Promise.all(st.players.map((p, i) => api.patchPlayer(p.player_id, { team_id: i % 2 === 0 ? 'red' : 'blue' })));
    st = await api.getState();
    const newTeams = [{ team_id: 'red' }, { team_id: 'blue' }, { team_id: 'yellow' }, { team_id: 'purple' }];
    const predicted = predictedSplit(st.players, st.config.teams, newTeams);
    await api.pick({ match: { teams: ['red', 'blue', 'yellow', 'purple'] } });
    const after = await api.getState();
    const actual = countsOf(after.players, after.config.teams);
    expect(actual, 'the mock re-teamed and rebalanced, as predicted').toEqual(predicted);
    expect(Object.values(actual).sort()).toEqual([2, 2, 2, 2]);
  });

  // Case #3 (team-lead's own words): an edit that leaves the team set alone never rebalances -- a
  // direct player move (not a teams change at all) must leave an operator's own uneven split exactly
  // as they made it.
  it('an edit that leaves the team set alone never rebalances an operator’s own uneven split', async () => {
    const api = new MockBackend();
    await api.pick({ match: { teams: ['red', 'blue'] } });
    const st = await api.getState();
    await Promise.all(st.players.map((p, i) => api.patchPlayer(p.player_id, { team_id: i === 0 ? 'red' : 'blue' })));
    // an unrelated edit: no "teams" key in the patch at all, so the declared set never moves.
    await api.pick({ match: { frag_limit: 15 } });
    const after = await api.getState();
    const actual = countsOf(after.players, after.config.teams);
    expect(Object.values(actual).sort(), `control: still 1 v ${st.players.length - 1} (saw ${JSON.stringify(actual)})`)
      .toEqual([1, st.players.length - 1]);
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
