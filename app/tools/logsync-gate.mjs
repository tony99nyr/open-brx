// logsync-gate.mjs — `npm run ui:logsync`. The browser gate for background log sync (contracts A25)
// and the baked build version (A29). It drives the REAL HUD bundle in Chromium against the REAL
// Python NetServer, so nothing here is a stand-in for the wire.
//
// WHAT IT PROVES (17 checks, each printed PASS/FAIL; exit 1 if any fail):
//   A29  `hello` and EVERY `status` heartbeat carry "<version>+<sha>[-dirty]" and platform, read off
//        the actual frames the page sent (WebSocket.prototype.send is hooked before the app loads);
//        the debug panel's LINK section opens with that build.
//   A25  a `pull_log` that arrives with an unacked fact in the ring sends NOT ONE log frame and the
//        node reads `held(N facts pending)`; draining the ring serves the PARKED request on its own
//        backoff, keeping MC's original `reason`, as `log_offer` + `log_data{last:true}`; a second
//        pull resumes from `uploadedThrough` and is smaller; an ARMED node (driven there by a real
//        assign/config/start push) holds again and tells MC so in `status.log`.
//   D5   no CAM handler survives behind the look-through button (S21).
//
// HOW TO RUN:  cd app && npm run build && npm run ui:logsync
// It starts EVERYTHING it needs and cleans up: its own NetServer on an EPHEMERAL port (via the
// harness at app/test/mc_server.py, WSL .venv python) and a static server for app/www on :4181.
// No Mission Control instance, no gun, no BLE — the HUD runs with the fake gun (`?gun=`).
// The one thing it does NOT cover is a real device: platform reads `web` in Chromium, and only an
// APK/IPA can prove `android`/`ios`.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

import { fileURLToPath } from 'node:url';
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = path.resolve(APP, '../.venv/bin/python');   // WSL dev venv: websockets + brx_mcp on the path
const root = path.join(APP, 'www');
const srv = http.createServer((req, res) => {
  const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0];
  try { res.setHeader('content-type', rel.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(fs.readFileSync(path.join(root, rel))); }
  catch { res.statusCode = 404; res.end(); }
}).listen(4181);

