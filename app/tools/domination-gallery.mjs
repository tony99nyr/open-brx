// The Domination row of hills gallery (F666): frozen renders of the REAL phone HUD (?demo) for Tony's review, day and
// night, at both screen-gate widths. It asserts nothing (app/tools/screens.mjs is the gate).
// Run from app/ after `npm run build`: node tools/domination-gallery.mjs [out-dir]
// The default out-dir is %USERPROFILE%\brx-domination-hud (from WSL, the same folder under /mnt/c; win-home.mjs). The
// screenshots never go in the repo.
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { winHome } from './win-home.mjs';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', 'www');
const OUT = path.resolve(process.argv[2] || path.join(winHome(), 'brx-domination-hud'));
fs.mkdirSync(OUT, { recursive: true });
const { port: PORT, close } = await startStaticServer(WWW, { host: '127.0.0.1', decodePath: true });
const VIEWS = [{ name: 'pixel', width: 891, height: 411, label: '891×411' }, { name: 'se', width: 667, height: 375, label: '667×375' }];   // = screens.mjs VIEWS
const SKINS = [{ name: 'day', q: '', label: 'Day' }, { name: 'night', q: '&night', label: 'Night ops' }];
const PLACES = [{ name: 'a', q: '', label: 'A: centred under the clock' }, { name: 'b', q: '&dompos=b', label: 'B: top left, under your name' }];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let base = '?'; try { base = execSync('git rev-parse --short HEAD', { cwd: HERE }).toString().trim(); } catch (_) { /* no git */ }

// Adverts as the stations send them: [id, team, state, value, present, ageMs]. state bits: held 1 · contested 2 ·
// rising 4 · falling 8. You are BLUE (tid 1) against RED (tid 0). A B C are ids 11 12 13.
const US = 1, THEM = 0, N = 255;
// Each moment: [id, label, adverts, waitMs]. The phone remembers every hill it heard, so the order matters: 'never' comes
// first on a fresh page, and 'old' drops B from the air and waits past CONTROL_STALE_MS (4 s).
const MOMENTS = [
  ['never', 'C not heard yet this match', [[11, US, 1, 100, 0], [12, THEM, 1, 100, 0]]],
  ['start', 'All three neutral and heard', [[11, N, 0, 0, 0], [12, N, 0, 0, 0], [13, N, 0, 0, 0]]],
  ['mixed', 'A ours, B theirs, C neutral', [[11, US, 1, 100, 0], [12, THEM, 1, 100, 0], [13, N, 0, 0, 0]]],
  ['capture', 'You are on C, and our bar is building (40 %)', [[11, US, 1, 100, 0], [12, THEM, 1, 100, 0], [13, US, 4, 40, 1]]],
  ['contested', 'B is contested: both teams are on it', [[11, US, 1, 100, 0], [12, THEM, 3, 100, 0], [13, N, 0, 0, 0]]],
  ['taking', 'They are taking A: it went neutral, their bar is at 60 %', [[11, THEM, 4, 60, 0], [12, THEM, 1, 100, 0], [13, US, 1, 100, 0]]],
  ['old', 'B out of earshot for 4 s: last known (theirs), dim', [[11, US, 1, 100, 0], [12, THEM, 1, 100, 0], [13, US, 1, 100, 0]], 0, [[11, US, 1, 100, 0], [13, US, 1, 100, 0]], 4400],
];
const CAPTURE = [[0, 'You step on C: neutral', [13, US, 4, 2, 1]], [1, '+1 s: our bar', [13, US, 4, 30, 1]], [2, '+2 s', [13, US, 4, 60, 1]],
  [3, '+3 s: nearly', [13, US, 4, 90, 1]], [4, '+4 s: C is ours', [13, US, 1, 100, 1]], [5, '+5 s: a red player arrives: contested', [13, US, 3, 100, 1]],
  [6, '+6 s: you hold it, they leave', [13, US, 1, 100, 1]]];
const AB = [[11, US, 1, 100, 0], [12, THEM, 1, 100, 0]];

