// The DOWN screen's recap (deathscreen.js): what it may and may not say. Pure functions of engine state, so these run
// without a browser; tools/screens.mjs checks the same states on the rendered screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weaponLabel, finalHitLine, callouts, gameNow } from '../src/hud/deathscreen.js';

const txt = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const said = h => [...h.matchAll(/aria-label="([^"]*)"/g)].map(m => m[1]);
const life = (o = {}) => ({ taken: [], dealt: [], takenTotal: 0, dealtTotal: 0, dealtPartial: false, shots: 0, kills: 0, aliveMs: 0, finalHit: null, ...o });
const now = { stale: false, age: 'LIVE', resultRows: r => r };
const tk = [{ num: 19, name: 'VIPER', dmg: 60, hits: 2, weapons: [] }];
const dl = [{ victim: 'p9', name: 'GHOST', dmg: 30, hits: 2, weapons: [] }];

test('weaponLabel: a name, two candidates with OR, more than two unclear, no claim is nothing', () => {
  assert.equal(weaponLabel({ name: 'Shotgun' }), 'SHOTGUN');
  assert.equal(weaponLabel({ ambiguous: true, names: ['SMG', 'USP-S'] }), 'SMG / USP-S');
  assert.equal(weaponLabel({ ambiguous: true, names: ['A', 'B', 'C'] }), 'WEAPON UNCLEAR');
  assert.equal(weaponLabel(null), null);
  assert.equal(weaponLabel({ weapon_id: null, name: null, ambiguous: false }), null);
});

test('finalHitLine: the killing weapon only, never a hit from someone else', () => {
  const fh = { num: 19, dmg: 30, sensor: 4, crit: true, dot: false, weapon: { name: 'Shotgun', ambiguous: false, pickup: true } };
  const h = finalHitLine({ killedBy: { num: 19 }, lastLife: life({ finalHit: fh }) });
  assert.equal(txt(h), 'SHOTGUN PICKUP CRIT');
  assert.deepEqual(said(h), ['killed with SHOTGUN, a pickup, a critical hit']);
  assert.doesNotMatch(h, /30/, 'no damage number');
  assert.equal(finalHitLine({ killedBy: { num: 21 }, lastLife: life({ finalHit: fh }) }), '', 'a stale hit from another shooter is not the kill');
  assert.equal(finalHitLine({ killedBy: { num: 0, unknown: true }, lastLife: life({ finalHit: fh }) }), '', 'an unknown killer is a stale latch');
  assert.equal(txt(finalHitLine({ killedBy: { num: 19, dot: true }, lastLife: life({ finalHit: { num: 19, dmg: 4, dot: true, weapon: null } }) })), 'POISON');
  assert.equal(finalHitLine({ killedBy: { num: 19 }, lastLife: life({ finalHit: { ...fh, weapon: null } }) }), '', 'no weapon claim: nothing drawn');
  assert.equal(finalHitLine({ killedBy: { num: 19 }, lastLife: life() }), '');
});

test('callouts: a callout with no value is not drawn; a number that may grow is greyed, never "+"', () => {
  const full = callouts({ lastLife: life({ taken: tk, takenTotal: 60, dealt: dl, dealtTotal: 30, kills: 1, aliveMs: 65000 }) });
  assert.deepEqual(said(full), ['damage taken 60', 'damage dealt 30', 'kills confirmed 1', 'alive 1:05']);
  assert.doesNotMatch(full, /unsure/);
  const part = callouts({ lastLife: life({ taken: tk, takenTotal: 60, dealt: dl, dealtTotal: 30, kills: 2, dealtPartial: true }) });
  assert.deepEqual(said(part).slice(1, 3), ['damage dealt at least 30', 'kills confirmed so far 2']);
  assert.equal((part.match(/co (dl|ki) unsure/g) || []).length, 2);
  assert.doesNotMatch(txt(part), /\+/);
  assert.deepEqual(said(callouts({ lastLife: life({ dealtPartial: true }) })), ['alive 0:00'], 'no taken, no dealt, no confirmed kill yet: only the time alive');
  assert.deepEqual(said(callouts({ lastLife: life({ taken: tk, takenTotal: 60 }) })), ['damage taken 60', 'kills confirmed 0', 'alive 0:00'], 'a final zero kills is a value; no dealt relay is not');
  assert.equal(callouts({ lastLife: null }), '');
});

test('gameNow: an old board keeps its numbers with a short age tag, the phone\'s own clock never goes stale', () => {
  const st = { clockMs: 61000, board: { teams: [{ team_id: 'blue', name: 'BLUE', score: 9 }, { team_id: 'yellow', name: 'YELLOW', score: 7 }], cap: 25 },
    scoreAt: 1, kills: 3, deaths: 2, shots: 40, teamKey: 'blue', mode: 'TDM' };
  assert.equal(txt(gameNow(st, now)), '1:01 BLUE 9 YELLOW 7 /25 3 2');
  const old = gameNow(st, { ...now, stale: true, age: 'AS OF 40 S AGO' });
  assert.equal((old.match(/class="rc stale"/g) || []).length, 2, 'the race and the match line, not the clock');
  assert.match(txt(old), /\/25 40 S AGO .*40 S AGO$/);
  assert.deepEqual(said(gameNow(st, now)), ['time left 1:01', 'your match: 3 kills, 2 deaths']);
});

test('gameNow: FFA gives your place, a hill names its holder, no score push shows only the phone\'s own facts', () => {
  const rows = [{ player_id: 'p2', display: 'VIPER', kills: 9 }, { player_id: 'me', display: 'REAPER', kills: 4 }];
  const ffa = gameNow({ clockMs: 0, mode: 'FFA', scoreRows: rows, scoreAt: 1, player: { player_id: 'me' }, board: { cap: 15 }, kills: 4, deaths: 1 }, now);
  assert.match(txt(ffa), /2ND \/2 VIPER 9/);
  assert.ok(said(ffa).includes('your place 2ND of 2, first to 15'));
  assert.ok(said(gameNow({ clockMs: 0, mode: 'KOTH', hill: { owner: 3 }, deaths: 0 }, now)).includes('hill held by purple'));   // F423: tid 3 paints purple, not green
  assert.ok(said(gameNow({ clockMs: 0, mode: 'KOTH', hill: { owner: 2 }, deaths: 0 }, now)).includes('hill held by nobody'));
  assert.ok(said(gameNow({ clockMs: 0, mode: 'KOTH', hill: null, deaths: 0 }, now)).includes('hill out of range'));
  const old = gameNow({ clockMs: 0, fragLimit: 25, kills: null, deaths: 1, shots: 12 }, now);
  assert.match(txt(old), /FIRST TO 25 1$/);
  assert.ok(said(old).includes('your match: 1 death'));
});
