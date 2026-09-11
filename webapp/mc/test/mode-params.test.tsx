// A18 (F105, review 2026-09-11) — Finding 2: the mock's `GET /api/modes` served rows with no `params` at
// all, while API.md promises `params` on every row (`[]` at minimum) and `ModeInfo.params` exists on the
// type. A UI built against the mock alone would never see the params controls it needs to render for
// koth/lms/extraction, because the demo data never had any to show.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

describe('GET /api/modes (mock) — params is always served (A18)', () => {
  it('every mode row carries params as an array', async () => {
    const modes = await new MockBackend().getModes();
    expect(modes.length).toBeGreaterThan(0);
    for (const m of modes) expect(Array.isArray(m.params), `${m.mode} has no params array`).toBe(true);
  });

  it('koth\'s params are non-empty and match the schema shape the engine declares', async () => {
    const modes = await new MockBackend().getModes();
    const koth = modes.find(m => m.mode === 'koth');
    expect(koth).toBeTruthy();
    expect(koth!.params!.length).toBeGreaterThan(0);
    const names = koth!.params!.map(p => p.name);
    expect(names).toEqual(['score_target', 'points_per_s']);
    expect(koth!.defaults.mode_params).toEqual({ score_target: 0, points_per_s: 1.0 });
  });

  it('a mode with no tunables (tdm) still gets [] rather than an absent field', async () => {
    const modes = await new MockBackend().getModes();
    const tdm = modes.find(m => m.mode === 'tdm');
    expect(tdm!.params).toEqual([]);
  });
});
