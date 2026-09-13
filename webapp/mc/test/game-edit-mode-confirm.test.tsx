// The inline MODE switch on KIT/LOBBY reshapes the roster too, and used to do it on ONE tap.
//
// GAMES got a two-tap confirm for exactly this in T2-A (9a1570d): switching mode re-teams every
// player onto the new mode's declared teams. The SAME reshape was still reachable with a single
// unconfirmed tap from `GameEditPanel`'s MODE control, whose only helper text said "Venue (day/night)
// stays" -- it never mentioned the teams moving. That is the bug the operator hit in the field, so
// this pins the confirm on the panel as well, using the SAME `splitLine` predicate and the SAME
// `SwitchConfirm` primitive the GAMES tiles use rather than a second implementation.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { GameConfig } from '../src/api/types';
import { Lobby } from '../src/screens/Lobby';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

const click = async (el: Element) => act(async () => { (el as HTMLElement).click(); });

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
  return { m, d, calls, modes, chip };
}

describe('GameEditPanel MODE is a two-tap control when it would reshape the roster', () => {
  it('the first tap sends nothing and shows the predicted split', async () => {
    const p = await panel();
    expect(p.d.state.config.mode, 'control: the demo starts on tdm').toBe('tdm');
    expect(p.d.state.players.length, 'control: a rostered game').toBeGreaterThanOrEqual(2);
    const koth = p.modes.find(m => m.mode === 'koth')!;

    await click(p.chip(koth.abbr));
    expect(p.calls.length, 'the FIRST tap must not reach the server').toBe(0);
    const split = p.m.find('[data-testid="confirm-split"]')[0];
    expect(split, 'the predicted split is on screen before anything moves').toBeTruthy();
    expect(split.textContent).toMatch(/^▲ \d+ PLAYERS? → [A-Z]+ \d+ \/ [A-Z]+ \d+$/);
    expect(split.textContent, 'the same prediction the GAMES tiles make').toBe('▲ 8 PLAYERS → BLUE 4 / GREEN 4');

    await click(p.chip(koth.abbr));
    expect(p.calls.length, 'the SECOND tap commits exactly one config write').toBe(1);
    expect(p.calls[0].mode).toBe('koth');
    p.m.unmount();
  });

  it('the confirm copy clears the 11px floor, like every other confirm', async () => {
    const p = await panel();
    const koth = p.modes.find(m => m.mode === 'koth')!;
    await click(p.chip(koth.abbr));
    const leaves = p.m.find('[data-testid="confirm-switch"] *')
      .filter(el => el.children.length === 0 && (el.textContent ?? '').trim().length > 3)
      .map(el => ({ t: (el.textContent ?? '').trim(), px: parseFloat(getComputedStyle(el).fontSize) }));
    expect(leaves.length, 'control: the confirm rendered copy').toBeGreaterThan(0);
    expect(leaves.filter(l => l.px < 11), `sub-11px confirm copy: ${JSON.stringify(leaves)}`).toEqual([]);
    p.m.unmount();
  });
});
