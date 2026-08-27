# The On-Gun Menu
_Everything you can set without a phone — and what the gun remembers._
Last verified: 2026-08-27

The gun's LED tells you which mode is selected: **white** Free For All · **red** Death Match · **yellow** Generals · **blue** Supremacy · **pink** Commander · **green** Survival · **orange** The Swarm. During play the same LED indicates ammo and health.
Source: docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

## Navigating the root menu
1. Power on → you are at the root menu. LEFT / RIGHT cycle game modes; the LED colour changes with each. **Trigger selects.** 📖
2. D-pad picks your team or faction. Trigger cycles weapons (or characters in Supremacy). ALT cycles perks — only in modes that have them. 📖
3. Press SELECT to step through the game variables: lives, game time, respawn, volume. D-pad changes each value; SELECT advances. 📖
4. Pull the reload handle to start. Settings you changed become the new defaults for that mode. 📖
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

## Game variables on the gun
| Setting | Values | Notes |
|---|---|---|
| Game time | Off · 5 · 10 · 15 · 20 · 30 min | 📖 |
| Respawn | Off · 15 · 30 · 60 s · Ramp 45 · Ramp 90 | "Ramp" grows the penalty with each death, up to the cap 📖👥 |
| Volume | 1 – 5 | 📖 |
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

These variables are remembered **per game mode** and live on the gun. They are not the same numbers the Callsign app uses — the app keeps its own clock and respawn timer on the phone and never writes these to the gun.
Source: docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7n

## Button holds worth memorising
- **ALT, hold 3 s** — toggle indoor / outdoor (persists). 📖
- **LEFT at power-on** — target mode for sighting. 📖
- **RIGHT at power-on** — "install accessory" pairing mode (headset, grenade, sidearm…). 📖👥
- **SELECT at power-on** — USB disk mode; no startup sound. 📖
- **LEFT + RIGHT, hold 5 s in a game** — soft reset back to the menu. 📖
- **LEFT + RIGHT, hold 3 s at the root menu** — admin lock (blocks mode changes and reset); add SELECT for the stronger lock that also freezes indoor/outdoor, weapon, team and perk. A locked gun cannot host. 👥
- **Swing your elbow (gesture-enabled "logo" guns)** — melee from the headset's front emitter; other guns use RIGHT. 📖
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

## Stock modes selectable on the gun
| Mode | Teams | Weapons | Perks |
|---|---|---|---|
| Free For All | none, friendly fire on | M-4 · SMG-X3 · MG-7 · SR-100 | — |
| Team Death Match | Alpha / Bravo | + TAC-87 | Grenade Launcher · Med Kit · Concussion Grenade · Extended Mags · Body Armor |
| Supremacy | Resistance (red) / Vanguard (green) / Nexus (blue) | 9 characters are the loadout | per-character abilities |
| Survival | Human / Infected | M-4 · SMG-X3 · MG-7 · SR-100 · TAC-87 | — |
Generals, Commander and The Swarm appear on newer firmware as Callsign-Live unlocks. Full stats and abilities are in the *Game Modes & Weapons* section. 📖
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

_[diagram OPS-03: ]_
