# Callsign config facts (restated)

Facts restated in our own words from the Callsign app's `assets/Configs/` JSON, per the repo
policy (`RAW_ASSETS_NOTE.md`): document facts, never copy assets. These describe game
design the platform can mirror; none are protocol-wire facts (those go in
`protocol/brx-protocol.md`). The raw config JSONs named below were committed under a temporary
exception through 2026-09-06 and were removed 2026-09-07 (`RAW_ASSETS_NOTE.md`); the filenames
stay in the headers as provenance for where each fact came from, not as a claim they are still
in the repo.

## Weapon category ids (from `weapon-categories-config.json`, removed 2026-09-07)

Guns use category ids **0 Rifle, 1 SMG, 2 Sniper, 3 Shotgun, 4 Heavy, 5 Energy, 6 Support,
7 Power, 8 Exotic, 9 Launcher, 10 Stun** (default gun category = 0). Abilities use id **11
Ability**; melee uses id **12 Melee**. (Whether these map to any `$WEAP` token is untested —
they are the app's UI grouping.)

## Post-game medals (from `game-medals-config.json`, removed 2026-09-07)

Award one per game, by computed stat — a stats model the platform's scoreboard/replay can
reproduce:

| Medal | Awarded to |
|---|---|
| MVP | highest score on their team |
| Top Gun | most kills in the game |
| Sharp Shooter | most accurate |
| Trigger Happy | most shots fired |
| Grave Lover | died the most |
| Highest K/D | best kill/death ratio |

(…medal list continues; these are the leading entries. The stats implied — score, kills,
accuracy, shots fired, deaths, K/D — are what a scoreboard must track.) The full 21-medal list,
restated with each award's window in seconds where the app's own text gives one (Double/Triple
Kill/Killtacular: 4 s), is `mcp/brx_mcp/data/medals.json`.

## Streak rewards (from `streak-rewards-config.json`, removed 2026-09-07)

Killstreak-style rewards the app grants: **UAV, Counter UAV, Power Weapon, Body Armor,
Second Life, Care Package, System Hack, Mortar** (…). UAV and System Hack raise an enemy
"warning." These are a design reference for the items/power-ups system in the master plan —
not tagger commands.
