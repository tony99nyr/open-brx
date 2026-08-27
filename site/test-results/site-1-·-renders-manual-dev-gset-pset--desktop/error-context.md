# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: site.spec.mjs >> 1 · renders /manual/dev/gset-pset/
- Location: test/site.spec.mjs:15:74

# Error details

```
Error: horizontal page overflow (1687 > 1280)

expect(received).toBeLessThanOrEqual(expected)

Expected: <= 1281
Received:    1687
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
      - group [ref=e36]:
        - generic "▸ 06 Developer reference" [ref=e37] [cursor=pointer]:
          - text: ▸
          - generic [ref=e38]: "06"
          - text: Developer reference
        - list [ref=e39]:
          - listitem [ref=e40]:
            - link "Overview" [ref=e41] [cursor=pointer]:
              - /url: /manual/dev/
          - listitem [ref=e42]:
            - link "Transport, framing & safety" [ref=e43] [cursor=pointer]:
              - /url: /manual/dev/transport/
          - listitem [ref=e44]:
            - link "Command reference" [ref=e45] [cursor=pointer]:
              - /url: /manual/dev/commands/
          - listitem [ref=e46]:
            - link "The arm sequence — from $CLEAR to a live gun" [ref=e47] [cursor=pointer]:
              - /url: /manual/dev/arm-sequence/
          - listitem [ref=e48]:
            - link "$WEAP — the weapon definition" [ref=e49] [cursor=pointer]:
              - /url: /manual/dev/weap/
          - listitem [ref=e50]:
            - link "$GSET and $PSET — game and player settings" [ref=e51] [cursor=pointer]:
              - /url: /manual/dev/gset-pset/
          - listitem [ref=e52]:
            - link "$SIR — the incoming-IR effects matrix" [ref=e53] [cursor=pointer]:
              - /url: /manual/dev/sir/
          - listitem [ref=e54]:
            - link "Events — what the gun tells you" [ref=e55] [cursor=pointer]:
              - /url: /manual/dev/events/
          - listitem [ref=e56]:
            - link "The IR word — what a shot carries through the air" [ref=e57] [cursor=pointer]:
              - /url: /manual/dev/ir/
          - listitem [ref=e58]:
            - link "The USB serial console — QUERY and SETUP" [ref=e59] [cursor=pointer]:
              - /url: /manual/dev/serial-console/
          - listitem [ref=e60]:
            - link "Headset, link and what survives" [ref=e61] [cursor=pointer]:
              - /url: /manual/dev/headset-link/
          - listitem [ref=e62]:
            - link "Getting started with brx-mcp" [ref=e63] [cursor=pointer]:
              - /url: /manual/dev/brx-mcp/
          - listitem [ref=e64]:
            - link "Captures — recording and decoding the official app" [ref=e65] [cursor=pointer]:
              - /url: /manual/dev/captures/
    - main [ref=e66]:
      - navigation "Breadcrumb" [ref=e67]:
        - link "Home" [ref=e68] [cursor=pointer]:
          - /url: /
        - generic [ref=e69]: /
        - link "Manual" [ref=e70] [cursor=pointer]:
          - /url: /manual/
        - generic [ref=e71]: /
        - link "Developer reference" [ref=e72] [cursor=pointer]:
          - /url: /manual/dev/
        - generic [ref=e73]: /
        - generic [ref=e74]: $GSET and $PSET — game and player settings
      - article [ref=e75]:
        - generic [ref=e76]:
          - heading [level=1] [ref=e77]:
            - code [ref=e78]: $GSET
            - text: and
            - code [ref=e79]: $PSET
            - text: — game and player settings
          - paragraph [ref=e80]: The two frames that set on-gun rules and the player's pools, identity and voice pack
          - paragraph [ref=e81]:
            - generic "Verified on our bench" [ref=e82]:
              - generic [ref=e83]: ✅
              - generic [ref=e84]: bench
            - generic "Decoded from the Callsign app" [ref=e85]:
              - generic [ref=e86]: 🔍
              - generic [ref=e87]: app
            - generic [ref=e88]:
              - text: Last verified
              - time [ref=e89]: 2026-08-27
            - link "View as Markdown" [ref=e90] [cursor=pointer]:
              - /url: /manual/dev/gset-pset.md
          - group [ref=e91]:
            - generic "? What the badges mean" [ref=e92] [cursor=pointer]
        - generic [ref=e93]:
          - heading [level=2] [ref=e94]:
            - code [ref=e95]: $GSET,<t1>,…,<t8>,*
            - text: — validated against the captured
            - code [ref=e96]: $GSET,0,0,1,0,1,0,50,1,*
          - table [ref=e98]:
            - rowgroup [ref=e99]:
              - row [ref=e100]:
                - columnheader "#" [ref=e101]
                - columnheader "Field" [ref=e102]
                - columnheader "Captured" [ref=e103]
                - columnheader "Meaning" [ref=e104]
                - columnheader "Conf" [ref=e105]
            - rowgroup [ref=e106]:
              - row [ref=e107]:
                - cell "1" [ref=e108]
                - cell "friendlyFire" [ref=e109]
                - cell "0 / 1" [ref=e110]
                - cell [ref=e111]:
                  - strong [ref=e112]: Firmware-enforced, both directions.
                  - text: 0 blocks same-team damage
                  - emphasis [ref=e113]: and
                  - text: heals from enemies; 1 opens the gate. Replicated 2× with alternating values plus control.
                - cell [ref=e114]:
                  - generic "Verified on our bench" [ref=e115]: ✅
              - row [ref=e117]:
                - cell "2" [ref=e118]
                - cell "outdoorMode" [ref=e119]
                - cell "0" [ref=e120]
                - cell "APK field name; not exercised on the bench." [ref=e121]
                - cell [ref=e122]:
                  - generic "Decoded from the Callsign app" [ref=e123]: 🔍
              - row [ref=e125]:
                - cell "3" [ref=e126]
                - cell "gunLaserRegion" [ref=e127]
                - cell "1" [ref=e128]
                - cell "APK field name; not exercised on the bench." [ref=e129]
                - cell [ref=e130]:
                  - generic "Decoded from the Callsign app" [ref=e131]: 🔍
              - row [ref=e133]:
                - cell "4" [ref=e134]
                - cell "autoAmbientLight" [ref=e135]
                - cell "0" [ref=e136]
                - cell "APK field name; not exercised on the bench." [ref=e137]
                - cell [ref=e138]:
                  - generic "Decoded from the Callsign app" [ref=e139]: 🔍
              - row [ref=e141]:
                - cell "5" [ref=e142]
                - cell "gyroscope" [ref=e143]
                - cell "1" [ref=e144]
                - cell "APK field name; not exercised on the bench." [ref=e145]
                - cell [ref=e146]:
                  - generic "Decoded from the Callsign app" [ref=e147]: 🔍
              - row [ref=e149]:
                - cell "6" [ref=e150]
                - cell "secondaryBluetoothWeapons" [ref=e151]
                - cell "0" [ref=e152]
                - cell "APK field name; not exercised on the bench." [ref=e153]
                - cell [ref=e154]:
                  - generic "Decoded from the Callsign app" [ref=e155]: 🔍
              - row [ref=e157]:
                - cell "7" [ref=e158]
                - cell "criticalShotModifier" [ref=e159]
                - cell "50" [ref=e160]
                - cell [ref=e161]:
                  - text: APK field name.
                  - strong [ref=e162]: Not
                  - text: score-to-win (byte-identical across captures with different win conditions).
                - cell [ref=e163]:
                  - generic "Decoded from the Callsign app" [ref=e164]: 🔍
                  - generic "Verified on our bench" [ref=e166]: ✅
              - row [ref=e168]:
                - cell "8" [ref=e169]
                - cell "gameMods" [ref=e170]
                - cell "1" [ref=e171]
                - cell "APK field name; not exercised on the bench." [ref=e172]
                - cell [ref=e173]:
                  - generic "Decoded from the Callsign app" [ref=e174]: 🔍
          - paragraph [ref=e176]:
            - text: "Source:"
            - link "protocol/callsign-extract/protocol-classes.md" [ref=e177] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/callsign-extract/protocol-classes.md
            - text: (GSET),
            - link "protocol/brx-protocol.md" [ref=e178] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: §3, §7n;
            - link "docs/experiment-log.md" [ref=e179] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/experiment-log.md
            - text: (FF enforcement table)
        - note [ref=e181]:
          - strong [ref=e182]: There is no respawn, time, lives or score token.
          - paragraph [ref=e183]:
            - text: Three captures at respawn 5/15/30 s and different clocks produced byte-identical
            - code [ref=e184]: $GSET
            - text: and
            - code [ref=e185]: $PSET
            - text: ", and the 8-field map from the app metadata contains none of them. Those live in the host. Stop looking."
          - paragraph [ref=e186]:
            - text: "Source:"
            - link "protocol/brx-protocol.md" [ref=e187] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: §7n
        - generic [ref=e188]:
          - heading [level=2] [ref=e189]:
            - code [ref=e190]: $PSET,<t1>,…,*
            - text: — sample
            - code [ref=e191]: $PSET,6,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*
          - table [ref=e193]:
            - rowgroup [ref=e194]:
              - row [ref=e195]:
                - columnheader "tok" [ref=e196]
                - columnheader "Field" [ref=e197]
                - columnheader "Sample" [ref=e198]
                - columnheader "Meaning" [ref=e199]
                - columnheader "Conf" [ref=e200]
            - rowgroup [ref=e201]:
              - row [ref=e202]:
                - cell "1" [ref=e203]
                - cell [ref=e204]:
                  - strong [ref=e205]: player id
                - cell "6" [ref=e206]
                - cell [ref=e207]:
                  - strong [ref=e208]: 0-based, 0–63 (6 bits)
                  - text: — the app's UI shows 1–64 and writes id−1 (app 7 → wire 6, app 64 → 63, an out-of-range 69 clamps to 63). Ends up in every IR shot's P field and comes back as
                  - code [ref=e209]: $HIR
                  - text: token 3 on whoever you hit.
                - cell [ref=e210]:
                  - generic "Verified on our bench" [ref=e211]: ✅
              - row [ref=e213]:
                - cell "2" [ref=e214]
                - cell "—" [ref=e215]
                - cell "0" [ref=e216]
                - cell "0 in every capture; 0/1/7 gave byte-identical behaviour. Inert." [ref=e217]
                - cell [ref=e218]:
                  - generic "Verified on our bench" [ref=e219]: ✅
              - row [ref=e221]:
                - cell "3" [ref=e222]
                - cell "HP" [ref=e223]
                - cell "45" [ref=e224]
                - cell [ref=e225]:
                  - text: Starting/max HP. Echoed as
                  - code [ref=e226]: $LCD
                  - text: token 1 after
                  - code [ref=e227]: $SPAWN
                  - text: .
                - cell [ref=e228]:
                  - generic "Verified on our bench" [ref=e229]: ✅
              - row [ref=e231]:
                - cell "4" [ref=e232]
                - cell "armor" [ref=e233]
                - cell "70" [ref=e234]
                - cell [ref=e235]:
                  - text: Armor pool (
                  - code [ref=e236]: $LCD
                  - text: token 2,
                  - code [ref=e237]: $HP
                  - text: token 2).
                - cell [ref=e238]:
                  - generic "Verified on our bench" [ref=e239]: ✅
              - row [ref=e241]:
                - cell "5" [ref=e242]
                - cell "shield" [ref=e243]
                - cell "70" [ref=e244]
                - cell [ref=e245]:
                  - text: Shield
                  - strong [ref=e246]: maximum
                  - text: . The pool starts at 0 and only fills via an IR
                  - code [ref=e247]: $SIR
                  - text: grant function — it is not BLE-writable as a value.
                - cell [ref=e248]:
                  - generic "Verified on our bench" [ref=e249]: ✅
              - row [ref=e251]:
                - cell "6" [ref=e252]
                - cell "—" [ref=e253]
                - cell "50" [ref=e254]
                - cell "— (unknown)" [ref=e255]
                - cell "—" [ref=e256]
              - row [ref=e257]:
                - cell "7" [ref=e258]
                - cell "(empty)" [ref=e259]
                - cell "—" [ref=e260]
                - cell [ref=e261]
                - cell "—" [ref=e262]
              - row [ref=e263]:
                - cell "8+" [ref=e264]
                - cell [ref=e265]:
                  - strong [ref=e266]: positional voice pack
                - cell "H44 JAD V33 V3I V3C V3G V3E V37 H06 H55 H13 H21 H02 U15 W71 A10" [ref=e267]
                - 'cell "Sixteen sound ids on the wire. The app''s metadata declares these voice-pack fields: deathAlarm, stealthDeathScream, musicMixOnDeath, deathScream, battleRespawnCry, meleeGrunt, shortPain, longPain, painRelief, missShothit, hitHp, hitArrmor, hitShield, hitCrit, emptyUnboundButtonSound, ammoOrGearPickUp, energyShieldLoop. Which wire slot carries which name: — (unknown)." [ref=e268]'
                - cell [ref=e269]:
                  - generic "Decoded from the Callsign app" [ref=e270]: 🔍
          - paragraph [ref=e272]:
            - text: "Source:"
            - link "protocol/brx-protocol.md" [ref=e273] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: §3, §7e, §7p, §7r;
            - link "protocol/callsign-extract/protocol-classes.md" [ref=e274] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/callsign-extract/protocol-classes.md
            - text: (PSET);
            - link "mcp/brx_mcp/gameconfig.py" [ref=e275] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/mcp/brx_mcp/gameconfig.py
            - text: ;
            - link "docs/unknowns.md" [ref=e276] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/docs/unknowns.md
            - text: (A10b′, P3)
        - note [ref=e278]:
          - strong [ref=e279]: Numbering a fleet is one token.
          - paragraph [ref=e280]:
            - text: Give every gun a distinct
            - code [ref=e281]: $PSET
            - text: token 1 at arm time and per-player kill attribution is BLE-native — no cable, no IR receiver. Show operators 1-based ids; write
            - code [ref=e282]: id − 1
            - text: .
          - paragraph [ref=e283]:
            - text: "Source:"
            - link "protocol/brx-protocol.md" [ref=e284] [cursor=pointer]:
              - /url: https://github.com/tony99nyr/open-brx/blob/main/protocol/brx-protocol.md
            - text: §7p, §7q
    - complementary "On this page" [ref=e285]:
      - generic [ref=e286]:
        - paragraph [ref=e287]: On this page
        - list [ref=e288]:
          - listitem [ref=e289]:
            - link "$GSET,<t1>,…,<t8>, — validated against the captured $GSET,0,0,1,0,1,0,50,1," [ref=e290] [cursor=pointer]:
              - /url: "#gset-validated-against-the-captured-gset-0-0-1-0-1-0-50-1"
          - listitem [ref=e291]:
            - link "There is no respawn, time, lives or score token." [ref=e292] [cursor=pointer]:
              - /url: "#there-is-no-respawn-time-lives-or-score-token"
          - listitem [ref=e293]:
            - link "$PSET,<t1>,…, — sample $PSET,6,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10," [ref=e294] [cursor=pointer]:
              - /url: "#pset-sample-pset-6-0-45-70-70-50-h44-jad-v33-v3i-v3c-v3g-v3e"
          - listitem [ref=e295]:
            - link "Numbering a fleet is one token." [ref=e296] [cursor=pointer]:
              - /url: "#numbering-a-fleet-is-one-token"
  - contentinfo [ref=e297]:
    - paragraph [ref=e298]:
      - text: Protocol discovered by
      - link "LaserTagMods" [ref=e299] [cursor=pointer]:
        - /url: https://github.com/LaserTagMods
      - text: (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community.
    - paragraph [ref=e300]:
      - text: Open BRX is an independent open-source project and is not affiliated with or endorsed by Battle Company. MIT licence.
      - link "Credits & sourcing" [ref=e301] [cursor=pointer]:
        - /url: /credits/
      - text: ·
      - link "Changelog" [ref=e302] [cursor=pointer]:
        - /url: /changelog/
      - text: ·
      - link "llms.txt" [ref=e303] [cursor=pointer]:
        - /url: /llms.txt
      - text: ·
      - link "GitHub" [ref=e304] [cursor=pointer]:
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
> 77  |     expect(sw, `horizontal page overflow (${sw} > ${iw})`).toBeLessThanOrEqual(iw + 1);
      |                                                            ^ Error: horizontal page overflow (1687 > 1280)
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
  174 |   await expect(ex.locator('[data-x-more]')).toBeHidden();
  175 |   await ex.locator('[data-x-search]').fill('');
  176 |   const chips = ex.locator('[data-facet]:not([data-facet="all"])');
  177 |   const fams = await page.evaluate(async () => [...new Set((await (await fetch('/data/sounds.json')).json()).rows.map(r => r.family))].sort());
```