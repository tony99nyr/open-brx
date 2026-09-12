// A27, the second round — what the console says while the SERVER is refusing, and what it does when
// the OVERRIDE is refused too (review 2026-09-12).
//
// Two defects, both on the same button, both visible only against a server that says no:
//
//  1. The button kept printing the CONSOLE's ready count while the server's refusal was on screen
//     under it: "CONTINUE ANYWAY · 9/9 READY" directly above "1 of 9 are not READY: ROCCO". The
//     console is arguing with the sentence it is quoting, and the operator has to decide which of the
//     two numbers to believe. The server's tally is the one that decided, so it is the one shown.
//
//  2. A 409 on the FORCED tap re-rendered the same line the unforced tap had produced — nothing on
//     screen said the override had been sent and turned down — and the 12 s expiry then disarmed the
//     button back to an UNFORCED tap, so the operator's next press repeated the first tap and could
//     never get through. Now the refused override says so, stays armed, and the next tap forces again.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Kit } from '../src/screens/Kit';
import type { PhaseRefusal, State } from '../src/api/types';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

/** Mount KIT against a server that refuses `kit -> lobby`. `always` refuses the forced tap too. */
async function kitScreen(refusal: PhaseRefusal, { always = false } = {}) {
  const d = await demo();
  const calls: (boolean | undefined)[] = [];
  const errors: string[] = [];
  const api = fixtureApi({
    setPhase: async (_phase: string, force?: boolean) => {
      calls.push(force);
      if (always || !force) {
        const e = new Error(refusal.error ?? 'refused') as Error & { status?: number; body?: unknown };
        e.status = 409; e.body = refusal;
        throw e;
      }
      return {};
    },
  });
  // the console's OWN roster looks green: every disagreement here is the server's to win
  const state: State = { ...d.state, players: d.state.players.map(p => ({ ...p, ready: true })) };
  const render = (s: State) => {
    const store = makeStore({ ...d, state: s, view: 'kit' }, {
      api,
      run: async fn => { try { return await fn(); } catch (e) { errors.push((e as Error).message); return undefined; } },
    });
    return <StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>;
  };
  const m = await mount(render(state));
  return Object.assign(m, {
    calls, errors, base: state,
    btn: () => m.find('[data-continue="kit"] button').slice(-1)[0],
    /** the next snapshot arrives, as a pushed WS frame would */
    push: (next: State) => m.update(render(next)),
  });
}

afterEach(() => { vi.useRealTimers(); });

describe("A27 · the button's count while the server is refusing", () => {
  it("prints the SERVER's tally, not the console's own", async () => {
    // 8 players, all of them ready as far as this console knows — so its own label would say 8/8.
    const m = await kitScreen({ error: '1 of 8 are not READY: ROCCO', not_ready: ['ROCCO'], greens: 7, roster_size: 8 });
    expect(m.btn().textContent, 'before the tap it is the console counting its own roster').toBe('CONTINUE · 8/8 READY ▸');
    await act(async () => { m.btn().click(); });
    expect(m.find('[data-continue-refusal]').length, 'the server refused').toBe(1);
    expect(m.btn().textContent).toBe('CONTINUE ANYWAY · 7/8 READY ▸');
    m.unmount();
  });

  it('says no number at all when the refusal carries none', async () => {
    // An older MC answers 409 with `error` and nothing else. A count is better left off than taken
    // from the roster the server has just contradicted.
    const m = await kitScreen({ error: 'THE LOBBY IS CLOSED' });
    await act(async () => { m.btn().click(); });
    expect(m.btn().textContent).toBe('CONTINUE ANYWAY ▸');
    m.unmount();
  });

  it('goes back to the console count once the refusal is cancelled', async () => {
    const m = await kitScreen({ error: 'NOT READY', not_ready: ['ROCCO'], greens: 7, roster_size: 8 });
    await act(async () => { m.btn().click(); });
    expect(m.btn().textContent).toBe('CONTINUE ANYWAY · 7/8 READY ▸');
    await m.click('CANCEL');
    expect(m.btn().textContent).toBe('CONTINUE · 8/8 READY ▸');
    m.unmount();
  });
});

