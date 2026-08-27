# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: site.spec.mjs >> 1 · renders /
- Location: test/site.spec.mjs:15:74

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.legend summary')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('.legend summary')

```

```yaml
- link "Skip to content":
  - /url: "#main"
- banner:
  - link "OPEN BRX":
    - /url: /
  - navigation "Primary":
    - link "Manual":
      - /url: /manual/
    - link "Platform":
      - /url: /platform/
    - link "Credits":
      - /url: /credits/
    - link "Changelog":
      - /url: /changelog/
  - button "Search the manual": Search ⌘K
  - button "Toggle light and dark theme" [pressed]: ◐
  - link "GitHub repository":
    - /url: https://github.com/tony99nyr/open-brx
    - text: GitHub
- main:
  - article:
    - heading "Video game inspired tactical laser tag — open and self-hosted." [level=1]
    - paragraph:
      - text: Manual last verified
      - time: 2026-08-27
      - link "View as Markdown":
        - /url: /index.md
    - paragraph:
      - strong: Open BRX.
      - text: "The definitive manual for the Battle Company BRX tagger and headset — and an open-source platform that turns stock BRX guns into a fully orchestrated laser-tag system: real game modes, live scoring, objectives, a phone HUD, a laptop mission control. No subscription. No firmware mods. No venue Wi-Fi required."
    - figure "full-bleed hero (night field, dim red HUD glow — see images.md)":
      - 'img "Night game: 3–4 silhouetted players spread across a dark field, each with a faint red/amber glow from a phone mounted on a black rifle-style tagger; the base is a distant laptop glow. Mood: tense, cinematic, no faces."': HOME-01 illustration pending
      - text: full-bleed hero (night field, dim red HUD glow — see images.md)
    - paragraph:
      - text: "Source:"
      - link "docs/VISION.md":
        - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/VISION.md
      - text: ", README.md"
    - heading "Two doors" [level=2]
    - paragraph: "2 large cards:"
    - list:
      - listitem:
        - strong: The Ultimate BRX Manual
        - text: →
        - link "Manual hub →":
          - /url: /manual/
        - text: ". \"Everything about the tagger and headset in one place: anatomy, pairing, every weapon, the 2166-sound bank, repairs, and the full BLE protocol. Built from the official docs, the community, and our own bench.\""
      - listitem:
        - strong: The Open BRX platform
        - text: →
        - link "The Open BRX platform →":
          - /url: /platform/
        - text: . "Run Team Deathmatch and more on stock guns from a laptop today with
        - code: brx-mcp
        - text: — proven on real hardware. The rest — a mission-control console, a phone HUD per gun, an ESP32 rider — is under construction."
    - paragraph:
      - text: "Source:"
      - link "docs/README.md":
        - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/README.md
      - text: ","
      - link "docs/architecture-topology.md":
        - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/architecture-topology.md
    - paragraph: "4 big numbers:"
    - list:
      - listitem:
        - strong: 2,166
        - text: sound ids decoded (protocol/callsign-extract/sound-bank.md)
      - listitem:
        - strong: "19"
        - text: weapons, every stat on the wire (docs/reference/weapons.md — 20 captured frames; the 20th is the default secondary, which is the Shotgun)
      - listitem:
        - strong: "63"
        - text: players per game, 4 native teams (
        - code: $PSET
        - text: id 1–63;
        - code: $TID
        - text: 2-bit) (docs/architecture-topology.md §2)
      - listitem:
        - strong: "0"
        - text: firmware modifications — ever (CLAUDE.md hard rule)
    - note:
      - strong: Only what we know.
      - paragraph: "Every fact on this site says where it came from: verified on our bench, from Battle Company's docs, decoded from the Callsign app, community-reported. If something isn't confirmed, it isn't here yet — the manual grows as the research does."
      - paragraph:
        - text: "Source:"
        - link "docs/site/BRIEF-open-brx-site.md":
          - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/site/BRIEF-open-brx-site.md
        - text: §2
    - heading "Start here if you…" [level=2]
    - paragraph: "4 cards linking into the manual:"
    - list:
      - listitem:
        - text: "\"…just got a BRX\" →"
        - link "Quick Start →":
          - /url: /manual/operate/quick-start/
      - listitem:
        - text: "\"…can't get the headset to pair\" →"
        - link "Headset, pairing & Bluetooth →":
          - /url: /manual/fix/pairing/
      - listitem:
        - text: "\"…want custom sounds\" →"
        - link "Custom sounds over USB →":
          - /url: /manual/sound/custom-sounds/
      - listitem:
        - text: "\"…want to write code that talks to the gun\" →"
        - link "Getting started with brx-mcp →":
          - /url: /manual/dev/brx-mcp/
    - paragraph: "Source: content/02, 04, 05, 06"
    - figure "teaser diagram (SVG — a phone on each gun, a laptop at the base, IR between guns; solid vs dashed links)":
      - 'img "Topology: laptop at base ↔ (dashed Wi-Fi) ↔ phone nodes, each phone ↔ (solid BLE) ↔ one gun, gun → gun IR arrows."': HOME-02 diagram pending
      - text: teaser diagram (SVG — a phone on each gun, a laptop at the base, IR between guns; solid vs dashed links)
    - heading "What the platform does today" [level=2]
    - paragraph: "3 cards with status badges:"
    - list:
      - listitem:
        - strong: Play now, laptop-only
        - text: —
        - code: python -m brx_mcp play tdm <gun1> <gun2>
        - text: "ran a full Team Deathmatch on two real taggers on 2026-08-25: scoring, respawn, frag limit, correct winner. Everyone stays in the laptop's BLE range (a room, a yard)."
      - listitem:
        - strong: Mission Control + the phone HUD
        - text: — a laptop console that authors the game and a phone on each gun that runs it over field Wi-Fi, so players aren't tied to the laptop's BLE range. Under construction — details when it's been run on a real field.
      - listitem:
        - strong: The Companion
        - text: — a ~$15 ESP32 rider that reconstructs the gun's own kill flash and killstreak audio over BLE, no phone needed. Under construction — specified, bench kit in hand.
    - paragraph:
      - text: "Source:"
      - link "docs/architecture-topology.md":
        - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/architecture-topology.md
      - text: §3, §7; README.md;
      - link "docs/VISION.md":
        - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/VISION.md
    - blockquote:
      - text: Credits,
      - link "Credits & sourcing →":
        - /url: /credits/
    - paragraph: "Source: README.md"
    - heading "Latest from the bench" [level=2]
    - paragraph:
      - text: 3 most recent dated entries, pulled from
      - link "Changelog →":
        - /url: /changelog/
      - text: (design the slot; content comes from the changelog page).
    - paragraph: "Footer: Manual sections · Platform · GitHub · Credits · \"Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company.\" · MIT."
