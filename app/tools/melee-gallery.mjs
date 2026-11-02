// The melee-ready icon gallery (F665): frozen renders of the REAL phone HUD (?demo) for Tony's review, day and night, at
// both screen-gate widths. It asserts nothing (app/tools/screens.mjs is the gate).
// Run from app/ after `npm run build`: node tools/melee-gallery.mjs [out-dir]
// The default out-dir is %USERPROFILE%\brx-melee-icon (from WSL, the same folder under /mnt/c; win-home.mjs). The
// screenshots never go in the repo.
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { winHome } from './win-home.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', 'www');
const OUT = path.resolve(process.argv[2] || path.join(winHome(), 'brx-melee-icon'));
fs.mkdirSync(OUT, { recursive: true });
const { port: PORT, close } = await startStaticServer(WWW, { host: '127.0.0.1', decodePath: true });
const VIEWS = [{ name: 'pixel', width: 891, height: 411, label: '891×411' }, { name: 'se', width: 667, height: 375, label: '667×375' }];   // = screens.mjs VIEWS
const SKINS = [{ name: 'day', q: '', label: 'Day' }, { name: 'night', q: '&night', label: 'Night ops' }];
const PLACES = [{ name: 'a', q: '', label: 'A: at the start of the weapon-name row' }, { name: 'b', q: '&meleepos=b', label: 'B: left of the ammo column, at its foot' }];
const MELEE_MS = 3000;   // placeholder until brx3's catalogue change sets the melee t14 (brx1, 2026-11-02)
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let base = '?'; try { base = execSync('git rev-parse --short HEAD', { cwd: HERE }).toString().trim(); } catch (_) { /* no git */ }

