// A56 (S58, docs/spec/powerups.md): the ITEMS panel's item picker for a POWERUP station, and the station
// row's live item state. Asserted against the rendered card, not internal state: what the host sees when
// MC has powerups on, off, or predates them; a refusal reaching the command bar; the lock in play; and
// the row's AVAILABLE / NEXT m:ss countdown.
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { makeStore, mount } from './harness';
import type { Api, PowerupsView, State, StationView } from '../src/api/types';

const NODE = 'util-a1b2c3';

/** Mount the muster screen against a MockBackend; `over` replaces api methods (the stale/refusal cases). */
async function muster(over: Partial<Api> = {}, opts: { phase?: State['phase']; now?: () => number } = {}) {
  const api = new MockBackend();
  Object.assign(api, over);
  let state: State = await api.getState();
  let error: string | null = null;
  const run: <T,>(fn: () => Promise<T>) => Promise<T | undefined> = async fn => {
    try { error = null; return await fn(); } catch (e) { error = (e as Error).message; return undefined; }
  };
  const view = () => (opts.phase ? { ...state, phase: opts.phase } : state);
  const render = () => (<StoreCtx.Provider value={makeStore({ state: view(), view: 'muster' }, { api, run, ...(opts.now ? { serverNow: opts.now } : {}) })}><Armory /></StoreCtx.Provider>);
  const m = await mount(render());
  await m.update(render());   // let the GET /api/powerups effect land
  const card = () => m.find(`[data-station-card="${NODE}"]`)[0];
  return { m, api, card, error: () => error,
    settle: async () => { state = await api.getState(); await m.update(render()); } };
}

const pick = (m: Awaited<ReturnType<typeof muster>>['m'], preset: string) =>
  m.find(`[data-testid="item-pick-${preset}"]`)[0] as HTMLButtonElement | undefined;

describe('ITEMS — the powerup item picker', () => {
  it('with powerups ON, a POWERUP station offers the three presets with name, colour and schedule', async () => {
    const { m, card } = await muster();
    // control: the picker is not there while the kind is RESPAWN
    expect(m.find('[data-testid="item-picker"]').length).toBe(0);
    await m.click('POWERUP');
    const picker = m.find('[data-testid="item-picker"]');
    expect(picker.length, `no picker, card says: ${card().textContent}`).toBe(1);
    for (const p of ['rockets', 'rail_gun', 'overshield']) expect(pick(m, p), `no ${p} button`).toBeTruthy();
    expect(pick(m, 'rockets')!.textContent).toMatch(/ROCKETS/);
    expect(pick(m, 'rockets')!.textContent).toMatch(/EVERY 2:00, FIRST AT 2:00/);
    expect(pick(m, 'overshield')!.textContent).toMatch(/EVERY 1:00, FIRST AT 1:00/);
    // the item's own colour is on the button (its swatch)
    const sw = pick(m, 'overshield')!.querySelector('[data-swatch]') as HTMLElement;
    expect(sw.style.background).not.toBe('');
    m.unmount();
  });

  it('a POWERUP station cannot be armed with no item picked, and says so', async () => {
    const { m, card } = await muster();
    await m.click('POWERUP');
    const btn = m.find(`[data-station-card="${NODE}"] button`).find(b => b.textContent?.includes('ASSIGN + ARM')) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(card().textContent).toMatch(/PICK AN ITEM/);
    m.unmount();
  });

  it('picking OVERSHIELD presses it and ASSIGN + ARM sends item_preset; the row then shows the item', async () => {
    const { m, api, card, settle } = await muster();
    await m.click('POWERUP');
    await m.click(/^OVERSHIELD/);
    expect(pick(m, 'overshield')!.getAttribute('aria-pressed')).toBe('true');
    expect(pick(m, 'rockets')!.getAttribute('aria-pressed')).toBe('false');
    const sent: unknown[] = [];
    const orig = api.putStation.bind(api);
    api.putStation = (async (n, a) => { sent.push(a); return orig(n, a); }) as Api['putStation'];
    await m.click('ASSIGN + ARM');
    expect(sent).toEqual([{ kind: 'powerup', team: 1, id: 1, threshold: -74, item_preset: 'overshield' }]);
    await settle();
    const row = m.find(`[data-station-card="${NODE}"] [data-testid="station-item"]`)[0];
    expect(row, `no item row, card says: ${card().textContent}`).toBeTruthy();
    expect(row.textContent).toMatch(/OVERSHIELD/);
    // after the server agrees, the button is ARMED (not dirty) and the pick is still shown
    expect(card().textContent).toMatch(/ARMED/);
    expect(pick(m, 'overshield')!.getAttribute('aria-pressed')).toBe('true');
    m.unmount();
  });

  it('with powerups OFF, there is no picker, a one-line note says why, and no item_preset is sent', async () => {
    const off: PowerupsView = { enabled: false, presets: [] };
    const { m, api, card } = await muster({ getPowerups: async () => off });
    await m.click('POWERUP');
    expect(m.find('[data-testid="item-picker"]').length).toBe(0);
    expect(m.find('[data-testid="item-note"]')[0]?.textContent).toMatch(/POWERUPS ARE OFF/);
    const sent: Record<string, unknown>[] = [];
    const orig = api.putStation.bind(api);
    api.putStation = (async (n, a) => { sent.push(a); return orig(n, a); }) as Api['putStation'];
    await m.click('ASSIGN + ARM');
    expect(sent.length, `card says: ${card().textContent}`).toBe(1);
    expect('item_preset' in sent[0]).toBe(false);
    m.unmount();
  });

  it('an older MC (GET /api/powerups 404s): no picker, and the note says the MC predates powerups', async () => {
    const e404 = Object.assign(new Error('Not Found'), { status: 404 });
    const { m } = await muster({ getPowerups: async () => { throw e404; } });
    await m.click('POWERUP');
    expect(m.find('[data-testid="item-picker"]').length).toBe(0);
    expect(m.find('[data-testid="item-note"]')[0]?.textContent).toMatch(/PREDATES POWERUPS/);
    m.unmount();
  });

  it('a refusal from MC on the PUT reaches the operator, not a swallowed catch', async () => {
    const REFUSAL = 'powerups are off on this MC: start it with --powerups to give a station an item';
    const { m, error } = await muster({ putStation: (async () => { throw new Error(REFUSAL); }) as Api['putStation'] });
    await m.click('POWERUP');
    await m.click(/^ROCKETS/);
    expect(error()).toBeNull();
    await m.click('ASSIGN + ARM');
    expect(error()).toBe(REFUSAL);
    m.unmount();
  });

  it('while the match is ARMED or LIVE the picker is disabled and says the items are locked', async () => {
    for (const phase of ['armed', 'live'] as const) {
      const { m } = await muster({}, { phase });
      await m.click('POWERUP');
      expect(m.find('[data-testid="item-picker"]').length, phase).toBe(1);
      for (const p of ['rockets', 'rail_gun', 'overshield']) expect(pick(m, p)!.disabled, `${phase} ${p}`).toBe(true);
      expect(m.find('[data-testid="item-picker"]')[0].textContent).toMatch(/LOCKED FOR THE MATCH/);
      m.unmount();
    }
  });
});

