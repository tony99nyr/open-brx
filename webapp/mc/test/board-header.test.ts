import { describe, expect, it } from 'vitest';
import type { State } from '../src/api/types';
import { boardHeader } from '../src/api/derive';
import { chip } from '../src/ui';

function state(mode: string, win_by: string, frag_limit: number | null, teams: string[]) {
  return {
    config: { mode, scoring: { win_by, frag_limit, hold_target_s: 90 }, teams: teams.map(team_id => ({ team_id })) },
    live: { ends_t: 65_000 },
  } as unknown as State;
}

describe('shared live board header', () => {
  it('shows a TDM frag cap and remaining time', () => {
    expect(boardHeader(state('tdm', 'kills', 25, ['blue', 'red']), 10_000)).toEqual({
      remaining: 55, cap: 25, objective: false, sub: 'TDM · FIRST TO 25',
    });
  });

  it('shows the KOTH hold objective without a kill cap', () => {
    expect(boardHeader(state('koth', 'objective', null, ['blue', 'red']), 10_000)).toEqual({
      remaining: 55, cap: null, objective: true, sub: 'KOTH · MOST HILL TIME WINS',
    });
  });

  it('shows the FFA frag cap', () => {
    expect(boardHeader(state('ffa', 'kills', 15, []), 10_000)).toEqual({
      remaining: 55, cap: 15, objective: false, sub: 'FFA · FIRST TO 15',
    });
  });
});

it('keeps the shared catalogue chip at least 36 px tall', () => {
  expect(chip(false).minHeight).toBe(36);
});
