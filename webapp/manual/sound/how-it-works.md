# How BRX audio works
_One speaker, two triggers: what the gun plays by itself, and what a host tells it to play_
Last verified: 2026-08-27

## Every sound is an id.
The BRX plays clips from a 2166-entry bank on its internal storage. The gun fires most of them itself the instant something happens; a connected host (the Callsign app, or Open BRX Mission Control) fires the rest with a single command. Understanding which is which tells you what you can change.
Source: docs/sound-architecture.md

Two independent questions decide how any sound behaves: **who triggers it** (the gun autonomously vs. a host over Bluetooth) and **how much you can change it** (fixed, re-skinnable by file swap, or fully configurable). The rest of this page is those two cuts.
Source: docs/sound-architecture.md

## Cut 1 — who triggers the sound
- **Automatic, gun-played (mapped once at game start).** Hit tones, respawn chimes, armor/shield pickups, pain and death lines, and the weapon's own fire / reload / empty sounds. The loadout maps an event to a sound id (`$SIR` for incoming IR types, `$PSET` for the player's voice pack, `$WEAP` for the weapon), then the firmware plays it with no host involved.
- **Host-triggered announcements.** Anything that depends on game state only a host knows — "flag taken", "point captured", "3 minutes left", game over, custom announcers. The host sends `$PLAY,<id>,…` at the moment its rules say so.
- **Native reflexes.** The boot chime, "connection established" on phone attach, the disabled/"can't do that" chirp, low battery. Fired by the firmware on its own schedule; you can re-skin the clip but not stop it.
Source: docs/sound-architecture.md, protocol/brx-protocol.md §5 · docs/sound-architecture.md, protocol/brx-protocol.md · docs/sound-architecture.md

## Cut 2 — how much you can change each sound
| Tier | Examples | What you control |
|---|---|---|
| Forced (native, unstoppable) | Power-on boot sound — plays before any host connects, which is why a tagger is loud at startup | Nothing: can't suppress or trigger |
| Native reflex, re-skinnable | "Phone connected" on BLE attach · disabled chirp · reload / empty · low battery | Can't stop it firing, but the clip can be replaced via the USB `AUDIO` folder (see Custom sounds) |
| Config-driven, then automatic | Hit / pain / death / armor / shield / weapon sounds | Any bank id via the loadout (`$SIR` / `$PSET` / `$WEAP`), or replace the file |
| Host-triggered, fully yours | Objective callouts, timers, custom announcers | Any of the 2166 ids, on any rule, via `$PLAY` |
Only one sound is truly stuck: the boot chime.
Source: docs/sound-architecture.md

_[diagram SND-01: The two-slot `$PLAY` command: an effect slot and an announcer slot that can fire together.]_

## The `$PLAY` command (developer detail)
- Shape: `$PLAY,<soundID>,<volume>,<priority>,<announcerID>,,,,*` — token 1 is the local/effect sound, **token 4 is a second, independent announcer/voice slot**. `$PLAY,,4,6,V3A,,,,*` leaves the effect slot empty and speaks "kill". Both slots can carry an id at once: the app's game-end frame is `$PLAY,VSF,4,6,JAY,,,,*` (victory sting + "victory").
- The volume/priority tokens are **required**: `$PLAY,VA33,,,,,,,*` was silent on our bench; `$PLAY,VA33,4,6,,,,,*` spoke "game over". The official apps use `3,9` (Android) and `3,6` / `4,6` (iOS Callsign) — these are app conventions, not protocol constants.
- `$PLAYX,0,*` stops playback immediately (the app sends it right after `$STOP` on connect; it also silences a spawn voice line if sent right after `$SPAWN`).
- Any id not in the bank is invalid — and the gun plays a **fallback sound** for unknown ids rather than staying silent, which is why a microphone sweep can't enumerate the bank (a nonsense id produced audio at 150× the noise floor).
Source: protocol/brx-protocol.md §7o, docs/experiment-log.md 2026-08-25 · protocol/brx-protocol.md §7r, docs/experiment-log.md · protocol/brx-protocol.md, docs/experiment-log.md · docs/experiment-log.md #7, #20

## Where kill feedback comes from (and what the green sight flash is)
- When you score a kill in a game the app hosts, the shooter's gun gets three things from the host over Bluetooth: `$SFLASH,*` — the **green sight flash** (the scope/sight LED goes green as a kill-confirm), `$PLAY,,4,6,V3A,,,,*` — the "kill" line on the announcer slot, and, on a lead change, a score line such as `VB17`. One `$SFLASH` per kill, ~0.4 s after the trigger burst.
- `$SFLASH` is bare (no arguments), works on an idle unspawned gun, and needs no companion frame — we validated it from our own stack, sight went green.
- In a **phoneless game started from the gun menu**, the gun says "double kill" (and other streak lines) on its own — that audio is computed on the gun over its radio mesh with no phone involved. Once a Bluetooth host is driving the gun, those native multikill lines go silent and the host has to play them.
Source: protocol/brx-protocol.md §7o, docs/experiment-log.md 2026-08-25 · docs/experiment-log.md 2026-08-26 · docs/sound-architecture.md, docs/experiment-log.md 2026-08-25

## A native "silence" weapon exists.
One of the IR hit functions (function 23 in the `$SIR` table) does not touch health, ammo or the trigger — it **mutes the victim's gun audio**, which recovers over roughly 6–8 s. No fire sound, no reload chain, no overheat cue. It is stock firmware behaviour that any host can emit today.
Source: docs/experiment-log.md 2026-08-27 (fn 23)

- **Why does the gun play music when I die?** Your player profile carries a "music mix on death" slot alongside the death scream — it's part of the voice pack, not a separate feature (see Voice packs).
- **Grenade sounds — are they on the grenade?** Mostly no. The detonation, flashbang/gas effects, CTF music and "control point captured" lines are played by the gun from its own bank in response to the grenade's IR signal; the grenade itself only chirps and flashes for status, and it announces its mode through the tagger speaker only while the gun is in setup.
Source: protocol/callsign-extract/protocol-classes.md · docs/reference/grenade.md
