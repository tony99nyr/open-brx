// ui-build-verify checklist for the Open BRX static site. Every step asserts what a person SEES.
// Run: npm test (builds first). ONLY=<title fragment> runs matching steps: ONLY=explorer npx playwright test
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');
const REPO = path.resolve(SITE, '..');
const WEB = path.join(REPO, 'webapp');
const STALE = 'http://localhost:4174';
const only = process.env.ONLY;
const it = (name, fn) => (only && !name.includes(only) ? test.skip : test)(name, fn);
const HEDGE = /\b(probably|likely|we think|we believe|reportedly|unconfirmed|unverified|may be|might be|appears to)\b/i;
const BLOCK_MARKER = /\[[a-z][a-z-]*(?::[a-z|]+)?(?:\s+[A-Za-z0-9-]+)?\]/;

function sitemapUrls() {
  const xml = fs.readFileSync(path.join(WEB, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
}
const manifest = () => JSON.parse(fs.readFileSync(path.join(WEB, '.site-manifest.json'), 'utf8'));
function watchErrors(page, allow = []) {
  const errors = [];
  const ok = s => allow.some(a => s.includes(a));
  page.on('pageerror', e => { const s = 'pageerror: ' + e.message; if (!ok(s)) errors.push(s); });
  page.on('console', m => { if (m.type() === 'error') { const s = 'console: ' + m.text(); if (!ok(s)) errors.push(s); } });
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('fonts.g')) { const s = `http ${r.status()} ${r.url()}`; if (!ok(s)) errors.push(s); } });
  return errors;
}

// ---- 0. we are testing the build we think we are ---------------------------------------------
it('0 · the server on :4173 serves the committed webapp/ output; sitemap ↔ manifest ↔ search index agree', async ({ request }) => {
  const r = await request.get('/');
  expect(r.headers()['x-site-root']).toBe(WEB);
  const m = manifest();
  expect(m.ok).toBe(true);
  const urls = sitemapUrls();
  expect(urls.length).toBe(m.htmlFiles);
  const idx = await (await request.get('/data/search.json')).json();
  expect(idx.length).toBe(urls.length);
  expect(new Set(idx.map(p => p.url.replace(/\/$/, '') || '/'))).toEqual(new Set(urls.map(u => u.replace(/\/$/, '') || '/')));
});

