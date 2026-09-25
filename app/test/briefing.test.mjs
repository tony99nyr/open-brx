import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/hud/hud.js';

test('briefing labels team damage by behaviour only when the mode has teams', () => {
  const render = mode => Hud.prototype._briefing.call({ bfMore: false }, { mode, game: { mode, teams_text: 'BLUE V YELLOW' }, canPickPrimary: false, canPickSecondary: false, canPickPerk: false });
  assert.match(render('tdm'), /TEAM DAMAGE/);
  assert.match(render('tdm'), />OFF</);
  assert.doesNotMatch(render('ffa'), /TEAM DAMAGE/);
});

test('briefing mode art has a missing-image fallback', () => {
  const html = Hud.prototype._briefing.call({ bfMore: false }, { mode: 'koth', game: { mode: 'koth' }, canPickPrimary: false, canPickSecondary: false, canPickPerk: false });
  assert.match(html, /<img[^>]+assets\/modes\/koth\.jpg[^>]+onerror=/);
  assert.match(html, /data-art="fallback"/);
});
