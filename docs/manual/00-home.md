# 00 · Home + Manual hub + Credits  (slugs: `/`, `/manual`, `/credits`, `/changelog`)
**Last verified:** 2026-08-27
**Audience:** everyone who lands here — mostly BRX owners from search, then players/clubs/modders/devs.
**Goal:** in 5 seconds, say what this is; in 10, get an owner to the answer they came for; leave the platform door open.
**Provenance legend:** ✅ verified on our bench · 📖 official Battle Company docs · 🔍 decoded from the Callsign app · 👥 community-reported — only confirmed facts are published
**Status legend (platform):** ✅ proven on real hardware · 🧪 built + software-tested · 📐 specified only

## Pages

### Page: Home  (`/`)  — template T1
_Video game inspired tactical laser tag — open and self-hosted._

[hero] **Open BRX.** The definitive manual for the Battle Company BRX tagger and headset — and an open-source platform that turns stock BRX guns into an orchestrated laser-tag system: real game modes, live scoring and objectives from a laptop today, with a phone HUD and a laptop Mission Control under construction. No subscription. No firmware mods. No venue Wi-Fi required.
[image HOME-01] full-bleed hero (night field, dim red HUD glow — see images.md)
src: docs/VISION.md, README.md

[cards] "Two doors"
- **The Ultimate BRX Manual** — Everything about the tagger and headset in one place: anatomy, pairing, every weapon, the 2166-sound bank, repairs, and the full BLE protocol. Built from the official docs, the community, and our own bench. ✅📖👥 → `/manual`
- **The Open BRX platform** — Run Team Deathmatch and more on stock guns from a laptop today with `brx-mcp` — proven on real hardware. The rest — a mission-control console, a phone HUD per gun, an ESP32 rider — is under construction. ✅🚧 → `/platform`
src: docs/README.md, docs/architecture-topology.md

[stat-row]
- **2,166** sound ids decoded 🔍 (protocol/callsign-extract/sound-bank.md)
- **19** weapons, every stat on the wire 🔍✅ (docs/reference/weapons.md — 20 captured frames; the 20th is the default secondary, which is the Shotgun)
- **63** player slots per game, 4 native teams ✅ (the gun accepts `$PSET` ids 0–63; Open BRX reserves 0, so ids 1–63 are playable; `$TID` 2-bit) (docs/spec/contracts.md A5.1, docs/architecture-topology.md §2)
- **0** firmware modifications — ever ✅ (CLAUDE.md hard rule)

[callout:info] **Only what we know.** Every fact on this site says where it came from: ✅ verified on our bench, 📖 from Battle Company's docs, 🔍 decoded from the Callsign app, 👥 community-reported. If something isn't confirmed, it isn't here yet — the manual grows as the research does.
src: docs/site/BRIEF-open-brx-site.md §2

[cards] "Start here if you…"
- **…just got a BRX** → `/manual/operate/quick-start`
- **…can't get the headset to pair** → `/manual/fix/pairing`
- **…want custom sounds** → `/manual/sound/custom-sounds`
- **…want to write code that talks to the gun** → `/manual/dev/brx-mcp`
src: content/02, 04, 05, 06

[image HOME-02] "How it's wired" teaser diagram (SVG — a phone on each gun, a laptop at the base, IR between guns; solid vs dashed links)
[cards] "What the platform does today"
- **Play now, laptop-only** ✅ — `python -m brx_mcp play tdm <gun1> <gun2>` ran a full Team Deathmatch on two real taggers on 2026-08-25: scoring, respawn, frag limit, correct winner. Everyone stays in the laptop's BLE range (a room, a yard). → `/manual/dev/brx-mcp`
- **Mission Control + the phone HUD** 🚧 — a laptop console that authors the game and a phone on each gun that runs it over field Wi-Fi. Under construction. → `/platform/pieces`
- **The Companion** 🚧 — a ~$15 ESP32 rider that reconstructs the gun's own kill flash and killstreak audio over BLE, no phone needed. Under construction. → `/platform/pieces`
src: docs/architecture-topology.md §3, §7; README.md; docs/VISION.md

[quote] "Protocol discovery and the tagger-rider concept originate with LaserTagMods (JEDGE / JBOX). Open BRX is a fresh, independent implementation — no code copied — but it stands on that work."
→ `/credits`
src: README.md

---

### Page: Manual hub  (`/manual`)  — template T2
_The Ultimate BRX Manual — everything about the tagger and headset, in one place._

[hero] Battle Company's quick manual and the 2018 Extended Guide are partial and scattered; the real knowledge lives in a Facebook group, LaserTagMods' repos, and PDFs. We aggregated all of it, verified what we could on the bench, and organised it so you can find an answer standing at the field with a gun in your other hand. 📖👥✅
[image HOME-03] manual-hub header: tagger + headset laid out flat, overhead, editorial (REAL PHOTO)
src: docs/VISION.md §"The definitive BRX manual"

[cards] "Sections"
- **Meet the BRX** — anatomy, buttons, LEDs, generations, the headset, the grenade, spec sheet. → `/manual/hardware`
- **Operating the BRX** — quick start, charging, indoor/outdoor, sighting, pairing, the Callsign app. → `/manual/operate`
- **Gameplay** — all 19 weapons with real stats, health & damage, native modes, perks, grenade modes. → `/manual/gameplay`
- **Sound, voice & updates** — how audio works, the Sound Bank Explorer, custom sound packs, firmware. → `/manual/sound`
- **Fix, mod & accessorise** — symptom-indexed troubleshooting, repairs, mods, accessories, community, FAQ. → `/manual/fix`
- **Developer reference** — the BLE + IR protocol, every command, the `$WEAP` map, the serial console, `brx-mcp`. → `/manual/dev`