describe('ITEMS — a powerup station row shows its item and live state', () => {
  const T0 = 1_800_000_000_000;
  async function row(extra: Partial<StationView>) {
    const d = new MockBackend();
    const base = await d.getState();
    const presets = (await d.getPowerups()).presets;
    const item = presets.find(p => p.preset === 'rockets')!.item;
    const state: State = { ...base, stations: [{ ...base.stations![0],
      assigned: { kind: 'powerup', team: 255, id: 4, threshold: -74, item },
      armed: { game: 1, at: 0, kind: 'powerup', team: 255, id: 4 }, attention: [], ...extra }] };
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api: d, serverNow: () => T0 })}><Armory /></StoreCtx.Provider>);
    const el = m.find('[data-testid="station-item"]')[0];
    return { m, text: el?.textContent ?? `(no item row) ${m.text()}` };
  }

  it('AVAILABLE when MC says the item is there', async () => {
    const { m, text } = await row({ item_available: true, next_spawn_at_ms: null });
    expect(text).toMatch(/ROCKETS/);
    expect(text).toMatch(/AVAILABLE/);
    expect(text).not.toMatch(/NEXT/);
    m.unmount();
  });

  it('NEXT 1:40 counting down when it was taken', async () => {
    const { m, text } = await row({ item_available: false, next_spawn_at_ms: T0 + 100_000 });
    expect(text).toMatch(/NEXT 1:40/);
    expect(text).not.toMatch(/AVAILABLE/);
    m.unmount();
  });

  it('an older MC (no live fields) shows the item and its schedule, not a state it cannot know', async () => {
    const { m, text } = await row({});
    expect(text).toMatch(/ROCKETS/);
    expect(text).toMatch(/EVERY 2:00, FIRST AT 2:00/);
    expect(text).not.toMatch(/AVAILABLE|NEXT/);
    m.unmount();
  });
});

describe('ITEMS — the ?mock backend speaks A56', () => {
  it('GET /api/powerups lists the three presets, and item_preset lands as the expanded item', async () => {
    const api = new MockBackend();
    const pv = await api.getPowerups();
    expect(pv.enabled).toBe(true);
    expect(pv.presets.map(p => p.preset)).toEqual(['rockets', 'rail_gun', 'overshield']);
    expect(pv.presets[0].item).toMatchObject({ kind: 'weapon', weapon_id: 'rocket_launcher', spawn_every_s: 120, first_at_s: 120 });
    expect(pv.presets[2].item).toMatchObject({ kind: 'overshield', amount: 75, spawn_every_s: 60, first_at_s: 60 });
    const v = await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'rail_gun' });
    expect(v.assigned?.item).toMatchObject({ kind: 'weapon', weapon_id: 'rail_gun' });
  });

  it('refuses an item_preset on a non-powerup kind, an unknown preset, and any PUT in play', async () => {
    const api = new MockBackend();
    await expect(api.putStation(NODE, { kind: 'respawn', team: 'any', id: 4, item_preset: 'rockets' })).rejects.toThrow(/powerup/);
    await expect(api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'bfg' })).rejects.toThrow(/bfg/);
    // as the real server: no station PUT while the match is armed or live (items are locked for the match)
    (api as unknown as { phase: string }).phase = 'live';
    await expect(api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'rockets' })).rejects.toThrow(/LIVE/);
  });
});