// ---- 1. fresh build: every page renders (one step per page so a failure names the page) --------
for (const u of sitemapUrls()) {
  it(`1 · renders ${u}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(u, { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toHaveCount(1);
    const title = await page.title();
    const segs = title.split(' | ');
    expect(new Set(segs).size, `doubled <title>: ${title}`).toBe(segs.length);
    expect(await page.locator('code.language-mermaid').count(), 'mermaid source published').toBe(0);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('time[datetime]').first()).toBeAttached();
    const text = await page.locator('main').innerText();
    // prose only (code samples legitimately contain [placeholders])
    const prose = await page.evaluate(() => { const c = document.querySelector('main').cloneNode(true); c.querySelectorAll('pre, code').forEach(e => e.remove()); return c.innerText; });
    expect(prose, 'raw block marker').not.toMatch(BLOCK_MARKER);
    expect(text, "shows 'undefined'/NaN").not.toMatch(/\bundefined\b|\bNaN\b/);
    expect(text, 'raw src: line').not.toMatch(/(^|\s)src:\s/);
    expect(text, 'leaked held content').not.toContain('Research backlog');
    expect(text, 'unconfirmed marker').not.toContain('❓');
    expect(text, 'hedge language').not.toMatch(HEDGE);
    expect(await page.locator('[data-todo]').count(), 'TODO chip on a real page').toBe(0);
    // every TOC link resolves to an element on the page; every figure has an accessible name
    const dangling = await page.evaluate(() => [...document.querySelectorAll('.toc a[href^="#"]')].map(a => a.getAttribute('href').slice(1)).filter(id => !document.getElementById(id)));
    expect(dangling, 'dangling TOC anchors').toEqual([]);
    const dupIds = await page.evaluate(() => { const seen = new Set(), d = []; for (const el of document.querySelectorAll('[id]')) { if (seen.has(el.id)) d.push(el.id); seen.add(el.id); } return d; });
    expect(dupIds, 'duplicate ids').toEqual([]);
    const badFig = await page.evaluate(() => [...document.querySelectorAll('figure')].filter(f => !(f.querySelector('img[alt]') || f.querySelector('[aria-label]'))).length);
    expect(badFig, 'figure without alt/aria-label').toBe(0);
    // "→ Title" cross-references must be links, and page links must show a title, not a raw slug
    const deadRefs = await page.evaluate(() => [...document.querySelectorAll('main em')].filter(e => !e.closest('a, figcaption') && /→\s*$/.test((e.previousSibling?.textContent || '').slice(-3))).map(e => e.textContent));
    expect(deadRefs, 'dead → cross-references').toEqual([]);
    const slugLinks = await page.evaluate(() => [...document.querySelectorAll('main a.pl')].filter(a => /^\/(manual|platform)/.test(a.textContent.trim())).map(a => a.textContent));
    expect(slugLinks, 'page links showing raw slugs').toEqual([]);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw, `horizontal page overflow (${sw} > ${iw})`).toBeLessThanOrEqual(iw + 1);
    // provenance is explained once, on /credits/ — a page that shows marks must link there
    if (await page.locator('.meta .badge').count()) {
      await expect(page.locator('.meta a.how')).toHaveAttribute('href', '/credits/#how-we-know');
      await expect(page.locator('.meta .badge').first()).toHaveText(/\w/); // the word, not a bare dot
    }
    expect(await page.locator('.legend, details.legend').count(), 'per-page badge legend is back').toBe(0);
    // house style: an em dash never reaches a reader
    const emdash = await page.evaluate(() => { const c = document.querySelector('main').cloneNode(true); c.querySelectorAll('pre, code').forEach(e => e.remove()); const t = c.innerText; const i = t.indexOf('\u2014'); return i < 0 ? null : t.slice(Math.max(0, i - 60), i + 60); });
    expect(emdash, `em dash in rendered text: ${emdash}`).toBeNull();
    expect(title, 'em dash in <title>').not.toContain('\u2014');
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

// ---- 1d. the design contract: what "less cluttered, more technical" means, asserted on screen ----
it('1d · page furniture is one meta line; a pending image is a strip, not a hero-sized box', async ({ page }) => {
  await page.goto('/manual/hardware/leds/', { waitUntil: 'networkidle' });
  // the head is: h1, subtitle, one meta line — and nothing else
  const head = await page.evaluate(() => [...document.querySelectorAll('.page-head > *')].map(e => e.tagName.toLowerCase() + '.' + e.className));
  expect(head, `page head grew furniture: ${head.join(', ')}`).toEqual(['h1.', 'p.subtitle', 'p.meta']);
  await expect(page.locator('.page-head .meta')).toBeVisible();
  // the head is title + subtitle + one meta row; on a phone the meta row wraps, nothing more
  const budget = page.viewportSize().width < 820 ? 260 : 200;
  const headH = await page.locator('.page-head').evaluate(e => Math.round(e.getBoundingClientRect().height));
  expect(headH, `page head is ${headH}px, over the ${budget}px budget`).toBeLessThan(budget);
  // one text family: no display face for headings, and headings match running prose
  const fams = await page.evaluate(() => ['h1', '.subtitle', 'main h2', 'main .blk p'].map(s => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontFamily.split(',')[0].replace(/"/g, '') : null; }));
  expect(new Set(fams.filter(Boolean)).size, `heading and body faces differ: ${fams.join(' / ')}`).toBe(1);
  expect(fams[0]).toBe('IBM Plex Sans');
  // a placeholder for an unshot image must not consume a screen
  await page.goto('/', { waitUntil: 'networkidle' });
  const phs = await page.locator('.ph').all();
  expect(phs.length, 'no placeholder on the home page to measure').toBeGreaterThan(0);
  for (const ph of phs) {
    const h = await ph.evaluate(e => Math.round(e.getBoundingClientRect().height));
    expect(h, 'pending-image placeholder is hero-sized again').toBeLessThan(64);
  }
});

it('1e · light by default; the section index on the home page routes to all seven sections', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('brx-theme'); } catch {} });
  await page.goto('/', { waitUntil: 'networkidle' });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lum = bg.match(/\d+/g).slice(0, 3).reduce((a, c) => a + Number(c), 0) / 3;
  expect(lum, `home is not light by default (body bg ${bg})`).toBeGreaterThan(200);
  const links = page.locator('.index a');
  await expect(links).toHaveCount(7);
  await expect(page.locator('.index-note')).toHaveText(/verified \d{4}-\d\d-\d\d/);
  for (let i = 0; i < 7; i++) {
    await expect(links.nth(i).locator('.n')).toHaveText(/^0[1-7]$/);
    await expect(links.nth(i).locator('.t')).not.toBeEmpty();
    await expect(links.nth(i).locator('.v')).toHaveText(/^\d+ pages?$/);
    // the blurb is the section's own page titles, never an author-facing goal or a mid-sentence cut
    const d = await links.nth(i).locator('.d').innerText();
    expect(d, `index blurb is truncated: ${d}`).not.toMatch(/…$/);
  }
  // the row is a real route, not decoration
  const href = await links.nth(2).getAttribute('href');
  const title = (await links.nth(2).locator('.t').innerText()).trim();
  await links.nth(2).click();
  await expect(page).toHaveURL(new RegExp(href.replace(/[/]/g, '\\/') + '$'));
  await expect(page.locator('h1')).toContainText(title);
});

it('1h · on a phone a table either fits the screen or scrolls — it is never crushed into a tower', async ({ page }) => {
  const vp = page.viewportSize();
  test.skip(vp.width >= 820, 'phone-only table sizing');
  let fits = 0, scrolls = 0;
  // a mix of wide reference tables (must scroll) and 2-column tables (must fit)
  for (const u of ['/manual/hardware/leds/', '/manual/dev/commands/', '/manual/hardware/spec-sheet/', '/manual/dev/weap/', '/manual/dev/brx-mcp/', '/manual/operate/sighting/', '/manual/sound/voice-packs/']) {
    await page.goto(u, { waitUntil: 'networkidle' });
    const rows = await page.evaluate(() => [...document.querySelectorAll('.table-wrap')].map(w => ({
      scrolls: w.scrollWidth > w.clientWidth + 1,
      cols: w.querySelector('tr')?.cells.length || 0,
      tallest: Math.max(0, ...[...w.querySelectorAll('tbody tr')].map(r => Math.round(r.getBoundingClientRect().height))),
    })));
    expect(rows.length, `${u} has no table to measure`).toBeGreaterThan(0);
    for (const r of rows) {
      r.scrolls ? scrolls++ : fits++;
      // a table that fits was not made to fit by crushing its columns
      if (!r.scrolls) expect(r.tallest, `${u}: a ${r.cols}-column table fits only because a row grew to ${r.tallest}px`).toBeLessThan(150);
    }
    // the page itself never scrolls sideways, whatever the table does
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw, `${u} page overflow`).toBeLessThanOrEqual(iw + 1);
  }
  expect(fits, 'no narrow table fits the phone screen — the min-width floor is too high').toBeGreaterThan(0);
});

it('1g · CSS and JS are content-hashed, so cached assets can never outlive the markup', async ({ page, request }) => {
  await page.goto('/manual/dev/commands/', { waitUntil: 'networkidle' });
  const refs = await page.evaluate(() => [document.querySelector('link[rel=stylesheet][href^="/assets"]')?.getAttribute('href'), document.querySelector('script[src^="/assets"]')?.getAttribute('src')]);
  for (const href of refs) {
    expect(href, 'asset reference missing').toBeTruthy();
    expect(href, `unhashed asset ${href} — a stale cache would break the page`).toMatch(/^\/assets\/site\.[0-9a-f]{10}\.(css|js)$/);
    expect((await request.get(href)).status(), href).toBe(200);
  }
  // and the unfingerprinted names must be gone, not left behind to be served stale
  expect((await request.get('/assets/site.css')).status()).not.toBe(200);
  // the same hashes on another page: one build, one pair of assets
  await page.goto('/', { waitUntil: 'networkidle' });
  const home = await page.evaluate(() => [document.querySelector('link[rel=stylesheet][href^="/assets"]')?.getAttribute('href'), document.querySelector('script[src^="/assets"]')?.getAttribute('src')]);
  expect(home).toEqual(refs);
});

it('1f · the provenance legend exists once, at /credits/#how-we-know, and names every mark', async ({ page }) => {
  await page.goto('/credits/', { waitUntil: 'networkidle' });
  const legend = page.locator('#how-we-know');
  await expect(legend).toBeVisible();
  await expect(legend.locator('.legend-list li')).toHaveCount(7);
  for (const kind of ['bench', 'official', 'apk', 'community', 'software', 'spec', 'wip']) {
    await expect(legend.locator(`.badge.b-${kind}`)).toHaveCount(1);
  }
  await expect(legend.locator('.legend-list li').first()).toContainText(/bench/i);
});

it('1t · TOC follows the reader: clicking a TOC link scrolls to the heading and marks it active', async ({ page }) => {
  await page.goto('/manual/dev/transport/');
  const vp = page.viewportSize();
  test.skip(vp.width < 1100, 'no TOC rail below 1100px');
  const link = page.locator('.toc a').nth(2);
  const id = (await link.getAttribute('href')).slice(1);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#${id}$`));
  await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
  await expect(page.locator('.toc a.active')).toHaveAttribute('href', `#${id}`);
});

