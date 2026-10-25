// Honest pickers (Tony 2026-10-25): "picking Armour Piercing and then finding out at config push that the chosen weapon
// cannot carry it is not fun". With a perk held, KIT offers only the weapons it can ride with (`PerkView.blocked_*`, from
// the catalogue); the Shields health preset refuses Armour Piercing and Body Armor (`PerkView.blocked_presets`), and a
// switch to it clears them with no warning, as state.py does.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Loadout, Player } from '../src/api/types';
import { Kit } from '../src/screens/Kit';
import { demo, mountScreen } from './harness';

async function kitWithAp() {
  const d = await demo();
  await d.api.patchPlayer('p1', { loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: 'armor_piercing' } });
  const patches: Loadout[] = [];
  const api = {
    patchPlayer: async (id: string, patch: Partial<Player>) => { if (patch.loadout) patches.push(patch.loadout); return d.api.patchPlayer(id, patch); },
  };
  const m = await mountScreen(<Kit />, { ...d, state: await d.api.getState(), view: 'kit', selPlayer: 'p1', api });
  return { d, m, patches };
}

describe('KIT · honest pickers', () => {
  it('with Armour Piercing held, a primary it cannot ride with is disabled with a short reason, and a tap sends nothing', async () => {
    const { m, patches } = await kitWithAp();
    await m.click('PRIMARY');
    const sniper = m.find('[aria-label^="Sniper Rifle,"]')[0];
    expect(sniper.getAttribute('aria-disabled')).toBe('true');
    expect(sniper.getAttribute('aria-label')).toContain('does not work with Armor Piercing');
    expect(sniper.getAttribute('title')).toBe('Does not work with Armor Piercing');
    await act(async () => { sniper.click(); });
    expect(patches).toEqual([]);
    // control: a primary it can ride with stays offered
    const smg = m.find('[aria-label^="SMG,"]')[0];
    expect(smg.getAttribute('aria-disabled')).toBeNull();
    m.unmount();
  });

  it('a switch to the Shields health preset clears Armour Piercing silently and stops offering it', async () => {
    const { d, m } = await kitWithAp();
    await act(async () => { await d.api.putConfig({ health: { max_hp: 45, max_armor: 0, max_shield: 105, preset: 'shields' } }); });
    const st = await d.api.getState();
    expect(st.players.find(p => p.player_id === 'p1')!.loadout.perk ?? null).toBeNull();
    expect(st.loadout_pool.perks).not.toContain('armor_piercing');
    expect(st.loadout_pool.perks).not.toContain('body_armor');
    m.unmount();
  });
});
