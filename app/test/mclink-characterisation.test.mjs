import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McAutoJoin, FIRST_CONTACT_SETTLE_MS } from '../src/transport/autojoin.js';
import { startUtilitySweep } from '../src/transport/utility-join.js';

test('HUD discovery keeps an unproved address out of the remembered dial', () => {
  let now = 1000;
  const join = new McAutoJoin({ now: () => now });
  const remembered = 'ws://10.0.0.1:8766/ws';
  const found = 'ws://10.0.0.2:8766/ws';
  const context = { bound: false, dialling: remembered, verifying: false,
    hasTrustKey: true, remembered, userDialPending: false };
  assert.deepEqual(join.onFound(found, 'mdns', context), { do: 'verify' });
  assert.equal(context.remembered, remembered, 'a proof dial does not replace the saved address');
  assert.equal(join.onVerifyFailed(found, true), 'unproven');
  assert.deepEqual(join.onFound(found, 'mdns', context), { do: 'offer', reason: 'unproven' });
});

test('HUD first contact waits for one distinct MC and never uses a trusted dial', () => {
  let now = 1000;
  const join = new McAutoJoin({ now: () => now });
  const context = { bound: false, dialling: null, verifying: false,
    hasTrustKey: false, remembered: null, userDialPending: false };
  const found = 'ws://10.0.0.2:8766/ws';
  assert.deepEqual(join.onFound(found, 'mdns', context), { do: 'wait', ms: FIRST_CONTACT_SETTLE_MS });
  now += FIRST_CONTACT_SETTLE_MS;
  assert.deepEqual(join.onFound(found, 'mdns', context), { do: 'join' });
});

test('station discovery dials an untrusted sweep hit (the remember-after-welcome rule: mclink.test.mjs)', async () => {
  const calls = [];
  const timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };
  const sweep = startUtilitySweep({ isBound: () => false, operatorUrl: () => false,
    connect: (url, options) => calls.push({ url, options }),
    sweep: async () => 'ws://10.0.0.3:8766/ws', timers, firstDelayMs: 0 });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls[0], { url: 'ws://10.0.0.3:8766/ws', options: { trusted: false } });
  } finally { sweep.stop(); }
});
