# Open BRX website — Claude Design brief

**Package for:** Claude Design. Build the public **Open BRX** website. The first thing it ships is
**The Ultimate BRX Manual** — the definitive reference for the Battle Company BRX laser-tag tagger and
headset — with the Open BRX platform (open-source software + hardware that orchestrates BRX taggers)
presented alongside it.

**Read in this order:** this brief → `../manual/00-home.md` → `../manual/01…07-*.md` (**the manual
itself** — one file per section, every fact real and sourced; the site is built from these, see §9) →
`images.md` (every image slot, with Gemini prompts) → `../spec/design/tokens.css` (palette/type seed —
evolve it, keep the roles).

**Logic vs visuals.** The content files are the *what*. Screens, layout, art direction, motion are yours to
iterate. **Do not invent facts** — every sentence on the site must trace to a content file. If a page seems to
need content the files don't have, leave a clearly-marked `TODO: content` slot rather than filling it in.

---

## 1. The product in one line

> **Video game inspired tactical laser tag — open and self-hosted.**

Two audiences, one site:

| Audience | What they came for | Where they land |
|---|---|---|
| **BRX owners** (the majority — Google "BRX manual", "BRX won't fire", "BRX headset pairing", "BRX sound files") | answers, fast; a manual better than the PDFs | `/manual/*` |
| **Players / clubs / modders / developers** curious about running real game modes on stock guns | what Open BRX is, what's proven, how to try it | `/platform/*` |

The manual is the **magnet** (authority + SEO); the platform is the **offer**. The manual must never feel
like a marketing funnel — it is genuinely the best BRX reference anywhere, and it earns the platform's credibility.

## 2. Brand & tone

- **Tactical, precise, confident, generous.** A field manual written by people who took the gun apart —
  not a wiki dump, not a startup landing page.
- **Known facts only.** The manual states what we know and nothing else. Every published fact wears a
  provenance badge (✅ verified on our bench · 📖 official Battle Company docs · 🔍 decoded from the
  app · 👥 community-reported). **Nothing marked ❓ / unconfirmed, speculative, or contradicted between
  sources is published** — it lives in each content file's *Research backlog* until it's confirmed, and
  the site simply doesn't mention it. When research turns up a new fact, it gets added; the manual grows
  by confirmation, not by hedging. The platform pages use a status badge (✅ proven on hardware ·
  🧪 software-tested · 📐 specified only). **Design these badges as a first-class component** — small,
  consistent, legible, never shouting.
- **Credit is part of the brand.** LaserTagMods (JEDGE/JBOX) discovered the protocol; Battle Company makes
  the hardware; the owner community found the fixes. Credits appear inline (a "source" line under blocks)
  and on a dedicated Credits page. Official PDFs are linked, never rehosted.
- **Dark-first**, with a real light theme (people read manuals in daylight on a phone at the field).
  Palette, type, and the fixed team colours are in `tokens.css`: near-black navy ground `#0c1016`,
  panel `#141b24`, ink `#e8eef5`, accent electric blue `#39b4ff`, amber `#ffb020` for warnings/tips.
  Display type condensed (Oswald/Rajdhani), UI type Inter. Numbers tabular.
- **Never cartoonish, never toy.** No neon-green "laser" clichés, no lens-flare. The art direction is
  premium product documentation: graphite, precise line work, restrained light.

## 3. Information architecture

```
/                          Home — hero, what this is, the two doors (Manual / Platform), status strip
/manual                    Manual home — the section grid + search + "start here" paths
/manual/hardware/*         01 · Meet the BRX — anatomy, LEDs, generations, headset, spec sheet
/manual/operate/*          02 · Operating the BRX — quick start, pairing, indoor/outdoor, the Callsign app
/manual/gameplay/*         03 · Gameplay — weapons (all 19), health/damage, native modes, perks, grenade modes
/manual/sound/*            04 · Sound, voice & updates — how audio works, the 2166-id Sound Bank Explorer, USB sound-pack + firmware
/manual/fix/*              05 · Fix, mod & accessorise — symptom-indexed troubleshooting, repairs, mods, accessories, community, FAQ
/manual/dev/*              06 · Developer reference — BLE + IR protocol, command tables, $WEAP token map, serial console, brx-mcp
/platform/*                07 · The Open BRX platform — pitch, topology, pieces, modes by tier, budget tiers, vs Edge, status, FAQ
/credits                   Credits & sourcing policy
/changelog                 What changed (the manual is a living document — date every page)
```

