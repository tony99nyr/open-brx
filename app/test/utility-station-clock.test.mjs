// F590 (3) and F593 (brx2's milestone review, 2026-10-24): the phone hill's clock.
// F590 (3): MC's deadline is relative, so a wall-clock step on the phone must not move the whistle. The station runs its
// 250 ms tick, its sightings and the hill deadline on one wall-anchored monotonic clock (`stationNow`).
// F593: a hill frozen at its whistle and reopened by a same-game lobby or abort config restarts its clock, so its first
// step back does not bank the frozen time.
//
// The harness is the one `utility-hill-clock.test.mjs` uses: just enough browser globals to load the REAL `utility.js`
// in its `?stage` no-radio mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEl } from './_helpers.mjs';

// ---- just enough browser globals to get `utility.js` through module load and `render()` without a
// real DOM. `src/build.js` documents that this tree is meant to load "run straight from source under
// `node --test`"; `utility.js` itself only ever does `document.getElementById`, a few `querySelectorAll`
// selector sweeps (fine to return nothing), `documentElement.dataset`, and plain property writes
// (`.hidden`, `.textContent`, `.value`, `.className`, `.style.setProperty`) -- none of it needs a
// faithful DOM, just objects that don't throw. ----
const elements = new Map();
function elFor(id) { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); }

global.document = { getElementById: elFor, querySelectorAll: () => [], documentElement: { dataset: {} }, activeElement: null };
global.window = {};
// Node >=21 already defines a read-only `navigator` global (its own, unrelated `userAgent` object), so a
// plain assignment throws -- redefine the property instead of setting it.
Object.defineProperty(global, 'navigator', { value: {}, configurable: true });
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
};
// `?stage`: the module's own no-radio harness mode (`DEMO`, computed once at load from `location.search`).
global.location = { search: '?stage', href: 'http://stage/?stage', replace() {} };

// The bottom IIFE starts `setInterval(tick, 250)` and a fake MC transport with its own retry timers --
// irrelevant to what this test checks, but a ref'd timer would keep this test file's process alive past
// its own assertions. unref() so real timer behaviour still runs (the stage socket's handshake included)
// without blocking exit.
const realSetInterval = global.setInterval, realSetTimeout = global.setTimeout;
global.setInterval = (...a) => { const h = realSetInterval(...a); h.unref?.(); return h; };
global.setTimeout = (...a) => { const h = realSetTimeout(...a); h.unref?.(); return h; };

await import('../src/utility.js');
for (const t0 = Date.now(); !global.window?.brxUtility && Date.now() - t0 < 5000;) {
  await new Promise(r => realSetTimeout(r, 5));
}
const api = global.window.brxUtility;
assert.ok(api, 'utility.js did not publish window.brxUtility -- module load itself failed');

const RED = 0;
const hill = { kind: 'control', team: 255, id: 9 };
let game = 60;
const redOnThePoint = () => { api.presence.players = () => [{ id: 4, team: RED, state: 1, present: true, inCircle: true, fading: false }]; };

async function armFresh(extra = {}) {
  await api.applyStationConfig({ ...hill, game: ++game });   // a new game: the point resets, no clock yet
  redOnThePoint();
  await api.applyStationConfig({ ...hill, game, ...extra });
  api.point.owner = RED; api.point.progress = 100;           // RED holds the point, as the Stick tests set it
}

test('F590: a phone clock step forward does not blow the whistle early or bank the time to it', async () => {
  await armFresh({ starts_in_ms: -1_000, ends_in_ms: 30_000 });
  const realNow = Date.now;
  try {
    api.tick(); api.tick();                                    // RED is counted at both ends from here on
    const before = api.point.holdMs[RED] || 0;
    Date.now = () => realNow() + 3_600_000;                    // the phone's wall clock steps forward an hour
    api.tick();
    const banked = (api.point.holdMs[RED] || 0) - before;
    assert.ok(banked < 2_000, `one real tick banked ${banked} ms: the clock step reached the hill`);
    assert.ok(api.settings.hillEndsAt - api.stationNow() > 25_000, 'the whistle moved with the wall clock');
  } finally { Date.now = realNow; }
});

test('F590: a deadline armed after a clock step back still ends on time', async () => {
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - 3_600_000;                    // the phone's wall clock is an hour behind
    await armFresh({ starts_in_ms: -1_000, ends_in_ms: 30_000 });
    const left = api.settings.hillEndsAt - api.stationNow();
    assert.ok(left > 29_000 && left <= 30_000, `the deadline is ${left} ms away on the station clock, not 30 s`);
  } finally { Date.now = realNow; }
});

test('F593: a hill reopened after its whistle by a same-game lobby config restarts its clock', async () => {
  await armFresh({ starts_in_ms: -1_000, ends_in_ms: 30_000 });
  const t0 = api.settings.hillEndsAt - 30_000;
  for (let t = 0; t <= 40_000; t += 250) api.controlTick(t0 + t);   // through the whistle: the point froze at it
  const frozen = api.point.holdMs[RED];
  assert.ok(frozen > 25_000 && frozen <= 31_000, `setup: RED held to the whistle (${frozen})`);
  api.controlTick(t0 + 50_000);
  assert.equal(api.point.holdMs[RED], frozen, 'setup: the point is frozen');
  await api.applyStationConfig({ ...hill, game });              // a same-game lobby or abort re-send: no times
  api.controlTick(t0 + 100_000);
  const banked = api.point.holdMs[RED] - frozen;
  assert.ok(banked <= 1_000, `the first step after the reopen banked ${banked} ms of frozen time`);
  api.controlTick(t0 + 100_250);
  assert.equal(api.point.holdMs[RED] - frozen - banked, 250, 'the reopened point counts on from its restart');
});
