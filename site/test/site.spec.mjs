// The whole gate for the Open BRX site. Every check asserts something a reader would see.
// Run: npm test (builds first). ONLY=<fragment> runs matching steps.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../webapp');
const only = process.env.ONLY;
let matched = 0;
const it = (name, fn) => {
  const run = !only || name.includes(only);
  if (run && only) matched++;
  return (run ? test : test.skip)(name, fn);
};

// the one list of old-DSL block names, imported from the build so the two can never drift
const { BLOCK_MARKER } = await import(pathToFileURL(path.resolve(HERE, '../block-names.mjs')).href);

const urls = () => [...fs.readFileSync(path.join(WEB, 'sitemap.xml'), 'utf8')
  .matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
const manifest = () => JSON.parse(fs.readFileSync(path.join(WEB, '.site-manifest.json'), 'utf8'));
// which pages are marketing landings (root, /manual) and which are readable doc pages
const layoutOf = u => manifest().layouts[u] || 'doc';
const docUrls = () => urls().filter(u => layoutOf(u) === 'doc');
const landingUrls = () => urls().filter(u => layoutOf(u) !== 'doc');
const DOCS = path.resolve(WEB, '../docs');

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  return errors;
}

it('0 · the build is clean and the server serves it', async ({ request }) => {
  // The build exits before writing when it finds a problem, so asserting `problems: []` here was
  // unfalsifiable. What IS worth checking is that the manifest describes the tree we are serving.
  const m = JSON.parse(fs.readFileSync(path.join(WEB, '.site-manifest.json'), 'utf8'));
  expect(m.ok).toBe(true);
  for (const f of m.files) expect(fs.existsSync(path.join(WEB, f)), `${f} is in the manifest but not on disk`).toBe(true);
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
    // an unconverted block marker or a TODO means the source is still in the old DSL.
    // The name list lives ONCE, in build.mjs: a second narrower copy here silently omitted
    // `download`, `pricing-tiers` and `audio-player`.
    expect(text, 'leftover block marker').not.toMatch(BLOCK_MARKER);
    expect(text, 'TODO reached a page').not.toMatch(/TODO/);
    expect(text, 'em dash reached a page').not.toMatch(/—/);
    // provenance marks are gone from the published prose
    expect(text, 'provenance badge reached a page').not.toMatch(/[✅📖🔍👥🧪📐🚧]/u);
    expect(text, 'src: citation reached a page').not.toMatch(/\bsrc:/);
    // the hard rule in CLAUDE.md: LaserTagMods is credited on every public page
    await expect(page.locator('footer')).toContainText('LaserTagMods (JEDGE / JBOX)');

    expect(errors).toEqual([]);
  });
}

it('1b · a doc page opens with its title, and its header lists its own section', async ({ page }) => {
  // A sibling-links row above the <h1> read as a second navigation bar under the first, so where
  // else to go in a section now lives in the header nav, and the article opens with its title.
  expect(landingUrls().length, 'the site publishes no landing pages').toBeGreaterThan(1);
  for (const u of docUrls()) {
    await page.goto(u);
    const first = page.locator('article > *').first();
    expect(await first.evaluate(e => e.tagName), `${u} does not open with its title`).toBe('H1');
    // the header names the section the page is in, and marks this page as current
    const here = page.locator('.topnav a[aria-current="page"]');
    if (u !== '/credits/' && u !== '/docs/') expect(await here.count(), `${u} has no current-page mark in the header`).toBe(1);
    // the wordmark names the place: BRX/ DOCS in the manual, PLATFORM/ DOCS in the platform half
    const wm = (await page.locator('.wm').innerText()).replace(/\s+/g, ' ').trim();
    const want = u.startsWith('/manual') || u === '/credits/' ? /^BRX ?\/ ?DOCS$/i : /^PLATFORM ?\/ ?DOCS$/i;   // every doc page carries DOCS; only the two landings are bare
    expect(wm, `${u}: the wordmark reads "${wm}"`).toMatch(want);
    // and a hairline separates the wordmark from the section links beside it
    expect(await page.locator('.brand').evaluate(e => getComputedStyle(e).borderRightWidth), `${u}: no separator after the wordmark`).toBe('1px');
  }
});

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

