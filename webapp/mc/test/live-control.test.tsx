// LIVE's END / RECALL, against the answers `POST /api/control` actually gives.
//
// The route answers 200 with `ok:false` when it REFUSES (state.py `control`): an END with no scorer,
// or a second END after the recap is already written. It ends nothing, says why in `error`, and still
// forwards the press to the guns (`pushed`). The console read `reached`/`nodes` and dropped `error`,
// so the press that did nothing reported "END REACHED 0 OF 8 NODE(S)" — a number, where the server
// had sent a sentence. These assert what the operator SEES: the refusal in the red strip, the count
// in the notice, and nothing claimed that did not happen.
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Api, LiveView, State } from '../src/api/types';
import { CommandBar } from '../src/frame/CommandBar';
import { Live } from '../src/screens/Live';
import { clearNotice } from '../src/notice';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount, type Mounted } from './harness';

const LIVE: LiveView = {
  match_id: 'm-test', go_live_t: Date.now() - 60_000, time_limit_s: 600,
  ends_t: Date.now() + 540_000, score: { blue: 3, yellow: 1 }, rows: [],
};

/** The real store wiring for `run()`: a rejection lands in `error`, which CommandBar renders as the
 *  red strip. A stub that swallows would make every one of these tests pass on the old code. */
function Wrap({ state, api, children }: { state: State; api: Partial<Api>; children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const store = makeStore({ state, view: 'live', api }, {
    error, clearError: () => setError(null),
    run: async fn => { try { setError(null); return await fn(); } catch (e) { setError((e as Error).message); return undefined; } },
  });
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

type Ctl = Awaited<ReturnType<Api['control']>>;

async function liveScreen(result: Ctl | Error) {
  const d = await demo();
  const calls: string[] = [];
  const api = fixtureApi({
    control: async (cmd: string) => { calls.push(cmd); if (result instanceof Error) throw result; return result; },
  } as unknown as Partial<Api>);
  const state: State = { ...d.state, phase: 'live', live: LIVE };
  const m = await mount(<Wrap state={state} api={api}><CommandBar /><Live /></Wrap>);
  return Object.assign(m, { calls });
}
/** the red error strip in the command bar, or '' */
const strip = (m: Mounted) => (m.find('header [role="alert"]')[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('LIVE · END / RECALL report what the server said', () => {
  beforeEach(() => clearNotice());

  it('a refused END shows the server\'s reason in the error strip, and claims nothing', async () => {
    const m = await liveScreen({
      ok: false, ended: false, reached: 0, pushed: 2, nodes: 8, phase: 'kit',
      error: 'no match is being scored — nothing to end (RECALL returns the field to KIT)',
    });
    await m.click('END MATCH EARLY');
    await m.click('CONFIRM END');
    expect(m.calls).toEqual(['end']);
    expect(strip(m), 'the refusal reaches the operator as an error').toContain('no match is being scored');
    expect(strip(m), 'and says the press still reached the guns').toContain('2 nodes were still told to stop');
    expect(m.text(), 'a refused END must not report a match ended').not.toContain('MATCH ENDED');
    expect(m.text(), 'and must not report a reach count for something that did not happen').not.toContain('REACHED 0 OF 8');
    m.unmount();
  });

  it('a second END after the recap is written says so', async () => {
    const m = await liveScreen({
      ok: false, ended: false, reached: 0, pushed: 6, nodes: 6, phase: 'recap',
      error: 'this match has already ended — the recap stands (RECALL returns the field to KIT)',
    });
    await m.click('END MATCH EARLY');
    await m.click('CONFIRM END');
    expect(strip(m)).toContain('the recap stands');
    expect(m.text()).not.toContain('MATCH ENDED');
    m.unmount();
  });

  it('a successful END is worded from `ended` and `reached`', async () => {
    const m = await liveScreen({ ok: true, ended: true, reached: 8, pushed: 8, nodes: 8, phase: 'recap' });
    await m.click('END MATCH EARLY');
    await m.click('CONFIRM END');
    expect(strip(m), 'no error on a success').toBe('');
    expect(m.text()).toContain('MATCH ENDED · REACHED 8 OF 8 NODES');
    m.unmount();
  });

  it('an END that missed a node is flagged, not reported as clean', async () => {
    const m = await liveScreen({ ok: true, ended: true, reached: 6, pushed: 6, nodes: 8, phase: 'recap' });
    await m.click('END MATCH EARLY');
    await m.click('CONFIRM END');
    expect(m.text()).toContain('MATCH ENDED · REACHED 6 OF 8 NODES');
    expect(m.text(), 'short of the bound carries the warning marker').toContain('▲ MATCH ENDED');
    m.unmount();
  });

  it('RECALL reports itself as a recall, never as an ended match', async () => {
    const m = await liveScreen({ ok: true, ended: true, reached: 8, pushed: 8, nodes: 8, phase: 'kit' });
    await m.click('RECALL');
    await m.click('CONFIRM RECALL');
    expect(m.calls).toEqual(['recall']);
    expect(m.text()).toContain('RECALLED · REACHED 8 OF 8 NODES');
    expect(m.text()).not.toContain('MATCH ENDED');
    m.unmount();
  });

  it('an older MC that sends no `nodes` gets no invented count', async () => {
    const m = await liveScreen({ ok: true });
    await m.click('END MATCH EARLY');
    await m.click('CONFIRM END');
    expect(m.text(), 'no "REACHED 0 OF 0"').not.toContain('REACHED');
    expect(m.text()).toContain('END SENT');
    m.unmount();
  });

  // The `?mock` demo answers this route too, and it used to reply `{ok:true}` to an END with no match
  // while quietly resetting the session — a demo that looked MORE permissive than a real MC.
  it('the ?mock backend answers the same shape a real MC does', async () => {
    const { api, state } = await demo();                // the demo session has no scorer
    const before = state.phase;
    const refused = await api.control('end');
    expect(refused.ok).toBe(false);
    expect(refused.ended).toBe(false);
    expect(refused.reached).toBe(0);
    expect(refused.pushed, 'the press still reaches the guns').toBeGreaterThan(0);
    expect(refused.error).toContain('no match is being scored');
    expect(refused.phase, 'a refused END moves no phase').toBe(before);
    expect((await api.getState()).phase, 'and the session is not reset behind it').toBe(before);
    const recalled = await api.control('recall');
    expect(recalled.ok).toBe(true);
    expect(recalled.ended).toBe(true);
    expect(recalled.reached).toBe(recalled.nodes);
    expect(recalled.nodes, 'the demo roster is 8 phones, so ?mock reads "REACHED 8 OF 8 NODES"').toBe(8);
    expect(recalled.phase, 'a recall lands on KIT, as it does on a real MC').toBe('kit');
  });

  it('a transport failure still lands in the error strip', async () => {
    const m = await liveScreen(new Error('control end: 503 upstream gone'));
    await m.click('END MATCH EARLY');
    await m.click('CONFIRM END');
    expect(strip(m)).toContain('503 upstream gone');
    expect(m.text()).not.toContain('MATCH ENDED');
    m.unmount();
  });
});
