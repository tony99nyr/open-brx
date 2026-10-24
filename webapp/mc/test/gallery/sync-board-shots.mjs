// F596/F597 storyboard: frozen renders of RECAP with the SYNC BOARD, at 1280x720, from `?mock&gallery=<frame>`.
//   node test/gallery/sync-board-shots.mjs <outDir> [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2];
const base = process.argv[3] || 'http://localhost:5391';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const log = [];
async function open(frame, layout, extra = '') {
  const page = await ctx.newPage();
  page.on('pageerror', e => log.push(String(e)));
  await page.goto(`${base}/?mock&norandom=1&gallery=${frame}${layout === 'tiles' ? '&syncboard=tiles' : layout === 'table' ? '&syncboard=table' : layout === 'strip' ? '&syncboard=strip' : ''}${extra}#recap`);
  await page.waitForSelector('[data-testid="recap-status"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
// fits above the fold: the board's and header's bottom edge inside the 720 px viewport
async function fold(page, name) {
  const r = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="sync-board"]') || document.querySelector('[data-testid="all-synced"]') || document.querySelector('[data-testid="recap-headline"]');
    const b = el?.getBoundingClientRect();
    return b ? { bottom: Math.round(b.bottom), top: Math.round(b.top) } : null;
  });
  log.push(`${name}: board ${JSON.stringify(r)}`);
}
for (const layout of ['list', 'tiles']) {
  const sfx = layout === 'list' ? 'A' : 'B';
  for (const fr of ['c', 'i']) { const p = await open(fr, layout); await shot(p, `${fr}-option-${sfx}`); await fold(p, `${fr}-${sfx}`); await p.close(); }
}
for (const fr of ['b', 'd', 'g', 'j']) { const p = await open(fr, 'list'); await shot(p, fr); await fold(p, fr); await p.close(); }
{ // e, f, h: one page, real clicks, then a late phone
  const p = await open('d2', 'list');
  await p.click('[data-testid="finalise"]');
  await p.waitForTimeout(250);
  await shot(p, 'e'); await fold(p, 'e');
  await p.click('[data-testid="finalise"]');
  await p.waitForSelector('[data-testid="final-without"]');
  await p.waitForTimeout(250);
  await shot(p, 'f'); await fold(p, 'f');
  await p.evaluate(() => window.__brxGallery('h'));
  await p.waitForSelector('[data-testid="result-changed"]');
  await p.waitForTimeout(250);
  await shot(p, 'h'); await fold(p, 'h');
  await p.close();
}
{ // a: BEFORE, from the unmodified console (baseUrl2)
  const b2 = process.argv[4];
  if (b2) {
    const p = await ctx.newPage();
    await p.goto(`${b2}/?mock&norandom=1&gallery=a#recap`);
    await p.waitForSelector('[data-testid="recap-status"]', { timeout: 15000 });
    await p.waitForTimeout(500);
    await shot(p, 'a');
    await p.close();
    const q = await ctx.newPage();
    await q.goto(`${b2}/?mock&norandom=1&gallery=a16#recap`);
    await q.waitForSelector('[data-testid="recap-status"]', { timeout: 15000 });
    await q.waitForTimeout(500);
    await shot(q, 'a-16');
    await q.close();
  }
}
{ // Option C: the sync column inside FULL STATS
  const C = [['b', 'b', ''], ['c', 'c', '&station=1&endopen=1'], ['d', 'd', ''], ['g', 'g', ''], ['i', 'i', '&endopen=2'], ['j', 'j', '&endopen=1']];
  for (const [name, fr, extra] of C) {
    const p = await open(fr, 'table', extra);
    await shot(p, `c-option-C-${name}`);
    const r = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-recap-name]')].map(e => e.closest('div').getBoundingClientRect().bottom);
      const st = document.querySelector('[data-testid="station-sync"]')?.getBoundingClientRect().bottom;
      const small = [...document.querySelectorAll('.screen *')].filter(e => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length;
      return { lastRowBottom: Math.round(Math.max(...rows)), stationBottom: st ? Math.round(st) : null, under11: small };
    });
    log.push(`C-${name}: ${JSON.stringify(r)}`);
    await p.close();
  }
}
{ // Option D: the strip of phone icons above FULL STATS
  const D = [['b', 'b', ''], ['c', 'c2', '&station=1&endopen=1'], ['d', 'd', ''], ['g', 'g', ''], ['i', 'i', '&station=1&endopen=2'], ['32', 'i32', '&station=1'], ['48', 'i48', '&station=1']];
  const probe = p => p.evaluate(() => {
    const st = document.querySelector('[data-testid="sync-strip"]')?.getBoundingClientRect();
    const th = document.querySelector('[data-col-head="k"]')?.getBoundingClientRect();
    return { stripBottom: st ? Math.round(st.bottom) : null, tableHeadTop: th ? Math.round(th.top) : null, iconW: document.querySelector('[data-testid="sync-strip"]')?.dataset.iconW ?? null };
  });
  for (const [name, fr, extra] of D) {
    const p = await open(fr, 'strip', extra);
    await shot(p, `c-option-D-${name}`);
    log.push(`D-${name}: ${JSON.stringify(await probe(p))}`);
    await p.close();
  }
  { // all-green: the last phone arrives, the strip is still and green for 2 s, then collapses
    const p = await open('d2', 'strip', '');
    await p.evaluate(() => window.__brxGallery('g'));
    await p.waitForTimeout(500);
    await shot(p, 'c-option-D-all-green');
    log.push(`D-all-green: still=${await p.evaluate(() => document.querySelector('[data-testid="sync-strip"]')?.dataset.still)} motion=${await p.evaluate(() => document.querySelectorAll('[data-strip-motion]').length)}`);
    await p.waitForSelector('[data-testid="all-synced"]', { timeout: 5000 });
    await p.waitForTimeout(200);
    await shot(p, 'c-option-D-collapsed');
    await p.close();
  }
  { // prefers-reduced-motion: reduce
    const rctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    const p = await rctx.newPage();
    await p.goto(`${base}/?mock&norandom=1&gallery=c2&syncboard=strip&station=1&endopen=1#recap`);
    await p.waitForSelector('[data-testid="sync-strip"]', { timeout: 15000 });
    await p.waitForTimeout(500);
    await shot(p, 'c-option-D-reduced');
    log.push('D-reduced animations: ' + await p.evaluate(() => [...document.querySelectorAll('.sb-dot,.sb-ring')].map(e => getComputedStyle(e).animationName).join(',')));
    await rctx.close();
  }
}
console.log(log.join('\n'));
await browser.close();
