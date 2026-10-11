// O5 review round 1: the store wiring, not just the helper. A failing weapon or mode fetch must raise
// `catalogueDown` and the chip, retry, and clear both when a retry succeeds.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandBar } from '../src/frame/CommandBar';
import type { MockBackend } from '../src/mock/backend';
import { StoreProvider, useStore } from '../src/store';
import { Shelf } from '../src/ui/index';
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

  it('retries a failed perks fetch and includes it in catalogue health', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    history.replaceState(null, '', '/?mock&perks=down');
    const retry = await mount(<StoreProvider><Probe /><CommandBar /></StoreProvider>);
    const api = (window as unknown as { __MC_MOCK__: MockBackend }).__MC_MOCK__;
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(retry.find('[data-probe]')[0].getAttribute('data-down')).toBe('true');
    api.failPerks = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(retry.find('[data-probe]')[0].getAttribute('data-down')).toBe('false');
    retry.unmount();
  });

  it('a 404 for perks retries and raises the catalogue chip', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    history.replaceState(null, '', '/?mock&perks=gone');
    const m = await mount(<StoreProvider><Probe /><CommandBar /></StoreProvider>);
    const api = (window as unknown as { __MC_MOCK__: MockBackend }).__MC_MOCK__;
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const calls = vi.spyOn(api, 'getPerks');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls, 'a 404 uses the same retry path as other failures').toHaveBeenCalled();
    expect(m.find('[data-probe]')[0].getAttribute('data-down')).toBe('true');
    expect(m.find('[data-alert="frame-catalogue-unavailable"]').length).toBe(1);
    m.unmount();
  });
});

describe('Shelf overflow', () => {
  it('rechecks when its first child grows', async () => {
    let notify: (() => void) | undefined;
    class Observer {
      constructor(callback: ResizeObserverCallback) { notify = () => callback([], this as unknown as ResizeObserver); }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    const old = globalThis.ResizeObserver;
    globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver;
    try {
      const m = await mount(<Shelf className="cards"><div>card</div></Shelf>);
      const shelf = m.find('.cards')[0];
      Object.defineProperties(shelf, { scrollWidth: { configurable: true, value: 100 }, clientWidth: { configurable: true, value: 100 }, scrollLeft: { configurable: true, value: 0 } });
      await act(async () => { notify?.(); });
      expect(shelf.className).not.toContain('shelf-x');
      Object.defineProperty(shelf, 'scrollWidth', { configurable: true, value: 180 });
      await act(async () => { notify?.(); });
      expect(shelf.className).toContain('shelf-x');
      // review: a card arriving resizes nothing the ResizeObserver watches; the child-list change must re-check alone
      Object.defineProperty(shelf, 'scrollWidth', { configurable: true, value: 100 });
      await act(async () => { notify?.(); });
      expect(shelf.className).not.toContain('shelf-x');
      Object.defineProperty(shelf, 'scrollWidth', { configurable: true, value: 260 });
      await act(async () => { shelf.appendChild(document.createElement('div')); await Promise.resolve(); });
      expect(shelf.className, 'a new card did not re-check the overflow').toContain('shelf-x');
      m.unmount();
    } finally { globalThis.ResizeObserver = old; }
  });
});
