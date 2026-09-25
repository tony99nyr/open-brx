// F343(b): the utility screen's MC-join WIRING, driven through the real `utility.js` (the pure halves are in
// utility-sweep.test.mjs). Loaded the way utility-exit-guard.test.mjs loads it: a stub DOM and storage, no
// `?stage` here, so the real `connectMc` and its Transport run against a fake WebSocket that never opens.
// Checked: the typed-address button dials the node url, not the console address; a sweep hit connects
// untrusted; and a sweep hit never replaces a connect already in flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
Object.defineProperty(global, 'navigator', { value: {}, configurable: true });
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
};
global.location = { search: '', href: 'http://localhost/utility.html', replace() {} };

// Every socket the module dials. None of them ever opens, so a connect stays in flight ('connecting').
const dialled = [];
class FakeWebSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.onopen = this.onmessage = this.onerror = this.onclose = null; dialled.push(url); }
  send() {}
  close() { this.readyState = 3; }
}
Object.defineProperty(global, 'WebSocket', { value: FakeWebSocket, configurable: true, writable: true });

const realSetInterval = global.setInterval, realSetTimeout = global.setTimeout;
global.setInterval = (...a) => { const h = realSetInterval(...a); h.unref?.(); return h; };
global.setTimeout = (...a) => { const h = realSetTimeout(...a); h.unref?.(); return h; };

await import('../src/utility.js');
for (const t0 = Date.now(); !global.window?.brxUtility && Date.now() - t0 < 5000;) {
  await new Promise(r => realSetTimeout(r, 5));
}
const api = global.window.brxUtility;
assert.ok(api, 'utility.js did not publish window.brxUtility: module load itself failed');

/** Wait for a condition on the real clock, bounded. */
async function until(fn, what, ms = 3000) {
  for (const t0 = Date.now(); !fn();) {
    if (Date.now() - t0 > ms) assert.fail('timed out waiting for ' + what);
    await new Promise(r => realSetTimeout(r, 5));
  }
}

test('a sweep hit connects UNTRUSTED: it is not saved as the operator\'s address', async () => {
  assert.equal(api.transport, null, 'control: nothing dialled at load (no url, not native)');
  const found = 'ws://10.0.0.9:8766/ws';
  let calls = 0;
  api.startLanSweep({ firstDelayMs: 0, sweep: async () => { calls++; return found; } });
  await until(() => api.transport && api.transport.url === found, 'the sweep hit to be dialled');
  assert.equal(calls, 1);
  assert.equal(api.transport.trusted, false, 'a sweep hit is an untrusted dial, like an mDNS hit');
  assert.equal(api.settings.mc, '', 'an untrusted hit is remembered only after MC welcomes it');
  assert.ok(dialled.includes(found));
  api.sweeper.stop();
});

test('a sweep hit never replaces a connect already in flight', async () => {
  const inFlight = api.transport.url;
  assert.equal(api.transport.state, 'connecting', 'control: the previous dial is still in flight');
  const other = 'ws://10.0.0.77:8766/ws';
  let calls = 0;
  api.startLanSweep({ firstDelayMs: 0, sweep: async () => { calls++; return other; } });
  await until(() => calls === 1 && api.log.some(l => l.includes('FOUND BY SWEEP') && l.includes(other)),
    'the second sweep to find its address');
  assert.equal(api.transport.url, inFlight, 'the in-flight connect must be left alone');
  assert.ok(!dialled.includes(other), 'and the sweep hit must not be dialled');
  api.sweeper.stop();
});

test('a typed http console address dials MC\'s node url, and is saved as that url', async () => {
  elFor('mcUrl').value = 'http://192.168.0.55:8765/';
  elFor('btnMc').onclick();
  const want = 'ws://192.168.0.55:8766/ws';
  await until(() => api.transport && api.transport.url === want, 'the typed address to be dialled');
  assert.equal(api.transport.trusted, true, 'an operator-typed address is a trusted dial');
  assert.equal(api.settings.mc, want, 'the node url is what is redialled on the next start, not the console address');
  assert.equal(api.settings.mc_auto, false);
  assert.ok(dialled.includes(want));
});
