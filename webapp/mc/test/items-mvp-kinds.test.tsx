// F405 (2026-09-25): Tony -- "so mvp for utility is respawn station, pickup, hill". The ARMORY kind
// picker offers only respawn/powerup/control; `extraction` and `bomb` keep their code, type and recap
// label (`KIND_LABEL`) so an OLD assignment of either still renders, selected, never crashing and never
// silently changed.
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { MockBackend } from '../src/mock/backend';
import { mountScreen } from './harness';
import type { State } from '../src/api/types';

const NODE = 'util-a1b2c3';

describe('ITEMS — the kind picker offers only the MVP station kinds', () => {
  it('a fresh station is offered only RESPAWN, POWERUP and CONTROL', async () => {
    const d = new MockBackend();
    const state = await d.getState();
    const m = await mountScreen(<Armory />, { state, view: 'muster' });
    const group = m.find(`[role="group"][aria-label="kind for ${NODE}"] button`);
    const labels = group.map(b => b.textContent?.trim());
    expect(labels).toEqual(['RESPAWN', 'POWERUP', 'CONTROL']);
    m.unmount();
  });

  it('an old EXTRACTION assignment still renders, selected, on its own card', async () => {
    const d = new MockBackend();
    const base = await d.getState();
    const state: State = { ...base, stations: base.stations!.map(s => s.node_id === NODE
      ? { ...s, assigned: { kind: 'extraction', team: 1, id: 3, threshold: -74 } } : s) };
    const m = await mountScreen(<Armory />, { state, view: 'muster' });
    // control: the card's own short label (F405 keeps `KIND_SHORT`/`KIND_LABEL` untouched) still shows it
    expect(m.find(`[data-station-card="${NODE}"]`)[0].textContent).toMatch(/EXTRACT/);
    const group = m.find(`[role="group"][aria-label="kind for ${NODE}"] button`);
    const labels = group.map(b => b.textContent?.trim());
    expect(labels).toEqual(['RESPAWN', 'POWERUP', 'CONTROL', 'EXTRACT']);
    const extractBtn = group.find(b => b.textContent?.trim() === 'EXTRACT');
    expect(extractBtn?.getAttribute('aria-pressed'), 'must not read as unset').toBe('true');
    m.unmount();
  });

  it('a BOMB assignment on one station never offers BOMB on a different, unassigned station', async () => {
    const d = new MockBackend();
    const base = await d.getState();
    const otherId = base.stations!.find(s => s.node_id !== NODE)!.node_id;
    const state: State = {
      ...base,
      stations: base.stations!.map(s => {
        if (s.node_id === NODE) return { ...s, assigned: { kind: 'bomb', team: 1, id: 4, threshold: -74 } };
        // the mock's second seeded phone defaults to an `extraction` fixture (F106(i)) -- reset it to
        // an ordinary unassigned respawn card so this test exercises a station nobody has touched yet.
        if (s.node_id === otherId) return { ...s, assigned: null, report: { ...s.report, kind: 'respawn' } };
        return s;
      }),
    };
    const m = await mountScreen(<Armory />, { state, view: 'muster' });
    const otherGroup = m.find(`[role="group"][aria-label="kind for ${otherId}"] button`);
    expect(otherGroup.map(b => b.textContent?.trim())).toEqual(['RESPAWN', 'POWERUP', 'CONTROL']);
    m.unmount();
  });
});
