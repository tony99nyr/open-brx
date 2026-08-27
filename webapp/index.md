# Home
_Video game inspired tactical laser tag — open and self-hosted._
Last verified: 2026-08-27

## Open BRX.
The definitive manual for the Battle Company BRX tagger and headset — and an open-source platform that turns stock BRX guns into an orchestrated laser-tag system: real game modes, live scoring and objectives from a laptop today, with a phone HUD and a laptop Mission Control under construction. No subscription. No firmware mods. No venue Wi-Fi required.

_[image HOME-01: full-bleed hero (night field, dim red HUD glow — see images.md)]_

## Two doors
- **The Ultimate BRX Manual** — Everything about the tagger and headset in one place: anatomy, pairing, every weapon, the 2166-sound bank, repairs, and the full BLE protocol. Built from the official docs, the community, and our own bench. ✅📖👥 → `/manual`
- **The Open BRX platform** — Run Team Deathmatch and more on stock guns from a laptop today with `brx-mcp` — proven on real hardware. The rest — a mission-control console, a phone HUD per gun, an ESP32 rider — is under construction. ✅🚧 → `/platform`
Source: docs/README.md, docs/architecture-topology.md

- **2,166** sound ids decoded 🔍 (protocol/callsign-extract/sound-bank.md)
- **19** weapons, every stat on the wire 🔍✅ (docs/reference/weapons.md — 20 captured frames; the 20th is the default secondary, which is the Shotgun)
- **63** player slots per game, 4 native teams ✅ (the gun accepts `$PSET` ids 0–63; Open BRX reserves 0, so ids 1–63 are playable; `$TID` 2-bit) (docs/spec/contracts.md A5.1, docs/architecture-topology.md §2)
- **0** firmware modifications — ever ✅ (CLAUDE.md hard rule)

## Only what we know.
Every fact on this site says where it came from: ✅ verified on our bench, 📖 from Battle Company's docs, 🔍 decoded from the Callsign app, 👥 community-reported. If something isn't confirmed, it isn't here yet — the manual grows as the research does.
Source: docs/site/BRIEF-open-brx-site.md §2

## Start here if you…
- **…just got a BRX** → `/manual/operate/quick-start`
- **…can't get the headset to pair** → `/manual/fix/pairing`
- **…want custom sounds** → `/manual/sound/custom-sounds`
- **…want to write code that talks to the gun** → `/manual/dev/brx-mcp`
Source: content/02, 04, 05, 06

_[image HOME-02: teaser diagram (SVG — a phone on each gun, a laptop at the base, IR between guns; solid vs dashed links)]_

## What the platform does today
- **Play now, laptop-only** ✅ — `python -m brx_mcp play tdm <gun1> <gun2>` ran a full Team Deathmatch on two real taggers on 2026-08-25: scoring, respawn, frag limit, correct winner. Everyone stays in the laptop's BLE range (a room, a yard). → `/manual/dev/brx-mcp`
- **Mission Control + the phone HUD** 🚧 — a laptop console that authors the game and a phone on each gun that runs it over field Wi-Fi. Under construction. → `/platform/pieces`
- **The Companion** 🚧 — a ~$15 ESP32 rider that reconstructs the gun's own kill flash and killstreak audio over BLE, no phone needed. Under construction. → `/platform/pieces`
Source: docs/architecture-topology.md §3, §7; README.md; docs/VISION.md

## Protocol discovery and the tagger-rider concept originate with LaserTagMods (JEDGE / JBOX). Open BRX is a fresh, independent implementation — no code copied — but it stands on that work.
→ `/credits`
Source: README.md
