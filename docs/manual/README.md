# The BRX Manual — canonical facts about the Battle Company BRX

**This directory is the manual.** It is the single place a confirmed fact about the BRX tagger,
headset, accessories, audio, protocol, and repairs is written in publishable form. The public website
(`open-brx.iamrossi.workers.dev`, design package in [`../site/`](../site/README.md)) is **built from
these files** — there is no second copy. A fresh clone of the repo has the entire manual right here.

**If you are an agent looking for a BRX fact: read the section file below first.** Only if the manual
is silent go to the evidence layer (`../reference/`, `../../protocol/`, `../experiment-log.md`) — and if
you confirm something there, promote it into the manual (see *How a fact gets in*).

## Sections

| File | Section | What's in it |
|---|---|---|
| [`00-home.md`](00-home.md) | Home · Manual hub · Credits · Changelog | site framing pages; sourcing policy |
| [`01-hardware.md`](01-hardware.md) | **Meet the BRX** | anatomy, buttons, ports, IR/sensors, LEDs, headset, battery, Gen1/2/3, accessories, spec sheet |
| [`02-operation.md`](02-operation.md) | **Operating the BRX** | quick start, charging, on-gun menu, indoor/outdoor, sighting, headset pairing (incl. Gen-3 re-pair), grenade, the Callsign app, a stock game, range, care |
| [`03-gameplay.md`](03-gameplay.md) | **Gameplay** | the full arsenal with wire stats, health/armor/damage, how a kill works, native modes + settings, classes/perks/killstreaks, grenade modes |
| [`04-sound.md`](04-sound.md) | **Sound, voice & updates** | how audio works, voice packs, the 2166-id sound bank, custom sounds over USB, firmware/factory restore, volume |
| [`05-fix-and-mod.md`](05-fix-and-mod.md) | **Fix, mod & accessorise** | symptom ladders, pairing/BLE, hits/sound/battery, repairs, mods, accessories, community, FAQ |
| [`06-developer.md`](06-developer.md) | **Developer reference** | transport/framing/safety, every command, arm sequence, `$WEAP` token map, `$GSET`/`$PSET`, `$SIR`, events, IR word, serial console, link survival, `brx-mcp`, captures |
| [`07-platform.md`](07-platform.md) | **The Open BRX platform** | what we're building on the BRX: architecture, pieces (🚧 where under construction), modes, build tiers, vs Edge, status, FAQ |

## The three layers (and why nothing is written twice)

```
EVIDENCE  ../experiment-log.md · ../../protocol/captures/ · ../../protocol/callsign-extract/ (raw APK data)
          ../reference/*.md (notes taken FROM external docs) · ../gotchas.md · ../unknowns.md
   │  dated, raw, never published as-is
   ▼  promote when confirmed
MANUAL    docs/manual/*.md  ← YOU ARE HERE — every confirmed fact, once, with a src: line into EVIDENCE
   │  the only place a fact is stated in publishable form
   ▼  build (no editing, no restating)
SITE      webapp/ (Cloudflare) — designed pages + a markdown twin of each + llms.txt, generated from MANUAL
```

Rules that keep it DRY:
- **A fact lives in one manual file.** Other repo docs link to it; they don't restate it. (Existing docs
  that predate the manual — `../game-modes.md`, `../sound-architecture.md`, the `Canonical sources`
  table in `../README.md` — should be migrated to link here as they're touched, not all at once.)
- **Data that exists as a file is never hand-copied.** The weapon roster (`../reference/weapons.md`,
  `../../mcp/brx_mcp/mc/weapons.json`), the sound bank (`../../protocol/callsign-extract/Sounds.json` +
  `sound-bank.md`) and the command list (`../../protocol/brx-protocol.md`) are rendered by the site
  build from those files. Where a manual page shows such a table inline today, it is a **snapshot for
  the designer** and is marked as generated; edit the data file, not the page.
- **Evidence is cited by path, never pasted.** Every block ends in `src:`.

## Known facts only

The manual states what we know. Every block carries a provenance badge — ✅ verified on our bench ·
📖 official Battle Company docs · 🔍 decoded from the Callsign APK · 👥 community-reported — and
**nothing unconfirmed, hedged, or contradicted between sources is published.** Each file ends with a
`## Research backlog (held — NOT published)` section listing exactly what was held and why; the site
build ignores that section. `../unknowns.md` is the cross-cutting index of open questions and links to
these backlogs rather than restating them.

## How a fact gets in (the update loop)

1. **Observe it** on the bench or find it in a source → append to `../experiment-log.md` (dated) or the
   relevant `../reference/*.md` note. This is evidence, not the manual.
2. **Confirm it** — bench-verified, or an official document, or concrete + uncontradicted community
   practice. If it's a guess, it stays in evidence and goes in the file's *Research backlog*.
3. **Write it once** in the right manual file, in the block format (below), with the badge and a `src:`
   line pointing at step 1. If it replaces a held backlog item, delete the backlog line.
4. **Bump the page's `Last verified:` date** (top of the file) and add a line to the changelog in
   `00-home.md` if it changes something owners care about.
5. **Build + verify + push.** `cd site && npm run build && npm test` (the generator reads these files;
   the suite refuses to run on a stale build), commit `webapp/` with the manual change, push — Cloudflare
   redeploys. The markdown twin and `llms-full.txt` update with it.

Contradictions: if two sources disagree, publish neither value — backlog both, and put the question in
`../unknowns.md` under what would settle it.

## Block format (what the files look like)

Each file: header (audience, goal, legend) → `## Pages` → one `### Page: Title (\`/slug\`)` per URL →
an ordered stream of typed blocks — `[hero]`, `[callout:info|warn|tip]`, `[steps]`, `[cards]`,
`[table]`, `[data-table:filterable]`, `[spec-sheet]`, `[accordion]`, `[image ID]` / `[diagram ID]`,
`[code lang]`, `[bit-field]`, `[symptom-ladder]`, `[compare]`, `[stat-row]`, `[faq]`,
`[under-construction …]` — then `## Images for this section`, `## Interactive ideas`, `## Sources used`,
`## Research backlog (held — NOT published)`. Full definitions: [`../site/BRIEF-open-brx-site.md`](../site/BRIEF-open-brx-site.md) §5.
Short by construction: no paragraph over three sentences; prefer lists, tables, steps.

Images are referenced by ID; the manifest with shot briefs and generation prompts is
[`../site/images.md`](../site/images.md). Real photos, when shot, are committed under `docs/manual/img/`
so the repo stays self-contained.

## Public-site policy (applies to these files because they are published)

Restate with credit; link official PDFs, never rehost Battle Company assets (manuals, audio, app
screenshots). Credit **LaserTagMods** (JEDGE/JBOX) for protocol discovery. Open BRX is independent and
not endorsed by Battle Company. No bench gun sticker labels, BLE addresses, or private individuals'
names (public creators the project already credits are fine).