it('2b · the official documents we say we link are actually reachable', async ({ request }) => {
  // The manual promised "linked, not rehosted" while publishing exactly one external link, to our
  // own GitHub. A promised link that 404s is the same broken promise one step later. Network is
  // allowed to be flaky, so a transport error is reported and skipped; only a real 4xx/5xx fails.
  const urls = new Set();
  for (const dir of ['manual', 'platform'].map(d => path.join(DOCS, d))) {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md')) {
      for (const u of fs.readFileSync(path.join(dir, f), 'utf8').match(/https?:\/\/[^\s)"'<]+/g) || []) {
        urls.add(u);   // including our own repo: excluding it is how a 404 on all 12 pages survived
      }
    }
  }
  // the footer link is in the template, not in any manual file, so read the built pages as well
  for (const f of fs.readdirSync(WEB).filter(f => f.endsWith('.html'))) {
    for (const u of (fs.readFileSync(path.join(WEB, f), 'utf8').match(/href="(https?:\/\/[^"]+)"/g) || [])) {
      urls.add(u.slice(6, -1));
    }
  }
  expect(urls.size, 'the manual publishes no external link at all').toBeGreaterThan(0);
  const bad = [];
  for (const u of urls) {
    try {
      const r = await request.get(u, { timeout: 20000, maxRedirects: 5 });
      // 429 is the host rate-limiting THIS checker (GitHub does, after a few runs), not a dead link
      if (r.status() === 429) { console.log(`  (rate limited by ${new URL(u).host}, could not verify ${u})`); continue; }
      if (r.status() >= 400) bad.push(`${u} -> ${r.status()}`);
    } catch (e) { console.log(`  (could not reach ${u}: ${e.message.split('\n')[0]})`); }
  }
  expect(bad, 'published official links that do not resolve').toEqual([]);
});

it('3 · every markdown twin is byte-for-byte the manual file it came from', async ({ request }) => {
  // The twins and llms-full.txt are what llms.txt exists to serve. Asserting "a file exists and has
  // an H1" let a twin carrying entirely the wrong page pass, so compare the actual bytes.
  const map = manifest().twins;
  expect(Object.keys(map).length, 'the build published no twin map').toBe(urls().length);
  const full = await (await request.get('/llms-full.txt')).text();
  for (const [twin, file] of Object.entries(map)) {
    const r = await request.get(twin);
    expect(r.ok(), `${twin} missing`).toBe(true);
    const served = await r.text();
    const source = fs.readFileSync(path.join(DOCS, file), 'utf8');
    expect(served, `${twin} is not ${file}`).toBe(source);
    expect(full.includes(source), `llms-full.txt is missing ${file}`).toBe(true);
  }
});

it('4a · the arsenal publishes CAPTURED wire values, never the rebalanced UI bars', async ({ request }) => {
  // weapons.json carries two different things: each weapon's captured $WEAP frame (Callsign truth)
  // and Open BRX's own rebalanced dmg/rof/rng, which are 0-100 UI BARS. Publishing the latter under
  // a heading like "Damage" stated Assault Rifle 8 where the wire says 9, on a page titled "The
  // complete Callsign arsenal". Every published number must come off the frame.
  const src = JSON.parse(fs.readFileSync(path.join(WEB, '../mcp/brx_mcp/mc/weapons.json'), 'utf8')).weapons;
  const rows = await (await request.get('/data/weapons.json')).json();

  // only weapons Callsign actually shipped: the Open BRX sidearms carry a copied frame
  expect(rows.length).toBe(src.filter(w => w.captured && w.capture?.frame).length);
  for (const bad of ['Glock-18', 'USP-S', 'Desert Eagle']) {
    expect(rows.find(r => r.name === bad), `${bad} is not a Callsign weapon`).toBeUndefined();
  }

  // every published number equals its token in that weapon's own frame
  const TOK = { dmg: 5, cycle_ms: 14, mag: 16, reserve: 17, reload_ms: 18, heat: 24, sound: 27 };
  const drift = [];
  for (const r of rows) {
    const f = src.find(w => w.weapon_id === r.id).capture.frame.split(',');
    for (const [field, n] of Object.entries(TOK)) {
      const wire = f[n + 1];
      const got = r[field];
      // t17 == 32768 is an unlimited flag, not a count
      const want = field === 'sound' ? wire
        : (field === 'reserve' && Number(wire) === 32768) ? 'unlimited' : Number(wire);
      if (String(got) !== String(want)) drift.push(`${r.name}.${field}: published ${got}, wire ${wire}`);
    }
  }
  expect(drift, 'published values that do not match the captured wire frame').toEqual([]);

  // and the bar fields must never reach the page
  for (const f of ['rof', 'rng', 'htk', 'ttk_ms']) {
    expect(rows.some(r => f in r), `${f} is a rebalanced UI bar and must not be published`).toBe(false);
  }
  // three the old published table pinned
  const by = n => rows.find(r => r.name === n);
  expect(by('Assault Rifle')).toMatchObject({ dmg: 9, cycle_ms: 100, mag: 32, sound: 'R01' });
  // no weapon may publish the raw unlimited flag as a round count
  expect(rows.filter(r => r.reserve === 32768).map(r => r.name), 'raw 32768 published').toEqual([]);
  expect(by('Charge Rifle')).toMatchObject({ sound: 'E03', cycle_ms: 1250, heat: 14 });
});

