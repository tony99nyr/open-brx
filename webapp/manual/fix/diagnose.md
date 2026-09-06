# Diagnose my tagger
_Start with what you see. Pick the ladder that matches, then work down it. The headset is the first thing to check._
Last verified: 2026-08-27

**It won't fire.** Before you decide it is broken, check three things. Check the headset, the game state and the locks. Work the ladder in order and stop at the first check that says yes. Each block shows how sure we are. ✅📖👥
Source: docs/gotchas.md · docs/reference/community-notes.md · docs/reference/brx-manual-notes.md

**Three things to know before any ladder.** (1) The tagger keeps no game state. If it is not in a started game, it will not shoot anyone. ✅ (2) The gun locks when its headset disconnects *mid-game*. That is anti-cheat. 📖 (3) A dead player's trigger only clicks. That is a game rule, not a fault. ✅
Source: protocol/session-findings-2026-08.md §7n, §7r · docs/reference/brx-manual-notes.md (Headset §) · docs/experiment-log.md (2026-08-25 "dead gun can't fire")

## "Won't fire": the ladder
1. **Is the headset slow-blinking a rainbow?** → yes → It is disconnected. The gun will not join a game or fire until the headset links. Power the headset on and wait for it to settle to team colour. That can take up to 3 minutes in a room full of Bluetooth. If it never settles, re-pair (→ *Headset, pairing & Bluetooth*). ✅📖
2. **Did the headset drop *after* the game started?** (it was fine, then the gun "charges its energy weapon but nothing happens on the trigger") → yes → That is the anti-cheat lockout. Re-link the headset. If it will not link, power-cycle both and restart the round. 👥📖
3. **Is the game actually started?** → no → On-gun play: pull the **reload handle** to start. That is the "go" signal, not the trigger. Hosted play: wait for the host to start it. 📖
4. **Are you dead, or waiting on a respawn station?** → yes → Respawn, or walk to the station. Once a tagger has been armed to a respawn station, its self-respawn is off. A dead player's trigger only makes the empty click. ✅👥
5. **Can you cycle weapons with the trigger *before* a game starts?** → no → The controls are locked. Check the **admin lock**. The primary lock is LEFT+RIGHT held 3 s in the root menu. The secondary is LEFT+RIGHT+SELECT for 3 s, and it also blocks indoor/outdoor, weapon, team and perk changes. Unlock the same way (v4.30: also hold SELECT). 👥
6. **Does the reload handle click home?** → no → The handle drives a mechanical switch under two screws. Press that switch with a pen. If the pen works and the handle does not, the handle is the problem (→ *Repairs*). 📖👥
7. **Does the trigger switch show continuity when pulled?** (multimeter in beep mode, battery **unplugged**) → no → It is the trigger switch, or a loose cable inside. Open the shell and reseat the connectors (→ *Repairs*). 👥
8. **Still nothing?** → It is the mainboard. That is not community-serviceable. Contact Battle Company for repair. 👥
Source: docs/reference/community-notes.md ("Gun won't fire - diagnostic ladder") · docs/reference/brx-manual-notes.md · docs/reference/grenade.md (Respawn Station) · docs/experiment-log.md 2026-08-27 (headset rainbow)

**Running the gun from a third-party host or your own code?** We hit three silent fire-killers on the bench. Send the button map, or the firmware reports the trigger as disabled. Send a game head with no start command, and the gun spawns with a trigger that only reloads. Load a magazine *after* the spawn, or the gun goes live with no ammunition. ✅
Source: docs/gotchas.md ("Sending commands") · docs/experiment-log.md 2026-08-25 (night, try-out couldn't fire)

## "Won't power on" / "powers off by itself"
1. **Did you hold a button while sliding the switch?** → yes → SELECT-at-boot puts the gun in USB disk mode with **no startup sound**. It looks dead, but it is waiting for a computer. LEFT-at-boot is target mode. RIGHT-at-boot is accessory pairing. Power off, then power on with nothing held. 📖
2. **Is the battery charged?** → no → The charger LED is red while charging and goes green when full. A full charge gives ~8 h of play. Use the 8.4 V two-cell smart charger for the gun. The headset takes any 5 V USB. 📖
3. **Using AAs?** → The optional 6×AA tray takes **non-rechargeable** cells only. The manual says never use rechargeable AAs. 📖
4. **Replacement pack or rebuilt connector?** → Battle Company wires the battery connector with polarity **reversed** from the usual convention. Check it with a meter before you plug it in. A reversed pack can damage the board. 👥
5. **Random on/off, especially when jostled?** → The slide **power switch** is a known mechanical failure. Contact or switch cleaner buys you time. Replacing the switch is the real fix (→ *Repairs*). 👥
6. **Was the battery plugged in while you modded it?** → A live battery during a mod is how owners have killed mainboards. That is now a repair, not a fix. 👥
7. **Got wet?** → Owners have brought guns back after days of thorough drying. Take the battery out. Dry the gun fully before any power attempt. 👥
Source: docs/reference/brx-extended-user-guide.md (USB disk mode, battery) · docs/reference/brx-manual-notes.md · docs/reference/community-notes.md (Battery / power; Common failures)

~8 h play per charge (📖) · charger LED red → green when full (📖) · up to 3 min for a headset to auto-pair in a crowded room (📖) · a Bluetooth link does not always come up first try, official app included, so retrying is the fix (✅)
Source: docs/reference/brx-manual-notes.md · docs/reference/brx-extended-user-guide.md · docs/gotchas.md ("Connection failed") · docs/experiment-log.md 2026-08-23 (link held 73.8 s once up)
