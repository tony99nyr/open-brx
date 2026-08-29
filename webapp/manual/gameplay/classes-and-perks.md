# Classes, factions, perks & killstreaks
_What Supremacy's characters are made of, what the ALT button cycles, and what the app hands out for streaks_
Last verified: 2026-08-27

Supremacy swaps the weapon picker for **characters**. Each one has a fixed gun, a set health/armor/shield build, and an ALT-button ability. Three factions split the roster: **Nexus** (energy, shields, explode-on-death), **Resistance** (milsim, explosives) and **Vanguard** (exotic, long-range).
Source: docs/reference/brx-manual-notes.md §Supremacy characters, docs/reference/brx-extended-user-guide.md §Character classes

## The 9 manual characters
the exact health builds Battle Company prints. There are two pool shapes here: armor characters and shield characters.
| Character | Role | Mag | Damage | Health | Armor | Shield | Ability (ALT) |
|---|---|---:|---:|---:|---:|---:|---|
| Soldier | Offense | 30 | 22 | 100 | 50 | – | secondary shotgun (M4 + shotgun swap) |
| Medic | Support | 30 | 21 | 100 | 40 | – | **medi-gel heal pulse**: heals allies when you shoot them |
| Heavy | Tank | 75 | 38 | 100 | 75 | – | rally: an attack boost for allies |
| Guardian | Support | 50 | 20–100 | 75 | – | 125 | charge-up plasma + **shield regenerator** |
| Marauder | Offense | 32 | 23 | 75 | – | 150 | adrenaline: a rate-of-fire boost |
| Sentinel | Tank | 100 | 25 | 75 | – | 175 | **EMP blast**: stuns a group |
| Viper | Offense | 16 | 25 | 125 | 25 | – | poison burst rifle + poison grenades |
| Technician | Support | 8 | 28 | 125 | 30 | – | incendiary rifle + medi-gel heal-over-time |
| Wraith | Tank | 32 | 25 | 125 | 50 | – | cryo rifle + frost grenades (slows enemy attack speed) |
Source: docs/reference/brx-manual-notes.md §Supremacy character ABILITIES + §Supremacy characters (V7 manual p.6)

## Four more classes described in the Extended Guide
(not in the V7 table)
- **Grenadier**: laser beam + sticky grenade 📖
- **Mercenary**: silenced AR + healing/tracking dart 📖
- **Valkyrie**: burst SMG + mini-rockets 📖
- **Sniper**: armor-piercing bolt rifle, silencer on ALT 📖
Source: docs/reference/brx-extended-user-guide.md §Character classes

## Status effects the app defines.
Here is the app's damage and ability list: Standard · MedicHeal · ActivateShield · RallyPulse · Radiation (poison) · Cryogenic (frost) · ArmorPiercing · EMP · Shrapnel · StickyBomb · lethal and non-lethal explosive · ShottyPellets · MeleeDamage · Plasma. Each one has its own hit-sound slot in the app's sound table (poison hit, cold hit, EMP start/loop/end, incendiary start/loop/stop …).
Source: protocol/callsign-extract/protocol-classes.md §Enums + §FSET

## Perks: what ALT cycles in Death Match / Generals
("not all games have perks", and TDM is the only stock mode with the perk row)
| Perk | Effect | Source |
|---|---|---|
| Grenade Launcher | launcher alt-fire | V7 manual + Extended Guide 📖 |
| Med Kit | self-heal | V7 + EUG 📖 |
| Body Armor | extra armor | V7 + EUG 📖 · 👥 on a General it *lowers* total health (a known stock quirk) |
| Extended Mags | bigger magazines | V7 + EUG 📖 |
| Concussion Grenade | stun grenade | V7 + EUG 📖 |
| Critical Strike | crit chance | EUG only 📖 |
| Foregrip | less recoil drift | EUG only 📖 |
| Focus | laser designator | EUG only 📖 |
Source: docs/reference/brx-manual-notes.md §Per-mode weapons & perks, docs/reference/brx-extended-user-guide.md §Perks, docs/reference/community-notes.md §Balance notes

## Killstreak rewards in the Callsign app
🔍 the list in the app's config. None of them is a tagger command.
| Reward | Warns the enemy? |
|---|---|
| UAV | yes |
| Counter UAV | no |
| Power Weapon | no |
| Body Armor | no |
| Second Life | no |
| Care Package | no |
| System Hack | yes |
| Mortar Strike | yes |
| Weapons Crate | no |
| Mystery Box | no |
| MEDEVAC | no |
| Support Package | no |
| Air Strike | yes |
| Chopper | yes |
| Air Raid (bombing run) | yes |
| Nuke | yes |
Source: protocol/callsign-extract/streak-rewards-config.json, protocol/callsign-extract/config-facts.md

## Post-game medals (21, from the app's config)
🔍
- **MVP**: highest score on their team · **Top Gun**: most kills · **Sharp Shooter**: most accurate · **Trigger Happy**: most shots fired · **Grave Lover**: most deaths · **Highest K/D** · **Survivalist**: fewest deaths · **Top 3**: top three score on your team · **The Assistant**: most assists · **Objective King**: most flags/boxes
- **First Blood**: first kill of the game · **Double Kill / Triple Kill / Killtacular**: 2/3/4 kills, each within 4 s of the last · **Streaky**: a 5-kill streak · **Streakerten**: a 10-kill streak · **Streakernaut**: highest streak in the game
- **Ninja**: 3 melee kills in one life · **Assassin**: most melee kills · **Weapons Expert**: 3 kills with 2+ weapons · **Head Shot**: 5 kills by head shots only
Source: protocol/callsign-extract/game-medals-config.json

## Where each fact on this page comes from.
✅ On the bench: the character health/armor/shield shapes are real pools the gun tracks; medic heal and shield grant exist as IR effect functions; the gun announces "double kill" by itself in gun-menu games. 📖 From the manuals: the character table, the abilities, the factions and the perk list. 🔍 From the app's config: the 16 streak rewards and the 21 medals.
Source: docs/experiment-log.md (#33, killstreak/multikill entries), docs/sound-architecture.md §Native multikills
