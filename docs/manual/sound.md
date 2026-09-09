# Sound, voice and updates
Last verified: 2026-09-09

How BRX plays sound: what the gun does on its own, what a host has to trigger, the full sound bank, and how to change what you hear over USB or through a firmware update.

## How BRX audio works

Every sound is an id. Your BRX stores 2,477 sound files (the official app's own list names 2,166 of them). The gun plays most of them by itself, the instant something happens. A host (the Callsign app, or Open BRX Mission Control) plays the rest with a single command. Knowing which is which tells you what you can change.

> **What decides behavior.** Two questions decide how any sound behaves. First, who starts it: the gun on its own, or a host over Bluetooth. Second, how much you can change it: fixed, swappable by file, or fully yours.

**Cut 1: who starts the sound**

- **Automatic, gun-played (mapped once at game start).** These are hit tones, respawn chimes, armor and shield pickups, pain and death lines, plus the weapon's own fire, reload and empty sounds. Your loadout points each event at a sound id (`$SIR` for incoming IR types, `$PSET` for your voice pack, `$WEAP` for the weapon). The firmware then plays it with no host involved.
- **Host-triggered announcements.** These depend on game state that only a host knows: "flag taken", "point captured", "3 minutes left", game over, custom announcers. The host sends `$PLAY,<id>,...` at the moment its rules say so.
- **Native reflexes.** The boot chime, "connection established" on phone attach, the disabled "can't do that" chirp, and low battery. The firmware fires these on its own schedule. You can swap the clip, but you cannot stop it.

**Cut 2: how much you can change each sound**

| Tier | Examples | What you control |
|---|---|---|
| Forced (native, unstoppable) | Power-on boot sound. It plays before any host connects, which is why a tagger is loud at startup | Nothing: can't suppress or trigger |
| Native reflex, re-skinnable | "Phone connected" on BLE attach, disabled chirp, reload / empty, low battery | You can't stop it firing, but you can replace the clip in the USB `AUDIO` folder (see Custom sounds over USB) |
| Config-driven, then automatic | Hit / pain / death / armor / shield / weapon sounds | Any bank id via the loadout (`$SIR` / `$PSET` / `$WEAP`), or replace the file |
| Host-triggered, fully yours | Objective callouts, timers, custom announcers | Any of the 2,477 ids on the gun, on any rule, via `$PLAY` |

Only one sound is truly stuck: the boot chime.

**The `$PLAY` command (developer detail)**

| Item | Value |
|---|---|
| Shape | `$PLAY,<soundID>,<volume>,<priority>,<announcerID>,,,,*`. Token 1 is the local effect sound; token 4 is a second, independent announcer/voice slot. |
| Two slots at once | `$PLAY,,4,6,V3A,,,,*` leaves the effect slot empty and says "kill". Both slots can carry an id at once: the app's game-end frame is `$PLAY,VSF,4,6,JAY,,,,*` (victory sting plus "victory"). |
| Required tokens | Volume and priority are required. `$PLAY,VA33,,,,,,,*` was silent on the bench; `$PLAY,VA33,4,6,,,,,*` spoke "game over". The official apps use `3,9` (Android) and `3,6` / `4,6` (iOS Callsign): app conventions, not protocol constants. |
| Stop playback | `$PLAYX,0,*` stops playback right away. The app sends it just after `$STOP` on connect, and it also silences a spawn voice line if sent right after `$SPAWN`. |
| Unknown id | Any id not in the bank is invalid. For an unknown id the gun plays a fallback sound instead of staying silent. That is why a microphone sweep can't list the bank: a nonsense id produced audio at 150x the noise floor. |

### Where kill feedback comes from, and what the green sight flash is

Score a kill in a game the app hosts, and your gun gets three things from the host over Bluetooth. `$SFLASH,*` is the green sight flash: the scope/sight LED goes green as a kill confirm. `$PLAY,,4,6,V3A,,,,*` says the "kill" line on the announcer slot. On a lead change, a score line such as `VB17` plays too. You get one `$SFLASH` per kill, about 0.4 s after the trigger burst.

`$SFLASH` is bare, with no arguments. It works on an idle unspawned gun and needs no companion frame.

In a phoneless game started from the gun menu, the gun says "double kill" and other streak lines on its own: it computes that audio over its radio mesh, with no phone involved. Once a Bluetooth host is driving the gun, those native multikill lines go silent and the host has to play them.

> **A native "silence" weapon.** One of the IR hit functions (function 23 in the `$SIR` table) does not touch health, ammo or the trigger. It mutes the victim's gun audio, which comes back over roughly 6-8 s. No fire sound, no reload chain, no overheat cue. It is stock firmware behavior, so any host can use it today.

### Why does the gun play music when I die?

Your player profile carries a "music mix on death" slot next to the death scream. It is part of the voice pack, not a separate feature (see Voice packs and announcers).

### Are grenade sounds on the grenade?

Mostly no. Your gun sees the grenade's IR signal and plays those sounds from its own bank: the blast, the flashbang and gas effects, the CTF music, the "control point captured" lines. The grenade itself only chirps and flashes for status. It announces its mode through the tagger speaker only while the gun is in setup.

## Voice packs and announcers

A voice pack is seventeen slots. The BRX does not ship "a male voice" and "a female voice" as one big pack. A player profile lists one sound id per game event: death alarm, pain, respawn cry, kill line. The characters you pick in the app are just pre-filled sets of those ids.

This is decoded from the app: the trailing tokens of a captured `$PSET` (e.g. `...,H44,JAD,V33,...,A10`) fill these slots in order.

| Slot | Event it fires on |
|---|---|
| deathAlarm | You died (the loud beep/alarm) |
| stealthDeathScream | Death while stealthed / quiet death |
| musicMixOnDeath | Death music sting (e.g. `JAD`) |
| deathScream | The character's death cry |
| battleRespawnCry | Respawn line ("Get some!", "Let's move out") |
| meleeGrunt | Melee swing |
| shortPain | Light hit |
| longPain | Heavy hit |
| painRelief | Healed / relieved |
| missShotHit | A shot that registered but did no damage (accuracy miss) |
| hitHp | Hit that took health |
| hitArmor | Hit that took armor |
| hitShield | Hit that took shield |
| hitCrit | Critical hit |
| emptyUnboundButtonSound | Pressing a button with nothing bound (the "can't do that" chirp) |
| ammoOrGearPickUp | Ammo / gear pickup |
| energyShieldLoop | Looping shield hum (e.g. `A10`) |

The "Get some" respawn line was traced to this block on the bench.

> **Design choice: pool sounds, not health sounds.** Open BRX uses the pool slots on purpose. Because the firmware carries a separate sound for a hit that took health, a hit that took armor and a hit that took shield, a hit can tell the player what it went through. Open BRX rings metal for armor and plays an energy note for the shield, drawing from a small pool so the same hit does not sound identical all match. Health is deliberately silent: the character's own pain grunt fires on exactly those hits, so real damage is the moment the metal stops and a human sound starts. The slot order above was confirmed on hardware 2026-09-07, and every sound was chosen by ear rather than from the catalog.

> **An empty slot is not silence.** Clearing one of these fields makes the gun fall through to a neighboring pool's sound, not go quiet: an empty hitShield plays the armor clip. Health can ship empty only because it is the innermost pool, with nothing further in to fall through to. This differs from the voice fields, where an empty value really does mean the gun says nothing. Confirmed on hardware 2026-09-07.

> **Where named voices come from.** The named voice profiles you choose in Callsign are not stored in the app. The app fetches them from Battle Company's server (`.../callsign/voice-profiles/selected/`) and writes the resulting slot ids into `$PSET`. Open BRX offers the same idea as a `voice` field on each player.

**Voice families in the bank**

Prefixes and character names are restated from David Knox's audio map; counts come from the bank file.

| Prefix | Character / voice | Ids |
|---|---|---|
| `VA` | Male (the default announcer; also the connect/countdown/game-over lines) | 321 |
| `VB` | Scout / clean female (score & lead lines such as `VB17` live here) | 90 |
| `VE` | Clean male | 9 (+13 `VEx` lines) |
| `VM` | Clean female | 9 (+12) |
| `VP` | Clean male (alt) | 9 (+12) |
| `VS` | Clean commander (game-end stings `VS6`, `VSB`, `VSF`) | 9 (+9) |
| `VC` | Sentinel | 9 (+13) |
| `VD` | Female sniper | 9 (+13) |
| `VF` / `VG` | Creature / female creature | 9 (+13) each |
| `VH` | Valkyrie ("weapons hot" `VHT`, kill `VHR`) | 9 (+22) |
| `VJ` | Viper | 9 (+13) |
| `VK` / `VL` | Wraith (Russian) / Russian clean | 9 (+13) / 9 (+12) |
| `VN` | Mercenary | 9 (+12) |
| `VQ` / `VR` | Nexus commander / Vanguard commander | 9 (+10) / 9 (+9) |
| `V0` Fury, `V1` Grenadier, `V2` Guardian, `V3` Heavy, `V4` Hive Queen, `V5`, `V6` Infiltrator, `V7` Marauder, `V8` Medic, `V9` Raider | The Supremacy / class characters | 23 each (V4: 33, V5: 26, V8: 35) |
| `V100`-`V144` | Gameplay callouts: CTF, Slayer, King of the Hill | 34 |

**What one character pack contains**

The pattern repeats across every `V<n>`/`V<letter>` family.

- **A "move" line**: Heavy `V3I` "Get some", Male `VAQ` "Let's move out", Scout `VBI` "Let's move", Valkyrie `VHT` "Weapons hot", Clean male `VEI` "Locked and loaded".
- **About four gasps** (Heavy `V3E`/`V3F`/`V3G`/`V3H`) and **three death screams** (Heavy `V33`/`V34`/`V35`; Male `VA3`/`VA4`/`VA5`; Medic `V85`/`V83`/`V84`).
- **A kill line**: Heavy `V3A`, Male `VAA`, Scout `VBA`, Medic `V8S`, Valkyrie `VHR`, Clean male `VEA`. `V3A` is the exact clip the official app plays on every scored kill.
- **A flavor line**: Medic `V8W` "One shot, one kill".

**Weapon callouts (announcer says the weapon name)**

| Weapon | Callout id | Fire sound id |
|---|---|---|
| M4 | `VA4B` | `R02` |
| TAC-87 shotgun | `VA6A` | `T14` |
| SR-100 sniper | `VA5Y` | `S16` |
| MG7 | `VA4F` | `J07` |
| SMG-x3 | `VA5R` | `G10` |
| TAR-33 (silenced AR) | `VA6B` | not documented |

> **Killstreak audio is not free under a phone or host.** "Double kill" and its friends are announced natively only in a game started from the gun's own menu. As soon as a host drives the gun over Bluetooth, the host must play them itself (`$PLAY` on the announcer slot). Open BRX's Mission Control does this. A bare Bluetooth script gets silence.

## The sound bank

2,477 sounds on the gun. One list. We read every file off a v4.32 tagger's `AUDIO` folder on 2026-09-03 and ran the voice lines through machine transcription. About 145 of those have since been confirmed by ear; the rest are machine guesses, and an unconfirmed transcript can be wrong. `V116` is catalogued as "Can't believe!" and the gun actually says "gained the lead". Treat any transcript below as a label to check, not a quote. The official app's own configuration file, `Sounds.json`, names 2,166 ids: 157 of those are not on the gun (they play the fallback sound), and 468 files on the gun are unknown to the app. The catalog is the authoritative set of `$PLAY` arguments, and of the file names you would replace over USB.

- **2,477** sound files on the gun (2,166 in the app's list; 157 app ids missing from the gun; 468 gun files the app does not know)
- **~4,700 s** (78 min) of audio across the app's 2,166-id list
- **136** `E_`-prefixed alternate takes of existing ids in the app's list
- **Longest:** `J100` at 250 s (a music bed). **Shortest:** `N1A` at 0.04 s

> **How to read an id.** The first letters are a family prefix (what kind of sound), and the rest is an index. `R02` is the second entry in the R (rifle-shot) family, and `V3A` is line A of the Heavy (V3) voice. An `E_` prefix marks an alternate take of the base id, so `E_VB17` is a variant of `VB17`. The `E_` set covers the VB, VA, J, K, N, X and VS families. Ids are the app's own names, and the protocol has no friendlier label.

**Category map: every family in the app's list**

Prefix meanings are restated from David Knox's audio map; counts are computed from the app's sound list. The on-gun catalog adds the `VX` and `VZ` voice families, `H102` to `H155` and more.

| Family | What it holds | Ids | Typical length |
|---|---|---|---|
| `VA` + `E_VA` | Male voice: announcer, system lines, weapon callouts, countdowns | 321 + 23 | 0.5-3 s (countdowns up to 11 s) |
| `VB` + `E_VB` | Scout / female-clean voice: score & lead lines | 90 + 64 | 1-2 s |
| `V0`-`V9` | Character voice packs (Fury, Grenadier, Guardian, Heavy, Hive Queen, V5 not named, Infiltrator, Marauder, Medic, Raider) | 23 each except V4 (33), V5 (26) and V8 (35); 255 total | 0.4-6 s |
| `V100`-`V144` | CTF / Slayer / King-of-the-Hill callouts | 34 | 1-2.4 s; three at 12-13 s |
| `VC`...`VS` (15 families) | Sentinel, Female sniper, Clean male, Creature, Female creature, Valkyrie, Viper, Wraith, Russian clean, Clean female, Mercenary, Clean male (alt), Nexus & Vanguard commanders, Clean commander | 9 base + 9-22 extra lines each (329 total, incl. 5 `E_VS` takes) | 1-6 s |
| `N` + `E_N` | Miscellaneous cues: the "kerchung", swish, revive ping, ultra-short ticks | 108 + 10 | 0.04-6.7 s |
| `NA` | Death beep (`NA0`) | 1 | 4 s |
| `M` | Mortal-Kombat-style SFX | 95 | 0.1-3.4 s (`M57` 25 s) |
| `U` | Beeps and boops (UI / system tones; `U16` is connect-related) | 91 | 0.05-1.9 s |
| `A` | Sci-fi SFX (incl. the shield loop `A10`; `A100`-`A103` run 7-24 s) | 80 | 0.2-24 s |
| `W` | Reloads | 74 | 0.3-8.7 s |
| `D` | Cocking / mechanical | 69 | 0.1-3.9 s |
| `H` | Hit SFX + special-weapon impacts (rail gun `H02`, energy blade `H50`, war hammer `H49`) | 59 | 0.4-6.4 s |
| `X` + `E_X` | Grenades and explosions (`X13` rocket) | 51 + 10 | 0.1-8 s |
| `R` | Rifle shots (`R02` M4) | 47 | 0.5-5 s |
| `SW` | Star-Wars-flavored SFX (`SW02` 28 s) | 34 | 0.3-28 s |
| `E` | Cool sci-fi SFX | 32 | 0.7-4.5 s |
| `JA` + `J` + `E_J` | Music & stings: `JA9` startup, `JAD` death music, `JAY` victory; `J01` 63 s and `J100` 250 s beds; `J07` MG7 fire | 32 + 23 + 12 | 1 s - 250 s |
| `B` | Bow / arrow | 31 | 0.2-2 s |
| `G` | SMG / gun shots (`G10` SMG-x3) | 23 | 0.5-2 s |
| `C` | Cool SFX | 21 | 1-4 s |
| `S` | Sniper / gun shots (`S16` SR-100) | 19 | 1-4 s |
| `P` | Pistol / gun shots | 18 | 0.7-2 s |
| `T` | Shotgun / gun shots (`T14` TAC-87) | 16 | 0.8-1.8 s |
| `F` | Fire / funny | 15 | 0.2-3.6 s |
| `Z` | Creature splat | 15 | 0.4-10 s |
| `K` + `E_K` | Fly-bys and air strikes | 12 + 12 | 2-30 s |
| `CC` | Contra-style SFX | 10 | 0.4-5.8 s |
| `Y` | Odd sci-fi | 10 | 0.2-3.7 s |
| `L` | Electrical | 7 | 0.4-4.5 s |
| `Q` | Silencers | 7 | 0.2-0.9 s |
| `O` | Big guns / ordnance | 6 | 1.5-2.5 s |

Sums to 2,166, the app's list; the gun holds 2,477 files.

**Thirty-odd ids worth knowing**

| Id | Family | Meaning | Length |
|---|---|---|---|
| `VA20` | VA | "Connection established": plays on every phone connect | 1.27 s |
| `U16` | U | Connect tone (paired with VA20) | 0.43 s |
| `VA81` | VA | 3-2-1 spawn countdown (arena) | 3.03 s |
| `VA33` | VA | "Game over" + music | 1.88 s |
| `VA85` | VA | Countdown to game over, no music | 10.01 s |
| `VSB` | VS | Countdown to game over + music | 10.46 s |
| `VS6` | VS | Game-end line (solo game close) | 2.42 s |
| `VSF` + `JAY` | VS / JA | Victory sting + "Victory": the winner's end-of-game pair | 1.86 s + 5.69 s |
| `VA46` | VA | Lives depleted / multi-kill | 1.47 s |
| `V3A` | V3 | "Kill": the app's per-kill announcer line | 0.79 s |
| `VB17` | VB | Score / lead-change line | 1.94 s |
| `N41` | N | Revive-countdown ping | 0.73 s |
| `NA0` | NA | Death beep (also the file swapped to change the death cue) | 4.00 s |
| `N03` | N | "Kerchung" | 0.82 s |
| `N04` | N | Swish | 1.43 s |
| `JA9` | JA | Startup music | 5.75 s |
| `JAD` | JA | Death music (the musicMixOnDeath slot) | 3.50 s |
| `H29` | H | Respawn / add-HP: a quiet, sustained "stim-pack" medical sound | 1.20 s |
| `VA16` | VA | "Armor suit": add armor | 0.94 s |
| `VA8C` | VA | "Shields online": add shields (SFX over the first word) | 1.50 s |
| `VA2` | VA | Tear gas effect | 5.98 s |
| `H02` | H | Rail gun impact | 0.39 s |
| `X13` | X | Rocket launcher / explosion | 1.55 s |
| `H50` | H | Energy blade | 0.99 s |
| `H57` | H | Rifle bash | 0.76 s |
| `H49` | H | War hammer | 1.21 s |
| `R02` | R | M4 fire | 2.20 s |
| `T14` | T | TAC-87 shotgun fire | 0.89 s |
| `S16` | S | SR-100 sniper fire | 1.61 s |
| `J07` | J | MG7 fire | 1.60 s |
| `G10` | G | SMG-x3 fire | 1.32 s |
| `V3I` | V3 | "Get some": Heavy respawn line | 1.53 s |
| `VA3` / `VA5` | VA | Male scream / yell (death-cue swap candidates) | 1.27 / 1.29 s |

The table below lists every sound on the gun: id, family, meaning where known, duration, and whether it is on the gun or app-only.

```data
sounds
```

## Custom sounds over USB

The `AUDIO` folder. Hold SELECT while you power on with a USB cable attached, and the tagger becomes a disk drive. You get a firmware file at the root and an `AUDIO` folder of per-sound files: replace a file, replace a sound. This is Battle Company's own update path, confirmed in their Extended User Guide, and the community has used it for Star Wars packs for years.

> **Back up the whole `AUDIO` folder before you change anything.** The originals belong to Battle Company, and the factory restore is their USB updater package (see Firmware updates and factory restore). Copying files is slow, so budget up to an hour per 250 MB. Don't unplug early.

**Swap a sound**

1. Power the tagger off, then connect the micro-USB Programming Port (not the charging port) to a computer.
2. Hold SELECT and switch the gun on. It makes no startup sound, and that silence is how you know you are in disk mode. A normal power-on never exposes the drive.
3. Open the removable disk that appears (Windows or macOS), with a `.BIN` at the root and an `AUDIO` folder. On older non-logo guns, tap SELECT a few times after entering if nothing shows.
4. Copy the entire `AUDIO` folder to your computer as a backup.
5. Name your replacement file `<ID>.LTP`, using the sound id from the bank (e.g. `R02.LTP` replaces the M4 fire sound, `NA0.LTP` the death beep).
6. Drag it into `AUDIO`, choose overwrite = yes, and wait for the copy to finish.
7. Eject the disk, power-cycle, and test with the on-gun menu (or `$PLAY,<id>,4,6,,,,,*` over Bluetooth).

**File facts**

| Item | Value |
|---|---|
| Naming | `<ID>.LTP`, one file per bank id. Known community swaps: `NA0.ltp` death loud-beep, `VA3.ltp` scream, `VA5.ltp` yell (copy or rename one over another to change the death cue). |
| Which files are which weapon | The Callsign-app gun sounds use different file names from the default (on-gun menu) weapon files. Replacing one set won't change the other. Default guns to target for the menu game: SR-100, TAC-87, SMG-x3, MG7. |
| Firmware v4.30+ | Needs a complete new audio-file set in `AUDIO`. After that update, old packs don't line up. |

**What people build with this**

- **Full overlay packs**: a complete Star Wars sound set exists in the owner community (credit David Knox). It replaces weapon, hit and voice files wholesale.
- **Re-skinning the "reflex" sounds**: the "phone connected" line, the disabled chirp, low battery. You can't stop them, but you can make them yours (Open BRX plans an "Open BRX connected" line this way).
- **Grenade audio**: the explosion, flashbang, gas and CTF music you hear from a grenade are gun-bank files (`X`/`H`/`JA` families). Swap those and every grenade "sounds different", with zero grenade modification.

> **Policy note.** Swapping files in `AUDIO` changes stored content, not firmware. It is the same mechanism Battle Company's updater uses, and it is reversible. Open BRX's own hard rule is "never modify stock firmware", and sound swaps sit comfortably inside it.

## Firmware updates and factory restore

One port, one `.BIN`. Firmware for the tagger, headset, hatchet, shield and sidearm all update the same way: enter USB disk mode, then replace the file at the root. Battle Company's updater package is also your factory restore, for both firmware and sounds.

**Update tagger firmware (Battle Company's procedure, restated)**

1. Get the current firmware package from [Battle Company](https://battlecompany.com/). We do not host a copy, and we have no permanent address for the download itself, so ask them for the current package rather than reusing an old file.
2. Switch the gun off, plug the USB cable into the Programming Port, then hold SELECT and switch on. There is no startup sound, and a disk appears.
3. Delete the existing `.BIN` at the root of the disk.
4. Copy the new `.BIN` to the root. Don't touch `AUDIO` unless the release notes say the audio set changed.
5. Eject and power-cycle. Non-logo (older) guns wait about 10 s and then announce "upgrade complete".

**Update a headset or accessory (hatchet, shield, sidearm)**

1. Hold the device's PROGRAM button (a pinhole) while you power it on.
2. Replace the root firmware file exactly as above, once it shows up as a USB disk.

> **Firmware v4.30 was a "makeover" release.** The community reports that it wipes on-gun config, breaks headset pairing and Callsign until you re-run setup, and requires a completely new audio-file set in `AUDIO`. Gen-1 guns need an extra step after flashing (reboot, then press SELECT three times). Read the release notes and back up `AUDIO` first.

### Known issues and Battle Company-verified fixes

- **Headset won't pair after an update.** The Battle-Company-verified recovery: downgrade to `BCgunV2_02e.bin`, run `SETUP` from the USB serial console, re-pair the headset, then re-upgrade to `BCgunV2_08b.bin`.
- **Re-pair a headset** without the downgrade: boot the gun holding RIGHT ("install accessory"), power the headset, then press its button once.
- **Admin lock blocks hosting.** Locked taggers (LEFT+RIGHT 3 s, or LEFT+RIGHT+SELECT 3 s) can't host. v4.30 adds hold-SELECT to unlock.
- **Version you're on:** the serial console's `QUERY` reports it. The guns on the bench run v4.32.

**Factory restore**

| Item | Value |
|---|---|
| Restore package | Battle Company's USB updater package is the reference firmware `.BIN` plus the matching `AUDIO` set. Restore both from that package and a tagger returns to stock, whatever packs were installed. |
| Your own backup | Keep your own backup of `AUDIO` from before any change. It is faster than a full restore, and it preserves the exact set your firmware version expects. |

> **Open BRX never modifies stock firmware.** All of its control runs over the Bluetooth serial protocol. So a tagger running Open BRX is always on Battle Company's firmware, and always restorable with Battle Company's updater.

## Volume

30 is silence. The gun menu offers volume 1-5. Over Bluetooth the same control is a 0-100 scale. On that scale, the gap between "quiet" and "you hear nothing" is smaller than you would think.

**The scales, side by side**

| Control | Range | Notes |
|---|---|---|
| On-gun menu (SELECT to settings) | 1-5 | Remembered per game mode as the new default |
| Bluetooth `$VOL,<0-100>,0,*` | 0-100 (`MaxMusicVolume` = 100) | Sent by every app on connect and again at game end |

**What the official apps send**

- Android Callsign: `$VOL,100`
- iOS Callsign: `$VOL,69`
- Open BRX game default: 80 indoors / 90 outdoors (`compile.play_volume()` sets it from the venue; 69 is estimated at roughly on-gun level 2, and it was inaudible on a field, 2026-08-30)
- Open BRX try-out default: 69 (fired at arm's length)
- Open BRX probing default: 30 (deliberately quiet, and deliberately not for games)

> **30 is not "quiet"; it is silent for weapon audio.** Measured with a microphone harness: at volume 100 the gun's sounds peak at 7-37 times the room noise floor, and at 30 nothing rises above room noise. Volume 45 is barely audible. Use 65 or higher to hear a tagger reliably. Open BRX plays at 80 indoors / 90 outdoors, because 69 was measurably too quiet across a field (2026-08-30). No absolute SPL figure exists for any of these values.

**Practical levels**

- **Play:** 80 indoors, 90 outdoors. That is what Open BRX sets from the venue, and an unknown venue gets the quieter of the two. The official iOS app's 69 is too quiet for game audio on a field; the Android app sends 100.
- **Try-outs:** 69. A try-out is fired at arm's length from the player's own head, so it stays quiet.
- **Bench / diagnostics:** 30 or lower keeps the neighbors happy and still confirms the command path (the gun echoes its state, you just won't hear it).

> **Safety.** The boot chime plays at the gun's stored level before any host can lower it. A gun last used at 100 is loud at the next power-on. Set the volume down before you switch off if kids or a quiet venue are next. Voice lines and the death beep are uncomfortable held to the ear at 100. The official iOS app ships 69 for a reason.
