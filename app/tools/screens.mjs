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
const LONG = new Set(['live-reload-overrun', 'resync-prompt', 'down-find-presence', 'down-wait', 'down-find', 'down-approach', 'down-at', 'live-switch-perk', 'live-alert', 'live-medals', 'live-switch', 'live', 'live-kill', 'live-reload', 'down', 'redeploy', 'resync', 'live-nogun', 'live-mclost', 'result', 'over', 'panic', 'live-hit', 'live-lowhp', 'live-lowammo', 'live-fired', 'aborted',
  'result-pending', 'result-unreached', 'result-win-team', 'result-players', 'result-lose-ffa', 'result-draw', 'result-undecided', 'history',
  'down-at-cap-offline', 'armed-with-mc-verify', 'loadout-picked']);   // A26: a pick now waits out the node's 400 ms debounce AND the host round-trip before the row reads ✓
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
// "sheared" = the box is SHORTER than the same element laid out at its natural height. A flex item that is
// squeezed below its own content height paints its text and then clips it, and the PARENT never overflows —
// which is exactly why no overflow check caught F110. offsetHeight is layout px, so the #frame scale is out
// of it (a getBoundingClientRect comparison silently fails at any viewport where the scale is not 1).
// Every outcome carries the SAME shape, and a missing element is its own verdict: the old code returned a
// 2-tuple for ABSENT, so `x[3]` was `undefined` and a row that never rendered was reported as if it had been
// sheared — the suite could not tell "the box clipped the text" from "the box is not on screen".
const sheared = (pg, sels) => pg.evaluate(sels => sels.map(sel => {
  const e = document.querySelector(sel); if (!e) return { sel, want: null, got: null, verdict: 'ABSENT' };
  const c = e.cloneNode(true); c.style.cssText = getComputedStyle(e).cssText;
  c.style.position = 'absolute'; c.style.left = '-9999px'; c.style.top = '0'; c.style.width = e.clientWidth + 'px';
  c.style.height = 'auto'; c.style.maxHeight = 'none'; c.style.flex = 'none'; c.style.animation = 'none';
  e.parentElement.appendChild(c); const want = c.offsetHeight; c.remove();
  return { sel, want, got: e.clientHeight, verdict: want > e.clientHeight + 1 ? 'SHEARED' : 'ok' };
}), sels);
/** Both halves of a `sheared()` result, asserted separately so a failure names which one it is. */
const notSheared = (r, sels) => {
  const missing = r.filter(x => x.verdict === 'ABSENT').map(x => x.sel);
  must(missing.length === 0, 'a row this step exists to measure is not on screen: ' + missing.join(', '));
  must(r.length === sels.length, `asked about ${sels.length} rows, got ${r.length}`);
  must(r.every(x => x.verdict === 'ok'), JSON.stringify(r));
};

