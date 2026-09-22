// B3 — editing the LOADED game (mode/night/health/weapon pool) inline on KIT and LOBBY, without the
// GAMES stepper or a RECALL, and with the guns re-pushed (never left silently stale) on an edit made
// after the lobby has already been pushed. See webapp/mc/src/ui/GameEditPanel.tsx.
//
// REWRITTEN 2026-09-13: this panel applied EVERY tap immediately, one `PUT /api/config` each, and
// these tests asserted exactly that (`expect(calls).toEqual([{ night: true }])` on the tap itself).
// Tony's model is a draft — "Click Edit to modify and then Save and Load to update all phones" — so
// the contract they pin is now the opposite one: a tap changes the DRAFT and sends nothing, and ONE
// request carries the whole change when the operator says so. The old assertions could not simply be
// kept: they encode the behaviour the field asked us to remove (five heads to every gun for one
// sitting of adjustments, five ack counters racing).
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { Api, GameConfig, State } from '../src/api/types';
import { Kit } from '../src/screens/Kit';
import { Lobby } from '../src/screens/Lobby';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('no such control on screen');
  await act(async () => { (el as HTMLElement).click(); });
};

/** Mount KIT or LOBBY wired to a LIVE MockBackend (so `putConfig` really lands and can be re-read),
 *  with `modes` supplied (the harness's `mountScreen` defaults it to `[]`, which every existing
 *  screen tolerates because none of them read it -- this is the first screen that does). */
async function gameScreen(view: 'kit' | 'lobby', apiOverrides: Partial<Api> = {}) {
  const d = await demo();
  // The demo backend BOOTS at 'muster' -- this is the first screen that reads `state.phase`, so it
  // has to actually be advanced through the real backend, not spliced into the fixture object, or
  // `resync()` below would immediately un-advance it on the first re-fetch.
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
  const panel = () => m.el.querySelector('[data-testid="game-edit-panel"]')!;
  const inPanel = (sel: string) => panel().querySelector(sel) as HTMLElement | null;
  const open = () => click(m.find('[data-testid="game-edit-toggle"]')[0]);
  const night = () => inPanel('[role="switch"]');
  const save = () => panel().querySelector('[data-testid="game-edit-save"] button') as HTMLButtonElement | null;
  const cancel = () => panel().querySelector('[data-testid="game-edit-cancel"] button') as HTMLButtonElement | null;
  return { m, d, calls, api, modes, resync, open, panel, inPanel, night, save, cancel };
}

