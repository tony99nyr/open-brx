// F429 (2026-09-26): the KOTH team board's caption used to replace "FIRST TO N · K · D · A" with
// "HOLD TIME · A LOWER BOUND", dropping the legend for the per-player K · D · A row it still draws
// underneath. `_board` is exercised the same way `board-age.test.mjs` exercises `_boardAge`/`_boardStale`:
// called against `Hud.prototype` directly, since building a real `Hud` needs a DOM tree its constructor
// creates, which this test does not want.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';

const board = st => Hud.prototype._board.call(Hud.prototype, st);

test('F429: the KOTH team board caption keeps a K · D · A tag alongside HOLD TIME', () => {
  const st = {
    mode: 'KOTH',
    board: { teams: [{ team_id: 'blue', name: 'BLUE TEAM', score: 0 }, { team_id: 'purple', name: 'PURPLE TEAM', score: 0 }] },
    scoreRows: [{ player_id: 'p1', team_id: 'blue', display: 'VIPER', kills: 3, deaths: 1, assists: 0 }],
  };
  const html = board(st);
  assert.match(html, /HOLD TIME/, 'the KOTH caption still says HOLD TIME');
  assert.match(html, /K\s*·\s*D\s*·\s*A/, 'the per-player row legend (K · D · A) must not be dropped for KOTH');
});

test('control: a capped TDM board keeps its own FIRST TO N · K · D · A caption unchanged', () => {
  const st = {
    mode: 'TDM',
    board: { teams: [{ team_id: 'blue', name: 'BLUE TEAM', score: 4 }, { team_id: 'yellow', name: 'YELLOW TEAM', score: 2 }], cap: 25 },
    scoreRows: [],
  };
  const html = board(st);
  assert.match(html, /FIRST TO 25 · K · D · A/);
});
