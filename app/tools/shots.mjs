import fs0 from 'fs'; try { fs0.mkdirSync(process.env.SHOTS_DIR || new URL('../shots', import.meta.url).pathname, { recursive: true }); } catch {}
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = new URL('../www', import.meta.url).pathname;
const srv = http.createServer((req, res) => {
  const p = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  try { const b = fs.readFileSync(p); res.setHeader('content-type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream'); res.end(b); }
  catch { res.statusCode = 404; res.end('nf'); }
}).listen(4173);
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 891, height: 411 } }); // Pixel-ish landscape
const logs = []; pg.on('console', m => logs.push(m.text()));
await pg.goto('http://127.0.0.1:4173/?demo');
const S = process.env.SHOTS_DIR || new URL('../shots', import.meta.url).pathname;
const snap = async (name, t) => { await pg.waitForTimeout(t); await pg.screenshot({ path: `${S}/hud-${name}.png` });
  const st = await pg.evaluate(() => { const s = window.brx.engine.state(); return { phase: s.phase, ammo: s.ammo, mag: s.mag, reserve: s.reserve, hp: s.hp, alive: s.alive, ended: s.ended }; });
  console.log('STATE', name, JSON.stringify(st)); };
await snap('idle', 800);        // ~0.8s: linked
await snap('kitted', 1200);     // ~2s: assigned
await snap('lobby', 1600);      // ~3.6s: config
await snap('armed', 2000);      // ~5.6s countdown
await snap('live-full', 9000);  // ~14.6s: spawned + fired 3
await snap('live-hit', 8000);   // ~22.6s: taking fire
await snap('down', 6000);       // ~28.6s: died
await snap('redeploy', 9000);   // ~37.6s: revived
await snap('resync', 12000);    // ~49.6s: resync prompt
console.log('LOGRING', JSON.stringify(await pg.evaluate(() => window.brx.log.slice(0, 30))));
console.log('CONSOLE', JSON.stringify(logs.slice(0, 15)));
await b.close(); srv.close();
