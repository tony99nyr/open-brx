// A56 (S58, docs/spec/powerups.md): the ITEMS panel's item picker for a POWERUP station, and the station
// row's live item state. Asserted against the rendered card, not internal state: what the host sees when
// MC has powerups on, off, or predates them; a refusal reaching the command bar; the lock in play; and
// the row's AVAILABLE / NEXT m:ss countdown.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { Armed } from '../src/screens/Armed';
import { Live } from '../src/screens/Live';
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
    // S-powerup-overrides: the effective RESPAWN (and, for a weapon, CHARGES) rides along on every apply,
    // the preset's own default here since neither stepper was touched.
    expect(sent).toEqual([{ kind: 'powerup', team: 1, threshold: 0, item_preset: 'overshield', amount: 75, spawn_every_s: 60 }]);
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
    expect(m.find('[data-testid="item-note"]')[0]?.textContent).toMatch(/MC SERVER IS OLDER THAN THIS CONSOLE/);
    m.unmount();
  });

  it('a refusal from MC on the PUT reaches the operator, not a swallowed catch', async () => {
    const REFUSAL = 'powerups are off on this MC (--no-powerups): drop that flag to give a station an item';
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

// S-powerup-overrides (2026-09-28): the CHARGES/AMOUNT/RESPAWN steppers on a powerup station card.
// Screen-truth: assert the rendered value and the disabled state, not internal drafts; the full click
// path (widths, tabular-nums) is test/e2e/items.mjs.
describe('ITEMS — per-station override steppers (S-powerup-overrides)', () => {
  const value = (m: Awaited<ReturnType<typeof muster>>['m'], field: string) => m.find(`[data-testid="station-${field}-${NODE}"]`)[0]?.textContent;
  const btn = (m: Awaited<ReturnType<typeof muster>>['m'], field: string, dir: 'minus' | 'plus') =>
    m.find(`button[aria-label="${field} for ${NODE} ${dir}"]`)[0] as HTMLButtonElement | undefined;

  it('a weapon item shows CHARGES and RESPAWN, not AMOUNT; an overshield shows AMOUNT and RESPAWN, not CHARGES', async () => {
    const { m } = await muster();
    await m.click('POWERUP');
    await m.click(/^ROCKETS/);
    expect(value(m, 'charges'), m.text()).toBe('2');
    expect(value(m, 'respawn')).toBe('2:00');
    expect(m.find(`[data-testid="station-amount-${NODE}"]`).length).toBe(0);
    await m.click(/^OVERSHIELD/);
    expect(m.find(`[data-testid="station-charges-${NODE}"]`).length).toBe(0);
    expect(value(m, 'amount')).toBe('+75');
    expect(value(m, 'respawn')).toBe('1:00');
    m.unmount();
  });

  it('stepping CHARGES sends the new value on apply, and disables at each end of 1-4', async () => {
    const { m, api } = await muster();
    await m.click('POWERUP');
    await m.click(/^ROCKETS/);
    const plus = () => btn(m, 'charges', 'plus')!, minus = () => btn(m, 'charges', 'minus')!;
    expect(minus().disabled, '2 is not the floor').toBe(false);
    await act(async () => { plus().click(); });
    expect(value(m, 'charges')).toBe('3');
    await act(async () => { plus().click(); });
    expect(value(m, 'charges')).toBe('4');
    expect(plus().disabled, 'at the ceiling, + disables').toBe(true);
    await act(async () => { plus().click(); });
    expect(value(m, 'charges'), 'a disabled + does nothing').toBe('4');
    const sent: unknown[] = [];
    const orig = api.putStation.bind(api);
    api.putStation = (async (n, a) => { sent.push(a); return orig(n, a); }) as Api['putStation'];
    await m.click('ASSIGN + ARM');
    expect(sent).toEqual([{ kind: 'powerup', team: 1, threshold: 0, item_preset: 'rockets', spawn_every_s: 120, charges: 4 }]);
    m.unmount();
  });

  it('stepping RESPAWN disables at 30 and at 240 (the StickS3 carries it in one byte)', async () => {
    const { m } = await muster();
    await m.click('POWERUP');
    await m.click(/^ROCKETS/);
    const minus = () => btn(m, 'respawn', 'minus')!;
    for (let i = 0; i < 3; i++) await act(async () => { minus().click(); });   // 120 -> 90 -> 60 -> 30
    expect(value(m, 'respawn')).toBe('0:30');
    expect(minus().disabled, 'at the floor, − disables').toBe(true);
    const plus = () => btn(m, 'respawn', 'plus')!;
    for (let i = 0; i < 7; i++) await act(async () => { plus().click(); });   // 30 -> ... -> 240
    expect(value(m, 'respawn')).toBe('4:00');
    expect(plus().disabled, 'at the ceiling, + disables').toBe(true);
    m.unmount();
  });

  // Polish 2026-09-28 (review High): an override used to survive a change of item, so ROCKETS 4 ->
  // OVERSHIELD -> RAIL GUN armed RAIL GUN with 4 charges the operator never chose for it, while its chip
  // still read "2 CHARGES". Any change of item now starts from that item's own defaults.
  it('a change of item resets CHARGES, AMOUNT and RESPAWN to that item\'s own defaults', async () => {
    const { m } = await muster();
    await m.click('POWERUP');
    await m.click(/^ROCKETS/);
    await act(async () => { btn(m, 'charges', 'plus')!.click(); });   // 2 -> 3
    await act(async () => { btn(m, 'charges', 'plus')!.click(); });   // 3 -> 4
    await act(async () => { btn(m, 'respawn', 'plus')!.click(); });   // 2:00 -> 2:30
    expect(value(m, 'charges')).toBe('4');
    const chip = (p: string) => m.find(`[data-testid="item-pick-${p}"]`)[0].textContent ?? '';
    expect(chip('rockets'), 'the chosen chip agrees with the steppers').toContain('4 CHARGES');
    expect(chip('rockets')).toContain('EVERY 2:30');
    await m.click(/^OVERSHIELD/);
    expect(m.find(`[data-testid="station-charges-${NODE}"]`).length, 'CHARGES does not apply to an overshield').toBe(0);
    expect(value(m, 'amount')).toBe('+75');
    expect(value(m, 'respawn'), 'the overshield\'s own default').toBe('1:00');
    await m.click(/^RAIL GUN/);
    expect(value(m, 'charges'), 'RAIL GUN starts from its own default, not the 4 set on ROCKETS').toBe('2');
    expect(value(m, 'respawn')).toBe('2:00');
    expect(chip('rail_gun')).toContain('2 CHARGES');
    expect(chip('rockets'), 'an unchosen chip shows its preset default').toContain('2 CHARGES');
    m.unmount();
  });

  it('a refusal from MC on an override reaches the visible error strip, not a swallowed catch', async () => {
    const REFUSAL = 'CHARGES MUST BE A WHOLE NUMBER, 1-4';
    const { m, error, card } = await muster({ putStation: (async () => { throw new Error(REFUSAL); }) as Api['putStation'] });
    await m.click('POWERUP');
    await m.click(/^ROCKETS/);
    await act(async () => { btn(m, 'charges', 'plus')!.click(); });
    expect(error()).toBeNull();
    await m.click('ASSIGN + ARM');
    expect(error()).toBe(REFUSAL);
    expect(card().textContent).toMatch(new RegExp(REFUSAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    m.unmount();
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

// S-powerup-overrides (2026-09-28): the mock mirrors mcp/brx_mcp/mc/powerups.py apply_overrides() exactly --
// same ranges, same wording, same statelessness. Parity with mcp/tests/test_mc_powerups.py's own override tests.
describe('ITEMS — the ?mock backend: per-station overrides (S-powerup-overrides)', () => {
  it('omitted overrides give exactly the preset default; charges/amount/spawn_every_s apply and are range-checked', async () => {
    const api = new MockBackend();
    const v = await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'rockets' });
    expect(v.assigned?.item).toMatchObject({ charges: 2, spawn_every_s: 120, first_at_s: 120 });
    const v2 = await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'rockets', charges: 3, spawn_every_s: 90 });
    expect(v2.assigned?.item).toMatchObject({ charges: 3, spawn_every_s: 90, first_at_s: 90 });
    for (const charges of [0, 5, -1, 2.5]) {
      await expect(api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'rockets', charges })).rejects.toThrow(/CHARGES/);
    }
    const v3 = await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield', amount: 100 });
    expect(v3.assigned?.item).toMatchObject({ amount: 100 });
    for (const amount of [10, 175, 30, -25]) {
      await expect(api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield', amount })).rejects.toThrow(/AMOUNT/);
    }
    for (const spawn_every_s of [20, 310, 45, 0]) {
      await expect(api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield', spawn_every_s })).rejects.toThrow(/RESPAWN/);
    }
  });

  it('refuses a field the item kind does not carry, and an override with no item_preset', async () => {
    const api = new MockBackend();
    await expect(api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'rockets', amount: 100 })).rejects.toThrow(/AMOUNT.*OVERSHIELD/);
    await expect(api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield', charges: 3 })).rejects.toThrow(/CHARGES.*WEAPON/);
    await expect(api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, charges: 3 })).rejects.toThrow(/item_preset/);
  });

  it('changing only item_preset does not carry an override forward: stateless, like the rest of the PUT', async () => {
    const api = new MockBackend();
    await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'rockets', charges: 3, spawn_every_s: 90 });
    const v = await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield' });
    expect(v.assigned?.item).toEqual((await api.getPowerups()).presets.find(p => p.preset === 'overshield')!.item);
  });

  it('cannot smuggle a weapon_id past the preset, and the two-weapon rule still runs on the overridden item', async () => {
    const api = new MockBackend();
    // `weapon_id` is not a field `putStation` accepts; a hand-crafted request naming it anyway must still be
    // ignored, exactly as any other unknown key is (`as never` only defeats the TS param check, not the mock's).
    const smuggled = { kind: 'powerup', team: 'any', id: 4, item_preset: 'rockets', charges: 3, weapon_id: 'stinger' };
    const v = await api.putStation(NODE, smuggled as never);
    expect(v.assigned?.item?.weapon_id).toBe('rocket_launcher');
    const v2 = await api.putStation('util-b', { kind: 'powerup', team: 'any', id: 5, item_preset: 'rail_gun', charges: 4 });
    expect(v2.assigned?.item?.charges).toBe(4);
  });

  it('a range-only PUT in play keeps a stored override; an override change in play is refused', async () => {
    // team as a NUMBER, matching what the console itself always sends (`Items.tsx`'s `team` state is a
    // `number`): the range-only fast path compares it against the stored (already-normalized) team as-is,
    // same as it already did for kind/id before this change.
    const api = new MockBackend();
    await api.putStation(NODE, { kind: 'powerup', team: 255, id: 4, item_preset: 'rockets', charges: 3 });
    (api as unknown as { phase: string }).phase = 'armed';
    const v = await api.putStation(NODE, { kind: 'powerup', team: 255, id: 4, item_preset: 'rockets', charges: 3, threshold: -60 });
    expect(v.assigned?.threshold).toBe(-60);
    expect(v.assigned?.item?.charges).toBe(3);
    await expect(api.putStation(NODE, { kind: 'powerup', team: 255, id: 4, item_preset: 'rockets', charges: 2, threshold: -60 })).rejects.toThrow(/ARMED/);
  });
});

