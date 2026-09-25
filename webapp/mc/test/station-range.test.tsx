// A67 (F365): the ITEMS card shows a station's RANGE and STRENGTH, says when the value was edited ON THE STATION,
// and carries a STRENGTH control. The server half (last edit wins, per field) is `mcp/tests/test_station_range.py`.
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { makeStore, mount, mountScreen } from './harness';
import type { Api, State, StationView } from '../src/api/types';

async function withStation(patch: Partial<StationView>): Promise<State> {
  const base = await new MockBackend().getState();
  const st: StationView = { ...base.stations![0],
    assigned: { kind: 'respawn', team: 1, id: 3, threshold: -60, at: 1, threshold_src: 'station', tx_power: 'medium', tx_power_src: 'mc' },
    armed: { game: 1, at: 0, kind: 'respawn', team: 1, id: 3 }, arm_pending: false, attention: [],
    report: { ...base.stations![0].report, threshold: -60, tx_power: 'medium' }, ...patch };
  return { ...base, stations: [st], game_no: 1, game_byte: 1 };
}

const card = (m: { find: (s: string) => HTMLElement[] }) => m.find('[data-station-card="util-a1b2c3"]')[0];

describe('ITEMS — a station range edited on the station (A67)', () => {
  it('shows RANGE and STRENGTH, marked EDITED ON STATION only when the station set the value', async () => {
    const state = await withStation({ range: { threshold: -60, threshold_src: 'station', threshold_edit_age_ms: 125_000,
      tx_power: 'medium', tx_power_src: 'mc' } });
    const m = await mountScreen(<Armory />, { state, view: 'muster' });
    const range = m.find('[data-station-range="util-a1b2c3"]')[0];
    const strength = m.find('[data-station-strength="util-a1b2c3"]')[0];
    expect(range.textContent).toMatch(/^-60 dBm · EDITED ON STATION .+ AGO$/);
    // CONTROL: MC's own value carries no EDITED mark
    expect(strength.textContent).toBe('MEDIUM');
    expect(card(m).textContent).toMatch(/strength changes range too/);
    m.unmount();
  });

  it('the STRENGTH control PUTs tx_power with the adopted threshold, not a stale draft', async () => {
    const state = await withStation({ range: { threshold: -60, threshold_src: 'station', tx_power: 'medium', tx_power_src: 'mc' } });
    const puts: unknown[] = [];
    const api: Partial<Api> = { putStation: (async (_n: string, a: unknown) => { puts.push(a); return state.stations![0]; }) as Api['putStation'] };
    const m = await mountScreen(<Armory />, { state, view: 'muster', api });
    const group = m.find('[role="group"][aria-label="strength for util-a1b2c3"]')[0];
    expect(group, 'a STRENGTH control on the card').toBeTruthy();
    // CONTROL: nothing is dirty before the operator touches it
    expect(m.find('[data-station-card="util-a1b2c3"] button').some(b => b.textContent?.trim() === 'ARMED')).toBe(true);
    const high = Array.from(group.querySelectorAll('button')).find(b => b.textContent?.trim() === 'HIGH')!;
    const { act } = await import('react');
    await act(async () => { high.click(); });
    await m.click('ARM WITH CHANGES');
    expect(puts).toEqual([{ kind: 'respawn', team: 1, id: 3, threshold: -60, tx_power: 'high' }]);
    m.unmount();
  });

  it('a threshold MC adopted from the station moves the draft, so the card does not read as changed', async () => {
    const state = await withStation({});
    const render = (st: State) => (<StoreCtx.Provider value={makeStore({ state: st, view: 'muster' })}><Armory /></StoreCtx.Provider>);
    const m = await mount(render(state));
    const armed = () => m.find('[data-station-card="util-a1b2c3"] button').some(b => b.textContent?.trim() === 'ARMED');
    expect(armed()).toBe(true);
    // the same assignment (same `at`), its threshold adopted from a station edit
    const next = { ...state, stations: [{ ...state.stations![0], assigned: { ...state.stations![0].assigned!, threshold: -64 } }] };
    await m.update(render(next));
    expect(armed(), 'an on-station edit is not an operator change to re-send').toBe(true);
    m.unmount();
  });

  it('a station that reports no strength (a phone that cannot set it) shows no STRENGTH control', async () => {
    const base = await withStation({});
    const state = { ...base, stations: [{ ...base.stations![0], report: { ...base.stations![0].report, tx_power: undefined } }] };
    const m = await mountScreen(<Armory />, { state, view: 'muster' });
    expect(m.find('[role="group"][aria-label="strength for util-a1b2c3"]').length).toBe(0);
    expect(card(m).textContent).not.toMatch(/strength changes range too/);
    m.unmount();
  });
});
