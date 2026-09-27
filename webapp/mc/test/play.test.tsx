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
import { afterEach, describe, expect, it } from 'vitest';
import type { Api } from '../src/api/types';
import { MockBackend } from '../src/mock/backend';
import { clearNotice, useNotice } from '../src/notice';
import { getRunway, setRunway } from '../src/runway';
import { Games } from '../src/screens/Games';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

afterEach(() => clearNotice());

/** A cross-screen notice (`setNotice`) is module state, not something `Games` renders itself --
 *  mounted beside it so the polish-round-1 tests can read what a refused action left in the bar. */
function NoticeProbe() {
  const n = useNotice();
  return <span data-testid="notice-probe">{n?.text ?? ''}</span>;
}

/** Type into a controlled input the way a real keystroke does (React's own value setter must be
 *  bypassed, or the framework never sees the change) — same pattern as armory-claim.test.tsx. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function renderPlay(api: MockBackend) {
  const state = await api.getState();
  const weapons = await api.getWeapons(), perks = await api.getPerks(), modes = await api.getModes();
  const render = async () => {
    const s = await api.getState();
    const store = makeStore({ state: s, weapons, perks, view: 'build' }, { api, modes });
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
    const { m, api, settle } = await renderPlay(new MockBackend());
    // Round 4: TDM -> KOTH reshapes the demo's 8-player blue/yellow roster, so this is now a two-tap
    // mode switch (F-6's splitLine confirm, restored) -- the first tap only shows the predicted split.
    await m.click('KING OF THE HILL');
    await m.click('KING OF THE HILL');
    m.unmount();
    const m2 = await settle();
    const after = await api.getState();
    expect(after.game_pick?.pieces.mode).toBe('builtin:mode:koth');
    expect(after.config.mode).toBe('koth');
    // M7: the tapped option itself must show as pressed once the snapshot follows the pick, not just
    // the backend's own state.
    const kothBtn = m2.find('[aria-label="game mode"] button').find(b => (b.textContent ?? '').includes('KING OF THE HILL')) as HTMLButtonElement;
    expect(kothBtn.getAttribute('aria-pressed')).toBe('true');
    m2.unmount();
  });

  it('KOTH with no hill assigned blocks LOAD and offers ASSIGN A HILL, never a dead end', async () => {
    const { m, settle } = await renderPlay(new MockBackend());
    await m.click('KING OF THE HILL');   // round 4: first tap only shows the reshape confirm
    await m.click('KING OF THE HILL');   // second tap actually picks it
    m.unmount();
    const m2 = await settle();
    expect(m2.text()).toContain('NO HILL STATION ASSIGNED');
    expect(m2.find('[data-testid="assign-a-hill"]').length).toBe(1);
    const load = m2.find('[data-testid="game-load"] button')[0] as HTMLButtonElement;
    expect(load.disabled).toBe(true);
    m2.unmount();
  });
});

describe('PLAY — round 4: a mode switch that reshapes the roster asks first (F-6, restored)', () => {
  it('the first tap sends nothing and shows the predicted split', async () => {
    const { m, api } = await renderPlay(new MockBackend());   // 8 players, 4 BLUE / 4 YELLOW (TDM)
    await m.click('KING OF THE HILL');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const after = await api.getState();
    expect(after.config.mode, 'the first tap must not reach the server').toBe('tdm');
    const split = m.find('[data-testid="confirm-split"]')[0];
    expect(split, 'the predicted split is on screen before anything moves').toBeTruthy();
    expect(split.textContent).toBe('▲ 8 PLAYERS → RED 4 / BLUE 4');   // F413 scope decision: a mode change gives red+blue
    expect(m.text()).toContain('TAP AGAIN TO SWITCH');
    m.unmount();
  });

  it('the second tap on the SAME mode commits exactly one pick', async () => {
    const { m, api } = await renderPlay(new MockBackend());
    await m.click('KING OF THE HILL');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('KING OF THE HILL');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const after = await api.getState();
    expect(after.config.mode).toBe('koth');
    expect(m.find('[data-testid="confirm-split"]').length, 'the confirm is gone once applied').toBe(0);
    m.unmount();
  });

  it('re-picking the mode already applied is still one tap (splitLine has nothing to confirm)', async () => {
    const { m, api } = await renderPlay(new MockBackend());   // already TDM
    await m.click('TEAM DEATHMATCH');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const after = await api.getState();
    expect(after.config.mode).toBe('tdm');
    expect(m.find('[data-testid="confirm-split"]').length).toBe(0);
    m.unmount();
  });

  it('tapping a DIFFERENT mode cancels the pending confirm rather than stacking it', async () => {
    const { m, api } = await renderPlay(new MockBackend());
    await m.click('KING OF THE HILL');   // arms the confirm for KOTH
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('TEAM DEATHMATCH');   // a DIFFERENT mode -- and TDM is already applied, so one tap picks it
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const after = await api.getState();
    expect(after.config.mode, 'TDM must have been picked, not KOTH from a stale confirm').toBe('tdm');
    expect(m.find('[data-testid="confirm-split"]').length).toBe(0);
    m.unmount();
  });
});

describe('PLAY — review follow-up: loading a FAVOURITE that reshapes the roster asks first too', () => {
  // F413 scope decision (2026-09-27): this favourite carries NO explicit `match.teams` (an older
  // favourite, saved before F413) -- loading it still reshapes, through `putConfig`'s own mode-changed
  // BASE rebuild (the NEW mode's own catalogue `defaults.teams`, blue+red for every team mode now,
  // team-lead's decision) rather than through pick()'s own reset (a SEPARATE code path entirely; a
  // favourite saved WITH an explicit teams list would carry ITS OWN saved colours instead, whatever
  // they were at save time).
  async function favouriteToKoth(api: MockBackend) {
    const before = await api.getState();
    await api.createFavourite({ name: 'KOTH Setup', countdown_s: 30,
      pick: { pieces: { ...before.game_pick!.pieces, mode: 'builtin:mode:koth' }, match: before.game_pick!.match } });
  }

  it('the first tap sends nothing and shows the predicted split', async () => {
    const api = new MockBackend();
    await favouriteToKoth(api);
    const { m } = await renderPlay(api);   // 8 players, 4 BLUE / 4 YELLOW (TDM)
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });   // getFavourites settles
    await m.click('KOTH Setup');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const after = await api.getState();
    expect(after.config.mode, 'the first tap must not reach the server').toBe('tdm');
    const split = m.find('[data-testid="confirm-split"]')[0];
    expect(split, 'the predicted split is on screen before anything moves').toBeTruthy();
    expect(split.textContent).toBe('▲ 8 PLAYERS → RED 4 / BLUE 4');
    m.unmount();
  });

  it('the second tap on the SAME favourite commits it', async () => {
    const api = new MockBackend();
    await favouriteToKoth(api);
    const { m } = await renderPlay(api);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('KOTH Setup');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('KOTH Setup');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const after = await api.getState();
    expect(after.config.mode).toBe('koth');
    expect(m.find('[data-testid="confirm-split"]').length, 'the confirm is gone once applied').toBe(0);
    m.unmount();
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

  it('M7: tapping LAST MATCH applies its four values and its countdown, not just renders the button', async () => {
    const api = new MockBackend();
    await api.pick({ match: { frag_limit: 15, night: true, silenced: true } });
    await api.setPhase('lobby');
    await api.pushLobby(true);
    await api.start(45, true);
    await api.abort();   // back to LOBBY (editable) with last_match still recorded
    // move the live pick away from LAST MATCH's values, so applying it has something to prove
    await api.pick({ match: { frag_limit: null, night: false, silenced: false } });
    const { m, settle } = await renderPlay(api);
    await m.click('LAST MATCH');
    m.unmount();
    const m2 = await settle();
    const after = await api.getState();
    expect(after.game_pick?.match).toEqual({ time_limit_s: 600, frag_limit: 15, night: true, silenced: true });
    expect(m2.find('[data-testid="match-kills-value"]')[0].textContent).toContain('15 KILLS');
    const nightBtn = m2.find('button').find(b => (b.textContent ?? '').trim() === 'NIGHT') as HTMLButtonElement;
    expect(nightBtn.getAttribute('aria-pressed')).toBe('true');
    expect(m2.find('[data-testid="match-countdown-value"]')[0].textContent).toContain('45');
    m2.unmount();
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

describe('PLAY — H1: CONTINUE TO KIT only follows a successful setPhase', () => {
  it('a refused setPhase does not navigate, and a real second tap before it answers does not double-fire', async () => {
    const real = new MockBackend();
    await real.loadGame();
    const state = await real.getState();
    const weapons = await real.getWeapons(), perks = await real.getPerks();
    let calls = 0;
    // an artificial delay -- round 2: the OLD version of this test clicked once and awaited the whole
    // round-trip before checking `calls`, which never actually raced a second tap against the first
    // (nothing was still in flight for it to race). Two separate `act()` taps, each flushing React's
    // state, is the same shape as two real, distinct clicks (play.test.tsx's own SAVE-guard test, above).
    const api = fixtureApi({ setPhase: async () => { calls++; await new Promise(r => setTimeout(r, 15)); throw Object.assign(new Error('2 PLAYERS ARE NOT READY'), { status: 409 }); } }, real);
    const views: string[] = [];
    const store = makeStore({ state, weapons, perks, view: 'build' }, { api, setView: v => { views.push(v as string); return true; } });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    const btn = () => m.find('[data-testid="game-continue-kit"] button')[0] as HTMLButtonElement;
    await act(async () => { btn().click(); });
    await act(async () => { btn().click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 25)); });
    expect(views, 'a refused setPhase must not navigate to KIT').toEqual([]);
    expect(calls, 'the busy guard must have blocked the second tap').toBe(1);
    m.unmount();
  });
});

describe('PLAY — H2: a REFUSED favourite load changes nothing', () => {
  it('shows the refusal and leaves the runway and the fallback note alone', async () => {
    const d = await demo();
    const fakeFav = { favourite_id: 'fav1', name: 'BENCH ONE', created_t: 0, updated_t: 0, pick: d.state.game_pick!, countdown_s: 60 };
    const api = fixtureApi({
      getFavourites: async () => [fakeFav],
      loadFavourite: async () => ({ ok: false, errors: ['TIME LIMIT REFUSED BY THE BENCH GATE'], config: d.state.config, pick: d.state.game_pick!, countdown_s: 999, fallbacks: [] }),
    }, d.api);
    const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api });
    const before = getRunway();
    const m = await mount(<StoreCtx.Provider value={store}><Games /><NoticeProbe /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });   // getFavourites settles
    await m.click('BENCH ONE');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(getRunway(), 'a refused load must not touch the runway (never 999)').toBe(before);
    expect(m.find('[data-testid="favourite-fallback-note"]').length, 'and no fallback note either').toBe(0);
    expect(m.find('[data-testid="notice-probe"]')[0].textContent).toContain('TIME LIMIT REFUSED');
    m.unmount();
  });
});

describe('PLAY — M4: LAST MATCH awaits the pick before applying its countdown', () => {
  it('a refused restore shows the refusal and leaves the runway alone', async () => {
    const real = new MockBackend();
    await real.pick({ match: { frag_limit: 15, night: true, silenced: true } });
    await real.setPhase('lobby');
    await real.pushLobby(true);
    await real.start(45, true);
    await real.abort();
    const state = await real.getState();
    const weapons = await real.getWeapons(), perks = await real.getPerks();
    const api = fixtureApi({
      pick: async () => ({ ok: false, errors: ['TIME LIMIT REFUSED BY THE BENCH GATE'], config: state.config, pick: state.game_pick!, fallbacks: [] }),
    }, real);
    const before = getRunway();
    const store = makeStore({ state, weapons, perks, view: 'build' }, { api });
    const m = await mount(<StoreCtx.Provider value={store}><Games /><NoticeProbe /></StoreCtx.Provider>);
    await m.click('LAST MATCH');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(getRunway(), 'a refused pick must not apply LAST MATCH’s countdown (never 45)').toBe(before);
    expect(m.find('[data-testid="notice-probe"]')[0].textContent).toContain('TIME LIMIT REFUSED');
    m.unmount();
  });
});

describe('PLAY — M5: a FAVOURITES fetch failure', () => {
  it('a 404 (an older MC) is silent', async () => {
    const d = await demo();
    const err = Object.assign(new Error('not found'), { status: 404 });
    const api = fixtureApi({ getFavourites: async () => { throw err; } }, d.api);
    const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="play-favourites-error"]').length).toBe(0);
    m.unmount();
  });

  it('any other failure shows, with a RETRY that tries again', async () => {
    const d = await demo();
    let calls = 0;
    const api = fixtureApi({ getFavourites: async () => { calls++; if (calls === 1) throw new Error('socket reset'); return []; } }, d.api);
    const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="play-favourites-error"]').length).toBe(1);
    expect(m.text()).toContain('SOCKET RESET');   // alertWords upper-cases the whole line
    await m.click('RETRY');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="play-favourites-error"]').length, 'RETRY must try again, and this time it lands').toBe(0);
    expect(calls).toBe(2);
    m.unmount();
  });

  it('does not fetch while known offline, and retries on its own once a real reconnect happens', async () => {
    const d = await demo();
    let calls = 0;
    const api = fixtureApi({ getFavourites: async () => { calls++; return []; } }, d.api);
    const m = await mount(<StoreCtx.Provider value={makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api, connected: false })}><Games /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(calls, 'no point fetching while the console itself says offline').toBe(0);
    await m.update(<StoreCtx.Provider value={makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api, connected: true })}><Games /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(calls, 'connected flipping true must trigger its own fetch').toBe(1);
    m.unmount();
  });
});

describe('PLAY — Lows', () => {
  it('SAVE AS A FAVOURITE cannot fire twice from one name', async () => {
    const real = new MockBackend();
    let calls = 0;
    const api: Api = fixtureApi({ createFavourite: async p => { calls++; await new Promise(r => setTimeout(r, 5)); return real.createFavourite(p); } }, real);
    const { m } = await renderPlay(api as unknown as MockBackend);
    await m.click('SAVE AS A FAVOURITE');
    const input = m.find('input[aria-label="favourite name"]')[0] as HTMLInputElement;
    await typeInto(input, 'BENCH ONE');
    const saveBtn = m.find('button').find(b => (b.textContent ?? '').includes('SAVE ▸')) as HTMLButtonElement;
    // two SEPARATE act() calls, each flushing React's state -- the same shape as two real, distinct
    // clicks (a single synchronous double-`.click()` batches into one render either way and proves
    // nothing about the guard).
    await act(async () => { saveBtn.click(); });
    await act(async () => { saveBtn.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(calls, 'a second tap before the first round-trip lands must not fire again').toBe(1);
    m.unmount();
  });

  it('a saved favourite’s countdown_s agrees with the (now snapped) screen value', async () => {
    const api = new MockBackend();
    const restore = getRunway();
    setRunway(40);   // not a RUNWAYS member -- runway.ts's own setRunway snaps it immediately (round 2)
    expect(getRunway(), 'the screen itself must already read the snapped value').toBe(45);
    try {
      const { m } = await renderPlay(api);
      await m.click('SAVE AS A FAVOURITE');
      const input = m.find('input[aria-label="favourite name"]')[0] as HTMLInputElement;
      await typeInto(input, 'DRIFTED');
      await m.click('SAVE ▸');
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      const favs = await api.getFavourites();
      expect(favs.find(f => f.name === 'DRIFTED')?.countdown_s).toBe(45);
      m.unmount();
    } finally { setRunway(restore); }
  });

  it('CONTINUE TO KIT is disabled by an empty required loadout slot, not just a locked phase', async () => {
    const d = await demo();
    const withEmptyPool = {
      ...d.state,
      game: { loaded: true, sent: 0, total: d.state.players.length, config_id: d.state.config.config_id },
      loadout_pool: {
        primary: [], secondary_weapons: d.state.loadout_pool.secondary_weapons, perks: d.state.loadout_pool.perks,
        reasons: { primary: 'filtered' as const },
      },
    };
    const store = makeStore({ state: withEmptyPool, weapons: d.weapons, perks: d.perks, view: 'build' }, { api: d.api });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    const btn = m.find('[data-testid="game-continue-kit"] button')[0] as HTMLButtonElement;
    expect(btn.disabled, 'an empty PRIMARY pool must block CONTINUE TO KIT even though the phase is not locked').toBe(true);
    m.unmount();
  });

  it('a fallback note clears on the next pick, not only on the next favourite load', async () => {
    const api = new MockBackend();
    const before = await api.getState();
    await api.createFavourite({ name: 'GONE SPAWN', countdown_s: 30, pick: { pieces: { ...before.game_pick!.pieces, primary: 'does-not-exist' }, match: before.game_pick!.match } });
    // `fallbackNote` is local screen state, not server state -- checked within ONE mount (no
    // unmount/settle round-trip, which starts a fresh `Games` instance and loses it).
    const { m } = await renderPlay(api);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });   // getFavourites settles
    await m.click('GONE SPAWN');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="favourite-fallback-note"]').length, 'the fallback note shows right after the load').toBe(1);
    await m.click('HARDCORE');   // any other pick, not a mode switch (round 4 gave that its own confirm)
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="favourite-fallback-note"]').length, 'and is gone after the very next pick').toBe(0);
    m.unmount();
  });

  // Round 2 (server review): pick() itself can now report a fallback too -- a kind the request did NOT
  // name (here, MODE: an inherited post-MVP piece a KIT edit set, round 2 #6's own game_pick sync) can
  // fall back to its builtin, shown the same way a favourite-load fallback already is.
  it('an ordinary pick shows a fallback note for a kind it did not itself change', async () => {
    const api = new MockBackend();
    await api.putConfig({ mode: 'infection' });   // GameEditPanel's inline KIT edit
    expect((await api.getState()).game_pick!.pieces.mode).toBe('builtin:mode:infection');
    const { m } = await renderPlay(api);
    await m.click('SHIELDS');   // picks LIFE, not MODE -- 'mode' is purely inherited on this request
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="favourite-fallback-note"]').length).toBe(1);
    expect(m.text()).toContain('GAME MODE');
    const after = await api.getState();
    expect(after.game_pick!.pieces.mode).toBe('builtin:mode:tdm');
    m.unmount();
  });
});

describe('PLAY — UX round 1: FAVOURITE rename has an explicit ✓, and ✕ truly cancels', () => {
  it('✓ commits the typed name', async () => {
    const api = new MockBackend();
    await api.createFavourite({ name: 'Old Name', countdown_s: 30 });
    const { m } = await renderPlay(api);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });   // getFavourites settles
    await act(async () => { (m.find('button[aria-label="rename Old Name"]')[0] as HTMLButtonElement).click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const input = m.find('input[aria-label="rename Old Name"]')[0] as HTMLInputElement;
    await typeInto(input, 'New Name');
    const saveBtn = m.find('button[aria-label="save rename"]')[0] as HTMLButtonElement;
    await act(async () => { saveBtn.click(); });
    // renameFavourite's own chain (updateFavourite, then refreshFavourites -> getFavourites ->
    // setFavourites) is a few promise hops deep -- flush it fully while still MOUNTED, or its last
    // `setFavourites` lands on an unmounted Games in whichever test runs next.
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    const favs = await api.getFavourites();
    expect(favs[0].name).toBe('New Name');
    m.unmount();
  });

  // Round 2 (5): made real. A plain `.click()` (the old version of this test) fires only a 'click'
  // event -- no mousedown, no blur -- so it never actually exercised the hazard at all: a REAL click
  // moves focus (a native `focusout`, `relatedTarget` set to whatever is about to take it) BEFORE the
  // click event reaches the button, and `DraftText`'s own onBlur used to commit on that focus shift,
  // ahead of ✕'s own handler ever running.
  it('✕ (mouse): focus, mousedown, blur (relatedTarget ✕), click, in that order — does not commit', async () => {
    const api = new MockBackend();
    await api.createFavourite({ name: 'Old Name', countdown_s: 30 });
    const { m } = await renderPlay(api);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await act(async () => { (m.find('button[aria-label="rename Old Name"]')[0] as HTMLButtonElement).click(); });
    const input = m.find('input[aria-label="rename Old Name"]')[0] as HTMLInputElement;
    await typeInto(input, 'Should Not Save');
    const cancelBtn = m.find('button[aria-label="cancel rename"]')[0] as HTMLButtonElement;
    await act(async () => {
      input.focus();
      cancelBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: cancelBtn }));
      cancelBtn.click();
    });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const favs = await api.getFavourites();
    expect(favs[0].name, 'the blur that focus-shift caused must not have committed the draft').toBe('Old Name');
    m.unmount();
  });

  it('Tab to ✕ (a real blur, relatedTarget ✕) then Enter cancels', async () => {
    const api = new MockBackend();
    await api.createFavourite({ name: 'Old Name', countdown_s: 30 });
    const { m } = await renderPlay(api);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await act(async () => { (m.find('button[aria-label="rename Old Name"]')[0] as HTMLButtonElement).click(); });
    const input = m.find('input[aria-label="rename Old Name"]')[0] as HTMLInputElement;
    await typeInto(input, 'Should Not Save');
    const cancelBtn = m.find('button[aria-label="cancel rename"]')[0] as HTMLButtonElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: cancelBtn }));   // what Tab does
      cancelBtn.focus();
      cancelBtn.click();   // jsdom does not turn a keydown Enter on a button into a click on its own
    });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const favs = await api.getFavourites();
    expect(favs[0].name, 'Tab’s own blur must not have committed the draft either').toBe('Old Name');
    m.unmount();
  });

  it('Escape cancels and leaves rename mode, without committing the draft', async () => {
    const api = new MockBackend();
    await api.createFavourite({ name: 'Old Name', countdown_s: 30 });
    const { m } = await renderPlay(api);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await act(async () => { (m.find('button[aria-label="rename Old Name"]')[0] as HTMLButtonElement).click(); });
    const input = m.find('input[aria-label="rename Old Name"]')[0] as HTMLInputElement;
    await typeInto(input, 'Should Not Save');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid^="favourite-rename-"]').length, 'Escape must leave rename mode').toBe(0);
    const favs = await api.getFavourites();
    expect(favs[0].name).toBe('Old Name');
    m.unmount();
  });

  // Round 3: `suppressCommit` was never reset after Escape/✕, so every LATER rename on that SAME chip
  // started with it already true -- Enter (a real commit) saved nothing from then on.
  it('a rename AFTER an Escape’d one still saves on Enter', async () => {
    const api = new MockBackend();
    await api.createFavourite({ name: 'Old Name', countdown_s: 30 });
    const { m } = await renderPlay(api);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    // first session: Escape (discarded, but this is what used to poison the next one)
    await act(async () => { (m.find('button[aria-label="rename Old Name"]')[0] as HTMLButtonElement).click(); });
    let input = m.find('input[aria-label="rename Old Name"]')[0] as HTMLInputElement;
    await typeInto(input, 'Discarded');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    // second session on the SAME chip: type a name and commit it the normal way (Enter -> blur -> commit)
    await act(async () => { (m.find('button[aria-label="rename Old Name"]')[0] as HTMLButtonElement).click(); });
    input = m.find('input[aria-label="rename Old Name"]')[0] as HTMLInputElement;
    input.focus();
    await typeInto(input, 'New Name');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); input.blur(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const favs = await api.getFavourites();
    expect(favs[0].name, 'the SECOND rename must not be poisoned by the first one’s Escape').toBe('New Name');
    m.unmount();
  });
});

describe('PLAY — review Low: the pieces-error banner is gated on connected', () => {
  it('a stale piecesError does not flash while the console is known offline', async () => {
    const d = await demo();
    const err = new Error('socket reset');
    const api = fixtureApi({ getPieces: async () => { throw err; } }, d.api);
    const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api, connected: false });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="play-pieces-error"]').length, 'offline is already said elsewhere -- this must stay quiet').toBe(0);
    m.unmount();
  });

  it('the same failure shows once the console is connected', async () => {
    const d = await demo();
    const err = new Error('socket reset');
    const api = fixtureApi({ getPieces: async () => { throw err; } }, d.api);
    const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api, connected: true });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="play-pieces-error"]').length).toBe(1);
    m.unmount();
  });
});

describe('PLAY — review: an invalid piece is never offered, and does not break one-choice hiding', () => {
  it('excludes it from the picker entirely, without turning a one-choice kind into two', async () => {
    const api = new MockBackend();
    const p = await api.createPiece({ kind: 'primary', name: 'OLD FAVOURITE',
      value: { choice: 'fixed', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: 'assault_rifle' } });
    (api as unknown as { pieces: { piece_id: string; invalid?: string }[] }).pieces
      .find(x => x.piece_id === p.piece_id)!.invalid = 'NAMES FORCE RIFLE, WHICH IS NO LONGER OFFERED: PICK A DIFFERENT WEAPON OR PERK';
    const { m } = await renderPlay(api);
    expect(m.find('[data-testid="picker-primary"]').length, 'one-choice hiding still applies with the invalid piece excluded').toBe(0);
    expect(m.text()).not.toContain('OLD FAVOURITE');
    m.unmount();
  });
});

/** A button inside ONE container, matched by its exact (trimmed) text -- `m.click` searches the whole
 *  document and would as happily hit a Seg option on a DIFFERENT control sharing the same label. */
