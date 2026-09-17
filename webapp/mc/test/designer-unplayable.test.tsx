// F-9 (2026-09-13): the DESIGNER's "N OF {total} WEAPONS" summary must not count the launcher in
// UNPLAYABLE_IDS ('energy_launcher') — it never leaves the catalogue (CATALOG and KIT both filter it
// out with the same constant, gameSummary.ts) and inflated every open slot's denominator by one.
import { describe, expect, it } from 'vitest';
import { Designer } from '../src/screens/Designer';
import { UNPLAYABLE_IDS } from '../src/screens/gameSummary';
import { demo, mountScreen } from './harness';

describe('DESIGNER weapon count excludes the unplayable launcher', () => {
  it('an open PRIMARY slot reads "N OF <playable count> WEAPONS", not the full catalogue size', async () => {
    const d = await demo();
    // control: the mock catalogue really does carry the unplayable id
    expect(d.weapons.some(w => UNPLAYABLE_IDS.has(w.weapon_id)), 'control: fixture carries the launcher').toBe(true);
    const playable = d.weapons.filter(w => !UNPLAYABLE_IDS.has(w.weapon_id)).length;
    const m = await mountScreen(<Designer />, { state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' });
    await new Promise(r => setTimeout(r, 0));
    const summary = m.find('[data-testid="primary-summary"]')[0];
    expect(summary, 'the primary slot summary chip').toBeTruthy();
    expect(summary.textContent).toContain(`OF ${playable} WEAPONS`);
    expect(summary.textContent).not.toContain(`OF ${d.weapons.length} WEAPONS`);
    m.unmount();
  });

  // 2a1c8623: the same filter (Designer.tsx ~line 287) also keeps the launcher out of the weapon
  // table itself, and out of the class chips built from that table. Before the filter, the table
  // still listed the launcher as a row that could never switch on, and the HEAVY chip counted it
  // as a member even though the pool (computePool, gameSummary.ts) never includes it — so under the
  // OPEN policy, where every other heavy weapon is allowed, the chip read partial ("mixed") instead
  // of fully on.
  it('renders no row for the launcher, and the HEAVY chip reads on (not mixed) under OPEN', async () => {
    const d = await demo();
    // control: the mock catalogue really does carry the unplayable id, tagged heavy
    const launcher = d.weapons.find(w => UNPLAYABLE_IDS.has(w.weapon_id));
    expect(launcher, 'control: fixture carries the launcher').toBeTruthy();
    expect(launcher!.tags ?? [], 'control: the launcher is tagged heavy').toContain('heavy');
    const m = await mountScreen(<Designer />, { state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' });
    await new Promise(r => setTimeout(r, 0));
    // 1: no row or chip anywhere in the DESIGNER names the launcher
    const launcherRows = m.find('button[aria-label^="Energy Launcher"]');
    expect(launcherRows, 'no weapon row for the launcher').toHaveLength(0);
    // 2: under OPEN (the demo's default policy, no excluded tags or ids) the primary slot's HEAVY
    // chip is fully on, since every OTHER heavy weapon is still allowed.
    const primaryGroup = m.find('[aria-label="primary slot rules"]')[0];
    expect(primaryGroup, 'the primary slot group').toBeTruthy();
    const heavyChip = Array.from(primaryGroup.querySelectorAll('button')).find(b => (b.textContent ?? '').includes('HEAVY'));
    expect(heavyChip, 'the HEAVY chip').toBeTruthy();
    expect(heavyChip!.getAttribute('aria-pressed')).toBe('true');
    m.unmount();
  });
});
