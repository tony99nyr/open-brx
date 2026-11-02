// F644 (field game 2026-11-01): the console needed manual refreshes to show the latest state, most of all after a
// match ended. Root cause: MC sent each snapshot to every `/ui-ws` socket in turn and awaited each send, so ONE
// console socket that stopped reading (a phone that locked its screen, a laptop that slept, a dead path through
// the Windows port proxy) filled its TCP window and held every other tab's snapshots behind it, for ever. A refresh
// opened a new socket, which got its first snapshot directly, so it looked fixed until the next change.
//
//   node test/e2e/stalled-tab.mjs
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…  SHOTS_DIR=…  HEADED=1
//
// The suite opens the operator console on a LIVE demo match, then connects a second `/ui-ws` client that never
// reads (a tiny receive buffer, so its window closes in seconds). The SERVER then moves the match on its own, as
// another tab or the timed end would: END, RECAP, PLAY AGAIN to BUILD, and a new match LIVE. The open console must
// follow every step WITHOUT a reload, and MC must drop the stalled socket, so a tab that wakes up redials.
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as H from './lib/mc-harness.mjs';

const OUT = path.join(H.E2E_DIR, 'shots', 'stalled-tab');
const SHOTS = process.env.SHOTS_DIR || OUT;
const c = H.checker();
const errors = [];
const P = await H.ports();
let mc = null, vite = null, browser = null, staller = null, healthy = null;

