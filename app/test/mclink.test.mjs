import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McLink, HUD_POLICY, STATION_POLICY, MC_MDNS_SERVICE, AUTOJOIN_LOCK_MS } from '../src/transport/mclink.js';

function rig(policy, now = () => 1_000_000) {
  let current = null;
  const saved = [];
  const calls = [];
  const link = new McLink({ policy, current: () => current, setCurrent: t => { current = t; },
    remember: (url, bound) => saved.push({ url, bound }), now,
    makeTransport: () => ({ closed: false, state: 'connecting', url: null,
      close() { this.closed = true; },
      connect(options) { this.url = options.url; calls.push(options); return Promise.resolve({}); } }) });
  return { link, saved, calls, current: () => current };
}

test('HUD and station keep their own remember rules in one controller', async () => {
  const hud = rig(HUD_POLICY);
  const station = rig(STATION_POLICY);
  const url = 'ws://10.0.0.5:8766/ws';
  const h = hud.link.dial(url, { remember: false, connect: { url, verify: true } }, () => {});
  const s = station.link.dial(url, { trusted: false, connect: { url, trusted: false } }, () => {});
  assert.deepEqual(hud.saved, []);
  assert.deepEqual(station.saved, []);
  assert.equal(hud.calls[0].verify, true);
  assert.equal(station.calls[0].trusted, false);
  hud.link.bound(h.transport, url, {});
  station.link.bound(s.transport, url, { trusted: false });
  assert.deepEqual(hud.saved, [{ url, bound: true }]);
  assert.deepEqual(station.saved, [{ url, bound: true }]);
  hud.link.dial(url, { remember: true, connect: { url } }, () => {});
  station.link.dial(url, { trusted: true, connect: { url } }, () => {});
  assert.deepEqual(hud.saved.at(-1), { url, bound: false });
  assert.deepEqual(station.saved.at(-1), { url, bound: false });
});

test('F443 station lock applies to discovery through the shared controller', () => {
  const now = 1_000_000;
  const station = rig(STATION_POLICY, () => now).link;
  const hud = rig(HUD_POLICY, () => now).link;
  const logs = [];
  const state = { inPlay: true, lastBoundAt: now - 5000, heldUrls: ['ws://10.0.0.5:8766/ws'],
    remembered: 'ws://10.0.0.5:8766/ws', log: s => logs.push(s) };
  const other = 'ws://10.0.0.6:8766/ws';
  assert.equal(station.allowAutoJoin(other, state), false);
  assert.equal(station.allowAutoJoin(other, state), false);
  assert.equal(logs.length, 1, 'one refusal per minute and address');
  assert.equal(station.allowAutoJoin('ws://10.0.0.5:9999/ws', state), true);
  assert.equal(station.allowAutoJoin(other, { ...state, lastBoundAt: now - AUTOJOIN_LOCK_MS }), true);
  assert.equal(hud.allowAutoJoin(other, state), true);
});

test('both phone roles use one mDNS service and URL parser', async () => {
  const link = rig(HUD_POLICY).link;
  let watched, found;
  link.watch({ watch(options, callback) { watched = options; callback({ action: 'resolved', service: {
    ipv4Addresses: ['10.0.0.5'], port: 8766, txtRecord: { ws_path: '/node' } } }); return Promise.resolve(); } },
  url => { found = url; }, () => assert.fail('watch error'));
  assert.deepEqual(watched, { type: MC_MDNS_SERVICE, domain: 'local.' });
  assert.equal(found, 'ws://10.0.0.5:8766/node');
});

test('HUD sweep suggests its hit and stops when the remembered URL changes', async () => {
  const link = rig(HUD_POLICY).link;
  let remembered = 'ws://10.0.0.4:8766/ws';
  const found = [];
  const plans = [];
  const options = { isBound: () => false, isOnline: () => true,
    getNetworkStatus: async () => ({ ipAddress: '10.0.0.20' }), joinUrl: () => null,
    remembered: () => remembered, wsFactory: () => null, isPaused: () => false,
    log() {}, onFound: (url, source) => found.push([url, source]),
    sweep: async plan => { plans.push(plan); return 'ws://10.0.0.5:8766/ws'; } };
  await link.runSweep(options);
  assert.equal(plans[0].subnets[0], '10.0.0');
  assert.deepEqual(found, [['ws://10.0.0.5:8766/ws', 'sweep']]);
  await link.runSweep({ ...options, sweep: async plan => {
    remembered = 'ws://10.0.0.7:8766/ws';
    return 'ws://10.0.0.6:8766/ws';
  } });
  assert.equal(found.length, 1, 'a user dial during the sweep wins');
});

test('a transport that binds after a redial replaced it is stale: nothing is remembered (review #8 named change)', () => {
  for (const policy of [HUD_POLICY, STATION_POLICY]) {
    const r = rig(policy);
    const old = r.link.dial('ws://10.0.0.5:8766/ws', { remember: false, trusted: false, connect: { url: 'ws://10.0.0.5:8766/ws' } }, () => {});
    r.link.dial('ws://10.0.0.9:8766/ws', { remember: false, trusted: false, connect: { url: 'ws://10.0.0.9:8766/ws' } }, () => {});
    r.link.bound(old.transport, 'ws://10.0.0.5:8766/ws', { trusted: false });
    assert.deepEqual(r.saved, [], 'a stale bind remembers nothing');
    let onBound = 0; r.link.autoJoin.onBound = () => { onBound++; };
    r.link.bound(old.transport, 'ws://10.0.0.5:8766/ws', { trusted: false });
    assert.equal(onBound, 0, 'and resets no auto-join state');
  }
});

test('the HUD sweep reads the join URL after the network wait, so a join noted meanwhile picks the subnet', async () => {
  const link = rig(HUD_POLICY).link;
  let joinUrl = null;
  const plans = [];
  await link.runSweep({ isBound: () => false, isOnline: () => true,
    getNetworkStatus: async () => { joinUrl = 'ws://192.168.7.3:8766/ws'; return {}; }, joinUrl: () => joinUrl,
    remembered: () => '', wsFactory: () => null, isPaused: () => false, log() {}, onFound() {},
    sweep: async plan => { plans.push(plan); return null; } });
  assert.equal(plans[0].subnets[0], '192.168.7');
});

test('the remember predicates keep the old truthiness for odd values', () => {
  assert.equal(STATION_POLICY.rememberAtDial({ trusted: 1 }), true);
  assert.equal(STATION_POLICY.rememberAtBound({ trusted: null }), true);
  assert.equal(STATION_POLICY.rememberAtDial({ trusted: null }), false);
  assert.equal(HUD_POLICY.rememberAtDial({ remember: 1 }), true);
});