// ---- 2. click every control --------------------------------------------------------------------
it('2a · weapons explorer: search, every class chip, compare pick/unpick/evict, sort — the screen changes', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const errors = watchErrors(page);
  await page.goto('/manual/gameplay/weapons/');
  const ex = page.locator('[data-explorer="weapons"]');
  await expect(ex.locator('[data-x-count]')).toHaveText(/19 of 19 shown/);
  await expect(ex.locator('[data-x-error]')).toBeHidden();
  await expect(ex.locator('tbody tr')).toHaveCount(19);
  // search narrows, "no matches" row appears for junk, clearing restores
  await ex.locator('[data-x-search]').fill('sniper');
  await expect(ex.locator('[data-x-count]')).toHaveText(/^[1-9] of 19 shown/);
  await ex.locator('[data-x-search]').fill('zzzz-no-such-weapon');
  await expect(ex.locator('tbody')).toContainText('No matches');
  await expect(ex.locator('[data-x-count]')).toHaveText(/^0 of 19 shown/);
  await ex.locator('[data-x-search]').fill('');
  await expect(ex.locator('tbody tr')).toHaveCount(19);
  // every facet chip changes the count and takes aria-pressed; chip set = distinct classes
  const chips = ex.locator('[data-facet]:not([data-facet="all"])');
  const roles = await page.evaluate(async () => [...new Set((await (await fetch('/data/weapons.json')).json()).weapons.map(w => w.role))].sort());
  expect(await chips.allTextContents()).toEqual(roles);
  for (let i = 0; i < await chips.count(); i++) {
    const chip = chips.nth(i); await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(ex.locator('[data-facet="all"]')).toHaveAttribute('aria-pressed', 'false');
    const txt = await ex.locator('[data-x-count]').innerText();
    expect(txt).toMatch(/^\d+ of 19 shown/); expect(txt).not.toMatch(/^19 of/); expect(txt).not.toMatch(/^0 of/);
  }
  await ex.locator('[data-facet="all"]').click();
  await expect(ex.locator('[data-x-count]')).toHaveText(/19 of 19 shown/);
  // compare dock states
  await expect(ex.locator('[data-x-dock]')).toContainText('Tick two weapons');
  await ex.locator('[data-pick="assault_rifle"]').check();
  await expect(ex.locator('[data-x-dock]')).toContainText('Assault Rifle');
  await expect(ex.locator('[data-x-dock]')).toContainText('one more');
  await ex.locator('[data-pick="smg"]').check();
  await expect(ex.locator('[data-x-dock] .cmp')).toBeVisible();
  await expect(ex.locator('[data-x-dock]')).toContainText('SMG');
  await expect(ex.locator('[data-x-dock]')).toContainText('Damage');
  await ex.locator('[aria-label="Compare Sniper Rifle"]').check();
  await expect(ex.locator('[data-x-dock]')).toContainText('Assault Rifle was replaced');
  await expect(ex.locator('[data-x-dock] .h').first()).not.toHaveText('Assault Rifle');
  await expect(ex.locator('tr.picked')).toHaveCount(2);
  await ex.locator('[data-x-clear]').click();
  await expect(ex.locator('tr.picked')).toHaveCount(0);
  await expect(ex.locator('[data-x-dock]')).toContainText('Tick two weapons');
  await ex.locator('[data-pick="smg"]').check();
  await ex.locator('[data-pick="smg"]').uncheck();
  await expect(ex.locator('tr.picked')).toHaveCount(0);
  // numeric sort reorders rows (9 < 10 < 100, not lexical)
  const dmgTh = ex.locator('th[data-col]', { hasText: 'Damage' });
  await dmgTh.click();
  await expect(dmgTh).toHaveAttribute('aria-sort', 'ascending');
  const asc = (await ex.locator('tbody tr td:nth-child(4)').allInnerTexts()).map(Number);
  expect(asc).toEqual([...asc].sort((a, b) => a - b));
  expect(asc[0]).toBeLessThan(asc[asc.length - 1]);
  await dmgTh.click();
  await expect(dmgTh).toHaveAttribute('aria-sort', 'descending');
  const desc = (await ex.locator('tbody tr td:nth-child(4)').allInnerTexts()).map(Number);
  expect(desc).toEqual([...asc].reverse());
  // keyboard sort on a text column
  const nameTh = ex.locator('th[data-col]', { hasText: 'Weapon' });
  await nameTh.focus(); await page.keyboard.press('Enter');
  await expect(nameTh).toHaveAttribute('aria-sort', 'ascending');
  const names = await ex.locator('tbody tr td:nth-child(2) strong').allInnerTexts();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  expect(errors, errors.join('\n')).toEqual([]);
});

