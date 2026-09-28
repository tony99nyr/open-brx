// The inline MODE switch on KIT/LOBBY. Picking a mode in the draft moves nobody (it changes a local
// object); SAVE AND LOAD is the one tap that sends it. Bench 2026-09-28 (Tony, no warnings): that SAVE
// applies at once, with no "TAP SAVE AGAIN" split preview. The server keeps each player's side on a
// same-count change and splits evenly on a count change.
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

describe('GameEditPanel — a mode change saves on one tap, with nothing to read', () => {
  it('picking the mode sends nothing; one SAVE tap commits it, and no confirm appears', async () => {
    const p = await panel();
    expect(p.d.state.config.mode, 'control: the demo starts on tdm').toBe('tdm');
    expect(p.d.state.players.length, 'control: a rostered game').toBeGreaterThanOrEqual(2);
    const koth = p.modes.find(m => m.mode === 'koth')!;

    await click(p.chip(koth.abbr));
    expect(p.calls.length, 'picking a mode in the draft must not reach the server').toBe(0);

    await click(p.save());
    expect(p.calls.length, 'the FIRST SAVE tap commits exactly one config write').toBe(1);
    expect(p.calls[0].mode).toBe('koth');
    expect(p.m.find('[data-testid="confirm-switch"]').length, 'no split warning to read').toBe(0);
    p.m.unmount();
  });

  it('an edit that moves NOBODY saves on one tap — a confirm nobody needs is a confirm everybody learns to ignore', async () => {
    const p = await panel();
    await click(p.m.el.querySelector('[data-testid="game-edit-panel"] [role="switch"]'));   // NIGHT: no reshape
    await click(p.save());
    expect(p.calls).toEqual([{ night: true }]);
    p.m.unmount();
  });

});
