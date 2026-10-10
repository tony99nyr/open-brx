// beacon.js — the utility-item UUID codec and the presence tracker (docs/spec/utility.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUuid, decodeUuid, decodeAdvert, Presence, TEAM_ANY, PLAYER_STATE, EXIT_GRACE_MS, SIGHT_RECENT_MAX, SIGHT_WINDOW_MS, thinWindow, timeWeightedMedian, medianOf } from '../src/beacon.js';

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
  // Round 2 (2026-10-04): the exit reads the median of the last 2 s, so the grace runs from when THAT falls below the band
  t += 500; p.observe(station(), -70, t); p.tick(t);
  assert.equal(p.stations()[0].present, true, 'the window median is now under the band: the grace starts');
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
  p.observe(station({ game: 7 }), -40, 0); p.observe(station({ game: 7 }), -60, 250);   // F452(c): alpha is per 250 ms
  assert.equal(p.stations()[0].rssi, -50, 'half-way after one 250 ms step at alpha 0.5');
  assert.equal(p.stations()[0].changedAt, undefined);
  p.observe(station({ game: 7, state: 0, seq: 1 }), -60, 500);
  assert.equal(p.stations()[0].changedAt, 500); assert.equal(p.stations()[0].state, 0);
  assert.equal(p.observe(station({ game: 9 }), -30, 750), null, 'another game');
  assert.equal(p.observe(station({ game: 0 }), -30, 750).id, 5, 'game 0 = any game');
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

// P-L1 (review 2026-10-03) + F452(b): the sighting window holds at most 64 adverts on the phone and on the Stick
// (presence.h SIGHT_RECENT_MAX), thinned evenly across time when it is full, so it always represents the whole 2 s and
// a dense phone reads what the same signal at half the rate reads.
test('presence: a full sighting window is thinned across the 2 s, so a dense phone and its half-rate twin agree', () => {
  const sighted = (below, above, step) => {
    const p = new Presence({ defaultThreshold: -74, dwellMs: 800 });
    const adv = encodeUuid({ role: 'player', id: 5, team: 0, state: PLAYER_STATE.alive, game: 0 });
    let t = 0;
    for (let i = 0; i < below; i++, t += step) p.observe([adv], -90, t);
    for (let i = 0; i < above; i++, t += step) p.observe([adv], -50, t);   // all inside the 2 s window
    return p.players()[0].sightedAt != null;
  };
  assert.equal(sighted(44, 36, 20), false, '36 of 80 are strong: out (the old drop-the-oldest rule read 36 of the last 64: in)');
  assert.equal(sighted(22, 18, 40), false, 'the half-rate twin of the same signal: out');
  assert.equal(sighted(36, 44, 20), true, '44 of 80 are strong: in');
  assert.equal(sighted(18, 22, 40), true, 'the half-rate twin: in');
  assert.equal(SIGHT_RECENT_MAX, 64);
});