it('4b · sound durations in the prose match the generated table cell for cell', async ({ request }) => {
  // sound.md hand-lists ~31 notable ids with durations taken from the APP's Sounds.json, while the
  // table below them is built from the real ON-GUN files. Seven disagreed, both visible at once.
  const rows = await (await request.get('/data/sounds.json')).json();
  const len = Object.fromEntries(rows.map(r => [r.id, r.len]));
  const md = fs.readFileSync(path.resolve(WEB, '../docs/manual/sound.md'), 'utf8');
  const bad = [];
  let checked = 0;
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const c = line.replace(/^\||\|$/g, '').split('|').map(x => x.trim());
    const id = (c[0] || '').match(/^`?([A-Z][A-Z0-9_]{1,6})`?$/)?.[1];
    if (!id || !(id in len)) continue;
    const cell = c.find(x => /^\d+\.\d+\s*s$/.test(x));
    if (!cell) continue;
    checked++;
    const stated = parseFloat(cell);
    if (Math.abs(stated - len[id]) > 1e-9) bad.push(`${id}: prose ${stated}s, table ${len[id]}s`);
  }
  expect(checked, 'found no duration cells to check').toBeGreaterThan(20);
  expect(bad, 'prose durations that disagree with the generated table').toEqual([]);
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

it('6b · search finds a symbol and lands on the section that defines it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/manual/hardware/', { waitUntil: 'networkidle' });
  // the index is lazy: nobody pays for search until they use it
  expect(await page.evaluate(() =>
    performance.getEntriesByType('resource').filter(r => r.name.includes('search.json')).length),
    'search index loaded before anyone searched').toBe(0);

  await page.keyboard.press('/');                       // the convention on a reference site
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('q');
  await page.keyboard.type('$SIR');
  await expect(page.locator('#results a').first()).toBeVisible();

  // a symbol must rank its DEFINING section first, not a page that mentions it in passing
  const top = page.locator('#results a').first();
  await expect(top.locator('.r-h')).toContainText('$SIR');
  const href = await top.getAttribute('href');
  expect(href, 'result should point at a heading anchor').toMatch(/^\/manual\/dev\/#/);

  await Promise.all([page.waitForURL(u => u.pathname === '/manual/dev/'), page.keyboard.press('Enter')]);
  // the anchor must exist AND clear the sticky header
  const y = await page.evaluate(() => {
    const el = document.querySelector(decodeURIComponent(location.hash));
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  });
  expect(y, 'the anchor a result points at does not exist').not.toBeNull();
  const headerH = await page.evaluate(() => document.querySelector('.top').offsetHeight);
  expect(y, `the anchor lands under the ${headerH}px sticky header`).toBeGreaterThanOrEqual(headerH);
  expect(errors).toEqual([]);
});

it('6c · search says so when nothing matches and when the index will not load', async ({ page }) => {
  await page.goto('/manual/');   // the manual's front door carries the search box in its hero
  await page.locator('#q').fill('zzzznotathing');
  await expect(page.locator('#results')).toContainText('Nothing matches');

  await page.route('**/data/search.json', r => r.fulfill({ status: 500, body: 'no' }));
  await page.reload();
  await page.locator('#q').fill('teal');
  await expect(page.locator('#results')).toContainText('could not load');
});

it('6d · a search box renders a query as text, never as markup', async ({ page }) => {
  // Both search inputs build their "nothing matches" message with innerHTML. The data-table one
  // interpolated the raw query and put a live <img> from user input into the DOM.
  const payload = '<img src=x onerror="window.__x=1">';
  await page.goto('/manual/gameplay/', { waitUntil: 'networkidle' });

  const dt = page.locator('.dt[data-table="weapons"]');
  await dt.locator('[data-search]').fill(payload);
  await expect(dt.locator('[data-count]')).toContainText('0 of');
  expect(await dt.locator('tbody img, tbody script').count(), 'table search injected markup').toBe(0);
  await expect(dt.locator('tbody')).toContainText('img src=x');

  await page.locator('#q').fill(payload);
  await page.waitForTimeout(250);
  expect(await page.locator('#results img, #results script').count(), 'site search injected markup').toBe(0);
  expect(await page.evaluate(() => !!window.__x), 'an injected handler ran').toBe(false);
});

it('6e · the phone menu opens, closes and keeps the header small', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  await page.goto('/manual/dev/', { waitUntil: 'networkidle' });
  const burger = page.locator('.burger');
  const nav = page.locator('.topnav');
  if (!phone) {
    expect(await burger.isVisible(), 'the burger should be a phone control only').toBe(false);
    await expect(nav).toBeVisible();
    return;
  }
  // nine links wrapped to three rows and made the header a quarter of the screen
  const h = await page.evaluate(() => document.querySelector('.top').offsetHeight);
  expect(h, `the header is ${h}px, too much of a 780px screen`).toBeLessThan(140);
  await expect(nav).toBeHidden();
  await burger.click();
  await expect(nav).toBeVisible();
  expect(await burger.getAttribute('aria-expanded')).toBe('true');
  const small = await nav.locator('a').evaluateAll(as => as.filter(a => a.getBoundingClientRect().height < 44).length);
  expect(small, 'nav links below a 44px tap target').toBe(0);
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.className)).toContain('burger');
});

it('7 · the theme toggle changes the page and survives navigation', async ({ page }) => {
  await page.goto('/manual/hardware/');
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator('.theme').click();
  const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(after).not.toBe(before);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.goto('/manual/hardware/');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
  // the landings are dark by design and carry no toggle, whatever the reader chose on a doc page
  for (const u of ['/', '/manual/']) {
    await page.goto(u, { waitUntil: 'networkidle' });
    expect(await page.locator('.theme').count(), `a theme toggle leaked onto ${u}`).toBe(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(7, 9, 13)');
  }
});

it('8 · on a phone the page never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  for (const u of urls()) {
    await page.goto(u);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${u} scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
  }
});