// Stamp the first moment the icon dims (the swing reached the screen), and every later melee state with its time.
const INIT = () => {
  window.__cool = null; window.__states = [];
  new MutationObserver(() => {
    const f = document.getElementById('frame'); if (!f) return;
    const s = f.dataset.melee || 'idle', last = window.__states[window.__states.length - 1];
    if (!last || last.s !== s) { window.__states.push({ s, at: Date.now() }); if (s === 'cool' && !window.__cool) window.__cool = Date.now(); }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-melee'], childList: true });
};
const b = await chromium.launch();
const openPg = async (view, stage, skin, place) => {
  const pg = await b.newPage({ viewport: { width: view.width, height: view.height } }); pg.__err = []; pg.on('pageerror', e => pg.__err.push(e.message));
  await pg.addInitScript(INIT);
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=${stage}&melee_ms=${MELEE_MS}${skin.q}${place.q}`);
  await pg.waitForSelector('#melee', { timeout: 15000 });
  return pg;
};
const read = pg => pg.evaluate(() => {
  const f = document.getElementById('frame'), m = document.getElementById('melee'), wn = document.querySelector('.ammo .wn');
  return { melee: f.dataset.melee || 'idle', op: m ? (+getComputedStyle(m).opacity).toFixed(2) : '-', down: !!f.dataset.down || !(window.brx && window.brx.engine && window.brx.engine.alive),
    wn: wn ? wn.innerText.replace(/\s+/g, ' ').trim() : '', mag: (document.getElementById('mag') || {}).innerText || '' };
});
const shoot = async (pg, name) => { await pg.screenshot({ path: path.join(OUT, name) }); return name; };
const LABEL = { idle: 'READY', cool: 'COOLING (dim)', ready: 'SHIMMER (one, 450 ms)' };
const cap = r => `${r.down ? 'DOWN · ' : ''}${LABEL[r.melee] || r.melee.toUpperCase()} · opacity ${r.op} · weapon row "${esc(r.wn)}" ${esc(r.mag)}`;

// ---- 1. the storyboard: one swing, frames timed from the dim ----
const SB = [[-1, 'Before the swing: ready'], [0.1, 'Swing +0.1 s: dim'], [1.5, '+1.5 s: still dim'], [2.9, '+2.9 s: still dim (the gun still refuses)'],
  [3.05, '+3.05 s: the shimmer starts'], [3.2, '+3.2 s: the shimmer'], [3.35, '+3.35 s: the shimmer ends'], [4, '+4 s: ready, plain']];
const story = [];
for (const place of PLACES) for (const skin of SKINS) for (const view of VIEWS) {
  const pg = await openPg(view, 'live-melee-swing', skin, place);
  const frames = [];
  await pg.waitForTimeout(300);
  frames.push({ t: -1, label: SB[0][1], f: await shoot(pg, `sb-${place.name}-${skin.name}-${view.name}-0.png`), r: await read(pg) });
  await pg.waitForFunction(() => window.__cool, null, { timeout: 15000 });
  const t0 = await pg.evaluate(() => window.__cool);
  for (const [t, label] of SB.slice(1)) {
    const wait = t0 + t * 1000 - (await pg.evaluate(() => Date.now()));
    if (wait > 0) await pg.waitForTimeout(wait);
    const r = await read(pg);
    frames.push({ t, label, f: await shoot(pg, `sb-${place.name}-${skin.name}-${view.name}-${String(t).replace('.', '_')}.png`), r });
  }
  const states = (await pg.evaluate(() => window.__states)).filter(s => s.at >= t0 - 5).map(s => `${({ idle: 'ready', ready: 'shimmer' })[s.s] || s.s} at ${((s.at - t0) / 1000).toFixed(2)} s`);
  if (pg.__err.length) throw new Error(`story ${place.name} ${skin.name} ${view.name}: ${pg.__err.join(' | ')}`);
  story.push({ place, skin, view, frames, states }); console.log('story', place.name, skin.name, view.name);
  await pg.close();
}

// ---- 2. down and respawn: swing, die 0.2 s later, respawn while still cooling ----
const DN = [[0.1, 'Swing +0.1 s: dim'], [0.5, 'DOWN +0.5 s: the icon is frozen'], [1.5, 'DOWN +1.5 s: still frozen'], [1.9, 'Respawn +1.9 s: still cooling, so dim'],
  [3.2, '+3.2 s: ready, one shimmer (alive again)'], [3.8, '+3.8 s: ready']];
const down = [];
for (const skin of SKINS) for (const view of VIEWS) {
  const place = PLACES[0];
  const pg = await openPg(view, 'live-melee-respawn', skin, place);
  await pg.waitForFunction(() => window.__cool, null, { timeout: 15000 });
  const t0 = await pg.evaluate(() => window.__cool), frames = [];
  for (const [t, label] of DN) {
    const wait = t0 + t * 1000 - (await pg.evaluate(() => Date.now()));
    if (wait > 0) await pg.waitForTimeout(wait);
    const r = await read(pg);
    frames.push({ t, label, f: await shoot(pg, `down-${skin.name}-${view.name}-${String(t).replace('.', '_')}.png`), r });
  }
  const states = (await pg.evaluate(() => window.__states)).filter(s => s.at >= t0 - 5).map(s => `${({ idle: 'ready', ready: 'shimmer' })[s.s] || s.s} at ${((s.at - t0) / 1000).toFixed(2)} s`);
  if (pg.__err.length) throw new Error(`down ${skin.name} ${view.name}: ${pg.__err.join(' | ')}`);
  down.push({ skin, view, frames, states }); console.log('down', skin.name, view.name);
  await pg.close();
}

// ---- 3. the page ----
const strip = (frames, view) => `<div class="strip">${frames.map(x => `<figure style="width:${Math.round(view.width * 0.42)}px"><img src="${x.f}" loading="lazy" alt="">
  <figcaption><b>${esc(x.label)}</b><br>${cap(x.r)}</figcaption></figure>`).join('')}</div>`;
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Melee-ready icon</title>
<style>body{background:#0b0e13;color:#dfe8f0;font:15px/1.5 system-ui,sans-serif;margin:0;padding:20px 24px}h1{margin:0 0 6px}h2{margin:30px 0 8px;border-top:1px solid #243140;padding-top:16px}
h3{margin:18px 0 6px;color:#9fc3df;font-size:15px}.lede{max-width:900px;color:#b8c6d3}ol.q li{margin:6px 0}.strip{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px}
figure{margin:0;flex:0 0 auto}figure img{width:100%;display:block;border:1px solid #243140;border-radius:4px}figcaption{font-size:12px;color:#9fb0c0;margin-top:4px}
.states{font-size:12px;color:#7f93a6}code{color:#ffd27a}</style></head><body>
<h1>Melee-ready icon (F665)</h1>
<p class="lede">Frozen renders of the real phone HUD (the <code>?demo</code> stages, built from branch <code>fix/f665-melee-ready</code> at <code>${esc(base)}</code>, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC).
Melee is one swing every ${MELEE_MS / 1000} s. The ${MELEE_MS} ms is a placeholder: the build reads the melee line's own time between swings ($WEAP slot 4, token 14), so the icon follows whatever the catalogue sets.
The icon is the BEAT DOWN fist without its ring. It dims after a swing, and it shimmers once when the gun takes the next swing. No number and no timer.
It times from the gun's own report of the swing, so ready can only be late, never early. While you are DOWN it does not change. Original designs.</p>
<h2>Open questions</h2>
<ol class="q">
<li><b>Placement: A or B?</b> A puts the fist at the start of the weapon-name row (bottom right, beside the weapon). B puts a larger fist to the left of the whole ammo column, at its foot. The storyboards below show both.</li>
<li><b>The shimmer: keep it?</b> By day it is one light sweep across the fist and a brief lift (450 ms). At night it is a brightness step only, no sweep and no glow, the same rule as the shot-ready cue.</li>
<li><b>The dim: strong enough?</b> Cooling is 28 % opacity and grey. Should cooling be dimmer, or hidden?</li>
</ol>
<h2>Also fixed: a swing no longer takes over the weapon row</h2>
<p class="lede">The game logs of 2026-11-01 show every swing as the gyro press, then a slot-4 ammo report. The phone took that report as a weapon change, so after every swing the HUD named the rifle <b>PICKUP</b> and showed <b>01</b> (the melee row) until the next shot. Now the swing books nothing on the weapon row: in every frame below the row still reads the rifle and its magazine.</p>
<h2>1. One swing, over time</h2>
${PLACES.map(place => `<h3>${esc(place.label)}</h3>` + story.filter(s => s.place === place).map(s => `<h3>${esc(s.skin.label)} · ${s.view.label}</h3>${strip(s.frames, s.view)}<div class="states">Icon states, timed from the dim: ${esc(s.states.join(' → '))}</div>`).join('')).join('')}
<h2>2. DOWN and the respawn (placement A)</h2>
<p class="lede">A swing, then the player is downed 0.2 s later and respawns at 1.7 s, while the gun is still cooling. The icon does not change while DOWN. After the respawn it shows the truth: still cooling, so dim, then the one shimmer when the gun takes a swing again. A cooldown that ends while you are DOWN comes back plain ready, with no shimmer.</p>
${down.map(s => `<h3>${esc(s.skin.label)} · ${s.view.label}</h3>${strip(s.frames, s.view)}<div class="states">Icon states, timed from the dim: ${esc(s.states.join(' → '))}</div>`).join('')}
</body></html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('wrote', path.join(OUT, 'index.html'));
await b.close(); close();
