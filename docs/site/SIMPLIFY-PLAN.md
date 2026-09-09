# Plan: drastically simplify the Open BRX site

**Status:** ACCEPTED 2026-09-09, in execution. Decisions: ~10 pages (one per file); all provenance
labelling deleted; platform reduced to one page; full scope including the Cloudflare build move. Supersedes `BRIEF-open-brx-site.md` §5/§10/§11 if adopted.
**Goal, in the owner's words:** prioritise *my* maintainability over the site's usability. Make the
content management much more direct. Less marketing. Adjust the prose. Images and provenance
labelling are out of scope (dropped, not redesigned).

---

## 1. What exists today (measured, not estimated)

| Thing | Size |
|---|---|
| Manual source, `docs/manual/*.md` | 3,819 lines / 451 KB in 8 files |
| Pages published | 74 HTML + 74 markdown twins |
| Custom block types in the DSL | 21 |
| Block instances to author and maintain | ~450 |
| Provenance badge glyphs inline in the prose | 1,524 |
| `src:` citations inline in the prose | ~700, hitting ~25 real evidence files |
| Image manifest tables (Gemini prompts, no photos exist) | 54 KB = 12% of the manual |
| Generator | 1,009 lines (`build` 338, `render` 380, `parse` 135, `data` 84, `sources` 36) |
| Hand-written CSS / JS | 472 + 192 lines |
| Playwright gate | 779 lines, ~109 steps |
| Design package `docs/site/` | 401 lines |
| Build time | 0.17 s |

**The cost is not the build. It is the authoring contract.** To add one fact today you must pick a
block type from 21, know that a bold lead-in needs its colon *outside* the bold because `splitLead()`
reads it, attach the right badge glyph, append a `src:` line in one of several accepted positions,
decide which of 74 pages it belongs on, bump a `Last verified:` stamp, maybe add a changelog entry in
`00-home.md`, rebuild, commit 74 pages of output, and hope the 109-step Playwright suite agrees.

## 2. Concrete defects the complexity is already causing

These are verified, not hypothetical:

- **The markdown twins lose table headers.** `[table] X - columns: A | B | C` renders real `<th>`
  in HTML but emits `| col 1 | col 2 | col 3 |` in the `.md` twin. 12 tables affected. The twins
  are the thing `llms.txt` exists to serve, so the LLM-facing copy is the broken one.
- **Every build dirties the tree with nothing.** A no-op rebuild rewrites four files
  (`.site-manifest.json`, `data/*.json`, `llms-full.txt`) with only a changed timestamp.
- **Template edits produce 80-to-135-file commits.** Content and output are committed together, so
  the git history of the manual is mostly generated noise.
- **A retracted fact sat in the canonical manual marked verified** until a sweep found it
  (commit `bd7768b`). 1,524 badges is more provenance surface than one person can keep true.
- **The data explorers scrape the manual's own prose.** `buildSounds()` finds sound-family meanings
  by matching column names (`family`/`prefix` + `meaning`/`category`/`what it holds`…) inside
  `04-sound.md`. Renaming a table column silently changes published data.

## 3. The proposal

### 3.1 Kill the block DSL. The manual becomes plain CommonMark.

One authoring rule replaces 21 block types: **write markdown**. Headings, paragraphs, lists, tables,
code fences, blockquotes. Nothing else.

Mechanical mapping for the rewrite:

| Today | Becomes |
|---|---|
| `[hero]` | the first paragraph |
| `[callout:info/warn/tip]` | `> **Note.**` blockquote (three styles collapse to one) |
| `[steps]` | ordered list |
| `[cards]` | bulleted list |
| `[table]`, `[compare]`, `[timeline]`, `[pricing-tiers]`, `[spec-sheet]`, `[stat-row]`, `[bit-field]` | a markdown table |
| `[symptom-ladder]` | ordered list |
| `[accordion]`, `[faq]` | `###` heading + paragraph |
| `[code lang]` | fenced code block |
| `[quote]` | blockquote |
| `[image]`, `[diagram]` | deleted (out of scope) |
| `[data-table:filterable]` | see §3.5 |
| `[under-construction]` | see §3.4 |

The renderer keeps one non-standard affordance and no more: **the last-verified date**, as a
`Last verified: YYYY-MM-DD` line under the H1.

