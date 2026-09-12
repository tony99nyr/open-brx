// A25 — background log sync, on the operator's screen.
//
// "game sync has priority. once that is completed, we should ask MC if ready and we should safely
// patiently background sync for the game logs. maybe an option on MC for this. For almost all of my
// games I'm going to want the logs from all phones." (Tony, game test 2026-09-11, D6.)
//
// Two controls: a session-wide LOG SYNC switch (auto = MC asks on its own at the recap, on an offer
// and on a reconnect; manual = only the operator asks), and a per-node LOGS button that is never
// gated. The board shows what the PHONE says it holds — MC asking does not change the state, because
// the phone answers when it is safe to and MC never waits on it.
//
// The load-bearing assertions are the ones about ABSENCE: an older server sends no `options` and no
// `log`, and the console must then render no switch at all rather than one that writes to a route
// that is not there.
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { CommandBar } from '../src/frame/CommandBar';
import { clearNotice } from '../src/notice';
import type { LogView, NodeView, State } from '../src/api/types';
import { demo, fixtureApi, makeStore, mount, mountScreen } from './harness';
import { StoreCtx } from '../src/store';

/** Set every node's log to `log`, or REMOVE the field entirely when it is undefined — "the server sent
 *  no `log` at all" is its own case and must not fall through to whatever the demo seeded. */
const withLogs = (s: State, log: LogView | undefined): State => ({
  ...s,
  nodes: s.nodes.map(n => {
    if (log) return { ...n, log } as NodeView;
    const { log: _drop, ...rest } = n;
    void _drop;
    return rest as NodeView;
  }),
});

describe('A25 · the LOG SYNC switch', () => {
  it('renders the current mode when the server sends the option table', async () => {
    const d = await demo();
    const state: State = { ...d.state, options: { log_sync: 'auto' } };
    const m = await mountScreen(<Armory />, { ...d, state, view: 'muster' });
    const sw = m.find('[data-logsync]')[0];
    expect(sw, 'the LOG SYNC control is on the muster header').toBeTruthy();
    expect(sw.getAttribute('data-logsync')).toBe('auto');
    expect(m.text()).toContain('LOG SYNC');
    m.unmount();
  });

  it('writes the other mode when the operator picks it', async () => {
    const d = await demo();
    const sent: { log_sync?: string }[] = [];
    const api = fixtureApi({ setOptions: async o => { sent.push(o); return o; } });
    const state: State = { ...d.state, options: { log_sync: 'auto' } };
    const store = makeStore({ ...d, state, view: 'muster' }, { api });
    const m = await mount(<StoreCtx.Provider value={store}><Armory /></StoreCtx.Provider>);
    await m.click('MANUAL');
    expect(sent).toEqual([{ log_sync: 'manual' }]);
    m.unmount();
  });

  it('is absent entirely on a server with no option table', async () => {
    const d = await demo();
    const state: State = { ...d.state, options: undefined };
    const m = await mountScreen(<Armory />, { ...d, state, view: 'muster' });
    expect(m.find('[data-logsync]').length).toBe(0);
    expect(m.text()).not.toContain('LOG SYNC');
    m.unmount();
  });

  it('says what AUTO means, so the switch is not a mystery', async () => {
    const d = await demo();
    const state: State = { ...d.state, options: { log_sync: 'auto' } };
    const m = await mountScreen(<Armory />, { ...d, state, view: 'muster' });
    const sw = m.find('[data-logsync]')[0];
    expect((sw.getAttribute('title') ?? '').toLowerCase()).toMatch(/recap|reconnect|on its own/);
    m.unmount();
  });
});