/** "TIME REMAINING 09:33" on the page, in seconds. */
const shownRemaining = async pg => {
  const m = /TIME REMAINING (\d+):(\d\d)/.exec(await H.bodyText(pg));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// A /ui-ws client that completes the handshake and then never reads. It watches for the reset that says MC dropped
// it, without reading: the socket's pending error, or (Linux) its TCP state leaving ESTABLISHED.
const STALLER = `
import base64, os, socket, sys, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
s.connect(('127.0.0.1', int(sys.argv[1])))
k = base64.b64encode(os.urandom(16)).decode()
s.sendall(('GET /ui-ws HTTP/1.1\\r\\nHost: x\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n'
           'Sec-WebSocket-Key: %s\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n' % k).encode())
print('STALLED', flush=True)
TCP_INFO = getattr(socket, 'TCP_INFO', None)
while True:
    time.sleep(0.25)
    if s.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR): break
    if TCP_INFO is not None and s.getsockopt(socket.IPPROTO_TCP, TCP_INFO, 8)[0] != 1: break   # 1 = ESTABLISHED
print('DROPPED', flush=True)
`;

try {
  mc = await H.startMC({ port: P.mc, wsPort: P.ws, home: path.join(OUT, 'home') });
  vite = await H.startVite({ port: P.vite, mcPort: P.mc });
  const srv = H.api(mc.base);
  browser = await H.chromium.launch({ headless: !process.env.HEADED });

  c.step = 'live';
  console.log(`\n[${c.step}] the console on a LIVE match`);
  const live = await H.startAMatch(mc.base);
  c.expect(live.phase === 'live', 'the real MC is LIVE');
  const pg = await H.newPage(browser, { width: 1440, height: 900 }, errors, () => c.step);
  await pg.goto(`${vite.base}/#live`, { waitUntil: 'domcontentloaded' });
  await c.until(async () => /TIME REMAINING/.test(await H.bodyText(pg)), 15000, 'the operator LIVE board');
  await pg.evaluate(() => { window.__noReload = 1; });   // a reload would clear it: the console must follow on its own

  c.step = 'stall';
  console.log(`\n[${c.step}] a second console socket stops reading`);
  // a second, healthy socket counts the snapshots MC sends after the stall starts
  let snaps = 0;
  healthy = new WebSocket(mc.base.replace('http', 'ws') + '/ui-ws');
  healthy.onmessage = ev => { try { if (JSON.parse(ev.data).kind === 'snapshot') snaps++; } catch { /* ignore */ } };
  let stallerOut = '';
  staller = spawn(H.devPython(), ['-c', STALLER, String(P.mc)], { stdio: ['ignore', 'pipe', 'pipe'] });
  staller.stdout.on('data', d => { stallerOut += d; });
  staller.stderr.on('data', d => { stallerOut += d; });
  await c.until(async () => /STALLED/.test(stallerOut), 10000, 'the stalled client to connect');
  const from = snaps;
  // Every snapshot is about 80 KB; flipping a session option is one snapshot each. 60 of them (about 5 MB) close the
  // stalled socket's window and fill MC's send buffer to it many times over. On the old code the healthy socket stops
  // counting partway: that IS the bug, so this loop does not fail on its own; the steps below fail, on what the
  // operator sees.
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    await fetch(`${mc.base}/api/options`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ log_sync: i % 2 ? 'auto' : 'manual' }) });
    await H.sleep(300);   // paces the flips past MC's 4/s snapshot coalescing; no assertion rests on this sleep
  }
  console.log(`      the healthy socket saw ${snaps - from} snapshot(s) in ${Date.now() - t0} ms while the stalled one filled`);

  c.step = 'end';
  console.log(`\n[${c.step}] MC ends the match (another tab, or the timed end)`);
  const r = await srv.post('/api/control', { cmd: 'end' });
  c.expect(r.status < 400, `MC took END (${r.status})`);
  await c.until(async () => (await srv.get('/api/state')).phase === 'recap', 10000, 'the server in RECAP');
  await c.until(async () => /MATCH COMPLETE|MATCH OVER · WAITING FOR RESULTS/.test(await H.bodyText(pg)), 10000,
    'the open console to show RECAP without a reload');
  await H.shot(pg, SHOTS, 'recap');

  c.step = 'play-again';
  console.log(`\n[${c.step}] MC leaves RECAP for the next match`);
  const f = await srv.post('/api/recap/finalise', {});
  c.expect(f.status < 400, `MC released the result (${f.status})`);
  const n = await srv.post('/api/match/next', {});
  c.expect(n.status < 400, `MC moved to the next match (${n.status})`);
  await c.until(async () => new URL(pg.url()).hash === '#build', 10000, 'the open console to land on PLAY (#build) without a reload');
  await c.until(async () => (await pg.getByTestId('game-loaded-status').count()) > 0, 10000, 'PLAY to show the loaded-game status');

  c.step = 'next-live';
  console.log(`\n[${c.step}] a new match goes LIVE`);
  const again = await H.startAMatch(mc.base);
  c.expect(again.phase === 'live' && again.live?.match_id !== live.live?.match_id, 'the server is LIVE on a NEW match');
  await c.until(async () => (await pg.getByTestId('phase-chip').innerText()).includes('● LIVE'), 10000,
    'the open console header to read ● LIVE without a reload');
  // the NEW match's clock, not the first match's last frame (which also read TIME REMAINING)
  await c.until(async () => { const st = await srv.get('/api/state'), got = await shownRemaining(pg);
    return got != null && Math.abs(got - Math.round((st.live.ends_t - st.t) / 1000)) <= 5; }, 10000,
  "the open console to show the new match's clock");
  c.expect(await pg.evaluate(() => window.__noReload === 1), 'the console was never reloaded');
  await H.shot(pg, SHOTS, 'next-live');

  c.step = 'dropped';
  console.log(`\n[${c.step}] MC drops the socket that stopped reading`);
  if (!await c.until(async () => /DROPPED/.test(stallerOut), 30000, 'MC to close the stalled socket (so a tab that wakes up redials)')) {
    console.log(`      MC log tail:\n${mc.log.split('\n').slice(-8).join('\n')}\n      staller: ${stallerOut}`);
  }

  c.step = 'errors';
  const real = errors.filter(e => !/WebSocket connection .* failed|502 \(Bad Gateway\)/.test(e));
  c.expect(real.length === 0, `no console or page errors (${real.length})`);
  if (real.length) console.log(real.slice(0, 10).join('\n'));
} catch (e) {
  c.failures.push(`${c.step}: threw ${e && e.stack || e}`);
  console.log(`    ✗ threw: ${e && e.message}`);
} finally {
  try { healthy?.close(); } catch { /* already closed */ }
  if (staller && staller.exitCode == null) staller.kill();
  if (browser) await browser.close();
  if (vite) await vite.stop();
  if (mc) await mc.stop();
}
process.exit(c.done());