### 3.2 Cut 74 pages to about 10. One file, one page.

Today an 898-line file explodes into 12 URLs; a reader needs the sidebar, breadcrumbs, an
on-this-page rail, and a search box to navigate what is really one document. Proposed set:

```
/                     home (short: what this is, two links, nothing else)
/manual/hardware      Meet the BRX
/manual/operate       Operating the BRX
/manual/gameplay      Gameplay
/manual/sound         Sound, voice and updates
/manual/fix           Fix, mod and accessorise
/manual/dev           Developer reference
/platform             Open BRX (one page, see §3.4)
/credits              credits and sourcing policy
```

Nine pages. A long page with a table of contents is *easier* to search (Ctrl-F works), easier to
link into, easier to read on a phone at the field, and removes the whole navigation apparatus:
sidebar, breadcrumb builder, TOC rail with active-state JS, ⌘K search index, and the slug/alias/link
resolution map in `build.mjs`.

Only `06-developer.md` is genuinely long enough to argue about. Recommendation: keep it as one page
anyway. It is a reference people Ctrl-F, not a narrative they read.

### 3.3 Drop provenance labelling entirely (per your instruction), and replace it with one honest line.

Delete all 1,524 badge glyphs and all ~700 inline `src:` citations from the prose. Replace with:

- One sentence in the site footer and on `/credits`: what the sources are, that the repo is public,
  and that anything unconfirmed is not published.
- Per page, one `Sources` section at the bottom: a plain list of the evidence files, unlinked to
  individual sentences.

