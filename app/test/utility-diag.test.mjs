// Bench 2026-10-02: CDP found an empty `window.brx` on a phone hill that never counted a RED player, so nobody could
// tell whether it had even heard him. The utility page now publishes `window.brx.diag()`: the point, its counts, and
// every player heard (team 0 included), plus a log line on each player's presence edge.
// Loaded the way utility-join-wiring.test.mjs loads it: a stub DOM and storage, no native plugins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUuid, PLAYER_STATE } from '../src/beacon.js';

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

test('window.brx is the utility API on the utility page, with diag()', () => {
  assert.equal(global.window.brx, api, 'the player app\'s name works here too');
  assert.equal(typeof api.diag, 'function');
});

test('diag() lists a RED (tid 0) player the station hears, and the log names the presence edge', async () => {
  api.settings.kind = 'control';
  const game = api.settings.game || 0;
  const adv = encodeUuid({ role: 'player', id: 7, team: 0, state: PLAYER_STATE.alive, game });
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) api.presence.observe([adv], -40, Date.now());
  for (const t1 = Date.now(); Date.now() - t1 < 4000;) {
    const p = api.diag().players.find(x => x.id === 7);
    if (p?.present && api.log.some(l => /player 7 \(RED\) PRESENT/.test(l))) break;
    api.presence.observe([adv], -40, Date.now());
    await new Promise(r => realSetTimeout(r, 50));
  }
  const p = api.diag().players.find(x => x.id === 7);
  assert.ok(p, 'the red player is listed');
  assert.equal(p.team, 0);
  assert.equal(p.present, true, `present after the dwell (waited ${Date.now() - t0} ms)`);
  assert.ok(api.log.some(l => /player 7 \(RED\) PRESENT at -\d+ dBm/.test(l)), `the log names the edge (saw ${JSON.stringify(api.log.slice(-5))})`);
  assert.ok(api.diag().point, 'a control station reports its point');
  const h = api.diag().players.find(x => x.id === 7).gapHistogram;
  assert.ok(h && Object.values(h).reduce((a, b) => a + b, 0) === p.gaps.length, `the gap histogram covers every gap (saw ${JSON.stringify(h)})`);
});
