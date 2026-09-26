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
});

/** Renders whichever screen the store's `view` currently names -- BUILD, or a stand-in for anything
 *  else, so a successful nav away from BUILD is provable (BUILD unmounts, the stand-in appears). */
function Screen() {
  const { view } = useStore();
  if (view === 'designer') return <Build />;
  return <div data-testid="other-screen">{view}</div>;
}

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
});
