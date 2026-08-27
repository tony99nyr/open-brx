# Handoff: Open BRX Website (first pass)

## Overview
Public website for **Open BRX**: "The Ultimate BRX Manual" (definitive reference for the Battle Company BRX laser-tag tagger + headset) plus the Open BRX platform pages. This handoff covers the first design pass: the Home page (T1), four of the six page templates (T2, T3, T4, T5, T6), and the block/badge component sheet in both themes.

Read alongside the source brief: `uploads/BRIEFopenbrxsite.md` (IA, templates, block vocabulary, hard constraints) and `uploads/images.md` (all 84 image slots: GENERATE vs REAL PHOTO vs SVG-built-in-site).

## About the Design Files
`Open BRX Site.dc.html` is a **design reference created in HTML** — a canvas of eight labeled frames (1a–1h) showing intended look and behavior. It is NOT production code. Recreate these designs in the target stack — the brief suggests a static site (Astro or Next static export, MDX content, static JSON for explorer data, Pagefind search); the repo already has `webapp/` (Vite/React/TS) if component sharing with Mission Control matters.

## Fidelity
**High-fidelity for visuals** (colors, type, spacing, badge/block designs are final direction) but **content-incomplete by design**: every amber `TODO: content` chip marks a fact that must come from the `content/*.md` files — the hard constraint is that no fact on the site may be invented. Do not replace TODO chips with made-up copy; wire them to real content.

## Frames in the design file
| id | What it is |
|---|---|
| 1a | T1 Home, desktop 1280 |
| 1b | T1 Home, phone 390 |
| 1c | T2 Section hub — /manual |
| 1d | T3 Reference page — /manual/hardware/anatomy (sidebar + right-rail TOC + hotspot image) |
| 1e | T4 Data explorer — /manual/gameplay/weapons (working search/filter/compare-pick) |
| 1f | T5 Procedure — headset re-pair, phone |
| 1g | T6 Diagnostic ladder — "won't fire", phone |
| 1h | Component sheet — §5 blocks + badges, dark & light |

## Screens / Views

