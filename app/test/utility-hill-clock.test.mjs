// F337 (b): MC re-sends a same-game `station_config` at START, END and RECALL only to move the A58 lock
// (`lock_s`, which a phone station ignores). Each re-send used to restart the phone's advert and close its
// seven-tap drawer. A same-game, same-assignment re-send now leaves both alone; a real change re-arms.
//
// The harness below is the one `utility-exit-guard.test.mjs` documents: just enough browser globals to
// load the REAL `utility.js` in its `?stage` no-radio mode.
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

// F386 phone twin (A68): a phone hill counts only between MC's go-live and its deadline, as the Stick's does. F555 scores
// the hill on this tally, so lobby and countdown presence must never reach it (brx3's F555 review).
const RED = 0;
const hill = { kind: 'control', team: 255, id: 9 };
let game = 40;
const redOnThePoint = () => { api.presence.players = () => [{ id: 4, team: RED, state: 1, present: true, inCircle: true, fading: false }]; };

async function armFresh(extra = {}) {
  await api.applyStationConfig({ ...hill, game: ++game });   // a new game: the point resets, no clock yet
  redOnThePoint();
  return api.applyStationConfig({ ...hill, game, ...extra });
}

test('the countdown wipes what the lobby counted, and the point waits for go-live', async () => {
  await api.applyStationConfig({ ...hill, game: ++game });
  redOnThePoint();
  const t0 = Date.now();
  for (let t = 0; t <= 15_000; t += 250) api.controlTick(t0 + t);   // RED stands on it in the lobby and takes it
  assert.ok(api.point.owner === RED && api.point.holdMs[RED] > 0, 'setup: the lobby counted');
  await api.applyStationConfig({ ...hill, game, starts_in_ms: 5_000, ends_in_ms: 65_000 });   // START
  const now = Date.now();
  assert.deepEqual(api.point.holdMs, {}, 'the lobby hold survived START');
  assert.equal(api.point.progress, 0);
  api.controlTick(now + 1_000); api.controlTick(now + 4_000);
  assert.equal(api.point.progress, 0, 'the point built in the countdown');
  api.controlTick(now + 5_500); api.controlTick(now + 6_500);
  // the first live step counts from go-live (now + 5 s), as the Stick anchors it: 1.5 s builds 15%
  assert.ok(Math.abs(api.point.progress - 15) < 0.05,   // a ms of real clock between the arming and `now`
    `1.5 s live builds 15%: ${api.point.progress}`);
});

test('a LIVE re-send keeps the count, and the deadline freezes it at the whistle', async () => {
  await armFresh({ starts_in_ms: -1_000, ends_in_ms: 30_000 });
  const now = Date.now();
  for (let t = 0; t <= 12_000; t += 250) api.controlTick(now + t);   // RED takes it at 10 s
  const held = api.point.holdMs[RED];
  assert.ok(held > 0 && api.point.owner === RED, 'setup: RED holds it');
  await api.applyStationConfig({ ...hill, game, starts_in_ms: -1_000, ends_in_ms: 30_000 });   // START re-sent in LIVE (same clock)
  assert.equal(api.point.holdMs[RED], held, 'a LIVE re-send wiped the count');
  for (let t = 12_250; t <= 40_000; t += 250) api.controlTick(now + t);
  const atWhistle = api.point.holdMs[RED];
  assert.ok(Math.abs(atWhistle - (30_000 - 10_000)) <= 1_000, `RED banks to the whistle and no further: ${atWhistle}`);
  api.controlTick(now + 60_000);
  assert.equal(api.point.holdMs[RED], atWhistle);
});

