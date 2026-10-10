import { describe, expect, it } from 'vitest';
import cases from '../../../app/test/fixtures/policy-cases.json';
import type { Loadout, LoadoutPolicy, PerkView, WeaponView } from '../src/api/types';
import { chainConflict, computePool, easyReloadConflict } from '../src/screens/gameSummary';

describe('server policy shared cases', () => {
  const weapons = cases.weapons as unknown as WeaponView[];
  const perks = cases.perks as unknown as PerkView[];

  it('matches the server loadout pool for every policy case', () => {
    for (const testCase of cases.pool) {
      expect(computePool(testCase.policy as LoadoutPolicy, weapons, perks), testCase.name).toEqual(testCase.expect);
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
