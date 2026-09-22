// Screen-truth suite for the HUD review of 2026-09-03 (docs/hud-review-2026-09-03.md). Every step is a
// reported bug turned into an assertion about what a PERSON SEES: rects, wraps, overlaps, visible text —
// never engine state. Runs the `?demo&stage=` states at the design width AND a narrow phone, with
// classic (desktop) scrollbars ON, because both of those reproduced the report and headless defaults hide them.
// Run: node tools/screens.mjs      ONLY=<substring> runs matching steps.      SCREENS_PORT=<port> pins the static server (default: ephemeral)
//      SCREENS_SHARDS=<n> splits the steps across n child processes (default: half the cores, at most 16, capped by free memory; 1 = serial)
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path'; import os from 'os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEMO_PERKS, DEMO_WEAPONS } from '../src/demo-catalog.js';
// Derived, never typed: `demo-catalog.js` is the artefact the PHONE reads (generated from weapons.json
// by mcp/tools/gen_ui_catalog.py), and a row is IN it only when it is not `hidden`. `sidearm` is the
// same predicate DESIGNER counts PISTOLS with (Designer.tsx SlotEditor); a `pickup_only` sidearm is
// never offered. Unhiding the glock must MOVE this step, not break it -- and whoever unhides it will
// not open this file. Names are upper-cased because the rack draws them that way.
const SIDEARM_NAMES = DEMO_WEAPONS.filter(w => (w.tags || []).includes('sidearm') && !w.pickup_only).map(w => w.name.toUpperCase());
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..'), WWW = path.join(ROOT, 'www');
// The root parallel runner supplies a private output: its focused standard-test pass may overlap the full
// app-screens job, and neither is allowed to erase or overwrite the other's forensic captures.
const OUT = process.env.SCREENS_OUT ? path.resolve(process.env.SCREENS_OUT) : path.join(ROOT, 'shots', 'screens');
const cliValue = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const ONLY = cliValue('--only') ?? process.env.ONLY;
const EXPECT_RAW = cliValue('--expect-steps') ?? process.env.SCREENS_EXPECT_STEPS;
const EXPECT_STEPS = EXPECT_RAW === undefined ? null : Number(EXPECT_RAW);
if (EXPECT_STEPS !== null && (!Number.isInteger(EXPECT_STEPS) || EXPECT_STEPS < 1)) {
  console.error(`--expect-steps / SCREENS_EXPECT_STEPS must be a positive integer, got ${EXPECT_RAW}`);
  process.exit(2);
}
// Sharding (2026-09-16). Serial, this suite took ~22 min: ~330 steps, each opening its own page and waiting out the
// stage timeline (1.6-4.2 s). Every step already runs in its own browser context (`b.newPage()` = a fresh context,
// so no localStorage or cookie crosses steps), so the steps are independent and a shard is just "every n-th step".
// The coordinator (no SCREENS_SHARD) checks the bundle, clears OUT once, and runs n children of this file; each child
// launches its own browser on its own ephemeral port and runs only its share. The wait per step is unchanged.
const SHARD = process.env.SCREENS_SHARD ? process.env.SCREENS_SHARD.split('/').map(Number) : null;   // [index, count]
// Default shard count: half the cores, at most 16, and never more than a quarter of the free memory (a shard is its own
// browser, ~240 MB: 16 shards are ~3.8 GB). SCREENS_SHARDS overrides.
const availableMb = () => { try { return Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024; } catch { return os.totalmem() / 1048576 / 2; } };
const SHARDS = SHARD ? SHARD[1] : Math.max(1, Number(cliValue('--shards') ?? process.env.SCREENS_SHARDS ?? Math.min(16, Math.floor(os.cpus().length / 2), Math.floor(availableMb() * 0.25 / 240))));
if (!SHARD) {
  const srcNewest = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }).map(f => path.join(ROOT, 'src', f)).filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } }).reduce((a, f) => Math.max(a, fs.statSync(f).mtimeMs), 0);
  if (srcNewest > fs.statSync(path.join(WWW, 'app.js')).mtimeMs) { console.error('STALE BUNDLE: run `npm run build` first.'); process.exit(2); }
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
}
if (!SHARD && SHARDS > 1) {
  const t0 = Date.now();
  // Selection belongs to every child, but the expected count belongs to the aggregate. Passing the latter through
  // would make each shard demand all selected steps; dropping the former would make a focused run execute everything.
  const { SCREENS_EXPECT_STEPS: _aggregateOnly, ...childEnv } = process.env;
  const runs = Array.from({ length: SHARDS }, (_, i) => new Promise(resolve => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...childEnv, ONLY: ONLY ?? '', SCREENS_SHARD: `${i}/${SHARDS}`, SCREENS_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ i, code, out }));
  }));
  let pass = 0, fail = 0; const errs = [];
  for (const { i, code, out } of await Promise.all(runs)) {
    console.log(`\n#### shard ${i + 1}/${SHARDS} (exit ${code})`); console.log(out.trimEnd());
    const m = out.match(/^(\d+) passed, (\d+) failed(?:: (.*))?$/m);
    // a shard that crashed before its summary line is a failure, never a silent zero
    if (!m) { fail++; errs.push(`shard ${i + 1} crashed (exit ${code})`); continue; }
    pass += +m[1]; fail += +m[2]; if (m[3]) errs.push(m[3]);
    if (code !== 0 && +m[2] === 0) { fail++; errs.push(`shard ${i + 1} exited ${code}`); }
  }
  if (EXPECT_STEPS !== null && pass + fail !== EXPECT_STEPS) {
    errs.push(`selected ${pass + fail} steps, expected ${EXPECT_STEPS}`); fail++;
  }
  console.log(`\n${pass} passed, ${fail} failed${fail ? ': ' + errs.join(', ') : ''}  (${SHARDS} shards, ${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(fail ? 1 : 0);
}
const srv = http.createServer((req, res) => { const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0];
  try { res.setHeader('content-type', rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.html') ? 'text/html' : 'application/octet-stream'); res.end(fs.readFileSync(path.join(WWW, rel))); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => srv.listen(Number(process.env.SCREENS_PORT || 0), '127.0.0.1', r));
const PORT = srv.address().port;
let pass = 0, fail = 0; const errs = [];
const must = (c, m) => { if (!c) throw new Error(m); };
const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });   // scrollbars ON: what a desktop reviewer sees
const VIEWS = [{ name: 'pixel', width: 891, height: 411 }, { name: 'se', width: 667, height: 375 }];
const LONG = new Set(['live-reload-overrun', 'resync-prompt', 'down-find-presence', 'down-wait', 'down-find', 'down-approach', 'down-at', 'live-switch-perk', 'live-alert', 'live-medals', 'live-switch', 'live', 'live-kill', 'live-reload', 'down', 'redeploy', 'resync', 'live-nogun', 'live-mclost', 'result', 'over', 'panic', 'live-hit', 'live-lowhp', 'live-lowammo', 'live-fired', 'aborted',
  'result-pending', 'result-unreached', 'result-win-team', 'result-players', 'result-lose-ffa', 'result-draw', 'result-undecided', 'history',
  'down-at-cap-offline', 'armed-with-mc-verify', 'loadout-picked', 'live-scores', 'live-scores-ffa', 'live-poison', 'live-smoke', 'down-poisoned', 'live-gun-no-answer', 'live-gun-locked']);   // A26: a pick now waits out the node's 400 ms debounce AND the host round-trip before the row reads ✓
let stepIdx = 0;   // counts every step this run selects; identical control flow in every shard, so `% count` partitions them
const step = async (name, fn) => { if (ONLY && !name.includes(ONLY)) return; if (SHARD && stepIdx++ % SHARD[1] !== SHARD[0]) return; try { await fn(); console.log(`  ok   ${name}`); pass++; } catch (e) { console.log(`  FAIL ${name}: ${String(e.message || e).slice(0, 300)}`); fail++; errs.push(name); } };
const open = async (view, stage, extra = '', ms) => {
  const pg = await b.newPage({ viewport: { width: view.width, height: view.height } }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=${stage}${extra}`); await pg.waitForTimeout(ms || (LONG.has(stage) ? 4200 : 1600));
  must(perr.length === 0, 'page errors: ' + perr.join(' | '));
  const reached = await pg.evaluate(s => ({ stage: window.brxDemo && window.brxDemo.stage, failed: (window.brx.log || []).filter(l => /stage step failed|unknown/.test(l)) }), stage);
  must(reached.stage === stage && reached.failed.length === 0, `stage not reached: ${JSON.stringify(reached)}`);   // a throwing stage step must not pass as "whatever is on screen"
  await pg.screenshot({ path: `${OUT}/${view.name}-${stage}${extra.replace(/[&=]/g, '_')}.png` });
  return pg;
};
// what every screen must satisfy (#1/#2/#3/#5/#7/#8/#10/#12/#14/#22): no sideways overflow, nothing under the ⓘ box, no wrapped plate row
const invariants = pg => pg.evaluate(() => {
  const out = []; const info = document.getElementById('info').getBoundingClientRect();
  const skinEl = document.getElementById('skin'), skin = skinEl ? skinEl.getBoundingClientRect() : null;   // the day/night switch under the ⓘ (bench 2026-09-17)
  const hit = (a, b) => a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2;
  for (const e of document.querySelectorAll('#hud *, #overlay *, #chips *')) {
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1) out.push(`sideways overflow: .${e.className} ${e.scrollWidth}>${e.clientWidth}`);
    const txt = e.childElementCount === 0 && (e.textContent || '').trim(); if (!txt) continue;
    const r = e.getBoundingClientRect(); if (r.width && hit(r, info)) out.push(`under the ⓘ button: "${txt.slice(0, 30)}"`);
    if (r.width && skin && hit(r, skin)) out.push(`under the day/night switch: "${txt.slice(0, 30)}"`);
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
  for (const st of ['idle', 'idle-noisy', 'idle-noisy-open', 'idle-assigned', 'connected', 'mc-rejected', 'setup', 'briefing', 'kitted', 'kitted-ready', 'kitted-headset-off', 'connected-headset-off', 'loadout-primary', 'loadout-secondary', 'loadout-picked', 'loadout-arming', 'loadout-info', 'kitted-perk', 'kitted-full', 'loadout-perk', 'tryout', 'lobby', 'lobby-kit-locked', 'kit-refused', 'armed', 'live', 'live-nogun', 'resync', 'live-kill', 'live-reload', 'down', 'redeploy', 'result', 'over',
    'result-pending', 'result-unreached', 'result-win-team', 'result-players', 'result-lose-ffa', 'result-draw', 'result-undecided', 'history',
    'down-at-cap-offline', 'armed-with-mc-verify']) {
    await step(`${view.name} ${st}: invariants`, async () => { const pg = await open(view, st); const bad = await invariants(pg); await pg.close(); must(bad.length === 0, bad.join(' ; ')); });
  }
  await step(`${view.name} frame keeps its design size (#6/#7/#13/#18/#22 root cause)`, async () => {
    const pg = await open(view, 'kitted'); const w = await pg.evaluate(() => getComputedStyle(document.getElementById('frame')).width); await pg.close(); must(w === '844px', 'frame width ' + w);
  });
  await step(`${view.name} F288 gun-health warning is visible, actionable, and clears`, async () => {
    const pg = await open(view, 'live-gun-no-answer');
    const read = () => pg.evaluate(() => {
      const e = document.querySelector('.gunwarn'); if (!e) return null;
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e), hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const font = parseFloat(getComputedStyle(e.querySelector('span')).fontSize), frame = document.getElementById('frame');
      const frameScale = frame.getBoundingClientRect().width / frame.offsetWidth;
      return { text: e.textContent.replace(/\s+/g, ' ').trim(), danger: e.classList.contains('danger'), role: e.getAttribute('role'), font, visualFont: font * frameScale,
        inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, overflow: e.scrollWidth > e.clientWidth + 1,
        headerHit: hit(r, document.querySelector('.clockplate').getBoundingClientRect()), reticleHit: hit(r, document.querySelector('.reticle').getBoundingClientRect()),
        chipHit: Array.from(document.querySelectorAll('.chipbar .pill')).some(p => { const s = getComputedStyle(p); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && hit(r, p.getBoundingClientRect()); }),
        chipsDisplay: getComputedStyle(document.getElementById('chips')).display, css: { display: cs.display, opacity: cs.opacity } };
    });
    const unanswered = await read();
    await pg.evaluate(() => window.brxDemo.gunNoFire());
    await pg.waitForFunction(() => document.querySelector('.gunwarn.status, .gunwarn.warn')?.textContent.includes('NOT REPORTING SHOTS')); const noFire = await read();
    await pg.evaluate(() => window.brxDemo.gunHealthy());
    await pg.waitForFunction(() => !document.querySelector('.gunwarn') && !document.getElementById('frame').hasAttribute('data-gun-health'));
    const cleared = await pg.evaluate(() => ({ warning: !!document.querySelector('.gunwarn'), flagged: document.getElementById('frame').hasAttribute('data-gun-health'), chips: getComputedStyle(document.getElementById('chips')).display, weaponsHot: document.getElementById('chips').textContent.includes('WEAPONS HOT') }));
    await pg.close();
    must(unanswered && unanswered.danger && unanswered.role === 'alert', JSON.stringify(unanswered));
    must(unanswered.text === 'GUN NOT ANSWERING HOST: FORCE RESPAWN OR RELINK', unanswered.text);
    must(unanswered.inside && !unanswered.overflow && !unanswered.headerHit && !unanswered.reticleHit && !unanswered.chipHit && unanswered.chipsDisplay === 'none' && unanswered.visualFont >= 11, JSON.stringify(unanswered));
    must(noFire, 'no no-fire warning');
    must(noFire.danger === false, 'no-fire warning used danger styling: ' + JSON.stringify(noFire));
    must(noFire.role === 'status', 'no-fire warning role: ' + JSON.stringify(noFire));
    must(/GUN NOT REPORTING SHOTS/.test(noFire.text) && /PULL TRIGGER AGAIN/.test(noFire.text) && /THEN TELL HOST/.test(noFire.text), 'no-fire copy: ' + JSON.stringify(noFire));
    must(noFire.inside && !noFire.overflow && !noFire.headerHit && !noFire.reticleHit && !noFire.chipHit && noFire.chipsDisplay === 'none' && noFire.visualFont >= 11, JSON.stringify(noFire));
    must(!cleared.warning && !cleared.flagged && cleared.chips !== 'none' && cleared.weaponsHot, 'healthy state did not restore chips: ' + JSON.stringify(cleared));
  });
  await step(`${view.name} F288 gun health does not cover live smoke or hit effects`, async () => {
    const pg = await open(view, 'live-gun-no-answer');
    const overlap = sel => pg.evaluate(sel => { const w = document.querySelector('.gunwarn'), e = document.querySelector(sel); if (!w || !e) return null; const a = w.getBoundingClientRect(), b = e.getBoundingClientRect(); return { hit: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top, warning: [a.top, a.bottom], effect: [b.top, b.bottom] }; }, sel);
    await pg.evaluate(() => window.brxDemo.gunSmokeOverlap());
    await pg.waitForFunction(() => document.querySelector('.gunwarn.danger') && document.querySelector('.aimfx')); const smoke = await overlap('.aimfx');
    await pg.evaluate(() => window.brxDemo.gunHitOverlap());
    await pg.waitForFunction(() => document.querySelector('.gunwarn.danger') && document.querySelector('.takingfire')); const hit = await overlap('.takingfire');
    await pg.close();
    must(smoke && !smoke.hit, 'warning covers smoke: ' + JSON.stringify(smoke));
    must(hit && !hit.hit, 'warning covers taking-fire: ' + JSON.stringify(hit));
  });
  await step(`${view.name} F288 link loss supersedes a persisted no-answer verdict`, async () => {
    const pg = await open(view, 'live-gun-no-answer');
    await pg.evaluate(() => window.brxDemo.dropGun());
    await pg.waitForFunction(() => !document.querySelector('.gunwarn') && document.querySelector('[data-act="onReconnectGun"]'));
    const r = await pg.evaluate(() => { const b = document.querySelector('[data-act="onReconnectGun"]'), chips = document.getElementById('chips'), br = b.getBoundingClientRect(), top = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2); return {
      text: b.textContent.replace(/\s+/g, ' ').trim(), chips: getComputedStyle(chips).display, visible: br.width > 0 && br.height > 0, onTop: top === b || b.contains(top), pointer: getComputedStyle(b).pointerEvents,
    }; });
    await pg.close();
    must(r.text === 'GUN LINK LOST — TAP TO RECONNECT' && r.chips !== 'none' && r.visible && r.onTop && r.pointer !== 'none', JSON.stringify(r));
  });
  await step(`${view.name} F272 locked gun: takeover, link-down, and power-cycle recovery are screen truth`, async () => {
    const pg = await open(view, 'live-gun-locked');
    const locked = await pg.evaluate(() => {
      const e = document.querySelector('[data-gun-locked]'), frame = document.getElementById('frame');
      if (!e || !frame) return null;
      const r = e.getBoundingClientRect(), fr = frame.getBoundingClientRect(), cs = getComputedStyle(e);
      return { text: e.textContent.replace(/\s+/g, ' ').trim(), role: e.getAttribute('role'),
        inside: r.left >= fr.left - 1 && r.right <= fr.right + 1 && r.top >= fr.top - 1 && r.bottom <= fr.bottom + 1,
        visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0,
        chipsHidden: getComputedStyle(document.getElementById('chips')).display === 'none',
        overflow: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1 };
    });
    must(locked && locked.visible && locked.inside && !locked.overflow && locked.chipsHidden, JSON.stringify(locked));
    must(locked.role === 'alert', `takeover role ${JSON.stringify(locked && locked.role)}`);
    must(/YOUR GUN HAS STOPPED/i.test(locked.text) && /HOLD POWER 3 S/i.test(locked.text) && /POWER ON/i.test(locked.text) && /PHONE WILL RE-ARM IT/i.test(locked.text), `takeover copy: ${JSON.stringify(locked.text)}`);
    const blocked = await pg.evaluate(() => {
      const e = document.querySelector('[data-gun-locked]'), box = e.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const hidden = ['hud', 'chips', 'info', 'skin', 'diag'].map(id => {
        const node = document.getElementById(id); return { id, inert: node?.hasAttribute('inert'), aria: node?.getAttribute('aria-hidden') };
      });
      return { takeoverHit: !!hit?.closest('[data-gun-locked]'), hidden };
    });
    must(blocked.takeoverHit && blocked.hidden.every(x => x.inert && x.aria === 'true'),
      `takeover did not exclusively own pointer/accessibility input: ${JSON.stringify(blocked)}`);

    // A cold app restore deliberately remains IDLE until BLE reconnects. The durable, match-scoped verdict
    // still owns the screen in that gap; otherwise restarting the phone erases the only recovery instruction.
    const restoredIdle = await pg.evaluate(() => {
      window.brx.engine.phase = 'idle'; window.brx.engine._changed();
      return !!document.querySelector('[data-gun-locked]');
    });
    must(restoredIdle, 'persisted lock takeover disappeared in the idle-before-relink restore gap');
    await pg.evaluate(() => { window.brx.engine.phase = 'live'; window.brx.engine._changed(); });

    await pg.evaluate(() => window.brxDemo.dropGun());
    // Wait for the mutation we are trying to prove. Waiting on the takeover itself was tautological:
    // it was already present before dropGun(), so a broken/no-op drop would still pass this step.
    await pg.waitForFunction(() => window.brx.engine.state().bleUp === false);
    const dropped = await pg.evaluate(() => {
      const link = document.querySelector('[data-act="onReconnectGun"]'), lr = link && link.getBoundingClientRect();
      return { bleUp: window.brx.engine.state().bleUp,
        locked: (document.querySelector('[data-gun-locked]') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
        link: link?.textContent || '', linkVisible: !!(link && lr.width > 0 && lr.height > 0 && getComputedStyle(link).visibility !== 'hidden'),
        chipsHidden: getComputedStyle(document.getElementById('chips')).display === 'none' };
    });
    must(dropped.bleUp === false && !dropped.linkVisible && /YOUR GUN HAS STOPPED/i.test(dropped.locked) && dropped.chipsHidden,
      `the power-cycle instruction stays authoritative while the radio is down: ${JSON.stringify(dropped)}`);

    await pg.evaluate(() => {
      const eng = window.brx.engine, ordinary = eng.writer;
      eng.writer = (frames, why, options) => frames.includes('$CLEAR,*')
        ? new Promise(resolve => { window.__f272Head = resolve; })
        : ordinary(frames, why, options);
      window.brxDemo.relinkGun();
    });
    await pg.waitForFunction(() => window.brx.engine.state().gunRecovery === 'rearming'
      && /KEEP POWER ON/i.test((document.querySelector('[data-gun-locked]') || {}).textContent || ''));
    const rearming = await pg.evaluate(() => (document.querySelector('[data-gun-locked]') || {}).textContent?.replace(/\s+/g, ' ').trim() || '');
    must(/KEEP POWER ON/i.test(rearming) && /RE-ARMING/i.test(rearming) && !/HOLD POWER 3 S/i.test(rearming),
      `recovery still tells the player to switch off: ${JSON.stringify(rearming)}`);
    await pg.evaluate(() => window.__f272Head(true));
    await pg.waitForFunction(() => !!document.querySelector('.mo.down'));
    await pg.waitForFunction(() => !document.querySelector('.whiteout'));
    const recovered = await pg.evaluate(() => ({ locked: !!document.querySelector('[data-gun-locked]'),
      down: (document.querySelector('.mo.down') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
      alive: window.brx.engine.state().alive }));
    await pg.screenshot({ path: `${OUT}/${view.name}-f272-recovered-down.png` });
    await pg.close();
    must(!recovered.locked && recovered.alive === false && /GUN RESTARTED/i.test(recovered.down) && /REDEPLOYING/i.test(recovered.down)
      && !/KILLED BY|UNKNOWN/i.test(recovered.down), `power-cycled gun returns through an honest recovery DOWN state: ${JSON.stringify(recovered)}`);

    const failed = await open(view, 'live-gun-locked');
    await failed.evaluate(() => {
      const eng = window.brx.engine, ordinary = eng.writer;
      window.brxDemo.dropGun();
      eng.writer = (frames, why, options) => frames.includes('$CLEAR,*') ? false : ordinary(frames, why, options);
      window.brxDemo.relinkGun();
    });
    await failed.waitForFunction(() => window.brx.engine.state().gunRecovery === 'retry_exhausted', null, { timeout: 7000 });
    const exhausted = await failed.evaluate(() => (document.querySelector('[data-gun-locked]') || {}).textContent?.replace(/\s+/g, ' ').trim() || '');
    await failed.close();
    must(/RE-ARMING DID NOT FINISH/i.test(exhausted) && /POWER-CYCLE AGAIN/i.test(exhausted),
      `spent recovery budget has no actionable screen truth: ${JSON.stringify(exhausted)}`);
  });
  await step(`${view.name} F272 locked-gun takeover stays readable at night`, async () => {
    const pg = await open(view, 'live-gun-locked', '&night');
    const r = await pg.evaluate(() => {
      const e = document.querySelector('[data-gun-locked]'), frame = document.getElementById('frame');
      if (!e || !frame) return null;
      const box = e.getBoundingClientRect(), fb = frame.getBoundingClientRect();
      const rgb = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = value => {
        const [red, green, blue] = rgb(value).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return .2126 * red + .7152 * green + .0722 * blue;
      };
      const bg = getComputedStyle(e).backgroundColor;
      const ratio = node => { const a = lum(getComputedStyle(node).color), b = lum(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
      return {
        text: e.textContent.replace(/\s+/g, ' ').trim(), env: document.querySelector('[data-env]')?.dataset.env,
        inside: box.left >= fb.left - 1 && box.right <= fb.right + 1 && box.top >= fb.top - 1 && box.bottom <= fb.bottom + 1,
        visible: box.width > 0 && box.height > 0 && getComputedStyle(e).visibility !== 'hidden' && Number(getComputedStyle(e).opacity) > 0,
        overflow: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1,
        contrast: { heading: ratio(e.querySelector('.k')), action: ratio(e.querySelector('.t')), reassurance: ratio(e.querySelector('.s')) },
      };
    });
    must(r && r.env === 'night' && r.visible && r.inside && !r.overflow, JSON.stringify(r));
    must(/YOUR GUN HAS STOPPED/i.test(r.text) && /HOLD POWER 3 S/i.test(r.text) && /POWER ON/i.test(r.text) && /PHONE WILL RE-ARM IT/i.test(r.text),
      `night takeover copy: ${JSON.stringify(r.text)}`);
    // Heading/action are bold large text (3:1 AA); the 12 px reassurance remains normal text (4.5:1 AA).
    must(r.contrast.heading >= 3 && r.contrast.action >= 3 && r.contrast.reassurance >= 4.5,
      `night takeover contrast below AA: ${JSON.stringify(r.contrast)}`);
    await pg.evaluate(() => {
      const eng = window.brx.engine, ordinary = eng.writer;
      window.brxDemo.dropGun();
      eng.writer = (frames, why, options) => frames.includes('$CLEAR,*')
        ? new Promise(resolve => { window.__f272NightHead = resolve; })
        : ordinary(frames, why, options);
      window.brxDemo.relinkGun();
    });
    await pg.waitForFunction(() => window.brx.engine.state().gunRecovery === 'rearming'
      && /KEEP POWER ON/i.test((document.querySelector('[data-gun-locked]') || {}).textContent || ''));
    const nightRearming = await pg.evaluate(() => (document.querySelector('[data-gun-locked]') || {}).textContent?.replace(/\s+/g, ' ').trim() || '');
    must(/KEEP POWER ON/i.test(nightRearming) && /RE-ARMING/i.test(nightRearming), `night rearming copy: ${JSON.stringify(nightRearming)}`);
    await pg.evaluate(() => {
      const eng = window.brx.engine;
      eng.writer = frames => frames.includes('$CLEAR,*') ? false : true;
      window.__f272NightHead(false);
    });
    await pg.waitForFunction(() => window.brx.engine.state().gunRecovery === 'retry_exhausted', null, { timeout: 7000 });
    const nightExhausted = await pg.evaluate(() => {
      const e = document.querySelector('[data-gun-locked]');
      return { text: e?.textContent?.replace(/\s+/g, ' ').trim() || '', bg: e && getComputedStyle(e).backgroundColor };
    });
    await pg.close();
    must(/POWER-CYCLE AGAIN/i.test(nightExhausted.text) && nightExhausted.bg === 'rgb(5, 0, 0)',
      `night exhausted recovery truth: ${JSON.stringify(nightExhausted)}`);
  });
  await step(`${view.name} F288 gun-health action stays readable at night`, async () => {
    const pg = await open(view, 'live-gun-no-answer', '&night');
    const r = await pg.evaluate(() => { const e = document.querySelector('.gunwarn.danger'), s = e && e.querySelector('span'), f = document.getElementById('frame'); return e && s ? {
      color: getComputedStyle(e).color, background: getComputedStyle(e).backgroundColor,
      visualFont: parseFloat(getComputedStyle(s).fontSize) * f.getBoundingClientRect().width / f.offsetWidth,
    } : null; });
    await pg.close();
    must(r && r.color === 'rgb(239, 104, 104)' && r.background === 'rgba(8, 3, 3, 0.96)' && r.visualFont >= 11, JSON.stringify(r));
  });
  await step(`${view.name} demo ignores a real session persisted on the same origin (correctness review)`, async () => {
    const pg = await b.newPage({ viewport: { width: view.width, height: view.height } });
    await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=idle`); await pg.waitForTimeout(600);
    await pg.evaluate(() => localStorage.setItem('brx.engine', JSON.stringify({ phase: 'live', player: { player_id: 'p9', display: 'GHOST', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'smg' }] } }, config: { config_id: 'x', mode: 'tdm' }, frames: { head: ['$START,*'], spawn: [], end: [], panic: [] }, start: { match_id: 'old', go_live_t: Date.now() - 60000, seq: 1 }, spawned: true, savedAt: Date.now() })));
    await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=connected`); await pg.waitForTimeout(1600);
    const r = await pg.evaluate(() => ({ phase: window.brx.engine.state().phase, txt: document.body.innerText.slice(0, 80) })); await pg.close();
    must(r.phase === 'connected', 'demo inherited the persisted session: ' + JSON.stringify(r));
  });
  await step(`${view.name} #2 idle list: no horizontal scrollbar`, async () => {
    const pg = await open(view, 'idle'); const r = await pg.evaluate(() => { const l = document.querySelector('.idle .list'); return { ox: getComputedStyle(l).overflowX, sw: l.scrollWidth, cw: l.clientWidth, rows: document.querySelectorAll('.tagrow').length }; }); await pg.close();
    must(r.rows === 3, 'rows ' + r.rows); must(r.ox === 'hidden' && r.sw <= r.cw + 1, JSON.stringify(r));
  });
  // ---- F258 (bench 2026-09-18): the gun picker in a room full of Bluetooth ----
  // What Tony saw: SCANNING FOR TAGGERS, then every device in the room in signal order (two
  // televisions, a QLED, a Hatch Rest, bare MAC addresses) with the two real taggers at positions 7
  // and 12 — and no tap or scroll ever landed, because the list was rebuilt on every scan hit.
  await step(`${view.name} F258 idle-noisy: the taggers are the only rows; the room is behind a fold`, async () => {
    const pg = await open(view, 'idle-noisy');
    const r = await pg.evaluate(() => ({
      shown: Array.from(document.querySelectorAll('.taggers .tagrow .nm')).map(e => e.textContent.trim()),
      folded: document.querySelectorAll('.others .tagrow').length,
      foldVisible: getComputedStyle(document.querySelector('.others')).display !== 'none',
      tog: (document.querySelector('.othertog') || {}).textContent || '',
      togVisible: !!document.querySelector('.othertog') && getComputedStyle(document.querySelector('.othertog')).display !== 'none',
    }));
    await pg.close();
    must(r.shown.length === 2, 'the picker shows ' + r.shown.length + ' rows, not the two taggers: ' + JSON.stringify(r.shown));
    must(/ALPHA-FE30/.test(r.shown[0]) && /BRAVO-9498/.test(r.shown[1]), 'the two taggers are not the visible rows: ' + JSON.stringify(r.shown));
    must(r.folded === 5 && !r.foldVisible, 'the room is not folded away: ' + JSON.stringify(r));
    must(r.togVisible && /OTHER DEVICES \(5\)/.test(r.tog), 'no way back to the other devices: ' + JSON.stringify(r));
  });
  // A real tap on the toggle, through the HUD's own click handler and app.js's `onScanOther` — not the
  // stage event. The fold is the only way back to a device the ranking got wrong, so it must be tappable.
  await step(`${view.name} F258 idle-noisy: tapping OTHER DEVICES opens the fold and shows the rest of the room`, async () => {
    const pg = await open(view, 'idle-noisy');
    await pg.click('.othertog');
    await pg.waitForTimeout(200);
    const r = await pg.evaluate(() => ({
      folded: Array.from(document.querySelectorAll('.others .tagrow .nm')).map(e => e.textContent.trim()),
      visible: getComputedStyle(document.querySelector('.others')).display !== 'none',
      tog: (document.querySelector('.othertog') || {}).textContent || '',
    }));
    await pg.close();
    must(r.visible && r.folded.length === 5, 'the fold did not open on a tap: ' + JSON.stringify(r));
    must(r.folded.some(t => /Samsung/.test(t)), 'the televisions are not reachable at all: ' + JSON.stringify(r.folded));
    must(/▾/.test(r.tog), 'the toggle does not say it is open: ' + JSON.stringify(r.tog));
  });
  // A finger landing in the middle of a tagger row must hit THAT row, not a neighbour and not the box
  // behind it. This is the screen-truth half of "no tap ever landed".
  await step(`${view.name} F258 idle-noisy: a finger in the middle of a tagger row hits that row`, async () => {
    const pg = await open(view, 'idle-noisy');
    const r = await pg.evaluate(() => {
      const sc = parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1) || 1;   // the #frame is scaled: tap targets are judged in DESIGN px, as step #23 does
      return Array.from(document.querySelectorAll('.taggers .tagrow')).map(row => {
        const b = row.getBoundingClientRect();
        const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        const hit = el && el.closest('.tagrow');
        return { want: row.dataset.arg, got: hit ? hit.dataset.arg : null, h: Math.round(b.height / sc) };
      });
    });
    await pg.close();
    must(r.length === 2 && r.every(x => x.got === x.want), 'a tap in a row does not reach that row: ' + JSON.stringify(r));
    must(r.every(x => x.h >= 44), 'a tagger row is under the 44px tap target: ' + JSON.stringify(r));
  });
  // Game day 2026-09-19: the gun list showed empty with no scan running, and nothing on screen said so.
  await step(`${view.name} picker-idle: an empty list says whether a scan runs and offers SCAN AGAIN`, async () => {
    const pg = await open(view, 'idle');
    const read = () => pg.evaluate(() => {
      const vis = el => !!el && getComputedStyle(el).display !== 'none';
      const b = document.querySelector('.idle .list .rescan'); const br = b && b.getBoundingClientRect();
      return { none: (document.querySelector('.idle .nonefound') || {}).textContent || '', noneVis: vis(document.querySelector('.idle .nonefound')),
        sc: vis(document.querySelector('.idle .sc')), btn: vis(b), act: b && b.dataset.act,
        h: br ? br.height / (parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1) || 1) : 0 };   // design px, as F258's row check
    });
    await pg.evaluate(() => window.brxDemo.pickerIdle(false)); await pg.waitForTimeout(200);
    const idle = await read();
    await pg.screenshot({ path: `${OUT}/${view.name}-picker-idle.png` });
    must(idle.noneVis && idle.none === 'No guns found. Turn the gun on, then tap Scan again.', 'idle text: ' + JSON.stringify(idle));
    must(idle.btn && idle.act === 'onScanAgain' && idle.h >= 36, 'no SCAN AGAIN button: ' + JSON.stringify(idle));
    must(!idle.sc, 'SCANNING FOR TAGGERS shows while no scan runs: ' + JSON.stringify(idle));
    const bad = await invariants(pg); must(bad.length === 0, bad.join(';'));
    await pg.evaluate(() => window.brxDemo.pickerIdle(true)); await pg.waitForTimeout(200);
    const busy = await read(); await pg.close();
    must(busy.none === 'Scanning…' && busy.sc && busy.btn, 'scanning state: ' + JSON.stringify(busy));
  });
  // App 0.4.2 (field 2026-09-19, Pixel 5): after a tap on a gun the list emptied and nothing showed for
  // about 4 s while two connects failed. From the tap to the link, the picker names the gun it connects to.
  await step(`${view.name} picker-connecting: a gun tap shows the gun name and progress, then retries, then a plain failure`, async () => {
    const pg = await open(view, 'idle-noisy');
    const read = () => pg.evaluate(() => {
      const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
      const c = document.querySelector('.idle .list .connecting');
      return { box: vis(c), head: (c && c.querySelector('.cn') || {}).textContent || '', line: (c && c.querySelector('.cst') || {}).textContent || '',
        bar: vis(c && c.querySelector('.cbar')), rows: Array.from(document.querySelectorAll('.idle .list .tagrow')).filter(vis).length,
        none: vis(document.querySelector('.idle .nonefound')), rescan: vis(document.querySelector('.idle .list .rescan')), sc: vis(document.querySelector('.idle .sc')) };
    });
    await pg.evaluate(() => window.brxDemo.pickerConnecting(1)); await pg.waitForTimeout(200);
    const first = await read();
    await pg.screenshot({ path: `${OUT}/${view.name}-picker-connecting.png` });
    must(first.box && first.head === 'Connecting to GUN-A-3D4F…' && first.bar, 'no connecting block from the tap: ' + JSON.stringify(first));
    must(first.rows === 0 && !first.none && !first.rescan && !first.sc, 'the list or the scan line still shows during a connect: ' + JSON.stringify(first));
    let bad = await invariants(pg); must(bad.length === 0, bad.join(';'));
    await pg.evaluate(() => window.brxDemo.pickerConnecting(2)); await pg.waitForTimeout(200);
    const retry = await read();
    must(retry.box && retry.line === 'Retrying (2 of 5)…' && retry.bar, 'no retry count: ' + JSON.stringify(retry));
    await pg.evaluate(() => window.brxDemo.pickerConnecting(5, true)); await pg.waitForTimeout(200);
    const fail = await read();
    await pg.screenshot({ path: `${OUT}/${view.name}-picker-connect-failed.png` });
    must(fail.box && fail.head === 'Could not connect to GUN-A-3D4F' && !fail.bar && fail.rescan && fail.rows === 0, 'the failure state: ' + JSON.stringify(fail));
    bad = await invariants(pg); must(bad.length === 0, bad.join(';'));
    await pg.evaluate(() => window.brxDemo.pickerConnectDone()); await pg.waitForTimeout(200);
    const done = await read(); await pg.close();
    must(!done.box && done.none, 'the picker did not return to its list after the connect state cleared: ' + JSON.stringify(done));
  });
  await step(`${view.name} F258 idle-assigned: the gun MC assigned to this player is offered first`, async () => {
    const pg = await open(view, 'idle-assigned');
    const first = await pg.evaluate(() => (document.querySelector('.taggers .tagrow .nm') || {}).textContent || '');
    await pg.close();
    must(/BRAVO-9498/.test(first), 'the assigned gun is not the first row: ' + JSON.stringify(first));
  });
  // The reason no tap landed: four samples a second apart gave 12 rows, 12 rows, 2 rows, then 5 in a
  // different order. Every row node must survive a repaint, and the signal readings must not move a row.
  await step(`${view.name} F258 idle-noisy: a repaint keeps every row NODE and its order, and still updates the signal`, async () => {
    const pg = await open(view, 'idle-noisy');
    const before = await pg.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.idle .list .tagrow'));
      rows.forEach((e, i) => { e.dataset.mark = 'm' + i; });   // a mark only this node carries
      return { ids: rows.map(e => e.dataset.arg), rssi: rows.map(e => (e.querySelector('.sig b') || {}).textContent) };
    });
    await pg.evaluate(() => window.brxDemo.scanAgain());
    await pg.waitForTimeout(200);
    const after = await pg.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.idle .list .tagrow'));
      return { ids: rows.map(e => e.dataset.arg), marks: rows.map(e => e.dataset.mark), rssi: rows.map(e => (e.querySelector('.sig b') || {}).textContent) };
    });
    await pg.close();
    must(before.ids.length === 7, 'the fixture room is not 7 devices: ' + JSON.stringify(before.ids));
    must(JSON.stringify(after.ids) === JSON.stringify(before.ids), 'the readings moved a row: ' + JSON.stringify([before.ids, after.ids]));
    must(after.marks.every((m, i) => m === 'm' + i), 'a row node was destroyed and rebuilt: ' + JSON.stringify(after.marks));
    must(JSON.stringify(after.rssi) !== JSON.stringify(before.rssi), 'the signal readings never updated, so this step proves nothing: ' + JSON.stringify(before.rssi));
  });
  // F211 (game-test-2026-09-13.md C2): the picker used to sit empty with no message when Bluetooth was off.
  await step(`${view.name} F211 idle-bt-off: the Bluetooth-off message replaces the list, no Android-only buttons`, async () => {
    const pg = await open(view, 'idle-bt-off');
    const r = await pg.evaluate(() => ({
      rows: document.querySelectorAll('.tagrow').length,
      msg: (document.querySelector('.idle .sc.bad') || {}).textContent || '',
      enable: !!document.querySelector('[data-act="onEnableBluetooth"]'),
      settings: !!document.querySelector('[data-act="onOpenBluetoothSettings"]'),
    }));
    await pg.close();
    must(r.rows === 0, 'still shows tagger rows with Bluetooth off: ' + JSON.stringify(r));
    must(/BLUETOOTH IS OFF/.test(r.msg), 'no Bluetooth-off message on screen: ' + JSON.stringify(r));
    must(!r.enable && !r.settings, 'a plugin button appeared off Android: ' + JSON.stringify(r));
  });
  await step(`${view.name} F211 idle-bt-off-android: TURN ON BLUETOOTH + BLUETOOTH SETTINGS are tappable and each does something`, async () => {
    const pg = await open(view, 'idle-bt-off-android');
    const before = await pg.evaluate(() => {
      const sc = parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1) || 1;   // the #frame is scaled: tap targets are judged in DESIGN px, as step #23 does
      const rc = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width / sc, h: r.height / sc }; };
      return { enable: rc('[data-act="onEnableBluetooth"]'), settings: rc('[data-act="onOpenBluetoothSettings"]'), logLen: (window.brx.log || []).length };
    });
    must(before.enable && before.enable.h >= 36, 'TURN ON BLUETOOTH missing or too small a tap target: ' + JSON.stringify(before));
    must(before.settings && before.settings.h >= 36, 'BLUETOOTH SETTINGS missing or too small a tap target: ' + JSON.stringify(before));
    await pg.click('[data-act="onEnableBluetooth"]'); await pg.waitForTimeout(200);
    const after = await pg.evaluate(() => (window.brx.log || []).length);
    await pg.close();
    must(after > before.logLen, 'tapping TURN ON BLUETOOTH left no trace — the control looks dead');
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
  // Bench 2026-09-17: a headset that is off makes the gun drop the link every few seconds. One steady line
  // and a RECONNECT NOW button, never the GUN LINK LOST pill blinking with each cycle.
  await step(`${view.name} flap-1 headset off: one steady line, RECONNECT NOW, and the tap answers`, async () => {
    const pg = await open(view, 'kitted-headset-off');
    const read = () => pg.evaluate(() => { const ps = Array.from(document.querySelectorAll('.chipbar .pill')); const b = document.querySelector('.chipbar [data-act="onReconnectNow"]'); const br = b && b.getBoundingClientRect();
      const pl = document.querySelector('.lobby .plates'); return { pills: ps.map(p => p.textContent.trim()), btn: br ? { h: br.height, hit: Math.max(br.height, parseFloat(getComputedStyle(b, '::after').height) || 0), w: br.width, bottom: br.bottom, vis: getComputedStyle(b).visibility, op: getComputedStyle(document.querySelector('.chipbar')).opacity } : null, platesTop: pl ? pl.getBoundingClientRect().top : null }; });
    const r = await read();
    must(r.pills.includes('HEADSET OFF? TURN THE HEADSET ON.') && r.pills.includes('RECONNECT NOW'), 'line or button missing: ' + JSON.stringify(r.pills));
    must(!r.pills.some(t => /GUN LINK LOST/.test(t)), 'the link-lost pill shows beside the headset line: ' + JSON.stringify(r.pills));
    must(r.btn && r.btn.hit >= 36 && r.btn.w >= 80, 'RECONNECT NOW tap target too small: ' + JSON.stringify(r.btn));
    must(r.platesTop == null || r.btn.bottom <= r.platesTop + 1, 'the button covers the plates: ' + JSON.stringify(r));
    const bad = await invariants(pg); must(bad.length === 0, bad.join(';'));
    await pg.evaluate(() => window.brxDemo.relinkGun()); await pg.waitForTimeout(400);   // the gun takes the link again for a second
    const up = await read(); must(up.pills.includes('HEADSET OFF? TURN THE HEADSET ON.'), 'the line blinks off on a momentary link: ' + JSON.stringify(up.pills));
    await pg.evaluate(() => window.brxDemo.dropGun()); await pg.waitForTimeout(300);
    await pg.screenshot({ path: `${OUT}/${view.name}-headset-off.png` });
    await pg.click('.chipbar [data-act="onReconnectNow"]'); await pg.waitForTimeout(400);
    const after = await read(); await pg.close();
    must(!after.pills.includes('HEADSET OFF? TURN THE HEADSET ON.'), 'RECONNECT NOW left the line up: ' + JSON.stringify(after.pills));
    must(after.pills.some(t => /GUN LINK LOST/.test(t)), 'after the tap the plain link state is back: ' + JSON.stringify(after.pills));
  });
  await step(`${view.name} flap-2 headset off before MC binds: the line and the button show on the CONNECTED screen`, async () => {
    const pg = await open(view, 'connected-headset-off'); const pills = await pg.evaluate(() => Array.from(document.querySelectorAll('.chipbar .pill')).map(p => p.textContent.trim()));
    await pg.screenshot({ path: `${OUT}/${view.name}-headset-off-connected.png` }); await pg.close();
    must(pills.includes('HEADSET OFF? TURN THE HEADSET ON.') && pills.includes('RECONNECT NOW') && !pills.some(t => /GUN LINK LOST/.test(t)), JSON.stringify(pills));
  });
  // Game day 2026-09-19: after 3 flaps BrxLink stops reconnecting for 30 s. One line says what fixes it.
  await step(`${view.name} flap-3 quiet period: the power-cycle line and RECONNECT NOW, and the tap ends it`, async () => {
    const pg = await open(view, 'kitted-headset-off');
    await pg.evaluate(() => window.brxDemo.flapGun(3, true)); await pg.waitForTimeout(300);
    const read = () => pg.evaluate(() => Array.from(document.querySelectorAll('.chipbar .pill')).map(p => p.textContent.trim()));
    const pills = await read();
    await pg.screenshot({ path: `${OUT}/${view.name}-gun-quiet.png` });
    must(pills.includes('GUN KEEPS DROPPING. POWER-CYCLE THE HEADSET, THEN THE GUN RECONNECTS.') && pills.includes('RECONNECT NOW'), JSON.stringify(pills));
    must(!pills.includes('HEADSET OFF? TURN THE HEADSET ON.') && !pills.some(t => /GUN LINK LOST/.test(t)), 'one line only: ' + JSON.stringify(pills));
    const bad = await invariants(pg); must(bad.length === 0, bad.join(';'));
    await pg.click('.chipbar [data-act="onReconnectNow"]'); await pg.waitForTimeout(400);
    const after = await read(); await pg.close();
    must(!after.some(t => /GUN KEEPS DROPPING/.test(t)), 'RECONNECT NOW left the quiet line up: ' + JSON.stringify(after));
  });
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
  // Bench 2026-09-17: the HUD skin is the player's own. One visible switch on every screen, tappable at both widths,
  // and a tap flips the screen both ways mid-match with no diag panel involved.
  for (const st of ['kitted', 'lobby', 'armed', 'live', 'down', 'result']) await step(`${view.name} skin-1 ${st}: the day/night switch is visible, on top and as big as the ⓘ`, async () => {
    const pg = await open(view, st);
    const r = await pg.evaluate(() => { const e = document.getElementById('skin'); if (!e) return null; const b = e.getBoundingClientRect(), cs = getComputedStyle(e);
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const i = document.getElementById('info').getBoundingClientRect();
      return { w: b.width, h: b.height, cssW: e.offsetWidth, cssH: e.offsetHeight, iw: i.width, ih: i.height, right: b.right, bottom: b.bottom, vis: cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.3, onTop: !!top && (top === e || e.contains(top)), label: e.getAttribute('aria-label'), checked: e.getAttribute('aria-checked') }; });
    await pg.close();
    must(r, 'no #skin switch on the page');
    must(r.vis && r.onTop, `switch hidden or covered: ${JSON.stringify(r)}`);
    must(r.cssW >= 36 && r.cssH >= 36 && r.w >= r.iw - 0.5 && r.h >= r.ih - 0.5 && r.right <= view.width && r.bottom <= view.height, `switch too small or off screen: ${JSON.stringify(r)}`);
    must(r.label === 'night' && r.checked === 'false', `a day screen reads night=false: ${JSON.stringify(r)}`);
  });
  await step(`${view.name} skin-2 live: a tap goes night, a second tap goes day, with no diag panel`, async () => {
    const pg = await open(view, 'live');
    const env = () => pg.evaluate(() => ({ env: document.getElementById('frame').dataset.env || '', checked: document.getElementById('skin').getAttribute('aria-checked') }));
    const a = await env();
    await pg.click('#skin'); await pg.waitForTimeout(400); const b1 = await env();
    await pg.screenshot({ path: `${OUT}/${view.name}-skin-live-tapped-night.png` });
    await pg.click('#skin'); await pg.waitForTimeout(400); const c = await env();
    const diagOpen = await pg.evaluate(() => document.getElementById('diag').classList.contains('open'));
    await pg.close();
    must(a.env === '' && a.checked === 'false', 'setup: starts on day ' + JSON.stringify(a));
    must(b1.env === 'night' && b1.checked === 'true', 'first tap did not go night: ' + JSON.stringify(b1));
    must(c.env === '' && c.checked === 'false', 'second tap did not go day: ' + JSON.stringify(c));
    must(!diagOpen, 'the switch opened the diagnostics panel');
  });
  await step(`${view.name} skin-3 night: the live label reads NIGHT OPS only with NIGHT OPS set`, async () => {
    const pg = await open(view, 'live', '&night');
    const r = await pg.evaluate(() => { const l = document.querySelector('.nightlab'); return { env: document.getElementById('frame').dataset.env, lab: l && l.textContent, vis: !!l && getComputedStyle(l).display !== 'none', checked: document.getElementById('skin').getAttribute('aria-checked') }; });
    await pg.evaluate(() => { window.brx.engine.config = { ...window.brx.engine.config, night: false }; window.brx.engine._changed(); }); await pg.waitForTimeout(400);
    const r2 = await pg.evaluate(() => ({ env: document.getElementById('frame').dataset.env, lab: document.querySelector('.nightlab') && document.querySelector('.nightlab').textContent }));
    await pg.close();
    must(r.env === 'night' && r.vis && r.lab === 'NIGHT OPS' && r.checked === 'true', 'NIGHT OPS night: ' + JSON.stringify(r));
    must(r2.env === 'night' && r2.lab === 'NIGHT', 'a player-chosen night without NIGHT OPS: ' + JSON.stringify(r2));
  });
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
    // The pistol rows are derived (SIDEARM_NAMES, top of this file), so an arsenal change moves this step.
    const pg = await open(view, 'loadout-sidearms'); const r = await pg.evaluate(() => ({ chips: Array.from(document.querySelectorAll('.fch')).map(c => c.textContent.trim()), rows: Array.from(document.querySelectorAll('.lrow .nm')).map(e => e.textContent.trim()), roles: Array.from(new Set(Array.from(document.querySelectorAll('.lrow .role')).map(e => e.textContent.trim()))), detail: (document.querySelector('.lodetail .rolechip') || {}).textContent }));
    await pg.close();
    must(SIDEARM_NAMES.length >= 2, 'the pickable pistols collapsed to ' + SIDEARM_NAMES.length + ': a sidearm-only slot 2 cannot mean anything below 2');
    must(r.chips[0] === `SIDEARMS · ${SIDEARM_NAMES.length}` && /^NONE/.test(r.chips[1]) && r.chips.length === 2, 'chips ' + r.chips); must(r.rows.slice().sort().join('|') === SIDEARM_NAMES.slice().sort().join('|'), 'rows ' + r.rows + ' want ' + SIDEARM_NAMES); must(r.roles.length === 1 && r.roles[0] === 'SIDEARM' && r.detail === 'SIDEARM', 'role ' + r.roles + ' / ' + r.detail);
  });
  // A14: the perk is its own slot (Tony 2026-09-04: "you should be able to have AR and pistol and quick switch perk")
  await step(`${view.name} #52 three plates on ONE row (PRIMARY / SECONDARY / PERK), HP·ARMOR in the header, nothing clipped`, async () => {
    const pg = await open(view, 'kitted-full', '', 2000); const r = await pg.evaluate(() => { const ps = Array.from(document.querySelectorAll('.plate.slot')).map(p => ({ k: p.querySelector('.k').textContent.trim(), h: p.querySelector('.h').textContent.trim(), top: Math.round(p.getBoundingClientRect().top), right: Math.round(p.getBoundingClientRect().right), clipped: p.querySelector('.h').scrollWidth > p.querySelector('.h').clientWidth + 1 }));
      const f = document.getElementById('frame').getBoundingClientRect(); return { ps, hpar: (document.querySelector('.lobby .hpar') || {}).textContent || '', fright: Math.round(f.right) }; });
    await pg.close();
    must(r.ps.length === 3 && r.ps.map(p => p.k.replace(/[▸\s]+$/, '')).join('|') === 'PRIMARY|SECONDARY|PERK', 'plates: ' + JSON.stringify(r.ps));
    must(new Set(r.ps.map(p => p.top)).size === 1, 'plates wrapped onto two rows: ' + JSON.stringify(r.ps)); must(r.ps.every(p => p.right <= r.fright), 'a plate leaves the frame');
    // 2026-09-17 (arsenal review): glock is `hidden` now — `fullKit` (app/src/demo.js) picks usp instead.
    must(r.ps[1].h === 'USP-S' && r.ps[2].h === 'QUICK SWITCH', 'AR + pistol + Quick Switch expected: ' + JSON.stringify(r.ps)); must(/HP 45 · ARMOR 70/.test(r.hpar), 'HP·ARMOR moved to the header: ' + r.hpar);
    must(r.ps.every(p => !p.clipped), 'plate title clipped: ' + JSON.stringify(r.ps));
  });
  await step(`${view.name} #53 PERK tab: three tabs on one line, one row per shipped perk + NONE, tapping a perk keeps the second weapon`, async () => {
    const pg = await open(view, 'loadout-perk', '', 2000); const r = await pg.evaluate(() => ({ tabs: Array.from(document.querySelectorAll('.lotab')).map(t => ({ k: t.querySelector('.k').textContent.trim(), top: Math.round(t.getBoundingClientRect().top) })), chips: Array.from(document.querySelectorAll('.fch')).map(c => c.textContent.trim()), rows: document.querySelectorAll('.lrow').length, eq: (document.querySelector('.lrow.eq .nm2 b') || {}).textContent }));
    await pg.click('.lrow[data-arg="perk:body_armor"]'); await pg.waitForTimeout(700);
    const after = await pg.evaluate(() => { const lo = window.brx.engine.state().loadout; return { perk: lo.perk && lo.perk.perk_id, sec: lo.secondary && lo.secondary.weapon_id, chip: (document.querySelector('.ackchip') || {}).textContent || '' }; }); await pg.close();
    must(r.tabs.map(t => t.k).join('|') === 'PRIMARY|SECONDARY|PERK' && new Set(r.tabs.map(t => t.top)).size === 1, 'tabs: ' + JSON.stringify(r.tabs));
    // S50 (2026-09-17) took the pool from 5 to 7 on paper, but `motion_tracker` and `second_wind` are
    // `hidden` until their node halves exist, so the phone ships 5. This step hardcoded 7 and went red
    // the moment they were hidden; Mission Control's own perk test hit the identical drift the same day.
    // Derive it from `demo-catalog.js`, the artefact the PHONE actually reads (editing perks.json alone
    // would not move it), so unhiding a perk moves this step with it instead of breaking it.
    const wantPerks = DEMO_PERKS.filter(p => !p.hidden).length;
    must(wantPerks >= 4, 'the perk catalogue collapsed to ' + wantPerks + ': this step cannot mean anything below 4');
    must(r.chips[0] === 'PERKS · ' + wantPerks && /^NONE/.test(r.chips[1]), 'chips ' + r.chips); must(r.rows === wantPerks && r.eq === 'QUICK SWITCH', 'rows/equipped: ' + r.rows + ' want ' + wantPerks + ' ' + r.eq);
    // 2026-09-17 (arsenal review): glock is `hidden` now — `fullKit` (app/src/demo.js) picks usp instead.
    must(after.perk === 'body_armor' && after.sec === 'usp', 'a perk pick must not displace the pistol: ' + JSON.stringify(after)); must(/EQUIPPED/.test(after.chip) && !/DROPPED/.test(after.chip), 'ack chip: ' + after.chip);
  });
  await step(`${view.name} #54 Easy Reload is GONE from the perk picker (S50: it is an accessibility override, not a perk)`, async () => {
    // It used to sit in this list and take the ALT button, which cost a player their second weapon -- so a child
    // who needed it paid twice. This step proves the retirement from the screen the player actually sees: the row
    // is absent, every shipped perk is present, and a two-weapon kit raises no conflict on any of them.
    const pg = await open(view, 'loadout-perk-conflict', '', 2400);
    const r = await pg.evaluate(() => ({
      ids: Array.from(document.querySelectorAll('.lrow[data-arg^="perk:"]')).map(e => e.dataset.arg.slice(5)),
      warned: Array.from(document.querySelectorAll('.lrow.warn[data-arg^="perk:"]')).map(e => e.dataset.arg),
      sec: window.brx.engine.state().loadout.secondary && window.brx.engine.state().loadout.secondary.weapon_id,
    })); await pg.close();
    must(!r.ids.includes('easy_reload'), 'Easy Reload is still in the perk picker: ' + JSON.stringify(r.ids));
    must(r.ids.length >= 5, 'the perk list is too short to be the shipped catalogue: ' + JSON.stringify(r.ids));
    must(r.sec === 'smg' && r.warned.length === 0, 'a two-weapon kit must raise no perk conflict now: ' + JSON.stringify(r));
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
    await pg.goto(`http://127.0.0.1:${PORT}/utility.html?stage`); await pg.waitForTimeout(1600);
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
    await pg.goto(`http://127.0.0.1:${PORT}/utility.html?stage`); await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); } catch {} }); await pg.reload(); await pg.waitForTimeout(1500);
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
  // A41 (field 2026-09-12): the ONLY exit from utility mode was the same undiscoverable ⓘ ×7 gesture as
  // the settings drawer, with ZERO feedback on a single tap, and no MC message could reach a stuck phone
  // at all. #66-#68 pin the three-part fix: visible tap progress, a plain HOLD-TO-EXIT for a phone
  // nobody has claimed as a station yet, and a real MC-side release that works even on a deployed one.
  await step(`${view.name} #66 A41: ⓘ shows tap progress and clears it; HOLD TO EXIT shows unassigned, hides once MC-armed`, async () => {
    const pg = await b.newPage({ viewport: { width: 411, height: 891 } }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/utility.html?stage`); await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); } catch {} }); await pg.reload(); await pg.waitForTimeout(1500);
    for (let i = 0; i < 3; i++) await pg.click('#info');
    const prog = await pg.evaluate(() => ({ hidden: document.getElementById('infoProg').hidden, text: document.getElementById('infoProg').textContent }));
    for (let i = 0; i < 4; i++) await pg.click('#info'); await pg.waitForTimeout(150);   // taps 4-7: the drawer opens
    const afterOpen = await pg.evaluate(() => ({ progHidden: document.getElementById('infoProg').hidden, cfgHidden: document.getElementById('cfg').hidden }));
    await pg.click('#cfgClose'); await pg.waitForTimeout(100);
    const exitVisible = await pg.evaluate(() => !document.getElementById('exitHud').hidden);
    await pg.evaluate(() => window.brxUtility.mcMessage('station_config', { kind: 'respawn', team: 'blue', id: 2 })); await pg.waitForTimeout(300);
    const exitHiddenWhenArmed = await pg.evaluate(() => document.getElementById('exitHud').hidden);
    await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); } catch {} }); await pg.close();
    must(perr.length === 0, perr.join('|'));
    must(!prog.hidden && prog.text === '3', 'tap progress after 3 taps: ' + JSON.stringify(prog));
    must(!afterOpen.cfgHidden && afterOpen.progHidden, 'drawer opened on tap 7 and the progress badge cleared: ' + JSON.stringify(afterOpen));
    must(exitVisible, 'HOLD TO EXIT is on screen for a phone nobody has assigned/armed yet');
    must(exitHiddenWhenArmed, 'HOLD TO EXIT hides the moment MC arms this phone as a real station');
  });
  await step(`${view.name} #67 A41: HOLD TO EXIT (unarmed) resets brx.role to hud and leaves utility.html for the HUD`, async () => {
    const pg = await b.newPage({ viewport: { width: 411, height: 891 } }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/utility.html?stage`); await pg.evaluate(() => { try { localStorage.setItem('brx.role', 'utility'); localStorage.removeItem('brx.utility'); } catch {} }); await pg.reload(); await pg.waitForTimeout(1500);
    await pg.clock.install();
    // The old implementation fired the action FROM requestAnimationFrame. Freeze visual frames so this
    // step proves the semantic hold deadline is independent of rendering load; old code times out here.
    await pg.evaluate(() => { window.requestAnimationFrame = () => 0; });
    const box = await pg.evaluate(() => { const r = document.getElementById('exitHud').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await pg.mouse.move(box.x, box.y); await pg.mouse.down();
    await Promise.all([pg.waitForURL(/index\.html\?hud/, { timeout: 5000 }), pg.clock.runFor(1400)]); await pg.mouse.up();
    const role = await pg.evaluate(() => { try { return localStorage.getItem('brx.role'); } catch (_) { return null; } });
    const url = pg.url();
    await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); localStorage.removeItem('brx.role'); } catch {} }).catch(() => {});
    await pg.close();
    must(perr.length === 0, perr.join('|'));
    must(role === 'hud', 'brx.role after HOLD TO EXIT: ' + role);
    must(/index\.html/.test(url) && /hud/.test(url), 'left utility.html for the HUD: ' + url);
  });
  await step(`${view.name} #67a A41: HOLD TO EXIT cancels on release, drag-away and deployment; keyboard hold works`, async () => {
    const pg = await b.newPage({ viewport: { width: 411, height: 891 } }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/utility.html?stage`); await pg.evaluate(() => { try { localStorage.setItem('brx.role', 'utility'); localStorage.removeItem('brx.utility'); } catch {} }); await pg.reload(); await pg.waitForTimeout(1500);
    await pg.clock.install();
    const box = await pg.evaluate(() => { const r = document.getElementById('exitHud').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await pg.mouse.move(box.x, box.y); await pg.mouse.down(); await pg.clock.runFor(250);
    const partialFill = await pg.$eval('#exitFill', el => parseFloat(el.style.width || '0'));
    await pg.mouse.up();
    const resetFill = await pg.$eval('#exitFill', el => el.style.width);
    await pg.clock.runFor(1100);
    must(/utility\.html/.test(pg.url()), 'an early release must cancel the exit: ' + pg.url());
    must(partialFill > 0 && partialFill < 100, 'a partial hold must show visible progress: ' + partialFill);
    must(resetFill === '0%', 'cancelling a hold must clear visible progress: ' + resetFill);
    await pg.dispatchEvent('#exitHud', 'pointerdown', { pointerId: 7, pointerType: 'touch', clientX: box.x, clientY: box.y });
    await pg.dispatchEvent('#exitHud', 'pointermove', { pointerId: 7, pointerType: 'touch', clientX: 1, clientY: 1 });
    await pg.clock.runFor(1300);
    must(/utility\.html/.test(pg.url()), 'dragging a touch away must cancel the exit: ' + pg.url());
    await pg.mouse.move(box.x, box.y); await pg.mouse.down(); await pg.clock.runFor(250);
    // MC assignment is authoritative before an awaited native advertise call lets render() update `hidden`.
    // Pin that real skew: state says deployed while the DOM still says the quick exit is visible.
    await pg.evaluate(() => { window.brxUtility.settings.mcArmed = { game: 3 }; }); await pg.clock.runFor(1100);
    must(/utility\.html/.test(pg.url()), 'authoritative MC-armed state must cancel before the DOM hide catches up: ' + pg.url());
    await pg.mouse.up(); await pg.evaluate(() => { window.brxUtility.settings.mcArmed = null; window.brxUtility.render(); });
    await pg.mouse.move(box.x, box.y); await pg.mouse.down(); await pg.clock.runFor(250);
    await pg.evaluate(() => window.brxUtility.mcMessage('station_config', { kind: 'respawn', team: 'blue', id: 2 })); await pg.clock.runFor(1100);
    must(/utility\.html/.test(pg.url()), 'a hold begun before MC arms the station must not exit after deployment: ' + pg.url());
    await pg.mouse.up();
    await pg.evaluate(async () => { await window.brxUtility.stopAdvert(); window.brxUtility.settings.mcArmed = null; window.brxUtility.render(); });
    await pg.focus('#exitHud'); await pg.keyboard.down('Space');
    await Promise.all([pg.waitForURL(/index\.html\?hud/, { timeout: 5000 }), pg.clock.runFor(1400)]); await pg.keyboard.up('Space');
    const role = await pg.evaluate(() => { try { return localStorage.getItem('brx.role'); } catch (_) { return null; } });
    await pg.close();
    must(perr.length === 0, perr.join('|'));
    must(role === 'hud', 'keyboard HOLD TO EXIT sets brx.role to hud: ' + role);
  });
  await step(`${view.name} #67b A41: assistive button activation exits without weakening a physical click`, async () => {
    const pg = await b.newPage({ viewport: { width: 411, height: 891 } }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/utility.html?stage`); await pg.evaluate(() => { try { localStorage.setItem('brx.role', 'utility'); localStorage.removeItem('brx.utility'); } catch {} }); await pg.reload(); await pg.waitForTimeout(1500);
    await pg.click('#exitHud'); await pg.waitForTimeout(100);
    must(/utility\.html/.test(pg.url()), 'a physical click must not bypass the hold: ' + pg.url());
    await Promise.all([pg.waitForURL(/index\.html\?hud/, { timeout: 5000 }), pg.dispatchEvent('#exitHud', 'click', { detail: 0 })]);
    const role = await pg.evaluate(() => { try { return localStorage.getItem('brx.role'); } catch (_) { return null; } });
    await pg.close();
    must(perr.length === 0, perr.join('|'));
    must(role === 'hud', 'assistive activation sets brx.role to hud: ' + role);
  });
  await step(`${view.name} #68 A41: an MC release (control{cmd:release_utility}) does what BACK TO HUD does, even on a DEPLOYED station`, async () => {
    const pg = await b.newPage({ viewport: { width: 411, height: 891 } }); const perr = []; pg.on('pageerror', e => perr.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/utility.html?stage`); await pg.evaluate(() => { try { localStorage.setItem('brx.role', 'utility'); localStorage.removeItem('brx.utility'); } catch {} }); await pg.reload(); await pg.waitForTimeout(1500);
    // Armed FIRST: the point of the release is that MC can reach a phone the plain HOLD TO EXIT no
    // longer shows (#66 already proves that hiding); the seven-tap gate is still the only PHYSICAL way in.
    await pg.evaluate(() => window.brxUtility.mcMessage('station_config', { kind: 'respawn', team: 'blue', id: 2 })); await pg.waitForTimeout(300);
    const armedFirst = await pg.evaluate(() => document.getElementById('exitHud').hidden);
    await Promise.all([pg.waitForURL(/index\.html\?hud/, { timeout: 5000 }), pg.evaluate(() => window.brxUtility.mcMessage('control', { cmd: 'release_utility' }))]);
    const role = await pg.evaluate(() => { try { return localStorage.getItem('brx.role'); } catch (_) { return null; } });
    await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); localStorage.removeItem('brx.role'); } catch {} }).catch(() => {});
    await pg.close();
    must(perr.length === 0, perr.join('|'));
    must(armedFirst, 'sanity: this station is MC-armed (HOLD TO EXIT hidden) before the release is tested');
    must(role === 'hud', 'brx.role after the MC release: ' + role);
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
    await pg.goto(`http://127.0.0.1:${PORT}/utility.html?stage`); await pg.evaluate(() => { try { localStorage.removeItem('brx.utility'); localStorage.removeItem('brx.station.control'); } catch {} }); await pg.reload();
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
    await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=idle`); await pg.waitForTimeout(500);
    await pg.evaluate(() => localStorage.setItem('brx.history', JSON.stringify([{ session: 'A', kills: 3, deaths: 1 }, { session: 'A', kills: 2, deaths: 2 }, { session: 'B', kills: 9, deaths: 0 }, { kills: 5, deaths: 5 }])));
    await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=result`); await pg.waitForTimeout(1200); await pg.evaluate(() => { window.brx.hud.sessionId = 'A'; }); await pg.waitForTimeout(3200);
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
  await step(`${view.name} kill-name KILL CONFIRMED names the victim by gamertag, never by player_id (field 2026-09-17)`, async () => {
    // MC's wire: `victim` is a player_id. The banner resolves it; a bare id on screen is the bug.
    const pg = await open(view, 'live', '', 3000);
    const r = await pg.evaluate(async () => { const e = window.brx.engine; const foe = e.roster.find(x => x.player_id !== (e.player && e.player.player_id));
      e.onMcMessage({ kind: 'feedback', body: { player_id: e.player.player_id, kind: 'kill', t: Date.now(), victim: foe.player_id, victim_team: foe.team_id } });
      for (let i = 0; i < 30 && !document.querySelector('.mo.kill .vt'); i++) await new Promise(res => setTimeout(res, 50));
      const vt = document.querySelector('.mo.kill .vt'); return { txt: vt ? vt.textContent.trim() : null, id: foe.player_id, display: foe.display }; });
    await pg.close();
    must(r.txt, 'no kill banner'); must(r.txt.includes(r.display.toUpperCase()), `banner says ${JSON.stringify(r.txt)}, not ${r.display}`); must(!r.txt.includes(r.id), `banner shows the player_id: ${r.txt}`);
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

  // ---------- 2026-09-11 field session, Block A (docs/archive/game-test-2026-09-11.md) ----------
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
  // Bench 2026-09-18 (Tony): on YOUR team's card the left edge carries the team colour, and the names sat
  // hard against it -- twice over, at 9px of padding and then at 15px. What a person reads is not the padding
  // number: it is the clear space between the INNER face of that coloured edge and the first glyph, and a
  // 13px name in a ~17px line box needs its own line-height of it before the column stops looking pinned to
  // a rule. The chip leans (skewX -12deg), so its bounding box juts further left than the padding and left
  // the same edge ragged -- the chip and the list must share one left edge, not two.
  await step(`${view.name} A24 result-win-team: the team card's contents clear the coloured left edge, on one left edge`, async () => {
    const pg = await open(view, 'result-win-team');
    const r = await pg.evaluate(() => {
      const scale = parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1);
      const card = document.querySelector('.result .rteam.mine'), cs = getComputedStyle(card), cr = card.getBoundingClientRect();
      // the coloured edge is the border plus any inset rail painted behind it (box-shadow does not take space)
      let rail = 0;
      if (/inset/.test(cs.boxShadow || '')) {
        const n = (cs.boxShadow.replace(/rgba?\([^)]*\)/g, '').match(/-?[\d.]+(?=px)/g) || []);
        rail = Math.abs(parseFloat(n[0] || 0));
      }
      const lefts = {};
      for (const [k, sel] of [['chip', '.tm'], ['held', '.thold'], ['header', '.tph span'], ['name', '.tp .pn']]) {
        const e = card.querySelector(sel); lefts[k] = e ? (e.getBoundingClientRect().left - cr.left) / scale : null;
      }
      return { edge: parseFloat(cs.borderLeftWidth) + rail, lefts };
    });
    await pg.close();
    const vals = Object.entries(r.lefts);
    must(vals.every(([, v]) => v != null), 'a card part is missing: ' + JSON.stringify(r.lefts));
    const CLEAR = 17, SUB = 0.5;   // one line-height of the 13px names; the frame's scale transform costs a sub-pixel
    for (const [k, v] of vals) must(v - r.edge >= CLEAR - SUB,
      `${k} sits ${v.toFixed(1)}px from the card edge, only ${(v - r.edge).toFixed(1)}px clear of the ${r.edge}px coloured edge -- a 13px name needs its own line-height: ${JSON.stringify(r.lefts)}`);
    const spread = Math.max(...vals.map(([, v]) => v)) - Math.min(...vals.map(([, v]) => v));
    must(spread <= 1.5, `the card's left edge is ragged by ${spread.toFixed(1)}px -- the leaning chip and the list must line up: ${JSON.stringify(r.lefts)}`);
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
  // ---------- A38 x A39 (T2 integration): SITTING OUT, and the READY UP button that must not be on it ----------
  // T2-A gave the LOBBY screen its own READY UP (a player whose kit window closed before they tapped);
  // T2-B gave a benched phone a KITTED-shaped state. Both facts are true, and the screen is the only
  // place their product is visible: there must be no way, from either screen a benched phone can land
  // on, to put yourself back into a game the host took you out of.
  for (const st of ['standby', 'standby-from-lobby']) {
    await step(`${view.name} A38 ${st}: SITTING OUT, and NO ready control anywhere on it`, async () => {
      const pg = await open(view, st);
      const r = await pg.evaluate(() => ({
        txt: (document.querySelector('.lobby .setup .t') || {}).textContent || null,
        sub: (document.querySelector('.lobby .setup .s') || {}).textContent || null,
        // every control on screen, by the words a player reads and the action it would fire
        acts: Array.from(document.querySelectorAll('#hud [data-act]')).map(e => e.getAttribute('data-act')),
        readyBtns: document.querySelectorAll('.foot .ready').length,
        body: document.body.innerText.replace(/\s+/g, ' '),
        standby: window.brx.engine.state().standby, phase: window.brx.engine.state().phase,
      }));
      const bad = await invariants(pg);
      await pg.close();
      must(r.standby === true, 'the stage never actually benched the engine: ' + JSON.stringify(r));
      must(r.txt === 'SITTING OUT \u2014 the host puts you back', 'copy: ' + r.txt);
      // T2 review S3: this assertion used to pin the OPPOSITE, and the copy it pinned was FALSE. STAND
      // DOWN is legal all the way through `lobby`, by which point the push has usually written the head,
      // and the standby branch deliberately touches nothing on the gun -- the tagger still fires, still
      // takes hits and still registers them. A player who read "your gun is not armed" walked back onto
      // the field believing they were inert. (The cure is NOT a $CLEAR to make the old line true: that
      // leaves the gun with no $SIR table and it cannot be hit at all until re-armed, F11.)
      must(!/not armed/i.test(r.sub || ''), 'the sub-line still claims the tagger is inert: ' + r.sub);
      must(/still live/i.test(r.sub || ''), 'the sub-line must say the tagger is STILL LIVE: ' + r.sub);
      must(!/READY UP|READY \u2713|STANDING BY/.test(r.body), 'a ready control is on the SITTING OUT screen: ' + r.body.slice(0, 200));
      must(r.readyBtns === 0, 'a .ready button rendered on the SITTING OUT screen');
      must(!r.acts.includes('onReady'), 'an onReady control is tappable while benched: ' + r.acts.join(','));
      must(bad.length === 0, bad.join(' ; '));
    });
  }
  await step(`${view.name} A38: the engine refuses a ready tap while benched, however it is reached`, async () => {
    // The screen not drawing the button is one guard; `engine.setReady` refusing is the other. Driven
    // through the app's OWN handler (`hud.h.onReady`, what a real tap fires) rather than the engine, so
    // this fails if either the handler or the engine stops refusing.
    const pg = await open(view, 'standby');
    const r = await pg.evaluate(() => { const before = window.brx.engine.state().ready;
      window.brx.hud.h.onReady(); return { before, after: window.brx.engine.state().ready }; });
    await pg.close();
    must(r.before === false && r.after === false, 'a benched phone readied up: ' + JSON.stringify(r));
  });
  await step(`${view.name} #24 night: the kit plates stay visible`, async () => {
    const pg = await open(view, 'kitted', '&night'); const r = await pg.evaluate(() => Array.from(document.querySelectorAll('.plate')).map(p => getComputedStyle(p).backgroundColor)); await pg.close();
    must(r.length >= 3 && r.every(c => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'), 'transparent plates: ' + r.join(' '));
  });
  await step(`${view.name} #24b night: NO weapon photo is lit anywhere (it is a position giveaway)`, async () => {
    // Night mode exists so a phone does not tell an opponent where its owner is standing. The night rules
    // used to say `background-image:none`, which silently stopped working the moment the missing-art
    // fallback (2026-09-18) made weapon art a real <img>: bright weapon photos then lit the kit plate, the
    // lobby row, the detail pane and the switching takeover, and nothing failed.
    // ⚠ An earlier version of this check ran on the LIVE hud, which renders no weapon art at all, so it
    // passed with the rule deleted -- a guard that could not fail. It runs on the screens that HAVE art,
    // and it audits the ELEMENT rather than the rule, so the next way someone paints a picture here trips
    // it too. Break it by deleting the `[data-env="night"] .wpic` rule in app/www/index.html.
    const lit = [];
    for (const stage of ['kitted', 'loadout-primary', 'loadout-secondary']) {   // NOT loadout-perk: perks render a glyph, never weapon art
      const pg = await open(view, stage, '&night', 2000);
      const seen = await pg.evaluate(() => Array.from(document.querySelectorAll('.wpic, .wpicfb'))
        .filter(e => { const st = getComputedStyle(e), r = e.getBoundingClientRect();
                       return st.display !== 'none' && st.visibility !== 'hidden' && +st.opacity > 0.05 && r.width > 2 && r.height > 2; })
        .map(e => e.className + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
      const any = await pg.evaluate(() => document.querySelectorAll('.wpic, .wpicfb').length);
      await pg.close();
      if (!any) { lit.push(stage + ': NO art elements at all, this stage cannot prove anything'); continue; }
      for (const x of seen) lit.push(stage + ' ' + x);
    }
    must(lit.length === 0, 'weapon art lit at night: ' + lit.join('; '));
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
// ---------- F145 (field 2026-09-12): the rack row's ⓘ needs its own real hit target ----------
await step('F145 loadout-primary: the ⓘ has a ≥44px hit target that reads the row without equipping it', async () => {
  const pg = await open(VIEWS[0], 'loadout-primary');
  // A real tap 2px OUTSIDE the icon's 40px visual box (the old edge) but inside the new invisible 44px zone —
  // a synthetic `el.click()` on the icon itself would pass even with no expanded target at all (it bypasses
  // real hit-testing), which is exactly the false-pass shape this suite exists to avoid.
  const before = await pg.evaluate(() => document.querySelectorAll('.lrow .linfo').length);
  must(before > 1, 'need at least two rack rows for this check');
  // #frame is scaled to fit the viewport (`fit()` in hud.js): a rect from getBoundingClientRect() is already
  // in rendered px, so the "1 design px past the edge" offset — and the sanity check on the box itself —
  // must scale with it, not assume a literal 40/44 (design 2026-09-12).
  const at = await pg.evaluate(() => { const row = document.querySelectorAll('.lrow')[1]; const icon = row.querySelector('.linfo'); const r = icon.getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(document.getElementById('frame')).transform.split(',')[3] || 1) || 1;
    return { arg: row.dataset.arg, x: r.right + scale, y: r.top + r.height / 2, hitSize: r.width, scale }; });
  must(at.hitSize <= 40 * at.scale + 1, 'the visual icon box grew past its design 40px — this check assumes it stayed the same and only the tap zone widened: ' + JSON.stringify(at));
  await pg.mouse.click(at.x, at.y);
  await pg.waitForTimeout(200);
  const r = await pg.evaluate(() => ({ focus: window.brx.hud.lo.focus, pendingPick: window.brx.engine.state().pendingPick }));
  await pg.close();
  must(r.focus === at.arg, `a tap just past the visual icon edge did not open its detail (focus: ${r.focus}, wanted ${at.arg})`);
  must(!r.pendingPick, 'the edge tap equipped the row instead of reading it: ' + JSON.stringify(r.pendingPick));
});
await step('F145 loadout-primary: a tap on the row body (clear of the icon) still equips', async () => {
  const pg = await open(VIEWS[0], 'loadout-primary');
  const at = await pg.evaluate(() => { const row = document.querySelectorAll('.lrow')[4]; row.scrollIntoView({ block: 'center' }); const nm = row.querySelector('.nm'); const r = nm.getBoundingClientRect();
    return { arg: row.dataset.arg, x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await pg.mouse.click(at.x, at.y);
  await pg.waitForTimeout(200);
  const r = await pg.evaluate(() => window.brx.engine.state().pendingPick);
  await pg.close();
  must(r && r.id === at.arg.slice(7), `the row body no longer equips on tap: ${JSON.stringify(r)}, wanted ${at.arg}`);
});

// ---------- F137 (field 2026-09-12): MC LINKED, one line, inside its box ----------
await step('F137 connected-linked: MC LINKED fits on one line and stays inside the box at every checked width', async () => {
  for (const view of [VIEWS[0], VIEWS[1], { name: 'design', width: 844, height: 390 }]) {
    const pg = await open(view, 'connected-linked');
    const r = await pg.evaluate(() => { const e = document.querySelector('.mclinked'); if (!e) return null; const u = e.querySelector('.unskew');
      const eb = e.getBoundingClientRect(), ub = u.getBoundingClientRect();
      return { oneLine: u.scrollWidth <= u.clientWidth + 1, inside: ub.left >= eb.left - 0.5 && ub.right <= eb.right + 0.5 }; });
    await pg.close();
    must(r, `${view.name}: MC LINKED never rendered — a sig field it depends on may have regressed out of the signature`);
    must(r.oneLine, `${view.name}: MC LINKED wrapped to a second line`);
    must(r.inside, `${view.name}: the text ran past the box`);
  }
});

// ---------- F156/F135/ledger#2+#31 (field 2026-09-12): SCAN QR + the typed address reachable in every phase ----------
await step('F156 idle-diag: the ⓘ panel carries SCAN QR + the address field BEFORE a gun is linked', async () => {
  const pg = await open(VIEWS[0], 'idle-diag');
  const r = await pg.evaluate(() => { const d = document.getElementById('diag'), i = document.getElementById('mcurl'), q = document.querySelector('[data-act="onScanQr"]');
    return { open: d.classList.contains('open'), input: !!i, insideDiag: !!(i && d.contains(i)), scan: !!q, scanInsideDiag: !!(q && d.contains(q)), setUrl: typeof window.brx.hud.h.onSetUrl }; });
  await pg.close();
  must(r.open, 'the ⓘ panel never opened');
  must(r.input && r.insideDiag, 'no #mcurl address field in the diag panel while idle (no gun linked yet): ' + JSON.stringify(r));
  must(r.scan && r.scanInsideDiag, 'no SCAN QR button in the diag panel while idle: ' + JSON.stringify(r));
});
await step('F156 kitted/live: the ⓘ panel still carries SCAN QR + the address field after a gun is linked', async () => {
  for (const stage of ['diag', 'diag-live']) {
    const pg = await open(VIEWS[0], stage, '', 5200);
    const r = await pg.evaluate(() => { const d = document.getElementById('diag'); return { input: !!d.querySelector('#mcurl'), scan: !!d.querySelector('[data-act="onScanQr"]') }; });
    await pg.close();
    must(r.input && r.scan, `${stage}: join controls missing from the diag panel: ` + JSON.stringify(r));
  }
});
await step('F156 connected-diag: only ONE #mcurl exists — the pre-join screen steps aside for the diag panel', async () => {
  // Before this fix the pre-join screen's own copy (same id, `onSetUrl` reads it by that id — app.js is
  // another lane) would sit in the DOM at the same time as the diag panel's, and `getElementById('mcurl')`
  // would silently read whichever one document order favours — not necessarily the one the player is typing into.
  const pg = await open(VIEWS[0], 'connected-diag');
  const r = await pg.evaluate(() => { const all = document.querySelectorAll('#mcurl'); const d = document.getElementById('diag');
    return { count: all.length, insideDiag: all.length === 1 && d.contains(all[0]), lobbyNote: (document.querySelector('.lobby .note.join') || {}).textContent || '' }; });
  await pg.close();
  must(r.count === 1, `expected exactly one #mcurl in the DOM, found ${r.count}`);
  must(r.insideDiag, 'the surviving #mcurl is not the diag panel\'s own — it is the stale pre-join copy');
  must(/ⓘ panel/.test(r.lobbyNote), 'the pre-join screen does not say where the join controls moved to: ' + r.lobbyNote);
});
await step('F156 connected: closing the ⓘ panel restores the pre-join screen\'s own copy', async () => {
  const pg = await open(VIEWS[0], 'connected-diag');
  await pg.click('[data-act="onCloseDiag"].close');   // the panel sits ABOVE #info (z-index 6 vs 5) while open, so this is the real close path
  await pg.waitForTimeout(150);
  const r = await pg.evaluate(() => { const d = document.getElementById('diag'); return { open: d.classList.contains('open'), count: document.querySelectorAll('#mcurl').length, outsideDiag: !!(document.getElementById('mcurl') && !d.contains(document.getElementById('mcurl'))) }; });
  await pg.close();
  must(!r.open, 'the panel did not close');
  must(r.count === 1 && r.outsideDiag, 'the pre-join screen did not get its own #mcurl back: ' + JSON.stringify(r));
});
// ---------- Polish-loop pass 1 (2026-09-12): armed/live gate a mid-match CONNECT / SCAN QR behind a second tap ----------
await step('polish-1 diag-live: CONNECT is a two-tap confirm mid-match, and reverts if not confirmed', async () => {
  const pg = await open(VIEWS[0], 'diag-live', '', 5200);
  await pg.evaluate(() => { window.__calls = 0; window.brx.hud.h.onSetUrl = () => { window.__calls++; }; });
  const before = await pg.evaluate(() => (document.getElementById('dg-mcjoinhint') || {}).textContent || '');
  await pg.click('[data-act="onSetUrl"]');
  await pg.waitForTimeout(80);
  const afterOne = await pg.evaluate(() => ({ calls: window.__calls, hint: (document.getElementById('dg-mcjoinhint') || {}).textContent || '' }));
  await pg.click('[data-act="onSetUrl"]');
  await pg.waitForTimeout(80);
  const afterTwo = await pg.evaluate(() => ({ calls: window.__calls, hint: (document.getElementById('dg-mcjoinhint') || {}).textContent || '' }));
  await pg.close();
  must(!/TAP AGAIN/.test(before), 'the warning is showing before any tap: ' + before);
  must(afterOne.calls === 0, 'the first tap mid-match reached onSetUrl instead of being swallowed');
  must(/TAP AGAIN/.test(afterOne.hint) && /MISSION CONTROL LINK MID-MATCH/.test(afterOne.hint), 'no mid-match warning after the first tap: ' + afterOne.hint);
  must(afterTwo.calls === 1, 'the second tap within the window did not reach onSetUrl: ' + JSON.stringify(afterTwo));
  must(!/TAP AGAIN/.test(afterTwo.hint), 'the warning did not clear once confirmed: ' + afterTwo.hint);
});
// Polish-loop pass 3 (UX, a11y HIGH): the hint text changing in place is the ONLY signal a first tap did
// anything while armed/live -- with no live region a screen-reader user hears nothing and it reads as dead.
await step('polish-3 diag-live: the two-tap hint is an assertive live region', async () => {
  const pg = await open(VIEWS[0], 'diag-live', '', 5200);
  const r = await pg.evaluate(() => { const el = document.getElementById('dg-mcjoinhint'); return el ? { role: el.getAttribute('role'), live: el.getAttribute('aria-live') } : null; });
  await pg.close();
  must(r, 'no #dg-mcjoinhint in the diag panel');
  must(r.role === 'status', 'missing role="status": ' + JSON.stringify(r));
  must(r.live === 'assertive', 'missing/weak aria-live (must be assertive, not polite): ' + JSON.stringify(r));
});
// ---------- Bench 2026-09-17 (match e6cbe0ae09): RELINK GUN mid-match ----------
// A press took the phone off the gun with no warning, and a second press during the relink did nothing
// visible. The REAL BrxLink runs here, over a fake plugin whose connect the step releases by hand, so the
// button state comes from `link.relinking` through app.js's diag push, exactly as on the phone.
const fakeGunPlugin = pg => pg.evaluate(() => {
  const l = window.brx.link, w = window.__ble = { disconnects: 0, connects: 0, release: null };
  l.ble = { initialize: async () => {}, disconnect: async () => { w.disconnects++; }, startNotifications: async () => {}, writeWithoutResponse: async () => {},
    connect: () => { w.connects++; return new Promise(res => { w.release = res; }); } };
  l.deviceId = 'A'; l.connected = true; l.advert = { name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' };
});
const relinkView = pg => pg.evaluate(() => { const b = document.querySelector('#diag [data-act="onReconnectGun"]'), h = document.getElementById('dg-gunhint'), d = document.getElementById('diag');
  return { label: b.textContent, disabled: b.disabled, hint: h ? h.textContent : '', hintFits: !h || h.scrollWidth <= h.clientWidth + 1, hintInPanel: !h || !h.textContent || h.getBoundingClientRect().right <= d.getBoundingClientRect().right + 1,
    live: h ? h.getAttribute('aria-live') : null, ...window.__ble }; });
for (const view of VIEWS) {
  await step(`${view.name} relink diag-live: RELINK GUN mid-match needs a confirm tap, then reads RELINKING… and ignores presses`, async () => {
    const pg = await open(view, 'diag-live', '', 5200);
    await fakeGunPlugin(pg);
    const before = await relinkView(pg);
    await pg.click('#diag [data-act="onReconnectGun"]'); await pg.waitForTimeout(120);
    const one = await relinkView(pg);
    await pg.click('#diag [data-act="onReconnectGun"]'); await pg.waitForTimeout(400);
    const two = await relinkView(pg);
    await pg.click('#diag [data-act="onReconnectGun"]', { force: true }); await pg.waitForTimeout(400);
    const three = await relinkView(pg);
    await pg.evaluate(() => window.__ble.release()); await pg.waitForTimeout(600);
    const up = await relinkView(pg);
    await pg.screenshot({ path: `${OUT}/${view.name}-relink-live-done.png` });
    await pg.close();
    must(before.label === 'RELINK GUN' && !before.hint, 'before any tap: ' + JSON.stringify(before));
    must(one.disconnects === 0, 'the first tap mid-match took the phone off the gun: ' + JSON.stringify(one));
    must(one.hint === 'RELINK TAKES THE PHONE OFF THE GUN FOR A FEW SECONDS. TAP AGAIN TO RELINK.' && one.live === 'assertive', 'no confirm line after the first tap: ' + JSON.stringify(one));
    must(one.hintFits && one.hintInPanel, 'the confirm line does not fit the panel: ' + JSON.stringify(one));
    must(two.disconnects === 1 && two.connects === 1, 'the confirm tap did not relink at once: ' + JSON.stringify(two));
    must(two.label === 'RELINKING…' && two.disabled && !two.hint, 'the button does not show the running relink: ' + JSON.stringify(two));
    must(three.disconnects === 1 && three.connects === 1 && three.label === 'RELINKING…', 'a press during the relink did something: ' + JSON.stringify(three));
    must(up.label === 'RELINK GUN' && !up.disabled, 'the button did not come back once the link was up: ' + JSON.stringify(up));
  });
}
await step('relink diag-live: an unconfirmed RELINK GUN reverts after a few seconds', async () => {
  const pg = await open(VIEWS[0], 'diag-live', '', 5200);
  await fakeGunPlugin(pg);
  await pg.click('#diag [data-act="onReconnectGun"]'); await pg.waitForTimeout(4600);
  const later = await relinkView(pg);
  await pg.click('#diag [data-act="onReconnectGun"]'); await pg.waitForTimeout(120);
  const again = await relinkView(pg);
  await pg.close();
  must(!later.hint && later.disconnects === 0, 'the confirm line did not clear: ' + JSON.stringify(later));
  must(again.disconnects === 0 && /TAP AGAIN/.test(again.hint), 'a tap after the window relinked without a fresh confirm: ' + JSON.stringify(again));
});
await step('relink idle-diag: RELINK GUN stays one tap outside a live match', async () => {
  const pg = await open(VIEWS[0], 'idle-diag');
  await fakeGunPlugin(pg);
  await pg.click('#diag [data-act="onReconnectGun"]'); await pg.waitForTimeout(400);
  const r = await relinkView(pg);
  await pg.evaluate(() => window.__ble.release()); await pg.close();
  must(r.disconnects === 1 && !r.hint, 'RELINK GUN needed a second tap outside a match: ' + JSON.stringify(r));
});
await step('polish-1 idle-diag: SCAN QR stays one-tap outside a live match', async () => {
  const pg = await open(VIEWS[0], 'idle-diag');
  await pg.evaluate(() => { window.__calls = 0; window.brx.hud.h.onScanQr = () => { window.__calls++; }; });
  await pg.click('[data-act="onScanQr"]');
  await pg.waitForTimeout(80);
  const r = await pg.evaluate(() => ({ calls: window.__calls, hint: (document.getElementById('dg-mcjoinhint') || {}).textContent || '' }));
  await pg.close();
  must(r.calls === 1, 'SCAN QR needed a second tap outside a match: ' + JSON.stringify(r));
  must(!/TAP AGAIN/.test(r.hint), 'a one-tap phase still shows the mid-match warning: ' + r.hint);
});

// ---------- Polish-loop pass 1: the discovered-MC row (LAN sweep, offered rather than auto-joined) ----------
await step('polish-1 connected: the discovered-MC row is absent by default, appears on setDiscovered, and JOINs on tap', async () => {
  const pg = await open(VIEWS[0], 'connected');
  must((await pg.evaluate(() => document.querySelectorAll('.discoveredrow').length)) === 0, 'a row appeared with nothing discovered');
  await pg.evaluate(() => { window.__calls = 0; window.brx.hud.h.onJoinDiscovered = () => { window.__calls++; };
    window.brx.hud.setDiscovered({ url: 'ws://192.168.1.42:8766/ws', at: Date.now() }); window.brx.hud.render(window.brx.engine.state()); });
  await pg.waitForTimeout(80);
  const row = await pg.evaluate(() => { const e = document.querySelector('.lobby .discoveredrow'); const foot = document.querySelector('.lobby .foot');
    if (!e) return null; const r = e.getBoundingClientRect(), f = foot.getBoundingClientRect();
    return { text: e.textContent, aboveFoot: r.bottom <= f.top + 1, oneLine: e.scrollWidth <= e.clientWidth + 1 }; });
  must(row, 'the discovered row never rendered on the pre-join screen');
  must(/192\.168\.1\.42:8766/.test(row.text) && /JOIN/.test(row.text), 'row text: ' + row.text);
  must(row.aboveFoot, 'the discovered row overlaps the CONNECT/SCAN QR row instead of sitting above it');
  must(row.oneLine, 'the discovered row wrapped');
  await pg.click('.lobby .discoveredrow');
  await pg.waitForTimeout(80);
  const calls = await pg.evaluate(() => window.__calls);
  await pg.close();
  must(calls === 1, 'tapping the discovered row did not call onJoinDiscovered');
});
await step('polish-1 idle-diag: the discovered-MC row also renders inside the ⓘ panel', async () => {
  const pg = await open(VIEWS[0], 'idle-diag');
  await pg.evaluate(() => { window.brx.hud.setDiscovered({ url: 'ws://192.168.1.42:8766/ws', at: Date.now() }); window.brx.hud.renderDiag(); });
  await pg.waitForTimeout(80);
  const r = await pg.evaluate(() => { const e = document.querySelector('#diag .discoveredrow'); return e ? e.textContent : null; });
  await pg.close();
  must(r && /192\.168\.1\.42:8766/.test(r) && /JOIN/.test(r), 'no discovered row in the diag panel: ' + r);
});

// ---------- Polish-loop pass 1 (LOW): the diag panel's address field follows hud.mcUrl after a rescan ----------
await step('polish-1 idle-diag: the address field updates after mcUrl changes (e.g. a QR rescan), unless focused', async () => {
  const pg = await open(VIEWS[0], 'idle-diag');
  await pg.evaluate(() => { window.brx.hud.mcUrl = 'ws://9.9.9.9:8766/ws'; window.brx.hud.renderDiag(); });
  await pg.waitForTimeout(80);
  const unfocused = await pg.evaluate(() => (document.querySelector('.mcurlfield') || {}).value);
  must(unfocused === 'ws://9.9.9.9:8766/ws', 'the field did not pick up the new mcUrl: ' + unfocused);
  await pg.click('.mcurlfield'); await pg.keyboard.type('typing');
  await pg.evaluate(() => { window.brx.hud.mcUrl = 'ws://1.1.1.1:8766/ws'; window.brx.hud.renderDiag(); });
  await pg.waitForTimeout(80);
  const whileTyping = await pg.evaluate(() => (document.querySelector('.mcurlfield') || {}).value);
  await pg.close();
  must(/typing/.test(whileTyping), 'a live mcUrl push overwrote what the player was typing: ' + whileTyping);
});
// ---------- Polish-loop pass 2: the two-tap guard also covers onJoinDiscovered and onReconnectMc ----------
await step('polish-2 diag-live: JOIN (a discovered address) and RELINK MC are ALSO two-tap mid-match', async () => {
  const pg = await open(VIEWS[0], 'diag-live', '', 5200);
  await pg.evaluate(() => { window.brx.hud.setDiscovered({ url: 'ws://1.2.3.4:8766/ws', at: Date.now(), source: 'sweep' }); window.brx.hud.renderDiag();
    window.__calls = {}; ['onJoinDiscovered', 'onReconnectMc'].forEach(a => { window.brx.hud.h[a] = () => { window.__calls[a] = (window.__calls[a] || 0) + 1; }; }); });
  for (const [act, sel] of [['onJoinDiscovered', '.discoveredrow'], ['onReconnectMc', '[data-act="onReconnectMc"]']]) {
    await pg.click(sel); await pg.waitForTimeout(60);
    const mid = await pg.evaluate(a => window.__calls[a] || 0, act);
    await pg.click(sel); await pg.waitForTimeout(60);
    const after = await pg.evaluate(a => window.__calls[a] || 0, act);
    must(mid === 0, `${act}: the first tap mid-match reached the handler instead of being swallowed`);
    must(after === 1, `${act}: the second tap within the window did not reach the handler`);
  }
  await pg.close();
});

// ---------- Polish-loop pass 2: the discovered-row wording names its source ----------
await step('polish-2 connected: the discovered row words itself by source (sweep vs mdns)', async () => {
  const pg = await open(VIEWS[0], 'connected');
  const texts = {};
  for (const source of ['sweep', 'mdns']) {
    texts[source] = await pg.evaluate(src => { window.brx.hud.setDiscovered({ url: 'ws://1.2.3.4:8766/ws', at: Date.now(), source: src }); window.brx.hud.render(window.brx.engine.state());
      return (document.querySelector('.lobby .discoveredrow') || {}).textContent || ''; }, source);
  }
  await pg.close();
  must(/FOUND ON THE NETWORK/.test(texts.sweep), 'sweep wording: ' + texts.sweep);
  must(/FOUND BY BROADCAST/.test(texts.mdns), 'mdns wording: ' + texts.mdns);
  must(texts.sweep !== texts.mdns, 'the two sources read identically');
});
await step('polish-2 connected: the pre-join copy no longer claims mDNS auto-joins', async () => {
  const pg = await open(VIEWS[0], 'connected');
  const note = await pg.evaluate(() => (document.querySelector('.lobby .note.join') || {}).textContent || '');
  await pg.close();
  must(!/connects by itself/i.test(note), 'the copy still claims an address connects by itself: ' + note);
  must(/tap JOIN/i.test(note), 'the copy does not point at the JOIN row: ' + note);
});

// ---------- Polish-loop pass 2: an honest, muted EQUIPPED · UNCONFIRMED after the arming timeout ----------
await step('polish-2 loadout-primary: an arm that times out reads EQUIPPED · UNCONFIRMED, muted, its own glyph, and fits', async () => {
  const pg = await open(VIEWS[0], 'loadout-primary');
  await pg.evaluate(() => {
    const eng = window.brx.engine;
    eng.requestLoadout('primary', 'weapon', 'smg', true);
    if (eng._flushPick) eng._flushPick('test');
    eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }] } } });
    eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 72 }, frames: ['$WEAP,0,*'] } });
    eng.now = () => Date.now() + 3200; eng.tick();   // jump past TRYOUT_ARM_MAX_MS with no confirming report
    window.brx.hud.sig = null; window.brx.hud.render(eng.state());
  });
  await pg.waitForTimeout(150);
  const r = await pg.evaluate(() => {
    const row = document.querySelector('.lrow.unconf'), hero = document.querySelector('.eqtag.unconf'), chip = document.querySelector('.ackchip.unconf'), nm = document.querySelector('.lodetail .nm');
    return { rowMark: row ? (row.querySelector('.st') || {}).textContent : null, hero: hero ? hero.textContent : null, chip: chip ? chip.textContent : null,
      nmFits: nm ? nm.scrollWidth <= nm.clientWidth + 1 : null,
      // pass 3: tryoutUnconfirmed is {tab, kind} | null, not a bare boolean
      engineConfirmed: window.brx.engine.state().tryoutArming === false && !!window.brx.engine.state().tryoutUnconfirmed };
  });
  await pg.close();
  must(r.engineConfirmed, 'the engine never settled into the unconfirmed state');
  must(r.rowMark === '≈', 'the row does not show the distinct ≈ glyph: ' + r.rowMark);
  must(r.hero === 'UNCONFIRMED', 'the hero pane badge: ' + r.hero);
  must(r.chip === 'EQUIPPED · UNCONFIRMED', 'the action-bar chip: ' + r.chip);
  must(r.nmFits, 'the hero pane name + role + badge overflows its line');
});
// ---------- Polish-loop pass 3 (MEDIUM): tryoutUnconfirmed must never bleed onto an unrelated tab/kind ----------
await step('polish-3 loadout-perk: a perk picked after a timed-out weapon arm shows a plain ✓, never the stale UNCONFIRMED', async () => {
  const pg = await open(VIEWS[0], 'loadout-perk');
  await pg.evaluate(() => {
    const eng = window.brx.engine;
    // time out a PRIMARY weapon arm first (same recipe as the loadout-primary case above)
    eng.requestLoadout('primary', 'weapon', 'smg', true);
    if (eng._flushPick) eng._flushPick('test');
    eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }] } } });
    eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 72 }, frames: ['$WEAP,0,*'] } });
    eng.now = () => Date.now() + 3200; eng.tick();
    // now pick a PERK -- perks never arm a try-out at all, and must not inherit the weapon's stale flag
    eng.requestLoadout('perk', 'perk', 'body_armor');
    eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'perk', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }], perk: 'body_armor' } } });
    window.brx.hud.lo.tab = 'perk'; window.brx.hud.sig = null; window.brx.hud.render(eng.state());
  });
  await pg.waitForTimeout(150);
  const r = await pg.evaluate(() => {
    const eqRow = document.querySelector('.lrow.eq'), unconfRow = document.querySelector('.lrow.unconf'), hero = document.querySelector('.eqtag');
    return { eqMark: eqRow ? (eqRow.querySelector('.st') || {}).textContent : null, unconfPresent: !!unconfRow, heroText: hero ? hero.textContent : null,
      engineStillUnconfirmed: !!window.brx.engine.state().tryoutUnconfirmed };
  });
  await pg.close();
  must(r.engineStillUnconfirmed, 'sanity: the weapon arm really did settle unconfirmed underneath');
  must(!r.unconfPresent, 'the perk row shows the ≈/unconf treatment it never earned');
  must(r.eqMark === '✓', 'the perk row does not read a plain confirmed ✓: ' + r.eqMark);
  must(r.heroText === 'EQUIPPED', 'the perk hero pane: ' + r.heroText);
});

