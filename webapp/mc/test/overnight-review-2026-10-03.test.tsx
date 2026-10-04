// Overnight adversarial review 2026-10-03: the ITEMS findings M1, L4 (mock), L6, L7 and L8 (mock).
// The server halves of L4 and L8 are `mcp/tests/test_mc_stations.py` (test_l4_*, test_l8_*).
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { MC_OLDER } from '../src/alerts';
import { makeStore, mount } from './harness';
import type { Api, State } from '../src/api/types';

const NODE = 'util-a1b2c3';

/** Mount ARMORY on the mock with a `run` that records the error the command bar would show. */
async function armory(api: MockBackend, phase?: State['phase']) {
  let state: State = await api.getState();
  let error: string | null = null;
  const run: <T,>(fn: () => Promise<T>) => Promise<T | undefined> = async fn => {
    try { error = null; return await fn(); } catch (e) { error = (e as Error).message; return undefined; }
  };
  const view = () => (phase ? { ...state, phase } : state);
  const render = () => (<StoreCtx.Provider value={makeStore({ state: view(), view: 'muster' }, { api, run })}><Armory /></StoreCtx.Provider>);
  const m = await mount(render());
  await m.update(render());   // let the GET /api/powerups effect land
  return { m, error: () => error, settle: async () => { state = await api.getState(); await m.update(render()); } };
}

/** An MC from before S-powerup-overrides: it takes the PUT, answers 200, and ignores charges/amount/spawn_every_s. */
function olderMc(api: MockBackend) {
  const real = api.putStation.bind(api);
  api.putStation = (async (n, a) => {
    const { charges: _c, amount: _a, spawn_every_s: _s, ...rest } = a;
    return real(n, rest);
  }) as Api['putStation'];
}

/** A powerup phone with an override, released, then back as a utility: RESTORE is on its card. */
async function returnedPowerup() {
  const api = new MockBackend();
  await api.putStation(NODE, { kind: 'powerup', team: 'any', item_preset: 'rockets', charges: 3, spawn_every_s: 180 });
  await api.releaseStation(NODE);
  api.confirmStationHud(NODE);
  api.utilityHello(NODE);
  return api;
}

const plusCharges = (m: Awaited<ReturnType<typeof armory>>['m']) =>
  m.find(`button[aria-label="charges for ${NODE} plus"]`)[0] as HTMLButtonElement;

describe('M1: an older MC that drops the overrides is caught, never a silent success', () => {
  it('ASSIGN + ARM with CHARGES 4 on an older MC shows the version-skew line on the card and the bar', async () => {
    const api = new MockBackend();
    olderMc(api);
    const { m, error } = await armory(api);
    await m.click('POWERUP');
    await m.click(/^ROCKETS/);
    await act(async () => { plusCharges(m).click(); });
    await act(async () => { plusCharges(m).click(); });
    await m.click('ASSIGN + ARM');
    expect(error() ?? '').toMatch(new RegExp(`^${MC_OLDER.what}: ${MC_OLDER.act} \\(\\./start\\.sh\\)`));
    const strip = m.find('[data-testid="station-apply-error"]')[0]?.textContent ?? '';
    expect(strip).toContain(MC_OLDER.what);
    expect(strip, 'the station did arm (with the defaults), so the line does not say NOT ARMED').not.toMatch(/NOT ARMED/);
    m.unmount();
  });

  it('CONTROL: the same apply on a current MC raises nothing', async () => {
    const api = new MockBackend();
    const { m, error } = await armory(api);
    await m.click('POWERUP');
    await m.click(/^ROCKETS/);
    await act(async () => { plusCharges(m).click(); });
    await m.click('ASSIGN + ARM');
    expect(error()).toBeNull();
    expect(m.find('[data-testid="station-apply-error"]')).toHaveLength(0);
    m.unmount();
  });

  it('RESTORE of a station with an override on an older MC shows the same line', async () => {
    const api = await returnedPowerup();
    olderMc(api);
    const { m, error, settle } = await armory(api);
    await m.click('RESTORE');
    await settle();
    // the card remounts on the new assignment (its key carries `assigned.at`), so the command bar carries the line
    expect(error() ?? '').toMatch(new RegExp(`^${MC_OLDER.what}`));
    m.unmount();
  });

  it('CONTROL: RESTORE on a current MC keeps the override and raises nothing', async () => {
    const api = await returnedPowerup();
    const { m, error, settle } = await armory(api);
    await m.click('RESTORE');
    await settle();
    expect(error()).toBeNull();
    expect((await api.getState()).stations!.find(s => s.node_id === NODE)!.assigned!.item).toMatchObject({ charges: 3, spawn_every_s: 180 });
    m.unmount();
  });
});

describe('L6 and L7: RESTORE and DISMISS on the station card', () => {
  it('L6: RESTORE is not offered while the match is ARMED or LIVE; CONTROL: it is in the lobby', async () => {
    const api = await returnedPowerup();
    for (const phase of ['armed', 'live'] as const) {
      const { m } = await armory(api, phase);
      expect(m.find('[data-testid="station-restore"]'), phase).toHaveLength(0);
      m.unmount();
    }
    const { m } = await armory(api);
    expect(m.find('[data-testid="station-restore"]')).toHaveLength(1);
    m.unmount();
  });

  it('L7: DISMISS sits beside RESTORE on the returned station\'s own card and drops the departure', async () => {
    const api = await returnedPowerup();
    const { m, settle } = await armory(api);
    const card = m.find(`[data-station-card="${NODE}"]`)[0];
    expect(card.querySelector('[data-testid="station-departure-dismiss"] button')).toBeTruthy();
    await m.click('DISMISS');
    await settle();
    expect((await api.getState()).station_departures).toEqual([]);
    expect(m.find('[data-testid="station-departure"]')).toHaveLength(0);
    m.unmount();
  });
});

describe('mock parity: L4 and L8', () => {
  it('L4: the same item_preset with no override key keeps the stored overrides; any override key replaces them', async () => {
    const api = new MockBackend();
    await api.putStation(NODE, { kind: 'powerup', team: 'any', item_preset: 'rockets', charges: 3, spawn_every_s: 180 });
    const v = await api.putStation(NODE, { kind: 'powerup', team: 'any', item_preset: 'rockets', threshold: -60 });
    expect(v.assigned).toMatchObject({ threshold: -60, item: { charges: 3, spawn_every_s: 180 } });
    const v2 = await api.putStation(NODE, { kind: 'powerup', team: 'any', item_preset: 'rockets', spawn_every_s: 120, charges: 2 });
    expect(v2.assigned!.item).toMatchObject({ charges: 2, spawn_every_s: 120 });
    const v3 = await api.putStation(NODE, { kind: 'powerup', team: 'any', item_preset: 'overshield' });
    expect(v3.assigned!.item!.kind).toBe('overshield');
    expect(v3.assigned!.item!.charges).toBeUndefined();
  });

  it('L8: once the phone is back as a utility, the label is the device again, not a player\'s HUD', async () => {
    const api = new MockBackend();
    await api.putStation(NODE, { kind: 'respawn', team: 'any' });
    const bound = (await api.getState()).players.find(p => p.node_id)!;
    await api.releaseStation(NODE);
    api.confirmStationHud(NODE, bound.node_id!);
    expect((await api.getState()).station_departures![0].label, 'CONTROL: a HUD before the return').toMatch(/^NOW /);
    api.utilityHello(NODE);
    const d = (await api.getState()).station_departures![0];
    expect(d.returned).toBe(true);
    expect(d.label).toBe('PHONE util-a1b2c3');
    expect(d.line).not.toMatch(/'S HUD/);
  });
});