describe('GameEditPanel — collapsed by default, opens to the loaded game', () => {
  it('the header line names the game before it is even opened', async () => {
    const { m, d } = await gameScreen('kit');
    const toggle = m.find('[data-testid="game-edit-toggle"]')[0];
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // S45: the demo game is the Standard preset (45/70/0) -- the collapsed chip names the preset, not
    // the raw numbers, once the pool matches one.
    expect(d.state.config.health).toEqual({ max_hp: 45, max_armor: 70, max_shield: 0, preset: 'standard' });
    expect(toggle.textContent).toContain('STANDARD');
    expect(m.find('[data-testid="game-edit-locked"]').length, 'no lock warning pre-arm').toBe(0);
    m.unmount();
  });

  it('opening it shows MODE, NIGHT OPS, LIFE PRESET and WEAPONS AVAILABLE, seeded from the loaded game', async () => {
    const { m, d, open } = await gameScreen('kit');
    await open();
    const txt = m.text();
    expect(txt).toContain('MODE');
    expect(txt).toContain('NIGHT OPS');
    expect(txt).toContain('LIFE PRESET');
    expect(txt).toContain('WEAPONS AVAILABLE');
    // the loaded game is Standard, so that preset button reads pressed and no CUSTOM chip shows
    expect(m.find('[data-testid="health-preset-standard"]')[0].getAttribute('aria-pressed')).toBe('true');
    expect(m.find('[data-testid="health-preset-shields"]')[0].getAttribute('aria-pressed')).toBe('false');
    expect(m.find('[data-testid="health-preset-custom"]').length, 'no CUSTOM chip on a named preset').toBe(0);
    // ADVANCED starts collapsed on a named preset (nothing to hand-tune yet), open it to check the numbers
    await click(m.find('[data-testid="health-advanced-toggle"]')[0]);
    expect((m.find('input[aria-label="health"]')[0] as HTMLInputElement).value).toBe(String(d.state.config.health.max_hp));
    expect((m.find('input[aria-label="armor"]')[0] as HTMLInputElement).value).toBe(String(d.state.config.health.max_armor));
    expect((m.find('input[aria-label="shield"]')[0] as HTMLInputElement).value).toBe(String(d.state.config.health.max_shield));
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

describe('GameEditPanel — a DRAFT: nothing leaves the panel until SAVE', () => {
  it('MODE, NIGHT and HEALTH all change the draft and send NOTHING', async () => {
    const { m, d, calls, modes, open, inPanel, night } = await gameScreen('kit');
    await open();
    const other = modes.find(mm => mm.mode !== d.state.config.mode)!;
    await m.click(other.abbr);
    await click(night());
    await click(inPanel('[data-testid="health-advanced-toggle"]'));
    const hp = inPanel('input[aria-label="health"]') as HTMLInputElement;
    await act(async () => {
      hp.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hp, '60');
      hp.dispatchEvent(new Event('input', { bubbles: true }));
      hp.blur();
    });
    expect(calls, 'three edits, nothing on the wire').toEqual([]);
    // the panel says so out loud, rather than leaving the operator guessing what is staged
    expect(inPanel('[data-testid="game-edit-dirty"]')!.textContent).toContain('UNSAVED');
    expect((await d.api.getState()).config.mode, 'the server still holds the old game').toBe(d.state.config.mode);
    m.unmount();
  });

  it('SAVE sends ONE patch carrying the whole change, and it round-trips back into the control', async () => {
    const { m, calls, open, night, save, resync } = await gameScreen('kit');
    await open();
    await click(night());
    expect(save()!.textContent, 'nothing is loaded yet, so this is a plain SAVE').toContain('SAVE');
    await click(save());
    expect(calls).toEqual([{ night: true }]);
    const state = await resync();
    expect(state.config.night).toBe(true);
    // F.6 (2026-09-13): a SUCCESSFUL save closes the draft, so this is the only way left to prove the
    // round trip reaches the CONTROL and not just the snapshot object -- reopening seeds a fresh draft
    // from whatever the server actually holds now.
    await open();
    expect(night()!.getAttribute('aria-checked'), 'the switch itself reads back what was applied').toBe('true');
    m.unmount();
  });

  it('a mode switch carries that mode\'s defaults — the patch names the MODE, not the old numbers', async () => {
    const { m, d, calls, modes, open, save, resync } = await gameScreen('kit');
    await open();
    const other = modes.find(mm => mm.mode !== d.state.config.mode)!;
    await m.click(other.abbr);
    await click(save());
    // `state.py set_config` rebuilds the whole config from `default_config(mode)`; a patch that also
    // pinned the PREVIOUS mode's health would fight that rebuild.
    expect(calls).toEqual([{ mode: other.mode }]);
    const state = await resync();
    expect(state.config.mode).toBe(other.mode);
    expect(m.find('[data-testid="game-edit-toggle"]')[0].textContent).toContain(other.abbr);
    m.unmount();
  });

  it('SAVE is dead until something actually changes', async () => {
    const { m, open, save } = await gameScreen('kit');
    await open();
    expect(save()!.disabled, 'an untouched draft has nothing to send').toBe(true);
    m.unmount();
  });

  it('editing HP sends the whole health block, keeping armor and shield, and the box shows the applied value', async () => {
    const { m, d, calls, open, inPanel, save, resync } = await gameScreen('kit');
    await open();
    await click(inPanel('[data-testid="health-advanced-toggle"]'));
    const hp = inPanel('input[aria-label="health"]') as HTMLInputElement;
    await act(async () => {
      hp.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hp, '60');
      hp.dispatchEvent(new Event('input', { bubbles: true }));
      hp.blur();
    });
    // a hand-edited number is CUSTOM at once -- shown right there in the draft, before SAVE
    expect(inPanel('[data-testid="health-preset-custom"]'), 'editing a number leaves the preset').toBeTruthy();
    await click(save());
    expect(calls).toEqual([{ health: { max_hp: 60, max_armor: d.state.config.health.max_armor, max_shield: d.state.config.health.max_shield, preset: 'custom' } }]);
    // F.6 (2026-09-13): proving the request is not proving the round trip -- reopen (SAVE closed the
    // draft) and read the box back off the server's own applied config. CUSTOM re-derives server-side
    // too (`state.py`), so ADVANCED starts open again with no extra click.
    await resync();
    await open();
    expect((inPanel('input[aria-label="health"]') as HTMLInputElement).value,
      'the round trip reaches the control, not only the outgoing request').toBe('60');
    m.unmount();
  });

  it('switching a weapon off stages its id in exclude_ids, and the chip repaints in the DRAFT', async () => {
    const { m, d, calls, open, save, resync } = await gameScreen('kit');
    await open();
    const weapons = await d.api.getWeapons();
    const excluded = d.state.config.loadout_policy!.primary.exclude_ids ?? [];
    const w = weapons.find(x => !excluded.includes(x.weapon_id))!;
    // Scoped to the PRIMARY pool group: a weapon allowed in BOTH primary and secondary renders two
    // identically-labelled chips (one per `PoolEditor`), so an unscoped query cannot tell them apart.
    const group = () => m.el.querySelector('[aria-label="primary weapons available"]')!;
    expect(group().querySelectorAll(`[aria-label="${w.name}, allowed"]`).length, `${w.name} starts allowed in PRIMARY`).toBe(1);
    await click(group().querySelector(`[aria-label="${w.name}, allowed"]`));
    // the draft repaints IMMEDIATELY (it is client-side, `computePool`) with nothing sent
    expect(calls).toEqual([]);
    expect(group().querySelectorAll(`[aria-label="${w.name}, off"]`).length, 'the chip follows the draft, not the server').toBe(1);
    await click(save());
    expect(calls.length).toBe(1);
    expect(calls[0].loadout_policy?.primary?.exclude_ids).toContain(w.weapon_id);
    const state = await resync();
    expect(state.config.loadout_policy!.primary.exclude_ids).toContain(w.weapon_id);
    // F.6 (2026-09-13): the request payload and the raw server state are not the same proof as "the
    // control itself reads it back" -- reopen (SAVE closed the draft) and check the chip again, seeded
    // fresh from what the server now holds.
    await open();
    expect(group().querySelectorAll(`[aria-label="${w.name}, off"]`).length, 'the same chip now reads off, seeded from the server').toBe(1);
    expect(group().querySelectorAll(`[aria-label="${w.name}, allowed"]`).length).toBe(0);
    m.unmount();
  });

  it('a FIXED slot shows what everyone carries instead of a toggle list', async () => {
    const { d, m, open } = await gameScreen('kit');
    await d.api.putConfig({ loadout_policy: { ...d.state.config.loadout_policy!, primary: { ...d.state.config.loadout_policy!.primary, choice: 'fixed', fixed_id: 'sniper_rifle' } } });
    const state = await d.api.getState();
    await m.update(<StoreCtx.Provider value={makeStore({ ...d, state, view: 'kit' }, { api: d.api, modes: await d.api.getModes() })}><Kit /></StoreCtx.Provider>);
    await open();
    expect(m.text()).toMatch(/FIXED.*carries/i);
    m.unmount();
  });

  it('abandoning a dirty draft asks once, and never sends', async () => {
    const { m, calls, open, night, cancel, panel } = await gameScreen('kit');
    await open();
    await click(night());
    await click(cancel());
    expect(panel().querySelector('[data-testid="game-edit-discard"]'), 'the first CANCEL asks').toBeTruthy();
    await click(cancel());
    expect(m.el.querySelector('[data-testid="game-edit-panel"] [role="switch"]'), 'the second discards the draft').toBeFalsy();
    expect(calls).toEqual([]);
    m.unmount();
  });

  it('F.4: a further edit after ONE cancel-confirm asks again -- editing does not spend the confirm silently', async () => {
    const { m, calls, open, night, cancel, panel, inPanel } = await gameScreen('kit');
    await open();
    await click(night());
    await click(cancel());
    expect(panel().querySelector('[data-testid="game-edit-discard"]'), 'the first CANCEL asks').toBeTruthy();
    // The operator did NOT confirm the discard -- they kept working, editing something ELSE (not
    // toggling NIGHT back to its original value, which would make the draft clean again and cancel
    // outright for an unrelated reason). `edit()` used to clear only `confirmSave`, leaving
    // `confirmCancel` primed: the NEXT tap of CANCEL would discard this fresh work immediately, on
    // what reads to the operator as its own first ask.
    await click(inPanel('[data-testid="health-advanced-toggle"]'));
    const hp = inPanel('input[aria-label="health"]') as HTMLInputElement;
    await act(async () => {
      hp.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hp, '77');
      hp.dispatchEvent(new Event('input', { bubbles: true }));
      hp.blur();
    });
    expect(panel().querySelector('[data-testid="game-edit-discard"]'), 'editing again stands the ask down').toBeFalsy();
    await click(cancel());
    expect(panel().querySelector('[data-testid="game-edit-discard"]'), 'so CANCEL has to ask again, not discard on the spot').toBeTruthy();
    expect(m.el.querySelector('[data-testid="game-edit-panel"] [role="switch"]'), 'the draft is still here after just one CANCEL').toBeTruthy();
    expect(calls).toEqual([]);
    m.unmount();
  });
});

describe('GameEditPanel — a reshaping SAVE confirms once, at the moment it would move people', () => {
  it('shows the predicted split on the first SAVE tap and commits on the second', async () => {
    const { m, calls, open, save, panel } = await gameScreen('lobby');
    await open();
    // KOTH declares BLUE+GREEN against the demo's TDM BLUE+YELLOW: an 8-player roster really moves.
    await m.click('KOTH');
    expect(calls, 'picking the mode sends nothing').toEqual([]);
    await click(save());
    const split = panel().querySelector('[data-testid="confirm-split"]');
    expect(split, 'the reshape is shown BEFORE it happens').toBeTruthy();
    expect(split!.textContent).toMatch(/^▲ \d+ PLAYERS? → [A-Z]+ \d+ \/ [A-Z]+ \d+$/);
    expect(calls, 'and the first SAVE tap still sends nothing').toEqual([]);
    await click(save());
    expect(calls).toEqual([{ mode: 'koth' }]);
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
    // 2026-09-16 (Tony): no yellow LOCKED badge on the collapsed row. The open panel still says why.
    expect(m.find('[data-testid="game-edit-toggle"]')[0].textContent).not.toMatch(/LOCKED/);
    await click(m.find('[data-testid="game-edit-toggle"]')[0]);
    expect(m.find('[data-testid="game-edit-locked"]').length, 'the panel explains WHY, not just that it is locked').toBe(1);
    expect(m.text()).toMatch(/RECALL/);
    // A real HTML `disabled` on the wrapping `<fieldset>`, not a per-control flag that a new control
    // could forget to carry. (jsdom does not implement the browser's fieldset->descendant disabling
    // cascade, so the individual elements inside cannot be asserted here the way a real-browser check
    // can -- that is covered by the e2e step against an actual browser instead.)
    const fieldset = m.el.querySelector('[data-testid="game-edit-panel"] fieldset') as HTMLFieldSetElement;
    expect(fieldset.disabled, 'one real disabled locks every control at once').toBe(true);
    // ...and so is the one control that would otherwise SEND the draft.
    const save = m.el.querySelector('[data-testid="game-edit-save"] button') as HTMLButtonElement;
    expect(save.disabled, 'SAVE cannot fire into a match in play either').toBe(true);
    m.unmount();
  });

  it('OPEN GAME DESIGNER is inside that lock too — it used to stay tappable and dead-end on the Designer banner', async () => {
    const d = await demo();
    const modes = await d.api.getModes();
    const designer = (state: State) => {
      const store = makeStore({ ...d, state, view: 'kit' }, { modes });
      return mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
    };
    const find = (m: Awaited<ReturnType<typeof designer>>) =>
      m.find('button').find(b => (b.textContent ?? '').includes('OPEN GAME DESIGNER')) as HTMLButtonElement | undefined;

    const live = await designer({ ...d.state, phase: 'live' });
    await click(live.find('[data-testid="game-edit-toggle"]')[0]);
    const lockedBtn = find(live);
    expect(lockedBtn, 'the control is still on screen — greyed, not hidden').toBeTruthy();
    expect(lockedBtn!.disabled, 'a real HTML disabled, never a tap that quietly goes nowhere').toBe(true);
    live.unmount();

    // CONTROL: in KIT it is live, so the lock is what disabled it and not the button always being dead.
    const kit = await designer({ ...d.state, phase: 'kit' });
    await click(kit.find('[data-testid="game-edit-toggle"]')[0]);
    expect(find(kit)!.disabled).toBe(false);
    kit.unmount();
  });
});

describe('GameEditPanel — a request that lands in the phase-race window is still refused clearly', () => {
  it('rewrites the server refusal to name the fix (RECALL), and KEEPS the draft', async () => {
    const d = await demo();
    // The CONSOLE still thinks it is KIT (the race: the phase already advanced server-side, the next
    // snapshot has not landed yet) -- so nothing is client-side disabled, and the only thing standing
    // between SAVE and the gun is the server's own answer.
    await d.api.setPhase('kit', true);
    const state: State = { ...(await d.api.getState()), phase: 'kit' };
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
    await click(m.el.querySelector('[data-testid="game-edit-panel"] [role="switch"]'));
    await click(m.el.querySelector('[data-testid="game-edit-save"] button'));
    expect(errors.length, 'the failure is never swallowed').toBe(1);
    expect(errors[0]).toMatch(/RECALL/);
    // …and the operator's work survives the refusal: a 409 must not eat what they just typed.
    expect(m.el.querySelector('[data-testid="game-edit-panel"] [role="switch"]')!.getAttribute('aria-checked'),
      'the draft is still on screen, still holding the change').toBe('true');
    m.unmount();
  });
});

describe('GameEditPanel — a SAVE while the lobby is already pushed RE-PUSHES (B1/B3)', () => {
  it('acks clear immediately (visibly re-pushing), then repopulate — the same acks LOBBY\'s own step reads', async () => {
    const { m, d, calls, open, night, save, resync, panel } = await gameScreen('lobby');
    await d.api.pushLobby(true);
    let state = await resync();
    expect(state.lobby.pushed).toBe(true);
    // The demo field is not perfect (one gun is deliberately unreachable, matching a real muster) --
    // so the baseline is whatever acked the FIRST push, not every player.
    const baseline = Object.values(state.lobby.acks).filter(a => a.ok).length;
    expect(baseline, 'at least one gun acked the first push').toBeGreaterThan(0);
    await open();
    expect(save()!.textContent, 'with a head on the guns, saving IS loading — and the button says so').toContain('SAVE AND LOAD');
    await click(night());
    await click(save());
    expect(calls.length).toBe(1);

    // Immediately after the PUT resolves, the mock (mirroring the real server) has already cleared the
    // acks but not yet repopulated them — the transitional "re-pushing" moment.
    state = await resync();
    expect(state.lobby.pushed, 'stays pushed — this is a RE-push, not an un-push (B1 was the un-push)').toBe(true);
    expect(Object.keys(state.lobby.acks).length, 'acks cleared: the guns have not echoed the new config yet').toBe(0);
    expect(panel().querySelector('[data-testid="game-edit-repush"]')!.textContent).toMatch(/RE-PUSHING/);
    // LOBBY's OWN "config pushed" step reads the identical field and agrees — one source, never two counts.
    expect(m.text()).toMatch(/Config pushed/);

    await sleep(260);
    state = await resync();
    expect(Object.values(state.lobby.acks).filter(a => a.ok).length, 'the same guns re-acked the new config').toBe(baseline);
    m.unmount();
  });

  it('before any push, the panel distinguishes loaded phones from unconfigured guns', async () => {
    const { m, open, panel } = await gameScreen('kit');
    await open();
    expect(panel().querySelector('[data-testid="game-edit-repush"]')!.textContent).toMatch(/GUNS NOT CONFIGURED YET/);
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

describe('GameEditPanel — an ack for a PREVIOUS config is not confirmation (A36)', () => {
  it('routes the count through pushGate, the SAME predicate LOBBY and KIT use, not its own bare a.ok count', async () => {
    const d = await demo();
    await d.api.setPhase('kit', true);
    const base = await d.api.getState();
    // A single-player roster makes the bug visible without any noise from the demo's other (real)
    // fleet faults: one gun, one stale ack, so a naive `a.ok` count reads it as "ALL GUNS ON THIS
    // CONFIG (1/1)" -- confirmed -- for a gun that has never laid eyes on the config on screen now.
    const player = base.players[0];
    const state: State = {
      ...base,
      phase: 'kit',
      players: [player],
      lobby: { ...base.lobby, pushed: true, all_acked: false,
        acks: { [player.player_id]: { ok: true, config_id: 'a-config-from-before-this-one' } } },
    };
    const modes = await d.api.getModes();
    const store = makeStore({ ...d, state, view: 'kit' }, { modes });
    const m = await mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
    await click(m.find('[data-testid="game-edit-toggle"]')[0]);
    const status = m.el.querySelector('[data-testid="game-edit-repush-open"]')!.textContent ?? '';
    expect(status, `saw ${JSON.stringify(status)} -- a stale ack must never read as this config confirmed`).not.toMatch(/ALL GUNS/);
    expect(status, 'the honest count: zero acks are CURRENT for this config').toMatch(/0\/1 GUNS CONFIRMED/);
    m.unmount();
  });
});

describe('GameEditPanel — a mode this console has no defaults for (F.5)', () => {
  it('SAVE sends health/policy outright rather than comparing the draft to the OLD mode and pinning its numbers', async () => {
    const d = await demo();
    await d.api.setPhase('kit', true);
    const state = await d.api.getState();
    const realModes = await d.api.getModes();
    const target = realModes.find(mm => mm.mode !== state.config.mode)!;
    // Present in the CONSOLE's own catalog (so its chip renders and is tappable) but with no
    // `defaults` -- a partial/incomplete `/api/modes` fetch, or a mode the server has not finished
    // configuring for this console. The real `MockBackend` (mirroring `state.py`) still knows the
    // mode fully; only THIS console's local copy of it is missing the piece `baseFor` needs.
    const broken = { ...target, defaults: undefined as unknown as typeof target.defaults };
    const modes = realModes.map(mm => (mm.mode === target.mode ? broken : mm));
    const calls: Partial<GameConfig>[] = [];
    const api = fixtureApi({ putConfig: async (patch: Partial<GameConfig>) => { calls.push(patch); return d.api.putConfig(patch); } }, d.api);
    const store = makeStore({ state, view: 'kit' }, { api, modes });
    const m = await mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
    await click(m.find('[data-testid="game-edit-toggle"]')[0]);
    const chip = m.find('[aria-label="mode"] button').find(b => (b.textContent ?? '').trim() === target.abbr)!;
    await click(chip);
    await click(m.el.querySelector('[data-testid="game-edit-save"] button'));
    expect(calls.length).toBe(1);
    expect(calls[0].mode).toBe(target.mode);
    // Neither field was touched by the operator -- the mode switch alone kept them at the OLD mode's
    // values (no defaults to rebuild from). Without the fix, comparing that against `cfg` (the SAME
    // old values) reads as "unchanged" and DROPS them from the patch, silently relying on the
    // server's own rebuild -- which, unlike this console, actually knows the new mode's real
    // defaults, so the two would then disagree about what just got applied. Sending them explicitly
    // is the correct, WYSIWYG-safe choice: what the draft shows is what gets sent.
    expect(calls[0].health, 'health rides along explicitly -- there is no known default to diff against').toEqual(state.config.health);
    expect(calls[0].loadout_policy, 'same for the weapon policy').toEqual(state.config.loadout_policy);
    m.unmount();
  });
});

describe('GameEditPanel — VIEW LOADED GAME, and nothing locked after the whistle (2026-09-16)', () => {
  it('the collapsed control reads VIEW LOADED GAME, never EDIT LOADED GAME', async () => {
    const { m } = await gameScreen('kit');
    const toggle = m.find('[data-testid="game-edit-toggle"]')[0];
    expect(toggle.textContent).toContain('VIEW LOADED GAME');
    expect(m.text()).not.toContain('EDIT LOADED GAME');
    m.unmount();
  });

  for (const phase of ['recap', 'live'] as const) {
    it(`no LOCKED label on the control in ${phase.toUpperCase()}`, async () => {
      const d = await demo();
      const state: State = { ...d.state, phase };
      const modes = await d.api.getModes();
      const store = makeStore({ ...d, state, view: 'kit' }, { modes });
      const m = await mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
      const toggle = m.find('[data-testid="game-edit-toggle"]')[0];
      expect(toggle.textContent).not.toMatch(/LOCKED/);
      expect(toggle.querySelector('[role="status"]'), 'no badge element at all').toBeNull();
      m.unmount();
    });
  }

  it('in RECAP the opened panel is editable: no lock warning, a live fieldset', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap' };
    const modes = await d.api.getModes();
    const store = makeStore({ ...d, state, view: 'kit' }, { modes });
    const m = await mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
    await click(m.find('[data-testid="game-edit-toggle"]')[0]);
    expect(m.find('[data-testid="game-edit-locked"]').length).toBe(0);
    const fieldset = m.el.querySelector('[data-testid="game-edit-panel"] fieldset') as HTMLFieldSetElement;
    expect(fieldset.disabled).toBe(false);
    expect(m.text()).not.toMatch(/THIS MATCH ENDED/);
    m.unmount();
  });
});
