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
`wrangler.toml`, and **a push to `main` deploys it**. ⚠ **The built pages are still committed**, and
Cloudflare serves `webapp/` exactly as pushed: build before you commit, or you publish a stale site.
The root `npm run build` and the `[build]` block exist for the move to deploy-time builds, but
push-to-deploy uses the build command set in the Cloudflare dashboard and that is not set yet
(FOLLOWUPS B24; the command to set is `npm run build:ci`, which drops the dev dependencies). `webapp/mc/` and `webapp/download/` are hand-committed and the generator refuses to
write into them.

**Editorial rule.** Only confirmed facts are published. There is no per-sentence confidence marking:
that lives in `docs/experiment-log/` and `docs/FOLLOWUPS.md`. See
[`../manual/README.md`](../manual/README.md).