async function clickIn(container: HTMLElement, text: string) {
  const btn = Array.from(container.querySelectorAll('button')).find(b => (b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined;
  if (!btn) throw new Error(`no button "${text}" inside the container -- saw: ${
    Array.from(container.querySelectorAll('button')).map(b => (b.textContent ?? '').trim().slice(0, 24)).join(' | ')}`);
  await act(async () => { btn.click(); });
}

describe('PLAY — F413: TEAMS strip item', () => {
  it('shows for TDM, reading the ROSTER’S actual teams (never an invented default)', async () => {
    const { m } = await renderPlay(new MockBackend());   // 8 players, 4 BLUE / 4 YELLOW (TDM)
    const teamsEl = m.find('[data-testid="match-teams-item"]')[0];
    expect(teamsEl, 'TDM offers TEAMS (data.ts TDM_ITEMS)').toBeTruthy();
    expect(teamsEl.textContent).toContain('BLUE');
    expect(teamsEl.textContent).toContain('YELLOW');
    m.unmount();
  });

  it('is absent for FFA (data.ts FFA_ITEMS names no teams item)', async () => {
    const { m, settle } = await renderPlay(new MockBackend());
    await m.click('FREE-FOR-ALL');   // FFA’s own single team: splitLine has <2 newTeams, no confirm
    m.unmount();
    const m2 = await settle();
    expect(m2.find('[data-testid="match-teams-item"]').length).toBe(0);
    m2.unmount();
  });

  it('a count change to 3 asks first, and the second tap commits 3 teams', async () => {
    const { m, api, settle } = await renderPlay(new MockBackend());
    const teamsEl = () => m.find('[data-testid="match-teams-item"]')[0];
    await clickIn(teamsEl(), '3');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect((await api.getState()).game_pick?.match.teams, 'the first tap must not reach the server').toBeUndefined();
    expect(m.text()).toContain('TAP A TEAMS CONTROL AGAIN TO SWITCH');
    await clickIn(teamsEl(), '3');
    m.unmount();
    const m2 = await settle();
    const after = await api.getState();
    expect(after.game_pick?.match.teams).toHaveLength(3);
    expect(after.config.teams.map(t => t.team_id)).toEqual(after.game_pick?.match.teams);
    expect(m2.find('[data-testid="match-teams-item"]')[0].textContent, 'confirm gone, the strip agrees with the server').not.toContain('TAP A TEAMS');
    m2.unmount();
  });

  it('a colour change on one slot asks first too, and reshapes the roster on commit', async () => {
    const { m, api, settle } = await renderPlay(new MockBackend());
    const chooser0 = () => m.find('[data-testid="match-teams-colour-0"]')[0];
    await clickIn(chooser0(), 'RED');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect((await api.getState()).config.teams.map(t => t.team_id)).toEqual(['blue', 'yellow']);   // unchanged
    await clickIn(chooser0(), 'RED');
    m.unmount();
    await settle();
    const after = await api.getState();
    expect(after.config.teams.map(t => t.team_id)).toEqual(['red', 'yellow']);
    expect(after.players.some(p => p.team_id === 'blue'), 'nobody left on a team no longer declared').toBe(false);
  });

  it('KOTH: no count control, and yellow is never offered', async () => {
    const { m, api, settle } = await renderPlay(new MockBackend());
    await m.click('KING OF THE HILL');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('KING OF THE HILL');   // second tap commits (round 4's own confirm)
    m.unmount();
    // a settled RE-RENDER, not a read off the live mount -- the mode-switch round trip lands over more
    // than one microtask/macrotask hop, and the live subscription can still be a tick behind here
    // (play.mjs's own `pickMode` helper double-clicks for the same reason; harness.tsx's `settle` re-
    // fetches state and remounts fresh, which every OTHER content check after a commit in this file uses).
    const m2 = await settle();
    expect((await api.getState()).config.mode).toBe('koth');
    const teamsEl = m2.find('[data-testid="match-teams-item"]')[0];
    expect(m2.find('[aria-label="team count"]').length, 'KOTH fixes the count at 2, no control shown').toBe(0);
    expect(teamsEl.textContent).not.toContain('YELLOW');
    m2.unmount();
  });

  // Review MEDIUM (brx1, e8811fea): four equal filled swatches read as four choices already made, not
  // one pick among several -- and the slot itself was unlabelled.
  it('labels each slot TEAM 1, TEAM 2, …, and only the chosen swatch is filled', async () => {
    const { m } = await renderPlay(new MockBackend());   // TDM, blue/yellow
    const teamsEl = m.find('[data-testid="match-teams-item"]')[0];
    expect(teamsEl.textContent).toContain('TEAM 1');
    expect(teamsEl.textContent).toContain('TEAM 2');
    const slot0 = m.find('[data-testid="match-teams-colour-0"]')[0];
    const chosen = slot0.querySelector('button[aria-pressed="true"]') as HTMLButtonElement;
    const other = slot0.querySelector('button[aria-pressed="false"]') as HTMLButtonElement;
    expect(chosen, 'the chosen slot 0 swatch (BLUE) exists').toBeTruthy();
    expect(other, 'an unchosen option exists to compare against').toBeTruthy();
    expect(chosen.style.background, 'the CHOSEN swatch is filled with its own colour').not.toBe('transparent');
    expect(other.style.background, 'an UNCHOSEN option is outlined, not filled').toBe('transparent');
    m.unmount();
  });

  // Low (d): at 4 teams every colour is already spoken for, so a slot's own "choice" is really just
  // itself -- a single, disabled swatch, not a button that looks pickable but never does anything.
  it('at 4 teams, a slot with only its own colour left is disabled', async () => {
    const { m, settle } = await renderPlay(new MockBackend());
    const teamsEl = () => m.find('[data-testid="match-teams-item"]')[0];
    await clickIn(teamsEl(), '4');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await clickIn(teamsEl(), '4');
    m.unmount();
    // a settled RE-RENDER: the count commit is a server round trip like any other pick, and the live
    // mount can still be a tick behind it (same reason the KOTH test above settles).
    const m2 = await settle();
    const chosers = [0, 1, 2, 3].map(i => m2.find(`[data-testid="match-teams-colour-${i}"]`)[0]);
    const buttonCounts = chosers.map(c => c.querySelectorAll('button').length);
    expect(buttonCounts.some(n => n === 1), `at least one slot has only its own colour left (saw ${JSON.stringify(buttonCounts)})`).toBe(true);
    const singleSlot = chosers[buttonCounts.findIndex(n => n === 1)]!;
    const onlyBtn = singleSlot.querySelector('button') as HTMLButtonElement;
    expect(onlyBtn.disabled, 'a slot with no real choice is disabled, not a dead-end tap').toBe(true);
    m2.unmount();
  });
});

describe('PLAY — F415: HOLD strip item (KOTH only)', () => {
  it('is absent on TDM, present on KOTH, starting at NO TARGET', async () => {
    const { m, api, settle } = await renderPlay(new MockBackend());
    expect(m.find('[data-testid="match-hold-value"]').length, 'TDM has no hold item').toBe(0);
    await m.click('KING OF THE HILL');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('KING OF THE HILL');
    m.unmount();
    const m2 = await settle();   // see the comment on the TEAMS item's own KOTH test, above
    expect((await api.getState()).config.mode).toBe('koth');
    expect(m2.find('[data-testid="match-hold-value"]')[0].textContent).toContain('NO TARGET');
    m2.unmount();
  });

  it('"5 MIN" reaches the server as hold_target_s: 300', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    const { m } = await renderPlay(api);
    await m.click('NO TARGET');
    await m.click('5 MIN');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect((await api.getState()).config.scoring.hold_target_s).toBe(300);
    m.unmount();
  });

  it('a mode change away and back resets the target to NO TARGET, like the other limits', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await api.pick({ match: { hold_target_s: 300 } });
    await api.pick({ pieces: { mode: 'builtin:mode:tdm' } });
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    const { m } = await renderPlay(api);
    expect(m.find('[data-testid="match-hold-value"]')[0].textContent).toContain('NO TARGET');
    m.unmount();
  });

  // Review MEDIUM (brx1, e8811fea): NO TARGET on its own says nothing about what it is NO TARGET *of*.
  it('the item carries a leading HOLD label, not just the value', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    const { m } = await renderPlay(api);
    const value = m.find('[data-testid="match-hold-value"]')[0];
    const holdItem = value.closest('span')!;
    expect(holdItem.textContent).toMatch(/^HOLD/);
    m.unmount();
  });

  // Low (b): the server refuses past 2:00:00 (7200 s) -- the stepper must not walk up to a value it
  // would only send back refused.
  it('the + stepper clamps at 120 MIN and then disables itself', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await api.pick({ match: { hold_target_s: 7140 } });   // 119 MIN -- one step short of the ceiling
    const { m, settle } = await renderPlay(api);
    const plus = m.find('button[aria-label="hold target plus"]')[0] as HTMLButtonElement;
    await act(async () => { plus.click(); });
    m.unmount();
    // a settled RE-RENDER: the step is a server round trip like any other pick (see the TEAMS tests above).
    const m2 = await settle();
    expect((await api.getState()).config.scoring.hold_target_s, 'one step reaches the ceiling exactly').toBe(7200);
    const plusAfter = m2.find('button[aria-label="hold target plus"]')[0] as HTMLButtonElement;
    expect(plusAfter.disabled, 'at the ceiling, + disables rather than inviting a refused step').toBe(true);
    await act(async () => { plusAfter.click(); });
    expect((await api.getState()).config.scoring.hold_target_s, 'a disabled + button does nothing').toBe(7200);
    m2.unmount();
  });
});

