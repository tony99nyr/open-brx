// LOAD, and the ACTIVE GAME CONFIG state it puts the GAMES tab into (2026-09-13).
//
// Tony, verbatim: "At first on a new match the game tab should be as it is today. Pick or create
// customize. Instead of continue though it should be Load. Load pushes that config to phones. The tab
// should then change state to active game config. Every setting for the current config shown. Click
// Edit to modify and then Save and Load to update all phones."
//
// REVISED the same day, and the revision is the important part: "weapons have to go with the arm."
// The first cut called the real config push, which compiles a weapon head per player — and nobody has
// kitted at that point, so it wrote policy-DEFAULT loadouts to every gun and re-pushed on every kit
// pick. LOAD now tells the PHONES which game is loaded and leaves the guns untouched; weapons still
// reach them at the LOBBY push after kitting. So the tests below pin two things that are easy to
// regress together: that LOAD reaches the phones, and that it reaches NOTHING else.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api, GameConfig, ModeInfo, Phase, State } from '../src/api/types';
import { CommandBar } from '../src/frame/CommandBar';
import { Games } from '../src/screens/Games';
import { MockBackend } from '../src/mock/backend';
import { clearNotice } from '../src/notice';
import { StoreCtx } from '../src/store';
import { fixtureApi, makeStore, mount } from './harness';

const tap = async (el: Element | undefined | null) => {
  if (!el) throw new Error('no such control on screen');
  if ((el as HTMLButtonElement).disabled) throw new Error(`refusing to "click" a DISABLED control: ${(el.textContent ?? '').trim()}`);
  await act(async () => { (el as HTMLElement).click(); });
};

async function games(opts: { phase?: Phase; over?: Partial<Api>; patch?: (s: State) => State; load?: boolean; push?: boolean } = {}) {
  const backend = new MockBackend();
  const modes: ModeInfo[] = await backend.getModes();
  await backend.setPhase(opts.phase ?? 'build', true);
  if (opts.load) await backend.loadGame();
  if (opts.push) await backend.pushLobby(true);
  const calls = { putConfig: [] as Partial<GameConfig>[], loadGame: 0, pushLobby: [] as (boolean | undefined)[], setPhase: [] as string[] };
  const api = fixtureApi({
    putConfig: async (p: Partial<GameConfig>) => { calls.putConfig.push(p); return backend.putConfig(p); },
    loadGame: async () => { calls.loadGame++; return backend.loadGame(); },
    // The UI's ARGUMENT is what is asserted; the demo backend keeps its own red gun and unreachable
    // phone regardless of the board a fixture renders, so the push itself is forced to let the
    // assertions after it reach the state they are about.
    pushLobby: async (f?: boolean) => { calls.pushLobby.push(f); return backend.pushLobby(true); },
    setPhase: async (p: string, f?: boolean) => { calls.setPhase.push(p); return backend.setPhase(p, f); },
    ...(opts.over ?? {}),
  }, backend as unknown as Api);
  const views: string[] = [];
  const read = async () => { const s = await backend.getState(); return opts.patch ? opts.patch(s) : s; };
  let state = await read();
  const render = () => (
    <StoreCtx.Provider value={makeStore({ state, view: 'build' }, { api, modes, setView: v => { views.push(v); } })}>
      <Games />
    </StoreCtx.Provider>
  );
  const m = await mount(render());
  const settle = async () => { state = await read(); await m.update(render()); };
  const q = (sel: string) => m.el.querySelector(sel) as HTMLElement | null;
  const btn = (sel: string) => m.el.querySelector(`${sel} button`) as HTMLButtonElement | null;
  return { m, backend, api, modes, calls, views, settle, q, btn, state: () => state };
}

