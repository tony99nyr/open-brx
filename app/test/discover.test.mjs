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
         DEFAULT_SUBNETS, MC_WS_PORT, PROBE_POOL, PROBE_PACING_MS } from '../src/transport/discover.js';

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

test('office test 2026-09-19: a paused sweep waits rather than gives up, and resumes once unpaused', async () => {
  // Field/office finding: the sweep ran ON TOP of a gun connect and was the likely cause of a 1-2 s freeze
  // before the picker's "Connecting to <gun>…" screen. `isPaused` must hold the NEXT batch, not abandon the
  // sweep the way `shouldStop` does -- so it still finds MC once the connect is done.
  const mc = 'ws://192.168.0.9:8766/ws';
  const { sockets, wsFactory } = lan([mc]);
  let paused = true;
  const plan = sweepPlan({ localIp: '192.168.0.149' });
  const p = sweepForMc({ ...plan, wsFactory, timeoutMs: 10, pool: 4, hosts: 20, pacingMs: 1, isPaused: () => paused });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(sockets.length, 0, 'paused before the first batch: nothing probed yet');
  paused = false;
  assert.equal(await p, mc, 'resumed, and went on to find it');
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
  await sweepForMc({ subnets: ['192.168.0'], ports: [8766], wsFactory, timeoutMs: 5, hosts: 40, pacingMs: 0 });
  assert.ok(peak <= PROBE_POOL, `peak in flight ${peak} <= the default pool ${PROBE_POOL}`);
  // Closing a socket that is still CONNECTING does not free it in a WebView, so the default is small on
  // purpose: a wide pool leaves hundreds half-open and starves the probes behind them.
  assert.ok(PROBE_POOL <= 8, 'the default pool stays small');
  assert.ok(PROBE_PACING_MS > 0, 'and batches are paced, so the platform can reap what we closed');
});

test('F139: a probe queued behind earlier batches gets its FULL window — the clock starts when it dials', async () => {
  // The MC on this LAN is the LAST host swept and answers 25 ms after ITS OWN socket is built. If the
  // timeout were armed when the sweep started rather than when this probe dialled, its window would be
  // long gone by the time its turn came and the one MC on the LAN would be reported as absent.
  const mc = 'ws://192.168.0.6:8766/ws';
  const sockets = [];
  const wsFactory = url => {
    const w = new FakeWS(url); sockets.push(w);
    if (url === mc) setTimeout(() => w.onopen && w.onopen(), 25);
    return w;
  };
  const found = await sweepForMc({ subnets: ['192.168.0'], ports: [8766], wsFactory, timeoutMs: 40,
                                   pool: 2, hosts: 6, pacingMs: 1 });
  assert.equal(found, mc);
  assert.ok(sockets.length >= 6, 'it really did work through the earlier batches first');
});

