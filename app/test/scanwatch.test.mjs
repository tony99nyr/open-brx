// The beacon watch (scanwatch.js). Playtest 2026-09-13: the Pixel 5 ran 8 scan stops and 8 starts a second,
// because the restart stamp was written only after the slow bridge answered, and restarts overlapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeaconWatch, aliveNeedsBeacon, RESCAN_DOWN_MS, RESCAN_IDLE_MS, ScanGuard, stationsInPlay, stationScanStep, SCAN_BUDGET_PER_S, GUARD_WINDOW_MS, GUARD_PAUSE_MS, GUARD_HOLD_MS, PRESENCE_SAMPLE_MS } from '../src/scanwatch.js';
import { Presence, encodeUuid } from '../src/beacon.js';

/** A link whose every scan call takes `lag` ms of fake time to settle, like a starved Capacitor bridge. */
function rig({ failStart = false } = {}) {
  let clock = 1_000_000; const pending = []; const calls = []; let inFlight = 0, maxInFlight = 0;
  const slow = (name, fail) => new Promise((res, rej) => {
    calls.push(name); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    pending.push(() => { inFlight--; fail ? rej(new Error('scanning too frequently')) : res(); });
  });
  const scans = [];
  const link = { scan: (onHit, opts) => { scans.push({ onHit, opts }); return slow('start', failStart); }, stopScan: () => slow('stop', false) };
  const logs = []; const hits = [];
  const watch = new BeaconWatch({ link, now: () => clock, log: m => logs.push(m), onHit: h => hits.push({ ...h, at: clock }) });
  const turn = () => new Promise(r => setImmediate(r));
  const flush = async () => { await turn(); while (pending.length) { pending.shift()(); await turn(); } };
  return { watch, calls, flush, scans, logs, hits, adv: ms => { clock += ms; }, get now() { return clock; }, get maxInFlight() { return maxInFlight; } };
}
const live = (alive = true) => ({ phase: 'live', alive, respawnType: 'scanner' });
// A scanner-respawn game that also has a powerup station, so an ALIVE player reads station adverts too: the scan
// mechanics below run on it. F342: a respawn-only station game opens the scan only while the player is down.
const SCANNER = { mode: 'tdm', respawn: { type: 'scanner', delay_s: 5 }, stations: [{ id: 1, kind: 'respawn' }, { id: 6, kind: 'powerup' }] };
const RESPAWN_ONLY = { mode: 'tdm', respawn: { type: 'scanner', delay_s: 5 }, stations: [{ id: 1, kind: 'respawn' }] };

test('a slow bridge never stacks restarts: one scan operation at a time', async () => {
  const r = rig();
  r.watch.tick(live(), { config: SCANNER }); await r.flush();           // open
  r.adv(RESCAN_IDLE_MS);                           // a restart is due
  for (let i = 0; i < 20; i++) { r.watch.tick(live(), { config: SCANNER }); r.adv(1000); }   // 20 ticks while the bridge answers nothing
  await r.flush();
  r.adv(1000); r.watch.tick(live(), { config: SCANNER }); await r.flush();   // the stamp was taken before the await: nothing is overdue now
  assert.equal(r.maxInFlight, 1, 'a second scan call must never overlap the first');
  assert.deepEqual(r.calls, ['start', 'stop', 'start'], 'exactly one restart, not one per tick');
});

test('the scan is open only in a match: not before ARMED, and closed after the match ends', async () => {
  const r = rig();
  for (const phase of ['idle', 'connected', 'kitted', 'lobby']) { r.watch.tick({ phase, alive: true }, { config: SCANNER }); await r.flush(); }
  assert.deepEqual(r.calls, [], 'no reader needs station adverts outside a match');
  r.watch.tick({ phase: 'armed', alive: true }, { config: SCANNER }); await r.flush();
  assert.equal(r.watch.open, true);
  r.watch.tick({ phase: 'kitted', alive: true }, { config: SCANNER }); await r.flush();
  assert.equal(r.watch.open, false);
  assert.deepEqual(r.calls, ['start', 'stop']);
});

test('the gun picker owns the radio: no beacon start while it is open', async () => {
  const r = rig();
  r.watch.tick(live(), { pickerOpen: true, config: SCANNER }); await r.flush();
  assert.deepEqual(r.calls, []);
});

