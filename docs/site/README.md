# Open BRX website — design package

The design package for the public **Open BRX** site: the homepage + **The Ultimate BRX Manual** (the
first thing we ship) + the platform overview. Hand this directory **plus [`../manual/`](../manual/README.md)**
to Claude Design.

**The content is not in this directory.** The manual's pages live in [`../manual/`](../manual/README.md)
— those files are the repo's canonical BRX documentation *and* the site's input; the site is built from
them so nothing is written twice (brief §9).

| File | What |
|---|---|
| [`BRIEF-open-brx-site.md`](BRIEF-open-brx-site.md) | **Read first.** Purpose, audiences, tone, information architecture, the 6 page templates, the block vocabulary the manual is written in, the interactive pieces, hard constraints, deliverables, **§9 deploy target (Cloudflare Worker serving `webapp/`)**, **§10 under-construction policy**, **§11 LLM/search-friendly requirements**. |
| [`images-priority.md`](images-priority.md) | **Work from this.** The 12 images that matter (7 to launch, 5 for polish), Gemini prompts rewritten for how the model actually behaves, and the photo-first workflow (your own phone photo → Gemini relight/edit) for anything showing the real BRX. |
| [`images.md`](images.md) | The full 84-slot backlog: every slot, shot brief, and diagram spec. Generated from the manual files' image tables by `tools/build_images.py` — edit the tables, not this file. |
| [`design-round-1-notes.md`](design-round-1-notes.md) | What came back from Claude Design round 1 and the deltas to carry into round 2 (❓ badge removed, 19 weapons, 🚧 pieces, new content paths, deploy target, LLM layer, the short image list). |
| [`tools/build_images.py`](tools/build_images.py) | Regenerates `images.md` from `../manual/*.md`. |

**The build (it exists).** `site/` at the repo root is the generator: `cd site && npm ci && npm run build`
renders `docs/manual/*.md` into `webapp/` (pages + `.md` twins + `llms.txt`/`llms-full.txt` + sitemap +
JSON-LD + the weapons/sound-bank explorer data); `npm test` runs the Playwright suite that implements
brief §12 (fresh build crawl, every control, stale-content fixture, 500 failure paths, viewports,
tap-target/tiny-text audits, machine-readable layer) on desktop + phone, and refuses to run if any source is
newer than the built output. `npm run serve` previews `webapp/` on :4173. Real photos go in
`docs/manual/img/<ID>.<ext>` and are picked up by ID.

**Where it ships.** `webapp/` is already published as an assets-only Cloudflare Worker via the root
`wrangler.toml` (git-connected; push to `main` = redeploy). The built site goes into `webapp/`
(`index.html` = Home, `manual/`, `platform/`, `llms.txt`); site source stays outside the published tree;
`webapp/mc/` and `app/` (Mission Control UI, phone HUD — still in development) are not touched.

**Editorial rule.** Known facts only, with provenance badges; anything unconfirmed lives in each manual
file's *Research backlog* and is never rendered. Details: [`../manual/README.md`](../manual/README.md).
