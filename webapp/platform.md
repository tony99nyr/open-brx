# The Open BRX platform
_Video game inspired tactical laser tag — open and self-hosted._
Last verified: 2026-08-27

## Video game inspired tactical laser tag — open and self-hosted.
An open-source (MIT) platform that turns stock Battle Company BRX taggers into an orchestrated laser-tag system: game modes, live scoring and custom weapons from a laptop today, with a laptop Mission Control and a phone HUD under construction. No subscription, no location lock, no venue Wi-Fi required. Stock firmware is never touched.
Source: docs/VISION.md §Naming, README.md

_[image PLAT-01: ]_

- **$0** to run your first orchestrated match (a laptop + the guns you own) ✅
- **2 taggers** ran a full scored Team Deathmatch on 2026-08-25; **3-gun** synchronised start proven ✅
- **63** player slots per game (wire ids 1–63; the gun accepts 0–63, 0 reserved) · **4** native hardware teams ✅
- **~$15** BOM for the Companion rider (specified, not built) 📐
- **2,166** sound ids decoded in the tagger's bank ✅
Source: docs/architecture-topology.md §3 + §7, docs/build-tiers.md, hardware/brx-companion-spec.md, protocol/callsign-extract/sound-bank.md

## The problem we're solving.
The official Edge engine costs **$599.99 / 6 months to $1,599.99 / year**, is licensed to **one computer at one location**, and assumes the taggers reach it over **venue Wi-Fi**. Meanwhile the BRX itself **keeps no game state** — no clock, no score, no respawn, no self-reported kills — so *everything* interesting has to live off-gun. Open BRX puts that "everything" in open, self-hosted software you run on hardware you already own.
Source: docs/reference/edge-brp.md §Pricing, docs/VISION.md, protocol/brx-protocol.md §7n

## Three things the BRX can't do alone — and where Open BRX puts them
- **Keep score.** The gun is host-blind about its own kills; a kill is only visible from the victim's side (`$HP,0` + its last `$HIR`). → A per-player **node** on each gun is the scorekeeper. ✅
- **Run a clock or a respawn.** Respawn time and game length are not in the protocol at all — the official app keeps them on the phone. → The node runs the match loop; **Mission Control** authors and aggregates. ✅
- **Reach a laptop across a field.** BLE holds ~1–30 m; players scatter 50–100 m. → The BLE link *rides the player* (phone now, Companion later); the laptop talks to nodes over Wi-Fi, best-effort. ✅ (constraint) / 🧪 (phone tier)
Source: docs/adr/0001-companion-rider-architecture.md §Context, docs/HANDOFF.md §ANSWERED, docs/adr/0002-laptop-mission-control-host.md

_[diagram PLAT-05: laptop Mission Control at the base; one phone (node) per gun in the field; solid BLE line node↔gun must hold, dashed Wi-Fi line node↔MC may drop; **no line from the laptop to any gun during play**. ✅ (Tier 0) / 🧪 (Tier 1)]_

## The pieces
one is usable today; the rest are 🚧 under construction (brief §10)
- **brx-mcp** — the CLI / MCP "lab instrument": scan, identify, listen, diagnose, and `play tdm …` a real match from a laptop. ✅ **Use it now** → `/manual/dev/brx-mcp`
- **Mission Control** 🚧 — the laptop operator console that authors a game and runs the match. Under construction.
- **BRX Combat HUD** 🚧 — the native phone app, one gun per phone. Under construction.
- **BRX Companion** 🚧 — an ESP32-S3 rider (~$15 BOM) that reconstructs the gun's native kill flash + audio without a phone. Specified; bench kit in hand.
- **Utility Box / stations** 🚧 — the open objective node (hill, flag, bomb site, extraction point, respawn). Design stage; our ESP32 rig has already put a synthetic IR shot into a stock tagger.
- **Effect nodes** 🚧 — smoke, lights, DMX, music as peers on the event stream. Design stage.
Source: README.md §Repo layout, docs/spec/README.md §2, hardware/*.md, docs/build-tiers.md §Environmental effects

## Start in one command.
On the machine with the Bluetooth radio: `pip install -e ./mcp`, then `python -m brx_mcp play tdm <addr1> <addr2> volume=69`. That exact command ran a full, scored Team Deathmatch on two real taggers. No guns to hand? `python -m brx_mcp game-sim tdm` narrates a match in your terminal.
Source: README.md §brx-mcp quickstart, docs/experiment-log.md "FIRST LIVE M0 GAME"

## A green test suite is not a working field.
the project's own rule for what counts as proven.
Source: docs/architecture-topology.md §7, docs/FOLLOWUPS.md B15
