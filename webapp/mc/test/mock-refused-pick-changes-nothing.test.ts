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