// Round 2 (brx5 lead, 2026-09-24): RESET makes a powerup station's item available now, and the row
// names who took it (`StationView.taken_by`, a player_num, shown as the roster display).
describe('ITEMS — RESET makes the item available now', () => {
  /** A powerup station already assigned OVERSHIELD, with the item taken, in `phase`. */
  async function inPlay(phase: State['phase'], over: Partial<Api> = {}, pv?: PowerupsView) {
    const api = new MockBackend();
    await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield' });
    Object.assign(api, over, pv ? { getPowerups: async () => pv } : {});
    const base = await api.getState();
    const state: State = { ...base, phase, stations: base.stations!.map(s => s.node_id === NODE ? { ...s, item_available: false, next_spawn_at_ms: Date.now() + 30_000 } : s) };
    let error: string | null = null;
    const run: <T,>(fn: () => Promise<T>) => Promise<T | undefined> = async fn => {
      try { error = null; return await fn(); } catch (e) { error = (e as Error).message; return undefined; }
    };
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api, run })}><Armory /></StoreCtx.Provider>);
    await m.update(<StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api, run })}><Armory /></StoreCtx.Provider>);
    const reset = () => m.find(`[data-station-card="${NODE}"] [data-testid="item-reset"]`)[0] as HTMLButtonElement | undefined;
    return { m, api, reset, error: () => error, card: () => m.find(`[data-station-card="${NODE}"]`)[0] };
  }

  it('is absent at muster, and absent in play when powerups are off', async () => {
    const a = await inPlay('muster');
    expect(a.reset(), 'no RESET outside a match').toBeUndefined();
    a.m.unmount();
    const b = await inPlay('live', {}, { enabled: false, presets: [] });
    expect(b.reset(), 'no RESET with the flag off').toBeUndefined();
    b.m.unmount();
  });

  it('while ARMED or LIVE: the first tap only asks, the second calls reset, CANCEL backs out', async () => {
    for (const phase of ['armed', 'live'] as const) {
      const calls: string[] = [];
      const { m, reset, card } = await inPlay(phase, { resetStation: async (n: string) => { calls.push(n); return { ok: true }; } } as Partial<Api>);
      expect(reset(), `${phase}: RESET is shown`).toBeTruthy();
      await m.click('RESET ITEM');
      expect(calls, `${phase}: one tap sends nothing`).toEqual([]);
      expect(card().textContent).toMatch(/TAP RESET ITEM AGAIN/);
      await m.click('CANCEL');
      expect(card().textContent).not.toMatch(/TAP RESET ITEM AGAIN/);
      await m.click('RESET ITEM');
      await m.click('RESET ITEM');
      expect(calls, `${phase}: the confirm calls reset for this station`).toEqual([NODE]);
      m.unmount();
    }
  });

  it('a refusal (or an older MC) reaches the operator', async () => {
    const MSG = 'THE MC SERVER PREDATES THIS UI (no station reset route). RESTART IT: python -m brx_mcp.mc';
    const { m, error } = await inPlay('live', { resetStation: async () => { throw new Error(MSG); } } as Partial<Api>);
    await m.click('RESET ITEM');
    await m.click('RESET ITEM');
    expect(error()).toBe(MSG);
    m.unmount();
  });
});