test('a refused start retries on the down cadence, not every tick', async () => {
  const r = rig({ failStart: true });
  for (let i = 0; i < 10; i++) { r.watch.tick(live(), { config: SCANNER }); await r.flush(); r.adv(1000); }
  assert.equal(r.calls.filter(c => c === 'start').length, 2, `10 s of ticks: a start at 0 s and one at ${RESCAN_DOWN_MS / 1000} s`);
});

test('going down kicks one immediate restart, then the 7 s cadence', async () => {
  const r = rig();
  r.watch.tick(live(), { config: SCANNER }); await r.flush();
  r.adv(1000); r.watch.tick(live(false), { config: SCANNER }); await r.flush();
  assert.deepEqual(r.calls, ['start', 'stop', 'start']);
  r.adv(1000); r.watch.tick(live(false), { config: SCANNER }); await r.flush();
  assert.equal(r.calls.length, 3, 'no second kick a second later');
  r.adv(RESCAN_DOWN_MS); r.watch.tick(live(false), { config: SCANNER }); await r.flush();
  assert.equal(r.calls.length, 5);
});

// ---------- bench 2026-09-16/17: the scan result flood (Pixel 5, ~57 results/s over the plugin bridge) ----------

const TDM = { mode: 'tdm', respawn: { type: 'auto', delay_s: 15 } };   // the bench match: no stations at all

test('stationsInPlay: only a game with stations on the field needs station adverts', () => {
  assert.equal(stationsInPlay(null), false);
  assert.equal(stationsInPlay(TDM), false, 'timed respawn, no stations: nothing reads an advert');
  assert.equal(stationsInPlay({ ...TDM, station_source: 'grenade' }), false, 'a grenade hill arrives over IR through the gun');
  assert.equal(stationsInPlay(SCANNER), true, 'the scanner respawn reads the respawn station');
  assert.equal(stationsInPlay({ mode: 'koth', station_source: 'phone' }), true, 'the phone control point');
  assert.equal(stationsInPlay({ ...TDM, stations: [{ id: 3, kind: 'powerup' }] }), true, 'MC armed a station for this game');
  assert.equal(stationsInPlay({ ...TDM, stations: [] }), false);
});

test('no scan in a live match with no stations, and none without a config', async () => {
  const r = rig();
  for (let i = 0; i < 5; i++) { r.watch.tick(live(), { config: TDM }); r.watch.tick({ phase: 'armed', alive: true }); await r.flush(); r.adv(1000); }
  assert.deepEqual(r.calls, [], 'the bench TDM must never open the beacon scan');
});

/** Feed `perSec` adverts a second from one station for `ms`, ticking a real Presence every 250 ms like app.js. */
async function feedStation(r, presence, { perSec, rssi, ms, id = 7 }) {
  const uuid = encodeUuid({ role: 'station', id, kind: 'respawn', team: 255, state: 1 });
  const step = 1000 / perSec; let t = 0, nextTick = 0;
  while (t < ms) {
    r.scans.at(-1).onHit({ deviceId: 'AA:' + id, name: '', rssi, uuids: [uuid] });
    r.adv(step); t += step;
    if (t >= nextTick) { presence.tick(r.now); nextTick += 250; }
  }
}

test('a station advert is still seen, sampled at 4 per second, and its RSSI bubble still fires', async () => {
  const r = rig();
  const presence = new Presence({ defaultThreshold: -74, dwellMs: 800 });   // app.js's bench-tuned values
  r.watch.onHit = h => { r.hits.push(h); presence.observe(h.uuids, h.rssi, r.now); };
  r.watch.tick(live(), { config: SCANNER }); await r.flush();
  assert.equal(r.scans.length, 1);
  await feedStation(r, presence, { perSec: 10, rssi: -60, ms: 2000 });
  assert.ok(r.hits.length >= 7 && r.hits.length <= 9, `10/s for 2 s reaches the reader at ~4/s, got ${r.hits.length}`);
  const st = presence.stations()[0];
  assert.ok(st && st.present, 'in range for 2 s: the station is PRESENT (dwell 0.8 s)');
  const far = new Presence({ defaultThreshold: -74, dwellMs: 800 });
  r.watch.onHit = h => far.observe(h.uuids, h.rssi, r.now);
  r.adv(PRESENCE_SAMPLE_MS);
  await feedStation(r, far, { perSec: 10, rssi: -90, ms: 2000, id: 8 });
  assert.equal(far.stations()[0].present, false, 'out of range stays out');
});

