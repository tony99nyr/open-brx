# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: site.spec.mjs >> 1 · renders /manual/fix/mods/
- Location: test/site.spec.mjs:15:74

# Error details

```
Error: dead → cross-references

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "Sound",
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
      - group [ref=e24]:
        - generic "▸ 04 Sound, voice & updates" [ref=e25] [cursor=pointer]:
          - text: ▸
          - generic [ref=e26]: "04"
          - text: Sound, voice & updates
      - group [ref=e27]:
        - generic "▸ 05 Fix, mod & accessorise" [ref=e28] [cursor=pointer]:
          - text: ▸
          - generic [ref=e29]: "05"
          - text: Fix, mod & accessorise
        - list [ref=e30]:
          - listitem [ref=e31]:
            - link "Overview" [ref=e32] [cursor=pointer]:
              - /url: /manual/fix/
          - listitem [ref=e33]:
            - link "Diagnose my tagger" [ref=e34] [cursor=pointer]:
              - /url: /manual/fix/diagnose/
          - listitem [ref=e35]:
            - link "Headset, pairing & Bluetooth" [ref=e36] [cursor=pointer]:
              - /url: /manual/fix/pairing/
          - listitem [ref=e37]:
            - link "Hits, sound & battery" [ref=e38] [cursor=pointer]:
              - /url: /manual/fix/hits-sound-battery/
          - listitem [ref=e39]:
            - link "Repairs" [ref=e40] [cursor=pointer]:
              - /url: /manual/fix/repairs/
          - listitem [ref=e41]:
            - link "Mods" [ref=e42] [cursor=pointer]:
              - /url: /manual/fix/mods/
          - listitem [ref=e43]:
            - link "Accessories" [ref=e44] [cursor=pointer]:
              - /url: /manual/fix/accessories/
          - listitem [ref=e45]:
            - link "The community" [ref=e46] [cursor=pointer]:
              - /url: /manual/fix/community/
          - listitem [ref=e47]:
            - link "FAQ" [ref=e48] [cursor=pointer]:
              - /url: /manual/fix/faq/
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
        - link "Fix, mod & accessorise" [ref=e58] [cursor=pointer]:
          - /url: /manual/fix/
        - generic [ref=e59]: /
        - generic [ref=e60]: Mods
      - article [ref=e61]:
        - generic [ref=e62]:
          - heading "Mods" [level=1] [ref=e63]
          - paragraph [ref=e64]: The community norm is "no permanent modification" — everything rides on the phone bracket or clips to the rail.
          - paragraph [ref=e65]:
            - generic "Community-reported" [ref=e66]:
              - generic [ref=e67]: 👥
              - generic [ref=e68]: community
            - generic "Official Battle Company docs" [ref=e69]:
              - generic [ref=e70]: 📖
              - generic [ref=e71]: official
            - generic [ref=e72]:
              - text: Last verified
              - time [ref=e73]: 2026-08-27
            - link "View as Markdown" [ref=e74] [cursor=pointer]:
              - /url: /manual/fix/mods.md
          - group [ref=e75]:
            - generic "? What the badges mean" [ref=e76] [cursor=pointer]
        - generic [ref=e77]:
          - paragraph
          - paragraph [ref=e78]:
            - strong [ref=e79]: Bolt on, never cut.
            - text: From a reload button to a full ESP32 field host, the proven BRX mods leave the tagger stock and reversible — which is also how the Open BRX Companion is designed.
            - generic "Community-reported" [ref=e80]: 👥
          - paragraph [ref=e82]:
            - text: "Source:"
            - link "docs/reference/community-notes.md" [ref=e83] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: ("Modding landscape") ·
            - link "hardware/brx-companion-spec.md" [ref=e84] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/hardware/brx-companion-spec.md
        - generic [ref=e85]:
          - heading "Mods owners actually run" [level=2] [ref=e86]
          - list [ref=e88]:
            - listitem [ref=e89]:
              - strong [ref=e90]: Reload-button mod (the most established BRX print).
              - text: Replaces the pull-back reload handle with a push button — easier to store and transport a fleet. A YouTube tutorial exists ("Battle Company BRX Laser Tag Gun Reload Button Modification") and an STL circulates privately in the owners' group.
              - generic "Community-reported" [ref=e91]: 👥
            - listitem [ref=e93]:
              - strong [ref=e94]: JEDGE tagger rider (LaserTagMods).
              - text: An ESP32 that Bluetooth-bridges each tagger for phone-free, host-coordinated multiplayer — scoring, respawn, team/perk/weapon assignment — over ESP-NOW or LoRa, configured from a WiFi web page. Rides on the phone bracket with a USB power bank (a 5000 mAh pack runs ~15 h, about two gun-battery cycles); no permanent mod, no drain on the gun. A field host has run
              - strong [ref=e95]: 45 rifles at once
              - text: . Credit LaserTagMods (JEDGE/JBOX).
              - generic "Community-reported" [ref=e96]: 👥
            - listitem [ref=e98]:
              - strong [ref=e99]: JBOX / JCUBE / JBOX Mini / JTOWER / JHALO (Jay, Extreme Laser Tag And More!).
              - text: "ESP32 objective stations: domination, CTF, respawn, medic, sentry, supply/upgrade, tug-of-war, battle-royale checkpoints. JHALO turns a"
              - strong [ref=e100]: spare BRX headset
              - text: into a respawn box. Each is its own WiFi hotspot (
              - code [ref=e101]: 192.168.4.1
              - text: ", ~45 s window after boot to reach the menu), firmware flashed over that page. →"
              - 'link "Accessories: stations" [ref=e102] [cursor=pointer]':
                - /url: /manual/fix/accessories/
              - text: .
              - generic "Community-reported" [ref=e103]: 👥
            - listitem [ref=e105]:
              - strong [ref=e106]: SwapTX headset mod.
              - text: A ~$50 replacement headset (single 18650) that unlocks STX-style on-tagger hosting and JEDGE controls — but it has
              - strong [ref=e107]: no IR emitters
              - text: ", so splash damage, shotguns, pass-through, medics, many Supremacy/Deathmatch perks and base/commander respawn requests are lost. Non-final beta; Battle Company declined to productise it."
              - generic "Community-reported" [ref=e108]: 👥
            - listitem [ref=e110]:
              - strong [ref=e111]: Custom sound packs.
              - text: The tagger's audio is swappable over the programming port (SELECT-at-boot →
              - code [ref=e112]: AUDIO
              - text: folder → replace
              - code [ref=e113]: <ID>.LTP
              - text: ). Star Wars overlay packs exist. Keep the originals. →
              - emphasis [ref=e114]: Sound
              - text: section.
              - generic "Official Battle Company docs" [ref=e115]: 📖
              - generic "Community-reported" [ref=e117]: 👥
            - listitem [ref=e119]:
              - strong [ref=e120]: Headset LED mods.
              - text: The addressable RGB LEDs are standard WS2812B (5050), wired in series on the BRX headset — one data line, NeoPixel-compatible.
              - generic "Community-reported" [ref=e121]: 👥
            - listitem [ref=e123]:
              - strong [ref=e124]: Phone bracket / mount.
              - text: Battle Company sells the BRX phone bracket; it doubles as the mount for rider boards and power banks.
              - generic "Official Battle Company docs" [ref=e125]: 📖
              - generic "Community-reported" [ref=e127]: 👥
            - listitem [ref=e129]:
              - strong [ref=e130]: Scope.
              - text: Sight it in target mode (LEFT-at-boot); indoors ~20 ft, outdoors ~300 ft, snipers 300–400 ft.
              - generic "Official Battle Company docs" [ref=e131]: 📖
              - generic "Community-reported" [ref=e133]: 👥
            - listitem [ref=e135]:
              - strong [ref=e136]: Cosmetics.
              - text: "3D-printed skins (private files, SwapTX-style). Painting: clean, scuff,"
              - strong [ref=e137]: black Krylon primer
              - text: ", thin colour coats, clear. Stickers/paint to keep gun–headset pairs matched at events."
              - generic "Community-reported" [ref=e138]: 👥
          - paragraph [ref=e140]:
            - text: "Source:"
            - link "hardware/print-files.md" [ref=e141] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/hardware/print-files.md
            - text: ·
            - link "docs/reference/lasertagmods.md" [ref=e142] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/lasertagmods.md
            - text: ·
            - link "docs/reference/jay-ecosystem.md" [ref=e143] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/jay-ecosystem.md
            - text: ·
            - link "docs/reference/community-notes.md" [ref=e144] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: ·
            - link "hardware/brx-companion-spec.md" [ref=e145] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/hardware/brx-companion-spec.md
            - text: ·
            - link "docs/reference/brx-extended-user-guide.md" [ref=e146] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-extended-user-guide.md
        - note [ref=e148]:
          - strong [ref=e149]: Hard-won electrical cautions for any ESP32 rider (credit Jay / the owners' group)
          - list [ref=e150]:
            - listitem [ref=e151]:
              - text: Feed the BRX serial side
              - strong [ref=e152]: 3.0–3.4 V logic (~3.06 V sweet spot)
              - text: — 5 V produces corrupt characters; even 0.3 V off on the BT-module pins breaks reception.
            - listitem [ref=e153]:
              - text: Insert
              - strong [ref=e154]: ~5 ms between characters
              - text: or the tagger garbles/drops them.
            - listitem [ref=e155]:
              - text: A
              - strong [ref=e156]: diode
              - text: is required between the ESP32 TX pin and the board RX / BT-module tab.
            - listitem [ref=e157]:
              - text: Draw
              - strong [ref=e158]: < 300 mA
              - text: if powering from the tagger (Battle Company-confirmed); a separate power bank is the norm.
            - listitem [ref=e159]: Cheap ESP32 D1-mini boards are failure-prone (undersized regulator) — power via USB or add a large capacitor.
            - listitem [ref=e160]:
              - strong [ref=e161]: Use exactly the units in the maintained build docs.
              - text: Substituted hardware is what sits behind the "JEDGE 6 doesn't work, LoRa doesn't work" threads. Play
              - strong [ref=e162]: outdoors
              - text: — ESP32 radio range is flaky indoors around solid cover.
          - paragraph [ref=e163]:
            - text: "Source:"
            - link "docs/reference/community-notes.md" [ref=e164] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: ("Hardware / power", "Modding landscape", "JEDGE mesh internals")
        - generic [ref=e165]:
          - heading "3D-printed parts — what exists (there is no public BRX print library)" [level=2] [ref=e166]
          - table [ref=e168]:
            - rowgroup [ref=e169]:
              - row [ref=e170]:
                - columnheader "Part" [ref=e171]
                - columnheader "Status" [ref=e172]
                - columnheader "Where" [ref=e173]
            - rowgroup [ref=e174]:
              - row [ref=e175]:
                - cell "Reload-button handle" [ref=e176]
                - cell "Exists, shared privately" [ref=e177]
                - cell "Owners' group" [ref=e178]
              - row [ref=e179]:
                - cell "JEDGE rider mount / clip-on cover" [ref=e180]
                - cell "Exists, part of the JEDGE build docs" [ref=e181]
                - cell "LaserTagMods / owners' group" [ref=e182]
              - row [ref=e183]:
                - cell "Skins / covers (incl. sniper body)" [ref=e184]
                - cell "Private SwapTX work; wanted" [ref=e185]
                - cell "Owners' group" [ref=e186]
              - row [ref=e187]:
                - cell "D-pad replacement buttons" [ref=e188]
                - cell [ref=e189]:
                  - strong [ref=e190]: Wanted, no STL
                - cell "Open contribution" [ref=e191]
              - row [ref=e192]:
                - cell "JBOX enclosures (Box V5 / Disk / Mini)" [ref=e193]
                - cell "Published with the JBOX repo — for the accessory, not the tagger; unlicensed" [ref=e194]
                - cell "LaserTagMods GitHub" [ref=e195]
              - row [ref=e196]:
                - cell [ref=e197]:
                  - text: Open BRX
                  - code [ref=e198]: hardware/
                - 'cell "Planned MIT library: reload button, D-pad, Companion mount, station enclosures, skins — version-tagged" [ref=e199]'
                - cell "this project" [ref=e200]
          - paragraph [ref=e201]:
            - text: "Source:"
            - link "hardware/print-files.md" [ref=e202] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/hardware/print-files.md
        - figure "The tagger's phone bracket carrying a USB power bank and a small ESP32 board, cable to the tagger's port" [ref=e204]:
          - img "The tagger's phone bracket carrying a USB power bank and a small ESP32 board, cable to the tagger's port" [ref=e205]:
            - generic [ref=e206]: FIX-08
            - generic [ref=e207]: photo pending
  - contentinfo [ref=e209]:
    - paragraph [ref=e210]:
      - text: Protocol discovered by
      - link "LaserTagMods" [ref=e211] [cursor=pointer]:
        - /url: https://github.com/LaserTagMods
      - text: (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community.
    - paragraph [ref=e212]:
      - text: Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company. MIT licence.
      - link "Credits & sourcing" [ref=e213] [cursor=pointer]:
        - /url: /credits/
      - text: ·
      - link "Changelog" [ref=e214] [cursor=pointer]:
        - /url: /changelog/
      - text: ·
      - link "llms.txt" [ref=e215] [cursor=pointer]:
        - /url: /llms.txt
      - text: ·
      - link "GitHub" [ref=e216] [cursor=pointer]:
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