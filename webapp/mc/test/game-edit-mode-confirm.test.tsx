// The inline MODE switch on KIT/LOBBY reshapes the roster, and the operator has to be asked before
// anybody moves.
//
// T2-A (9a1570d) gave the GAMES tiles a two-tap confirm for exactly this, and a follow-up put the
// same gate on `GameEditPanel`'s MODE chip. REWRITTEN 2026-09-13: the panel is a DRAFT now, so the
// question moved to the tap that actually moves people. Picking a mode in a draft moves NOBODY — it
// changes a local object — and confirming there would have trained operators to tap through a
// warning about something that had not happened yet, twice per edit. SAVE AND LOAD is the tap that
// reshapes the roster, so SAVE AND LOAD is the tap that asks, with the SAME `splitLine` predicate and
// the SAME `SwitchConfirm` primitive the GAMES tiles use rather than a second implementation.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { GameConfig } from '../src/api/types';
import { Lobby } from '../src/screens/Lobby';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

const click = async (el: Element | null) => {
  if (!el) throw new Error('no such control on screen');
  await act(async () => { (el as HTMLElement).click(); });
};

async function panel() {
  const d = await demo();
  await d.api.setPhase('lobby', true);
  d.state = await d.api.getState();
  const modes = await d.api.getModes();
  const calls: Partial<GameConfig>[] = [];
  const api = fixtureApi({ putConfig: async (patch: Partial<GameConfig>) => { calls.push(patch); return d.api.putConfig(patch); } }, d.api);
  const store = makeStore({ ...d, view: 'lobby' }, { api, modes });
  const m = await mount(<StoreCtx.Provider value={store}><Lobby /></StoreCtx.Provider>);
  await click(m.find('[data-testid="game-edit-toggle"]')[0]);
  const chip = (abbr: string) => m.find('[aria-label="mode"] button').find(b => (b.textContent ?? '').trim() === abbr)!;
  const save = () => m.el.querySelector('[data-testid="game-edit-save"] button') as HTMLButtonElement | null;
  return { m, d, calls, modes, chip, save };
}

describe('GameEditPanel — a reshaping SAVE is a two-tap control', () => {
  it('picking the mode sends nothing and asks nothing; the first SAVE tap shows the predicted split', async () => {
    const p = await panel();
    expect(p.d.state.config.mode, 'control: the demo starts on tdm').toBe('tdm');
    expect(p.d.state.players.length, 'control: a rostered game').toBeGreaterThanOrEqual(2);
    const koth = p.modes.find(m => m.mode === 'koth')!;

    await click(p.chip(koth.abbr));
    expect(p.calls.length, 'picking a mode in the draft must not reach the server').toBe(0);
    expect(p.m.find('[data-testid="confirm-switch"]').length,
      'and it does not ask about a reshape that has not been requested yet').toBe(0);

    await click(p.save());
    expect(p.calls.length, 'the FIRST SAVE tap must not reach the server either').toBe(0);
    const split = p.m.find('[data-testid="confirm-split"]')[0];
    expect(split, 'the predicted split is on screen before anything moves').toBeTruthy();
    expect(split.textContent).toMatch(/^▲ \d+ PLAYERS? → [A-Z]+ \d+ \/ [A-Z]+ \d+$/);
    expect(split.textContent, 'the same prediction the GAMES tiles make').toBe('▲ 8 PLAYERS → BLUE 4 / GREEN 4');

    await click(p.save());
    expect(p.calls.length, 'the SECOND SAVE tap commits exactly one config write').toBe(1);
    expect(p.calls[0].mode).toBe('koth');
    p.m.unmount();
  });

  it('an edit that moves NOBODY saves on one tap — a confirm nobody needs is a confirm everybody learns to ignore', async () => {
    const p = await panel();
    await click(p.m.el.querySelector('[data-testid="game-edit-panel"] [role="switch"]'));   // NIGHT: no reshape
    await click(p.save());
    expect(p.calls).toEqual([{ night: true }]);
    p.m.unmount();
  });

  it('the confirm copy clears the 11px floor, like every other confirm', async () => {
    const p = await panel();
    const koth = p.modes.find(m => m.mode === 'koth')!;
    await click(p.chip(koth.abbr));
    await click(p.save());
    const leaves = p.m.find('[data-testid="confirm-switch"] *')
      .filter(el => el.children.length === 0 && (el.textContent ?? '').trim().length > 3)
      .map(el => ({ t: (el.textContent ?? '').trim(), px: parseFloat(getComputedStyle(el).fontSize) }));
    expect(leaves.length, 'control: the confirm rendered copy').toBeGreaterThan(0);
    expect(leaves.filter(l => l.px < 11), `sub-11px confirm copy: ${JSON.stringify(leaves)}`).toEqual([]);
    p.m.unmount();
  });
});