// ---------- Bench 2026-09-16: press feedback on EVERY tappable thing (hud.js `_tapDown`/`_tapUp`) ----------
// A player could not tell whether a tap landed. One delegated pointerdown/up pair on #frame adds/clears
// `.tap-press`. These steps dispatch real pointer events (not clicks) so they prove the mechanism itself,
// not just that the act still fires.
await step('press feedback: a native button (ⓘ) presses on pointerdown and clears on pointerup', async () => {
  const pg = await open(VIEWS[0], 'idle');
  const cls = async () => pg.evaluate(() => document.getElementById('info').className);
  must(!/tap-press/.test(await cls()), 'started pressed');
  await pg.locator('#info').dispatchEvent('pointerdown', { pointerId: 1, bubbles: true });
  must(/tap-press/.test(await cls()), 'pointerdown did not press the ⓘ button');
  await pg.locator('#info').dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  must(!/tap-press/.test(await cls()), 'pointerup did not clear the ⓘ button');
  await pg.close();
});
await step('press feedback: a data-act tile (SET MY GUN) presses on pointerdown and clears on pointerup', async () => {
  const pg = await open(VIEWS[0], 'idle');
  const sel = '.bigbtn[data-act="onSetGun"]';
  const cls = async () => pg.evaluate(s => document.querySelector(s).className, sel);
  await pg.locator(sel).dispatchEvent('pointerdown', { pointerId: 1, bubbles: true });
  must(/tap-press/.test(await cls()), 'pointerdown did not press SET MY GUN: ' + await cls());
  await pg.locator(sel).dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  must(!/tap-press/.test(await cls()), 'pointerup did not clear SET MY GUN');
  await pg.close();
});
await step('press feedback: a loadout row presses on pointerdown and clears on pointercancel', async () => {
  const pg = await open(VIEWS[0], 'loadout-primary');
  const sel = '.lrow[data-arg="weapon:smg"]';
  const cls = async () => pg.evaluate(s => document.querySelector(s).className, sel);
  await pg.locator(sel).dispatchEvent('pointerdown', { pointerId: 1, bubbles: true });
  must(/tap-press/.test(await cls()), 'pointerdown did not press the SMG row: ' + await cls());
  await pg.locator(sel).dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  must(!/tap-press/.test(await cls()), 'pointercancel did not clear the SMG row');
  await pg.close();
});
await step('press feedback: a locked (disabled) loadout tab never shows pressed', async () => {
  const pg = await open(VIEWS[0], 'loadout-primary', '&locked');
  const sel = '.lotab[data-arg="primary"]';
  const fixture = await pg.evaluate(s => { const el = document.querySelector(s); return { locked: el.classList.contains('locked'), disabled: el.disabled }; }, sel);
  must(fixture.locked && fixture.disabled, 'fixture: the primary tab is not actually locked here: ' + JSON.stringify(fixture));
  await pg.locator(sel).dispatchEvent('pointerdown', { pointerId: 1, bubbles: true });
  const cls = await pg.evaluate(s => document.querySelector(s).className, sel);
  await pg.close();
  must(!/tap-press/.test(cls), 'a locked loadout tab must never show pressed feedback: ' + cls);
});

