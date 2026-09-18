// F211 fix (playtest review 2026-09-13): the Bluetooth enabled-watcher used to open the gun picker on
// `!link.connected` alone, including mid-match with a remembered gun whose forever-reconnect loop was
// already running -- stealing the radio, and leaving `scanning` stuck true (nothing cleared it once the
// loop reconnected), which keeps the beacon scan closed for the rest of the match.
//
// `app.js` is a boot-time IIFE that needs `document`/BLE plugins to run, so -- as `tapgate.test.mjs`
// already does for the same file -- this is a source guard, not an execution test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const APP_JS = new URL('../src/app.js', import.meta.url);

test('F211 guard: watchEnabled only opens the picker with no remembered gun', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const i = src.indexOf('link.watchEnabled(');
  assert.ok(i > 0, 'the watchEnabled wiring is gone from app.js -- FIX this guard, do not delete it');
  const block = src.slice(i, i + 700);
  assert.match(block, /!link\.connected\s*&&\s*!link\.deviceId\s*&&\s*!scanning/,
    'the "Bluetooth back on" branch must not open the picker when a gun is already remembered (its reconnect loop owns the radio)');
});

test('F211 guard: a link coming up closes the picker so the beacon scan is free again', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const i = src.indexOf('onUp: advert =>');
  assert.ok(i > 0, 'the BrxLink onUp wiring is gone from app.js -- FIX this guard, do not delete it');
  const block = src.slice(i, i + 400);
  // F258 added `stopPickerPaint()` to the same teardown, so the three facts are matched separately
  // rather than as one fixed sequence.
  assert.match(block, /if\s*\(scanning\)\s*\{[^}]*scanning\s*=\s*false;[^}]*hud\.setScan\(\[\]\);[^}]*link\.stopScan\(\)/,
    'onUp must close the picker (scanning=false, stopScan) so it cannot sit open after a reconnect');
});

// F258 (bench 2026-09-18): picking a gun froze the screen for about three seconds. The scan was still
// running across the connect, contending with it on the plugin's single native queue. `link.stopScan()`
// must therefore be AWAITED before `link.connect()`, and the radio claim must not be dropped in between.
test('F258 guard: onPick stops the scan before it connects, and holds the radio across the connect', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const i = src.indexOf('onPick: async deviceId =>');
  assert.ok(i > 0, 'the onPick handler is gone from app.js -- FIX this guard, do not delete it');
  const block = src.slice(i, i + 900);
  const stop = block.indexOf('await link.stopScan()'), conn = block.indexOf('await link.connect(');
  assert.ok(stop > 0 && conn > 0, 'onPick no longer awaits both stopScan and connect: ' + block.slice(0, 200));
  assert.ok(stop < conn, 'onPick must AWAIT link.stopScan() BEFORE link.connect(), or the scan contends with the connect');
  assert.ok(!/scanning\s*=\s*false;\s*await link\.connect/.test(block),
    'onPick must not release the radio claim before the connect: the 1 Hz beacon tick would open a scan across it');
});
