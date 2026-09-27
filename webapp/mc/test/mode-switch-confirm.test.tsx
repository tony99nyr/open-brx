// F-6 (2026-09-13): a mode switch that moves ≥2 rostered players between teams asks first and shows
// the resulting split. `splitLine` is the pure predicate behind that gate (KIT/LOBBY's inline edit
// uses it). F411 retired the GAMES tiles this file also drove; PLAY's own mode picker has its own test.
import { describe, expect, it } from 'vitest';
import { splitLine } from '../src/screens/gameSummary';

describe('splitLine — the pure predicate behind the gate', () => {
  const blue = { team_id: 'blue' }, yellow = { team_id: 'yellow' }, purple = { team_id: 'purple' };
  it('nothing to confirm with fewer than two players rostered', () => {
    expect(splitLine([{ player_num: 1, team_id: 'blue' }], [blue, yellow], [blue, purple])).toBe('');
    expect(splitLine([], [blue, yellow], [blue, purple])).toBe('');
  });
  it('nothing to confirm when the target has fewer than two teams (FFA)', () => {
    const players = [{ player_num: 1, team_id: 'blue' }, { player_num: 2, team_id: 'yellow' }];
    expect(splitLine(players, [blue, yellow], [{ team_id: 'ffa' }])).toBe('');
  });
  it('nothing to confirm when the target declares the SAME team ids already applied', () => {
    const players = [{ player_num: 1, team_id: 'blue' }, { player_num: 2, team_id: 'yellow' }];
    expect(splitLine(players, [blue, yellow], [blue, yellow])).toBe('');
  });
  it('"N PLAYERS → BLUE n / PURPLE n" when the layout actually changes, in the NEW mode\'s team order', () => {
    const players = [
      { player_num: 1, team_id: 'blue' }, { player_num: 2, team_id: 'yellow' },
      { player_num: 3, team_id: 'blue' }, { player_num: 4, team_id: 'yellow' },
    ];
    expect(splitLine(players, [blue, yellow], [blue, purple])).toBe('4 PLAYERS → BLUE 2 / PURPLE 2');
  });
});
