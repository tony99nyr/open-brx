# Sound, voice and updates
Last verified: 2026-09-20

How BRX plays sound: what the gun does on its own, what a host has to trigger, and how to change what you hear over USB or through a firmware update.

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
| Slots behave differently | Token 1 interrupts: sending a new id there cuts off whatever is playing, in either slot, even mid-word. Token 4 queues: a new id there waits its turn and plays after what is ahead of it, several deep. This is true of the slot, not the id: an effect id sent through token 4 queues exactly like a voice line does. Put anything that must never be cut off in token 4, and accept that anything urgent in token 1 can cut a line short. |
| Required tokens | Volume and priority are required. `$PLAY,VA33,,,,,,,*` was silent on the bench; `$PLAY,VA33,4,6,,,,,*` spoke "game over". The official apps use `3,9` (Android) and `3,6` / `4,6` (iOS Callsign): app conventions, not protocol constants. |
| Stop playback | `$PLAYX,0,*` stops playback right away. The app sends it just after `$STOP` on connect, and it also silences a spawn voice line if sent right after `$SPAWN`. One stop per write stops only the clip playing; several stops in one write can clear every queued clip. |
| Queue | `$PLAY` clips queue first in, first out. Four `$PLAY` frames written with no gap between them lost one clip, in 2 of 2 runs, so Open BRX spaces its `$PLAY` writes. The smallest safe gap is not measured. |
| Unknown id | Any id not in the bank is invalid. For an unknown id the gun plays a fallback sound instead of staying silent. That is why a microphone sweep can't list the bank: a nonsense id produced audio at 150x the noise floor. |

### Where kill feedback comes from, and what the green sight flash is

Score a kill in a game the app hosts, and your gun gets three things from the host over Bluetooth. `$SFLASH,*` is the green sight flash: the scope/sight LED goes green as a kill confirm. `$PLAY,,4,6,V3A,,,,*` says the "kill" line on the announcer slot. On a lead change, a score line such as `VB17` plays too. You get one `$SFLASH` per kill, about 0.4 s after the trigger burst.

`$SFLASH` is bare, with no arguments. It works on an idle unspawned gun and needs no companion frame.

In a phoneless game started from the gun menu, the gun says "double kill" and other streak lines on its own, with no phone involved. How a gun learns enough about the other players to call a streak has not been established. Once a Bluetooth host is driving the gun, those native multikill lines go silent and the host has to play them.

> **The one hit function that changes something without touching a pool.** Function 23 in the `$SIR` table leaves health, armor, ammo and the trigger alone: the victim keeps firing normally. What it does move is `$ALCD` token 2, which reads 100 in normal play, drops to 0 on a fn 23 hit and climbs back over roughly 6 to 8 s. A `$SPAWN,,*` resets it to 100 at once. **Token 2 is now known: it is the gun's live accuracy** (bench 2026-09-09), so a fn 23 hit forces your accuracy to zero, below whatever floor your weapon carries. The gun was also heard to go silent on a fn 23 hit, and that stands on its own, but the token 2 number was never evidence for it. Treat fn 23 as an accuracy debuff a host can trigger and read.

### Why does the gun play music when I die?

Your player profile carries a "music mix on death" slot next to the death scream. It is part of the voice pack, not a separate feature (see Voice packs and announcers).

### Are grenade sounds on the grenade?

Mostly no. Your gun sees the grenade's IR signal and plays those sounds from its own bank: the blast, the flashbang and gas effects, the CTF music, the "control point captured" lines. The grenade itself only chirps and flashes for status. It announces its mode through the tagger speaker only while the gun is in setup.

## Voice packs and announcers

A voice pack is the run of sound ids at the tail of `$PSET`, one per game event: death alarm, pain, respawn cry, kill line. The BRX does not ship "a male voice" and "a female voice" as one big pack. The characters you pick in the app are just pre-filled sets of those ids.

The voice pack has **seventeen wire slots**, `$PSET` tokens 7 through 23, in the order below. The alignment is confirmed from Battle Company's field table and the v4.30 firmware image, and the pool-sound positions were checked on hardware.

| Declared field | Event it fires on |
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
| energyShieldLoop | Looping shield hum (e.g. `A10`). Stops only when the shield reaches zero, not on `$PLAYX,0,*` (confirmed 2026-09-25). It holds every queued clip back, so Open BRX ships it empty. |

The "Get some" respawn line was traced to this block on the bench.

> **Design choice: pool sounds, not health sounds.** Open BRX uses the pool slots on purpose. Because the firmware carries a separate sound for a hit that took health, a hit that took armor and a hit that took shield, a hit can tell the player what it went through. Open BRX rings metal for armor and plays an energy note for the shield, drawing from a small pool so the same hit does not sound identical all match. Health is deliberately silent: the character's own pain grunt fires on exactly those hits, so real damage is the moment the metal stops and a human sound starts. The pool slots behave as described on hardware, and every sound was chosen by ear rather than from the catalog.

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

See [the sound bank](/manual/sounds) for all 2,634 known ids: 2,477 files on the gun plus 157 app-listed ids whose files are missing. The searchable table includes AI categories and acoustic analysis, transcripts, confirmed uses, by-ear review notes, availability, and community labels from the LaserTagMods BRX Audio sheet.

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
| Audio encoding | Headerless raw PCM, signed 16-bit little-endian, mono, 44,100 Hz. An `.LTP` file has no WAV header. |
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
- Open BRX game default: set from the venue, see [Modes and setup](/docs/modes). 69 measures at roughly on-gun level 2, and it was inaudible on a field (2026-08-30)
- Open BRX try-out default: 69 (fired at arm's length)
- Open BRX probing default: 30 (deliberately quiet, and deliberately not for games)

> **30 is not "quiet"; it is silent for weapon audio.** Measured with a microphone harness: at volume 100 the gun's sounds peak at 7-37 times the room noise floor, and at 30 nothing rises above room noise. Volume 45 is barely audible. Use 65 or higher to hear a tagger reliably. No absolute SPL figure exists for any of these values.

**Practical levels**

- **Play:** the Open BRX game default above. An unknown venue gets the indoor level, the quieter one.
- **Try-outs:** 69. A try-out is fired at arm's length from the player's own head, so it stays quiet.
- **Bench / diagnostics:** 30 or lower keeps the neighbors happy and still confirms the command path (the gun echoes its state, you just won't hear it).

> **Safety.** The boot chime plays at the gun's stored level before any host can lower it. A gun last used at 100 is loud at the next power-on. Set the volume down before you switch off if kids or a quiet venue are next. Voice lines and the death beep are uncomfortable held to the ear at 100. The official iOS app ships 69 for a reason.