// ---------- Bench 2026-09-16: READY UP must turn clearly green, and only on the CONFIRMED state ----------
// Tony's bench report: pressing READY only changed the label. `st.ready` (hud.js) is already set by
// `engine.setReady`, which refuses a tap while the clock is unsynced or the player is benched/wrong
// phase — so it is the CONFIRMED state, not the raw tap. These steps prove the green treatment tracks
// that flag, an `aria-pressed` mirror exists for it, and a refused tap never shows green.
await step('ready control: READY UP is not green before the player readies', async () => {
  const pg = await open(VIEWS[0], 'kitted');
  const r = await pg.evaluate(() => {
    const btn = document.querySelector('.lobby .ready[data-act="onReady"]');
    return { text: btn.textContent.trim(), off: btn.classList.contains('off'), pressed: btn.getAttribute('aria-pressed') };
  });
  await pg.close();
  must(r.text === 'READY UP', 'label: ' + r.text);
  must(r.off, 'READY UP must wear the not-ready (grey) treatment before the tap');
  must(r.pressed === 'false', 'aria-pressed must read false before the player readies: ' + r.pressed);
});
await step('ready control: READY turns solid --ok green once the engine confirms it', async () => {
  const pg = await open(VIEWS[0], 'kitted-ready');
  const r = await pg.evaluate(() => {
    const btn = document.querySelector('.lobby .ready[data-act="onReady"]');
    const probe = document.createElement('div'); probe.style.background = 'var(--ok)'; document.body.appendChild(probe);
    const ok = getComputedStyle(probe).backgroundColor; probe.remove();
    return { text: btn.textContent.trim(), off: btn.classList.contains('off'), pressed: btn.getAttribute('aria-pressed'), bg: getComputedStyle(btn).backgroundColor, ok };
  });
  await pg.close();
  must(r.text === 'READY ✓', 'label: ' + r.text);
  must(!r.off, 'a confirmed ready must drop the grey .off treatment');
  must(r.bg === r.ok, `confirmed READY must paint the --ok token, got ${r.bg} vs token ${r.ok}`);
  must(r.pressed === 'true', 'aria-pressed must read true once the engine confirms ready: ' + r.pressed);
});
await step('ready control: a tap the engine refuses (clock not synced) never turns the button green', async () => {
  const pg = await open(VIEWS[0], 'kitted');
  await pg.evaluate(() => { window.brx.engine.isSynced = () => false; });   // A38-style guard: setReady must refuse this tap
  await pg.click('.lobby .ready[data-act="onReady"]');
  await pg.waitForTimeout(300);
  const r = await pg.evaluate(() => {
    const btn = document.querySelector('.lobby .ready[data-act="onReady"]');
    return { text: btn.textContent.trim(), off: btn.classList.contains('off'), pressed: btn.getAttribute('aria-pressed'), confirmed: window.brx.engine.state().ready };
  });
  await pg.close();
  must(!r.confirmed, 'engine.ready flipped true despite the sync guard refusing the tap');
  must(r.off, 'a refused ready must stay in the not-ready (grey) treatment: ' + JSON.stringify(r));
  must(r.text === 'READY UP', 'label must not claim ready after a refused tap: ' + r.text);
  must(r.pressed === 'false', 'aria-pressed must stay false after a refused tap: ' + r.pressed);
});
await step('ready control: a READY player in the pushed LOBBY sees a green READY, not a grey STANDING BY', async () => {
  const pg = await open(VIEWS[0], 'lobby-ready');
  const r = await pg.evaluate(() => {
    const btn = document.querySelector('.lobby .ready.wait');
    const probe = document.createElement('div'); probe.style.background = 'var(--ok)'; document.body.appendChild(probe);
    const ok = getComputedStyle(probe).backgroundColor; probe.remove();
    return { ready: window.brx.engine.state().ready, has: !!btn, text: btn && btn.textContent.trim(), on: btn && btn.classList.contains('on'),
             bg: btn && getComputedStyle(btn).backgroundColor, ok, over: btn && btn.scrollWidth > btn.clientWidth + 1 };
  });
  await pg.close();
  must(r.ready, 'fixture: the lobby stage state is not a ready player: ' + JSON.stringify(r));
  must(r.has, 'no STANDING BY control in the pushed lobby');
  must(/READY \u2713/.test(r.text), 'a ready player in the lobby must read READY: ' + r.text);
  must(r.on && r.bg === r.ok, `a ready player in the lobby must paint --ok, got ${r.bg} vs ${r.ok}`);
  must(!r.over, 'the READY label overflows its button');
});
await step('ready control: pressed feedback (.tap-press) still works on READY UP', async () => {
  const pg = await open(VIEWS[0], 'kitted');
  const sel = '.lobby .ready[data-act="onReady"]';
  const cls = async () => pg.evaluate(s => document.querySelector(s).className, sel);
  await pg.locator(sel).dispatchEvent('pointerdown', { pointerId: 1, bubbles: true });
  must(/tap-press/.test(await cls()), 'pointerdown did not press READY UP: ' + await cls());
  await pg.locator(sel).dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  must(!/tap-press/.test(await cls()), 'pointerup did not clear READY UP');
  await pg.close();
});
// Playtest review 2026-09-13: STANDING BY has no `data-act` -- a tap does nothing -- so it must read
// `aria-disabled` (the press handler already skips that), carry no `aria-pressed` (it is not a toggle),
// and never show `.tap-press` on a real pointerdown.
await step('ready control: the inert STANDING BY button is marked aria-disabled, has no aria-pressed, and never shows .tap-press', async () => {
  const pg = await open(VIEWS[0], 'lobby');
  const sel = '.lobby .ready.wait';
  const before = await pg.evaluate(s => { const e = document.querySelector(s);
    return { text: e.textContent.trim(), act: e.dataset.act || null, ariaDisabled: e.getAttribute('aria-disabled'), ariaPressed: e.getAttribute('aria-pressed') }; }, sel);
  await pg.locator(sel).dispatchEvent('pointerdown', { pointerId: 1, bubbles: true });
  const cls = await pg.evaluate(s => document.querySelector(s).className, sel);
  await pg.locator(sel).dispatchEvent('pointerup', { pointerId: 1, bubbles: true });
  await pg.close();
  must(before.act === null, 'fixture: STANDING BY must stay inert (no data-act): ' + JSON.stringify(before));
  must(before.ariaDisabled === 'true', 'STANDING BY must announce aria-disabled: ' + JSON.stringify(before));
  must(before.ariaPressed === null, 'STANDING BY must carry no aria-pressed -- it is not a toggle: ' + JSON.stringify(before));
  must(!/tap-press/.test(cls), 'a pointerdown on the inert STANDING BY button must never show pressed feedback: ' + cls);
});

