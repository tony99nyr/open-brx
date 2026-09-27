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

  // team-lead (2026-09-27): the server's own strings, copied verbatim (gamepick.py/state.py) -- a shape
  // violation (count, duplicate, or an unknown colour) is ONE generic message on the real server too,
  // whichever specific defect it is.
  const SHAPE_ERR = 'TEAM COLOURS MUST BE 2-4 UNIQUE PICKS FROM RED, BLUE, YELLOW, PURPLE';

  it('refuses fewer than 2 or more than 4, with the server\'s own words', async () => {
    const b = new MockBackend();
    await expect(b.pick({ match: { teams: ['red'] } })).rejects.toMatchObject({ status: 400, message: SHAPE_ERR });
    await expect(b.pick({ match: { teams: ['red', 'blue', 'yellow', 'purple', 'red'] } })).rejects.toMatchObject({ status: 400, message: SHAPE_ERR });
  });

  it('refuses a duplicate colour, with the server\'s own words', async () => {
    const b = new MockBackend();
    await expect(b.pick({ match: { teams: ['red', 'red'] } })).rejects.toMatchObject({ status: 400, message: SHAPE_ERR });
  });

  it('refuses an unknown colour, with the server\'s own words', async () => {
    const b = new MockBackend();
    await expect(b.pick({ match: { teams: ['red', 'green'] as unknown as ['red'] } })).rejects.toMatchObject({ status: 400, message: SHAPE_ERR });
  });

  it('KOTH is exactly 2 teams, with the server\'s own words', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await expect(b.pick({ match: { teams: ['blue', 'purple', 'red'] } }))
      .rejects.toMatchObject({ status: 400, message: 'KING OF THE HILL IS EXACTLY 2 TEAMS: PICK TWO COLOURS' });
    const r = await b.pick({ match: { teams: ['red', 'purple'] } });
    expect(r.ok).toBe(true);
  });

  it('KOTH never offers yellow, with the server\'s own F82 words', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await expect(b.pick({ match: { teams: ['blue', 'yellow'] } })).rejects.toMatchObject({ status: 400,
      message: "F82: mode 'koth' cannot have a team on $TID 2 at all — that is the value a NEUTRAL grenade hill "
        + 'broadcasts, so anyone put on it later reads every uncaptured point as their own and takes no hill damage. '
        + 'Use tid 0, 1 or 3.' });
  });
});

describe('F413: a mode change resets teams to red+blue, like the limits', () => {
  // Team-lead's scope decision (2026-09-27): TDM's and KOTH's own CATALOGUE `defaults.teams` are
  // red+blue now, matching the server's own `default_config`/`MODES` rows (`mock/data.ts`'s `base()`) --
  // a mode change through `pick()` reads that straight, one source of truth shared with `putConfig`'s
  // own mode-changed base rebuild and the console's client-side prediction. Only the static DEMO's own
  // starting session keeps the old blue/yellow, a deliberate, separate override (`DEMO_TEAMS`).
  it('TDM -> KOTH resets to red+blue', async () => {
    const b = new MockBackend();
    await b.pick({ match: { teams: ['red', 'yellow', 'purple'] } });
    const r = await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    expect(r.ok).toBe(true);
    expect((await b.getState()).game_pick!.match.teams).toEqual(['red', 'blue']);
    expect((await b.getState()).config.teams.map(t => t.team_id), 'the composed config agrees').toEqual(['red', 'blue']);
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
  it('is refused on any mode but KOTH, with the server\'s own words', async () => {
    const b = new MockBackend();
    await expect(b.pick({ match: { hold_target_s: 300 } })).rejects.toMatchObject({ status: 400,
      message: 'A HOLD TARGET ONLY APPLIES TO KING OF THE HILL: CLEAR IT OR PICK KING OF THE HILL' });
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

  it('refuses zero, a negative value, or a value past 2:00:00, with the server\'s own words', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    const HOLD_ERR = 'HOLD TARGET MUST BE 1 S TO 2:00:00, OR NO TARGET';
    await expect(b.pick({ match: { hold_target_s: 0 } })).rejects.toMatchObject({ status: 400, message: HOLD_ERR });
    await expect(b.pick({ match: { hold_target_s: -5 } })).rejects.toMatchObject({ status: 400, message: HOLD_ERR });
    await expect(b.pick({ match: { hold_target_s: 7201 } })).rejects.toMatchObject({ status: 400, message: HOLD_ERR });
    const r = await b.pick({ match: { hold_target_s: 7200 } });
    expect(r.ok, '2:00:00 exactly is the ceiling, still legal').toBe(true);
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