describe('ITEMS — TAKEN BY', () => {
  async function takenRow(extra: Partial<StationView>) {
    const d = new MockBackend();
    const base = await d.getState();
    const item = (await d.getPowerups()).presets[0].item;
    const p = base.players[1];
    const state: State = { ...base, stations: [{ ...base.stations![0], assigned: { kind: 'powerup', team: 255, id: 4, threshold: -74, item },
      armed: { game: 1, at: 0, kind: 'powerup', team: 255, id: 4 }, attention: [], ...extra } as StationView] };
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api: d })}><Armory /></StoreCtx.Provider>);
    return { m, p, text: m.find('[data-testid="station-item"]')[0]?.textContent ?? '(no row)' };
  }
  it('names the player who took it, by roster display, beside NEXT', async () => {
    const d = new MockBackend(); const pl = (await d.getState()).players[1];
    const { m, text } = await takenRow({ item_available: false, next_spawn_at_ms: Date.now() + 50_000, taken_by: pl.player_num } as Partial<StationView>);
    expect(text).toMatch(/NEXT \d:\d\d/);
    expect(text).toContain(`TAKEN BY ${pl.display.toUpperCase()}`);
    m.unmount();
  });
  it('shows nothing extra when the field is absent, or while AVAILABLE', async () => {
    const a = await takenRow({ item_available: false, next_spawn_at_ms: Date.now() + 50_000 });
    expect(a.text).not.toMatch(/TAKEN BY/);
    a.m.unmount();
    const b = await takenRow({ item_available: true, next_spawn_at_ms: Date.now() + 50_000, taken_by: 2 } as Partial<StationView>);
    expect(b.text).not.toMatch(/TAKEN BY|NEXT/);
    b.m.unmount();
  });
  it('a spawn time already past shows NEXT 0:00, never a negative', async () => {
    const { m, text } = await takenRow({ item_available: false, next_spawn_at_ms: Date.now() - 5_000 });
    expect(text).toMatch(/NEXT 0:00/);
    m.unmount();
  });
});