test('ScanGuard: judged over a 2 s window against the budget', () => {
  const g = new ScanGuard(); let now = 0; g.reset(now);
  for (let i = 0; i < 2 * SCAN_BUDGET_PER_S; i++) { g.hit(now); now += 1000 / SCAN_BUDGET_PER_S; }
  assert.deepEqual(g.check(now), { rate: SCAN_BUDGET_PER_S, over: false }, 'exactly the budget is allowed');
  for (let i = 0; i < 120; i++) { g.hit(now); now += 1000 / 60; }
  const c = g.check(now);
  assert.equal(c.over, true); assert.ok(c.rate >= 55, `a 60/s flood reads as one, got ${c.rate}`);
  assert.equal(g.check(now + 10).over, false, 'no verdict before the next window is full');
});

/** Push `perSec` raw results a second through the open scan's onRaw for `ms`, ticking the watch every second. */
async function flood(r, st, { perSec, ms }) {
  let t = 0; const step = 1000 / perSec; let nextTick = 1000;
  while (t < ms) {
    const s = r.scans.at(-1); if (r.watch.open) s.opts.onRaw();
    r.adv(step); t += step;
    if (t >= nextTick) { r.watch.tick(st, { config: SCANNER }); await r.flush(); nextTick += 1000; }
  }
}

test('the guard backs the scan off under a synthetic flood: close, pause, reopen one mode lower', async () => {
  const r = rig();
  r.watch.tick(live(), { config: SCANNER }); await r.flush();
  assert.equal(r.scans[0].opts.scanMode, 2, 'a station game starts at low latency');
  await flood(r, live(), { perSec: 60, ms: GUARD_WINDOW_MS + 100 });
  assert.equal(r.watch.open, false, 'the flood closed the scan');
  assert.equal(r.logs.filter(l => /flood/.test(l)).length, 1, 'logged once');
  const startsBefore = r.calls.filter(c => c === 'start').length;
  for (let t = 0; t < GUARD_PAUSE_MS - 1000; t += 1000) { r.adv(1000); r.watch.tick(live(), { config: SCANNER }); await r.flush(); }
  assert.equal(r.calls.filter(c => c === 'start').length, startsBefore, 'closed for the pause');
  r.adv(1500); r.watch.tick(live(), { config: SCANNER }); await r.flush();
  assert.equal(r.watch.open, true); assert.equal(r.scans.at(-1).opts.scanMode, 1, 'reopened at balanced');
  await flood(r, live(), { perSec: 60, ms: GUARD_WINDOW_MS + 100 });
  for (let t = 0; t <= GUARD_PAUSE_MS + 1000; t += 1000) { r.adv(1000); r.watch.tick(live(), { config: SCANNER }); await r.flush(); }
  assert.equal(r.scans.at(-1).opts.scanMode, 0, 'still flooding: low power');
  assert.equal(r.watch.stats().backoffs, 2);
  // quiet for the hold time: one mode back up
  for (let t = 0; t <= GUARD_HOLD_MS; t += 1000) { r.adv(1000); r.watch.tick(live(), { config: SCANNER }); await r.flush(); }
  assert.equal(r.scans.at(-1).opts.scanMode, 1, 'a quiet minute steps back up one mode');
});

test('F342: a gun reconnect inside the match keeps the lowered scan mode; the next game starts at full rate', async () => {
  // Field 2026-09-24 (Pixel 5): the guard lowered the scan at arm time, the gun dropped, and the reconnect (which
  // owns the radio, `pickerOpen`) reset the mode. The scan reopened at low latency and flooded again during the
  // reconcile's re-arm writes.
  const r = rig();
  r.watch.tick(live(), { config: SCANNER }); await r.flush();
  await flood(r, live(), { perSec: 60, ms: GUARD_WINDOW_MS + 100 });
  for (let t = 0; t <= GUARD_PAUSE_MS + 1000; t += 1000) { r.adv(1000); r.watch.tick(live(), { config: SCANNER }); await r.flush(); }
  assert.equal(r.scans.at(-1).opts.scanMode, 1, 'setup: the guard lowered the scan to balanced');
  const released = r.watch.release(); await r.flush(); await released;   // the reconnect takes the radio
  for (let t = 0; t < 3000; t += 1000) { r.adv(1000); r.watch.tick(live(), { pickerOpen: true, config: SCANNER }); await r.flush(); }
  assert.equal(r.watch.open, false, 'the reconnect owns the radio');
  r.adv(RESCAN_DOWN_MS); r.watch.tick(live(), { config: SCANNER }); await r.flush();
  assert.equal(r.watch.open, true);
  assert.equal(r.scans.at(-1).opts.scanMode, 1, 'reopened at the mode the guard chose, not at low latency');
  r.watch.tick({ phase: 'kitted', alive: true }, { config: SCANNER }); await r.flush();   // the match ends
  r.adv(RESCAN_DOWN_MS); r.watch.tick({ phase: 'armed', alive: true }, { config: SCANNER }); await r.flush();
  assert.equal(r.scans.at(-1).opts.scanMode, 2, 'the next game starts at full rate');
});

