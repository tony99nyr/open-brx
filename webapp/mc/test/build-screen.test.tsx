// Polish round 1: BUILD (screens/Build.tsx) gets two fixes this round.
//
// H3: a `GET /api/pieces` failure that is not the older-console 404 used to leave `pieces` null for
// ever, with the shelf stuck on "LOADING..." and nothing an operator could do about it -- mirrors
// `Games.tsx`'s own `piecesError`/RETRY pair (test/play.test.tsx's "stale server" describe).
//
// M6: an unsaved BUILD edit used to block only BUILD's own back button and its kind tabs. Anything
// ELSE that called the store's `setView` (the CommandBar stepper, the menu) reached straight past it
// and silently discarded the edit. `store.tsx`'s `setView` now gates every caller the same way, off a
// `dirty` flag BUILD keeps synced; this proves the two pieces end to end, through a real CommandBar tap.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { CommandBar } from '../src/frame/CommandBar';
import { Build } from '../src/screens/Build';
import { StoreCtx, StoreProvider, useStore } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

describe('BUILD — H3: a real GET /api/pieces failure', () => {
  it('shows the error with a RETRY, never an endless LOADING…', async () => {
    const d = await demo();
    let calls = 0;
    const api = fixtureApi({ getPieces: async () => { calls++; if (calls === 1) throw new Error('socket reset'); return d.api.getPieces(); } }, d.api);
    const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'designer' }, { api });
    const m = await mount(<StoreCtx.Provider value={store}><Build /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="build-pieces-error"]').length).toBe(1);
    expect(m.text()).not.toContain('LOADING…');
    expect(m.text()).toContain('socket reset');
    await m.click('RETRY');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="build-pieces-error"]').length, 'RETRY must try again, and this time it lands').toBe(0);
    expect(calls).toBe(2);
    m.unmount();
  });

  it('review Low: does not flash while the console is known offline', async () => {
    const d = await demo();
    const api = fixtureApi({ getPieces: async () => { throw new Error('socket reset'); } }, d.api);
    const store = makeStore({ state: d.state, weapons: d.weapons, perks: d.perks, view: 'designer' }, { api, connected: false });
    const m = await mount(<StoreCtx.Provider value={store}><Build /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.find('[data-testid="build-pieces-error"]').length, 'offline is already said elsewhere -- this must stay quiet').toBe(0);
    m.unmount();
  });
});

/** Renders whichever screen the store's `view` currently names -- BUILD, or a stand-in for anything
 *  else, so a successful nav away from BUILD is provable (BUILD unmounts, the stand-in appears). */
function Screen() {
  const { view } = useStore();
  if (view === 'designer') return <Build />;
  return <div data-testid="other-screen">{view}</div>;
}

describe('round 2 (1): BUILD’s own ◂ BACK TO PLAY leaves on the SECOND tap, not a third', () => {
  it('confirming once actually leaves', async () => {
    history.replaceState(null, '', '/?mock#designer');
    const m = await mount(<StoreProvider><Screen /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });   // getPieces settles
    await m.click('LIFE');
    await m.click('NEW ▸');
    const nameInput = m.find('input[aria-label="preset name"]')[0] as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput, `${nameInput.value} TWO`);
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await m.click('◂ BACK TO PLAY');   // tap 1: BUILD's own local confirm
    expect(m.text(), 'tap 1 shows the confirm and stays put').toContain('UNSAVED CHANGES');
    expect(m.find('[data-testid="other-screen"]').length).toBe(0);
    await m.click('◂ BACK TO PLAY');   // tap 2: confirmed -- this used to still be blocked by the
                                       // store's OWN guard (dirty had not reached it yet) and need a third
    expect(m.find('[data-testid="other-screen"]').length, 'the second tap must actually leave').toBe(1);
    m.unmount();
  });
});