describe('ITEMS — the ?mock backend: reset and taken_by', () => {
  it('a pickup records who took it; RESET makes it available again and clears taken_by; refused outside play', async () => {
    const api = new MockBackend();
    await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield' });
    await expect(api.resetStation(NODE)).rejects.toThrow(/armed or live/);
    const mb = api as unknown as { phase: string; start_: { go_live_t: number } };
    mb.phase = 'live'; mb.start_ = { go_live_t: Date.now() - 61_000 } as never;
    const v0 = (await api.getState()).stations!.find(s => s.node_id === NODE)!;
    expect(v0.item_available).toBe(true);
    api.pickupStation(NODE, 3);
    const v1 = (await api.getState()).stations!.find(s => s.node_id === NODE)!;
    expect(v1.item_available).toBe(false);
    expect(v1.taken_by).toBe(3);
    await api.resetStation(NODE);
    const v2 = (await api.getState()).stations!.find(s => s.node_id === NODE)!;
    expect(v2.item_available).toBe(true);
    expect(v2.taken_by).toBeUndefined();
  });
});

// Polish round 1 (brx5 lead): the store follows the phase, so while a match is ARMED or LIVE the
// operator is on those screens, never on ARMORY. M3: the item state and RESET ITEM must be there too.

describe('M3: the powerup strip on the ARMED and LIVE screens', () => {
  /** A mock match in `phase` with the first utility phone a powerup station holding OVERSHIELD. */
  async function onScreen(phase: 'armed' | 'live', opts: { item?: boolean; over?: Partial<Api>; station?: Partial<StationView> } = {}) {
    const api = new MockBackend();
    if (opts.item !== false) await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield' });
    await api.pushLobby(true);
    await api.start(30, true);
    if (phase === 'live') (api as unknown as { goLive(): void }).goLive();
    Object.assign(api, opts.over ?? {});
    const base = await api.getState();
    const state: State = { ...base, stations: base.stations!.map(s => s.node_id === NODE ? { ...s, ...(opts.station ?? {}) } : s) };
    let error: string | null = null;
    const run: <T,>(fn: () => Promise<T>) => Promise<T | undefined> = async fn => {
      try { error = null; return await fn(); } catch (e) { error = (e as Error).message; return undefined; }
    };
    const node = () => <StoreCtx.Provider value={makeStore({ state, view: phase }, { api, run })}>{phase === 'armed' ? <Armed /> : <Live />}</StoreCtx.Provider>;
    const m = await mount(node());
    await m.update(node());
    const strip = () => m.find('[data-testid="powerup-strip"]')[0];
    return { m, strip, error: () => error, state };
  }

  it('shows each item station on ARMED and LIVE, with its state', async () => {
    for (const phase of ['armed', 'live'] as const) {
      const { m, strip } = await onScreen(phase, { station: { item_available: false, next_spawn_at_ms: Date.now() + 40_000, taken_by: 2 } });
      expect(strip(), `${phase}: no powerup strip`).toBeTruthy();
      expect(strip().textContent).toMatch(/OVERSHIELD/);
      expect(strip().textContent).toMatch(/NEXT 0:[34]\d/);
      expect(strip().textContent).toMatch(/TAKEN BY /);
      m.unmount();
    }
  });

  it('F331: is absent when GET /api/powerups says the flag is off, even with a restored item on a station', async () => {
    const { m, strip, state } = await onScreen('live', { over: { getPowerups: async () => ({ enabled: false, presets: [] }) } });
    expect(state.stations!.some(s => s.assigned?.item), 'setup: a station still holds an item').toBe(true);
    expect(strip()).toBeUndefined();
    m.unmount();
  });

  it('polish: TAKEN BY inherits the dim colour from its parent, no second T.dim', async () => {
    const { m, strip } = await onScreen('live', { station: { item_available: false, next_spawn_at_ms: Date.now() + 40_000, taken_by: 2 } });
    const span = Array.from(strip().querySelectorAll('span')).find(e => /^ · TAKEN BY /.test(e.textContent ?? ''));
    expect(span, 'setup: the TAKEN BY span').toBeTruthy();
    expect(span!.getAttribute('style')).toBeNull();
    m.unmount();
  });

  it('is absent when no powerup station holds an item', async () => {
    const { m, strip } = await onScreen('live', { item: false });
    expect(strip()).toBeUndefined();
    m.unmount();
  });

  it('RESET ITEM on LIVE: two taps call reset; a refusal shows inline on the row AND in the banner', async () => {
    const MSG = "'util-a1b2c3' is not a powerup station with an item in this match";
    const calls: string[] = [];
    const { m, strip, error } = await onScreen('live', {
      station: { item_available: false, next_spawn_at_ms: Date.now() + 40_000 },
      over: { resetStation: async (n: string) => { calls.push(n); throw new Error(MSG); } } as Partial<Api> });
    await m.click('RESET ITEM');
    expect(calls).toEqual([]);
    expect(strip().textContent).toMatch(/TAP RESET ITEM AGAIN/);
    await m.click('RESET ITEM');
    expect(calls).toEqual([NODE]);
    expect(error()).toBe(MSG);
    expect(strip().querySelector('[data-testid="item-reset-error"]')?.textContent).toContain(MSG);
    m.unmount();
  });

  it('no RESET ITEM while the item is AVAILABLE (there is nothing to reset)', async () => {
    const { m, strip } = await onScreen('live', { station: { item_available: true, next_spawn_at_ms: Date.now() + 40_000 } });
    expect(strip().textContent).toMatch(/AVAILABLE/);
    expect(strip().querySelector('[data-testid="item-reset"]')).toBeNull();
    m.unmount();
  });
});

