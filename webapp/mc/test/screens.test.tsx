// Every MC screen must RENDER — with a full session, and with a starved one.
//
// The black ARSENAL page (`PH[-1][1]`) shipped because nothing ever mounted that screen outside a
// browser a human was looking at. These tests are the floor: mount all nine, twice.
import { describe, expect, it } from 'vitest';
import { Armed } from '../src/screens/Armed';
import { Armory } from '../src/screens/Armory';
import { Catalog } from '../src/screens/Catalog';
import { Designer } from '../src/screens/Designer';
import { Games } from '../src/screens/Games';
import { Kit } from '../src/screens/Kit';
import { Live } from '../src/screens/Live';
import { Lobby } from '../src/screens/Lobby';
import { Recap } from '../src/screens/Recap';
import { CommandBar } from '../src/frame/CommandBar';
import { demo, makeStore, mount, mountScreen, starved } from './harness';
import { StoreCtx } from '../src/store';
import type { View } from '../src/store';

const SCREENS: [string, View, () => React.ReactElement][] = [
  ['muster', 'muster', () => <Armory />],
  ['build', 'build', () => <Games />],
  ['designer', 'designer', () => <Designer />],
  ['catalog', 'catalog', () => <Catalog />],
  ['kit', 'kit', () => <Kit />],
  ['lobby', 'lobby', () => <Lobby />],
  ['armed', 'armed', () => <Armed />],
  ['live', 'live', () => <Live />],
  ['recap', 'recap', () => <Recap />],
  ['command bar', 'muster', () => <CommandBar />],
];

describe('every screen renders', () => {
  it.each(SCREENS)('%s · with a full session', async (_name, view, make) => {
    const d = await demo();
    const m = await mountScreen(make(), { ...d, view });
    expect(m.text().length).toBeGreaterThan(0);
    m.unmount();
  });

  it.each(SCREENS)('%s · with an empty session and an empty catalog', async (_name, view, make) => {
    // no players, no nodes, no teams, no catalog: a server that just booted. Every screen has to say
    // something rather than throw — several of these index [0] or [-1] into a list.
    const d = await demo();
    const m = await mountScreen(make(), { state: starved(d.state), weapons: [], perks: [], view });
    expect(m.text().length).toBeGreaterThan(0);
    m.unmount();
  });

  it.each(SCREENS)('%s · mounts with no snapshot, then renders when one arrives', async (_name, view, make) => {
    // The rules-of-hooks class, for every screen. A hook called BELOW an `if (!state) return null`
    // makes the render that first receives a snapshot run more hooks than the one before it, and
    // React throws "rendered more hooks than during the previous render" — which is a blank console.
    //
    // This has to RE-RENDER the same tree with a fuller store, not swap it for something else:
    // rendering `<div/>` unmounts the screen instead, so React never compares the two hook lists and
    // the test passes against a screen that is broken (review 2026-09-01 — verified by injecting a
    // hook below Live.tsx's early return, which this now catches and the old shape did not).
    const d = await demo();
    const empty = makeStore({ state: null, weapons: d.weapons, perks: d.perks, view });
    const full = makeStore({ ...d, view });
    const m = await mount(<StoreCtx.Provider value={empty}>{make()}</StoreCtx.Provider>);
    await m.update(<StoreCtx.Provider value={full}>{make()}</StoreCtx.Provider>);
    expect(m.text().length, 'the screen must render once it has a snapshot').toBeGreaterThan(0);
    m.unmount();
  });
});

describe('a screen that gets its snapshot late still works', () => {
  it('kit renders its own content, not just something', async () => {
    // the parameterised case above proves no screen THROWS; this one proves KIT actually arrives
    const d = await demo();
    const empty = makeStore({ state: null, weapons: d.weapons, perks: d.perks, view: 'kit' });
    const full = makeStore({ ...d, view: 'kit' });
    const m = await mount(<StoreCtx.Provider value={empty}><Kit /></StoreCtx.Provider>);
    await m.update(<StoreCtx.Provider value={full}><Kit /></StoreCtx.Provider>);
    expect(m.text()).toContain('KIT');
    m.unmount();
  });
});
