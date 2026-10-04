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

// Round 2 HIGH (review 2026-10-04): `mcArmed` and `live` persist across sessions, so "armed" alone stranded a station
// whose MC came back on a new IP next session (a new hotspot lease). The guard is for a station repointed MID-MATCH:
// in play AND bound to its MC within AUTOJOIN_LOCK_MS. After a longer drop any MC may be joined again.
const MIN = 60 * 1000;
async function sweepOnce(found) {
  let calls = 0;
  api.startLanSweep({ firstDelayMs: 0, sweep: async () => { calls++; return found; } });
  await until(() => calls >= 1 && api.log.some(l => l.includes('FOUND BY SWEEP') && l.includes(found)), 'the sweep to find ' + found);
  await new Promise(r => realSetTimeout(r, 20));
  api.sweeper.stop();
}
function reset() { if (api.transport) api.transport.close(); }

test('mid-match: live, the link down for seconds, a different host is refused', async () => {
  const mine = 'ws://10.0.0.9:8766/ws';
  api.settings.mc = mine; api.settings.mc_auto = true; api.settings.mcArmed = { game: 7 }; api.settings.live = true;
  api.settings.mcLastBoundAt = Date.now() - 5000;
  assert.equal(api.transport, null, 'control: nothing dialled at load');
  const other = 'ws://10.0.0.66:8766/ws';
  await sweepOnce(other);
  assert.ok(!dialled.includes(other), 'another MC is never dialled mid-match');
  assert.ok(api.log.some(l => /not joining/i.test(l) && l.includes(other)), 'and the log says why');
});

test('the same host is always dialled (mid-match, or long after)', async () => {
  for (const ago of [5000, 3 * 60 * MIN]) {
    reset();
    api.settings.mcLastBoundAt = Date.now() - ago;
    const same = `ws://10.0.0.9:${9000 + ago % 997}/ws`;   // the same host on another port is the same MC
    await sweepOnce(same);
    assert.ok(dialled.includes(same), `the same host is dialled (bound ${ago} ms ago)`);
  }
});

test('next session: armed earlier, the link down long ago, a new MC on another host IS dialled', async () => {
  reset();
  api.settings.mcArmed = { game: 7 }; api.settings.live = true;
  api.settings.mcLastBoundAt = Date.now() - 11 * MIN;   // past AUTOJOIN_LOCK_MS: not this match any more
  const fresh = 'ws://10.0.0.123:8766/ws';
  await sweepOnce(fresh);
  assert.ok(dialled.includes(fresh), 'a station armed once is not stranded when its MC comes back on a new IP');
});

test('setting up (not armed): auto-discovery joins any MC, as before', async () => {
  reset();
  api.settings.mcArmed = null; api.settings.mc = ''; api.settings.live = false; api.settings.mcLastBoundAt = Date.now();
  const any = 'ws://10.0.0.88:8766/ws';
  api.startLanSweep({ firstDelayMs: 0, sweep: async () => any });
  await until(() => dialled.includes(any), 'an unarmed station to dial what it found');
  api.sweeper.stop();
});

test('utility.js stamps mcLastBoundAt whenever the link enters or leaves bound', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/utility.js', import.meta.url), 'utf8');
  assert.match(src, /if \(s === 'bound' \|\| was === 'bound'\) \{ settings\.mcLastBoundAt = Date\.now\(\); save\(\); \}/, 'without the stamp the guard cannot tell this match from a later session');
});

test('the mDNS path takes the same in-play rule as the sweep', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/utility.js', import.meta.url), 'utf8');
  const watch = src.slice(src.indexOf("plugins.zeroconf.watch("), src.indexOf("plugins.zeroconf.watch(") + 900);
  assert.match(watch, /if \(!autoJoinAllowed\(url\)\) return;/, 'an mDNS hit on another MC must not be dialled in play either');
});
