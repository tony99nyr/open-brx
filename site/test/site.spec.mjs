// The whole gate for the Open BRX site. Every check asserts something a reader would see.
// Run: npm test (builds first). ONLY=<fragment> runs matching steps.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../webapp');
const only = process.env.ONLY;
const it = (name, fn) => (only && !name.includes(only) ? test.skip : test)(name, fn);

// the one list of old-DSL block names, imported from the build so the two can never drift
const { BLOCK_MARKER } = await import(pathToFileURL(path.resolve(HERE, '../block-names.mjs')).href);

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

    expect(errors).toEqual([]);
  });
}

it('1b · a page opens with its title, not with a second nav bar', async ({ page }) => {
  // A sibling-links row above the <h1> read as a second navigation bar under the first, with the
  // same underline-for-current treatment, so three "you are here" marks sat within 100px and it
  // competed with the contents box. Where-to-go-next belongs at the END of the article.
  for (const u of urls()) {
    await page.goto(u);
    const first = page.locator('article > *').first();
    expect(await first.evaluate(e => e.tagName), `${u} does not open with its title`).toBe('H1');
    // and any section-sibling nav must come after the content
    const more = page.locator('article > nav.more');
    if (await more.count()) {
      const pos = await more.evaluate(e => {
        const kids = [...e.parentElement.children];
        return { at: kids.indexOf(e), of: kids.length };
      });
      expect(pos.at, `${u}: the "more in this section" block is not at the end`).toBeGreaterThan(pos.of - 3);
    }
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
  const dir = path.resolve(WEB, '../docs/manual');
  const urls = new Set();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md')) {
    for (const u of fs.readFileSync(path.join(dir, f), 'utf8').match(/https?:\/\/[^\s)"'<]+/g) || []) {
      urls.add(u);   // including our own repo: excluding it is how a 404 on all 12 pages survived
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
      if (r.status() >= 400) bad.push(`${u} -> ${r.status()}`);
    } catch (e) { console.log(`  (could not reach ${u}: ${e.message.split('\n')[0]})`); }
  }
  expect(bad, 'published official links that do not resolve').toEqual([]);
});

it('3 · every markdown twin is byte-for-byte the manual file it came from', async ({ request }) => {
  // The twins and llms-full.txt are what llms.txt exists to serve. Asserting "a file exists and has
  // an H1" let a twin carrying entirely the wrong page pass, so compare the actual bytes.
  const MANUAL = path.resolve(WEB, '../docs/manual');
  const map = JSON.parse(fs.readFileSync(path.join(WEB, '.site-manifest.json'), 'utf8')).twins;
  expect(Object.keys(map).length, 'the build published no twin map').toBe(urls().length);
  const full = await (await request.get('/llms-full.txt')).text();
  for (const [twin, file] of Object.entries(map)) {
    const r = await request.get(twin);
    expect(r.ok(), `${twin} missing`).toBe(true);
    const served = await r.text();
    const source = fs.readFileSync(path.join(MANUAL, file), 'utf8');
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
  expect(y, 'the anchor lands under the sticky header').toBeGreaterThanOrEqual(0);
  expect(errors).toEqual([]);
});

it('6c · search says so when nothing matches and when the index will not load', async ({ page }) => {
  await page.goto('/');
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
