// LOAD, and the ACTIVE GAME CONFIG state it puts the GAMES tab into (2026-09-13).
//
// Tony, verbatim: "At first on a new match the game tab should be as it is today. Pick or create
// customize. Instead of continue though it should be Load. Load pushes that config to phones. The tab
// should then change state to active game config. Every setting for the current config shown. Click
// Edit to modify and then Save and Load to update all phones."
//
// And the reason, which is what every assertion here is really about: "several times while players
// were kitting I wanted to make adjustments and I would have to remake a game type and hit continue
// hoping it pushed the updates." CONTINUE never pushed anything — `Games.tsx` fired a bare
// `api.setPhase('kit')` — so the doubt was correct. Each test below fails on the pre-LOAD code.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api, GameConfig, ModeInfo, Phase, ReadinessRow, State } from '../src/api/types';
import { Games } from '../src/screens/Games';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { fixtureApi, makeStore, mount } from './harness';

const tap = async (el: Element | undefined | null) => {
  if (!el) throw new Error('no such control on screen');
  if ((el as HTMLButtonElement).disabled) throw new Error(`refusing to "click" a DISABLED control: ${(el.textContent ?? '').trim()}`);
  await act(async () => { (el as HTMLElement).click(); });
};

/** The demo fixture ships one deliberately RED gun and one phone that has never arrived — a real
 *  muster. LOAD reads the SERVER's push gate (`derive.pushGate` → `state.py push_config`), so those
 *  rows correctly refuse a FIRST push, and a test that ignored them would be watching a dead button
 *  and calling it a pass. Green the board by default; the refusal tests put faults back deliberately. */
const greenBoard = (s: State): State => ({
  ...s,
  readiness: { ...s.readiness, roster_faults: [], board: s.readiness.board.map(r => ({ ...r, status: 'green' as const, blockers: [], ambers: [] })) },
});

async function games(opts: { phase?: Phase; over?: Partial<Api>; patch?: (s: State) => State; push?: boolean } = {}) {
  const backend = new MockBackend();
  const modes: ModeInfo[] = await backend.getModes();
  await backend.setPhase(opts.phase ?? 'build', true);
  if (opts.push) await backend.pushLobby(true);
  const calls = { putConfig: [] as Partial<GameConfig>[], pushLobby: [] as (boolean | undefined)[], setPhase: [] as string[] };
  const api = fixtureApi({
    putConfig: async (p: Partial<GameConfig>) => { calls.putConfig.push(p); return backend.putConfig(p); },
    // What the UI ASKED FOR is what these tests assert (`calls.pushLobby`). The backend is then
    // driven with `force`, because the demo fixture keeps its own red gun and unreachable phone
    // regardless of the board this fixture renders — without it the mock would refuse every push and
    // the assertions after it would be about a state the fixture never reached.
    pushLobby: async (f?: boolean) => { calls.pushLobby.push(f); return backend.pushLobby(true); },
    setPhase: async (p: string, f?: boolean) => { calls.setPhase.push(p); return backend.setPhase(p, f); },
    ...(opts.over ?? {}),
  }, backend as unknown as Api);
  const views: string[] = [];
  const held: string[] = [];
  const read = async () => { const s = greenBoard(await backend.getState()); return opts.patch ? opts.patch(s) : s; };
  let state = await read();
  const render = () => (
    <StoreCtx.Provider value={makeStore({ state, view: 'build' }, { api, modes, setView: v => { views.push(v); }, holdPhase: p => { held.push(p); } })}>
      <Games />
    </StoreCtx.Provider>
  );
  const m = await mount(render());
  const settle = async () => { state = await read(); await m.update(render()); };
  const q = (sel: string) => m.el.querySelector(sel) as HTMLElement | null;
  const btn = (sel: string) => m.el.querySelector(`${sel} button`) as HTMLButtonElement | null;
  return { m, backend, api, modes, calls, views, held, settle, q, btn, state: () => state };
}