it('9 · 404 renders a real page whose links all work', async ({ page, request }) => {
  const r = await page.goto('/no/such/page/');
  expect(r.status()).toBe(404);
  await expect(page.locator('h1')).toBeVisible();
  const hrefs = await page.locator('a[href^="/"]').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(3);
  for (const h of hrefs) expect((await request.get(h)).ok(), `404 page links to ${h}`).toBe(true);
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
  // the pages that MOVED must land on their own new home, not on any live page
  const moved = { '/platform/leds/': '/docs/leds/', '/platform/modes/': '/docs/modes/', '/platform/run-a-game/': '/docs/run-a-game/' };
  expect(live.has('/platform'), '/platform/ must be a live landing, not a redirect').toBe(true);
  for (const [from, to] of Object.entries(moved)) {
    const rule = rules.find(r => norm(r.from) === norm(from));
    expect(rule, `no redirect for ${from}`).toBeTruthy();
    expect(norm(rule.to), `${from} redirects to the wrong page`).toBe(norm(to));
  }
  expect(live.has('/manual'), '/manual/ must be a live page, not a redirect').toBe(true);
  // no rule may point at another rule's source, which would chain
  const chained = rules.filter(r => rules.some(o => matches(o.from, r.to)));
  expect(chained.map(r => `${r.from} -> ${r.to}`), 'chained redirects').toEqual([]);
});

