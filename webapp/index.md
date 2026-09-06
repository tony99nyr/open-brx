# Home
_Video game style tactical laser tag. Open, and you host it yourself._
Last verified: 2026-08-27

## Open BRX.
This is the full manual for the Battle Company BRX tagger and headset. It is also an open-source platform. It turns stock BRX guns into one connected laser tag system. You get real game modes, live scoring, and objectives from a laptop today. A phone HUD and a laptop Mission Control are still being built. No subscription. No firmware mods. No venue Wi-Fi needed.

_[image HOME-01: full-bleed hero (night field, dim red HUD glow; see the Images table below)]_

## Two doors
- **The Ultimate BRX Manual**: everything about the tagger and headset in one place. You get anatomy, pairing, every weapon, the 2,477-sound bank, repairs, and the full BLE protocol. We built it from the official docs, the community, and our own bench. ✅📖👥 → `/manual`
- **The Open BRX platform**: run Team Deathmatch and more on stock guns from a laptop today with `brx-mcp`. That part is proven on real hardware. The rest is under construction: a mission-control console, a phone HUD per gun, and an ESP32 rider. ✅🚧 → `/platform`
Source: docs/README.md, docs/architecture-topology.md

- **2,477** sounds on the gun, every one catalogued with a category and, for voices, its words ✅ (docs/reference/sound-catalog.md)
- **19** weapons, every stat on the wire 🔍✅ (docs/reference/weapons.md: 20 captured frames; the 20th is the default secondary, which is the Shotgun)
- **63** player slots per game, 4 native teams ✅ (the gun accepts `$PSET` ids 0–63; Open BRX reserves 0, so ids 1–63 are playable; `$TID` 2-bit) (docs/spec/contracts.md A5.1, docs/architecture-topology.md §2)
- **0** firmware changes, ever ✅ (CLAUDE.md hard rule)

## Only what we know.
Every fact on this site says where it came from: ✅ verified on our bench, 📖 from Battle Company's docs, 🔍 decoded from the Callsign app, 👥 community-reported. If a fact is not confirmed, it is not here yet. The manual grows as the research does.
Source: docs/site/BRIEF-open-brx-site.md §2

## Start here if you…
- **…just got a BRX** → `/manual/operate/quick-start`
- **…can't get the headset to pair** → `/manual/fix/pairing`
- **…want custom sounds** → `/manual/sound/custom-sounds`
- **…want to write code that talks to the gun** → `/manual/dev/brx-mcp`
Source: content/02, 04, 05, 06

_[image HOME-02: teaser diagram (SVG: a phone on each gun, a laptop at the base, IR between guns; solid vs dashed links)]_

## What the platform does today
- **Play now, laptop only** ✅: `python -m brx_mcp play tdm <gun1> <gun2>` ran a full Team Deathmatch on two real taggers on 2026-08-25. It handled scoring, respawn, the frag limit, and the correct winner. Everyone stays in the laptop's BLE range (a room, a yard). → `/manual/dev/brx-mcp`
- **Mission Control + the phone HUD** 🚧: a laptop console sets up the game. A phone on each gun then runs it over field Wi-Fi. Under construction. → `/platform/pieces` · Android test build → `/platform/app`
- **The Companion** 🚧: a ~$15 ESP32 rider that rebuilds the gun's own kill flash and killstreak audio over BLE. You need no phone for it. Under construction. → `/platform/pieces`
Source: docs/architecture-topology.md §3, §7; README.md; docs/VISION.md

## Protocol discovery and the tagger-rider concept originate with LaserTagMods (JEDGE / JBOX). Open BRX is a fresh, independent build (no code copied). It still stands on that work.
→ `/credits`
Source: README.md
