# Open BRX website — design package

The design package for the public **Open BRX** site: the homepage + **The Ultimate BRX Manual** (the
first thing we ship) + the platform overview. It was the hand-off to Claude Design; the site now exists (below).

**The content is not in this directory.** The manual's pages live in [`../manual/`](../manual/README.md)
— those files are the repo's canonical BRX documentation *and* the site's input; the site is built from
them so nothing is written twice (brief §9).

| File | What |
|---|---|
| [`BRIEF-open-brx-site.md`](BRIEF-open-brx-site.md) | The parts of the design brief that are still load-bearing: §2 tone and the known-facts rule, **§5 the block vocabulary** the manual is written in (the renderer's contract, referenced from `../manual/README.md`), **§10 under-construction policy**, **§11 LLM/search-friendly requirements**. The full original brief is archived in `../archive/site/`. |
| [`images-priority.md`](images-priority.md) | **Work from this.** The 12 images that matter (7 to launch, 5 for polish), Gemini prompts rewritten for how the model actually behaves, and the photo-first workflow (your own phone photo → Gemini relight/edit) for anything showing the real BRX. |
| [`tools/build_images.py`](tools/build_images.py) | Regenerates the full 84-slot image manifest (`images.md`) from the manual files' image tables. The last generated copy, the round-1 design handoff and the round-1 notes are archived in `../archive/site/`; the manual's own image tables are the source. |

**The build (it exists).** `site/` at the repo root is the generator: `cd site && npm ci && npm run build`
renders `docs/manual/*.md` into `webapp/` (pages + `.md` twins + `llms.txt`/`llms-full.txt` + sitemap +
JSON-LD + the weapons/sound-bank explorer data); `npm test` runs the Playwright suite that implements
brief §12 (fresh build crawl, every control, stale-content fixture, 500 failure paths, viewports,
tap-target/tiny-text audits, machine-readable layer) on desktop + phone, and refuses to run if any source is
newer than the built output. `npm run serve` previews `webapp/` on :4173. Real photos go in
`docs/manual/img/<ID>.<ext>` and are picked up by ID.

**Where it ships.** `webapp/` is published as an assets-only Cloudflare Worker via the root
`wrangler.toml` — **a push to `main` deploys it**; Cloudflare builds from the repo, so `webapp/` goes
live exactly as committed. Push a stale `webapp/` and you publish a stale site, so build and run the
suite first. (`npx wrangler deploy` from the repo root still works for a local deploy without a commit;
wrangler is logged in from WSL. A push did not redeploy before 2026-08-30.) The built site goes into `webapp/`
(`index.html` = Home, `manual/`, `platform/`, `llms.txt`); site source stays outside the published tree;
`webapp/mc/` and `app/` (Mission Control UI, phone HUD — still in development) are not touched.

**Editorial rule.** Known facts only, with provenance badges; anything unconfirmed lives in each manual
file's *Research backlog* and is never rendered. Details: [`../manual/README.md`](../manual/README.md).
