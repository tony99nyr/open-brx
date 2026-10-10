// F404 (2026-09-25): Tony -- pickups are set up in ARMORY only and he wants to see them before the
// match. LOBBY gets one read-only line, reusing `ui/Powerups.tsx`'s own rows and enabled-flag rule
// (never a second renderer): the armed items, grey "NO PICKUPS" when none is armed, and nothing at all
// when the powerups flag is off.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { Api } from '../src/api/types';
import { Lobby } from '../src/screens/Lobby';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { fixtureApi, makeStore, mount } from './harness';

const NODE = 'util-a1b2c3';
afterEach(() => { vi.useRealTimers(); });

async function lobby(over: Partial<Api> = {}, waitForPowerups = true) {
  const backend = new MockBackend();
  await backend.setPhase('lobby', true);
  const api = fixtureApi(over, backend as unknown as Api);
  const getPowerups = vi.spyOn(api, 'getPowerups');
  const state = await backend.getState();
  const m = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'lobby' }, { api })}><Lobby /></StoreCtx.Provider>);
  if (waitForPowerups) await vi.waitFor(async () => {
    expect(getPowerups).toHaveBeenCalled();
    await expect(getPowerups.mock.results[0]!.value).resolves.toBeDefined();
  });
  return { m, backend, api };
}

describe('LOBBY — the read-only PICKUPS line', () => {
  it('lists every armed pickup by item and station', async () => {
    const { backend, api } = await lobby();
    await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield' });
    const state = await backend.getState();
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'lobby' }, { api })}><Lobby /></StoreCtx.Provider>);
    await vi.waitFor(() => expect(m.find('[data-testid="powerups-lobby-line"]')[0], 'no PICKUPS line rendered').toBeTruthy());
    const line = m.find('[data-testid="powerups-lobby-line"]')[0];
    expect(line.textContent).toMatch(/^PICKUPS: OVERSHIELD · PHONE 4$/);
    m.unmount();
  });

  it('shows grey NO PICKUPS when the flag is on but nothing is armed', async () => {
    const { m } = await lobby();
    const line = m.find('[data-testid="powerups-lobby-line"]')[0];
    expect(line, 'no PICKUPS line rendered').toBeTruthy();
    expect(line.textContent).toBe('NO PICKUPS');
    m.unmount();
  });

  it('renders nothing at all when MC says the powerups flag is off', async () => {
    vi.useFakeTimers();
    const { m } = await lobby({ getPowerups: async () => ({ enabled: false, presets: [] }) }, false);
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(m.find('[data-testid="powerups-lobby-line"]').length).toBe(0);
    m.unmount();
  });
});
