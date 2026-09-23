// The DOWN screen's recap (deathscreen.js): what it may and may not say. Pure functions of engine state, so these run
// without a browser; tools/screens.mjs checks the same states on the rendered screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weaponLabel, finalHitLine, lifeLine, tables, gameNow } from '../src/hud/deathscreen.js';

const txt = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const life = (o = {}) => ({ taken: [], dealt: [], takenTotal: 0, dealtTotal: 0, dealtPartial: false, shots: 0, kills: 0, aliveMs: 0, finalHit: null, ...o });
const row = (num, name, dmg, weapons = []) => ({ num, name, teamKey: 'yellow', dmg, hits: 2, weapons });
const W = (name, x = {}) => ({ weapon_id: 'w', name, ambiguous: false, pickup: false, dmg: 1, ...x });
const now = { stale: false, age: 'LIVE', resultRows: r => r };

test('weaponLabel: a name, two candidates with OR, more than two unclear, no claim is nothing', () => {
  assert.equal(weaponLabel(W('Shotgun')), 'SHOTGUN');
  assert.equal(weaponLabel({ ambiguous: true, names: ['SMG', 'USP-S'] }), 'SMG OR USP-S');
  assert.equal(weaponLabel({ ambiguous: true, names: ['A', 'B', 'C'] }), 'WEAPON UNCLEAR');
  assert.equal(weaponLabel({ ambiguous: true }), 'WEAPON UNCLEAR');
  assert.equal(weaponLabel(null), null);
  assert.equal(weaponLabel({ weapon_id: null, name: null, ambiguous: false }), null);
});

test('finalHitLine: the killer\'s last hit, never a hit from someone else', () => {
  const fh = { num: 19, dmg: 30, sensor: 4, crit: true, dot: false, weapon: { name: 'Shotgun', ambiguous: false, pickup: true } };
  assert.equal(txt(finalHitLine({ killedBy: { num: 19 }, lastLife: life({ finalHit: fh }) })), 'SHOTGUN PICKUP · FINAL HIT 30 · ON YOUR GUN · CRIT');
  assert.equal(finalHitLine({ killedBy: { num: 21 }, lastLife: life({ finalHit: fh }) }), '', 'a stale hit from another shooter is not the kill');
  assert.equal(txt(finalHitLine({ killedBy: { num: 19, dot: true }, lastLife: life({ finalHit: { num: 19, dmg: 4, dot: true, weapon: null } }) })), 'POISON · FINAL TICK 4');
  assert.equal(finalHitLine({ killedBy: { num: 19 }, lastLife: life() }), '');
  assert.equal(finalHitLine({ killedBy: { num: 0, unknown: true }, lastLife: life({ finalHit: fh }) }), '', 'an unknown killer is a stale latch: its hit is not the kill');
  assert.match(txt(finalHitLine({ killedBy: { num: 0, unknown: true }, lastLife: life({ finalHit: { ...fh, num: 0, weapon: null } }) })), /^FINAL HIT 30/);
});

test('lifeLine: kills say CONFIRMED, read "at least" while partial, and no accuracy is claimed', () => {
  assert.equal(txt(lifeLine({ lastLife: life({ shots: 8, kills: 1, aliveMs: 65000, dealtTotal: 30 }) })), 'THIS LIFE 01:05 ALIVE · 8 ROUNDS · 1 KILL CONFIRMED');
  assert.equal(txt(lifeLine({ lastLife: life({ shots: 8, kills: 1, dealtPartial: true }) })), 'THIS LIFE 00:00 ALIVE · 8 ROUNDS · 1+ KILLS CONFIRMED');
  assert.equal(txt(lifeLine({ lastLife: life({ shots: 1, dealtPartial: true }) })), 'THIS LIFE 00:00 ALIVE · 1 ROUND · KILLS NOT YET CONFIRMED');
  assert.equal(txt(lifeLine({ lastLife: life({ shots: 3 }) })), 'THIS LIFE 00:00 ALIVE · 3 ROUNDS · 0 KILLS CONFIRMED');
});

