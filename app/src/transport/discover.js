// Finding Mission Control on the LAN when mDNS cannot (F139, field 2026-09-12).
//
// The old sweep, in app.js, did `fetch('http://<ip>:8765/api/state')` across a /24. On Android the page
// origin is `https://localhost`, so EVERY one of those requests was blocked as Mixed Content — the
// Pixel 4's logcat is a wall of them. The sweep has therefore never once worked on a phone. It also
// derived the /24 from the REMEMBERED MC url, so on a new network it swept yesterday's subnet
// (172.20.10.0/24, an iPhone hotspot from the previous game test) while the phone sat on 192.168.0.0/24.
//
// Two fixes, both here so they can be tested (`app.js` pulls in the DOM and Capacitor at import time, so
// nothing inside it can be exercised by `node --test`):
//
//   1. WHICH /24s. The phone's own address first, whenever anything can give it; then the LAN url of the
//      CURRENT join (this run's QR scan / typed address / discovery / LAN welcome) — never a remembered
//      one; then the common home + hotspot ranges. See `sweepPlan`.
//   2. HOW we probe. Open a WebSocket to `ws://<ip>:<ws-port>/ws` and close it the moment it opens,
//      without ever sending a hello. `ws://` from the app's https origin is exactly what the LAN join
//      path already does successfully on these phones, so it is not blocked the way an http fetch is;
//      and a completed websocket upgrade is a much stronger "this is Mission Control" signal than a bare
//      TCP accept. Sending no hello is the same rule `transport.js:_probePub` follows, for the same
//      reason: MC's node registry is one-socket-per-node, so a hello from a probe would make MC hand the
//      node over and close the real link.
//
// Bounded on purpose: `pool` sockets in flight, `timeoutMs` each, and `shouldStop()` is consulted between
// every batch so a join that lands mid-sweep ends it.

/** The ranges a phone is actually likely to be on: home routers, Google Wifi, and the two phone-hotspot
 *  defaults (iOS 172.20.10.0/24, Android 192.168.43.0/24). */
export const DEFAULT_SUBNETS = ['192.168.0', '192.168.1', '192.168.86', '10.0.0', '192.168.43', '172.20.10'];
/** MC's node websocket port (`mc/__main__.py --ws-port`, default 8766). NOT 8765 — that is the operator
 *  HTTP API, which is what the old http sweep probed. */
export const MC_WS_PORT = 8766;
export const PROBE_TIMEOUT_MS = 800;
export const PROBE_POOL = 32;
export const HOSTS_PER_SUBNET = 254;

/** '192.168.0.149' → '192.168.0'; anything that is not a dotted-quad IPv4 → null. */
export function subnetOf(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip == null ? '' : ip).trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some(n => n > 255)) return null;
  return parts.slice(0, 3).join('.');
}

/** Split a ws url into { host, port, path }, or null if it is not one. */
export function parseWsTarget(url) {
  const m = /^wss?:\/\/([^/:?#]+)(?::(\d+))?([^?#]*)/i.exec(String(url == null ? '' : url).trim());
  if (!m) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : null, path: m[3] || '/ws' };
}

/** The phone's own IPv4, if the object we were handed carries one.
 *  Capacitor's Network plugin reports `{connected, connectionType}` and NOTHING else today, so this
 *  returns null on both phones — it is written against the shape rather than a version so a plugin (or a
 *  swap to one that does report an address) starts working with no other change. `sweepPlan` falls back
 *  to the current join's subnet, which is the only other honest source we have. */
export function localIpFrom(status) {
  if (!status || typeof status !== 'object') return null;
  for (const k of ['ipAddress', 'ip', 'ipv4', 'ipv4Address', 'address', 'localIp']) {
    const v = status[k];
    if (typeof v === 'string' && subnetOf(v)) return v;
  }
  return null;
}

/**
 * What to sweep, in order: the phone's own /24, then the CURRENT join's /24, then the common ranges.
 * `joinUrl` must be this run's join target — a remembered address is what sent the field sweep after a
 * subnet the phone had not been on since the day before.
 * @returns {{subnets:string[], ports:number[], path:string}}
 */
export function sweepPlan({ localIp = null, joinUrl = null, extra = DEFAULT_SUBNETS } = {}) {
  const subnets = [];
  const push = sn => { if (sn && !subnets.includes(sn)) subnets.push(sn); };
  push(subnetOf(localIp));
  const target = parseWsTarget(joinUrl);
  if (target) push(subnetOf(target.host));
  for (const sn of extra || []) push(subnetOf(`${sn}.1`));
  const ports = [];
  if (target && target.port) ports.push(target.port);
  if (!ports.includes(MC_WS_PORT)) ports.push(MC_WS_PORT);
  return { subnets, ports, path: (target && target.path) || '/ws' };
}

/**
 * Is there a websocket server at `url`? Opens, and closes again on `onopen` WITHOUT sending anything.
 * Resolves false on error/close-before-open and on the timeout (a host with no route fires no event at
 * all — that is the case the timeout exists for).
 * @returns {Promise<boolean>}
 */
export function probeWsOpen(url, { wsFactory, timers = globalThis, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    let ws = null, done = false, timer = null;
    const finish = ok => {
      if (done) return; done = true;
      if (timer != null) { try { timers.clearTimeout(timer); } catch (_) { /* ignore */ } timer = null; }
      if (ws) {
        try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; } catch (_) { /* ignore */ }
        try { ws.close(1000, 'probe'); } catch (_) { /* ignore */ }
      }
      resolve(ok);
    };
    try { ws = wsFactory(url); } catch (_) { resolve(false); return; }
    timer = timers.setTimeout(() => finish(false), timeoutMs);
    ws.onopen = () => finish(true);          // upgraded — a server is there. No hello, ever.
    ws.onerror = () => { /* onclose follows, or the timeout has it */ };
    ws.onclose = () => finish(false);
    ws.onmessage = () => { /* nothing was sent, so nothing meaningful can arrive */ };
  });
}

/**
 * Sweep the planned /24s for MC's node socket. Returns the ws url that answered, or null.
 * @param {object} o  `subnets`/`ports`/`path` from `sweepPlan`, plus the injectable machinery the tests
 *                    use: `wsFactory`, `timers`, `timeoutMs`, `pool`, `hosts`, `shouldStop`, `onSubnet`.
 */
export async function sweepForMc({ subnets = [], ports = [MC_WS_PORT], path = '/ws', wsFactory,
                                   timers = globalThis, timeoutMs = PROBE_TIMEOUT_MS, pool = PROBE_POOL,
                                   hosts = HOSTS_PER_SUBNET, shouldStop = () => false, onSubnet = null } = {}) {
  for (const sn of subnets) {
    if (shouldStop()) return null;
    if (onSubnet) { try { onSubnet(sn); } catch (_) { /* ignore */ } }
    for (let start = 1; start <= hosts; start += pool) {
      if (shouldStop()) return null;
      const batch = [];
      for (let i = start; i < start + pool && i <= hosts; i++) batch.push(i);
      const hits = await Promise.all(batch.map(async i => {
        for (const port of ports) {
          const url = `ws://${sn}.${i}:${port}${path}`;
          if (await probeWsOpen(url, { wsFactory, timers, timeoutMs })) return url;
        }
        return null;
      }));
      const found = hits.find(Boolean);
      if (found) return found;
    }
  }
  return null;
}
