// Bench 2026-09-17 (Pixel 5, app 0.3.0): Bluetooth off, TURN ON BLUETOOTH, then a tap on a gun row.
// The phone's own log showed two "connecting to Tactix-3D4F…" lines four seconds apart, then
// "*** gun disconnected ***", a relink write, "connect 1/5 failed", and "write err: Not connected to
// device". The first tap gave no feedback while the connect waited in the plugin queue, so the second
// tap started a second connect beside it. Sixteen minutes later the gun picker's scan was still open
// in the lobby (link.scanning true, the picker rows still updating).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BrxLink } from '../src/brxlink.js';

function useClock(ctx) {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_700_000_000_000 });
  return async (ms = 1300) => {
    for (let i = 0; i < ms; i++) { ctx.mock.timers.tick(1); await new Promise(r => setImmediate(r)); }
  };
}

/** The Android plugin as the app sees it: ONE queue for every native call (bleClient.js `queue`), a
 *  connect that takes a while, "Already connected." for a second connect, and a disconnect that fires
 *  the newest `disconnected|<id>` listener (bleClient.js replaces the listener per connect). */
function queuedGun() {
  let chain = Promise.resolve();
  const q = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  const gun = { up: false, listener: null, notifyWhileDown: 0 };
  const ble = {
    initialize: async () => {},
    connect: (id, onDisconnect) => q(async () => {
      gun.listener = onDisconnect;
      if (!gun.up) { await new Promise(r => setTimeout(r, 400)); gun.up = true; }
    }),
    disconnect: () => q(async () => { if (gun.up) { gun.up = false; if (gun.listener) gun.listener(); } }),
    startNotifications: () => q(async () => { if (!gun.up) throw new Error('Not connected to device.'); }),
  };
  return { ble, gun };
}

test('two taps on one gun row: the connect that lost never claims the link', async ctx => {
  const settle = useClock(ctx);
  const { ble, gun } = queuedGun();
  const ups = [], drops = [];
  const link = new BrxLink({ ble, log: () => {}, onUp: () => ups.push(gun.up), onDrop: () => drops.push(1) });
  ctx.after(() => link.disconnect());
  const first = link.connect('A', 'Tactix-3D4F');
  await settle(100);
  const second = link.connect('A', 'Tactix-3D4F');   // the player taps the row again
  await settle(3000);
  await Promise.allSettled([first, second]);
  assert.deepEqual(ups, [true], 'onUp must run once, and only with the gun actually connected');
  assert.equal(link.connected, gun.up, 'the link must not read connected while the gun is down');
});

test('picker guard: a gun row tap cannot start a second connect, and SET MY GUN waits for it', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const pick = src.slice(src.indexOf('onPick: async'), src.indexOf('onUtility:'));
  assert.ok(pick.length > 0, 'onPick is gone from app.js -- FIX this guard, do not delete it');
  assert.match(pick, /if \(!d \|\| picking\) return;\s*picking = true;/, 'onPick must ignore a tap while a pick connects');
  // F258 put the radio claim in the same `finally`: `scanning` now stays true across the connect, so
  // the 1 Hz beacon tick cannot open a scan that contends with it. Both flags clear however it ends.
  assert.match(pick, /finally \{ picking = false;[^}]*\}/, 'onPick must release the guard however the connect ends');
  assert.match(pick, /finally \{[^}]*scanning = false;[^}]*\}/, 'onPick must hand the radio back however the connect ends');
  const set = src.slice(src.indexOf('onSetGun: async'), src.indexOf('onEnableBluetooth:'));
  assert.match(set, /^onSetGun: async \(\) => \{\s*if \(picking\) return;/, 'SET MY GUN must do nothing while a pick connects');
  const afterEnabled = set.slice(set.indexOf('await link.isEnabled()'));
  assert.match(afterEnabled, /^[^\n]*\n\s*if \(picking \|\| link\.connected\) return;/,
    'onSetGun must re-check after isEnabled(): that call waits in the plugin queue behind a connect');
  const afterStop = set.slice(set.indexOf('await stopAnyScan();'));
  assert.match(afterStop, /^[^\n]*\n\s*if \(picking \|\| link\.connected\) \{ scanning = false; return; \}/,
    'onSetGun must not open the picker scan once a gun has linked');
});
