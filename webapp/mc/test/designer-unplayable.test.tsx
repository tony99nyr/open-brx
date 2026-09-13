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
});