describe('polish round 1: the lows on the ITEMS card', () => {
  it('no RESET ITEM on the card while the item is AVAILABLE', async () => {
    const api = new MockBackend();
    await api.putStation(NODE, { kind: 'powerup', team: 'any', id: 4, item_preset: 'overshield' });
    const base = await api.getState();
    const state: State = { ...base, phase: 'live', stations: base.stations!.map(s => s.node_id === NODE ? { ...s, item_available: true } : s) };
    const node = <StoreCtx.Provider value={makeStore({ state, view: 'muster' }, { api })}><Armory /></StoreCtx.Provider>;
    const m = await mount(node); await m.update(node);
    expect(m.find(`[data-station-card="${NODE}"] [data-testid="item-station-row"]`).length, 'the item row is there').toBe(1);
    expect(m.find(`[data-station-card="${NODE}"] [data-testid="item-reset"]`).length).toBe(0);
    m.unmount();
  });

  it('ASSIGN + ARM looks disabled while it needs a pick', async () => {
    const { m } = await muster();
    await m.click('POWERUP');
    const btn = m.find(`[data-station-card="${NODE}"] button`).find(b => b.textContent?.includes('ASSIGN + ARM')) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.style.cursor).toBe('not-allowed');
    expect(btn.style.background).not.toBe('rgb(56, 182, 255)');
    const lit = getComputedStyle(btn).color;
    await m.click(/^ROCKETS/);
    expect(btn.disabled).toBe(false);
    expect(getComputedStyle(btn).color, 'the live button reads differently from the dead one').not.toBe(lit);
    m.unmount();
  });

  it('the powerups-off note gives the one restart hint', async () => {
    const { m } = await muster({ getPowerups: async () => ({ enabled: false, presets: [] }) });
    await m.click('POWERUP');
    expect(m.find('[data-testid="item-note"]')[0].textContent).toContain('./start.sh (no --no-powerups flag)');
    m.unmount();
  });
});
