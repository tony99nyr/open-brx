// F559 console: CAPTURE TIME and NET CAP on the PLAY strip (KOTH only), and the one-line readout on LOBBY and ITEMS.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Api } from '../src/api/types';
import { HILL_CAPTURE_S, HILL_NET_CAP } from '../src/api/contract.gen';
import { MockBackend } from '../src/mock/backend';
import { clearNotice, useNotice } from '../src/notice';
import { resetBaseline } from '../src/playBaseline';
import { Games } from '../src/screens/Games';
import { hillReadoutText } from '../src/ui/HillReadout';
import { HillControl } from '../src/screens/games/controls';
import { Items } from '../src/screens/Items';
import { Lobby } from '../src/screens/Lobby';
import { StoreCtx } from '../src/store';
import { fixtureApi, makeStore, mount, mountScreen } from './harness';

afterEach(() => { clearNotice(); resetBaseline(); });

const txt = (m: { find(s: string): HTMLElement[] }, id: string) => m.find(`[data-testid="${id}"]`)[0]?.textContent;
const btn = (m: { find(s: string): HTMLElement[] }, label: string) => m.find(`button[aria-label="${label}"]`)[0] as HTMLButtonElement;

describe('HillControl', () => {
  it('starts at SET ON THE HILL, steps from the station default, and CLEAR returns to it', async () => {
    const calls: unknown[] = [];
    let hill: { capture_s?: number; net_cap?: number } | undefined;
    const view = () => <HillControl hill={hill} onChange={p => { calls.push(p); hill = { ...hill, ...p } as typeof hill; }} />;
    const m = await mount(view());
    expect(txt(m, 'match-hill-capture-value')).toBe('SET ON THE HILL');
    expect(txt(m, 'match-hill-net-value')).toBe('SET ON THE HILL');
    expect(btn(m, 'hill capture time clear').disabled, 'nothing to clear yet').toBe(true);
    await act(async () => { btn(m, 'hill capture time plus').click(); });
    await act(async () => { btn(m, 'hill net cap plus').click(); });
    expect(calls).toEqual([{ capture_s: HILL_CAPTURE_S + 1 }, { net_cap: HILL_NET_CAP + 1 }]);
    await m.update(view());
    expect(txt(m, 'match-hill-capture-value')).toBe('11 S');
    expect(txt(m, 'match-hill-net-value')).toBe('4');
    await act(async () => { btn(m, 'hill capture time minus').click(); });
    expect(calls[2]).toEqual({ capture_s: HILL_CAPTURE_S });
    await act(async () => { btn(m, 'hill net cap clear').click(); });
    expect(calls[3]).toEqual({ net_cap: null });
    await m.update(view());
    expect(txt(m, 'match-hill-net-value')).toBe('SET ON THE HILL');
    m.unmount();
  });

  it('a minus from SET ON THE HILL starts one below the default, and the bounds disable the steppers', async () => {
    const calls: unknown[] = [];
    const m = await mount(<HillControl hill={undefined} onChange={p => calls.push(p)} />);
    await act(async () => { btn(m, 'hill capture time minus').click(); });
    expect(calls).toEqual([{ capture_s: HILL_CAPTURE_S - 1 }]);
    await m.update(<HillControl hill={{ capture_s: 60, net_cap: 1 }} onChange={() => {}} />);
    expect(btn(m, 'hill capture time plus').disabled).toBe(true);
    expect(btn(m, 'hill net cap minus').disabled).toBe(true);
    m.unmount();
  });
});

async function renderPlay(api: MockBackend) {
  const state = await api.getState();
  const weapons = await api.getWeapons(), perks = await api.getPerks(), modes = await api.getModes();
  const store = makeStore({ state, weapons, perks, view: 'build' }, { api, modes });
  function Probe() { const n = useNotice(); return <span data-testid="notice-probe">{n?.text ?? ''}</span>; }
  return mount(<StoreCtx.Provider value={store}><Games /><Probe /></StoreCtx.Provider>);
}

