import fs0 from 'fs'; try { fs0.mkdirSync(process.env.SHOTS_DIR || new URL('../shots', import.meta.url).pathname, { recursive: true }); } catch {}
// Full-stack browser rig: REAL MC server + MC web UI (page A) + REAL HUD with a fake gun (page B).
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MC = process.env.MC || 'http://127.0.0.1:8765', WS = process.env.WS || MC.replace('http', 'ws').replace(':8765', ':8766') + '/ws';
const root = new URL('../www', import.meta.url).pathname;
const srv = http.createServer((req, res) => { const p = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  try { res.setHeader('content-type', p.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(fs.readFileSync(p)); } catch { res.statusCode = 404; res.end(); } }).listen(4180);
const api = async (m, p, b) => { const r = await fetch(MC + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
const S = process.env.SHOTS_DIR || new URL('../shots', import.meta.url).pathname;
const b = await chromium.launch();
const mc = await b.newPage({ viewport: { width: 1280, height: 800 } });
const hud = await b.newPage({ viewport: { width: 891, height: 411 } });
hud.on('pageerror', e => console.log('HUD PAGEERROR:', e.message));
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 400)); } throw new Error('until timeout'); };
const shot = async (tag) => { await mc.screenshot({ path: `${S}/rig-mc-${tag}.png` }); await hud.screenshot({ path: `${S}/rig-hud-${tag}.png` }); console.log('shot', tag); };

console.log('fresh session:', (await api('POST', '/api/session/new', { keep_roster: false })).phase);
await mc.goto(MC + '/');
// 1. muster: scan the (fake) armory, grab a gun id
const scan = await api('POST', '/api/armory/scan', { duration_s: 1 });
const gun = (Array.isArray(scan) ? scan : scan.rows || [])[0];
console.log('armory first gun:', JSON.stringify(gun));
const gunName = gun.name;   // ScanRow carries the advertised name (sticker-tail)
// 2. HUD joins with the fake gun
await hud.goto(`http://127.0.0.1:4180/?mc=${encodeURIComponent(WS)}&gun=${encodeURIComponent(gunName)}`);
await hud.waitForTimeout(1500); await shot('1-muster-joined');
// 3. roster: ALPHA on blue with that gun
const p1 = await api('POST', '/api/players', { display: 'ALPHA', team_id: 'blue', gun_id: gun.gun_id });
console.log('player:', p1.player_id);
await until(async () => { const st = await api('GET', '/api/state'); return st.players[0] && st.players[0].node_id; });
await api('PUT', '/api/config', { time_limit_s: 120 });
await hud.waitForTimeout(1200); await shot('2-kitted');
// 4. HUD readies up (a real tap on the real button)
await until(async () => (await hud.locator('[data-act="onReady"]').count()) > 0);
await hud.click('[data-act="onReady"]');
// wait for MC's own green light (readiness rollup needs the first status heartbeat)
await until(async () => (await api('GET', '/api/state')).readiness.go === true, 20000);
// 5. push config, HUD echoes, board green
console.log('push:', JSON.stringify(await api('POST', '/api/lobby/push', {})));
await until(async () => { const st = await api('GET', '/api/state'); const a = st.lobby && st.lobby.acks; return a && Object.values(a)[0] && Object.values(a)[0].ok; });
await shot('3-pushed-lobby');
const st1 = await api('GET', '/api/state');
console.log('acks:', JSON.stringify(st1.lobby && st1.lobby.acks), 'board:', st1.readiness.board[0] && st1.readiness.board[0].status);
// 6. start with a 12 s runway → armed T-minus on the HUD
console.log('start:', JSON.stringify(await api('POST', '/api/start', { runway_s: 12 })));
await hud.waitForTimeout(3000); await shot('4-armed-tminus');
await hud.waitForTimeout(10000); await shot('5-live');   // past T-0
// 7. combat: fire, take hits, die, respawn
await hud.evaluate(() => window.fakeGun.fire(5));
await hud.waitForTimeout(500);
await hud.evaluate(() => window.fakeGun.hit(4));
await hud.waitForTimeout(400); await shot('6-taking-fire');
await hud.evaluate(() => window.fakeGun.kill());
await hud.waitForTimeout(800); await shot('7-down');
await hud.waitForTimeout(9000); await shot('8-redeployed');   // auto respawn 8s
// 8. end the match from MC (host control), HUD → result screen
await api('POST', '/api/control', { cmd: 'end' });
await hud.waitForTimeout(1500); await shot('9-result');
await hud.click('[data-act="onEndOk"]');
await hud.waitForTimeout(600); await shot('10-over');
const st2 = await api('GET', '/api/state');
console.log('final phase:', st2.phase, 'recap rows:', JSON.stringify((st2.recap && st2.recap.rows || []).map(r => [r.display, r.kills, r.deaths])));
await b.close(); srv.close();
