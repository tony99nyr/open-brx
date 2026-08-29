# The Smart Grenade's game modes
_Five objective modes, one button, one colour, and which ones the guns can actually "see"_
Last verified: 2026-08-27

The BRX Smart Grenade is more than a bomb. Hold its button and it turns into a **portable objective**: a respawn station, a King-of-the-Hill point, an assault objective, or a CTF flag base. It talks to every gun in range with an IR beacon, and the guns make the sounds. There is no app for this. You set the mode on the device itself, and it stays locked there.
Source: docs/reference/grenade.md

## The five modes, by LED colour
| Colour | Mode | How it plays | Guns can read its state live? |
|---|---|---|---|
| **Red** | **Frag** | a blast grenade; throw it or press it to detonate (it needs pairing to your headset), and it wipes everyone within ~30 ft | ❌ no beacon |
| **Green** | **Assault** | shoot it to capture it to your team's colour; attackers arm, defenders hold | ❌ captures silently (LED only) |
| **Blue** | **Hill (King of the Hill)** | starts neutral (white); shoot it to capture and you hear "control point captured"; each shot adds charge, so the other team must fire at least as much back to retake it; a thrown-grenade blast on the point captures it 100 % instantly; the holder gets a **rate-of-fire boost** | ✅ beacons owner every ~3–5 s |
| **Yellow** | **Respawn** | starts neutral; shoot it to claim it for a team; press the button to respawn everyone of that team nearby, or **face it with the front of your headset and pull the trigger** (~18–20 ft) | ✅ beacons owner every ~2.5 s |
| **White** | **CTF** | flag-base mode; shoot it to grab it, and the carrier's tagger plays the "scary" flag music | ❌ no passive beacon |
Source: docs/reference/grenade.md §Exact setup procedure + §Respawn Station + §King of the Hill + §Assault, docs/reference/community-notes.md §Grenade notes

## Setting a mode (the finicky part, exactly)
1. Turn the grenade **off, then on**, and wait for the **green** LED (that means ready).
2. **Hold the top button ~4 s** → a long loud beep means you are in setup.
3. It beeps fast and **cycles colour** while you hold. (A tagger left in its own setup mode *says each mode's name* as you cycle, which is a free audio monitor.)
4. **Let go on the colour you want.** The LED turns **white** to confirm the lock.
5. The mode **survives a power-cycle**. On boot it flashes the current mode's colour for ~1 s so you can check it.
Source: docs/reference/grenade.md §Exact setup procedure

## The Respawn-station catch that earns the grenade its "buggy" reputation.
Setting the grenade to Respawn is not enough. **Each tagger must also receive the station's IR** to switch from self-respawn to station-respawn. Either show every gun the station before the game, or press the grenade's button near each gun after the start. That second way is the reliable one. A gun that never got the signal just self-respawns as normal.
Source: docs/reference/grenade.md §Respawn Station mode

## What each mode gives you for $0
| You want | Grenade mode | Caveat |
|---|---|---|
| A respawn point per team | Yellow (Respawn) | arm every tagger; stations can be overtaken; "not always consistent" |
| King of the Hill / a checkpoint | Blue (Hill) | no winner display on the grenade, so someone has to keep score |
| Two hills or two respawn points | two grenades | each one is its own objective |
| A Counter-Strike bomb site | Blue (Hill) as the site | the plant/defuse timer runs on a host, not the grenade |
Source: docs/reference/grenade.md §Known grenade quirks + §Resolved/still open, docs/game-modes.md §How much can the GRENADE do

## Where the grenade sounds come from.
The detonation, the flashbang and gas effects, the CTF music, "control point captured": all of it plays from the **gun and headset**, triggered by the grenade's IR. The grenade itself only chirps and flashes for status. Swap the tagger's sound files and every grenade "sounds" different, without touching the accessory.
Source: docs/reference/grenade.md §Can we put new audio on the grenade

_[image GAME-12: REAL PHOTO: the Smart Grenade with its top button and LED, ideally lit in one of the mode colours.]_

_[diagram GAME-13: Colour-to-mode wheel: red Frag · green Assault · blue Hill · yellow Respawn · white CTF, with "beacons live" badges on Hill and Respawn.]_
