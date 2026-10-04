// O7 / O8: the failures MC reports on the snapshot, as the operator sees them (src/ui/ServerFailures.tsx).
import { describe, expect, it } from 'vitest';
import type { State } from '../src/api/types';
import { ServerFailures } from '../src/ui/ServerFailures';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount } from './harness';

const F = { since: 1000, count: 3, error: 'OSError: [Errno 28] No space left on device' };
async function chips(patch: Partial<State>) {
  const d = await demo();
  const api = fixtureApi({}, d.api);
  const state = { ...d.state, t: 5000, ...patch } as State;
  const m = await mount(<StoreCtx.Provider value={makeStore({ ...d, state, view: 'muster' }, { api })}><ServerFailures /></StoreCtx.Provider>);
  const out = [...m.find('[data-alert]')].map(e => ({ id: e.getAttribute('data-alert')!, sev: e.getAttribute('data-sev')!, text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), title: e.getAttribute('title') ?? '' }));
  m.unmount();
  return out;
}

describe('O7/O8 server failure chips', () => {
  it('a healthy MC draws nothing', async () => { expect(await chips({ not_saving: undefined, ticker_failing: undefined, join_error: undefined })).toEqual([]); });

  it('the store failing is red and keeps the raw error in the title, not in the words', async () => {
    const [c] = await chips({ not_saving: { store: F } });
    expect(c).toMatchObject({ id: 'server-not-saving-store', sev: 'red' });
    expect(c.text).toBe('▲ NOT SAVING GAME DATA, A RESULT CAN BE LOST: CHECK THE DISK AND THE MC LOG');
    expect(c.title).toContain('No space left');
  });

  it('the archive failing is its own red chip', async () => {
    const [c] = await chips({ not_saving: { archive: F } });
    expect(c).toMatchObject({ id: 'server-not-saving-archive', sev: 'red' });
    expect(c.text).toBe("▲ NOT SAVING THIS MATCH'S RESULT, IT CAN BE LOST: CHECK THE DISK AND THE MC LOG");
  });

  it('the snapshot alone is amber before a match, and red while ARMED or LIVE', async () => {
    expect((await chips({ phase: 'lobby', not_saving: { snapshot: F } }))[0]).toMatchObject({ id: 'server-not-saving-snapshot', sev: 'amber' });
    for (const phase of ['armed', 'live'] as const)
      expect((await chips({ phase, not_saving: { snapshot: F } }))[0]).toMatchObject({ id: 'server-not-saving-snapshot-live', sev: 'red' });
  });

  it('the ticker chip does not advise a restart while MC is not saving', async () => {
    const ok = (await chips({ ticker_failing: F }))[0];
    expect(ok.text).toMatch(/: RESTART MC$/);
    const bad = (await chips({ ticker_failing: F, not_saving: { snapshot: F } })).find(c => c.id === 'server-ticker-failing')!;
    expect(bad.text).not.toMatch(/RESTART MC$/);
    expect(bad.text).toContain('CHECK THE MC LOG');
  });

  it('a join error that still holds an earlier address says the QR may be out of date', async () => {
    expect((await chips({ join_error: { error: 'x', ws_url: '' } }))[0].text).toContain('JOIN QR HAS NO ADDRESS');
    expect((await chips({ join_error: { error: 'x', ws_url: 'ws://10.0.0.5:8766/ws' } }))[0].text).toContain('NOT REFRESHED');
  });
});
