// F404 (2026-09-25): Tony -- pickups are set up in ARMORY only and he wants to see them before the
// match. LOBBY gets one read-only line, reusing `ui/Powerups.tsx`'s own rows and enabled-flag rule
// (never a second renderer): the armed items, grey "NO PICKUPS" when none is armed, and nothing at all
// when the powerups flag is off.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api } from '../src/api/types';
import { Lobby } from '../src/screens/Lobby';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { fixtureApi, makeStore, mount } from './harness';

const NODE = 'util-a1b2c3';

async function lobby(over: Partial<Api> = {}) {
  const backend = new MockBackend();
  await backend.setPhase('lobby', true);
  const api = fixtureApi(over, backend as unknown as Api);
  const state = await backend.getState();
  const m = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'lobby' }, { api })}><Lobby /></StoreCtx.Provider>);
  await act(async () => { await new Promise(r => setTimeout(r, 5)); });   // let GET /api/powerups land
  return { m, backend, api };
}

describe('LOBBY — the read-only PICKUPS line', () => {
  it('lists every armed pickup by item and station', async () => {
    const { backend, api } = await lobby();
    await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield' });
    const state = await backend.getState();
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'lobby' }, { api })}><Lobby /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    const line = m.find('[data-testid="powerups-lobby-line"]')[0];
    expect(line, 'no PICKUPS line rendered').toBeTruthy();
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
    const { m } = await lobby({ getPowerups: async () => ({ enabled: false, presets: [] }) });
    expect(m.find('[data-testid="powerups-lobby-line"]').length).toBe(0);
    m.unmount();
  });
});
