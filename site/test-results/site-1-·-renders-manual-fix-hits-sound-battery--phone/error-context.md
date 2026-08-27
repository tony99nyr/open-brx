# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: site.spec.mjs >> 1 · renders /manual/fix/hits-sound-battery/
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
        - generic [ref=e60]: Hits, sound & battery
      - article [ref=e61]:
        - generic [ref=e62]:
          - heading "Hits, sound & battery" [level=1] [ref=e63]
          - paragraph [ref=e64]: When the gun fires but nothing lands, nothing is heard, or nothing lasts.
          - paragraph [ref=e65]:
            - generic "Verified on our bench" [ref=e66]:
              - generic [ref=e67]: ✅
              - generic [ref=e68]: bench
            - generic "Official Battle Company docs" [ref=e69]:
              - generic [ref=e70]: 📖
              - generic [ref=e71]: official
            - generic "Community-reported" [ref=e72]:
              - generic [ref=e73]: 👥
              - generic [ref=e74]: community
            - generic [ref=e75]:
              - text: Last verified
              - time [ref=e76]: 2026-08-27
            - link "View as Markdown" [ref=e77] [cursor=pointer]:
              - /url: /manual/fix/hits-sound-battery.md
          - group [ref=e78]:
            - generic "? What the badges mean" [ref=e79] [cursor=pointer]
        - generic [ref=e80]:
          - heading "\"IR isn't registering hits\"" [level=2] [ref=e81]
          - list [ref=e82]:
            - listitem [ref=e83]:
              - generic [ref=e84]:
                - generic [ref=e85]: "1"
                - strong [ref=e86]: Same team, friendly fire off?
              - generic [ref=e87]:
                - generic [ref=e88]: Yes →
                - generic [ref=e89]:
                  - text: Zero damage is correct; the firmware enforces it.
                  - generic "Verified on our bench" [ref=e90]: ✅
            - listitem [ref=e92]:
              - generic [ref=e93]:
                - generic [ref=e94]: "2"
                - strong [ref=e95]: Is the target alive and in a started game?
              - generic [ref=e96]:
                - generic [ref=e97]: No →
                - generic [ref=e98]:
                  - text: A dead tagger accepts no IR at all, and a configured-but-unstarted one ignores it too. Silence from a corpse proves nothing.
                  - generic "Verified on our bench" [ref=e99]: ✅
            - listitem [ref=e101]:
              - generic [ref=e102]:
                - generic [ref=e103]: "3"
                - strong [ref=e104]: Bright sunlight?
                - text: → The gun's hit radius shrinks by roughly half in full sun (IR noise filtering); range is best in shade and at night. Typical max is ~600 ft in good conditions.
                - generic "Official Battle Company docs" [ref=e105]: 📖
            - listitem [ref=e107]:
              - generic [ref=e108]:
                - generic [ref=e109]: "4"
                - strong [ref=e110]: Wrong indoor/outdoor mode?
                - text: → Hold
                - strong [ref=e111]: ALT for 3 s
                - text: to toggle; it persists across power cycles. Indoor dims the green hit LEDs, enables the RGB LEDs and shrinks explosion/melee range; outdoor projects further.
                - generic "Official Battle Company docs" [ref=e112]: 📖
            - listitem [ref=e114]:
              - generic [ref=e115]:
                - generic [ref=e116]: "5"
                - strong [ref=e117]: Is the scope sighted?
                - text: → Boot in
                - strong [ref=e118]: target mode
                - text: "(hold LEFT at power-on: yellow team, 0 damage, unlimited ammo); direct hits flash the target green. Sight indoors at ~20 ft, outdoors ~300 ft; snipers 300–400 ft, shotgun/SMG 50–100 ft."
                - generic "Official Battle Company docs" [ref=e119]: 📖
                - generic "Community-reported" [ref=e121]: 👥
            - listitem [ref=e123]:
              - generic [ref=e124]:
                - generic [ref=e125]: "6"
                - strong [ref=e126]: Mag-dumping?
                - text: → The simulated-recoil model drifts accuracy under rapid fire; a miss makes the enemy hear a zip and their headset light with
                - strong [ref=e127]: 0 damage
                - text: . Fire in bursts.
                - generic "Official Battle Company docs" [ref=e128]: 📖
            - listitem [ref=e130]:
              - generic [ref=e131]:
                - generic [ref=e132]: "7"
                - strong [ref=e133]: Hits register from the front but not the back (or vice versa)?
                - text: → The headset has separate front and back sensor domes plus a gun-body sensor; a dead dome is a replaceable part (sensor boards for front/left/right are sold).
                - generic "Official Battle Company docs" [ref=e134]: 📖
                - generic "Community-reported" [ref=e136]: 👥
                - generic "Verified on our bench" [ref=e138]: ✅
            - listitem [ref=e140]:
              - generic [ref=e141]:
                - generic [ref=e142]: "8"
                - strong [ref=e143]: Never lands at any range, target mode included?
                - text: → IR emitters do die. The laser emitter is a separately replaceable part.
                - generic "Community-reported" [ref=e144]: 👥
                - generic "Official Battle Company docs" [ref=e146]: 📖
          - paragraph [ref=e148]:
            - text: "Source:"
            - link "protocol/brx-protocol.md" [ref=e149] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: §7r (FF firmware-enforced; dead/unspawned guns ignore IR; sensor map) ·
            - link "docs/reference/brx-extended-user-guide.md" [ref=e150] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-extended-user-guide.md
            - text: (indoor/outdoor, target mode, accuracy) ·
            - link "docs/reference/brx-manual-notes.md" [ref=e151] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-manual-notes.md
            - text: ·
            - link "docs/reference/community-notes.md" [ref=e152] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
        - note [ref=e154]:
          - paragraph [ref=e155]:
            - strong [ref=e156]: Outdoors, prefer the stock headset.
            - text: SwapTX-modded headsets have dimmer LEDs than the BRX headset, which makes it hard to tell in direct sun whether you're landing tags at range.
            - generic "Community-reported" [ref=e157]: 👥
          - paragraph [ref=e159]:
            - text: "Source:"
            - link "docs/reference/community-notes.md" [ref=e160] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: ("Scoping / sighting & outdoor play")
        - generic [ref=e161]:
          - heading "\"No sound\" / \"too quiet\"" [level=2] [ref=e162]
          - list [ref=e163]:
            - listitem [ref=e164]:
              - generic [ref=e165]:
                - generic [ref=e166]: "1"
                - strong [ref=e167]: Did you hear a "pop" at power-on?
              - generic [ref=e168]:
                - generic [ref=e169]: Yes →
                - generic [ref=e170]:
                  - text: The speaker and amp are powered; check the audio files next. → no → Speaker/wiring; Battle Company sells replacement speakers.
                  - generic "Community-reported" [ref=e171]: 👥
            - listitem [ref=e173]:
              - generic [ref=e174]:
                - generic [ref=e175]: "2"
                - strong [ref=e176]: Volume set to 1?
                - text: → On-gun volume is 1–5 in the SELECT menu and is remembered per game mode.
                - generic "Official Battle Company docs" [ref=e177]: 📖
            - listitem [ref=e179]:
              - generic [ref=e180]:
                - generic [ref=e181]: "3"
                - strong [ref=e182]: Driven from an app or host?
                - text: "→ The wire-level volume command has a much wider range: the official app sends"
                - strong [ref=e183]: "69"
                - text: ; a "safe" 30 is measurably inaudible for weapon audio outdoors.
                - generic "Verified on our bench" [ref=e184]: ✅
            - listitem [ref=e186]:
              - generic [ref=e187]:
                - generic [ref=e188]: "4"
                - strong [ref=e189]: Booted into USB disk mode by accident?
                - text: → SELECT-at-boot suppresses the startup sound entirely. Reboot with nothing held.
                - generic "Official Battle Company docs" [ref=e190]: 📖
            - listitem [ref=e192]:
              - generic [ref=e193]:
                - generic [ref=e194]: "5"
                - strong [ref=e195]: Just updated to v4.30+?
                - text: → That release requires a
                - strong [ref=e196]: complete new audio file set
                - text: in the
                - code [ref=e197]: AUDIO
                - text: folder; old files leave silences.
                - generic "Community-reported" [ref=e198]: 👥
            - listitem [ref=e200]:
              - generic [ref=e201]:
                - generic [ref=e202]: "6"
                - strong [ref=e203]: Installed a custom pack and only some sounds changed?
                - text: → The filenames the app-selected guns use differ from the default gun files; the default weapons to target are SR-100, TAC-87, SMG-X3 and MG7 (→
                - emphasis [ref=e204]: Sound
                - text: section for the id map).
                - generic "Community-reported" [ref=e205]: 👥
          - paragraph [ref=e207]:
            - text: "Source:"
            - link "docs/reference/community-notes.md" [ref=e208] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: (Audio) ·
            - link "docs/reference/brx-extended-user-guide.md" [ref=e209] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-extended-user-guide.md
            - text: (SELECT menu) · CLAUDE.md volume rule /
            - link "docs/experiment-log.md" [ref=e210] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/experiment-log.md
            - text: ·
            - link "docs/reference/brx-manual-notes.md" [ref=e211] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-manual-notes.md
        - generic [ref=e212]:
          - heading "\"Battery dies fast\" / \"won't charge\" / replacing a pack" [level=2] [ref=e213]
          - list [ref=e214]:
            - listitem [ref=e215]:
              - generic [ref=e216]:
                - generic [ref=e217]: "1"
                - strong [ref=e218]: Charger LED never goes green?
                - text: "→ Confirm it's the 8.4 V two-cell smart charger (headset: any 5 V USB). ~2–4 h to full."
                - generic "Official Battle Company docs" [ref=e219]: 📖
            - listitem [ref=e221]:
              - generic [ref=e222]:
                - generic [ref=e223]: "2"
                - strong [ref=e224]: Bluetooth stops holding as the day goes on?
                - text: → Firmware won't re-pair BLE below a battery threshold. Top up, or swap packs.
                - generic "Community-reported" [ref=e225]: 👥
            - listitem [ref=e227]:
              - generic [ref=e228]:
                - generic [ref=e229]: "3"
                - strong [ref=e230]: Buying a replacement pack?
                - text: → Stock is a
                - strong [ref=e231]: 7.4 V, ~2200 mAh Li-ion
                - text: with a 2-pin connector. Marketplace packs often have a 3-pin connector; the third (thermistor) pin is ignored by the BRX.
                - strong [ref=e232]: Check polarity — Battle Company's is reversed from the usual convention.
                - generic "Community-reported" [ref=e233]: 👥
            - listitem [ref=e235]:
              - generic [ref=e236]:
                - generic [ref=e237]: "4"
                - strong [ref=e238]: Want to charge spares without the gun?
                - text: → Owners splice a BRX AC adapter onto a battery connector and charge packs on the bench, then hot-swap in the field (one screw near the reload switch opens the gun's battery bay; the v1 headset has a slide compartment).
                - generic "Community-reported" [ref=e239]: 👥
                - generic "Official Battle Company docs" [ref=e241]: 📖
            - listitem [ref=e243]:
              - generic [ref=e244]:
                - generic [ref=e245]: "5"
                - strong [ref=e246]: Running a rider board off the tagger?
                - text: → Under 300 mA draw from the tagger's port is confirmed OK by Battle Company; most modders use a separate USB power bank anyway.
                - generic "Community-reported" [ref=e247]: 👥
            - listitem [ref=e249]:
              - generic [ref=e250]:
                - generic [ref=e251]: "6"
                - strong [ref=e252]: Want a live reading?
                - text: → The USB console
                - code [ref=e253]: QUERY
                - text: shows gun and headset volts; a battery frame also appears over Bluetooth.
                - generic "Verified on our bench" [ref=e254]: ✅
          - paragraph [ref=e256]:
            - text: "Source:"
            - link "docs/reference/brx-extended-user-guide.md" [ref=e257] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-extended-user-guide.md
            - text: (Battery) ·
            - link "docs/reference/community-notes.md" [ref=e258] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: (Hardware / power) ·
            - link "protocol/brx-protocol.md" [ref=e259] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: (QUERY record) ·
            - link "docs/experiment-log.md" [ref=e260] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/experiment-log.md
            - text: §17 ($VOLTS)
        - note [ref=e262]:
          - paragraph [ref=e263]:
            - strong [ref=e264]: Lithium + reversed polarity = the two ways owners kill boards.
            - text: Unplug the battery before any work inside the shell, meter the connector before plugging a non-stock pack, and never use rechargeable AAs in the AA tray.
            - generic "Community-reported" [ref=e265]: 👥
            - generic "Official Battle Company docs" [ref=e267]: 📖
          - paragraph [ref=e269]:
            - text: "Source:"
            - link "docs/reference/community-notes.md" [ref=e270] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: ·
            - link "docs/reference/brx-manual-notes.md" [ref=e271] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-manual-notes.md
  - contentinfo [ref=e272]:
    - paragraph [ref=e273]:
      - text: Protocol discovered by
      - link "LaserTagMods" [ref=e274] [cursor=pointer]:
        - /url: https://github.com/LaserTagMods
      - text: (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community.
    - paragraph [ref=e275]:
      - text: Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company. MIT licence.
      - link "Credits & sourcing" [ref=e276] [cursor=pointer]:
        - /url: /credits/
      - text: ·
      - link "Changelog" [ref=e277] [cursor=pointer]:
        - /url: /changelog/
      - text: ·
      - link "llms.txt" [ref=e278] [cursor=pointer]:
        - /url: /llms.txt
      - text: ·
      - link "GitHub" [ref=e279] [cursor=pointer]:
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