# The Smart Grenade's game modes
_Five objective modes, one button, one colour — and which ones the guns can actually "see"_
Last verified: 2026-08-27

The BRX Smart Grenade is more than a bomb: hold its button and it becomes a **portable objective** — a respawn station, a King-of-the-Hill point, an assault objective, or a CTF flag base. It talks to every gun in range by IR beacon, and the guns do the sounds. There is no app for this; the mode is set on the device and locked there.
Source: docs/reference/grenade.md

## The five modes, by LED colour
| Colour | Mode | How it plays | Guns can read its state live? |
|---|---|---|---|
| **Red** | **Frag** | a blast grenade — throw or press to detonate (needs pairing to your headset); wipes everyone in ~30 ft | ❌ no beacon |
| **Green** | **Assault** | shoot it to capture it to your team's colour; attackers arm, defenders hold | ❌ captures silently (LED only) |
| **Blue** | **Hill (King of the Hill)** | starts neutral (white); shoot to capture — "control point captured"; each shot adds charge, the other team must fire at least as much back to retake; a thrown-grenade blast on the point captures it 100 % instantly; the holder gets a **rate-of-fire boost** | ✅ beacons owner every ~3–5 s |
| **Yellow** | **Respawn** | starts neutral; shoot to claim for a team; press the button to respawn everyone of that team nearby, or **face it with the front of your headset and pull the trigger** (~18–20 ft) | ✅ beacons owner every ~2.5 s |
| **White** | **CTF** | flag-base mode — shoot to grab; the carrier's tagger plays the "scary" flag music | ❌ no passive beacon |
Source: docs/reference/grenade.md §Exact setup procedure + §Respawn Station + §King of the Hill + §Assault, docs/reference/community-notes.md §Grenade notes

## Setting a mode (the finicky part, exactly)
1. Turn the grenade **off, then on**; wait for the **green** LED (ready).
2. **Hold the top button ~4 s** → a long loud beep means you are in setup.
3. It beeps rapidly and **cycles colour** while you hold. (A tagger left in its own setup mode will *announce each mode's name* as you cycle — a free audible monitor.)
4. **Release on the colour you want** — the LED goes **white** to confirm the lock.
5. The mode **survives a power-cycle**; on boot it flashes the current mode's colour for ~1 s so you can check it.
Source: docs/reference/grenade.md §Exact setup procedure

## The Respawn-station gotcha that gives the grenade its "buggy" reputation.
Setting the grenade to Respawn is not enough — **each tagger must also receive the station's IR** to switch from self-respawn to station-respawn. Either expose every gun to the station before the game, or press the grenade's button near each gun after the start (the reliable per-gun way). A gun that never got the signal just self-respawns as normal.
Source: docs/reference/grenade.md §Respawn Station mode

## What each mode gives you for $0
| You want | Grenade mode | Caveat |
|---|---|---|
| A respawn point per team | Yellow (Respawn) | arm every tagger; stations can be overtaken; "not always consistent" |
| King of the Hill / a checkpoint | Blue (Hill) | no winner display on the grenade — someone has to keep score |
| Two hills or two respawn points | two grenades | each is its own objective |
| A Counter-Strike bomb site | Blue (Hill) as the site | plant/defuse timer runs on a host, not the grenade |
Source: docs/reference/grenade.md §Known grenade quirks + §Resolved/still open, docs/game-modes.md §How much can the GRENADE do

## Where the grenade sounds come from.
The detonation, flashbang and gas effects, the CTF music, "control point captured" — all of it plays from the **gun and headset**, triggered by the grenade's IR. The grenade itself only chirps and flashes for status. Swap the tagger's sound files and every grenade "sounds" different without touching the accessory.
Source: docs/reference/grenade.md §Can we put new audio on the grenade

_[image GAME-12: REAL PHOTO — the Smart Grenade with its top button and LED, ideally lit in one of the mode colours.]_

_[diagram GAME-13: Colour-to-mode wheel: red Frag · green Assault · blue Hill · yellow Respawn · white CTF, with "beacons live" badges on Hill and Respawn.]_
