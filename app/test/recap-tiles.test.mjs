// Review of medal-icons (M1): the PLAYERS tab hides the stat tiles only when the player's own row is on the board (it
// carries the same numbers), and SHOTS, which no board column shows, moves to the meta line then. With no rows, or
// with the player off the board, the tiles stay. And the recap legend escapes the key it writes into an attribute.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recapTilesHidden, recapShotsNote, recapLegend } from '../src/hud/hud.js';

const ROWS = [{ player_id: 'p-demo' }, { player_id: 'p-2' }];
test('the tiles hide on PLAYERS only when my own row is on the board, and always on AWARDS', () => {
  assert.equal(recapTilesHidden('player', ROWS, 'p-demo'), true);
  assert.equal(recapTilesHidden('player', [], 'p-demo'), false, 'MC sent no rows');
  assert.equal(recapTilesHidden('player', ROWS, 'p-9'), false, 'I am not on the board');
  assert.equal(recapTilesHidden('player', ROWS, null), false, 'no player id');
  assert.equal(recapTilesHidden('team', ROWS, 'p-demo'), false);
  assert.equal(recapTilesHidden('awards', [], null), true);
});
test('SHOTS moves to the meta line when the tiles hide, and never when a hold replaces it', () => {
  assert.equal(recapShotsNote({ shots: 57 }, null), '57 SHOTS');
  assert.equal(recapShotsNote({ shots: null }, null), null);
  assert.equal(recapShotsNote({ shots: 57, teamKey: 'blue' }, { blue: 214 }), null, 'the tiles showed YOUR TEAM HELD, not SHOTS; HELD has its own strip');
});
test('the legend escapes the key it writes into data-medal', () => {
  const html = recapLegend(['x"><img src=x onerror=alert(1)>'], false);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-medal="x&quot;&gt;&lt;img/);
});
