// F139 (field test 2026-09-12): the LAN discovery sweep had never worked on Android.
//
// Two independent faults, both invisible to any test that existed: it probed with `fetch('http://<ip>:
// 8765/api/state')`, which the webview blocks as Mixed Content from the app's https origin (the Pixel
// 4's logcat is a wall of them); and it took the /24 to sweep from the REMEMBERED MC url, so a phone on
// 192.168.0.x spent the sweep on 172.20.10.x — the iPhone hotspot it had joined the previous game test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { subnetOf, parseWsTarget, localIpFrom, sweepPlan, probeWsOpen, sweepForMc,
         DEFAULT_SUBNETS, MC_WS_PORT } from '../src/transport/discover.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = path.resolve(HERE, '../src/app.js');

class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.closed = null; }
  send(t) { this.sent.push(t); }
  close(code, reason) { if (!this.closed) this.closed = { code, reason }; if (this.onclose) this.onclose({ code, reason }); }
}
/** A fake LAN: `live` are the addresses that complete a websocket upgrade, everything else is silent
 *  (which is what a host with no device on it looks like — no error, no close, nothing). */
function lan(live = []) {
  const sockets = [];
  const wsFactory = url => {
    const w = new FakeWS(url); sockets.push(w);
    if (live.includes(url)) setTimeout(() => w.onopen && w.onopen(), 0);
    return w;
  };
  return { sockets, wsFactory };
}

test('F139: subnetOf takes the /24 of a dotted quad and refuses anything else', () => {
  assert.equal(subnetOf('192.168.0.149'), '192.168.0');
  assert.equal(subnetOf(' 10.0.0.7 '), '10.0.0');
  assert.equal(subnetOf('172.20.10.1'), '172.20.10');
  assert.equal(subnetOf('192.168.0.256'), null, 'not an octet');
  assert.equal(subnetOf('mc.local'), null, 'an mDNS name has no subnet to sweep');
  assert.equal(subnetOf(null), null); assert.equal(subnetOf(''), null);
});

test('F139: parseWsTarget splits host/port/path, defaulting the path', () => {
  assert.deepEqual(parseWsTarget('ws://192.168.0.12:8766/ws'), { host: '192.168.0.12', port: 8766, path: '/ws' });
  assert.deepEqual(parseWsTarget('WSS://x.trycloudflare.com/ws'), { host: 'x.trycloudflare.com', port: null, path: '/ws' });
  assert.deepEqual(parseWsTarget('ws://192.168.0.12:8766'), { host: '192.168.0.12', port: 8766, path: '/ws' });
  assert.equal(parseWsTarget('http://192.168.0.12:8765/api/state'), null);
  assert.equal(parseWsTarget(null), null);
});

test('F139: the phone\'s own address is the first subnet swept, whatever shape the plugin reports it in', () => {
  assert.equal(localIpFrom({ connected: true, connectionType: 'wifi' }), null, 'Capacitor\'s Network plugin reports no address today — say so rather than guess');
  assert.equal(localIpFrom({ ipAddress: '192.168.0.149' }), '192.168.0.149');
  assert.equal(localIpFrom({ ip: '10.0.0.4' }), '10.0.0.4');
  assert.equal(localIpFrom({ ip: 'fe80::1' }), null, 'not a v4 address to sweep');
  assert.equal(localIpFrom(null), null);
  const plan = sweepPlan({ localIp: '192.168.0.149', joinUrl: 'ws://172.20.10.3:8766/ws' });
  assert.equal(plan.subnets[0], '192.168.0', 'the phone\'s OWN subnet wins over any url');
});

test('F139: with no address source, the subnet comes from the CURRENT join — the field bug was using a remembered one', () => {
  const plan = sweepPlan({ localIp: null, joinUrl: 'ws://192.168.0.12:8766/ws' });
  assert.equal(plan.subnets[0], '192.168.0');
  assert.deepEqual(plan.ports, [8766], 'the join\'s own port, deduped against the default');
  assert.equal(plan.path, '/ws');
  // and the common ranges still follow, so a phone with neither source is no worse off than before
  for (const sn of DEFAULT_SUBNETS) assert.ok(plan.subnets.includes(sn), `${sn} still swept`);
  assert.equal(new Set(plan.subnets).size, plan.subnets.length, 'no subnet swept twice');
});

test('F139: a join on a non-default port sweeps that port first, then the default', () => {
  const plan = sweepPlan({ joinUrl: 'ws://10.1.2.3:9100/node' });
  assert.deepEqual(plan.ports, [9100, MC_WS_PORT]);
  assert.equal(plan.path, '/node');
  assert.equal(plan.subnets[0], '10.1.2.3'.split('.').slice(0, 3).join('.'));
});

test('F139: with nothing known at all the plan is still valid — the common ranges on MC\'s node port', () => {
  const plan = sweepPlan();
  assert.deepEqual(plan.subnets, DEFAULT_SUBNETS);
  assert.deepEqual(plan.ports, [MC_WS_PORT]);
  assert.equal(plan.path, '/ws');
});