// ---------- ammo gauge (bench 2026-09-17): one pip per round up to AMMO_PIP_MAX, a continuous bar past
// it, an energy weapon (charge/energy in its id) always gets the percentage bar, and OUT OF AMMO/OUT OF
// ENERGY replace a reload prompt that would lie once the reserve is also empty. Drives the live engine
// directly (`window.brx.engine`, the same handle `demo.js`'s own stage harness uses) so a real weapon's
// real magazine size is on screen — the `live` stage's golden bundle only ever spawns an assault rifle. ----------
const setAmmo = async (pg, weaponId, slot, mag, reserve, ammo, heat = 0) => {
  await pg.evaluate(({ weaponId, slot, mag, reserve }) => {
    const e = window.brx.engine;
    e.player.loadout.weapons[slot] = { weapon_id: weaponId };
    e.frames.spawn = e.frames.spawn.map(f => f.startsWith(`$AMMO,${slot},`) ? `$AMMO,${slot},${mag},${reserve},1,*` : f);
  }, { weaponId, slot, mag, reserve });
  // F259 (2026-09-18): the node IGNORES an `$ALCD` that raises the magazine while it is still waiting for the
  // gun to echo a magazine the node itself wrote (`_acctAmmo`'s echo window, ACC_ECHO_MS) — swapping the weapon
  // above is one of the things that makes it write. A single injected frame can land inside that window and be
  // dropped, and the step then asserts against the PREVIOUS state: two ammo steps read as a HUD bug that way
  // (2026-09-18), because a swallowed frame looks exactly like a screen that refused to move. So feed until the
  // engine reports the number back. A swallowed frame becomes a retry, and a state that never lands fails HERE,
  // naming the state, instead of silently later as a wrong pixel. Polled slowly on purpose: each feed is a whole
  // frame through the engine, and a tight rAF loop would put dozens of them through it per window.
  await pg.waitForFunction(({ slot, ammo, reserve, heat }) => {
    const e = window.brx.engine;
    e.feedFrame(`$ALCD,${ammo},100,${slot},${reserve},${heat},*`);   // ALWAYS feed: a step can re-send the same magazine with a different reserve
    const s = e.state();
    return s.ammo === ammo && s.reserve === reserve;
  }, { slot, ammo, reserve, heat }, { polling: 200, timeout: 5000 })
    .catch(async () => { throw new Error(`setAmmo: the engine never took ${weaponId} ${ammo}/${mag} (reserve ${reserve}, heat ${heat}), it reads ${JSON.stringify(await pg.evaluate(() => { const s = window.brx.engine.state(); return { ammo: s.ammo, reserve: s.reserve }; }))}`); });
};
const gaugeState = pg => pg.evaluate(() => ({
  pips: document.querySelectorAll('#pips > i').length,
  lit: document.querySelectorAll('#pips > i:not(.spent)').length,
  bar: !!document.querySelector('#pips > .bar'),
  // "ammobar", not "ammo" -- item 1 (bench 2026-09-17): the bar's own class must never collide with the
  // ammo COLUMN's `.ammo` (position:absolute;right:36px;bottom:32px), which floated the bar over the digits.
  ammoBar: !!document.querySelector('#pips > .bar.ammobar'),
  energyBar: !!document.querySelector('#pips > .bar.energy'),
  mag: (document.getElementById('mag') || {}).textContent,
  prompt: (document.querySelector('.ammo .reload .unskew') || {}).textContent || null,
  // item 6 revision (bench 2026-09-17): NOT ENOUGH ENERGY moved from a second big prompt to a small
  // note under the digits, so a state check needs both: the ONE big prompt, and this note's presence.
  note: (document.querySelector('.ammo .enote') || {}).textContent || null,
  bigPrompts: document.querySelectorAll('.ammo .reload').length,
}));
await step('ammo gauge se: a 4-round sniper mag gets exactly 4 pips, one per round, and firing one clears exactly one', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'sniper_rifle', 0, 4, 24, 4); await pg.waitForTimeout(400);
  let r = await gaugeState(pg);
  must(r.pips === 4 && r.lit === 4 && !r.bar, `a 4-round mag must show 4 discrete pips, all lit, not a bar: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-sniper-full.png` });
  await setAmmo(pg, 'sniper_rifle', 0, 4, 24, 3); await pg.waitForTimeout(400);
  r = await gaugeState(pg);
  must(r.pips === 4 && r.lit === 3, `firing one round of a 4-round mag must clear exactly one pip (3 of 4 lit), got ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-sniper-fired1.png` });
  await pg.close();
});
await step('ammo gauge se: a 36-round mag (burst rifle) uses the continuous bar, not 36 pips', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'burst_rifle', 0, 36, 216, 36); await pg.waitForTimeout(400);
  const r = await gaugeState(pg);
  must(r.bar && r.ammoBar && r.pips === 0, `a 36-round mag must render as the ammo bar, never 36 pips: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-burst-bar.png` });
  await pg.close();
});
// ---------- item 1 (bench 2026-09-17): the big-mag bar shared the class name `ammo` with the ammo
// COLUMN's own `position:absolute;right:36px;bottom:32px` rule. Since `.pips` is `position:relative`
// (63278ea4), that pulled the bar out of flow, over the mag digits, and collapsed `.pips` to 0x0. ----------
await step('ammo gauge se: the big-mag bar sits clear of the mag digits and the pips box does not collapse', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'assault_rifle', 0, 32, 192, 32); await pg.waitForTimeout(400);
  const r = await pg.evaluate(() => {
    const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    const bar = document.querySelector('#pips > .bar');
    return { pips: rect(document.getElementById('pips')), bar: rect(bar), mag: rect(document.getElementById('mag')), barClass: bar ? bar.className : null };
  });
  must(r.pips && r.pips.w > 0 && r.pips.h > 0, `the pips box must not collapse to 0px on a big mag: ${JSON.stringify(r.pips)}`);
  must(r.bar && r.bar.w > 0 && r.bar.h > 0, `the ammo bar must actually render: ${JSON.stringify(r)}`);
  must(!/(^| )ammo( |$)/.test(r.barClass || ''), `the bar's class must not be "ammo" -- it collides with the .ammo column: ${r.barClass}`);
  must(r.bar.t >= r.mag.b, `the bar must sit below the mag digits, not float over them: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-bigmag-bar.png` });
  await pg.close();
});
await step('ammo gauge se: the ready shine still shows on a big (>30) mag now the pips box no longer collapses', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'assault_rifle', 0, 32, 192, 32); await pg.waitForTimeout(400);
  const r = await pg.evaluate(() => {
    document.getElementById('frame').dataset.cool = 'ready';
    const pips = document.querySelector('.ammo .pips'); const af = getComputedStyle(pips, '::after'); const b = pips.getBoundingClientRect();
    return { anim: af.animationName, w: b.width, h: b.height };
  });
  must(r.w > 0 && r.h > 0, `the pips box needs real size for the shine to be visible: ${JSON.stringify(r)}`);
  must(r.anim === 'readyshine', `the ready shine must be armed on a big mag too: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-bigmag-readyshine.png` });
  await pg.close();
});
await step('ammo gauge se: swapping from the sniper to a 36-round mag re-renders the gauge from pips to the bar', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'sniper_rifle', 0, 4, 24, 4); await pg.waitForTimeout(400);
  let r = await gaugeState(pg);
  must(r.pips === 4 && !r.bar, `pre-swap: expected 4 pips: ${JSON.stringify(r)}`);
  await setAmmo(pg, 'burst_rifle', 0, 36, 216, 36); await pg.waitForTimeout(400);
  r = await gaugeState(pg);
  must(r.bar && r.ammoBar && r.pips === 0, `post-swap to a 36-round mag: expected the bar, not pips: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-swap-to-bar.png` });
  await pg.close();
});
await step('ammo prompt se: mag 0 / reserve 0 reads OUT OF AMMO, never RELOAD', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'sniper_rifle', 0, 4, 0, 0); await pg.waitForTimeout(400);
  const r = await gaugeState(pg);
  must(r.prompt === 'OUT OF AMMO', `mag 0 / reserve 0 must read OUT OF AMMO (a reload would give nothing back), got ${JSON.stringify(r.prompt)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-out-of-ammo.png` });
  await pg.close();
});
await step('ammo prompt se: mag 0 / reserve > 0 keeps RELOAD (a reload still gives rounds back)', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'sniper_rifle', 0, 4, 24, 0); await pg.waitForTimeout(400);
  const r = await gaugeState(pg);
  must(/^RELOAD/.test(r.prompt || ''), `mag 0 / reserve 24 must keep the RELOAD prompt, got ${JSON.stringify(r.prompt)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-reload.png` });
  await pg.close();
});
await step('ammo gauge se: an energy weapon (charge rifle) shows the cell bar and its proportion, never pips or a round count', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 12, 12, 6); await pg.waitForTimeout(400);
  const r = await gaugeState(pg);
  must(r.bar && r.energyBar && !r.ammoBar && r.pips === 0, `an energy weapon must render the energy bar, never pips: ${JSON.stringify(r)}`);
  // Bench 2026-09-18 (Tony): the per-cent SIGN is gone, the number is still the proportion of the cell.
  // `12` would be a round count and `50` is half a cell, so this still catches the gauge reading rounds.
  must(r.mag === '50', `an energy weapon's digit must read the cell proportion, not a round count: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-energy-half.png` });
  await pg.close();
});
await step('ammo prompt se: an energy weapon at 0/0 reads OUT OF ENERGY, never OUT OF AMMO', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 12, 0, 0); await pg.waitForTimeout(400);
  const r = await gaugeState(pg);
  must(r.prompt === 'OUT OF ENERGY', `an energy weapon at 0/0 must read OUT OF ENERGY, got ${JSON.stringify(r.prompt)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-energy-out.png` });
  await pg.close();
});
await step('ammo prompt se: an energy weapon with reserve left reads HOLD TO RECHARGE, never RELOAD', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 12, 12, 0); await pg.waitForTimeout(400);
  const r = await gaugeState(pg);
  must(r.prompt === 'HOLD TO RECHARGE', `an energy weapon at 0 with reserve must read HOLD TO RECHARGE, got ${JSON.stringify(r.prompt)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-energy-recharge.png` });
  await pg.close();
});
// ---------- energy severity revision (bench 2026-09-17, item 6 reworked): a charge rifle cell under one
// full charge (10, `CHARGE_RIFLE_FULL_CHARGE_COST` in hud.js) fires nothing, but the ORIGINAL fix made
// this a second big prompt (NOT ENOUGH ENERGY, red) sitting beside RECHARGE, and dropped it alone with
// no big prompt at all once the reserve ran out too -- a player with nothing left saw the mildest-looking
// screen of the three. New rule: severity comes from the RESERVE, not the cell. Below one full charge (or
// empty) with a reserve to draw on reads one calm RECHARGE, exactly like the empty-cell case already did.
// Below one full charge with NO reserve reads OUT OF ENERGY, same big red prompt as mag 0 / reserve 0.
// NOT ENOUGH ENERGY survives only as a small note under the digits, never a second big prompt. ----------
// ---------- A48 (merge 2026-09-17): the HUD reads the CLASS and the CHARGE COST off the catalogue ----------
// `weapon_class` ("ballistic" | "energy" | "melee") replaced the old "energy or charge in the weapon id"
// guess, and `rounds_per_charge` replaced the hard-coded 10.
// ---------- F248 (2026-09-17): `weapon_class === "energy"` is WIDER than the old id match, so
// this test originally asserted the Rail Gun (2-round mag, one round per shot) drew the percentage/cell
// gauge -- that assertion WAS the bug. The agreed rule: the gauge is a CELL gauge exactly when
// `rounds_per_charge > 1`; `weapon_class` still, and only, picks the RELOAD/RECHARGE wording. ----------
await step('ammo gauge se: the Rail Gun (2-round mag, one round per shot) shows pips, not the cell gauge, though its class is energy', async () => {
  const pg = await open(VIEWS[1], 'live');
  const cls = await pg.evaluate(() => {
    const w = window.brx.engine.catalog.weapons.find(x => x.weapon_id === 'rail_gun');
    return w && w.weapon_class;
  });
  must(cls === 'energy', `pre-condition: the catalogue must still call the rail gun energy, got ${JSON.stringify(cls)}`);
  await setAmmo(pg, 'rail_gun', 0, 2, 2, 1); await pg.waitForTimeout(400);
  let r = await gaugeState(pg);
  must(r.pips === 2 && r.lit === 1 && !r.bar, `a 2-round Rail Gun must show 2 pips, one round per shot, never the cell gauge: ${JSON.stringify(r)}`);
  must(r.mag === '01', `the digit beside the pips must read a round count, not a percentage: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-class-railgun.png` });
  // weapon_class still picks the WORDING: an empty Rail Gun with reserve reads HOLD TO RECHARGE, not RELOAD,
  // and 0/0 reads OUT OF ENERGY, not OUT OF AMMO -- the class keeps that job even though the gauge above it
  // is now pips.
  await setAmmo(pg, 'rail_gun', 0, 2, 2, 0); await pg.waitForTimeout(400);
  r = await gaugeState(pg);
  must(r.prompt === 'HOLD TO RECHARGE', `an empty Rail Gun with reserve must still read HOLD TO RECHARGE (class energy): ${JSON.stringify(r)}`);
  await setAmmo(pg, 'rail_gun', 0, 2, 0, 0); await pg.waitForTimeout(400);
  r = await gaugeState(pg);
  must(r.prompt === 'OUT OF ENERGY', `0/0 on an energy-class weapon must still read OUT OF ENERGY, not OUT OF AMMO: ${JSON.stringify(r)}`);
  await pg.close();
});
// ---------- F248: a bundle from before A48 carries neither `weapon_class` nor `rounds_per_charge` at all
// (simulated here with a catalogue row removed, or an id the catalogue never had) -- the HUD must fall back
// to the named charge-rifle constant, then the old id regex, exactly as it did before A48 existed. ----------
await step('ammo gauge se: an old (pre-A48) bundle with no catalogue row falls back to the charge-rifle constant, then the id match', async () => {
  const pg = await open(VIEWS[1], 'live');
  // The charge rifle's OWN id, but with its row missing from the catalogue -- as if this were a pre-A48
  // bundle that had never heard of `rounds_per_charge`. The named CHARGE_RIFLE_FULL_CHARGE_COST constant
  // must still put it on the cell gauge.
  await pg.evaluate(() => { window.brx.engine.catalog.weapons = window.brx.engine.catalog.weapons.filter(w => w.weapon_id !== 'charge_rifle' && w.weapon_id !== 'rail_gun'); });
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 25); await pg.waitForTimeout(400);
  let r = await gaugeState(pg);
  must(r.energyBar && r.pips === 0, `an unrecognised charge_rifle id must still fall back to the named constant and draw the cell gauge: ${JSON.stringify(r)}`);
  // An unrecognised id that merely CONTAINS "energy" falls back to the old id regex.
  await setAmmo(pg, 'legacy_energy_cannon', 0, 40, 80, 25); await pg.waitForTimeout(400);
  r = await gaugeState(pg);
  must(r.energyBar && r.pips === 0, `an unrecognised id matching the old energy/charge regex must still draw the cell gauge: ${JSON.stringify(r)}`);
  // The Rail Gun's id never matched that regex (no "energy"/"charge" in "rail_gun"), so with no catalogue
  // row at all it must fall all the way through to pips -- exactly as it did before weapon_class existed.
  await setAmmo(pg, 'rail_gun', 0, 2, 2, 1); await pg.waitForTimeout(400);
  r = await gaugeState(pg);
  must(r.pips === 2 && !r.bar, `an unrecognised rail_gun id must fall back to pips, not the id regex: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-pre-a48-fallback.png` });
  await pg.close();
});
await step('ammo note se: NOT ENOUGH ENERGY follows rounds_per_charge from the catalogue, not a constant', async () => {
  const pg = await open(VIEWS[1], 'live');
  // Move the charge rifle's cost off the old hard-coded 10. A cell of 15 is ABOVE 10 and BELOW 20, so the
  // note can only appear if the HUD read the catalogue value.
  await pg.evaluate(() => { window.brx.engine.catalog.weapons.find(x => x.weapon_id === 'charge_rifle').rounds_per_charge = 20; });
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 15); await pg.waitForTimeout(400);
  let r = await gaugeState(pg);
  must(r.note === 'NOT ENOUGH ENERGY', `a cell of 15 under a catalogue cost of 20 must show the note: ${JSON.stringify(r)}`);
  // And back: a cell of 25 clears it at the same catalogue cost.
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 25); await pg.waitForTimeout(400);
  r = await gaugeState(pg);
  must(r.note === null, `a cell of 25 is above the catalogue cost of 20 -- no note: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-charge-cost.png` });
  await pg.close();
});
await step('ammo prompt se: a charge rifle cell of 9 (under the 10-cost full charge) with reserve reads one calm RECHARGE, plus the small note', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 9); await pg.waitForTimeout(400);
  const r = await gaugeState(pg);
  must(r.bigPrompts === 1 && r.prompt === 'HOLD TO RECHARGE', `9 of 40 with reserve must read one HOLD TO RECHARGE prompt, got ${JSON.stringify(r)}`);
  must(r.note === 'NOT ENOUGH ENERGY', `the small note must still say why: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-energy-not-enough.png` });
  await pg.close();
});
// F257 (bench 2026-09-18): Tony's charge rifle sat at 7 of 40, no reserve, and the HUD showed OUT OF
// ENERGY over a 20% gauge while the gun fired a tap perfectly well. A cell above 0 is not a dead end --
// only `ammo === 0` with no reserve is (that case is `outOfAmmo` above, already OUT OF ENERGY worded).
// So a cell below a charge but still above 0 gets the small note ALONE, never the big prompt too.
await step('ammo prompt se: a charge rifle cell of 9 with NO reserve reads the small NOT ENOUGH ENERGY note alone, never the OUT OF ENERGY big prompt (F257)', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 0, 9); await pg.waitForTimeout(400);
  const r = await gaugeState(pg);
  must(r.bigPrompts === 0 && r.prompt === null, `9 of 40 with no reserve still fires taps -- it must show no big prompt, got ${JSON.stringify(r)}`);
  must(r.note === 'NOT ENOUGH ENERGY', `the small note must still say why a full charge is out of reach: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-energy-out-of-energy-no-reserve.png` });
  await pg.close();
});
// The cell truly empty (0), no reserve: taps have nothing left either, so this IS the dead end and
// reads OUT OF ENERGY -- same big red prompt as mag 0 / reserve 0, and no note (the note is for ammo > 0).
await step('ammo prompt se: a charge rifle cell of exactly 0 with NO reserve reads OUT OF ENERGY, and no note (F257)', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 0, 0); await pg.waitForTimeout(400);
  const r = await gaugeState(pg);
  must(r.bigPrompts === 1 && r.prompt === 'OUT OF ENERGY', `0 of 40 with no reserve is a true dead end: ${JSON.stringify(r)}`);
  must(r.note === null, `the note is for a cell above 0 only: ${JSON.stringify(r)}`);
  await pg.close();
});
await step('ammo prompt se: 0/40 and 5/40 with reserve read the identical RECHARGE prompt -- one consistent style regardless of the cell', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 0); await pg.waitForTimeout(400);
  const empty = await pg.evaluate(() => { const el = document.querySelector('.ammo .reload'); return { cls: el.className, text: el.textContent.trim() }; });
  await pg.screenshot({ path: `${OUT}/se-ammo-energy-recharge-empty.png` });
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 5); await pg.waitForTimeout(400);
  const partial = await pg.evaluate(() => { const el = document.querySelector('.ammo .reload'); return { cls: el.className, text: el.textContent.trim() }; });
  must(empty.cls === partial.cls, `0/40 and 5/40 with reserve must render the same prompt style, got ${JSON.stringify({ empty, partial })}`);
  must(empty.text === 'HOLD TO RECHARGE' && partial.text === 'HOLD TO RECHARGE', `both must read HOLD TO RECHARGE: ${JSON.stringify({ empty, partial })}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-energy-recharge-partial.png` });
  await pg.close();
});
// ---------- pl4 (2026-09-17): an empty energy cell with reserve showed three amber items at once (a blinking
// RECHARGE, the amber 0%, and NOT ENOUGH ENERGY). The note is only for a cell that still reads above 0, and the
// prompt is steady whether the cell is empty or below a charge. The Energy Rifle bench found taps refill
// nothing and a hold refills the whole cell, so the prompt says HOLD TO RECHARGE. ----------
for (const [view, tag] of [[VIEWS[1], 'se'], [VIEWS[0], 'pixel']]) {
  await step(`ammo prompt ${tag}: an empty energy cell with reserve reads one steady HOLD TO RECHARGE and no NOT ENOUGH ENERGY note`, async () => {
    const pg = await open(view, 'live');
    for (const [w, mag, ammo] of [['charge_rifle', 40, 0], ['charge_rifle', 40, 5], ['energy_rifle', 40, 0], ['energy_rifle', 40, 4]]) {
      await setAmmo(pg, w, 0, mag, 80, ammo); await pg.waitForTimeout(400);
      const r = await gaugeState(pg);
      const box = await pg.evaluate(() => { const el = document.querySelector('.ammo .reload'); const b = el.getBoundingClientRect(); return { anim: getComputedStyle(el).animationName, right: b.right, left: b.left, vw: innerWidth, sw: el.scrollWidth, cw: el.clientWidth }; });
      must(r.bigPrompts === 1 && r.prompt === 'HOLD TO RECHARGE', `${w} ${ammo}/${mag} with reserve: ${JSON.stringify(r)}`);
      must(box.anim === 'none', `${w} ${ammo}/${mag}: HOLD TO RECHARGE must not blink: ${JSON.stringify(box)}`);
      must(box.left >= 0 && box.right <= box.vw && box.sw <= box.cw + 1, `${w} ${ammo}/${mag}: the prompt must fit at ${tag}: ${JSON.stringify(box)}`);
      must(r.note === (w === 'charge_rifle' && ammo > 0 ? 'NOT ENOUGH ENERGY' : null), `${w} ${ammo}/${mag}: the note shows only for a cell above 0 that is below a charge: ${JSON.stringify(r)}`);
      const bad = await invariants(pg); must(bad.length === 0, bad.join(' ; '));
      if (ammo === 0 && w === 'charge_rifle') await pg.screenshot({ path: `${OUT}/${tag}-ammo-energy-hold-to-recharge.png` });
    }
    await pg.close();
  });
}
await step('ammo prompt se: a charge rifle cell of exactly 10 (the full-charge cost) shows neither the NOT ENOUGH ENERGY note nor a RECHARGE/OUT OF ENERGY prompt', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 10); await pg.waitForTimeout(400);
  const r = await gaugeState(pg);
  must(r.note === null, `10 of 40 is a full charge and must show no NOT ENOUGH ENERGY note: ${JSON.stringify(r)}`);
  must(r.prompt === null, `10 of 40 needs no reload/recharge prompt at all: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-ammo-energy-enough.png` });
  await pg.close();
});
await step('ammo prompt se: the NOT ENOUGH ENERGY note never shows for a bullet weapon or a tap-only energy weapon', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'burst_rifle', 0, 36, 216, 9); await pg.waitForTimeout(400);
  let r = await gaugeState(pg);
  must(r.note === null, `a bullet weapon must never show the NOT ENOUGH ENERGY note: ${JSON.stringify(r)}`);
  await setAmmo(pg, 'energy_rifle', 0, 40, 80, 9); await pg.waitForTimeout(400);
  r = await gaugeState(pg);
  must(r.note === null, `only charge_rifle has a known full-charge cost -- energy_rifle must not show the note: ${JSON.stringify(r)}`);
  await pg.close();
});
// F257: the true dead end (ammo 0, no reserve) is the OUT OF ENERGY case, and it never carries the
// note (the note is for ammo > 0). This checks that big prompt lays out cleanly at both sizes.
for (const [view, tag] of [[VIEWS[1], 'se'], [VIEWS[0], 'pixel']]) {
  for (const night of [false, true]) {
    await step(`${tag} energy severity ${night ? 'night' : 'day'}: OUT OF ENERGY alone lays out cleanly at both sizes (F257)`, async () => {
      const pg = await open(view, 'live', night ? '&night' : '');
      await setAmmo(pg, 'charge_rifle', 0, 40, 0, 0); await pg.waitForTimeout(400);
      const r = await gaugeState(pg);
      must(r.bigPrompts === 1 && r.prompt === 'OUT OF ENERGY' && r.note === null, `0 of 40, no reserve, at ${tag}/${night ? 'night' : 'day'}: ${JSON.stringify(r)}`);
      const bad = await invariants(pg); must(bad.length === 0, bad.join(' ; '));
      await pg.screenshot({ path: `${OUT}/${tag}-energy-out-note-${night ? 'night' : 'day'}.png` });
      await pg.close();
    });
  }
}

