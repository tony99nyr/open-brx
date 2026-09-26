// The GAMES mode-tile CONFIRM CONTRACT, pinned as a fast test.
//
// T2-A (9a1570d, "GAMES confirms a mode/game switch that reshapes >=2 rostered players") turned the
// mode tiles from one tap into two. That is the intended fix for a field bug -- a tile silently
// reshaped teams -- but `test/e2e/koth.mjs` picks KOTH with ONE tap, so the pick stopped applying and
// TEN assertions across the suite cascaded from it. koth.mjs is the only suite that hardcodes :8765,
// so it is the one suite a lane cannot run: the regression was invisible until the integrator ran it
// by hand.
//
// This file is the fast guard for that. It fails if a tile goes back to one tap, if the confirm's
// TEXT SHAPE changes out from under the e2e's locators, or if the confirm copy drops below the
// console's 11px legibility floor. It binds nothing and runs in `npm test`.
import { describe, expect, it } from 'vitest';
import type { ModeInfo, State } from '../src/api/types';
import { Games } from '../src/screens/Games';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { makeStore, mount } from './harness';

async function games() {
  const api = new MockBackend();
  const modes: ModeInfo[] = await api.getModes();
  let state: State = await api.getState();
  const render = () => (<StoreCtx.Provider value={makeStore({ state, view: 'build' }, { api, modes })}><Games /></StoreCtx.Provider>);
  const m = await mount(render());
  return { m, api, modes, settle: async () => { state = await api.getState(); await m.update(render()); } };
}

/** Every leaf element inside the confirm block, with the size it actually renders at. jsdom computes
 *  no layout but DOES resolve the `font` shorthand to a px `fontSize` (probed 2026-09-13), which is
 *  the only thing this assertion needs. */
const confirmLeaves = (m: Awaited<ReturnType<typeof games>>['m']) =>
  m.find('[data-testid="confirm-switch"] *')
    .filter(el => el.children.length === 0 && (el.textContent ?? '').trim().length > 3)
    .map(el => ({ t: (el.textContent ?? '').trim(), px: parseFloat(getComputedStyle(el).fontSize) }));

describe('the GAMES mode tile is a TWO-TAP control', () => {
  it('a stock tile that reshapes the roster does not apply on the first tap', async () => {
    const g = await games();
    const before = await g.api.getState();
    expect(before.config.mode, 'control: the demo starts on tdm').toBe('tdm');
    expect(before.players.length, 'control: a rostered game').toBeGreaterThanOrEqual(2);

    await g.m.click('KING OF THE HILL');
    expect((await g.api.getState()).config.mode, 'the FIRST tap must send nothing').toBe('tdm');
    expect(g.m.find('[data-testid="confirm-switch"]').length, 'the confirm is on screen after tap 1').toBe(1);

    await g.m.click('KING OF THE HILL');
    await g.settle();
    expect((await g.api.getState()).config.mode, 'the SECOND tap commits the pick').toBe('koth');
  });

  it('the confirm names the predicted split in the shape the e2e reads', async () => {
    const g = await games();
    await g.m.click('KING OF THE HILL');
    const split = g.m.find('[data-testid="confirm-split"]')[0];
    expect(split, 'the split line carries its own testid').toBeTruthy();
    // the e2e and the operator both read this line; its shape is a contract, not an implementation detail
    expect(split.textContent).toMatch(/^▲ \d+ PLAYERS? → [A-Z]+ \d+ \/ [A-Z]+ \d+$/);
    expect(split.textContent, 'the demo roster is 8, split 4/4 across the koth sides').toBe('▲ 8 PLAYERS → BLUE 4 / PURPLE 4');
    // and the block tells the operator what to do with it
    expect(g.m.find('[data-testid="confirm-switch"]')[0].textContent).toMatch(/TAP AGAIN/);
    g.m.unmount();
  });
});

describe('the confirm copy clears the 11px legibility floor', () => {
  // `ui/index.tsx` states the rule: "the console's floor for meaning-bearing text is 11 px (audit
  // 2026-09-12)". Both of these lines carry meaning an operator acts on -- one says the roster is
  // about to move, the other says an unsaved game is about to be lost -- and koth.mjs's `audit-text`
  // step fails the whole run on either of them being under the floor.
  it('every line of a roster-reshape confirm is >= 11px', async () => {
    const g = await games();
    await g.m.click('KING OF THE HILL');
    const leaves = confirmLeaves(g.m);
    expect(leaves.length, 'control: the confirm really rendered some copy').toBeGreaterThan(0);
    expect(leaves.filter(l => l.px < 11), `sub-11px confirm copy: ${JSON.stringify(leaves)}`).toEqual([]);
    g.m.unmount();
  });

  it('the UNSAVED-TUNED-GAME warning is >= 11px too', async () => {
    const g = await games();
    // tune the live config so the draft is TUNED -- NOT SAVED, which is what raises that line
    await g.api.putConfig({ scoring: { frag_limit: 10, win_by: 'objective' } });
    await g.settle();
    await g.m.click('KING OF THE HILL');
    const leaves = confirmLeaves(g.m);
    const drop = leaves.find(l => /DROPS YOUR UNSAVED TUNED GAME/.test(l.t));
    expect(drop, `the unsaved-draft warning is on screen: ${JSON.stringify(leaves)}`).toBeTruthy();
    expect(drop!.px, 'the unsaved-draft warning is legible').toBeGreaterThanOrEqual(11);
    expect(leaves.filter(l => l.px < 11), `sub-11px confirm copy: ${JSON.stringify(leaves)}`).toEqual([]);
    g.m.unmount();
  });
});
