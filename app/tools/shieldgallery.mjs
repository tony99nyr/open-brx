// The shield HUD pass (2026-09-24): a frozen gallery of the `?shieldv=a|b|c` variants for Tony, and the checks
// that every state renders. Every state is the REAL engine on the stage harness (src/demo.js `live-shields*`),
// driven by `window.brxDemo` helpers that feed the frames a gun sends; the recharge is the engine's own S29 timer.
// A capture pauses every running animation and transition first, so a flash or the recharge sweep is frozen where
// it was, then resumes them.
//
//   cd app && npm run build && node tools/shieldgallery.mjs [outDir]      (default outDir: /tmp/claude-1000/shield-gallery)
//
// Checks (exit 1 on any failure): the meter renders in every state; it never overlaps the ammo, the callout card, the
// powerup hint, the clock, the identity block, the link status or a chip; the meter carries no text or number; at night no visible green, teal or blue pixel on the meter or in the tint band; with no shield (Standard) and no overshield there
// is no meter at all; with no `shieldv` there is no meter either.
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', 'www');
const OUT = path.resolve(process.argv[2] || '/tmp/claude-1000/shield-gallery');
const SHOTS = path.join(OUT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]); const file = path.join(WWW, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(WWW)) { res.statusCode = 403; res.end(); return; }
  try { const b = fs.readFileSync(file); res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream'); res.end(b); }
  catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const VARIANTS = [
  { v: 'a', name: 'A · CROWN', idea: 'A thick, flat, 10-segment bar at the top centre, draining right to left (Halo 3 / Reach), a thin health bar under it; the clock drops under the meter.' },
  { v: 'b', name: 'B · ARC', idea: 'One curved band bowed over the clock, draining from both ends to the centre (Halo 5 / Infinite), a thinner health arc under it; the clock drops under the meter.' },
  { v: 'c', name: 'C · VISOR', idea: 'A long, thin, 5-cell strip along the top edge, draining from both ends to the centre, a health line under it; the clock and the chips stay exactly where they are today.' },
];
const VIEWS = [{ w: 891, h: 411 }, { w: 667, h: 375 }];
const STATES = [
  ['full', 'Full'], ['hit', 'Hit: flash + drain'], ['broken', 'Broken: red pulse, red tint'], ['waiting', 'Broken, 3 s into the 6.5 s delay (the creeping fill)'],
  ['recharge', 'Recharging, mid-sweep'], ['os', 'Overshield full'], ['oshalf', 'Overshield half drained'], ['stdos', 'Standard preset + overshield (health and overshield together)'],
];
const fails = []; const must = (ok, msg) => { if (!ok) fails.push(msg); };
const b = await chromium.launch();

// ---- in-page readers ----
const READ = () => {
  const vis = e => { if (!e) return null; const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return null;
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const frame = document.getElementById('frame'), fr = frame.getBoundingClientRect(), scale = fr.width / frame.offsetWidth;
  const svm = document.getElementById('svm');
  const parts = svm ? [svm.querySelector('.svbar, .svarc'), svm.querySelector('.svhp')].filter(Boolean) : [];
  const others = { ammo: '.alive .ammo', callout: '#overlay .co .cob', puhint: '#puhint .pu', clock: '.alive .clockplate', ident: '.alive .ident', topright: '.alive .topright', stats: '.alive .stats' };
  const o = {}; for (const [k, sel] of Object.entries(others)) o[k] = [...document.querySelectorAll(sel)].map(vis).filter(Boolean);
  o.chips = [...document.querySelectorAll('#chips .pill')].map(vis).filter(Boolean);
  const st = window.brx.engine.state();
  return { svm: !!svm && !!vis(svm), parts: parts.map(e => ({ cls: String(e.className.baseVal != null ? e.className.baseVal : e.className), box: vis(e) })).filter(p => p.box),
    others: o, text: svm ? svm.textContent.trim() : '',
    s: svm && svm.dataset.s, tint: !!document.querySelector('.alive.sv-down'), shield: st.shield, max: st.maxShield, charging: !!(st.shieldRegen && st.shieldRegen.charging),
    os: st.powerup && st.powerup.overshield ? st.powerup.overshield.left : null, scale, frame: vis(frame) };
};
const apart = (a, c) => a.r <= c.l + 0.5 || c.r <= a.l + 0.5 || a.b <= c.t + 0.5 || c.b <= a.t + 0.5;
function checkLayout(r, tag) {
  must(r.svm, `${tag}: the meter must render`);
  for (const p of r.parts) for (const [k, boxes] of Object.entries(r.others)) for (const bx of boxes)
    must(apart(p.box, bx), `${tag}: meter part ${p.cls} overlaps ${k} ${JSON.stringify({ part: p.box, [k]: bx })}`);
  must(r.text === '', `${tag}: the meter must carry no text or number (Tony: "just the bar"): "${r.text}"`);
}
// Night: every pixel of the frame, decoded in a blank page. Green or teal/blue = a visible channel (>= 70) clearly over red
// (by 24). Today's night HUD already has ~170 near-black bluish anti-aliasing pixels (luminance ~30) around the system-font
// status text; the thresholds leave those out and catch anything a player could see as green, teal or blue.
async function nightPixels(buf, zones) {
  const pg = await b.newPage();
  const n = await pg.evaluate(async ([b64, zones]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let green = 0, blue = 0; const box = [1e9, 1e9, -1, -1]; let sample = null;
    for (let i = 0; i < d.length; i += 4) { const R = d[i], G = d[i + 1], B = d[i + 2]; let hit = false;
      const p0 = i / 4, X = p0 % c.width, Y = Math.floor(p0 / c.width);
      if (!zones.some(z => X >= z.l && X <= z.r && Y >= z.t && Y <= z.b)) continue;
      if (G >= 70 && G > R + 24) { green++; hit = true; } else if (B >= 70 && B > R + 24) { blue++; hit = true; }
      if (hit) { const p = i / 4, px = p % c.width, py = Math.floor(p / c.width); box[0] = Math.min(box[0], px); box[1] = Math.min(box[1], py); box[2] = Math.max(box[2], px); box[3] = Math.max(box[3], py); sample = sample || [R, G, B]; } }
    return { green, blue, box, sample };
  }, [buf.toString('base64'), zones]);
  await pg.close(); return n;
}
async function freeze(pg) { await pg.evaluate(() => { window.__frozen = document.getAnimations().filter(a => a.playState === 'running'); window.__frozen.forEach(a => a.pause()); }); }
async function thaw(pg) { await pg.evaluate(() => { (window.__frozen || []).forEach(a => { try { a.play(); } catch (_) {} }); window.__frozen = []; }); }
const waitFor = (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const stateOf = 'window.brx && window.brx.engine && window.brx.engine.state()';

async function capture(pg, name, { v, view, night, layout = true }) {
  await freeze(pg);
  const r = await pg.evaluate(READ);
  const file = `${v}-${name}-${view.w}${night ? '-night' : ''}.png`;
  const buf = await pg.screenshot({ path: path.join(SHOTS, file) });
  await thaw(pg);
  const tag = `${v} ${name} ${view.w}x${view.h}${night ? ' night' : ''}`;
  if (layout) checkLayout(r, tag);
  if (night) {
    // Strict where this pass paints: the meter's parts (6 px of margin) and the frame's outer 44 px band (the red tint).
    // Elsewhere is today's HUD, logged when it trips (the HIT tag and the armour digits have a faint blue/green fringe).
    const F = r.frame, pad = 6, band = 44 * r.scale;
    const zones = [...r.parts.map(p => ({ l: p.box.l - pad, t: p.box.t - pad, r: p.box.r + pad, b: p.box.b + pad })),
      { l: F.l, t: F.t, r: F.r, b: F.t + band }, { l: F.l, t: F.b - band, r: F.r, b: F.b }, { l: F.l, t: F.t, r: F.l + band, b: F.b }, { l: F.r - band, t: F.t, r: F.r, b: F.b }];
    const all = await nightPixels(buf, [{ l: 0, t: 0, r: 1e5, b: 1e5 }]);
    if (all.green || all.blue) console.log(`  note ${tag}: today's HUD outside the meter: ${all.green} green, ${all.blue} blue px in ${JSON.stringify(all.box)}`);
    const n = await nightPixels(buf, zones); must(n.green === 0 && n.blue === 0, `${tag}: ${n.green} green and ${n.blue} blue/teal pixels at night, in ${JSON.stringify(n.box)} e.g. rgb ${n.sample}`); }
  return { file, r };
}

async function sequence(v, view, night) {
  const N = night ? '&night' : '';
  const pg = await b.newPage({ viewport: { width: view.w, height: view.h } });
  pg.on('pageerror', e => fails.push(`${v} ${view.w}${night ? ' night' : ''}: page error ${e.message}`));
  const shots = {};
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=live-shields-full&shieldv=${v}${N}`);
  await waitFor(pg, `${stateOf} && window.brx.engine.state().phase === 'live' && window.brx.engine.state().shield >= 105`);
  await pg.waitForTimeout(1200);
  shots.full = await capture(pg, 'full', { v, view, night });
  must(shots.full.r.s === 'ok', `${v} full: data-s ${shots.full.r.s}`);
  await pg.evaluate(() => window.brxDemo.shieldHit(30)); await pg.waitForTimeout(140);
  shots.hit = await capture(pg, 'hit', { v, view, night });
  await pg.waitForTimeout(900);
  await pg.evaluate(() => window.brxDemo.shieldBreak()); await pg.waitForTimeout(260);
  shots.broken = await capture(pg, 'broken', { v, view, night });
  must(shots.broken.r.s === 'down' && shots.broken.r.tint, `${v} broken: the meter must say down and tint the frame: ${shots.broken.r.s} ${shots.broken.r.tint}`);
  await pg.waitForTimeout(2900);
  shots.waiting = await capture(pg, 'waiting', { v, view, night });
  await waitFor(pg, `${stateOf}.shieldRegen && window.brx.engine.state().shieldRegen.charging && window.brx.engine.state().shield >= 45`);
  await pg.waitForTimeout(80);
  shots.recharge = await capture(pg, 'recharge', { v, view, night });
  must(shots.recharge.r.s === 'charge' && !shots.recharge.r.tint, `${v} recharge: data-s ${shots.recharge.r.s}, tint ${shots.recharge.r.tint}`);
  await waitFor(pg, `${stateOf}.shield >= 105 && !window.brx.engine.state().shieldRegen.charging`);
  await pg.evaluate(() => window.brxDemo.overshield());
  await waitFor(pg, `${stateOf}.powerup && window.brx.engine.state().powerup.overshield && window.brx.engine.state().powerup.overshield.left >= 75`);
  await pg.waitForTimeout(700);
  shots.os = await capture(pg, 'os', { v, view, night });
  await pg.evaluate(() => window.brxDemo.shieldHit(37));
  await waitFor(pg, `${stateOf}.powerup.overshield && window.brx.engine.state().powerup.overshield.left <= 38`);
  await pg.waitForTimeout(900);
  shots.oshalf = await capture(pg, 'oshalf', { v, view, night });
  must(shots.oshalf.r.os === 38 && shots.oshalf.r.shield === 143, `${v} oshalf: the hit must come off the overshield first: ${JSON.stringify({ os: shots.oshalf.r.os, shield: shots.oshalf.r.shield })}`);
  await pg.close();
  // the Standard preset: no meter until an overshield is held, then the overshield alone, beside a green health bar
  const p2 = await b.newPage({ viewport: { width: view.w, height: view.h } });
  await p2.goto(`http://127.0.0.1:${PORT}/?demo&stage=live-pu&shieldv=${v}${N}`); await waitFor(p2, `${stateOf}.phase === 'live' && window.brx.engine.state().alive`); await p2.waitForTimeout(900);
  must(!(await p2.evaluate(() => !!document.getElementById('svm'))), `${v} Standard with no overshield must draw no meter`);
  await p2.evaluate(() => window.brxDemo.puTake(6));
  await waitFor(p2, `${stateOf}.powerup && window.brx.engine.state().powerup.overshield`); await p2.waitForTimeout(900);
  shots.stdos = await capture(p2, 'stdos', { v, view, night });
  await p2.close();
  // the callout card and the powerup hint beside the meter (layout only, not in the gallery)
  for (const stage of ['live-shields-callout', 'live-shields-claim']) {
    const p3 = await b.newPage({ viewport: { width: view.w, height: view.h } });
    await p3.goto(`http://127.0.0.1:${PORT}/?demo&stage=${stage}&shieldv=${v}${N}`);
    await waitFor(p3, stage.endsWith('callout') ? '!!document.querySelector("#overlay .co .cob")' : '!!document.querySelector("#puhint .pu")', null, 8000).catch(() => must(false, `${v} ${stage}: the card never showed`));
    await p3.waitForTimeout(250); await freeze(p3);
    const r = await p3.evaluate(READ); checkLayout(r, `${v} ${stage} ${view.w}${night ? ' night' : ''}`);
    must(stage.endsWith('callout') ? r.others.callout.length > 0 : r.others.puhint.length > 0, `${v} ${stage}: nothing to check against`);
    await p3.close();
  }
  return shots;
}

// The motion Tony asked for, broken -> delay -> refill, as a looping sprite: the top of the frame sampled every STEP ms
// from the break until the refill is done, on the real engine clock.
const STEP = 400, STRIP_H = 150;
async function strip(v, night) {
  const view = { w: 891, h: 411 };
  const pg = await b.newPage({ viewport: { width: view.w, height: view.h } });
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=live-shields-full&shieldv=${v}${night ? '&night' : ''}`);
  await waitFor(pg, `${stateOf} && window.brx.engine.state().shield >= 105`); await pg.waitForTimeout(1500);
  const frames = []; const t0 = Date.now(); let doneAt = null;
  await pg.evaluate(() => window.brxDemo.shieldBreak());
  for (let i = 0; i < 60; i++) {
    const wait = t0 + i * STEP - Date.now(); if (wait > 0) await pg.waitForTimeout(wait);
    frames.push((await pg.screenshot({ clip: { x: 0, y: 0, width: view.w, height: STRIP_H } })).toString('base64'));
    const st = await pg.evaluate(() => { const s = window.brx.engine.state(); return { full: s.shield >= 105, charging: !!(s.shieldRegen && s.shieldRegen.charging) }; });
    if (st.full && !st.charging && doneAt == null) doneAt = i;
    if (doneAt != null && i >= doneAt + 3) break;
  }
  await pg.close();
  const sp = await b.newPage();
  const png = await sp.evaluate(async ([fr, w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h * fr.length; const x = c.getContext('2d');
    for (let i = 0; i < fr.length; i++) { const img = new Image(); img.src = 'data:image/png;base64,' + fr[i]; await img.decode(); x.drawImage(img, 0, i * h); }
    return c.toDataURL('image/png').split(',')[1];
  }, [frames, view.w, STRIP_H]);
  await sp.close();
  const file = `${v}-motion${night ? '-night' : ''}.png`;
  fs.writeFileSync(path.join(SHOTS, file), Buffer.from(png, 'base64'));
  return { file, n: frames.length };
}
const strips = {};

// today's HUD is untouched without the parameter
{ const pg = await b.newPage({ viewport: { width: 891, height: 411 } });
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=live-shields-full`); await waitFor(pg, `${stateOf}.shield >= 105`); await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => ({ svm: !!document.getElementById('svm'), row: !!document.getElementById('shieldbar') }));
  must(!r.svm && r.row, `no shieldv: today's shield row, no meter: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: path.join(SHOTS, `today-full-891.png`) });
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=live-pu-overshield`); await waitFor(pg, `${stateOf}.powerup && window.brx.engine.state().powerup.overshield`); await pg.waitForTimeout(900);
  await pg.screenshot({ path: path.join(SHOTS, `today-stdos-891.png`) });
  await pg.close(); }

const jobs = []; for (const { v } of VARIANTS) for (const view of VIEWS) for (const night of [false, true]) jobs.push({ v, view, night });
const results = {};
const LANES = 6; let next = 0;
await Promise.all(Array.from({ length: LANES }, async () => { while (next < jobs.length) { const j = jobs[next++];
  try { results[`${j.v}-${j.view.w}-${j.night ? 'n' : 'd'}`] = await sequence(j.v, j.view, j.night); }
  catch (e) { fails.push(`${j.v} ${j.view.w}${j.night ? ' night' : ''}: ${e.message.split('\n')[0]}`); } } }));
for (const { v } of VARIANTS) for (const night of [false, true]) {
  try { strips[`${v}${night ? 'n' : 'd'}`] = await strip(v, night); } catch (e) { fails.push(`${v} motion strip${night ? ' night' : ''}: ${e.message.split('\n')[0]}`); } }
await b.close(); server.close();

// ---- the gallery ----
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cell = (f, cap) => fs.existsSync(path.join(SHOTS, f)) ? `<figure><a href="shots/${f}"><img src="shots/${f}" loading="lazy" alt="${esc(cap)}"></a><figcaption>${esc(cap)}</figcaption></figure>` : `<figure class="miss"><figcaption>${esc(cap)}: missing</figcaption></figure>`;
const sections = VARIANTS.map(({ v, name, idea }) => `<section><h2>${esc(name)}</h2><p class="idea">${esc(idea)}</p>
  <h3>Motion: shield breaks, the 6.5 s delay, the refill (the real engine, sampled every ${STEP} ms, looping)</h3><div class="row">${['d', 'n'].map(t => { const m = strips[`${v}${t}`];
    return m ? `<figure><div class="motion" style="--n:${m.n};background-image:url(shots/${m.file});animation-duration:${m.n * STEP}ms;animation-timing-function:steps(${m.n})"></div><figcaption>${t === 'd' ? 'day' : 'night'} 891×411, top ${STRIP_H} px</figcaption></figure>` : ''; }).join('')}</div>
  ${STATES.map(([k, label]) => `<h3>${esc(label)}</h3><div class="row">${VIEWS.map(vw => cell(`${v}-${k}-${vw.w}.png`, `day ${vw.w}×${vw.h}`)).join('')}${VIEWS.map(vw => cell(`${v}-${k}-${vw.w}-night.png`, `night ${vw.w}×${vw.h}`)).join('')}</div>`).join('\n  ')}</section>`).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shield HUD variants</title>
<style>
:root{--bg:#0b0e13;--fg:#e8eef4;--mut:#93a4b5;--edge:#26313d;--acc:#3cb6ff}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;padding:16px}
header{max-width:1100px}h1{font-size:22px;margin:0 0 8px}h2{font-size:20px;margin:28px 0 4px;color:var(--acc)}h3{font-size:14px;margin:16px 0 6px;color:var(--mut);font-weight:600}
ul{margin:6px 0 0;padding-left:20px}li{margin:3px 0}.q{margin-top:10px;padding:8px 12px;border:1px solid var(--acc);display:inline-block}
.idea{margin:0;color:var(--mut)}.row{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px}
figure{margin:0;flex:0 0 auto}figure img{display:block;height:206px;width:auto;border:1px solid var(--edge)}figcaption{font-size:12px;color:var(--mut)}
.miss{width:200px;height:206px;border:1px dashed #a33;display:flex;align-items:center;justify-content:center}
.fail{color:#ff8080}
.motion{width:891px;height:${STRIP_H}px;background-size:891px auto;background-repeat:no-repeat;border:1px solid var(--edge);animation-name:motion;animation-iteration-count:infinite}
@keyframes motion{from{background-position:0 0}to{background-position:0 calc(var(--n) * -${STRIP_H}px)}}
</style></head><body><header>
<h1>Shield HUD variants: pick one</h1>
<ul>
${VARIANTS.map(x => `<li><b>${esc(x.name)}</b>: ${esc(x.idea)}</li>`).join('\n')}
<li><b>No words, no numbers</b> (Tony): the bar tells it. A hit flashes it; broken, the empty track pulses red and the frame is tinted red; during the delay a faint fill creeps along the empty track; the refill rises with a sweep.</li>
<li><b>Overshield, day</b> (every variant): a lime-green layer drawn over the blue shield, drained first by hits, then the blue shows again. Health stays a thin mint-green bar under the shield, so the two greens differ in shade, size and place.</li>
<li><b>Overshield, night</b> (every variant): no green and no blue at night, so the overshield is a brighter red, double-railed layer (two bright rails with a dark core) over the dim red shield: shape and brightness only. At night the only motion is the broken track's slow red pulse; the delay fill is a static dim red, and there is no sweep and no white.</li>
<li><b>Engine timing</b> (engine.js S29, unchanged): the recharge starts <b>6.5 s</b> after the last damage, then +10 every 300 ms, so 0 to 105 takes about <b>3.3 s</b>. Every hit restarts the 6.5 s. The meter draws the delay as the faint fill creeping along the empty track, with no number.</li>
<li><b>Sounds</b>: already on the gun, no new files. The break plays N101 "(Halo) Shields Down" and the first recharge grant plays N102 "(Halo) Shields Recharge" (engine events <code>shield_down</code> and <code>shield_charging</code>).</li>
<li><b>Gun LEDs</b>: shield + overshield shown as one teal pool (Tony); the phone is Halo blue/green on purpose.</li>
<li>Try it live: the stage harness (<code>npm run ui:stage</code>), "shield HUD" select, stages <code>live-shields*</code>, or <code>/hud/?demo&amp;stage=live-shields&amp;shieldv=a</code>. Without <code>shieldv</code> the HUD is today's.</li>
</ul>
<p class="q"><b>Question:</b> Should the overshield decay over time? (today: no, only hits remove it)</p>
${fails.length ? `<p class="fail">Checks failed: ${fails.length}</p><ul class="fail">${fails.slice(0, 30).map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : `<p>Checks: every state rendered; no overlap with the ammo, the callout card, the powerup hint, the clock, the identity block, the link status or the chips; no text or number on the meter; no green, teal or blue pixel at night; no meter in Standard without an overshield.</p>`}
<h2>Today, for reference</h2><div class="row">${cell('today-full-891.png', 'today · Shields preset, full')}${cell('today-stdos-891.png', 'today · Standard + overshield')}</div>
</header>
${sections}
</body></html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`gallery -> ${OUT}/index.html (${fs.readdirSync(SHOTS).length} shots)`);
if (fails.length) { console.log(`FAIL ${fails.length}:\n` + fails.join('\n')); process.exit(1); }
console.log('PASS: every shield state rendered, no overlap, no text on the meter, night has no green/teal/blue');