describe('GAMES · LOAD is the push', () => {
  it('the primary control says LOAD, and it sends the config to the guns', async () => {
    const g = await games();
    const load = g.btn('[data-testid="game-load"]');
    expect(load, 'a LOAD control is on the un-loaded GAMES tab').toBeTruthy();
    expect(load!.textContent).toContain('LOAD');
    expect(g.m.text(), 'CONTINUE is gone — it was the control that pushed nothing').not.toContain('CONTINUE ▸');
    await tap(load);
    // `false`, not `true`: an ordinary LOAD never forces. The override is a separate control, and it
    // is the only thing that may pass `true` (see the refusal tests below).
    expect(g.calls.pushLobby, 'LOAD pushes exactly once, unforced').toEqual([false]);
    expect((await g.backend.getState()).lobby.pushed, 'and the guns really have it').toBe(true);
    g.m.unmount();
  });

  it('LOAD does NOT advance to KIT — the tab stays put and becomes the ACTIVE GAME CONFIG', async () => {
    const g = await games();
    await tap(g.btn('[data-testid="game-load"]'));
    expect(g.calls.setPhase, 'LOAD is a push, not a navigation').toEqual([]);
    expect(g.views, 'nothing navigated the console away from GAMES').toEqual([]);
    // …and the phase advance the push DOES cause (state.py push_config sets `lobby`) is accounted
    // for, or the store's phase-follow would throw this tab onto the LOBBY screen (store.holdPhase).
    expect(g.held, 'the tab holds the lobby advance its own push caused').toEqual(['lobby']);
    await g.settle();
    expect(g.q('[data-testid="active-game-config"]'), 'the tab changed state').toBeTruthy();
    // the title is uppercased in CSS, so the DOM text is the sentence case the source carries
    expect(g.m.text()).toMatch(/Active Game Config/i);
    g.m.unmount();
  });

  it('the active state shows EVERY setting, including the fields no control edits', async () => {
    const g = await games({ push: true });
    const txt = g.m.text();
    for (const label of ['TEAMS', 'WIN', 'RESPAWN', 'TIME', 'HEALTH', 'LOADOUT', 'VENUE',
                         'MODE RULES', 'SCORING', 'PHONE PICKS', 'COVERAGE', 'STUN (EMP)', 'SIPHON',
                         'HIT AUDIO', 'LED', 'PRESENTATION', 'VIP', 'PLAYER NUMBERS', 'CONFIG ID']) {
      expect(txt, `the loaded config names ${label}`).toContain(label);
    }
    // the id is the operator's OWN answer to "is what I am looking at what the guns are holding"
    expect(txt, 'and the config_id the guns must echo is on screen').toContain(g.state().config.config_id);
    g.m.unmount();
  });

  it('the ack counter is on the active state, so "did it push?" has an answer', async () => {
    const g = await games({ push: true });
    const status = g.q('[data-testid="game-load-status"]');
    expect(status, 'the loaded state carries the count').toBeTruthy();
    const s = g.state();
    const acked = Object.values(s.lobby.acks).filter(a => a.ok).length;
    expect(status!.textContent).toContain(`${acked}/${s.players.length}`);
    expect(status!.textContent).toMatch(/GUNS/);
    g.m.unmount();
  });

  it('never claims ALL GUNS for a count that is not all of them', async () => {
    // `state.py all_acked()` walks the roster the way `start()` does and SKIPS every player with no
    // node bound — so before anybody's phone is up it is VACUOUSLY TRUE. Handing that to the readout
    // printed "ALL GUNS ON THIS CONFIG (0/8)" directly above "Waiting for 8 phones" (caught by eye on
    // the koth screenshot, 2026-09-13, after every assertion in this file had passed). False
    // reassurance in the one place the operator looks is the exact thing this screen exists to remove.
    const g = await games({ push: true, patch: s => ({ ...s, lobby: { ...s.lobby, all_acked: true, acks: {} } }) });
    const line = g.q('[data-testid="game-load-status"]')!.textContent ?? '';
    expect(line, `saw ${JSON.stringify(line)}`).not.toMatch(/ALL GUNS/);
    expect(line).toContain(`0/${g.state().players.length}`);
    // ...and the cure is still offered rather than the screen painting itself green
    expect(g.q('button[data-repush="1"]'), 'RE-PUSH CONFIG stays available while guns are unconfirmed').toBeTruthy();
    g.m.unmount();
  });

  it('CONTINUE TO KIT is the way on, and it is what advances the phase', async () => {
    const g = await games({ push: true });
    const on = g.btn('[data-testid="game-continue-kit"]');
    expect(on, 'the active state carries the way on to KIT').toBeTruthy();
    await tap(on);
    expect(g.calls.setPhase).toEqual(['kit']);
    expect(g.views).toEqual(['kit']);
    g.m.unmount();
  });

  it('a re-push is reachable from here too, by the name every fault line uses', async () => {
    // one gun still answering for nothing: the count is short, so the cure is on screen
    const g = await games({ push: true, patch: s => ({ ...s, lobby: { ...s.lobby, all_acked: false, acks: {} } }) });
    const repush = g.q('button[data-repush="1"]');
    expect(repush, 'RE-PUSH CONFIG is on the active state when a gun is not caught up').toBeTruthy();
    expect(repush!.textContent).toContain('RE-PUSH CONFIG');
    await tap(repush);
    expect(g.calls.pushLobby.length, 'and it is the same push').toBe(1);
    g.m.unmount();
  });
});

