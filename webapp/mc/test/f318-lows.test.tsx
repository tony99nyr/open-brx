// F318 (MC visual QA Lows, 2026-09-23): the ones jsdom can see. Each case names the item it guards.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api, FeedEntry, GameConfig, MatchHistoryRow, ModeInfo, State } from '../src/api/types';
import { CommandBar } from '../src/frame/CommandBar';
import { MockBackend } from '../src/mock/backend';
import { Games } from '../src/screens/Games';
import { Kit } from '../src/screens/Kit';
import { Recap } from '../src/screens/Recap';
import { StoreCtx, StoreProvider, dedupeFeed, feedKey, prependFeed, useStore } from '../src/store';
import { demo, fixtureApi, makeStore, mount, mountScreen } from './harness';

describe('F318 item 1: the command bar while MC is offline', () => {
  it('does not show a red ● LIVE beside MC OFFLINE; it says the phase is last known', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'live' };
    const bar = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'live' }, { mock: false, connected: false })}><CommandBar /></StoreCtx.Provider>);
    expect(bar.text()).toContain('MC OFFLINE');
    const chip = bar.find('[data-testid="phase-chip"]')[0];
    expect(chip.textContent).toContain('LAST KNOWN');
    expect(chip.textContent).not.toContain('●');
    expect(chip.style.color, 'not the live red').not.toBe('rgb(255, 82, 82)');
    bar.unmount();
  });

  it('still says ● LIVE in red when MC is connected', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'live' };
    const bar = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'live' }, { mock: false, connected: true })}><CommandBar /></StoreCtx.Provider>);
    const chip = bar.find('[data-testid="phase-chip"]')[0];
    expect(chip.textContent).toBe('● LIVE');
    bar.unmount();
  });
});

describe('F318 item 3: GAMES under the LOCKED banner', () => {
  it('does not tell the operator to adjust and SAVE AND LOAD while the match is live', async () => {
    const backend = new MockBackend();
    const modes: ModeInfo[] = await backend.getModes();
    await backend.setPhase('lobby', true);
    await backend.loadGame();
    const raw = await backend.getState();
    // a clean board: every gun acked this config, nobody red or waiting (the demo keeps one gun unpowered)
    const acks = Object.fromEntries(raw.players.map(p => [p.player_id, { ok: true, config_id: raw.config.config_id }]));
    const base: State = { ...raw, lobby: { ...raw.lobby, pushed: true, all_acked: true, acks } as State['lobby'],
                          readiness: { ...raw.readiness, board: [] } as State['readiness'] };
    const api = fixtureApi({ putConfig: async (p: Partial<GameConfig>) => backend.putConfig(p) }, backend as unknown as Api);
    const render = (phase: State['phase']) => mount(<StoreCtx.Provider value={makeStore({ state: { ...base, phase }, weapons: [], perks: [], view: 'build' }, { api, modes })}><Games /></StoreCtx.Provider>);
    const pre = await render('lobby');
    expect(pre.text(), 'the control: pre-arm, the sentence is true').toContain('Adjust it here and SAVE AND LOAD');
    pre.unmount();
    const live = await render('live');
    expect(live.text()).toContain('Every gun is holding this config');
    expect(live.text()).not.toContain('Adjust it here and SAVE AND LOAD');
    live.unmount();
  });
});

describe('F318 items 5, 9 and 10: KIT', () => {
  it('item 5: a roster name ellipsises and carries its full name as a title', async () => {
    const d = await demo();
    expect(d.state.kit.trying, 'the demo has someone TRYING').toMatchObject({ p4: 'smg' });
    const m = await mountScreen(<Kit />, { ...d, view: 'kit' });
    const name = m.find('[data-kit-name="p4"]')[0];
    const p4 = d.state.players.find(p => p.player_id === 'p4')!;
    expect(name.style.textOverflow).toBe('ellipsis');
    expect(name.style.overflow).toBe('hidden');
    expect(name.style.whiteSpace).toBe('nowrap');
    expect(name.getAttribute('title')).toBe(`#${p4.player_num} ${p4.display}`);
    m.unmount();
  });

  for (const phase of ['armed', 'live'] as const) {
    it(`item 9: the voice and gun selects look disabled in ${phase.toUpperCase()}`, async () => {
      const d = await demo();
      const state: State = { ...d.state, phase, voices: [{ id: 'male', name: 'MALE' }, { id: 'female', name: 'FEMALE' }, { id: 'robot', name: 'ROBOT' }] } as State;
      const m = await mountScreen(<Kit />, { ...d, state, view: 'kit', selPlayer: 'p1' });
      const sels = m.find('select[aria-label^="gun for"], select[aria-label^="voice for"]') as HTMLSelectElement[];
      expect(sels.length, 'the gun select at least').toBeGreaterThan(0);
      for (const s of sels) {
        expect(s.disabled).toBe(true);
        expect(s.style.cursor).toBe('not-allowed');
        expect(Number(s.style.opacity)).toBeLessThan(1);
      }
      m.unmount();
    });
  }

  it('item 9 control: pre-arm the selects look live', async () => {
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, state: { ...d.state, phase: 'kit' }, view: 'kit', selPlayer: 'p1' });
    const gun = m.find('select[aria-label^="gun for"]')[0] as HTMLSelectElement;
    expect(gun.disabled).toBe(false);
    expect(gun.style.cursor).toBe('pointer');
    expect(gun.style.opacity).toBe('');
    m.unmount();
  });

  it('item 10: the pool inputs and the player-number input are at least 36 px tall', async () => {
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, state: { ...d.state, phase: 'kit' }, view: 'kit', selPlayer: 'p1' });
    const num = m.find('input[aria-label="player number (1–63)"]')[0];
    expect(parseInt(num.style.minHeight, 10)).toBeGreaterThanOrEqual(36);
    const pool = m.find('[data-pool-card] input[type="number"]');
    expect(pool.length, 'the HP and AR inputs').toBe(2);
    for (const i of pool) expect(parseInt(i.style.minHeight, 10)).toBeGreaterThanOrEqual(36);
    m.unmount();
  });
});

