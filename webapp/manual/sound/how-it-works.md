# How BRX audio works
_One speaker, two triggers: what the gun plays by itself, and what a host tells it to play_
Last verified: 2026-09-06

## Every sound is an id.
Your BRX stores 2,477 sound files (the official app's own list names 2,166 of them). The gun plays most of them by itself, the instant something happens. A host (the Callsign app, or Open BRX Mission Control) plays the rest with a single command. Knowing which is which tells you what you can change.
Source: protocol/brx-protocol.md §5, protocol/session-findings-2026-08.md §7o, docs/experiment-log.md #33-40

Two questions decide how any sound behaves. First, **who starts it**: the gun on its own, or a host over Bluetooth. Second, **how much you can change it**: fixed, swappable by file, or fully yours. The rest of this page is those two cuts.
Source: protocol/brx-protocol.md §5, protocol/session-findings-2026-08.md §7o, docs/experiment-log.md #33-40

## Cut 1: who starts the sound
- **Automatic, gun-played (mapped once at game start).** These are hit tones, respawn chimes, armor and shield pickups, pain and death lines, plus the weapon's own fire, reload and empty sounds. Your loadout points each event at a sound id (`$SIR` for incoming IR types, `$PSET` for your voice pack, `$WEAP` for the weapon). The firmware then plays it with no host involved.
- **Host-triggered announcements.** These depend on game state that only a host knows: "flag taken", "point captured", "3 minutes left", game over, custom announcers. The host sends `$PLAY,<id>,…` at the moment its rules say so.
- **Native reflexes.** The boot chime, "connection established" on phone attach, the disabled "can't do that" chirp, and low battery. The firmware fires these on its own schedule. You can swap the clip, but you cannot stop it.
Source: protocol/brx-protocol.md §5, docs/experiment-log.md #33 · protocol/session-findings-2026-08.md §7o, docs/experiment-log.md 2026-08-25 · protocol/brx-protocol.md §5, protocol/session-findings-2026-08.md §7o, docs/experiment-log.md #33-40

## Cut 2: how much you can change each sound
| Tier | Examples | What you control |
|---|---|---|
| Forced (native, unstoppable) | Power-on boot sound. It plays before any host connects, which is why a tagger is loud at startup | Nothing: can't suppress or trigger |
| Native reflex, re-skinnable | "Phone connected" on BLE attach · disabled chirp · reload / empty · low battery | You can't stop it firing, but you can replace the clip in the USB `AUDIO` folder (see Custom sounds) |
| Config-driven, then automatic | Hit / pain / death / armor / shield / weapon sounds | Any bank id via the loadout (`$SIR` / `$PSET` / `$WEAP`), or replace the file |
| Host-triggered, fully yours | Objective callouts, timers, custom announcers | Any of the 2,477 ids on the gun, on any rule, via `$PLAY` |
Only one sound is truly stuck: the boot chime.
Source: protocol/brx-protocol.md §5, protocol/session-findings-2026-08.md §7o, docs/experiment-log.md #33-40

_[diagram SND-01: The two-slot `$PLAY` command: an effect slot and an announcer slot that can fire together.]_

## The `$PLAY` command (developer detail)
- Shape: `$PLAY,<soundID>,<volume>,<priority>,<announcerID>,,,,*`. Token 1 is the local effect sound, and **token 4 is a second, independent announcer/voice slot**. `$PLAY,,4,6,V3A,,,,*` leaves the effect slot empty and says "kill". Both slots can carry an id at once: the app's game-end frame is `$PLAY,VSF,4,6,JAY,,,,*` (victory sting plus "victory").
- The volume and priority tokens are **required**. `$PLAY,VA33,,,,,,,*` was silent on our bench, and `$PLAY,VA33,4,6,,,,,*` spoke "game over". The official apps use `3,9` (Android) and `3,6` / `4,6` (iOS Callsign), which are app conventions, not protocol constants.
- `$PLAYX,0,*` stops playback right away. The app sends it just after `$STOP` on connect, and it also silences a spawn voice line if you send it right after `$SPAWN`.
- Any id not in the bank is invalid. For an unknown id the gun plays a **fallback sound** instead of staying silent. That is why a microphone sweep can't list the bank: a nonsense id produced audio at 150× the noise floor.
Source: protocol/session-findings-2026-08.md §7o, docs/experiment-log.md 2026-08-25 · protocol/session-findings-2026-08.md §7r, docs/experiment-log.md · protocol/brx-protocol.md, docs/experiment-log.md · docs/experiment-log.md #7, #20

## Where kill feedback comes from (and what the green sight flash is)
- Score a kill in a game the app hosts, and your gun gets three things from the host over Bluetooth. `$SFLASH,*` is the **green sight flash**: the scope/sight LED goes green as a kill-confirm. `$PLAY,,4,6,V3A,,,,*` says the "kill" line on the announcer slot. On a lead change, a score line such as `VB17` plays too. You get one `$SFLASH` per kill, about 0.4 s after the trigger burst.
- `$SFLASH` is bare, with no arguments. It works on an idle unspawned gun and needs no companion frame. We validated it from our own stack, and the sight went green.
- In a **phoneless game started from the gun menu**, the gun says "double kill" and other streak lines on its own. The gun computes that audio over its radio mesh, with no phone involved. Once a Bluetooth host is driving the gun, those native multikill lines go silent and the host has to play them.
Source: protocol/session-findings-2026-08.md §7o, docs/experiment-log.md 2026-08-25 · docs/experiment-log.md 2026-08-26 · protocol/session-findings-2026-08.md §7o, docs/experiment-log.md 2026-08-24/25

## A native "silence" weapon exists.
One of the IR hit functions (function 23 in the `$SIR` table) does not touch health, ammo or the trigger. It **mutes the victim's gun audio**, which comes back over roughly 6–8 s. No fire sound, no reload chain, no overheat cue. It is stock firmware behaviour, so any host can use it today.
Source: docs/experiment-log.md 2026-08-27 (fn 23)

- **Why does the gun play music when I die?** Your player profile carries a "music mix on death" slot next to the death scream. It is part of the voice pack, not a separate feature (see Voice packs).
- **Grenade sounds: are they on the grenade?** Mostly no. Your gun sees the grenade's IR signal and plays those sounds from its own bank: the blast, the flashbang and gas effects, the CTF music, the "control point captured" lines. The grenade itself only chirps and flashes for status. It announces its mode through the tagger speaker only while the gun is in setup.
Source: protocol/callsign-extract/protocol-classes.md · docs/reference/grenade.md