describe('GAMES · LOAD announces the game and writes no gun', () => {
  it('the primary control says LOAD, and it calls the announcement — never the config push', async () => {
    const g = await games();
    const load = g.btn('[data-testid="game-load"]');
    expect(load, 'a LOAD control is on the un-loaded GAMES tab').toBeTruthy();
    expect(load!.textContent).toContain('LOAD');
    expect(g.m.text(), 'CONTINUE is gone — it was the control that pushed nothing').not.toContain('CONTINUE ▸');
    await tap(load);
    expect(g.calls.loadGame, 'LOAD announces exactly once').toBe(1);
    expect(g.calls.pushLobby, '…and never touches the gun-writing push').toEqual([]);
    g.m.unmount();
  });

  it('LOAD leaves the lobby UN-pushed: weapons go with the arm, not with the game', async () => {
    // The whole revision in one assertion. A LOAD that set `lobby.pushed` would be compiling a
    // weapon head per player before anybody has kitted — policy defaults to every gun, re-pushed on
    // every kit pick, which is what the operator hit.
    const g = await games();
    await tap(g.btn('[data-testid="game-load"]'));
    const after = await g.backend.getState();
    expect(after.lobby.pushed, 'LOAD must not push config').toBe(false);
    expect(after.game?.loaded, 'it announced the game instead').toBe(true);
    g.m.unmount();
  });

  it('LOAD does not advance to KIT — the tab stays put and becomes the ACTIVE GAME CONFIG', async () => {
    const g = await games();
    await tap(g.btn('[data-testid="game-load"]'));
    expect(g.calls.setPhase, 'LOAD is an announcement, not a navigation').toEqual([]);
    expect(g.views, 'nothing navigated the console away from GAMES').toEqual([]);
    await g.settle();
    expect(g.q('[data-testid="active-game-config"]'), 'the tab changed state').toBeTruthy();
    expect(g.m.text()).toMatch(/Loaded Game/i);
    g.m.unmount();
  });

  it('the active state is keyed on the GAME being loaded, not on the lobby being pushed', async () => {
    const g = await games({ load: true });
    expect(g.state().lobby.pushed, 'control: nothing has been pushed to a gun').toBe(false);
    expect(g.q('[data-testid="active-game-config"]'), 'and the tab is still in its loaded state').toBeTruthy();
    g.m.unmount();
  });

  it('the active state shows EVERY setting, including the fields no control edits', async () => {
    const g = await games({ load: true });
    const txt = g.m.text();
    for (const label of ['TEAMS', 'WIN', 'RESPAWN', 'TIME', 'HEALTH', 'LOADOUT', 'VENUE',
                         'MODE RULES', 'SCORING', 'PHONE PICKS', 'COVERAGE', 'STUN (EMP)', 'SIPHON',
                         'HIT AUDIO', 'LED', 'PRESENTATION', 'VIP', 'PLAYER NUMBERS', 'CONFIG ID']) {
      expect(txt, `the loaded config names ${label}`).toContain(label);
    }
    expect(txt, 'and the config_id the guns must echo is on screen').toContain(g.state().config.config_id);
    g.m.unmount();
  });
});

