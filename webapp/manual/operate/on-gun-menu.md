# The On-Gun Menu
_Everything you can set without a phone, and what the gun remembers._
Last verified: 2026-08-27

The gun's LED tells you which mode is selected: **white** Free For All · **red** Death Match · **yellow** Generals · **blue** Supremacy · **pink** Commander · **green** Survival · **orange** The Swarm. During play the same LED shows ammo and health.
Source: docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

## Navigating the root menu
1. Power on. You land at the root menu. LEFT / RIGHT cycle game modes and the LED colour changes with each one. **Trigger selects.** 📖
2. Pick your team or faction with the D-pad. Trigger cycles weapons (or characters in Supremacy). ALT cycles perks, but only in modes that have them. 📖
3. Press SELECT to step through the game variables: lives, game time, respawn, volume. The D-pad changes each value and SELECT moves you on. 📖
4. Pull the reload handle to start. Anything you changed becomes the new default for that mode. 📖
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

## Game variables on the gun
| Setting | Values | Notes |
|---|---|---|
| Game time | Off · 5 · 10 · 15 · 20 · 30 min | 📖 |
| Respawn | Off · 15 · 30 · 60 s · Ramp 45 · Ramp 90 | "Ramp" grows the penalty with each death, up to the cap 📖👥 |
| Volume | 1 – 5 | 📖 |
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md (respawn delay ramps)

The gun remembers these variables **per game mode**, and they live on the gun. They are not the numbers the Callsign app uses. The app keeps its own clock and respawn timer on the phone, and it never writes these to the gun.
Source: docs/reference/brx-extended-user-guide.md, protocol/session-findings-2026-08.md §7n

## Button holds worth memorising
- **ALT, hold 3 s**: toggle indoor / outdoor (it sticks). 📖
- **LEFT at power-on**: target mode, for sighting. 📖
- **RIGHT at power-on**: "install accessory" pairing mode (headset, grenade, sidearm and friends). 📖👥
- **SELECT at power-on**: USB disk mode. No startup sound. 📖
- **LEFT + RIGHT, hold 5 s in a game**: soft reset back to the menu. 📖
- **LEFT + RIGHT, hold 3 s at the root menu**: admin lock. It blocks mode changes and reset. Add SELECT for the stronger lock, which also freezes indoor/outdoor, weapon, team and perk. A locked gun cannot host. 👥
- **Swing your elbow (gesture-enabled "logo" guns)**: melee from the headset's front emitter. Other guns use RIGHT. 📖
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

## Stock modes selectable on the gun
| Mode | Teams | Weapons | Perks |
|---|---|---|---|
| Free For All | none, friendly fire on | M-4 · SMG-X3 · MG-7 · SR-100 | none |
| Team Death Match | Alpha / Bravo | + TAC-87 | Grenade Launcher · Med Kit · Concussion Grenade · Extended Mags · Body Armor |
| Supremacy | Resistance (red) / Vanguard (green) / Nexus (blue) | 9 characters are the loadout | per-character abilities |
| Survival | Human / Infected | M-4 · SMG-X3 · MG-7 · SR-100 · TAC-87 | none |
Generals, Commander and The Swarm show up on newer firmware as Callsign-Live unlocks. Full stats and abilities are in the *Game Modes & Weapons* section. 📖
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

_[diagram OPS-03: ]_