Each `../manual/NN-*.md` file lists its pages and their URL slugs. Treat those as the sitemap.

**Navigation model:** a persistent left sidebar inside `/manual` (sections → pages, current page's headings
below it), a top bar with **search** (⌘K), theme toggle, GitHub link, and the Manual / Platform switch.
On phones: a bottom "On this page" sheet + a hamburger for the section tree. Breadcrumbs on every page.

**Search is not optional.** Owners arrive with a symptom. Search must index page titles, headings,
table rows (weapon names, sound ids, command names) and the FAQ. Show results grouped by section.

## 4. Page templates (design these 6, everything else is a variant)

| Template | Used by | Shape |
|---|---|---|
| **T1 Home** | `/` | full-bleed hero (image slot HOME-01), one-line pitch, two door cards, a 3–4 stat row, "latest from the bench" strip, credits footer |
| **T2 Section hub** | `/manual`, each `/manual/<section>`, `/platform` | intro paragraph, page cards with a thumbnail + 1-line summary, a "start here if…" path list |
| **T3 Reference page** | most manual pages | title + subtitle + confidence/date meta, right-rail TOC, block stream (see §5), prev/next, "sources" footer, "was this useful / report an error" |
| **T4 Data explorer** | Weapons table, Sound Bank Explorer, Command reference | sticky filter bar + search, dense virtualised table, row → detail drawer, copy buttons, export CSV |
| **T5 Procedure** | pairing, sound-pack update, firmware, repairs | numbered steps with one image per step, prerequisites checklist at the top, "if this fails →" links into troubleshooting |
| **T6 Diagnostic ladder** | troubleshooting pages | symptom cards → an ordered ladder of checks (check → yes/no → fix); optionally a wizard mode |

## 5. Block vocabulary (the content files are written in these)

The content files describe pages as an ordered stream of typed blocks. Design one component per type;
keep them visually related. Blocks are **short** by construction — no paragraph is longer than three
sentences; if a designer finds a wall of text, the content file is wrong, not the layout.

| Block | Design intent |
|---|---|
| `[hero]` | page opener: 1–2 lines + optional image; sets the page's purpose |
| `[callout:info/warn/tip]` | bordered aside; warn = amber, tip = blue, info = neutral. Icon + short title + ≤3 lines |
| `[steps]` | numbered procedure; each step may carry an image slot; big step numerals |
| `[cards]` | 2–6 equal cards: icon/thumbnail, title, 1–2 lines. For "at a glance" summaries |
| `[table]` | static table; sticky header; zebra; confidence column when present |
| `[data-table:filterable]` | T4 explorer: search + facet filters + sortable columns + copy-cell |
| `[spec-sheet]` | key/value pairs in two columns; the "datasheet" look |
| `[accordion]` | collapsed Q/A or detail; used for "why" digressions and FAQ |
| `[image X]` / `[diagram X]` | slot from `images.md`; every image has a caption and, for anatomy, HTML hotspot labels over an unlabeled render |
| `[code lang]` | monospace, copy-to-clipboard, language chip; command frames like `$WEAP,…,*` are this block |
| `[bit-field]` | bit-layout diagram (fields as coloured spans over a bit ruler) — build as SVG/HTML |
| `[symptom-ladder]` | ordered checks; each has check / yes → fix / no → next; the T6 core |
| `[compare]` | side-by-side columns (Open BRX vs Edge, Gen2 vs Gen3, BRX vs BRP) with ✓ / ✗ / ~ cells |
| `[stat-row]` | 3–5 big tabular numbers with labels |
| `[download]` | the download button + fact table for the one app build committed under `webapp/download/`. The generator reads the file's own name, size, build date (from its `build.json` sidecar) and sha256, so the page cannot advertise a build it is not serving. No APK present renders a visible TODO, two APKs fail the build. Cut a build with `npm run android:apk` in `app/`. |
| `[timeline]` | roadmap / status by date |
| `[pricing-tiers]` | build-tier comparison — looks like pricing, but the columns are budgets, not plans |
| `[quote]` | a community or official-doc quote, credited |
| `[faq]` | accordion list, each question indexable by search |
| `[audio-player]` | future — we cannot rehost Battle Company audio; design the slot, mark it "coming when licensed" |
| `[under-construction …]` | a 🚧 card: title, one-line "what it will be", status badge, and a "details when it's on the bench" line. **Renders nothing else** — the content file may carry a full draft beneath it for later, but the public site shows only the card. See §10. |

