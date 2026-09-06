# Game modes
_Every mode we know the BRX can run, sorted by the gear it needs._
Last verified: 2026-09-06

## Two tier axes, kept separate.
*Infrastructure* tiers say what gear a mode needs (laptop-only → + props → + broadcast). *Spend* tiers (next page) say what each budget adds. A mode's infrastructure tier maps to whichever spend tier buys that gear.
Source: docs/game-modes.md §Three infrastructure tiers

## Laptop-only with `brx-mcp`, no props, no broadcast
(engines built 🧪; TDM ✅ on 2 guns; FFA / Infection / LMS engines sim-proven, not yet run on real guns)
- **Team Deathmatch**: two to four teams. Team kills or elimination. ✅ 2026-08-25
- **Free For All**: everyone against everyone. Exact per-player attribution over BLE (the shooter id rides in every hit). 🧪
- **Survival / Infection**: a kill turns a human into the infected team (the live `$TID` flip is bench-proven). 🧪 (flip ✅)
- **Last Man Standing**: limited lives, last one alive wins. 🧪
- **Generals / Commander / The Swarm**: one player *is* the team's mobile respawn point. 📐
- **Supremacy**: three factions, class loadouts as `$WEAP`/`$PSET`. 📐
- **Health variants**: Syphon (health-on-kill to the exact killer), Halo-style regen (host-driven; armor does not regen on its own), medic, armor overshield. 🧪 (`$LIFE`/`$BUMP` writes ✅)
Source: docs/game-modes.md §Catalog + §Health/regen, docs/archive/verification-checklist.md, mcp/brx_mcp/modes/

## + Props: a contested place needs a local authority
(engines built 🧪; need a station or a grenade to emit the IR events)
- **Domination**: hold control points to score over time. Multi-point wants linked stations. 🧪 engine
- **King of the Hill / Territory**: hold one zone. The Smart Grenade can be the hill for $0. 🧪 engine / ✅ grenade Hill mode
- **Capture the Flag**: standard, assault (one-sided) and centre-flag variants. 🧪 engine (grenade CTF team-assign still open)
- **Assault**: attack and defend objectives in order. 📐
- **Counter-Strike (plant / defuse)**: the grenade, a station, or *a phone's touchscreen* is the bomb. 🧪 engine
- **Team Arena**: TDM plus QR weapon pickups and capturable flags (paper QR = ~$0 props). 📐
- **VIP escort / Hostage rescue**: a special player role plus one extraction station. 📐
Source: docs/game-modes.md §Catalog + §Custom modes + §Hard ceilings

## + Broadcast / location
- **Battle Royale**: shrinking zone, GPS supply drops, last one alive. It needs per-node location and a live field-wide downlink (Tier 4 radio). 📐
- **Any prop mode with live callouts**: "flag taken!" everywhere, plus a live HQ scoreboard, on a large park with no Wi-Fi. 📐
Source: docs/game-modes.md §Catalog

## Extraction: the flagship mode Edge doesn't have
([image PLAT-04])
Extraction shooters (Tarkov, Hunt: Showdown, DMZ) fit laser tag perfectly. Drop in → **loot** → reach an extraction point and **start the channel, loudly, so everyone runs at you** → survive the channel → bank the loot. **Die and you drop everything.** 🧪 engine
Source: docs/game-modes.md §Extraction

## How Extraction maps onto the BRX
| Genre element | Open BRX implementation | Status |
|---|---|---|
| Your carried loot | the player's node is the **loot wallet** (kills, IR loot boxes, pickups), plus an optional printed QR "briefcase" you carry | 🧪 |
| Extraction point + "summon it, takes a while" | the King-of-the-Hill hold primitive with a **30–60 s channel timer**. Use a station, or the Smart Grenade as the beacon | 🧪 / 📐 |
| "It's loud" | the station and nearby nodes fire an audio/LED alarm; the guns themselves scream via `$PLAY`; field-wide needs the broadcast tier | 🧪 |
| Survive the channel | get killed or leave the zone and the channel pauses or resets | 🧪 |
| Drop it all on death | on `$HP,0` the wallet moves out, to a dropped token, the pool, or the killer | 🧪 |
| Extracted loot → power | banked value becomes score and/or `$LIFE`/`$WEAP` boosts on your next raid, so the stash carries over | 🧪 |
Source: docs/game-modes.md §Extraction, mcp/brx_mcp/modes/extraction.py

## Try Extraction with no hardware.
`python -m brx_mcp extraction-sim` runs the pure rules engine as a narrated demo (loot wallet, loud channel, drop-on-death, pickup, bank → boost, win target). A $0 version with the grenade as the beacon and phones as wallets is designed. The full version wants stations and the broadcast tier.
Source: docs/game-modes.md §Extraction, mcp/tests/test_extraction.py

## What the stock Smart Grenade gives you for $0
✅ hardware-characterised
| Mode (set by the on-grenade button, LED colour) | Live state readable over BLE? | Notes |
|---|---|---|
| Red = Frag | no | thrown blast |
| Green = Assault | no | shoot to capture to team colour |
| Blue = Hill (KotH) | **yes**, beacon `$HIR,0,15,0,<team>,<mode>` | holder gets a rate-of-fire perk |
| Yellow = Respawn | **yes** | disables self-respawn; respawn via grenade button |
| White = CTF | no | turned red, not team colour; team assignment unresolved |
`$GREN` over BLE does **not** set the mode (button-locked, anti-tamper), so config stays a printed cheat-sheet. Two grenades = two objectives.
Source: docs/game-modes.md §Grenade, docs/reference/grenade.md, docs/HANDOFF.md 2026-08-27