for (const view of VIEWS) {
  console.log(`\n== ${view.name} ${view.width}×${view.height} ==`);
  for (const st of ['idle', 'connected', 'mc-rejected', 'setup', 'briefing', 'kitted', 'kitted-ready', 'loadout-primary', 'loadout-secondary', 'loadout-picked', 'loadout-arming', 'loadout-info', 'kitted-perk', 'kitted-full', 'loadout-perk', 'tryout', 'lobby', 'lobby-kit-locked', 'kit-refused', 'armed', 'live', 'live-nogun', 'resync', 'live-kill', 'live-reload', 'down', 'redeploy', 'result', 'over',
    'result-pending', 'result-unreached', 'result-win-team', 'result-players', 'result-lose-ffa', 'result-draw', 'result-undecided', 'history',
    'down-at-cap-offline', 'armed-with-mc-verify']) {
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
    must(r.length === 2 && r.every(x => x[2]), JSON.stringify(r)); must(ov[0] === 'hidden' && ov[1] <= 1, 'lolist overflow ' + ov);   // A14: WEAPONS + NONE (perks moved to their own tab)
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
  await step(`${view.name} ux-1 plate subtitles never wrap (NO ALT-FIRE / SET AT ARM TIME)`, async () => { const pg = await open(view, 'kitted'); const r = await oneLine(pg, '.plate.slot .s'); await pg.close(); must(r.length === 3 && r.every(x => x[2]), JSON.stringify(r)); });   // A14: three plates
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
  await step(`${view.name} pass2-2 a perk in its own plate: subtitle fits on one line, the secondary plate is untouched`, async () => {
    const pg = await open(view, 'kitted-perk', '', 2400); const r = await pg.evaluate(() => Array.from(document.querySelectorAll('.plate.slot')).map(p => ({ k: p.querySelector('.k').textContent.trim(), s: p.querySelector('.s').textContent.trim(), clipped: p.querySelector('.s').scrollWidth > p.querySelector('.s').clientWidth + 1 }))); await pg.close();
    must(r.length === 3 && /PERK/.test(r[2].k) && /FASTER/.test(r[2].s), 'perk plate: ' + JSON.stringify(r)); must(/SECONDARY/.test(r[1].k) && /NONE/.test((r[1].s || '') + ' ') === false, 'secondary plate: ' + JSON.stringify(r[1]));
    must(r.every(x => !x.clipped), 'subtitle clipped: ' + JSON.stringify(r));
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
    const pg = await open(view, 'resync-prompt'); await pg.evaluate(() => { const d = window.brxDemo; d.reloadPull(); }); await pg.waitForTimeout(500);
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
    await pg.close();
    must(r.chips[0] === 'SIDEARMS · 3' && /^NONE/.test(r.chips[1]) && r.chips.length === 2, 'chips ' + r.chips); must(r.rows.length === 3 && r.rows.includes('GLOCK-18'), 'rows ' + r.rows); must(r.roles.length === 1 && r.roles[0] === 'SIDEARM' && r.detail === 'SIDEARM', 'role ' + r.roles + ' / ' + r.detail);
  });
  // A14: the perk is its own slot (Tony 2026-09-04: "you should be able to have AR and pistol and quick switch perk")
  await step(`${view.name} #52 three plates on ONE row (PRIMARY / SECONDARY / PERK), HP·ARMOR in the header, nothing clipped`, async () => {
    const pg = await open(view, 'kitted-full', '', 2000); const r = await pg.evaluate(() => { const ps = Array.from(document.querySelectorAll('.plate.slot')).map(p => ({ k: p.querySelector('.k').textContent.trim(), h: p.querySelector('.h').textContent.trim(), top: Math.round(p.getBoundingClientRect().top), right: Math.round(p.getBoundingClientRect().right), clipped: p.querySelector('.h').scrollWidth > p.querySelector('.h').clientWidth + 1 }));
      const f = document.getElementById('frame').getBoundingClientRect(); return { ps, hpar: (document.querySelector('.lobby .hpar') || {}).textContent || '', fright: Math.round(f.right) }; });
    await pg.close();
    must(r.ps.length === 3 && r.ps.map(p => p.k.replace(/[▸\s]+$/, '')).join('|') === 'PRIMARY|SECONDARY|PERK', 'plates: ' + JSON.stringify(r.ps));
    must(new Set(r.ps.map(p => p.top)).size === 1, 'plates wrapped onto two rows: ' + JSON.stringify(r.ps)); must(r.ps.every(p => p.right <= r.fright), 'a plate leaves the frame');
    must(r.ps[1].h === 'GLOCK-18' && r.ps[2].h === 'QUICK SWITCH', 'AR + pistol + Quick Switch expected: ' + JSON.stringify(r.ps)); must(/HP 45 · ARMOR 70/.test(r.hpar), 'HP·ARMOR moved to the header: ' + r.hpar);
    must(r.ps.every(p => !p.clipped), 'plate title clipped: ' + JSON.stringify(r.ps));
  });
  await step(`${view.name} #53 PERK tab: three tabs on one line, 5 perk rows + NONE, tapping a perk keeps the second weapon`, async () => {
    const pg = await open(view, 'loadout-perk', '', 2000); const r = await pg.evaluate(() => ({ tabs: Array.from(document.querySelectorAll('.lotab')).map(t => ({ k: t.querySelector('.k').textContent.trim(), top: Math.round(t.getBoundingClientRect().top) })), chips: Array.from(document.querySelectorAll('.fch')).map(c => c.textContent.trim()), rows: document.querySelectorAll('.lrow').length, eq: (document.querySelector('.lrow.eq .nm2 b') || {}).textContent }));
    await pg.click('.lrow[data-arg="perk:body_armor"]'); await pg.waitForTimeout(700);
    const after = await pg.evaluate(() => { const lo = window.brx.engine.state().loadout; return { perk: lo.perk && lo.perk.perk_id, sec: lo.secondary && lo.secondary.weapon_id, chip: (document.querySelector('.ackchip') || {}).textContent || '' }; }); await pg.close();
    must(r.tabs.map(t => t.k).join('|') === 'PRIMARY|SECONDARY|PERK' && new Set(r.tabs.map(t => t.top)).size === 1, 'tabs: ' + JSON.stringify(r.tabs));
    must(r.chips[0] === 'PERKS · 5' && /^NONE/.test(r.chips[1]), 'chips ' + r.chips); must(r.rows === 5 && r.eq === 'QUICK SWITCH', 'rows/equipped: ' + r.rows + ' ' + r.eq);
    must(after.perk === 'body_armor' && after.sec === 'glock', 'a perk pick must not displace the pistol: ' + JSON.stringify(after)); must(/EQUIPPED/.test(after.chip) && !/DROPPED/.test(after.chip), 'ack chip: ' + after.chip);
  });
  await step(`${view.name} #54 Easy Reload over a loaded SMG: first tap warns (nothing sent), second tap equips and reports the SMG dropped`, async () => {
    const pg = await open(view, 'loadout-perk-conflict', '', 2400);
    const first = await pg.evaluate(() => ({ warn: !!document.querySelector('.lrow.warn[data-arg="perk:easy_reload"]'), chip: (document.querySelector('.ackchip') || {}).textContent || '', sent: (window.brx.log || []).filter(l => /loadout_request perk perk easy_reload/.test(l)).length, sec: window.brx.engine.state().loadout.secondary && window.brx.engine.state().loadout.secondary.weapon_id }));
    must(first.warn && /TAKES THE ALT BUTTON/.test(first.chip) && /DROPS YOUR SMG/.test(first.chip) && /TAP AGAIN/.test(first.chip), 'first tap should warn: ' + JSON.stringify(first));
    must(first.sent === 0 && first.sec === 'smg', 'first tap must not send: ' + JSON.stringify(first));
    await pg.click('.lrow[data-arg="perk:easy_reload"]'); await pg.waitForTimeout(800);
    const second = await pg.evaluate(() => { const lo = window.brx.engine.state().loadout; return { perk: lo.perk && lo.perk.perk_id, sec: lo.secondary, chip: (document.querySelector('.ackchip') || {}).textContent || '', ack: window.brx.engine.loadoutAck }; });
    await pg.click('.lotab[data-arg="secondary"]'); await pg.waitForTimeout(300); await pg.click('.lrow[data-arg="weapon:smg"]'); await pg.waitForTimeout(300);
    const third = await pg.evaluate(() => ({ warn: !!document.querySelector('.lrow.warn[data-arg="weapon:smg"]'), chip: (document.querySelector('.ackchip') || {}).textContent || '' })); await pg.close();
    must(second.perk === 'easy_reload' && second.sec === null, 'second tap should equip and drop the SMG: ' + JSON.stringify(second)); must(/EQUIPPED/.test(second.chip) && /SMG DROPPED/.test(second.chip), 'ack chip: ' + second.chip);
    must(second.ack && second.ack.dropped && second.ack.dropped.id === 'smg', 'ack.dropped: ' + JSON.stringify(second.ack));
    must(third.warn && /NEEDS THE ALT BUTTON/.test(third.chip) && /DROPS EASY RELOAD/.test(third.chip), 'the reverse pick warns too: ' + JSON.stringify(third));
  });
  await step(`${view.name} #45 DOWN in scanner mode: find → approach (closeness bar) → at station`, async () => {
    const pg = await open(view, 'down-find', '', 6200); /* death at ~2.6 s + the 3 s scanner delay (the F34 floor) + margin */ const has = await pg.evaluate(() => typeof window.brx.engine.setStations === 'function');
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
  await step(`${view.name} #45c presence gate: the first-death line never says "pull the trigger"`, async () => {
    const pg = await open(view, 'down-find-presence', '', 6200); const r = await pg.evaluate(() => ({ gate: window.brx.engine.state().respawnGate, hint: window.brx.engine.state().respawnHint, ins: (document.querySelector('.down .ins') || {}).textContent, lab: (document.querySelector('.down .lab') || {}).textContent })); await pg.close();
    if (r.gate !== 'presence') { console.log('       (engine without respawnGate — step skipped)'); return; }
    must(r.hint === 'find_station' && /RESPAWN STATION/.test(r.ins || '') && r.lab === 'AND STAND THERE', JSON.stringify(r));
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
  await step(`${view.name} #48 utility phone: status only; ⓘ ×7 opens the settings; START sticks across a reload`, async () => {
    const pg = await b.newPage({ viewport: { width: 411, height: 891 } }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
    await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); } catch {} }).catch(() => {});
    await pg.goto('http://127.0.0.1:4192/utility.html?stage'); await pg.waitForTimeout(1600);
    const s1 = await pg.evaluate(() => ({ hidden: document.getElementById('cfg').hidden, rows: document.querySelectorAll('#players .row:not(.empty)').length, team: document.getElementById('team').textContent, status: document.getElementById('status').textContent }));
    for (let i = 0; i < 6; i++) await pg.click('#info'); const six = await pg.evaluate(() => document.getElementById('cfg').hidden); await pg.click('#info'); await pg.waitForTimeout(150);
    const s2 = await pg.evaluate(() => ({ hidden: document.getElementById('cfg').hidden, defaults: document.querySelectorAll('#cfg .def').length, pressed: document.querySelectorAll('.seg button[aria-pressed="true"]').length, rangeLabel: !!document.querySelector('label[for="thrRange"]') }));
    await pg.click('#btnStart'); await pg.waitForTimeout(200); await pg.click('#cfgClose'); await pg.waitForTimeout(150);
    const s3 = await pg.evaluate(() => ({ status: document.getElementById('status').textContent, hidden: document.getElementById('cfg').hidden }));
    await pg.reload(); await pg.waitForTimeout(1500); const s4 = await pg.evaluate(() => ({ status: document.getElementById('status').textContent, hidden: document.getElementById('cfg').hidden }));
    await pg.screenshot({ path: `${OUT}/${view.name}-utility.png` }); await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); } catch {} }); await pg.close();
    must(perr.length === 0, perr.join('|')); must(s1.hidden && s1.rows === 4 && s1.team === 'BLUE' && s1.status === 'READY', 'status screen: ' + JSON.stringify(s1));   // four fake phones: three for the respawn demo + the opposing team a control point needs (F82 bars tid 2)
    must(six, 'six taps opened the settings'); must(!s2.hidden && s2.defaults >= 6 && s2.pressed === 3 && s2.rangeLabel, 'settings: ' + JSON.stringify(s2));
    must(s3.status === 'LIVE' && s3.hidden, 'after START + close: ' + JSON.stringify(s3)); must(s4.status === 'LIVE' && s4.hidden, 'after reload: ' + JSON.stringify(s4));
  });
  await step(`${view.name} #49 utility phone: a station_config push arms it (MC-ARMED · game, re-keyed advert, live, drawer shut, survives reload)`, async () => {
    const pg = await b.newPage({ viewport: { width: 411, height: 891 } }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
    await pg.goto('http://127.0.0.1:4192/utility.html?stage'); await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); } catch {} }); await pg.reload(); await pg.waitForTimeout(1500);
    const s1 = await pg.evaluate(() => document.getElementById('armed').textContent);
    // Through the REAL wire (review 2026-09-11 lane-4): `mcMessage` hands a real `station_config` envelope
    // to the stage's fake socket, which the Transport decodes exactly as it would a live MC push -- not a
    // bare call into `applyStationConfig()`, which used to skip the envelope entirely.
    await pg.evaluate(() => window.brxUtility.mcMessage('station_config', { kind: 'bomb', team: 'red', id: 4, threshold: -70, game: 3, valid_ids: [4, 7] })); await pg.waitForTimeout(400);
    const s2 = await pg.evaluate(() => ({ armed: document.getElementById('armed').textContent, status: document.getElementById('status').textContent, kind: document.getElementById('kind').textContent, team: document.getElementById('team').textContent, sid: document.getElementById('sid').textContent, hidden: document.getElementById('cfg').hidden, uuid: window.brxUtility.stationUuid(), ids: document.getElementById('ids').textContent }));
    await pg.reload(); await pg.waitForTimeout(1500); const s3 = await pg.evaluate(() => ({ armed: document.getElementById('armed').textContent, status: document.getElementById('status').textContent, ids: document.getElementById('ids').textContent })); await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); } catch {} }); await pg.close();
    must(perr.length === 0, perr.join('|')); must(s1 === 'NOT ARMED BY MISSION CONTROL', 'before: ' + s1);
    must(s2.armed === 'MC-ARMED · GAME 3' && s2.status === 'LIVE' && s2.kind === 'BOMB SITE' && s2.team === 'RED' && s2.sid === 'STATION 4' && s2.hidden && /-0400-/.test(s2.uuid) && s2.ids === 'VALID IDS: 4, 7', 'after push: ' + JSON.stringify(s2));
    must(s3.ids === 'VALID IDS: 4, 7', 'valid ids survive reload: ' + JSON.stringify(s3));
    must(s3.armed === 'MC-ARMED · GAME 3' && s3.status === 'LIVE', 'after reload: ' + JSON.stringify(s3));
  });
  // ---- K1: the control point, on the real screen. Every assertion below is what a PERSON SEES (rendered
  // text, a painted bar width) driven through the REAL presence path — the stage's fake player phones, whose
  // RSSI these steps pin so presence is deterministic instead of drifting. Presence is NOT instant (EMA α
  // 0.35 + 0.8 s dwell + 6 dB hysteresis ≈ 1-1.5 s either way), so these steps WAIT FOR the screen to reach
  // a state rather than sleeping a guessed number of milliseconds — a fixed sleep here read the screen
  // mid-walk and made four of these assertions wrong the first time round.
  const FAR = -95, ON = -50;
  const cread = pg => pg.evaluate(() => {
    const fill = document.getElementById('cfill').getBoundingClientRect(), bar = document.getElementById('cbar').getBoundingClientRect();
    return { shown: !document.getElementById('control').hidden, kind: document.getElementById('kind').textContent,
      team: document.getElementById('team').textContent, owner: document.getElementById('cowner').textContent,
      pct: document.getElementById('cpct').textContent, net: document.getElementById('cnet').textContent,
      eta: document.getElementById('ceta').textContent, banner: document.getElementById('cbanner').textContent,
      warn: document.getElementById('cwarn').textContent, title: document.getElementById('ptitle').textContent,
      rate: document.getElementById('crate').textContent, tally: document.getElementById('ctally').textContent,
      flash: document.getElementById('cflash').hidden ? '' : document.getElementById('cflash').textContent,
      arrow: document.getElementById('carrow').hidden ? '' : document.getElementById('carrow').textContent,
      arrowAt: document.getElementById('carrow').hidden ? null : Math.round(100 * (document.getElementById('carrow').getBoundingClientRect().left - bar.left) / bar.width),
      marks: { claim: document.querySelectorAll('#players .row.claim').length, dead: document.querySelectorAll('#players .row.dead').length, far: document.querySelectorAll('#players .row.far').length },
      // the row of whoever is actually ON the point, and how it is marked — the per-row assertion the
      // totals above cannot make
      onPointRow: (r => r ? { cls: r.className.replace('row ', ''), struck: getComputedStyle(r).textDecorationLine.includes('line-through') } : null)(
        [...document.querySelectorAll('#players .row')].find(r => (r.querySelector('.pres') || {}).textContent === 'ON POINT')),
      cstate: document.documentElement.getAttribute('data-cstate'), dteam: document.documentElement.getAttribute('data-team'),
      painted: Math.round(100 * fill.width / bar.width), claims: document.querySelectorAll('#players .row.claim').length,
      revives: document.getElementById('revives').textContent,
      wire: (h => { const b = i => parseInt(h.slice(i * 2, i * 2 + 2), 16); return { kind: b(8), team: b(9), state: b(10), value: b(11), seq: b(12) }; })(window.brxUtility.stationUuid().replace(/-/g, '')) };
  });
  /** Poll the rendered screen until `pred(reading)`, or throw with the last thing seen. */
  const untilC = async (pg, pred, ms, why) => {
    const t0 = Date.now(); let last;
    while (Date.now() - t0 < ms) { last = await cread(pg); if (pred(last)) return last; await pg.waitForTimeout(150); }
    throw new Error(`${why}: never reached in ${ms} ms; last = ${JSON.stringify(last)}`);
  };
  const pinFakes = (pg, at) => pg.evaluate(a => window.brxUtilityFake.forEach((f, i) => { f.rssi = () => a[i]; }), at);
  /** A utility phone on the stage, switched to CONTROL POINT and started, with a pinned fake roster.
   *  `at` is the RSSI each of the four stage phones sits at: [P7 blue, P19 tid-2, P23 blue, P31 red]. */
  // A utility phone stands at a control point in PORTRAIT, so these steps do not use the landscape HUD
  // viewports above -- but they were pinned to one hardcoded 411x891 and ran at that same size in both
  // VIEWS passes, so "two viewports" bought nothing and the target device was never rendered at all.
  // `pixel` is now Pixel 4, the match-day phone; `se` is a smaller Android, where clipping shows first.
  const CP_VP = view.name === 'pixel' ? { width: 393, height: 830 } : { width: 360, height: 740 };
  const utilPage = async (at = [ON, FAR, FAR, FAR], mutate = null) => {
    const pg = await b.newPage({ viewport: CP_VP }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
    await pg.goto('http://127.0.0.1:4192/utility.html?stage'); await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); localStorage.removeItem('brx.station.control'); } catch {} }); await pg.reload();
    await pg.waitForFunction(() => !!window.brxUtilityFake, null, { timeout: 8000 });
    await pinFakes(pg, at); if (mutate) await pg.evaluate(mutate);
    for (let i = 0; i < 7; i++) await pg.click('#info');
    await pg.click('[data-kind="control"]'); await pg.click('#btnStart'); await pg.click('#cfgClose'); await pg.waitForTimeout(200);
    return { pg, perr };
  };
  const done = async (pg, perr) => { await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); localStorage.removeItem('brx.station.control'); } catch {} }); await pg.close(); must(perr.length === 0, perr.join('|')); };

  await step(`${view.name} #52 control point: a lone attacker converts it, and the screen says who, which way and how long`, async () => {
    const { pg, perr } = await utilPage();
    const a = await cread(pg);
    must(a.shown && a.kind === 'CONTROL POINT' && a.team === 'NEUTRAL' && a.title === 'WHO IS ON THE POINT', 'fresh point: ' + JSON.stringify(a));
    must(a.revives === '', 'a control point does not show a revive tally');
    const mid = await untilC(pg, r => parseInt(r.pct, 10) >= 20 && parseInt(r.pct, 10) <= 70, 12000, 'mid-conversion');
    must(/BLUE IS TAKING IT/.test(mid.owner) && mid.cstate === 'rising', 'owner + direction: ' + JSON.stringify(mid));
    must(/BLUE TAKES IT IN \d+ S/.test(mid.eta), 'the eta says how long: ' + mid.eta);
    must(/^BLU 1 → \+1 BLU$/.test(mid.net), 'net line: ' + mid.net);
    must(Math.abs(mid.painted - parseInt(mid.pct, 10)) <= 6, `the painted bar matches the number (${mid.painted}% vs ${mid.pct})`);
    must(mid.claims === 1, 'exactly one body is converting it, got ' + mid.claims);
    must(mid.rate === '▶ BLUE ×1', 'the rate reads as a direction and a multiplier: ' + mid.rate);
    must(mid.arrow === '▶' && Math.abs(mid.arrowAt - parseInt(mid.pct, 10)) <= 6, `the arrow rides the moving edge (at ${mid.arrowAt}% for ${mid.pct})`);
    must(mid.wire.kind === 5 && mid.wire.team === 1 && (mid.wire.state & 1) === 0 && mid.wire.value > 0,
      'mid-conversion the advert says BLUE is at N% and holds NOTHING: ' + JSON.stringify(mid.wire));
    const held = await untilC(pg, r => r.team === 'BLUE', 14000, 'capture');
    must(held.pct === '100%' && held.painted >= 96, 'captured: ' + JSON.stringify(held));
    must(held.owner === 'HELD' && held.cstate === 'held' && held.dteam === 'blue' && held.eta === '', 'held state: ' + JSON.stringify(held));
    must(held.flash === 'CAPTURED BY BLUE', 'the crossing throws a full-screen word: ' + JSON.stringify(held.flash));
    must(held.rate === 'STALLED' || /▶ BLUE/.test(held.rate), 'rate line at 100%: ' + held.rate);
    must(held.wire.kind === 5 && held.wire.team === 1 && (held.wire.state & 1) === 1 && held.wire.value === 100 && held.wire.seq > 1,
      'and the advert now says BLUE HOLDS it, at a bumped seq: ' + JSON.stringify(held.wire));
    await pg.screenshot({ path: `${OUT}/${view.name}-control-held.png` });
    // the flash is one-shot: it clears itself, and the possession tally takes over (§5d.4)
    const after = await untilC(pg, r => r.flash === '', 5000, 'the flash clears itself');
    must(/^HELD · BLU \d+:\d\d$/.test(after.tally), 'and the screen becomes the recap sheet: ' + JSON.stringify(after.tally));
    await done(pg, perr);
  });

  await step(`${view.name} #53 control point: an even fight reads CONTESTED and stalls, and clearing it resumes`, async () => {
    const { pg, perr } = await utilPage();
    await untilC(pg, r => parseInt(r.pct, 10) >= 15, 12000, 'the push starts');
    await pinFakes(pg, [ON, FAR, FAR, ON]);                       // P31 RED walks onto the point: 1 v 1
    const c = await untilC(pg, r => r.banner === 'CONTESTED', 8000, 'contested');
    must(c.cstate === 'contested' && /^(RED 1 · BLU 1|BLU 1 · RED 1) → STALLED$/.test(c.net), 'the net line: ' + JSON.stringify(c.net));
    must(c.rate === 'STALLED' && c.arrow === '', 'at net 0 the arrow is replaced by STALLED: ' + JSON.stringify(c));
    must(c.eta === '' && c.claims === 2, 'a stalemate has no eta, and both bodies count: ' + JSON.stringify(c));
    must((c.wire.state & 2) === 2, 'and the contest goes out on the wire (byte 10 bit 1): ' + JSON.stringify(c.wire));
    await pg.screenshot({ path: `${OUT}/${view.name}-control-contested.png` });
    const held = parseInt(c.pct, 10);
    await pg.waitForTimeout(3000);
    const still = await cread(pg);
    must(Math.abs(parseInt(still.pct, 10) - held) <= 2, `1 v 1 nets zero: ${held}% -> ${still.pct} after 3 s`);
    must(still.banner === 'CONTESTED', 'and it is still contested');
    // the positive half: RED leaves and the SAME screen starts moving again
    await pinFakes(pg, [ON, FAR, FAR, FAR]);
    const back = await untilC(pg, r => r.cstate === 'rising' && parseInt(r.pct, 10) > held + 8, 8000, 'resumed');
    must(back.banner === '', 'and the CONTESTED banner clears: ' + JSON.stringify(back));
    await done(pg, perr);
  });

  await step(`${view.name} #54 control point: a two-phase steal drains to NEUTRAL on screen before it flips`, async () => {
    // capture_s is the knob (§5d.1); `rate` is a derived getter and assigning it does nothing at all.
    const { pg, perr } = await utilPage([ON, FAR, FAR, FAR], () => { window.brxUtility.settings.captureS = 4; window.brxUtility.point.captureS = 4; });
    await untilC(pg, r => r.team === 'BLUE', 12000, 'BLUE takes it');
    await pinFakes(pg, [FAR, FAR, FAR, ON]);                      // BLUE leaves, RED arrives
    const mid = await untilC(pg, r => r.cstate === 'falling', 8000, 'the drain starts');
    must(mid.team === 'BLUE' && mid.owner === 'LOSING IT', 'mid-drain it is STILL blue: ' + JSON.stringify(mid));
    must(/LOST IN \d+ S/.test(mid.eta), 'and the screen says how long: ' + mid.eta);
    must(parseInt(mid.pct, 10) < 100 && (mid.wire.state & 1) === 1, 'draining, not flipped: ' + JSON.stringify(mid));
    await pg.screenshot({ path: `${OUT}/${view.name}-control-losing.png` });
    const neu = await untilC(pg, r => r.team === 'NEUTRAL', 9000, 'it goes neutral');
    must(/RED IS TAKING IT/.test(neu.owner) && (neu.wire.state & 1) === 0, 'through neutral, nobody holding: ' + JSON.stringify(neu));
    must(neu.flash === 'NEUTRAL', 'the drain completing throws its own word: ' + JSON.stringify(neu.flash));
    must(neu.arrow === '▶' && /▶ RED/.test(neu.rate), 'and the arrow already points RED`s way: ' + JSON.stringify(neu));
    const red = await untilC(pg, r => r.team === 'RED', 9000, 'and only then RED');
    must(red.dteam === 'red' && red.pct === '100%' && red.wire.team === 0 && (red.wire.state & 1) === 1, 'RED holds it: ' + JSON.stringify(red));
    await done(pg, perr);
  });

  await step(`${view.name} #55 control point: a DOWN body on the point converts nothing, and a tid-2 body is refused out loud`, async () => {
    // The only body on the point is DOWN from the start, so "0%" cannot be progress that merely stopped.
    const { pg, perr } = await utilPage([ON, FAR, FAR, FAR], () => { window.brxUtilityFake[0].alive = false; });
    await pg.waitForTimeout(3500);
    const d = await cread(pg);
    must(d.pct === '0%' && d.painted <= 2 && d.owner === 'NOBODY HOLDS IT', 'a DOWN body converts nothing: ' + JSON.stringify(d));
    must(d.claims === 0 && /NOBODY ON THE POINT/.test(d.net), 'and it is not counted: ' + JSON.stringify(d));
    must(await pg.evaluate(() => !!document.querySelector('#players .row .state.down')), 'though it IS on screen, as DOWN');
    must(d.marks.claim === 0, 'nobody is counted: ' + JSON.stringify(d.marks));
    must(d.onPointRow && d.onPointRow.struck && /dead/.test(d.onPointRow.cls) && !/claim/.test(d.onPointRow.cls),
      'the body ON the point is struck through and not counted: ' + JSON.stringify(d.onPointRow));
    must(d.marks.far === 3, 'and the three out-of-range phones are dimmed (one of them also down, so the marks compose): ' + JSON.stringify(d.marks));
    // the positive half: the SAME body back on its feet converts the SAME point
    await pg.evaluate(() => { window.brxUtilityFake[0].alive = true; });
    await untilC(pg, r => parseInt(r.pct, 10) > 8, 8000, 'the same player alive converts');
    // F82: tid 2 standing on it is refused, and the operator is told why
    await pg.evaluate(() => { window.brxUtilityFake[1].alive = true; });
    await pinFakes(pg, [FAR, ON, FAR, FAR]);
    const y = await untilC(pg, r => /TEAM 2 CAN NEVER HOLD A POINT/.test(r.warn), 8000, 'the F82 warning');
    must(y.claims === 0 && y.team !== 'YELLOW' && !/YELLOW/.test(y.owner), 'and tid 2 gets nothing: ' + JSON.stringify(y));
    must(y.wire.team !== 2, 'nor can the advert ever name team 2: ' + JSON.stringify(y.wire));
    const frozen = parseInt(y.pct, 10);
    await pg.waitForTimeout(3000);
    must(parseInt((await cread(pg)).pct, 10) === frozen, 'a tid-2 body on the point moves the bar not at all');
    // ...and the ROSTER has to agree with the bar. A refused body read exactly like a contributing one --
    // highlighted row, green "ON POINT" -- while two lines above it the net line said NOBODY ON THE POINT.
    // A down body is struck through; a refused one had no mark at all, so the same screen said both things.
    const refusedRow = await pg.evaluate(() => {
      const r = [...document.querySelectorAll('#players .row')].find(x => /YELLOW/.test(x.textContent));
      if (!r) return null;
      const p = r.querySelector('.pres');
      return { cls: r.className.replace('row ', ''), pres: p.textContent.trim(), color: getComputedStyle(p).color, px: parseFloat(getComputedStyle(p).fontSize), clipped: p.scrollWidth > p.clientWidth + 1 };
    });
    must(refusedRow, 'the tid-2 body is on the roster at all');
    must(refusedRow.pres !== 'ON POINT',
      `the roster must not call a refused body a contributor while the net line says NOBODY ON THE POINT: ${JSON.stringify(refusedRow)}`);
    must(/CAN.T HOLD|REFUSED|NOT COUNTED/i.test(refusedRow.pres), 'it says what it is instead: ' + JSON.stringify(refusedRow));
    must(refusedRow.px >= 11, 'and legibly: ' + refusedRow.px + 'px');
    must(!refusedRow.clipped, '.pres is overflow:hidden, so a word too long for its column disappears silently: ' + JSON.stringify(refusedRow));
    await pg.screenshot({ path: `${OUT}/${view.name}-control-refused.png` });
    await done(pg, perr);
  });

  await step(`${view.name} #56 control point: the owner and the progress survive a reload, and every control does something`, async () => {
    const { pg, perr } = await utilPage();
    const mid = await untilC(pg, r => parseInt(r.pct, 10) >= 30 && parseInt(r.pct, 10) <= 80, 12000, 'part way through');
    await pinFakes(pg, [FAR, FAR, FAR, FAR]);                     // everyone walks off, so nothing moves across the reload
    await pg.waitForTimeout(1500);
    const parked = parseInt((await cread(pg)).pct, 10);
    must(parked >= 30, 'precondition: parked part way through, got ' + parked);
    await pg.reload();
    // `seedDemo` re-seeds the fake roster on every load, so re-pin the INSTANT it exists: presence needs
    // ~1 s of dwell to establish, so pinning here means zero conversion happens across the restart and the
    // number below is genuinely the restored one and not a fresh push.
    await pg.waitForFunction(() => !!window.brxUtilityFake, null, { timeout: 8000 });
    await pinFakes(pg, [FAR, FAR, FAR, FAR]);
    await pg.waitForTimeout(1200);
    const back = await cread(pg);
    must(back.shown && Math.abs(parseInt(back.pct, 10) - parked) <= 2, `progress survived the restart: ${parked}% -> ${back.pct}`);
    must(back.painted >= parked - 3, `and the bar is painted to match (${back.painted}% vs ${back.pct})`);
    must(back.wire.kind === 5 && back.wire.value === parseInt(back.pct, 10), 'and it comes back up advertising it: ' + JSON.stringify(back.wire));
    // every control on the new panel changes something a person can see
    for (let i = 0; i < 7; i++) await pg.click('#info');
    const cap = async () => pg.evaluate(() => [document.getElementById('capS').textContent, document.getElementById('netCap').textContent]);
    const c0 = await cap();
    await pg.click('#capMinus'); await pg.click('#capMinus');
    const c1 = await cap();
    await pg.click('#capPlus'); await pg.click('#capPlus2'); await pg.click('#capMinus2'); await pg.click('#capMinus2');
    const c2 = await cap();
    must(c0[0] === '10 S' && c0[1] === '3', 'the labelled defaults: ' + JSON.stringify(c0));
    must(c1[0] === '8 S' && c2[0] === '9 S', `the capture-time control: ${c1[0]} / ${c2[0]}`);
    must(c2[1] === '2', 'the net-cap control: ' + c2[1]);
    // and the point state lives under its own key (§5d.6), not inside the operator's settings
    const keys = await pg.evaluate(() => ({ ctl: JSON.parse(localStorage.getItem('brx.station.control') || 'null'), set: JSON.parse(localStorage.getItem('brx.utility') || '{}') }));
    must(keys.ctl && Number.isFinite(keys.ctl.progress) && Number.isFinite(keys.ctl.seq) && Array.isArray(keys.ctl.log),
      'brx.station.control carries the model, seq and the capture log: ' + JSON.stringify(keys.ctl));
    must(keys.set.control === undefined && keys.set.captureS != null, 'and the settings key holds settings only: ' + JSON.stringify(keys.set));
    must(await pg.evaluate(() => !document.getElementById('teamnote').hidden), 'the TEAM panel says it does not apply to a control point');
    await pg.click('#btnPointReset'); await pg.waitForTimeout(500);
    const reset = await cread(pg);
    must(reset.pct === '0%' && reset.painted <= 3 && reset.team === 'NEUTRAL', 'RESET POINT TO NEUTRAL: ' + JSON.stringify(reset));
    // and switching kind away puts the respawn screen back
    await pg.click('[data-kind="respawn"]'); await pg.waitForTimeout(300);
    const resp = await pg.evaluate(() => ({ hidden: document.getElementById('control').hidden, kind: document.getElementById('kind').textContent, team: document.getElementById('team').textContent, note: document.getElementById('teamnote').hidden, title: document.getElementById('ptitle').textContent }));
    must(resp.hidden && resp.kind === 'RESPAWN STATION' && resp.team === 'BLUE' && resp.note && resp.title === 'PLAYER PHONES IN RANGE', 'back to respawn: ' + JSON.stringify(resp));
    await done(pg, perr);
  });

  // The crossing flash is the one thing on this screen that can HIDE the screen. §5d.4 asks for a
  // "full-width flash", and `#cflash` is `position:fixed; inset:0` -- but it lived inside `.hero`, which
  // is `transform: skewX(-4deg)`, and a transform makes an element the containing block for its fixed
  // descendants. So `inset:0` resolved to the HERO box: a skewed 323x196 patch sitting exactly on the
  // capture bar and the `LOST IN n S` countdown, for its full 2.6 s. A capture that is contested a second
  // later -- the normal case -- covered the one line a defender reads to decide whether to run.
  // Nothing caught it because every other assertion in this file reads `textContent` and `hidden`, which
  // are blind to where a box actually is and what it sits on top of.
  await step(`${view.name} #57 control point: the crossing flash is full-bleed and never covers the bar or the countdown`, async () => {
    const { pg, perr } = await utilPage([ON, FAR, FAR, FAR], () => { window.brxUtility.settings.captureS = 4; window.brxUtility.point.captureS = 4; });
    await untilC(pg, r => r.team === 'BLUE', 14000, 'BLUE takes it');
    const up = await pg.evaluate(() => !document.getElementById('cflash').hidden);
    must(up, 'precondition: the capture threw its flash');
    // `.cflash.go` scales 1.3 -> 1 over the first 8% of 2.6 s, so a getBoundingClientRect sampled during the
    // pop measures the animation, not the layout. Size and fit are read off the LAYOUT box (offsetWidth /
    // scrollWidth), which a transform does not touch; the overlap checks wait for the pop to finish.
    const geo = () => pg.evaluate(() => {
      const r = e => { const b = document.getElementById(e).getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
      const ov = (a, z) => !(a.right <= z.x || a.x >= z.right || a.bottom <= z.y || a.y >= z.bottom);
      const wash = document.getElementById('cflash'), w = document.getElementById('cflashw');
      const word = r('cflashw'), bar = r('cbar'), eta = r('ceta');
      // a fixed element's containing block is the viewport MINUS classic scrollbars, and this harness runs
      // with them on (ignoreDefaultArgs --hide-scrollbars), so innerWidth overstates it by 15px
      const de = document.documentElement;
      return { vp: { w: de.clientWidth, h: de.clientHeight, inner: innerWidth }, layout: { w: wash.offsetWidth, h: wash.offsetHeight }, wash: r('cflash'), word, bar, eta,
        wordOverBar: ov(word, bar), wordOverEta: ov(word, eta),
        clipped: w.scrollWidth > w.clientWidth + 1 };   // a word wider than its own box is a word nobody can read
    });
    await pg.waitForTimeout(450);                       // let the pop settle, then measure the screen as it stands
    const g = await geo();
    must(g.layout.w >= g.vp.w - 1 && g.layout.h >= g.vp.h - 1,
      `the flash is FULL-BLEED, not a patch inside the hero: ${g.layout.w}x${g.layout.h} on a ${g.vp.w}x${g.vp.h} screen`);
    must(!g.clipped, `the word fits the screen: ${JSON.stringify(g.word)} on ${g.vp.w}px`);
    must(!g.wordOverBar, `the flash word does not sit on the capture bar: word ${JSON.stringify(g.word)} vs bar ${JSON.stringify(g.bar)}`);
    // and the live half of it: put an enemy on the point WHILE the flash is up, so the screen is telling
    // the defender he is losing it at the same moment it is celebrating the capture
    await pinFakes(pg, [FAR, FAR, FAR, ON]);
    const losing = await untilC(pg, r => r.cstate === 'falling' && /LOST IN \d+ S/.test(r.eta), 8000, 'the drain starts');
    const g2 = await geo();
    const stillUp = await pg.evaluate(() => !document.getElementById('cflash').hidden);
    await pg.screenshot({ path: `${OUT}/${view.name}-control-flash-vs-countdown.png` });
    must(stillUp, 'precondition: the capture flash is STILL up while the point drains (that is the whole bug)');
    must(!g2.wordOverEta, `"${losing.eta}" is not covered by "${await pg.evaluate(() => document.getElementById('cflashw').textContent)}": eta ${JSON.stringify(g2.eta)} vs word ${JSON.stringify(g2.word)}`);
    must(!g2.wordOverBar, `nor is the bar: bar ${JSON.stringify(g2.bar)} vs word ${JSON.stringify(g2.word)}`);
    await done(pg, perr);
  });

  // The threshold slider is how the operator calibrates "at the station" -- the primary control of the
  // whole config drawer -- and a bare `input[type=range]` is 16px tall on a phone.
  await step(`${view.name} #58 utility: no undersized tap target, and the roster's meaning-bearing text is >= 11px`, async () => {
    const { pg, perr } = await utilPage();
    for (let i = 0; i < 7; i++) await pg.click('#info');
    await pg.waitForTimeout(250);
    const a = await pg.evaluate(() => {
      const small = [];
      for (const el of document.querySelectorAll('button,[role=button],input,select')) {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (r.height < 36 || r.width < 36) small.push(`${el.id || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return { small, pres: parseFloat(getComputedStyle(document.querySelector('#players .pres')).fontSize) };
    });
    must(a.small.length === 0, 'undersized tap targets: ' + JSON.stringify(a.small));
    must(a.pres >= 11, `"ON POINT" is the roster's readout of who is converting, so it is legible: ${a.pres}px`);
    await done(pg, perr);
  });

  await step(`${view.name} #50 a live rejoin shows the RECONCILING takeover for 3 s, then clears with no prompt`, async () => {
    const pg = await open(view, 'resync', '', 3900); const r = await pg.evaluate(() => { const m = document.querySelector('.mo.reconciling'); return { up: !!m, t: m ? m.querySelector('.t').textContent : null, k: m ? m.querySelector('.k').textContent : null, rec: window.brx.engine.state().reconciling, prompt: !!document.querySelector('.prompt'), chips: getComputedStyle(document.getElementById('chips')).opacity }; });
    await pg.waitForTimeout(3200); const r2 = await pg.evaluate(() => ({ up: !!document.querySelector('.mo.reconciling'), rec: window.brx.engine.state().reconciling, alive: window.brx.engine.state().alive, prompt: !!document.querySelector('.prompt') })); await pg.close();
    if (r.rec == null) { console.log('       (engine without reconciling — step skipped)'); return; }
    must(r.up && r.rec && r.t === 'SYNCING WITH YOUR GUN' && r.k === 'GUN RELINKED' && !r.prompt && r.chips === '0', 'during: ' + JSON.stringify(r)); must(!r2.up && !r2.rec && r2.alive && !r2.prompt, 'after: ' + JSON.stringify(r2));
  });
  await step(`${view.name} #51 result: the tally is this MC session's games, not the phone's lifetime`, async () => {
    const pg = await b.newPage({ viewport: { width: view.width, height: view.height } }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
    await pg.goto('http://127.0.0.1:4192/?demo&stage=idle'); await pg.waitForTimeout(500);
    await pg.evaluate(() => localStorage.setItem('brx.history', JSON.stringify([{ session: 'A', kills: 3, deaths: 1 }, { session: 'A', kills: 2, deaths: 2 }, { session: 'B', kills: 9, deaths: 0 }, { kills: 5, deaths: 5 }])));
    await pg.goto('http://127.0.0.1:4192/?demo&stage=result'); await pg.waitForTimeout(1200); await pg.evaluate(() => { window.brx.hud.sessionId = 'A'; }); await pg.waitForTimeout(3200);
    const r = await pg.evaluate(() => ({ line: (document.querySelector('.result .sess') || {}).textContent || '', n: window.brx.hud.history.length }));
    await pg.evaluate(() => { window.brx.hud.sessionId = null; window.brx.engine.ackEnd(); }); await pg.waitForTimeout(300);
    const r2 = await pg.evaluate(() => { window.brx.hud.sessionId = null; return window.brx.hud.history.filter(g => g.session === 'A').length; });
    await pg.evaluate(() => localStorage.removeItem('brx.history')); await pg.close();
    must(perr.length === 0, perr.join('|')); must(r.line === 'THIS SESSION · 2 GAMES · 5 KILLS · 3 DEATHS', 'tally: ' + JSON.stringify(r)); must(r2 === 2, 'entries kept');
  });
  await step(`${view.name} #17 resync prompt: label over instruction, each on one line`, async () => { const pg = await open(view, 'resync-prompt'); const r = [...await oneLine(pg, '.prompt .pl'), ...await oneLine(pg, '.prompt .pi')]; const stack = await pg.evaluate(() => document.querySelector('.prompt .pl').getBoundingClientRect().bottom <= document.querySelector('.prompt .pi').getBoundingClientRect().top + 1); await pg.close(); must(r.length === 2 && r.every(x => x[2]), JSON.stringify(r)); must(r[0][1] === 'GUN RELINKED' && r[1][1] === 'PULL THE TRIGGER', 'copy'); must(stack, 'label is not above the instruction'); });
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
  await step(`${view.name} #22 the post-match button is one line, plates intact`, async () => { const pg = await open(view, 'over'); const r = await oneLine(pg, '.foot .ready'); must(r.length === 1, 'no post-match button'); const btn = await pg.evaluate(() => document.querySelector('.foot .ready').textContent.trim()); await pg.close(); must(btn === 'READY FOR NEXT MATCH \u25b8', 'button copy: ' + btn); must(r.every(x => x[2]), JSON.stringify(r)); });   // F117 2026-09-11: was "MATCH COMPLETE", which read as a status line

  // ---------- 2026-09-11 field session, Block A (docs/game-test-2026-09-11.md) ----------
  await step(`${view.name} F110 briefing: the title and the description are not sheared by their box`, async () => {
    const sels = ['.bfname', '.bfdesc', '.bfk', '.bfrules', '.bfload'];
    const pg = await open(view, 'briefing'); const r = await sheared(pg, sels); await pg.close();
    notSheared(r, sels);
  });
  await step(`${view.name} F110 briefing: the body never reaches the CTA footer`, async () => {
    // Driven with the LONG payload, not the demo's one short line of each: against the demo payload this step
    // passed on the CSS that shipped the bug, which makes it a tautology. A host writes the name, the ruleset
    // and the loadout line, and a two-line name over a wrapped loadout line is what ran into the footer.
    const pg = await open(view, 'briefing-long');
    const r = await pg.evaluate(() => { const b = document.querySelector('.bfbody'), f = document.querySelector('.bffoot');
      const R = e => e.getBoundingClientRect(); const ft = R(f);
      const hit = a => a.left < ft.right - 2 && a.right > ft.left + 2 && a.top < ft.bottom - 2 && a.bottom > ft.top + 2;
      return { over: b.scrollHeight > b.clientHeight + 1, name: document.querySelector('.bfname').textContent,
               onFoot: Array.from(b.children).filter(e => hit(R(e))).map(e => e.className.split(' ')[0]),
               last: Math.max(...Array.from(b.children).map(e => R(e).bottom)), footTop: ft.top }; });
    await pg.close();
    must(/THUNDERDOME/.test(r.name), 'the long payload never reached the screen: ' + r.name);
    must(r.onFoot.length === 0, 'briefing rows sit on top of the CTA footer: ' + r.onFoot.join(','));
    must(!r.over, 'the briefing body overflows its own box: ' + JSON.stringify(r));
    must(r.last <= r.footTop - 4, `the last briefing row runs into the footer: ${Math.round(r.last)} > ${Math.round(r.footTop)}`);
  });
  await step(`${view.name} F117 over: READY FOR NEXT MATCH is a control, styled like READY UP`, async () => {
    const read = pg => pg.evaluate(() => { const e = document.querySelector('.foot .ready'); const cs = getComputedStyle(e);
      return { txt: e.textContent.trim(), act: e.dataset.act || null, color: cs.color, fs: cs.fontSize, wait: e.classList.contains('wait'), clipped: e.scrollWidth > e.clientWidth + 1 }; });
    const a = await open(view, 'kitted'); const kitted = await read(a); await a.close();
    const b2 = await open(view, 'over'); const over = await read(b2); await b2.close();
    must(over.act === 'onReady', 'the post-match button is not wired: ' + JSON.stringify(over));
    must(/READY/.test(over.txt) && over.txt !== 'MATCH COMPLETE', 'the label still states a fact instead of asking for a tap: ' + over.txt);
    must(!over.wait, 'the post-match button wears `.wait`, the INERT button\'s own class: ' + JSON.stringify(over));
    must(over.color === kitted.color && over.fs === kitted.fs, `post-match control reads dimmer/smaller than the pre-match one: ${JSON.stringify(over)} vs ${JSON.stringify(kitted)}`);
    must(!over.clipped, 'the label is clipped: ' + JSON.stringify(over));
  });
  await step(`${view.name} F117 .wait dresses the genuinely inert button and nothing else`, async () => {
    const seen = [];
    for (const stage of ['lobby', 'over', 'kitted']) { const pg = await open(view, stage); seen.push(...await pg.evaluate(s => Array.from(document.querySelectorAll('.ready.wait')).map(e => [s, e.textContent.trim(), e.dataset.act || null]), stage)); await pg.close(); }
    must(seen.length > 0, 'no inert button found on any screen — has STANDING BY moved?');
    must(seen.every(x => x[2] === null), 'a real control is dressed as the inert one: ' + JSON.stringify(seen));
  });
  await step(`${view.name} F122 diag: SHARE LOG is reachable without scrolling`, async () => {
    const pg = await open(view, 'diag-live', '', 5200);
    const r = await pg.evaluate(() => { const d = document.getElementById('diag'), s = document.querySelector('[data-act="onShareLog"]');
      if (!d.classList.contains('open')) return { open: false }; if (!s) return { open: true, share: false };
      const rb = s.getBoundingClientRect(), rd = d.getBoundingClientRect(); const hit = document.elementFromPoint(rb.x + rb.width / 2, rb.y + rb.height / 2);
      const sc = parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1) || 1;   // the #frame is scaled: tap targets are judged in DESIGN px, as step #23 does
      const f = d.querySelector('.btns'), tops = new Set(Array.from(f.children).map(e => Math.round(e.getBoundingClientRect().top)));
      const last = f.children[f.children.length - 1].getBoundingClientRect();   // the row is right-aligned: the LAST child is the one that runs off
      return { open: true, share: true, inside: rb.bottom <= rd.bottom + 1 && rb.top >= rd.top - 1, topmost: hit === s, h: rb.height / sc,
               rightIn: last.right <= rd.right + 1 && last.left >= rd.left - 1, over: Math.round(last.right - rd.right),
               rows: tops.size, footH: f.getBoundingClientRect().height / sc, scroller: d.scrollHeight > d.clientHeight + 1 }; });
    await pg.close();
    must(r.open && r.share, 'no diagnostics panel / no SHARE LOG: ' + JSON.stringify(r));
    must(r.inside, 'SHARE LOG is off the bottom of the panel — the operator has to scroll a growing log to reach it');
    // Vertical containment alone passed a row whose last button hung off the RIGHT edge: the panel does not
    // scroll sideways, so that button is simply unreachable at 390px (review 2026-09-12).
    must(r.rightIn, `the last action button is ${r.over}px past the right edge of the panel — nothing scrolls sideways, so it cannot be tapped`);
    must(r.topmost, 'something is on top of SHARE LOG');
    must(r.h >= 43.5, 'tap target ' + r.h.toFixed(1) + 'px (design px)');
    must(r.rows === 1, `the action row wraps to ${r.rows} rows — every extra row is taken from the log above it`);
    must(r.footH <= 56, `the action row is ${r.footH.toFixed(1)} design px of a 390px panel`);
  });
  await step(`${view.name} F122 diag: the reader's scroll position survives the render churn`, async () => {
    const pg = await open(view, 'diag-live', '', 5200);
    await pg.evaluate(() => { const b = document.getElementById('dbody') || document.getElementById('diag'); b.scrollTop = Math.round((b.scrollHeight - b.clientHeight) / 2); window.__st = b.scrollTop; });
    const before = await pg.evaluate(() => window.__st); must(before > 20, 'the panel does not scroll here, so this step proves nothing: ' + before);
    await pg.waitForTimeout(2000);   // app.js pushes fresh diag data every 250 ms
    const after = await pg.evaluate(() => (document.getElementById('dbody') || document.getElementById('diag')).scrollTop); await pg.close();
    must(Math.abs(after - before) <= 2, `scroll jumped ${before} -> ${after} under the render loop`);
  });
  await step(`${view.name} F122 diag: a press that straddles a re-render still fires SHARE LOG`, async () => {
    const pg = await open(view, 'diag-live', '', 5200);
    await pg.evaluate(() => { window.__n = 0; window.brx.hud.h.onShareLog = () => { window.__n++; }; });   // count the tap, never run the real share
    for (let i = 0; i < 4; i++) {
      const at = await pg.evaluate(() => { const r = document.querySelector('[data-act="onShareLog"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await pg.mouse.move(at.x, at.y); await pg.mouse.down(); await pg.waitForTimeout(400); await pg.mouse.up(); await pg.waitForTimeout(150);   // 400 ms spans at least one 250 ms render
    }
    const n = await pg.evaluate(() => window.__n); await pg.close();
    must(n === 4, `${n} of 4 presses became taps — a re-render destroyed the button under the finger`);
  });
  await step(`${view.name} F126 diag: text inflation is pinned off (WKWebView)`, async () => {
    const pg = await open(view, 'diag-live', '', 5200);
    const r = await pg.evaluate(() => ['html', 'body', '#diag'].map(s => [s, getComputedStyle(document.querySelector(s)).webkitTextSizeAdjust])); await pg.close();
    must(r.every(x => x[1] === '100%'), 'WKWebView will inflate this text: ' + JSON.stringify(r));
  });
  await step(`${view.name} F115 down: the countdown is the same width at every value`, async () => {
    const pg = await open(view, 'down', '', 5200);
    const r = await pg.evaluate(() => { const n = document.querySelector('.down .n'); if (!n) return null; const keep = n.innerHTML;
      const set = v => { n.innerHTML = String(v).split('').map(c => `<span class="d">${c}</span>`).join(''); };
      const w = {}; for (const v of ['11', '10', '09', '08', '88', '00']) { set(v); w[v] = +n.getBoundingClientRect().width.toFixed(2); }
      const clip = []; for (const c of '0123456789') { set(c); const d = n.querySelector('.d'); if (d.scrollWidth > d.clientWidth + 1) clip.push(c); }
      n.innerHTML = keep; return { w, clip, cells: n.querySelectorAll('.d').length }; });
    await pg.close();
    must(r, 'no DOWN countdown'); must(r.cells === 2, 'the countdown is not built from per-digit cells: ' + JSON.stringify(r));
    const ws = Object.values(r.w); must(Math.max(...ws) - Math.min(...ws) < 1, 'the digits re-lay-out on every tick: ' + JSON.stringify(r.w));
    must(r.clip.length === 0, 'digits clipped by their own cell: ' + r.clip.join(''));
  });
  await step(`${view.name} F115 down: the digits do not stand over the label under them`, async () => {
    const pg = await open(view, 'down', '', 5200);
    const r = await pg.evaluate(() => { const n = document.querySelector('.down .n'), l = document.querySelector('.down .lab'), rc = document.querySelector('.down .recap');
      const R = e => e.getBoundingClientRect(); return { grow: n.scrollHeight - n.clientHeight, nBottom: R(n).bottom, labTop: R(l).top, recapTop: rc ? R(rc).top : 1e9, labBottom: R(l).bottom }; });
    await pg.close();
    // `nBottom <= labTop` used to be asserted here and was a TAUTOLOGY: `.n` and `.lab` are siblings in the
    // `.dn` flex column, so their BOXES can never overlap however the glyphs paint. `grow` is the real F115
    // check — it measures the glyph box standing outside the element. The recap check is not a tautology:
    // `.down .c` is absolutely positioned, so it genuinely can land on `.recap`.
    must(r.labBottom <= r.recapTop + 1, 'the label runs into the recap');
    must(r.grow < 40, `the glyph box stands ${r.grow}px past the element — line-height is fighting the font (F115)`);
  });
  // ---------- 2026-09-12 review of the Block A diff ----------
  await step(`${view.name} F117 over: an UNSYNCED clock is explained under the button that refuses the tap`, async () => {
    const pg = await open(view, 'over');
    await pg.evaluate(() => { window.brx.engine.isSynced = () => false; window.brx.hud.render(window.brx.engine.state()); });
    await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => { const n = document.querySelector('.foot .note');
      return { note: n ? n.textContent.trim() : null, btn: document.querySelector('.foot .ready').textContent.trim(),
               took: window.brx.engine.setReady(true) }; });
    await pg.screenshot({ path: `${OUT}/${view.name}-over-unsynced.png` });
    await pg.close();
    must(/READY/.test(r.btn), 'this is not the post-match screen: ' + r.btn);
    must(r.took === false, 'setReady no longer refuses an unsynced clock — this step proves nothing');
    must(/[Ss]yncing/.test(r.note || ''), 'the button silently refuses and the note says nothing about it: ' + r.note);
  });
  await step(`${view.name} F122 diag: a reader at the tail of the LOG keeps following it as it grows`, async () => {
    // Chromium CLAMPS a scroller across an innerHTML replacement rather than resetting it, so a growing log
    // does not jump to the top — it drifts off the tail, which is the end a person reading a live log wants.
    const pg = await open(view, 'diag-live', '', 5200);
    const before = await pg.evaluate(() => { const h = window.brx.hud;
      window.__log = ((h.diagData && h.diagData.log) || []).concat(Array.from({ length: 80 }, (_, i) => 'log line ' + i));
      h.setDiag({ ...(h.diagData || {}), log: window.__log.slice() });
      const p = document.getElementById('dg-log');
      if (p.scrollHeight - p.clientHeight < 40) return null;
      p.scrollTop = p.scrollHeight;                                   // the reader is AT THE BOTTOM
      return { max: p.scrollHeight - p.clientHeight, top: p.scrollTop }; });
    must(before && before.top > 10, 'the LOG pre does not scroll here, so this step proves nothing: ' + JSON.stringify(before));
    const after = await pg.evaluate(() => { const h = window.brx.hud;
      for (let i = 0; i < 8; i++) { window.__log.push('grew ' + i); h.setDiag({ ...(h.diagData || {}), log: window.__log.slice() }); }
      const p = document.getElementById('dg-log');
      return { gap: p.scrollHeight - p.clientHeight - p.scrollTop }; });
    await pg.close();
    must(after.gap <= 4, `the reader was left ${Math.round(after.gap)}px behind the tail as the log grew`);
  });
  await step(`${view.name} F123 reload: past the nominal time the bar goes indeterminate, not "0.0S"`, async () => {
    // A chain weapon's `reloadTotalMs` is the PER-SHELL time, so the bar pinned at 100% and counted 0.0S for
    // most of the reload. Once overrun is up the countdown goes away and the bar pulses instead.
    const pg = await open(view, 'live-reload-overrun');
    const r = await pg.evaluate(() => { const mo = document.querySelector('.mo.reloading'); if (!mo) return { none: true };
      const n = mo.querySelector('.n'), bar = mo.querySelector('#rlbar'), t = mo.querySelector('.t');
      return { over: mo.classList.contains('over'), head: t.textContent.trim(), overrun: window.brx.engine.state().reloadOverrun,
               numShown: getComputedStyle(n).display !== 'none', num: n.textContent,
               anim: getComputedStyle(bar).animationName, width: bar.style.width }; });
    await pg.screenshot({ path: `${OUT}/${view.name}-live-reload-overrun.png` });
    await pg.close();
    must(!r.none, 'no RELOADING takeover on screen');
    must(r.over, 'the overrun treatment is not up: ' + JSON.stringify(r));
    must(!r.numShown, 'a wrong countdown is still on screen: "' + r.num + '"');
    must(r.head === 'RELOADING…', 'the headline does not say the wait is open-ended: ' + r.head);
    must(r.anim === 'rlpulse', 'the bar is not pulsing (it is pinned at a full, wrong 100%): ' + r.anim);
  });
  await step(`${view.name} F123 reload: a second reload in ONE BLE batch opens fresh, not on the last one's latch`, async () => {
    // The overrun treatment is LATCHED for the life of one takeover, and `_moment` could not tell two apart:
    // a $ALCD (fired) and a $BUT,2,1 arriving in ONE BLE batch end and re-open the takeover between two
    // renders, so the NEW reload opened already pulsing with its countdown gone — at a magazine that had
    // only just started moving (review 2026-09-12).
    const pg = await open(view, 'live-reload-overrun');
    const before = await pg.evaluate(() => !!document.querySelector('.mo.reloading.over'));
    must(before, 'the first reload is not in overrun here, so this step would prove nothing');
    const r = await pg.evaluate(async () => {
      const d = window.brxDemo; d.fire(1); d.reloadPull();      // ONE synchronous batch: no render between them
      await new Promise(res => setTimeout(res, 120));           // …and well inside the new reload's nominal time
      const mo = document.querySelector('.mo.reloading'); const st = window.brx.engine.state();
      return mo ? { over: mo.classList.contains('over'), head: mo.querySelector('.t').textContent.trim(),
                    engineOverrun: st.reloadOverrun, numShown: getComputedStyle(mo.querySelector('.n')).display !== 'none' }
                : { none: true, reloading: st.reloading };
    });
    await pg.close();
    must(!r.none, 'the second pull raised no takeover: ' + JSON.stringify(r));
    must(!r.engineOverrun, 'the new reload is genuinely in overrun already, so the class proves nothing: ' + JSON.stringify(r));
    must(!r.over, "the new reload opened on the OLD one's overrun latch: " + JSON.stringify(r));
    must(r.numShown && r.head === 'RELOADING', 'a reload that just started is dressed as an open-ended one: ' + JSON.stringify(r));
  });
  await step(`${view.name} F115 down: a three-digit countdown is clamped, never a third cell`, async () => {
    // `respawnIn` is a server number — a long penalty box, or a stalled clock, is not the HUD's to render as
    // a layout break. Three .56em cells at 170px do not fit the frame the countdown lives in.
    const pg = await open(view, 'down', '', 5200);
    const r = await pg.evaluate(async () => {
      const e = window.brx.engine, real = e.state.bind(e);
      e.state = () => ({ ...real(), respawnType: 'auto', respawnHint: 'timer', respawnIn: 120 });
      window.brx.hud.render(e.state());
      await new Promise(res => setTimeout(res, 150));
      const n = document.querySelector('.down .n');
      return n ? { cells: n.querySelectorAll('.d').length, text: n.textContent.trim() } : { none: true };
    });
    await pg.close();
    must(!r.none, 'no DOWN countdown');
    must(r.cells === 2, `respawnIn 120 rendered ${r.cells} cells ("${r.text}") — the frame holds two`);
    must(r.text === '99', 'the clamp shows the ceiling, not a truncated or wrapped value: ' + r.text);
  });
  await step(`${view.name} F117 over: the ready note promises no veto the player does not have`, async () => {
    // `state.py` `_on_ready` auto-advances ONLY in KIT (contracts §4.4): after a match the host pushes the
    // next one whenever they like. "the host cannot start until everyone has" is how somebody sits a round out.
    const pg = await open(view, 'over');
    const r = await pg.evaluate(() => ({ note: (document.querySelector('.foot .note') || { textContent: '' }).textContent.trim(),
                                         ready: window.brx.engine.state().ready }));
    await pg.close();
    must(!r.ready, 'this player is already readied, so the un-readied note is not the one on screen: ' + JSON.stringify(r));
    must(!/cannot start until/i.test(r.note), 'the note still promises a veto the player does not have: ' + r.note);
    must(/host sees who is ready/i.test(r.note), 'the note does not say what readying up actually does: ' + r.note);
  });
  // ================= A24 FINAL RESULTS / A31 verify-at-MC (game test 2026-09-11 D3, contracts A24/A31) =================
  // Every step below is about what a PERSON SEES on the results screen. The first one is the hard rule: the node
  // may not write win or lose from the absence of a message, so it is written as a NEGATIVE test that also proves
  // it can see the words it is looking for — an assertion that can never fail is not a guard.
  await step(`${view.name} A24 result-pending: NOTHING on screen reads as won or lost until MC says so`, async () => {
    const pg = await open(view, 'result-pending');
    const OUTCOME = /\b(WIN|WON|LOSE|LOST|DEFEAT|VICTORY|DRAW)\b/;
    const before = await text(pg);
    must(/RESULT PENDING/.test(before), 'the screen does not say the result is pending: ' + before.slice(0, 200));
    must(/CONFIRM AT MISSION CONTROL/.test(before), 'it does not say where the result comes from');
    must(!OUTCOME.test(before), 'an outcome word is on screen with NO result pushed: ' + (before.match(OUTCOME) || [])[0] + ' — ' + before.slice(0, 260));
    must(await pg.evaluate(() => window.brx.engine.state().result === null), 'the engine invented a result');
    // the same assertion, against a screen that SHOULD carry the word — proves the regex can fail this step
    await pg.evaluate(() => window.brxDemo.result('win')); await pg.waitForTimeout(400);
    const after = await text(pg);
    await pg.close();
    must(OUTCOME.test(after), 'the guard cannot see an outcome word even when one is pushed — it would never fail: ' + after.slice(0, 200));
    must(/\bWIN\b/.test(after), 'the pushed outcome is not the word on screen: ' + after.slice(0, 200));
  });
  await step(`${view.name} A24 result-unreached: 30 s with no MC link says MC NOT REACHED, never a loss`, async () => {
    const pg = await open(view, 'result-unreached');
    const t = await text(pg); const wait = await pg.evaluate(() => window.brx.engine.state().resultWait);
    await pg.close();
    must(wait === 'unreached', 'settle window state: ' + wait);
    must(/MC NOT REACHED/.test(t) && /SEE MISSION CONTROL/.test(t), 'copy: ' + t.slice(0, 200));
    must(!/\b(LOSE|LOST|DEFEAT)\b/.test(t), 'an unreachable MC was rendered as a defeat: ' + t.slice(0, 200));
  });
  await step(`${view.name} A24 result-pending: RETURN TO MISSION CONTROL is on screen and blinking`, async () => {
    const pg = await open(view, 'result-pending');
    const r = await pg.evaluate(() => { const e = document.querySelector('.result .retmc'); if (!e) return null;
      const cs = getComputedStyle(e); return { txt: e.textContent.trim(), anim: cs.animationName, dur: cs.animationDuration, fs: parseFloat(cs.fontSize) }; });
    const gone = await pg.evaluate(async () => { window.brxDemo.result('win'); await new Promise(r => setTimeout(r, 400)); return !document.querySelector('.result .retmc'); });
    await pg.close();
    must(r, 'no RETURN TO MISSION CONTROL line');
    must(r.txt === 'RETURN TO MISSION CONTROL', 'copy: ' + r.txt);
    must(r.anim !== 'none' && parseFloat(r.dur) > 0, 'it does not blink: ' + JSON.stringify(r));
    must(r.fs >= 11, 'too small: ' + r.fs);
    must(gone, 'it kept blinking after the result arrived — the walk back is over');
  });
  await step(`${view.name} A24 result-win-team: the headline is the pushed outcome, in the team colour language`, async () => {
    const pg = await open(view, 'result-win-team');
    const r = await pg.evaluate(() => { const h = document.querySelector('.result .rh1'); const cs = getComputedStyle(h);
      return { txt: h.textContent.trim(), cls: h.className, fs: parseFloat(cs.fontSize), color: cs.color,
               meta: (document.querySelector('.result .rmeta') || {}).textContent || '' }; });
    await pg.close();
    must(r.txt === 'WIN', 'headline: ' + r.txt);
    must(/\bwin\b/.test(r.cls), 'headline is not marked as a win: ' + r.cls);
    must(r.fs >= 30, 'the headline is not the biggest thing on the screen: ' + r.fs);
    must(/TDM/.test(r.meta) && /WIN BY KILLS/.test(r.meta), 'the screen is not mode-aware: ' + r.meta);
  });
  for (const [stage, word] of [['result-draw', 'DRAW'], ['result-undecided', 'UNDECIDED']]) {
    await step(`${view.name} A24 ${stage}: the headline reads ${word}`, async () => {
      const pg = await open(view, stage); const h = (await pg.evaluate(() => document.querySelector('.result .rh1').textContent)).trim(); await pg.close();
      must(h === word, 'headline: ' + h);
    });
  }
  await step(`${view.name} A24 result-win-team: the TEAM view shows every team's total AND its players`, async () => {
    const pg = await open(view, 'result-win-team');
    const r = await pg.evaluate(() => ({
      teams: Array.from(document.querySelectorAll('.result .rteam')).map(t => ({
        chip: t.querySelector('.tm').textContent.replace(/\s+/g, ' ').trim(),
        mine: t.classList.contains('mine'),
        players: Array.from(t.querySelectorAll('.tp')).map(p => p.textContent.replace(/\s+/g, ' ').trim()) })),
      hold: (t => t ? t.textContent.replace(/\s+/g, ' ').trim() : null)(document.querySelector('.result .thold')) }));
    await pg.close();
    must(r.teams.length === 2, 'teams rendered: ' + r.teams.length);
    must(r.teams.filter(t => t.mine).length === 1, 'exactly one team is marked as mine: ' + JSON.stringify(r.teams.map(t => t.mine)));
    must(r.teams.every(t => /\d/.test(t.chip)), 'a team chip carries no score: ' + JSON.stringify(r.teams.map(t => t.chip)));
    must(r.teams.every(t => t.players.length === 2), 'each team should list its two players: ' + JSON.stringify(r.teams.map(t => t.players)));
    must(r.teams.some(t => /REAPER/.test(t.players.join(' '))), 'this player is not in the team list');
    must(r.hold && /HELD/.test(r.hold), 'possession was pushed and is not shown: ' + r.hold);
  });
  await step(`${view.name} A24 result: the TEAMS/PLAYERS toggle actually changes the screen`, async () => {
    const pg = await open(view, 'result-win-team');
    const seg = await pg.evaluate(() => Array.from(document.querySelectorAll('.result .rseg .sg')).map(b => ({ t: b.textContent.trim(), on: b.getAttribute('aria-pressed'), h: b.getBoundingClientRect().height / parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1) })));
    must(seg.length === 2 && seg[0].t === 'TEAMS' && seg[1].t === 'PLAYERS', 'segments: ' + JSON.stringify(seg));
    must(seg[0].on === 'true' && seg[1].on === 'false', 'a team game does not open on the team view: ' + JSON.stringify(seg));
    must(seg.every(x => x.h >= 36), 'segment tap targets under 36px: ' + JSON.stringify(seg.map(x => x.h)));
    const before = await pg.evaluate(() => ({ teams: document.querySelectorAll('.result .rteam').length, board: document.querySelectorAll('.result .lbr').length }));
    await pg.click('.result .rseg .sg[data-arg="player"]'); await pg.waitForTimeout(250);
    const after = await pg.evaluate(() => ({ teams: document.querySelectorAll('.result .rteam').length, board: document.querySelectorAll('.result .lbr').length,
      head: Array.from(document.querySelectorAll('.result .lbh .c')).map(c => c.textContent.trim()), on: document.querySelector('.result .rseg .sg[data-arg="player"]').getAttribute('aria-pressed') }));
    await pg.screenshot({ path: `${OUT}/${view.name}-result-players-toggled.png` });
    await pg.click('.result .rseg .sg[data-arg="team"]'); await pg.waitForTimeout(250);
    const back = await pg.evaluate(() => document.querySelectorAll('.result .rteam').length);
    await pg.close();
    must(before.teams === 2 && before.board === 0, 'the team view is not what opened: ' + JSON.stringify(before));
    must(after.teams === 0 && after.board === 4, 'PLAYERS did not swap in the leaderboard: ' + JSON.stringify(after));
    must(after.on === 'true', 'the tapped segment does not read as pressed');
    must(['K', 'D', 'A', 'KD', 'ACC', 'BEST', 'MEDALS'].every(h => after.head.includes(h)), 'leaderboard columns: ' + JSON.stringify(after.head));
    must(back === 2, 'TEAMS did not come back');
  });
  await step(`${view.name} A24 result-players: the leaderboard carries kd, acc, best streak and medals`, async () => {
    const pg = await open(view, 'result-players');
    const r = await pg.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.result .lbr'));
      return { first: rows[0].textContent.replace(/\s+/g, ' ').trim(), me: rows.findIndex(x => x.classList.contains('me')),
        medals: rows.map(x => x.querySelector('.c.m').textContent.trim()),
        prov: rows.filter(x => x.querySelector('.c.prov')).length };
    });
    await pg.close();
    must(/VIPER/.test(r.first) && /13/.test(r.first), 'the top row is not the top scorer: ' + r.first);
    must(/1\.9/.test(r.first) && /43%/.test(r.first) && /\b7\b/.test(r.first), 'kd / acc / best streak missing from the row: ' + r.first);
    must(r.me >= 0, 'this player is not marked on the leaderboard');
    must(r.medals.some(m => /KILLING SPREE|TRIPLE KILL/.test(m)), 'no medals on any row: ' + JSON.stringify(r.medals));
    must(r.prov === 1, 'a provisional accuracy is not dimmed: ' + r.prov);
  });
  await step(`${view.name} A24 result: a four-player field fits — no row is cut off by the fixed rows around it`, async () => {
    // The screen's height budget is head + strips + tiles + footer; the body gets whatever is left. A strip that
    // grows by a few px silently eats the last leaderboard row, and the scrollbars are hidden (touch UI) so the
    // player sees a half row and no way to know there is more.
    const pg = await open(view, 'result-players');
    const lb = await pg.evaluate(() => { const r = document.querySelector('.result .lbrows'); return { c: r.clientHeight, s: r.scrollHeight, rows: r.children.length }; });
    await pg.click('.result .rseg .sg[data-arg="team"]'); await pg.waitForTimeout(250);
    const tm = await pg.evaluate(() => Array.from(document.querySelectorAll('.result .tpl')).map(r => ({ c: r.clientHeight, s: r.scrollHeight })));
    await pg.close();
    must(lb.rows === 4, 'the fixture is not four players: ' + lb.rows);
    must(lb.s <= lb.c + 1, `the leaderboard clips a row: ${lb.s} > ${lb.c}`);
    must(tm.length === 2 && tm.every(x => x.s <= x.c + 1), 'a team block clips its player list: ' + JSON.stringify(tm));
  });
  await step(`${view.name} A24 result-lose-ffa: no TEAM view is offered when MC sent no team totals`, async () => {
    const pg = await open(view, 'result-lose-ffa');
    const r = await pg.evaluate(() => ({ seg: document.querySelectorAll('.result .rseg .sg').length, teams: document.querySelectorAll('.result .rteam').length,
      rows: document.querySelectorAll('.result .lbr').length, head: document.querySelector('.result .rh1').textContent.trim(),
      meta: (document.querySelector('.result .rmeta') || {}).textContent || '' }));
    await pg.close();
    must(r.head === 'LOSE', 'headline: ' + r.head);
    must(r.seg === 0 && r.teams === 0, 'an FFA match offered a team view: ' + JSON.stringify(r));
    must(r.rows === 4, 'the FFA leaderboard is not the whole field: ' + r.rows);
    must(/FFA/.test(r.meta), 'the screen is not mode-aware: ' + r.meta);
  });
  await step(`${view.name} A24 result: AFTER THE WHISTLE is shown, and shown as NOT counted`, async () => {
    const pg = await open(view, 'result-win-team');
    const r = await pg.evaluate(() => { const e = document.querySelector('.result .rstrip.after'); if (!e) return null;
      return { k: e.querySelector('.k').textContent.trim(), v: e.querySelector('.v').textContent.replace(/\s+/g, ' ').trim(),
               fs: parseFloat(getComputedStyle(e.querySelector('.k')).fontSize),
               inBoard: !!e.closest('.rlb, .rteams') };
    });
    await pg.close();
    must(r, 'the post-whistle tally is not on screen');
    must(/AFTER THE WHISTLE/.test(r.k) && /NOT COUNTED/.test(r.k), 'copy: ' + r.k);
    must(/\b4 NOT COUNTED/.test(r.k), 'the recap`s fact COUNT is not shown (server sends after_end.facts): ' + r.k);
    must(/VIPER/.test(r.v), 'no per-player post-whistle line: ' + r.v);
    // `after_end.by_player` is keyed by player_id and carries NO name: the HUD resolves it from `rows`, and a
    // player with no row at all falls back to the raw id rather than being dropped or given an invented name.
    must(/VIPER 2·0/.test(r.v.replace(/\s+/g, ' ')), 'the name was not resolved from rows: ' + r.v);
    must(/P-GHOST 1·0/.test(r.v.replace(/\s+/g, ' ')), 'a player with no scored row was dropped instead of falling back to the id: ' + r.v);
    must(!r.inBoard, 'the unofficial tally is mixed into the scored board');
    must(r.fs >= 11, 'too small: ' + r.fs);
  });
  await step(`${view.name} A24 result: HONORS name the PLAYER and print MC's stat STRING, and FFA offers no team view`, async () => {
    // `honors[].display` is the player's name, not a label for the medal — printing the medal twice and the
    // person not at all is the easy way to get this wrong. The TEAMS toggle keys off `team_scores.length`.
    // The stat is MC's own sentence ("11 K · 2.8 K/D · ×5 STREAK"), NOT a number: this step asserts the text
    // MC actually sends, because the numeric demo payload it used to assert is what hid a guard that dropped
    // every real one (`num(h.stat) != null` is false for a string).
    const pg = await open(view, 'result-win-team');
    const h = await pg.evaluate(() => Array.from(document.querySelectorAll('.result .rstrip.hon .ch')).map(c => c.textContent.replace(/\s+/g, ' ').trim()));
    await pg.close();
    must(h.length === 3, 'honors chips: ' + JSON.stringify(h));
    must(h.some(x => /^MVP REAPER 11 K · 2\.8 K\/D · ×5 STREAK$/.test(x)), 'the honor does not name the player and print MC\'s stat string: ' + JSON.stringify(h));
    must(h.some(x => /^FIRST BLOOD VIPER AT 01:12$/.test(x)), 'honors: ' + JSON.stringify(h));
    must(h.some(x => /^SHARPSHOOTER VIPER 41% ACCURACY$/.test(x)), 'honors: ' + JSON.stringify(h));
  });
  await step(`${view.name} A24 result: every meaning-bearing label is at least 11px (the 9.5px cell label was the report)`, async () => {
    const pg = await open(view, 'result-win-team');
    const small = await pg.evaluate(() => Array.from(document.querySelectorAll('.result *')).filter(e => {
      const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (e.childElementCount) return false; const t = (e.textContent || '').trim(); if (!t) return false;
      return parseFloat(cs.fontSize) < 11; }).map(e => `${e.className || e.tagName}@${getComputedStyle(e).fontSize}: ${(e.textContent || '').trim().slice(0, 24)}`));
    await pg.close();
    must(small.length === 0, 'text under 11px: ' + small.join(' ; '));
  });
  await step(`${view.name} A24 result: head, body, strips, tiles and footer do not overlap`, async () => {
    const pg = await open(view, 'result-win-team');
    const bad = await pg.evaluate(() => {
      const sels = ['.rhead', '.rbody', '.rstrip.poss', '.rstrip.hon', '.rstrip.after', '.rstats', '.rfoot'];
      const boxes = sels.map(s => [s, document.querySelector('.result ' + s)]).filter(x => x[1]).map(([s, e]) => [s, e.getBoundingClientRect()]);
      const out = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i][1], b = boxes[j][1];
        if (a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2) out.push(boxes[i][0] + ' x ' + boxes[j][0]);
      }
      const f = document.querySelector('.result').getBoundingClientRect(), last = boxes[boxes.length - 1][1];
      if (last.bottom > f.bottom + 1) out.push('the footer is off the bottom of the frame');
      return out; });
    await pg.close();
    must(bad.length === 0, bad.join(' ; '));
  });
  await step(`${view.name} A24 over: RESULTS and HISTORY put the player back on the screens`, async () => {
    const pg = await open(view, 'over');
    const btns = await pg.evaluate(() => Array.from(document.querySelectorAll('.lobby .overbtns button')).map(b => ({ t: b.textContent.trim(), h: b.getBoundingClientRect().height / parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1) })));
    must(btns.length === 2 && /RESULTS/.test(btns[0].t) && /HISTORY/.test(btns[1].t), 'buttons: ' + JSON.stringify(btns));
    must(btns.every(b => b.h >= 36), 'tap targets under 36px: ' + JSON.stringify(btns.map(b => b.h)));
    await pg.click('[data-act="onShowResults"]'); await pg.waitForTimeout(250);
    const onResult = await pg.evaluate(() => ({ shown: !!document.querySelector('.result:not(.hist)'), btn: (document.querySelector('.result .rfoot .ready') || {}).textContent.trim() }));
    must(onResult.shown, 'RESULTS did not reopen the results screen');
    must(onResult.btn === 'CLOSE', 'a reopened results screen still offers OK: ' + onResult.btn);
    await pg.click('[data-act="onCloseView"]'); await pg.waitForTimeout(250);
    const backOver = await pg.evaluate(() => !document.querySelector('.result') && !!document.querySelector('.lobby .overbtns'));
    must(backOver, 'CLOSE did not return to the over screen');
    await pg.click('[data-act="onShowHistory"]'); await pg.waitForTimeout(250);
    const onHist = await pg.evaluate(() => !!document.querySelector('.result.hist'));
    await pg.screenshot({ path: `${OUT}/${view.name}-over-reopened.png` });
    await pg.close();
    must(onHist, 'HISTORY did not open the history list');
  });
  await step(`${view.name} A24 history: this session's matches, and one MC never confirmed`, async () => {
    const pg = await open(view, 'history');
    const r = await pg.evaluate(() => ({ rows: Array.from(document.querySelectorAll('.result.hist .hr:not(.hh)')).map(x => x.textContent.replace(/\s+/g, ' ').trim()),
      head: (document.querySelector('.result.hist .hr.hh') || {}).textContent || '',
      title: (document.querySelector('.result.hist .rh1') || {}).textContent.trim() }));
    await pg.close();
    must(r.rows.length >= 3, 'history rows: ' + r.rows.length);
    must(/THIS SESSION/.test(r.title), 'the list is not scoped to this MC session: ' + r.title);
    must(/RESULT/.test(r.head) && /K · D · A/.test(r.head), 'history columns: ' + r.head);
    must(r.rows.some(x => /\bWIN\b/.test(x)) && r.rows.some(x => /\bLOSE\b/.test(x)), 'no outcomes in the list: ' + JSON.stringify(r.rows));
    must(r.rows.some(x => /NOT CONFIRMED/.test(x)), 'an entry MC never resolved must read NOT CONFIRMED, not a guess: ' + JSON.stringify(r.rows));
  });
  await step(`${view.name} A31 down-at-cap-offline: one off the cap with no MC link names where a win is confirmed`, async () => {
    const pg = await open(view, 'down-at-cap-offline');
    const t = await text(pg);
    const r = await pg.evaluate(() => { const e = document.querySelector('.down .recap .capwarn'); if (!e) return null;
      const cs = getComputedStyle(e.querySelector('.unskew') || e); const rc = document.querySelector('.down .recap').getBoundingClientRect();
      return { txt: e.textContent.trim(), fs: parseFloat(cs.fontSize), inRecap: e.getBoundingClientRect().bottom <= rc.bottom + 1 }; });
    await pg.close();
    must(/DOWN/.test(t), 'this is not the DOWN screen');
    must(r, 'no cap-1 line on the DOWN screen');
    must(r.txt === 'MC OUT OF RANGE · A WIN IS CONFIRMED ONLY AT MISSION CONTROL', 'copy: ' + r.txt);
    must(r.fs >= 11, 'too small: ' + r.fs);
    must(r.inRecap, 'the line escapes the recap block');
  });
  await step(`${view.name} A31 down: the cap-1 line stays OFF while MC is linked`, async () => {
    const pg = await open(view, 'down');   // linked, board at 18/21 of 25
    const has = await pg.evaluate(() => !!document.querySelector('.down .recap .capwarn')); await pg.close();
    must(!has, 'the out-of-range warning shows while MC is in range');
  });
  await step(`${view.name} A31 armed: the compiled verify-at-MC notice sits above the T-minus`, async () => {
    const pg = await open(view, 'armed-with-mc-verify');
    const r = await pg.evaluate(() => { const e = document.querySelector('.mo.tminus .mcv span'); if (!e) return null;
      const n = document.querySelector('.mo.tminus .n').getBoundingClientRect(), b = e.getBoundingClientRect();
      const info = document.getElementById('info').getBoundingClientRect();
      return { txt: e.textContent.trim(), fs: parseFloat(getComputedStyle(e).fontSize), above: b.bottom <= n.top + 1,
               underInfo: b.left < info.right - 2 && b.right > info.left + 2 && b.top < info.bottom - 2 && b.bottom > info.top + 2,
               dim: getComputedStyle(e).color }; });
    const plain = await open(view, 'armed').then(async p => { const x = await p.evaluate(() => !!document.querySelector('.mo.tminus .mcv')); await p.close(); return x; });
    await pg.close();
    must(r, 'no mc_verify notice on the ARMED screen');
    must(/A WIN IS CONFIRMED AT MISSION CONTROL/.test(r.txt), 'copy: ' + r.txt);
    must(r.fs >= 11, 'too small: ' + r.fs);
    must(r.above, 'the notice is not above the T-minus digits');
    must(!r.underInfo, 'the notice runs under the ⓘ button');
    must(!plain, 'a game with NO mc_verify still rendered the notice');
  });
  await step(`${view.name} S21: the CAM look-through is gone from the live HUD — button, layer and scrims`, async () => {
    const pg = await open(view, 'live');
    // The button went in the first S21 pass; the layer it drove (#cam), the `cam-on`/`#frame.cam` rules and
    // the two scrims that were only ever visible under it survived as dead weight until the 2026-09-12 review.
    const r = await pg.evaluate(() => ({ chip: document.querySelectorAll('.camchip').length, act: document.querySelectorAll('[data-act="onToggleCam"]').length,
      layer: document.querySelectorAll('#cam').length, scrims: document.querySelectorAll('.scrim-t, .scrim-b').length,
      setCam: typeof window.brx.hud.setCam, camOn: document.documentElement.classList.contains('cam-on'),
      qr: typeof window.brx.hud.h.onScanQr }));
    await pg.close();
    must(r.chip === 0 && r.act === 0, 'the CAM button is still on screen');
    must(r.layer === 0, 'the #cam layer is still in the frame');
    must(r.scrims === 0, 'the cam-only scrims are still rendered on every live frame');
    must(r.setCam === 'undefined' && !r.camOn, 'hud.setCam / the cam-on class survived the removal');
    must(r.qr === 'function', 'the QR join scanner went with it — it was supposed to stay (S21)');
  });
  // ---------- A26 (S20, contracts A26 / loadout.md §4.5): the try-out collapsed into selection ----------
  await step(`${view.name} #59 A26 rack: TRY IT is gone, the bar reads REVIEW KIT ▸, and a tapped row shows ⟳ while it arms`, async () => {
    const pg = await open(view, 'loadout-arming');
    const r = await pg.evaluate(() => {
      const pend = document.querySelector('.lrow.pend');
      return { bar: Array.from(document.querySelectorAll('.lobar .lobtn')).map(b => b.textContent.trim()),
               tryIt: (document.body.innerText.match(/TRY IT/g) || []).length,
               pendName: pend ? pend.querySelector('.nm').textContent.trim() : null,
               pendMark: pend ? pend.querySelector('.st').textContent.trim() : null,
               ticks: Array.from(document.querySelectorAll('.lrow .st')).filter(e => e.textContent.trim() === '✓').length,
               chip: (document.querySelector('.ackchip') || {}).textContent || '' };
    });
    await pg.close();
    must(r.tryIt === 0, 'TRY IT is still on screen');
    must(r.bar[0] === 'REVIEW KIT ▸' && r.bar[1] === 'CLOSE', 'action bar: ' + JSON.stringify(r.bar));
    must(r.pendName === 'SMG', 'the tapped row is not the one marked arming: ' + r.pendName);
    must(r.pendMark === '⟳', 'the arming row must wear ⟳, got "' + r.pendMark + '"');
    must(r.ticks === 0, 'a ✓ is showing while the host has not acked yet');
    must(/ASKING THE HOST/.test(r.chip), 'the bar does not say the host is being asked: ' + r.chip);
  });
  await step(`${view.name} #60 A26 rack: the ack turns ⟳ into ✓ and the try-out does NOT take the screen`, async () => {
    const pg = await open(view, 'loadout-picked');
    const r = await pg.evaluate(() => ({ eq: (document.querySelector('.lrow.eq .nm') || {}).textContent, mark: (document.querySelector('.lrow.eq .st') || {}).textContent,
      pend: document.querySelectorAll('.lrow.pend').length, rack: document.querySelectorAll('.lo .lolist').length, takeover: document.querySelectorAll('.tryout').length,
      armed: window.brx.engine.state().tutorial, chip: (document.querySelector('.ackchip') || {}).textContent || '' }));
    await pg.close();
    must(r.eq === 'SMG' && r.mark.trim() === '✓', 'the acked row does not read ✓: ' + JSON.stringify(r));
    must(r.pend === 0, 'still arming after the ack');
    must(r.armed === true, 'the pick did not ARM the weapon — A26 says a tap equips AND arms');
    must(r.rack === 1 && r.takeover === 0, 'the try-out panel ejected the player from the rack: ' + JSON.stringify(r));
    must(/EQUIPPED/.test(r.chip), 'ack chip: ' + r.chip);
  });
  await step(`${view.name} #65 F129 A26 hero: the detail pane never says EQUIPPED while its own row is still ⟳`, async () => {
    const pg = await open(view, 'loadout-arming');
    const before = await pg.evaluate(() => { const nm = document.querySelector('.lodetail .nm'); const tag = nm ? nm.querySelector('.eqtag') : null;
      return { nm: nm ? nm.textContent.trim() : null, tagText: tag ? tag.textContent.trim() : null,
               arming: tag ? tag.classList.contains('arming') : null,
               fs: tag ? parseFloat(getComputedStyle(tag).fontSize) : null, color: tag ? getComputedStyle(tag).color : null,
               rowMark: (document.querySelector('.lrow.pend .st') || {}).textContent }; });
    must(/SMG/.test(before.nm || ''), 'the hero is not focused on the arming row: ' + JSON.stringify(before));
    must(before.rowMark && before.rowMark.trim() === '⟳', 'this stage is not mid-arm, so the step proves nothing: ' + JSON.stringify(before));
    must(before.tagText === 'ARMING…', 'the hero still claims EQUIPPED while the row reads ⟳: ' + JSON.stringify(before));
    must(before.arming === true, 'the hero tag is not wearing the amber .arming look: ' + JSON.stringify(before));
    must(before.fs >= 11, 'hero tag text is under 11px: ' + before.fs);
    must(before.color !== 'rgb(57, 224, 124)', 'the hero tag is still the green EQUIPPED colour, not amber: ' + before.color);
    await pg.close();
    const pg2 = await open(view, 'loadout-picked');
    const after = await pg2.evaluate(() => { const nm = document.querySelector('.lodetail .nm'); const tag = nm ? nm.querySelector('.eqtag') : null;
      return { nm: nm ? nm.textContent.trim() : null, tagText: tag ? tag.textContent.trim() : null, arming: tag ? tag.classList.contains('arming') : null }; });
    await pg2.close();
    must(/SMG/.test(after.nm || ''), 'the hero is not focused on the acked weapon: ' + JSON.stringify(after));
    must(after.tagText === 'EQUIPPED', 'the hero never turned to EQUIPPED once the ack landed: ' + JSON.stringify(after));
    must(after.arming === false, 'the hero kept the amber arming look after the ack: ' + JSON.stringify(after));
  });
  await step(`${view.name} #61 A26: REVIEW KIT ▸ lands on the three-plate kit summary with READY UP`, async () => {
    const pg = await open(view, 'loadout-primary');
    await pg.click('.lobar .lobtn.review'); await pg.waitForTimeout(500);
    const r = await pg.evaluate(() => ({ rack: document.querySelectorAll('.lo .lolist').length,
      plates: Array.from(document.querySelectorAll('.lobby .plates .plate.slot')).map(p => p.querySelector('.k').textContent.replace(/[▸\s]+$/, '')),
      ready: (document.querySelector('.foot .ready') || {}).textContent || '' }));
    await pg.close();
    must(r.rack === 0, 'REVIEW KIT left the player in the rack');
    must(r.plates.join('|') === 'PRIMARY|SECONDARY|PERK', 'not the three-plate summary: ' + JSON.stringify(r.plates));
    must(/READY UP/.test(r.ready), 'no READY UP on the kit summary: ' + r.ready);
  });
  await step(`${view.name} #62 A26: the ⓘ opens a row's detail and equips NOTHING (and is a real tap target)`, async () => {
    const pg = await open(view, 'loadout-info');
    const r = await pg.evaluate(() => { const sc = parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1);
      const b = document.querySelector('.lrow[data-arg="weapon:shotgun"] .linfo').getBoundingClientRect();
      return { detail: (document.querySelector('.lodetail .nm') || {}).textContent || '', focused: (document.querySelector('.lrow.fo .nm') || {}).textContent,
               equipped: window.brx.engine.state().loadout.primary.weapon_id, pend: window.brx.engine.state().pendingPick,
               asked: (window.brx.log || []).filter(l => /loadout_request .*shotgun/.test(l)).length,
               w: b.width / sc, h: b.height / sc, infos: document.querySelectorAll('.lrow .linfo').length, rows: document.querySelectorAll('.lrow').length }; });
    await pg.close();
    must(/SHOTGUN/.test(r.detail), 'the ⓘ did not move the detail pane: ' + r.detail);
    must(r.focused === 'SHOTGUN', 'the ⓘ did not focus its own row: ' + r.focused);
    must(r.equipped === 'assault_rifle' && r.pend === null && r.asked === 0, 'the ⓘ equipped something: ' + JSON.stringify(r));
    must(r.infos === r.rows, 'every row needs its own ⓘ: ' + r.infos + ' of ' + r.rows);
    must(r.w >= 36 && r.h >= 36, 'the ⓘ is an undersized tap target: ' + Math.round(r.w) + 'x' + Math.round(r.h));
  });
  // ---------- A27/A30: the host locks kits under a player who is still kitting (loadout.md §4.4) ----------
  await step(`${view.name} #63 A30: a lobby push mid-kit leads the lobby screen with THE HOST LOCKED KITS`, async () => {
    const pg = await open(view, 'lobby-kit-locked');
    const r = await pg.evaluate(() => { const e = document.querySelector('.lobby .kitlock'); if (!e) return null;
      const b = e.getBoundingClientRect(), btn = document.querySelector('.foot .ready').getBoundingClientRect();
      const f = document.getElementById('frame').getBoundingClientRect();
      return { txt: e.textContent.trim(), fs: parseFloat(getComputedStyle(e).fontSize), above: b.bottom <= btn.top + 1,
               inFrame: b.left >= f.left - 1 && b.right <= f.right + 1, clipped: e.scrollWidth > e.clientWidth + 1,
               rack: document.querySelectorAll('.lo .lolist').length, moment: window.brx.engine.state().moment }; });
    await pg.close();
    must(r, 'the lobby screen said nothing — a silent screen swap is exactly what A27 forbids');
    must(r.txt === 'THE HOST LOCKED KITS — you play what you had', 'copy: ' + r.txt);
    must(r.fs >= 11 && !r.clipped && r.inFrame, 'the line is unreadable or off the frame: ' + JSON.stringify(r));
    must(r.above, 'the lock line does not lead the footer');
    must(r.rack === 0, 'still in the rack after the push');
  });
  await step(`${view.name} #64 A30: MC's refusal copy is printed VERBATIM on the kit screen`, async () => {
    const pg = await open(view, 'kit-refused');
    const r = await pg.evaluate(() => { const e = document.querySelector('.lobby .kitlock'); if (!e) return null;
      const b = e.getBoundingClientRect(), ps = Array.from(document.querySelectorAll('.plate.slot')).map(p => p.getBoundingClientRect());
      return { txt: e.textContent.trim(), clipped: e.scrollWidth > e.clientWidth + 1,
               onPlate: ps.some(p => b.top < p.bottom - 2 && b.bottom > p.top + 2), plates: ps.length }; });
    await pg.close();
    must(r, 'the refusal never reached the screen');
    must(r.txt === 'THE MATCH HAS STARTED — YOUR KIT IS LOCKED UNTIL THE NEXT ONE', 'not verbatim: ' + r.txt);
    must(!r.clipped, 'the refusal is cut off: ' + r.txt);
    must(r.plates === 3 && !r.onPlate, 'the refusal line sits on the plates');
  });
  await step(`${view.name} #24 night: the kit plates stay visible`, async () => {
    const pg = await open(view, 'kitted', '&night'); const r = await pg.evaluate(() => Array.from(document.querySelectorAll('.plate')).map(p => getComputedStyle(p).backgroundColor)); await pg.close();
    must(r.length >= 3 && r.every(c => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'), 'transparent plates: ' + r.join(' '));
  });
}
await step('F110 briefing with a LONG name at 812\u00d7375 (the iPhone the report came from)', async () => {
  const v = { name: 'iphone', width: 812, height: 375 };
  const pg = await open(v, 'briefing-long');
  const r = await pg.evaluate(() => { const b = document.querySelector('.bfbody'), f = document.querySelector('.bffoot');
    const R = e => e.getBoundingClientRect(); const ft = R(f);
    const hit = a => a.left < ft.right - 2 && a.right > ft.left + 2 && a.top < ft.bottom - 2 && a.bottom > ft.top + 2;
    return { over: b.scrollHeight > b.clientHeight + 1, onFoot: Array.from(b.children).filter(e => hit(R(e))).map(e => e.className.split(' ')[0]),
             last: Math.max(...Array.from(b.children).map(e => R(e).bottom)), footTop: ft.top }; });
  await pg.close();
  must(r.onFoot.length === 0, 'briefing rows sit on top of the CTA footer: ' + r.onFoot.join(','));
  must(!r.over && r.last <= r.footTop - 4, JSON.stringify(r));
});
await step('F110 briefing at 812\u00d7375 (the iPhone the report came from)', async () => {
  const v = { name: 'iphone', width: 812, height: 375 };
  const sels = ['.bfname', '.bfdesc', '.bfk', '.bfrules', '.bfload'];
  const pg = await open(v, 'briefing'); const r = await sheared(pg, sels);
  const fit = await pg.evaluate(() => { const b = document.querySelector('.bfbody'), f = document.querySelector('.bffoot');
    return { over: b.scrollHeight > b.clientHeight + 1, last: Math.max(...Array.from(b.children).map(e => e.getBoundingClientRect().bottom)), footTop: f.getBoundingClientRect().top }; });
  await pg.close();
  notSheared(r, sels);
  must(!fit.over && fit.last <= fit.footTop - 4, JSON.stringify(fit));
});
await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed${fail ? ': ' + errs.join(', ') : ''}`);
process.exit(fail ? 1 : 0);
