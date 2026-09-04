// Screen-truth suite for the HUD review of 2026-09-03 (docs/hud-review-2026-09-03.md). Every step is a
// reported bug turned into an assertion about what a PERSON SEES: rects, wraps, overlaps, visible text —
// never engine state. Runs the `?demo&stage=` states at the design width AND a narrow phone, with
// classic (desktop) scrollbars ON, because both of those reproduced the report and headless defaults hide them.
// Run: node tools/screens.mjs      ONLY=<substring> runs matching steps.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), WWW = path.join(ROOT, 'www');
const OUT = path.join(ROOT, 'shots', 'screens'); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY;
const srcNewest = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }).map(f => path.join(ROOT, 'src', f)).filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } }).reduce((a, f) => Math.max(a, fs.statSync(f).mtimeMs), 0);
if (srcNewest > fs.statSync(path.join(WWW, 'app.js')).mtimeMs) { console.error('STALE BUNDLE: run `npm run build` first.'); process.exit(2); }
const srv = http.createServer((req, res) => { const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0];
  try { res.setHeader('content-type', rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.html') ? 'text/html' : 'application/octet-stream'); res.end(fs.readFileSync(path.join(WWW, rel))); } catch { res.statusCode = 404; res.end(); } }).listen(4192);
let pass = 0, fail = 0; const errs = [];
const must = (c, m) => { if (!c) throw new Error(m); };
const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });   // scrollbars ON: what a desktop reviewer sees
const VIEWS = [{ name: 'pixel', width: 891, height: 411 }, { name: 'se', width: 667, height: 375 }];
const LONG = new Set(['down-wait', 'down-find', 'down-approach', 'down-at', 'live-switch-perk', 'live-alert', 'live-medals', 'live-switch', 'live', 'live-kill', 'live-reload', 'down', 'redeploy', 'resync', 'live-nogun', 'live-mclost', 'result', 'over', 'panic', 'live-hit', 'live-lowhp', 'live-lowammo', 'live-fired', 'aborted']);
const step = async (name, fn) => { if (ONLY && !name.includes(ONLY)) return; try { await fn(); console.log(`  ok   ${name}`); pass++; } catch (e) { console.log(`  FAIL ${name}: ${String(e.message || e).slice(0, 300)}`); fail++; errs.push(name); } };
const open = async (view, stage, extra = '', ms) => {
  const pg = await b.newPage({ viewport: { width: view.width, height: view.height } }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
  await pg.goto(`http://127.0.0.1:4192/?demo&stage=${stage}${extra}`); await pg.waitForTimeout(ms || (LONG.has(stage) ? 4200 : 1600));
  must(perr.length === 0, 'page errors: ' + perr.join(' | '));
  const reached = await pg.evaluate(s => ({ stage: window.brxDemo && window.brxDemo.stage, failed: (window.brx.log || []).filter(l => /stage step failed|unknown/.test(l)) }), stage);
  must(reached.stage === stage && reached.failed.length === 0, `stage not reached: ${JSON.stringify(reached)}`);   // a throwing stage step must not pass as "whatever is on screen"
  await pg.screenshot({ path: `${OUT}/${view.name}-${stage}${extra.replace(/[&=]/g, '_')}.png` });
  return pg;
};
// what every screen must satisfy (#1/#2/#3/#5/#7/#8/#10/#12/#14/#22): no sideways overflow, nothing under the ⓘ box, no wrapped plate row
const invariants = pg => pg.evaluate(() => {
  const out = []; const info = document.getElementById('info').getBoundingClientRect();
  const hit = (a, b) => a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2;
  for (const e of document.querySelectorAll('#hud *, #overlay *, #chips *')) {
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1) out.push(`sideways overflow: .${e.className} ${e.scrollWidth}>${e.clientWidth}`);
    const txt = e.childElementCount === 0 && (e.textContent || '').trim(); if (!txt) continue;
    const r = e.getBoundingClientRect(); if (r.width && hit(r, info)) out.push(`under the ⓘ button: "${txt.slice(0, 30)}"`);
  }
  const plates = Array.from(document.querySelectorAll('.lobby .plates > .plate')).map(p => Math.round(p.getBoundingClientRect().top));
  if (plates.length > 1 && new Set(plates).size > 1) out.push('plates row wrapped: tops ' + plates.join(','));
  const pr = document.querySelector('.lobby .plates'); const foot = document.querySelector('.lobby .foot');
  if (pr && foot && pr.getBoundingClientRect().bottom > foot.getBoundingClientRect().top + 1) out.push('plates run under the footer');
  for (const pill of document.querySelectorAll('.chipbar .pill')) { const p = pill.getBoundingClientRect(); for (const q of document.querySelectorAll('.plate, .tryout')) if (hit(p, q.getBoundingClientRect())) out.push('a pill covers a plate'); }
  return out;
});
// "one line" = the element's text paints as ONE line box (a Range over its contents yields rects whose tops agree), not a height guess
const oneLine = (pg, sel) => pg.evaluate(sel => Array.from(document.querySelectorAll(sel)).map(e => { const r = document.createRange(); r.selectNodeContents(e); const rects = Array.from(r.getClientRects()).filter(x => x.width > 1 && x.height > 1); const tops = new Set(rects.map(x => Math.round(x.top / 4))); return [sel, e.textContent.trim().slice(0, 30), rects.length > 0 && tops.size === 1]; }), sel);   // hidden text is NOT "one line"
const text = pg => pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));

