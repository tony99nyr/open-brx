// O2: the corrupt-armory banner on the Armory screen. (O3 is covered by the observability NOT SAVING chips.)
import { describe, expect, it } from 'vitest';
import type { State } from '../src/api/types';
import { Armory } from '../src/screens/Armory';
import { StoreCtx } from '../src/store';
import { demo, fixtureApi, makeStore, mount, mountScreen } from './harness';

describe('O2 · armory_corrupt banner', () => {
  it('shows a red banner naming the moved file and warning the list is incomplete', async () => {
    const d = await demo();
    const state: State = { ...d.state, armory_corrupt: { kept: '/h/armory.json.bad-20261004T010203', error: 'JSONDecodeError: bad' } };
    const m = await mountScreen(<Armory />, { ...d, state });
    const b = m.find('[data-testid="armory-corrupt-banner"]');
    expect(b.length).toBe(1);
    expect(b[0].getAttribute('data-sev')).toBe('red');
    expect(m.text()).toContain('ARMORY FILE IS CORRUPT');
    expect(m.text()).toContain('BACKUP AT /h/armory.json.bad-20261004T010203');
    expect(m.text()).toContain('GUNS BELOW ARE NOT YOUR FULL ARMORY');
    expect(m.text()).toContain('JSONDecodeError: bad');
    m.unmount();
  });

  it('renders nothing on a healthy armory', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, d);
    expect(m.find('[data-testid="armory-corrupt-banner"]').length).toBe(0);
    m.unmount();
  });

  it('DISMISS calls the route', async () => {
    const d = await demo();
    const calls: string[] = [];
    const state: State = { ...d.state, armory_corrupt: { kept: null, error: 'x' } };
    const api = fixtureApi({ dismissArmoryCorrupt: async () => { calls.push('dismiss'); return { ok: true, dismissed: true }; } }, d.api);
    const m = await mountScreen(<Armory />, { ...d, state, api });
    expect(m.find('[data-testid="armory-corrupt-dismiss"]').length).toBe(1);
    await m.click('DISMISS');
    expect(calls).toEqual(['dismiss']);
    m.unmount();
  });

  it('the mock backend keeps the flag until dismissed, then drops it from the state', async () => {
    const { MockBackend } = await import('../src/mock/backend');
    const b = new MockBackend() as unknown as { demoArmoryCorrupt: boolean; dismissArmoryCorrupt(): Promise<{ dismissed: boolean }>; getState(): Promise<State> };
    b.demoArmoryCorrupt = true;
    expect((await b.getState()).armory_corrupt).toBeTruthy();
    expect(await b.dismissArmoryCorrupt()).toMatchObject({ dismissed: true });
    expect((await b.getState()).armory_corrupt).toBeUndefined();
  });

  it('an unreadable armory gets its own wording', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, { ...d, state: { ...d.state, armory_corrupt: { kept: null, error: 'OSError: kept changing', unreadable: true } } });
    expect(m.text()).toContain('COULD NOT BE READ');
    m.unmount();
  });
});
