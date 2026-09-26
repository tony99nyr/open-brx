// F-scope A (2026-09-25): MVP is TDM, FFA and KotH only. Extraction, Infection and Last Man Standing
// keep their engine, their `MODES` row and their config path -- an old saved game or an API config
// naming one of them still loads and renders -- but they drop off the console's own mode pickers.
// Server-flagged (`ModeInfo.mvp`, `GET /api/modes`), not a console-side name list: `mcp/tests/test_mc_api.py`
// pins the served flag.
import { describe, expect, it } from 'vitest';
import type { Api, ModeInfo } from '../src/api/types';
import { Designer } from '../src/screens/Designer';
import { Games } from '../src/screens/Games';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { fixtureApi, makeStore, mount } from './harness';

async function loadedOn(mode: string) {
  const backend = new MockBackend();
  const modes: ModeInfo[] = await backend.getModes();
  await backend.putConfig({ mode });
  await backend.setPhase('build', true);
  await backend.loadGame();
  const api = fixtureApi({}, backend as unknown as Api);
  return { backend, modes, api, state: await backend.getState(), weapons: await backend.getWeapons(), perks: await backend.getPerks() };
}

/** GAMES shows its full "pick a game" shelves (STOCK MODES included) only before anything is LOADED --
 *  once loaded they collapse behind "PLAY A DIFFERENT GAME". The picker test wants the shelves open. */
async function notLoadedOn(mode: string) {
  const backend = new MockBackend();
  const modes: ModeInfo[] = await backend.getModes();
  await backend.putConfig({ mode });
  await backend.setPhase('build', true);
  const api = fixtureApi({}, backend as unknown as Api);
  return { backend, modes, api, state: await backend.getState(), weapons: await backend.getWeapons(), perks: await backend.getPerks() };
}

describe('GAMES — the STOCK MODES picker offers only the MVP modes', () => {
  it('lists TDM, FFA and KOTH, and never extraction/infection/lms', async () => {
    const { modes, api, state, weapons, perks } = await notLoadedOn('tdm');
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, weapons, perks, view: 'build' }, { api, modes })}><Games /></StoreCtx.Provider>);
    const labels = m.find('[aria-label^="play "]').map(e => e.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['play TEAM DEATHMATCH', 'play FREE-FOR-ALL', 'play KING OF THE HILL']));
    expect(labels.some(l => /INFECTION|EXTRACTION|LAST MAN STANDING/i.test(l ?? ''))).toBe(false);
    m.unmount();
  });

  it('an old game on a hidden mode (lms) still loads and renders its own name, not a raw string', async () => {
    const { modes, api, state, weapons, perks } = await loadedOn('lms');
    expect(state.config.mode).toBe('lms');   // control: the config really did land on the hidden mode
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, weapons, perks, view: 'build' }, { api, modes })}><Games /></StoreCtx.Provider>);
    expect(m.find('[data-testid="playing-title"]')[0]?.textContent).toBe('LAST MAN STANDING');
    m.unmount();
  });
});

describe('DESIGNER — the BASE MODE picker offers only the MVP modes', () => {
  it('lists TDM, FFA and KOTH as switch targets', async () => {
    const { modes, api, state, weapons, perks } = await loadedOn('tdm');
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, weapons, perks, view: 'designer' }, { api, modes, designerSeed: { fromLive: true } })}><Designer /></StoreCtx.Provider>);
    const buttons = m.find('[data-testid="mode-base-grid"] button');
    const names = buttons.map(b => b.textContent ?? '');
    expect(names.some(t => t.includes('TEAM DEATHMATCH'))).toBe(true);
    expect(names.some(t => t.includes('FREE-FOR-ALL'))).toBe(true);
    expect(names.some(t => t.includes('KING OF THE HILL'))).toBe(true);
    expect(names.some(t => /EXTRACTION|INFECTION|LAST MAN STANDING/.test(t))).toBe(false);
    m.unmount();
  });

  it('a hidden current base (lms) stays in the grid, selected, even though it is not offered from elsewhere', async () => {
    const { modes, api, state, weapons, perks } = await loadedOn('lms');
    const m = await mount(<StoreCtx.Provider value={makeStore({ state, weapons, perks, view: 'designer' }, { api, modes, designerSeed: { fromLive: true } })}><Designer /></StoreCtx.Provider>);
    const buttons = m.find('[data-testid="mode-base-grid"] button');
    const lms = buttons.find(b => (b.textContent ?? '').includes('LAST MAN STANDING'));
    expect(lms, 'the current base must still render its own card').toBeTruthy();
    expect(lms!.getAttribute('aria-pressed')).toBe('true');
    m.unmount();
  });
});