describe('F318 item 10: RECAP history chips', () => {
  it('are at least 36 px tall', async () => {
    const d = await demo();
    const rows = [{ match_id: 'old1', mode: 'tdm', go_live_t: 1, ended_t: Date.now() - 60_000, recap: null, config: null }] as unknown as MatchHistoryRow[];
    const state: State = { ...d.state, phase: 'recap' };
    const m = await mountScreen(<Recap />, { ...d, state, api: { matchHistory: async () => rows } });
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    const chips = (m.find('button') as HTMLButtonElement[]).filter(b => /TDM/.test(b.textContent ?? ''));
    expect(chips.length, 'the archived match chip').toBe(1);
    expect(parseInt(chips[0].style.minHeight, 10)).toBeGreaterThanOrEqual(36);
    m.unmount();
  });
});

// Items 6 and 12: one race. A snapshot's feed replaces the local list; a `feed` push for an entry the
// snapshot already carried then prepended it again (once after go-live; FIRST BLOOD after a recall and a
// restart, which is a new match id and so a replace too).
describe('F318 items 6 and 12: a feed line never shows twice', () => {
  const FB: FeedEntry = { t_match_s: 10, text: 'FIRST BLOOD', kind: 'alert' };
  const K: FeedEntry = { t_match_s: 42, text: 'VIPER killed GHOST', kind: 'kill' };

  it('keys an entry on everything it says', () => {
    expect(feedKey(FB)).toBe(feedKey({ ...FB }));
    expect(feedKey(FB)).not.toBe(feedKey({ ...FB, t_match_s: 11 }));
    expect(feedKey(FB)).not.toBe(feedKey({ ...FB, tag: 'NOTE' }));
    expect(prependFeed([K, FB], FB)).toEqual([K, FB]);
    expect(prependFeed([K], FB)).toEqual([FB, K]);
    expect(dedupeFeed([K, FB, K])).toEqual([K, FB]);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('a push for an entry the snapshot already carried does not repeat it', async () => {
    history.replaceState(null, '', '/');
    const LIVE = { session_id: 's1', phase: 'live', t: 1, live: { match_id: 'm2' }, game: { loaded: true, sent: 2, total: 2 }, feed: [K, FB] };
    const sockets: Sock[] = [];
    class Sock {
      onmessage: ((ev: { data: string }) => void) | null = null;
      onopen: (() => void) | null = null;
      onclose: ((ev: { code: number }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { sockets.push(this); setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ kind: 'snapshot', state: LIVE }) }); }, 0); }
      close() {}
      send() {}
    }
    vi.stubGlobal('WebSocket', Sock);
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, status: 200, statusText: 'OK', json: async () => (path === '/api/state' ? LIVE : []) } as Response)));
    function Probe() { const { feed } = useStore(); return <span data-probe data-feed={feed.map(e => e.text).join('|')} />; }
    const m = await mount(<StoreProvider><Probe /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    // the push that raced the reseed: the snapshot already has it
    await act(async () => { sockets[0].onmessage?.({ data: JSON.stringify({ kind: 'feed', entry: FB }) }); });
    expect(m.find('[data-probe]')[0].getAttribute('data-feed')).toBe('VIPER killed GHOST|FIRST BLOOD');
    // a genuinely new entry still lands on top
    const NEW: FeedEntry = { t_match_s: 50, text: 'GHOST killed VIPER', kind: 'kill' };
    await act(async () => { sockets[0].onmessage?.({ data: JSON.stringify({ kind: 'feed', entry: NEW }) }); });
    expect(m.find('[data-probe]')[0].getAttribute('data-feed')).toBe('GHOST killed VIPER|VIPER killed GHOST|FIRST BLOOD');
    m.unmount();
  });
});
