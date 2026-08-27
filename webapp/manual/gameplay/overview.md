# What the BRX can play
_Two arsenals, three ways to run a game, and one damage model underneath all of it_
Last verified: 2026-08-27

The BRX runs games three ways: **from the gun's own menu** (no phone — 7 modes, 5–7 stock guns, 9 Supremacy characters), **from the Callsign app** (14 mode families, a 19-weapon arsenal, QR pickups, perks and killstreaks), or **from a host of your own** (Open BRX — any rule you can write over hits, teams, health and spawns). All three push the same primitives into the same firmware: the gun keeps no game state, so "mode" is always whoever is talking to it.
Source: docs/game-modes.md, protocol/callsign-extract/protocol-classes.md (§What's moddable), docs/reference/brx-manual-notes.md

- **19** weapons in the Callsign app arsenal, from **20** captured frames (every one read off the wire) ✅
- **7** gun-menu modes with no phone at all (FFA · Death Match · Generals · Supremacy · Commander · Survival · The Swarm) 📖
- **14** mode families implemented in the Callsign app 🔍
- **115** = the default health pool (45 HP + 70 armor) ✅
- **4** native hardware teams (team id is 2 bits in every shot) ✅
- **5** Smart Grenade objective modes, set by a button and a colour ✅
Source: docs/reference/weapons.md, docs/reference/brx-extended-user-guide.md, protocol/callsign-extract/apk-harvest.md, docs/weapon-design.md §0, docs/game-modes.md §Team structure, docs/reference/grenade.md

- **The arsenal** — all 19 Callsign weapons (20 captured frames) with damage, cycle, clip, reserve, heat, reload and fire mode. → `/manual/gameplay/weapons`
- **Health, armor & damage** — what a hit subtracts, what armor does, why nothing regenerates on its own. → `/manual/gameplay/health`
- **How a kill actually works** — the 25-bit word of light, the three sensors that catch it, the green flash that confirms it. → `/manual/gameplay/how-a-kill-works`
- **Native modes & settings** — every gun-menu and Callsign mode, with the exact setting values. → `/manual/gameplay/modes`
- **Classes, factions, perks & killstreaks** — Nexus/Resistance/Vanguard, the 9+ characters, the perk row, the streak rewards. → `/manual/gameplay/classes-and-perks`
- **The grenade's game modes** — Frag · Assault · Hill · Respawn · CTF, and how each one really behaves. → `/manual/gameplay/grenade-modes`
- **Beyond stock: the Open BRX catalog** — Extraction, Counter-Strike, Syphon, and the infrastructure tiers. → `/manual/gameplay/open-brx-modes`
Source: this section

## Two arsenals, one gun.
The gun-menu weapons (M-4, SMG-X3, MG-7, SR-100, TAC-87 …) are presets the firmware carries for phoneless play. The Callsign app's 19 weapons are *sent* to the gun over Bluetooth at game start — the same 6 weapon slots, filled with different numbers. This section documents the Callsign 19 in full because we captured every one of them on the wire (20 frames); the gun-menu five are listed from the manual.
Source: docs/reference/brx-manual-notes.md §Stock weapons, docs/reference/weapons.md, protocol/callsign-extract/protocol-classes.md §What's moddable