describe('GAMES · the two counts are different facts and are worded as such', () => {
  it('the phone count is DELIVERY and says so, and the gun count is absent until there is a push', async () => {
    const g = await games({ load: true });
    const sent = g.q('[data-testid="game-load-status"]')!.textContent ?? '';
    expect(sent, `saw ${JSON.stringify(sent)}`).toMatch(/GAME SENT TO/);
    expect(sent).toMatch(/PHONE/);
    // before any push there is no gun fact to report, and inventing one would be the whole defect
    const guns = g.q('[data-testid="game-gun-status"]')!.textContent ?? '';
    expect(guns).toMatch(/GUNS NOT CONFIGURED YET/);
    expect(guns).toMatch(/LOBBY PUSH/);
    g.m.unmount();
  });

  it('never claims ALL for a partial count, and never for a roster of nobody', async () => {
    // `state.py all_acked()` skips players with no node bound, so it is VACUOUSLY TRUE before any
    // phone is up — rendering that as a claim produced "ALL GUNS ON THIS CONFIG (0/8)" above
    // "Waiting for 8 phones". Every count on this screen is now derived from the number it prints.
    const partial = await games({ load: true, patch: s => ({ ...s, game: { ...(s.game ?? { loaded: true, sent: 0, total: 0 }), loaded: true, sent: 3, total: 8 } }) });
    const line = partial.q('[data-testid="game-load-status"]')!.textContent ?? '';
    expect(line, `saw ${JSON.stringify(line)}`).not.toMatch(/ALL/);
    expect(line).toContain('3/8');
    partial.m.unmount();

    const empty = await games({ load: true, patch: s => ({ ...s, game: { loaded: true, sent: 0, total: 0 } }) });
    const none = empty.q('[data-testid="game-load-status"]')!.textContent ?? '';
    expect(none, `a zero-of-zero must not read as everybody: ${JSON.stringify(none)}`).not.toMatch(/ALL/);
    expect(none).toMatch(/NOBODY IS ROSTERED/);
    empty.m.unmount();
  });

  it('once the lobby IS pushed, the gun count appears beside the phone count', async () => {
    const g = await games({ load: true, push: true });
    expect(g.q('[data-testid="game-load-status"]')!.textContent).toMatch(/GAME SENT TO/);
    expect(g.q('[data-testid="game-gun-status"]')!.textContent).toMatch(/CONFIG/);
    g.m.unmount();
  });

  it('F.3: an older server with no `game` block renders no phone-delivery line — never a fabricated count', async () => {
    // `gameSent`/`gameTotal` fall back to 0 and the roster size when `state.game` is absent (an older
    // server never sent one), which LOOKS exactly like a real "0 of N delivered" under a pushed
    // lobby -- rendering it unconditionally produced "GAME SENT TO 0/N PHONES" on a config the phones
    // plainly already have (2026-09-13). Absence is a different fact from zero.
    const g = await games({ push: true, patch: s => ({ ...s, game: undefined }) });
    expect(g.q('[data-testid="active-game-config"]'), 'control: `loaded` still falls back off lobby.pushed').toBeTruthy();
    expect(g.q('[data-testid="game-load-status"]'), 'no game block, no delivery claim at all').toBeFalsy();
    expect(g.q('[data-testid="game-gun-status"]'), 'the gun count is a fact about the LOBBY push, unaffected').toBeTruthy();
    g.m.unmount();
  });

  it('int-n1: "the phones have the game" is gated on delivery, not just a clean readiness board', async () => {
    // Independent server facts: the readiness board (guns) can read clean while the phone-delivery
    // count (a DIFFERENT call, `state.game.sent/total`) is still catching up right after a LOAD. The
    // old sentence asserted delivery unconditionally whenever the board had nothing to complain
    // about, so it could sit directly under a counter reading 5 of 8.
    const g = await games({
      load: true,
      patch: s => ({
        ...s,
        game: { loaded: true, sent: 5, total: 8 },
        // clear the demo's one deliberately-unreachable gun so the readiness board reads clean and
        // cannot itself explain why this sentence should be cautious.
        readiness: { ...s.readiness, board: s.readiness.board.map(b => (b.status === 'red' ? { ...b, status: 'green' as const, blockers: [] } : b)) },
      }),
    });
    const txt = g.m.text();
    expect(txt, `saw ${JSON.stringify(txt)}`).not.toContain('The phones have the game.');
    expect(txt).toMatch(/5 of 8 phones? have the game/i);
    g.m.unmount();
  });
});

describe('GAMES · the way on, and the way back', () => {
  it('CONTINUE TO KIT is the way on, and it is what advances the phase', async () => {
    const g = await games({ load: true });
    const on = g.btn('[data-testid="game-continue-kit"]');
    expect(on, 'the active state carries the way on to KIT').toBeTruthy();
    await tap(on);
    expect(g.calls.setPhase).toEqual(['kit']);
    expect(g.views).toEqual(['kit']);
    g.m.unmount();
  });

  it('a re-push is reachable only once there has been a push — before that nothing on a gun is stale', async () => {
    const loadedOnly = await games({ load: true });
    expect(loadedOnly.q('button[data-repush="1"]'), 'no head has been written, so there is nothing to re-push').toBeFalsy();
    loadedOnly.m.unmount();

    const pushed = await games({ load: true, push: true, patch: s => ({ ...s, lobby: { ...s.lobby, all_acked: false, acks: {} } }) });
    const repush = pushed.q('button[data-repush="1"]');
    expect(repush, 'RE-PUSH CONFIG appears when a pushed gun is not caught up').toBeTruthy();
    await tap(repush);
    expect(pushed.calls.pushLobby.length, 'and it is the gun-writing push, not the announcement').toBe(1);
    expect(pushed.calls.loadGame, 'a re-push does not re-announce').toBe(0);
    pushed.m.unmount();
  });
});