const b = await chromium.launch();
const openPg = async (view, skin, place) => {
  const pg = await b.newPage({ viewport: { width: view.width, height: view.height } }); pg.__err = []; pg.on('pageerror', e => pg.__err.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=live-dom&team=blue&foe=red&melee_ms=3000${skin.q}${place.q}`);
  await pg.waitForFunction(() => window.brx && window.brx.engine && window.brx.engine.state().phase === 'live' && window.brxDemo, null, { timeout: 15000 });
  await pg.waitForTimeout(400);
  return pg;
};
const feed = async (pg, rows) => { await pg.evaluate(r => window.brxDemo.points(r), rows); await pg.waitForTimeout(350); };
const marks = pg => pg.evaluate(() => [...document.querySelectorAll('.domrow .dh')].map(e => {
  const d = e.dataset; return `${e.textContent.trim()}: ${d.own === 'none' ? 'neutral' : d.own === 'mine' ? 'ours' : 'theirs'}${d.hold !== 'none' ? `, ${d.hold === 'mine' ? 'our' : 'their'} bar ${e.style.getPropertyValue('--p')}` : ''}${d.con === '1' ? ', contested' : ''}${d.fresh === 'old' ? ', last known' : d.fresh === 'never' ? ', not heard' : ''}${d.on === '1' ? ', you are on it' : ''}`; }).join(' · '));
const shoot = async (pg, name) => { await pg.screenshot({ path: path.join(OUT, name) }); return name; };

// ---- 1. single moments, both placements ----
const moments = [];
for (const place of PLACES) for (const skin of SKINS) for (const view of VIEWS) {
  const pg = await openPg(view, skin, place), cells = [];
  for (const [id, label, rows, , then, waitMs] of MOMENTS) {
    await feed(pg, rows);
    if (then) { await pg.evaluate(r => window.brxDemo.points(r), then); await pg.waitForTimeout(waitMs); }
    cells.push({ label, f: await shoot(pg, `m-${place.name}-${id}-${skin.name}-${view.name}.png`), cap: await marks(pg) });
  }
  if (pg.__err.length) throw new Error(`moments ${place.name} ${skin.name} ${view.name}: ${pg.__err.join(' | ')}`);
  moments.push({ place, skin, view, cells }); console.log('moments', place.name, skin.name, view.name); await pg.close();
}
// ---- 2. a capture over time (placement A) ----
const story = [];
for (const skin of SKINS) for (const view of VIEWS) {
  const pg = await openPg(view, skin, PLACES[0]), cells = [];
  for (const [t, label, c] of CAPTURE) { await feed(pg, [...AB, c]); cells.push({ label, f: await shoot(pg, `sb-${skin.name}-${view.name}-${t}.png`), cap: await marks(pg) }); }
  if (pg.__err.length) throw new Error(`story ${skin.name} ${view.name}: ${pg.__err.join(' | ')}`);
  story.push({ skin, view, cells }); console.log('story', skin.name, view.name); await pg.close();
}
// ---- 3. clash: the row with the KOTH-style OBJECTIVE card, the melee icon cooling and a kill card ----
const clash = [];
for (const place of PLACES) for (const skin of SKINS) for (const view of VIEWS) {
  const pg = await openPg(view, skin, place);
  await feed(pg, [...AB, [13, N, 0, 0, 0]]);
  await feed(pg, [...AB, [13, US, 4, 20, 1]]);   // the capture starts: the OBJECTIVE lane names it
  await pg.evaluate(() => { window.brxDemo.swing(); window.brxDemo.killMedals(['first_blood'], 'VIPER'); });
  await pg.waitForTimeout(450);
  const what = await pg.evaluate(() => ({ lane: [...document.querySelectorAll('#lanes .lo, #lanes .lh, .lanes *')].map(e => e.innerText).filter(Boolean).slice(0, 2).join(' | ').replace(/\s+/g, ' ').slice(0, 120),
    melee: document.getElementById('frame').dataset.melee || 'ready' }));
  const f = await shoot(pg, `clash-${place.name}-${skin.name}-${view.name}.png`);
  if (pg.__err.length) throw new Error(`clash ${place.name} ${skin.name} ${view.name}: ${pg.__err.join(' | ')}`);
  clash.push({ place, skin, view, cells: [{ label: 'Capturing C + the OBJECTIVE card + a kill card + melee cooling', f, cap: `${await marks(pg)} · melee ${what.melee === 'cool' ? 'cooling (dim)' : what.melee}` }] });
  console.log('clash', place.name, skin.name, view.name); await pg.close();
}

const strip = (cells, view) => `<div class="strip">${cells.map(x => `<figure style="width:${Math.round(view.width * 0.42)}px"><img src="${x.f}" loading="lazy" alt="">
  <figcaption><b>${esc(x.label)}</b><br>${esc(x.cap)}</figcaption></figure>`).join('')}</div>`;
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Domination HUD</title>
<style>body{background:#0b0e13;color:#dfe8f0;font:15px/1.5 system-ui,sans-serif;margin:0;padding:20px 24px}h1{margin:0 0 6px}h2{margin:30px 0 8px;border-top:1px solid #243140;padding-top:16px}
h3{margin:18px 0 6px;color:#9fc3df;font-size:15px}.lede{max-width:920px;color:#b8c6d3}ol.q li{margin:6px 0}.strip{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px}
figure{margin:0;flex:0 0 auto}figure img{width:100%;display:block;border:1px solid #243140;border-radius:4px}figcaption{font-size:12px;color:#9fb0c0;margin-top:4px}code{color:#ffd27a}</style></head><body>
<h1>Domination: the row of hills (F666)</h1>
<p class="lede">Frozen renders of the real phone HUD (the <code>?demo</code> Domination stage, built from branch <code>feat/f666-domination-hud</code> at <code>${esc(base)}</code>, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC; brx4's engine <code>state().hills</code> from main).
You are BLUE against RED. One tile per hill, A B C. The fill is the owner's team colour. The bar along the foot is a capture building, in the capturing team's colour. An amber edge is contested. A dashed, dim tile is out of earshot: it shows the last owner the phone heard. A bright edge and a caret mark the hill you stand on. No number and no timer. The melee icon (F665, still waiting for your picks) is on in every frame. Original designs.</p>
<h2>Open questions</h2>
<ol class="q">
<li><b>Placement: A or B?</b> A is centred under the clock. B is top left, under your name.</li>
<li><b>Night ops:</b> night is red and amber only, so team colours cannot show. Ours is a solid tile, theirs an amber outline, contested a double edge. Readable enough?</li>
<li><b>A hill out of earshot:</b> it dims and its edge goes dashed. domination-design.md §2.6 also asked for a "1:40 AGO" label, but the brief says no text timers. Dim only, or add the AGO text?</li>
<li><b>The OBJECTIVE card:</b> KOTH's capture card (right side) still fires on the hill you stand on. Keep it in Domination, or let the row alone carry it?</li>
</ol>
<h2>What the renders show</h2>
<ul class="lede">
<li><b>The kill card covers placement A.</b> At 667×375 the centre kill card (KILL, the name, FIRST BLOOD) sits over the whole row for its hold. Placement B stays clear (section 3).</li>
<li><b>The OBJECTIVE card can mislead in Domination.</b> When B goes out of earshot, KOTH's card says HILL LOST, but nobody took it: the phone simply stopped hearing it ("B out of earshot" frames). This is question 4.</li>
</ul>
<h2>1. Every state (both placements)</h2>
${PLACES.map(place => `<h3>${esc(place.label)}</h3>` + moments.filter(m => m.place === place).map(m => `<h3>${esc(m.skin.label)} · ${m.view.label}</h3>${strip(m.cells, m.view)}`).join('')).join('')}
<h2>2. A capture over time (placement A)</h2>
<p class="lede">You walk onto C, the bar builds, C turns blue, a red player arrives (contested), then leaves.</p>
${story.map(s => `<h3>${esc(s.skin.label)} · ${s.view.label}</h3>${strip(s.cells, s.view)}`).join('')}
<h2>3. Clash: the row, the OBJECTIVE card, a kill card and the melee icon at once</h2>
${PLACES.map(place => `<h3>${esc(place.label)}</h3><div class="strip">` + clash.filter(c => c.place === place).map(c => `<figure style="width:${Math.round(c.view.width * 0.42)}px"><img src="${c.cells[0].f}" loading="lazy" alt=""><figcaption><b>${esc(c.skin.label)} · ${c.view.label}</b><br>${esc(c.cells[0].cap)}</figcaption></figure>`).join('') + '</div>').join('')}
</body></html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('wrote', path.join(OUT, 'index.html'));
await b.close(); close();
