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
// ---- A10: the LOADOUT browser (docs/spec/loadout.md §4.5) — ?demo&kit stays in KITTED with a fake MC answering picks ----
const lo = async (name, url, steps, viewport = { width: 891, height: 411 }) => {
  const p2 = await b.newPage({ viewport }); p2.on('console', m => logs.push(m.text()));
  await p2.goto(`http://127.0.0.1:4173/${url}`); await p2.waitForTimeout(1800);
  for (const st of steps) {
    if (typeof st === 'string') { await p2.click(st); await p2.waitForTimeout(650); }
    else if (st.shot) { await p2.screenshot({ path: `${S}/hud-${st.shot}.png` }); }
    else if (st.wait) await p2.waitForTimeout(st.wait);
  }
  const vis = await p2.evaluate(() => Array.from(document.querySelectorAll('#hud [data-act]')).map(e => e.dataset.act + (e.dataset.arg ? ':' + e.dataset.arg : '')));
  console.log('LOADOUT', name, JSON.stringify(vis.slice(0, 12)));
  await p2.close();
};
await lo('plates', '?demo&kit', [{ shot: 'kitted-plates' }, '[data-act="onOpenLoadout"][data-arg="primary"]', { shot: 'loadout-primary' },
  '[data-act="onPickItem"][data-arg="weapon:smg"]', { shot: 'loadout-primary-picked' },
  '[data-act="onLoTab"][data-arg="secondary"]', { shot: 'loadout-secondary-weapons' },
  '[data-act="onLoFilter"][data-arg="perks"]', '[data-act="onPickItem"][data-arg="perk:body_armor"]', { shot: 'loadout-secondary-perk' },
  '[data-act="onLoTab"][data-arg="primary"]', '[data-act="onTryIt"]', { wait: 700 }, { shot: 'loadout-tryout' },
  '[data-act="onTryDone"]', { shot: 'loadout-after-tryout' }, '[data-act="onLoDone"]', { shot: 'kitted-plates-perk' }]);
await lo('reject', '?demo&kit&reject', ['[data-act="onOpenLoadout"][data-arg="primary"]', '[data-act="onPickItem"][data-arg="weapon:shotgun"]', { shot: 'loadout-reject' }]);
await lo('locked', '?demo&kit&locked', [{ shot: 'kitted-locked' }]);
await lo('night', '?demo&kit&night', ['[data-act="onOpenLoadout"][data-arg="primary"]', { shot: 'loadout-night' }]);
await lo('short', '?demo&kit', ['[data-act="onOpenLoadout"][data-arg="secondary"]', { shot: 'loadout-short' }], { width: 844, height: 330 });
console.log('LOGRING', JSON.stringify(await pg.evaluate(() => window.brx.log.slice(0, 30))));
console.log('CONSOLE', JSON.stringify(logs.slice(0, 15)));
await b.close(); srv.close();
