import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';

test('briefing shows TEAM DAMAGE: OFF only when MC says the game has teams (Q13)', () => {
  const render = game => Hud.prototype._briefing.call({ bfMore: false }, { mode: game.mode, game, canPickPrimary: false, canPickSecondary: false, canPickPerk: false });
  assert.match(render({ mode: 'tdm', teams_text: 'BLUE V YELLOW', team_damage: 'off' }), /TEAM DAMAGE<\/span><span class="v">OFF</);
  assert.doesNotMatch(render({ mode: 'ffa' }), /TEAM DAMAGE/);
  assert.doesNotMatch(render({ mode: 'lms', teams_text: 'SOLO OR SQUADS' }), /TEAM DAMAGE/, 'solo LMS is one team');
});

test('briefing mode art has a missing-image fallback', () => {
  const html = Hud.prototype._briefing.call({ bfMore: false }, { mode: 'koth', game: { mode: 'koth' }, canPickPrimary: false, canPickSecondary: false, canPickPerk: false });
  assert.match(html, /<img[^>]+assets\/modes\/koth\.jpg[^>]+onerror=/);
  assert.match(html, /data-art="fallback"/);
});