describe("A25 · what each phone says it holds", () => {
  const state = (log: LogView | undefined) => demo().then(d => ({ d, s: withLogs(d.state, log) }));

  it.each([
    ['offered', /READY TO SEND/],
    ['pulling', /SENDING/],
    ['held', /HOLDING/],
    ['complete', /DELIVERED/],
  ])('a %s log reads as something an operator can act on', async (st, want) => {
    const { d, s } = await state({ state: st as LogView['state'], last_t: 1_000 });
    const m = await mountScreen(<Armory />, { ...d, state: s, view: 'muster' });
    // scoped to the node card: the readiness gun cards carry their OWN log row, from the readiness
    // board, and they come first in the DOM
    const cell = m.find('[data-node-card] [data-log-state]')[0];
    expect(cell, 'the node card carries a log row').toBeTruthy();
    expect(cell.getAttribute('data-log-state')).toBe(st);
    expect(cell.textContent ?? '').toMatch(want);
    m.unmount();
  });

  it("shows the node's own reason verbatim", async () => {
    const { d, s } = await state({ state: 'held', reason: '2 facts pending', last_t: 1_000 });
    const m = await mountScreen(<Armory />, { ...d, state: s, view: 'muster' });
    expect(m.find('[data-node-card] [data-log-state]')[0].textContent).toContain('2 facts pending');
    m.unmount();
  });

  it('is on the per-player readiness card too, from the readiness row', async () => {
    const d = await demo();
    const state: State = {
      ...d.state,
      readiness: { ...d.state.readiness, board: d.state.readiness.board.map(b => ({ ...b, log: { state: 'held' as const, reason: '2 facts pending', last_t: 1_000 } })) },
    };
    const m = await mountScreen(<Armory />, { ...d, state, view: 'muster' });
    // every LINKED gun card carries one; the node cards keep their own, unchanged
    const held = m.find('[data-log-state="held"]').filter(el => !el.closest('[data-node-card]'));
    expect(held.length).toBeGreaterThan(1);
    expect(held[0].textContent).toContain('2 facts pending');
    m.unmount();
  });

  it('renders a node that has said nothing about its log at all', async () => {
    const { d, s } = await state(undefined);
    const m = await mountScreen(<Armory />, { ...d, state: s, view: 'muster' });
    const cell = m.find('[data-node-card] [data-log-state]')[0];
    expect(cell.getAttribute('data-log-state')).toBe('none');
    expect(cell.textContent).toMatch(/NOTHING OFFERED|—/);
    m.unmount();
  });
});

describe('A25 · the LOGS button', () => {
  /** The COMMAND BAR is mounted with the screen on purpose: the answer to a LOGS tap is a notice, and
   *  a notice renders in the bar, not on the screen that raised it (`notice.ts`). Asserting against the
   *  screen alone would pass whether or not the operator is ever told anything. */
  async function armoryWith(result: { ok: boolean; node_id: string; log?: LogView | null }) {
    clearNotice();
    const d = await demo();
    const asked: string[] = [];
    const api = fixtureApi({ pullLog: async (id: string) => { asked.push(id); return result; } });
    const store = makeStore({ ...d, state: withLogs(d.state, { state: 'none', last_t: 1_000 }), view: 'muster' }, { api });
    const m = await mount(<StoreCtx.Provider value={store}><><CommandBar /><Armory /></></StoreCtx.Provider>);
    return Object.assign(m, { asked });
  }

  it('asks the node MC actually shows on the card', async () => {
    const m = await armoryWith({ ok: true, node_id: 'node_3D4F' });
    const btn = m.find('[data-pull-log]')[0];
    expect(btn, 'a LOGS button on the node card').toBeTruthy();
    const id = btn.getAttribute('data-pull-log');
    await m.click('LOGS');
    expect(m.asked).toEqual([id]);
    m.unmount();
  });

  it('says so on screen when the ask went out', async () => {
    const m = await armoryWith({ ok: true, node_id: 'node_3D4F', log: { state: 'none', last_t: 1_000 } });
    await m.click('LOGS');
    expect(m.text()).toMatch(/ASKED/i);
    m.unmount();
  });

  it('says so when MC could NOT ask, instead of looking like it worked', async () => {
    // `ok: false` is MC refusing to ask — a utility phone, a node past the ~1 MB budget, or no socket.
    // A button that answers "nothing happened" the same way it answers "done" is the F40 shape.
    const m = await armoryWith({ ok: false, node_id: 'node_3D4F' });
    await m.click('LOGS');
    expect(m.text()).toMatch(/COULD NOT ASK|NOT ASKED/i);
    expect(m.text()).not.toMatch(/ASKED ✓/);
    m.unmount();
  });

  it('is a real tap target', async () => {
    const m = await armoryWith({ ok: true, node_id: 'node_3D4F' });
    const btn = m.find('[data-pull-log]')[0];
    expect(parseFloat(btn.style.minHeight || '0')).toBeGreaterThanOrEqual(36);
    m.unmount();
  });
});
