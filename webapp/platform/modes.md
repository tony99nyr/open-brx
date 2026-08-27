# Game modes
_Every mode we know the BRX can run — classified by the gear it needs._
Last verified: 2026-08-27

## Two tier axes, kept separate.
*Infrastructure* tiers say what gear a mode needs (Mission Control alone → + props → + broadcast). *Spend* tiers (next page) say what each budget adds. A mode's infrastructure tier maps to whichever spend tier supplies that gear.
Source: docs/game-modes.md §Three infrastructure tiers

## Mission Control alone — no props, no broadcast
(engines built 🧪; TDM ✅ on 2 guns; FFA / Infection / LMS engines sim-proven, not yet run on real guns)
- **Team Deathmatch** — two to four teams; team kills or elimination. ✅ 2026-08-25
- **Free For All** — everyone vs everyone; exact per-player attribution over BLE (shooter id rides in every hit). 🧪
- **Survival / Infection** — a kill converts a human to the infected team (live `$TID` flip is bench-proven). 🧪 (flip ✅)
- **Last Man Standing** — limited lives; last alive. 🧪
- **Generals / Commander / The Swarm** — a player *is* the team's mobile respawn point. 📐
- **Supremacy** — three factions, class loadouts as `$WEAP`/`$PSET`. 📐
- **Health variants** — Syphon (health-on-kill to the exact killer), Halo-style regen (host-driven; armor does not regen natively), medic, armor overshield. 🧪 (`$LIFE`/`$BUMP` writes ✅)
Source: docs/game-modes.md §Catalog + §Health/regen, docs/verification-checklist.md, mcp/brx_mcp/modes/

## + Props — a contested place needs a local authority
(engines built 🧪; need a station or a grenade to emit the IR events)
- **Domination** — hold control points for score-over-time; multi-point wants linked stations. 🧪 engine
- **King of the Hill / Territory** — hold one zone; the Smart Grenade can be the hill for $0. 🧪 engine / ✅ grenade Hill mode
- **Capture the Flag** — standard, assault (one-sided) and centre-flag variants. 🧪 engine (grenade CTF team-assign still open)
- **Assault** — attack/defend objectives in sequence. 📐
- **Counter-Strike (plant / defuse)** — the grenade, a station, or *a phone's touchscreen* is the bomb. 🧪 engine
- **Team Arena** — TDM + QR weapon pickups + capturable flags (paper QR = ~$0 props). 📐
- **VIP escort / Hostage rescue** — a special player role + one extraction station. 📐
Source: docs/game-modes.md §Catalog + §Custom modes, docs/mode-limits.md §2

## + Broadcast / location
- **Battle Royale** — shrinking zone, GPS supply drops, last alive; needs per-node location and a live field-wide downlink (Tier 4 radio). 📐
- **Any prop mode with live callouts** — "flag taken!" everywhere, a live HQ scoreboard, on a large no-Wi-Fi park. 📐
Source: docs/game-modes.md §Catalog, docs/build-tiers.md Tier 4

## Extraction — the flagship mode Edge doesn't have
([image PLAT-04])
The extraction-shooter genre (Tarkov, Hunt: Showdown, DMZ) maps beautifully onto laser tag: insert → **loot** → reach an extraction point and **channel it — loudly, so everyone converges on you** → survive the channel → bank the loot. **Die and you drop everything.** 🧪 engine
Source: docs/game-modes.md §Extraction

## How Extraction maps onto the BRX
| Genre element | Open BRX implementation | Status |
|---|---|---|
| Your carried loot | the player's node is the **loot wallet** (kills, IR loot boxes, pickups); optional printed QR "briefcase" you physically carry | 🧪 |
| Extraction point + "summon it, takes a while" | the King-of-the-Hill hold primitive with a **30–60 s channel timer** — a station, or the Smart Grenade as the beacon | 🧪 / 📐 |
| "It's loud" | station + nearby nodes fire an audio/LED alarm; the guns themselves scream via `$PLAY`; field-wide needs the broadcast tier | 🧪 |
| Survive the channel | killed or leave the zone → channel pauses/resets | 🧪 |
| Drop it all on death | on `$HP,0` the wallet transfers out — to a dropped token, the pool, or the killer | 🧪 |
| Extracted loot → power | banked value becomes score and/or `$LIFE`/`$WEAP` boosts on the next raid — a persistent stash | 🧪 |
Source: docs/game-modes.md §Extraction, mcp/brx_mcp/modes/extraction.py

## Try Extraction with no hardware.
`python -m brx_mcp extraction-sim` runs the pure rules engine — loot wallet, loud channel, drop-on-death, pickup, bank → boost, win target — as a narrated demo. A $0 version with the grenade as the beacon and phones as wallets is designed; the full version wants stations and the broadcast tier.
Source: docs/game-modes.md §Extraction, mcp/tests/test_extraction.py

## What the stock Smart Grenade gives you for $0
✅ hardware-characterised
| Mode (set by the on-grenade button, LED colour) | Live state readable over BLE? | Notes |
|---|---|---|
| Red = Frag | no | thrown blast |
| Green = Assault | no | shoot to capture to team colour |
| Blue = Hill (KotH) | **yes** — beacon `$HIR,0,15,0,<team>,<mode>` | holder gets a rate-of-fire perk |
| Yellow = Respawn | **yes** | disables self-respawn; respawn via grenade button |
| White = CTF | no | turned red, not team colour — team assignment unresolved |
`$GREN` over BLE does **not** set the mode (button-locked, anti-tamper) — config stays a printed cheat-sheet. Two grenades = two objectives.
Source: docs/game-modes.md §Grenade, docs/reference/grenade.md, docs/HANDOFF.md 2026-08-27
