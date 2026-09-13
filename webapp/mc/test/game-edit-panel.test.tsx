// B3 — editing the LOADED game (mode/night/health/weapon pool) inline on KIT and LOBBY, without the
// GAMES stepper or a RECALL, and with the guns re-pushed (never left silently stale) on an edit made
// after the lobby has already been pushed. See webapp/mc/src/ui/GameEditPanel.tsx.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api, GameConfig, State } from '../src/api/types';
import { Kit } from '../src/screens/Kit';
import { Lobby } from '../src/screens/Lobby';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const click = async (el: Element) => act(async () => { (el as HTMLElement).click(); });

/** Mount KIT or LOBBY wired to a LIVE MockBackend (so `putConfig` really lands and can be re-read),
 *  with `modes` supplied (the harness's `mountScreen` defaults it to `[]`, which every existing
 *  screen tolerates because none of them read it -- this is the first screen that does). */
async function gameScreen(view: 'kit' | 'lobby', apiOverrides: Partial<Api> = {}) {
  const d = await demo();
  // The demo backend BOOTS at 'muster' (server-guards.test.tsx and every other screen test never
  // needs to move it, because nothing they check reads `state.phase`) -- this is the first screen
  // that does, so it has to actually be advanced through the real backend, not just spliced into the
  // fixture object, or `resync()` below would immediately un-advance it on the first re-fetch.
  await d.api.setPhase(view, true);
  d.state = await d.api.getState();
  const modes = await d.api.getModes();
  const calls: Partial<GameConfig>[] = [];
  const api = fixtureApi({
    putConfig: async (patch: Partial<GameConfig>) => { calls.push(patch); return d.api.putConfig(patch); },
    ...apiOverrides,
  }, d.api);
  const store = makeStore({ ...d, view }, { api, modes });
  const Screen = view === 'kit' ? Kit : Lobby;
  const m = await mount(<StoreCtx.Provider value={store}><Screen /></StoreCtx.Provider>);
  /** Re-render the SAME screen from whatever the live backend holds now -- the stand-in for "a fresh
   *  snapshot arrived", since this harness (like every other screen-truth test here) mounts a fixed
   *  fixture rather than a live subscription. */
  const resync = async () => {
    const state = await d.api.getState();
    await m.update(<StoreCtx.Provider value={makeStore({ ...d, state, view }, { api, modes })}><Screen /></StoreCtx.Provider>);
    return state;
  };
  const open = () => click(m.find('[data-testid="game-edit-toggle"]')[0]);
  return { m, d, calls, api, modes, resync, open };
}

describe('GameEditPanel — collapsed by default, opens to the loaded game', () => {
  it('the header line names the game before it is even opened', async () => {
    const { m, d } = await gameScreen('kit');
    const toggle = m.find('[data-testid="game-edit-toggle"]')[0];
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain(`HP ${d.state.config.health.max_hp}/${d.state.config.health.max_armor}`);
    expect(m.find('[data-testid="game-edit-locked"]').length, 'no lock warning pre-arm').toBe(0);
    m.unmount();
  });

  it('opening it shows MODE, NIGHT OPS, DEFAULT HEALTH and WEAPONS AVAILABLE, seeded from the loaded game', async () => {
    const { m, d, open } = await gameScreen('kit');
    await open();
    const txt = m.text();
    expect(txt).toContain('MODE');
    expect(txt).toContain('NIGHT OPS');
    expect(txt).toContain('DEFAULT HEALTH');
    expect(txt).toContain('WEAPONS AVAILABLE');
    expect((m.find('input[aria-label="default health"]')[0] as HTMLInputElement).value).toBe(String(d.state.config.health.max_hp));
    expect((m.find('input[aria-label="default armor"]')[0] as HTMLInputElement).value).toBe(String(d.state.config.health.max_armor));
    expect(m.find('[role="switch"]')[0].getAttribute('aria-checked')).toBe(String(d.state.config.night));
    m.unmount();
  });

  it('mounts on LOBBY too, seeded the same way', async () => {
    const { m, open } = await gameScreen('lobby');
    await open();
    expect(m.text()).toContain('WEAPONS AVAILABLE');
    m.unmount();
  });
});

describe('GameEditPanel — MODE', () => {
  it('tapping a different mode sends putConfig({mode}), and the header reflects it once the snapshot lands', async () => {
    const { m, d, calls, modes, open, resync } = await gameScreen('kit');
    await open();
    const other = modes.find(mm => mm.mode !== d.state.config.mode)!;
    await m.click(other.abbr);
    expect(calls).toEqual([{ mode: other.mode }]);
    const state = await resync();
    expect(state.config.mode).toBe(other.mode);
    expect(m.find('[data-testid="game-edit-toggle"]')[0].textContent).toContain(other.abbr);
    m.unmount();
  });
});

