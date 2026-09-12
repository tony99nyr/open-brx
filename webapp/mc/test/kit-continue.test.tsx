// F127 (field 2026-09-11): "if MC hits continue and goes to lobby it messes with everyone actively
// kitting. Seems fine to MC but locks everyone out. There should be a warning and a status of how
// many people readied."
//
// KIT's CONTINUE fired a bare `api.setPhase('lobby')`, which skips MC's own rule (`state.py`
// `_all_ready`, contracts §4.4: "kit → lobby advances only when EVERY rostered player is ready") —
// and the phone follows the phase, so every player still choosing a loadout lost the screen out
// from under them with nothing said on either side.
//
// These are the screen-truth assertions for the fix: the count is ON the button, a short roster
// takes two taps and the first one NAMES who it would strand, and a full roster still takes one.
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createHttpApi } from '../src/api/client';
import type { Player, State } from '../src/api/types';
import { Kit } from '../src/screens/Kit';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount, type Mounted } from './harness';

interface Kitted extends Mounted {
  phases: string[];
  views: string[];
  /** the fixture snapshot this mounted against */
  base: State;
  /** re-render the same tree against a changed snapshot, as a pushed WS frame would */
  push(next: State): Promise<void>;
}

/** Mount KIT with every `setPhase` and every view change recorded. */
async function kitScreen(mutate: (s: State) => State = s => s, opts: { failPhase?: string; voidPhase?: boolean } = {}): Promise<Kitted> {
  const d = await demo();
  const phases: string[] = [];
  const views: string[] = [];
  const api = fixtureApi({
    setPhase: async (p: string) => {
      phases.push(p);
      if (opts.failPhase) throw new Error(opts.failPhase);
      return opts.voidPhase ? undefined : {};   // `voidPhase`: a 204, or any api that does not echo the phase
    },
  });
  const render = (s: State) => {
    const store = makeStore({ ...d, state: s, view: 'kit', selPlayer: 'p1' }, { api, setView: v => views.push(v) });
    return <StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>;
  };
  const m = await mount(render(mutate(d.state)));
  return Object.assign(m, { phases, views, base: d.state, push: (next: State) => m.update(render(next)) });
}

const allReady = (s: State): State => ({ ...s, players: s.players.map(p => ({ ...p, ready: true })) });
/** a server that does not send `ready` at all (older MC / a foreign snapshot) */
const noReadyField = (s: State): State => ({
  ...s,
  players: s.players.map(p => { const { ready: _drop, ...rest } = p; return rest as Player; }),
});
/** the button, whatever state it is in */
const btn = (m: Mounted) => m.find('[data-continue="kit"] button').slice(-1)[0];
/** the visible consequence line: it must NAME the players and say what the tap costs them */
const WARN = 'SABLE, DRIFT ARE STILL KITTING AND WILL LOSE THEIR SCREEN — CONTINUE ANYWAY?';
/** ready everyone EXCEPT these callsigns */
const unReadyOnly = (names: string[]) => (s: State): State => ({ ...s, players: s.players.map(p => ({ ...p, ready: !names.includes(p.display.toUpperCase()) })) });
/** un-ready the two the demo roster starts short of */
const unReady = unReadyOnly(['SABLE', 'DRIFT']);