// ---------- energy gauge layout + reserve pills (bench 2026-09-17, Tony -- real charge rifle, 40-round
// energy cell, 80 in reserve). The cell overflowed its own frame, and "25% /80" mixed a percentage with a
// round count on a weapon that has no rounds. ----------
const energyBox = pg => pg.evaluate(() => {
  const frame = document.querySelector('.pips .bar.energy'); const fill = frame ? frame.querySelector('i') : null;
  const r = el => el ? el.getBoundingClientRect() : null;
  return { frame: r(frame), fill: r(fill), resHtml: (document.getElementById('res') || {}).innerHTML || '',
    resText: (document.getElementById('res') || {}).textContent || '', cells: document.querySelectorAll('#res .cell').length,
    fullCells: document.querySelectorAll('#res .cell:not(.partial)').length, partialCells: document.querySelectorAll('#res .cell.partial').length };
});
for (const view of VIEWS) {
  await step(`${view.name} energy gauge: the segmented cell sits inside its own frame`, async () => {
    const pg = await open(view, 'live');
    await setAmmo(pg, 'charge_rifle', 0, 40, 80, 25); await pg.waitForTimeout(400);
    const r = await energyBox(pg);
    must(r.frame && r.fill, `no energy bar rendered: ${JSON.stringify(r)}`);
    const pad = 0.5;   // sub-pixel rounding only — a real overflow measured ~2.4-3px at se (bench 2026-09-17)
    must(r.fill.top >= r.frame.top - pad && r.fill.bottom <= r.frame.bottom + pad,
      `the segment fill must sit inside the frame's own box, not overflow it: frame ${JSON.stringify(r.frame)} fill ${JSON.stringify(r.fill)}`);
    await pg.screenshot({ path: `${OUT}/${view.name}-energy-frame-fit.png` });
    await pg.close();
  });
}
await step('energy reserve se: 40/80 (a 40-round cell, 2 spares) shows exactly 2 full pills and no "/80" text', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 40); await pg.waitForTimeout(400);
  const r = await energyBox(pg);
  must(r.cells === 2 && r.fullCells === 2 && r.partialCells === 0, `40/80 must show 2 full pills, none partial: ${JSON.stringify(r)}`);
  must(!/\/\s*80/.test(r.resText) && !/\d/.test(r.resText), `#res must carry no digits at all for an energy weapon, got text ${JSON.stringify(r.resText)} (html ${r.resHtml})`);
  await pg.screenshot({ path: `${OUT}/se-energy-reserve-2full.png` });
  await pg.close();
});
await step('energy reserve se: 40/60 shows 1 full pill plus 1 partial pill', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 60, 40); await pg.waitForTimeout(400);
  const r = await energyBox(pg);
  must(r.cells === 2 && r.fullCells === 1 && r.partialCells === 1, `40/60 must show 1 full pill + 1 partial: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-energy-reserve-1full1partial.png` });
  await pg.close();
});
await step('energy reserve se: reserve 0 shows no pills at all (OUT OF ENERGY already says it)', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 0, 0); await pg.waitForTimeout(400);
  const r = await energyBox(pg);
  must(r.cells === 0, `reserve 0 must show zero pills: ${JSON.stringify(r)}`);
  const prompt = await pg.evaluate(() => (document.querySelector('.ammo .reload .unskew') || {}).textContent || null);
  must(prompt === 'OUT OF ENERGY', `reserve 0 / mag 0 must still read OUT OF ENERGY: ${prompt}`);
  await pg.screenshot({ path: `${OUT}/se-energy-reserve-zero.png` });
  await pg.close();
});
// ---------- Bench 2026-09-18 (Tony): "i like the amber pill for charge rifle", then: they still need polish.
// A spare charge is an OBJECT, so the casing, the cap and the highlight belong to the canister and must
// survive every fill level -- only the charge inside moves. Two things broke that. A part-full canister
// dropped its glow and went translucent, so it read as a different material from the full ones beside it.
// And the night skin painted the part-full canister at a HARD-CODED 50%: the very bug Tony reported for the
// day skin ("they appeared to be half full after a reload") was still live behind `[data-env="night"]`. ----------
for (const view of VIEWS) {
  for (const night of [false, true]) {
    await step(`${view.name} energy reserve ${night ? 'night' : 'day'}: a spare canister keeps its casing, cap and highlight at every fill, and only the charge moves`, async () => {
      const pg = await open(view, 'live', night ? '&night' : '');
      const read = async reserve => {
        await setAmmo(pg, 'charge_rifle', 0, 40, reserve, 25); await pg.waitForTimeout(400);
        return pg.evaluate(() => {
          const pick = e => {
            const cs = getComputedStyle(e), bef = getComputedStyle(e, '::before'), aft = getComputedStyle(e, '::after');
            return { op: cs.opacity, bg: cs.backgroundImage, border: cs.borderLeftColor, bw: cs.borderLeftWidth,
              cap: { c: bef.content, h: parseFloat(bef.height) || 0, w: parseFloat(bef.width) || 0 },
              spec: { c: aft.content, h: parseFloat(aft.height) || 0, w: parseFloat(aft.width) || 0 } };
          };
          const cells = Array.from(document.querySelectorAll('#res .cell'));
          return { full: cells.filter(e => !e.classList.contains('partial')).map(pick),
                   part: cells.filter(e => e.classList.contains('partial')).map(pick) };
        });
      };
      const low = await read(83);    // 2 full spares + 3 of a 40-round charge: the floor fill
      const high = await read(118);  // 2 full spares + 38 of 40: almost a whole spare charge
      await pg.screenshot({ path: `${OUT}/${view.name}-energy-canister-${night ? 'night' : 'day'}.png` });
      const bad = await invariants(pg);   // three canisters plus their gaps must still fit the readout row
      await pg.close();
      must(bad.length === 0, bad.join(' ; '));
      for (const [tag, r] of [['3 of 40', low], ['38 of 40', high]]) {
        must(r.full.length === 2 && r.part.length === 1, `${tag}: expected 2 full canisters and 1 part-full: ${JSON.stringify({ full: r.full.length, part: r.part.length })}`);
        const p = r.part[0], f = r.full[0];
        must(p.op === '1', `${tag}: the part-full canister went translucent (opacity ${p.op}) -- it is the same object, just less charged`);
        must(p.border === f.border && p.bw === f.bw, `${tag}: the casing changes with the fill (part ${p.bw} ${p.border} vs full ${f.bw} ${f.border})`);
        for (const [who, c] of [['full', f], ['part-full', p]]) {
          must(c.cap.c !== 'none' && c.cap.h >= 2 && c.cap.w >= 3, `${tag}: the ${who} canister has no cap across its top (::before ${JSON.stringify(c.cap)})`);
          must(c.spec.c !== 'none' && c.spec.h >= 6 && c.spec.w >= 1, `${tag}: the ${who} canister has no highlight down its glass (::after ${JSON.stringify(c.spec)})`);
        }
        // Chromium drops the default 180deg from the computed value, so a vertical fill is "no angle at all"
        // and a sideways one names its angle. Either way this is the paint, not the source.
        must(/linear-gradient/.test(p.bg) && !/(90deg|270deg|to right|to left)/.test(p.bg),
          `${tag}: the charge sweeps sideways like a bar segment instead of standing in the canister: ${p.bg.slice(0, 90)}`);
      }
      must(low.part[0].bg !== high.part[0].bg,
        `3 of 40 and 38 of 40 paint the identical canister -- the fill is hard-coded, not the real fraction: ${low.part[0].bg.slice(0, 120)}`);
      must(low.full[0].bg === high.full[0].bg, 'a FULL canister must not change when the reserve does');
    });
  }
}
await step('ammo reserve se: a bullet weapon still shows plain "/reserve" text, never pills', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'burst_rifle', 0, 36, 216, 30); await pg.waitForTimeout(400);
  const r = await energyBox(pg);
  must(r.cells === 0, `a bullet weapon must never show cell pills: ${JSON.stringify(r)}`);
  must(r.resText === '/216', `a bullet weapon's #res must read plain "/reserve", got ${JSON.stringify(r.resText)}`);
  await pg.close();
});
// F248: the Energy Rifle has no `rounds_per_charge` (one round per shot, like the Rail Gun), so per the
// agreed rule it now renders the ordinary big-magazine bar (mag 300 > AMMO_PIP_MAX) and a plain "/reserve"
// count, never the cell gauge -- this test used to expect the (buggy) percentage bar and reserve pills.
for (const view of VIEWS) {
  await step(`${view.name} energy-class gauge night: the big-magazine bar and plain reserve still read at night, no overflow with a long weapon name`, async () => {
    const pg = await open(view, 'live', '&night');
    await setAmmo(pg, 'energy_rifle', 0, 300, 600, 150); await pg.waitForTimeout(400);
    const r = await pg.evaluate(() => {
      const frame = document.querySelector('.pips .bar.ammobar');
      const cs = frame ? getComputedStyle(frame) : null;
      return { visible: !!frame && cs.display !== 'none' && cs.visibility !== 'hidden', cells: document.querySelectorAll('#res .cell').length, resText: (document.getElementById('res') || {}).textContent || '', wn: (document.querySelector('.ammo .wn') || {}).textContent };
    });
    must(r.visible, `a low-cost energy weapon's big magazine must still render the ordinary bar at night: ${JSON.stringify(r)}`);
    must(r.cells === 0 && r.resText === '/600', `it keeps the plain round-count reserve, never cell pills: ${JSON.stringify(r)}`);
    const bad = await invariants(pg); must(bad.length === 0, bad.join(' ; '));
    await pg.screenshot({ path: `${OUT}/${view.name}-energy-night.png` });
    await pg.close();
  });
}

