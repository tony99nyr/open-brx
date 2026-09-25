// F343(a): the ITEMS id pre-fill. An unarmed station reports station_id 0, and the API refuses 0, so the
// card starts from a free id. It used to count only ASSIGNED stations, once at mount, so two unarmed
// stations both started at 1 and the second ASSIGN + ARM was refused as a clash.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { MockBackend } from '../src/mock/backend';
import { StoreCtx } from '../src/store';
import { makeStore, mount } from './harness';
import type { State, StationView } from '../src/api/types';

async function base() {
  const st = await new MockBackend().getState();
  const proto = st.stations![0];
  const unarmed = (node_id: string): StationView =>
    ({ ...proto, node_id, assigned: null, armed: null, arm_pending: false, attention: [], report: { ...proto.report, station_id: 0 } });
  return { st, proto, unarmed };
}
const render = (state: State) => (<StoreCtx.Provider value={makeStore({ state, view: 'muster' })}><Armory /></StoreCtx.Provider>);
const idBox = (m: Awaited<ReturnType<typeof mount>>, node: string) =>
  m.find(`input[aria-label="station id for ${node}"]`)[0] as HTMLInputElement;

describe('F343(a): the next free station id', () => {
  it('two unarmed stations start at different ids, and skip an id another station reports', async () => {
    const { st, proto, unarmed } = await base();
    const reporting: StationView = { ...proto, node_id: 'util-rep', assigned: null, armed: null, attention: [], report: { ...proto.report, station_id: 1 } };
    const m = await mount(render({ ...st, stations: [reporting, unarmed('util-x'), unarmed('util-y')] }));
    expect(idBox(m, 'util-rep').value, 'control: a reported id is kept as the draft').toBe('1');
    expect(idBox(m, 'util-x').value).toBe('2');
    expect(idBox(m, 'util-y').value, 'the second unarmed station must not start on the first one\'s id').toBe('3');
    m.unmount();
  });

  it('re-derives on a new snapshot until the host edits the id, then keeps the edit', async () => {
    const { st, proto, unarmed } = await base();
    const m = await mount(render({ ...st, stations: [unarmed('util-x')] }));
    expect(idBox(m, 'util-x').value).toBe('1');
    const taken: StationView = { ...proto, node_id: 'util-t', assigned: { kind: 'respawn', team: 1, id: 1, threshold: 0, at: 5 }, armed: null, attention: [] };
    await m.update(render({ ...st, stations: [unarmed('util-x'), taken] }));
    expect(idBox(m, 'util-x').value, 'another station took id 1 after this card mounted').toBe('2');
    await act(async () => {
      const el = idBox(m, 'util-x');
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '42');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.blur();
    });
    expect(idBox(m, 'util-x').value).toBe('42');
    await m.update(render({ ...st, stations: [unarmed('util-x'), { ...taken, assigned: { ...taken.assigned!, id: 2 } }] }));
    expect(idBox(m, 'util-x').value, 'an unrelated update must not reset the host\'s edit').toBe('42');
    m.unmount();
  });
  it('a new unassigned station joining ahead of the others never moves their ids', async () => {
    const { st, unarmed } = await base();
    const m = await mount(render({ ...st, stations: [unarmed('util-x'), unarmed('util-y')] }));
    expect(idBox(m, 'util-x').value).toBe('1');
    expect(idBox(m, 'util-y').value).toBe('2');
    await m.update(render({ ...st, stations: [unarmed('util-a'), unarmed('util-x'), unarmed('util-y')] }));
    expect(idBox(m, 'util-x').value, 'an unrelated station joined: this card must keep its id').toBe('1');
    expect(idBox(m, 'util-y').value).toBe('2');
    expect(idBox(m, 'util-a').value, 'the newcomer takes the next free id').toBe('3');
    await m.update(render({ ...st, stations: [unarmed('util-a'), unarmed('util-y')] }));
    expect(idBox(m, 'util-y').value, 'and a station leaving does not move it either').toBe('2');
    expect(idBox(m, 'util-a').value).toBe('3');
    m.unmount();
  });
});
