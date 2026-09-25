// A58: StationAlerts (the LOBBY/ARMED/LIVE strip for a station's `STATION #N ...` attention lines and,
// on ARMED/LIVE, UNLOCK STATIONS) and the ITEMS card's LOCKED tag. Mirrors items-powerups.test.tsx's
// harness -- a MockBackend-backed store, asserted against the rendered card/strip, not internal state.
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StationAlerts } from '../src/ui/StationAlerts';
import { Items } from '../src/screens/Items';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { makeStore, mount } from './harness';
import type { Api, State, StationView } from '../src/api/types';

/** A full StationView for one ASSIGNED respawn station, with `over` layered on top -- mirrors `row()`'s
 *  shape in items-powerups.test.tsx. */
function station(node_id: string, over: Partial<StationView> = {}): StationView {
  return {
    node_id, assigned: { kind: 'respawn', team: 255, id: 1, threshold: -74, at: 0 },
    armed: { game: 1, at: 0, kind: 'respawn', team: 255, id: 1 }, arm_pending: false,
    report: { kind: 'respawn', team: 255, station_id: 1, threshold: -74, live: true, armed: true },
    last_seen_ms: 0, online: true, attention: [], game: 1, ...over,
  };
}

/** `<StationAlerts />` (or `showUnlock`) against a MockBackend store carrying exactly `stations`. */
async function alerts(stations: StationView[], opts: { showUnlock?: boolean; over?: Partial<Api>; now?: () => number } = {}) {
  const api = new MockBackend();
  Object.assign(api, opts.over ?? {});
  const base = await api.getState();
  const state: State = { ...base, stations };
  let error: string | null = null;
  const run: <T,>(fn: () => Promise<T>) => Promise<T | undefined> = async fn => {
    try { error = null; return await fn(); } catch (e) { error = (e as Error).message; return undefined; }
  };
  const node = () => (
    <StoreCtx.Provider value={makeStore({ state, view: 'live' }, { api, run, ...(opts.now ? { serverNow: opts.now } : {}) })}>
      <StationAlerts showUnlock={opts.showUnlock} />
    </StoreCtx.Provider>
  );
  const m = await mount(node());
  await m.update(node());
  return { m, api, error: () => error };
}

describe('StationAlerts — the STATION #N attention lines', () => {
  it('renders a RESTARTED line', async () => {
    const { m } = await alerts([station('a', { attention: ['STATION #4 RESTARTED 2 TIMES'] })]);
    expect(m.find('[data-testid="station-alerts"]').length, m.text()).toBe(1);
    expect(m.text()).toContain('STATION #4 RESTARTED 2 TIMES');
    m.unmount();
  });

  it('renders an OFFLINE line', async () => {
    const { m } = await alerts([station('a', { attention: ['STATION #4 OFFLINE'] })]);
    expect(m.text()).toContain('STATION #4 OFFLINE');
    m.unmount();
  });

  it('renders a LOCK EXPIRES MID-MATCH line', async () => {
    const { m } = await alerts([station('a', { attention: ['STATION #4 LOCK EXPIRES MID-MATCH, REJOIN IT'] })]);
    expect(m.text()).toContain('STATION #4 LOCK EXPIRES MID-MATCH, REJOIN IT');
    m.unmount();
  });

  // M5 (visual QA 2026-09-24): every attention line of an assigned station now reaches this strip, BATTERY LOW included.
  it('lists every attention line, from more than one station, a non-STATION flag included', async () => {
    const { m } = await alerts([
      station('a', { attention: ['STATION #1 RESTARTED', 'BATTERY LOW'] }),
      station('b', { attention: ['STATION #2 OFFLINE'] }),
    ]);
    expect(m.text()).toContain('STATION #1 RESTARTED');
    expect(m.text()).toContain('STATION #2 OFFLINE');
    expect(m.text()).toContain('BATTERY LOW');
    m.unmount();
  });

  it('ignores an UNASSIGNED station entirely', async () => {
    const { m } = await alerts([station('a', { assigned: null, attention: ['STATION #1 RESTARTED'] })]);
    expect(m.find('[data-testid="station-alerts"]').length).toBe(0);
    m.unmount();
  });

  it('renders nothing with no matching flags and no active lock', async () => {
    const { m } = await alerts([station('a')]);
    expect(m.find('[data-testid="station-alerts"]').length).toBe(0);
    expect(m.text()).toBe('');
    m.unmount();
  });

  it('with showUnlock and no lock and no flags: still nothing', async () => {
    const { m } = await alerts([station('a')], { showUnlock: true });
    expect(m.find('[data-testid="station-alerts"]').length).toBe(0);
    m.unmount();
  });
});

