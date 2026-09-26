// The harness unmounts every screen a test leaves mounted (test/mounts.ts, test/setup.ts). Without it a
// LIVE screen's 500 ms tick outlives its test and can fire after jsdom is gone ("window is not defined").
import { describe, expect, it } from 'vitest';
import { Live } from '../src/screens/Live';
import { liveMounts } from './mounts';
import { demo, mountScreen } from './harness';

describe('the harness cleans up after a test', () => {
  it('a test may leave a ticking LIVE screen mounted', async () => {
    const d = await demo();
    await mountScreen(<Live />, { state: { ...d.state, phase: 'live' }, view: 'live' });
    expect(liveMounts.size).toBe(1);
  });
  it('the next test starts with nothing mounted', () => {
    expect(liveMounts.size, 'a screen from the previous test is still mounted').toBe(0);
    expect(document.body.children.length).toBe(0);
  });
});