describe('GAMES · EDIT is a draft, SAVE AND LOAD is the only thing that sends', () => {
  const openEdit = async (g: Awaited<ReturnType<typeof games>>) => {
    await tap(g.btn('[data-testid="game-edit-open"]'));
    expect(g.q('[data-testid="game-edit-panel"]'), 'EDIT opens the editor in place').toBeTruthy();
  };
  const nightToggle = (g: Awaited<ReturnType<typeof games>>) =>
    g.m.el.querySelector('[data-testid="game-edit-panel"] [role="switch"]') as HTMLElement;
  const save = (g: Awaited<ReturnType<typeof games>>) => g.btn('[data-testid="game-edit-save"]');

  it('nothing is sent while editing — the whole change goes in ONE put at SAVE', async () => {
    const g = await games({ load: true });
    await openEdit(g);
    await tap(nightToggle(g));
    await tap(g.m.el.querySelector('[data-testid="game-edit-panel"] [data-testid="health-advanced-toggle"]') as HTMLElement);
    const hp = g.m.el.querySelector('[data-testid="game-edit-panel"] input[aria-label="health"]') as HTMLInputElement;
    await act(async () => {
      hp.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hp, '60');
      hp.dispatchEvent(new Event('input', { bubbles: true }));
      hp.blur();
    });
    expect(g.calls.putConfig, 'two edits, NOTHING on the wire').toEqual([]);
    const before = g.state().config.health;
    await tap(save(g));
    expect(g.calls.putConfig.length, 'ONE request carries the whole patch').toBe(1);
    expect(g.calls.putConfig[0]).toEqual({ night: true, health: { max_hp: 60, max_armor: before.max_armor, max_shield: before.max_shield, preset: 'custom' } });
    g.m.unmount();
  });

  it('SAVE re-announces the new game to the phones, and does NOT write a gun', async () => {
    const g = await games({ load: true });
    const before = g.state().config.config_id;
    await openEdit(g);
    await tap(nightToggle(g));
    await tap(save(g));
    await g.settle();
    expect(g.state().config.config_id, 'control: the edit really produced a new config').not.toBe(before);
    expect(g.state().game?.loaded, 'the phones are told about it').toBe(true);
    expect(g.state().game?.config_id).toBe(g.state().config.config_id);
    expect(g.state().lobby.pushed, 'and the guns are still untouched — weapons go with the arm').toBe(false);
    g.m.unmount();
  });

  it('…and once the lobby HAS been pushed, SAVE re-pushes the guns too, or they drift', async () => {
    const g = await games({ load: true, push: true });
    const acked = Object.values(g.state().lobby.acks).filter(a => a.ok).length;
    expect(acked, 'control: guns acked the push').toBeGreaterThan(0);
    // The mock re-acks a re-push after a short timer (220ms). On a loaded machine the SAVE and the
    // settle below can take longer than that, and then the read sees the acks back again. Hold the
    // acks for a minute, so the read always lands inside the transitional state it asserts.
    g.backend.repushAckMs = 60_000;
    await openEdit(g);
    await tap(nightToggle(g));
    await tap(save(g));
    await g.settle();
    expect(g.state().lobby.pushed, 'still pushed — an edit RE-pushes rather than un-pushing (B1/B3)').toBe(true);
    expect(Object.keys(g.state().lobby.acks).length, 'the count drops to zero while the guns take the new head').toBe(0);
    g.m.unmount();
  });

  it('a draft that reshapes the roster shows the split AT SAVE TIME, and one more tap commits', async () => {
    const g = await games({ load: true });
    await openEdit(g);
    const koth = Array.from(g.m.el.querySelectorAll('[data-testid="game-edit-panel"] [aria-label="mode"] button'))
      .find(b => (b.textContent ?? '').trim() === 'KOTH');
    expect(koth, 'control: the mode list offers KOTH').toBeTruthy();
    await tap(koth);
    expect(g.calls.putConfig, 'picking a mode in a draft sends nothing').toEqual([]);
    await tap(save(g));
    const split = g.q('[data-testid="confirm-split"]');
    expect(split, 'the reshape is shown before it happens').toBeTruthy();
    expect(split!.textContent).toMatch(/^▲ \d+ PLAYERS? → [A-Z]+ \d+ \/ [A-Z]+ \d+$/);
    expect(g.calls.putConfig, 'and the first SAVE tap still sends nothing').toEqual([]);
    await tap(save(g));
    expect(g.calls.putConfig).toEqual([{ mode: 'koth' }]);
    g.m.unmount();
  });

  it('abandoning a dirty draft asks once', async () => {
    const g = await games({ load: true });
    await openEdit(g);
    await tap(nightToggle(g));
    await tap(g.btn('[data-testid="game-edit-cancel"]'));
    expect(g.q('[data-testid="game-edit-discard"]'), 'the first CANCEL asks').toBeTruthy();
    expect(g.q('[data-testid="game-edit-panel"]'), 'and keeps the draft on screen').toBeTruthy();
    await tap(g.btn('[data-testid="game-edit-cancel"]'));
    expect(g.q('[data-testid="game-edit-panel"]'), 'the second CANCEL discards it').toBeFalsy();
    expect(g.calls.putConfig, 'nothing was ever sent').toEqual([]);
    g.m.unmount();
  });

  it('F.2, REVISED bench 2026-09-17: a mode/game card tap while EDIT is open discards the draft and proceeds — no refusal', async () => {
    // Tony hit the OLD "F.2" refusal ("FINISH EDITING FIRST...") cold: he had opened EDIT, left it,
    // forgotten it was open, and got a sticky error with nothing on screen to finish or cancel. The
    // call now: a pick while a draft is open just drops the draft, silently, and plays the pick —
    // same as any other "this drops your unsaved game" case already on this screen.
    const g = await games({ load: true });
    await openEdit(g);
    await tap(g.q('[data-testid="pick-another"]'));   // shows the shelves next to the open draft
    // F-scope A (2026-09-25): the STOCK MODES shelf now offers only TDM/FFA/KOTH. FFA's single team
    // (`newTeams.length < 2`) needs no reshape confirm regardless of the roster, unlike KOTH against
    // TDM's default teams -- so it still proves the draft's discard with one tap, not a second,
    // unrelated confirm mechanic.
    const other = g.modes.find(mm => mm.mode === 'ffa')!;
    const card = g.q(`[aria-label="play ${other.name}"]`);
    expect(card, 'control: the shelf offers a different mode to tap').toBeTruthy();
    await tap(card);
    expect(g.q('[data-testid="game-edit-panel"]'), 'the draft is gone — discarded, not left open').toBeFalsy();
    expect(g.calls.putConfig.length, 'the pick itself goes straight through').toBe(1);
    expect(g.calls.putConfig[0].mode).toBe('ffa');
    g.m.unmount();
  });

  it('an UNCHANGED draft is dropped with no notice at all', async () => {
    const g = await games({ load: true });
    await openEdit(g);   // seeded, untouched — `dirty` is false
    await tap(g.q('[data-testid="pick-another"]'));
    const other = g.modes.find(mm => mm.mode === 'ffa')!;
    await tap(g.q(`[aria-label="play ${other.name}"]`));
    expect(g.m.text(), 'nothing changed, so nothing is worth announcing').not.toContain('DISCARDED');
    g.m.unmount();
  });

  it('a CHANGED draft is dropped with one short, auto-clearing notice — never an error', async () => {
    const backend = new MockBackend();
    const modes: ModeInfo[] = await backend.getModes();
    await backend.setPhase('build', true);
    await backend.loadGame();
    const calls: Partial<GameConfig>[] = [];
    const api = fixtureApi({ putConfig: async (p: Partial<GameConfig>) => { calls.push(p); return backend.putConfig(p); } }, backend as unknown as Api);
    let state = await backend.getState();
    const render = () => (
      <StoreCtx.Provider value={makeStore({ state, view: 'build' }, { api, modes })}>
        <><CommandBar /><Games /></>
      </StoreCtx.Provider>
    );
    clearNotice();
    const m = await mount(render());
    const q = (sel: string) => m.el.querySelector(sel) as HTMLElement | null;
    await tap(q('[data-testid="game-edit-open"] button'));
    const nightSwitch = m.el.querySelector('[data-testid="game-edit-panel"] [role="switch"]') as HTMLElement;
    await tap(nightSwitch);
    expect(m.el.querySelector('[data-testid="game-edit-dirty"]')!.textContent, 'control: the draft really changed').toContain('UNSAVED');
    await tap(q('[data-testid="pick-another"]'));
    const other = modes.find(mm => mm.mode === 'ffa')!;
    await tap(q(`[aria-label="play ${other.name}"]`));
    expect(q('[data-testid="game-edit-panel"]'), 'the draft is gone').toBeFalsy();
    // the draft's own NIGHT toggle never reaches the server — only the pick itself does
    expect(calls.length, 'one request: the pick, not the discarded edit').toBe(1);
    expect(calls[0].mode).toBe('ffa');
    expect(m.text(), 'a plain notice, never the old refusal').toContain('UNSAVED EDITS DISCARDED');
    expect(m.text()).not.toContain('FINISH EDITING FIRST');
    // it is not an error strip: the bar renders a notice styled `bad`, and this one is not
    const toast = Array.from(m.el.querySelectorAll('.cb-notices button')).find(b => (b.textContent ?? '').includes('UNSAVED EDITS DISCARDED')) as HTMLButtonElement | undefined;
    expect(toast, 'the notice actually rendered in the bar').toBeTruthy();
    expect(toast!.textContent, 'no ▲ — that glyph marks the bad/error notices only').not.toContain('▲');
    m.unmount();
    clearNotice();
  });

  it('editing never survives once the loaded game itself goes away, even with no navigation at all', async () => {
    // Bench 2026-09-17: `editing` used to be an island — nothing reset it once the operator stopped
    // looking at the draft any other way than SAVE/CANCEL. If the loaded game itself goes away (an
    // older snapshot, a finished match rolling forward under this SAME tab, no phase change, no
    // remount) while EDIT was open, `editing` stayed true with no draft left on screen to finish or
    // cancel — and the next card tap hit the exact same stale refusal Tony hit at the bench.
    const g = await games({ load: true });
    await openEdit(g);
    expect(g.q('[data-testid="game-edit-panel"]')).toBeTruthy();
    await g.settle();   // no-op read from the same backend; establishes the baseline before the patch
    await act(async () => {
      await g.m.update(
        <StoreCtx.Provider value={makeStore({
          state: { ...g.state(), game: { loaded: false, sent: 0, total: g.state().players.length }, lobby: { ...g.state().lobby, pushed: false } },
          view: 'build',
        }, { api: g.api, modes: g.modes })}>
          <Games />
        </StoreCtx.Provider>,
      );
    });
    expect(g.q('[data-testid="game-edit-panel"]'), 'no draft UI left to finish or cancel').toBeFalsy();
    expect(g.q('[data-testid="active-game-config"]'), 'back to picking a game, not the active state').toBeFalsy();
    const other = g.modes.find(mm => mm.mode === 'ffa')!;
    const card = g.q(`[aria-label="play ${other.name}"]`);
    expect(card, 'control: a pick is on screen').toBeTruthy();
    await tap(card);
    expect(g.m.text(), 'never the stale refusal over an invisible draft').not.toContain('FINISH EDITING FIRST');
    expect(g.calls.putConfig.length, 'the pick actually reaches the server').toBe(1);
    g.m.unmount();
  });

  it('the VENUE strip stands down while the draft owns NIGHT OPS — never two live controls for one field', async () => {
    const g = await games({ load: true });
    const venue = () => g.m.el.querySelector('[role="group"][aria-label="venue"]')!.closest('fieldset') as HTMLFieldSetElement;
    expect(venue().disabled, 'before EDIT the venue applies straight away, as it always has').toBe(false);
    await tap(g.btn('[data-testid="game-edit-open"]'));
    expect(venue().disabled, 'while a draft is open it is a real HTML disabled').toBe(true);
    expect(g.q('[data-testid="venue-in-draft"]'), 'and it says where the control went').toBeTruthy();
    expect(g.q('[data-testid="venue-locked"]'), 'a draft is not a match lock').toBeFalsy();
    g.m.unmount();
  });
});

