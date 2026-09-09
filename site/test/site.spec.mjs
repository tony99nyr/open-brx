// The whole gate for the Open BRX site. Every check asserts something a reader would see.
// Run: npm test (builds first). ONLY=<fragment> runs matching steps.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../webapp');
const only = process.env.ONLY;
const it = (name, fn) => (only && !name.includes(only) ? test.skip : test)(name, fn);

const urls = () => [...fs.readFileSync(path.join(WEB, 'sitemap.xml'), 'utf8')
  .matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  return errors;
}

it('0 · the build is clean and the server serves it', async ({ request }) => {
  const m = JSON.parse(fs.readFileSync(path.join(WEB, '.site-manifest.json'), 'utf8'));
  expect(m.problems).toEqual([]);
  expect(m.ok).toBe(true);
  expect((await request.get('/')).headers()['x-site-root']).toBe(WEB);
  expect(urls().length).toBe(m.pages);
});

// one step per page so a failure names the page
for (const u of urls()) {
  it(`1 · renders ${u}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(u, { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toBeVisible();

    const text = await page.locator('main').innerText();
    // an unconverted block marker or a TODO means the source is still in the old DSL
    expect(text, 'leftover block marker').not.toMatch(/\[(hero|callout|steps|cards|table|spec-sheet|accordion|faq|image|diagram|code|quote|stat-row|symptom-ladder|compare|bit-field|data-table|under-construction|timeline)\b/);
    expect(text, 'TODO reached a page').not.toMatch(/TODO/);
    expect(text, 'em dash reached a page').not.toMatch(/—/);
    // provenance marks are gone from the published prose
    expect(text, 'provenance badge reached a page').not.toMatch(/[✅📖🔍👥🧪📐🚧]/u);
    expect(text, 'src: citation reached a page').not.toMatch(/\bsrc:/);

    expect(errors).toEqual([]);
  });
}

it('2 · every internal link resolves', async ({ page, request }) => {
  const seen = new Set();
  const bad = [];
  for (const u of urls()) {
    await page.goto(u);
    const hrefs = await page.locator('a[href^="/"]').evaluateAll(as => as.map(a => a.getAttribute('href')));
    for (const h of hrefs) {
      if (seen.has(h)) continue;
      seen.add(h);
      const r = await request.get(h);
      if (!r.ok()) bad.push(`${u} -> ${h} (${r.status()})`);
    }
  }
  expect(bad).toEqual([]);
});

it('3 · the markdown twin of every page is the source, tables and all', async ({ request }) => {
  for (const u of urls()) {
    const twin = u === '/' ? '/index.md' : u.replace(/\/$/, '') + '.md';
    const r = await request.get(twin);
    expect(r.ok(), `${twin} missing`).toBe(true);
    const body = await r.text();
    expect(body, `${twin} has no H1`).toMatch(/^#\s+\S/m);
    // the old generator emitted "| col 1 | col 2 |" here, which is what llms.txt was serving
    expect(body, `${twin} lost its table headers`).not.toMatch(/\|\s*col 1\s*\|/);
  }
});

it('4a · every weapon publishes its wire-derived fire sound, cycle and heat', async ({ request }) => {
  // These three columns came from a markdown table that the build used to scrape. They now come
  // off the captured $WEAP frame (t14/t24/t27). A silently empty column is the regression to catch.
  const rows = await (await request.get('/data/weapons.json')).json();
  expect(rows.length).toBeGreaterThan(15);
  const noSound = rows.filter(r => !r.sound).map(r => r.name);
  expect(noSound, 'weapons with no fire sound id').toEqual([]);
  const noCycle = rows.filter(r => typeof r.cycle_ms !== 'number').map(r => r.name);
  expect(noCycle, 'weapons with no cycle time').toEqual([]);
  expect(rows.every(r => Number.isFinite(r.heat)), 'a heat value is NaN').toBe(true);
  // spot-check three the old published table pinned
  const by = n => rows.find(r => r.name === n);
  expect(by('Assault Rifle').sound).toBe('R01');
  expect(by('Charge Rifle')).toMatchObject({ sound: 'E03', cycle_ms: 1250, heat: 14 });
  expect(by('Rail Gun').sound).toBe('C03');
});

it('4 · the weapons table loads rows and filters', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/manual/gameplay/');
  const dt = page.locator('.dt[data-table="weapons"]');
  await expect(dt).toBeVisible();
  await expect(dt.locator('tbody tr')).not.toHaveCount(0);
  const all = await dt.locator('tbody tr').count();
  await dt.locator('[data-search]').fill('zzzznotaweapon');
  await expect(dt.locator('[data-count]')).toContainText('0 of');
  await dt.locator('[data-search]').fill('');
  await expect(dt.locator('tbody tr')).toHaveCount(all);
  expect(errors).toEqual([]);
});

it('5 · the sound bank loads rows, filters, and pages', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/manual/sound/');
  const dt = page.locator('.dt[data-table="sounds"]');
  await expect(dt).toBeVisible();
  await expect(dt.locator('[data-count]')).toContainText('rows');
  const first = await dt.locator('tbody tr').count();
  await dt.locator('[data-more]').click();
  expect(await dt.locator('tbody tr').count()).toBeGreaterThan(first);
  expect(errors).toEqual([]);
});

it('6 · a data table that cannot load says so instead of sitting empty', async ({ page }) => {
  await page.route('**/data/weapons.json', r => r.fulfill({ status: 500, body: 'nope' }));
  await page.goto('/manual/gameplay/');
  await expect(page.locator('.dt[data-table="weapons"] [data-count]')).toContainText('could not load');
  await expect(page.locator('.dt[data-table="weapons"] tbody')).toContainText('/data/weapons.json');
});

it('7 · the theme toggle changes the page and survives navigation', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator('.theme').click();
  const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(after).not.toBe(before);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.goto('/manual/hardware/');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
});

it('8 · on a phone the page never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  for (const u of urls()) {
    await page.goto(u);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${u} scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
  }
});

it('9 · 404 renders a real page', async ({ page }) => {
  const r = await page.goto('/no/such/page/');
  expect(r.status()).toBe(404);
  await expect(page.locator('h1')).toBeVisible();
});

it('10 \u00b7 every URL the old site published still resolves, by page or by redirect', async () => {
  // The 2026-09-09 cut removed 65 of 74 URLs. Search results and bookmarks still point at them,
  // so each must be absorbed by a _redirects rule rather than 404.
  const old = fs.readFileSync(path.join(HERE, 'old-urls.txt'), 'utf8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  expect(old.length).toBe(74);
  const rules = fs.readFileSync(path.join(WEB, '_redirects'), 'utf8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const [from, to, code] = l.split(/\s+/); return { from, to, code }; });
  const live = new Set(urls().map(u => u.replace(/\/$/, '') || '/'));
  const norm = u => u.replace(/\/$/, '') || '/';
  const matches = (from, url) => from.endsWith('/*')
    ? norm(url).startsWith(from.slice(0, -2) + '/') || norm(url) === norm(from.slice(0, -2))
    : norm(from) === norm(url);
  const covered = u => live.has(norm(u)) || rules.some(r => matches(r.from, u));
  const orphans = old.filter(u => !covered(u));
  expect(orphans, `old URLs that would 404: ${orphans.join(', ')}`).toEqual([]);
  // every redirect target must be a page that exists
  const badTargets = rules.filter(r => !live.has(r.to.replace(/\/$/, '') || '/'));
  expect(badTargets.map(r => `${r.from} -> ${r.to}`)).toEqual([]);
  // A rule must never match a page that still exists. A splat like `/manual/dev/*` also matches
  // `/manual/dev/` itself, which redirected the live page to itself and looped forever in production.
  const selfMatch = [...live].filter(p => rules.some(r => matches(r.from, p)));
  expect(selfMatch, `redirect rules that swallow a live page (loop): ${selfMatch.join(', ')}`).toEqual([]);
  // no rule may point at another rule's source, which would chain
  const chained = rules.filter(r => rules.some(o => matches(o.from, r.to)));
  expect(chained.map(r => `${r.from} -> ${r.to}`), 'chained redirects').toEqual([]);
});