const mc = spawn(PY, [path.join(APP, 'test/mc_server.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = []; let buf = '';
mc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) lines.push(JSON.parse(l)); } });
const until = async (pred, ms = 20000, what = '') => { const t0 = Date.now(); for (;;) { const m = lines.find(pred); if (m) return m; if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await new Promise(r => setTimeout(r, 150)); } };
const tell = o => mc.stdin.write(JSON.stringify(o) + '\n');
const fail = [];
const check = (ok, what, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  ' + extra : ''}`); if (!ok) fail.push(what); };

const { port } = await until(o => o.port, 10000, 'mc port');
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 891, height: 411 } });
page.on('pageerror', e => { console.log('HUD PAGEERROR:', e.message); fail.push('pageerror: ' + e.message); });
page.on('console', m => { if (m.type() === 'error') console.log('HUD console.error:', m.text()); });
// record the REAL wire frames the phone sends
await page.addInitScript(() => {
  window.__wire = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) { try { window.__wire.push(JSON.parse(d)); } catch (_) {} return send.call(this, d); };
});
await page.goto(`http://127.0.0.1:4181/?gun=RIGG-1234&mc=${encodeURIComponent(`ws://127.0.0.1:${port}/ws`)}`);
await until(o => o.ev === 'node', 20000, 'node hello');
await page.waitForFunction(() => window.brx && window.brx.transport && window.brx.transport.state === 'bound', null, { timeout: 20000 });

// ---- A29 on the wire ----
const hello = await page.evaluate(() => window.__wire.find(f => f.kind === 'hello').body);
check(/^\d+\.\d+\.\d+\+\S+$/.test(hello.app_ver), 'hello.app_ver is the baked build', JSON.stringify(hello.app_ver));
check(hello.platform === 'web', 'hello.platform', hello.platform);
await page.waitForFunction(() => window.__wire.filter(f => f.kind === 'status').length >= 2, null, { timeout: 15000 });
const st = await page.evaluate(() => window.__wire.filter(f => f.kind === 'status').pop().body);
check(st.app_ver === hello.app_ver && st.platform === 'web', 'every status heartbeat repeats app_ver + platform', JSON.stringify({ app_ver: st.app_ver, platform: st.platform, log: st.log }));
check(st.log === 'none', 'status.log before any pull', String(st.log));

// ---- A25: an unacked fact HOLDS the pull ----
await page.evaluate(() => window.brx.transport.ring.push({ type: 'respawn', t: Date.now(), node_id: 'x', player_id: 'p1', match_id: null }));
lines.length = 0;
tell({ push: { node_id: await page.evaluate(() => window.brx.transport.nodeId), kind: 'pull_log', body: { reason: 'recap' } } });
await new Promise(r => setTimeout(r, 2500));
const early = lines.filter(o => o.ev === 'msg' && (o.kind === 'log_offer' || o.kind === 'log_data'));
check(early.length === 0, 'pull_log with an unacked fact sends NO log frame', `${early.length} frames`);
const held = await page.evaluate(() => window.brx.logsync.state());
check(/^held\(/.test(held), 'logsync state is held(...)', held);
const diagLog = await page.evaluate(() => { window.brx.hud.toggleDiag(); const rows = [...window.brx.hud.diag.querySelectorAll('#dg-link span')].map(e => e.textContent); window.brx.hud.toggleDiag(); return rows.slice(0, 6); });
check(diagLog[0] === 'app' && /^\d+\.\d+\.\d+\+/.test(diagLog[1]), 'debug panel LINK shows the build first', JSON.stringify(diagLog));

// ---- the ring drains → the parked pull is served on the backoff, with no new ask from MC ----
await page.evaluate(() => window.brx.transport.ring.prune(1e9));
const offer = await until(o => o.ev === 'msg' && o.kind === 'log_offer', 20000, 'deferred log_offer');
const data = await until(o => o.ev === 'msg' && o.kind === 'log_data', 10000, 'log_data');
check(offer.body.reason === 'recap', 'the deferred offer keeps MC\'s reason', String(offer.body.reason));
check(data.body.last === true && typeof data.body.chunk === 'string' && data.body.chunk.length > 0, 'log_data{last:true} with content', `${data.body.chunk.length} chars`);
check((await page.evaluate(() => window.brx.logsync.state())) === 'none', 'logsync back to none');
const through = await page.evaluate(() => window.brx.logsync.uploadedThrough);
check(through > 0, 'uploadedThrough advanced', String(through));

// ---- a second pull sends only the tail ----
lines.length = 0;
await page.evaluate(() => window.brx.log.length && window.brx.logsync);
tell({ push: { node_id: await page.evaluate(() => window.brx.transport.nodeId), kind: 'pull_log', body: { reason: 'manual' } } });
const offer2 = await until(o => o.ev === 'msg' && o.kind === 'log_offer', 10000, 'second offer');
check(offer2.body.from === through, 'the second offer resumes from uploadedThrough', `${offer2.body.from} vs ${through}`);
check(offer2.body.bytes < offer.body.bytes, 'the tail is smaller than the first upload', `${offer2.body.bytes} < ${offer.body.bytes}`);

// ---- CAM is gone (D5) ----
const camBtn = await page.evaluate(() => !!document.querySelector('[data-act="onToggleCam"]') && !!(window.brx.hud.h.onToggleCam));
check(camBtn === false, 'no CAM handler behind the button (S21/D5)', String(camBtn));

// ---- the ARMED gate, through a real start ----
const nid = await page.evaluate(() => window.brx.transport.nodeId);
tell({ push: { node_id: nid, kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, team: { team_id: 'blue', name: 'Blue', color: 'blue', tid: 1 }, roster: [] } } });
tell({ push: { node_id: nid, kind: 'config', body: { config: { config_id: 'c1', time_limit_s: 600 }, frames: { head: ['$CLEAR,*'], spawn: [], revive: [], end: [], panic: [], cues: {} }, roster: [] } } });
tell({ broadcast: { kind: 'start', body: { match_id: 'm-gate', go_live_t: Date.now() + 120000, config_id: 'c1', seq: 1, countdown_s: 120 } } });
await page.waitForFunction(() => window.brx.engine.phase === 'armed', null, { timeout: 15000 });
lines.length = 0;
tell({ push: { node_id: nid, kind: 'pull_log', body: { reason: 'recap' } } });
await new Promise(r => setTimeout(r, 2500));
check(lines.filter(o => o.ev === 'msg' && o.kind.startsWith('log_')).length === 0, 'ARMED: pull_log sends no log frame');
check((await page.evaluate(() => window.brx.logsync.state())) === 'held(armed)', 'logsync state held(armed)', await page.evaluate(() => window.brx.logsync.state()));
const stArmed = await page.evaluate(() => window.__wire.filter(f => f.kind === 'status').pop().body);
check(stArmed.log === 'held(armed)', 'status.log tells MC the node is holding', String(stArmed.log));

await b.close(); tell({ quit: 1 }); mc.kill(); srv.close();
console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(' | ')}` : '\nall gate checks passed');
process.exit(fail.length ? 1 : 0);
