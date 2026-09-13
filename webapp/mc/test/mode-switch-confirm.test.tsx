// F-6 (2026-09-13). `Games.tsx guarded()` only confirmed a TUNED (unsaved) draft — a mode-tile switch
// with a rostered game was one unconfirmed tap, even though round-3 FIELD-1's index-map + rebalance
// still MOVES players between teams (TDM's BLUE/YELLOW to KOTH's BLUE/GREEN). This is the new gate:
// confirm whenever the switch would reshape ≥2 rostered players, and show the resulting split.
import { describe, expect, it } from 'vitest';
import type { ModeInfo, State } from '../src/api/types';
import { Games } from '../src/screens/Games';
import { splitLine } from '../src/screens/gameSummary';
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

describe('GAMES mode-tile switch confirms a roster reshape', () => {
  it('a rostered TDM -> KOTH switch shows the split, and the first tap sends nothing', async () => {
    const g = await games();
    const before = await g.api.getState();
    expect(before.players.length, 'control: a rostered game (the demo default)').toBeGreaterThanOrEqual(2);
    expect(before.config.mode).toBe('tdm');
    await g.m.click('KING OF THE HILL');
    // the first tap must not have reached the server
    expect((await g.api.getState()).config.mode, 'no silent switch — the first tap only confirms').toBe('tdm');
    const confirm = g.m.find('[data-testid="confirm-split"]')[0];
    expect(confirm, 'the resulting split is on screen before the second tap').toBeTruthy();
    expect(confirm.textContent).toMatch(/\d+ PLAYERS? → BLUE \d+ \/ GREEN \d+/);
    // second tap on the same card actually plays it
    await g.m.click('KING OF THE HILL');
    await g.settle();
    expect((await g.api.getState()).config.mode).toBe('koth');
    g.m.unmount();
  });

  it('re-picking the SAME mode (identical team layout) stays a one-tap no-op guard — nothing to confirm', async () => {
    // Two different games sharing a team layout (or "run it back") move nobody; showing a confirm
    // there would train operators to blind-tap through every confirm, which defeats the point of one.
    const g = await games();
    await g.m.click('TEAM DEATHMATCH');   // already the active stock mode -> tappable() swallows it
    expect(g.m.find('[data-testid="confirm-split"]').length).toBe(0);
    g.m.unmount();
  });

});

describe('splitLine — the pure predicate behind the gate', () => {
  const blue = { team_id: 'blue' }, yellow = { team_id: 'yellow' }, green = { team_id: 'green' };
  it('nothing to confirm with fewer than two players rostered', () => {
    expect(splitLine([{ player_num: 1, team_id: 'blue' }], [blue, yellow], [blue, green])).toBe('');
    expect(splitLine([], [blue, yellow], [blue, green])).toBe('');
  });
  it('nothing to confirm when the target has fewer than two teams (FFA)', () => {
    const players = [{ player_num: 1, team_id: 'blue' }, { player_num: 2, team_id: 'yellow' }];
    expect(splitLine(players, [blue, yellow], [{ team_id: 'ffa' }])).toBe('');
  });
  it('nothing to confirm when the target declares the SAME team ids already applied', () => {
    const players = [{ player_num: 1, team_id: 'blue' }, { player_num: 2, team_id: 'yellow' }];
    expect(splitLine(players, [blue, yellow], [blue, yellow])).toBe('');
  });
  it('"N PLAYERS → BLUE n / GREEN n" when the layout actually changes, in the NEW mode\'s team order', () => {
    const players = [
      { player_num: 1, team_id: 'blue' }, { player_num: 2, team_id: 'yellow' },
      { player_num: 3, team_id: 'blue' }, { player_num: 4, team_id: 'yellow' },
    ];
    expect(splitLine(players, [blue, yellow], [blue, green])).toBe('4 PLAYERS → BLUE 2 / GREEN 2');
  });
});
