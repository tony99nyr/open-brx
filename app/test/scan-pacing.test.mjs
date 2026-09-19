// App 0.4.2 scan review (fleet scale: 10 guns and 10 phones in one room share the radio space). The
// picker's scan starts are debounced, an automatic start backs off exponentially with jitter and a tap
// resets it, and no scan starts while a gun connect attempt is in flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ScanPacer, PICKER_MIN_GAP_MS, AUTO_SCAN_BASE_MS, AUTO_SCAN_CAP_MS } from '../src/gunpicker.js';
import { BrxLink } from '../src/brxlink.js';

function clock(t = 1_000_000) { const c = { t, now: () => c.t, tick: ms => { c.t += ms; } }; return c; }

test('debounce: a second start inside PICKER_MIN_GAP_MS while the scan runs is dropped', () => {
  const c = clock(); const p = new ScanPacer({ now: c.now });
  assert.equal(p.allow({ open: false }), true); p.started();
  c.tick(300);
  assert.equal(p.allow({ open: true }), false, 'a double tap restarted the scan');
  assert.equal(p.allow({ auto: true, open: false }), false, 'an automatic open landed on top of a fresh start');
  c.tick(PICKER_MIN_GAP_MS);
  assert.equal(p.allow({ open: true }), true, 'a tap after the gap must restart the scan');
});

test('back-off: automatic starts wait base, 2x base, ... up to the cap, with jitter; a tap resets it', () => {
  const c = clock();
  const p = new ScanPacer({ now: c.now, random: () => 0.5 });   // jitter factor 1.0
  const gaps = [];
  for (let i = 0; i < 8; i++) {
    assert.equal(p.allow({ auto: true }), true);
    p.started({ auto: true });
    const from = c.t; c.tick(PICKER_MIN_GAP_MS);   // past the debounce
    while (!p.allow({ auto: true })) c.tick(100);
    gaps.push(c.t - from);
  }
  assert.deepEqual(gaps.slice(0, 5), [2000, 4000, 8000, 16000, 32000].map(g => Math.max(g, PICKER_MIN_GAP_MS)));
  assert.equal(gaps[6], AUTO_SCAN_CAP_MS, 'the back-off is capped');
  // a user tap resets the back-off: the next automatic start is due after one base gap again
  p.started({ auto: true }); c.tick(PICKER_MIN_GAP_MS);
  assert.equal(p.allow({ auto: true }), false);
  assert.equal(p.allow({ auto: false }), true); p.started();
  p.started({ auto: true }); const from = c.t; c.tick(PICKER_MIN_GAP_MS);
  while (!p.allow({ auto: true })) c.tick(100);
  assert.equal(c.t - from, AUTO_SCAN_BASE_MS);
});

test('jitter: the automatic back-off spreads phones out (0.8x to 1.2x)', () => {
  const lo = new ScanPacer({ now: () => 0, random: () => 0 }), hi = new ScanPacer({ now: () => 0, random: () => 0.999 });
  lo.started({ auto: true }); hi.started({ auto: true });
  assert.equal(lo.nextAutoAt, AUTO_SCAN_BASE_MS * 0.8);
  assert.ok(hi.nextAutoAt > AUTO_SCAN_BASE_MS * 1.19);
});

test('no scan starts while a gun connect attempt is in flight', async () => {
  let release;
  const ble = { initialize: async () => {}, requestLEScan: async () => {}, stopLEScan: async () => {},
    connect: () => new Promise(r => { release = r; }), startNotifications: async () => {}, disconnect: async () => {} };
  const link = new BrxLink({ ble });
  const p = link.connect('A', 'GUN-A-3D4F');
  for (let i = 0; i < 5 && !link.connecting; i++) await new Promise(r => setImmediate(r));
  assert.equal(link.connecting, true);
  await assert.rejects(link.scan(() => {}), /connect is in flight/);
  assert.equal(link.scanning, false, 'a refused scan must not read as open');
  release(); await p;
  assert.equal(link.connecting, false);
  await link.scan(() => {});
  assert.equal(link.scanning, true);
  await link.stopScan(); await link.disconnect();
});

test('app.js: the automatic picker opens are paced, and the beacon watch yields to a connect', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(src, /pacer\.allow\(\{ auto, open:/, 'openPicker must ask the pacer');
  assert.match(src, /pacer\.started\(\{ auto \}\)/, 'openPicker must record the start');
  assert.equal((src.match(/openPicker\(\{ auto: true \}\)/g) || []).length, 2, 'Bluetooth-back-on and the rejoin fallback are automatic opens');
  assert.match(src, /beaconWatch\.tick\(st, \{ pickerOpen: scanning \|\| link\.connecting/);
});

test('app.js: SET MY GUN ends a background reconnect before it scans, so the picker never shows "No guns found" for a scan that never ran', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const start = src.indexOf('async function openPicker');
  const end = src.indexOf('await link.scan(d => picker.observe(d));', start);
  assert.ok(start >= 0 && end > start, 'openPicker must still call link.scan(...) with the picker.observe callback');
  const body = src.slice(start, end);
  assert.match(body, /if \(link\.connecting\)/, 'openPicker must check for a background reconnect holding the radio');
  assert.match(body, /await link\.disconnect\(\)/, 'openPicker must end it before scanning (brxlink.test.mjs pins the BrxLink half)');
});
