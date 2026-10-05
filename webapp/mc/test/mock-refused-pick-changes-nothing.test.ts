// Cross-lane review 0.4.19 (Codex M4): api.py `_apply_patch` prechecks a PICK, FAVOURITES LOAD or picked-piece edit and a
// refusal touches nothing. The mock ran `putConfig` (re-team, policy, push state, game_pick sync) and then restored only
// `config`, so a refused pick still moved players between teams.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

describe('mock: a refused pick changes nothing', () => {
  it('a KOTH pick with an out-of-range hold target leaves the roster, push state and pick as they were', async () => {
    const b = new MockBackend();
    const before = await b.getState();
    const r = await b.pick({ pieces: { mode: 'builtin:mode:koth' }, match: { hold_target_s: 7201 } });
    expect(r.ok).toBe(false);
    const after = await b.getState();
    expect(after.players.map(p => [p.player_id, p.team_id, JSON.stringify(p.loadout)]))
      .toEqual(before.players.map(p => [p.player_id, p.team_id, JSON.stringify(p.loadout)]));
    expect(after.config).toEqual(before.config);
    expect(after.game_pick).toEqual(before.game_pick);
    expect(after.phase).toBe(before.phase);
    expect(after.lobby).toEqual(before.lobby);
  });
});

describe('mock: a refused pick in RECAP', () => {
  it('rolls forward first, as api.py does (_refuse_config_locked runs before the precheck), never a RECAP with no recap', async () => {
    const b = new MockBackend() as unknown as { phase: string; recap_: unknown; endedAt: number; gameLoaded: boolean;
      pick: MockBackend['pick']; getState: MockBackend['getState'] };
    b.phase = 'recap'; b.recap_ = { marker: 1 }; b.endedAt = 123; b.gameLoaded = true;
    const r = await b.pick({ pieces: { mode: 'builtin:mode:koth' }, match: { hold_target_s: 7201 } });
    expect(r.ok).toBe(false);
    expect(b.phase).not.toBe('recap');
    expect((await b.getState()).phase).toBe(b.phase);
  });
});
