// Bench 2026-10-02: CDP found an empty `window.brx` on a phone hill that never counted a RED player, so nobody could
// tell whether it had even heard him. The utility page now publishes `window.brx.diag()`: the point, its counts, and
// every player heard (team 0 included), plus a log line on each player's presence edge.
// Loaded the way utility-join-wiring.test.mjs loads it: a stub DOM and storage, no native plugins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUuid, PLAYER_STATE } from '../src/beacon.js';
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
    if (p?.present && api.log.some(l => /player 7 \(RED\) IN THE CIRCLE/.test(l))) break;
    api.presence.observe([adv], -40, Date.now());
    await new Promise(r => realSetTimeout(r, 50));
  }
  const p = api.diag().players.find(x => x.id === 7);
  assert.ok(p, 'the red player is listed');
  assert.equal(p.team, 0);
  assert.equal(p.present, true, `present after the dwell (waited ${Date.now() - t0} ms)`);
  assert.ok(api.log.some(l => /player 7 \(RED\) IN THE CIRCLE at -\d+ dBm/.test(l)), `the log names the edge (saw ${JSON.stringify(api.log.slice(-5))})`);
  assert.ok(api.diag().point, 'a control station reports its point');
  const h = api.diag().players.find(x => x.id === 7).gapHistogram;
  assert.ok(h && Object.values(h).reduce((a, b) => a + b, 0) === p.gaps.length, `the gap histogram covers every gap (saw ${JSON.stringify(h)})`);
});

// Bench 11.4 (2026-10-02): an MC-armed, A58-locked station let anyone change its MC LINK with no hold, a tamper hole
// the lock is meant to close. On the field the link now changes only once the RANGE hold has opened editing (1.5 s,
// or 5 s under an A58 lock); setting up, it stays free.
test('the MC link cannot be changed on the field until the hold opens editing', () => {
  const before = api.settings.mc;
  api.settings.mcArmed = true;                       // on the field
  api.settings.lockUntil = Date.now() + 60_000;      // and MC-locked (A58)
  api.connectTypedMc('ws://10.9.9.9:8766/ws');
  assert.equal(api.settings.mc, before, 'refused: the link is unchanged');
  assert.ok(api.log.some(l => /MC LINK IS LOCKED/.test(l)), `the station says why (saw ${JSON.stringify(api.log.slice(-3))})`);
  api.openRangeEdit();                               // what the 5 s override hold does
  api.connectTypedMc('ws://10.9.9.9:8766/ws');
  assert.equal(api.settings.mc, 'ws://10.9.9.9:8766/ws', 'after the hold, the change goes through');
  assert.ok(api.log.some(l => /MC link changed on the station/.test(l)), 'and it is logged');
  api.settings.mcArmed = false; api.settings.lockUntil = 0;
});

test('window.brx is published before the boot awaits the advert or the scan (review 2026-10-03)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/utility.js', import.meta.url), 'utf8');
  const boot = src.slice(src.lastIndexOf('(async () => {'));
  const at = boot.indexOf('window.brx = { log: logLines');
  assert.ok(at > 0, 'the early window.brx is still there');
  assert.ok(at < boot.indexOf('await startAdvert()'), 'before the advert start, which awaits the plugin');
  assert.ok(at < boot.indexOf('await startScan()'), 'and before the scan');
});

test('the quiet log uses the point`s own in-circle rule: a sighted player not yet present is logged too (review 2026-10-03)', async () => {
  const dwell = api.presence.dwellMs;
  api.presence.dwellMs = 60000;   // never present inside this test: only the sighting puts the player in the circle
  try {
    const adv = encodeUuid({ role: 'player', id: 12, team: 1, state: PLAYER_STATE.alive, game: api.settings.game || 0 });
    api.presence.observe([adv], -40, Date.now());
    for (const t1 = Date.now(); Date.now() - t1 < 3500 && !api.log.some(l => /player 12 .* quiet/.test(l));) await new Promise(r => realSetTimeout(r, 50));
    const p = api.diag().players.find(x => x.id === 12);
    assert.equal(p.present, false, 'setup: never present');
    assert.ok(api.log.some(l => /player 12 \(BLUE\) quiet/.test(l)), 'a player the point counts and does not hear is logged as quiet');
  } finally { api.presence.dwellMs = dwell; }
});
