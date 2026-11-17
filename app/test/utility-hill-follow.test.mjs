// F658, the static hill (field game 2026-11-01): a phone hill out of Wi-Fi range missed MC's arming for the next game,
// kept its old game byte and ignored every player of the new game all match. A hill now follows the newest LIVE game it
// hears (the player advert's live bit, 128), whatever MC last armed it with. Loaded the way utility-hill-clock.test.mjs
// loads the real utility.js: a stub DOM and storage, the `?stage` no-radio mode, and the station clock driven by the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEl } from './_helpers.mjs';
import { encodeUuid, decodeUuid } from '../src/beacon.js';

const elements = new Map();
function elFor(id) { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); }
global.document = { getElementById: elFor, querySelectorAll: () => [], documentElement: { dataset: {} }, activeElement: null };
global.window = {};
Object.defineProperty(global, 'navigator', { value: {}, configurable: true });
const store = new Map();
global.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } };
global.location = { search: '?stage', href: 'http://stage/?stage', replace() {} };
const realSetInterval = global.setInterval, realSetTimeout = global.setTimeout;
global.setInterval = (...a) => { const h = realSetInterval(...a); h.unref?.(); return h; };
global.setTimeout = (...a) => { const h = realSetTimeout(...a); h.unref?.(); return h; };

await import('../src/utility.js');
for (const t0 = Date.now(); !global.window?.brxUtility && Date.now() - t0 < 5000;) await new Promise(r => realSetTimeout(r, 5));
const api = global.window.brxUtility;
assert.ok(api, 'utility.js did not publish window.brxUtility');

const RED = 0, BLUE = 1, hill = { kind: 'control', team: 255, id: 9 };
let T = api.stationNow() + 1_000_000;
api.useStationClock(() => T);
const advert = (p) => [encodeUuid({ role: 'player', id: p.id, team: p.team, state: 1 | (p.live ? 128 : 0), game: p.game, scopeKinds: p.kinds ?? 1, scope: p.scope ?? 1 << 9 })];
/** `ms` of 250 ms ticks with every player in `players` heard strongly on each one. */
function stand(ms, players) {
  for (let k = 0; k < ms; k += 250) { T += 250; for (const p of players) api.onSighting(advert(p), -50, T); api.tick(); }
}
const airGame = () => decodeUuid(api.stationUuid()).game;

test('A86: players whose scope does not name this control station never count and never start follow mode', async () => {
  await api.applyStationConfig({ ...hill, game: 50 });
  stand(3000, [{ id: 1, team: RED, game: 50, live: true, scope: 1 << 8 }, { id: 2, team: BLUE, game: 50, live: true, kinds: 2 },
    { id: 5, team: RED, game: 50, live: true, kinds: 0, scope: 0 }]);
  assert.equal(api.statusBody().control.follows, undefined, 'another station\'s id bit, the respawn bit alone and a zero scope: inert');
  assert.equal(api.point.progress, 0);
  assert.equal(api.point.contested, false);
});

test('fallback: with no live-bit player heard the hill counts its MC-armed game only, as before', async () => {
  await api.applyStationConfig({ ...hill, game: 50 });
  stand(3000, [{ id: 1, team: RED, game: 50 }, { id: 2, team: BLUE, game: 51 }]);
  const c = api.statusBody().control;
  assert.equal(c.follows, undefined, 'no follow mode without a live bit');
  assert.equal(c.game, 50);
  assert.equal(api.point.contested, false, 'a game-51 player never contests a game-50 hill');
  assert.ok(api.point.progress > 20, `red of game 50 builds: ${api.point.progress}`);
  assert.equal(airGame(), 50);
});

test('a live player of another game: the hill follows it, counts at once whatever MC\'s window says, and advertises its byte', async () => {
  await api.applyStationConfig({ ...hill, game: 40, starts_in_ms: 600_000, ends_in_ms: 1_200_000 });   // MC: go-live in 10 min
  stand(3000, [{ id: 3, team: RED, game: 41, live: true }]);
  const c = api.statusBody().control;
  assert.equal(c.follows, true);
  assert.equal(c.game, 41, 'the heartbeat names the followed game');
  assert.ok(c.games && c.games['41'], 'the ring summary carries game 41');
  assert.ok(api.point.progress > 20, `the live bit, not MC's window, decides when the hill counts: ${api.point.progress}`);
  assert.equal(airGame(), 41, 'the advert carries the followed byte, so game-41 phones read this hill');
  assert.equal(JSON.parse(store.get('brx.station.hillring')).follows, true, 'the ring is saved for a restart');
});

