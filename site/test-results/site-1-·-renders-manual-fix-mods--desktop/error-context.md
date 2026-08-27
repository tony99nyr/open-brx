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
    - link "OPEN BRX" [ref=e4] [cursor=pointer]:
      - /url: /
    - navigation "Primary" [ref=e8]:
      - link "Manual" [ref=e9] [cursor=pointer]:
        - /url: /manual/
      - link "Platform" [ref=e10] [cursor=pointer]:
        - /url: /platform/
      - link "Credits" [ref=e11] [cursor=pointer]:
        - /url: /credits/
      - link "Changelog" [ref=e12] [cursor=pointer]:
        - /url: /changelog/
    - generic [ref=e13]:
      - button "Search the manual" [ref=e14] [cursor=pointer]:
        - generic [ref=e15]: Search
        - generic [ref=e16]: ⌘K
      - button "Toggle light and dark theme" [pressed] [ref=e17] [cursor=pointer]: ◐
      - link "GitHub repository" [ref=e18] [cursor=pointer]:
        - /url: https://github.com/tony99nyr/open-brx
        - text: GitHub
  - generic [ref=e19]:
    - navigation "Manual sections" [ref=e20]:
      - group [ref=e21]:
        - generic "▸ 01 Meet the BRX" [ref=e22] [cursor=pointer]:
          - text: ▸
          - generic [ref=e23]: "01"
          - text: Meet the BRX
      - group [ref=e24]:
        - generic "▸ 02 Operating the BRX" [ref=e25] [cursor=pointer]:
          - text: ▸
          - generic [ref=e26]: "02"
          - text: Operating the BRX
      - group [ref=e27]:
        - generic "▸ 03 Gameplay" [ref=e28] [cursor=pointer]:
          - text: ▸
          - generic [ref=e29]: "03"
          - text: Gameplay
      - group [ref=e30]:
        - generic "▸ 04 Sound, voice & updates" [ref=e31] [cursor=pointer]:
          - text: ▸
          - generic [ref=e32]: "04"
          - text: Sound, voice & updates
      - group [ref=e33]:
        - generic "▸ 05 Fix, mod & accessorise" [ref=e34] [cursor=pointer]:
          - text: ▸
          - generic [ref=e35]: "05"
          - text: Fix, mod & accessorise
        - list [ref=e36]:
          - listitem [ref=e37]:
            - link "Overview" [ref=e38] [cursor=pointer]:
              - /url: /manual/fix/
          - listitem [ref=e39]:
            - link "Diagnose my tagger" [ref=e40] [cursor=pointer]:
              - /url: /manual/fix/diagnose/
          - listitem [ref=e41]:
            - link "Headset, pairing & Bluetooth" [ref=e42] [cursor=pointer]:
              - /url: /manual/fix/pairing/
          - listitem [ref=e43]:
            - link "Hits, sound & battery" [ref=e44] [cursor=pointer]:
              - /url: /manual/fix/hits-sound-battery/
          - listitem [ref=e45]:
            - link "Repairs" [ref=e46] [cursor=pointer]:
              - /url: /manual/fix/repairs/
          - listitem [ref=e47]:
            - link "Mods" [ref=e48] [cursor=pointer]:
              - /url: /manual/fix/mods/
          - listitem [ref=e49]:
            - link "Accessories" [ref=e50] [cursor=pointer]:
              - /url: /manual/fix/accessories/
          - listitem [ref=e51]:
            - link "The community" [ref=e52] [cursor=pointer]:
              - /url: /manual/fix/community/
          - listitem [ref=e53]:
            - link "FAQ" [ref=e54] [cursor=pointer]:
              - /url: /manual/fix/faq/
      - group [ref=e55]:
        - generic "▸ 06 Developer reference" [ref=e56] [cursor=pointer]:
          - text: ▸
          - generic [ref=e57]: "06"
          - text: Developer reference
    - main [ref=e58]:
      - navigation "Breadcrumb" [ref=e59]:
        - link "Home" [ref=e60] [cursor=pointer]:
          - /url: /
        - generic [ref=e61]: /
        - link "Manual" [ref=e62] [cursor=pointer]:
          - /url: /manual/
        - generic [ref=e63]: /
        - link "Fix, mod & accessorise" [ref=e64] [cursor=pointer]:
          - /url: /manual/fix/
        - generic [ref=e65]: /
        - generic [ref=e66]: Mods
      - article [ref=e67]:
        - generic [ref=e68]:
          - heading "Mods" [level=1] [ref=e69]
          - paragraph [ref=e70]: The community norm is "no permanent modification" — everything rides on the phone bracket or clips to the rail.
          - paragraph [ref=e71]:
            - generic "Community-reported" [ref=e72]:
              - generic [ref=e73]: 👥
              - generic [ref=e74]: community
            - generic "Official Battle Company docs" [ref=e75]:
              - generic [ref=e76]: 📖
              - generic [ref=e77]: official
            - generic [ref=e78]:
              - text: Last verified
              - time [ref=e79]: 2026-08-27
            - link "View as Markdown" [ref=e80] [cursor=pointer]:
              - /url: /manual/fix/mods.md
          - group [ref=e81]:
            - generic "? What the badges mean" [ref=e82] [cursor=pointer]
        - generic [ref=e83]:
          - paragraph
          - paragraph [ref=e84]:
            - strong [ref=e85]: Bolt on, never cut.
            - text: From a reload button to a full ESP32 field host, the proven BRX mods leave the tagger stock and reversible — which is also how the Open BRX Companion is designed.
            - generic "Community-reported" [ref=e86]: 👥
          - paragraph [ref=e88]:
            - text: "Source:"
            - link "docs/reference/community-notes.md" [ref=e89] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: ("Modding landscape") ·
            - link "hardware/brx-companion-spec.md" [ref=e90] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/hardware/brx-companion-spec.md
        - generic [ref=e91]:
          - heading "Mods owners actually run" [level=2] [ref=e92]
          - list [ref=e94]:
            - listitem [ref=e95]:
              - strong [ref=e96]: Reload-button mod (the most established BRX print).
              - text: Replaces the pull-back reload handle with a push button — easier to store and transport a fleet. A YouTube tutorial exists ("Battle Company BRX Laser Tag Gun Reload Button Modification") and an STL circulates privately in the owners' group.
              - generic "Community-reported" [ref=e97]: 👥
            - listitem [ref=e99]:
              - strong [ref=e100]: JEDGE tagger rider (LaserTagMods).
              - text: An ESP32 that Bluetooth-bridges each tagger for phone-free, host-coordinated multiplayer — scoring, respawn, team/perk/weapon assignment — over ESP-NOW or LoRa, configured from a WiFi web page. Rides on the phone bracket with a USB power bank (a 5000 mAh pack runs ~15 h, about two gun-battery cycles); no permanent mod, no drain on the gun. A field host has run
              - strong [ref=e101]: 45 rifles at once
              - text: . Credit LaserTagMods (JEDGE/JBOX).
              - generic "Community-reported" [ref=e102]: 👥
            - listitem [ref=e104]:
              - strong [ref=e105]: JBOX / JCUBE / JBOX Mini / JTOWER / JHALO (Jay, Extreme Laser Tag And More!).
              - text: "ESP32 objective stations: domination, CTF, respawn, medic, sentry, supply/upgrade, tug-of-war, battle-royale checkpoints. JHALO turns a"
              - strong [ref=e106]: spare BRX headset
              - text: into a respawn box. Each is its own WiFi hotspot (
              - code [ref=e107]: 192.168.4.1
              - text: ", ~45 s window after boot to reach the menu), firmware flashed over that page. →"
              - 'link "Accessories: stations" [ref=e108] [cursor=pointer]':
                - /url: /manual/fix/accessories/
              - text: .
              - generic "Community-reported" [ref=e109]: 👥
            - listitem [ref=e111]:
              - strong [ref=e112]: SwapTX headset mod.
              - text: A ~$50 replacement headset (single 18650) that unlocks STX-style on-tagger hosting and JEDGE controls — but it has
              - strong [ref=e113]: no IR emitters
              - text: ", so splash damage, shotguns, pass-through, medics, many Supremacy/Deathmatch perks and base/commander respawn requests are lost. Non-final beta; Battle Company declined to productise it."
              - generic "Community-reported" [ref=e114]: 👥
            - listitem [ref=e116]:
              - strong [ref=e117]: Custom sound packs.
              - text: The tagger's audio is swappable over the programming port (SELECT-at-boot →
              - code [ref=e118]: AUDIO
              - text: folder → replace
              - code [ref=e119]: <ID>.LTP
              - text: ). Star Wars overlay packs exist. Keep the originals. →
              - emphasis [ref=e120]: Sound
              - text: section.
              - generic "Official Battle Company docs" [ref=e121]: 📖
              - generic "Community-reported" [ref=e123]: 👥
            - listitem [ref=e125]:
              - strong [ref=e126]: Headset LED mods.
              - text: The addressable RGB LEDs are standard WS2812B (5050), wired in series on the BRX headset — one data line, NeoPixel-compatible.
              - generic "Community-reported" [ref=e127]: 👥
            - listitem [ref=e129]:
              - strong [ref=e130]: Phone bracket / mount.
              - text: Battle Company sells the BRX phone bracket; it doubles as the mount for rider boards and power banks.
              - generic "Official Battle Company docs" [ref=e131]: 📖
              - generic "Community-reported" [ref=e133]: 👥
            - listitem [ref=e135]:
              - strong [ref=e136]: Scope.
              - text: Sight it in target mode (LEFT-at-boot); indoors ~20 ft, outdoors ~300 ft, snipers 300–400 ft.
              - generic "Official Battle Company docs" [ref=e137]: 📖
              - generic "Community-reported" [ref=e139]: 👥
            - listitem [ref=e141]:
              - strong [ref=e142]: Cosmetics.
              - text: "3D-printed skins (private files, SwapTX-style). Painting: clean, scuff,"
              - strong [ref=e143]: black Krylon primer
              - text: ", thin colour coats, clear. Stickers/paint to keep gun–headset pairs matched at events."
              - generic "Community-reported" [ref=e144]: 👥
          - paragraph [ref=e146]:
            - text: "Source:"
            - link "hardware/print-files.md" [ref=e147] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/hardware/print-files.md
            - text: ·
            - link "docs/reference/lasertagmods.md" [ref=e148] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/lasertagmods.md
            - text: ·
            - link "docs/reference/jay-ecosystem.md" [ref=e149] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/jay-ecosystem.md
            - text: ·
            - link "docs/reference/community-notes.md" [ref=e150] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: ·
            - link "hardware/brx-companion-spec.md" [ref=e151] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/hardware/brx-companion-spec.md
            - text: ·
            - link "docs/reference/brx-extended-user-guide.md" [ref=e152] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-extended-user-guide.md
        - note [ref=e154]:
          - strong [ref=e155]: Hard-won electrical cautions for any ESP32 rider (credit Jay / the owners' group)
          - list [ref=e156]:
            - listitem [ref=e157]:
              - text: Feed the BRX serial side
              - strong [ref=e158]: 3.0–3.4 V logic (~3.06 V sweet spot)
              - text: — 5 V produces corrupt characters; even 0.3 V off on the BT-module pins breaks reception.
            - listitem [ref=e159]:
              - text: Insert
              - strong [ref=e160]: ~5 ms between characters
              - text: or the tagger garbles/drops them.
            - listitem [ref=e161]:
              - text: A
              - strong [ref=e162]: diode
              - text: is required between the ESP32 TX pin and the board RX / BT-module tab.
            - listitem [ref=e163]:
              - text: Draw
              - strong [ref=e164]: < 300 mA
              - text: if powering from the tagger (Battle Company-confirmed); a separate power bank is the norm.
            - listitem [ref=e165]: Cheap ESP32 D1-mini boards are failure-prone (undersized regulator) — power via USB or add a large capacitor.
            - listitem [ref=e166]:
              - strong [ref=e167]: Use exactly the units in the maintained build docs.
              - text: Substituted hardware is what sits behind the "JEDGE 6 doesn't work, LoRa doesn't work" threads. Play
              - strong [ref=e168]: outdoors
              - text: — ESP32 radio range is flaky indoors around solid cover.
          - paragraph [ref=e169]:
            - text: "Source:"
            - link "docs/reference/community-notes.md" [ref=e170] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: ("Hardware / power", "Modding landscape", "JEDGE mesh internals")
        - generic [ref=e171]:
          - heading "3D-printed parts — what exists (there is no public BRX print library)" [level=2] [ref=e172]
          - table [ref=e174]:
            - rowgroup [ref=e175]:
              - row [ref=e176]:
                - columnheader "Part" [ref=e177]
                - columnheader "Status" [ref=e178]
                - columnheader "Where" [ref=e179]
            - rowgroup [ref=e180]:
              - row [ref=e181]:
                - cell "Reload-button handle" [ref=e182]
                - cell "Exists, shared privately" [ref=e183]
                - cell "Owners' group" [ref=e184]
              - row [ref=e185]:
                - cell "JEDGE rider mount / clip-on cover" [ref=e186]
                - cell "Exists, part of the JEDGE build docs" [ref=e187]
                - cell "LaserTagMods / owners' group" [ref=e188]
              - row [ref=e189]:
                - cell "Skins / covers (incl. sniper body)" [ref=e190]
                - cell "Private SwapTX work; wanted" [ref=e191]
                - cell "Owners' group" [ref=e192]
              - row [ref=e193]:
                - cell "D-pad replacement buttons" [ref=e194]
                - cell [ref=e195]:
                  - strong [ref=e196]: Wanted, no STL
                - cell "Open contribution" [ref=e197]
              - row [ref=e198]:
                - cell "JBOX enclosures (Box V5 / Disk / Mini)" [ref=e199]
                - cell "Published with the JBOX repo — for the accessory, not the tagger; unlicensed" [ref=e200]
                - cell "LaserTagMods GitHub" [ref=e201]
              - row [ref=e202]:
                - cell [ref=e203]:
                  - text: Open BRX
                  - code [ref=e204]: hardware/
                - 'cell "Planned MIT library: reload button, D-pad, Companion mount, station enclosures, skins — version-tagged" [ref=e205]'
                - cell "this project" [ref=e206]
          - paragraph [ref=e207]:
            - text: "Source:"
            - link "hardware/print-files.md" [ref=e208] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/hardware/print-files.md
        - figure "The tagger's phone bracket carrying a USB power bank and a small ESP32 board, cable to the tagger's port" [ref=e210]:
          - img "The tagger's phone bracket carrying a USB power bank and a small ESP32 board, cable to the tagger's port" [ref=e211]:
            - generic [ref=e212]: FIX-08
            - generic [ref=e213]: photo pending
    - complementary "On this page" [ref=e215]:
      - generic [ref=e216]:
        - paragraph [ref=e217]: On this page
        - list [ref=e218]:
          - listitem [ref=e219]:
            - link "Mods owners actually run" [ref=e220] [cursor=pointer]:
              - /url: "#mods-owners-actually-run"
          - listitem [ref=e221]:
            - link "Hard-won electrical cautions for any ESP32 rider (credit Jay / the owners' group)" [ref=e222] [cursor=pointer]:
              - /url: "#hard-won-electrical-cautions-for-any-esp32-rider-credit-jay-"
          - listitem [ref=e223]:
            - link "3D-printed parts — what exists (there is no public BRX print library)" [ref=e224] [cursor=pointer]:
              - /url: "#3d-printed-parts-what-exists-there-is-no-public-brx-print-li"
  - contentinfo [ref=e225]:
    - paragraph [ref=e226]:
      - text: Protocol discovered by
      - link "LaserTagMods" [ref=e227] [cursor=pointer]:
        - /url: https://github.com/LaserTagMods
      - text: (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community.
    - paragraph [ref=e228]:
      - text: Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company. MIT licence.
      - link "Credits & sourcing" [ref=e229] [cursor=pointer]:
        - /url: /credits/
      - text: ·
      - link "Changelog" [ref=e230] [cursor=pointer]:
        - /url: /changelog/
      - text: ·
      - link "llms.txt" [ref=e231] [cursor=pointer]:
        - /url: /llms.txt
      - text: ·
      - link "GitHub" [ref=e232] [cursor=pointer]:
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