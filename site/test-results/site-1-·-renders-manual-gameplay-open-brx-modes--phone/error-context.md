# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: site.spec.mjs >> 1 · renders /manual/gameplay/open-brx-modes/
- Location: test/site.spec.mjs:15:74

# Error details

```
Error: dead → cross-references

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "Platform section",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - banner [ref=e3]:
    - button "Open navigation" [ref=e4] [cursor=pointer]: ☰
    - link "OPEN BRX" [ref=e5] [cursor=pointer]:
      - /url: /
    - generic [ref=e9]:
      - button "Search the manual" [ref=e10] [cursor=pointer]:
        - generic [ref=e11]: ⌘K
      - button "Toggle light and dark theme" [pressed] [ref=e12] [cursor=pointer]: ◐
  - generic [ref=e13]:
    - navigation "Manual sections" [ref=e14]:
      - group [ref=e15]:
        - generic "▸ 01 Meet the BRX" [ref=e16] [cursor=pointer]:
          - text: ▸
          - generic [ref=e17]: "01"
          - text: Meet the BRX
      - group [ref=e18]:
        - generic "▸ 02 Operating the BRX" [ref=e19] [cursor=pointer]:
          - text: ▸
          - generic [ref=e20]: "02"
          - text: Operating the BRX
      - group [ref=e21]:
        - generic "▸ 03 Gameplay" [ref=e22] [cursor=pointer]:
          - text: ▸
          - generic [ref=e23]: "03"
          - text: Gameplay
        - list [ref=e24]:
          - listitem [ref=e25]:
            - link "Overview" [ref=e26] [cursor=pointer]:
              - /url: /manual/gameplay/
          - listitem [ref=e27]:
            - link "What the BRX can play" [ref=e28] [cursor=pointer]:
              - /url: /manual/gameplay/overview/
          - listitem [ref=e29]:
            - link "The Callsign arsenal — the complete roster" [ref=e30] [cursor=pointer]:
              - /url: /manual/gameplay/weapons/
          - listitem [ref=e31]:
            - link "Health, armor & damage" [ref=e32] [cursor=pointer]:
              - /url: /manual/gameplay/health/
          - listitem [ref=e33]:
            - link "How a kill actually works" [ref=e34] [cursor=pointer]:
              - /url: /manual/gameplay/how-a-kill-works/
          - listitem [ref=e35]:
            - link "Native game modes & their settings" [ref=e36] [cursor=pointer]:
              - /url: /manual/gameplay/modes/
          - listitem [ref=e37]:
            - link "Classes, factions, perks & killstreaks" [ref=e38] [cursor=pointer]:
              - /url: /manual/gameplay/classes-and-perks/
          - listitem [ref=e39]:
            - link "The Smart Grenade's game modes" [ref=e40] [cursor=pointer]:
              - /url: /manual/gameplay/grenade-modes/
          - listitem [ref=e41]:
            - link "Beyond stock — the Open BRX mode catalog" [ref=e42] [cursor=pointer]:
              - /url: /manual/gameplay/open-brx-modes/
      - group [ref=e43]:
        - generic "▸ 04 Sound, voice & updates" [ref=e44] [cursor=pointer]:
          - text: ▸
          - generic [ref=e45]: "04"
          - text: Sound, voice & updates
      - group [ref=e46]:
        - generic "▸ 05 Fix, mod & accessorise" [ref=e47] [cursor=pointer]:
          - text: ▸
          - generic [ref=e48]: "05"
          - text: Fix, mod & accessorise
      - group [ref=e49]:
        - generic "▸ 06 Developer reference" [ref=e50] [cursor=pointer]:
          - text: ▸
          - generic [ref=e51]: "06"
          - text: Developer reference
    - main [ref=e52]:
      - navigation "Breadcrumb" [ref=e53]:
        - link "Home" [ref=e54] [cursor=pointer]:
          - /url: /
        - generic [ref=e55]: /
        - link "Manual" [ref=e56] [cursor=pointer]:
          - /url: /manual/
        - generic [ref=e57]: /
        - link "Gameplay" [ref=e58] [cursor=pointer]:
          - /url: /manual/gameplay/
        - generic [ref=e59]: /
        - generic [ref=e60]: Beyond stock — the Open BRX mode catalog
      - article [ref=e61]:
        - generic [ref=e62]:
          - heading "Beyond stock — the Open BRX mode catalog" [level=1] [ref=e63]
          - paragraph [ref=e64]: Because the gun keeps no game state, any rule you can write over hits, teams, health and spawns is a mode. A teaser — the full catalog lives in the platform section.
          - paragraph [ref=e65]:
            - generic "Verified on our bench" [ref=e66]:
              - generic [ref=e67]: ✅
              - generic [ref=e68]: bench
            - generic [ref=e69]:
              - text: Last verified
              - time [ref=e70]: 2026-08-27
            - link "View as Markdown" [ref=e71] [cursor=pointer]:
              - /url: /manual/gameplay/open-brx-modes.md
          - group [ref=e72]:
            - generic "? What the badges mean" [ref=e73] [cursor=pointer]
        - generic [ref=e74]:
          - paragraph [ref=e75]:
            - text: "Every mode above is host-side rules over the same four primitives: the hit stream, team ids, the health pools, and respawn. Open BRX runs those rules on a laptop (Mission Control) and on a small node per player, so the same gear plays modes Battle Company never shipped — and modes that need props scale up through cheap tiers. →"
            - emphasis [ref=e76]: Platform section
            - text: for the architecture.
          - paragraph [ref=e77]:
            - text: "Source:"
            - link "docs/game-modes.md" [ref=e78] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/game-modes.md
            - text: ","
            - link "docs/mode-limits.md" [ref=e79] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/mode-limits.md
            - text: ","
            - link "protocol/callsign-extract/protocol-classes.md" [ref=e80] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/callsign-extract/protocol-classes.md
            - text: §What's moddable
        - generic [ref=e81]:
          - heading "Modes by what they need" [level=2] [ref=e82]
          - table [ref=e84]:
            - rowgroup [ref=e85]:
              - row [ref=e86]:
                - columnheader "Tier" [ref=e87]
                - columnheader "What you add" [ref=e88]
                - columnheader "Modes in the catalog" [ref=e89]
            - rowgroup [ref=e90]:
              - row [ref=e91]:
                - cell [ref=e92]:
                  - strong [ref=e93]: Tier 0 — Mission Control alone
                  - text: (taggers + a laptop/phone you own)
                - cell "nothing" [ref=e94]
                - cell [ref=e95]:
                  - text: FFA · Team Death Match · Survival/Infection · The Swarm · Generals · Commander · Supremacy · Last Man Standing ·
                  - strong [ref=e96]: Syphon
                  - text: (health on kill) ·
                  - strong [ref=e97]: Halo-style regenerating health
                  - text: · overshield / medic roles · small-scale
                  - strong [ref=e98]: Extraction
                  - text: · grenade-site
                  - strong [ref=e99]: Counter-Strike
              - row [ref=e100]:
                - cell [ref=e101]:
                  - strong [ref=e102]: Tier 1 — + props
                  - text: (objective stations, flags, QR codes — or the grenade)
                - cell "contested places" [ref=e103]
                - cell [ref=e104]:
                  - text: Domination · King of the Hill / Territory · Capture the Flag (standard, one-sided, centre-flag) · Assault · Team Arena · VIP escort · Hostage rescue · a real
                  - strong [ref=e105]: Extraction point
              - row [ref=e106]:
                - cell [ref=e107]:
                  - strong [ref=e108]: Tier 2 — + broadcast
                  - text: (a live field-wide downlink; location on each node)
                - cell "live global awareness" [ref=e109]
                - cell "Battle Royale · live scoreboards and \"flag taken!\" callouts on a big no-WiFi field · hidden multi-extracts" [ref=e110]
          - paragraph [ref=e111]:
            - text: "Source:"
            - link "docs/game-modes.md" [ref=e112] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/game-modes.md
            - text: §The three infrastructure tiers + §Catalog + §Custom/advanced modes,
            - link "docs/mode-limits.md" [ref=e113] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/mode-limits.md
        - generic [ref=e114]:
          - heading "Three modes stock BRX doesn't ship" [level=2] [ref=e115]
          - list [ref=e117]:
            - listitem [ref=e118]:
              - strong [ref=e119]: Extraction
              - text: — insert, loot, reach an extraction point and
              - emphasis [ref=e120]: channel
              - text: it (30–60 s, and it's loud — everyone converges), survive, bank the loot; die and you drop it all. Playable at $0 with the grenade as the beacon and phones as loot wallets; a rules engine already exists.
              - generic "Verified on our bench" [ref=e121]: ✅
            - listitem [ref=e123]:
              - strong [ref=e124]: Counter-Strike (plant / defuse)
              - text: — the grenade or a phone is the bomb; attackers arm (dwell, IR, or an on-screen code), defenders defuse (IR or a puzzle); round ends on detonate / defuse / elimination.
              - generic "Verified on our bench" [ref=e125]: ✅
            - listitem [ref=e127]:
              - strong [ref=e128]: Syphon & regenerating health
              - text: — the host credits the exact killer (every shot names its shooter) and tops up their pool; or refills anyone who has gone T seconds without damage. Both are pure host rules on top of the "heals add, never set" write.
              - generic "Verified on our bench" [ref=e129]: ✅
          - paragraph [ref=e131]:
            - text: "Source:"
            - link "docs/game-modes.md" [ref=e132] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/game-modes.md
            - text: §Extraction + §Custom/advanced modes + §Health/regen variants,
            - link "mcp/brx_mcp/modes/extraction.py" [ref=e133] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/mcp/brx_mcp/modes/extraction.py
        - note [ref=e135]:
          - strong [ref=e136]: Teams are more flexible than red vs blue.
          - paragraph [ref=e137]: The hardware supports four native teams with on-gun friendly-fire protection and per-team LED colour. For more squads, run everyone as one team with friendly fire on, hand out armbands, and let Mission Control keep the real teams and scores — a technique the owner community proved with clipped ribbon "flags".
          - paragraph [ref=e138]:
            - text: "Source:"
            - link "docs/game-modes.md" [ref=e139] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/game-modes.md
            - text: §Team structure,
            - link "docs/reference/community-notes.md" [ref=e140] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: §Game-mode design ideas
        - note [ref=e142]:
          - strong [ref=e143]: Honest limits.
          - paragraph [ref=e144]: Phones have no IR, so shoot-the-point needs a station or the grenade; one phone can hold only a handful of gun links; a field without WiFi means live global state needs a radio tier. All of it is designed around, not ignored — the constraints ledger is in the platform section.
          - paragraph [ref=e145]:
            - text: "Source:"
            - link "docs/mode-limits.md" [ref=e146] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/mode-limits.md
            - text: §3
        - generic [ref=e147]:
          - figure "The tier ladder — Tier 0 (laptop + taggers) → Tier 1 (+ stations / grenade) → Tier 2 (+ field broadcast), with representative modes stacked on each rung." [ref=e148]:
            - 'img "Three ascending platforms: a laptop with taggers; plus a small station and a grenade; plus a radio mast — with abstract mode badges stacked on each" [ref=e149]':
              - generic [ref=e150]: GAME-14
              - generic [ref=e151]: diagram pending
          - paragraph [ref=e153]:
            - text: "Source:"
            - link "docs/game-modes.md" [ref=e154] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/game-modes.md
  - contentinfo [ref=e155]:
    - paragraph [ref=e156]:
      - text: Protocol discovered by
      - link "LaserTagMods" [ref=e157] [cursor=pointer]:
        - /url: https://github.com/LaserTagMods
      - text: (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community.
    - paragraph [ref=e158]:
      - text: Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company. MIT licence.
      - link "Credits & sourcing" [ref=e159] [cursor=pointer]:
        - /url: /credits/
      - text: ·
      - link "Changelog" [ref=e160] [cursor=pointer]:
        - /url: /changelog/
      - text: ·
      - link "llms.txt" [ref=e161] [cursor=pointer]:
        - /url: /llms.txt
      - text: ·
      - link "GitHub" [ref=e162] [cursor=pointer]:
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
> 73  |     expect(deadRefs, 'dead → cross-references').toEqual([]);
      |                                                 ^ Error: dead → cross-references
  74  |     const slugLinks = await page.evaluate(() => [...document.querySelectorAll('main a.pl')].filter(a => /^\/(manual|platform)/.test(a.textContent.trim())).map(a => a.textContent));
  75  |     expect(slugLinks, 'page links showing raw slugs').toEqual([]);
  76  |     const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  77  |     expect(sw, `horizontal page overflow (${sw} > ${iw})`).toBeLessThanOrEqual(iw + 1);
  78  |     await expect(page.locator('.legend summary')).toBeVisible();
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
```