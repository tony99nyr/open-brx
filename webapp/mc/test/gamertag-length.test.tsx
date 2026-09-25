// F366 (Tony 2026-09-25, "366 sounds good"): a gamertag is at most 16 characters and MC refuses a longer one, never
// cutting it; from 13 to 16 the console warns that the phone HUD may shorten it. The server half is
// `mcp/tests/test_gamertag_length.py`; both numbers come from the generated contract.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { MAX_TAG_LEN, SOFT_TAG_LEN } from '../src/api/contract.gen';
import { Armory } from '../src/screens/Armory';
import { Kit } from '../src/screens/Kit';
import { MockBackend } from '../src/mock/backend';
import type { State } from '../src/api/types';
import { StoreCtx } from '../src/store';
import { demo, makeStore, mountScreen } from './harness';

async function typeInto(input: HTMLInputElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const hint = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

const worn = { node_id: 'node_91C2', node_type: 'companion', gun_name: 'GUN-B-91C2', gun_tail: '91C2', arm_state: 'kitted', last_seen_ms: 300, synced: true } as unknown as State['nodes'][number];

describe('F366 gamertag length', () => {
  it('the limits are 16 and 12', () => { expect([MAX_TAG_LEN, SOFT_TAG_LEN]).toEqual([16, 12]); });

  it('the mock refuses a long tag on add and on rename, as state.py does, and keeps one at the limit whole', async () => {
    const b = new MockBackend();
    await expect(b.addPlayer({ display: 'x'.repeat(17) })).rejects.toThrow(/17 characters: 16 is the most/);
    const p = await b.addPlayer({ display: 'y'.repeat(16) });
    expect(p.display).toBe('Y'.repeat(16));
    await expect(b.patchPlayer(p.player_id, { display: 'z'.repeat(20) })).rejects.toThrow(/16 is the most/);
    expect((await b.getState()).players.find(x => x.player_id === p.player_id)!.display).toBe('Y'.repeat(16));
  });

  it('ARMORY claim: nothing up to 12, a warning at 13, the refusal and no submit at 17', async () => {
    const d = await demo();
    const state: State = { ...d.state, players: d.state.players.filter(p => p.gun_id !== 'GUN-B'), standby: [], nodes: [worn] };
    const calls: unknown[] = [];
    const m = await mountScreen(<Armory />, { ...d, state, view: 'muster', api: { addPlayer: async p => { calls.push(p); throw new Error('stop'); } } });
    const card = m.find('[data-node-card="node_91C2"]')[0];
    const input = card.querySelector('form input') as HTMLInputElement;
    const submit = card.querySelector('form button') as HTMLButtonElement;
    await typeInto(input, 'a'.repeat(12));
    expect(hint(card, 'claim-tag-hint')).toBeNull();
    await typeInto(input, 'a'.repeat(13));
    expect(hint(card, 'claim-tag-hint')!.textContent).toMatch(/13 OF 16 CHARACTERS: MAY BE SHORTENED ON THE PHONE HUD/);
    expect(submit.disabled).toBe(false);
    await typeInto(input, 'a'.repeat(17));
    expect(hint(card, 'claim-tag-hint')!.textContent).toMatch(/17 OF 16 CHARACTERS/);
    expect(hint(card, 'claim-tag-hint')!.getAttribute('aria-live'), 'announced politely, not on every keystroke as an alert').toBe('polite');
    expect(submit.disabled, 'a tag over the limit cannot be sent').toBe(true);
    expect(input.value, 'the input never cuts what was typed').toBe('a'.repeat(17));
    await act(async () => { (card.querySelector('form') as HTMLFormElement).requestSubmit(); });
    expect(calls).toEqual([]);
    m.unmount();
  });

  it('KIT: a stored tag over the limit shows the refusal on its rename field until it is renamed', async () => {
    const d = await demo();
    const long = 'Q'.repeat(20);                        // as an MC before F366 could store (it cut at 24)
    const state: State = { ...d.state, players: d.state.players.map(p => p.player_id === 'p1' ? { ...p, display: long } : p) };
    const patches: unknown[] = [];
    const m = await mountScreen(<Kit />, { ...d, state, view: 'kit', selPlayer: 'p1', api: { patchPlayer: async (_id, p) => { patches.push(p); return state.players[0]; } } });
    expect(hint(document, 'rename-tag-hint')!.textContent).toMatch(/20 OF 16 CHARACTERS/);
    const field = m.find('input[aria-label="operator callsign"]')[0] as HTMLInputElement;
    // a rename still over the limit is kept on screen, not sent
    await act(async () => { field.focus(); });
    await typeInto(field, 'R'.repeat(18));
    await act(async () => { field.blur(); });
    expect(patches).toEqual([]);
    expect(field.value).toBe('R'.repeat(18));
    // CONTROL: a rename within the limit is sent, and its hint goes
    await act(async () => { field.focus(); });
    await typeInto(field, 'ROCCO');
    expect(hint(document, 'rename-tag-hint')).toBeNull();
    await act(async () => { field.blur(); });
    expect(patches).toEqual([{ display: 'ROCCO' }]);
    m.unmount();
  });

  it('KIT: a refused draft does not follow the operator to another player and back', async () => {
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, view: 'kit', selPlayer: 'p1', api: { patchPlayer: async () => d.state.players[0] } });
    const field = () => m.find('input[aria-label="operator callsign"]')[0] as HTMLInputElement;
    await act(async () => { field().focus(); });
    await typeInto(field(), 'R'.repeat(18));
    expect(hint(document, 'rename-tag-hint')!.textContent).toMatch(/18 OF 16/);
    const fx = { ...d, view: 'kit' as const, api: { patchPlayer: async () => d.state.players[0] } };
    await m.update(<StoreCtx.Provider value={makeStore({ ...fx, selPlayer: 'p2' })}><Kit /></StoreCtx.Provider>);
    await m.update(<StoreCtx.Provider value={makeStore({ ...fx, selPlayer: 'p1' })}><Kit /></StoreCtx.Provider>);
    expect(field().value, 'the field is back on the stored name').toBe(d.state.players.find(p => p.player_id === 'p1')!.display);
    expect(hint(document, 'rename-tag-hint'), 'and the stale refusal is gone').toBeNull();
    m.unmount();
  });

  it('KIT add: ADD is disabled past the limit', async () => {
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, view: 'kit' });
    const input = m.find('input[aria-label="new operator callsign"]')[0] as HTMLInputElement;
    await typeInto(input, 'b'.repeat(17));
    expect(hint(document, 'add-tag-hint')!.textContent).toMatch(/17 OF 16/);
    const add = Array.from(input.closest('form')!.querySelectorAll('button')).find(b => b.textContent === 'ADD') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    m.unmount();
  });
});
