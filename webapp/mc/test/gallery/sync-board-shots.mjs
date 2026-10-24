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
async function open(frame, layout) {
  const page = await ctx.newPage();
  page.on('pageerror', e => log.push(String(e)));
  await page.goto(`${base}/?mock&norandom=1&gallery=${frame}${layout === 'tiles' ? '&syncboard=tiles' : ''}#recap`);
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
console.log(log.join('\n'));
await browser.close();