describe('A27 · a refused OVERRIDE', () => {
  it('says the override itself was refused, not the same sentence again', async () => {
    const m = await kitScreen({ error: 'THE LOBBY IS CLOSED', greens: 8, roster_size: 8 }, { always: true });
    await act(async () => { m.btn().click(); });                     // refused, unforced
    const first = m.find('[data-continue-refusal]')[0];
    expect(first.getAttribute('data-override-refused')).toBe('0');
    expect(first.textContent).toBe('THE LOBBY IS CLOSED — CONTINUE ANYWAY?');

    await act(async () => { m.btn().click(); });                     // refused, FORCED
    expect(m.calls).toEqual([undefined, true]);
    const second = m.find('[data-continue-refusal]')[0];
    expect(second.getAttribute('data-override-refused'), 'the forced tap was refused and the screen says so').toBe('1');
    expect(second.textContent).toBe('MC REFUSED THE OVERRIDE — THE LOBBY IS CLOSED');
    m.unmount();
  });

  it('stays armed through the 12 s expiry, so the next tap forces again', async () => {
    vi.useFakeTimers();
    const m = await kitScreen({ error: 'THE LOBBY IS CLOSED' }, { always: true });
    await act(async () => { m.btn().click(); });
    await act(async () => { m.btn().click(); });
    expect(m.calls).toEqual([undefined, true]);
    // the ordinary confirm expires after 12 s; a refused override must NOT, or the next press is the
    // first tap of the two-tap gate again and the operator can never get through
    await act(async () => { await vi.advanceTimersByTimeAsync(13_000); });
    expect(m.find('[data-continue-refusal]').length, 'the refusal is still on screen').toBe(1);
    await act(async () => { m.btn().click(); });
    expect(m.calls, 'the third tap re-forces rather than starting over').toEqual([undefined, true, true]);
    m.unmount();
  });

  it('a roster that goes green takes the refusal and its frozen count with it', async () => {
    // THE STALE LINE (round-2 review 2026-09-12). A refused override never expires — deliberately,
    // so the next tap can force again — and it used to be cleared only when the set of UNREADY
    // NAMES changed. In the case the A27 guard exists for that set is empty on both sides of the
    // event: the console already reads its own roster as green, and the player the SERVER is
    // holding out for is one this console has not seen yet. So when ROCCO finally arrived, readied,
    // the sentence "1 of 9 are not READY: ROCCO" and its 8/9 count stayed on a screen where every
    // player was green, with no tap that could clear it.
    const m = await kitScreen({ error: '1 of 9 are not READY: ROCCO', not_ready: ['ROCCO'], greens: 8, roster_size: 9 }, { always: true });
    await act(async () => { m.btn().click(); });                     // refused
    await act(async () => { m.btn().click(); });                     // override refused: no expiry
    expect(m.find('[data-continue-refusal]')[0].getAttribute('data-override-refused')).toBe('1');
    expect(m.btn().textContent, "the server's tally while it is refusing").toBe('CONTINUE ANYWAY · 8/9 READY ▸');

    // the snapshot catches up: ROCCO is on the roster, and ready
    const rocco = { ...m.base.players[0], player_id: 'rocco', player_num: 99, display: 'ROCCO', ready: true };
    await m.push({ ...m.base, players: [...m.base.players, rocco] });
    expect(m.find('[data-continue-refusal]').length, 'the refusal described a roster that no longer exists').toBe(0);
    expect(m.btn().textContent, 'and the count is the console\'s own again').toBe('CONTINUE · 9/9 READY ▸');
    expect(m.calls, 'nothing was sent by the snapshot arriving').toEqual([undefined, true]);
    m.unmount();
  });

  it('but a snapshot that changes nothing about the roster leaves it alone', async () => {
    // The control. Snapshots arrive ~4x a second; if any of them cleared the refusal the operator
    // would never get to read it, let alone answer it.
    const m = await kitScreen({ error: 'THE LOBBY IS CLOSED', greens: 8, roster_size: 8 }, { always: true });
    await act(async () => { m.btn().click(); });
    await act(async () => { m.btn().click(); });
    await m.push({ ...m.base, t: m.base.t + 250 });
    expect(m.find('[data-continue-refusal]')[0].textContent).toBe('MC REFUSED THE OVERRIDE — THE LOBBY IS CLOSED');
    m.unmount();
  });

  it('the ordinary refusal still expires on its own', async () => {
    vi.useFakeTimers();
    const m = await kitScreen({ error: 'NOT READY', not_ready: ['ROCCO'] });
    await act(async () => { m.btn().click(); });
    expect(m.find('[data-continue-refusal]').length).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(13_000); });
    expect(m.find('[data-continue-refusal]').length, 'an armed warning left on screen is a trap').toBe(0);
    expect(m.btn().textContent).toBe('CONTINUE · 8/8 READY ▸');
    m.unmount();
  });
});
