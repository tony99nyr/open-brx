// Roadmap A6 — the recap's stations row: revives/hold reported by each utility station itself
// (utility.md §5c/§5d.6, `Session._recap_stations()` on the server side, `mcp/tests/test_mc_stations.py`).
// What is asserted here is the half a python test cannot see: the block RENDERS, is ABSENT when nothing
// was assigned, and shows the two failure-visible states (never heard from vs. a real number).
import { describe, expect, it } from 'vitest';
import { Recap } from '../src/screens/Recap';
import type { RecapView, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

const RECAP_ROWS = [{ player_id: 'p1', display: 'ALPHA', team_id: 'blue', kills: 3, deaths: 1, assists: 0,
  shots: 20, hits: 8, accuracy: 40, kd: 3, streak: 3, medals: [] }];

function recapWith(stations?: RecapView['stations']): RecapView {
  return { winner: { player_id: 'p1' }, score: {}, rows: RECAP_ROWS, honors: [], provisional: false, missing: [], stations };
}

describe('RECAP — the stations row (roadmap A6)', () => {
  it('is absent from the screen when no station reported anything', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap', recap: recapWith(undefined) };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap' });
    expect(m.find('[data-testid="recap-stations"]').length).toBe(0);
    m.unmount();
  });

  it('shows a respawn station\'s revive count', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap',
      recap: recapWith([{ node_id: 'util-a1b2c3', kind: 'respawn', id: 3, team: 1, heard: true, revives: 5 }]) };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap' });
    const block = m.find('[data-testid="recap-stations"]')[0];
    expect(block, `expected the stations block, saw: ${m.text()}`).toBeTruthy();
    expect(block.textContent).toMatch(/RESPAWN 3/);
    expect(block.textContent).toMatch(/5 REVIVES/);
    m.unmount();
  });

  it('a station never heard from says so instead of showing a fabricated zero', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap',
      recap: recapWith([{ node_id: 'util-a1b2c3', kind: 'respawn', id: 3, team: 1, heard: false, revives: null }]) };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap' });
    const block = m.find('[data-testid="recap-stations"]')[0];
    expect(block.textContent).toMatch(/NEVER HEARD FROM/);
    expect(block.textContent).not.toMatch(/0 REVIVES/);
    m.unmount();
  });

  it('shows a control point\'s owner and hold time', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap',
      recap: recapWith([{ node_id: 'util-d4e5f6', kind: 'control', id: 9, team: 255, heard: true, owner: 1, hold_ms: { '1': 45000 } }]) };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap' });
    const block = m.find('[data-testid="recap-stations"]')[0];
    expect(block.textContent).toMatch(/CONTROL POINT 9/);
    expect(block.textContent).toMatch(/HELD BY BLUE/);
    expect(block.textContent).toMatch(/BLUE 45s/);
    m.unmount();
  });

  // Finding 1 (review 2026-09-11, F105): extraction/powerup/bomb have no count of their own — before this
  // fix the block rendered NOTHING for them, so a station that never reported looked identical to one that
  // had. `heard` is the only signal there is for these three kinds.
  it('a never-heard extraction station says so, not silence', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap',
      recap: recapWith([{ node_id: 'util-d4e5f6', kind: 'extraction', id: 8, team: 255, heard: false }]) };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap' });
    const block = m.find('[data-testid="recap-stations"]')[0];
    expect(block, `expected the stations block, saw: ${m.text()}`).toBeTruthy();
    expect(block.textContent).toMatch(/EXTRACTION 8/);
    expect(block.textContent).toMatch(/NEVER HEARD FROM/);
    m.unmount();
  });

  it('a powerup station that reported shows REPORTED, not silence', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap',
      recap: recapWith([{ node_id: 'util-a1b2c3', kind: 'powerup', id: 4, team: 255, heard: true }]) };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap' });
    const block = m.find('[data-testid="recap-stations"]')[0];
    expect(block.textContent).toMatch(/POWERUP 4/);
    expect(block.textContent).toMatch(/REPORTED/);
    expect(block.textContent).not.toMatch(/NEVER HEARD FROM/);
    m.unmount();
  });
});