// Round 2 MEDIUM (review 2026-10-04): the EMA's alpha is applied per ADVERT, so a sparse phone's EMA lags further and the
// 4 s grace adds on top: a 1/s phone left a sprint-out 1.5 s later than a 4/s phone, a walk-out 3 s later (max 11 s).
// The exit decision reads the median of the last SIGHT_WINDOW_MS of raw samples, so every rate leaves at about the same
// time. Seeded fading (AR(1), sigma 5 dB, tau 2 s) plus 3 dB per-advert noise, as the reviewer's sim (r2sim.mjs). The exit
// is the FIRST step out after the mean crosses the exit level (a later fade spike may sight the player again).
function exitSim({ rate, slopeMsPerDb, seed, presence = {} }) {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const gauss = () => { let u = 0; while (!u) u = rnd(); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const THR = -75, p = new Presence({ defaultThreshold: THR, dwellMs: 800, alpha: 0.35, ...presence });
  const adv = encodeUuid({ role: 'player', id: 1, team: 0, state: PLAYER_STATE.alive, game: 0 });
  const mean = t => (t < 60000 ? -67 : Math.max(-95, -67 - (t - 60000) / slopeMsPerDb));
  let fade = 0, nextAdv = 0, crossAt = null, leftAt = null, was = false;
  for (let t = 0; t < 100000; t += 50) {
    const a = Math.exp(-50 / 2000); fade = a * fade + Math.sqrt(1 - a * a) * 5 * gauss();
    if (crossAt == null && mean(t) < THR - 3) crossAt = t;
    while (nextAdv <= t) { p.observe([adv], Math.round(mean(t) + fade + 3 * gauss()), t); nextAdv += (1000 / rate) * (0.8 + 0.4 * rnd()); }
    if (t % 250 === 0) { p.tick(t); const e = p.players()[0]; const c = !!(e && (e.present || e.inCircle)); if (was && !c && crossAt != null && leftAt == null) leftAt = t; was = c; }
  }
  return leftAt != null && crossAt != null && leftAt > crossAt ? leftAt - crossAt : null;
}
function medianExit(rate, slopeMsPerDb, presence) {
  const xs = []; for (let seed = 1; seed <= 20; seed++) { const x = exitSim({ rate, slopeMsPerDb, seed, presence }); if (x != null) xs.push(x); }
  xs.sort((a, b) => a - b); return xs[xs.length >> 1];
}
test('presence: walking or sprinting out of the circle takes about the same time at every advert rate', () => {
  for (const [name, slope] of [['walk 400 ms/dB', 400], ['sprint 80 ms/dB', 80]]) {
    const m = [0.4, 1, 4].map(rate => medianExit(rate, slope));
    const spread = Math.max(...m) - Math.min(...m);
    assert.ok(spread <= 1500, `${name}: median exits ${m.map(x => (x / 1000).toFixed(1)).join(' / ')} s at 0.4 / 1 / 4 per s (spread ${(spread / 1000).toFixed(1)} s, want <= 1.5 s)`);
  }
});

test('presence: the exit reads the window median, not the EMA (the Stick runs the same numbers, test_presence.cpp)', () => {
  const p = new Presence({ defaultThreshold: -74, dwellMs: 800, alpha: 0.35 });
  const adv = encodeUuid({ role: 'player', id: 4, team: 0, state: PLAYER_STATE.alive, game: 0 });
  let at7500 = false, at8000 = true;
  for (let t = 0; t <= 9000; t += 250) {
    if (t <= 2000) p.observe([adv], -60, t); else if (t % 2500 === 0) p.observe([adv], -84, t);
    p.tick(t);
    if (t === 8250) at7500 = p.players()[0].present;
    if (t === 8500) at8000 = p.players()[0].present;
  }
  assert.equal(at7500, true, 'inside the grace, which starts at 4.5 s: the last advert level (-60) holds until that advert leaves the 2 s window, then the last raw sample (-84) is the level (F452(b) round 3)');
  assert.equal(at8000, false, 'out once the grace has run (the EMA would hold it until about 11.5 s)');
});

// F452(b): a full sighting window is thinned evenly across time, never trimmed from the old end. The same vectors are
// asserted by hardware/m5sticks3/test/test_presence.cpp (`sight_thin_index`), so the two stay one rule.
test('thinWindow: a uniform stream thinned to 64 keeps the whole 2 s at near-uniform spacing', () => {
  let a = [];
  for (let k = 0; k < 100; k++) {
    const before = a.length ? a[a.length - 1].t : null;
    a = thinWindow([...a, { t: k * 20, rssi: -60 }]);
    assert.equal(a[a.length - 1].t, k * 20, 'the newest sample is never dropped');
    assert.equal(a[0].t, 0, 'the oldest sample is never dropped');
    assert.ok(before === null || a.length <= SIGHT_RECENT_MAX);
  }
  assert.equal(a.length, 64);
  assert.equal(a.reduce((m, x) => m + x.t, 0), 63720);   // the exact kept set, shared with the C++ test
  const gaps = a.slice(1).map((x, i) => x.t - a[i].t);
  assert.ok(Math.max(...gaps) <= 2 * 20 && Math.min(...gaps) >= 20, `gaps ${Math.min(...gaps)}..${Math.max(...gaps)} ms`);
  assert.ok(a[63].t - a[0].t >= SIGHT_WINDOW_MS - 40);
});

test('thinWindow: a burst plus a sparse tail keeps the tail', () => {
  const burst = Array.from({ length: 100 }, (_, k) => ({ t: k * 5, rssi: -60 }));
  const tail = Array.from({ length: 6 }, (_, k) => ({ t: 500 + k * 250, rssi: -60 }));
  const a = thinWindow([...burst, ...tail]);
  assert.equal(a.length, 64);
  assert.equal(a.filter(x => x.t >= 500).length, 6, 'every tail sample survives: dropping one would open the biggest hole');
  assert.equal(a[0].t, 0);
  assert.equal(a[a.length - 1].t, 1750);
  assert.equal(a.reduce((m, x) => m + x.t, 0), 20370);
});

test('thinWindow: under the bound it changes nothing, and it never mutates its input', () => {
  const s = Array.from({ length: 10 }, (_, k) => ({ t: k * 100, rssi: -70 }));
  const copy = s.map(x => ({ ...x }));
  assert.deepEqual(thinWindow(s), copy);
  assert.deepEqual(thinWindow(Array.from({ length: 80 }, (_, k) => ({ t: k * 20, rssi: -70 })), 64).length, 64);
  assert.deepEqual(s, copy);
});

// F452(b): the sighting window is read as a TIME-WEIGHTED median. hardware/m5sticks3/test/test_presence.cpp asserts the
// same vectors against `time_weighted_median`.
test('timeWeightedMedian: a weak burst with a longer strong stretch reads strong, whatever the advert count', () => {
  const burst = Array.from({ length: 100 }, (_, k) => ({ t: k * 5, rssi: -90 }));
  const tail = Array.from({ length: 6 }, (_, k) => ({ t: 500 + k * 250, rssi: -50 }));
  assert.equal(timeWeightedMedian([...burst, ...tail], 1750), -50, '100 weak votes cover 0.5 s, 6 strong cover 1.25 s');
  assert.equal(timeWeightedMedian(thinWindow([...burst, ...tail]), 1750), -50, 'and the 64 kept samples say the same');
  const sparse = [...Array.from({ length: 5 }, (_, k) => ({ t: k * 100, rssi: -90 })), ...tail];
  assert.equal(timeWeightedMedian(sparse, 1750), -50);
  // the plain median of the 106 votes is weak: the number of adverts is not what the window says
  assert.equal(medianOf([...burst, ...tail].map(x => x.rssi)), -90);
});

test('timeWeightedMedian: the end adverts cover half a gap at an observe, the middle ones a full gap', () => {
  const three = [{ t: 0, rssi: -50 }, { t: 100, rssi: -90 }, { t: 200, rssi: -60 }];
  assert.equal(timeWeightedMedian(three, 200), -90, 'covers 50 / 100 / 50 ms: the middle one reaches half the total first');
  assert.equal(timeWeightedMedian(three, 250), -60, 'last heard 50 ms ago: covers 50 / 100 / 100 ms');
  // equal spacing and equal covers (a flat run) is the plain median of a flat run
  const flat = Array.from({ length: 9 }, (_, k) => ({ t: k * 100, rssi: -70 }));
  assert.equal(timeWeightedMedian(flat, 800), -70);
});

test('timeWeightedMedian: every cover is clipped to the window, so the newest gets only the time up to now', () => {
  // Codex, F452(b) round 2: a weak advert at 0 and a strong one 1.5 s later: each covers 750 ms, the tie falls to the
  // lower one: weak. (A newest cover that ran past now gave strong.)
  assert.equal(timeWeightedMedian([{ t: 0, rssi: -90 }, { t: 1500, rssi: -50 }], 1500), -90);
  // Opus: at a 1.4 s interval the two adverts each cover 700 ms and the tie falls to the lower one.
  assert.equal(timeWeightedMedian([{ t: 0, rssi: -88 }, { t: 1400, rssi: -72 }], 1400), -88);
  assert.equal(timeWeightedMedian([{ t: 0, rssi: -88 }, { t: 1300, rssi: -72 }], 1300), -88);
});

test('timeWeightedMedian: one sample is itself, the newest holds its level until now, one instant falls back to the plain median', () => {
  assert.equal(timeWeightedMedian([{ t: 500, rssi: -61 }], 1900), -61);
  assert.equal(timeWeightedMedian([], 1000), null);
  const three = [{ t: 0, rssi: -50 }, { t: 500, rssi: -50 }, { t: 1000, rssi: -90 }];
  assert.equal(timeWeightedMedian(three, 1100), -50, 'just heard: the two strong ones cover more of the window');
  assert.equal(timeWeightedMedian(three, 1900), -90, 'the weak sample has held for 1.15 s of the 2 s window by now');
  const instant = [{ t: 50, rssi: -90 }, { t: 50, rssi: -50 }, { t: 50, rssi: -60 }];
  assert.equal(timeWeightedMedian(instant, 50), -60);
});

// F452(c): the entry EMA is time-based (weight 1 - (1 - alpha)^(min(dt, 500 ms) / 250 ms)), so a noisy edge gives about the same
// number of `present` ticks at every advert rate. Mean over 20 seeds of a 60 s walk at mean -75 (the threshold), sigma 4 dB,
// ticks every 250 ms, rates 10 ms to 1.8 s (10 and 50 ms are the rates of the original complaint: main gave 170 ticks at
// 10 ms against 225 at 250 ms). Spread (max - min across rates) over five blocks of 20 seeds: main 55, 48, 77, 55, 42 (min
// 42); this branch 26, 30, 13, 15, 13 (max 30; median 15, the 1-20 block used here is 26). The bound is 35: it fails on main
// with margin in every block and passes on the branch with margin in every block. The shared case file has the step-entry
// sweep (the Stick runs it too).
test('presence: a noisy edge gives about the same present time at every advert rate (time-based EMA, F452(c))', () => {
  const adv = encodeUuid({ role: 'player', id: 1, team: 0, state: PLAYER_STATE.alive, game: 0 });
  const mean = ms => {
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      let s = (seed * 31 + ms) >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
      const g = () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
      const p = new Presence({ defaultThreshold: -75, dwellMs: 800, alpha: 0.35 });
      let k = 0, n = 0;
      for (let t = 0; t <= 60000; t += 250) {
        while (k * ms <= t) { p.observe([adv], Math.round(-75 + 4 * g()), k * ms); k++; }
        p.tick(t);
        if (p.players()[0] && p.players()[0].present) n++;
      }
      total += n;
    }
    return total / 20;
  };
  const m = [10, 50, 100, 250, 500, 1000, 1400, 1800].map(mean);
  const spread = Math.max(...m) - Math.min(...m);
  assert.ok(spread <= 35, `present ticks ${m.map(x => x.toFixed(0)).join(' / ')} at 10 / 50 / 100 / 250 / 500 / 1000 / 1400 / 1800 ms (spread ${spread.toFixed(0)}, want <= 35)`);
});

