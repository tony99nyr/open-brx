// beacon.js — the utility-item UUID codec and the presence tracker (docs/spec/utility.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUuid, decodeUuid, decodeAdvert, Presence, TEAM_ANY, PLAYER_STATE } from '../src/beacon.js';

test('station uuid round-trips every field, and is a well-formed 128-bit uuid', () => {
  const u = encodeUuid({ role: 'station', id: 300, kind: 'respawn', team: 1, state: 1, value: 0, seq: 7, game: 0x5a, threshold: -58 });
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(u.startsWith('4f425258-01'), 'magic OBRX then version 1');
  assert.equal(u, '4f425258-0101-012c-0101-0100075ac600', 'the exact vector mcp/tests/test_beacon.py pins too — the phones and MC must agree byte for byte');
  const d = decodeUuid(u);
  assert.deepEqual(d, { role: 'station', id: 300, kind: 'respawn', team: 1, state: 1, value: 0, seq: 7, game: 0x5a, threshold: -58 });
});

test('player uuid: id is the player_num, kind is null, state carries the alive/intent bits', () => {
  const u = encodeUuid({ role: 'player', id: 19, team: 2, state: PLAYER_STATE.alive | PLAYER_STATE.planting });
  const d = decodeUuid(u);
  assert.equal(d.role, 'player'); assert.equal(d.id, 19); assert.equal(d.kind, null); assert.equal(d.team, 2);
  assert.equal(d.state & PLAYER_STATE.alive, 1); assert.equal(d.state & PLAYER_STATE.planting, 2);
  assert.equal(d.threshold, 0, 'unset threshold reads 0 = use the default');
});

test('decode accepts uppercase (iOS) and dashless forms; rejects foreign uuids and other versions', () => {
  const u = encodeUuid({ role: 'station', id: 1, kind: 'bomb', team: TEAM_ANY });
  assert.deepEqual(decodeUuid(u.toUpperCase()), decodeUuid(u));
  assert.deepEqual(decodeUuid(u.replace(/-/g, '')), decodeUuid(u));
  assert.equal(decodeUuid('6e400001-b5a3-f393-e0a9-e50e24dcca9e'), null, 'the Nordic UART uuid is not ours');
  assert.equal(decodeUuid(u.replace('4f425258-01', '4f425258-02')), null, 'a future version is not decoded by this codec');
  assert.equal(decodeUuid('garbage'), null);
  assert.equal(decodeUuid(u.slice(0, -1) + 'g'), null, 'a non-hex nibble is rejected, not parsed as a smaller value');
  assert.equal(decodeUuid(u + 'ff'), null, 'wrong length is rejected');
  assert.equal(decodeAdvert(['6e400001-b5a3-f393-e0a9-e50e24dcca9e', u]).kind, 'bomb', 'finds ours among several');
  assert.equal(decodeAdvert([]), null);
});

test('threshold encodes negative dBm as int8 and clamps', () => {
  assert.equal(decodeUuid(encodeUuid({ role: 'station', id: 1, kind: 'respawn', threshold: -90 })).threshold, -90);
  assert.equal(decodeUuid(encodeUuid({ role: 'station', id: 1, kind: 'respawn', threshold: -200 })).threshold, -128);
  assert.equal(decodeUuid(encodeUuid({ role: 'station', id: 1, kind: 'respawn', threshold: 0 })).threshold, 0);
});

function station(overrides = {}) { return [encodeUuid({ role: 'station', id: 5, kind: 'respawn', team: 1, state: 1, ...overrides })]; }

test('presence: dwell before present, hysteresis before gone, expiry when silent', () => {
  const p = new Presence({ dwellMs: 2000, hysteresisDb: 6, expiryMs: 4000, alpha: 1, defaultThreshold: -62 });
  let t = 1000;
  p.observe(station(), -50, t); p.tick(t);
  assert.equal(p.stations()[0].present, false, 'strong on first sight is not yet present (dwell)');
  t += 1000; p.observe(station(), -50, t); p.tick(t);
  assert.equal(p.stations()[0].present, false, '1 s above: still dwelling');
  t += 1100; p.observe(station(), -50, t); p.tick(t);
  assert.equal(p.stations()[0].present, true, '2.1 s above: present');
  t += 500; p.observe(station(), -65, t); p.tick(t);
  assert.equal(p.stations()[0].present, true, '3 dB under the threshold is inside the hysteresis band: still present');
  t += 500; p.observe(station(), -70, t); p.tick(t);
  assert.equal(p.stations()[0].present, false, '8 dB under: gone');
  t += 500; p.observe(station(), -50, t); p.tick(t); t += 2100; p.observe(station(), -50, t); p.tick(t);
  assert.equal(p.stations()[0].present, true, 'back above for the dwell: present again');
  t += 4100; p.tick(t);
  assert.equal(p.stations()[0].present, false, 'silent for longer than expiry: gone even though the last reading was strong');
  t += 4100; p.tick(t);
  assert.equal(p.stations().length, 0, 'and forgotten after twice the expiry');
});

test('presence: a dip below the threshold restarts the dwell', () => {
  const p = new Presence({ dwellMs: 2000, alpha: 1, defaultThreshold: -62 });
  let t = 0;
  p.observe(station(), -55, t); p.tick(t);
  t += 1500; p.observe(station(), -75, t); p.tick(t);
  t += 1000; p.observe(station(), -55, t); p.tick(t);
  assert.equal(p.stations()[0].present, false, '2.5 s since first sight but the run above was broken');
  t += 2000; p.observe(station(), -55, t); p.tick(t);
  assert.equal(p.stations()[0].present, true);
});

test('presence: the station advertised threshold wins over the default; a neutral station admits every team', () => {
  const p = new Presence({ dwellMs: 0, alpha: 1, defaultThreshold: -62 });
  p.observe(station({ threshold: -45 }), -50, 0); p.tick(0);
  assert.equal(p.stations()[0].present, false, '-50 is under the station-set -45');
  p.observe(station({ threshold: -45 }), -40, 1); p.tick(1);
  assert.equal(p.stations()[0].present, true);
  assert.equal(p.presentStation('respawn', 2), null, 'a team-1 station does not admit team 2');
  assert.equal(p.presentStation('respawn', 1).id, 5);
  p.observe([encodeUuid({ role: 'station', id: 6, kind: 'respawn', team: TEAM_ANY, state: 1 })], -30, 2); p.tick(2);
  assert.equal(p.presentStation('respawn', 2).id, 6, 'neutral admits team 2');
  assert.equal(p.presentStation('bomb', 1), null, 'kind is part of the match');
});

test('presence: EMA smooths, seq/state changes stamp changedAt, other games are ignored', () => {
  const p = new Presence({ alpha: 0.5, game: 7 });
  p.observe(station({ game: 7 }), -40, 0); p.observe(station({ game: 7 }), -60, 1);
  assert.equal(p.stations()[0].rssi, -50, 'half-way after one step at alpha 0.5');
  assert.equal(p.stations()[0].changedAt, undefined);
  p.observe(station({ game: 7, state: 0, seq: 1 }), -60, 2);
  assert.equal(p.stations()[0].changedAt, 2); assert.equal(p.stations()[0].state, 0);
  assert.equal(p.observe(station({ game: 9 }), -30, 3), null, 'another game');
  assert.equal(p.observe(station({ game: 0 }), -30, 3).id, 5, 'game 0 = any game');
});
