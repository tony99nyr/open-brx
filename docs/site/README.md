# The public website

The Open BRX site is a static generator, `site/`, that renders two doors from one source: the
platform pages (`docs/platform/*.md`) into the marketing landing at `/`, `/docs/*` and `/download`,
and the manual pages (`docs/manual/*.md`) into `/manual/*`. 16 pages, one per source file. Nothing is
written twice.

| File | What |
|---|---|
| [`FORMAT.md`](FORMAT.md) | **The contract.** The source format, the file-to-URL map, landing-page rules, the one extension, and the house style. If it is not in there, it is not a feature. |

`docs/archive/site/SIMPLIFY-PLAN.md` has the history of why the site looks like this (what the old
block-DSL generator cost, what was cut, what was measured) — history, not instructions.

**The build.** `cd site && npm ci` once, then:

- The landing embeds the real phone HUD as a tap-to-try demo, so build the app first: `cd app && npm
  run build`. `site/build.mjs` fails if `app/www` is missing.
- `npm run build` renders `docs/platform/*.md` and `docs/manual/*.md` into `webapp/`.
- `npm run shots` drives the built MC UI (`?mock`) and the HUD (`?demo`) with Playwright into
  `site/shots/` (committed, content-hashed on publish); `mcp/tests/test_site_shots.py` fails once
  `webapp/mc/src` or `app/src` has moved past `site/shots/manifest.json`.
- `npm test` builds first (with the app build above as its own prerequisite), then runs the
  Playwright gate: every page renders, landing pages carry no dates or status language, internal
  links resolve, the markdown twins keep their tables, both generated `data` tables load and filter,
  a failed data fetch says so, theme persists, no sideways scroll on a phone, old URLs redirect, 404
  works. `site/test/site.spec.mjs` is the source of truth for exactly what it checks.
- `npm run serve` previews `webapp/` on :4173.

**Where it ships.** `webapp/` is published as an assets-only Cloudflare Worker via the root
`wrangler.toml`, and **a push to `main` deploys it**. Cloudflare rebuilds the site itself: Workers
Builds runs `npx wrangler deploy`, and `wrangler deploy` runs the `[build]` command
(`npm run build:ci`) before reading the assets directory. **The generated pages are git-ignored**, so
a push cannot publish a stale build and you never need to rebuild before committing. `webapp/mc/` and
`webapp/download/build.json` are hand-kept; the generator writes only `webapp/download/index.html`
into that shared directory and otherwise refuses to touch either path (`site/build.mjs`), and
`.assetsignore` keeps `mc/` from being served as a doc page.

**Editorial rule.** Only confirmed facts are published. There is no per-sentence confidence marking:
that lives in `docs/experiment-log/` and `docs/FOLLOWUPS.md`. See
[`../manual/README.md`](../manual/README.md).