test('at the whistle the bit drops and nothing counts; the next live game takes over with a fresh point', () => {
  const before = api.point.progress;
  stand(1000, [{ id: 3, team: RED, game: 41, live: false }]);
  assert.ok(api.point.progress <= before, 'a player off the live bit builds nothing');
  stand(2000, [{ id: 4, team: BLUE, game: 42, live: true }]);
  assert.equal(airGame(), 42);
  assert.equal(api.point.capturing, BLUE, 'blue of game 42 builds its own point');
  const g = api.statusBody().control.games;
  assert.deepEqual(Object.keys(g).sort(), ['41', '42'], 'game 41 keeps its tally in the ring');
});

test('an MC arming for a new game does not wipe a following hill\'s point', async () => {
  const progress = api.point.progress;
  await api.applyStationConfig({ ...hill, game: 43, starts_in_ms: 5_000, ends_in_ms: 60_000 });
  assert.equal(api.point.progress, progress, 'the ring and the live bit decide, not the arming');
  assert.equal(api.statusBody().control.follows, true);
});

test('F658 review: MC re-arms a following hill as another id: the point and the ring go, as on the Stick', async () => {
  await api.applyStationConfig({ ...hill, game: 60 });
  stand(250, [{ id: 4, team: BLUE, game: 42, live: false }]);   // the whistle of game 42 (the test above)
  stand(8000, [{ id: 3, team: RED, game: 61, live: true }]);
  assert.equal(api.statusBody().control.follows, true);
  assert.equal(api.statusBody().control.game, 61);
  assert.ok(api.point.progress > 20, `red builds: ${api.point.progress}`);
  assert.ok(api.log.some(l => /F658: following game 61\b/.test(l)), 'the switch log names the game it follows (review r2)');
  assert.ok(!api.log.some(l => /following game undefined/.test(l)));
  await api.applyStationConfig({ ...hill, id: 10, game: 60 });
  const c = api.statusBody().control;
  assert.equal(c.follows, undefined, 'a new id follows nothing yet');
  assert.equal(api.point.progress, 0);
  assert.deepEqual(api.point.holdMs, {});
  await api.applyStationConfig({ ...hill, game: 60 });   // back to id 9 for the tests after this one
});

test('MC END for the followed game ends it at MC\'s whistle on a hill that heard no phone at END; MC END for another game does not', async () => {
  await api.applyStationConfig({ ...hill, game: 74 });
  stand(15000, [{ id: 3, team: RED, game: 75, live: true }]);
  assert.equal(airGame(), 75);
  assert.equal(api.point.owner, RED, 'red owns game 75');
  await api.applyStationConfig({ ...hill, game: 74, ends_in_ms: 0 });   // the wire shape MC sends: no start
  stand(1000, [{ id: 3, team: RED, game: 75, live: true }, { id: 5, team: BLUE, game: 75, live: true }]);
  assert.equal(api.point.contested, true, "MC's END for game 74 says nothing about game 75");
  // MC's START for game 75 with a whistle 5 s from now; everyone walks out of earshot, still live
  await api.applyStationConfig({ ...hill, game: 75, starts_in_ms: -16000, ends_in_ms: 5000 });
  stand(5000, []);
  const ownAtWhistle = api.point.ownMs[RED];
  stand(30000, []);   // the hill misses END: red's empty hill keeps banking
  assert.ok(api.point.ownMs[RED] > ownAtWhistle + 20000);
  await api.applyStationConfig({ ...hill, game: 75, ends_in_ms: 0 });   // 30 s late, a reconnect in the recap
  stand(1000, []);
  assert.ok(Math.abs(api.point.ownMs[RED] - ownAtWhistle) <= 250, 'the game ends at MC\'s whistle: the recap delay is not possession');
  const own = api.point.ownMs[RED];
  stand(20000, [{ id: 5, team: BLUE, game: 75, live: true }]);
  assert.equal(api.point.owner, RED, 'blue, still live in the ended game, drains nothing');
  assert.equal(api.point.progress, 100);
  assert.equal(api.point.ownMs[RED], own, 'the ended game banks no more');
  stand(3000, [{ id: 6, team: BLUE, game: 76, live: true }]);
  assert.equal(airGame(), 76, 'the next live game takes the hill');
  assert.equal(api.point.capturing, BLUE, 'and counts at once');
  await api.applyStationConfig({ ...hill, id: 10, game: 77 });   // another id forgets every game, for the tests after this one
  await api.applyStationConfig({ ...hill, game: 77 });
});