describe('GameEditPanel — NIGHT OPS', () => {
  it('the toggle sends putConfig({night}) and flips the label once applied', async () => {
    const { m, d, calls, open, resync } = await gameScreen('kit');
    await open();
    expect(d.state.config.night).toBe(false);
    await click(m.find('[role="switch"]')[0]);
    expect(calls).toEqual([{ night: true }]);
    await resync();
    expect(m.find('[role="switch"]')[0].getAttribute('aria-checked')).toBe('true');
    expect(m.text()).toContain('NIGHT');
    m.unmount();
  });
});

describe('GameEditPanel — DEFAULT HEALTH', () => {
  it('editing HP sends the whole health block, keeping armor, and the box shows the applied value', async () => {
    const { m, d, calls, open, resync } = await gameScreen('kit');
    await open();
    const hp = m.find('input[aria-label="default health"]')[0] as HTMLInputElement;
    await act(async () => {
      hp.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hp, '150');
      hp.dispatchEvent(new Event('input', { bubbles: true }));
      hp.blur();
    });
    expect(calls).toEqual([{ health: { max_hp: 150, max_armor: d.state.config.health.max_armor } }]);
    await resync();
    expect((m.find('input[aria-label="default health"]')[0] as HTMLInputElement).value).toBe('150');
    m.unmount();
  });
});

describe('GameEditPanel — WEAPONS AVAILABLE', () => {
  it('switching a weapon off sends its id in exclude_ids, and the chip repaints once applied', async () => {
    const { m, d, calls, open, resync } = await gameScreen('kit');
    await open();
    const weapons = await d.api.getWeapons();
    const excluded = d.state.config.loadout_policy!.primary.exclude_ids ?? [];
    const w = weapons.find(x => !excluded.includes(x.weapon_id))!;
    // Scoped to the PRIMARY pool group: a weapon allowed in BOTH primary and secondary renders two
    // identically-labelled chips (one per `PoolEditor`), so an unscoped query cannot tell them apart.
    const group = m.el.querySelector('[aria-label="primary weapons available"]')!;
    const before = Array.from(group.querySelectorAll(`[aria-label="${w.name}, allowed"]`));
    expect(before.length, `${w.name} starts allowed in PRIMARY`).toBe(1);
    await click(before[0]);
    expect(calls.length).toBe(1);
    expect(calls[0].loadout_policy?.primary?.exclude_ids).toContain(w.weapon_id);
    await resync();
    const group2 = m.el.querySelector('[aria-label="primary weapons available"]')!;
    expect(group2.querySelectorAll(`[aria-label="${w.name}, off"]`).length, 'the same chip now reads off').toBe(1);
    expect(group2.querySelectorAll(`[aria-label="${w.name}, allowed"]`).length).toBe(0);
    m.unmount();
  });

  it('a FIXED slot shows what everyone carries instead of a toggle list', async () => {
    const { d, m, open } = await gameScreen('kit', {});
    await d.api.putConfig({ loadout_policy: { ...d.state.config.loadout_policy!, primary: { ...d.state.config.loadout_policy!.primary, choice: 'fixed', fixed_id: 'sniper_rifle' } } });
    const state = await d.api.getState();
    await m.update(<StoreCtx.Provider value={makeStore({ ...d, state, view: 'kit' }, { api: d.api, modes: await d.api.getModes() })}><Kit /></StoreCtx.Provider>);
    await open();
    expect(m.text()).toMatch(/FIXED.*carries/i);
    m.unmount();
  });
});

describe('GameEditPanel — locked once the match has started (armed/live)', () => {
  it('the header names the lock, opening explains it, and every control is a real HTML disabled', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'live' };
    const modes = await d.api.getModes();
    const store = makeStore({ ...d, state, view: 'kit' }, { modes });
    const m = await mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
    expect(m.find('[data-testid="game-edit-toggle"]')[0].textContent).toContain('LOCKED — LIVE');
    await click(m.find('[data-testid="game-edit-toggle"]')[0]);
    expect(m.find('[data-testid="game-edit-locked"]').length, 'the panel explains WHY, not just that it is locked').toBe(1);
    expect(m.text()).toMatch(/RECALL/);
    // A real HTML `disabled` on the wrapping `<fieldset>`, not a per-control flag that a new control
    // could forget to carry. (jsdom does not implement the browser's fieldset->descendant disabling
    // cascade, so the individual `<input>`/`<button>` elements inside cannot be asserted here the way
    // a real-browser check can -- that is covered by the e2e step against an actual browser instead.)
    const fieldset = m.el.querySelector('fieldset')!;
    expect(fieldset.disabled, 'one real disabled locks every control at once').toBe(true);
    m.unmount();
  });
});

