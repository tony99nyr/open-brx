# The Open BRX platform
_Video game inspired tactical laser tag: open and self-hosted._
Last verified: 2026-09-06

## Video game inspired tactical laser tag: open and self-hosted.
Open BRX is free, open-source (MIT) software for stock Battle Company BRX taggers. It ties your guns together into one game system. Today a laptop runs the game modes, live scoring and custom weapons. A laptop Mission Control and a phone HUD are still under construction. There is no subscription, no location lock and no venue Wi-Fi to set up. Stock firmware is never touched.
Source: docs/VISION.md §Naming, README.md

_[image PLAT-01: ]_

- **$0** to run your first full scored match (a laptop plus the guns you own) ✅
- **2 taggers** played a full scored Team Deathmatch on 2026-08-25; a **3-gun** synced start is proven ✅
- **63** player slots per game (wire ids 1–63; the gun accepts 0–63, 0 reserved) · **4** native hardware teams ✅
- **~$15** in parts for the Companion rider (specified, not built) 📐
- **2,477** sound files on the tagger, every one catalogued ✅
Source: docs/architecture-topology.md §3 + §7, hardware/brx-companion-spec.md, docs/reference/sound-catalog.md

## The problem we're solving.
The official Edge engine costs **$599.99 / 6 months to $1,599.99 / year**. It is licensed to **one computer at one location**. It also expects the taggers to reach it over **venue Wi-Fi**. The BRX gun itself **keeps no game state**: no clock, no score, no respawn, no self-reported kills. So *everything* fun has to live off the gun. Open BRX puts that "everything" in open software you host yourself, on gear you already own.
Source: docs/reference/edge-brp.md §Pricing, docs/VISION.md, protocol/session-findings-2026-08.md §7n

## Three things the BRX can't do alone, and where Open BRX puts them
- **Keep score.** The gun cannot tell a host about its own kills. A kill is only visible from the victim's side (`$HP,0` plus its last `$HIR`). → A per-player **node** on each gun is the scorekeeper. ✅
- **Run a clock or a respawn.** Respawn time and game length are not in the protocol at all. The official app keeps them on the phone. → The node runs the match loop. **Mission Control** writes the game and adds up the results. ✅
- **Reach a laptop across a field.** BLE reaches about 1–30 m. Players spread out 50–100 m. → So the BLE link *rides the player*: a phone today, a Companion later. The laptop talks to the nodes over Wi-Fi, best-effort. ✅ (constraint) / 🧪 (phone tier)
Source: docs/adr/0001-companion-rider-architecture.md §Context, docs/HANDOFF.md §ANSWERED, docs/adr/0002-laptop-mission-control-host.md

_[diagram PLAT-05: laptop Mission Control at the base, one phone (node) per gun in the field. The solid BLE line node↔gun must hold. The dashed Wi-Fi line node↔MC is allowed to drop. **No line from the laptop to any gun during play**. ✅ (Tier 0) / 🧪 (Tier 1)]_

## The pieces
one works today, the rest are 🚧 under construction (brief §10)
- **brx-mcp**: the CLI / MCP "lab instrument". Scan, identify, listen, diagnose, and `play tdm …` a real match from a laptop. ✅ **Use it now** → `/manual/dev/brx-mcp`
- **Mission Control** 🚧: the laptop console that writes a game and runs the match. Under construction.
- **BRX Combat HUD** 🚧: the native phone app, one gun per phone. Under construction, and there is an Android test build to sideload → `/platform/app`
- **BRX Companion** 🚧: a small ESP32-S3 rider (~$15 in parts), designed to rebuild the gun's native kill flash and audio with no phone. Specified; bench kit in hand.
- **Utility Box / stations** 🚧: the open objective node (hill, flag, bomb site, extraction point, respawn). Design stage. Our ESP32 rig has already put a synthetic IR shot into a stock tagger.
- **Effect nodes** 🚧: smoke, lights, DMX and music as peers on the event stream. Design stage.
Source: README.md §Repo layout, docs/spec/README.md §2, hardware/*.md

## Start in one command.
On the machine with the Bluetooth radio, run `pip install -e ./mcp`. Then run `python -m brx_mcp play tdm <addr1> <addr2> volume=69`. That exact command ran a full, scored Team Deathmatch on two real taggers. No guns to hand? `python -m brx_mcp game-sim tdm` narrates a match in your terminal.
Source: README.md §brx-mcp quickstart, docs/experiment-log.md "FIRST LIVE M0 GAME"

## A green test suite is not a working field.
The project's own rule for what counts as proven.
Source: docs/architecture-topology.md §7, docs/FOLLOWUPS.md B15
