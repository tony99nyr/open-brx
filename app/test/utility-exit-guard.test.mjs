// Field-safety fix (2026-09-13): a deployed utility station -- a live control point, respawn station,
// whatever kind -- must never show the quick "STUCK? HOLD TO EXIT" control (`#exitHud`, `wireExit()`),
// because that hold is the ONLY guard the handler checks (`if (firing || btn.hidden) return;`
// `src/utility.js`'s `wireExit`). The bug: `render()` hid it on `!!settings.mcArmed` alone, and that flag
// is set ONLY by a Mission Control push (`applyStationConfig`). A station armed BY HAND, behind the
// seven-tap-on-ⓘ gate's own START button -- exactly the path the station warnings promise
// (`docs/platform/modes.md`, `docs/spec/utility.md` §1) -- never touches `mcArmed`, so it kept a
// live, visible one-second hold sitting on the main screen. Using it takes a real objective off the
// field mid-match.
//
// This drives the REAL `render()` path, not a reimplementation of its condition, through the module's
// own `?stage` no-radio harness (the same fast path `tools/stage.mjs` uses in a real browser):
// `startAdvert()`'s `if (DEMO) { advertising = true; ...; return; }` branch flips `advertising` exactly
// the way pressing START in the seven-tap-gated drawer does, with no plugin and no MC involved.
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

test('a station armed BY HAND (advertising, no MC push at all) hides the quick hold-to-exit', async () => {
  await api.stopAdvert();
  api.settings.mcArmed = null;
  api.render();
  assert.equal(elFor('exitHud').hidden, false,
    'an idle, unclaimed phone (never armed, not advertising) is the one case the quick exit exists for');

  await api.startAdvert();   // exactly what the seven-tap-gated drawer's own START button calls
  assert.equal(api.settings.mcArmed, null, 'hand-arming must never touch mcArmed -- that flag is MC-only');
  assert.equal(elFor('exitHud').hidden, true,
    'THE DEFECT: hiding was keyed off settings.mcArmed alone, so a hand-armed, LIVE station kept the ' +
    'hold-to-exit visible -- the only guard the hold handler checks -- one stray hold from leaving the field');

  await api.stopAdvert();
  assert.equal(elFor('exitHud').hidden, false, 'stopped again: back to an unclaimed phone, quick exit returns');
});

test('an MC-armed station keeps hiding it too (unchanged from before this fix)', async () => {
  await api.stopAdvert();
  api.settings.mcArmed = { game: 0, at: Date.now(), valid_ids: null };
  api.render();
  assert.equal(elFor('exitHud').hidden, true, 'MC-arming must still hide the quick exit exactly as before');
  api.settings.mcArmed = null;
  api.render();
});

test('persisted live intent hides the quick exit before native advertising finishes restoring', async () => {
  await api.stopAdvert();
  api.settings.mcArmed = null;
  api.settings.live = true;
  api.render();
  assert.equal(elFor('exitHud').hidden, true,
    'a reloaded hand-armed station must stay guarded while its native advertiser is still starting');
  api.settings.live = false;
  api.render();
});

test('MC-armed AND advertising (the normal deployed case) hides it -- and not through mcArmed alone', async () => {
  api.settings.mcArmed = { game: 0, at: Date.now(), valid_ids: null };
  await api.startAdvert();
  assert.equal(elFor('exitHud').hidden, true);
  await api.stopAdvert();
  api.settings.mcArmed = null;
  api.render();
});

test('F184: BACK TO HUD sends the final live station tally before navigation', async () => {
  await api.startAdvert();
  const order = []; let finalBody = null;
  const realStatus = api.transport.status.bind(api.transport);
  const realReplace = global.location.replace;
  api.transport.status = body => { order.push('status'); finalBody = body; return true; };
  global.location.replace = () => { order.push('navigate'); };
  try { await api.exitToHud(); } finally {
    api.transport.status = realStatus;
    global.location.replace = realReplace;
  }
  assert.deepEqual(order, ['status', 'navigate']);
  assert.equal(finalBody.role, 'utility');
  assert.equal(finalBody.live, true, 'the final status is built before stopAdvert changes live intent');
});

test('F184: BACK TO HUD persists the utility identity proof for the new HUD transport', async () => {
  api.transport.nodeKey = 'utility-proof';
  await api.exitToHud();
  assert.deepEqual(JSON.parse(store.get('brx.prior_utility')), {
    node_id: api.transport.nodeId, node_key: 'utility-proof', mc_url: api.transport.url,
  });
  assert.ok(api.transport.url, 'F346 (d) r1: the proof is bound to the MC url it came from');
});
