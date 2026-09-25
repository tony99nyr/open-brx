// The DESIGNER objective source must show the config as it is. A config for an objective mode with no
// `station_source` is refused by the server ("needs a station/objective source"), so the control must
// not show PHONE as picked: the operator would believe the game is ready.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { Designer } from '../src/screens/Designer';
import { StoreCtx, type Store } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

async function designer(stationSource: string | undefined) {
  const d = await demo();
  const modes = await d.api.getModes();
  const koth = modes.find(m => m.mode === 'koth')!;
  const config = { ...koth.defaults, station_source: stationSource };
  const game = { id: 'g-test', name: 'TEST', desc: '', builtin: false, config };
  const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' },
    { api: fixtureApi({}, d.api), modes, designerSeed: { game } } as unknown as Partial<Store>);
  const m = await mount(<StoreCtx.Provider value={store}><Designer /></StoreCtx.Provider>);
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return m;
}

const pressed = (m: Awaited<ReturnType<typeof designer>>) => {
  const grp = m.find('[role="group"][aria-label="objective source"]')[0];
  return Array.from(grp.querySelectorAll('button')).filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent);
};

describe('DESIGNER objective source with no station_source', () => {
  it('picks no option and says one is needed', async () => {
    const m = await designer(undefined);
    expect(pressed(m)).toEqual([]);
    expect(m.text()).toMatch(/PICK AN OBJECTIVE SOURCE/);
    m.unmount();
  });
  it('control: a config with phone shows PHONE picked', async () => {
    const m = await designer('phone');
    expect(pressed(m)).toHaveLength(1);
    expect(m.text()).not.toMatch(/PICK AN OBJECTIVE SOURCE/);
    m.unmount();
  });
});