it('11 · every old URL really resolves over HTTP, in one hop, with no loop', async ({ request, page }) => {
  // Step 10 reasons about the _redirects FILE. This one drives the server, which now mirrors
  // Cloudflare's redirect handling. The loop that reached production passed a file-only check.
  const old = fs.readFileSync(path.join(HERE, 'old-urls.txt'), 'utf8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const bad = [];
  for (const u of old) {
    const r = await request.get(u, { maxRedirects: 5 });
    if (!r.ok()) bad.push(`${u} -> ${r.status()} ${r.url()}`);
  }
  expect(bad, 'old URLs that do not resolve').toEqual([]);
  // and a live page must never redirect at all
  for (const u of urls()) {
    const r = await request.get(u, { maxRedirects: 0 });
    expect(r.status(), `${u} redirects instead of serving`).toBe(200);
  }
});


// ---- the landing pages ----------------------------------------------------------------------
// Everything below asserts what a visitor SEES on the root and the manual's front door: real
// screenshots that loaded, buttons that go where they say, numbers that equal the repo data, and
// motion that reveals rather than hides.
const facts = () => {
  const modes = (fs.readFileSync(path.join(DOCS, '../mcp/brx_mcp/mc/state.py'), 'utf8').match(/\{"mode":\s*"[a-z_]+",\s*"name"/g) || []).length;
  const weapons = JSON.parse(fs.readFileSync(path.join(DOCS, '../mcp/brx_mcp/mc/weapons.json'), 'utf8')).weapons.length;
  const release = JSON.parse(fs.readFileSync(path.join(DOCS, '../webapp/download/build.json'), 'utf8'));
  return { modes, weapons, release };
};

it('12 · the root landing renders every section with a loaded image and one h1', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toContainText(/unlocked/i);
  // the hero lede says what the product is, since the headline no longer does
  await expect(page.locator('.hero .lede')).toContainText(/BRX taggers/);
  // the hero is a product shot of the two real screens, the phone overlapping the console
  const duo = page.locator('.hero-duo');
  await expect(duo).toBeVisible();
  const [main, phone] = await Promise.all([duo.locator('.duo-main').boundingBox(), duo.locator('.duo-phone').boundingBox()]);
  expect(phone.y + phone.height, 'the phone should overlap the console\'s lower edge').toBeGreaterThan(main.y + main.height);
  expect(phone.y, 'the phone should sit over the console, not below it').toBeLessThan(main.y + main.height);
  expect((await page.locator('.wm').innerText()).replace(/\s+/g, ' ').trim()).toMatch(/^OPEN-BRX ?\/$/i);
  // the wordmark sits on one line: icon, name and the nav links share a vertical centre within 3px
  const mid = el => el.evaluate(e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; });
  const [icon, name, link] = await Promise.all([mid(page.locator('.wm .logo')), mid(page.locator('.wm-name')), mid(page.locator('.topnav a').first())]);
  expect(Math.abs(icon - name), `wordmark icon and name are ${(icon - name).toFixed(1)}px apart vertically`).toBeLessThanOrEqual(3);
  if (page.viewportSize().width >= 1024) expect(Math.abs(name - link), `wordmark and nav links are ${(name - link).toFixed(1)}px apart vertically`).toBeLessThanOrEqual(4);
  // the wordmark opens the core places, every one a live page, and Escape closes it back to the button
  await page.locator('.wm').click();
  await expect(page.locator('#places')).toBeVisible();
  const places = await page.locator('#places a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(places).toEqual(expect.arrayContaining(['/', '/platform/', '/manual/']));
  expect(places, 'download does not belong in the places menu; the header button carries it').not.toContain('/download/');
  await page.keyboard.press('Escape');
  await expect(page.locator('#places')).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.className)).toBe('wm');
  // the header call to action is a button, not an underlined link
  expect(await page.locator('.top .btn').evaluate(b => getComputedStyle(b).textDecorationLine)).toBe('none');
  // the outline button's border runs along the whole chamfer, the diagonal included (a CSS border cannot; a clipped layer can)
  const edge = await page.locator('.hero .btn-line').first().evaluate(b => { const cs = getComputedStyle(b, '::before'); return { bg: cs.backgroundColor, clip: cs.clipPath }; });
  expect(edge.bg, 'the outline button has no drawn edge layer').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(edge.clip, 'the edge layer is not chamfered').toMatch(/polygon/);
  // hovering the primary button keeps its label readable (a generic link hover once turned it light blue on light blue)
  const primary = page.locator('.hero .btn-acc').first();
  await primary.hover(); await page.waitForTimeout(250);
  const hov = await primary.evaluate(b => { const cs = getComputedStyle(b); return [cs.color, cs.backgroundColor]; });
  const lumH = c => { const [r, g, b] = c.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const hr = (Math.max(lumH(hov[0]), lumH(hov[1])) + .05) / (Math.min(lumH(hov[0]), lumH(hov[1])) + .05);
  expect(hr, `hovered button label contrast ${hr.toFixed(2)}:1 (${hov.join(' on ')})`).toBeGreaterThanOrEqual(4.5);
  await page.mouse.move(0, 0);
  // keyboard focus is VISIBLE on a chamfered button (the clip-path used to clip the outline away)
  await page.locator('.hero .btn').first().focus();
  const ring = await page.locator('.hero .btn').first().evaluate(b => { const cs = getComputedStyle(b); return { style: cs.outlineStyle, offset: cs.outlineOffset }; });
  expect(ring.style, 'no focus ring on the primary button').not.toBe('none');
  expect(parseInt(ring.offset), 'focus ring drawn outside the chamfer, where the clip hides it').toBeLessThan(0);
  // modes that have not run on real taggers say so
  const wip = await page.locator('.tile.wip .badge').allTextContents();
  expect(wip.length, 'no mode is badged in development, yet state.py says some are unproven').toBeGreaterThan(0);
  // sections: eyebrow + h2 each, anchored, and the header's in-page links resolve to them
  const secs = page.locator('main.landing section.feat');
  const srcMd = fs.readFileSync(path.join(DOCS, 'platform/index.md'), 'utf8');
  expect(await secs.count(), 'a landing section went missing').toBe((srcMd.match(/^## /gm) || []).length);
  // the eyebrows number the sections in order, 01 upward, no gaps and no repeats
  const eyebrows = await page.locator('main.landing .feat .feat-head .eyebrow').allTextContents();
  expect(eyebrows.map(e => e.trim().slice(0, 2))).toEqual(eyebrows.map((_, i) => String(i + 1).padStart(2, '0')));
  for (const a of await page.locator('.topnav a[href^="#"]').evaluateAll(as => as.map(a => a.getAttribute('href')))) {
    expect(await page.locator(a).count(), `nav anchor ${a} has no target`).toBe(1);
  }
  // every screenshot and photo actually loaded, at its declared size. They are lazy, so walk the
  // page first the way a reader would; an image that never loads on scroll is the bug to catch.
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); });
  await page.waitForLoadState('networkidle');
  const imgs = await page.locator('main img').evaluateAll(is => is.map(i => ({ src: i.getAttribute('src'), alt: i.alt, ok: i.complete && i.naturalWidth > 0, w: i.getAttribute('width') })));
  expect(imgs.length).toBeGreaterThanOrEqual(8);
  for (const i of imgs) {
    expect(i.ok, `${i.src} did not load`).toBe(true);
    expect(i.alt.trim().length, `${i.src} has no alt text`).toBeGreaterThan(8);
    expect(i.w, `${i.src} has no declared width, so the page jumps as it loads`).not.toBeNull();
  }
  // shots and photos are content-hashed, never served under a bare name a cache could pin
  for (const i of imgs) expect(i.src, `${i.src} is not content-hashed`).toMatch(/\.[0-9a-f]{10}\.(jpg|svg|png)$/);
  // and every image is THE image the source names, in the source's order: a swapped screenshot fails here
  const want = [...srcMd.matchAll(/!\[[^\]]*\]\((\/(?:shots|photos)\/[^)\s]+)\)/g)].map(m => m[1].split('/').pop().replace(/\.[a-z]+$/, ''));
  const got = imgs.map(i => i.src.split('/').pop().replace(/\.[0-9a-f]{10}\.[a-z]+$/, ''));
  expect(got, 'rendered images differ from the source, in identity or order').toEqual(want);
  expect(errors).toEqual([]);
});