it('2b · sound bank explorer: 2166 ids, search, family chips, show-more to exhaustion, copy $PLAY', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const errors = watchErrors(page);
  await page.goto('/manual/sound/sound-bank/');
  const ex = page.locator('[data-explorer="sounds"]');
  await expect(ex.locator('[data-x-count]')).toHaveText(/2166 of 2166 match · showing 300/);
  await expect(ex.locator('tbody tr')).toHaveCount(300);
  await expect(ex.locator('[data-x-more]')).toBeVisible();
  let clicks = 0;
  while (await ex.locator('[data-x-more]').isVisible()) { await ex.locator('[data-x-more-btn]').click(); clicks++; expect(clicks).toBeLessThan(10); await page.waitForTimeout(50); }
  await expect(ex.locator('tbody tr')).toHaveCount(2166);
  await expect(ex.locator('[data-x-count]')).toHaveText(/2166 of 2166 shown/);
  await ex.locator('[data-x-search]').fill('R02');
  await expect(ex.locator('[data-x-count]')).toHaveText(/^\d+ of 2166 shown/);
  await expect(ex.locator('tbody tr').first()).toContainText('R02');
  await expect(ex.locator('[data-x-more]')).toBeHidden();
  await ex.locator('[data-x-search]').fill('');
  const chips = ex.locator('[data-facet]:not([data-facet="all"])');
  const fams = await page.evaluate(async () => [...new Set((await (await fetch('/data/sounds.json')).json()).rows.map(r => r.family))].sort());
  expect(await chips.allTextContents()).toEqual(fams);
  const chip = ex.locator('[data-facet="VA"]');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(ex.locator('[data-x-count]')).not.toHaveText(/2166 of 2166/);
  await expect(ex.locator('tbody tr td:first-child').first()).toContainText(/^VA/);
  const copy = ex.locator('[data-copy]').first();
  const cmd = await copy.getAttribute('data-copy');
  await copy.click();
  await expect(copy).toHaveText('copied');
  await expect(copy).toHaveAttribute('data-done', '1');
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (clip !== null) expect(clip).toBe(cmd);
  expect(errors, errors.join('\n')).toEqual([]);
});

it('2c · in-page filterable table (command reference) filters, clears, and sorts rows for real', async ({ page }) => {
  await page.goto('/manual/dev/commands/');
  const dt = page.locator('.dt').first();
  const total = await dt.locator('.dt-count').innerText();
  expect(total).toMatch(/^\d+ rows$/);
  await dt.locator('input').fill('PING');
  const after = await dt.locator('.dt-count').innerText();
  expect(after).not.toBe(total); expect(after).toMatch(/^\d+ of \d+ rows/);
  await expect(dt.locator('tbody tr:visible').first()).toContainText('PING');
  await dt.locator('input').fill('zzzz-nothing');
  await expect(dt.locator('.dt-empty')).toBeVisible();
  await dt.locator('input').fill('');
  await expect(dt.locator('.dt-empty')).toBeHidden();
  await expect(dt.locator('.dt-count')).toHaveText(total);
  const th = dt.locator('thead th').first();
  const col = () => dt.locator('tbody tr:not(.dt-empty) td:first-child').allInnerTexts();
  await th.click();
  await expect(th).toHaveAttribute('aria-sort', 'ascending');
  const a = await col(); expect(a).toEqual([...a].sort((x, y) => x.localeCompare(y)));
  await th.click();
  await expect(th).toHaveAttribute('aria-sort', 'descending');
  expect(await col()).toEqual([...a].reverse());
});

it('2d · code copy → "copied"; clipboard failure → "copy failed"', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.goto('/manual/dev/transport/');
  const btn = page.locator('.code-wrap .copy-btn').first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toHaveText('copied');
  await expect(btn).toHaveAttribute('data-done', '1');
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
  await page.waitForTimeout(1900);
  await btn.click();
  await expect(btn).toHaveText('copy failed');
});

