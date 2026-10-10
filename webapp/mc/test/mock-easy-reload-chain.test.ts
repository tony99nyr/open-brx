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

describe("the mock's policy apply follows MC's order (Opus r1)", () => {
  it('a chain primary drops Easy Reload and KEEPS the secondary', async () => {
    const { apply, defaultPolicy, pool } = await import('../src/mock/policy');
    const { WEAPONS, PERKS } = await import('../src/mock/data');
    const p = defaultPolicy('tdm');
    const pl = pool(p, WEAPONS, PERKS);
    const sec = pl.secondary_weapons.find(w => w !== 'shotgun');
    expect(pl.primary.includes('shotgun') && sec, 'the default pool offers a Shotgun primary and some secondary').toBeTruthy();
    const out = apply(p, { weapons: [{ weapon_id: 'shotgun' }, { weapon_id: sec! }], perk: null, overrides: { easy_reload: true } }, pl, WEAPONS);
    expect(out.weapons.map(w => w.weapon_id)).toEqual(['shotgun', sec]);
    expect(out.overrides?.easy_reload).toBeFalsy();
  });
});

describe('K/D reads as MC formats it (the binary k/d, one decimal)', () => {
  it("matches Python's f'{k/d:.1f}' on inexact and exact ties", async () => {
    const { formatKd } = await import('../src/mock/honors');
    // expected values printed by Python: 13/20 0.7, 3/20 0.1, 21/20 1.1 (inexact); 5/4 1.2, 7/4 1.8, 1/4 0.2, 3/8 0.4 (exact)
    const pairs: [number, number, string][] = [[13, 20, '0.7'], [3, 20, '0.1'], [21, 20, '1.1'], [5, 4, '1.2'], [7, 4, '1.8'], [1, 4, '0.2'], [3, 8, '0.4']];
    for (const [k, d, want] of pairs) expect(formatKd({ kills: k, deaths: d } as never), `${k}/${d}`).toBe(want);
  });
});
