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
  for (const b of m.find('[data-alert]')) {
    if (b.querySelector('button')) await m.click('Why? ▾');
  }
  const out = [...m.find('[data-alert]')].map(e => ({ id: e.getAttribute('data-alert')!, sev: e.getAttribute('data-sev')!, text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), title: e.getAttribute('title') ?? e.querySelector('button')?.getAttribute('title') ?? '' }));
  m.unmount();
  return out;
}

describe('O7/O8 server failure chips', () => {
  it('a healthy MC draws nothing', async () => { expect(await chips({ not_saving: undefined, ticker_failing: undefined, join_error: undefined })).toEqual([]); });

  it('the store failing is red and keeps the raw error in the title, not in the words', async () => {
    const [c] = await chips({ not_saving: { store: F } });
    expect(c).toMatchObject({ id: 'server-not-saving-store', sev: 'red' });
    expect(c.text).toContain('Not saving game data');
    expect(c.text).toContain('A result can be lost.');
    expect(c.text).toContain('Check the disk and the MC log.');
    expect(c.text).toContain('No space left');
  });

  it('the archive failing is its own red chip', async () => {
    const [c] = await chips({ not_saving: { archive: F } });
    expect(c).toMatchObject({ id: 'server-not-saving-archive', sev: 'red' });
    expect(c.text).toContain('Not saving this result');
    expect(c.text).toContain('The result can be lost.');
    expect(c.text).toContain('Check the disk and the MC log.');
  });

  it('the snapshot alone is amber before a match, and red while ARMED or LIVE', async () => {
    expect((await chips({ phase: 'lobby', not_saving: { snapshot: F } }))[0]).toMatchObject({ id: 'server-not-saving-snapshot', sev: 'amber' });
    for (const phase of ['armed', 'live'] as const)
      expect((await chips({ phase, not_saving: { snapshot: F } }))[0]).toMatchObject({ id: 'server-not-saving-snapshot-live', sev: 'red' });
  });

  it('the ticker chip does not advise a restart while MC is not saving', async () => {
    const ok = (await chips({ ticker_failing: F }))[0];
    expect(ok.text).toContain('Match clock failing');
    expect(ok.text).toContain('Restart MC.');
    const bad = (await chips({ ticker_failing: F, not_saving: { snapshot: F } })).find(c => c.id === 'server-ticker-failing')!;
    expect(bad.text).not.toContain('Restart MC.');
    expect(bad.text).toContain('Do not restart while MC is not saving.');
  });

  it('a join error that still holds an earlier address says the QR may be out of date', async () => {
    expect((await chips({ join_error: { error: 'x', ws_url: '' } }))[0].text).toContain('Join QR has no address');
    expect((await chips({ join_error: { error: 'x', ws_url: 'ws://10.0.0.5:8766/ws' } }))[0].text).toContain('Join address out of date');
  });
});
