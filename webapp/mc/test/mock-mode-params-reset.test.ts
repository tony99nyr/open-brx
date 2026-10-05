// F470 (cross-lane review #3), mock parity with gamepick.py compose + api.py pick: a pick that only changes the time
// keeps a KIT mode_params edit; a pick that names the gameplay piece resets it to the mode's defaults.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

describe('mock: which pick resets mode_params', () => {
  it('a time-only pick keeps a KIT edit, a gameplay pick resets it', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await b.putConfig({ mode_params: { score_target: 100 } } as never);
    const kept = (await b.pick({ match: { time_limit_s: 900 } })).config as { mode_params?: Record<string, unknown> };
    expect(kept.mode_params?.score_target).toBe(100);
    const reset = (await b.pick({ pieces: { gameplay: 'builtin:gameplay:standard' } })).config as { mode_params?: Record<string, unknown> };
    expect(reset.mode_params?.score_target).not.toBe(100);
  });
});
