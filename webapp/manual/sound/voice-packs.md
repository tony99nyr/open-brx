# Voice packs & announcers
_Male, Female, Heavy, Medic, Valkyrie. Every character is a set of sound-bank slots_
Last verified: 2026-09-06

## A voice pack is seventeen slots.
The BRX does not ship "a male voice" and "a female voice" as one big pack. A player profile lists one sound id per game event: death alarm, pain, respawn cry, kill line. The characters you pick in the app are just pre-filled sets of those ids.
Source: protocol/callsign-extract/protocol-classes.md

## The positional voice pack inside the player settings (`$PSET`)
🔍 decoded from the app; the trailing tokens of a captured `$PSET` (`…,H44,JAD,V33,…,A10`) fill these slots in order.
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
Source: protocol/callsign-extract/protocol-classes.md "PSET"; ✅ the "Get some" respawn line was traced to this block on the bench · docs/experiment-log.md 2026-08-23

🚧 **Open BRX uses the three pool slots on purpose.** Because the firmware carries a separate sound for a hit that took health, a hit that took armor and a hit that took shield, a hit can tell the player *what it went through*: metal for armor, an impact for the body, an energy note for the shield. Open BRX picks all three (and re-draws them between lives, so the same hit does not sound identical all match), and it holds the character's own pain grunt back for hits that reached health. Which wire slot carries which of the three names is source derived and not yet confirmed on hardware.
Source: mcp/brx_mcp/hitaudio.py, docs/spec/contracts.md A17

The **named voice profiles** you choose in Callsign are not stored in the app. The app fetches them from Battle Company's server (`…/callsign/voice-profiles/selected/`) and writes the resulting slot ids into `$PSET`. Open BRX offers the same idea as a `voice` field on each player.
Source: protocol/callsign-extract/apk-harvest.md, mcp/brx_mcp/mc/API.md

## Voice families in the bank
(prefix → character; credit David Knox's audio map, restated) 👥
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
| `V0` Fury · `V1` Grenadier · `V2` Guardian · `V3` Heavy · `V4` Hive Queen · `V5` … · `V6` Infiltrator · `V7` Marauder · `V8` Medic · `V9` Raider | The Supremacy / class characters | 23 each (V4: 33, V5: 26, V8: 35) |
| `V100`–`V144` | Gameplay callouts: CTF, Slayer, King of the Hill | 34 |
Counts computed from the bank file; character names from DK's map.
Source: mcp/brx_mcp/data/sound_ids.json, protocol/callsign-extract/sound-bank.md

## What one character pack contains
(the pattern repeats across every `V<n>`/`V<letter>` family) 👥
- **A "move" line**: Heavy `V3I` "Get some", Male `VAQ` "Let's move out", Scout `VBI` "Let's move", Valkyrie `VHT` "Weapons hot", Clean male `VEI` "Locked and loaded".
- **About four gasps** (Heavy `V3E`/`V3F`/`V3G`/`V3H`) and **three death screams** (Heavy `V33`/`V34`/`V35`; Male `VA3`/`VA4`/`VA5`; Medic `V85`/`V83`/`V84`).
- **A kill line**: Heavy `V3A`, Male `VAA`, Scout `VBA`, Medic `V8S`, Valkyrie `VHR`, Clean male `VEA`. `V3A` is the exact clip the official app plays on every scored kill. ✅
- **A flavour line**: Medic `V8W` "One shot, one kill".
Source: protocol/callsign-extract/sound-bank.md (DK map), protocol/session-findings-2026-08.md §7o

## Weapon callouts (announcer says the weapon name)
👥
| Weapon | Callout id | Fire sound id |
|---|---|---|
| M4 | `VA4B` | `R02` |
| TAC-87 shotgun | `VA6A` | `T14` |
| SR-100 sniper | `VA5Y` | `S16` |
| MG7 | `VA4F` | `J07` |
| SMG-x3 | `VA5R` | `G10` |
| TAR-33 (silenced AR) | `VA6B` | not documented |
Source: protocol/callsign-extract/sound-bank.md (DK map), docs/reference/brx-extended-user-guide.md

## Killstreak audio is not free under a phone or host.
"Double kill" and its friends are announced natively only in a game started from the gun's own menu. As soon as a host drives the gun over Bluetooth, the host must play them itself (`$PLAY` on the announcer slot). Open BRX's Mission Control does this. A bare Bluetooth script gets silence.
Source: protocol/session-findings-2026-08.md §7o, docs/experiment-log.md 2026-08-24/25

_[image SND-02: Voice-pack "slot rack" illustration: seventeen labelled sockets, some filled. GENERATE.]_
