// mc.md #1 (review 2026-10-10): a mode change carries the VENUE across (state.py `_candidate_config`): environment,
// night, coverage AND the host's volume (K8). The mock carried the first three only, so `?mock` dropped the volume on a
// mode switch that the server keeps.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

describe('mock: a mode change keeps the venue', () => {
  it('keeps the volume, environment and night unless the patch names them', async () => {
    const b = new MockBackend();
    await b.putConfig({ volume: 85, environment: 'indoor', night: true } as never);
    const prev = (await b.getState()).config;
    const next = prev.mode === 'ffa' ? 'tdm' : 'ffa';
    await b.putConfig({ mode: next } as never);
    const c = (await b.getState()).config as { volume?: number; environment?: string; night?: boolean; mode: string };
    expect(c.mode).toBe(next);
    expect(c.volume).toBe(85);
    expect(c.environment).toBe('indoor');
    expect(c.night).toBe(true);
    await b.putConfig({ mode: prev.mode, volume: null } as never);
    expect(((await b.getState()).config as { volume?: number }).volume).toBeUndefined();
  });

  it('a PICK keeps the host volume too (gamepick.py compose never writes it)', async () => {
    const b = new MockBackend();
    await b.putConfig({ volume: 85 } as never);
    const r = await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    expect(r.ok).toBe(true);
    expect(((await b.getState()).config as { volume?: number }).volume).toBe(85);
  });
});
