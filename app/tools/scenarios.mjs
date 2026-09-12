import fs0 from 'fs'; try { fs0.mkdirSync(process.env.SHOTS_DIR || new URL('../shots', import.meta.url).pathname, { recursive: true }); } catch {}
// Edge-state visual QA: the live reconcile (§3.10), BLE-drop, abort, panic — states rig.mjs's happy path skips.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MC = process.env.MC || 'http://127.0.0.1:8765', WS = process.env.WS || MC.replace('http', 'ws').replace(':8765', ':8766') + '/ws';
const root = new URL('../www', import.meta.url).pathname;
const S = process.env.SHOTS_DIR || new URL('../shots', import.meta.url).pathname;
const srv = http.createServer((req, res) => { const p = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  try { res.setHeader('content-type', p.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(fs.readFileSync(p)); } catch { res.statusCode = 404; res.end(); } }).listen(4185);
const api = async (m, p, b) => (await fetch(MC + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 400)); } throw new Error('until timeout'); };
console.log('fresh:', (await api('POST', '/api/session/new', { keep_roster: false })).phase);
const scan = await api('POST', '/api/armory/scan', { duration_s: 1 });
const gun = (Array.isArray(scan) ? scan : scan.rows || [])[0];
const b = await chromium.launch(); const hud = await b.newPage({ viewport: { width: 891, height: 411 } });
hud.on('pageerror', e => console.log('PAGEERROR:', e.message));
const shot = async t => { await hud.screenshot({ path: `${S}/sc-${t}.png` }); console.log('shot', t); };
await hud.goto(`http://127.0.0.1:4185/?mc=${encodeURIComponent(WS)}&gun=${encodeURIComponent(gun.name)}`);
await hud.waitForTimeout(1200);
await api('POST', '/api/players', { display: 'ALPHA', team_id: 'blue', gun_id: gun.gun_id });
await api('PUT', '/api/config', { time_limit_s: 300 });
await until(async () => (await api('GET', '/api/state')).players[0].node_id);
await until(async () => (await hud.locator('[data-act="onReady"]').count()) > 0);
await hud.click('[data-act="onReady"]');
await until(async () => (await api('GET', '/api/state')).readiness.go === true);
await api('POST', '/api/lobby/push', {});
await until(async () => { const st = await api('GET', '/api/state'); const a = st.lobby.acks; return a && Object.values(a)[0] && Object.values(a)[0].ok; });
// scenario A: abort during the countdown
await api('POST', '/api/start', { runway_s: 30 });
await hud.waitForTimeout(2500); await shot('a1-armed');
await api('POST', '/api/start/abort', {});
await hud.waitForTimeout(1200); await shot('a2-aborted-back-to-lobby');
// scenario B: start, BLE drop mid-live → NO GUN state; relink → the S7.1 RECONCILE (node.md §3.10).
// NOT the trigger-first resync prompt: that evidence protocol was retired for the live path (it mis-concluded
// "dead" and let auto-respawn heal the player on restart) and now survives only for lobby/armed. A live relink
// — and a live app RESUME, which took the retired path until 2026-09-12 — disarms for RECONCILE_MS, keeps the
// real pools, then re-arms. Nothing is asked of the player.
await api('POST', '/api/start', { runway_s: 3 });
await hud.waitForTimeout(6000); await shot('b1-live');
await hud.evaluate(() => window.fakeGun.drop());
await hud.waitForTimeout(1000); await shot('b2-ble-dropped');
await hud.evaluate(() => window.fakeGun.relink());
await hud.waitForTimeout(1500); await shot('b3-reconciling');
console.log('reconcile state:', await hud.evaluate(() => { const s = window.brx.engine.state(); return JSON.stringify({ reconciling: s.reconciling, resync: s.resync, alive: s.alive, hp: s.hp }); }));
// no trigger pull is asked of the player: the window closes on its own and the gun re-arms at its REAL hp
await hud.waitForTimeout(2500); await shot('b4-reconciled');
console.log('after the window:', await hud.evaluate(() => { const s = window.brx.engine.state(); return JSON.stringify({ reconciling: s.reconciling, resync: s.resync, alive: s.alive, hp: s.hp, phase: s.phase }); }));
// scenario C: host PANIC
await api('POST', '/api/control', { cmd: 'panic', confirm: true });
await hud.waitForTimeout(1500); await shot('c1-panic');
console.log('post-panic:', await hud.evaluate(() => { const s = window.brx.engine.state(); return JSON.stringify({ phase: s.phase, ended: s.ended }); }));
await b.close(); srv.close();
