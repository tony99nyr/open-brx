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
    const { m, api, settle } = await renderPlay(new MockBackend());
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
  it('a refused setPhase does not navigate, and busy blocks a second tap before it answers', async () => {
    const real = new MockBackend();
    await real.loadGame();
    const state = await real.getState();
    const weapons = await real.getWeapons(), perks = await real.getPerks();
    let calls = 0;
    const api = fixtureApi({ setPhase: async () => { calls++; throw Object.assign(new Error('2 PLAYERS ARE NOT READY'), { status: 409 }); } }, real);
    const views: string[] = [];
    const store = makeStore({ state, weapons, perks, view: 'build' }, { api, setView: v => views.push(v as string) });
    const m = await mount(<StoreCtx.Provider value={store}><Games /></StoreCtx.Provider>);
    await m.click('CONTINUE TO KIT');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(views, 'a refused setPhase must not navigate to KIT').toEqual([]);
    expect(calls, 'one request, not a double-fire').toBe(1);
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
      pick: async () => ({ ok: false, errors: ['TIME LIMIT REFUSED BY THE BENCH GATE'], config: state.config, pick: state.game_pick! }),
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

  it('retries on its own once a real reconnect happens, not only off a RETRY tap', async () => {
    const d = await demo();
    let calls = 0;
    const api = fixtureApi({ getFavourites: async () => { calls++; if (calls === 1) throw new Error('down'); return []; } }, d.api);
    const m = await mount(<StoreCtx.Provider value={makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api, connected: false })}><Games /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(calls).toBe(1);
    await m.update(<StoreCtx.Provider value={makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' }, { api, connected: true })}><Games /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(calls, 'connected flipping true must trigger its own retry').toBe(2);
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

  it('a saved favourite’s countdown_s snaps to the nearest RUNWAYS value', async () => {
    const api = new MockBackend();
    const restore = getRunway();
    setRunway(40);   // not a RUNWAYS member (would come from a LAST MATCH/favourite that drifted)
    try {
      const { m } = await renderPlay(api);
      await m.click('SAVE AS A FAVOURITE');
      const input = m.find('input[aria-label="favourite name"]')[0] as HTMLInputElement;
      await typeInto(input, 'DRIFTED');
      await m.click('SAVE ▸');
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      const favs = await api.getFavourites();
      expect(favs.find(f => f.name === 'DRIFTED')?.countdown_s).toBe(45);   // nearest to 40
      expect(getRunway()).toBe(40);   // the LIVE runway itself is never rewritten, only what gets saved
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
    await m.click('KING OF THE HILL');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="favourite-fallback-note"]').length, 'and is gone after the very next pick').toBe(0);
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

  it('✕ discards the typed name, even though the click blurs the input first', async () => {
    const api = new MockBackend();
    await api.createFavourite({ name: 'Old Name', countdown_s: 30 });
    const { m } = await renderPlay(api);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await act(async () => { (m.find('button[aria-label="rename Old Name"]')[0] as HTMLButtonElement).click(); });
    const input = m.find('input[aria-label="rename Old Name"]')[0] as HTMLInputElement;
    await typeInto(input, 'Should Not Save');
    const cancelBtn = m.find('button[aria-label="cancel rename"]')[0] as HTMLButtonElement;
    await act(async () => { cancelBtn.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const favs = await api.getFavourites();
    expect(favs[0].name, 'cancel must not have sent the typed name to the server').toBe('Old Name');
    m.unmount();
  });
});