it('2f · theme toggle changes the page and persists across navigation', async ({ page }) => {
  await page.goto('/manual/');
  const t = page.locator('[data-theme-toggle]');
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await t.click();
  const mode = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(['light', 'dark']).toContain(mode);
  // the control is named by the action it performs, not by an aria-pressed that reads backwards
  await expect(t).toHaveAttribute('aria-label', mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(after).not.toBe(before);
  await page.goto('/manual/hardware/leds/');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(mode);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(after);
});

it('2g · search: ⌘K opens, results for a symptom, "$WEAP", no-results message, Escape and backdrop close', async ({ page }) => {
  await page.goto('/manual/');
  await page.keyboard.press('Control+k');
  const modal = page.locator('[data-search-modal]');
  await expect(modal).toBeVisible();
  await page.locator('[data-search-input]').fill('headset pairing');
  const res = page.locator('[data-search-results] a');
  await expect(res.first()).toBeVisible();
  await expect(res.first()).toContainText(/Pairing|Headset/i);
  await page.locator('[data-search-input]').fill('$WEAP');
  await expect(res.first()).toContainText(/WEAP/i);
  await page.locator('[data-search-input]').fill('wont fire');
  await expect(res.first()).toBeVisible();
  await page.locator('[data-search-input]').fill('screamer');
  await expect(page.locator('[data-search-results]')).toContainText(/pairing|Bluetooth/i);
  await page.locator('[data-search-input]').fill('headset pairing');
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement.closest('[data-search-results]') !== null)).toBe(true);
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => document.activeElement.hasAttribute('data-search-input'))).toBe(true);
  await page.locator('[data-search-input]').fill('qzxv-nothing');
  await expect(page.locator('[data-search-results]')).toContainText('No results');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await page.locator('[data-search-open]').click();
  await expect(modal).toBeVisible();
  await modal.click({ position: { x: 5, y: 5 } });
  await expect(modal).toBeHidden();
});

it('2e · diagnostic ladder rungs; sidebar (or phone drawer) navigates; drawer closes on outside tap', async ({ page }) => {
  await page.goto('/manual/fix/diagnose/');
  const rungs = page.locator('.ladder .rung');
  expect(await rungs.count()).toBeGreaterThan(3);
  await expect(rungs.first().locator('.check')).toBeVisible();
  await expect(rungs.first().locator('.chip')).toHaveText(/Yes →|No →/);
  await expect(rungs.first().locator('.fix')).toBeVisible();
  const vp = page.viewportSize();
  if (vp.width < 820) {
    await expect(page.locator('.side')).not.toBeInViewport();
    await page.locator('[data-nav-toggle]').click();
    await expect(page.locator('[data-nav-toggle]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.side')).toBeInViewport();
    await expect(page.locator('[data-nav-toggle]')).toHaveAttribute('aria-label', 'Close navigation');
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-nav-toggle]')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('[data-nav-toggle]').click();
    await page.mouse.click(vp.width - 10, vp.height - 10); // outside the drawer
    await expect(page.locator('[data-nav-toggle]')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.side')).not.toBeInViewport();
    await page.locator('[data-nav-toggle]').click();
  }
  await expect(page.locator('.side a[aria-current="page"]')).toContainText('Diagnose');
  await page.locator('.side a', { hasText: 'Repairs' }).first().click();
  await expect(page).toHaveURL(/\/manual\/fix\/repairs\/$/);
  await expect(page.locator('h1')).toContainText('Repairs');
});

it('2h · under-construction policy: five 🚧 cards on /platform/pieces/, brx-mcp in full, no held details leak', async ({ page }) => {
  await page.goto('/platform/pieces/');
  await expect(page.locator('.uc')).toHaveCount(5);
  for (const uc of await page.locator('.uc').all()) {
    await expect(uc.locator('h2')).toBeVisible();
    await expect(uc.locator('.uc-note')).toBeVisible();
    expect(await uc.locator('p:not(.uc-note)').count()).toBe(1);
  }
  const text = await page.locator('main').innerText();
  for (const leak of ['Phases:', 'Core BOM', 'Operator auth', 'ESP-NOW', 'Optional tiers']) expect(text, leak).not.toContain(leak);
  expect(text).toContain('brx-mcp');
  await expect(page.locator('.blk-spec-sheet dl').first()).toBeVisible();
});

// ---- 3. stale/old content: the renderer degrades visibly ---------------------------------------
it('3 · stale/malformed content renders visible TODOs, a placeholder, ragged tables, and never the backlog', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(STALE + '/manual/stale/resilience/');
  await expect(page.locator('h1')).toHaveText('Resilience page');
  await expect(page.locator('.blk-unknown .todo')).toBeVisible();
  await expect(page.locator('.blk-unknown .todo')).toContainText(/unknown block/i);
  await expect(page.locator('.blk-unknown')).toContainText('it still has content');
  await expect(page.locator('.blk-table .todo')).toBeVisible();
  await expect(page.locator('.blk-table .todo')).toContainText(/malformed table/i);
  await expect(page.locator('.fig-pending .ph-id')).toHaveText('ZZZ-99');
  await expect(page.locator('.dt')).toBeVisible();
  await expect(page.locator('.dt tbody tr:not(.dt-empty)')).toHaveCount(2);
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('NEVER-PUBLISH-SENTINEL');
  expect(text).not.toContain('undefined');
  await page.goto(STALE + '/manual/stale/');
  await expect(page.locator('h1')).toContainText('Stale fixture');
  const full = await page.request.get(STALE + '/llms-full.txt');
  expect(await full.text()).not.toContain('NEVER-PUBLISH-SENTINEL');
  const twin = await page.request.get(STALE + '/manual/stale/resilience.md');
  expect(await twin.text()).not.toContain('NEVER-PUBLISH-SENTINEL');
  expect(errors, errors.join('\n')).toEqual([]);
});

it('3b · old data shape: explorer rows missing fields render n/a, never undefined/NaN', async ({ page }) => {
  await page.route('**/data/weapons.json', async route => {
    const real = await (await route.fetch()).json();
    const weapons = real.weapons.map(({ role, dmg, cycle_ms, sound, behaviour, ...rest }) => rest); // an older data file
    weapons[0] = { id: 'ghost' }; // a row with nothing but an id
    await route.fulfill({ json: { weapons } });
  });
  const errors = watchErrors(page);
  await page.goto('/manual/gameplay/weapons/');
  const ex = page.locator('[data-explorer="weapons"]');
  await expect(ex.locator('[data-x-count]')).toHaveText(/19 of 19 shown/);
  const text = await ex.innerText();
  expect(text).not.toMatch(/\bundefined\b|\bNaN\b/);
  expect(text, 'missing values must read n/a').toContain('n/a');
  expect(text, 'em dash in explorer output').not.toContain('\u2014');
  await ex.locator('[data-pick="ghost"]').check();
  await ex.locator('[data-pick="smg"]').check();
  await expect(ex.locator('[data-x-dock] .cmp')).toBeVisible();
  expect(await ex.locator('[data-x-dock]').innerText()).not.toMatch(/\bundefined\b|\bNaN\b/);
  expect(errors, errors.join('\n')).toEqual([]);
});

