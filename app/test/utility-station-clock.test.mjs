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

test('F590: a phone clock stepped back an hour does not hold the whistle off', async () => {
  await armFresh({ starts_in_ms: -1_000, ends_in_ms: 1_500 });
  const realNow = Date.now;
  try {
    api.tick();
    Date.now = () => realNow() - 3_600_000;                    // the phone's wall clock steps back an hour
    const t0 = realNow();
    // wait for the condition, in real time: the whistle is 1.5 s after arming on any honest clock
    while (!(api.point.at != null && api.point.at >= api.settings.hillEndsAt) && realNow() - t0 < 6_000) {
      api.tick();
      await new Promise(r => realSetTimeout(r, 50));
    }
    assert.ok(api.point.at != null && api.point.at >= api.settings.hillEndsAt, 'the hill was still counting 6 s after a 1.5 s whistle');
    const banked = api.point.holdMs[RED] || 0;
    assert.ok(banked <= 2_000, `the hill banked ${banked} ms in a 1.5 s match`);
  } finally { Date.now = realNow; }
});

test('F590: the station clock follows wall time that runs ahead of it, as after a phone sleep', () => {
  const realNow = Date.now;
  try {
    const before = api.stationNow();
    Date.now = () => realNow() + 60_000;                       // a minute of wall time the monotonic clock did not see
    const after = api.stationNow();
    assert.ok(after - before >= 59_990 && after - before < 61_000, `the station clock moved ${after - before} ms`);
    Date.now = realNow;                                        // wall time "falls back" behind it: the station clock holds
    assert.ok(api.stationNow() >= after, 'the station clock went backwards');
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

test('F593: an END and a lobby config with no tick between them still restart the clock', async () => {
  await armFresh({ starts_in_ms: -1_000, ends_in_ms: 30_000 });
  api.controlTick(api.stationNow() - 1_000);                   // one live step, a second before the END: RED is counted
  const held = api.point.holdMs[RED] || 0;
  await api.applyStationConfig({ ...hill, game, ends_in_ms: 0 });   // END: the whistle is now
  await api.applyStationConfig({ ...hill, game });                  // a lobby re-send before any tick stepped to it
  api.controlTick(api.stationNow() + 100_000);                 // the station's next step, much later
  const banked = (api.point.holdMs[RED] || 0) - held;
  assert.ok(banked <= 1_000, `the first step after END and the lobby banked ${banked} ms`);
});
