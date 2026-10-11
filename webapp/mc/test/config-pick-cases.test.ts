import { describe, expect, it } from 'vitest';
import fixture from '../../../app/test/fixtures/config-pick-cases.json';
import { MockBackend } from '../src/mock/backend';
import { MODES, TEAMS } from '../src/mock/data';
import type { GameConfig, MatchSettings, PieceKind } from '../src/api/types';

type Step = {
  pick?: { pieces: Partial<Record<PieceKind, string>>; match: Partial<MatchSettings> };
  put?: Partial<GameConfig>;
  outcome: { ok: true } | { refusal: string; thrown: boolean };
  result: unknown;
};
type Case = { name: string; start: { mode: string; teams: string[]; players: string[];
  config: Partial<GameConfig> }; steps: Step[] };
const cases = fixture.cases as unknown as Case[];

function project(config: GameConfig, gamePick: { pieces: Partial<Record<PieceKind, string>>; match: MatchSettings }, players: { player_num: number; team_id: string | null }[]) {
  const match = gamePick.match;
  return {
    mode: config.mode,
    teams: config.teams.map(t => ({ team_id: t.team_id, name: t.name, color: t.color, tid: t.tid })),
    time_limit_s: config.time_limit_s ?? null,
    frag_limit: config.scoring.frag_limit ?? null,
    hold_target_s: config.scoring.hold_target_s ?? null,
    night: config.night,
    volume: config.volume ?? null,
    respawn: config.respawn,
    game_pick: { pieces: { mode: gamePick.pieces.mode ?? null }, match: {
      ...('teams' in match ? { teams: match.teams } : {}),
      ...('hold_target_s' in match ? { hold_target_s: match.hold_target_s } : {}),
      time_limit_s: match.time_limit_s, frag_limit: match.frag_limit,
      night: match.night, silenced: match.silenced,
    } },
    players: [...players].sort((a, b) => a.player_num - b.player_num).map(p => p.team_id),
  };
}

describe('server-generated config and pick cases', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const b = new MockBackend();
      try {
        for (const p of (await b.getState()).players) await b.deletePlayer(p.player_id);
        const setup = await b.putConfig({ mode: c.start.mode,
          teams: c.start.teams.map(id => [...TEAMS, ...MODES.find(m => m.mode === 'ffa')!.defaults.teams].find(t => t.team_id === id)!),
          time_limit_s: 600, ...c.start.config });
        expect(setup.ok).toBe(true);
        for (const [i, team_id] of c.start.players.entries()) {
          await b.addPlayer({ display: `P${i + 1}`, team_id });
        }
        for (const [i, step] of c.steps.entries()) {
          let outcome: Step['outcome'];
          try {
            const response = step.pick ? await b.pick(step.pick) : await b.putConfig(step.put!);
            outcome = response.ok ? { ok: true } : { refusal: response.errors[0], thrown: false };
          } catch (error) {
            outcome = { refusal: (error as Error).message, thrown: true };
          }
          expect(outcome, `step ${i + 1} outcome`).toEqual(step.outcome);
          const state = await b.getState();
          expect(state.game_pick, `step ${i + 1} game pick`).toBeDefined();
          expect(project(state.config, state.game_pick!, state.players), `step ${i + 1} projection`).toEqual(step.result);
        }
      } finally {
        b.dispose();
      }
    });
  }
});
