// Screen-truth tests for the GAMES and DESIGNER findings of the MC visual QA pass (2026-09-23):
// C1 (rail CUSTOMIZE → PLAY THIS NOW never loaded), H1 (rail values invisible), M12 (CONTINUE TO KIT
// said the game was on the guns), M15 (class and kind chips that disagreed with their tiles) and M16
// (the presentation panel showed the applied game under a draft). The browser twin of C1 is
// `test/e2e/designer-rail-play.mjs`.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api, GameConfig, ModeInfo, State } from '../src/api/types';
import { Designer } from '../src/screens/Designer';
import { Games } from '../src/screens/Games';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx, type DesignerSeed } from '../src/store';
import { fixtureApi, makeStore, mount } from './harness';

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 5)); });

async function setup(opts: { load?: boolean; phase?: string; patch?: (s: State) => State } = {}) {
  const backend = new MockBackend();
  const modes: ModeInfo[] = await backend.getModes();
  await backend.setPhase(opts.phase ?? 'build', true);
  if (opts.load) await backend.loadGame();
  const calls = { loadGame: 0, setPhase: [] as string[], putConfig: [] as Partial<GameConfig>[] };
  const api = fixtureApi({
    loadGame: async () => { calls.loadGame++; return backend.loadGame(); },
    setPhase: async (p: string, f?: boolean) => { calls.setPhase.push(p); return backend.setPhase(p, f); },
    putConfig: async (p: Partial<GameConfig>) => { calls.putConfig.push(p); return backend.putConfig(p); },
  }, backend as unknown as Api);
  let state = await backend.getState();
  if (opts.patch) state = opts.patch(state);
  return { backend, modes, api, calls, state, weapons: await backend.getWeapons(), perks: await backend.getPerks() };
}

async function designer(opts: Parameters<typeof setup>[0] & { seed?: DesignerSeed } = {}) {
  const s = await setup(opts);
  const views: string[] = [];
  const store = makeStore({ state: s.state, weapons: s.weapons, perks: s.perks, view: 'designer' },
    { api: s.api, modes: s.modes, designerSeed: opts.seed ?? { fromLive: true }, setView: v => { views.push(v); } });
  const m = await mount(<StoreCtx.Provider value={store}><Designer /></StoreCtx.Provider>);
  await settle();
  return { ...s, m, views };
}

describe('C1: DESIGNER opened from the GAMES rail (fromLive) with nothing loaded', () => {
  it('PLAY THIS NOW loads the game and moves the phase to KIT, like the stock-card path', async () => {
    const d = await designer({ seed: { fromLive: true } });
    expect(d.state.game?.loaded, 'control: nothing is loaded yet').toBe(false);
    await d.m.click('PLAY THIS NOW');
    await settle();
    expect(d.calls.loadGame, 'PLAY loaded the game').toBe(1);
    expect(d.calls.setPhase, 'and moved the phase').toEqual(['kit']);
    expect(d.views.at(-1)).toBe('kit');
    const after = await d.backend.getState();
    expect(after.phase).toBe('kit');
    expect(after.game?.loaded).toBe(true);
    d.m.unmount();
  });

  it('with a game already loaded in LOBBY, PLAY re-announces through the config write and stays in LOBBY', async () => {
    const d = await designer({ seed: { fromLive: true }, load: true, phase: 'lobby' });
    await d.m.click('PLAY THIS NOW');
    await settle();
    expect(d.calls.loadGame, 'no second LOAD: set_config re-announces a loaded game').toBe(0);
    expect(d.calls.setPhase, 'LOBBY is never dropped back to KIT').toEqual([]);
    expect(d.views.at(-1)).toBe('lobby');
    d.m.unmount();
  });

  it('with a game loaded but the phase still BUILD, PLAY moves the phase to KIT (no view-only jump)', async () => {
    const d = await designer({ seed: { fromLive: true }, load: true, phase: 'build' });
    await d.m.click('PLAY THIS NOW');
    await settle();
    expect(d.calls.loadGame).toBe(0);
    expect(d.calls.setPhase).toEqual(['kit']);
    expect((await d.backend.getState()).phase).toBe('kit');
    d.m.unmount();
  });
});