describe('GAMES · LOAD carries the server\'s own refusals', () => {
  const oneTeam = (s: State): State => ({
    ...s,
    readiness: { ...s.readiness, roster_faults: ['ONLY ONE SIDE HAS PLAYERS — a match fought on one side cannot register a hit; move players between teams'] },
  });
  const waiting = (s: State): State => ({
    ...s,
    readiness: { ...s.readiness, board: s.readiness.board.map((r, i) => (i === 0 ? ({ ...r, status: 'waiting', blockers: [] } as ReadinessRow) : r)) },
  });

  it('an unplayable roster kills LOAD outright, and says force cannot open it', async () => {
    const g = await games({ patch: oneTeam });
    expect(g.btn('[data-testid="game-load"]')!.disabled, 'the server refuses this push, so the button does not pretend').toBe(true);
    const strip = g.q('[data-testid="load-blocked"]');
    expect(strip, 'and the refusal is on screen, not only in the error strip').toBeTruthy();
    expect(strip!.textContent).toContain('ONLY ONE SIDE HAS PLAYERS');
    expect(g.q('[data-load-force="1"]'), '`one_team_fault` is checked AFTER the force gate on the server').toBeFalsy();
    expect(strip!.textContent).toContain('CANNOT BE OVERRIDDEN');
    g.m.unmount();
  });

  it('a phone that has not arrived refuses the FIRST push — and that one IS overridable', async () => {
    const g = await games({ patch: waiting });
    expect(g.btn('[data-testid="game-load"]')!.disabled).toBe(true);
    const force = g.q('[data-load-force="1"]');
    expect(force, 'the host override is offered for a judgement they may accept').toBeTruthy();
    await tap(force);
    expect(g.calls.pushLobby, 'and it forces').toEqual([true]);
    g.m.unmount();
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

  it('nothing is sent while editing — the whole change goes in ONE put at SAVE AND LOAD', async () => {
    const g = await games({ push: true });
    await openEdit(g);
    await tap(nightToggle(g));
    const hp = g.m.el.querySelector('[data-testid="game-edit-panel"] input[aria-label="default health"]') as HTMLInputElement;
    await act(async () => {
      hp.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hp, '60');
      hp.dispatchEvent(new Event('input', { bubbles: true }));
      hp.blur();
    });
    expect(g.calls.putConfig, 'two edits, NOTHING on the wire').toEqual([]);
    expect(save(g)!.textContent, 'the button says what it will do').toContain('SAVE AND LOAD');
    await tap(save(g));
    expect(g.calls.putConfig.length, 'ONE request carries the whole patch').toBe(1);
    expect(g.calls.putConfig[0]).toEqual({ night: true, health: { max_hp: 60, max_armor: g.state().config.health.max_armor } });
    g.m.unmount();
  });

  it('the editor closes on a successful save and the settings show the new values', async () => {
    const g = await games({ push: true });
    await openEdit(g);
    await tap(nightToggle(g));
    await tap(save(g));
    await g.settle();
    expect(g.q('[data-testid="game-edit-panel"]'), 'the draft is done').toBeFalsy();
    expect(g.q('[data-testid="game-settings"]')!.textContent).toContain('NIGHT OPS');
    g.m.unmount();
  });

  it('SAVE AND LOAD re-pushes: the acks clear and come back (the operator watches the count move)', async () => {
    const g = await games({ push: true });
    const before = Object.values(g.state().lobby.acks).filter(a => a.ok).length;
    expect(before, 'control: guns acked the first load').toBeGreaterThan(0);
    await openEdit(g);
    await tap(nightToggle(g));
    await tap(save(g));
    await g.settle();
    expect(g.state().lobby.pushed, 'still loaded — an edit RE-pushes, it does not un-push (B1/B3)').toBe(true);
    expect(Object.keys(g.state().lobby.acks).length, 'the count drops to zero while the guns take the new head').toBe(0);
    await new Promise(r => setTimeout(r, 300));
    await g.settle();
    expect(Object.values(g.state().lobby.acks).filter(a => a.ok).length, 'and climbs back as they answer').toBe(before);
    g.m.unmount();
  });

  it('a draft that reshapes the roster shows the split AT SAVE TIME, and one more tap commits', async () => {
    const g = await games({ push: true });
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
    const g = await games({ push: true });
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

  it('the VENUE strip stands down while the draft owns NIGHT OPS — never two live controls for one field', async () => {
    const g = await games({ push: true });
    const venue = () => g.m.el.querySelector('[role="group"][aria-label="venue"]')!.closest('fieldset') as HTMLFieldSetElement;
    expect(venue().disabled, 'before EDIT the venue applies straight away, as it always has').toBe(false);
    await tap(g.btn('[data-testid="game-edit-open"]'));
    expect(venue().disabled, 'while a draft is open it is a real HTML disabled').toBe(true);
    expect(g.q('[data-testid="venue-in-draft"]'), 'and it says where the control went').toBeTruthy();
    g.m.unmount();
  });
});

describe('GAMES · once the match has started', () => {
  for (const phase of ['armed', 'live'] as const) {
    it(`${phase.toUpperCase()}: the loaded config is still shown, EDIT is refused, and it names the way back`, async () => {
      const g = await games({ push: true, patch: s => ({ ...s, phase }) });
      expect(g.q('[data-testid="active-game-config"]'), 'what the guns are holding is readable mid-match').toBeTruthy();
      expect(g.btn('[data-testid="game-edit-open"]')!.disabled, 'the server refuses a config edit in play').toBe(true);
      expect(g.q('[data-testid="games-locked"]')!.textContent).toContain(phase === 'armed' ? 'ABORT' : 'RECALL');
      expect(g.calls.putConfig).toEqual([]);
      g.m.unmount();
    });
  }

  it('RECAP is back to picking the next game — the mode cards are the play-again path', async () => {
    // `_finish()` drops `lobby_pushed`, so the debrief is an un-loaded tab again.
    const g = await games({ patch: s => ({ ...s, phase: 'recap' }) });
    expect(g.q('[data-testid="active-game-config"]')).toBeFalsy();
    expect(g.m.text()).toContain('PICK A MODE TO START THE NEXT ONE');
    g.m.unmount();
  });
});