it('12b · the landing numbers equal the repo data they claim to count', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const f = facts();
  const counts = await page.locator('.counts .count').evaluateAll(cs => cs.map(c => ({ n: c.querySelector('b').dataset.n, label: c.querySelector('span').textContent })));
  expect(counts.find(c => /modes/.test(c.label))?.n).toBe(String(f.modes));
  expect(counts.find(c => /weapons/.test(c.label))?.n).toBe(String(f.weapons));
  const onGun = JSON.parse(fs.readFileSync(path.join(WEB, 'data/sounds.json'), 'utf8')).filter(s => s.on_gun).length;
  expect(counts.find(c => /sounds/.test(c.label))?.n, 'the sound count is not the on-tagger count').toBe(String(onGun));
  // one tile per mode, one chip total per weapon
  expect(await page.locator('.tiles .tile').count()).toBe(f.modes);
  const chipTotal = (await page.locator('.chips .chip b').allTextContents()).reduce((a, b) => a + Number(b), 0);
  expect(chipTotal).toBe(f.weapons);
  // the version comes from the release sidecar and is the only version on the page
  await expect(page.locator('.cards .c-app')).toContainText(f.release.version);
  const text = await page.locator('main').innerText();
  const versions = [...new Set(text.match(/\b\d+\.\d+\.\d+\b/g) || [])];
  expect(versions, 'a version other than the published build is on the landing').toEqual([f.release.version]);
  // and no date or status word reached the marketing copy
  expect(text).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  expect(text).not.toMatch(/\b(not yet|unfinished|coming soon)\b/i);
});

it('12c · every landing button goes where it says', async ({ page, request }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const btns = await page.locator('main .btn, .top .btn').evaluateAll(bs => bs.map(b => ({ t: b.textContent.trim(), h: b.getAttribute('href') })));
  expect(btns.length).toBeGreaterThanOrEqual(5);
  for (const b of btns) {
    expect(b.h, `button "${b.t}" has no href`).toBeTruthy();
    if (b.h.startsWith('/')) expect((await request.get(b.h)).ok(), `"${b.t}" -> ${b.h}`).toBe(true);
  }
  // "Get the app" is the primary action and it lands on the download page, never on a bare APK
  const get = btns.filter(b => /get the app/i.test(b.t));
  expect(get.length).toBeGreaterThanOrEqual(2);
  for (const b of get) expect(b.h).toBe('/download/');
  // the download page carries the live Android card with the checksum
  await page.goto('/download/');
  await expect(page.locator('.dl .dl-btn')).toContainText(/APK/);
  expect(await page.locator('.dl .dl-btn').getAttribute('href')).toMatch(/^https:\/\/github\.com\/.*\.apk$/);
  await expect(page.locator('.dl-meta')).toContainText(/[0-9a-f]{64}/);
  await expect(page.locator('h2', { hasText: /iOS/ })).toBeVisible();
});

it('12d · motion reveals as you scroll and never hides content from readers', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  // before scrolling, a section far down is staged (transparent) but present in the tree
  const late = page.locator('section.feat[aria-labelledby="get-it"]');   // the id sits on the h2 the nav anchors to
  const staged = await late.locator('[data-reveal]').first().evaluate(e => getComputedStyle(e).opacity);
  expect(Number(staged), 'the reveal has no starting state; motion is not wired').toBeLessThan(1);
  // scroll the ELEMENT in, not the section: on a phone the section is taller than the screen and
  // centring it leaves its first line above the viewport
  await late.locator('[data-reveal]').first().scrollIntoViewIfNeeded();
  await expect(late.locator('[data-reveal]').first()).toHaveClass(/\bin\b/);
  await expect.poll(async () => Number(await late.locator('[data-reveal]').first().evaluate(e => getComputedStyle(e).opacity)), { timeout: 3000 }).toBe(1);
  // after a full scroll under NORMAL motion nothing stays hidden: not a photo, not a shot, not a terminal line
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 90)); } });
  await page.waitForTimeout(1800);
  const stuck = await page.locator('[data-reveal], .shot.wide, .hero .photo, .term .t-l').evaluateAll(es => es.filter(e => Number(getComputedStyle(e).opacity) < 1).map(e => e.className || e.tagName));
  expect(stuck, 'elements still hidden after scrolling the whole page').toEqual([]);
  // every count-up lands on its real number, not just the first
  await page.locator('.counts').scrollIntoViewIfNeeded();
  const ns = page.locator('.counts b[data-n]');
  for (let i = 0; i < await ns.count(); i++) {
    await expect.poll(async () => (await ns.nth(i).textContent()).replace(/,/g, ''), { timeout: 3000 }).toBe(await ns.nth(i).getAttribute('data-n'));
  }
  // the pinned layout: the shot never overlaps the lede or the captions beside it (desktop only; it stacks on a phone)
  if (page.viewportSize().width >= 1024) {
    const pin = page.locator('.feat.pin').first();
    await pin.locator('.shot.wide').scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
    const [lede, shot, caps] = await Promise.all([pin.locator('> .lede').boundingBox(), pin.locator('.shot.wide').boundingBox(), pin.locator('.caps').boundingBox()]);
    const overlap = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    expect(overlap(lede, shot), 'the pinned shot overlaps its lede').toBe(false);
    expect(overlap(caps, shot), 'the pinned shot overlaps its captions').toBe(false);
  }
  // an in-page anchor lands its heading BELOW the sticky header, not under it (the heading used to be
  // scrolled to while still translated by its reveal, then slid up 18px under the header)
  for (const a of ['#mission-control', '#the-hud', '#game-modes']) {
    await page.goto('/', { waitUntil: 'networkidle' });
    if (await page.locator('.burger').isVisible()) await page.locator('.burger').click();   // the nav is behind the burger on a phone
    await page.locator(`.topnav a[href="${a}"]`).click();
    await page.waitForTimeout(1200);
    const [top, header] = await page.evaluate(sel => [document.querySelector(sel).getBoundingClientRect().top, document.querySelector('.top').offsetHeight], a);
    expect(top, `${a} lands at ${top}px, header is ${header}px`).toBeGreaterThanOrEqual(header + 8);
  }
  // no JavaScript: every word and picture is visible, nothing waits for a reveal that will never run
  const nojs = await page.context().browser().newContext({ javaScriptEnabled: false });
  const p0 = await nojs.newPage();
  await p0.goto('/', { waitUntil: 'networkidle' });
  const dark = await p0.locator('[data-reveal], .shot.wide, .hero .photo, .term .t-l').evaluateAll(es => es.filter(e => Number(getComputedStyle(e).opacity) < 1).length);
  expect(dark, 'elements invisible without JavaScript').toBe(0);
  await nojs.close();
  // reduced motion: everything is visible at once, nothing animates
  const ctx = await page.context().browser().newContext({ reducedMotion: 'reduce' });
  const p2 = await ctx.newPage();
  await p2.goto('/', { waitUntil: 'networkidle' });
  const hidden = await p2.locator('[data-reveal]').evaluateAll(es => es.filter(e => Number(getComputedStyle(e).opacity) < 1).length);
  expect(hidden, 'elements hidden under prefers-reduced-motion').toBe(0);
  await ctx.close();
});

