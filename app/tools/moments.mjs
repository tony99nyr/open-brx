// Screen-truth suite for the HUD's transient MOMENTS: hit taken, pool gain, kill confirm, death,
// redeploy. Every assertion is what a PERSON SEES -- the rendered overlay and its visible text --
// never engine state, because asserting `engine.moment.kind === 'hit'` would pass with the overlay
// never rendering at all.
//
// Serves www/ and drives the app's own `?demo` mode. Hits go through `engine.feedFrame(...)`, the
// REAL gun path, rather than the demo's `hit()` helper -- see `hitOnce` below for why that matters.
//
// Run: node tools/moments.mjs      ONLY=<substring> runs one step.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WWW = path.join(ROOT, 'www');
const OUT = path.join(ROOT, 'shots', 'moments');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY;

// Refuse to run on a stale bundle -- the second most common reason "it works for me".
const srcNewest = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
  .map(f => path.join(ROOT, 'src', f)).filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } })
  .reduce((a, f) => Math.max(a, fs.statSync(f).mtimeMs), 0);
const bundle = fs.statSync(path.join(WWW, 'app.js')).mtimeMs;
if (srcNewest > bundle) { console.error('STALE BUNDLE: src is newer than www/app.js. Run `npm run build` first.'); process.exit(2); }

const srv = http.createServer((req, res) => {
  const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0];
  try { res.setHeader('content-type', rel.endsWith('.js') ? 'text/javascript' : 'text/html');
        res.end(fs.readFileSync(path.join(WWW, rel))); } catch { res.statusCode = 404; res.end(); }
}).listen(4187);

