# Status & roadmap
_What's proven on hardware, what's only software, what's only a spec — with dates._
Last verified: 2026-08-27

## How to read this page.
✅ means a human ran it on a real tagger and wrote it in the experiment log. 🧪 means it's built, has tests, and has *not* been run on hardware. 📐 means there is a spec and nothing else. The project's own rule: *a green test ≠ works on real guns — that's earned on the bench.*
Source: docs/architecture-topology.md §7, docs/FOLLOWUPS.md B15

## Status board
| Element | Status | Date / evidence |
|---|---|---|
| Remote game start over BLE (config → spawn → live → timed match → respawn) | ✅ | multiple sessions, 2026-08-23 → 25 |
| Full Team Deathmatch: scoring, respawn, frag limit, correct winner, BLE held all match | ✅ 2 guns | 2026-08-25 "FIRST LIVE M0 GAME" |
| Synchronised start across guns (config-all-then-spawn barrier) | ✅ 3 guns | 2026-08-25, FOLLOWUPS B10 |
| Exact per-player attribution over BLE (`$PSET` id → `$HIR` shooter) | ✅ | 2026-08-25, protocol §7p/§7q |
| Native kill feedback from our stack: green-sight flash (`$SFLASH`) + announcer (`$PLAY` slot 4) | ✅ | 2026-08-25 / 26 |
| Four native teams; firmware-enforced friendly fire; live team flip | ✅ | 2026-08-26 |
| `$WEAP` map: damage, fire interval, fire modes (auto / single / burst / charge / melee), overheat; all 19 Callsign weapons captured (20 frames) | ✅ | 2026-08-26 |
| Config survives a BLE drop; a power-cycle wipes it (re-push tell) | ✅ | 2026-08-25 |
| Headset must be on or the gun won't join; rainbow blink = disconnected | ✅ | 2026-08-25 / 27 |
| Smart Grenade: 5 native modes, Hill/Respawn beacons readable, no BLE config | ✅ | exp-log #33–40 |
| BRX IR word decoded (25 bits, timings, parity); **stock tagger accepts synthetic shots from our ESP32 rig** | ✅ | 2026-08-26 |
| `$SIR` effects matrix (16 protocols × 4 subtypes) mapped: damage, ×1.25 / ×2, heal, armor, shield, audio suppression | ✅ | 2026-08-26 / 27 |
| Native phone app: connects, drives `$SFLASH`, arms a full game, stable session | ✅ single gun | 2026-08-25 |
| Phone → Mission Control → gun: hello, roster bind, try-out fired a real gun | ✅ single node, bench | 2026-08-25 night |
| Mission Control full stack (Muster → Recap), FrameBundle compiler, operator auth, discovery, loadout policy, saved games | 🧪 | ~500 Python tests, 42 e2e, 2026-08-26 / 27 |
| FFA / Infection / LMS / CS / Domination / KotH / CTF / Extraction engines | 🧪 | 156 sim scenarios; objective modes wait on a station |
| **MC ↔ multiple phones over a real field Wi-Fi** | 🧪 never run | — |
| **Dispersed timed start on a real field** | 🧪 never run | — |
| **Store-and-forward recovery after real coverage loss** | 🧪 never run | — |
| 20-minute two-node soak (screen-lock, backgrounding, out of Wi-Fi range) | 🧪 open | verification-checklist §NEXT 4 |
| Loadout v2 (two slots, perks, policy presets, phone picks) | 🧪 | 2026-08-27, not bench-verified |
| BRX Companion (ESP32-S3 rider) | 📐 | ADR-0001 accepted 2026-08-25; bench kit arrived 2026-08-26 |
| Utility Box / objective station | 📐 design, ✅ emit | build is "a packaging exercise" |
| Effect nodes (relay, WLED, DMX) | 📐 | `firmware/` empty |
| Field radio (LoRa / the gun's nRF) | 📐 | nRF unprobed (D1) |
Source: docs/architecture-topology.md §7, docs/verification-checklist.md, docs/FOLLOWUPS.md, docs/HANDOFF.md, docs/experiment-log.md

## Roadmap — the project ladder
- **M1 · Identify** — scan, identify, listen to real taggers. ✅ done
- **M2 · Control** — remote game start, weapons, respawn, timed matches. ✅ done
- **M3 · Protocol depth** — `$WEAP` map, the 2,166-id sound bank, game-mode model, **per-player id over BLE**, the IR word. ✅ done (2026-08-25 / 26)
- **M4 · Pilot game** — per-player node + Mission Control + live scoreboard. 🧪 built + tested in software; the MC↔phone field path is the next hardware muster (`docs/field-runbook-mc.md`)
- **M5 · Arena** — objectives, items, stations (Domination / KotH / CTF / Extraction points / bomb sites). 🧪 engines · ✅ IR emit · 📐 the box
- **M6 · Companion + scale** — ESP32 Companions on the same contracts; mesh for instant field-wide feedback; 20+ guns. 📐
Source: README.md §Roadmap

## Mission Control and the phone HUD — 🚧 under construction; details when they have run on a real field.
Source: docs/spec/README.md §8

## What we will not claim yet.
Nobody has run a multi-phone match on a real field, a dispersed start where players walk out of range before T-0, or a store-and-forward recovery after real coverage loss. Three guns on one laptop radio is the most we have held at once; the maximum is untested. FFA / Infection / LMS have not been played on real guns (their logic is sim-proven). The Companion and the Utility Box are not built. See *Honest gaps* below for the full list.
Source: docs/architecture-topology.md §7, docs/FOLLOWUPS.md B10, docs/verification-checklist.md