[cards] "Fast paths" — "Won't fire" · "Headset pairing" · "Battery & polarity" · "Custom sounds over USB" · "Weapon stats" · "Sound id lookup" (each links to its page)

[callout:tip] **Search first.** ⌘K / the search box indexes every heading, weapon, sound id, command, and FAQ.

[accordion] "How we source and verify" — 3 short items: (1) restate, don't copy — official PDFs are linked, not rehosted; (2) confidence badges on every block; (3) sources link to the open repo so you can check our work. → `/credits`
src: docs/VISION.md §Sourcing/policy

---

### Page: Credits & sourcing  (`/credits`)  — template T3
_Who found what, and how we use it._

[cards] Credits:
- **LaserTagMods (JEDGE / JBOX)** — protocol discovery, the tagger-rider ESP32 concept. 👥
- **Battle Company** — the BRX hardware, the V7 quick manual, the 2018 Extended User Guide (linked). 📖
- **The BRX owner community** — repairs, mods, the audio map, field lore. 👥
- **Open BRX bench** — everything marked ✅ was reproduced on our own taggers; the notebook is public (`docs/experiment-log.md`). ✅
src: README.md, docs/VISION.md, docs/reference/lasertagmods.md, docs/reference/community-notes.md

[callout:info] **Policy.** We restate facts with credit and link official documents rather than rehosting them. We never modify stock firmware; everything is done over the documented Bluetooth protocol. Open BRX is independent and not affiliated with or endorsed by Battle Company.
src: docs/VISION.md, CLAUDE.md

[faq] "Is this legal?" (interoperability reverse-engineering, clean-room, facts-not-code) · "Can I contribute a fix?" (GitHub) · "Found an error?" (every page has a report link)

---

### Page: Changelog  (`/changelog`)  — template T3
_The manual is a living document. Every page carries its last-verified date; this is the feed._

[timeline] Entries are dated bench findings phrased for owners (source: `docs/experiment-log.md` headlines, curated — not the raw notebook). Seed with the latest: 2026-08-25 first live Team Deathmatch on two real taggers; 2026-08-25 per-player identity over BLE (`$PSET`/`$HIR`); 2026-08-27 headset LED map corrected (green is hit/kill feedback, team colour is pre-game only). ✅
src: git log, docs/experiment-log.md

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|
| HOME-01 | `/` hero | Night game: 3–4 silhouetted players spread across a dark field, each with a faint red/amber glow from a phone mounted on a black rifle-style tagger; the base is a distant laptop glow. Mood: tense, cinematic, no faces. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Wide cinematic night scene on an open field: three or four silhouetted players spread far apart, each holding a modern black rifle-style laser-tag tagger with a small phone mounted on the forearm glowing dim red-amber; a faint blue laptop glow at a distant base table; mist, long shadows, near-black navy sky (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and dim amber (#ffb020) HUD glow; restrained photoreal lighting; no faces visible; NO text, NO labels, NO logos, NO brand names, NO watermarks; 21:9. |
| HOME-02 | `/` "how it's wired" teaser | Topology: laptop at base ↔ (dashed Wi-Fi) ↔ phone nodes, each phone ↔ (solid BLE) ↔ one gun, gun → gun IR arrows. | SVG (build in site) | docs/architecture-topology.md §2 | — |
| HOME-03 | `/manual` header | Overhead flat-lay: one tagger and one headset on a dark matte surface, editorial product photography, soft top light. | REAL PHOTO | — | Shot brief: overhead, 4:3, matte black backdrop, gun horizontal, headset beside it, soft diffused key light from top-left, no props. |
| HOME-04 | `/` platform door card | Laptop on a folding table outdoors at dusk with two black rifle-style taggers beside it, screen glowing blue with a scoreboard-like grid (unreadable). | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. A laptop on a folding camp table outdoors at dusk, screen glowing electric blue (#39b4ff) with an abstract grid of unreadable rows; two modern black rifle-style laser-tag taggers resting beside it; shallow depth of field; near-black navy ambient (#0c1016), cool desaturated palette, restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. |
| HOME-05 | `/` manual door card | Close macro of a black laser-tag headset sensor dome with a soft electric-blue LED glow, technical and clean. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Extreme macro of a single translucent sensor dome on a black laser-tag headset band, lit from within by a soft electric-blue (#39b4ff) LED, fine surface texture, dark graphite background (#0c1016) with subtle gradient, cool desaturated palette; restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 1:1. |
| HOME-06 | `/credits` | Abstract "standing on shoulders": layered translucent circuit-trace sheets in blue and graphite. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Abstract composition of three layered translucent sheets etched with fine circuit traces, stacked with depth, edges catching electric-blue (#39b4ff) rim light, one thin amber (#ffb020) trace; near-black navy background (#0c1016) with subtle graphite gradient; clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. |
| HOME-07 | site-wide | Favicon / mark: a minimal geometric mark suggesting a sight reticle merged with an open bracket. | GENERATE (then vectorise) | — | Minimal flat logo mark on a plain near-black navy background (#0c1016): a circular sight reticle whose left side opens into a square bracket shape, single electric-blue (#39b4ff) stroke, geometric, centered, lots of negative space; NO text, NO letters, NO gradients, NO watermarks; 1:1. |

## Sources used
docs/VISION.md · README.md · docs/README.md · docs/architecture-topology.md · CLAUDE.md · git log (2026-08-27)

## Research backlog (held — NOT published)
- The Tier-1 field path (Mission Control ↔ phones over field Wi-Fi) has never been run on hardware — the home page must say "software-tested" until the first live muster.
- BLE links per laptop radio is an estimate (5–7 planning number, unmeasured).
