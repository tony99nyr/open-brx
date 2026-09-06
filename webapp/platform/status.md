# Status & roadmap
_What is proven on hardware, what is only software, what is only a spec. With dates._
Last verified: 2026-09-06

## How to read this page.
✅ means a human ran it on a real tagger and wrote it in the experiment log. 🧪 means it is built, has tests, and has *not* been run on hardware. 📐 means there is a spec and nothing else. The project's own rule: *a green test ≠ works on real guns. That is earned on the bench.*
Source: docs/architecture-topology.md §7, docs/FOLLOWUPS.md B15

## Status board
| Element | Status | Date / evidence |
|---|---|---|
| Remote game start over BLE (config → spawn → live → timed match → respawn) | ✅ | multiple sessions, 2026-08-23 → 25 |
| Full Team Deathmatch: scoring, respawn, frag limit, correct winner, BLE held all match | ✅ 2 guns | 2026-08-25 "FIRST LIVE M0 GAME" |
| Synced start across guns (config-all-then-spawn barrier) | ✅ 3 guns | 2026-08-25, FOLLOWUPS B10 |
| Exact per-player attribution over BLE (`$PSET` id → `$HIR` shooter) | ✅ | 2026-08-25, `protocol/session-findings-2026-08.md` §7p/§7q |
| Native kill feedback from our stack: green-sight flash (`$SFLASH`) + announcer (`$PLAY` slot 4) | ✅ | 2026-08-25 / 26 |
| Four native teams; firmware-enforced friendly fire; live team flip | ✅ | 2026-08-26 |
| `$WEAP` map: damage, fire interval, fire modes (auto / single / burst / charge / melee), overheat; all 19 Callsign weapons captured (20 frames) | ✅ | 2026-08-26 |
| Config survives a BLE drop; a power-cycle wipes it (re-push tell) | ✅ | 2026-08-25 |
| Headset must be on or the gun won't join; rainbow blink = disconnected | ✅ | 2026-08-25 / 27 |
| Smart Grenade: 5 native modes, Hill/Respawn beacons readable, no BLE config | ✅ | exp-log #33–40 |
| BRX IR word decoded (25 bits, timings, parity); **stock tagger accepts synthetic shots from our ESP32 rig** | ✅ | 2026-08-26 |
| `$SIR` effects matrix (16 protocols × 4 subtypes) mapped: damage, heal, armor, shield, audio suppression | ✅ | 2026-08-26 / 27 |
| The ×1.25 / ×2 multiplier rows (functions 36 and 37): fn 36 lands the **floor** of magnitude ×1.25, fn 37 lands magnitude ×2 | ✅ 16 trials, 4 magnitudes, 8 row-tail shapes, fn 1 control in every trial | 2026-09-02 |
| Native phone app: connects, drives `$SFLASH`, arms a full game, stable session | ✅ single gun | 2026-08-25 |
| Phone → Mission Control → gun: hello, roster bind, try-out fired a real gun | ✅ single node, bench | 2026-08-25 night |
| Mission Control full stack (Muster → Recap), FrameBundle compiler, operator auth, discovery, loadout policy, saved games | 🧪 | ~500 Python tests, 42 e2e, 2026-08-26 / 27 |
| FFA / Infection / LMS / CS / Domination / KotH / CTF / Extraction engines | 🧪 | 156 sim scenarios; objective modes wait on a station |
| **MC ↔ two phones over a real field Wi-Fi, a whole match** | ✅ 2 phones | 2026-08-30 FFA (300 s, 12 kills) and 2026-09-01 outdoor TDM; more than two phones untested |
| **Dispersed timed start on a real field** (players out of range before T-0) | 🧪 never run | n/a |
| **Store-and-forward recovery after real coverage loss** | 🧪 never run | n/a |
| 20-minute two-node soak (screen-lock, backgrounding, out of Wi-Fi range) | 🧪 open | verification-checklist §NEXT 4 |
| Loadout v2 (three slots: primary, secondary, perk; policy presets, phone picks) | 🧪 | 2026-08-27 and 2026-09-04, not bench-verified |
| BRX Companion (ESP32-S3 rider) | 📐 | ADR-0001 accepted 2026-08-25; bench kit arrived 2026-08-26 |
| Utility Box / objective station | 📐 design, ✅ emit | build is "a packaging exercise" |
| Effect nodes (relay, WLED, DMX) | 📐 | `firmware/` empty |
| Field radio (LoRa / the gun's nRF) | 📐 | nRF unprobed (D1) |
Source: docs/architecture-topology.md §7, docs/archive/verification-checklist.md, docs/FOLLOWUPS.md, docs/HANDOFF.md, docs/experiment-log.md

## Roadmap: the project ladder
- **M1 · Identify**: scan, identify and listen to real taggers. ✅ done
- **M2 · Control**: remote game start, weapons, respawn, timed matches. ✅ done
- **M3 · Protocol depth**: the `$WEAP` map, the sound bank, the game-mode model, **per-player id over BLE**, and the IR word. ✅ done (2026-08-25 / 26)
- **M4 · Pilot game**: per-player node + Mission Control + live scoreboard. 🧪 built and tested in software. The MC↔phone field path is the next hardware muster (`docs/field-runbook-mc.md`)
- **M5 · Arena**: objectives, items, stations (Domination / KotH / CTF / Extraction points / bomb sites). 🧪 engines · ✅ IR emit · 📐 the box
- **M6 · Companion + scale**: ESP32 Companions on the same contracts, a mesh for instant field-wide feedback, 20+ guns. 📐
Source: README.md §Roadmap

## Mission Control and the phone HUD: 🚧 under construction. Details when they have run on a real field.
Source: docs/spec/README.md §8

## What we will not claim yet.
Two phones is the most that have played a whole match together; nobody has run more. Nobody has run a dispersed start where players walk out of range before T-0. Nobody has run a store-and-forward recovery after real coverage loss, a 20-minute soak, a phone auto-rejoin to the field SSID, or a locked iPhone's BLE through a match. Three guns on one laptop radio is the most we have held at once, and the maximum is untested. FFA has been played on real guns (2026-08-30); Infection / LMS have not, and their logic is only sim-proven. The Companion and the Utility Box are not built. See *Honest gaps* below for the full list.
Source: docs/architecture-topology.md §7, docs/FOLLOWUPS.md B10, docs/archive/verification-checklist.md