- contentinfo:
  - paragraph:
    - text: Protocol discovered by
    - link "LaserTagMods":
      - /url: https://github.com/LaserTagMods
    - text: (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community.
  - paragraph:
    - text: Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company. MIT licence.
    - link "Credits & sourcing":
      - /url: /credits/
    - text: ·
    - link "Changelog":
      - /url: /changelog/
    - text: ·
    - link "llms.txt":
      - /url: /llms.txt
    - text: ·
    - link "GitHub":
      - /url: https://github.com/tony99nyr/open-brx
```

# Test source

```ts
  1   | // ui-build-verify checklist for the Open BRX static site. Every step asserts what a person SEES.
  2   | // Run: npm test (builds first). ONLY=<title fragment> runs matching steps: ONLY=explorer npx playwright test
  3   | import { test, expect } from '@playwright/test';
  4   | import fs from 'node:fs';
  5   | import path from 'node:path';
  6   | import { execFileSync } from 'node:child_process';
  7   | import { fileURLToPath } from 'node:url';
  8   | 
  9   | const HERE = path.dirname(fileURLToPath(import.meta.url));
  10  | const SITE = path.resolve(HERE, '..');
  11  | const REPO = path.resolve(SITE, '..');
  12  | const WEB = path.join(REPO, 'webapp');
  13  | const STALE = 'http://localhost:4174';
  14  | const only = process.env.ONLY;
  15  | const it = (name, fn) => (only && !name.includes(only) ? test.skip : test)(name, fn);
  16  | const HEDGE = /\b(probably|likely|we think|we believe|reportedly|unconfirmed|unverified|may be|might be|appears to)\b/i;
  17  | const BLOCK_MARKER = /\[[a-z][a-z-]*(?::[a-z|]+)?(?:\s+[A-Za-z0-9-]+)?\]/;
  18  | 
  19  | function sitemapUrls() {
  20  |   const xml = fs.readFileSync(path.join(WEB, 'sitemap.xml'), 'utf8');
  21  |   return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
  22  | }
  23  | const manifest = () => JSON.parse(fs.readFileSync(path.join(WEB, '.site-manifest.json'), 'utf8'));
  24  | function watchErrors(page, allow = []) {
  25  |   const errors = [];
  26  |   const ok = s => allow.some(a => s.includes(a));
  27  |   page.on('pageerror', e => { const s = 'pageerror: ' + e.message; if (!ok(s)) errors.push(s); });
  28  |   page.on('console', m => { if (m.type() === 'error') { const s = 'console: ' + m.text(); if (!ok(s)) errors.push(s); } });
  29  |   page.on('response', r => { if (r.status() >= 400 && !r.url().includes('fonts.g')) { const s = `http ${r.status()} ${r.url()}`; if (!ok(s)) errors.push(s); } });
  30  |   return errors;
  31  | }
  32  | 
  33  | // ---- 0. we are testing the build we think we are ---------------------------------------------
  34  | it('0 · the server on :4173 serves the committed webapp/ output; sitemap ↔ manifest ↔ search index agree', async ({ request }) => {
  35  |   const r = await request.get('/');
  36  |   expect(r.headers()['x-site-root']).toBe(WEB);
  37  |   const m = manifest();
  38  |   expect(m.ok).toBe(true);
  39  |   const urls = sitemapUrls();
  40  |   expect(urls.length).toBe(m.htmlFiles);
  41  |   const idx = await (await request.get('/data/search.json')).json();
  42  |   expect(idx.length).toBe(urls.length);
  43  |   expect(new Set(idx.map(p => p.url.replace(/\/$/, '') || '/'))).toEqual(new Set(urls.map(u => u.replace(/\/$/, '') || '/')));
  44  | });
  45  | 
  46  | // ---- 1. fresh build: every page renders (one step per page so a failure names the page) --------
  47  | for (const u of sitemapUrls()) {
  48  |   it(`1 · renders ${u}`, async ({ page }) => {
  49  |     const errors = watchErrors(page);
  50  |     await page.goto(u, { waitUntil: 'networkidle' });
  51  |     await expect(page.locator('h1')).toHaveCount(1);
  52  |     await expect(page.locator('h1').first()).toBeVisible();
  53  |     await expect(page.locator('time[datetime]').first()).toBeAttached();
  54  |     const text = await page.locator('main').innerText();
  55  |     // prose only (code samples legitimately contain [placeholders])
  56  |     const prose = await page.evaluate(() => { const c = document.querySelector('main').cloneNode(true); c.querySelectorAll('pre, code').forEach(e => e.remove()); return c.innerText; });
  57  |     expect(prose, 'raw block marker').not.toMatch(BLOCK_MARKER);
  58  |     expect(text, "shows 'undefined'/NaN").not.toMatch(/\bundefined\b|\bNaN\b/);
  59  |     expect(text, 'raw src: line').not.toMatch(/(^|\s)src:\s/);
  60  |     expect(text, 'leaked held content').not.toContain('Research backlog');
  61  |     expect(text, 'unconfirmed marker').not.toContain('❓');
  62  |     expect(text, 'hedge language').not.toMatch(HEDGE);
  63  |     expect(await page.locator('[data-todo]').count(), 'TODO chip on a real page').toBe(0);
  64  |     // every TOC link resolves to an element on the page; every figure has an accessible name
  65  |     const dangling = await page.evaluate(() => [...document.querySelectorAll('.toc a[href^="#"]')].map(a => a.getAttribute('href').slice(1)).filter(id => !document.getElementById(id)));
  66  |     expect(dangling, 'dangling TOC anchors').toEqual([]);
  67  |     const dupIds = await page.evaluate(() => { const seen = new Set(), d = []; for (const el of document.querySelectorAll('[id]')) { if (seen.has(el.id)) d.push(el.id); seen.add(el.id); } return d; });
  68  |     expect(dupIds, 'duplicate ids').toEqual([]);
  69  |     const badFig = await page.evaluate(() => [...document.querySelectorAll('figure')].filter(f => !(f.querySelector('img[alt]') || f.querySelector('[aria-label]'))).length);
  70  |     expect(badFig, 'figure without alt/aria-label').toBe(0);
  71  |     // "→ Title" cross-references must be links, and page links must show a title, not a raw slug
  72  |     const deadRefs = await page.evaluate(() => [...document.querySelectorAll('main em')].filter(e => !e.closest('a') && /→\s*$/.test((e.previousSibling?.textContent || '').slice(-3))).map(e => e.textContent));
  73  |     expect(deadRefs, 'dead → cross-references').toEqual([]);
  74  |     const slugLinks = await page.evaluate(() => [...document.querySelectorAll('main a.pl')].filter(a => /^\/(manual|platform)/.test(a.textContent.trim())).map(a => a.textContent));
  75  |     expect(slugLinks, 'page links showing raw slugs').toEqual([]);
  76  |     const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  77  |     expect(sw, `horizontal page overflow (${sw} > ${iw})`).toBeLessThanOrEqual(iw + 1);
> 78  |     await expect(page.locator('.legend summary')).toBeVisible();
      |                                                   ^ Error: expect(locator).toBeVisible() failed
  79  |     expect(errors, errors.join('\n')).toEqual([]);
  80  |   });
  81  | }
  82  | 
  83  | it('1t · TOC follows the reader: clicking a TOC link scrolls to the heading and marks it active', async ({ page }) => {
  84  |   await page.goto('/manual/dev/transport/');
  85  |   const vp = page.viewportSize();
  86  |   test.skip(vp.width < 1100, 'no TOC rail below 1100px');
  87  |   const link = page.locator('.toc a').nth(2);
  88  |   const id = (await link.getAttribute('href')).slice(1);
  89  |   await link.click();
  90  |   await expect(page).toHaveURL(new RegExp(`#${id}$`));
  91  |   await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
  92  |   await expect(page.locator('.toc a.active')).toHaveAttribute('href', `#${id}`);
  93  | });
  94  | 
  95  | // ---- 2. click every control --------------------------------------------------------------------
  96  | it('2a · weapons explorer: search, every class chip, compare pick/unpick/evict, sort — the screen changes', async ({ page, context }) => {
  97  |   await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  98  |   const errors = watchErrors(page);
  99  |   await page.goto('/manual/gameplay/weapons/');
  100 |   const ex = page.locator('[data-explorer="weapons"]');
  101 |   await expect(ex.locator('[data-x-count]')).toHaveText(/19 of 19 shown/);
  102 |   await expect(ex.locator('[data-x-error]')).toBeHidden();
  103 |   await expect(ex.locator('tbody tr')).toHaveCount(19);
  104 |   // search narrows, "no matches" row appears for junk, clearing restores
  105 |   await ex.locator('[data-x-search]').fill('sniper');
  106 |   await expect(ex.locator('[data-x-count]')).toHaveText(/^[1-9] of 19 shown/);
  107 |   await ex.locator('[data-x-search]').fill('zzzz-no-such-weapon');
  108 |   await expect(ex.locator('tbody')).toContainText('No matches');
  109 |   await expect(ex.locator('[data-x-count]')).toHaveText(/^0 of 19 shown/);
  110 |   await ex.locator('[data-x-search]').fill('');
  111 |   await expect(ex.locator('tbody tr')).toHaveCount(19);
  112 |   // every facet chip changes the count and takes aria-pressed; chip set = distinct classes
  113 |   const chips = ex.locator('[data-facet]:not([data-facet="all"])');
  114 |   const roles = await page.evaluate(async () => [...new Set((await (await fetch('/data/weapons.json')).json()).weapons.map(w => w.role))].sort());
  115 |   expect(await chips.allTextContents()).toEqual(roles);
  116 |   for (let i = 0; i < await chips.count(); i++) {
  117 |     const chip = chips.nth(i); await chip.click();
  118 |     await expect(chip).toHaveAttribute('aria-pressed', 'true');
  119 |     await expect(ex.locator('[data-facet="all"]')).toHaveAttribute('aria-pressed', 'false');
  120 |     const txt = await ex.locator('[data-x-count]').innerText();
  121 |     expect(txt).toMatch(/^\d+ of 19 shown/); expect(txt).not.toMatch(/^19 of/); expect(txt).not.toMatch(/^0 of/);
  122 |   }
  123 |   await ex.locator('[data-facet="all"]').click();
  124 |   await expect(ex.locator('[data-x-count]')).toHaveText(/19 of 19 shown/);
  125 |   // compare dock states
  126 |   await expect(ex.locator('[data-x-dock]')).toContainText('Tick two weapons');
  127 |   await ex.locator('[data-pick="assault_rifle"]').check();
  128 |   await expect(ex.locator('[data-x-dock]')).toContainText('Assault Rifle');
  129 |   await expect(ex.locator('[data-x-dock]')).toContainText('one more');
  130 |   await ex.locator('[data-pick="smg"]').check();
  131 |   await expect(ex.locator('[data-x-dock] .cmp')).toBeVisible();
  132 |   await expect(ex.locator('[data-x-dock]')).toContainText('SMG');
  133 |   await expect(ex.locator('[data-x-dock]')).toContainText('Damage');
  134 |   await ex.locator('[aria-label="Compare Sniper Rifle"]').check();
  135 |   await expect(ex.locator('[data-x-dock]')).not.toContainText('Assault Rifle');
  136 |   await expect(ex.locator('tr.picked')).toHaveCount(2);
  137 |   await ex.locator('[data-pick="smg"]').uncheck();
  138 |   await expect(ex.locator('tr.picked')).toHaveCount(1);
  139 |   await expect(ex.locator('[data-x-dock]')).toContainText('one more');
  140 |   // numeric sort reorders rows (9 < 10 < 100, not lexical)
  141 |   const dmgTh = ex.locator('th[data-col]', { hasText: 'Damage' });
  142 |   await dmgTh.click();
  143 |   await expect(dmgTh).toHaveAttribute('aria-sort', 'ascending');
  144 |   const asc = (await ex.locator('tbody tr td:nth-child(4)').allInnerTexts()).map(Number);
  145 |   expect(asc).toEqual([...asc].sort((a, b) => a - b));
  146 |   expect(asc[0]).toBeLessThan(asc[asc.length - 1]);
  147 |   await dmgTh.click();
  148 |   await expect(dmgTh).toHaveAttribute('aria-sort', 'descending');
  149 |   const desc = (await ex.locator('tbody tr td:nth-child(4)').allInnerTexts()).map(Number);
  150 |   expect(desc).toEqual([...asc].reverse());
  151 |   // keyboard sort on a text column
  152 |   const nameTh = ex.locator('th[data-col]', { hasText: 'Weapon' });
  153 |   await nameTh.focus(); await page.keyboard.press('Enter');
  154 |   await expect(nameTh).toHaveAttribute('aria-sort', 'ascending');
  155 |   const names = await ex.locator('tbody tr td:nth-child(2) strong').allInnerTexts();
  156 |   expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  157 |   expect(errors, errors.join('\n')).toEqual([]);
  158 | });
  159 | 
  160 | it('2b · sound bank explorer: 2166 ids, search, family chips, show-more to exhaustion, copy $PLAY', async ({ page, context }) => {
  161 |   await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  162 |   const errors = watchErrors(page);
  163 |   await page.goto('/manual/sound/sound-bank/');
  164 |   const ex = page.locator('[data-explorer="sounds"]');
  165 |   await expect(ex.locator('[data-x-count]')).toHaveText(/2166 of 2166 shown/);
  166 |   await expect(ex.locator('tbody tr')).toHaveCount(300);
  167 |   await expect(ex.locator('[data-x-more]')).toBeVisible();
  168 |   let clicks = 0;
  169 |   while (await ex.locator('[data-x-more]').isVisible()) { await ex.locator('[data-x-more-btn]').click(); clicks++; expect(clicks).toBeLessThan(10); await page.waitForTimeout(50); }
  170 |   await expect(ex.locator('tbody tr')).toHaveCount(2166);
  171 |   await ex.locator('[data-x-search]').fill('R02');
  172 |   await expect(ex.locator('[data-x-count]')).toHaveText(/^\d+ of 2166 shown/);
  173 |   await expect(ex.locator('tbody tr').first()).toContainText('R02');
  174 |   await expect(ex.locator('[data-x-more]')).toBeHidden();
  175 |   await ex.locator('[data-x-search]').fill('');
  176 |   const chips = ex.locator('[data-facet]:not([data-facet="all"])');
  177 |   const fams = await page.evaluate(async () => [...new Set((await (await fetch('/data/sounds.json')).json()).rows.map(r => r.family))].sort());
  178 |   expect(await chips.allTextContents()).toEqual(fams);
```