describe('PLAY — the HILL strip item', () => {
  it('is absent on TDM and present on KOTH', async () => {
    const tdm = await renderPlay(new MockBackend());
    expect(tdm.find('[data-testid="match-hill-item"]').length).toBe(0);
    tdm.unmount();
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    const m = await renderPlay(api);
    expect(txt(m, 'match-hill-capture-value')).toBe('SET ON THE HILL');
    m.unmount();
  });

  it('+ reaches the server as hill.capture_s 11, and CLEAR on the last key sends the hill away', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    const m = await renderPlay(api);
    await act(async () => { btn(m, 'hill capture time plus').click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect((await api.getState()).config.hill).toEqual({ capture_s: 11 });
    m.unmount();
    const m2 = await renderPlay(api);
    expect(txt(m2, 'match-hill-capture-value')).toBe('11 S');
    await act(async () => { btn(m2, 'hill capture time clear').click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect((await api.getState()).config.hill).toBeUndefined();
    m2.unmount();
  });

  it('a refused pick (ok: false) surfaces its words in the notice bar, never a silent catch', async () => {
    const real = new MockBackend();
    await real.pick({ pieces: { mode: 'builtin:mode:koth' } });
    const state = await real.getState();
    const weapons = await real.getWeapons(), perks = await real.getPerks(), modes = await real.getModes();
    const api = fixtureApi({
      pick: async () => ({ ok: false, errors: ['CAPTURE TIME REFUSED BY THE TEST'], config: state.config, pick: state.game_pick!, fallbacks: [] }),
    }, real as unknown as Api);
    const store = makeStore({ state, weapons, perks, view: 'build' }, { api, modes });
    function Probe() { const n = useNotice(); return <span data-testid="notice-probe">{n?.text ?? ''}</span>; }
    const m = await mount(<StoreCtx.Provider value={store}><Games /><Probe /></StoreCtx.Provider>);
    await act(async () => { btn(m, 'hill capture time plus').click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(txt(m, 'notice-probe')).toContain('CAPTURE TIME REFUSED');
    m.unmount();
  });

  it('the mock clears one key with a null and keeps the other, and a null hill clears both', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' }, match: { hill: { capture_s: 15, net_cap: 4 } } });
    expect((await api.getState()).config.hill).toEqual({ capture_s: 15, net_cap: 4 });
    await api.pick({ match: { hill: { capture_s: null } as never } });
    expect((await api.getState()).config.hill).toEqual({ net_cap: 4 });
    await api.pick({ match: { hill: null as never } });
    expect((await api.getState()).config.hill).toBeUndefined();
  });

  it('the mock refuses what the server refuses, with the server words', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    for (const bad of [{ capture_s: 2 }, { capture_s: 61 }, { net_cap: 0 }, { net_cap: 7 }, { capture_s: 1.5 }]) {
      await expect(api.pick({ match: { hill: bad } })).rejects.toThrow(/MUST BE A WHOLE NUMBER/);
    }
    await expect(api.pick({ match: { hill: { x: 1 } as never } })).rejects.toThrow(/NOT A HILL SETTING/);
    await api.pick({ pieces: { mode: 'builtin:mode:tdm' }, match: { hill: { capture_s: 30 } } });
    expect((await api.getState()).config.hill, 'a mode without the item never takes one').toBeUndefined();
  });
});

describe('LOBBY and ITEMS — the hill values in force', () => {
  async function kothState(hill?: { capture_s?: number; net_cap?: number }, mode = 'koth') {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: `builtin:mode:${mode}` } });
    if (hill) await api.pick({ match: { hill } });
    const s = await api.getState();
    return { api, state: hill ? s : { ...s, config: { ...s.config, hill: undefined } } };
  }

  it('LOBBY reads the set values and SET ON THE HILL for an absent key', async () => {
    const { api, state } = await kothState({ capture_s: 15 });
    const m = await mountScreen(<Lobby />, { state, view: 'lobby', api: fixtureApi({}, api as unknown as Api) });
    expect(txt(m, 'hill-readout')).toBe('HILL: CAPTURE 15 S · NET CAP SET ON THE HILL');
    m.unmount();
  });

  it('LOBBY reads one HILL: PACE SET ON EACH HILL with no config.hill (an older server), and shows nothing outside KOTH', async () => {
    const { state } = await kothState();
    const m = await mountScreen(<Lobby />, { state, view: 'lobby' });
    expect(txt(m, 'hill-readout')).toBe('HILL: PACE SET ON EACH HILL');
    m.unmount();
    const t = await kothState(undefined, 'tdm');
    const m2 = await mountScreen(<Lobby />, { state: t.state, view: 'lobby' });
    expect(m2.find('[data-testid="hill-readout"]').length).toBe(0);
    m2.unmount();
  });

  it('ITEMS shows the same line for KOTH and nothing for TDM', async () => {
    const { state } = await kothState({ capture_s: 15, net_cap: 4 });
    const m = await mountScreen(<Items />, { state, view: 'muster' });
    expect(txt(m, 'hill-readout')).toBe('HILL: CAPTURE 15 S · NET CAP 4');
    m.unmount();
    const t = await kothState(undefined, 'tdm');
    const m2 = await mountScreen(<Items />, { state: t.state, view: 'muster' });
    expect(m2.find('[data-testid="items-panel"]').length, 'the panel itself renders').toBe(1);
    expect(m2.find('[data-testid="hill-readout"]').length).toBe(0);
    m2.unmount();
  });
});

