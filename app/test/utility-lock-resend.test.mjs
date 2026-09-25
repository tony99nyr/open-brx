// F337 (b): MC re-sends a same-game `station_config` at START, END and RECALL only to move the A58 lock
// (`lock_s`, which a phone station ignores). Each re-send used to restart the phone's advert and close its
// seven-tap drawer. A same-game, same-assignment re-send now leaves both alone; a real change re-arms.
//
// The harness below is the one `utility-exit-guard.test.mjs` documents: just enough browser globals to
// load the REAL `utility.js` in its `?stage` no-radio mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- just enough browser globals to get `utility.js` through module load and `render()` without a
// real DOM. `src/build.js` documents that this tree is meant to load "run straight from source under
// `node --test`"; `utility.js` itself only ever does `document.getElementById`, a few `querySelectorAll`
// selector sweeps (fine to return nothing), `documentElement.dataset`, and plain property writes
// (`.hidden`, `.textContent`, `.value`, `.className`, `.style.setProperty`) -- none of it needs a
// faithful DOM, just objects that don't throw. ----
const elements = new Map();
function makeEl(id) {
  return {
    id, hidden: false, textContent: '', innerHTML: '', className: '', value: '',
    style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, dataset: {},
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  };
}
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
// The IIFE's own awaits (loadPlugins, startScan, the stage handshake) resolve over microtasks/timers
// after the module body finishes evaluating -- give them a moment before touching what it published,
// same as any page that doesn't poke a script until it has finished loading. Uses the REAL (ref'd)
// setTimeout -- the patched one above is unref'd on purpose and must not be what this process waits on,
// or there is nothing left keeping the event loop open for it to ever fire.
// Poll for the published API, not a fixed 50 ms: under CPU load the bootstrap can take longer than any
// fixed wait. The 5 s bound keeps a real load failure fast and clear.
for (const t0 = Date.now(); !global.window?.brxUtility && Date.now() - t0 < 5000;) {
  await new Promise(r => realSetTimeout(r, 5));
}
const api = global.window.brxUtility;
assert.ok(api, 'utility.js did not publish window.brxUtility -- module load itself failed');

const adverts = () => api.log.filter(l => l.includes('stage: pretending to advertise')).length;
let closes = 0;
global.window.brxUtilityGate = { close() { closes++; } };
const arm = { kind: 'respawn', team: 'blue', id: 3, threshold: 0, game: 7, valid_ids: [3], lock_s: 2520 };

test('F337 (b): a same-game re-send that changes only lock_s keeps the advert and the drawer', async () => {
  await api.applyStationConfig(arm);
  const a0 = adverts(), c0 = closes;
  await api.applyStationConfig({ ...arm, lock_s: 750 });   // START: the time left
  await api.applyStationConfig({ ...arm, lock_s: 0 });     // END: unlocked
  assert.equal(adverts(), a0, 'the advert was restarted by a lock-only re-send');
  assert.equal(closes, c0, 'the seven-tap drawer was closed by a lock-only re-send');
  assert.equal(api.settings.game, 7);
});

test('F337 (b): a real change still re-arms: another game, another id, another allow-list', async () => {
  await api.applyStationConfig(arm);
  for (const change of [{ game: 8 }, { game: 8, id: 4 }, { game: 8, id: 4, valid_ids: [3, 4] }]) {
    const a0 = adverts(), c0 = closes;
    await api.applyStationConfig({ ...arm, ...change });
    assert.equal(adverts(), a0 + 1, `the advert restarts for ${JSON.stringify(change)}`);
    assert.equal(closes, c0 + 1, `the drawer closes for ${JSON.stringify(change)}`);
  }
});