test('bench H6: once the followed game ends here, a phone that missed END builds nothing until another live game takes the hill', async () => {
  await api.applyStationConfig({ ...hill, game: 70 });
  stand(15000, [{ id: 3, team: RED, game: 71, live: true }]);
  assert.equal(api.point.owner, RED, 'red owns game 71');
  stand(1000, [{ id: 3, team: RED, game: 71, live: false }]);   // red's whistle: the game ended at this hill
  const hold = api.point.holdMs[RED];
  stand(20000, [{ id: 3, team: RED, game: 71, live: false }, { id: 5, team: BLUE, game: 71, live: true }]);
  assert.equal(api.point.owner, RED, 'blue, still live in the ended game, drains nothing');
  assert.equal(api.point.progress, 100);
  assert.equal(api.point.contested, false);
  assert.equal(api.point.holdMs[RED], hold);
  stand(3000, [{ id: 6, team: BLUE, game: 72, live: true }]);
  assert.equal(airGame(), 72, 'the next live game takes the hill');
  assert.equal(api.point.capturing, BLUE, 'and counts at once');
});

test('MC arming a new game ends the followed game whose END the hill missed, at MC\'s whistle', async () => {
  await api.applyStationConfig({ ...hill, id: 10, game: 89 });   // another id forgets every game, then MC's game 90
  await api.applyStationConfig({ ...hill, game: 90, starts_in_ms: 0, ends_in_ms: 20000 });
  stand(20000, [{ id: 7, team: RED, game: 90, live: true }]);
  assert.equal(airGame(), 90);
  assert.equal(api.point.owner, RED, 'red owns game 90');
  const ownAtWhistle = api.point.ownMs[RED];
  stand(30000, []);   // red walks out of earshot, still live; the hill misses END
  await api.applyStationConfig({ ...hill, game: 91 });   // MC arms the next game
  stand(1000, []);
  assert.ok(Math.abs(api.point.ownMs[RED] - ownAtWhistle) <= 250, 'game 90 ends at MC\'s whistle, not at the arming');
  stand(3000, [{ id: 8, team: BLUE, game: 91, live: true }]);
  assert.equal(airGame(), 91, 'the next live game takes the hill at once');
  assert.equal(api.point.capturing, BLUE);
});

test('a countdown START for the followed game after it ended here starts a new match on that byte', async () => {
  await api.applyStationConfig({ ...hill, id: 10, game: 89 });
  await api.applyStationConfig({ ...hill, game: 92 });
  stand(20000, [{ id: 12, team: RED, game: 92, live: true }]);
  assert.equal(api.point.owner, RED);
  await api.applyStationConfig({ ...hill, game: 92, ends_in_ms: 0 });   // MC END
  stand(1000, []);
  await api.applyStationConfig({ ...hill, game: 92, starts_in_ms: -5000, ends_in_ms: 60000 });   // a LIVE re-send
  assert.equal(api.point.owner, RED, 'a re-send whose start is past is not a new match');
  await api.applyStationConfig({ ...hill, game: 92, starts_in_ms: 5000, ends_in_ms: 600000 });   // MC reset reused 92
  assert.equal(api.point.owner, 255, 'the new match on byte 92 starts neutral');
  stand(5000, [{ id: 13, team: BLUE, game: 92, live: true }]);
  assert.equal(airGame(), 92);
  assert.equal(api.point.capturing, BLUE, 'and counts at once');
});