describe('GAMES · once the match has started', () => {
  for (const phase of ['armed', 'live'] as const) {
    it(`${phase.toUpperCase()}: the loaded config is still shown, EDIT is refused, and it names the way back`, async () => {
      const g = await games({ load: true, push: true, patch: s => ({ ...s, phase }) });
      expect(g.q('[data-testid="active-game-config"]'), 'what the guns are holding is readable mid-match').toBeTruthy();
      expect(g.btn('[data-testid="game-edit-open"]')!.disabled, 'the server refuses a config edit in play').toBe(true);
      expect(g.q('[data-testid="games-locked"]')!.textContent).toContain(phase === 'armed' ? 'ABORT' : 'RECALL');
      expect(g.calls.putConfig).toEqual([]);
      g.m.unmount();
    });
    it(`${phase.toUpperCase()}: NIGHT OPS is visibly locked beside the toggle, and a tap sends nothing`, async () => {
      // Bench 2026-09-17: a mid-match tap on NIGHT OPS changed no LED and the strip did not say why.
      const g = await games({ load: true, push: true, patch: s => ({ ...s, phase }) });
      const toggle = g.q('button[aria-label="night ops"]') as HTMLButtonElement;
      expect(toggle.closest('fieldset')!.disabled, 'a real HTML disabled').toBe(true);
      const note = g.q('[data-testid="venue-locked"]');
      expect(note, 'the venue strip says it is locked').toBeTruthy();
      expect(note!.textContent).toContain(`LOCKED WHILE THE MATCH IS ${phase.toUpperCase()}`);
      await tap(toggle);
      expect(g.calls.putConfig, 'no config reaches the server mid-match').toEqual([]);
      g.m.unmount();
    });
  }

  it('RECAP is back to picking the next game, with LOAD live and no banner', async () => {
    // `_finish()` drops BOTH `lobby_pushed` and the announced game, so the debrief is an un-loaded tab.
    // 2026-09-16: and nothing on it is locked. LOAD (or any edit) rolls the session to the next match.
    const g = await games({ patch: s => ({ ...s, phase: 'recap', game: { loaded: false, sent: 0, total: s.players.length } }) });
    expect(g.q('[data-testid="active-game-config"]')).toBeFalsy();
    expect(g.q('[data-testid="games-locked"]'), 'no RECAP banner').toBeFalsy();
    expect(g.m.text()).not.toMatch(/PICK A MODE|THIS MATCH ENDED/);
    expect(g.btn('[data-testid="game-load"]')!.disabled).toBe(false);
    g.m.unmount();
  });
});

