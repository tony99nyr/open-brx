// U-M2 (review 2026-10-03): F443 locks the MC link in play, and auto-discovery must not get round it. With
// `mc_auto` on and the link down on an armed station, a LAN sweep (or mDNS) hit on ANOTHER Mission Control used to be
// dialled, welcomed, saved as `settings.mc`, and its station_config re-armed the station. Armed and not editing, the
// station auto-joins only the SAME MC. Harness: utility-join-wiring.test.mjs (the real utility.js, a fake WebSocket).
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

test('armed: a sweep hit on a different address is not dialled; the same MC is', async () => {
  const mine = 'ws://10.0.0.9:8766/ws';
  api.settings.mc = mine; api.settings.mc_auto = true; api.settings.mcArmed = { game: 7 };
  assert.equal(api.transport, null, 'control: nothing dialled at load');
  const other = 'ws://10.0.0.66:8766/ws';
  let calls = 0;
  api.startLanSweep({ firstDelayMs: 0, sweep: async () => { calls++; return other; } });
  await until(() => calls === 1 && api.log.some(l => l.includes('FOUND BY SWEEP') && l.includes(other)), 'the sweep to find the other MC');
  await new Promise(r => realSetTimeout(r, 20));
  assert.ok(!dialled.includes(other), 'another MC is never dialled while the station is armed');
  assert.ok(api.log.some(l => /not joining/i.test(l) && l.includes(other)), 'and the log says why');
  api.sweeper.stop();
  const moved = 'ws://10.0.0.9:9000/ws';   // the same host on another port is the same MC
  calls = 0;
  api.startLanSweep({ firstDelayMs: 0, sweep: async () => { calls++; return moved; } });
  await until(() => api.transport && api.transport.url === moved, 'the same MC to be dialled');
  api.sweeper.stop();
});

test('setting up (not armed): auto-discovery joins any MC, as before', async () => {
  api.transport.close();
  api.settings.mcArmed = null; api.settings.mc = ''; api.settings.live = false;
  const any = 'ws://10.0.0.88:8766/ws';
  api.startLanSweep({ firstDelayMs: 0, sweep: async () => any });
  await until(() => dialled.includes(any), 'an unarmed station to dial what it found');
  api.sweeper.stop();
});

test('the mDNS path takes the same in-play rule as the sweep', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/utility.js', import.meta.url), 'utf8');
  const watch = src.slice(src.indexOf("plugins.zeroconf.watch("), src.indexOf("plugins.zeroconf.watch(") + 900);
  assert.match(watch, /if \(!autoJoinAllowed\(url\)\) return;/, 'an mDNS hit on another MC must not be dialled in play either');
});