// ---------- weapon heat + OVERHEAT (bench 2026-09-17, match 592e444eff: a charge rifle locked out past
// heat 100 and the HUD said nothing at all). ----------
const heatState = pg => pg.evaluate(() => {
  const bar = document.getElementById('heat'); const vig = document.querySelector('.heatvig'); const word = document.querySelector('.heatword');
  return { barPresent: !!bar, barHot: !!(bar && bar.classList.contains('hot')), barWidth: bar ? bar.querySelector('i').style.width : null,
    overlay: !!vig, word: word ? word.textContent : null, prompt: (document.querySelector('.ammo .reload .unskew') || {}).textContent || null,
    pointerEvents: vig ? getComputedStyle(vig).pointerEvents : null };
});
await step('heat bar se: a weapon that has never heated draws no heat bar', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'assault_rifle', 0, 32, 192, 32, 0); await pg.waitForTimeout(400);
  const r = await heatState(pg);
  must(!r.barPresent, `a weapon at heat 0 that has never heated must show no heat bar: ${JSON.stringify(r)}`);
  await pg.close();
});
await step('heat bar se: heat rising shows the bar tracking the level, below the lockout it is not OVERHEAT yet', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 30, 55); await pg.waitForTimeout(400);
  const r = await heatState(pg);
  must(r.barPresent && !r.barHot && r.barWidth === '55%', `heat 55 must show the bar at 55%, not hot: ${JSON.stringify(r)}`);
  must(r.prompt !== 'OVERHEAT', `heat 55 (under the lockout) must not say OVERHEAT: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-heat-rising.png` });
  await pg.close();
});
for (const [view, tag] of [[VIEWS[1], 'se'], [VIEWS[0], 'pixel']]) {
  for (const night of [false, true]) {
    await step(`${tag} OVERHEAT ${night ? 'night' : 'day'}: heat past the lockout shows the prompt and the full-frame overlay, vitals stay visible, no taps blocked`, async () => {
      const pg = await open(view, 'live', night ? '&night' : '');
      await setAmmo(pg, 'charge_rifle', 0, 40, 80, 3, 108); await pg.waitForTimeout(400);
      const r = await heatState(pg);
      must(r.barPresent && r.barHot, `heat 108 must show the heat bar, hot: ${JSON.stringify(r)}`);
      must(r.overlay && r.word === 'OVERHEAT', `heat 108 must show the full-frame OVERHEAT overlay: ${JSON.stringify(r)}`);
      must(r.prompt === 'OVERHEAT', `heat 108 must show the OVERHEAT prompt in place of RECHARGE: ${JSON.stringify(r)}`);
      must(r.pointerEvents === 'none', `the overlay must never block a tap: pointer-events ${r.pointerEvents}`);
      const boxes = await pg.evaluate(() => {
        const rect = el => el ? el.getBoundingClientRect() : null;
        return { hp: rect(document.getElementById('hp')), sh: rect(document.getElementById('sh')), mag: rect(document.getElementById('mag')),
          hpVisible: document.getElementById('hp') ? getComputedStyle(document.getElementById('hp')).visibility !== 'hidden' : false,
          // a tap over HP must still hit something in the vitals column, not the pointer-events:none overlay
          hitsVitals: (() => { const hp = document.getElementById('hp'); if (!hp) return null; const b = hp.getBoundingClientRect();
            const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!(el && (el === hp || hp.contains(el) || el.closest('.vitals'))); })() };
      });
      must(boxes.hp && boxes.sh && boxes.hpVisible, `HP/armor must stay visible under the overlay: ${JSON.stringify(boxes)}`);
      must(boxes.hitsVitals, `a tap over the vitals must still land on the vitals, not be intercepted by the overlay: ${JSON.stringify(boxes)}`);
      const bad = await invariants(pg); must(bad.length === 0, bad.join(' ; '));
      await pg.screenshot({ path: `${OUT}/${tag}-overheat-${night ? 'night' : 'day'}.png` });
      await pg.close();
    });
  }
}
await step('heat bar se: heat falls back under the lockout and the OVERHEAT state clears', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 3, 108); await pg.waitForTimeout(400);
  let r = await heatState(pg);
  must(r.overlay && r.prompt === 'OVERHEAT', `pre-condition: must start overheating: ${JSON.stringify(r)}`);
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 3, 0); await pg.waitForTimeout(400);   // the gun's own next $ALCD after a reload/cooldown reports heat 0
  r = await heatState(pg);
  must(!r.overlay, `heat back to 0 must clear the full-frame overlay: ${JSON.stringify(r)}`);
  must(r.prompt !== 'OVERHEAT', `heat back to 0 must clear the OVERHEAT prompt: ${JSON.stringify(r)}`);
  must(r.barPresent && !r.barHot && r.barWidth === '0%', `the heat bar itself stays (this weapon has heated before) but reads empty and not hot: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-heat-cleared.png` });
  await pg.close();
});
// ---------- item 3 (bench 2026-09-17, playtest pl3): the OVERHEAT overlay/prompt used to key off
// `st.overheating` directly, which the node can echo back for up to 25 s after a stale reading (see
// engine.js `HEAT_STALE_MS`). `overheatShown` is the engine's narrower field (true only while the reading
// is live, about 6 s); this lane switches the HUD to read it, falling back to `overheating` while the
// engine field is still undefined (pl3-engine has not merged yet -- `window.__hud`/`window.brx.engine`
// drive this directly since the demo engine cannot set the new field itself). ----------
await step('heat bar se: st.overheatShown, once set, overrides the stale st.overheating field', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 3, 108); await pg.waitForTimeout(400);
  let r = await heatState(pg);
  must(r.overlay && r.prompt === 'OVERHEAT', `pre-condition: must start overheating: ${JSON.stringify(r)}`);
  // a stale-but-true st.overheating with overheatShown explicitly false must hide the takeover
  await pg.evaluate(() => { const h = window.__hud; h.sig = null; h.render({ ...window.brx.engine.state(), overheatShown: false }); });
  r = await heatState(pg);
  must(!r.overlay && r.prompt !== 'OVERHEAT', `overheatShown:false must hide OVERHEAT even though the stale st.overheating is still true: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-overheatshown-false-hides.png` });
  // the reverse: overheatShown explicitly true must show it even with the old field false
  await pg.evaluate(() => { const h = window.__hud; h.sig = null; h.render({ ...window.brx.engine.state(), overheating: false, overheatShown: true }); });
  r = await heatState(pg);
  must(r.overlay && r.prompt === 'OVERHEAT', `overheatShown:true must show OVERHEAT even with the old field false: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-overheatshown-true-shows.png` });
  await pg.close();
});
// ---------- item 5 (bench 2026-09-17): `.reload.hot`/`.reload.out` stayed a solid bright block with white
// text at night -- the one light-discipline miss in this file. Dark fill, `var(--num)` text, no glow. ----------
await step('night se: the OVERHEAT (.reload.hot) prompt drops the solid bright fill and white text', async () => {
  const pg = await open(VIEWS[1], 'live', '&night');
  await setAmmo(pg, 'charge_rifle', 0, 40, 80, 3, 108); await pg.waitForTimeout(400);
  const r = await pg.evaluate(() => { const el = document.querySelector('.reload.hot'); const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color }; });
  must(r.color !== 'rgb(255, 255, 255)', `night must not show white text on OVERHEAT: ${JSON.stringify(r)}`);
  must(r.bg === 'rgb(42, 12, 12)', `night must use the dark night fill on OVERHEAT, not the bright day block: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-reload-hot-night.png` });
  await pg.close();
});
await step('night se: the OUT OF ENERGY (.reload.out) prompt drops the solid bright fill and white text', async () => {
  const pg = await open(VIEWS[1], 'live', '&night');
  await setAmmo(pg, 'charge_rifle', 0, 40, 0, 0); await pg.waitForTimeout(400);
  const r = await pg.evaluate(() => { const el = document.querySelector('.reload.out'); const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color }; });
  must(r.color !== 'rgb(255, 255, 255)', `night must not show white text on OUT OF ENERGY: ${JSON.stringify(r)}`);
  must(r.bg === 'rgb(42, 12, 12)', `night must use the dark night fill on OUT OF ENERGY, not the bright day block: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-reload-out-night.png` });
  await pg.close();
});
// ---------- item 2 (bench 2026-09-17): the plain RELOAD/RECHARGE prompt (no `.hot`/`.out`) was missed by
// the fixes above and still blinked bright amber at night. ----------
await step('night se: the plain RELOAD/RECHARGE prompt stops blinking and drops the bright amber fill', async () => {
  const pg = await open(VIEWS[1], 'live', '&night');
  await setAmmo(pg, 'sniper_rifle', 0, 4, 24, 0); await pg.waitForTimeout(400);
  const r = await pg.evaluate(() => { const el = document.querySelector('.reload'); const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color, anim: cs.animationName }; });
  must(r.anim === 'none', `night must stop the RELOAD blink, got animation ${JSON.stringify(r.anim)}`);
  must(r.bg === 'rgb(42, 12, 12)', `night must use the dark night fill, not the bright amber block: ${JSON.stringify(r)}`);
  must(r.color !== 'rgb(26, 18, 0)', `night must not keep the day's dark-on-amber text colour: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-reload-plain-night.png` });
  await pg.close();
});
await step('night se: OVERHEAT/OUT OF ENERGY (.reload.hot/.reload.out) still win over the plain .reload night rule', async () => {
  const pg = await open(VIEWS[1], 'live', '&night');
  await setAmmo(pg, 'charge_rifle', 0, 40, 0, 0); await pg.waitForTimeout(400);
  const r = await pg.evaluate(() => { const el = document.querySelector('.reload.out'); const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color }; });
  must(r.bg === 'rgb(42, 12, 12)' && r.color !== 'rgb(255, 255, 255)', `the plain .reload night rule must not have knocked .reload.out off its own colours: ${JSON.stringify(r)}`);
  await pg.close();
});

