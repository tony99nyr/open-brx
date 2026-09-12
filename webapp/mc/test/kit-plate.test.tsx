// KIT's slot plates — the `✕ CLEAR` control and the line it used to land on.
//
// `✕ CLEAR` is positioned in the plate's bottom-right corner, and the weapon's
// `SIDEARM · MAG 7 · RES 48` sat directly under it: two runs of text on top of each other, on every
// SECONDARY plate in every Kit screenshot we have (review 2026-09-12). Absolute position takes the
// control out of flow, so nothing was ever going to move aside for it.
//
// jsdom lays nothing out, so "do the two rectangles intersect" is measured in the browser by
// `npm run e2e:kit` (`checkSlotPlates`, which hard-fails when no plate has both). These are the
// cheap guards for the two things that make that measurement come out right: the room is reserved,
// and the line is allowed to wrap into it rather than being cut off.
import { describe, expect, it } from 'vitest';
import { Kit } from '../src/screens/Kit';
import type { State } from '../src/api/types';
import { StoreCtx } from '../src/store';
import { demo, makeStore, mount } from './harness';

async function kitScreen() {
  const d = await demo();
  const state: State = d.state;
  const store = makeStore({ ...d, state, view: 'kit', selPlayer: state.players[0]?.player_id ?? null });
  return mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
}

describe('KIT · a slot plate with a CLEAR control', () => {
  it('reserves the corner the control sits in', async () => {
    const m = await kitScreen();
    const clears = m.find('[data-slot-clear]');
    expect(clears.length, 'the demo player has a secondary and a perk to clear').toBeGreaterThan(0);
    for (const clear of clears) {
      const card = clear.parentElement as HTMLElement;
      const ammo = card.querySelector('[data-slot-ammo]') as HTMLElement | null;
      expect(ammo, `the ${clear.getAttribute('data-slot-clear')} plate has an ammo/effect line`).toBeTruthy();
      const row = ammo!.parentElement!.parentElement as HTMLElement;   // the icon + text row
      expect(parseFloat(row.style.paddingRight || '0'),
        `the ${clear.getAttribute('data-slot-clear')} plate keeps the control's corner clear`).toBeGreaterThanOrEqual(80);
    }
    m.unmount();
  });

  it('lets the line wrap rather than cutting the reserve count off', async () => {
    const m = await kitScreen();
    const ammo = m.find('[data-slot-ammo]');
    expect(ammo.length).toBeGreaterThan(0);
    for (const line of ammo) {
      expect(getComputedStyle(line).whiteSpace, `"${line.textContent}" must be able to wrap`).not.toBe('nowrap');
      expect(getComputedStyle(line).textOverflow).not.toBe('ellipsis');
    }
    // and the thing that would have been lost is still on screen
    expect(m.text()).toMatch(/RES \d+/);
    m.unmount();
  });

  it('a plate with nothing to clear reserves nothing', async () => {
    // PRIMARY is required, so it carries no CLEAR — and it must keep the full width for its line.
    const m = await kitScreen();
    const primary = m.find('[data-slot-ammo]').map(el => el.parentElement!.parentElement as HTMLElement)
      .filter(row => !(row.parentElement as HTMLElement).querySelector('[data-slot-clear]'));
    expect(primary.length, 'the PRIMARY plate has no CLEAR').toBeGreaterThan(0);
    for (const row of primary) expect(row.style.paddingRight === '' || row.style.paddingRight === '0px').toBe(true);
    m.unmount();
  });
});