describe('KIT · CONTINUE to lobby (F127)', () => {
  it('the button carries the live ready count', async () => {
    const m = await kitScreen();      // demo roster: 8 players, SABLE and DRIFT not ready
    expect(m.text()).toContain('CONTINUE · 6/8 READY');
    m.unmount();
  });

  it('with a player still kitting the first tap advances nothing and names who is waiting', async () => {
    const m = await kitScreen();
    await act(async () => { btn(m).click(); });
    expect(m.phases, 'the first tap must not move the phase').toEqual([]);
    expect(m.views, 'the first tap must not leave KIT').toEqual([]);
    expect(m.text(), 'the warning names them AND says what it costs them').toContain(WARN);
    // the count stays on the armed label: the strip's other number is KITTED, a different tally
    expect(btn(m).textContent).toBe('CONTINUE ANYWAY · 6/8 READY ▸');
    m.unmount();
  });

  it('the second tap advances', async () => {
    const m = await kitScreen();
    await act(async () => { btn(m).click(); });
    await act(async () => { btn(m).click(); });
    expect(m.phases).toEqual(['lobby']);
    expect(m.views).toEqual(['lobby']);
    m.unmount();
  });

  it('CANCEL disarms the confirm, and the next tap arms it again instead of advancing', async () => {
    const m = await kitScreen();
    await act(async () => { btn(m).click(); });
    await m.click('CANCEL');
    expect(m.text()).not.toContain('STILL KITTING');
    expect(btn(m).textContent, 'CANCEL restores the resting label').toBe('CONTINUE · 6/8 READY ▸');
    await act(async () => { btn(m).click(); });
    expect(m.phases, 'a tap after CANCEL re-arms, it does not advance').toEqual([]);
    expect(m.text()).toContain(WARN);
    m.unmount();
  });

  it('with every player ready one tap advances', async () => {
    const m = await kitScreen(allReady);
    expect(m.text()).toContain('CONTINUE · 8/8 READY');
    await act(async () => { btn(m).click(); });
    expect(m.phases).toEqual(['lobby']);
    expect(m.views).toEqual(['lobby']);
    expect(m.text()).not.toContain('STILL KITTING');
    m.unmount();
  });

  it('a snapshot that makes everyone ready disarms an armed confirm', async () => {
    const m = await kitScreen();
    await act(async () => { btn(m).click(); });
    expect(m.text()).toContain('STILL KITTING');
    await m.push(allReady(m.base));
    expect(m.text()).not.toContain('STILL KITTING');
    expect(m.text()).toContain('CONTINUE · 8/8 READY');
    await act(async () => { btn(m).click(); });
    expect(m.phases, 'the disarmed button must not still be a second tap').toEqual(['lobby']);
    m.unmount();
  });

  // The confirm is DERIVED from the armed-for name set, which used to hide it without forgetting it:
  // arm on SABLE|DRIFT, let both ready up, let both go un-ready again, and the warning came back with
  // no tap — so the operator's FIRST tap was the second tap, and everyone still kitting lost the
  // screen. That is F127 itself, one snapshot later.
  it('the same roster blocking AGAIN comes back disarmed, not pre-armed', async () => {
    const m = await kitScreen();
    await act(async () => { btn(m).click(); });          // armed on SABLE|DRIFT
    expect(m.text()).toContain(WARN);
    await m.push(allReady(m.base));                       // both ready up -> not blocked
    expect(m.text()).not.toContain('STILL KITTING');
    await m.push(unReady(m.base));                        // ...and both go un-ready again
    expect(m.text(), 'a re-blocked roster must NOT arrive already armed').not.toContain('STILL KITTING');
    expect(btn(m).textContent).toBe('CONTINUE · 6/8 READY ▸');
    await act(async () => { btn(m).click(); });
    expect(m.phases, 'the first tap after re-blocking must arm, not advance').toEqual([]);
    expect(m.views).toEqual([]);
    expect(m.text()).toContain(WARN);
    m.unmount();
  });

  // Round-2 review 2026-09-12: forgetting the armed-for set only when the roster stops BLOCKING left it
  // behind through every roster that was still blocked by somebody else — the commonest shape there is,
  // because players ready up one at a time. The confirm hid, the set survived, and the moment the original
  // names came back the button was live again with no tap.
  it('one of the two readying up forgets the armed set — it does not just hide it', async () => {
    const m = await kitScreen();
    await act(async () => { btn(m).click(); });          // armed on SABLE|DRIFT
    expect(m.text()).toContain(WARN);
    await m.push(unReadyOnly(['DRIFT'])(m.base));         // SABLE readies: STILL blocked, now by DRIFT alone
    expect(m.text(), 'the confirm was armed for SABLE|DRIFT, and that is no longer who it would strand').not.toContain('STILL KITTING');
    expect(btn(m).textContent).toBe('CONTINUE · 7/8 READY ▸');
    await m.push(unReady(m.base));                        // ...and SABLE drops back out
    expect(m.text(), 'the old set must have been FORGOTTEN, not hidden behind a blocked roster').not.toContain('STILL KITTING');
    expect(btn(m).textContent).toBe('CONTINUE · 6/8 READY ▸');
    await act(async () => { btn(m).click(); });
    expect(m.phases, 'the first tap on the re-blocked roster must arm, not advance').toEqual([]);
    expect(m.views).toEqual([]);
    expect(m.text()).toContain(WARN);
    m.unmount();
  });

  // `run()` hands back undefined on a THROW and the call's own value otherwise, so a phase change whose
  // body is empty read as a refusal: the phase moved on the server, the console stayed on KIT, and the
  // error strip had nothing to say about it.
  it('a setPhase that resolves nothing still advances — only a THROW is a refusal', async () => {
    const m = await kitScreen(allReady, { voidPhase: true });
    await act(async () => { btn(m).click(); });
    expect(m.phases).toEqual(['lobby']);
    expect(m.views, 'an empty body is a successful phase change, not a refusal').toEqual(['lobby']);
    m.unmount();
  });

  it('and the real client never hands a 204 back as `undefined` in the first place', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 204, statusText: 'No Content',
      json: async () => { throw new SyntaxError('no body'); },
    }));
    try {
      const r = await createHttpApi().setPhase('lobby');
      expect(r, '`undefined` is how `store.run` reports a FAILED call — a 204 must never look like one').not.toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });

  it('a server that does not send `ready`: a plain CONTINUE, a readiness-unknown hint, and one tap', async () => {
    const m = await kitScreen(noReadyField);
    expect(m.text()).toContain('READINESS UNKNOWN');
    expect(m.text()).not.toContain('READY ▸');
    await act(async () => { btn(m).click(); });
    expect(m.phases).toEqual(['lobby']);
    m.unmount();
  });

  it('an empty roster renders a plain CONTINUE and no hint (nobody to strand)', async () => {
    const m = await kitScreen(s => ({ ...s, players: [] }));
    expect(m.text()).toContain('CONTINUE ▸');
    expect(m.text()).not.toContain('READINESS UNKNOWN');
    m.unmount();
  });

  it('a refused setPhase does not navigate (the error strip is the store\'s job)', async () => {
    const m = await kitScreen(allReady, { failPhase: 'phase kit -> lobby refused' });
    await act(async () => { btn(m).click(); });
    expect(m.phases).toEqual(['lobby']);
    expect(m.views, 'a 400 must not navigate').toEqual([]);
    m.unmount();
  });
});
