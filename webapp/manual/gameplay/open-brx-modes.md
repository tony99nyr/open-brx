# Beyond stock: the Open BRX mode catalog
_The gun keeps no game state, so any rule you can write over hits, teams, health and spawns is a mode. This is a taste; the full catalog lives in the platform section._
Last verified: 2026-08-27

Every mode above is host-side rules over the same four building blocks: the hit stream, team ids, the health pools, and respawn. Open BRX runs those rules on a laptop (Mission Control) and on a small node per player. So the same gear plays modes Battle Company never shipped, and modes that need props scale up through cheap tiers. → *Platform section* for the architecture.
Source: docs/game-modes.md, docs/mode-limits.md, protocol/callsign-extract/protocol-classes.md §What's moddable

## Modes by what they need
| Tier | What you add | Modes in the catalog |
|---|---|---|
| **Tier 0 · laptop-only with `brx-mcp`** (taggers + a laptop you own) | nothing | FFA · Team Death Match · Survival/Infection · The Swarm · Generals · Commander · Supremacy · Last Man Standing · **Syphon** (health on kill) · **Halo-style regenerating health** · overshield / medic roles · small-scale **Extraction** · grenade-site **Counter-Strike** |
| **Tier 1 · + props** (objective stations, flags, QR codes, or the grenade) | contested places | Domination · King of the Hill / Territory · Capture the Flag (standard, one-sided, centre-flag) · Assault · Team Arena · VIP escort · Hostage rescue · a real **Extraction point** |
| **Tier 2 · + broadcast** (a live field-wide downlink; location on each node) | live global awareness | Battle Royale · live scoreboards and "flag taken!" callouts on a big no-WiFi field · hidden multi-extracts |
Source: docs/game-modes.md §The three infrastructure tiers + §Catalog + §Custom/advanced modes, docs/mode-limits.md

## Three modes stock BRX doesn't ship
- **Extraction**: drop in, loot, then reach an extraction point and *channel* it. That takes 30–60 s and it is loud, so everyone comes running. Survive and you bank the loot. Die and you drop all of it. You can play it for $0 with the grenade as the beacon and phones as loot wallets, and a rules engine already exists. ✅
- **Counter-Strike (plant / defuse)**: the grenade or a phone is the bomb. Attackers arm it (by dwell, IR, or an on-screen code) and defenders defuse it (by IR or a puzzle). The round ends on detonate, defuse or elimination. ✅
- **Syphon & regenerating health**: the host credits the exact killer (every shot names its shooter) and tops up their pool. Or it refills anyone who has gone T seconds without taking damage. Both are pure host rules on top of the "heals add, never set" write. ✅
Source: docs/game-modes.md §Extraction + §Custom/advanced modes + §Health/regen variants, mcp/brx_mcp/modes/extraction.py

## Teams are more flexible than red vs blue.
The hardware supports four native teams, with on-gun friendly-fire protection and a per-team LED colour. For more squads, run everyone as one team with friendly fire on. Hand out armbands, and let Mission Control keep the real teams and scores. The owner community proved this trick with clipped ribbon "flags".
Source: docs/game-modes.md §Team structure, docs/reference/community-notes.md §Game-mode design ideas

## Honest limits.
Phones have no IR, so shoot-the-point needs a station or the grenade. One phone can hold only a handful of gun links. A field without WiFi means live global state needs a radio tier. We design around all of it instead of ignoring it, and the constraints ledger is in the platform section.
Source: docs/mode-limits.md §3

_[diagram GAME-14: The tier ladder: Tier 0 (laptop + taggers) → Tier 1 (+ stations / grenade) → Tier 2 (+ field broadcast), with representative modes stacked on each rung.]_
