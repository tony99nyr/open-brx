// F365 / contracts A67: the phone station's on-station range edit, driven through the real utility.js in its ?stage
// no-radio mode. The browser-global harness below is the one utility-exit-guard.test.mjs documents.
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

// ---- F365 / contracts A67: the phone station's on-station range edit, through the REAL utility.js ----
const { makeEnvelope, encode } = await import('../src/transport/envelope.js');
const { decodeUuid } = await import('../src/beacon.js');
const arm = { kind: 'respawn', team: 'blue', id: 3, game: 9, valid_ids: [3] };
const advertThr = () => decodeUuid(api.stationUuid()).threshold;
const src = f => api.range.src(f);

test('A67: MC\'s threshold 0 is the station\'s own default, and MC is the source', async () => {
  await api.applyStationConfig({ ...arm, threshold: -60, threshold_age_ms: 1000 });
  assert.equal(advertThr(), -60);
  await api.applyStationConfig({ ...arm, threshold: 0, threshold_age_ms: 1000 });
  assert.equal(api.settings.threshold, 0);
  assert.equal(advertThr(), -70, 'a phone respawn station defaults to -70 dBm (F345)');
  assert.equal(src('threshold'), 'mc');
  assert.equal(api.statusBody().threshold_src, 'mc');
});

test('A67: an on-station edit newer than MC\'s value is kept; an older one gives way; no age from MC applies as today', async () => {
  api.stationEdit('threshold', -62);
  assert.equal(advertThr(), -62, 'the edit applies at once: the advert\'s threshold byte');
  await api.applyStationConfig({ ...arm, threshold: -55, threshold_age_ms: 60_000 });
  assert.equal(api.settings.threshold, -62, 'MC\'s value is a minute old, the edit is newer: kept');
  assert.equal(src('threshold'), 'station');
  assert.ok(api.statusBody().threshold_edit_age_ms >= 0);
  await api.applyStationConfig({ ...arm, threshold: -55, threshold_age_ms: 0 });
  assert.equal(api.settings.threshold, -55, 'MC edited just now, after the station: MC applies');
  assert.equal(src('threshold'), 'mc');
  assert.equal('threshold_edit_age_ms' in api.statusBody(), false);
  api.stationEdit('threshold', -66);
  await api.applyStationConfig({ ...arm, threshold: -58 });
  assert.equal(api.settings.threshold, -58, 'an older MC (no threshold_age_ms) applies its value, as before A67');
  assert.equal(src('threshold'), 'mc');
});

test('A67: tx_power: absent keeps the station\'s own; present applies; each field keeps its own edit and source', async () => {
  api.stationEdit('tx_power', 'medium');
  await api.applyStationConfig({ ...arm, threshold: -58 });
  assert.equal(api.settings.tx, 'medium', 'no tx_power from MC: the station keeps its own');
  for (const junk of ['constructor', 'toString', 'HIGH', 7]) {
    await api.applyStationConfig({ ...arm, threshold: -58, tx_power: junk, tx_power_age_ms: 0 });
    assert.equal(api.settings.tx, 'medium', `a junk tx_power (${junk}) is ignored`);
  }
  assert.equal(api.statusBody().tx_power, 'medium');
  api.stationEdit('threshold', -61);
  await api.applyStationConfig({ ...arm, threshold: -50, threshold_age_ms: 60_000, tx_power: 'ultra_low', tx_power_age_ms: 0 });
  assert.equal(api.settings.threshold, -61, 'the radius edit is newer than MC\'s radius: kept');
  assert.equal(api.settings.tx, 'ultraLow', 'MC\'s strength is newer than the station\'s: it applies');
  const st = api.statusBody();
  assert.equal(st.threshold_src, 'station'); assert.equal(st.tx_power_src, 'mc'); assert.equal(st.tx_power, 'ultra_low');
  assert.equal('tx_power_edit_age_ms' in st, false);
});

test('A67 addendum 2: an edit under an A58 lock is marked locked, and the hold needs 5 s, not 1.5 s', async () => {
  await api.applyStationConfig({ ...arm, threshold: -61, threshold_age_ms: 60_000, lock_s: 600 });
  assert.equal(api.a58Locked(), true);
  assert.equal(api.holdMs(), 5000, 'a locked station needs the stronger hold');
  api.stationEdit('threshold', -64);
  const last = api.statusBody().range_edits.at(-1);
  assert.deepEqual([last.field, last.from, last.to, last.locked], ['threshold', -61, -64, true]);
  await api.applyStationConfig({ ...arm, threshold: -64, threshold_age_ms: 60_000, lock_s: 0 });
  assert.equal(api.a58Locked(), false);
  assert.equal(api.holdMs(), 1500);
  api.stationEdit('tx_power', 'high');
  const l2 = api.statusBody().range_edits.at(-1);
  assert.deepEqual([l2.field, l2.from, l2.to, l2.locked], ['tx_power', 'ultra_low', 'high', false]);
});

test('A67: the edit and its log persist (localStorage) for an app restart', () => {
  const saved = JSON.parse(store.get('brx.station.range'));
  assert.equal(saved.f.threshold.src, 'station');
  assert.equal(saved.seq, api.statusBody().range_edits.at(-1).seq);
  assert.ok(saved.f.threshold.at > 0, 'the edit time is stored, so a restart can compute its age');
});

/** A fake MC socket: hello -> welcome, and every frame the station sends is kept. */
function capFactory(sent) {
  return () => {
    const ws = { close() {} };
    ws.send = raw => {
      let env; try { env = JSON.parse(raw); } catch (_) { return; }
      sent.push(env);
      if (env.kind === 'hello') setTimeout(() => { if (ws.onmessage) ws.onmessage({ data: encode(makeEnvelope('welcome', { session_id: 'cap', server_t: Date.now(), seq_hi: 0, node_key: 'cap-key' })) }); }, 0);
    };
    setTimeout(() => { if (ws.onopen) ws.onopen(); }, 0);
    return ws;
  };
}
const until = async (fn, ms = 4000) => { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = fn(); if (v) return v; await new Promise(r => realSetTimeout(r, 5)); } return null; };

test('A67: an edit made offline waits to sync, and the first beat after reconnect reports it (restated every beat)', async () => {
  const s1 = []; api.connectMc('stage://cap1', { wsFactory: capFactory(s1) });
  assert.ok(await until(() => api.transport.state === 'bound'), 'the first socket never bound');
  api.transport.close();
  assert.notEqual(api.transport.state, 'bound');
  api.stationEdit('threshold', -68);
  const seq = api.range.st.seq;
  assert.equal(api.range.pending('threshold'), true, 'offline: SET HERE · WILL SYNC');
  const s2 = []; api.connectMc('stage://cap2', { wsFactory: capFactory(s2) });
  const beats = () => s2.filter(e => e.kind === 'status');
  const first = await until(() => beats()[0]);
  assert.ok(first, 'no heartbeat after the reconnect');
  assert.equal(first.body.threshold, -68);
  assert.equal(first.body.threshold_src, 'station');
  assert.ok(Number.isInteger(first.body.threshold_edit_age_ms) && first.body.threshold_edit_age_ms >= 0);
  assert.equal(first.body.range_edits.at(-1).seq, seq, 'the offline edit rides the FIRST beat');
  assert.equal(api.range.pending('threshold'), false, 'sent: no longer waiting to sync');
  const again = api.statusBody().range_edits;
  assert.deepEqual(again.map(e => e.seq), first.body.range_edits.map(e => e.seq), 'the whole list is restated on the next beat');
  api.transport.close();
});