test('MC arming another game leaves a game MC did not arm, and a live game before its whistle (a fresh MC resuming)', async () => {
  await api.applyStationConfig({ ...hill, id: 10, game: 89 });
  await api.applyStationConfig({ ...hill, game: 93 });   // MC's game 93; the hill follows game 94
  stand(20000, [{ id: 14, team: RED, game: 94, live: true }]);
  assert.equal(airGame(), 94);
  await api.applyStationConfig({ ...hill, game: 95 });
  stand(3000, [{ id: 14, team: RED, game: 94, live: true }]);
  assert.equal(api.point.owner, RED, 'game 94 was not MC\'s to end');
  const own = api.point.ownMs[RED];
  await api.applyStationConfig({ ...hill, game: 94, starts_in_ms: -20000, ends_in_ms: 600000 });   // MC's 94, whistle ahead
  await api.applyStationConfig({ ...hill, game: 1 });   // a fresh MC re-arms on byte 1 before RESUME MATCH
  stand(3000, [{ id: 14, team: RED, game: 94, live: true }]);
  assert.equal(airGame(), 94);
  assert.ok(api.point.ownMs[RED] > own, 'the live game 94 still banks');
});

test('F670: the phone hill shows MATCH OVER when its followed game ends, as the Stick does, and drops it for the next game', async () => {
  const cpct = document.getElementById('cpct'), html = document.documentElement;
  await api.applyStationConfig({ ...hill, id: 11, game: 90 });   // a new id: a fresh follower
  stand(3000, [{ id: 3, team: RED, game: 91, live: true, scope: 1 << 11 }]);
  api.render();
  assert.notEqual(cpct.textContent, 'MATCH OVER', 'CONTROL: a live followed game is not over');
  assert.notEqual(html.dataset.cstate, 'ended');
  stand(1000, [{ id: 3, team: RED, game: 91, live: false, scope: 1 << 11 }]);   // red's whistle
  api.render();
  assert.equal(cpct.textContent, 'MATCH OVER');
  assert.equal(html.dataset.cstate, 'ended', 'the ring holds still');
  stand(3000, [{ id: 4, team: BLUE, game: 92, live: true, scope: 1 << 11 }]);   // the next game takes the hill
  api.render();
  assert.notEqual(cpct.textContent, 'MATCH OVER', 'a new live game clears it');
});

test('F670: a hill MC armed (not following) shows MATCH OVER at MC\'s END', async () => {
  const cpct = document.getElementById('cpct');
  await api.applyStationConfig({ ...hill, id: 12, game: 95, starts_in_ms: 0, ends_in_ms: 60_000 });
  api.render();
  assert.notEqual(cpct.textContent, 'MATCH OVER', 'CONTROL: before the whistle');
  await api.applyStationConfig({ ...hill, id: 12, game: 95, ends_in_ms: 0 });
  api.render();
  assert.equal(cpct.textContent, 'MATCH OVER');
  await api.applyStationConfig({ ...hill, id: 12, game: 96, starts_in_ms: 3000, ends_in_ms: 60_000 });
  api.render();
  assert.notEqual(cpct.textContent, 'MATCH OVER', 'the next START clears it');
});

test('F670 review: a capture just before MC\'s END does not hide MATCH OVER behind its flash', async () => {
  const cpct = document.getElementById('cpct'), cflash = document.getElementById('cflash');
  await api.applyStationConfig({ ...hill, id: 13, game: 97, starts_in_ms: 0, ends_in_ms: 600_000 });
  stand(30_000, [{ id: 5, team: RED, game: 97, scope: 1 << 13 }]);
  assert.equal(api.point.owner, RED, 'CONTROL: red captured the hill');
  assert.equal(cflash.hidden, false, 'CONTROL: the CAPTURED flash is showing');
  await api.applyStationConfig({ ...hill, id: 13, game: 97, ends_in_ms: 0 });
  api.render();
  assert.equal(cflash.hidden, true, 'the flash goes at the whistle');
  assert.equal(cpct.hidden, false);
  assert.equal(cpct.textContent, 'MATCH OVER');
});