let pass = 0, fail = 0; const errs = [];
const step = async (name, fn) => {
  if (ONLY && !name.includes(ONLY)) return;
  try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${String(e.message || e).slice(0, 300)}`); fail++; errs.push(name); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// Drive a hit through the REAL gun path (`feedFrame`), not `window.brxDemo.hit()`.
// The demo's helper decrements ITS OWN private hp/armour closure variables, which deplete over a
// long run; once they reach zero every call feeds `$HP,0,0` -- a DEATH, not a hit -- and reviving
// the engine does not reset them. That produced "the feature is broken" for three steps running.
const hitOnce = (p, dmg = 1) => p.evaluate(d => {
  const e = window.brx.engine;
  e.feedFrame('$HIR,4,0,19,2,9,0,3,*');
  e.feedFrame(`$HP,${e.hp},${Math.max(0, e.armor - d)},0,*`);
}, dmg);
// A dead demo player emits NO moments, so every step after a fatal one fails for the wrong reason.
// The demo SCRIPTS its own death on a timer (src/demo.js), so a long suite will outlive the player
// no matter how gently its own steps hit. Revive rather than race it: a dead player emits no
// moments at all, and every later step would then fail for a reason that has nothing to do with the
// feature under test.
const mustBeAlive = async p => {
  const revived = await p.evaluate(() => {
    const e = window.brx.engine;
    if (!e.alive && e.phase === 'live') { e._revive(false); return true; }
    return false;
  });
  // A revive sets a 'redeploy' moment, and the engine protects a rare moment for one render tick
  // (250 ms) so a hit cannot erase it before the HUD draws it. Firing instantly after a revive would
  // therefore be swallowed by that guard -- which is correct behaviour, so wait it out.
  // ALWAYS wait past the rare-moment guard, not just after a revive: a step that fires within
  // 250 ms of the previous step's kill/redeploy is legitimately suppressed by the engine, and that
  // shows up as "the feature is broken" when it is the guard working as designed.
  await p.waitForTimeout(revived ? 400 : 300);
  const alive = await p.evaluate(() => window.brx.engine.alive && window.brx.engine.phase === 'live');
  must(alive, 'the demo player is DEAD and could not be revived -- moments cannot fire');
};

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 891, height: 411 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message)));
await page.goto('http://127.0.0.1:4187/?demo');

// wait for the demo to reach LIVE and spawned -- the only state where moments fire
await page.waitForFunction(() => window.brx && window.brx.engine
  && window.brx.engine.phase === 'live' && window.brx.engine.spawned && window.brx.engine.alive,
  null, { timeout: 45000 });

const shot = async n => page.screenshot({ path: path.join(OUT, `${n}.png`) });

await step('hit taken renders a visible overlay with the damage number', async () => {
  await mustBeAlive(page);
  await hitOnce(page, 9);
  const el = page.locator('.mo.hit').first();
  await el.waitFor({ state: 'visible', timeout: 3000 });
  const dmg = await page.locator('.mo.hit .dmg').first().textContent();
  must(/^-\d+$/.test((dmg || '').trim()), `damage text was ${JSON.stringify(dmg)}`);
  await shot('hit');
});

await step('hit overlay CLEARS itself (it is transient, not stuck on screen)', async () => {
  await mustBeAlive(page);
  // Assert it EXISTED first. Without that this passes with _hit deleted entirely: "count is 0" is
  // trivially true when nothing is ever created.
  await hitOnce(page, 9);
  await page.locator('.mo.hit').first().waitFor({ state: 'visible', timeout: 3000 });
  must(await page.locator('.mo.hit').count() > 0, 'overlay never appeared, so "clears" proves nothing');
  await page.waitForFunction(() => document.querySelectorAll('.mo.hit').length === 0,
    null, { timeout: 4000 });
});

await step('sustained fire does NOT stack overlays into a red wall', async () => {
  await mustBeAlive(page);
  // The failure this guards: appending unconditionally left 8 vignettes alive at 10 hits/s, which
  // composited to a near-opaque red wash and hid the HP and ammo readouts at exactly the moment a
  // player is being focused. One live overlay per kind, re-triggered.
  await page.evaluate(async () => {
    // dmg 1: this step tests STACKING, not damage. Ten 9-damage hits killed the demo player, and a
    // dead player produces no moments at all, so every later step failed for the wrong reason.
    const e = window.brx.engine;
    for (let i = 0; i < 10; i++) {
      e.feedFrame('$HIR,4,0,19,2,9,0,3,*');
      e.feedFrame(`$HP,${e.hp},${Math.max(0, e.armor - 1)},0,*`);
      await new Promise(r => setTimeout(r, 100));
    }
  });
  const n = await page.locator('.mo.hit').count();
  must(n <= 1, `${n} hit overlays alive at once -- they composite into a wall`);
  const dmgs = await page.locator('.mo.hit .dmg').count();
  must(dmgs <= 1, `${dmgs} damage numbers drawn on top of each other`);
  await shot('burst');
});

await step('a KILL is not clobbered by a hit landing in the same moment', async () => {
  await mustBeAlive(page);
  // One `moment` slot, and `hit` is the highest-frequency producer: without a priority rule the
  // KILL CONFIRMED overlay was silently lost.
  // BOTH in ONE evaluate: the point is the SAME-TICK race, and a second round-trip lets the HUD
  // render the kill node first, which is exactly why the earlier version of this step passed with
  // the guard disabled.
  await page.evaluate(() => {
    const e = window.brx.engine;
    e.onMcMessage({ kind: 'feedback',
      body: { kind: 'kill', victim: 'BRAVO', victim_team: 'yellow', t: Date.now() } });
    e.feedFrame('$HIR,4,0,19,2,9,0,3,*');
    e.feedFrame(`$HP,${e.hp},${Math.max(0, e.armor - 1)},0,*`);
    if (e.moment && e.moment.kind !== 'kill') throw new Error('the hit overwrote the kill moment');
  });
  await page.locator('.mo.kill').first().waitFor({ state: 'visible', timeout: 3000 });
  must(/CONFIRMED/.test((await page.locator('.mo.kill').first().textContent()) || ''),
    'the kill overlay was replaced by the hit');
});

await step('a pool GAIN renders with a + amount and the pool name', async () => {
  await mustBeAlive(page);
  await page.evaluate(() => {
    const e = window.brx.engine;
    e.feedFrame(`$HP,${Math.max(1, e.hp)},${e.armor},0,*`);          // establish a baseline
    e.feedFrame(`$HP,${e.hp},${e.armor + 20},0,*`);                  // armour pickup
  });
  const el = page.locator('.mo.gain').first();
  await el.waitFor({ state: 'visible', timeout: 3000 });
  const amt = await page.locator('.mo.gain .amt').first().textContent();
  const lab = await page.locator('.mo.gain .lab').first().textContent();
  must(/^\+\d+$/.test((amt || '').trim()), `amount text was ${JSON.stringify(amt)}`);
  must(/ARMOUR|HEALTH|SHIELD/.test(lab || ''), `label was ${JSON.stringify(lab)}`);
  await shot('gain');
});

await step('kill confirm renders CONFIRMED and the elimination banner', async () => {
  await page.evaluate(() => window.brx.engine.onMcMessage(
    { kind: 'feedback', body: { kind: 'kill', victim: 'BRAVO', victim_team: 'yellow', t: Date.now() } }));
  const el = page.locator('.mo.kill').first();
  await el.waitFor({ state: 'visible', timeout: 3000 });
  const txt = (await el.textContent()) || '';
  must(/CONFIRMED/.test(txt), 'kill overlay did not say CONFIRMED');
  must(/ELIMINATION/.test(txt), 'kill overlay did not say ELIMINATION');
  await shot('kill');
});

await step('NIGHT mode keeps the hit information but drops the glare', async () => {
  // Use the app's OWN night path (`?night`), not a DOM poke: the HUD's render loop owns
  // `#frame[data-env]` and overwrites anything set behind its back, so poking it tested nothing.
  const pn = await b.newPage({ viewport: { width: 891, height: 411 } });
  pn.on('pageerror', e => pageErrors.push('night:' + e.message));
  await pn.goto('http://127.0.0.1:4187/?demo&night');
  await pn.waitForFunction(() => window.brx && window.brx.engine
    && window.brx.engine.phase === 'live' && window.brx.engine.spawned && window.brx.engine.alive,
    null, { timeout: 45000 });
  const env = await pn.evaluate(() => document.querySelector('#frame').dataset.env);
  must(env === 'night', `night mode did not engage (data-env=${env})`);
  await hitOnce(pn, 7);
  const dmg = pn.locator('.mo.hit .dmg').first();
  await dmg.waitFor({ state: 'visible', timeout: 3000 });
  must(await dmg.isVisible(), 'damage number vanished at night -- you must still know you are hit');
  const shadow = await dmg.evaluate(n => getComputedStyle(n).textShadow);
  must(shadow === 'none', `night should drop the glow, got ${shadow}`);
  await pn.screenshot({ path: path.join(OUT, 'hit-night.png') });
  await pn.close();
});

