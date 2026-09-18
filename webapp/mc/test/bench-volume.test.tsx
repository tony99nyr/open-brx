// `--bench-volume N` (bench 2026-09-16): MC plays every $VOL at N. The console header must say so, so
// nobody runs a real game at bench level. The field is absent on a normal run and on an older server.
import { describe, expect, it } from 'vitest';
import { CommandBar } from '../src/frame/CommandBar';
import { demo, mountScreen } from './harness';

describe('the bench volume tag', () => {
  it('shows BENCH VOL with the level when the state carries bench_volume', async () => {
    const d = await demo();
    const m = await mountScreen(<CommandBar />, { ...d, state: { ...d.state, bench_volume: 55 }, view: 'muster' });
    const tag = m.el.querySelector('[data-testid="bench-volume"]');
    expect(tag?.textContent).toMatch(/BENCH VOL 55/);
    expect(tag?.getAttribute('title')).toMatch(/not for a real game/i);
    m.unmount();
  });

  it('shows nothing when the field is absent', async () => {
    const d = await demo();
    const state = { ...d.state };
    delete state.bench_volume;
    const m = await mountScreen(<CommandBar />, { ...d, state, view: 'muster' });
    expect(m.el.querySelector('[data-testid="bench-volume"]')).toBeNull();
    expect(m.text()).not.toMatch(/BENCH VOL/);
    m.unmount();
  });
});
