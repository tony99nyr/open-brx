# The public website

The Open BRX site is `docs/manual/*.md` rendered into `webapp/` by `site/` at the repo root. Nine
pages, one per manual file. Nothing is written twice.

| File | What |
|---|---|
| [`FORMAT.md`](FORMAT.md) | **The contract.** The source format, the file-to-URL map, the one extension, and the house style. If it is not in there, it is not a feature. |
| [`SIMPLIFY-PLAN.md`](SIMPLIFY-PLAN.md) | Why the site looks like this: what the old block-DSL generator cost, what was cut, and what was measured. History, not instructions. |

**The build.** `cd site && npm ci` once, then:

- `npm run build` renders `docs/manual/*.md` into `webapp/`.
- `npm test` builds and runs the Playwright gate (every page renders, no leftover block markers or
  provenance marks, internal links resolve, the markdown twins keep their tables, both generated
  tables load and filter, a failed data fetch says so, theme persists, no sideways scroll on a
  phone, 404 works).
- `npm run serve` previews `webapp/` on :4173.

**Where it ships.** `webapp/` is published as an assets-only Cloudflare Worker via the root
`wrangler.toml`, and **a push to `main` deploys it**. Cloudflare rebuilds the site itself: Workers
Builds runs `npx wrangler deploy`, and `wrangler deploy` runs the `[build]` command
(`npm run build:ci`) before reading the assets directory. **The generated pages are git-ignored**, so
a push cannot publish a stale build and you never need to rebuild before committing. `webapp/mc/`,
`webapp/download/`, `webapp/favicon.svg` and `webapp/.assetsignore` are hand-kept; the generator
refuses to write into the first two, and `.assetsignore` keeps `mc/` from being served.

**Editorial rule.** Only confirmed facts are published. There is no per-sentence confidence marking:
that lives in `docs/experiment-log/` and `docs/FOLLOWUPS.md`. See
[`../manual/README.md`](../manual/README.md).