test('tables: dealt is never a numeral 0, and a fourth source folds into +N MORE', () => {
  const none = txt(tables({ killedBy: { num: 19 }, lastLife: life() }));
  assert.match(none, /DAMAGE DEALT — NO HITS REPORTED$/);
  assert.doesNotMatch(none, /\b0\b/);
  assert.match(txt(tables({ killedBy: {}, lastLife: life({ dealtPartial: true }) })), /DAMAGE DEALT — NO HITS REPORTED YET$/);
  const four = [row(19, 'A', 40, [W('AR')]), row(20, 'B', 30), row(21, 'C', 20), row(22, 'D', 10)];
  const t = txt(tables({ killedBy: { num: 19 }, lastLife: life({ taken: four, takenTotal: 100 }) }));
  assert.match(t, /^DAMAGE TAKEN 100 A KILLER 40 AR B 30 2 HITS \+2 MORE · 30 /);
  const three = txt(tables({ killedBy: { num: 19 }, lastLife: life({ taken: four.slice(0, 3), takenTotal: 90 }) }));
  assert.doesNotMatch(three, /MORE/);
});

test('gameNow: an old board keeps its numbers with its age, the phone\'s own clock is never marked stale', () => {
  const st = { clockMs: 61000, board: { teams: [{ team_id: 'blue', name: 'BLUE', score: 9 }, { team_id: 'yellow', name: 'YELLOW', score: 7 }], cap: 25 },
    scoreAt: 1, kills: 3, deaths: 2, shots: 40, teamKey: 'blue', mode: 'TDM' };
  const fresh = gameNow(st, now);
  assert.match(txt(fresh), /01:01 TIME LEFT BLUE 9 YELLOW 7 FIRST TO 25 3 KILLS · 2 DEATHS YOUR MATCH$/);
  const old = gameNow(st, { ...now, stale: true, age: 'AS OF 40 S AGO' });
  assert.match(txt(old), /FIRST TO 25 · AS OF 40 S AGO .*YOUR MATCH · AS OF 40 S AGO$/);
  assert.equal((old.match(/rc stale/g) || []).length, 2);
  assert.match(old, /<span class="rc "><span class="rv"><b class="tab">01:01/);
});

test('gameNow: FFA gives your place, a hill names its holder, no score push says only what the phone knows', () => {
  const rows = [{ player_id: 'p2', display: 'VIPER', kills: 9 }, { player_id: 'me', display: 'REAPER', kills: 4 }];
  assert.match(txt(gameNow({ clockMs: 0, mode: 'FFA', scoreRows: rows, scoreAt: 1, player: { player_id: 'me' }, board: { cap: 15 }, kills: 4, deaths: 1 }, now)), /2ND OF 2 · VIPER 9 FIRST TO 15/);
  assert.match(txt(gameNow({ clockMs: 0, mode: 'KOTH', hill: { owner: 3 }, deaths: 0, shots: 0 }, now)), /GREEN HOLDS THE HILL/);
  assert.match(txt(gameNow({ clockMs: 0, mode: 'KOTH', hill: { owner: 2 }, deaths: 0, shots: 0 }, now)), /NEUTRAL THE HILL/);
  assert.match(txt(gameNow({ clockMs: 0, mode: 'KOTH', hill: null, deaths: 0, shots: 0 }, now)), /OUT OF RANGE THE HILL/);
  assert.match(txt(gameNow({ clockMs: 0, fragLimit: 25, kills: null, deaths: 1, shots: 12 }, now)), /25 SCORE CAP 1 DEATH · 12 SHOTS YOUR MATCH$/);
});

test('tables: poison ticks show as ticks on the poisoner\'s row, never as hits', () => {
  const t = txt(tables({ killedBy: { num: 5, dot: true }, lastLife: life({ taken: [{ num: 5, name: 'VENOM', teamKey: 'green', dmg: 29, hits: 1, ticks: 5, weapons: [] }], takenTotal: 29 }) }));
  assert.match(t, /VENOM KILLER 29 1 HIT · POISON ×5/);
});
