// F340 (bench 2026-09-24, the grey Pixel 5 on Android 11): with Location services off, the gun picker
// found nothing while a gun advertised at -71 dBm, and the screen only said "No guns found". On Android 11
// and older (API 30 and lower) a BLE scan needs Location services ON, not just the permission. Android 12+
// scans with BLUETOOTH_SCAN `neverForLocation` (app/scripts/android-setup.sh) and iOS has no such rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsLocation, locationBlocked, LOCATION_MAX_SDK } from '../src/location.js';
import { BrxLink } from '../src/brxlink.js';

test('needsLocation: Android 11 (API 30) with Location off is blocked', () => {
  assert.equal(LOCATION_MAX_SDK, 30);
  assert.equal(needsLocation({ platform: 'android', sdk: 30, locationOn: false }), true);
  assert.equal(needsLocation({ platform: 'android', sdk: 23, locationOn: false }), true);
  assert.equal(needsLocation({ platform: 'android', sdk: 30, locationOn: true }), false);
});

test('needsLocation: Android 12 (API 31) and later are never blocked', () => {
  assert.equal(needsLocation({ platform: 'android', sdk: 31, locationOn: false }), false);
  assert.equal(needsLocation({ platform: 'android', sdk: 35, locationOn: false }), false);
});

test('needsLocation: iOS and web are never blocked', () => {
  assert.equal(needsLocation({ platform: 'ios', sdk: 30, locationOn: false }), false);
  assert.equal(needsLocation({ platform: 'web', sdk: undefined, locationOn: false }), false);
});

test('needsLocation: an unknown Android API level is not blocked (scan as before)', () => {
  assert.equal(needsLocation({ platform: 'android', sdk: undefined, locationOn: false }), false);
  assert.equal(needsLocation({ platform: 'android', sdk: null, locationOn: false }), false);
});

test('locationBlocked: asks the plugin only on Android 30 and lower', async () => {
  let asked = 0; const probe = async () => { asked++; return false; };
  assert.equal(await locationBlocked({ platform: 'android', sdk: 30, probe }), true);
  assert.equal(asked, 1);
  assert.equal(await locationBlocked({ platform: 'android', sdk: 31, probe }), false);
  assert.equal(await locationBlocked({ platform: 'ios', sdk: 30, probe }), false);
  assert.equal(asked, 1, 'the check ran on Android 12+ or iOS');
  assert.equal(await locationBlocked({ platform: 'android', sdk: 29, probe: async () => true }), false);
});

test('locationBlocked: a check that throws is logged and does not block the scan', async () => {
  const lines = [];
  const r = await locationBlocked({ platform: 'android', sdk: 30, probe: async () => { throw new Error('boom'); }, log: (m, c) => lines.push([m, c]) });
  assert.equal(r, false);
  assert.equal(lines.length, 1, 'the failure was swallowed');
  assert.match(lines[0][0], /location check failed.*boom/);
  assert.equal(lines[0][1], 'le');
});

test('BrxLink: isLocationEnabled and openLocationSettings reach the plugin', async () => {
  const calls = [];
  const ble = { isLocationEnabled: async () => { calls.push('is'); return false; }, openLocationSettings: async () => { calls.push('open'); } };
  const link = new BrxLink({ ble, log: () => {} });
  assert.equal(await link.isLocationEnabled(), false);
  assert.equal(await link.openLocationSettings(), true);
  assert.deepEqual(calls, ['is', 'open']);
  // isLocationEnabled must NOT swallow a failure: the caller logs it and falls back (locationBlocked)
  const bad = new BrxLink({ ble: { isLocationEnabled: async () => { throw new Error('no'); } }, log: () => {} });
  await assert.rejects(() => bad.isLocationEnabled(), /no/);
  // a plugin with no settings shortcut says so instead of throwing
  const bare = new BrxLink({ ble: {}, log: () => {} });
  assert.equal(await bare.openLocationSettings(), false);
});

// app.js is a boot-time IIFE (see bluetooth-picker.test.mjs), so its wiring is a source guard.
test('F340 guard: openPicker checks Location before it scans, and app resume re-checks', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const i = src.indexOf('async function openPicker(');
  assert.ok(i > 0, 'openPicker is gone from app.js -- FIX this guard, do not delete it');
  const body = src.slice(i, src.indexOf('\nObject.assign(hud.h,', i));
  const gate = body.indexOf('await checkLocation('), scan = body.indexOf('await link.scan(');
  assert.ok(gate > 0 && scan > 0 && gate < scan, 'openPicker must check Location services BEFORE it starts the scan');
  assert.match(src, /addListener\('resume'/, 'the App resume event must re-check Location');
  assert.match(src, /onOpenLocationSettings:/, 'the OPEN LOCATION SETTINGS handler is missing');
});

test('locationCheck: writes hud.locationOn and reports the moment Location comes back', async () => {
  const { locationCheck } = await import('../src/location.js');
  const hud = { locationOn: true }; let on = false;
  const chk = locationCheck({ platform: () => 'android', sdk: () => 30, probe: async () => on, hud });
  assert.deepEqual(await chk(), { blocked: true, cleared: false }); assert.equal(hud.locationOn, false);
  assert.deepEqual(await chk(), { blocked: true, cleared: false });
  on = true;
  assert.deepEqual(await chk(), { blocked: false, cleared: true }); assert.equal(hud.locationOn, true);
  assert.deepEqual(await chk(), { blocked: false, cleared: false });
});