**Confidence badge** and **source line** are sub-elements on every block. Source lines are small,
muted, and link to the repo file (GitHub) so anyone can check our work.

## 6. Interactive pieces that earn their place (build these, in priority order)

1. **Sound Bank Explorer** (`/manual/sound/sound-bank`) — 2166 rows; search by id/name/category; filters;
   copy-id; "used by" cross-links. Spec in `../manual/04-sound.md` §Interactive.
2. **Weapon table + comparator** (`/manual/gameplay/weapons`) — all 20 weapons; pick two → side-by-side
   stat bars; real numbers only. Spec in `../manual/03-gameplay.md`.
3. **Command reference explorer** (`/manual/dev/commands`) — every BLE command, filter by direction /
   confidence; row drawer shows the field map and a copyable example frame.
4. **`$WEAP` frame builder** (`/manual/dev/weap`) — sliders → the exact frame string, with the bench-proven
   token map. Spec in `../manual/06-developer.md`.
5. **Diagnose my tagger** wizard (`/manual/fix/diagnose`) — a guided walk through the symptom ladders.
6. **Interactive topology** (`/platform/architecture`) — click a phase → the diagram shows which links are up.

Everything else is static. Interactivity is for data, never for decoration.

## 7. Hard constraints

1. **Facts only from the content files.** No lorem, no placeholder numbers, no "example" weapon stats.
2. **Known facts only.** Never render anything tagged ❓, anything in a file's *Research backlog*
   section, or any "we think / probably / may" phrasing. If a block reads as uncertain, it doesn't ship.
   Provenance and status badges are mandatory wherever the content file carries one.
3. **Real photos for hardware.** An image model cannot render the actual BRX accurately; `images.md`
   splits every slot into REAL PHOTO (the owner shoots it) vs GENERATE (Gemini). Design with real-photo
   slots as clearly-framed placeholders (aspect ratio + a one-line shot description) until they exist.
4. **No trademarks in generated art, no rehosted Battle Company assets** (manual PDFs, audio, app screenshots).
   Link out. Screenshots of the official app are *reference-only*, not for the public site.
5. **Never imply endorsement by Battle Company.** "Open BRX" is descriptive; the site says so on Credits.
6. **Mobile-first for the manual.** Owners read it standing at a field with a gun in the other hand:
   big tap targets, sticky "on this page", tables that scroll horizontally inside their container, never the page.
7. **Fast + static.** No client-side data fetching for content; explorer data ships as static JSON.
   The host is an assets-only Cloudflare Worker serving `webapp/` (§9) — no server-side anything.
8. **Every page dated** ("last verified 2026-08-27") and linked to its sources — the manual is a living document.
9. **Accessibility:** WCAG AA contrast in both themes; every image has alt text (written from the
   "what it shows" column in `images.md`); keyboard-navigable explorers.

## 8. Deliverables to iterate

- The six templates (§4), desktop + phone.
- The Home page (T1) with real copy from `../manual/00-home.md`.
- One fully-realised page per section as the reference implementation:
  Hardware → anatomy page · Operate → headset pairing (T5) · Gameplay → weapons (T4) ·
  Sound → the Sound Bank Explorer (T4) · Fix → `/manual/fix/diagnose` "won't fire" ladder (T6) ·
  Dev → `/manual/dev/commands` (T4) · Platform → `/platform/architecture` (T2 + interactive topology).
- The component sheet for §5 blocks + the confidence/status badges, both themes.
- The image placeholder treatment (REAL PHOTO slots) so the site ships before the photo shoot.

## 9. Where it deploys (this IS a constraint)

The site is **already hosted**: the repo's root `wrangler.toml` publishes the `webapp/` folder as an
assets-only **Cloudflare Worker** (`open-brx.iamrossi.workers.dev`). **A push to `main` deploys it.**
Cloudflare builds from the repo, so the push is the deploy and `webapp/` goes live exactly as committed.
(This changed: a push did *not* redeploy when that was verified on 2026-08-27, and it does as of
2026-08-30, confirmed by a manual edit reaching the live page with no `wrangler` run. `npx wrangler
deploy` from the repo root still works for pushing local `webapp/` without a commit.)
`webapp/.assetsignore` keeps `mc/` and the build manifest off the public host. Nothing outside `webapp/`
is published. So:

