# The BRX manual

**This directory is the manual.** It is the single place a confirmed fact about the BRX tagger,
headset, accessories, audio, protocol and repairs is written in publishable form. The public website
is built from these files. There is no second copy.

**If you are an agent looking for a BRX fact: read the page below first.** Only if the manual is
silent go to the evidence layer (`../reference/`, `../../protocol/`, `../experiment-log/`). If you
confirm something there, write it in here.

## The pages

| File | Page | What is in it |
|---|---|---|
| `index.md` | `/` | the front page: what this is, and links |
| `hardware.md` | `/manual/hardware` | anatomy, buttons, ports, IR and sensors, LEDs, headset, battery, generations, accessories |
| `operate.md` | `/manual/operate` | quick start, charging, the on-gun menu, indoor and outdoor, sighting, headset pairing, the grenade, the Callsign app, a stock game, range, care |
| `gameplay.md` | `/manual/gameplay` | the arsenal with wire stats, health and damage, how a kill works, native modes, classes and perks, grenade modes |
| `sound.md` | `/manual/sound` | how audio works, voice packs, the sound bank, custom sounds over USB, firmware, volume |
| `fix.md` | `/manual/fix` | symptom ladders, pairing and BLE, hits, sound, battery, repairs, mods, accessories, community, FAQ |
| `dev.md` | `/manual/dev` | transport, framing, every command, the arm sequence, `$WEAP`, `$GSET`/`$PSET`, `$SIR`, events, the IR word, the serial console, `brx-mcp` |
| `platform.md` | `/platform` | what Open BRX is, what runs on hardware, what does not exist yet |
| `credits.md` | `/credits` | credits, sourcing, policy |

## How to write in here

The source format is **plain CommonMark**, and the whole contract is
[`../site/FORMAT.md`](../site/FORMAT.md). There is no block syntax, no badge system and no
per-sentence citation. Write markdown.

House style:

- **No em dashes.** The build fails on one. Use a period, a colon, or parentheses.
- **Write for a player.** Short sentences. Say "you". Active voice. State the fact first.
- **No marketing.** No superlatives, no positioning against other products, no telling the reader
  how the manual was made.
- **`dev.md` is the exception.** Keep every command, token, field name, enum and wire value exact.
  Simplify the prose around a table, never the table.
- **Never simplify a fact away.** Split the sentence instead.
- `##` headings are the unit of navigation: one per thing a reader would link to.
- No per-page sources list and no per-sentence citation. The footer links the repository.

## How a fact gets in

1. **Observe it** on the bench or find it in a source, and write it in the current month's file
   under `../experiment-log/` or the relevant `../reference/` note. That is evidence, not the manual.
2. **Confirm it.** Bench-verified, or an official document, or concrete and uncontradicted community
   practice. A guess stays in the evidence layer and goes in `../FOLLOWUPS.md`.
3. **Write it once** in the right page above.
4. **Bump that page's `Last verified:` date.**
5. **Build and push.** `cd site && npm test` builds and checks. A push to `main` deploys.

**Only confirmed facts are published.** If two sources disagree, publish neither value: put the
question in `../FOLLOWUPS.md` with what would settle it. This rule is unchanged. What went away is
the per-sentence bookkeeping that tried to encode it in the prose: confidence now lives in the
evidence layer, where it can be dated and argued with.

## Data that is generated, never typed

The weapon roster and the sound bank render from repo data files
(`../../mcp/brx_mcp/mc/weapons.json`, `../../mcp/brx_mcp/data/sound_catalog.json`) into the pages via
a `data` fenced block. Edit the JSON, not the page. The build never reads facts back out of manual
prose.

## Public-site policy

Restate with credit. Link official PDFs, never rehost Battle Company assets. Credit **LaserTagMods**
(JEDGE / JBOX) for the protocol discovery. Open BRX is independent and not endorsed by Battle
Company. No bench gun sticker labels, no BLE addresses, and no private individuals' names (public
creators the project already credits are fine).
