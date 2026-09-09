# The manual source format

This is the whole contract between `docs/manual/*.md` and the site generator (`site/build.mjs`).
If something is not on this page, it is not a feature. Adopted 2026-09-09 (see `SIMPLIFY-PLAN.md`).

## One file, one page

| File | URL | Title |
|---|---|---|
| `docs/manual/index.md` | `/` | Open BRX |
| `docs/manual/hardware.md` | `/manual/hardware` | Meet the BRX |
| `docs/manual/operate.md` | `/manual/operate` | Operating the BRX |
| `docs/manual/gameplay.md` | `/manual/gameplay` | Gameplay |
| `docs/manual/sound.md` | `/manual/sound` | Sound, voice and updates |
| `docs/manual/fix.md` | `/manual/fix` | Fix, mod and accessorise |
| `docs/manual/dev.md` | `/manual/dev` | Developer reference |
| `docs/manual/platform.md` | `/platform` | The Open BRX platform |
| `docs/manual/credits.md` | `/credits` | Credits and sources |

The map lives in `site/build.mjs` and nowhere else. Adding a page means adding a file and a row.

## The file

```markdown
# Meet the BRX
Last verified: 2026-09-06

One or two plain sentences saying what this page covers.

## A section

Plain CommonMark. Paragraphs, lists, tables, code fences, blockquotes, links.

## Sources

- docs/reference/brx-extended-user-guide.md
- protocol/brx-protocol.md
```

Rules, all of them:

1. **The first line is `# Title`.** It becomes the `<h1>`, the `<title>` and the nav label.
2. **The second line may be `Last verified: YYYY-MM-DD`.** Optional. Rendered as a `<time>` under
   the H1. Nothing else goes in the header.
3. **Everything else is plain CommonMark.** No block markers, no badges, no `src:` lines, no page
   markers, no image manifests, no research backlogs, no audience or goal lines.
4. **`## Sources` is the last section** if the page has one. A plain bulleted list of repo paths.
5. **`##` headings get anchors and appear in the page's table of contents.** `###` and deeper do
   not. So `##` is the unit of navigation: one per thing a reader would link to. A page with two or
   fewer `##` headings gets no table of contents at all.

## The one extension: generated data tables

A fenced block with the language `data` and a single keyword on its own line is replaced by a
filterable table rendered in the browser from JSON the build writes:

````markdown
```data
weapons
```
````

Keywords: `weapons` (from `mcp/brx_mcp/mc/weapons.json`) and `sounds` (from
`mcp/brx_mcp/data/sound_catalog.json`). The JSON is the only source. The build never reads facts
out of manual prose.

This is valid CommonMark, so an un-built file degrades to a visible code block rather than to
garbage.

## House style

- **No em dashes.** The build fails on one. Use a period, a colon, or parentheses.
- **Write for a player.** Short sentences. Say "you". Active voice. State the fact first.
- **No marketing.** No superlatives, no positioning against other products, no "we built this by".
  The manual is useful or it is not; it does not argue that it is.
- **The developer reference is exact.** In `dev.md`, every command, token, field name and wire
  value stays literal. Simplify the prose around a table, never the table.
- **No provenance marks in the prose.** Confidence is not published per sentence. The rule that
  only confirmed facts get published is unchanged and lives in `docs/manual/README.md`; the
  evidence lives in `docs/experiment-log/` and `docs/FOLLOWUPS.md`.

## What the build produces

For each file: `<slug>/index.html` and `<slug>.md` (a byte-for-byte copy of the source). Plus
`sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt`, `data/weapons.json`, `data/sounds.json`,
`_redirects`, `404.html`, `.site-manifest.json`, and the hashed CSS/JS. Nothing else.

## Old URLs

The site published 74 URLs before 2026-09-09. The 65 that went away are absorbed by splat rules in
`site/public/_redirects`, copied into the build verbatim and parsed natively by Cloudflare. That
file is frozen history: the old URL set cannot grow, so it never needs editing. `site/test/old-urls.txt`
is the frozen list, and a test step fails if any entry would 404 or if a rule points at a page that
does not exist.