test('F139: the sweep stops the moment a host answers — no further ports, no further batches', async () => {
  const mc = 'ws://192.168.0.1:8766/ws';
  const { sockets, wsFactory } = lan([mc]);
  const found = await sweepForMc({ subnets: ['192.168.0'], ports: [8766, 9999], path: '/ws', wsFactory,
                                   timeoutMs: 20, pool: 4, hosts: 254, pacingMs: 1 });
  assert.equal(found, mc);
  assert.ok(sockets.every(s => !s.url.includes(':9999')), 'the second port was never tried once one answered');
  assert.ok(sockets.length <= 4, `only the batch that found it was opened (${sockets.length})`);
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
  assert.match(body, /sweepSubnetsForMc\(\{[^\n]*wsFactory/, 'the probe uses the shared WebSocket factory');
  assert.match(src, /const wsFactory = makeWsFactory\(\)/, 'the factory selects the native socket on Android');
  // security (review pass 1): a websocket upgrade is all a squatter on the node port has to answer, and
  // the hello that follows carries this node's takeover key. A hit is a suggestion the player taps.
  assert.doesNotMatch(body, /connectMc\(/, 'the sweep must NEVER dial its own hit');
  assert.match(body, /suggestMc\(found, 'sweep'\)/, 'it hands the hit to suggestMc (a JOIN row, or an A60 proof dial)');
  assert.match(src, /import \{ sweepPlan, localIpFrom, sweepForMc as sweepSubnetsForMc \} from '\.\/transport\/discover\.js'/);
});

test('office test 2026-09-19 guard: the sweep is paused for the whole gun connect (onPick\'s `picking`)', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const i = src.indexOf('async function sweepForMc(');
  const body = src.slice(i, src.indexOf('\n}', i));
  assert.match(body, /isPaused: \(\) => picking/, 'the sweep must not run on top of a gun connect (the likely cause of the field freeze)');
});

test('F153c guard: app.js wires a network-change listener to the transport\'s immediate dial', () => {
  const src = readFileSync(APP_JS, 'utf8');
  assert.match(src, /plugins\.network && plugins\.network\.addListener/, 'guarded — the plugin is absent in a browser and in node');
  assert.match(src, /addListener\('networkStatusChange'/);
  assert.match(src, /transport\.dialNow\(\)/, 'a change to connected must kick a dial, not wait out a backoff');
  assert.match(src, /window\.addEventListener\('online'/, 'the web half of the same signal');
});

test('F139 guard: the discovered address is joined only by an explicit tap, and even then untrusted', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const i = src.indexOf('onJoinDiscovered:');
  assert.ok(i > 0, 'the JOIN handler the HUD calls is gone — FIX this guard, do not delete it');
  const body = src.slice(i, src.indexOf('\n  },', i));
  assert.match(body, /hud\.discovered/, 'it dials what the sweep suggested');
  assert.match(body, /connectMc\(d\.url, false, \{ trusted: false, user: true \}\)/,
    'remember:FALSE — a tapped address is not the explicit target and is persisted only if it binds us; trusted:false keeps the key off the hello');
  // and the transport half of that promise
  const t = readFileSync(path.resolve(HERE, '../src/transport/transport.js'), 'utf8');
  assert.match(t, /this\.secret && this\.trusted \? \{ secret: this\.secret \}/);
  assert.match(t, /this\.nodeKey && this\.trusted \? \{ node_key: this\.nodeKey \}/);
});

test('F153c guard: ONE coalesced entry point for the network-came-back signal', () => {
  const src = readFileSync(APP_JS, 'utf8');
  // Android fires the Capacitor networkStatusChange AND the webview's `online` for the same transition;
  // two kicks abort each other's dial and reset the backoff twice, so a flapping radio never backs off.
  assert.equal((src.match(/transport\.dialNow\(\)/g) || []).length, 1, 'exactly one caller');
  assert.match(src, /function kickDial\(/);
  assert.match(src, /now - lastKickAt < 1000/, 'coalesced');
  assert.match(src, /addListener\('networkStatusChange', st => \{[\s\S]*?kickDial\(/);
  assert.match(src, /window\.addEventListener\('online', \(\) => kickDial\('online'\)\)/);
});

// ---------------- review pass 2 ----------------

test('security guard: a SUGGESTED address persists only once it binds us; a USER-PROVIDED one persists at the dial', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const writes = [...src.matchAll(/settings\.mcUrl\s*=\s*[^=]/g)];
  // A60 (F203 revised): a remembered url that misses its first welcome is NOT cleared any more; the
  // transport keeps redialling it and a sweep runs beside it. So only the two writes are left.
  assert.equal(writes.length, 2, 'user dial and successful bind; nothing clears a remembered url');

  // 1. the dial-time write is gated on `remember`, which only a user-provided address gets
  const connect = src.indexOf('function connectMc(');
  const head = src.slice(connect, src.indexOf('lastMcUrl = url;', connect));
  assert.match(head, /if \(remember\) \{ settings\.mcUrl = url; hud\.mcUrl = url; \}/,
    'a QR scanned or an address typed while MC is down must still be there on the next launch');
  assert.equal([...head.matchAll(/settings\.mcUrl\s*=/g)].length, 1);

  // 2. ...and the suggestion path passes remember:false, so nothing is written until it binds
  const tap = src.slice(src.indexOf('onJoinDiscovered:'), src.indexOf('\n  },', src.indexOf('onJoinDiscovered:')));
  assert.match(tap, /connectMc\(d\.url, false, \{ trusted: false, user: true \}\)/,
    'an address the user never named: not persisted at the dial, and keyless on the wire');

  // 3. the second write is the bind — which is what finally remembers a suggestion that was right
  const bound = src.indexOf("if (s === 'bound')");
  const boundEnd = src.indexOf('else if (!assistTimer)', bound);
  assert.ok(bound > 0 && boundEnd > bound && writes[1].index > bound && writes[1].index < boundEnd,
    'the second write is in the bound branch');
  assert.match(src.slice(writes[1].index, writes[1].index + 60), /settings\.mcUrl = transport\.url/,
    'and it remembers the url that actually bound us, not whatever was dialled');
  const catchAt = src.indexOf('/no welcome within/.test(');
  assert.ok(catchAt > 0, 'the first-welcome-timeout branch is gone: FIX this guard, do not delete it');
  const f203 = src.slice(catchAt, src.indexOf('\n', catchAt));
  assert.match(f203, /sweepForMc\(\)/, 'a missed first welcome starts a sweep beside the remembered dial');
  assert.doesNotMatch(f203, /settings\.mcUrl|clearJoinTarget|\.close\(\)/, 'and forgets nothing, closes nothing (F203 revised, A60)');

  // 4. the user-provided callers really do ask to be remembered
  const qr = src.slice(src.indexOf('QR scanned — connecting'), src.indexOf('QR scanned — connecting') + 240);
  assert.match(qr, /connectMc\(join\.url, true, \{ pub: join\.pub, secret: join\.secret, user: true \}\)/, 'a scanned QR is the user naming an address');
  const typed = src.slice(src.indexOf('onSetUrl:'), src.indexOf('\n  },', src.indexOf('onSetUrl:')));
  assert.match(typed, /connectMc\(j\.url, true, \{ pub: j\.pub, secret: j\.secret, user: true \}\)/, 'so is a typed join code');
});

test('security guard: an mDNS advert is offered, never dialled — same one-tap row as a sweep hit', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const i = src.indexOf('function startDiscovery(');
  assert.ok(i > 0, 'startDiscovery is gone — FIX this guard, do not delete it');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.doesNotMatch(body, /connectMc\(/, 'anything on the field Wi-Fi can advertise _openbrx._tcp');
  assert.match(body, /suggestMc\(url, 'mdns'\)/);
  // A60: the only dial suggestMc makes is a VERIFY dial (keyless, nothing processed before the proof)
  const j = src.indexOf('function suggestMc(');
  const suggest = src.slice(j, src.indexOf('\n}\n', j));
  const dials = [...suggest.matchAll(/connectMc\([^\n]*/g)].map(m => m[0]);
  // (the remembered url, re-dialled when discovery sees it and nothing is dialling, is not automatic in
  // this sense: the player named it or it bound us, the same rule as every boot dial)
  assert.deepEqual(dials, ['connectMc(settings.mcUrl);', 'connectMc(url, false, { verify: true, source });'], 'an automatic dial is a proof dial, never a trusted or keyless-trusting one');
  assert.match(suggest, /holdsTrustKey\(\)/, 'only a phone that holds a trust key may proof-dial');
  // and the offer itself dials nothing
  const k = src.indexOf('function offerMc(');
  const offer = src.slice(k, src.indexOf('\n}\n', k));
  assert.doesNotMatch(offer, /connectMc\(/);
  assert.match(offer, /hud\.discovered = \{ url, at: Date\.now\(\), source, reason, text \}/);
  assert.match(offer, /state === 'bound'/, 'never offered while we are already home');
});

test('security guard: no automatic dial is left anywhere — every connectMc caller is a tap, a scan, or a url that bound us', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const callers = [...src.matchAll(/connectMc\(/g)].map(m => {
    const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index)).trim();
    return line;
  }).filter(l => !l.startsWith('*') && !l.startsWith('//'));
  for (const l of callers) {
    assert.ok(/params|d\.url|j\.url|join\.url|settings\.mcUrl|\bv\)|\bv, true, \{ user: true \}\)|\burl,|\burl\)/.test(l), `unexpected connectMc caller: ${l}`);
  }
  assert.ok(callers.length >= 4, 'the real callers are still there');
  // A60: the one caller that no person started (a discovery hit) must be a verify dial...
  const auto = callers.filter(l => /connectMc\(url, false/.test(l));
  assert.deepEqual(auto, ['connectMc(url, false, { verify: true, source });']);
  // ...and a verify dial must send neither the takeover key, the join secret nor the utility proof
  const t = readFileSync(path.resolve(HERE, '../src/transport/transport.js'), 'utf8');
  assert.match(t, /this\.trusted = trusted !== false && !this\.verify;/, 'verify forces an untrusted (keyless) hello');
  assert.match(t, /this\.secret && this\.trusted \? \{ secret: this\.secret \}/);
  assert.match(t, /this\.nodeKey && this\.trusted \? \{ node_key: this\.nodeKey \}/);
  assert.match(t, /this\.priorUtility && this\.trusted \? \{ prior_utility: this\.priorUtility \}/);
  assert.match(t, /if \(this\.pub && !this\.verify\) this\._dialVia\('backhaul'/, 'and never goes to the trusted MC\'s tunnel');
});

test('A60 guard: the verify path processes nothing before the proof check', () => {
  const t = readFileSync(path.resolve(HERE, '../src/transport/transport.js'), 'utf8');
  // _onWelcome: the verify block is the FIRST statement, ahead of every timer, key, join and hydrate
  const w = t.indexOf('  _onWelcome(body) {');
  const welcome = t.slice(w, t.indexOf('\n  }\n', w));
  const firstStmt = welcome.split('\n').slice(1).find(l => l.trim() && !l.trim().startsWith('//'));
  assert.equal(firstStmt.trim(), 'if (this.verify) {', 'the proof check must come before anything else in the welcome');
  const check = welcome.indexOf('matchingKey(');
  for (const later of ['this._adoptSecret', 'this._adoptPub', 'this._storeTrustKey', 'this.nodeKey = body.node_key', 'this._absorb', 'this.bind()', '_onHydrate', '_setState(']) {
    const at = welcome.indexOf(later);
    assert.ok(at > check, `${later} runs after the proof check`);
  }
  // _onFrame: nothing but the welcome is looked at while a verify dial is unproven
  const f = t.indexOf('  _onFrame(text) {');
  const frame = t.slice(f, t.indexOf('\n  }\n', f));
  const gate = frame.indexOf("if (this.verify) return;");
  assert.ok(gate > 0 && gate > frame.indexOf("if (kind === 'welcome')"), 'the verify gate sits right after the welcome dispatch');
  for (const later of ["kind === 'ack'", "kind === 'time_res'", "kind === 'config'", "kind === 'join'", 'DELIVERED.has']) {
    assert.ok(frame.indexOf(later) > gate, `${later} is processed only after the verify gate`);
  }
  // and connect() in verify mode touches no held pub/secret/url scope before the proof
  const c = t.indexOf('    if (this.verify) {\n      // A60: nothing held');
  const vconnect = t.slice(c, t.indexOf('\n    }\n', c));
  assert.doesNotMatch(vconnect, /_setPub|_setSecret|_pubUrlKey/);
});