// ---------- shot-ready cue (bench 2026-09-17): a weapon with >= 400 ms between rounds dims the gauge after each
// shot and shines once when the next round is due. Timed from the gun's own `$ALCD`, so never early. ----------
/** Put a full 44-field `$WEAP,<slot>` with token 14 = `ms` into the head the engine holds (the demo's head is a stub). */
const setWeap = (pg, slot, ms) => pg.evaluate(({ slot, ms }) => {
  const e = window.brx.engine; const f = `$WEAP,${slot},` + Array(41).fill('0').map((x, i) => i === 13 ? String(ms) : x).join(',') + ',*';
  e.frames.head = [...e.frames.head.filter(x => !x.startsWith(`$WEAP,${slot},`)), f];
}, { slot, ms });
/** Fire one round (mag -> mag-1) and record every `data-cool` change on #frame with its time since the shot. */
const shotTrace = (pg, weaponId, ms, waitMs) => pg.evaluate(async ({ weaponId, ms, waitMs }) => {
  const e = window.brx.engine, fr = document.getElementById('frame'); const trace = [];
  e.player.loadout.weapons[0] = { weapon_id: weaponId };
  e.frames.spawn = e.frames.spawn.map(f => f.startsWith('$AMMO,0,') ? '$AMMO,0,4,24,1,*' : f);
  e.feedFrame('$ALCD,4,100,0,24,0,*'); await new Promise(r => setTimeout(r, 300));
  let t0 = 0; let dimOpacity = null, dimMag = null, shine = null;
  const mo = new MutationObserver(() => {
    const v = fr.dataset.cool || ''; trace.push({ v, t: Math.round(performance.now() - t0) });
    if (v === 'on' && dimOpacity == null) setTimeout(() => { dimOpacity = +getComputedStyle(document.querySelector('.ammo .pips')).opacity; dimMag = +getComputedStyle(document.getElementById('mag')).opacity; }, 150);
    if (v === 'ready' && shine == null) { const pips = document.querySelector('.ammo .pips'); const af = getComputedStyle(pips, '::after');
      shine = { anim: af.animationName, display: af.display, filter: getComputedStyle(pips).filter, magFilter: getComputedStyle(document.getElementById('mag')).filter }; }
  });
  mo.observe(fr, { attributes: true, attributeFilter: ['data-cool'] });
  t0 = performance.now(); e.feedFrame('$ALCD,3,100,0,24,0,*');
  await new Promise(r => setTimeout(r, waitMs)); mo.disconnect();
  return { trace, dimOpacity, dimMag, shine, after: fr.dataset.cool || '', opacityAfter: +getComputedStyle(document.querySelector('.ammo .pips')).opacity };
}, { weaponId, ms, waitMs });
for (const [view, tag] of [[VIEWS[1], 'se'], [VIEWS[0], 'pixel']]) {
  for (const night of [false, true]) {
    await step(`${tag} shot cue ${night ? 'night' : 'day'}: a sniper (1500 ms a round) dims after the shot and shines once when the round is due, never early`, async () => {
      const pg = await open(view, 'live', night ? '&night' : '');
      await setWeap(pg, 0, 1500);
      const shoot = shotTrace(pg, 'sniper_rifle', 1500, 2100);
      await pg.waitForTimeout(300 + 700); await pg.screenshot({ path: `${OUT}/${tag}-shotcue-dim-${night ? 'night' : 'day'}.png` });
      await pg.waitForTimeout(540); await pg.screenshot({ path: `${OUT}/${tag}-shotcue-ready-${night ? 'night' : 'day'}.png` });
      const r = await shoot; await pg.close();
      const on = r.trace.find(x => x.v === 'on'), ready = r.trace.find(x => x.v === 'ready');
      must(on && on.t < 150, `the gauge must dim at the shot: ${JSON.stringify(r)}`);
      must(r.dimOpacity != null && r.dimOpacity < 0.8, `the dim must be visible (pips opacity under 0.8): ${JSON.stringify(r)}`);
      must(ready && ready.t >= 1500 && ready.t < 1800, `the ready cue must come at or after 1500 ms, never early: ${JSON.stringify(r.trace)}`);
      if (night) must(r.dimMag != null && r.dimMag < 0.8, `night hides the pips, so the round digits must dim too: ${JSON.stringify(r)}`);
      if (night) must(r.shine && r.shine.display === 'none' && /brightness/.test(r.shine.magFilter), `night: no moving shine, a dim brightness step on the digits instead: ${JSON.stringify(r.shine)}`);
      else must(r.shine && r.shine.anim === 'readyshine', `day: the green shine must run on ready: ${JSON.stringify(r.shine)}`);
      must(r.after === '' && r.opacityAfter === 1, `the cue must clear after the shine: ${JSON.stringify(r)}`);
    });
  }
}
await step('se shot cue reduced motion: a brightness step, no moving shine', async () => {
  const pg = await b.newPage({ viewport: { width: VIEWS[1].width, height: VIEWS[1].height }, reducedMotion: 'reduce' });
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=live`); await pg.waitForTimeout(4200);
  await setWeap(pg, 0, 600);
  const r = await shotTrace(pg, 'sniper_rifle', 600, 1100); await pg.close();
  must(r.trace.some(x => x.v === 'ready'), `pre-condition: the ready cue must fire: ${JSON.stringify(r.trace)}`);
  must(r.shine && r.shine.display === 'none' && /brightness/.test(r.shine.filter), `reduced motion must swap the shine for a brightness step: ${JSON.stringify(r.shine)}`);
});
await step('se shot cue CONTROL: an automatic weapon (assault rifle, 140 ms a round) gets no dim and no shine', async () => {
  const pg = await open(VIEWS[1], 'live');
  await setWeap(pg, 0, 140);
  const r = await shotTrace(pg, 'assault_rifle', 140, 900); await pg.close();
  must(r.trace.length === 0, `an automatic weapon must never dim or shine: ${JSON.stringify(r.trace)}`);
});

// ---------- live scores overlay (bench 2026-09-17): the player name opens PLAYERS, the clock opens TEAMS ----------
const boardState = pg => pg.evaluate(() => {
  const p = document.querySelector('.bdpanel'); const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
  return { open: !!p, tab: (document.querySelector('.bdseg .sg[aria-pressed="true"] .unskew') || {}).textContent || null,
    rows: document.querySelectorAll('.bdlist .bdr:not(.bdh)').length, me: Array.from(document.querySelectorAll('.bdr.me')).map(x => x.textContent.replace(/\s+/g, ' ').trim()),
    teams: Array.from(document.querySelectorAll('.bdteam .tm')).map(x => x.textContent.trim()), age: (document.getElementById('bdage') || {}).textContent || null,
    stale: !!document.querySelector('#bdage.stale'), panel: rect(p), hp: rect(document.getElementById('hp')), mag: rect(document.getElementById('mag')),
    chipsOpacity: getComputedStyle(document.getElementById('chips')).opacity };
});
const apart = (a, c) => !(a.l < c.r && a.r > c.l && a.t < c.b && a.b > c.t);
for (const view of VIEWS) {
  await step(`${view.name} scores overlay: the player name opens PLAYERS, every player row, my row highlighted, ✕ closes`, async () => {
    const pg = await open(view, 'live-scores');
    must(!(await boardState(pg)).open, 'the overlay must start closed');
    await pg.click('.ident'); await pg.waitForTimeout(200);
    const r = await boardState(pg);
    await pg.screenshot({ path: `${OUT}/${view.name}-scores-player.png` });
    must(r.open && r.tab === 'PLAYERS', `the name must open the PLAYERS tab: ${JSON.stringify(r)}`);
    must(r.rows === 4, `all four of MC's rows must show: ${JSON.stringify(r)}`);
    must(r.me.length === 1 && /REAPER/.test(r.me[0]) && /34%/.test(r.me[0]), `my row (REAPER, with accuracy) must be the one highlighted: ${JSON.stringify(r.me)}`);
    must(r.age === 'LIVE' && !r.stale, `a bound link reads LIVE: ${JSON.stringify(r)}`);
    must(apart(r.panel, r.hp) && apart(r.panel, r.mag), `the panel must leave the HP and ammo digits clear: ${JSON.stringify(r)}`);
    const bad = await invariants(pg); must(bad.length === 0, bad.join(' ; '));
    await pg.dispatchEvent('.bdx', 'pointerdown'); const pressed = await pg.evaluate(() => document.querySelector('.bdx').classList.contains('tap-press'));
    await pg.dispatchEvent('.bdx', 'pointerup');
    must(pressed, 'the ✕ must show the tap-press feedback');
    await pg.click('.bdx'); await pg.waitForTimeout(200);
    const c = await boardState(pg); await pg.close();
    must(!c.open, `✕ must close the overlay: ${JSON.stringify(c)}`);
  });
  await step(`${view.name} scores overlay: the clock opens TEAMS with MC's totals, a tap outside the panel closes it`, async () => {
    const pg = await open(view, 'live-scores');
    await pg.click('.clockplate'); await pg.waitForTimeout(200);
    const r = await boardState(pg);
    await pg.screenshot({ path: `${OUT}/${view.name}-scores-team.png` });
    must(r.open && r.tab === 'TEAMS', `the clock must open the TEAMS tab: ${JSON.stringify(r)}`);
    must(r.teams.length === 2 && /18/.test(r.teams[0]) && /21/.test(r.teams[1]), `both team totals from MC's board: ${JSON.stringify(r.teams)}`);
    must(r.me.length === 1 && /REAPER/.test(r.me[0]), `my row is highlighted under my team: ${JSON.stringify(r.me)}`);
    must(r.chipsOpacity === '0', `the chip bar must not draw over the open panel: ${r.chipsOpacity}`);
    await pg.click('.bdseg .sg[data-arg="player"]'); await pg.waitForTimeout(200);
    must((await boardState(pg)).tab === 'PLAYERS', 'the PLAYERS tab button must switch tabs');
    const box = r.panel; const scale = await pg.evaluate(() => document.getElementById('frame').getBoundingClientRect().width / 844);
    await pg.mouse.click(box.l - 40 * scale, box.t + 60 * scale); await pg.waitForTimeout(200);
    const c = await boardState(pg); await pg.close();
    must(!c.open, `a tap outside the panel must close it: ${JSON.stringify(c)}`);
  });
  await step(`${view.name} scores overlay: off the MC link the label gives the age of the last push`, async () => {
    const pg = await open(view, 'live-scores');
    await pg.evaluate(() => { window.brxDemo.mcLost(); window.brx.engine.scoreAt = Date.now() - 12000; });
    await pg.click('.ident'); await pg.waitForTimeout(300);
    const r = await boardState(pg);
    await pg.screenshot({ path: `${OUT}/${view.name}-scores-stale.png` });
    await pg.close();
    must(r.open && /^AS OF 1[23] S AGO$/.test(r.age || '') && r.stale, `a stale board must say how old it is: ${JSON.stringify(r)}`);
  });
}
// ---------- item 2 (bench 2026-09-17): `#frame[data-board] #chips{opacity:0}` hid the link-status pills
// but `button.pill` opts back into pointer-events, so a hidden RECONNECT/GUN LINK LOST button still sat
// over the panel's own tab row and could swallow a tap meant for TEAMS/PLAYERS. ----------
await step('scores overlay: a hidden pill under the tab row cannot intercept the tap meant for the tab', async () => {
  const pg = await open(VIEWS[1], 'live-scores');
  await pg.evaluate(() => window.brx.engine.onBleDropped());   // renders the GUN LINK LOST button into #chips
  await pg.click('.clockplate'); await pg.waitForTimeout(200);
  const r = await pg.evaluate(() => {
    // check the point where the hidden pill and the panel HEAD actually overlap on screen, not the tab's
    // own centre (the two boxes only partly overlap, and the tab's centre can sit just outside the pill).
    const btn = document.querySelector('[data-act="onReconnectGun"]'); const head = document.querySelector('.bdhead');
    const b = btn.getBoundingClientRect(), h = head.getBoundingClientRect();
    const overlaps = b.left < h.right && b.right > h.left && b.top < h.bottom && b.bottom > h.top;
    const x = (Math.max(b.left, h.left) + Math.min(b.right, h.right)) / 2, y = (Math.max(b.top, h.top) + Math.min(b.bottom, h.bottom)) / 2;
    const el = document.elementFromPoint(x, y);
    return { overlaps, hitsHead: !!(el && (el === head || head.contains(el))), btnPE: getComputedStyle(btn).pointerEvents,
      chipsPE: getComputedStyle(document.getElementById('chips')).pointerEvents };
  });
  must(r.overlaps, 'pre-condition: the hidden pill and the panel head must actually overlap for this check to mean anything');
  must(r.btnPE === 'none', `the hidden pill button must not stay tappable while the board is open: ${JSON.stringify(r)}`);
  must(r.hitsHead, `a tap where the pill overlaps the panel head must reach the panel, not the hidden pill underneath: ${JSON.stringify(r)}`);
  await pg.click('.bdseg .sg[data-arg="player"]'); await pg.waitForTimeout(200);
  const s = await boardState(pg); await pg.close();
  must(s.tab === 'PLAYERS', `the tap must actually switch the tab: ${JSON.stringify(s)}`);
});
// ---------- item 3 (bench 2026-09-17): the empty-board badge was long enough to push the ✕ off the panel ----------
await step('scores overlay: the empty-board badge is short and stays clear of the ✕', async () => {
  const pg = await open(VIEWS[1], 'live-scores');
  await pg.evaluate(() => { window.brx.engine.scoreAt = null; });
  await pg.click('.ident'); await pg.waitForTimeout(200);
  const r = await pg.evaluate(() => {
    const rect = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right }; };
    const age = document.getElementById('bdage'), x = document.querySelector('.bdx');
    return { text: age.textContent, age: rect(age), x: rect(x), overflow: getComputedStyle(age).textOverflow };
  });
  must(r.text === 'NO SCORES YET', `the badge copy must be short, got ${JSON.stringify(r.text)}`);
  must(r.overflow === 'ellipsis', `the badge must ellipsize rather than push its neighbour: ${r.overflow}`);
  must(r.age.r <= r.x.l, `the badge must stay left of the ✕, not overlap it: ${JSON.stringify(r)}`);
  await pg.screenshot({ path: `${OUT}/se-scores-empty-badge.png` });
  await pg.close();
});
// ---------- item 4 (bench 2026-09-17): the overlay tabs and ✕ were under the 44px tap-target floor ----------
await step('scores overlay: the tabs and the ✕ meet the 44px tap-target floor', async () => {
  const pg = await open(VIEWS[1], 'live-scores');
  await pg.click('.clockplate'); await pg.waitForTimeout(200);
  // #frame is the 844x390 design scaled to fit the viewport (top-of-file comment), so a raw getBoundingClientRect
  // reads SCALED px -- divide back to design px, same trick the "tap outside the panel" step above uses.
  const r = await pg.evaluate(() => {
    const scale = document.getElementById('frame').getBoundingClientRect().width / 844;
    const h = el => el.getBoundingClientRect().height / scale;
    return { tabs: Array.from(document.querySelectorAll('.bdseg .sg')).map(h), x: h(document.querySelector('.bdx')) };
  });
  must(r.tabs.length > 0 && r.tabs.every(v => v >= 44), `every overlay tab must be at least 44px tall (design px): ${JSON.stringify(r.tabs)}`);
  must(r.x >= 44, `the ✕ must be at least 44px tall (design px): ${r.x}`);
  await pg.close();
});
await step('se scores overlay FFA: the clock opens STANDINGS, a kills ranking with my row highlighted', async () => {
  const pg = await open(VIEWS[1], 'live-scores-ffa');
  await pg.click('.clockplate'); await pg.waitForTimeout(200);
  const r = await boardState(pg);
  await pg.screenshot({ path: `${OUT}/se-scores-ffa.png` });
  await pg.close();
  must(r.open && r.tab === 'STANDINGS' && r.rows === 4 && r.teams.length === 0, `FFA has no teams: the TEAM tab is the standings: ${JSON.stringify(r)}`);
  must(r.me.length === 1 && /REAPER/.test(r.me[0]), `my row is highlighted: ${JSON.stringify(r.me)}`);
});
for (const view of VIEWS) {
  await step(`${view.name} scores overlay night: dim panel, and the day/night switch still works with it open`, async () => {
    const pg = await open(view, 'live-scores', '&night');
    await pg.click('.clockplate'); await pg.waitForTimeout(200);
    const r = await boardState(pg);
    await pg.screenshot({ path: `${OUT}/${view.name}-scores-night.png` });
    must(r.open && r.tab === 'TEAMS', `night: the clock must open the overlay: ${JSON.stringify(r)}`);
    await pg.click('#skin'); await pg.waitForTimeout(300);
    const s2 = await pg.evaluate(() => document.getElementById('frame').dataset.env || '');
    const c = await boardState(pg); await pg.close();
    must(s2 === '', `the day/night switch must still switch with the overlay open: env ${s2}`);
    must(c.open, 'the skin switch must not close the overlay');
  });
}