await step('NO repeating animation on the hit overlay (strobe guard)', async () => {
  await mustBeAlive(page);
  // The whole reason this feedback is on the phone: flicker in the 10-25Hz band is the
  // photosensitive-epilepsy trigger range. Any `infinite` animation here would be that bug.
  await hitOnce(page, 1);
  const el = page.locator('.mo.hit').first();
  await el.waitFor({ state: 'visible', timeout: 3000 });
  const iters = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.mo, .mo *').forEach(n =>
      out.push(getComputedStyle(n).animationIterationCount));
    return out;
  });
  must(!iters.some(v => String(v).includes('infinite')), `found an infinite animation: ${iters.join(',')}`);
});

await step('reduced-motion users still SEE the hit, without the animation', async () => {
  const p2 = await b.newPage({ viewport: { width: 891, height: 411 }, reducedMotion: 'reduce' });
  p2.on('pageerror', e => pageErrors.push('reduced:' + e.message));
  await p2.goto('http://127.0.0.1:4187/?demo');
  await p2.waitForFunction(() => window.brx && window.brx.engine
    && window.brx.engine.phase === 'live' && window.brx.engine.spawned && window.brx.engine.alive,
    null, { timeout: 45000 });
  await hitOnce(p2, 9);
  const el = p2.locator('.mo.hit').first();
  await el.waitFor({ state: 'visible', timeout: 3000 });
  const name = await p2.locator('.mo.hit .dmg').first().evaluate(n => getComputedStyle(n).animationName);
  must(name === 'none', `animation still running under reduced motion: ${name}`);
  must(await p2.locator('.mo.hit .dmg').first().isVisible(), 'damage number not visible under reduced motion');
  await p2.screenshot({ path: path.join(OUT, 'hit-reduced.png') });
  await p2.close();
});

await step('moment overlays do NOT cover the match clock', async () => {
  await mustBeAlive(page);
  // A transient that hides the clock during a firefight is a bad trade. Both overlays originally
  // sat at the top and landed squarely on it -- caught by looking at the screenshot, not by a
  // passing assertion, which is why this check now exists.
  const clock = await page.locator('#clock').first().boundingBox();
  must(clock, 'could not find the match clock -- this check would silently pass without it');
  await hitOnce(page, 9);
  await page.locator('.mo.hit .dmg').first().waitFor({ state: 'visible', timeout: 3000 });
  const dmg = await page.locator('.mo.hit .dmg').first().boundingBox();
  {
    const overlap = !(dmg.x + dmg.width < clock.x || clock.x + clock.width < dmg.x
                   || dmg.y + dmg.height < clock.y || clock.y + clock.height < dmg.y);
    must(!overlap, `hit overlay overlaps the clock: dmg=${JSON.stringify(dmg)} clock=${JSON.stringify(clock)}`);
  }
  await shot('hit-placed');
});

await step('reduced motion stops the HUD blinkers, not just the overlays', async () => {
  // The first version of this rule was `.frame *`, which matched NOTHING (the element is
  // id="frame"), so `.takingfire` kept blinking infinitely while the CSS claimed otherwise. The
  // strobe step could not see it: it only queries `.mo, .mo *`.
  const p3 = await b.newPage({ viewport: { width: 891, height: 411 }, reducedMotion: 'reduce' });
  p3.on('pageerror', e => pageErrors.push('rm2:' + e.message));
  await p3.goto('http://127.0.0.1:4187/?demo');
  await p3.waitForFunction(() => window.brx && window.brx.engine
    && window.brx.engine.phase === 'live' && window.brx.engine.spawned, null, { timeout: 45000 });
  await hitOnce(p3, 1);
  await p3.waitForTimeout(300);
  const spinning = await p3.evaluate(() => {
    const out = [];
    document.querySelectorAll('#frame *').forEach(n => {
      const c = getComputedStyle(n);
      if (String(c.animationIterationCount).includes('infinite') && c.animationName !== 'none') {
        out.push(`${n.className || n.id}:${c.animationName}`);
      }
    });
    return out;
  });
  must(spinning.length === 0, `still animating under reduced motion: ${spinning.slice(0, 4).join(', ')}`);
  await p3.close();
});

await step('no page errors were thrown during any of it', async () => {
  must(pageErrors.length === 0, `page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
});

await b.close(); srv.close();
console.log(`\n  ${pass} passed, ${fail} failed   shots -> ${OUT}`);
if (fail) { console.log('  failed:', errs.join(', ')); process.exit(1); }