### 1a · Home (T1) — desktop
- **Top bar** (56px, border-bottom 1px rgba(232,238,245,.08)): reticle-bracket logo mark (22px circle, 2px #39b4ff stroke, left side opens into a bracket) + "OPEN BRX" (Oswald 600, 16px, letter-spacing .06em); nav Manual / Platform / Credits / Changelog (13px/500, active = 2px #39b4ff bottom border); right: search pill (⌘K), theme toggle, GitHub link.
- **Hero** (21:9, image slot HOME-01): left gradient scrim rgba(12,16,22,.92)→.2; kicker in JetBrains Mono 12px #39b4ff letter-spacing .14em "OPEN-SOURCE · SELF-HOSTED · REVERSE-ENGINEERED"; H1 Oswald 600 56px/1.08 max-width 640px — exact copy: "Video game inspired tactical laser tag — open and self-hosted."; TODO chip for the subline; two buttons: filled #39b4ff (text #0c1016, 600/14px, radius 6, 12×22 padding) "Read the manual" + outlined "Explore the platform".
- **Two door cards** (2-col grid, gap 20, panels #141b24, radius 10, border rgba(232,238,245,.09)): Manual door (HOME-05 1:1 thumb, "The Ultimate BRX Manual") and Platform door (HOME-04 16:9 thumb, "The Open BRX platform") — platform card carries the three status badges.
- **Stat row** (4-col): big numbers Oswald 600 34px tabular over 2px #39b4ff top rule — 20 weapons / 2,166 sound ids / 11 game modes / 43 $WEAP tokens. (All four numbers trace to the brief.)
- **"How it's wired" teaser** (HOME-02, built as SVG/HTML in the real site): LAPTOP —dashed Wi-Fi— PHONE ×n —solid BLE— GUN —dotted amber IR→— GUN. Boxes are JetBrains Mono 11px chips; blue for host/base, amber for IR.
- **Credits footer** (#0a0e13): "Protocol discovered by LaserTagMods (JEDGE / JBOX) · Hardware by Battle Company · Fixes by the owner community." + non-affiliation line. Links: Credits · Changelog · GitHub.
- Note: the home page is **static** — no "latest updates" strip; the /changelog page is the record of occasional updates.

### 1b · Home — phone (390)
Same content stacked: hamburger + logo + search icon bar (44px hit targets); hero text block; two full-width CTA buttons (14px padding, radius 8); door cards stacked; stats 2×2; condensed credits footer.

### 1c · Manual hub (T2)
Two-column: main (title Oswald 40px, "last verified" meta line, TODO intro chip, 2×3 grid of section cards) + 300px rail (HOME-03 4:3 REAL PHOTO slot, "START HERE IF…" panel with three arrow rows: New gun → Quick start · Something's broken → Diagnose my tagger · You write code → Protocol reference). Section cards: big Oswald number in #39b4ff (01–06), title 17px, one-line summary 12px #8b98a8 — summaries taken verbatim from the brief's IA table.

### 1d · Reference page (T3)
Three columns: 250px sidebar (#0a0e13, section tree, active page = rgba(57,180,255,.1) bg + 2px left #39b4ff), content, 210px right rail ("ON THIS PAGE" TOC, active = blue + left rule).
- Breadcrumb 12px #5f7a93 → title Oswald 34px → meta row: confidence badge + "last verified YYYY-MM-DD" + TODO chip.
- **HW-02 anatomy image** with HTML hotspot overlays: 10px #39b4ff dot with 4px rgba(57,180,255,.2) halo + JetBrains Mono 10px label chip (bg rgba(12,16,22,.85), border rgba(57,180,255,.3)). Full hotspot list: trigger, reload handle, ALT, SELECT, LEFT/RIGHT, power switch, emitter, body sensor, LED bank, sight, speaker, charging port, micro-USB.
- **Spec-sheet block**: panel #141b24, mono label header, 180px/1fr key-value grid, inline confidence badges, muted source line linking the repo file.
- Prev/next row, "Was this useful? Yes/No + Report an error" footer.

### 1e · Weapons explorer (T4)
- Sticky filter bar (bg rgba(12,16,22,.95)): search input (#141b24, radius 6), class chips (All, Assault, CQB, Marksman, Support, Power, Melee — active chip filled #39b4ff w/ dark text, inactive outlined), "N of 20 shown", Export CSV button.
- Table: 7-col grid (WEAPON 2fr / CLASS 1.2 / FIRE MODE 1.2 / DAMAGE 1 / RATE 1 / AMMO 1 / CONFIDENCE 1.3), mono 10px letter-spaced header, zebra rgba(232,238,245,.015), row checkbox (accent #39b4ff) picks up to 2 for the comparator.
- Comparator dock (#0a0e13 footer strip): message state — none picked / 1 picked / 2 picked.
- **Behavior to implement**: live search over name+class; single-select class facet; compare selection capped at 2 (oldest dropped); selected row bg rgba(57,180,255,.07). Weapon names/stats are TODO — ship structure now, bind `content/03-gameplay.md` data (static JSON) later. Row → detail drawer and side-by-side stat bars come with the data.

### 1f · Procedure (T5) — phone
Title, TODO confidence badge, "BEFORE YOU START" prerequisites panel, numbered steps (numeral Oswald 700 30px #39b4ff, 34px column) each with a 4:3 REAL PHOTO slot (FIX-07 frames), amber "If this fails →" callout linking into troubleshooting, source line. Steps copy (traceable to FIX-07 in images.md): 1 Hold the headset button · 2 Boot the tagger while holding RIGHT on the D-pad · 3 Pull the trigger.

### 1g · Diagnostic ladder (T6) — phone
Kicker "SYMPTOM" (mono 10px blue) → title. Check cards (#141b24): "CHECK n" Oswald 700 16px #39b4ff, TODO check text, two 44px+ buttons "Yes → fix" (green outline #7ddb8a) / "No → next"; cards joined by a 2px vertical blue connector; ladder ends in an amber "exhausted → community / repair guide" card. Sticky bottom bar: "On this page ▴" + "Wizard mode".

### 1h · Component sheet
Both themes side by side; see Design Tokens + component specs below.

## Components (the §5 block vocabulary)

**Confidence badges** (first-class component, used inline everywhere): pill, inline-flex, gap 5px, 11px/600, radius 999, padding 3×10, translucent tinted bg (8% of the text color) + 25% border.
- Dark theme colors: ✅ verified on our bench #7ddb8a · 📖 official docs #8fb6d9 · 🔍 decoded from the app #39b4ff · 👥 community #c9a7e8 · ❓ unconfirmed #8b98a8.
- Status set (platform): ✅ proven on hardware #7ddb8a · 🧪 software-tested #39b4ff · 📐 specified only #8b98a8.
- Light theme: ✅ #1c7a2e · 📖 #3d6a8f · 🔍 #0b78c2 · 👥 #7b4fa3 · ❓ #5c6b7c (7% bg, 30% border) — chosen for WCAG AA on #f4f6f9.

**Callouts**: radius 8, 12×14 padding, 13px/1.5. Warn = amber (dark: bg rgba(255,176,32,.06), border .35; light: #9a6400 on rgba(178,116,0,.06)). Tip = blue. Info = neutral grey. Bold lead-in ("⚠ Warning") + ≤3 lines.

**Code block**: bg #0a0e13 (stays dark in BOTH themes), radius 8, JetBrains Mono 14px; header row with language chip + "copy ⧉"; token coloring: $ and * in #39b4ff, separators #5f7a93; empty tokens highlighted amber (rgba(255,176,32,.15) bg, .4 border) with the note "empty = leave unchanged".

**Bit-field**: flexbox spans with flex = bit width, 2px gaps; each cell mono 10px centered, tinted per field group; bit ruler (bit 0 … bit 24) beneath in mono 9px.

**Table**: radius-8 bordered wrapper, header row #141b24 mono 10px letter-spacing .08em, zebra rgba(232,238,245,.02), trailing CONF. column with badge glyphs.

**Spec-sheet**: two-column key/value grid (keys #8b98a8, values JetBrains Mono 12px), inline badges, source line.

**Stat-row**: Oswald 600 26–34px tabular numbers, 11-12px muted labels.

**Quote**: 2px #39b4ff left border, italic 13px, credited.

**Source line** (on every block): 11px #5f7a93, "source:" + blue link to the repo file.

**TODO chip** (`data-todo` attr): JetBrains Mono 10px #ffb020, 1px dashed rgba(255,176,32,.5) border, radius 3, padding 1×6. Site-wide visibility toggle exists in the prototype (Tweaks prop `showTodo`).

**Image placeholders** (until assets land — treatment is a deliverable):
- GENERATE slots: blue — repeating-linear-gradient(135deg, rgba(57,180,255,.06) 0 1px, transparent 1px 12–14px) over #0e141c, 1px dashed rgba(57,180,255,.3), radius 6-8; mono 9-10px caption "ID · ratio · GENERATE · one-line description", bottom-left.
- REAL PHOTO slots: same but amber (rgba(255,176,32,…)) + the shot brief line. Correct aspect-ratio via CSS `aspect-ratio`.

## Interactions & Behavior
- Weapons explorer: see 1e. Everything else in this pass is static.
- Search (⌘K) is designed as a pill in the top bar; not implemented in the prototype. Must index page titles, headings, table rows (weapon names, sound ids, commands) and FAQ, grouped by section (brief §3) — Pagefind or static index.
- Theme toggle (◐ icon) designed, not wired; both themes fully specified in frame 1h.
- Mobile: hamburger → section tree; sticky bottom "On this page" sheet (see 1g); all tap targets ≥44px; tables scroll horizontally inside their container, never the page.
- Hover states not specified in this pass — keep restrained (link color shift #39b4ff → #7fd0ff; card border brighten).

## State Management
- Explorer pages: local UI state only (query string, active facet, compare picks ≤2, open drawer row). Data ships as static JSON built from the repo — no client-side fetching of content.
- Theme: dark default, persisted preference, light theme fully tokenized.
- No global app state needed; the site is static.

## Design Tokens
Colors (dark, default):
- Ground #0c1016 · deep ground / footer #0a0e13 · panel #141b24 · placeholder ground #0e141c
- Ink #e8eef5 · secondary #c6d2df · muted #8b98a8 · faint #5f7a93
- Accent #39b4ff (hover #7fd0ff) · amber #ffb020 · success/verified #7ddb8a · community #c9a7e8 · official #8fb6d9
- Hairlines: rgba(232,238,245,.05/.08/.09/.1) by depth
Light theme: ground #f4f6f9 · panel #ffffff · ink #10161d · body #3c4652 · muted #5c6b7c · accent #0b78c2 · amber #9a6400 · hairline rgba(16,22,29,.1). Code blocks stay dark.
Typography:
- Display: Oswald 500–700 (titles 26/34/40/56px, stat numbers, step numerals). Condensed alt per brief: Rajdhani.
- UI/body: Inter 400–700 (body 13-14px/1.5-1.6, nav 13px/500).
- Mono: JetBrains Mono 400-500 (chips/meta 9-12px, code 14px). All numbers tabular (font-variant-numeric: tabular-nums).
Radii: chips 3-4 · inputs/buttons/blocks 6-8 · cards/frames 10 · badges 999.
Spacing: page gutter 72px desktop / 20px phone; card padding 16-22px; grid gaps 12-20px.
Shadows: frame-level only (0 24px 60px rgba(0,0,0,.5)); components rely on borders, not shadows.

## Assets
No final assets exist yet. All 84 image slots (IDs, ratios, GENERATE prompts, REAL PHOTO shot briefs, SVG diagram specs) are in `uploads/images.md`. File naming: `<ID>.<ext>` (e.g. HW-03.png). Diagrams marked SVG (HOME-02, DEV-02…09, GAME-09/10/14, PLAT-05…09) are built in-site, not generated. Never rehost Battle Company assets (PDFs, audio, app screenshots) — link out.

## Hard constraints (from the brief — enforce in code review)
1. Facts only from content files; TODO slots, never invented copy.
2. Confidence/status badges mandatory wherever content carries one.
3. Real photos for hardware; placeholders until the shoot.
4. No trademarks in generated art; never imply Battle Company endorsement.
5. Mobile-first manual; fast + static; every page dated + sourced; WCAG AA both themes.

## Files
- `Open BRX Site.dc.html` — the design canvas (frames 1a–1h). Open in a browser.
- `uploads/BRIEFopenbrxsite.md` — full brief (IA, templates T1–T6, block vocabulary, constraints).
- `uploads/images.md` — image manifest: 38 GENERATE / 29 REAL PHOTO / 17 SVG.