describe('StationAlerts — UNLOCK STATIONS', () => {
  it('with showUnlock, shows the header and the button from an active lock alone, with no attention lines', async () => {
    const { m } = await alerts([station('a', { lock_until_ms: Date.now() + 60_000 })], { showUnlock: true });
    expect(m.find('[data-testid="station-alerts"]').length, m.text()).toBe(1);
    expect(m.find('[data-testid="station-unlock"]').length).toBe(1);
    m.unmount();
  });

  it('without showUnlock, an active lock alone shows nothing -- no header, no button', async () => {
    const { m } = await alerts([station('a', { lock_until_ms: Date.now() + 60_000 })]);
    expect(m.find('[data-testid="station-alerts"]').length, 'no strip for a lock alone').toBe(0);
    m.unmount();
  });

  it('requires two taps and calls unlockStations exactly once', async () => {
    let calls = 0;
    const { m, error } = await alerts(
      [station('a', { lock_until_ms: Date.now() + 60_000 })],
      { showUnlock: true, over: { unlockStations: async () => { calls++; return { ok: true, armed: 1, pending: [] }; } } as Partial<Api> },
    );
    expect(m.find('[data-testid="station-unlock"]').length).toBe(1);
    await m.click('UNLOCK STATIONS');
    expect(calls, 'one tap sends nothing').toBe(0);
    expect(m.text()).toMatch(/TAP UNLOCK STATIONS AGAIN/);
    await m.click('UNLOCK STATIONS');
    expect(calls).toBe(1);
    expect(error()).toBeNull();
    m.unmount();
  });

  it('a CANCEL backs out with no call', async () => {
    let calls = 0;
    const { m } = await alerts(
      [station('a', { lock_until_ms: Date.now() + 60_000 })],
      { showUnlock: true, over: { unlockStations: async () => { calls++; return { ok: true, armed: 1, pending: [] }; } } as Partial<Api> },
    );
    await m.click('UNLOCK STATIONS');
    await m.click('CANCEL');
    expect(m.text()).not.toMatch(/TAP UNLOCK STATIONS AGAIN/);
    expect(calls).toBe(0);
    m.unmount();
  });

  it('a refusal reaches the operator and shows inline on the row', async () => {
    const MSG = 'THE MC SERVER PREDATES THIS UI (no unlock route). RESTART IT: python -m brx_mcp.mc';
    const { m, error } = await alerts(
      [station('a', { lock_until_ms: Date.now() + 60_000 })],
      { showUnlock: true, over: { unlockStations: async () => { throw new Error(MSG); } } as Partial<Api> },
    );
    await m.click('UNLOCK STATIONS');
    await m.click('UNLOCK STATIONS');
    expect(error()).toBe(MSG);
    expect(m.find('[data-testid="station-unlock-error"]')[0]?.textContent).toContain(MSG);
    m.unmount();
  });

  it('no UNLOCK STATIONS for a lock that has already run out (MC clock)', async () => {
    const { m } = await alerts([station('a', { lock_until_ms: 5_000 })], { showUnlock: true, now: () => 10_000 });
    expect(m.find('[data-testid="station-unlock"]').length).toBe(0);
    m.unmount();
  });

  it('the confirm expires after 8 s, so a later tap only arms it again', async () => {
    let calls = 0;
    const { m } = await alerts(
      [station('a', { lock_until_ms: Date.now() + 600_000 })],
      { showUnlock: true, over: { unlockStations: async () => { calls++; return { ok: true, armed: 1, pending: [] }; } } as Partial<Api> },
    );
    vi.useFakeTimers();
    try {
      await m.click('UNLOCK STATIONS');
      expect(m.text()).toMatch(/TAP UNLOCK STATIONS AGAIN/);
      await act(async () => { await vi.advanceTimersByTimeAsync(8001); });
      expect(m.text()).not.toMatch(/TAP UNLOCK STATIONS AGAIN/);
      await m.click('UNLOCK STATIONS');
      expect(calls, 'the stale confirm did not fire').toBe(0);
    } finally {
      vi.useRealTimers();
      m.unmount();
    }
  });

  it('no UNLOCK STATIONS once every assigned station is unlocked', async () => {
    const { m } = await alerts([station('a', { lock_until_ms: undefined })], { showUnlock: true });
    expect(m.find('[data-testid="station-unlock"]').length).toBe(0);
    m.unmount();
  });
});

