// beacon.js — the utility-item UUID codec and the presence tracker (docs/spec/utility.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUuid, decodeUuid, decodeAdvert, Presence, TEAM_ANY, PLAYER_STATE, EXIT_GRACE_MS } from '../src/beacon.js';

test('station uuid round-trips every field, and is a well-formed 128-bit uuid', () => {
  const u = encodeUuid({ role: 'station', id: 300, kind: 'respawn', team: 1, state: 1, value: 0, seq: 7, game: 0x5a, threshold: -58 });
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(u.startsWith('4f425258-01'), 'magic OBRX then version 1');
  assert.equal(u, '4f425258-0101-012c-0101-0100075ac600', 'the exact vector mcp/tests/test_beacon.py pins too — the phones and MC must agree byte for byte');
  const d = decodeUuid(u);
  assert.deepEqual(d, { role: 'station', id: 300, kind: 'respawn', team: 1, state: 1, value: 0, seq: 7, game: 0x5a, threshold: -58, taker: 0 });   // A56: byte 15 is `taker` (0 = none)
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
  // F440: leaving is debounced: 8 dB under is a dip until it has lasted EXIT_GRACE_MS
  assert.equal(p.stations()[0].present, true, '8 dB under for a moment: still present (a dip is not a step out)');
  t += 4100; p.observe(station(), -70, t); p.tick(t);
  assert.equal(p.stations()[0].present, false, '8 dB under for longer than the exit grace: gone');
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

test('X10: a game byte change drops presence learnt under the old byte at once, not after expiryMs', () => {
  const p = new Presence({ dwellMs: 0, game: 7 });
  p.observe(station({ game: 7 }), -40, 0);
  p.observe(station({ id: 6, game: 0 }), -40, 0);
  p.tick(0);
  assert.equal(p.stations().filter(e => e.present).length, 2, 'CONTROL: both stations are present first');
  p.game = 7;                                         // app.js reassigns the same byte on every render
  assert.equal(p.stations().length, 2, 'the same byte again drops nothing');
  p.game = 8;
  p.tick(1);
  assert.deepEqual(p.stations().map(e => e.id), [6], 'the old game station is gone; the any-game one stays');
  assert.equal(p.game, 8);
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

// Bench 2026-10-02: a hill that never counted a RED player left nothing in its log to say whether it had
// HEARD him. `playerEdges` reports each player's present/left edge once, for the station's log.
import { playerEdges } from '../src/beacon.js';
test('playerEdges: one line per presence edge, team 0 included, nothing while steady', () => {
  const pres = new Presence({ dwellMs: 0, game: 7 });
  const mem = new Map();
  const adv = (id, team) => encodeUuid({ role: 'player', id, team, state: PLAYER_STATE.alive, game: 7 });
  pres.observe([adv(1, 0)], -50, 1000); pres.tick(1000);
  assert.deepEqual(playerEdges(pres, mem).map(e => [e.id, e.team, e.present]), [[1, 0, true]], 'red arriving is an edge');
  pres.observe([adv(1, 0)], -50, 1500); pres.tick(1500);
  assert.deepEqual(playerEdges(pres, mem), [], 'steady presence logs nothing');
  pres.tick(1500 + pres.expiryMs + 1);
  assert.deepEqual(playerEdges(pres, mem).map(e => [e.id, e.present]), [[1, false]], 'leaving is an edge');
});

// Bench 2026-10-02 (F440 A/B): the hill heard ONE phone only intermittently, whatever its team. Presence now keeps
// each entry's recent inter-arrival gaps, so a sparse advertiser shows up as numbers, not a guess.
test('Presence keeps each entry\'s recent advert gaps (ms between arrivals), bounded', () => {
  const pres = new Presence({ dwellMs: 0, game: 7 });
  const adv = encodeUuid({ role: 'player', id: 1, team: 0, state: PLAYER_STATE.alive, game: 7 });
  let t = 1000;
  for (const gap of [0, 200, 250, 1800, 220]) { t += gap; pres.observe([adv], -60, t); }
  const e = pres.players()[0];
  assert.deepEqual(e.gaps, [200, 250, 1800, 220], 'one gap per arrival after the first');
  assert.equal(Math.max(...e.gaps), 1800);
  for (let i = 0; i < 40; i++) { t += 100; pres.observe([adv], -60, t); }
  assert.ok(pres.players()[0].gaps.length <= 16, 'bounded');
});

// F440: the player phone logs every advertiser start and stop with WHY, so a phone the hill hears only sometimes
// can be checked for churn (restarts) or a stop it never meant.
import { advertChangeReason } from '../src/beacon.js';
test('advertChangeReason names what changed between two player adverts, and why one stops', () => {
  const u = o => encodeUuid({ role: 'player', id: 1, team: 0, state: PLAYER_STATE.alive, game: 7, ...o });
  assert.equal(advertChangeReason(null, u()), 'first start');
  assert.equal(advertChangeReason(u(), u({ state: 0 })), 'state alive -> down');
  assert.equal(advertChangeReason(u({ state: 0 }), u()), 'state down -> alive');
  assert.equal(advertChangeReason(u(), u({ value: 4 })), 'value 0 -> 4');
  assert.equal(advertChangeReason(u(), u({ team: 1 })), 'team 0 -> 1');
  assert.equal(advertChangeReason(u(), null, { phase: 'idle' }), 'stop: phase idle');
  assert.equal(advertChangeReason(u(), null, { phase: 'live', stations: false }), 'stop: no stations in this game');
  assert.equal(advertChangeReason(u(), null, { phase: 'live', stations: true, num: null }), 'stop: no player number');
});

// F440 uniform advertising: after the scan reopens (a flood close, a BLE hiccup) the player re-asserts its advert,
// because a silent advertiser stop has no callback. `refresh()` makes the same advert due again, once.
import { AdvertGate } from '../src/beacon.js';
test('AdvertGate.refresh: the same advert is due to start again, then settles', () => {
  const g = new AdvertGate({ minStartMs: 0, minValueMs: 0, failBackoffMs: 0 });
  const u = encodeUuid({ role: 'player', id: 1, team: 0, state: PLAYER_STATE.alive, game: 7 });
  assert.equal(g.due(u, 1000), 'start'); g.started(u, 1000);
  assert.equal(g.due(u, 1100), null, 'control: an unchanged advert is not restarted');
  g.refresh();
  assert.equal(g.due(u, 1200), 'start', 'after refresh the same advert is due again');
  g.started(u, 1200);
  assert.equal(g.due(u, 1300), null, 'and settles once restarted');
  const idle = new AdvertGate(); idle.refresh();
  assert.equal(idle.due(null, 0), null, 'refresh on a stopped gate does not invent a stop');
});

// P-M2 (review 2026-10-03): body shadowing. A standing player's own body takes 12 dB off its advert for 2-5 s at a
// time. With a 2.5 s exit grace a player standing 3-6 dB inside the circle dropped 9-19 times in 10 minutes. The
// grace is 4 s, so a shadow of up to about 3.5 s is not a step out. Fails with EXIT_GRACE_MS = 2500.
test('presence: body shadowing of up to 3.5 s never drops a player standing inside the circle', () => {
  const thr = -74;
  for (const inside of [3, 4, 6]) {
    const p = new Presence({ defaultThreshold: thr, dwellMs: 800, alpha: 0.35 });
    const adv = encodeUuid({ role: 'player', id: 9, team: 0, state: PLAYER_STATE.alive, game: 0 });
    const shadows = [2000, 2500, 3000, 3500];   // one every 20 s, cycling through the lengths
    let drops = 0, was = false;
    for (let t = 0; t <= 600000; t += 250) {
      const k = Math.floor(t / 20000), inShadow = t % 20000 >= 10000 && t % 20000 < 10000 + shadows[k % shadows.length];
      const ripple = [0, 1, -1, 0.5][(t / 250) % 4];   // a small steady ripple, no randomness
      p.observe([adv], thr + inside + ripple - (inShadow ? 12 : 0), t); p.tick(t);
      const now = p.players()[0].present;
      if (was && !now) drops++;
      was = now;
    }
    assert.equal(drops, 0, `${inside} dB inside the circle: ${drops} drops in 10 minutes`);
  }
});