it('12e · the landing is accessible: landmarks, heading order, contrast, tap targets, fonts', async ({ page }, testInfo) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  for (const lm of ['header', 'nav', 'main', 'footer']) expect(await page.locator(lm).count(), `no <${lm}>`).toBeGreaterThan(0);
  // h1 then h2s only: the section eyebrows are labels, not headings, so the outline stays flat
  const levels = await page.locator('main h1, main h2, main h3, main h4').evaluateAll(hs => hs.map(h => h.tagName));
  expect(levels[0]).toBe('H1');
  expect(levels.filter(l => l !== 'H1' && l !== 'H2'), 'a landing section skipped a heading level').toEqual([]);
  // the self-hosted display face actually loaded (Google-hosted fonts are gone)
  expect(await page.evaluate(() => document.fonts.check('700 40px Oswald')), 'Oswald did not load').toBe(true);
  expect(await page.locator('link[href*="fonts.googleapis"]').count(), 'a Google Fonts link is still on the page').toBe(0);
  // Open Graph and canonical for the share card
  for (const m of ['og:title', 'og:description', 'og:url']) expect(await page.locator(`meta[property="${m}"]`).count(), `missing ${m}`).toBe(1);
  expect(await page.locator('link[rel="canonical"]').count()).toBe(1);
  expect(await page.locator('script[type="application/ld+json"]').count()).toBe(1);
  // body copy contrast: the lede against the ground
  const c = await page.locator('.hero .lede').evaluate(e => [getComputedStyle(e).color, getComputedStyle(document.body).backgroundColor]);
  const lum = s => { const [r, g, b] = s.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const ratio = (lum(c[0]) + .05) / (lum(c[1]) + .05);
  expect(ratio, `lede contrast ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  // no text a reader is meant to read is under 11px (labels included; decorative regions excluded by the vh class)
  const tiny = await page.evaluate(() => {
    const res = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())) {
      const t = n.textContent.trim(); if (t.length < 3) continue;
      const el = n.parentElement; if (!el || el.closest('.vh, [hidden], script, style')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (parseFloat(cs.fontSize) < 11) res.push(`${cs.fontSize} "${t.slice(0, 30)}"`);
    }
    return res;
  });
  expect(tiny, 'text under 11px').toEqual([]);
  // every button is a real tap target
  const small = await page.locator('main .btn').evaluateAll(bs => bs.filter(b => b.getBoundingClientRect().height < 44).map(b => b.textContent.trim()));
  expect(small, 'buttons under 44px').toEqual([]);
  // the skip link moves FOCUS into the content, not just the scroll position
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip')).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement?.id), 'skip link did not move focus to main').toBe('main');
  if (testInfo.project.name === 'phone') {
    // the two icon buttons in the header are what a phone user actually has to hit
    for (const sel of ['.burger']) {
      const h = await page.locator(sel).evaluate(b => b.getBoundingClientRect().height);
      expect(h, `${sel} is ${h}px tall on a phone`).toBeGreaterThanOrEqual(44);
    }
    await page.goto('/manual/hardware/');
    const th = await page.locator('.theme').evaluate(b => b.getBoundingClientRect().height);
    expect(th, `.theme is ${th}px tall on a phone`).toBeGreaterThanOrEqual(44);
    await page.goto('/', { waitUntil: 'networkidle' });
    // the header CTA hides on a phone so the burger and brand fit; the hero buttons carry the action
    await expect(page.locator('.top-cta')).toBeHidden();
    await expect(page.locator('.wm')).toBeVisible();
    // the landing header has its own burger; it opens the section list and Escape closes it
    await page.locator('.burger').click();
    await expect(page.locator('.topnav')).toBeVisible();
    expect(await page.locator('.topnav a').count()).toBeGreaterThanOrEqual(5);
    await page.keyboard.press('Escape');
    await expect(page.locator('.topnav')).toBeHidden();
    const w = await page.locator('.hero .cta .btn').first().evaluate(b => b.getBoundingClientRect().width);
    expect(w, 'hero button is not full width on a phone').toBeGreaterThan(300);
  }
});

it('12f · the manual front door searches from its hero and lists every manual page', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/manual/', { waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveCount(1);
  // one door per manual page in the header nav, each leading to a live page with that title
  const doors = await page.locator('.doors .door').evaluateAll(ds => ds.map(d => ({ h: d.getAttribute('href'), t: d.querySelector('.t').textContent.trim() })));
  const navs = await page.locator('.topnav a[href^="/manual/"]').evaluateAll(as => as.map(a => a.textContent.trim()));
  expect(doors.map(d => d.t)).toEqual(navs);
  // a door's blurb is a sentence: it ends on a full stop, never on a bare cut or an ellipsis
  const blurbs = await page.locator('.doors .door .s').allTextContents();
  for (const b of blurbs) {
    expect(b.length, `blurb too short: "${b}"`).toBeGreaterThan(40);
    expect(b.trim(), `blurb does not end as a sentence: "${b}"`).toMatch(/[a-z)]\.$/i);
  }
  for (const d of doors) {
    await page.goto(d.h);
    await expect(page.locator('h1')).toBeVisible();
  }
  await page.goto('/manual/', { waitUntil: 'networkidle' });
  // the hero search is the header search, moved: same behaviour, same keyboard
  await page.keyboard.press('/');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('q');
  expect(await page.evaluate(() => document.activeElement.closest('.hero-find') !== null), 'slash focused a box outside the hero').toBe(true);
  await page.keyboard.type('$WEAP');
  await expect(page.locator('#results a').first()).toBeVisible();
  await expect(page.locator('#results a').first().locator('.r-h')).toContainText('$WEAP');
  expect(errors).toEqual([]);
});

it('12h · the platform landing markets the software and hands off to the download', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/platform/', { waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveCount(1);
  expect((await page.locator('.wm').innerText()).replace(/\s+/g, ' ').trim()).toMatch(/^PLATFORM ?\/$/i);
  expect(await page.locator('.top .btn.top-cta').getAttribute('href')).toBe('/download/');
  expect(await page.locator('.theme').count()).toBe(0);
  // its header lists its own sections and they resolve
  for (const a of await page.locator('.topnav a[href^="#"]').evaluateAll(as => as.map(a => a.getAttribute('href')))) {
    expect(await page.locator(a).count(), `nav anchor ${a} has no target`).toBe(1);
  }
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); });
  await page.waitForLoadState('networkidle');
  const imgs = await page.locator('main img').evaluateAll(is => is.map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })));
  expect(imgs.length).toBeGreaterThanOrEqual(6);
  for (const i of imgs) expect(i.ok, `${i.src} did not load`).toBe(true);
  // the release card is live data, the same version as the download page
  const v = JSON.parse(fs.readFileSync(path.join(DOCS, '../webapp/download/build.json'), 'utf8')).version;
  await expect(page.locator('.cards .c-app')).toContainText(v);
  expect(errors).toEqual([]);
});

it('12g · the site is honest when a photo has not been shot yet', async ({ page }) => {
  // The hero and objectives slots may still be placeholders. If they are, the placeholder says so
  // in its own alt text, so nobody mistakes the striped box for a broken image.
  await page.goto('/', { waitUntil: 'networkidle' });
  const photos = await page.locator('figure.photo img').evaluateAll(is => is.map(i => ({ src: i.getAttribute('src'), alt: i.alt })));
  expect(photos.length).toBeGreaterThanOrEqual(1);
  for (const p of photos) {
    if (p.src.endsWith('.svg')) expect(p.alt.length, `${p.src}: a placeholder needs alt text saying what belongs there`).toBeGreaterThan(8);
  }
});

// A typo in ONLY= skipped all 30 steps and exited 0, which reads exactly like a green run.
// Registered with bare `test` so it cannot be filtered out by the very thing it is checking.
if (only) test('ONLY= matched at least one step', () => {
  expect(matched, `ONLY="${only}" matched no step, so nothing ran`).toBeGreaterThan(0);
});