describe('ITEMS — the LOCKED tag', () => {
  async function itemsWith(over: Partial<StationView>, now = () => Date.now()) {
    const api = new MockBackend();
    const base = await api.getState();
    const state: State = { ...base, stations: [station('a', over)] };
    const node = () => <StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api, serverNow: now })}><Items /></StoreCtx.Provider>;
    const m = await mount(node());
    await m.update(node());
    return { m, card: () => m.find('[data-station-card="a"]')[0] };
  }

  it('shows LOCKED while lock_until_ms is in the future', async () => {
    const { m, card } = await itemsWith({ lock_until_ms: Date.now() + 120_000 });
    expect(m.find('[data-testid="station-locked"]').length, card()?.textContent).toBe(1);
    m.unmount();
  });

  it('does not show LOCKED once lock_until_ms is in the past', async () => {
    const { m } = await itemsWith({ lock_until_ms: Date.now() - 1000 });
    expect(m.find('[data-testid="station-locked"]').length).toBe(0);
    m.unmount();
  });

  it('does not show LOCKED when lock_until_ms is absent', async () => {
    const { m } = await itemsWith({ lock_until_ms: undefined });
    expect(m.find('[data-testid="station-locked"]').length).toBe(0);
    m.unmount();
  });
});

describe('ITEMS — a StickS3 is named as one, not as a phone', () => {
  async function itemsWith(stations: StationView[]) {
    const api = new MockBackend();
    const base = await api.getState();
    const state: State = { ...base, stations };
    const node = () => <StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api })}><Items /></StoreCtx.Provider>;
    const m = await mount(node());
    await m.update(node());
    return m;
  }

  it('an unassigned esp32 station reads STICKS3, and a phone still reads UTILITY PHONE', async () => {
    // brx4, 2026-09-24: the first real Stick on MC was listed as "UTILITY PHONE stick-1cc3e1".
    const m = await itemsWith([
      station('stick-1cc3e1', { assigned: null, armed: null, platform: 'esp32' }),
      station('util-phone1', { assigned: null, armed: null, platform: 'android' }),
    ]);
    const stick = m.find('[data-station-card="stick-1cc3e1"]')[0]?.textContent ?? '';
    const phone = m.find('[data-station-card="util-phone1"]')[0]?.textContent ?? '';
    expect(stick).toMatch(/STICKS3/);
    expect(stick).not.toMatch(/PHONE/);
    expect(phone).toMatch(/UTILITY PHONE/);
    expect(m.text()).toMatch(/2 STATIONS/);
    m.unmount();
  });
});

describe('ITEMS — the ASSIGN + ARM form (Block 9, brx4)', () => {
  async function itemsWith(stations: StationView[], over: Partial<Api> = {}) {
    const api = new MockBackend();
    Object.assign(api, over);
    const base = await api.getState();
    const state: State = { ...base, stations };
    let error: string | null = null;
    const run: <T,>(fn: () => Promise<T>) => Promise<T | undefined> = async fn => {
      try { error = null; return await fn(); } catch (e) { error = (e as Error).message; return undefined; }
    };
    const node = () => <StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api, run })}><Items /></StoreCtx.Provider>;
    const m = await mount(node());
    await m.update(node());
    return { m, error: () => error };
  }
  const unarmed = (id: string, over: Partial<StationView> = {}) => station(id, {
    assigned: null, armed: null, platform: 'esp32',
    report: { kind: 'respawn', team: 255, station_id: 0, threshold: -74, live: false, armed: false }, ...over });

  it('a station reporting id 0 can ASSIGN + ARM: the console sends no id and MC assigns one (F364)', async () => {
    const sent: { id?: number }[] = [];
    const { m } = await itemsWith([
      station('taken', { assigned: { kind: 'respawn', team: 255, id: 1, threshold: -74, at: 0 } }),
      unarmed('stick-1'),
    ], { putStation: async (_n: string, a: { id?: number }) => { sent.push(a); return station('stick-1'); } } as unknown as Partial<Api>);
    expect(m.find('input[aria-label="station id for stick-1"]'), 'no id input').toHaveLength(0);
    const card = m.find('[data-station-card="stick-1"]')[0] as HTMLElement;
    const btn = [...card.querySelectorAll('button')].find(b => b.textContent === 'ASSIGN + ARM') as HTMLButtonElement;
    await act(async () => { btn.click(); });
    expect(sent.length).toBe(1);
    expect(sent[0].id).toBeUndefined();
    m.unmount();
  });

  it('a write the server refuses for auth says the operator link expired, on the card itself', async () => {
    const { AuthError } = await import('../src/api/client');
    const { m } = await itemsWith([unarmed('stick-1')], { putStation: async () => { throw new AuthError(); } } as unknown as Partial<Api>);
    const card = () => m.find('[data-station-card="stick-1"]')[0] as HTMLElement;
    const btn = [...card().querySelectorAll('button')].find(b => b.textContent === 'ASSIGN + ARM') as HTMLButtonElement;
    await act(async () => { btn.click(); });
    expect(card().textContent).toMatch(/OPERATOR LINK EXPIRED/);
    m.unmount();
  });
});