it('3c · the build refuses a manual with a broken internal link (link checker is a hard gate)', async () => {
  const dir = fs.mkdtempSync(path.join(SITE, 'test', 'tmp-broken-'));
  const out = path.join(dir, 'out');
  try {
    for (const f of fs.readdirSync(path.join(HERE, 'fixtures/manual-stale'))) fs.copyFileSync(path.join(HERE, 'fixtures/manual-stale', f), path.join(dir, f));
    fs.appendFileSync(path.join(dir, '00-home.md'), '\n[callout:tip] A link to a page that does not exist: [nope](/manual/nope/). ✅ src: fixture\n');
    let code = 0, output = '';
    try { output = execFileSync('node', [path.join(SITE, 'build.mjs'), '--manual', dir, '--out', out], { stdio: 'pipe' }).toString(); }
    catch (e) { code = e.status; output = String(e.stdout) + String(e.stderr); }
    expect(code).not.toBe(0);
    expect(output).toContain('broken link /manual/nope/');
    const m = JSON.parse(fs.readFileSync(path.join(out, '.site-manifest.json'), 'utf8'));
    expect(m.ok).toBe(false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 4. failure paths --------------------------------------------------------------------------
for (const [slug, id, count] of [['/manual/sound/sound-bank/', 'sounds', '2166 of 2166 match'], ['/manual/gameplay/weapons/', 'weapons', '19 of 19 shown']]) {
  it(`4 · ${id} explorer data 500 → visible error strip, retry recovers`, async ({ page }) => {
    let fail = true;
    await page.route(`**/data/${id}.json`, route => fail ? route.fulfill({ status: 500, body: 'boom' }) : route.continue());
    const errors = watchErrors(page, ['http 500', 'explorer load failed', 'Failed to load resource']);
    await page.goto(slug);
    const ex = page.locator(`[data-explorer="${id}"]`);
    await expect(ex.locator('[data-x-error]')).toBeVisible();
    await expect(ex.locator('[data-x-count]')).toHaveText('failed');
    await expect(ex.locator('tbody tr')).toHaveCount(0);
    fail = false;
    await ex.locator('[data-x-retry]').click();
    await expect(ex.locator('[data-x-error]')).toBeHidden();
    await expect(ex.locator('[data-x-count]')).toHaveText(new RegExp(count));
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

it('4b · search index 500 → visible error; typing does not pretend to search', async ({ page }) => {
  await page.route('**/data/search.json', route => route.fulfill({ status: 500, body: 'boom' }));
  await page.goto('/manual/');
  await page.locator('[data-search-open]').click();
  await expect(page.locator('[data-search-results]')).toContainText(/failed to load/i);
  await page.locator('[data-search-input]').fill('headset');
  await expect(page.locator('[data-search-results]')).toContainText(/failed to load/i);
  await expect(page.locator('[data-search-results] a')).toHaveCount(0);
});

// ---- 5. viewports ------------------------------------------------------------------------------
it('5 · no horizontal page overflow on key pages; short landscape phone still usable', async ({ page }) => {
  const urls = ['/', '/manual/', '/manual/hardware/leds/', '/manual/fix/diagnose/', '/manual/fix/pairing/', '/manual/gameplay/weapons/', '/manual/dev/commands/', '/manual/dev/weap/', '/manual/sound/sound-bank/', '/platform/architecture/'];
  for (const u of urls) {
    await page.goto(u, { waitUntil: 'networkidle' });
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw, `${u} scrolls horizontally (${sw} > ${iw})`).toBeLessThanOrEqual(iw + 1);
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/manual/operate/headset-pairing/');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.steps ol > li').first()).toBeVisible();
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(iw + 1);
});

// ---- 6. audits ---------------------------------------------------------------------------------
it('6 · primary controls ≥ 44px on phone (≥ 36px desktop); no meaning-bearing text under 11px', async ({ page }) => {
  const vp = page.viewportSize();
  const min = vp.width < 820 ? 44 : 36;
  for (const u of ['/manual/gameplay/weapons/', '/manual/fix/diagnose/', '/manual/sound/sound-bank/', '/manual/dev/transport/', '/manual/dev/commands/', '/']) {
    await page.goto(u, { waitUntil: 'networkidle' });
    if (vp.width < 820) await page.locator('[data-nav-toggle]').click();
    await page.locator('[data-search-open]').click();
    await page.locator('[data-search-input]').fill('headset');
    await expect(page.locator('[data-search-results] a').first()).toBeVisible();
    const small = await page.evaluate(min => {
      const sel = 'header button, header a, .dt-bar input, .chips button, [data-x-more-btn], [data-x-retry], .copy-btn, .x-cell-copy, .md-link, .side a, .side summary, details summary, .search-results a, th[data-sort], .pick, .prevnext a';
      return [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed').map(el => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), h: Math.round(r.height), w: Math.round(r.width) }; }).filter(x => (x.h > 0 || x.w > 0) && (x.h < min || x.w < min));
    }, min);
    expect(small, `${u} undersized controls (<${min}px): ${JSON.stringify(small)}`).toEqual([]);
    await page.keyboard.press('Escape');
    const tiny = await page.evaluate(() => {
      const out = new Set();
      const walker = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
      let n; while ((n = walker.nextNode())) { if (!n.textContent.trim()) continue; const el = n.parentElement; if (el.closest('.ph, kbd, [aria-hidden="true"], .toc-h, .kicker')) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 11) out.add(`${fs}px: ${n.textContent.trim().slice(0, 30)}`); }
      return [...out];
    });
    expect(tiny, `${u} tiny text: ${tiny.join(' | ')}`).toEqual([]);
  }
});

// ---- 8. machine-readable layer -------------------------------------------------------------------
it('8 · llms.txt, llms-full.txt, sitemap, robots, JSON-LD (TechArticle/Breadcrumb/HowTo/FAQ/Dataset) and markdown twins', async ({ page, request }) => {
  for (const f of ['/llms.txt', '/llms-full.txt', '/sitemap.xml', '/robots.txt', '/favicon.svg', '/404.html']) { const r = await request.get(f); expect(r.status(), f).toBe(200); }
  const llms = await (await request.get('/llms.txt')).text();
  expect(llms).toContain('# Open BRX');
  const urls = sitemapUrls();
  for (const u of urls) {
    const md = await request.get(u === '/' ? '/index.md' : u.replace(/\/$/, '') + '.md');
    expect(md.status(), `${u} markdown twin`).toBe(200);
    expect(md.headers()['content-type']).toContain('text/markdown');
    if (u !== '/') expect(llms, `${u} listed in llms.txt`).toContain(u.replace(/\/$/, '') + '.md');
  }
  const full = await (await request.get('/llms-full.txt')).text();
  expect(full.length).toBeGreaterThan(100_000);
  expect(full).not.toContain('Research backlog');
  // twin matches page title
  await page.goto('/manual/operate/headset-pairing/');
  const h1 = await page.locator('h1').innerText();
  const twin = await (await request.get('/manual/operate/headset-pairing.md')).text();
  expect(twin.split('\n')[0]).toBe('# ' + h1);
  const graph = JSON.parse(await page.locator('script[type="application/ld+json"]').first().textContent())['@graph'];
  const types = graph.map(g => g['@type']);
  expect(types).toEqual(expect.arrayContaining(['TechArticle', 'BreadcrumbList', 'HowTo']));
  const howto = graph.find(g => g['@type'] === 'HowTo');
  expect(howto.step.length).toBeGreaterThan(2);
  expect(JSON.stringify(howto)).not.toMatch(/src:/);
  await page.goto('/manual/fix/faq/');
  const faq = JSON.parse(await page.locator('script[type="application/ld+json"]').first().textContent())['@graph'].find(g => g['@type'] === 'FAQPage');
  expect(faq.mainEntity.length).toBeGreaterThan(5);
  expect(faq.mainEntity[0].acceptedAnswer.text.length).toBeGreaterThan(10);
  await page.goto('/manual/sound/sound-bank/');
  const ds = JSON.parse(await page.locator('script[type="application/ld+json"]').first().textContent())['@graph'].find(g => g['@type'] === 'Dataset');
  expect(ds.distribution[0].contentUrl).toMatch(/\/data\/sounds\.json$/);
  expect(await page.locator('link[rel="alternate"][type="text/markdown"]').count()).toBe(1);
});

// ---- 9. the app download: the button must hand over the exact bytes the page describes --------
// A download page that 404s, or that advertises a size/checksum from an older build, is worse than
// no page at all: the visitor installs a file they cannot verify, or nothing at all.
it('9 · /platform/app: the download button serves the committed APK, and the page facts match the bytes', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.goto('/platform/app/', { waitUntil: 'networkidle' });
  const btn = page.locator('a.dl-btn');
  await expect(btn).toBeVisible();
  const href = await btn.getAttribute('href');
  expect(href, 'the button links an apk under /download/').toMatch(/^\/download\/[\w.-]+\.apk$/);

  // the file the site will actually deploy (Cloudflare publishes webapp/ from the repo)
  const onDisk = path.join(WEB, href.replace(/^\//, ''));
  expect(fs.existsSync(onDisk), `${href} is not committed under webapp/`).toBe(true);
  const bytes = fs.readFileSync(onDisk);
  expect(bytes.length, 'an apk under 1 MB is not a real build').toBeGreaterThan(1e6);
  expect(bytes.subarray(0, 2).toString('latin1'), 'not a zip/apk').toBe('PK');

  // served, not just present
  const r = await request.get(href);
  expect(r.status()).toBe(200);
  expect((await r.body()).length).toBe(bytes.length);

  // and the button actually hands the file over when a person taps it
  const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()]);
  expect(dl.suggestedFilename()).toBe(path.basename(href));
  expect(fs.statSync(await dl.path()).size).toBe(bytes.length);

  // every hard fact on the page is the file's own
  const sha = createHash('sha256').update(bytes).digest('hex');   // not sha256sum: macOS has shasum
  const meta = (await page.locator('.dl-meta').innerText()).replace(/\s+/g, ' ');
  expect(meta).toContain(path.basename(onDisk));
  expect(meta).toContain(sha);
  expect(meta, 'size on the page must match the file').toContain(`${(bytes.length / 1e6).toFixed(1)} MB`);
  const ver = path.basename(onDisk).match(/-(\d+\.\d+\.\d+)-/)?.[1];
  expect(ver, 'the filename carries the version').toBeTruthy();
  expect(meta).toContain(ver);
  // the Built row comes from the sidecar, not from the file's mtime, which a checkout rewrites
  const sidecar = JSON.parse(fs.readFileSync(path.join(WEB, 'download', 'build.json'), 'utf8'));
  expect(sidecar.sha256, 'sidecar must describe the served apk').toBe(sha);
  expect(meta).toContain(sidecar.built.slice(0, 10));

  // the honesty the page owes a sideloader
  const body = (await page.locator('main').innerText()).toLowerCase();
  for (const claim of ['debug build', 'nearby devices', 'api 24']) expect(body, `missing: ${claim}`).toContain(claim);
  expect(errors).toEqual([]);
});

// The two ways this page can lie to a visitor, both caught at build time: no build published (must
// say so, not link a 404) and two builds published (the page must not pick one at random).
it('9b · a manual with [download] but no apk renders a TODO; two apks fail the build', async () => {
  const dir = fs.mkdtempSync(path.join(SITE, 'test', 'tmp-dl-'));
  const build = out => {
    try { return { code: 0, output: execFileSync('node', [path.join(SITE, 'build.mjs'), '--manual', dir, '--out', out], { stdio: 'pipe' }).toString() }; }
    catch (e) { return { code: e.status, output: String(e.stdout) + String(e.stderr) }; }
  };
  try {
    for (const f of fs.readdirSync(path.join(HERE, 'fixtures/manual-stale'))) fs.copyFileSync(path.join(HERE, 'fixtures/manual-stale', f), path.join(dir, f));
    // into the FIRST page of the fixture (appending would land it on the last page instead)
    const home = path.join(dir, '00-home.md');
    const src = fs.readFileSync(home, 'utf8');
    const cut = src.indexOf('\n### Page:', src.indexOf('\n### Page:') + 1);
    fs.writeFileSync(home, src.slice(0, cut) + '\n[download] **The app** Get it here. src: fixture\n' + src.slice(cut));

    const none = path.join(dir, 'out-none');
    const a = build(none);
    expect(a.code, a.output).toBe(0);
    const html = fs.readFileSync(path.join(none, 'index.html'), 'utf8');
    expect(html).toContain('data-todo="no build published"');
    expect(html).not.toContain('href="/download/');

    const two = path.join(dir, 'out-two');
    fs.mkdirSync(path.join(two, 'download'), { recursive: true });
    for (const f of ['one.apk', 'two.apk']) fs.writeFileSync(path.join(two, 'download', f), 'PK');
    const b = build(two);
    expect(b.code, 'two apks must fail the build').not.toBe(0);
    expect(b.output).toContain('keep exactly one');
    expect(JSON.parse(fs.readFileSync(path.join(two, '.site-manifest.json'), 'utf8')).ok).toBe(false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The page's whole premise is that it cannot state a fact about a build it is not serving. That
// rests on the sidecar contract, so every way the sidecar can stop describing the bytes must fail
// the build rather than publish a plausible-looking date.
it('9c · the build.json contract: missing, mismatched or dirty fails the build; a good one dates the page', async () => {
  const dir = fs.mkdtempSync(path.join(SITE, 'test', 'tmp-dl-meta-'));
  const apk = Buffer.from('PK\u0003\u0004 pretend apk');
  const sha = createHash('sha256').update(apk).digest('hex');
  const NAME = 'brx-companion-9.9.9-android-debug.apk';
  const build = out => {
    try { return { code: 0, output: execFileSync('node', [path.join(SITE, 'build.mjs'), '--manual', dir, '--out', out], { stdio: 'pipe' }).toString() }; }
    catch (e) { return { code: e.status, output: String(e.stdout) + String(e.stderr) }; }
  };
  const withSidecar = (name, meta) => {
    const out = path.join(dir, name);
    fs.mkdirSync(path.join(out, 'download'), { recursive: true });
    fs.writeFileSync(path.join(out, 'download', NAME), apk);
    if (meta) fs.writeFileSync(path.join(out, 'download', 'build.json'), JSON.stringify(meta));
    return { out, ...build(out) };
  };
  try {
    for (const f of fs.readdirSync(path.join(HERE, 'fixtures/manual-stale'))) fs.copyFileSync(path.join(HERE, 'fixtures/manual-stale', f), path.join(dir, f));
    const home = path.join(dir, '00-home.md');
    const src = fs.readFileSync(home, 'utf8');
    const cut = src.indexOf('\n### Page:', src.indexOf('\n### Page:') + 1);
    fs.writeFileSync(home, src.slice(0, cut) + '\n[download] **The app** Get it here. src: fixture\n' + src.slice(cut));

    const good = { file: NAME, sha256: sha, built: '2019-07-04T10:00:00.000Z', dirty: false };
    for (const [label, meta, expected] of [
      ['missing', null, 'build.json is missing'],
      ['wrong sha', { ...good, sha256: 'deadbeef' }, 'does not describe'],
      ['wrong file', { ...good, file: 'something-else.apk' }, 'does not describe'],
      ['dirty tree', { ...good, dirty: true, git: 'abc1234' }, 'dirty tree'],
    ]) {
      const r = withSidecar('out-' + label.replace(/ /g, '-'), meta);
      expect(r.code, `${label} must fail the build`).not.toBe(0);
      expect(r.output, label).toContain(expected);
      expect(JSON.parse(fs.readFileSync(path.join(r.out, '.site-manifest.json'), 'utf8')).ok).toBe(false);
    }

    // and the honest case: the page shows the sidecar's date, not today's mtime
    const ok = withSidecar('out-good', good);
    expect(ok.code, ok.output).toBe(0);
    const html = fs.readFileSync(path.join(ok.out, 'index.html'), 'utf8');
    expect(html).toContain('2019-07-04');
    expect(html).toContain(`href="/download/${NAME}"`);
    expect(html).not.toContain('data-todo');

    // a hand-dropped file the script could never have produced is refused, not linked
    const odd = path.join(dir, 'out-odd');
    fs.mkdirSync(path.join(odd, 'download'), { recursive: true });
    fs.writeFileSync(path.join(odd, 'download', 'my build".apk'), apk);
    const r = build(odd);
    expect(r.code, 'an unexpected filename must fail the build').not.toBe(0);
    expect(r.output).toContain('unexpected filename');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
