// F70/F82/F88 — King of the Hill on the GAMES screen: is the mode actually PICKABLE, and does the
// operator get told what to do with the grenade?
//
// The server half is `mcp/tests/test_mc_koth.py`. What is asserted here is the half a python test
// cannot see: the card exists in the shelf a human clicks, and picking it puts the objective source
// and the field setup step on the screen. Mounted against the same MockBackend `?mock` uses.
import { describe, expect, it } from 'vitest';
import { Games } from '../src/screens/Games';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { makeStore, mount } from './harness';
import type { ModeInfo, State } from '../src/api/types';

/** GAMES with a live mock backend behind it, its `modes` list loaded the way `store.tsx` loads it. */
async function games() {
  const api = new MockBackend();
  const modes: ModeInfo[] = await api.getModes();
  let state: State = await api.getState();
  const render = () => (
    <StoreCtx.Provider value={makeStore({ state, view: 'build' }, { api, modes })}><Games /></StoreCtx.Provider>
  );
  const m = await mount(render());
  return {
    m, api, modes,
    /** re-read the mock's state and re-render, i.e. what the WS snapshot does in the real console */
    settle: async () => { state = await api.getState(); await m.update(render()); },
  };
}

describe('KING OF THE HILL — GAMES', () => {
  it('is in the stock shelf, and picking it shows the objective source and the grenade setup step', async () => {
    const g = await games();
    expect(g.modes.map(x => x.mode)).toContain('koth');
    expect(g.m.text()).toContain('KING OF THE HILL');

    await g.m.click('KING OF THE HILL');       // the card itself is the play button
    await g.settle();
    const t = g.m.text();
    // the rail's own rows: how it is won, and what is emitting the point (F88: exactly one)
    expect(t).toContain('POSSESSION TIME');
    expect(t).toMatch(/GRENADE HILL · ONE POINT/);
    // the field step nothing in software can do for the operator
    expect(t).toMatch(/POWER-CYCLE THE GRENADE/i);
    expect(t).toMatch(/NEUTRAL/i);
    expect(t).toMatch(/HILL MODE/i);
    expect(t).toMatch(/F88/);
    g.m.unmount();
  });

  it('never offers the neutral team: the hill defaults are BLUE + GREEN, never tid 2 (F82)', async () => {
    // A NEUTRAL hill broadcasts team 2, so a yellow (tid 2) roster reads every uncaptured point as its
    // own and takes no hill damage. The server refuses such a roster; the mode's own defaults must not
    // hand the operator one in the first place.
    const g = await games();
    const koth = g.modes.find(x => x.mode === 'koth')!;
    expect(koth.defaults.teams.map(x => x.tid).sort()).toEqual([1, 3]);
    expect(koth.defaults.teams.some(x => x.tid === 2)).toBe(false);
    expect(koth.defaults.station_source).toBe('grenade');
    // CONTROL: tid 2 is an ordinary team in a mode with no hill, and TDM still ships it.
    expect(g.modes.find(x => x.mode === 'tdm')!.defaults.teams.some(x => x.tid === 2)).toBe(true);
    g.m.unmount();
  });

  it('drops the grenade step when the operator switches to a mode with no hill', async () => {
    // CONTROL for the first test, and a real trap: the rail is fed from the CONFIG, so a stale
    // `station_source` left over from the previous game would keep telling a TDM operator to
    // power-cycle a grenade that is not in play.
    const g = await games();
    await g.m.click('KING OF THE HILL');
    await g.settle();
    expect(g.m.text()).toMatch(/POWER-CYCLE THE GRENADE/i);
    await g.m.click('TEAM DEATHMATCH');
    await g.settle();
    const t = g.m.text();
    expect(t).not.toMatch(/POWER-CYCLE THE GRENADE/i);
    expect(t).not.toMatch(/GRENADE HILL/);
    expect(t).toContain('SCORE CAP / TIME');
    g.m.unmount();
  });
});