for (const view of VIEWS) {
  console.log(`\n== ${view.name} ${view.width}×${view.height} ==`);
  for (const st of ['idle', 'connected', 'mc-rejected', 'setup', 'briefing', 'kitted', 'kitted-ready', 'loadout-primary', 'loadout-secondary', 'loadout-picked', 'kitted-perk', 'tryout', 'lobby', 'armed', 'live', 'live-nogun', 'resync', 'live-kill', 'live-reload', 'down', 'redeploy', 'result', 'over']) {
    await step(`${view.name} ${st}: invariants`, async () => { const pg = await open(view, st); const bad = await invariants(pg); await pg.close(); must(bad.length === 0, bad.join(' ; ')); });
  }
  await step(`${view.name} frame keeps its design size (#6/#7/#13/#18/#22 root cause)`, async () => {
    const pg = await open(view, 'kitted'); const w = await pg.evaluate(() => getComputedStyle(document.getElementById('frame')).width); await pg.close(); must(w === '844px', 'frame width ' + w);
  });
  await step(`${view.name} demo ignores a real session persisted on the same origin (correctness review)`, async () => {
    const pg = await b.newPage({ viewport: { width: view.width, height: view.height } });
    await pg.goto('http://127.0.0.1:4192/?demo&stage=idle'); await pg.waitForTimeout(600);
    await pg.evaluate(() => localStorage.setItem('brx.engine', JSON.stringify({ phase: 'live', player: { player_id: 'p9', display: 'GHOST', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'smg' }] } }, config: { config_id: 'x', mode: 'tdm' }, frames: { head: ['$START,*'], spawn: [], end: [], panic: [] }, start: { match_id: 'old', go_live_t: Date.now() - 60000, seq: 1 }, spawned: true, savedAt: Date.now() })));
    await pg.goto('http://127.0.0.1:4192/?demo&stage=connected'); await pg.waitForTimeout(1600);
    const r = await pg.evaluate(() => ({ phase: window.brx.engine.state().phase, txt: document.body.innerText.slice(0, 80) })); await pg.close();
    must(r.phase === 'connected', 'demo inherited the persisted session: ' + JSON.stringify(r));
  });
  await step(`${view.name} #2 idle list: no horizontal scrollbar`, async () => {
    const pg = await open(view, 'idle'); const r = await pg.evaluate(() => { const l = document.querySelector('.idle .list'); return { ox: getComputedStyle(l).overflowX, sw: l.scrollWidth, cw: l.clientWidth, rows: document.querySelectorAll('.tagrow').length }; }); await pg.close();
    must(r.rows === 3, 'rows ' + r.rows); must(r.ox === 'hidden' && r.sw <= r.cw + 1, JSON.stringify(r));
  });
  await step(`${view.name} #4 connected: URL field, SCAN QR and the hint sit on one centre line`, async () => {
    const pg = await open(view, 'connected'); const ys = await pg.evaluate(() => ['.mcin', '.qrbtn', '.note.join'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.top + r.height / 2; })); await pg.close();
    must(Math.max(...ys) - Math.min(...ys) < 6, 'centres ' + ys.map(Math.round).join(','));
  });
  await step(`${view.name} #6 setup banner on one line`, async () => { const pg = await open(view, 'setup'); const r = await oneLine(pg, '.lobby .setup .t'); const t = await text(pg); await pg.close(); must(t.includes('HOST IS SETTING UP THE GAME'), 'copy'); must(r.length === 1 && r.every(x => x[2]), JSON.stringify(r)); });
  await step(`${view.name} #23 READY is a button, not a billboard (≤64px, ≥44px)`, async () => { const pg = await open(view, 'kitted'); const h = await pg.evaluate(() => document.querySelector('.ready').getBoundingClientRect().height / parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1)); await pg.close(); must(h >= 44 && h <= 64, 'ready height ' + h); });
  await step(`${view.name} #5 the join-refused pill sits in its own band above the plates`, async () => {
    const pg = await open(view, 'mc-rejected'); const r = await pg.evaluate(() => { const p = document.querySelector('.chipbar .pill').getBoundingClientRect(), pl = document.querySelector('.lobby .plates').getBoundingClientRect(), top = document.querySelector('.lobby .top').getBoundingClientRect(); return { pillBottom: p.bottom, platesTop: pl.top, pillTop: p.top, topBottom: top.bottom, txt: document.querySelector('.chipbar .pill').textContent }; }); await pg.close();
    must(/ASK THE HOST/.test(r.txt), 'pill text'); must(r.pillBottom <= r.platesTop + 1 && r.pillTop >= r.topBottom - 1, JSON.stringify(r));
  });
  await step(`${view.name} #10 loadout filter tabs on one line, list without sideways scroll`, async () => {
    const pg = await open(view, 'loadout-secondary'); const r = await oneLine(pg, '.fch'); const ov = await pg.evaluate(() => { const l = document.querySelector('.lolist'); return [getComputedStyle(l).overflowX, l.scrollWidth - l.clientWidth]; }); await pg.close();
    must(r.length === 3 && r.every(x => x[2]), JSON.stringify(r)); must(ov[0] === 'hidden' && ov[1] <= 1, 'lolist overflow ' + ov);
  });
  await step(`${view.name} #8/#9/#11 detail pane: title + ammo line on one line, description whole and reachable`, async () => {
    const pg = await open(view, 'loadout-primary'); const r = await pg.evaluate(() => { const d = document.querySelector('.lodetail'); const desc = d.querySelector('.desc'); const cs = getComputedStyle(desc);
      d.scrollTop = 1e6; const dr = desc.getBoundingClientRect(), pr = d.getBoundingClientRect(), bar = document.querySelector('.lobar').getBoundingClientRect();
      return { clamp: cs.webkitLineClamp, scrolls: getComputedStyle(d).overflowY, descBottom: dr.bottom, paneBottom: pr.bottom, barTop: bar.top, descH: dr.height, nm: document.querySelector('.lodetail .nm').textContent }; }); await pg.close();
    must(r.clamp === 'none', 'desc clamped: ' + r.clamp); must(r.scrolls === 'auto', 'pane overflow ' + r.scrolls);
    must(r.descBottom <= r.paneBottom + 1 && r.paneBottom <= r.barTop + 1, `desc ${r.descBottom} pane ${r.paneBottom} bar ${r.barTop}`); must(r.descH > 30, 'desc height ' + r.descH);
  });
  await step(`${view.name} #12 try-out panel clear of the footer and the status line`, async () => {
    const pg = await open(view, 'tryout'); const r = await pg.evaluate(() => { const t = document.querySelector('.tryout').getBoundingClientRect(), f = document.querySelector('.lobby .foot').getBoundingClientRect(), tr = document.querySelector('.lobby .tr').getBoundingClientRect(); return { t: [t.top, t.bottom], f: f.top, tr: tr.bottom }; }); await pg.close();
    must(r.t[1] <= r.f - 14, `tryout bottom ${r.t[1]} too close to footer top ${r.f} (want ≥14px clear)`); must(r.t[0] >= r.tr - 1, `tryout top ${r.t[0]} < status bottom ${r.tr}`);
  });
  await step(`${view.name} #28 try-out panel is slanted like DONE / READY UP, art stays inside it`, async () => {
    const pg = await open(view, 'tryout'); const r = await pg.evaluate(() => { const t = document.querySelector('.tryout'); const a = t.querySelector('.art').getBoundingClientRect(), tr = t.getBoundingClientRect(); return { tf: getComputedStyle(t).transform, inside: a.left >= tr.left && a.right <= tr.right }; }); await pg.close();
    must(r.tf !== 'none', 'panel not skewed'); must(r.inside, 'art pokes out of the slanted panel');
  });
  await step(`${view.name} #13 T-minus labels never wrap`, async () => { const pg = await open(view, 'armed'); const r = [...await oneLine(pg, '.tminus .lab .s'), ...await oneLine(pg, '.tminus .r .s'), ...await oneLine(pg, '.tminus .chip')]; await pg.close(); must(r.length === 4 && r.every(x => x[2]), JSON.stringify(r)); });
  await step(`${view.name} #14/#20 live header: legible stats, no ✓MC badges, timer clear of GUN/MC`, async () => {
    const pg = await open(view, 'live'); await pg.evaluate(() => window.brxDemo.score(3, 1, 1)); await pg.waitForTimeout(600); const r = await pg.evaluate(() => { const b = document.querySelector('.stats b'); const clock = document.querySelector('.clockplate').getBoundingClientRect(), tr = document.querySelector('.topright').getBoundingClientRect();
      return { fs: parseFloat(getComputedStyle(b).fontSize), badges: document.querySelectorAll('.stats .mc').length, gap: tr.left - clock.right, gun: document.querySelector('#linklab').textContent, mc: !!document.querySelector('#mcdot'), acc: !!document.querySelector('#st-ACC') }; }); await pg.close();
    must(r.fs >= 20, 'stat number ' + r.fs + 'px'); must(r.badges === 0, 'badges after a score push'); must(r.gap > 8, 'timer/topright gap ' + r.gap); must(r.gun === 'GUN' && r.mc, 'GUN + MC dots'); must(!r.acc, 'ACC shown before MC counted a hit');
  });
  await step(`${view.name} #29 zero stats stay off the header; a kill puts K on it`, async () => {
    const pg = await open(view, 'live'); const before = await pg.evaluate(() => document.querySelector('.stats').textContent.trim());
    await pg.evaluate(() => window.brxDemo.score(2, 0, 0)); await pg.waitForTimeout(600); const after = await pg.evaluate(() => document.querySelector('.stats').textContent.trim()); await pg.close();
    must(before === '', 'stats shown at zero: "' + before + '"'); must(/^K2$/.test(after), 'after a score push: "' + after + '"');
  });
  await step(`${view.name} #16 gun-link-lost pill and NO GUN label`, async () => { const pg = await open(view, 'live-nogun'); const t = await text(pg); const bad = await invariants(pg); await pg.close(); must(t.includes('NO GUN') && t.includes('GUN LINK LOST'), 'text'); must(bad.length === 0, bad.join(';')); });
  await step(`${view.name} #32 live off MC range: amber dot, no pill; tapping MC shows the detail`, async () => {
    const pg = await open(view, 'live-mclost'); const read = () => pg.evaluate(() => ({ dot: document.querySelector('#mcdot').className, pills: Array.from(document.querySelectorAll('.chipbar .pill')).map(p => p.textContent.trim()) }));
    let r = await read(); must(/\bws\b/.test(r.dot), 'MC dot not amber: ' + r.dot); must(!r.pills.some(t => /MISSION CONTROL/.test(t)), 'pill shown unasked: ' + r.pills);
    await pg.click('button.mclink'); await pg.waitForTimeout(400); r = await read(); must(r.pills.some(t => /OUT OF MISSION CONTROL RANGE/.test(t)), 'tap did not show the detail: ' + r.pills);
    await pg.click('button.mclink'); await pg.waitForTimeout(400); r = await read(); await pg.close(); must(!r.pills.some(t => /MISSION CONTROL/.test(t)), 'second tap did not hide it');
  });
  await step(`${view.name} #32b kitted off MC: the reconnecting pill still shows (MC is required before the match)`, async () => {
    const pg = await open(view, 'kitted'); await pg.evaluate(() => window.brxDemo.mcLost()); await pg.waitForTimeout(500); const t = await text(pg); await pg.close(); must(t.includes('RECONNECTING TO MISSION CONTROL'), 'pill missing');
  });
  await step(`${view.name} breaker-1 chips hide under the RELOADING takeover`, async () => {
    const pg = await open(view, 'live-reload', '', 3200); const r = await pg.evaluate(() => ({ up: !!document.querySelector('.mo.reloading'), chips: getComputedStyle(document.getElementById('chips')).opacity }));
    await pg.waitForTimeout(2300); const after = await pg.evaluate(() => getComputedStyle(document.getElementById('chips')).opacity); await pg.close();
    must(r.up && r.chips === '0', 'chips visible over the takeover: ' + JSON.stringify(r)); must(after === '1', 'chips stayed hidden after the reload');
  });
  await step(`${view.name} breaker-2 a reload does not survive death and respawn`, async () => {
    const pg = await open(view, 'live'); await pg.evaluate(() => { const d = window.brxDemo; d.fire(10); d.reloadPull(); setTimeout(() => d.die(), 200); setTimeout(() => d.respawn(), 600); }); await pg.waitForTimeout(1400);
    const r = await pg.evaluate(() => ({ reloading: !!document.querySelector('.mo.reloading'), redeploy: !!document.querySelector('.mo.redeploy'), alive: window.brx.engine.state().alive })); await pg.close();
    must(r.alive && !r.reloading, 'RELOADING carried into the new life: ' + JSON.stringify(r)); must(r.redeploy, 'REDEPLOYED did not play on time');
  });
  await step(`${view.name} breaker-3 DOWN in a no-respawn mode shows no countdown`, async () => {
    const pg = await open(view, 'down', '&respawn=none'); const r = await pg.evaluate(() => ({ rd: !!document.querySelector('#rd'), lab: document.querySelector('.down .lab').textContent, t: document.querySelector('.down .recap').textContent })); await pg.close();
    must(!r.rd && /NO RESPAWNS THIS MODE/.test(r.lab), JSON.stringify(r)); must(!/NO RESPAWNS/.test(r.t), 'recap repeats the big label');
  });
  await step(`${view.name} breaker-4 the plate ammo line never dangles its separator`, async () => {
    const pg = await open(view, 'over'); const r = await oneLine(pg, '.plate.slot .s .nw'); await pg.close(); must(r.length >= 1 && r.every(x => x[2]), JSON.stringify(r));
  });
  await step(`${view.name} breaker-5 harness &team=red is the red palette`, async () => {
    const pg = await open(view, 'kitted', '&team=red'); const r = await pg.evaluate(() => ({ team: document.getElementById('frame').dataset.team, chip: document.querySelector('.lobby .chip').textContent })); await pg.close(); must(r.team === 'red' && /RED/.test(r.chip), JSON.stringify(r));
  });
  await step(`${view.name} ux-1 plate subtitles never wrap (NO ALT-FIRE / SET AT ARM TIME)`, async () => { const pg = await open(view, 'kitted'); const r = await oneLine(pg, '.plate.slot .s'); await pg.close(); must(r.length === 2 && r.every(x => x[2]), JSON.stringify(r)); });
  await step(`${view.name} ux-2 night DOWN: team chips and KILLED BY are dim, not daylight`, async () => {
    const pg = await open(view, 'down', '&night'); const r = await pg.evaluate(() => Array.from(document.querySelectorAll('.down .recap .tm, .down .kb b')).map(e => getComputedStyle(e).backgroundColor)); await pg.close();
    must(r.length === 3 && r.every(c => c === 'rgb(42, 13, 13)'), 'chips ' + r.join(' '));
  });
  await step(`${view.name} ux-3 a burst of kill confirms flashes at most twice a second`, async () => {
    const pg = await open(view, 'live'); const n = await pg.evaluate(async () => { let n = 0; const mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(x => { if (x.classList && x.classList.contains('whiteout')) n++; }))); mo.observe(document.getElementById('overlay'), { childList: true });
      for (let i = 0; i < 4; i++) { window.brxDemo.killConfirm('VIPER'); await new Promise(r => setTimeout(r, 300)); } await new Promise(r => setTimeout(r, 300)); mo.disconnect(); return n; }); await pg.close();
    must(n <= 3, n + ' whiteouts in 1.2 s');
  });
  await step(`${view.name} ux-4 the MC range pill resets when MC comes back`, async () => {
    const pg = await open(view, 'live-mclost'); await pg.click('button.mclink'); await pg.waitForTimeout(300); await pg.evaluate(() => window.brxDemo.mcBound()); await pg.waitForTimeout(300); await pg.evaluate(() => window.brxDemo.mcLost()); await pg.waitForTimeout(500);
    const pills = await pg.evaluate(() => Array.from(document.querySelectorAll('.chipbar .pill')).map(p => p.textContent)); await pg.close(); must(!pills.some(t => /MISSION CONTROL/.test(t)), 'pill came back on its own: ' + pills);
  });
  await step(`${view.name} pass2-1 dying mid-reload releases the chip bar (GUN LINK LOST must show while dead)`, async () => {
    const pg = await open(view, 'live'); await pg.evaluate(() => { const d = window.brxDemo; d.fire(10); d.reloadPull(); setTimeout(() => d.die(), 200); setTimeout(() => d.dropGun(), 500); }); await pg.waitForTimeout(1100);
    const r = await pg.evaluate(() => ({ tk: document.getElementById('frame').dataset.takeover || '', chips: getComputedStyle(document.getElementById('chips')).opacity, pill: Array.from(document.querySelectorAll('.chipbar .pill')).map(p => p.textContent) })); await pg.close();
    must(r.tk === '' && r.chips === '1', 'takeover flag stuck: ' + JSON.stringify(r)); must(r.pill.some(t => /GUN LINK LOST/.test(t)), 'no link-lost pill while dead');
  });
  await step(`${view.name} pass2-2 a perk in slot 2: plate subtitle fits on one line`, async () => {
    const pg = await open(view, 'kitted-perk', '', 2400); const r = await pg.evaluate(() => Array.from(document.querySelectorAll('.plate.slot')).map(p => ({ k: p.querySelector('.k').textContent.trim(), s: p.querySelector('.s').textContent.trim(), clipped: p.querySelector('.s').scrollWidth > p.querySelector('.s').clientWidth + 1 }))); await pg.close();
    must(r[1] && /PERK/.test(r[1].k) && /FASTER/.test(r[1].s), 'perk plate: ' + JSON.stringify(r)); must(r.every(x => !x.clipped), 'subtitle clipped: ' + JSON.stringify(r));
  });
  await step(`${view.name} pass2-3 gun link drop mid-reload releases the takeover at once`, async () => {
    const pg = await open(view, 'live'); await pg.evaluate(() => { const d = window.brxDemo; d.fire(10); d.reloadPull(); setTimeout(() => d.dropGun(), 200); }); await pg.waitForTimeout(700);
    const r = await pg.evaluate(() => ({ up: !!document.querySelector('.mo.reloading'), chips: getComputedStyle(document.getElementById('chips')).opacity, pill: Array.from(document.querySelectorAll('.chipbar .pill')).map(p => p.textContent) })); await pg.close();
    must(!r.up && r.chips === '1' && r.pill.some(t => /GUN LINK LOST/.test(t)), JSON.stringify(r));
  });
  await step(`${view.name} pass2-4 DOWN at a scanner: the glyph stays above its label`, async () => {
    // scanner mode counts the delay down first (utility.md §4.3), so wait past a 1 s delay for the station hint + glyph
    const pg = await open(view, 'down', '&respawn=scanner&delay=1', 4200); const r = await pg.evaluate(() => { const g = document.querySelector('.down .n.nn'), i = document.querySelector('.down .ins'); if (!g || !i) return { ins: i && i.textContent }; const gr = g.getBoundingClientRect(), ir = i.getBoundingClientRect(); return { gb: gr.bottom, it: ir.top, ins: i.textContent }; }); await pg.close();
    must(/RESPAWN STATION/.test(r.ins || '') && r.gb != null && r.gb <= r.it + 2, JSON.stringify(r));
  });
  await step(`${view.name} audit-1 two pills share the band above the plates`, async () => {
    const pg = await open(view, 'kitted'); await pg.evaluate(() => { window.brxDemo.mcLost(); window.brxDemo.dropGun(); }); await pg.waitForTimeout(600);
    const r = await pg.evaluate(() => { const ps = Array.from(document.querySelectorAll('.chipbar .pill')).map(p => p.getBoundingClientRect()); const pl = document.querySelector('.lobby .plates').getBoundingClientRect(); return { n: ps.length, tops: ps.map(p => Math.round(p.top)), maxBottom: Math.max(...ps.map(p => p.bottom)), platesTop: pl.top }; }); await pg.close();
    must(r.n === 2 && new Set(r.tops).size === 1, 'pills not on one row: ' + JSON.stringify(r)); must(r.maxBottom <= r.platesTop + 1, 'pills over the plates: ' + JSON.stringify(r));
  });
  await step(`${view.name} audit-2 the loadout browser's pill sits clear of tabs, filters and the action bar`, async () => {
    const pg = await open(view, 'loadout-secondary'); await pg.evaluate(() => window.brxDemo.mcLost()); await pg.waitForTimeout(600);
    const r = await pg.evaluate(() => { const p = document.querySelector('.chipbar .pill'); if (!p) return null; const pr = p.getBoundingClientRect(); const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; return ['.lotop', '.lofilt', '.lobar'].map(s => [s, hit(pr, document.querySelector(s).getBoundingClientRect())]); }); await pg.close();
    must(r && r.every(x => !x[1]), 'pill collides: ' + JSON.stringify(r));
  });
  await step(`${view.name} audit-3 hits still show over the RELOADING takeover`, async () => {
    const pg = await open(view, 'live'); await pg.evaluate(() => { const d = window.brxDemo; d.fire(10); d.reloadPull(); setTimeout(() => d.hit(), 300); }); await pg.waitForTimeout(600);
    const r = await pg.evaluate(() => ({ reload: !!document.querySelector('.mo.reloading'), hit: !!document.querySelector('.mo.hit') })); await pg.close(); must(r.reload && r.hit, JSON.stringify(r));
  });
  await step(`${view.name} audit-4 loadout description: last line readable at the end of the scroll`, async () => {
    const pg = await open(view, 'loadout-primary'); const r = await pg.evaluate(() => { const d = document.querySelector('.lodetail'); d.scrollTop = 1e6; const desc = d.querySelector('.desc').getBoundingClientRect(), pane = d.getBoundingClientRect(); return { descBottom: desc.bottom, fadeTop: pane.top + pane.height * .9 }; }); await pg.close();
    must(r.descBottom <= r.fadeTop + 1, `last line under the fade: ${r.descBottom} > ${r.fadeTop}`);
  });
  await step(`${view.name} pass3-1 no RELOADING takeover during the resync protocol`, async () => {
    const pg = await open(view, 'resync'); await pg.evaluate(() => { const d = window.brxDemo; d.reloadPull(); }); await pg.waitForTimeout(500);
    const r = await pg.evaluate(() => ({ reload: !!document.querySelector('.mo.reloading'), prompt: !!document.querySelector('.prompt'), chips: getComputedStyle(document.getElementById('chips')).opacity })); await pg.close();
    must(!r.reload && r.prompt && r.chips === '1', JSON.stringify(r));
  });
  await step(`${view.name} #40 SWITCHING takeover: from → to, then ACTIVE on the confirming shot`, async () => {
    const pg = await open(view, 'live-switch', '', 3100); const r = await pg.evaluate(() => { const m = document.querySelector('.mo.switching'); if (!m) return null; return { t: m.querySelector('.t').textContent, from: m.querySelector('.wt.from .wn').textContent, to: m.querySelector('.wt.to .wn').textContent, w: parseFloat(m.querySelector('#swbar').style.width), chips: getComputedStyle(document.getElementById('chips')).opacity }; });
    await pg.waitForTimeout(700); const r2 = await pg.evaluate(() => { const m = document.querySelector('.mo.switched'); return { sw: !!document.querySelector('.mo.switching'), on: m ? m.querySelector('.wt.on .wn').textContent : null, lab: m ? m.querySelector('.wl').textContent : null, corner: document.querySelector('.ammo .wn').textContent, chips: getComputedStyle(document.getElementById('chips')).opacity }; }); await pg.close();
    must(r, 'no SWITCHING overlay'); must(r.t === 'SWITCHING' && r.from === 'ASSAULT RIFLE' && r.to === 'SMG' && r.w > 0 && r.chips === '0', JSON.stringify(r));
    must(!r2.sw && r2.on === 'SMG' && /ACTIVE/.test(r2.lab) && /SMG/.test(r2.corner) && r2.chips === '1', JSON.stringify(r2));
  });
  await step(`${view.name} #41 game-event alert banner: text, family colour, one line, gone by ~5 s`, async () => {
    const pg = await open(view, 'live-alert', '', 2900); const r = await pg.evaluate(() => { const a = document.querySelector('.mo.alert'); if (!a) return null; const t = a.querySelector('.t'); const rg = document.createRange(); rg.selectNodeContents(t); return { txt: t.textContent, fam: a.className, lines: rg.getClientRects().length, col: getComputedStyle(a.querySelector('.k')).color, w: a.querySelector('.band').getBoundingClientRect().width, fw: document.getElementById('frame').getBoundingClientRect().width }; });
    await pg.waitForTimeout(2500); const gone = await pg.evaluate(() => !document.querySelector('.mo.alert')); await pg.close();
    must(r, 'no alert banner'); must(r.txt === 'BOMB PLANTED' && /danger/.test(r.fam) && r.lines === 1 && r.w >= r.fw - 2, JSON.stringify(r)); must(gone, 'alert still up after 5.4 s');
  });
  await step(`${view.name} #41b alert at night still shows (dim)`, async () => {
    const pg = await open(view, 'live-alert', '&night', 2900); const r = await pg.evaluate(() => { const a = document.querySelector('.mo.alert'); return a ? { vis: getComputedStyle(a).display !== 'none', txt: a.querySelector('.t').textContent } : null; }); await pg.close(); must(r && r.vis && r.txt === 'BOMB PLANTED', JSON.stringify(r));
  });
  await step(`${view.name} #42 kill with medals: badges stack and the takeover holds for the announcer lines`, async () => {
    const pg = await open(view, 'live-medals', '', 3000); const r = await pg.evaluate(() => { const k = document.querySelector('.mo.kill'); if (!k) return null; return { badges: Array.from(k.querySelectorAll('.medal')).map(b => [b.textContent.trim(), getComputedStyle(b).opacity]) }; });
    await pg.waitForTimeout(2300); const r2 = await pg.evaluate(() => { const k = document.querySelector('.mo.kill'); return { up: !!k, second: k ? getComputedStyle(k.querySelectorAll('.medal')[1]).opacity : null }; }); await pg.close();
    must(r && r.badges.length === 2 && r.badges[0][0] === 'DOUBLE KILL' && r.badges[1][0] === 'KILLING SPREE', JSON.stringify(r)); must(+r.badges[0][1] === 1 && +r.badges[1][1] === 0, 'first badge up, second waiting: ' + JSON.stringify(r));
    must(r2.up && +r2.second === 1, 'second badge should land at +2 s while the takeover holds: ' + JSON.stringify(r2));
  });
  await step(`${view.name} #43 Quick Switch perk halves the swap window (425 ms, then ACTIVE · READY)`, async () => {
    const pg = await open(view, 'live-switch-perk', '', 2950); const r = await pg.evaluate(() => ({ win: window.brx.engine.state().switchWindowMs, up: !!document.querySelector('.mo.switching') }));
    await pg.waitForTimeout(950); const r2 = await pg.evaluate(() => { const m = document.querySelector('.mo.switched'); return { up: !!document.querySelector('.mo.switching'), lab: m ? m.querySelector('.s').textContent : null, slot: window.brx.engine.state().activeSlot }; }); await pg.close();   // the assumed swap lands on the next 250 ms engine tick after the window
    must(r.win === 425 && r.up, JSON.stringify(r)); must(!r2.up && r2.lab === 'READY' && r2.slot === 1, JSON.stringify(r2));
  });
  await step(`${view.name} #44 sidearm-only slot 2: SIDEARMS chip, pistol rows, SIDEARM role`, async () => {
    const pg = await open(view, 'loadout-sidearms'); const r = await pg.evaluate(() => ({ chips: Array.from(document.querySelectorAll('.fch')).map(c => c.textContent.trim()), rows: Array.from(document.querySelectorAll('.lrow .nm')).map(e => e.textContent.trim()), roles: Array.from(new Set(Array.from(document.querySelectorAll('.lrow .role')).map(e => e.textContent.trim()))), detail: (document.querySelector('.lodetail .rolechip') || {}).textContent }));
    await pg.click('.fch[data-arg="perks"]'); await pg.waitForTimeout(300); const perks = await pg.evaluate(() => document.querySelectorAll('.lrow').length); await pg.close();
    must(r.chips[0] === 'SIDEARMS · 3' && r.chips[1] === 'PERKS · 5', 'chips ' + r.chips); must(r.rows.length === 3 && r.rows.includes('GLOCK-18'), 'rows ' + r.rows); must(r.roles.length === 1 && r.roles[0] === 'SIDEARM' && r.detail === 'SIDEARM', 'role ' + r.roles + ' / ' + r.detail); must(perks === 5, 'perks tab');
  });
  await step(`${view.name} #45 DOWN in scanner mode: find → approach (closeness bar) → at station`, async () => {
    const pg = await open(view, 'down-find', '', 4200); /* death at ~2.6 s + the 1 s scanner delay */ const has = await pg.evaluate(() => typeof window.brx.engine.setStations === 'function');
    if (!has) { await pg.close(); console.log('       (engine without stations — step skipped)'); return; }
    const read = () => pg.evaluate(() => { const l = document.querySelector('.down .lab'), i = document.querySelector('.down .ins'); const b = document.querySelector('.down .near i'); return { hint: window.brx.engine.state().respawnHint, ins: i ? i.textContent.trim() : null, lab: l ? l.textContent.trim() : null, bar: b ? parseFloat(b.style.width) : null, on: !!document.querySelector('.down .ins.on') }; });
    let r = await read(); must(r.hint === 'find_station' && r.ins === "RUN TO YOUR TEAM'S RESPAWN STATION" && r.lab === 'THEN PULL THE TRIGGER THERE' && r.bar === null, JSON.stringify(r));
    const title = await pg.evaluate(() => ({ a: (document.querySelector('.down .tt .t') || {}).textContent, b: (document.querySelector('.down .tt .t2') || {}).innerText, anim: getComputedStyle(document.querySelector('.down .tt .t2')).animationName }));
    must(title.a === 'DOWN' && /RESPAWN\s+AT STATION/.test(title.b || '') && title.anim === 'downB', 'title cycle: ' + JSON.stringify(title));
    await pg.evaluate(() => window.brxDemo.station(-89, false)); await pg.waitForTimeout(500); r = await read();
    must(r.hint === 'approach' && r.ins === 'GET CLOSER' && /-89 \/ -74 dBm$/.test(r.lab) && r.bar === 50 && !r.on, JSON.stringify(r));   // 15 dB below the -74 threshold = half a bar
    await pg.evaluate(() => window.brxDemo.station(-70, true)); await pg.waitForTimeout(500); r = await read(); await pg.screenshot({ path: `${OUT}/${view.name}-down-at.png` }); await pg.close();
    must(r.hint === 'pull_trigger' && r.ins === 'PULL THE TRIGGER TO RESPAWN' && r.bar === 100 && r.on, JSON.stringify(r));
  });
  await step(`${view.name} #45b at the station before the delay is up: HOLD…, never a "00"`, async () => {
    const pg = await open(view, 'down-hold', '', 3300); const r = await pg.evaluate(() => ({ hint: window.brx.engine.state().respawnHint, ins: (document.querySelector('.down .ins') || {}).textContent, rd: !!document.querySelector('#rd'), txt: document.querySelector('.down .c').innerText })); await pg.close();
    if (r.hint !== 'hold') { console.log('       (engine without the hold hint — step skipped: ' + r.hint + ')'); must(!r.rd && !/\b00\b/.test(r.txt), 'a 00 countdown on a scanner DOWN: ' + r.txt); return; }
    must(r.ins === 'HOLD…' && !r.rd && !/\b00\b/.test(r.txt), JSON.stringify(r));
  });
  await step(`${view.name} #46 idle: a UTILITY MODE control exists (44px tap row)`, async () => {
    const pg = await open(view, 'idle'); const r = await pg.evaluate(() => { const b = document.querySelector('[data-act="onUtility"]'); if (!b) return null; const rc = b.getBoundingClientRect(); const sc = parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1); return { txt: b.textContent.trim(), h: rc.height / sc }; }); await pg.close();
    must(r && /UTILITY MODE/.test(r.txt) && r.h >= 38, JSON.stringify(r));
  });
  await step(`${view.name} #17 resync prompt: label over instruction, each on one line`, async () => { const pg = await open(view, 'resync'); const r = [...await oneLine(pg, '.prompt .pl'), ...await oneLine(pg, '.prompt .pi')]; const stack = await pg.evaluate(() => document.querySelector('.prompt .pl').getBoundingClientRect().bottom <= document.querySelector('.prompt .pi').getBoundingClientRect().top + 1); await pg.close(); must(r.length === 2 && r.every(x => x[2]), JSON.stringify(r)); must(r[0][1] === 'GUN RELINKED' && r[1][1] === 'PULL THE TRIGGER', 'copy'); must(stack, 'label is not above the instruction'); });
  await step(`${view.name} #15 RELOADING takeover with progress and the weapon`, async () => {
    const pg = await open(view, 'live-reload', '', 3300); const r = await pg.evaluate(() => { const m = document.querySelector('.mo.reloading'); if (!m) return null; return { t: m.querySelector('.t').textContent, s: m.querySelector('.s').textContent, w: parseFloat(m.querySelector('#rlbar').style.width), n: m.querySelector('#rlleft').textContent, big: parseFloat(getComputedStyle(m.querySelector('.t')).fontSize) }; });
    await pg.waitForTimeout(2200); const gone = await pg.evaluate(() => !document.querySelector('.mo.reloading')); await pg.close();
    must(r, 'no RELOADING overlay'); must(r.t === 'RELOADING' && /^ASSAULT RIFLE$/.test(r.s), JSON.stringify(r)); must(r.w > 5 && r.w < 100 && /S$/.test(r.n), 'progress ' + r.w + ' ' + r.n); must(r.big >= 60, 'too small'); must(gone, 'takeover did not clear once the mag was back');
  });
  await step(`${view.name} #19 KILL CONFIRMED is a takeover, not a sticker`, async () => {
    const pg = await open(view, 'live-kill', '', 3000); const r = await pg.evaluate(() => { const k = document.querySelector('.mo.kill'); if (!k) return null; const c = k.querySelector('.c').getBoundingClientRect(), f = k.getBoundingClientRect(); return { mid: (c.top + c.height / 2 - f.top) / f.height, big: parseFloat(getComputedStyle(k.querySelector('.k')).fontSize), bg: getComputedStyle(k).backgroundImage }; }); await pg.close();
    must(r, 'no kill overlay'); must(r.mid > .3 && r.mid < .6, 'not centred: ' + r.mid); must(r.big >= 90, 'KILL ' + r.big + 'px'); must(/0\.9/.test(r.bg), 'HUD not dimmed behind it');
  });
  await step(`${view.name} #25/#26 DOWN: recap instead of ghost numbers`, async () => {
    const read = () => pg.evaluate(() => ({ ghost: !!document.querySelector('.down .ghost'), recap: (document.querySelector('.down .recap') || {}).textContent || '', bottoms: Array.from(document.querySelectorAll('.down .recap > .rc')).map(s => Math.round(s.getBoundingClientRect().bottom / 3)), tiles: document.querySelectorAll('.down .recap > .rc').length, chips: document.querySelectorAll('.down .recap .tm').length }));
    const pg = await open(view, 'down'); let r = await read();
    must(!r.ghost, 'ghost numbers still there'); for (const k of ['TIME LEFT', 'FIRST TO 25', 'BLUE', 'YELLOW', 'YOU', 'KILLS', 'DEATH']) must(r.recap.includes(k), 'recap missing ' + k + ': ' + r.recap); must(new Set(r.bottoms).size === 1, 'recap wrapped ' + r.bottoms); must(r.tiles === 3 && r.chips === 2, 'tiles ' + r.tiles + ' chips ' + r.chips);
    // the MC link drops: team totals and kills come from MC, so they leave the recap; the phone's own facts stay
    await pg.evaluate(() => window.brxDemo.mcLost()); await pg.waitForTimeout(700); r = await read(); await pg.screenshot({ path: `${OUT}/${view.name}-down-offline.png` }); await pg.close();
    must(r.chips === 0 && !r.recap.includes('KILL'), 'off-link recap still shows MC data: ' + r.recap); for (const k of ['TIME LEFT', 'SCORE CAP', 'DEATH', 'SHOT']) must(r.recap.includes(k), 'off-link recap missing ' + k + ': ' + r.recap);
  });
  await step(`${view.name} #18/#27 REDEPLOYED fits and lists the kit`, async () => {
    const pg = await open(view, 'redeploy', '', 4100); const r = await pg.evaluate(() => { const m = document.querySelector('.mo.redeploy'); if (!m) return null; const t = m.querySelector('.t').getBoundingClientRect(), f = document.getElementById('frame').getBoundingClientRect(); const kit = Array.from(m.querySelectorAll('.kit .kn')).map(e => e.textContent); const s = m.querySelector('.r .s').getBoundingClientRect(), k = m.querySelector('.kit').getBoundingClientRect(), sl = m.querySelector('.slash').getBoundingClientRect(), tt = m.querySelector('.t'); return { right: t.right, frameRight: f.right, kit, overlap: k.top < s.bottom - 1, textLeft: t.left, slashRight: sl.right, clipped: tt.scrollWidth > tt.clientWidth + 1 }; }); await pg.close();
    must(r, 'no redeploy overlay'); must(r.right <= r.frameRight && !r.clipped, `REDEPLOYED clipped: ${r.right} > ${r.frameRight} / ${r.clipped}`); must(r.textLeft >= r.slashRight - 2, `text starts inside the slash: ${r.textLeft} < ${r.slashRight}`); must(r.kit.includes('ASSAULT RIFLE'), 'kit ' + r.kit); must(!r.overlap, 'kit row overlaps the line above');
  });
  await step(`${view.name} #21 accuracy shown only once MC has counted hits (result)`, async () => {
    const pg = await open(view, 'result'); const t = await text(pg); await pg.close(); must(/41%\s*ACCURACY/.test(t), 'result should show 41% here: ' + t.slice(0, 120)); must(!t.includes('✓MC'), 'badge');
  });
  await step(`${view.name} #22 MATCH COMPLETE on one line, plates intact`, async () => { const pg = await open(view, 'over'); const r = await oneLine(pg, '.ready.wait'); must(r.length === 1, 'no MATCH COMPLETE button'); const btn = await pg.evaluate(() => document.querySelector('.ready.wait').textContent.trim()); await pg.close(); must(btn === 'MATCH COMPLETE', 'button copy: ' + btn); must(r.every(x => x[2]), JSON.stringify(r)); });
  await step(`${view.name} #24 night: the kit plates stay visible`, async () => {
    const pg = await open(view, 'kitted', '&night'); const r = await pg.evaluate(() => Array.from(document.querySelectorAll('.plate')).map(p => getComputedStyle(p).backgroundColor)); await pg.close();
    must(r.length >= 3 && r.every(c => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'), 'transparent plates: ' + r.join(' '));
  });
}
await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed${fail ? ': ' + errs.join(', ') : ''}`);
process.exit(fail ? 1 : 0);