// F677 (2), the Stick's F674 tests (test_link.cpp): a late END with no deadline the phone knows ended the game at
// receipt, so the recap delay counted as possession. The END's `end_age_ms` names MC's whistle.
test('F677: a late END ends the followed game at MC\'s whistle from end_age_ms', async () => {
  await api.applyStationConfig({ ...hill, id: 10, game: 89 });
  await api.applyStationConfig({ ...hill, game: 96 });   // untimed: no deadline
  stand(20000, [{ id: 15, team: RED, game: 96, live: true }]);
  assert.equal(api.point.owner, RED, 'red owns game 96');
  stand(5000, []);   // red walks out of earshot, still live: the hill misses END
  const ownAtWhistle = api.point.ownMs[RED];
  stand(30000, []);
  assert.ok(api.point.ownMs[RED] > ownAtWhistle + 20000, 'setup: the empty hill banks past the whistle');
  await api.applyStationConfig({ ...hill, game: 96, ends_in_ms: 0, end_age_ms: 30000 });   // a reconnect in the recap
  stand(1000, []);
  assert.ok(Math.abs(api.point.ownMs[RED] - ownAtWhistle) <= 250, 'the game ends at MC\'s whistle: the recap delay is not possession');
});

test('F677: a queued END never ends a game after a deadline that has passed, and a negative age is receipt', async () => {
  await api.applyStationConfig({ ...hill, id: 10, game: 89 });
  await api.applyStationConfig({ ...hill, game: 97, starts_in_ms: -1000, ends_in_ms: 30000 });
  stand(30000, [{ id: 16, team: RED, game: 97, live: true }]);
  const ownAtDeadline = api.point.ownMs[RED];
  assert.ok(ownAtDeadline > 10000, `setup: red banked before the deadline (${ownAtDeadline})`);
  stand(10000, []);   // past the deadline, the hill missed END
  await api.applyStationConfig({ ...hill, game: 97, ends_in_ms: 0, end_age_ms: 1000 });   // queued: names t - 1 s
  stand(1000, []);
  assert.ok(Math.abs(api.point.ownMs[RED] - ownAtDeadline) <= 250, 'the game ends at the passed deadline, the earlier time');
  // CONTROL: a negative age is not a time, so an untimed game's END is at receipt, as before
  await api.applyStationConfig({ ...hill, id: 10, game: 89 });
  await api.applyStationConfig({ ...hill, game: 98 });
  stand(20000, [{ id: 17, team: RED, game: 98, live: true }]);
  stand(5000, []);
  const ownAtEnd = api.point.ownMs[RED];
  await api.applyStationConfig({ ...hill, game: 98, ends_in_ms: 0, end_age_ms: -5 });
  stand(1000, []);
  assert.ok(Math.abs(api.point.ownMs[RED] - ownAtEnd) <= 250, 'the END at receipt keeps what was banked up to it');
});

// F677 (1): MC's CLEAR sent a phone station nothing, so it kept advertising its old role. `control{clear_station}` stops
// the advert, unarms and unlocks it, and the phone stays a station (never BACK TO HUD, which is `release_utility`).
test('F677: clear_station stops the advert and unarms the station, and it stays a station', async () => {
  await api.applyStationConfig({ ...hill, id: 10, game: 99, lock_s: 600 });
  await api.startAdvert(true);
  assert.equal(api.statusBody().live, true, 'setup: on air');
  assert.equal(api.statusBody().armed, true, 'setup: MC-armed');
  assert.ok(api.settings.lockUntil > 0, 'setup: locked');
  const clearing = api.clearedByMc();
  assert.equal(api.statusBody().armed, true, 'a beat while the stop is in flight is no proof yet');
  await clearing;
  const st = api.statusBody();
  assert.equal(st.live, false, 'the advert stops');
  assert.equal(st.armed, false, 'unarmed: the beat MC reads as proof');
  assert.equal(api.settings.lockUntil, 0, 'unlocked');
  assert.equal(st.role, 'utility', 'still a station: not BACK TO HUD');
  await api.applyStationConfig({ ...hill, game: 100 });   // a new role arms it again, for the tests after this one
  assert.equal(api.statusBody().armed, true);
});