// F402 (Tony 2026-09-25): "KOTH should require utility in the armory. no way to play it without it."
// The server hard-refuses a koth LOAD/push with nothing on the field that IS the hill
// (`state.py Session._koth_hill_fault`, force does not open it) -- these pin the console's OWN
// prediction of that same fault: LOAD disabled, the existing red banner beside it (never a second,
// new blocker area), and a way straight to the fix.
describe('GAMES · F402 koth needs a hill assigned, or LOAD is refused', () => {
  const controlStation = (kind: 'control' | 'respawn' = 'control') => [{
    node_id: 'util-hill', assigned: { kind, team: 255, id: 1, threshold: 0 }, armed: null,
    arm_pending: false, report: {}, last_seen_ms: 0, online: true, attention: [], game: 1,
  }];

  it('no station assigned: LOAD is disabled, the red banner names it, and a button jumps to ARMORY', async () => {
    const g = await games({ patch: s => ({ ...s, config: { ...s.config, mode: 'koth', station_source: 'phone' }, stations: [] }) });
    const load = g.btn('[data-testid="game-load"]');
    expect(load!.disabled, 'LOAD is visibly disabled, never a silent no-op').toBe(true);
    const banner = g.q('[data-testid="games-locked"]');
    expect(banner, 'the EXISTING blocker banner beside LOAD, not a new one').toBeTruthy();
    expect(banner!.textContent).toContain('KING OF THE HILL NEEDS A HILL');
    expect(banner!.textContent).toContain('ASSIGN A PHONE OR STICK AS A HILL IN THE ARMORY');
    const jump = Array.from(banner!.querySelectorAll('button')).find(b => (b.textContent ?? '').includes('ARMORY'));
    expect(jump, 'a button that jumps to the ARMORY').toBeTruthy();
    await tap(jump);
    expect(g.views).toEqual(['muster']);   // the view id the nav bar renders as ARMORY
    g.m.unmount();
  });

  it('a phone or Stick assigned as CONTROL clears the block: LOAD is live and the banner is gone', async () => {
    const g = await games({ patch: s => ({ ...s, config: { ...s.config, mode: 'koth', station_source: 'phone' }, stations: controlStation() }) });
    expect(g.q('[data-testid="games-locked"]'), 'no block once a hill is assigned').toBeFalsy();
    expect(g.btn('[data-testid="game-load"]')!.disabled).toBe(false);
    g.m.unmount();
  });

  it('a station assigned as RESPAWN (not CONTROL) does not satisfy the gate', async () => {
    const g = await games({ patch: s => ({ ...s, config: { ...s.config, mode: 'koth', station_source: 'phone' }, stations: controlStation('respawn') }) });
    expect(g.btn('[data-testid="game-load"]')!.disabled, 'a respawn station is not a hill').toBe(true);
    expect(g.q('[data-testid="games-locked"]')!.textContent).toContain('KING OF THE HILL NEEDS A HILL');
    g.m.unmount();
  });

  it("station_source is not phone: the block names the OTHER fix (set the source, then assign a hill)", async () => {
    const g = await games({ patch: s => ({ ...s, config: { ...s.config, mode: 'koth', station_source: 'grenade' }, stations: [] }) });
    const banner = g.q('[data-testid="games-locked"]');
    expect(banner!.textContent).toContain('SET OBJECTIVE SOURCE TO PHONE');
    expect(g.btn('[data-testid="game-load"]')!.disabled).toBe(true);
    g.m.unmount();
  });

  it('a mode other than koth is never blocked by this gate', async () => {
    const g = await games({ patch: s => ({ ...s, config: { ...s.config, mode: 'tdm' }, stations: [] }) });
    expect(g.q('[data-testid="games-locked"]')).toBeFalsy();
    expect(g.btn('[data-testid="game-load"]')!.disabled).toBe(false);
    g.m.unmount();
  });

  it('an older server with no `stations` field at all does not crash, and reads as no hill assigned', async () => {
    const g = await games({ patch: s => ({ ...s, config: { ...s.config, mode: 'koth', station_source: 'phone' }, stations: undefined }) });
    expect(() => g.m.text()).not.toThrow();
    expect(g.btn('[data-testid="game-load"]')!.disabled).toBe(true);
    expect(g.q('[data-testid="games-locked"]')!.textContent).toContain('KING OF THE HILL NEEDS A HILL');
    g.m.unmount();
  });
});