test('presence: the EMA weight is 1 - (1 - alpha)^(min(dt, 500 ms) / 250 ms), the same numbers the Stick asserts (F452(c))', () => {
  const p = new Presence({});
  const u = encodeUuid({ role: 'player', id: 7, team: 0, state: PLAYER_STATE.alive, game: 0 });
  p.observe([u], -60, 0);
  p.observe([u], -80, 250);
  assert.ok(Math.abs(p.players()[0].rssi - -67) < 1e-9, 'alpha at a 250 ms gap');
  p.observe([u], -50, 750);                                    // a 500 ms gap: 1 - 0.65^2 = 0.5775
  assert.ok(Math.abs(p.players()[0].rssi - (-67 + 0.5775 * 17)) < 1e-9);
  const before = p.players()[0].rssi;
  p.observe([u], -90, 3750);                                   // a 3 s gap is capped at 500 ms
  assert.ok(Math.abs(p.players()[0].rssi - (before + 0.5775 * (-90 - before))) < 1e-9);
});

import { advertNeedsSnapshot } from '../src/beacon.js';
test('advertNeedsSnapshot: only skips when no station is in play AND nothing is on air', () => {
  const idle = new AdvertGate();
  const onAir = new AdvertGate(); onAir.started('4f425258-0201-0001-0100-000000000000', 0);
  assert.equal(advertNeedsSnapshot(false, idle), false, 'no stations, nothing on air: nothing to decide');
  assert.equal(advertNeedsSnapshot(true, idle), true, 'stations in play: the advert may need to start');
  assert.equal(advertNeedsSnapshot(false, onAir), true, 'no stations but on air: the stop is due');
  assert.equal(advertNeedsSnapshot(true, onAir), true);
  const unknown = new AdvertGate(); unknown.started('x', 0); unknown.refresh();
  assert.equal(unknown.last, '?');
  assert.equal(advertNeedsSnapshot(false, unknown), true, 'UNKNOWN counts as on air');
  const failed = new AdvertGate(); failed.failed('start', 0);
  assert.equal(failed.last, '?');
  assert.equal(advertNeedsSnapshot(false, failed), true, 'a failed start leaves UNKNOWN, so a stop is due');
  assert.equal(idle.due(null, 0), null, 'the premise: an idle gate with no want does nothing');
});
