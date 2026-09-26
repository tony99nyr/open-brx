// PLAY — the F411 rewrite of screens/Games.tsx (docs/spec/design/games-presets.md). Screen-truth
// coverage for the parts vitest can prove without a browser: the one-choice hiding rule, a tap
// reaching the server, KOTH with no hill, LAST MATCH, and the stale-server banner. The full click-path
// (silent-snipers, a failed pick, widths) is test/e2e/play.mjs.
//
// Driven against a REAL, live MockBackend — not the Fixture.api override (that layers a FEW methods
// onto a SEPARATE, fresh backend `mountScreen` builds internally, which is right for a stubbed single
// call but wrong here: a tap has to land on the same backend the assertions read back). `api` goes in
// as a `makeStore` base override instead, exactly as the deleted field-2026-09-12/koth suites did.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import { Games } from '../src/screens/Games';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

async function renderPlay(api: MockBackend) {
  const state = await api.getState();
  const weapons = await api.getWeapons(), perks = await api.getPerks();
  const render = async () => {
    const s = await api.getState();
    const store = makeStore({ state: s, weapons, perks, view: 'build' }, { api });
    return mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
  };
  const m = await render();
  return { m, api, state, settle: async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); return render(); } };
}

describe('PLAY — the one-choice hiding rule (games-redesign.md §4)', () => {
  it('a fresh install shows exactly GAME MODE, LIFE and SPAWN', async () => {
    const { m } = await renderPlay(new MockBackend());
    expect(m.find('[data-testid="picker-mode"]').length).toBe(1);
    expect(m.find('[data-testid="picker-life"]').length).toBe(1);
    expect(m.find('[data-testid="picker-spawn"]').length).toBe(1);
    // exactly one pickable piece each: hidden, and applied silently (the pick already names it)
    expect(m.find('[data-testid="picker-primary"]').length).toBe(0);
    expect(m.find('[data-testid="picker-secondary"]').length).toBe(0);
    expect(m.find('[data-testid="picker-perks"]').length).toBe(0);
    expect(m.find('[data-testid="picker-misc_loadouts"]').length).toBe(0);
    // GAMEPLAY is hidden for MVP regardless of preset count (§3/§13/§15)
    expect(m.find('[data-testid="picker-gameplay"]').length).toBe(0);
    m.unmount();
  });

  it('a second BUILD piece for a kind makes its picker appear', async () => {
    const api = new MockBackend();
    await api.createPiece({ kind: 'primary', name: 'SNIPERS', value: { choice: 'fixed', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: 'sniper_rifle' } });
    const { m } = await renderPlay(api);
    expect(m.find('[data-testid="picker-primary"]').length).toBe(1);
    m.unmount();
  });
});

describe('PLAY — a tap is one POST /api/play/pick', () => {
  it('picking a mode reaches the server and the mark follows game_pick', async () => {
    const { m, api } = await renderPlay(new MockBackend());
    await m.click('KING OF THE HILL');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const after = await api.getState();
    expect(after.game_pick?.pieces.mode).toBe('builtin:mode:koth');
    expect(after.config.mode).toBe('koth');
    m.unmount();
  });

  it('KOTH with no hill assigned blocks LOAD and offers ASSIGN A HILL, never a dead end', async () => {
    const { m, settle } = await renderPlay(new MockBackend());
    await m.click('KING OF THE HILL');
    m.unmount();
    const m2 = await settle();
    expect(m2.text()).toContain('NO HILL STATION ASSIGNED');
    expect(m2.find('[data-testid="assign-a-hill"]').length).toBe(1);
    const load = m2.find('[data-testid="game-load"] button')[0] as HTMLButtonElement;
    expect(load.disabled).toBe(true);
    m2.unmount();
  });
});

describe('PLAY — LAST MATCH', () => {
  it('hidden until a match has been played', async () => {
    const { m } = await renderPlay(new MockBackend());
    expect(m.find('[data-testid="last-match"]').length).toBe(0);
    m.unmount();
  });

  it('shown, and restores the four strip values plus the countdown, once a match has started', async () => {
    const api = new MockBackend();
    await api.pick({ match: { frag_limit: 15, night: true, silenced: true } });
    await api.setPhase('lobby');
    await api.pushLobby(true);
    await api.start(45, true);
    const state = await api.getState();
    expect(state.last_match).toEqual({ time_limit_s: 600, frag_limit: 15, night: true, silenced: true, countdown_s: 45 });
    const { m } = await renderPlay(api);
    expect(m.find('[data-testid="last-match"]').length).toBe(1);
    m.unmount();
  });
});

describe('PLAY — stale server (games-presets.md §5)', () => {
  it('shows the exact banner when game_pick is absent, and still renders', async () => {
    const d = await demo();
    const state = { ...d.state, game_pick: undefined };
    const store = makeStore({ state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api: d.api });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    expect(m.find('[data-testid="play-stale-server"]').length).toBe(1);
    expect(m.text()).toContain('THE SERVER PREDATES THIS CONSOLE');
    expect(m.text()).toContain('./start.sh');
    m.unmount();
  });

  it('shows the same banner when GET /api/pieces 404s', async () => {
    const d = await demo();
    const err = Object.assign(new Error('not found'), { status: 404 });
    const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' },
      { api: fixtureApi({ getPieces: async () => { throw err; } }, d.api) });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="play-stale-server"]').length).toBe(1);
    m.unmount();
  });
});

describe('PLAY — MATCH SETTINGS strip', () => {
  it('KILLS only shows for a kills-scored mode', async () => {
    const { m } = await renderPlay(new MockBackend());   // TDM: win_by kills
    expect(m.find('[data-testid="match-kills-value"]').length).toBe(1);
    m.unmount();
  });

  it('"only 15 kills": tap the kill value, tap 15', async () => {
    const { m, api } = await renderPlay(new MockBackend());
    await m.click('NO KILL LIMIT');
    await m.click('15');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const after = await api.getState();
    expect(after.game_pick?.match.frag_limit).toBe(15);
    m.unmount();
  });

  it('PICKUPS is hidden with nothing armed, and reads what ARMORY armed when it is', async () => {
    const { m: noPickups } = await renderPlay(new MockBackend());
    expect(noPickups.find('[data-testid="pickups-line"]').length).toBe(0);
    noPickups.unmount();

    const d = await demo();
    const withItem = {
      ...d.state,
      stations: [{ node_id: 'n1', assigned: { kind: 'powerup' as const, team: 255, id: 3, threshold: 0, at: 0,
        item: { kind: 'weapon' as const, weapon_id: 'rocket_launcher', charges: 2, spawn_every_s: 120, first_at_s: 120, name: 'ROCKETS', color: '#ff6a2b' } },
        armed: null, arm_pending: false, report: {}, app_ver: 'utility', last_seen_ms: 0, online: true, attention: [], game: 1 }],
    };
    const store = makeStore({ state: withItem, weapons: d.weapons, perks: d.perks, view: 'build' }, { api: d.api });
    const m2 = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    expect(m2.find('[data-testid="pickups-line"]')[0].textContent).toContain('ROCKETS @ STATION 3');
    m2.unmount();
  });
});
