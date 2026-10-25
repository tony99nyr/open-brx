// F596/F597 renders: RECAP with the sync strip, at 1280x720, from the PRODUCTION build (`npx vite build`, then
// `npx vite preview --port <p>`) and `?mock&gallery=<frame>`. Frames live in src/mock/gallery.ts.
//   node test/gallery/sync-board-shots.mjs <outDir> <baseUrl>
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2];
const base = process.argv[3] || 'http://localhost:4173';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const log = [];
const open = async (frame, ctx) => {
  const page = await ctx.newPage();
  page.on('pageerror', e => log.push(`PAGEERROR ${frame}: ${e}`));
  await page.goto(`${base}/?mock&norandom=1&gallery=${frame}#recap`);
  await page.waitForSelector('[data-testid="recap-status"]', { timeout: 15000 });
  await page.waitForTimeout(400);
  return page;
};
const probe = p => p.evaluate(() => {
  const r = s => document.querySelector(s)?.getBoundingClientRect();
  const rows = [...document.querySelectorAll('[data-recap-name]')].map(e => e.closest('[data-sync-row], div').getBoundingClientRect().bottom);
  const strip = r('[data-testid="sync-strip"]') ?? r('[data-testid="all-synced"]');
  return { rows: rows.length, lastRowBottom: rows.length ? Math.round(Math.max(...rows)) : null, stripBottom: strip ? Math.round(strip.bottom) : null,
    unverified: document.querySelectorAll('[data-unverified="1"]').length, syncCol: !!document.querySelector('[data-col-head="sync"]') };
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const frames = [['b', 'b'], ['c', 'c'], ['d', 'd'], ['i', 'i'], ['48', 'i48'], ['finalised-without-1', 'fin1'], ['result-changed', 'chg']];
for (const [name, fr] of frames) {
  const p = await open(fr, ctx);
  if (fr === 'fin1') await p.waitForSelector('[data-testid="final-without"]');
  await p.screenshot({ path: `${out}/${name}.png` });
  log.push(`${name}: ${JSON.stringify(await probe(p))}`);
  await p.close();
}
{ // all-green: the last phone arrives; still and green for 2 s; then the strip AND the SYNC column collapse to one green line
  const p = await open('d', ctx);
  await p.evaluate(() => window.__brxGallery('g'));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/all-green.png` });
  log.push(`all-green: still=${await p.evaluate(() => document.querySelector('[data-testid="sync-strip"]')?.dataset.still)} motion=${await p.evaluate(() => document.querySelectorAll('[data-strip-motion]').length)} ${JSON.stringify(await probe(p))}`);
  await p.waitForSelector('[data-testid="all-synced"]', { timeout: 5000 });
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${out}/collapsed.png` });
  log.push(`collapsed: ${JSON.stringify(await probe(p))}`);
  await p.close();
}
{ // all-green-col-collapsed: everything in; a row that lost facts and a row with its END open keep a badge by the name
  const p = await open('c', ctx);
  await p.evaluate(() => window.__brxGallery('lost'));
  await p.waitForSelector('[data-testid="all-synced"]', { timeout: 6000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/all-green-col-collapsed.png` });
  log.push(`all-green-col-collapsed: ${JSON.stringify(await probe(p))}`);
  await p.close();
}
{ // the projector (SPECTATE) while pending: no winner, no score, no ranking
  const p = await ctx.newPage();
  await p.goto(`${base}/?mock&norandom=1&gallery=c#spectate`);
  await p.waitForSelector('[data-spectate="pending"]', { timeout: 15000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/spectate-pending.png` });
  log.push(`spectate-pending: ${await p.evaluate(() => /WINS/.test(document.body.innerText))}`);
  await p.close();
}
{ // e, f: the two taps, then FINALISE released the result
  const p = await open('d', ctx);
  await p.click('[data-testid="finalise"]');
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${out}/finalise-armed.png` });
  await p.close();
}
{ // prefers-reduced-motion: reduce
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const p = await rctx.newPage();
  await p.goto(`${base}/?mock&norandom=1&gallery=c#recap`);
  await p.waitForSelector('[data-testid="sync-strip"]', { timeout: 15000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/reduced.png` });
  log.push('reduced animations: ' + await p.evaluate(() => [...document.querySelectorAll('.sb-dot,.sb-ring')].map(e => getComputedStyle(e).animationName).join(',')));
  await rctx.close();
}
console.log(log.join('\n'));
await browser.close();
