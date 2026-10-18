import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import { compilerValidation } from '../src/rules/configcheck';

async function fixture() {
  const backend = new MockBackend();
  const state = await backend.getState();
  return { config: structuredClone(state.config), players: structuredClone(state.players), weapons: await backend.getWeapons() };
}

describe('mock compiler validation', () => {
  it('grades a backup USP against its own magazine and keeps warning order', async () => {
    const f = await fixture();
    f.players[0].loadout.weapons = [{ weapon_id: 'assault_rifle' }, { weapon_id: 'usp' }];
    f.config.scoring.frag_limit = 5;
    // 2026-10-17: the USP (12 a hit) kills a 115 pool on one magazine, so a 200 pool keeps the magazine warning.
    f.config.health = { ...f.config.health, max_hp: 100, max_armor: 100 };
    const result = compilerValidation(f.config, f.players, f.weapons, false);
    const magazine = result.warnings.findIndex(line => line.startsWith('usp is your backup'));
    const crit = result.warnings.findIndex(line => line.includes('HEADSET-ONLY'));
    const coverage = result.warnings.findIndex(line => line.startsWith('frag_limit'));
    expect(magazine).toBeGreaterThanOrEqual(0);
    expect(crit).toBeGreaterThan(magazine);
    expect(coverage).toBeGreaterThan(crit);
  });

  it('uses resolved $SIR cells for support and conditional weapons', async () => {
    const f = await fixture();
    f.players[0].loadout.weapons = [{ weapon_id: 'assault_rifle' }, { weapon_id: 'stripper' }];
    f.players[1].loadout.weapons = [{ weapon_id: 'toxin_rifle' }];
    const result = compilerValidation(f.config, f.players, f.weapons, true);
    expect(result.errors.some(line => /stripper.*NO ROW|toxin_rifle.*NO ROW/.test(line))).toBe(false);
    // Deliberately nonlethal support weapons skip the GRANT warning in the compiler.
    expect(result.warnings.some(line => /stripper keys \$SIR/.test(line))).toBe(false);
  });

  it('refuses a support primary and warns about stun and a weak shield-only pool', async () => {
    const f = await fixture();
    f.players[0].loadout.weapons = [{ weapon_id: 'stripper' }];
    f.players[1].loadout.weapons = [{ weapon_id: 'charge_rifle' }];
    f.players[1].loadout.perk = 'armor_piercing';
    f.config.health = { ...f.config.health, max_hp: 30, max_armor: 0 };
    f.config.stun = {};
    const result = compilerValidation(f.config, f.players, f.weapons, true);
    expect(result.errors.some(line => /stripper cannot kill.*PRIMARY/.test(line))).toBe(true);
    expect(result.warnings.some(line => /^stun: charge_rifle/.test(line))).toBe(true);
    expect(result.warnings.some(line => /shield-only game \(30 HP/.test(line))).toBe(true);
  });

  it('uses the compiled modifier in crit wording and the allocated rekey cell', async () => {
    const f = await fixture();
    f.players[0].loadout.weapons = [{ weapon_id: 'burst_rifle' }];
    const crit = compilerValidation(f.config, f.players, f.weapons, true, undefined, 50);
    expect(crit.warnings.some(line => /burst_rifle.*CONFIRMED HEADSET-ONLY.*floor\(2\.0x/.test(line))).toBe(true);
    f.config.hit_audio_rekey = true;
    const rekeyed = compilerValidation(f.config, f.players, f.weapons, true);
    expect(rekeyed.errors.some(line => /NO ROW/.test(line))).toBe(false);
  });

  it('orders station setup before magazine and $SIR warnings', async () => {
    const f = await fixture();
    f.config.mode = 'koth';
    f.config.station_source = 'phone';
    f.config.teams = f.config.teams.map(team => ({ ...team, tid: team.tid === 2 ? 3 : team.tid }));
    f.players[0].loadout.weapons = [{ weapon_id: 'usp' }];
    f.config.health = { ...f.config.health, max_hp: 100, max_armor: 100 };   // see the backup-USP test above
    const result = compilerValidation(f.config, f.players, f.weapons, true);
    const setup = result.warnings.findIndex(line => line.startsWith('SETUP:'));
    const magazine = result.warnings.findIndex(line => line.startsWith('usp is your only weapon'));
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(magazine).toBeGreaterThan(setup);
  });

  it('validates generated mode parameters and respawn options', async () => {
    const f = await fixture();
    f.config.mode = 'lms';
    f.config.mode_params = { lives: 0, unknown: 2 };
    f.config.respawn = { ...f.config.respawn, protect_s: 9 } as unknown as typeof f.config.respawn;
    const result = compilerValidation(f.config, f.players, f.weapons, true);
    expect(result.errors.some(line => /has no parameter 'unknown'/.test(line))).toBe(true);
    expect(result.errors.some(line => /mode_params.lives must be at least 1/.test(line))).toBe(true);
    expect(result.errors.some(line => /respawn.protect_s must be one of/.test(line))).toBe(true);
  });

  it('reports unknown perks when given the server perk catalogue', async () => {
    const f = await fixture();
    f.players[0].loadout.perk = 'missing_perk';
    const perks = await new MockBackend().getPerks();
    const result = compilerValidation(f.config, f.players, f.weapons, true, perks);
    expect(result.errors).toContain("unknown perk_id 'missing_perk'");
  });
});