describe('F559 review fixes', () => {
  it('LAST MATCH recorded at SET ON THE HILL clears the hill now in force', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await api.putStation('util-a1b2c3', { kind: 'control', team: 'any', id: 9 });
    await api.setPhase('lobby');
    await api.pushLobby(true);
    await api.start(45, true);
    await api.abort();                                          // the last match ran with no hill
    await api.pick({ match: { hill: { capture_s: 30, net_cap: 5 } } });
    expect((await api.getState()).config.hill).toEqual({ capture_s: 30, net_cap: 5 });
    const m = await renderPlay(api);
    await m.click('LAST MATCH');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect((await api.getState()).config.hill, 'the default hill replaced the 30 / 5').toBeUndefined();
    m.unmount();
  });

  it('LAST MATCH with one key set clears the other key', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' }, match: { hill: { capture_s: 20 } } });
    await api.putStation('util-a1b2c3', { kind: 'control', team: 'any', id: 9 });
    await api.setPhase('lobby');
    await api.pushLobby(true);
    await api.start(45, true);
    await api.abort();
    await api.pick({ match: { hill: { capture_s: 30, net_cap: 5 } } });
    const m = await renderPlay(api);
    await m.click('LAST MATCH');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect((await api.getState()).config.hill).toEqual({ capture_s: 20 });
    m.unmount();
  });

  it('a pick naming hill on a mode without the item drops it, so the pick never holds what the config lacks', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:tdm' } });
    await api.pick({ match: { hill: { capture_s: 30 } } });
    let s = await api.getState();
    expect(s.game_pick?.match.hill).toBeUndefined();
    expect(s.config.hill).toBeUndefined();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' }, match: { hill: { capture_s: 12 } } });
    await api.pick({ pieces: { mode: 'builtin:mode:tdm' } });
    s = await api.getState();
    expect(s.config.hill, 'a mode change keeps the config hill').toEqual({ capture_s: 12 });
    expect(s.game_pick?.match.hill, 'and the pick holds exactly that').toEqual({ capture_s: 12 });
  });

  it('a favourite naming hill for a mode without the item loads without it (picks.py `_hill_for_mode`)', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:tdm' } });
    const pick = (await api.getState()).game_pick!;
    const fav = await api.createFavourite({ name: 'Odd', countdown_s: 30, pick: { ...pick, match: { ...pick.match, hill: { capture_s: 30 } } } });
    const r = await api.loadFavourite(fav.favourite_id);
    expect(r.ok).toBe(true);
    const s = await api.getState();
    expect(s.config.hill).toBeUndefined();
    expect(s.game_pick?.match.hill).toBeUndefined();
  });

  it('the mock refuses a favourite with a bad hill in the server words', async () => {
    const api = new MockBackend();
    const pick = (await api.getState()).game_pick!;
    await expect(api.createFavourite({ name: 'Bad', countdown_s: 30, pick: { ...pick, match: { ...pick.match, hill: { capture_s: 99 } } } }))
      .rejects.toThrow(/HILL SETTINGS MUST BE CAPTURE_S 3-60/);
    await api.createFavourite({ name: 'Good', countdown_s: 30, pick: { ...pick, match: { ...pick.match, hill: { capture_s: 20 } } } });
  });

  it('the readout reads one SET ON THE HILL when neither key is set, the long form when one is', () => {
    expect(hillReadoutText({ mode: 'koth' })).toBe('HILL: PACE SET ON EACH HILL');
    expect(hillReadoutText({ mode: 'koth', hill: {} })).toBe('HILL: PACE SET ON EACH HILL');
    expect(hillReadoutText({ mode: 'koth', hill: { net_cap: 4 } })).toBe('HILL: CAPTURE SET ON THE HILL · NET CAP 4');
    expect(hillReadoutText({ mode: 'tdm', hill: { net_cap: 4 } })).toBeNull();
  });
});