describe('H1 and M12: the GAMES screen', () => {
  const games = async (opts: Parameters<typeof setup>[0] = {}) => {
    const s = await setup(opts);
    const store = makeStore({ state: s.state, weapons: s.weapons, perks: s.perks, view: 'build' }, { api: s.api, modes: s.modes });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    await settle();
    return { ...s, m };
  };

  it('H1: the right rail lays its rule rows out in ONE track that fits the rail, with every value present', async () => {
    const g = await games();
    const rail = g.m.find('[data-testid="rail-settings"]')[0];
    expect(rail, 'the rail settings block').toBeTruthy();
    expect(rail.style.gridTemplateColumns, 'no 9999px track pushing the values off the rail').not.toMatch(/9999/);
    expect(rail.style.gridTemplateColumns).toBe('minmax(0,1fr)');
    const rows = Array.from(rail.children) as HTMLElement[];
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) expect((r.lastElementChild?.textContent ?? '').trim(), `a value for ${r.firstElementChild?.textContent}`).not.toBe('');
    g.m.unmount();
  });

  it('M12: CONTINUE TO KIT never claims the game is on the guns before a LOBBY push', async () => {
    const g = await games({ load: true });
    const btn = g.m.find('[data-testid="game-continue-kit"] button')[0];
    expect(btn, 'the loaded state shows CONTINUE TO KIT').toBeTruthy();
    const title = btn.getAttribute('title') ?? '';
    expect(title).not.toMatch(/on the guns/i);
    expect(title).toMatch(/sent to the phones/i);
    expect(title).toMatch(/lobby push/i);
    g.m.unmount();
  });
});

describe('M15: DESIGNER kind chips agree with the tiles', () => {
  it('the secondary reads ALL WEAPONS (pistols ✓ and counted) or SIDEARMS ONLY, exactly one on', async () => {
    const d = await designer();
    const q = (id: string) => d.m.find(`[aria-label="secondary slot rules"] [data-testid="${id}"]`)[0];
    const all = q('kind-all'), side = q('kind-sidearms');
    expect(all.textContent).toContain('ALL WEAPONS');
    expect(side.textContent).toContain('SIDEARMS ONLY');
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(side.getAttribute('aria-pressed')).toBe('false');
    // the pistols are allowed under ALL WEAPONS, which the chip now says
    const usp = d.m.find('[aria-label="secondary slot rules"] button[aria-label^="USP-S"]')[0];
    expect(usp.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { side.click(); });
    expect(q('kind-sidearms').getAttribute('aria-pressed')).toBe('true');
    expect(q('kind-all').getAttribute('aria-pressed')).toBe('false');
    expect(d.m.find('[data-testid="secondary-summary"]')[0].textContent).toContain('SIDEARMS ONLY');
    // tapping the chip that is already on changes nothing (never leaves the slot with no kind)
    await act(async () => { q('kind-sidearms').click(); });
    expect(q('kind-sidearms').getAttribute('aria-pressed')).toBe('true');
    await act(async () => { q('kind-all').click(); });
    expect(q('kind-all').getAttribute('aria-pressed')).toBe('true');
    d.m.unmount();
  });
});

describe('M16: DESIGNER presentation panel describes the draft, honestly', () => {
  const open = async (d: Awaited<ReturnType<typeof designer>>) => {
    const btn = d.m.find('[data-testid="advanced-presentation"] button[aria-controls="advanced-presentation-body"]')[0];
    await act(async () => { btn.click(); });
    await settle();
  };

  it('a draft that shares the applied profile shows the table and says it is the draft\'s', async () => {
    const d = await designer({ seed: { fromLive: true } });
    await open(d);
    const scope = d.m.find('[data-testid="presentation-scope"]')[0].textContent ?? '';
    expect(scope).toMatch(/read only/i);
    expect(scope).toMatch(/of the draft above/i);
    expect(scope).not.toMatch(/comes next/i);
    expect(d.m.find('[data-testid^="pres-row-"]').length).toBeGreaterThan(0);
    d.m.unmount();
  });

  it('a draft on another profile names the draft\'s preset and shows no applied-game table', async () => {
    const d = await designer({
      seed: { mode: 'tdm' },
      patch: s => ({ ...s, config: { ...s.config, presentation: { preset: 'silenced' } } }),
    });
    await open(d);
    const scope = d.m.find('[data-testid="presentation-scope"]')[0].textContent ?? '';
    expect(scope).toMatch(/read only/i);
    expect(scope).not.toMatch(/comes next/i);
    expect(d.m.find('[data-testid="presentation-draft-preset"]')[0].textContent).not.toMatch(/SILENCED/);
    expect(d.m.find('[data-testid^="pres-row-"]').length, 'the applied game\'s table is not shown as the draft\'s').toBe(0);
    d.m.unmount();
  });
});