describe('GameEditPanel — a request that lands in the phase-race window is still refused clearly', () => {
  it('rewrites the server refusal to name the fix (RECALL), surfaced in the normal error strip', async () => {
    const d = await demo();
    // The CONSOLE still thinks it is KIT (this is the race the comment on GameEditPanel describes:
    // the phase already advanced server-side, the next snapshot has not landed yet) -- so nothing is
    // client-side disabled, and the only thing standing between the tap and the gun is the server's
    // own answer.
    const state: State = { ...d.state, phase: 'kit' };
    const modes = await d.api.getModes();
    const errors: string[] = [];
    const api = fixtureApi({
      putConfig: async () => { throw new Error('cannot change config after the match has started'); },
    }, d.api);
    const store = makeStore({ ...d, state, view: 'kit' }, {
      api, modes, run: async fn => { try { return await fn(); } catch (e) { errors.push((e as Error).message); return undefined; } },
    });
    const m = await mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
    await click(m.find('[data-testid="game-edit-toggle"]')[0]);
    await click(m.find('[role="switch"]')[0]);
    expect(errors.length, 'the failure is never swallowed').toBe(1);
    expect(errors[0]).toMatch(/RECALL/);
    m.unmount();
  });
});

describe('GameEditPanel — an edit while the lobby is already pushed RE-PUSHES (B1/B3)', () => {
  it('acks clear immediately (visibly re-pushing), then repopulate — the same acks LOBBY\'s own step reads', async () => {
    const { m, d, calls, open, resync } = await gameScreen('lobby');
    await d.api.pushLobby(true);
    let state = await resync();
    expect(state.lobby.pushed).toBe(true);
    // The demo field is not perfect (one gun is deliberately unreachable, matching a real muster) --
    // so the baseline is whatever acked the FIRST push, not every player. A re-push that recovers the
    // same baseline is the thing being proven, not that every gun in a fixed demo happens to answer.
    const baseline = Object.values(state.lobby.acks).filter(a => a.ok).length;
    expect(baseline, 'at least one gun acked the first push').toBeGreaterThan(0);
    await open();
    await click(m.find('[role="switch"]')[0]);   // NIGHT — any edit re-pushes
    expect(calls.length).toBe(1);

    // Immediately after the PUT resolves, the mock (mirroring the real server) has already cleared the
    // acks but not yet repopulated them — the transitional "re-pushing" moment.
    state = await resync();
    expect(state.lobby.pushed, 'stays pushed — this is a RE-push, not an un-push (B1 was the un-push)').toBe(true);
    expect(Object.keys(state.lobby.acks).length, 'acks cleared: the guns have not echoed the new config yet').toBe(0);
    expect(m.find('[data-testid="game-edit-repush"]')[0].textContent).toMatch(/RE-PUSHING/);
    // LOBBY's OWN "config pushed" step reads the identical field and agrees — one source, never two counts.
    if (m.find('[data-continue="kit"]').length === 0) expect(m.text()).toMatch(/Config pushed/);

    await sleep(260);
    state = await resync();
    expect(Object.values(state.lobby.acks).filter(a => a.ok).length, 'the same guns re-acked the new config').toBe(baseline);
    m.unmount();
  });

  it('before any push, the panel says there is nothing on the guns to update', async () => {
    const { m, open } = await gameScreen('kit');
    await open();
    expect(m.find('[data-testid="game-edit-repush"]').length).toBe(0);
    expect(m.text()).toMatch(/NOT PUSHED YET/);
    m.unmount();
  });
});

describe('GameEditPanel — a session from before loadout policy existed (OLD DATA)', () => {
  it('KIT and LOBBY both render, falling back to the OPEN policy rather than crashing', async () => {
    const d = await demo();
    const state: State = { ...d.state, config: { ...d.state.config, loadout_policy: undefined as unknown as State['config']['loadout_policy'] } };
    for (const [view, Screen] of [['kit', Kit], ['lobby', Lobby]] as const) {
      const store = makeStore({ ...d, state, view }, { modes: [] });   // an older server: no /api/modes rows either
      const m = await mount(<StoreCtx.Provider value={store}><Screen /></StoreCtx.Provider>);
      await click(m.find('[data-testid="game-edit-toggle"]')[0]);
      expect(m.text()).toContain('mode list unavailable');
      expect(m.find('[aria-label*="allowed"], [aria-label*="off"]').length, 'the weapon pool still renders from the OPEN fallback').toBeGreaterThan(0);
      m.unmount();
    }
  });
});
