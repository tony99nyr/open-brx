# Beyond stock — the Open BRX mode catalog
_Because the gun keeps no game state, any rule you can write over hits, teams, health and spawns is a mode. A teaser — the full catalog lives in the platform section._
Last verified: 2026-08-27

Every mode above is host-side rules over the same four primitives: the hit stream, team ids, the health pools, and respawn. Open BRX runs those rules on a laptop (Mission Control) and on a small node per player, so the same gear plays modes Battle Company never shipped — and modes that need props scale up through cheap tiers. → *Platform section* for the architecture.
Source: docs/game-modes.md, docs/mode-limits.md, protocol/callsign-extract/protocol-classes.md §What's moddable

## Modes by what they need
| Tier | What you add | Modes in the catalog |
|---|---|---|
| **Tier 0 — Mission Control alone** (taggers + a laptop/phone you own) | nothing | FFA · Team Death Match · Survival/Infection · The Swarm · Generals · Commander · Supremacy · Last Man Standing · **Syphon** (health on kill) · **Halo-style regenerating health** · overshield / medic roles · small-scale **Extraction** · grenade-site **Counter-Strike** |
| **Tier 1 — + props** (objective stations, flags, QR codes — or the grenade) | contested places | Domination · King of the Hill / Territory · Capture the Flag (standard, one-sided, centre-flag) · Assault · Team Arena · VIP escort · Hostage rescue · a real **Extraction point** |
| **Tier 2 — + broadcast** (a live field-wide downlink; location on each node) | live global awareness | Battle Royale · live scoreboards and "flag taken!" callouts on a big no-WiFi field · hidden multi-extracts |
Source: docs/game-modes.md §The three infrastructure tiers + §Catalog + §Custom/advanced modes, docs/mode-limits.md

## Three modes stock BRX doesn't ship
- **Extraction** — insert, loot, reach an extraction point and *channel* it (30–60 s, and it's loud — everyone converges), survive, bank the loot; die and you drop it all. Playable at $0 with the grenade as the beacon and phones as loot wallets; a rules engine already exists. ✅
- **Counter-Strike (plant / defuse)** — the grenade or a phone is the bomb; attackers arm (dwell, IR, or an on-screen code), defenders defuse (IR or a puzzle); round ends on detonate / defuse / elimination. ✅
- **Syphon & regenerating health** — the host credits the exact killer (every shot names its shooter) and tops up their pool; or refills anyone who has gone T seconds without damage. Both are pure host rules on top of the "heals add, never set" write. ✅
Source: docs/game-modes.md §Extraction + §Custom/advanced modes + §Health/regen variants, mcp/brx_mcp/modes/extraction.py

## Teams are more flexible than red vs blue.
The hardware supports four native teams with on-gun friendly-fire protection and per-team LED colour. For more squads, run everyone as one team with friendly fire on, hand out armbands, and let Mission Control keep the real teams and scores — a technique the owner community proved with clipped ribbon "flags".
Source: docs/game-modes.md §Team structure, docs/reference/community-notes.md §Game-mode design ideas

## Honest limits.
Phones have no IR, so shoot-the-point needs a station or the grenade; one phone can hold only a handful of gun links; a field without WiFi means live global state needs a radio tier. All of it is designed around, not ignored — the constraints ledger is in the platform section.
Source: docs/mode-limits.md §3

_[diagram GAME-14: The tier ladder — Tier 0 (laptop + taggers) → Tier 1 (+ stations / grenade) → Tier 2 (+ field broadcast), with representative modes stacked on each rung.]_
