// F-9 (2026-09-13): the DESIGNER's "N OF {total} WEAPONS" summary must not count a weapon in
// UNPLAYABLE_IDS — it never leaves the catalogue (CATALOG and KIT both filter it out with the same
// constant, gameSummary.ts) and inflated every open slot's denominator by one.
//
// 2026-09-17 (arsenal review): the real `energy_launcher` row is now ALSO `hidden` (one of the 8
// arsenal cuts), so it no longer reaches the mock catalogue at all — `UNPLAYABLE_IDS` still names it
// (kept as-is per the arsenal-review brief) but the id is a no-op against `d.weapons` today. These
// tests still need a row that is PRESENT in the catalogue but UNPLAYABLE, so they add a synthetic one
// (same id, same shape a real row would have) rather than assert on the id no longer being there.
import { describe, expect, it } from 'vitest';
import { Designer } from '../src/screens/Designer';
import { UNPLAYABLE_IDS } from '../src/screens/gameSummary';
import { demo, mountScreen } from './harness';
import type { WeaponView } from '../src/api/types';

function withSyntheticLauncher(weapons: WeaponView[]): WeaponView[] {
  const template = weapons[0];
  const launcher: WeaponView = { ...template, weapon_id: 'energy_launcher', name: 'Energy Launcher',
    weapon_class: 'energy', role: 'power', tags: ['power', 'heavy'], caution: 'Known issue: deals no damage in our shipped config.' };
  return [...weapons, launcher];
}

describe('DESIGNER weapon count excludes the unplayable launcher', () => {
  it('an open PRIMARY slot reads "N OF <playable count> WEAPONS", not the full catalogue size', async () => {
    const d = await demo();
    const weapons = withSyntheticLauncher(d.weapons);
    // control: the catalogue really does carry the unplayable id
    expect(weapons.some(w => UNPLAYABLE_IDS.has(w.weapon_id)), 'control: fixture carries the launcher').toBe(true);
    const playable = weapons.filter(w => !UNPLAYABLE_IDS.has(w.weapon_id)).length;
    const m = await mountScreen(<Designer />, { state: d.state, weapons, perks: d.perks, view: 'build' });
    await new Promise(r => setTimeout(r, 0));
    const summary = m.find('[data-testid="primary-summary"]')[0];
    expect(summary, 'the primary slot summary chip').toBeTruthy();
    expect(summary.textContent).toContain(`OF ${playable} WEAPONS`);
    expect(summary.textContent).not.toContain(`OF ${weapons.length} WEAPONS`);
    m.unmount();
  });

  // 2a1c8623: the same filter (Designer.tsx ~line 287) also keeps the launcher out of the weapon
  // table itself, and out of the class chips built from that table. Before the filter, the table
  // still listed the launcher as a row that could never switch on, and the HEAVY chip counted it
  // as a member even though the pool (computePool, gameSummary.ts) never includes it.
  //
  // 2026-09-17 (arsenal review): rocket_launcher/rail_gun are `pickup_only` now, permanently out of
  // every pool. The HEAVY chip then read "◐ 0/2" under OPEN, a partial state no tap could complete.
  // M15 (visual QA 2026-09-23): a chip counts only the members the slot can actually take, so a class
  // with none (HEAVY today) has no chip, and a pickup-only row is not a control: it says PICKUP ONLY.
  it('renders no row for the launcher, no HEAVY chip, and PICKUP ONLY rows that are not buttons', async () => {
    const d = await demo();
    const weapons = withSyntheticLauncher(d.weapons);
    // control: the catalogue really does carry the unplayable id, tagged heavy
    const launcher = weapons.find(w => UNPLAYABLE_IDS.has(w.weapon_id));
    expect(launcher, 'control: fixture carries the launcher').toBeTruthy();
    expect(launcher!.tags ?? [], 'control: the launcher is tagged heavy').toContain('heavy');
    const m = await mountScreen(<Designer />, { state: d.state, weapons, perks: d.perks, view: 'build' });
    await new Promise(r => setTimeout(r, 0));
    // 1: no row or chip anywhere in the DESIGNER names the launcher
    const launcherRows = m.find('button[aria-label^="Energy Launcher"]');
    expect(launcherRows, 'no weapon row for the launcher').toHaveLength(0);
    // 2: under OPEN every HEAVY member is pickup_only, so the slot can take none of them: no chip.
    const primaryGroup = m.find('[aria-label="primary slot rules"]')[0];
    expect(primaryGroup, 'the primary slot group').toBeTruthy();
    const heavyChip = Array.from(primaryGroup.querySelectorAll('button')).find(b => (b.textContent ?? '').trim().endsWith('HEAVY'));
    expect(heavyChip, 'no HEAVY chip when the slot can take no heavy').toBeFalsy();
    expect(primaryGroup.textContent, 'no partial glyph for a class nobody can pick').not.toContain('0/2');
    // 3: the pickup-only rows say why, and are not buttons
    const pickup = weapons.filter(w => w.pickup_only && !UNPLAYABLE_IDS.has(w.weapon_id));
    expect(pickup.length, 'control: the demo carries pickup-only heavies').toBeGreaterThan(0);
    for (const w of pickup) {
      const rowEl = primaryGroup.querySelector(`[data-locked][aria-label^="${w.name}"]`);
      expect(rowEl, `${w.name} is a locked row`).toBeTruthy();
      expect(rowEl!.tagName).not.toBe('BUTTON');
      expect(rowEl!.textContent).toContain('PICKUP ONLY');
    }
    m.unmount();
  });
});
