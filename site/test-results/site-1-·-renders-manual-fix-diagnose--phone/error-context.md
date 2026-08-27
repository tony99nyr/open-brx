# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: site.spec.mjs >> 1 · renders /manual/fix/diagnose/
- Location: test/site.spec.mjs:15:74

# Error details

```
Error: dead → cross-references

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "Headset, pairing & Bluetooth",
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
        - generic [ref=e60]: Diagnose my tagger
      - article [ref=e61]:
        - generic [ref=e62]:
          - heading "Diagnose my tagger" [level=1] [ref=e63]
          - paragraph [ref=e64]: Symptom first. Start at the top of the ladder that matches what you see — the headset is the first thing to check.
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
              - /url: /manual/fix/diagnose.md
          - group [ref=e78]:
            - generic "? What the badges mean" [ref=e79] [cursor=pointer]
        - generic [ref=e80]:
          - paragraph
          - paragraph [ref=e81]:
            - strong [ref=e82]: It won't fire.
            - text: Before you decide it's broken, check the headset, the game state and the locks. Work the ladder in order and stop at the first check that says yes. Confidence for the whole page is shown per block.
            - generic "Verified on our bench" [ref=e83]: ✅
            - generic "Official Battle Company docs" [ref=e85]: 📖
            - generic "Community-reported" [ref=e87]: 👥
          - paragraph [ref=e89]:
            - text: "Source:"
            - link "docs/gotchas.md" [ref=e90] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/gotchas.md
            - text: ·
            - link "docs/reference/community-notes.md" [ref=e91] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: ·
            - link "docs/reference/brx-manual-notes.md" [ref=e92] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-manual-notes.md
        - note [ref=e94]:
          - paragraph [ref=e95]:
            - strong [ref=e96]: Three things to know before any ladder.
            - text: (1) The tagger keeps no game state — if it isn't in a started game it won't shoot at anyone. (2) Since a 2018/2019 firmware revision, the gun locks when its headset disconnects
            - emphasis [ref=e97]: mid-game
            - text: (anti-cheat); a gun booted with no headset at all fires fine. (3) A dead player's trigger does nothing but click — that's a game rule, not a fault.
            - generic "Official Battle Company docs" [ref=e98]: 📖
            - generic "Verified on our bench" [ref=e100]: ✅
          - paragraph [ref=e102]:
            - text: "Source:"
            - link "docs/reference/brx-manual-notes.md" [ref=e103] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-manual-notes.md
            - text: (Headset §) ·
            - link "protocol/brx-protocol.md" [ref=e104] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: §7r ·
            - link "docs/experiment-log.md" [ref=e105] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/experiment-log.md
            - text: (2026-08-25 "dead gun can't fire")
        - generic [ref=e106]:
          - heading "\"Won't fire\" — the ladder" [level=2] [ref=e107]
          - list [ref=e108]:
            - listitem [ref=e109]:
              - generic [ref=e110]:
                - generic [ref=e111]: "1"
                - strong [ref=e112]: Is the headset slow-blinking a rainbow?
              - generic [ref=e113]:
                - generic [ref=e114]: Yes →
                - generic [ref=e115]:
                  - text: It's disconnected. The gun refuses to join or fire until the headset links. Power the headset on, wait for it to settle to team colour (up to 3 minutes in a room full of Bluetooth), or re-pair (→
                  - emphasis [ref=e116]: Headset, pairing & Bluetooth
                  - text: ).
                  - generic "Verified on our bench" [ref=e117]: ✅
                  - generic "Official Battle Company docs" [ref=e119]: 📖
            - listitem [ref=e121]:
              - generic [ref=e122]:
                - generic [ref=e123]: "2"
                - strong [ref=e124]:
                  - text: Did the headset drop
                  - emphasis [ref=e125]: after
                  - text: the game started?
                - text: (it was fine, then the gun "charges its energy weapon but nothing happens on the trigger")
              - generic [ref=e126]:
                - generic [ref=e127]: Yes →
                - generic [ref=e128]:
                  - text: Anti-cheat lockout. Re-link the headset; if it won't, power-cycle both and restart the round.
                  - generic "Community-reported" [ref=e129]: 👥
                  - generic "Official Battle Company docs" [ref=e131]: 📖
            - listitem [ref=e133]:
              - generic [ref=e134]:
                - generic [ref=e135]: "3"
                - strong [ref=e136]: Is the game actually started?
              - generic [ref=e137]:
                - generic [ref=e138]: No →
                - generic [ref=e139]:
                  - text: "On-gun play: pull the"
                  - strong [ref=e140]: reload handle
                  - text: "to start — that's the \"go\" signal, not the trigger. Hosted play: wait for the host's start."
                  - generic "Official Battle Company docs" [ref=e141]: 📖
            - listitem [ref=e143]:
              - generic [ref=e144]:
                - generic [ref=e145]: "4"
                - strong [ref=e146]: Are you dead / waiting on a respawn station?
              - generic [ref=e147]:
                - generic [ref=e148]: Yes →
                - generic [ref=e149]:
                  - text: Respawn (or walk to the station; once a tagger has been armed to a respawn station its self-respawn is disabled). Trigger-while-dead makes only the empty click.
                  - generic "Verified on our bench" [ref=e150]: ✅
                  - generic "Community-reported" [ref=e152]: 👥
            - listitem [ref=e154]:
              - generic [ref=e155]:
                - generic [ref=e156]: "5"
                - strong [ref=e157]:
                  - text: Can you cycle weapons with the trigger
                  - emphasis [ref=e158]: before
                  - text: a game starts?
              - generic [ref=e159]:
                - generic [ref=e160]: No →
                - generic [ref=e161]:
                  - text: Controls are locked. Check
                  - strong [ref=e162]: admin lock
                  - text: ": primary lock is LEFT+RIGHT held 3 s in the root menu; the secondary LEFT+RIGHT+SELECT 3 s also blocks indoor/outdoor, weapon, team and perk changes. Unlock the same way (v4.30: also hold SELECT)."
                  - generic "Community-reported" [ref=e163]: 👥
            - listitem [ref=e165]:
              - generic [ref=e166]:
                - generic [ref=e167]: "6"
                - strong [ref=e168]: Does the reload handle click home?
              - generic [ref=e169]:
                - generic [ref=e170]: No →
                - generic [ref=e171]:
                  - text: The handle drives a mechanical switch under two screws; press the switch with a pen. If the pen works and the handle doesn't, it's the handle (→
                  - link "Repairs" [ref=e172] [cursor=pointer]:
                    - /url: /manual/fix/repairs/
                  - text: ).
                  - generic "Official Battle Company docs" [ref=e173]: 📖
                  - generic "Community-reported" [ref=e175]: 👥
            - listitem [ref=e177]:
              - generic [ref=e178]:
                - generic [ref=e179]: "7"
                - strong [ref=e180]: Does the trigger switch show continuity when pulled?
                - text: (multimeter in beep mode, battery
                - strong [ref=e181]: unplugged
                - text: )
              - generic [ref=e182]:
                - generic [ref=e183]: No →
                - generic [ref=e184]:
                  - text: Trigger switch or a loose internal cable. Open the shell and reseat connectors (→
                  - link "Repairs" [ref=e185] [cursor=pointer]:
                    - /url: /manual/fix/repairs/
                  - text: ).
                  - generic "Community-reported" [ref=e186]: 👥
            - listitem [ref=e188]:
              - generic [ref=e189]:
                - generic [ref=e190]: "8"
                - strong [ref=e191]: Still nothing?
                - text: → It's the mainboard. Not community-serviceable — contact Battle Company for repair.
                - generic "Community-reported" [ref=e192]: 👥
          - paragraph [ref=e194]:
            - text: "Source:"
            - link "docs/reference/community-notes.md" [ref=e195] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: ("Gun won't fire — diagnostic ladder") ·
            - link "docs/reference/brx-manual-notes.md" [ref=e196] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-manual-notes.md
            - text: ·
            - link "docs/reference/grenade.md" [ref=e197] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/grenade.md
            - text: (Respawn Station) ·
            - link "docs/experiment-log.md" [ref=e198] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/experiment-log.md
            - text: 2026-08-27 (headset rainbow)
        - note [ref=e200]:
          - paragraph [ref=e201]:
            - strong [ref=e202]: Running the gun from a third-party host or your own code?
            - text: "Three silent fire-killers we hit on the bench: the button map must be sent or the firmware reports the trigger as disabled; a game head without the start command spawns a gun whose trigger only reloads; and a magazine must be loaded"
            - emphasis [ref=e203]: after
            - text: the spawn or the gun goes live with no ammunition.
            - generic "Verified on our bench" [ref=e204]: ✅
          - paragraph [ref=e206]:
            - text: "Source:"
            - link "docs/gotchas.md" [ref=e207] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/gotchas.md
            - text: ("Sending commands") ·
            - link "docs/experiment-log.md" [ref=e208] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/experiment-log.md
            - text: 2026-08-25 (night, try-out couldn't fire)
        - generic [ref=e209]:
          - heading "\"Won't power on\" / \"powers off by itself\"" [level=2] [ref=e210]
          - list [ref=e211]:
            - listitem [ref=e212]:
              - generic [ref=e213]:
                - generic [ref=e214]: "1"
                - strong [ref=e215]: Did you hold a button while sliding the switch?
              - generic [ref=e216]:
                - generic [ref=e217]: Yes →
                - generic [ref=e218]:
                  - text: SELECT-at-boot puts the gun in USB disk mode with
                  - strong [ref=e219]: no startup sound
                  - text: — it looks dead but is waiting for a computer. LEFT-at-boot is target mode, RIGHT-at-boot is accessory pairing. Power off, power on with nothing held.
                  - generic "Official Battle Company docs" [ref=e220]: 📖
            - listitem [ref=e222]:
              - generic [ref=e223]:
                - generic [ref=e224]: "2"
                - strong [ref=e225]: Is the battery charged?
              - generic [ref=e226]:
                - generic [ref=e227]: No →
                - generic [ref=e228]:
                  - text: The charger LED goes red → green; a full 2 h charge gives ~8 h of play. Use the 8.4 V two-cell smart charger for the gun (the headset takes any 5 V USB).
                  - generic "Official Battle Company docs" [ref=e229]: 📖
            - listitem [ref=e231]:
              - generic [ref=e232]:
                - generic [ref=e233]: "3"
                - strong [ref=e234]: Using AAs?
                - text: → The optional 6×AA tray takes
                - strong [ref=e235]: non-rechargeable
                - text: cells only — the manual says never use rechargeable AAs.
                - generic "Official Battle Company docs" [ref=e236]: 📖
            - listitem [ref=e238]:
              - generic [ref=e239]:
                - generic [ref=e240]: "4"
                - strong [ref=e241]: Replacement pack or rebuilt connector?
                - text: → Battle Company wires the battery connector with polarity
                - strong [ref=e242]: reversed
                - text: from the usual convention. Verify with a meter before plugging in — a reversed pack can damage the board.
                - generic "Community-reported" [ref=e243]: 👥
            - listitem [ref=e245]:
              - generic [ref=e246]:
                - generic [ref=e247]: "5"
                - strong [ref=e248]: Random on/off, especially when jostled?
                - text: → The slide
                - strong [ref=e249]: power switch
                - text: is a known mechanical failure. Contact/switch cleaner buys time; replacement is the fix (→
                - link "Repairs" [ref=e250] [cursor=pointer]:
                  - /url: /manual/fix/repairs/
                - text: ).
                - generic "Community-reported" [ref=e251]: 👥
            - listitem [ref=e253]:
              - generic [ref=e254]:
                - generic [ref=e255]: "6"
                - strong [ref=e256]: Was the battery plugged in while you modded it?
                - text: → A live battery during a mod is how owners have killed mainboards. That's a repair, not a fix.
                - generic "Community-reported" [ref=e257]: 👥
            - listitem [ref=e259]:
              - generic [ref=e260]:
                - generic [ref=e261]: "7"
                - strong [ref=e262]: Got wet?
                - text: → Owners have recovered guns after days of thorough drying. Remove the battery, dry fully before any power attempt.
                - generic "Community-reported" [ref=e263]: 👥
          - paragraph [ref=e265]:
            - text: "Source:"
            - link "docs/reference/brx-extended-user-guide.md" [ref=e266] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-extended-user-guide.md
            - text: (USB disk mode, battery) ·
            - link "docs/reference/brx-manual-notes.md" [ref=e267] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-manual-notes.md
            - text: ·
            - link "docs/reference/community-notes.md" [ref=e268] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/community-notes.md
            - text: (Battery / power; Common failures)
        - generic [ref=e269]:
          - paragraph [ref=e270]:
            - text: ~8 h play per charge (
            - generic "Official Battle Company docs" [ref=e271]: 📖
            - text: ) · 2–4 h to recharge (
            - generic "Official Battle Company docs" [ref=e273]: 📖
            - text: ) · up to 3 min for a headset to auto-pair in a crowded room (
            - generic "Official Battle Company docs" [ref=e275]: 📖
            - text: ) · ~1 in 3 — how often a Bluetooth connection attempt succeeds first time, official app included (
            - generic "Verified on our bench" [ref=e277]: ✅
            - text: )
          - paragraph [ref=e279]:
            - text: "Source:"
            - link "docs/reference/brx-manual-notes.md" [ref=e280] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-manual-notes.md
            - text: ·
            - link "docs/reference/brx-extended-user-guide.md" [ref=e281] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/reference/brx-extended-user-guide.md
            - text: ·
            - link "docs/gotchas.md" [ref=e282] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/gotchas.md
            - text: ("Connection failed")
  - contentinfo [ref=e283]:
    - paragraph [ref=e284]:
      - text: Protocol discovered by
      - link "LaserTagMods" [ref=e285] [cursor=pointer]:
        - /url: https://github.com/LaserTagMods
      - text: (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community.
    - paragraph [ref=e286]:
      - text: Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company. MIT licence.
      - link "Credits & sourcing" [ref=e287] [cursor=pointer]:
        - /url: /credits/
      - text: ·
      - link "Changelog" [ref=e288] [cursor=pointer]:
        - /url: /changelog/
      - text: ·
      - link "llms.txt" [ref=e289] [cursor=pointer]:
        - /url: /llms.txt
      - text: ·
      - link "GitHub" [ref=e290] [cursor=pointer]:
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