describe('PLAY — F413/F415: LAST MATCH and FAVOURITES carry teams and the hold target forward', () => {
  it('LAST MATCH applies the hold target and the team colours it recorded, on the SAME mode', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await api.pick({ match: { hold_target_s: 300, teams: ['red', 'purple'] } });
    await api.putStation('util-a1b2c3', { kind: 'control', team: 'any', id: 9 });   // KOTH needs a hill to push
    await api.setPhase('lobby');
    await api.pushLobby(true);
    await api.start(45, true);
    await api.abort();
    // move the live pick away, so LAST MATCH applying it again has something to prove
    await api.pick({ match: { hold_target_s: null, teams: ['blue', 'purple'] } });
    const { m, settle } = await renderPlay(api);
    await m.click('LAST MATCH');
    m.unmount();
    await settle();
    const after = await api.getState();
    expect(after.game_pick?.match.hold_target_s).toBe(300);
    expect(after.game_pick?.match.teams).toEqual(['red', 'purple']);
  });

  // Review MEDIUM (brx1, e8811fea): a last match played on TDM with 3 teams (or a yellow pick) used to
  // send that array straight into a KOTH pick, which koth's own exactly-2/never-yellow rules refuse --
  // and since it is ONE pick() call, that refusal used to roll back the OTHER four fields too. The mode
  // sharing the 'teams' item is not the same as the last match's own teams being LEGAL for it.
  it('LAST MATCH drops an illegal team count/colour for the CURRENT mode, but still applies the rest', async () => {
    const api = new MockBackend();
    // played on TDM with 3 teams, a kill limit, night and silenced
    await api.pick({ match: { teams: ['red', 'blue', 'yellow'], frag_limit: 15, night: true, silenced: true } });
    await api.setPhase('lobby');
    await api.pushLobby(true);
    await api.start(45, true);
    await api.abort();
    // now on KOTH (a real mode change: resets teams to koth's own default, red/blue) -- and the live
    // pick moved away from last_match's OWN values, so applying it has something to prove
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await api.putStation('util-a1b2c3', { kind: 'control', team: 'any', id: 9 });   // KOTH needs a hill to push
    await api.pick({ match: { frag_limit: null, night: false, silenced: false } });
    const before = await api.getState();
    expect(before.game_pick?.match.teams, 'control: koth is legally on its own 2-team default').toEqual(['red', 'blue']);
    const { m, settle } = await renderPlay(api);
    await m.click('LAST MATCH');
    m.unmount();
    await settle();
    const after = await api.getState();
    expect(after.game_pick?.match.frag_limit, 'the other fields still apply').toBe(15);
    expect(after.game_pick?.match.night).toBe(true);
    expect(after.game_pick?.match.silenced).toBe(true);
    expect(after.game_pick?.match.teams, 'the illegal 3-team array was dropped, koth kept its own default').toEqual(['red', 'blue']);
  });

  // brx1's review of 4275fad2: the yellow half of `kothLegal` had no test (a 2-team array that is legal
  // by COUNT but carries yellow, KOTH's neutral team, F82).
  it('LAST MATCH drops a 2-team array that includes YELLOW when the current mode is KOTH', async () => {
    const api = new MockBackend();
    await api.pick({ match: { teams: ['red', 'yellow'], frag_limit: 15, night: true } });
    await api.setPhase('lobby');
    await api.pushLobby(true);
    await api.start(45, true);
    await api.abort();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await api.putStation('util-a1b2c3', { kind: 'control', team: 'any', id: 9 });
    await api.pick({ match: { frag_limit: null, night: false } });
    expect((await api.getState()).game_pick?.match.teams, 'control: koth is on its own default').toEqual(['red', 'blue']);
    const { m, settle } = await renderPlay(api);
    await m.click('LAST MATCH');
    m.unmount();
    await settle();
    const after = await api.getState();
    expect(after.game_pick?.match.night, 'the other fields still apply').toBe(true);
    expect(after.game_pick?.match.teams, 'yellow is never sent into KOTH').toEqual(['red', 'blue']);
  });

  it('a FAVOURITE saved on KOTH with a hold target restores it on load', async () => {
    const api = new MockBackend();
    await api.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await api.pick({ match: { hold_target_s: 600 } });
    await api.createFavourite({ name: 'Hill Rush', countdown_s: 30 });
    await api.pick({ pieces: { mode: 'builtin:mode:tdm' } });   // resets hold_target_s to null
    const { m, settle } = await renderPlay(api);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });   // getFavourites settles
    // the favourite’s own mode (KOTH) reshapes the roster from TDM’s current split -- same two-tap
    // confirm as any other favourite load (review follow-up, above).
    await m.click('Hill Rush');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('Hill Rush');
    m.unmount();
    await settle();
    const after = await api.getState();
    expect(after.config.mode).toBe('koth');
    expect(after.game_pick?.match.hold_target_s).toBe(600);
  });
});