describe('M6 — an unsaved BUILD edit blocks navigation from OUTSIDE BUILD too', () => {
  it('the CommandBar stepper needs a second tap while an edit is unsaved, the same as BUILD’s own back button', async () => {
    history.replaceState(null, '', '/?mock#designer');
    const m = await mount(<StoreProvider><CommandBar /><Screen /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });   // getPieces settles
    // open a LIFE editor and dirty it (BUILD defaults to the read-only GAME MODE tab)
    await m.click('LIFE');
    await m.click('NEW ▸');
    const nameInput = m.find('input[aria-label="preset name"]')[0] as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput, `${nameInput.value} TWO`);
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // the CommandBar's own KIT tab, not BUILD's back button
    await m.click('KIT');
    expect(m.find('[data-testid="other-screen"]').length, 'a first tap while dirty must not navigate').toBe(0);
    expect(m.text()).toContain('UNSAVED CHANGES');
    await m.click('KIT');
    expect(m.find('[data-testid="other-screen"]').length, 'a second tap at the same target confirms it').toBe(1);
    m.unmount();
  });

  // Round 2 Low: a further edit after being blocked made the pending "tap again" stale -- it was a
  // confirm for the draft as it stood a MOMENT AGO, not for the one just typed.
  it('a further edit after being blocked clears the pending confirm, so KIT needs asking again', async () => {
    history.replaceState(null, '', '/?mock#designer');
    const m = await mount(<StoreProvider><CommandBar /><Screen /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('LIFE');
    await m.click('NEW ▸');
    const nameInput = m.find('input[aria-label="preset name"]')[0] as HTMLInputElement;
    const type = async (v: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput, v);
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await type('FIRST DRAFT');
    await m.click('KIT');   // blocked, navBlockedTo = 'kit'
    expect(m.find('[data-testid="other-screen"]').length).toBe(0);
    await type('SECOND DRAFT');   // a further edit -- the pending block is now stale
    await m.click('KIT');   // must re-block (not silently confirm off the STALE navBlockedTo)
    expect(m.find('[data-testid="other-screen"]').length, 'one tap after a further edit must not be enough').toBe(0);
    expect(m.text()).toContain('UNSAVED CHANGES');
    await m.click('KIT');   // now this really is the second tap
    expect(m.find('[data-testid="other-screen"]').length).toBe(1);
    m.unmount();
  });

  // Round 3 (2): the banner used to print the raw view id (MUSTER), not the label CommandBar itself
  // shows for that tab (ARMORY) -- a different vocabulary for the exact same target on the exact same
  // screen. 'muster'/ARMORY is the clearest case: 'kit' happens to equal its own label already.
  it('names the target using CommandBar’s OWN label (ARMORY), never the raw view id (MUSTER)', async () => {
    history.replaceState(null, '', '/?mock#designer');
    const m = await mount(<StoreProvider><CommandBar /><Screen /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('LIFE');
    await m.click('NEW ▸');
    const nameInput = m.find('input[aria-label="preset name"]')[0] as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput, `${nameInput.value} TWO`);
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await m.click('ARMORY');
    expect(m.text()).toContain('LEAVE FOR ARMORY');
    expect(m.text()).not.toContain('MUSTER');
    m.unmount();
  });

  // Round 3 (4): a draft keystroke must only invalidate a block IT could have caused (an operator's
  // own nav attempt) -- never one `followPhase` set. The banner names the phase; continuing to edit
  // must not make that warning vanish just because the operator kept typing.
  it('a draft keystroke does not clear a block that came from the SERVER’s phase advancing', async () => {
    history.replaceState(null, '', '/?mock#designer');
    const m = await mount(<StoreProvider><Screen /></StoreProvider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('LIFE');
    await m.click('NEW ▸');
    const nameInput = m.find('input[aria-label="preset name"]')[0] as HTMLInputElement;
    const type = async (v: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput, v);
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await type('DIRTY DRAFT');
    const api = (window as unknown as { __MC_MOCK__: { setPhase(p: string): Promise<unknown> } }).__MC_MOCK__;
    await act(async () => { await api.setPhase('kit'); });   // the server advances the phase, not an operator tap
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(m.text(), 'the phase-follow banner must be up').toContain('LEAVE FOR KIT');
    await type('DIRTY DRAFT, STILL EDITING');   // a further keystroke -- must NOT clear a follow-caused block
    expect(m.text(), 'a draft keystroke must not clear a block it did not cause').toContain('LEAVE FOR KIT');
    m.unmount();
  });
});

describe('BUILD — MEDIUM 3 (review): SAVE sends value only when it changed', () => {
  it('a name-only rename omits value from the request entirely', async () => {
    const d = await demo();
    const life = await d.api.createPiece({ kind: 'life', name: 'CUSTOM LIFE', value: { max_hp: 50, max_armor: 60, max_shield: 0 } });
    await d.api.pick({ pieces: { life: life.piece_id } });
    const calls: Array<{ name?: string; note?: string; value?: unknown }> = [];
    const api = fixtureApi({
      updatePiece: async (id: string, p: { name?: string; note?: string; value?: Record<string, unknown> }) => {
        calls.push(p);
        return d.api.updatePiece(id, p);
      },
    }, d.api);
    const state = await d.api.getState();
    const store = makeStore({ state, weapons: d.weapons, perks: d.perks, view: 'designer' }, { api });
    const m = await mount(<StoreCtx.Provider value={store}><Build /></StoreCtx.Provider>);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    await m.click('LIFE');
    await m.click('CUSTOM LIFE');
    const nameInput = m.find('input[aria-label="preset name"]')[0] as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput, 'RENAMED LIFE');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await m.click('SAVE ▸');
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(calls.length, 'exactly one save').toBe(1);
    expect('value' in calls[0], 'a name-only save must not send value at all').toBe(false);
    m.unmount();
  });
});