- **The built site's output lands in `webapp/`**: `webapp/index.html` becomes the T1 Home (it is a
  throwaway dev landing page today), `webapp/manual/…` and `webapp/platform/…` hold the sections, with
  clean directory URLs (`/manual/hardware/leds/` → `webapp/manual/hardware/leds/index.html`).
- **Static output only** — no server, no SSR, no functions. Explorer data ships as static JSON files
  built from the repo (`protocol/callsign-extract/Sounds.json` + `sound-bank.md`, `docs/reference/weapons.md`,
  `mcp/brx_mcp/mc/weapons.json`, `protocol/brx-protocol.md`).
- **The content source is the repo's own manual — `docs/manual/`.** Those files are simultaneously the
  project's canonical documentation and the site's input; the site generator reads them, and there is
  no second copy of any fact. Design/layout source lives in its own dir (e.g. `site/` at the repo root);
  the built output is committed into `webapp/` (that is how the deploy works today — Cloudflare uploads
  what's in git). Tables that exist as data files (the weapon roster, the sound bank, the command list)
  are **generated at build from those files**, never hand-copied into pages.
- **Do not touch `webapp/mc/` or `app/`.** The Mission Control UI and the phone HUD are still in
  development and are *not* part of this site — no refactor, no move, no cleanup, no shared-component
  extraction. The manual site is a separate static build that simply doesn't link to them. (If a
  `webapp/.assetsignore` is wanted to keep `mc/src` off the public host, it's a one-line file — optional.)
- **What's live there today is stale and gets replaced, not preserved.** `index.html` is a dev
  landing page; `ble-test.html` is the dead Web Bluetooth spike (ADR-0003); `mission-control.html` is a
  pre-`webapp/mc` prototype; `brx-companion.apk` is an old debug build that is publicly downloadable.
  The new site's build overwrites `index.html`; the other three can be deleted in the same commit or
  simply left unlinked — no cleanup project needed. Nothing on the live host needs to survive.
- **Custom domain** is a Cloudflare setting, not a code change; the site must not hard-code the
  `workers.dev` host in links.
- Framework: any static-output generator (Astro is the natural fit for MDX content + islands for the
  explorers); seed the palette from `docs/spec/design/tokens.css` (copy the values — don't import from
  `webapp/mc`). Search: Pagefind or a prebuilt index — no hosted search dependency.
## 10. Under-construction policy (what the platform pages may show right now)

The manual (sections 01–06) ships in full. The platform is mostly still being built, so the public site
shows it honestly and briefly:

| Piece | Public treatment |
|---|---|
| **`brx-mcp`** (CLI + MCP server) | **Shown in full.** It works today — Tier 0 (laptop-only) games are hardware-proven. It appears on Home, `/platform` and `/platform/pieces` as the thing you can run now, and `/manual/dev/brx-mcp` is the getting-started page. |
| **Mission Control** (operator console) | 🚧 `[under-construction]` card only. No screenshots, no phase walkthrough, no feature lists. |
| **BRX Combat HUD** (phone node app) | 🚧 card only. No screenshots, no APK download. |
| **BRX Companion** (ESP32 rider) | 🚧 card only ("specified; bench kit in hand"). |
| **Utility Box / stations, effect nodes** | 🚧 card only. The one proven fact (a stock tagger accepted a synthetic IR shot from our rig) may appear as a one-liner. |
| `/platform/architecture`, `/platform/modes`, `/platform/build-tiers`, `/platform/vs-edge`, `/platform/status` | Ship — they describe the design and the honest status, and every block carries ✅/🧪/📐. They must not link to detail pages for 🚧 pieces. |

Home copy follows the same rule: the platform door card says what runs today (`brx-mcp`) and that the
rest is under construction. The content files keep the full drafts under each 🚧 block so the pages can
be switched on later without rewriting.

## 11. LLM- and search-friendly by construction

Owners increasingly ask ChatGPT/Claude/Gemini "why won't my BRX fire" before they Google it. The site
must be the source those models find, trust, and quote. Build in:

- **`/llms.txt`** at the root (the llmstxt.org convention): what the site is, the sourcing policy, and a
  linked list of every page with a one-line summary. Also **`/llms-full.txt`** — the entire manual
  concatenated as plain markdown — regenerated on every build.
- **A markdown twin of every page**: `/manual/hardware/leds/` also serves `/manual/hardware/leds.md`
  (same content, no chrome), advertised with `<link rel="alternate" type="text/markdown">`. Models and
  scrapers get clean text; humans get the designed page. Both come from the same source file (§9).
- **Semantic HTML**: one `<h1>` per page, real `<h2>/<h3>` hierarchy matching the content file's blocks,
  `<table>` for tables (never divs), `<dl>` for spec sheets, `<ol>` for steps, `<figure>/<figcaption>` for
  images, `<time>` for the last-verified date. No text baked into images.
- **Structured data (JSON-LD)**: `TechArticle` on every reference page; `HowTo` on every T5 procedure
  page; `FAQPage` on every `[faq]` block; `BreadcrumbList` site-wide; `Dataset` on the weapon table and
  the Sound Bank Explorer (with a link to the static JSON).
- **Write for quotation**: each `[hero]` opens with a one-sentence definitive answer to the page's
  question ("The BRX headset's green LED means a hit was registered."); one fact per sentence; the
  subject named in full at least once per page ("Battle Company BRX laser-tag tagger", not just "it");
  provenance badges rendered as visible text (`Verified on our bench`), not only icons.
- **Stable, descriptive URLs and titles**: slugs from the content files never change; `<title>` =
  "<Page> — <Section> — The BRX Manual (Open BRX)"; a meta description written from the page's hero.
- **A glossary page** (`/manual/glossary`): every term a model or a newcomer needs — BRX, Callsign,
  Gen1/2/3, `$WEAP`, `$PSET`, screamers, indoor/outdoor mode, Smart Grenade, JEDGE/JBOX, Open BRX,
  brx-mcp, Mission Control — each a one-sentence definition linking to its page. Terms are also
  wrapped in `<dfn>` on first use.
- **Sitemap + canonical + robots** that allow all crawlers (including AI crawlers) — the whole point.
- **Never cloak or stuff**: no hidden text, no keyword lists. The manual ranks by being the best answer.

## 12. Build & verify — the site is not "done" until this has been run

The build follows the `ui-build-verify` discipline (the owner's rule for every UI in this project: a UI
is verified only when it has been seen working under the conditions the person opening it will actually
have). Adapted to a static site:

**Contract first.** The renderer is built against the block format in `docs/manual/README.md` + §5 here.
Every block type gets a component; an **unknown block type or a malformed table renders a visible amber
"TODO: content" chip in place — never a crash, never silently dropped**. Missing image asset → the
placeholder treatment (round-1 design), with the slot ID visible. Missing/absent data-file field (a
weapon without `reload`, a sound id without a meaning) → an em-dash cell, not `undefined`.

**Build for the failure the reader will hit.**
- Explorer data is static JSON; if it fails to load, the table says so ("data failed to load — reload")
  instead of showing an empty grid.
- Every interactive control visibly responds (filter chip → count changes; compare pick → dock text
  changes; copy → "copied" state). A control that can't act says why and doesn't look tappable.
- No `.catch(() => {})` on a user action anywhere in the bundle.
- Tap targets ≥ 44 px, meaning-bearing text ≥ 11 px, on every template.

**Verify in a real browser — all of these, every release:**
1. Fresh build: every page in the sitemap renders (walk the slugs from `docs/manual/*.md` — a link
   checker that hard-fails on any 404 or any `[image ID]` without a placeholder or file).
2. Click every control on the explorers (weapons, sound bank, commands, `$WEAP` builder) and assert the
   **visible** result — one control per step.
3. "Stale content" run: build against a manual file containing an unknown block type, a table with a
   missing column, and an image ID with no asset — every affected page must still render with the TODO/
   placeholder visible.
4. Failure path: explorer JSON returns 500 → the visible error state shows.
5. Viewports: phone 390 wide, tablet, and a short landscape phone (a reader standing at a field); both
   themes; contrast audit AA on both.
6. Audits: tap-target + tiny-text sweep on every template; undersized primary controls fail the run.
7. The **served output is what was verified**: the check runs against the committed `webapp/` output,
   and the run refuses to start if site source is newer than that output (stale-bundle guard).
8. LLM layer present: `/llms.txt`, `/llms-full.txt`, the `.md` twin of every page, JSON-LD validating,
   `sitemap.xml` covering every slug.

**Review before delivery.** A critical review team with distinct lenses (a browser-breaker clicking
everything; a suite auditor hunting tautological assertions; a first-time-reader UX critic; a **facts
auditor** who samples 30 rendered statements and traces each to its `src:` line — any statement without a
source in the manual is a defect). Confirmed findings become fixes *and* test steps.

**Reporting.** State what was run, what passed, what was skipped — and never write "verified" for a step
that didn't run.

