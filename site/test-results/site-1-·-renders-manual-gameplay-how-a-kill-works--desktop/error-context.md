# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: site.spec.mjs >> 1 · renders /manual/gameplay/how-a-kill-works/
- Location: test/site.spec.mjs:15:74

# Error details

```
Error: dead → cross-references

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "Developer / IR protocol",
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
        - list [ref=e30]:
          - listitem [ref=e31]:
            - link "Overview" [ref=e32] [cursor=pointer]:
              - /url: /manual/gameplay/
          - listitem [ref=e33]:
            - link "What the BRX can play" [ref=e34] [cursor=pointer]:
              - /url: /manual/gameplay/overview/
          - listitem [ref=e35]:
            - link "The Callsign arsenal — the complete roster" [ref=e36] [cursor=pointer]:
              - /url: /manual/gameplay/weapons/
          - listitem [ref=e37]:
            - link "Health, armor & damage" [ref=e38] [cursor=pointer]:
              - /url: /manual/gameplay/health/
          - listitem [ref=e39]:
            - link "How a kill actually works" [ref=e40] [cursor=pointer]:
              - /url: /manual/gameplay/how-a-kill-works/
          - listitem [ref=e41]:
            - link "Native game modes & their settings" [ref=e42] [cursor=pointer]:
              - /url: /manual/gameplay/modes/
          - listitem [ref=e43]:
            - link "Classes, factions, perks & killstreaks" [ref=e44] [cursor=pointer]:
              - /url: /manual/gameplay/classes-and-perks/
          - listitem [ref=e45]:
            - link "The Smart Grenade's game modes" [ref=e46] [cursor=pointer]:
              - /url: /manual/gameplay/grenade-modes/
          - listitem [ref=e47]:
            - link "Beyond stock — the Open BRX mode catalog" [ref=e48] [cursor=pointer]:
              - /url: /manual/gameplay/open-brx-modes/
      - group [ref=e49]:
        - generic "▸ 04 Sound, voice & updates" [ref=e50] [cursor=pointer]:
          - text: ▸
          - generic [ref=e51]: "04"
          - text: Sound, voice & updates
      - group [ref=e52]:
        - generic "▸ 05 Fix, mod & accessorise" [ref=e53] [cursor=pointer]:
          - text: ▸
          - generic [ref=e54]: "05"
          - text: Fix, mod & accessorise
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
        - link "Gameplay" [ref=e64] [cursor=pointer]:
          - /url: /manual/gameplay/
        - generic [ref=e65]: /
        - generic [ref=e66]: How a kill actually works
      - article [ref=e67]:
        - generic [ref=e68]:
          - heading "How a kill actually works" [level=1] [ref=e69]
          - paragraph [ref=e70]: From trigger pull to green flash, in five steps — the developer section has the bit layout
          - paragraph [ref=e71]:
            - generic [ref=e72]:
              - text: Last verified
              - time [ref=e73]: 2026-08-27
            - link "View as Markdown" [ref=e74] [cursor=pointer]:
              - /url: /manual/gameplay/how-a-kill-works.md
          - group [ref=e75]:
            - generic "? What the badges mean" [ref=e76] [cursor=pointer]
        - generic [ref=e77]:
          - paragraph [ref=e78]:
            - text: A BRX "bullet" is a burst of infrared light 25 bits long, sent on a 38 kHz carrier. It carries
            - strong [ref=e79]: who fired (player id), which team, how much damage, and what kind of damage
            - text: . Your victim's headset or gun catches it, looks it up, subtracts the damage — and if that was the last of their health, the shooter's sight flashes green.
          - paragraph [ref=e80]:
            - text: "Source:"
            - link "protocol/brx-ir-protocol.md" [ref=e81] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-ir-protocol.md
            - text: ","
            - link "protocol/brx-protocol.md" [ref=e82] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: §7o + §7r
        - generic [ref=e83]:
          - 'figure "The kill pipeline: gun → 25-bit IR word → three receivers on the victim → pool subtraction → death → kill-confirm flash back on the shooter." [ref=e84]':
            - 'img "The kill pipeline: tagger emitting a coded burst of light → a headset with front and back domes plus a gun-body sensor → a pool bar dropping → a green sight flash on the shooter" [ref=e85]':
              - generic [ref=e86]: GAME-10
              - generic [ref=e87]: diagram pending
          - paragraph [ref=e89]:
            - text: "Source:"
            - link "protocol/brx-ir-protocol.md" [ref=e90] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-ir-protocol.md
            - text: ","
            - link "protocol/brx-protocol.md" [ref=e91] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: §7r
        - generic [ref=e92]:
          - heading "The five steps" [level=2] [ref=e93]
          - list [ref=e95]:
            - listitem [ref=e96]:
              - strong [ref=e97]: Fire.
              - text: "The trigger pull emits the IR word: a 2 ms start pulse, then 25 bits (long pulse = 1, short = 0). Damage type (4 bits) · player id (6 bits, 0–63) · team (2 bits, 4 teams) · damage (8 bits, up to 255) · crit flag · effect subtype · 2 check bits."
            - listitem [ref=e98]:
              - strong [ref=e99]: Catch.
              - text: "The target has three receivers: the headset's"
              - strong [ref=e100]: front dome
              - text: ", the headset's"
              - strong [ref=e101]: back dome
              - text: ", and a sensor on the"
              - strong [ref=e102]: gun body
              - text: . Whichever catches the word reports it — at field distance that tells you where you were hit from; at point-blank range IR floods every sensor and the first to see it wins.
            - listitem [ref=e103]:
              - strong [ref=e104]: Resolve.
              - text: "The victim's gun checks the team bits first (same team + friendly fire off = ignored), then looks up the damage type in its effect table and applies the magnitude: armor first, then health."
            - listitem [ref=e105]:
              - strong [ref=e106]: Feedback.
              - text: The victim's headset lights green (a blink on a hit, a hold on a kill) and plays the pain/death sound; the gun reports the hit and new health to any connected phone. Melee, explosive and other damage types each get their own hit sound.
            - listitem [ref=e107]:
              - strong [ref=e108]: Confirm.
              - text: On a kill the
              - emphasis [ref=e109]: shooter's
              - text: sight flashes green (the kill-confirm flash) and the announcer says "kill". In a phoneless gun-menu game the guns work this out between themselves over their short-range radio; in an app-hosted game the phone scores the kill and drives the same flash and voice line.
          - paragraph [ref=e110]:
            - text: "Source:"
            - link "protocol/brx-ir-protocol.md" [ref=e111] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-ir-protocol.md
            - text: §Frame + §Field layout,
            - link "protocol/brx-protocol.md" [ref=e112] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: §7r (sensor map, FF),
            - link "docs/sound-architecture.md" [ref=e113] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/sound-architecture.md
            - text: §Native multikills,
            - link "docs/experiment-log.md" [ref=e114] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/experiment-log.md
            - text: ("headset LED map" 2026-08-27 entries),
            - link "protocol/callsign-extract/protocol-classes.md" [ref=e115] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/callsign-extract/protocol-classes.md
            - text: §FSET
        - note [ref=e117]:
          - strong [ref=e118]: Why misses still make noise.
          - paragraph [ref=e119]: "The manual's \"simulated recoil\" accuracy model means a rapid-fire miss still reaches the enemy: their headset lights and they hear a zip, but 0 damage is applied. If someone's headset is flashing and they are not dying, you are missing — fire in bursts."
          - paragraph [ref=e120]:
            - text: "Source:"
            - link "docs/reference/brx-extended-user-guide.md" [ref=e121] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-extended-user-guide.md
            - text: §Weapons
        - generic [ref=e122]:
          - heading "Feedback you will see and hear" [level=2] [ref=e123]
          - table [ref=e125]:
            - rowgroup [ref=e126]:
              - row [ref=e127]:
                - columnheader "Event" [ref=e128]
                - columnheader "Victim" [ref=e129]
                - columnheader "Shooter" [ref=e130]
            - rowgroup [ref=e131]:
              - row [ref=e132]:
                - cell "Hit (non-lethal)" [ref=e133]
                - cell "headset green blink · hit tone (HP / armor / shield / crit each have their own) · gun LEDs" [ref=e134]
                - cell "nothing (no radio path for a plain hit)" [ref=e135]
              - row [ref=e136]:
                - cell "Kill" [ref=e137]
                - cell "headset green hold · death alarm · gun stops firing" [ref=e138]
                - cell [ref=e139]:
                  - strong [ref=e140]: green sight flash
                  - text: + "kill" callout; in gun-menu games also "double kill" etc. streak lines
              - row [ref=e141]:
                - cell "Same team, FF off" [ref=e142]
                - cell "nothing — the gun drops the shot" [ref=e143]
                - cell "nothing" [ref=e144]
              - row [ref=e145]:
                - cell "Miss (accuracy roll)" [ref=e146]
                - cell "headset lights + zip, 0 damage" [ref=e147]
                - cell "—" [ref=e148]
          - paragraph [ref=e149]:
            - text: "Source:"
            - link "protocol/brx-protocol.md" [ref=e150] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: §7o,
            - link "docs/sound-architecture.md" [ref=e151] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/sound-architecture.md
            - text: ","
            - link "docs/experiment-log.md" [ref=e152] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/experiment-log.md
            - text: (LED map entries 2026-08-27),
            - link "docs/reference/brx-extended-user-guide.md" [ref=e153] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-extended-user-guide.md
        - note [ref=e155]:
          - strong [ref=e156]: Every shot names its shooter.
          - paragraph [ref=e157]:
            - text: The 6-bit player id in the word is why a host can credit the
            - emphasis [ref=e158]: exact
            - text: "killer, run free-for-all scoring, and build health-on-kill — all from what the victim's gun reports. Stock BRX uses it too: that is how the kill-confirm and streak callouts find the right gun. Full bit layout, timings and the effect-table mechanism: →"
            - emphasis [ref=e159]: Developer / IR protocol
            - text: .
          - paragraph [ref=e160]:
            - text: "Source:"
            - link "protocol/brx-ir-protocol.md" [ref=e161] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-ir-protocol.md
            - text: §Why this matters,
            - link "docs/game-modes.md" [ref=e162] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/game-modes.md
            - text: (P2 closed note)
        - generic [ref=e163]:
          - figure "REAL PHOTO — a headset lit green mid-hit next to a tagger sight showing the kill-confirm flash." [ref=e164]:
            - img "REAL PHOTO — a headset lit green mid-hit next to a tagger sight showing the kill-confirm flash" [ref=e165]:
              - generic [ref=e166]: GAME-11
              - generic [ref=e167]: photo pending
          - paragraph [ref=e169]: "Source: this section"
    - complementary "On this page" [ref=e170]:
      - generic [ref=e171]:
        - paragraph [ref=e172]: On this page
        - list [ref=e173]:
          - listitem [ref=e174]:
            - link "The five steps" [ref=e175] [cursor=pointer]:
              - /url: "#the-five-steps"
          - listitem [ref=e176]:
            - link "Why misses still make noise." [ref=e177] [cursor=pointer]:
              - /url: "#why-misses-still-make-noise"
          - listitem [ref=e178]:
            - link "Feedback you will see and hear" [ref=e179] [cursor=pointer]:
              - /url: "#feedback-you-will-see-and-hear"
          - listitem [ref=e180]:
            - link "Every shot names its shooter." [ref=e181] [cursor=pointer]:
              - /url: "#every-shot-names-its-shooter"
  - contentinfo [ref=e182]:
    - paragraph [ref=e183]:
      - text: Protocol discovered by
      - link "LaserTagMods" [ref=e184] [cursor=pointer]:
        - /url: https://github.com/LaserTagMods
      - text: (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community.
    - paragraph [ref=e185]:
      - text: Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company. MIT licence.
      - link "Credits & sourcing" [ref=e186] [cursor=pointer]:
        - /url: /credits/
      - text: ·
      - link "Changelog" [ref=e187] [cursor=pointer]:
        - /url: /changelog/
      - text: ·
      - link "llms.txt" [ref=e188] [cursor=pointer]:
        - /url: /llms.txt
      - text: ·
      - link "GitHub" [ref=e189] [cursor=pointer]:
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