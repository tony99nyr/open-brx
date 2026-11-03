// F658, the static powerup: a powerup station set up once plays every later game with no walk-out, no Wi-Fi and no re-arm,
// as the hill does (utility-hill-follow.test.mjs). It follows the live game of the in-scope players it hears, starts the
// item's clock at the first sighting of a game, and reports it. Loaded the way utility-hill-follow.test.mjs loads the real
// utility.js: a stub DOM and storage, the `?stage` no-radio mode, and the station clock driven by the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEl } from './_helpers.mjs';
import { encodeUuid, decodeUuid } from '../src/beacon.js';

const elements = new Map();
function elFor(id) { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); }
global.document = { getElementById: elFor, querySelectorAll: () => [], documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, activeElement: null };
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

const ITEM = { kind: 'overshield', amount: 50, spawn_every_s: 60, first_at_s: 60, name: 'OVERSHIELD', color: '#3cf' };
const station = { kind: 'powerup', team: 255, id: 6, item: ITEM };
let T = api.stationNow() + 1_000_000;
api.useStationClock(() => T);
// a player advert: alive, the live bit when `live`, the powerup kind bit (4) and station 6's id bit unless told otherwise
const advert = (p) => [encodeUuid({ role: 'player', id: p.id, team: 1, state: 1 | (p.live ? 128 : 0) | (p.ready ? 48 : 0), value: p.ready ? 6 : 0,
  game: p.game, scopeKinds: p.kinds ?? 4, scope: p.scope ?? 1 << 6 })];
function stand(ms, players) {
  for (let k = 0; k < ms; k += 250) { T += 250; for (const p of players) api.onSighting(advert(p), -50, T); api.tick(); }
}
const air = () => decodeUuid(api.stationUuid());

test('a zero scope or another station\'s id bit leaves an unfollowed powerup inert', async () => {
  await api.applyStationConfig({ ...station, game: 50 });
  stand(2000, [{ id: 1, game: 51, live: true, scope: 1 << 7 }, { id: 2, game: 51, live: true, kinds: 0, scope: 0 }]);
  assert.equal(api.statusBody().powerup, undefined, 'no follow mode');
  assert.equal(air().game, 50, 'it still advertises MC\'s game');
  assert.equal(api.pu.available, null, 'and its item is still unknown');
});

test('a live in-scope player of another game: the station follows it, starts the clock at first_at_s and advertises its byte', () => {
  stand(1000, [{ id: 3, game: 51, live: true }]);
  const p = api.statusBody().powerup;
  assert.equal(p.follows, true);
  assert.equal(p.game, 51);
  assert.equal(p.games['51'].available, false);
  assert.ok(p.games['51'].next_ms > 58_000 && p.games['51'].next_ms <= 60_000, `next spawn ${p.games['51'].next_ms}`);
  assert.equal(air().game, 51, 'game-51 phones read this station');
  assert.equal(air().value, 60, 'the countdown to first_at_s');
  assert.equal(JSON.parse(store.get('brx.station.pufollow')).current, 51, 'saved for a restart');
});

test('MC\'s update for its armed game waits while the station follows another; its new arming leaves the item alone', async () => {
  api.applyStationUpdate({ id: 6, available: true, next_spawn_in_ms: 60_000 });
  assert.equal(api.pu.available, false, 'MC armed game 50, the field plays 51');
  await api.applyStationConfig({ ...station, game: 52 });
  api.applyStationUpdate({ id: 6, available: true, next_spawn_in_ms: 60_000 });   // MC's START for game 52
  assert.equal(api.statusBody().powerup.game, 51, 'still the live game');
  assert.equal(api.pu.available, false, 'kept for game 52, not applied to game 51');
});

test('the item spawns on the station\'s own clock and a live player of the game takes it; the next live game starts again', () => {
  stand(60_000, [{ id: 3, game: 51, live: true }]);
  assert.equal(api.pu.available, true);
  stand(500, [{ id: 3, game: 51, live: true, ready: true }]);
  assert.equal(api.pu.taker, 3);
  assert.equal(air().taker, 3);
  stand(1000, [{ id: 3, game: 51, live: false }, { id: 4, game: 53, live: true }]);   // the whistle drops game 51's live bit
  assert.equal(api.statusBody().powerup.game, 53, 'the new live game takes the station');
  assert.equal(api.pu.taker, 0, 'the last game\'s taker is gone');
  assert.equal(air().value, 60, 'the clock starts again at first_at_s');
});

test('review round 1: following into MC\'s armed game from another game applies MC\'s START for it, not a fresh clock', async () => {
  await api.applyStationConfig({ ...station, game: 54 });
  api.applyStationUpdate({ id: 6, available: false, next_spawn_in_ms: 20_000 });   // MC's START for game 54
  assert.equal(api.statusBody().powerup.game, 53, 'still following game 53');
  stand(1000, [{ id: 4, game: 53, live: false }, { id: 5, game: 54, live: true }, { id: 6, game: 54, live: true }]);
  assert.equal(api.statusBody().powerup.game, 54);
  assert.ok(air().value <= 20 && air().value >= 18, `MC's schedule, not first_at_s: ${air().value}`);
});

test('memo fix: a new arming on the same byte forgets MC\'s remembered update, so following into that byte starts at first_at_s', async () => {
  await api.applyStationConfig({ ...station, game: 55 });
  api.applyStationUpdate({ id: 6, available: false, next_spawn_in_ms: 20_000 });   // an old match's START for game 55
  await api.applyStationConfig({ ...station, game: 55 });   // MC restarted and armed game 55 again; its new START is lost
  assert.equal(JSON.parse(store.get('brx.station.pufollow')).mcAnchored, false, 'the saved mark is gone too');
  // 5 s: game 54's last live advert (player 6, the test above) must expire first, or the switch waits for the hold
  stand(5000, [{ id: 5, game: 54, live: false }, { id: 7, game: 55, live: true }, { id: 8, game: 55, live: true }]);
  assert.equal(api.statusBody().powerup.game, 55);
  assert.ok(air().value >= 59, `a fresh clock, not the old match's schedule: ${air().value}`);
});

test('review Low 2: a station that reloads after MC\'s START and before the first sighting keeps MC\'s schedule', async () => {
  const st7 = { ...station, id: 7 };
  await api.applyStationConfig({ ...st7, game: 60 });   // another id: a station that follows nothing yet
  api.applyStationUpdate({ id: 7, available: false, next_spawn_in_ms: 20_000 });   // MC's START for game 60
  // the reload: a fresh utility.js on the same storage
  global.window.brxUtility = undefined;
  await import('../src/utility.js?reload=1');
  for (const t0 = Date.now(); !global.window?.brxUtility && Date.now() - t0 < 5000;) await new Promise(r => realSetTimeout(r, 5));
  const api2 = global.window.brxUtility;
  assert.ok(api2 && api2 !== api, 'the module loaded again');
  api2.useStationClock(() => T);
  for (let k = 0; k < 1000; k += 250) {
    T += 250;
    api2.onSighting([encodeUuid({ role: 'player', id: 9, team: 1, state: 1 | 128, value: 0, game: 60, scopeKinds: 4, scope: 1 << 7 })], -50, T);
    api2.tick();
  }
  assert.equal(api2.statusBody().powerup.game, 60);
  const v = decodeUuid(api2.stationUuid()).value;
  assert.ok(v <= 19 && v >= 18, `MC's schedule, not first_at_s: ${v}`);
});