// ---------- OVERHEAT vs WEAPONS HOT (bench 2026-09-17): the pill covered the centre of the word ----------
for (const [view, tag] of [[VIEWS[1], 'se'], [VIEWS[0], 'pixel']]) {
  for (const night of [false, true]) {
    await step(`${tag} OVERHEAT ${night ? 'night' : 'day'}: the word and the WEAPONS HOT pill do not overlap`, async () => {
      const pg = await open(view, 'live', night ? '&night' : '');
      await setAmmo(pg, 'charge_rifle', 0, 40, 80, 3, 108); await pg.waitForTimeout(300);
      const r = await pg.evaluate(() => {
        const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        const pill = Array.from(document.querySelectorAll('.chipbar .pill')).find(p => /WEAPONS HOT/.test(p.textContent));
        return { word: rect(document.querySelector('.heatword')), pill: rect(pill) };
      });
      await pg.screenshot({ path: `${OUT}/${tag}-overheat-weapons-hot-${night ? 'night' : 'day'}.png` });
      await pg.close();
      must(r.word && r.pill, `both must be on screen for the check to mean anything: ${JSON.stringify(r)}`);
      must(apart(r.word, r.pill), `OVERHEAT and WEAPONS HOT overlap: ${JSON.stringify(r)}`);
    });
  }
}

// ---------- S16 poison pill + S53 smoke / S55 recoil tells. All are driven through the REAL engine by the stage:
// the demo gun answers the node's own `$LIFE` ticks the way the bench measured, so the countdown, the pools and the
// DOWN screen below are what the phone would show, not a painted fixture. ----------
const tells = pg => pg.evaluate(() => {
  const vis = el => { if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
  const px = el => el ? getComputedStyle(el) : null;
  const poison = document.querySelector('#fxbar .fx.poison'), aim = document.querySelector('.aimfx');
  const secs = el => { const t = el && el.querySelector('.t'); return t ? parseInt(t.textContent, 10) : null; };
  return { poison: vis(poison), poisonText: poison ? poison.innerText.replace(/\s+/g, ' ') : '', poisonSecs: secs(poison),
    poisonRect: rect(poison), hpRect: rect(document.querySelector('.vitals .hp')), identRect: rect(document.querySelector('.ident')),
    aim: vis(aim), aimText: aim ? aim.innerText.replace(/\s+/g, ' ') : '', aimSecs: secs(aim), aimRect: rect(aim),
    reticle: vis(document.querySelector('.reticle')),
    anim: [poison, aim].filter(Boolean).map(e => px(e).animationName).filter(n => n && n !== 'none'),
    bg: [poison, aim].filter(Boolean).map(e => px(e).backgroundColor),
    ink: [poison, aim].filter(Boolean).map(e => px(e.querySelector('.k')).color),
    pills: Array.from(document.querySelectorAll('.chipbar .pill')).map(rect),
    hp: window.brx.engine.state().hp, armor: window.brx.engine.state().armor };
});
/** a background is "bright" when its sRGB luminance (alpha-weighted over black) passes a dim night fill */
const bright = (css, max = 60) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(css || ''); if (!m) return false; const a = m[4] == null ? 1 : +m[4]; return a * (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) > max; };
// the night palette's brightest ink is `--num` (#c9484a, luminance ~100); the day tells use near-white (~240)
await step('S16/S53 control: a plain live screen shows neither tell, and the reticle', async () => {
  const pg = await open(VIEWS[1], 'live'); const r = await tells(pg); await pg.close();
  must(!r.poison && !r.aim && r.reticle, `no poison, no smoke, reticle up: ${JSON.stringify(r)}`);
});
for (const [view, tag] of [[VIEWS[1], 'se'], [VIEWS[0], 'pixel']]) {
  for (const night of [false, true]) {
    const env = night ? 'night' : 'day';
    await step(`${tag} S16 poison ${env}: POISONED counts down above the health it drains, names the applier, no pulse`, async () => {
      const pg = await open(view, 'live-poison', night ? '&night' : '');
      const a = await tells(pg); await pg.waitForTimeout(1300); const b2 = await tells(pg);
      await pg.screenshot({ path: `${OUT}/${tag}-poison-${env}.png` });
      const bad = await invariants(pg); await pg.close();
      must(a.poison && /POISONED/.test(a.poisonText) && /VIPER/.test(a.poisonText), `the pill names the effect and the applier: ${JSON.stringify(a)}`);
      must(a.poisonSecs != null && b2.poisonSecs != null && b2.poisonSecs < a.poisonSecs, `the countdown moves: ${a.poisonSecs} then ${b2.poisonSecs}`);
      must(b2.armor < a.armor || b2.hp < a.hp, `a tick landed on the pools while it counted: ${JSON.stringify([a.armor, b2.armor])}`);
      must(apart(a.poisonRect, a.hpRect) && apart(a.poisonRect, a.identRect), `the pill sits clear of the HP digits and the callsign: ${JSON.stringify(a)}`);
      must(a.anim.length === 0, `no animation on the tell: ${a.anim}`);
      if (night) must(!a.bg.some(c => bright(c)) && !a.ink.some(c => bright(c, 150)), `no bright fill or ink at night: ${a.bg} / ${a.ink}`);
      must(bad.length === 0, bad.join(' ; '));
    });
    await step(`${tag} S53 smoke ${env}: SMOKED takes the reticle's place, says why, counts down, then clears`, async () => {
      const pg = await open(view, 'live-smoke', night ? '&night' : '');
      const a = await tells(pg); await pg.waitForTimeout(1300); const b2 = await tells(pg);
      await pg.screenshot({ path: `${OUT}/${tag}-smoke-${env}.png` });
      const bad = await invariants(pg);
      await pg.waitForTimeout(5200); const c = await tells(pg); await pg.close();
      must(a.aim && /SMOKED/.test(a.aimText) && /MISS/.test(a.aimText), `the tell names the effect and what it does: ${JSON.stringify(a)}`);
      must(!a.reticle, 'the reticle gives way to the tell');   // (night hides the reticle anyway; the day run is the one that proves the swap)
      must(a.aimSecs != null && b2.aimSecs != null && b2.aimSecs < a.aimSecs, `the countdown moves: ${a.aimSecs} then ${b2.aimSecs}`);
      must(a.pills.every(p => !p || apart(p, a.aimRect)), `no chip-bar pill covers the tell: ${JSON.stringify(a.pills)}`);
      must(a.anim.length === 0, `no animation on the tell: ${a.anim}`);
      if (night) must(!a.bg.some(c => bright(c)) && !a.ink.some(c => bright(c, 150)), `no bright fill or ink at night: ${a.bg} / ${a.ink}`);
      must(bad.length === 0, bad.join(' ; '));
      must(!c.aim && (night || c.reticle), `about 6 s after the hit the gun gives accuracy back and the tell is gone${night ? '' : ', reticle back'}: ${JSON.stringify(c)}`);
    });
    await step(`${tag} S55 recoil ${env}: RECOIL takes the reticle's place and clears after release`, async () => {
      const pg = await open(view, 'live', night ? '&night' : '');
      await pg.evaluate(() => window.brxDemo.fire(3));
      await pg.waitForFunction(() => /RECOIL/.test((document.querySelector('.aimfx') || {}).innerText || ''));
      const a = await tells(pg);
      await pg.screenshot({ path: `${OUT}/${tag}-recoil-${env}.png` });
      const bad = await invariants(pg);
      await pg.waitForFunction(() => !document.querySelector('.aimfx'));
      const c = await tells(pg);
      const healthy = await pg.evaluate(() => !window.brx.engine._recoil.disabled);
      await pg.evaluate(() => window.brxDemo.fire(3));
      await pg.waitForFunction(() => /RECOIL/.test((document.querySelector('.aimfx') || {}).innerText || ''));
      const again = await tells(pg); await pg.close();
      must(a.aim && /RECOIL/.test(a.aimText) && /RELEASE TO STEADY/.test(a.aimText), `the tell names the cause and remedy: ${JSON.stringify(a)}`);
      must(!a.reticle, 'the reticle gives way to the recoil tell');
      must(a.pills.every(p => !p || apart(p, a.aimRect)), `no chip-bar pill covers the tell: ${JSON.stringify(a.pills)}`);
      must(a.anim.length === 0, `no animation on the tell: ${a.anim}`);
      if (night) must(!a.bg.some(c2 => bright(c2)) && !a.ink.some(c2 => bright(c2, 150)), `no bright fill or ink at night: ${a.bg} / ${a.ink}`);
      must(bad.length === 0, bad.join(' ; '));
      must(!c.aim && (night || c.reticle), `after release the recoil tell clears${night ? '' : ' and the reticle returns'}: ${JSON.stringify(c)}`);
      must(healthy, 'the simulated gun acknowledged t4; the verifier must not disable recoil');
      must(again.aim && /RECOIL/.test(again.aimText), `a second burst still drives the real writer path: ${JSON.stringify(again)}`);
    });
  }
}
// ---------- review finding 2026-09-19: OVERHEAT and the smoke tell share the centre-screen slot in the
// player's eyeline, and at 891x411 they overlapped by about 25px when a player was overheating and smoked at
// the same time. `.heatword` moved from top:63% to top:74%, and `.aimfx` gets a `.tight` modifier (drops its
// sub-line) exactly in this combo -- see the comments beside both rules in app/www/index.html and the
// `tight` class hud.js adds in `_live()`. Order matters: `window.brxDemo.smoke()` overwrites the active
// slot's `$ALCD` (heat resets to 0), so the smoke fires FIRST and the forced heat lands after it. ----------
for (const [view, tag] of [[VIEWS[1], 'se'], [VIEWS[0], 'pixel']]) {
  for (const night of [false, true]) {
    await step(`${tag} OVERHEAT+SMOKED ${night ? 'night' : 'day'}: the word and the smoke tell do not overlap`, async () => {
      const pg = await open(view, 'live', night ? '&night' : '');
      await pg.evaluate(() => window.brxDemo.smoke());
      await pg.waitForTimeout(300);
      await setAmmo(pg, 'charge_rifle', 0, 40, 80, 3, 108);
      await pg.waitForTimeout(300);
      const r = await pg.evaluate(() => {
        const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        const word = document.querySelector('.heatword'), aim = document.querySelector('.aimfx');
        return { word: rect(word), aim: rect(aim), wordText: word ? word.textContent : '', aimText: aim ? aim.innerText.replace(/\s+/g, ' ') : '' };
      });
      await pg.screenshot({ path: `${OUT}/${tag}-overheat-smoked-${night ? 'night' : 'day'}.png` });
      const bad = await invariants(pg); await pg.close();
      must(r.word && r.aim, `both must be on screen for the check to mean anything: ${JSON.stringify(r)}`);
      must(/OVERHEAT/.test(r.wordText) && /SMOKED/.test(r.aimText), `both tells must still say what they mean: ${JSON.stringify(r)}`);
      must(apart(r.word, r.aim), `OVERHEAT and the smoke tell overlap: ${JSON.stringify(r)}`);
      must(bad.length === 0, bad.join(' ; '));
    });
  }
}
await step('S16 lethal tick: DOWN says POISONED BY and names the applier', async () => {
  const pg = await open(VIEWS[1], 'down-poisoned', '', 5200);
  const r = await pg.evaluate(() => ({ kb: (document.querySelector('.mo.down .kb') || {}).innerText || '', alive: window.brx.engine.state().alive }));
  await pg.screenshot({ path: `${OUT}/se-down-poisoned.png` }); await pg.close();
  must(!r.alive && /^POISONED BY/.test(r.kb.trim()) && /VIPER/.test(r.kb), `the down screen tells the player the poison did it: ${JSON.stringify(r)}`);
});

if (EXPECT_STEPS !== null && pass + fail !== EXPECT_STEPS) {
  errs.push(`selected ${pass + fail} steps, expected ${EXPECT_STEPS}`); fail++;
}
await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed${fail ? ': ' + errs.join(', ') : ''}`);
process.exit(fail ? 1 : 0);
