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
const advert = (p) => [encodeUuid({ role: 'player', id: p.id, team: p.team, state: 1 | (p.live ? 128 : 0), game: p.game })];
/** `ms` of 250 ms ticks with every player in `players` heard strongly on each one. */
function stand(ms, players) {
  for (let k = 0; k < ms; k += 250) { T += 250; for (const p of players) api.onSighting(advert(p), -50, T); api.tick(); }
}
const airGame = () => decodeUuid(api.stationUuid()).game;

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
