import { describe, expect, it } from 'vitest';
import cases from '../../../app/test/fixtures/policy-cases.json';
import type { Loadout, LoadoutPolicy, PerkView, WeaponView } from '../src/api/types';
import { UNPLAYABLE_IDS, chainConflict, computePool, easyReloadConflict } from '../src/screens/gameSummary';
import { apply as mockApply } from '../src/mock/policy';

describe('server policy shared cases', () => {
  const weapons = cases.weapons as unknown as WeaponView[];
  const perks = cases.perks as unknown as PerkView[];

  it("the console's UNPLAYABLE_IDS is the set the case file marks unplayable (policy.py UNPLAYABLE_IDS)", () => {
    const marked = (cases.weapons as { weapon_id: string; unplayable?: boolean }[]).filter(w => w.unplayable).map(w => w.weapon_id);
    expect(marked.length).toBeGreaterThan(0);
    for (const id of marked) expect(UNPLAYABLE_IDS.has(id), id).toBe(true);
  });

  it('matches the server loadout pool for every policy case', () => {
    for (const testCase of cases.pool) {
      expect(computePool(testCase.policy as LoadoutPolicy, weapons, perks), testCase.name).toEqual(testCase.expect);
    }
  });

  it("the mock's apply() matches MC's for every apply case (MC leaves out a null perk and an emptied overrides)", () => {
    const shape = (lo: Loadout) => {
      const out: Record<string, unknown> = { weapons: lo.weapons };
      if (lo.perk != null) out.perk = lo.perk;
      if (lo.overrides && Object.keys(lo.overrides).length) out.overrides = lo.overrides;
      return out;
    };
    for (const testCase of (cases as unknown as { apply: { name: string; policy: LoadoutPolicy; loadout: Loadout; expect: unknown }[] }).apply) {
      const pool = computePool(testCase.policy, weapons, perks);
      expect(shape(mockApply(testCase.policy, testCase.loadout, pool, weapons)), testCase.name).toEqual(testCase.expect);
    }
  });

  it('matches both Easy Reload conflicts for every loadout case', () => {
    for (const testCase of cases.easy_reload) {
      const loadout = testCase.loadout as Loadout;
      expect({
        conflict: easyReloadConflict(loadout),
        chain_conflict: chainConflict(loadout, weapons),
      }, testCase.name).toEqual(testCase.expect);
    }
  });
});
