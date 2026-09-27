// F413 (TEAMS) + F415 (KOTH hold target) -- games-presets.md §7. Mock parity: validation, compose,
// per-mode defaults, and the mode-switch reset.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

describe('F413: match.teams validation', () => {
  it('accepts 2 to 4 unique colours on TDM', async () => {
    const b = new MockBackend();
    const r2 = await b.pick({ match: { teams: ['red', 'purple'] } });
    expect(r2.ok).toBe(true);
    expect((await b.getState()).config.teams.map(t => t.team_id)).toEqual(['red', 'purple']);
    const r3 = await b.pick({ match: { teams: ['red', 'blue', 'yellow'] } });
    expect(r3.ok).toBe(true);
    expect((await b.getState()).config.teams.map(t => t.team_id)).toEqual(['red', 'blue', 'yellow']);
  });

  it('refuses fewer than 2 or more than 4', async () => {
    const b = new MockBackend();
    await expect(b.pick({ match: { teams: ['red'] } })).rejects.toMatchObject({ status: 400 });
    await expect(b.pick({ match: { teams: ['red', 'blue', 'yellow', 'purple', 'red'] } })).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a duplicate colour', async () => {
    const b = new MockBackend();
    await expect(b.pick({ match: { teams: ['red', 'red'] } })).rejects.toMatchObject({ status: 400 });
  });

  it('refuses an unknown colour', async () => {
    const b = new MockBackend();
    await expect(b.pick({ match: { teams: ['red', 'green'] as unknown as ['red'] } })).rejects.toMatchObject({ status: 400 });
  });

  it('KOTH is exactly 2 teams', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await expect(b.pick({ match: { teams: ['blue', 'purple', 'red'] } })).rejects.toMatchObject({ status: 400 });
    const r = await b.pick({ match: { teams: ['red', 'purple'] } });
    expect(r.ok).toBe(true);
  });

  it('KOTH never offers yellow', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await expect(b.pick({ match: { teams: ['blue', 'yellow'] } })).rejects.toMatchObject({ status: 400 });
  });
});

describe('F413: a mode change resets teams to red+blue, like the limits', () => {
  // Team-lead's scope decision (2026-09-27): pick/compose (a fresh pick, a mode change) gives red+blue
  // outright, never the mode's own catalogue `defaults.teams` (KOTH's own row still declares
  // blue/purple, but that now only feeds the static demo fixture and a direct putConfig mode switch --
  // mock/data.ts's own base() comment has the full reasoning).
  it('TDM -> KOTH resets to red+blue', async () => {
    const b = new MockBackend();
    await b.pick({ match: { teams: ['red', 'yellow', 'purple'] } });
    const r = await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    expect(r.ok).toBe(true);
    expect((await b.getState()).game_pick!.match.teams).toEqual(['red', 'blue']);
  });
});

describe('F413: a TEAMS change that reshapes the roster goes through the SAME reteam path as a mode switch', () => {
  it('changes config.teams (compose), which reteamForConfig then rebalances', async () => {
    const b = new MockBackend();
    const before = await b.getState();
    expect(before.players.some(p => p.team_id === 'yellow'), 'control: some players start on yellow').toBe(true);
    await b.pick({ match: { teams: ['red', 'purple'] } });
    const after = await b.getState();
    expect(after.config.teams.map(t => t.team_id)).toEqual(['red', 'purple']);
    expect(after.players.some(p => p.team_id === 'yellow'), 'nobody is left on a team no longer declared').toBe(false);
  });
});

describe('F415: match.hold_target_s validation', () => {
  it('is refused on any mode but KOTH', async () => {
    const b = new MockBackend();
    await expect(b.pick({ match: { hold_target_s: 300 } })).rejects.toMatchObject({ status: 400 });
  });

  it('null is always legal (no target)', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    const r = await b.pick({ match: { hold_target_s: null } });
    expect(r.ok).toBe(true);
    expect((await b.getState()).config.scoring.hold_target_s ?? null).toBeNull();
  });

  it('a positive integer on KOTH is accepted and reaches config.scoring', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    const r = await b.pick({ match: { hold_target_s: 300 } });
    expect(r.ok).toBe(true);
    expect((await b.getState()).config.scoring.hold_target_s).toBe(300);
  });

  it('refuses zero or a negative value', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await expect(b.pick({ match: { hold_target_s: 0 } })).rejects.toMatchObject({ status: 400 });
    await expect(b.pick({ match: { hold_target_s: -5 } })).rejects.toMatchObject({ status: 400 });
  });

  it('resets to null on a mode change (like the limits)', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await b.pick({ match: { hold_target_s: 300 } });
    await b.pick({ pieces: { mode: 'builtin:mode:tdm' } });
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    expect((await b.getState()).game_pick!.match.hold_target_s ?? null).toBeNull();
  });
});

describe('F413/F415: GET /api/modes rows carry their own match_items', () => {
  it('TDM/FFA/KOTH match the spec’s table', async () => {
    const b = new MockBackend();
    const modes = await b.getModes();
    expect(modes.find(m => m.mode === 'tdm')?.match_items).toEqual(['time', 'kills', 'countdown', 'daynight', 'silenced', 'teams']);
    expect(modes.find(m => m.mode === 'ffa')?.match_items).toEqual(['time', 'kills', 'countdown', 'daynight', 'silenced']);
    expect(modes.find(m => m.mode === 'koth')?.match_items).toEqual(['time', 'hold', 'countdown', 'daynight', 'silenced', 'teams']);
  });
});
