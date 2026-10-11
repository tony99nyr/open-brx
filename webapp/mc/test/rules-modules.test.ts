import { describe, expect, it } from 'vitest';
import type { Loadout, WeaponView } from '../src/api/types';
import { STATION_DEFAULT_THRESHOLD_DBM } from '../src/api/contract.gen';
import { healthPresetOf, HEALTH_PRESETS } from '../src/rules/health';
import { chainConflict, DEFAULT_POLICY, easyReloadConflict, withPolicy } from '../src/rules/loadoutPolicy';
import { bubbleDefault } from '../src/rules/stationBubble';

describe('pure rules modules', () => {
  it('uses each platform default in the station bubble', () => {
    expect(bubbleDefault('respawn', false).start).toBe(STATION_DEFAULT_THRESHOLD_DBM.phone.respawn);
    expect(bubbleDefault('respawn', true).start).toBe(STATION_DEFAULT_THRESHOLD_DBM.sticks3.respawn);
  });
  it('recognises every health preset and custom values', () => {
    for (const [key, value] of Object.entries(HEALTH_PRESETS)) expect(healthPresetOf(value)).toBe(key);
    expect(healthPresetOf({ max_hp: 46, max_armor: 70, max_shield: 0 })).toBe('custom');
  });
  it('reports Easy Reload conflicts only when it takes ALT with a secondary', () => {
    const conflict: Loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'glock' }], overrides: { easy_reload: true } };
    expect(easyReloadConflict(conflict)).toEqual({ weapon: 'glock' });
    expect(easyReloadConflict({ ...conflict, overrides: {} })).toBeNull();
  });
  it('reports chain reload conflicts only for an equipped chain weapon', () => {
    const loadout: Loadout = { weapons: [{ weapon_id: 'shotgun' }], overrides: { easy_reload: true } };
    const weapons = [{ weapon_id: 'shotgun', reload_type: 'chain' }, { weapon_id: 'assault_rifle', reload_type: 'magazine' }] as WeaponView[];
    expect(chainConflict(loadout, weapons)).toEqual({ weapon: 'shotgun' });
    expect(chainConflict({ ...loadout, weapons: [{ weapon_id: 'assault_rifle' }] }, weapons)).toBeNull();
  });
  it('fills a missing policy with the default policy', () => {
    const config = { mode: 'ffa', scoring: {} } as Parameters<typeof withPolicy>[0];
    expect(withPolicy(config).loadout_policy).toEqual(DEFAULT_POLICY());
  });
});