test('F139: the probe OPENS a websocket and closes it without ever sending a hello', async () => {
  const { sockets, wsFactory } = lan(['ws://192.168.0.12:8766/ws']);
  assert.equal(await probeWsOpen('ws://192.168.0.12:8766/ws', { wsFactory, timeoutMs: 50 }), true);
  assert.equal(sockets[0].sent.length, 0, 'a hello here would make MC hand the node over and kill the real link (transport.js _probePub)');
  assert.deepEqual(sockets[0].closed, { code: 1000, reason: 'probe' }, 'closed the moment it opened');
  assert.equal(sockets[0].onopen, null, 'handlers detached');
});

test('F139: a probe of a dead address resolves false on the timeout — a host with no route fires NO event', async () => {
  const { sockets, wsFactory } = lan([]);
  const t0 = Date.now();
  assert.equal(await probeWsOpen('ws://192.168.0.13:8766/ws', { wsFactory, timeoutMs: 30 }), false);
  assert.ok(Date.now() - t0 >= 25, 'it waited out its own bound, not the OS\'s');
  assert.ok(sockets[0].closed, 'and closed the socket it gave up on');
});

test('F139: a probe that is refused resolves false at once, and a factory that throws does not take the sweep down', async () => {
  const { wsFactory } = lan([]);
  const refusing = url => { const w = new FakeWS(url); setTimeout(() => w.onclose && w.onclose({ code: 1006 }), 0); return w; };
  assert.equal(await probeWsOpen('ws://192.168.0.14:8766/ws', { wsFactory: refusing, timeoutMs: 5000 }), false);
  assert.equal(await probeWsOpen('ws://bad/ws', { wsFactory: () => { throw new Error('blocked'); }, timeoutMs: 5000 }), false);
  assert.ok(wsFactory, 'unused');
});

test('F139: the sweep finds MC on the planned subnet and returns the url to dial', async () => {
  const mc = 'ws://192.168.0.12:8766/ws';
  const { sockets, wsFactory } = lan([mc]);
  const plan = sweepPlan({ localIp: '192.168.0.149' });
  const found = await sweepForMc({ ...plan, wsFactory, timeoutMs: 20, pool: 16, hosts: 20 });
  assert.equal(found, mc);
  assert.ok(sockets.every(s => s.url.startsWith('ws://192.168.0.')), 'never left the phone\'s own subnet once it hit');
  assert.ok(sockets.every(s => s.sent.length === 0), 'no probe ever spoke');
});

test('F139: the sweep is bounded and stops the moment a join lands — it never keeps hammering the LAN', async () => {
  const { sockets, wsFactory } = lan([]);
  let bound = false;
  const plan = sweepPlan({ localIp: '192.168.0.149' });
  const p = sweepForMc({ ...plan, wsFactory, timeoutMs: 10, pool: 8, hosts: 254, shouldStop: () => bound });
  setTimeout(() => { bound = true; }, 25);
  assert.equal(await p, null);
  assert.ok(sockets.length < 254 * plan.ports.length, `stopped early (${sockets.length} probes)`);
  assert.ok(sockets.length > 0, 'but it did start');
});

test('F139: the sweep never has more than `pool` sockets open at a time', async () => {
  let open = 0, peak = 0;
  const wsFactory = url => {
    open++; peak = Math.max(peak, open);
    const w = new FakeWS(url);
    const orig = w.close.bind(w);
    w.close = (c, r) => { if (!w.closed) open--; orig(c, r); };
    return w;
  };
  await sweepForMc({ subnets: ['192.168.0'], ports: [8766], wsFactory, timeoutMs: 5, pool: 8, hosts: 40 });
  assert.ok(peak <= 8, `peak in flight ${peak} <= pool 8`);
});

// ---------------- the guard: app.js must actually USE this, and not the blocked path ----------------
// A green module test proves nothing if app.js still calls fetch() across the subnet of a url it
// remembered from another day — which is exactly the state the field found.
test('F139 guard: app.js sweeps over ws:// from discover.js, never an http fetch, and never off a remembered url', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const i = src.indexOf('async function sweepForMc(');
  assert.ok(i > 0, 'sweepForMc is gone from app.js — FIX this guard, do not delete it');
  const body = src.slice(i, src.indexOf('\n}', i));
  assert.doesNotMatch(body, /fetch\(/, 'an http fetch from the https origin is blocked as Mixed Content on Android — every request, every time');
  assert.doesNotMatch(body, /8765/, 'the operator HTTP port is not reachable from the app at all');
  assert.doesNotMatch(body, /settings\.mcUrl\s*\|\||joinUrl:\s*settings\.mcUrl/, 'a remembered address must never pick the subnet');
  assert.match(body, /sweepPlan\(\{[^}]*joinUrl:\s*currentJoinUrl/, 'the subnet comes from THIS run\'s join');
  assert.match(body, /new WebSocket\(url\)/, 'and the probe is a websocket, the scheme the LAN join path already uses');
  assert.match(src, /import \{ sweepPlan, localIpFrom, sweepForMc as sweepSubnetsForMc \} from '\.\/transport\/discover\.js'/);
});

test('F153c guard: app.js wires a network-change listener to the transport\'s immediate dial', () => {
  const src = readFileSync(APP_JS, 'utf8');
  assert.match(src, /plugins\.network && plugins\.network\.addListener/, 'guarded — the plugin is absent in a browser and in node');
  assert.match(src, /addListener\('networkStatusChange'/);
  assert.match(src, /transport\.dialNow\(\)/, 'a change to connected must kick a dial, not wait out a backoff');
  assert.match(src, /window\.addEventListener\('online'/, 'the web half of the same signal');
});