test('F342: in a respawn-only station game the scan is closed while the player is alive, and opens at once on a death', async () => {
  // Field 2026-09-24 (Pixel 5): 60 results/s at arm time and 78 at the lowest scan mode, during the T-3 hit table and
  // the T-0 spawn burst. Only a DOWN player reads a respawn station.
  const r = rig();
  r.watch.tick({ phase: 'armed', alive: true, respawnType: 'scanner' }, { config: RESPAWN_ONLY }); await r.flush();
  r.watch.tick(live(), { config: RESPAWN_ONLY }); await r.flush();
  assert.deepEqual(r.calls, [], 'no scan at arm time or while alive');
  r.adv(1000); r.watch.tick(live(false), { config: RESPAWN_ONLY }); await r.flush();
  assert.equal(r.watch.open, true, 'the death opens it at once');
  assert.equal(r.scans.at(-1).opts.scanMode, 2);
  r.adv(9000); r.watch.tick(live(true), { config: RESPAWN_ONLY }); await r.flush();
  assert.equal(r.watch.open, false, 'the revive closes it again');
  assert.equal(aliveNeedsBeacon(RESPAWN_ONLY), false);
  assert.equal(aliveNeedsBeacon(SCANNER), true, 'a powerup station is read alive');
  assert.equal(aliveNeedsBeacon({ station_source: 'phone' }), true, 'so is a phone control point');
});

test('a down scanner-respawn player never drops below balanced, and is never paused', async () => {
  const r = rig();
  r.watch.tick(live(), { config: SCANNER }); await r.flush();
  r.adv(1000); r.watch.tick(live(false), { config: SCANNER }); await r.flush();   // died: kick
  await flood(r, live(false), { perSec: 80, ms: GUARD_WINDOW_MS + 100 });
  r.adv(1000); r.watch.tick(live(false), { config: SCANNER }); await r.flush();
  assert.equal(r.watch.open, true, 'reopened at once: a down player needs the station now');
  assert.equal(r.scans.at(-1).opts.scanMode, 1);
  await flood(r, live(false), { perSec: 80, ms: 3 * GUARD_WINDOW_MS });
  assert.equal(r.scans.at(-1).opts.scanMode, 1, 'no low power while hunting a station');
  assert.ok(r.logs.some(l => /lowest scan mode allowed/.test(l)), 'says the bridge still carries them');
});

test('the station player watch drops only to balanced and steps back after the hold', () => {
  let s = stationScanStep({ over: true, idx: 0, since: 0, now: 1000 });
  assert.deepEqual(s, { idx: 1, since: 1000, restart: true, tripped: true });
  s = stationScanStep({ over: true, idx: 1, since: 1000, now: 3000 });
  assert.equal(s.idx, 1); assert.equal(s.restart, false, 'never to low power');
  s = stationScanStep({ over: false, idx: 1, since: 1000, now: 1000 + GUARD_HOLD_MS });
  assert.deepEqual(s, { idx: 0, since: 1000 + GUARD_HOLD_MS, restart: true, tripped: false });
});

// app.js cannot be imported in a test (it boots the HUD), so its two call sites are pinned by source.
test('app.js: the beacon watch gets the game config, and the player advert needs stations too', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(src, /beaconWatch\.tick\(st, \{ pickerOpen: scanning \|\| link\.connecting, config: engine\.config \}\)/,
    'without the config the watch cannot tell a station game from a plain TDM');
  const fn = src.slice(src.indexOf('async function syncPlayerAdvert'), src.indexOf('async function syncPlayerAdvert') + 1200);
  assert.match(fn, /const want = \([^;]*stationsInPlay\(engine\.config\)/, 'a player advert is carried by every other phone scan: only a station game sends one');
});
