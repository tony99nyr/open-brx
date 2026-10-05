// O5 (maintainability review 2026-10-03): a failed weapon or mode fetch used to be swallowed once at mount.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWithRetry } from '../src/api/retry';
import { CommandBar } from '../src/frame/CommandBar';
import { StoreCtx } from '../src/store';
import { demo, makeStore, mount } from './harness';

afterEach(() => { vi.useRealTimers(); });

describe('loadWithRetry', () => {
  it('flags the failure, retries with backoff and clears the flag on success', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const flags: boolean[] = [], got: string[] = [];
    const stop = loadWithRetry(() => (++calls < 3 ? Promise.reject(new Error('503')) : Promise.resolve('ok')), v => got.push(v), f => flags.push(f));
    await vi.advanceTimersByTimeAsync(0);
    expect(flags).toEqual([true]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(calls).toBe(2);   // the second wait is 4 s
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(3);
    expect(got).toEqual(['ok']);
    expect(flags.at(-1)).toBe(false);
    stop();
  });
});

describe('the catalogue chip', () => {
  it('shows an amber WHAT: WHAT TO DO line only while the lists are down', async () => {
    const d = await demo();
    const down = await mount(<StoreCtx.Provider value={makeStore({ state: d.state }, { catalogueDown: true })}><CommandBar /></StoreCtx.Provider>);
    const chip = down.find('[data-alert="frame-catalogue-unavailable"]')[0];
    expect(chip.getAttribute('data-sev')).toBe('amber');
    expect(chip.textContent).toContain('WEAPON OR MODE LIST NOT LOADED: ');
    down.unmount();
    const up = await mount(<StoreCtx.Provider value={makeStore({ state: d.state }, { catalogueDown: false })}><CommandBar /></StoreCtx.Provider>);
    expect(up.find('[data-alert="frame-catalogue-unavailable"]').length).toBe(0);
    up.unmount();
  });
});
