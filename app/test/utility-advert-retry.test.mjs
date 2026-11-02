// F648 (game 2026-11-01, issue 7): a phone hill out of MC range "simply stopped functioning". `startAdvert()`'s catch set
// `settings.live = false`, and the hill tick retries a dropped advert only while `settings.live` is true. A hill
// re-keys its advert about once a second, so ONE failed re-key took it off the air for the rest of the match, with
// no MC to re-arm it. A failed start must keep the operator's intent; only a station that never got on air stays off.
// Loaded the way utility-diag.test.mjs loads it: a stub DOM and storage, the beacon plugin faked through the seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEl } from './_helpers.mjs';

const elements = new Map();
function elFor(id) { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); }
global.document = { getElementById: elFor, querySelectorAll: () => [], documentElement: { dataset: {} }, activeElement: null };
global.window = {};
Object.defineProperty(global, 'navigator', { value: {}, configurable: true });
const store = new Map();
global.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } };
global.location = { search: '', href: 'http://localhost/utility.html', replace() {} };
class FakeWebSocket { constructor() { this.readyState = 0; } send() {} close() {} }
Object.defineProperty(global, 'WebSocket', { value: FakeWebSocket, configurable: true, writable: true });
const realSetInterval = global.setInterval, realSetTimeout = global.setTimeout;
global.setInterval = (...a) => { const h = realSetInterval(...a); h.unref?.(); return h; };
global.setTimeout = (...a) => { const h = realSetTimeout(...a); h.unref?.(); return h; };

await import('../src/utility.js');
for (const t0 = Date.now(); !global.window?.brxUtility && Date.now() - t0 < 5000;) await new Promise(r => realSetTimeout(r, 5));
const api = global.window.brxUtility;
assert.ok(api, 'utility.js did not publish window.brxUtility');

// Each tick a step further ahead than the last: the retry back-off remembers the last retry's time across tests.
let ahead = 0;
const later = () => api.stationNow() + (ahead += 5000);

/** A beacon plugin whose `start` fails while `broken` is set: a throw, or `{advertising: false}`. */
function fakeBeacon() {
  const b = { broken: null, starts: 0 };
  b.start = async () => {
    b.starts++;
    if (b.broken === 'throw') throw new Error('ADVERTISE_FAILED_INTERNAL_ERROR');
    return { advertising: b.broken !== 'refused', txPowerControl: true };
  };
  b.stop = async () => {};
  return b;
}

for (const mode of ['throw', 'refused']) {
  test(`a live hill whose re-key fails (${mode}) stays live and is back on air after the next tick`, async () => {
    const beacon = fakeBeacon();
    api.plugins.beacon = beacon;
    api.settings.kind = 'control';
    await api.startAdvert();
    assert.equal(api.settings.live, true, 'the hill is on air');

    beacon.broken = mode;
    await api.startAdvert(true);   // the once-a-second progress re-key, failing
    assert.equal(api.settings.live, true,
      'THE DEFECT: one failed re-key cleared the operator\'s intent, so the tick never retried and the hill went dark');

    beacon.broken = null;
    const before = beacon.starts;
    api.controlTick(later());   // past the 1 s retry back-off
    for (const t0 = Date.now(); beacon.starts === before && Date.now() - t0 < 2000;) await new Promise(r => realSetTimeout(r, 5));
    await new Promise(r => realSetTimeout(r, 5));
    assert.ok(beacon.starts > before, 'the tick retried the advert');
    assert.equal(api.statusBody().live, true, 'MC hears the hill is on air again');
    await api.stopAdvert();
  });
}

test('a station whose FIRST start fails stays off (it never got on air, so it keeps its exit)', async () => {
  const beacon = fakeBeacon();
  api.plugins.beacon = beacon;
  await api.stopAdvert();
  assert.equal(api.settings.live, false);
  beacon.broken = 'throw';
  await api.startAdvert();
  assert.equal(api.settings.live, false, 'no intent was ever on air: nothing to retry');
  api.render();
  assert.equal(elFor('exitHud').hidden, false, 'the quick exit stays for a phone that never went live');
});

test('STOP still takes the hill off the air for good', async () => {
  const beacon = fakeBeacon();
  api.plugins.beacon = beacon;
  api.settings.kind = 'control';
  await api.startAdvert();
  await api.stopAdvert();
  const before = beacon.starts;
  api.controlTick(later());
  await new Promise(r => realSetTimeout(r, 20));
  assert.equal(beacon.starts, before, 'an operator stop is not retried');
  assert.equal(api.settings.live, false);
});

test('a live hill whose radio is retrying still offers STOP, and STOP takes it off the air', async () => {
  const beacon = fakeBeacon();
  api.plugins.beacon = beacon;
  api.settings.kind = 'control';
  await api.startAdvert();
  beacon.broken = 'throw';
  await api.startAdvert(true);
  api.render();
  assert.equal(api.settings.live, true);
  assert.equal(elFor('btnStart').textContent, 'STOP', 'the operator can still stop a hill that is retrying');
  await elFor('btnStart').onclick();
  assert.equal(api.settings.live, false, 'STOP clears the intent, so the tick stops retrying');
});