test('an END (ends_in_ms 0) freezes the point now; a config with no timing counts as before', async () => {
  await armFresh({ starts_in_ms: -1_000, ends_in_ms: 600_000 });
  const now = Date.now();
  for (let t = 0; t <= 12_000; t += 250) api.controlTick(now + t);
  await api.applyStationConfig({ ...hill, game, ends_in_ms: 0 });
  const frozen = api.point.holdMs[RED] || 0;
  api.controlTick(Date.now() + 5_000); api.controlTick(Date.now() + 9_000);
  assert.ok((api.point.holdMs[RED] || 0) - frozen <= 300, 'the point banked after END');
  // CONTROL: a hill with no match clock at all (an old MC, an adopted match) still counts
  await api.applyStationConfig({ ...hill, game: ++game });
  redOnThePoint();
  const t1 = Date.now();
  for (let t = 0; t <= 12_000; t += 250) api.controlTick(t1 + t);
  assert.ok(api.point.holdMs[RED] > 0, 'a hill with no clock stopped counting');
});


test('a late END never moves a whistle that has passed, and a START with no deadline clears the old one', async () => {
  // `applyStationConfig` reads Date.now(), so the arming times are driven by a fake clock here
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  try {
    const t0 = clock;
    await armFresh({ starts_in_ms: -1_000, ends_in_ms: 20_000 });
    for (let t = 0; t <= 25_000; t += 250) api.controlTick(t0 + t);   // RED takes it at 10 s; the whistle at 20 s
    const atWhistle = api.point.holdMs[RED];
    clock = t0 + 25_000;
    await api.applyStationConfig({ ...hill, game, ends_in_ms: 0 });     // MC's END, 5 s after the whistle
    for (let t = 25_250; t <= 32_000; t += 250) api.controlTick(t0 + t);
    assert.equal(api.point.holdMs[RED], atWhistle, 'the END moved the whistle on');
    // the next game's START with no deadline (an untimed KOTH), on a phone that missed the lobby config
    clock = t0 + 40_000;
    await api.applyStationConfig({ ...hill, game: ++game, starts_in_ms: -1_000 });
    redOnThePoint();
    assert.equal(api.settings.hillEndsAt, null);
    for (let t = 40_000; t <= 52_000; t += 250) api.controlTick(t0 + t);
    assert.ok(api.point.holdMs[RED] > 0, 'an untimed match froze on a stale deadline');
  } finally {
    Date.now = realNow;
  }
});

test('F557: a steady hold is saved as it grows, not only when the advert changes', async () => {
  await armFresh({ starts_in_ms: -1_000, ends_in_ms: 600_000 });
  const now = Date.now();
  for (let t = 0; t <= 30_000; t += 250) api.controlTick(now + t);
  const saved = JSON.parse(localStorage.getItem('brx.station.control'));
  const held = api.point.holdMs[RED];
  assert.ok(held > 15_000, `setup: ${held}`);
  assert.ok(held - (saved.holdMs?.[RED] ?? 0) <= 2_250, `the saved hold lags by more than the throttle: ${JSON.stringify(saved.holdMs)} vs ${held}`);
});


test('a START with no tick before go-live still counts from go-live', async () => {
  await armFresh({ starts_in_ms: -1_000, ends_in_ms: 600_000 });
  const t0 = Date.now();
  for (let t = 0; t <= 4_000; t += 250) api.controlTick(t0 + t);   // RED builds 40% before the next match
  await api.applyStationConfig({ ...hill, game: ++game });
  redOnThePoint();
  await api.applyStationConfig({ ...hill, game, starts_in_ms: 5_000, ends_in_ms: 600_000 });
  const now = Date.now();
  api.controlTick(now + 5_100);                                      // the first tick lands 0.1 s after go-live
  assert.ok(Math.abs(api.point.progress - 1) < 0.05, `0.1 s from go-live builds 1%: ${api.point.progress}`);
});


test('F558: status.control carries the inputs: net, counts and lead', async () => {
  await armFresh({ starts_in_ms: -1_000, ends_in_ms: 600_000 });
  const now = Date.now();
  for (let t = 0; t <= 2_000; t += 250) api.controlTick(now + t);
  const c = api.statusBody().control;
  assert.equal(c.net, 1);
  assert.deepEqual(c.counts, { [RED]: 1 });
  assert.equal(c.lead, RED);
  api.presence.players = () => [];
  api.controlTick(now + 2_250);
  const empty = api.statusBody().control;
  assert.equal(empty.net, 0);
  assert.deepEqual(empty.counts, {});
  assert.equal(empty.lead, null, 'nobody counted: no lead');
});