This is the single biggest reduction in authoring ceremony in the plan. The *policy* ("known facts
only", contradictions stay out) survives untouched; only the per-sentence bookkeeping goes. The
`docs/experiment-log/` notebook remains the real provenance record, which is where it belongs.

### 3.4 Cut the marketing. `/platform` becomes one honest page.

`07-platform.md` is 528 lines and 10 URLs of positioning: build-tier pricing tables, a competitor
comparison quoting Edge's `$599.99 / 6 months to $1,599.99 / year`, a roadmap, a "get involved"
page, 22 🚧 markers, and a stat row led by "**$0** to run your first full scored match".

Replace with one page that states, in plain sentences: what Open BRX is, what runs on real hardware
today, what does not exist yet, where the code is. No tiers, no competitor comparison, no roadmap,
no vision language. The vision belongs in `docs/VISION.md`, which is not published.

Prose changes across the whole manual, in the same spirit:

- Delete superlatives and positioning: "The **Ultimate** BRX Manual", "the **definitive**
  reference", "premium", "No subscription. No firmware mods. No venue Wi-Fi needed."
- Delete the self-referential framing: "We gathered all of it, checked what we could on the bench,
  and sorted it", "the manual is the magnet, the platform is the offer".
- Delete the per-file `**Audience:** … **Goal of this section:** …` headers. They are instructions
  to a designer, not content.
- Delete `## Interactive ideas`, `## Images for this section`, and the `## Research backlog`
  sections. Backlog items move to `docs/FOLLOWUPS.md`, which already exists for exactly this.
- Lead every section with the fact, not with what the section will do for you.

Keep the tone that already works: the symptom ladders in `05-fix-and-mod.md` are direct, specific
and useful. That is the target voice for the whole manual.

### 3.5 Keep the two generated data tables. Drop the third-party scraping.

The weapon roster and the sound bank are the site's genuinely unique assets and cost **zero**
authoring: they render from `mcp/brx_mcp/mc/weapons.json` and
`mcp/brx_mcp/data/sound_catalog.json`. Keep both, as plain sortable tables on their own pages.

Change one thing: stop enriching them by scraping markdown tables out of `04-sound.md`. Anything the
catalog JSON does not contain belongs in the JSON, not in prose the build parses.

### 3.6 Shrink the generator to roughly 150 lines.

What goes:

- `parse.mjs` (135) entirely. `marked` already parses markdown.
- Most of `render.mjs` (380): the 21-case block dispatch, badge rendering, source lines, figure
  handling, TOC, sidebar, breadcrumbs, JSON-LD.
- From `build.mjs` (338): the slug/title/alias resolution map, the search index, per-page JSON-LD.
- `site.js` (192): theme toggle and code-copy survive; ⌘K search, TOC active-state, mobile drawer,
  and the two explorer widgets are replaced by a ~40-line table filter or dropped.
- `docs/site/BRIEF-open-brx-site.md`, `images-priority.md`, `tools/build_images.py` (368 lines):
  delete. Images are out of scope.

What stays: read 8 markdown files → `marked` → one HTML template → write. Plus `sitemap.xml`,
`robots.txt`, `llms.txt`, the `.md` twin of each page (now a straight copy of the source, which
fixes the broken-table-header defect for free), and the two data tables.

### 3.7 Replace the 109-step Playwright gate with about 10 checks.

The current suite hard-codes page counts, prose fragments, sound-id totals, and the
under-construction policy. It will fight every step of this plan. Replace with:

1. Every page in the sitemap returns 200 and has exactly one `<h1>`.
2. No page contains an unrendered `[block]` marker or a `TODO`.
3. No em dash reaches a page (keep this rule; it is one regex and it works).
4. No internal link 404s.
5. The data tables have rows.
6. No console errors on any page.

Six checks, one file, well under 100 lines.

### 3.8 Stop committing the build output (optional, decide separately)

`webapp/` is committed, so a content edit is a two-part commit and a forgotten rebuild publishes a
stale site. Cloudflare can run the build itself. This is a real improvement but it is a *deploy*
change, not a content change, and `webapp/mc/` and `webapp/download/` are hand-committed into the
same directory. Recommendation: do it after the content work lands, as its own change.

## 4. Result (measured after the work, 2026-09-09)

| | Before | After |
|---|---|---|
| Manual source | 3,819 lines / 451 KB | 3,215 lines, and every line is publishable prose |
| Pages | 74 | 9 |
| Files in the built site | 160 | 27 |
| Block types to know | 21 | 0 |
| Provenance badges in the prose | 1,524 | 0 |
| `src:` citations in the prose | ~700 | 0 |
| Image manifest | 54 KB of prompts | deleted |
| Generator | 1,009 lines | 233 (`build.mjs` 190, `data.mjs` 26, `serve.mjs` 17) |
| CSS + JS | 664 lines | 202 |
| Test suite | 779 lines, ~109 steps | 146 lines, 18 steps |
| Design package `docs/site/` | 401 lines of brief and image tooling | 327 lines, and it is the format contract plus this plan |

The manual is not much shorter in lines, and that is the point: what went away was ceremony, not
facts. Every published command in the developer reference survived (checked by diffing the `$`
command sets; the only names that disappeared were in the unpublished research backlog).

**To add a fact now:** open one of nine markdown files, write a sentence, push. No block type, no
badge, no `src:` line, no page-placement decision.

## 5. Suggested order

1. **Prose and content cut first**, in the existing DSL: delete image manifests, interactive ideas,
   research backlogs, audience/goal headers, badges, `src:` lines, and the marketing copy. Rewrite
   `07-platform.md` down to one page. This is the bulk of the value and touches no code.
2. **Flatten to ~10 pages**: merge each file's pages into one document with `##` headings.
3. **Convert the remaining blocks to plain markdown** (mechanical, per the §3.1 table).
4. **Rewrite the generator** against the now-plain input.
5. **Replace the test suite.**
6. §3.8 (see below).

## 6. What is done, and the one step left

Steps 1 to 5 are done and verified: the manual is plain markdown, the generator is rewritten, the
gate is 18 browser checks and passes, and the repo's own suites (1,067 tests) are green.

Step 3.8 is **half done and deliberately stopped there.** The root `package.json` and the
`[build]` section in `wrangler.toml` are in place, so the site builds from source at deploy time.
The built pages are **still committed**, because push-to-deploy runs the build command configured in
the Cloudflare dashboard, not the one in `wrangler.toml`. Un-committing `webapp/` before that
setting exists would publish an empty site on the next push.

To finish it: set **Workers & Pages -> open-brx -> Settings -> Build -> Build command** to
`npm run build`, push once, confirm the deploy renders, and only then stop committing the generated
files.

Steps 1-3 are independently useful even if 4-6 never happen: the manual gets better and the site
keeps building.
