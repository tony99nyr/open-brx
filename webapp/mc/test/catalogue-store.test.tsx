// O5 review round 1: the store wiring, not just the helper. A failing weapon or mode fetch must raise
// `catalogueDown` and the chip, retry, and clear both when a retry succeeds.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandBar } from '../src/frame/CommandBar';
import type { MockBackend } from '../src/mock/backend';
import { StoreProvider, useStore } from '../src/store';
import { mount } from './harness';

function Probe() {
  const { catalogueDown, weapons, modes } = useStore();
  return <span data-probe data-down={String(catalogueDown)} data-weapons={weapons.length} data-modes={modes.length} />;
}

afterEach(() => { vi.useRealTimers(); history.replaceState(null, '', '/'); });

describe('the store retries a failed catalogue fetch', () => {
  it('shows the chip while it fails and clears it, with the lists, when a retry succeeds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    history.replaceState(null, '', '/?mock&catalogue=down');
    const m = await mount(<StoreProvider><Probe /><CommandBar /></StoreProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const probe = () => m.find('[data-probe]')[0];
    expect(probe().getAttribute('data-down')).toBe('true');
    expect(probe().getAttribute('data-weapons')).toBe('0');
    expect(m.find('[data-alert="frame-catalogue-unavailable"]').length).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(probe().getAttribute('data-down'), 'still failing: the retry keeps the chip').toBe('true');
    (window as unknown as { __MC_MOCK__: MockBackend }).__MC_MOCK__.failCatalogue = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(probe().getAttribute('data-down')).toBe('false');
    expect(Number(probe().getAttribute('data-weapons'))).toBeGreaterThan(0);
    expect(Number(probe().getAttribute('data-modes'))).toBeGreaterThan(0);
    expect(m.find('[data-alert="frame-catalogue-unavailable"]').length).toBe(0);
    m.unmount();
  });
});
