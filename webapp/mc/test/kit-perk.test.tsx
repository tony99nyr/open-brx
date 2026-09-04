// A14 (2026-09-04): the perk is its own slot on KIT — three cards, a perk rides beside the second weapon, and the one
// exception (Easy Reload takes the ALT button) is a two-tap confirm that drops the other thing, never a silent 400.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Loadout, Player } from '../src/api/types';
import { Designer } from '../src/screens/Designer';
import { Kit } from '../src/screens/Kit';
import { demo, mountScreen } from './harness';

/** Mount KIT on one demo player with every PATCH body recorded. */
async function kitFor(pid: string) {
  const d = await demo();
  const patches: Loadout[] = [];
  const api = {
    patchPlayer: async (id: string, patch: Partial<Player>) => { if (patch.loadout) patches.push(patch.loadout); return d.api.patchPlayer(id, patch); },
  };
  const m = await mountScreen(<Kit />, { ...d, view: 'kit', selPlayer: pid, api });
  const tile = async (label: string) => {
    const el = m.find(`[aria-label^="${label}"]`)[0];
    if (!el) throw new Error(`no tile ${label}`);
    await act(async () => { el.click(); });
  };
  return { m, patches, tile, state: d.state };
}

describe('KIT · perk slot (A14)', () => {
  it('shows three slot cards and the demo three-slot kit (AR + Desert Eagle + Quick Switch)', async () => {
    const { m, state } = await kitFor('p1');
    const p1 = state.players.find(p => p.player_id === 'p1')!;
    expect(p1.loadout).toEqual({ weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'deagle' }], perk: 'quick_switch' });
    const t = m.text();
    for (const s of ['PRIMARY', 'SECONDARY', 'PERK', 'ASSAULT RIFLE', 'DESERT EAGLE', 'QUICK SWITCH']) expect(t).toContain(s);
    expect(m.find('[aria-label="clear perk"]').length, 'the perk card has its own ✕ CLEAR').toBe(1);
    m.unmount();
  });

  it('picking a perk keeps the second weapon', async () => {
    const { m, patches, tile } = await kitFor('p1');
    await m.click('PERK');
    expect(m.text()).toContain('ARSENAL // PERK');
    await tile('Body Armor perk');
    expect(patches).toEqual([{ weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'deagle' }], perk: 'body_armor' }]);
    m.unmount();
  });

  it('Easy Reload beside a second weapon: first tap warns and sends nothing, second tap sends with the weapon dropped', async () => {
    const { m, patches, tile } = await kitFor('p1');
    await m.click('PERK');
    await tile('Easy Reload perk');
    expect(patches, 'the first tap must not PATCH').toEqual([]);
    expect(m.text()).toContain('DROPS THEIR DESERT EAGLE — TAP AGAIN');
    await tile('Easy Reload perk');
    expect(patches).toEqual([{ weapons: [{ weapon_id: 'assault_rifle' }], perk: 'easy_reload' }]);
    expect(m.text()).not.toContain('TAP AGAIN');
    m.unmount();
  });

  it('a second weapon beside Easy Reload: warns, then sends with the perk dropped', async () => {
    const { m, patches, tile, state } = await kitFor('p6');
    expect(state.players.find(p => p.player_id === 'p6')!.loadout).toEqual({ weapons: [{ weapon_id: 'assault_rifle' }], perk: 'easy_reload' });
    await m.click('SECONDARY');
    await tile('SMG,');
    expect(patches).toEqual([]);
    expect(m.text()).toContain('DROPS EASY RELOAD — TAP AGAIN');
    await tile('SMG,');
    expect(patches).toEqual([{ weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }], perk: null }]);
    m.unmount();
  });

  it('a perk that does not take the button warns about nothing (Body Armor beside a shotgun)', async () => {
    const { m, patches, tile } = await kitFor('p2');   // AR + shotgun, no perk
    await m.click('PERK');
    await tile('Body Armor perk');
    expect(patches).toEqual([{ weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'shotgun' }], perk: 'body_armor' }]);
    expect(m.text()).not.toContain('TAP AGAIN');
    m.unmount();
  });
});

describe('DESIGNER · perk rule (A14)', () => {
  it('renders a third PERK column with its own pool summary', async () => {
    const d = await demo();
    const m = await mountScreen(<Designer />, { ...d, view: 'designer' });
    expect(m.find('[aria-label="perk slot rules"]').length).toBe(1);
    expect(m.find('[data-testid="perk-summary"]')[0]?.textContent).toBe('5 OF 5 PERKS');
    expect(m.find('[data-testid="secondary-summary"]')[0]?.textContent).not.toContain('PERK');
    m.unmount();
  });
});
