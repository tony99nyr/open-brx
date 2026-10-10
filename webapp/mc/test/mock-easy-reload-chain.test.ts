// mc.md #4 review (Codex r1): MC refuses Easy Reload on a chain-reload weapon (policy.py validate: the Shotgun loads
// shell by shell) and its policy apply() drops the override beside a chain primary. The mock accepted both.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

describe('the mock refuses Easy Reload on a chain-reload weapon, as MC does', () => {
  it('a host loadout with a Shotgun primary and Easy Reload is refused in MC\'s words', async () => {
    const b = new MockBackend();
    const p = (await b.getState()).players[0];
    await expect(b.patchPlayer(p.player_id, { loadout: { weapons: [{ weapon_id: 'shotgun' }], perk: null, overrides: { easy_reload: true } } }))
      .rejects.toThrow(/loads shell by shell/);
  });
});
