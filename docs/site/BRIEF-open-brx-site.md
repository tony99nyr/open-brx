# Open BRX website — Claude Design brief

**Package for:** Claude Design. Build the public **Open BRX** website. The first thing it ships is
**The Ultimate BRX Manual** — the definitive reference for the Battle Company BRX laser-tag tagger and
headset — with the Open BRX platform (open-source software + hardware that orchestrates BRX taggers)
presented alongside it.

**Trimmed 2026-09-06.** The site is built and deployed (`site/` at the repo root renders `../manual/*.md`
into `webapp/`; see [`README.md`](README.md) for the build, the deploy and the test gate). This file now keeps
only the parts that are still load-bearing: the tone and known-facts rule (§2), the block vocabulary the
manual is written in and the renderer parses (§5, referenced from `../manual/README.md`), the
under-construction policy (§10) and the LLM/search requirements (§11). The original brief, with the
information architecture, templates, image plan and deploy notes, is in `../archive/site/`.

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
| `[image X]` / `[diagram X]` | slot from the section file's `## Images for this section` table; every image has a caption and, for anatomy, HTML hotspot labels over an unlabeled render |
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

## 10. Under-construction policy (what the platform pages may show right now)

The manual (sections 01–06) ships in full. The platform is mostly still being built, so the public site
shows it honestly and briefly:

| Piece | Public treatment |
|---|---|
| **`brx-mcp`** (CLI + MCP server) | **Shown in full.** It works today — Tier 0 (laptop-only) games are hardware-proven. It appears on Home, `/platform` and `/platform/pieces` as the thing you can run now, and `/manual/dev/brx-mcp` is the getting-started page. |
| **Mission Control** (operator console) | 🚧 `[under-construction]` card only. No screenshots, no phase walkthrough, no feature lists. |
| **BRX Combat HUD** (phone node app) | 🚧 card only, **except the download**: `/platform/app` publishes the Android test build via a `[download]` block (see §5), because a build people can install is the one thing the card cannot substitute for. Still no screenshots and no feature walkthrough until it has run a full match on hardware. |
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
