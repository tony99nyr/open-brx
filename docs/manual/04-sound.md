# 04 · Sound, voice & updates  (section slug: /manual/sound)
**Last verified:** 2026-09-06
**Audience:** BRX owners who want to know what their tagger says and how to change it; event hosts setting volume for a venue; developers driving audio over Bluetooth. · **Goal of this section:** show how BRX audio works from end to end (who plays what, how loud, and how to change it), publish the first complete searchable map of the 2,477-file sound bank, and walk through the USB sound-pack and firmware update path, with Battle Company's updater as the factory restore.
**Provenance legend:** ✅ verified on our bench · 📖 official Battle Company docs · 🔍 decoded from the Callsign APK · 👥 community-reported. Only confirmed facts are published. See Research backlog at the end.

**Credits used throughout this section:** Battle Company (BRX Manual V7, BRX Extended User Guide 2018; link to them, don't rehost) · **David Knox** (the "DK BRX Audio File Names" meaning map, shared with the owner community) · the BRX owner community (sound-filename lists, swap reports) · LaserTagMods / JEDGE (protocol discovery). Sound clips are Battle Company's copyright. The site ships **ids, durations and meanings only**, never audio files.

---

## Pages

### Page: How BRX audio works  (`/manual/sound/how-it-works`)
_One speaker, two triggers: what the gun plays by itself, and what a host tells it to play_

[hero] **Every sound is an id.** Your BRX stores 2,477 sound files (the official app's own list names 2,166 of them). The gun plays most of them by itself, the instant something happens. A host (the Callsign app, or Open BRX Mission Control) plays the rest with a single command. Knowing which is which tells you what you can change. ✅ `src: protocol/brx-protocol.md §5, protocol/session-findings-2026-08.md §7o, docs/experiment-log.md #33-40`

[callout:info] Two questions decide how any sound behaves. First, **who starts it**: the gun on its own, or a host over Bluetooth. Second, **how much you can change it**: fixed, swappable by file, or fully yours. The rest of this page is those two cuts. ✅ `src: protocol/brx-protocol.md §5, protocol/session-findings-2026-08.md §7o, docs/experiment-log.md #33-40`

[cards] **Cut 1: who starts the sound**
- **Automatic, gun-played (mapped once at game start).** These are hit tones, respawn chimes, armor and shield pickups, pain and death lines, plus the weapon's own fire, reload and empty sounds. Your loadout points each event at a sound id (`$SIR` for incoming IR types, `$PSET` for your voice pack, `$WEAP` for the weapon). The firmware then plays it with no host involved. ✅ `src: protocol/brx-protocol.md §5, docs/experiment-log.md #33`
- **Host-triggered announcements.** These depend on game state that only a host knows: "flag taken", "point captured", "3 minutes left", game over, custom announcers. The host sends `$PLAY,<id>,…` at the moment its rules say so. ✅ `src: protocol/session-findings-2026-08.md §7o, docs/experiment-log.md 2026-08-25`
- **Native reflexes.** The boot chime, "connection established" on phone attach, the disabled "can't do that" chirp, and low battery. The firmware fires these on its own schedule. You can swap the clip, but you cannot stop it. ✅ `src: protocol/brx-protocol.md §5, protocol/session-findings-2026-08.md §7o, docs/experiment-log.md #33-40`

[table] **Cut 2: how much you can change each sound**
| Tier | Examples | What you control |
|---|---|---|
| Forced (native, unstoppable) | Power-on boot sound. It plays before any host connects, which is why a tagger is loud at startup | Nothing: can't suppress or trigger |
| Native reflex, re-skinnable | "Phone connected" on BLE attach · disabled chirp · reload / empty · low battery | You can't stop it firing, but you can replace the clip in the USB `AUDIO` folder (see Custom sounds) |
| Config-driven, then automatic | Hit / pain / death / armor / shield / weapon sounds | Any bank id via the loadout (`$SIR` / `$PSET` / `$WEAP`), or replace the file |
| Host-triggered, fully yours | Objective callouts, timers, custom announcers | Any of the 2,477 ids on the gun, on any rule, via `$PLAY` |
Only one sound is truly stuck: the boot chime. ✅ `src: protocol/brx-protocol.md §5, protocol/session-findings-2026-08.md §7o, docs/experiment-log.md #33-40`

[diagram SND-01] The two-slot `$PLAY` command: an effect slot and an announcer slot that can fire together. ✅ `src: `protocol/session-findings-2026-08.md` §7o

[spec-sheet] **The `$PLAY` command (developer detail)**
- Shape: `$PLAY,<soundID>,<volume>,<priority>,<announcerID>,,,,*`. Token 1 is the local effect sound, and **token 4 is a second, independent announcer/voice slot**. `$PLAY,,4,6,V3A,,,,*` leaves the effect slot empty and says "kill". Both slots can carry an id at once: the app's game-end frame is `$PLAY,VSF,4,6,JAY,,,,*` (victory sting plus "victory"). ✅ `src: `protocol/session-findings-2026-08.md` §7o, docs/experiment-log.md 2026-08-25
- The volume and priority tokens are **required**. `$PLAY,VA33,,,,,,,*` was silent on our bench, and `$PLAY,VA33,4,6,,,,,*` spoke "game over". The official apps use `3,9` (Android) and `3,6` / `4,6` (iOS Callsign), which are app conventions, not protocol constants. ✅ `src: `protocol/session-findings-2026-08.md` §7r, docs/experiment-log.md
- `$PLAYX,0,*` stops playback right away. The app sends it just after `$STOP` on connect, and it also silences a spawn voice line if you send it right after `$SPAWN`. ✅ `src: protocol/brx-protocol.md`, docs/experiment-log.md
- Any id not in the bank is invalid. For an unknown id the gun plays a **fallback sound** instead of staying silent. That is why a microphone sweep can't list the bank: a nonsense id produced audio at 150× the noise floor. ✅ `src: docs/experiment-log.md` #7, #20

[accordion] **Where kill feedback comes from (and what the green sight flash is)**
- Score a kill in a game the app hosts, and your gun gets three things from the host over Bluetooth. `$SFLASH,*` is the **green sight flash**: the scope/sight LED goes green as a kill-confirm. `$PLAY,,4,6,V3A,,,,*` says the "kill" line on the announcer slot. On a lead change, a score line such as `VB17` plays too. You get one `$SFLASH` per kill, about 0.4 s after the trigger burst. ✅ `src: `protocol/session-findings-2026-08.md` §7o, docs/experiment-log.md 2026-08-25
- `$SFLASH` is bare, with no arguments. It works on an idle unspawned gun and needs no companion frame. We validated it from our own stack, and the sight went green. ✅ `src: docs/experiment-log.md` 2026-08-26
- In a **phoneless game started from the gun menu**, the gun says "double kill" and other streak lines on its own. The gun computes that audio over its radio mesh, with no phone involved. Once a Bluetooth host is driving the gun, those native multikill lines go silent and the host has to play them. ✅ `src: protocol/session-findings-2026-08.md §7o, docs/experiment-log.md 2026-08-24/25`

[callout:tip] **A native "silence" weapon exists.** One of the IR hit functions (function 23 in the `$SIR` table) does not touch health, ammo or the trigger. It **mutes the victim's gun audio**, which comes back over roughly 6–8 s. No fire sound, no reload chain, no overheat cue. It is stock firmware behaviour, so any host can use it today. ✅ `src: docs/experiment-log.md` 2026-08-27 (fn 23)

[faq]
- **Why does the gun play music when I die?** Your player profile carries a "music mix on death" slot next to the death scream. It is part of the voice pack, not a separate feature (see Voice packs). 🔍 `src: protocol/callsign-extract/protocol-classes.md`
- **Grenade sounds: are they on the grenade?** Mostly no. Your gun sees the grenade's IR signal and plays those sounds from its own bank: the blast, the flashbang and gas effects, the CTF music, the "control point captured" lines. The grenade itself only chirps and flashes for status. It announces its mode through the tagger speaker only while the gun is in setup. ✅👥 `src: docs/reference/grenade.md`

---

### Page: Voice packs & announcers  (`/manual/sound/voice-packs`)
_Male, Female, Heavy, Medic, Valkyrie. Every character is a set of sound-bank slots_

[hero] **A voice pack is seventeen slots.** The BRX does not ship "a male voice" and "a female voice" as one big pack. A player profile lists one sound id per game event: death alarm, pain, respawn cry, kill line. The characters you pick in the app are just pre-filled sets of those ids. 🔍 `src: protocol/callsign-extract/protocol-classes.md`

[table] **The positional voice pack inside the player settings (`$PSET`)**: 🔍 decoded from the app; the trailing tokens of a captured `$PSET` (`…,H44,JAD,V33,…,A10`) fill these slots in order.
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
🔍 `src: protocol/callsign-extract/protocol-classes.md` "PSET"; ✅ the "Get some" respawn line was traced to this block on the bench, `src: docs/experiment-log.md` 2026-08-23

[callout:info] The **named voice profiles** you choose in Callsign are not stored in the app. The app fetches them from Battle Company's server (`…/callsign/voice-profiles/selected/`) and writes the resulting slot ids into `$PSET`. Open BRX offers the same idea as a `voice` field on each player. 🔍 `src: protocol/callsign-extract/apk-harvest.md`, mcp/brx_mcp/mc/API.md

[table] **Voice families in the bank** (prefix → character; credit David Knox's audio map, restated) 👥
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
Counts computed from the bank file; character names from DK's map. 🔍👥 `src: mcp/brx_mcp/data/sound_ids.json`, protocol/callsign-extract/sound-bank.md

[cards] **What one character pack contains** (the pattern repeats across every `V<n>`/`V<letter>` family) 👥
- **A "move" line**: Heavy `V3I` "Get some", Male `VAQ` "Let's move out", Scout `VBI` "Let's move", Valkyrie `VHT` "Weapons hot", Clean male `VEI` "Locked and loaded".
- **About four gasps** (Heavy `V3E`/`V3F`/`V3G`/`V3H`) and **three death screams** (Heavy `V33`/`V34`/`V35`; Male `VA3`/`VA4`/`VA5`; Medic `V85`/`V83`/`V84`).
- **A kill line**: Heavy `V3A`, Male `VAA`, Scout `VBA`, Medic `V8S`, Valkyrie `VHR`, Clean male `VEA`. `V3A` is the exact clip the official app plays on every scored kill. ✅
- **A flavour line**: Medic `V8W` "One shot, one kill".
`src: protocol/callsign-extract/sound-bank.md` (DK map), protocol/session-findings-2026-08.md §7o

[table] **Weapon callouts (announcer says the weapon name)** 👥
| Weapon | Callout id | Fire sound id |
|---|---|---|
| M4 | `VA4B` | `R02` |
| TAC-87 shotgun | `VA6A` | `T14` |
| SR-100 sniper | `VA5Y` | `S16` |
| MG7 | `VA4F` | `J07` |
| SMG-x3 | `VA5R` | `G10` |
| TAR-33 (silenced AR) | `VA6B` | not documented |
`src: protocol/callsign-extract/sound-bank.md` (DK map), docs/reference/brx-extended-user-guide.md

[callout:warn] **Killstreak audio is not free under a phone or host.** "Double kill" and its friends are announced natively only in a game started from the gun's own menu. As soon as a host drives the gun over Bluetooth, the host must play them itself (`$PLAY` on the announcer slot). Open BRX's Mission Control does this. A bare Bluetooth script gets silence. ✅ `src: protocol/session-findings-2026-08.md §7o, docs/experiment-log.md 2026-08-24/25`

[image SND-02] Voice-pack "slot rack" illustration: seventeen labelled sockets, some filled. GENERATE. `src: this page`

---

### Page: The sound bank  (`/manual/sound/sound-bank`)
_All 2,477 sounds on the gun, by family, with durations, categories and the words each voice line says_

[hero] **2,477 sounds on the gun. One list.** We read every file off a v4.32 tagger's `AUDIO` folder on 2026-09-03 and transcribed the voice lines. The official app's own configuration file, `Sounds.json`, names 2,166 ids: 157 of those are not on the gun (they play the fallback sound), and 468 files on the gun are unknown to the app. The catalog is the authoritative set of `$PLAY` arguments, and of the file names you would replace over USB. ✅🔍 `src: docs/reference/sound-catalog.md`, protocol/callsign-extract/sound-bank.md, docs/experiment-log/2026-09.md (2026-09-03)

[stat-row]
- **2,477** sound files on the gun (2,166 in the app's list; 157 app ids missing from the gun; 468 gun files the app does not know)
- **~4,700 s** (78 min) of audio across the app's 2,166-id list
- **136** `E_`-prefixed alternate takes of existing ids in the app's list
- **Longest:** `J100` at 250 s (a music bed) · **Shortest:** `N1A` at 0.04 s
✅🔍 `src: docs/reference/sound-catalog.md`, mcp/brx_mcp/data/sound_ids.json (computed)

[callout:info] **How to read an id.** The first letters are a family prefix (what kind of sound), and the rest is an index. `R02` is the second entry in the R (rifle-shot) family, and `V3A` is line A of the Heavy (V3) voice. An `E_` prefix marks an alternate take of the base id, so `E_VB17` is a variant of `VB17`. The `E_` set covers the VB, VA, J, K, N, X and VS families. Ids are the app's own names, and the protocol has no friendlier label. 🔍 `src: protocol/callsign-extract/sound-bank.md`

[table] **Category map: every family in the app's list** (prefix meanings restated from David Knox's audio map, counts computed from the app's sound list, restated as `mcp/brx_mcp/data/sound_ids.json`; the on-gun catalog adds the `VX` and `VZ` voice families, `H102` to `H155` and more; 👥🔍)
| Family | What it holds | Ids | Typical length |
|---|---|---|---|
| `VA` + `E_VA` | Male voice: announcer, system lines, weapon callouts, countdowns | 321 + 23 | 0.5–3 s (countdowns up to 11 s) |
| `VB` + `E_VB` | Scout / female-clean voice: score & lead lines | 90 + 64 | 1–2 s |
| `V0`–`V9` | Character voice packs (Fury, Grenadier, Guardian, Heavy, Hive Queen, V5 not named, Infiltrator, Marauder, Medic, Raider) | 23 each (255 total) | 0.4–6 s |
| `V100`–`V144` | CTF / Slayer / King-of-the-Hill callouts | 34 | 1–2.4 s; three at 12–13 s |
| `VC`…`VS` (15 families) | Sentinel, Female sniper, Clean male, Creature, Female creature, Valkyrie, Viper, Wraith, Russian clean, Clean female, Mercenary, Clean male (alt), Nexus & Vanguard commanders, Clean commander | 9 base + 9–22 extra lines each (329 total, incl. 5 `E_VS` takes) | 1–6 s |
| `N` + `E_N` | Miscellaneous cues: the "kerchung", swish, revive ping, ultra-short ticks | 108 + 10 | 0.04–6.7 s |
| `NA` | Death beep (`NA0`) | 1 | 4 s |
| `M` | Mortal-Kombat-style SFX | 95 | 0.1–3.4 s (`M57` 25 s) |
| `U` | Beeps and boops (UI / system tones; `U16` is connect-related) | 91 | 0.05–1.9 s |
| `A` | Sci-fi SFX (incl. the shield loop `A10`; `A100`–`A103` run 7–24 s) | 80 | 0.2–24 s |
| `W` | Reloads | 74 | 0.3–8.7 s |
| `D` | Cocking / mechanical | 69 | 0.1–3.9 s |
| `H` | Hit SFX + special-weapon impacts (rail gun `H02`, energy blade `H50`, war hammer `H49`) | 59 | 0.4–6.4 s |
| `X` + `E_X` | Grenades and explosions (`X13` rocket) | 51 + 10 | 0.1–8 s |
| `R` | Rifle shots (`R02` M4) | 47 | 0.5–5 s |
| `SW` | Star-Wars-flavoured SFX (`SW02` 28 s) | 34 | 0.3–28 s |
| `E` | Cool sci-fi SFX | 32 | 0.7–4.5 s |
| `JA` + `J` + `E_J` | Music & stings: `JA9` startup, `JAD` death music, `JAY` victory; `J01` 63 s and `J100` 250 s beds; `J07` MG7 fire | 32 + 23 + 12 | 1 s – 250 s |
| `B` | Bow / arrow | 31 | 0.2–2 s |
| `G` | SMG / gun shots (`G10` SMG-x3) | 23 | 0.5–2 s |
| `C` | Cool SFX | 21 | 1–4 s |
| `S` | Sniper / gun shots (`S16` SR-100) | 19 | 1–4 s |
| `P` | Pistol / gun shots | 18 | 0.7–2 s |
| `T` | Shotgun / gun shots (`T14` TAC-87) | 16 | 0.8–1.8 s |
| `F` | Fire / funny | 15 | 0.2–3.6 s |
| `Z` | Creature splat | 15 | 0.4–10 s |
| `K` + `E_K` | Fly-bys and air strikes | 12 + 12 | 2–30 s |
| `CC` | Contra-style SFX | 10 | 0.4–5.8 s |
| `Y` | Odd sci-fi | 10 | 0.2–3.7 s |
| `L` | Electrical | 7 | 0.4–4.5 s |
| `Q` | Silencers | 7 | 0.2–0.9 s |
| `O` | Big guns / ordnance | 6 | 1.5–2.5 s |
Sums to 2,166, the app's list; the gun holds 2,477 files. `src: mcp/brx_mcp/data/sound_ids.json` (computed), protocol/callsign-extract/sound-bank.md (DK prefix legend), docs/reference/sound-catalog.md

[table] **Thirty-odd ids worth knowing** (the confirmed core; ✅ = heard on our bench or in a capture, 👥 = DK map)
| Id | Family | Meaning | Length | Conf. |
|---|---|---|---|---|
| `VA20` | VA | "Connection established": plays on every phone connect | 1.27 s | ✅ |
| `U16` | U | Connect tone (paired with VA20) | 0.43 s | ✅ |
| `VA81` | VA | 3-2-1 spawn countdown (arena) | 2.97 s | ✅ |
| `VA33` | VA | "Game over" + music | 2.26 s | ✅ |
| `VA85` | VA | Countdown to game over, no music | 9.66 s | 👥 |
| `VSB` | VS | Countdown to game over + music | 10.39 s | 👥 |
| `VS6` | VS | Game-end line (solo game close) | 2.26 s | ✅ |
| `VSF` + `JAY` | VS / JA | Victory sting + "Victory": the winner's end-of-game pair | 1.86 s + 5.69 s | ✅ |
| `VA46` | VA | Lives depleted / multi-kill | 1.47 s | 👥 |
| `V3A` | V3 | "Kill": the app's per-kill announcer line | 0.79 s | ✅ |
| `VB17` | VB | Score / lead-change line | 1.77 s | ✅ |
| `N41` | N | Revive-countdown ping | 0.73 s | 👥 |
| `NA0` | NA | Death beep (also the file swapped to change the death cue) | 4.00 s | 👥 |
| `N03` | N | "Kerchung" | 0.82 s | 👥 |
| `N04` | N | Swish | 1.43 s | 👥 |
| `JA9` | JA | Startup music | 5.74 s | 👥 |
| `JAD` | JA | Death music (the musicMixOnDeath slot) | 3.50 s | 👥 |
| `H29` | H | Respawn / add-HP: a quiet, sustained "stim-pack" medical sound | 1.20 s | ✅ |
| `VA16` | VA | "Armor suit": add armor | 0.94 s | ✅ |
| `VA8C` | VA | "Shields online": add shields (SFX over the first word) | 1.50 s | ✅ |
| `VA2` | VA | Tear gas effect | 5.98 s | ✅ |
| `H02` | H | Rail gun impact | 0.39 s | ✅ |
| `X13` | X | Rocket launcher / explosion | 1.55 s | ✅ |
| `H50` | H | Energy blade | 0.99 s | ✅ |
| `H57` | H | Rifle bash | 0.76 s | ✅ |
| `H49` | H | War hammer | 1.21 s | ✅ |
| `R02` | R | M4 fire | 2.20 s | 👥 |
| `T14` | T | TAC-87 shotgun fire | 0.89 s | 👥 |
| `S16` | S | SR-100 sniper fire | 1.61 s | 👥 |
| `J07` | J | MG7 fire | 1.60 s | 👥 |
| `G10` | G | SMG-x3 fire | 1.32 s | 👥 |
| `V3I` | V3 | "Get some": Heavy respawn line | 1.53 s | ✅ |
| `VA3` / `VA5` | VA | Male scream / yell (death-cue swap candidates) | 1.27 / 1.29 s | 👥 |
`src: protocol/callsign-extract/sound-bank.md` "Confirmed meanings" + DK map, protocol/session-findings-2026-08.md §7o, §7r, docs/experiment-log.md 2026-08-26, mcp/brx_mcp/sounds.py

[data-table:filterable] **Sound Bank Explorer**: the full table of what is on the gun (2,477 rows, plus the 157 app-only ids flagged as not on the gun), built from `mcp/brx_mcp/data/sound_catalog.json` at publish time (see Interactive ideas for the full spec). Columns: id · family · meaning (blank when unknown) · meaning status (known / unknown) · duration · on gun / app only · provenance (✅ / 👥) · copy button. Every id, filename and duration is published. A meaning is shown only when it is known. ✅🔍 `src: mcp/brx_mcp/data/sound_catalog.json` (data), docs/reference/sound-catalog.md, protocol/callsign-extract/sound-bank.md (DK meanings)

[diagram SND-03] Treemap of the bank by family, area = number of ids, one accent for voice families. GENERATE from the counts above. `src: mcp/brx_mcp/data/sound_ids.json`

---

### Page: Custom sounds over USB  (`/manual/sound/custom-sounds`)
_Yes, you can put your own audio on a BRX. No firmware hacking, and fully reversible_

[hero] **The AUDIO folder.** Hold SELECT while you power on with a USB cable attached, and the tagger becomes a disk drive. You get a firmware file at the root and an `AUDIO` folder of per-sound files: replace a file, replace a sound. This is Battle Company's own update path, confirmed in their Extended User Guide, and the community has used it for Star Wars packs for years. 📖👥 `src: docs/reference/brx-extended-user-guide.md`, docs/reference/community-notes.md

[callout:warn] **Back up the whole `AUDIO` folder before you change anything.** The originals belong to Battle Company, and the factory restore is their USB updater package (see Firmware updates). Copying files is slow, so budget up to an hour per 250 MB. Don't unplug early. 📖👥 `src: docs/reference/brx-extended-user-guide.md`, docs/reference/community-notes.md

[steps] **Swap a sound**
1. Power the tagger **off**, then connect the micro-USB **Programming Port** (not the charging port) to a computer. 📖
2. **Hold SELECT and switch the gun on.** It makes no startup sound, and that silence is how you know you are in disk mode. A normal power-on never exposes the drive. 📖👥
3. Open the removable disk that appears (Windows or macOS), with a `.BIN` at the root and an **`AUDIO`** folder. On older non-logo guns, tap SELECT a few times after entering if nothing shows. 📖
4. Copy the entire `AUDIO` folder to your computer as a backup. 👥
5. Name your replacement file **`<ID>.LTP`**, using the sound id from the bank (e.g. `R02.LTP` replaces the M4 fire sound, `NA0.LTP` the death beep). 👥
6. Drag it into `AUDIO`, choose **overwrite = yes**, and wait for the copy to finish. 📖
7. Eject the disk, power-cycle, and test with the on-gun menu (or `$PLAY,<id>,4,6,,,,,*` over Bluetooth). ✅
`src: docs/reference/brx-extended-user-guide.md`, docs/reference/community-notes.md, protocol/callsign-extract/sound-bank.md

[spec-sheet] **File facts**
- **Naming:** `<ID>.LTP`, one file per bank id. Known community swaps: `NA0.ltp` death loud-beep, `VA3.ltp` scream, `VA5.ltp` yell (copy or rename one over another to change the death cue). 👥 `src: docs/reference/community-notes.md`
- **Which files are which weapon:** the Callsign-app gun sounds use **different file names from the default (on-gun menu) weapon files**. Replacing one set won't change the other. Default guns to target for the menu game: SR-100, TAC-87, SMG-x3, MG7. 👥 `src: docs/reference/community-notes.md`
- **Firmware v4.30+ needs a complete new audio-file set** in `AUDIO`. After that update, old packs don't line up. 👥 `src: docs/reference/community-notes.md`

[cards] **What people build with this**
- **Full overlay packs**: a complete Star Wars sound set exists in the owner community (credit David Knox). It replaces weapon, hit and voice files wholesale. 👥
- **Re-skinning the "reflex" sounds**: the "phone connected" line, the disabled chirp, low-battery. You can't stop them, but you can make them yours (Open BRX plans an "Open BRX connected" line this way). ✅
- **Grenade audio**: the explosion, flashbang, gas and CTF music you hear from a grenade are gun-bank files (`X`/`H`/`JA` families). Swap those and every grenade "sounds different", with zero grenade modification. ✅👥
`src: docs/reference/community-notes.md`, docs/reference/brx-extended-user-guide.md, docs/FOLLOWUPS.md B11, docs/reference/grenade.md

[callout:info] **Policy note.** Swapping files in `AUDIO` changes stored *content*, not firmware. It is the same mechanism Battle Company's updater uses, and it is reversible. Open BRX's own hard rule is "never modify stock firmware", and sound swaps sit comfortably inside it. ✅ `src: CLAUDE.md`, docs/reference/community-notes.md

[image SND-04] REAL PHOTO: the tagger in USB disk mode next to a laptop showing the root `.BIN` and the `AUDIO` folder listing. `src: docs/reference/brx-extended-user-guide.md`

---

### Page: Firmware updates & factory restore  (`/manual/sound/firmware`)
_The same USB disk carries the firmware. Here is the official procedure, and the traps_

[hero] **One port, one `.BIN`.** Firmware for the tagger, headset, hatchet, shield and sidearm all update the same way: enter USB disk mode, then replace the file at the root. Battle Company's updater package is also your factory restore, for both firmware and sounds. 📖 `src: docs/reference/brx-extended-user-guide.md`

[steps] **Update tagger firmware (Battle Company's procedure, restated)**
1. Download the current firmware package from Battle Company. (Link to their official download; the site never rehosts it.) 📖
2. Switch the gun **off**, plug the USB cable into the Programming Port, then **hold SELECT and switch on**. There is no startup sound, and a disk appears. 📖
3. **Delete** the existing `.BIN` at the root of the disk. 📖
4. Copy the new `.BIN` to the root. Don't touch `AUDIO` unless the release notes say the audio set changed. 📖
5. Eject and power-cycle. Non-logo (older) guns wait about 10 s and then announce "upgrade complete". 📖
`src: docs/reference/brx-extended-user-guide.md`

[steps] **Update a headset or accessory (hatchet, shield, sidearm)**
1. Hold the device's **PROGRAM button** (a pinhole) while you power it on. 📖
2. Replace the root firmware file exactly as above, once it shows up as a USB disk. 📖
`src: docs/reference/brx-extended-user-guide.md`

[callout:warn] **Firmware v4.30 was a "makeover" release.** The community reports that it **wipes on-gun config**, breaks headset pairing and Callsign until you re-run setup, and **requires a completely new audio-file set** in `AUDIO`. Gen-1 guns need an extra step after flashing (reboot, then press SELECT three times). Read the release notes and back up `AUDIO` first. 👥 `src: docs/reference/community-notes.md`

[accordion] **Known issues and Battle Company-verified fixes**
- **Headset won't pair after an update.** The BC-verified recovery: downgrade to `BCgunV2_02e.bin`, run `SETUP` from the USB serial console, re-pair the headset, then re-upgrade to `BCgunV2_08b.bin`. 👥 `src: docs/reference/community-notes.md`
- **Re-pair a headset** without the downgrade: boot the gun holding **RIGHT** ("install accessory"), power the headset, then press its button once. 📖👥 `src: docs/reference/brx-extended-user-guide.md (accessory pairing), docs/reference/community-notes.md`
- **Admin lock blocks hosting.** Locked taggers (LEFT+RIGHT 3 s, or LEFT+RIGHT+SELECT 3 s) can't host. v4.30 adds hold-SELECT to unlock. 👥 `src: docs/reference/community-notes.md`
- **Version you're on:** the serial console's `QUERY` reports it. The guns on our bench run **v4.32**. ✅ `src: docs/HANDOFF.md`

[spec-sheet] **Factory restore**
- Battle Company's USB updater package = the reference firmware `.BIN` plus the matching `AUDIO` set. Restore both from that package and a tagger returns to stock, whatever packs were installed. 📖👥
- Keep your own backup of `AUDIO` from before any change. It is faster than a full restore, and it preserves the exact set your firmware version expects. 👥
`src: docs/reference/brx-extended-user-guide.md`, docs/reference/community-notes.md

[callout:info] Open BRX never modifies stock firmware. All of its control runs over the Bluetooth serial protocol. So a tagger running Open BRX is always on Battle Company's firmware, and always restorable with Battle Company's updater. ✅ `src: CLAUDE.md`, docs/adr/0001-companion-rider-architecture.md

[image SND-05] REAL PHOTO: close-up of the tagger's two ports (charging and Programming/micro-USB) with a cable in the Programming Port. `src: docs/reference/brx-manual-notes.md`

---

### Page: Volume  (`/manual/sound/volume`)
_On-gun 1–5, protocol 0–100, and why "30" is silence_

[hero] **30 is silence.** The gun menu offers volume 1–5. Over Bluetooth the same control is a 0–100 scale. On that scale, the gap between "quiet" and "you hear nothing" is smaller than you would think. ✅📖 `src: docs/reference/brx-manual-notes.md`, protocol/brx-protocol.md

[table] **The scales, side by side**
| Control | Range | Notes |
|---|---|---|
| On-gun menu (SELECT → settings) | 1–5 | Remembered per game mode as the new default 📖 |
| Bluetooth `$VOL,<0–100>,0,*` | 0–100 (`MaxMusicVolume` = 100) | Sent by every app on connect and again at game end ✅🔍 |
`src: docs/reference/brx-manual-notes.md`, protocol/brx-protocol.md, docs/experiment-log.md

[stat-row] **What the official apps send**: Android Callsign: `$VOL,100` · iOS Callsign: `$VOL,69` · Open BRX game default: **80 indoors / 90 outdoors** (`compile.play_volume()` sets it from the venue; 69 measured as roughly on-gun level 2 and was inaudible on a field, 2026-08-30) · Open BRX try-out default: **69** (fired at arm's length) · Open BRX probing default: **30** (deliberately quiet, and deliberately not for games). ✅ `src: protocol/brx-protocol.md`, CLAUDE.md

[callout:warn] **30 is not "quiet", it is silent for weapon audio.** We measured it with a microphone harness. At volume 100 the gun's sounds peak at 7–37× the room noise floor, and at 30 nothing rises above room noise. Volume 45 is barely audible. Use **≥ 65** to hear a tagger reliably. Open BRX plays at **80 indoors / 90 outdoors**, because 69 was measurably too quiet across a field (2026-08-30). No absolute SPL figure exists for any of these values. ✅ `src: docs/experiment-log.md` #6, protocol/brx-protocol.md

[cards] **Practical levels**
- **Play:** 69, the value the official iOS app sets on connect. The Android app sends 100. ✅
- **Bench / diagnostics:** 30 or lower keeps the neighbours happy and still confirms the command path (the gun echoes its state, you just won't hear it). ✅
`src: protocol/brx-protocol.md`, docs/experiment-log.md #6, CLAUDE.md

[callout:info] **Safety.** The boot chime plays at the gun's stored level before any host can lower it. A gun last used at 100 is loud at the next power-on. Set the volume down before you switch off if kids or a quiet venue are next. Voice lines and the death beep are uncomfortable held to the ear at 100. The official iOS app ships 69 for a reason. ✅ `src: docs/experiment-log.md 2026-08-30 (volume), docs/reference/brx-manual-notes.md`

[diagram SND-06] Horizontal loudness scale 0–100 with the two app defaults (69, 100) marked and a shaded "inaudible for weapon audio" zone below ~45. GENERATE. `src: protocol/brx-protocol.md`, docs/experiment-log.md #6

---

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|
| SND-01 | How it works · after the tiers table | A single command splitting into two parallel channels: a short percussive "effect" waveform and a longer "voice" waveform, both feeding one speaker cone | GENERATE | protocol/session-findings-2026-08.md §7o | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: an abstract signal diagram. One thin line entering from the left splits into two parallel horizontal lanes; the upper lane carries a short, sharp electric-blue waveform burst, the lower lane a longer, softer amber waveform resembling speech; both lanes converge on the right into a minimalist speaker cone drawn in fine grey outline, emitting faint concentric arcs. Generous negative space, thin 1px lines, subtle glow on the blue burst only. |
| SND-02 | Voice packs · after the character-pack cards | A "slot rack": a horizontal row of seventeen identical sockets, about ten filled with small glowing chips, the rest empty | GENERATE | protocol/callsign-extract/protocol-classes.md | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: an isometric rack of seventeen identical rectangular sockets in a single row, machined dark graphite; roughly ten sockets hold small flat chips lit with a soft electric-blue edge glow, one chip lit amber, the remaining sockets empty and shadowed. Shallow depth of field, restrained studio lighting from upper left, no characters, no faces. |
| SND-03 | Sound bank · after the sample table | A treemap of the bank: nested rectangles proportional to the family counts in the category table (VA largest, then N, M, U, VB, A, W, D, H, X, R, SW …), voice families in blue, SFX families in greys, one amber block | GENERATE | mcp/brx_mcp/data/sound_ids.json | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a clean treemap infographic made of about thirty nested rectangles of varying sizes separated by thin 2px dark gutters; one large rectangle occupies roughly a sixth of the area, a dozen medium blocks, many tiny slivers along one edge. About a third of the blocks are tinted in graded electric-blue, the rest in graded cool greys, and exactly one small block is amber. Flat, precise, no text inside blocks, no legend. |
| SND-04 | Custom sounds · end of page | The real tagger in USB disk mode beside a laptop whose screen shows a file browser with a root `.BIN` and an `AUDIO` folder | REAL PHOTO | docs/reference/brx-extended-user-guide.md | (owner shoots it; frame the micro-USB cable in the Programming Port and the drive listing; blur any sticker labels) |
| SND-05 | Firmware · end of page | Close-up of the tagger's charging port and Programming (micro-USB) port with a cable seated in the Programming Port | REAL PHOTO | docs/reference/brx-manual-notes.md | (owner shoots it; macro, dark background, blur any sticker labels) |
| SND-06 | Volume · end of page | A loudness scale 0–100 with two highlighted markers (69 and 100) and a shaded inaudible zone at the low end | GENERATE | protocol/brx-protocol.md, docs/experiment-log.md #6 | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a wide horizontal gauge bar spanning the frame, thin graphite track; the left 45 percent is hatched in dim grey to read as a dead zone; two slim vertical markers glow: one electric-blue at about 69 percent of the track, one amber at the far right end. Minimal, precise, lots of negative space, no numerals. |
| SND-07 | How it works · hero | Abstract hero: a tagger silhouette in profile with sound arcs leaving the speaker, half the arcs originating from inside the gun and half arriving from a small phone-shaped glyph off-frame | GENERATE | docs/manual/04-sound.md (How it works) | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a generic futuristic rifle-shaped device in dark matte grey, seen in profile from the left, rendered as a fine outline with restrained rim light; from a small speaker grille on its body a fan of thin concentric arcs radiates outward in electric blue; a second, thinner set of amber arcs travels toward the device from a small rounded rectangle glyph at the far right edge. No people, no readable markings, no real-world brand geometry. |

---

## Interactive ideas (≤5)

### 1. Sound Bank Explorer (the centrepiece, `/manual/sound/sound-bank`, full-width)
**Data source (build-time):** `mcp/brx_mcp/data/sound_catalog.json` → key `sounds` (a list of 2,634 entries: `id`, `family`, `duration_s`, `on_gun`, `in_app`, `kind`, `category`, `description`; `count_on_gun` = 2477, `count_app_only` = 157). Rows with `on_gun: false` are shown flagged, never hidden, so an operator learns that an app id plays the fallback. The app's `Sounds.json` (`SoundsLengthMap`, 2,166 ids; `MaxMusicVolume` = 100) is no longer the source. **Meanings overlay (build-time merge):** `protocol/callsign-extract/sound-bank.md` (the "Confirmed meanings" table + the DK prefix legend + the voice-pack examples) and `mcp/brx_mcp/sounds.py` (`CATALOG`: semantic name, id, meaning, `confirmed|provisional`). **Only `confirmed` catalog entries and DK-map meanings are merged; `provisional` entries are dropped at build and their ids ship with a blank meaning.** Emit a single static JSON for the page; do not fetch at runtime.

**Derived columns (compute at build):**
| Column | Rule |
|---|---|
| `id` | key as-is (e.g. `E_VB17`) |
| `base_id` | `id` with a leading `E_` stripped |
| `is_alt_take` | `id` starts with `E_` |
| `family` | leading letters after `E_` strip; for `V` followed by one char use `V<char>` (`V3`, `VA`, `VB` …); `V1xx` (V100–V144) → family `V1xx`; `NA0` → `NA`; `JA…` → `JA` |
| `family_label` | from the category map on this page (e.g. `R` → "Rifle shots", `V3` → "Heavy voice") |
| `kind` | `voice` (family starts with `V`), `music` (`J`, `JA`, `E_J`), `sfx` (everything else) |
| `duration_s` | value, rounded to 2 dp |
| `on_gun` | from the catalog; `false` = listed by the app but not on a v4.32 gun (plays the fallback) |
| `meaning` | from the merged overlay; empty if unknown |
| `meaning_known` | `true` when `meaning` is non-empty, else `false`; rendered as a "meaning known / meaning unknown" column |
| `provenance` | `bench` (✅ heard/captured by Open BRX) · `community` (👥 DK map) · empty when `meaning_known` is false |
| `play_cmd` | `$PLAY,<id>,4,6,,,,,*` for sfx/music; `$PLAY,,4,6,<id>,,,,*` for voice (announcer slot) |
| `file_name` | `<id>.LTP` |

**UI:** search box (matches `id`, `meaning`, `family_label`; prefix-aware so typing `V3` lists the Heavy pack first) · filter chips: kind (voice / sfx / music), family (multi-select, grouped Voice | Weapons & hits | Cues & UI | Music & ambience), meaning known / unknown, provenance, "hide alternate takes" (default on), duration range slider (0–250 s, log scale) · sortable columns (id, family, duration, meaning known) · row expand shows `play_cmd`, `file_name`, related ids (same `base_id`, same voice-slot letter across families) · **copy buttons**: copy id, copy `$PLAY` command, copy file name · sticky result count ("312 of 2166") · deep-linkable state in the URL query (`?q=kill&family=V3`) · keyboard: `/` focuses search, `Esc` clears. Empty state suggests the "worth knowing" ids from this page. Mobile: card list instead of table, chips collapse into a sheet. Note licensing: no playback; the copy-command button is the "hear it" path.

### 2. Voice-pack slot builder (`/manual/sound/voice-packs`)
Seventeen labelled slots (the `$PSET` positional list, decoded from the app); each slot is filled by picking an id from the Explorer. Output: the trailing `$PSET` token block, copyable. No auto-fill by character. Which id a given character uses in each slot is not known (see Research backlog), so the builder never pre-fills a slot.

### 3. Volume mapper (`/manual/sound/volume`)
A slider 0–100 that shows an "audible for weapon audio?" indicator (red < 45, amber 45–64, green ≥ 65), the two app defaults as markers, and the `$VOL,<n>,0,*` string with a copy button.

### 4. "What plays this?" lookup (`/manual/sound/how-it-works`)
Type or pick an event (hit, death, respawn, connect, kill, flag captured, low battery, boot) → returns which tier it is (forced / reflex / config / host), who triggers it, the known id(s), and whether it can be swapped, re-mapped, or host-played.

### 5. Update checklist (`/manual/sound/custom-sounds`, `/manual/sound/firmware`)
A stateful (localStorage) checklist for the USB procedure: backup AUDIO ✓, SELECT-hold boot ✓, drive appeared ✓, file copied ✓, eject ✓, test ✓. The v4.30 warning is surfaced when the user ticks "firmware".

---

## Sources used
- `protocol/brx-protocol.md` §5 + `protocol/session-findings-2026-08.md` §7o: the two-cut model, the tier table, native multikill vs host kill feedback (the former `docs/sound-architecture.md` was folded into this section 2026-09-06); `mcp/brx_mcp/sounds.py`: the cue catalog.
- `protocol/callsign-extract/sound-bank.md`: bank header, DK prefix legend and voice-pack structure, confirmed meanings, per-prefix inventory.
- `mcp/brx_mcp/data/sound_catalog.json` / `docs/reference/sound-catalog.md`: every file on a v4.32 gun (2,477) with duration, category and transcript; the Explorer's data source.
- `mcp/brx_mcp/data/sound_ids.json`: the app's 2,166-id → duration map, restated from its own `Sounds.json` (removed 2026-09-07, `protocol/callsign-extract/RAW_ASSETS_NOTE.md`); the family counts and totals on this page are computed from it.
- `protocol/callsign-extract/protocol-classes.md`: `$PSET` positional voice-pack field list; off-tagger audio note.
- `protocol/callsign-extract/apk-harvest.md`: voice profiles come from the Callsign server; `Sounds.json` provenance.
- `protocol/brx-protocol.md`: `$PLAY` (two slots, required tokens), `$PLAYX`, `$VOL` (scales, app values), `$SFLASH`; `protocol/session-findings-2026-08.md` §7o / §7r.
- `docs/reference/brx-extended-user-guide.md`: USB disk mode, firmware and AUDIO procedures, accessory PROGRAM button, on-gun volume 1–5.
- `docs/reference/brx-manual-notes.md`: ports, settings ranges, V7 manual link.
- `docs/reference/community-notes.md`: sound swap details, `.LTP` filenames, v4.30 caveats, pairing fix.
- `docs/reference/grenade.md`: grenade audio plays on the gun.
- `docs/experiment-log.md`: #6 (30 inaudible, mic numbers), #7/#20 (fallback sound, bank recovery), 2026-08-23 ("Get some" from `$PSET`), 2026-08-25 (`$SFLASH` + announcer slot), 2026-08-26 (heard H29/VA16/VA8C; `$SFLASH` from our stack), 2026-08-27 (fn 23 audio suppression).
- `mcp/brx_mcp/sounds.py`: semantic catalog with confidence per cue.
- `docs/FOLLOWUPS.md`: B11 (custom connect voice).
- `docs/HANDOFF.md`, `docs/gotchas.md`, `CLAUDE.md`: firmware version, headset-off gate, volume rule.

## Research backlog (held, NOT published)
Nothing below appears on the site. Each item moves into the pages above only once a source confirms it.

- **Headset green LED behaviour.** Removed from "Where kill feedback comes from": green reported as blink-on-hit / hold-on-kill; the observer flagged his own uncertainty, "green = death" was withdrawn, and whose hit/kill it marks (wearer's or target's) is open. `src: docs/experiment-log.md` 2026-08-27
- **Headset speaker / headset audio.** Removed FAQ item: Battle Company lists "speakers" among v2 headset spares and community write-ups say grenade/objective sounds play on "the gun and headset"; every sound measured on our bench came from the gun. Not characterised. `src: docs/reference/community-notes.md`, docs/reference/grenade.md
- **`VA90` (silenced AR / TAR-33).** DK's map lists `VA90`; no `VA90` exists in the bank (nearest is `VA9`, 1.2 s). Renaming is a guess. `src: protocol/callsign-extract/sound-bank.md`
- **`ST` family (sci-fi mortars / rockets).** DK's map lists the prefix; the bank has zero `ST` ids. Whether it was folded into `S`/`X` is a guess. Row removed from the category map. `src: protocol/callsign-extract/sound-bank.md`
- **What the `E_` alternate takes are.** 136 ids duplicate a base id with identical durations; "echo/localised variant" is unheard speculation. Only the count and the family coverage are published. `src: protocol/callsign-extract/sound-bank.md`
- **"Music bed" labels inferred from duration alone.** The three 12–13 s `V1xx` entries and `A100`–`A103` were called beds only because they are long; durations kept, labels dropped. `src: mcp/brx_mcp/data/sound_ids.json`
- **Objective callouts `V100`–`V144`.** Which id says "flag captured", "hill taken", "flag returned" is unpinned; Open BRX's own catalog marks them provisional. Removed tip block; the Explorer shows these ids with a blank meaning. `src: mcp/brx_mcp/sounds.py`, docs/archive/verification-checklist.md
- **Per-character voice-pack slot assignments.** Which of a character's ids fills which `$PSET` slot is known only for the bench-traced "Get some" (`V3I` → battleRespawnCry); the rest is DK-pattern inference. Slot builder no longer auto-fills. `src: protocol/callsign-extract/sound-bank.md`, docs/experiment-log.md 2026-08-23
- **Sample playback on the site.** Removed `[audio-player]` block: would need Battle Company's consent to rehost clips; not requested. `src: docs/VISION.md`
- **The `.LTP` file format.** Name and folder are known; sample rate / codec are not documented in any source we hold. "Match an existing file's properties" is community practice, not a spec. `src: docs/reference/community-notes.md`
- **Audio storage medium (SD card).** Contradicted: community describes an SD card on the mainboard that is hot-glued and not meant to be removed; other owners report swapping the card to diagnose a silent gun; the Extended User Guide says only "internal memory for audio pack expansion". Whole accordion removed, neither value published. `src: docs/reference/community-notes.md`, docs/FOLLOWUPS.md P14, docs/reference/brx-manual-notes.md
- **Boot "pop" diagnostic.** Community: a pop at boot means the speaker circuit is powered; pop-but-no-sounds "suggests" a loose or corrupt card. Held with the SD-card item because its conclusion depends on it. `src: docs/reference/community-notes.md`
- **Grenade firmware updates.** Contradicted: the Extended User Guide lists the grenade among PROGRAM-button USB-updatable accessories; the grenade on our bench exposes no USB data interface in any state and no PROGRAM pin. Grenade removed from the firmware page's device list and steps title. `src: docs/reference/brx-extended-user-guide.md`, docs/reference/grenade.md, docs/FOLLOWUPS.md G4/G7
- **On-gun menu volume 1–5 → `$VOL` 0–100 mapping.** L1≈60 · L2≈70 · L3≈80 · L4≈90 · L5≈100 is a field estimate, evenly spaced, never measured with a meter. Table row, "Level 3 is 80" headline, the menu-level parentheticals in Practical levels, the volume mapper's level readout, and the level ticks in SND-06 all removed. A `$VOL` sweep against a mic would settle it. `src: protocol/brx-protocol.md`, docs/experiment-log.md
- **"Level 3–4 is what players typically pick."** Uncited observation; removed from Practical levels. `src: protocol/brx-protocol.md`
- **Indoor ~75 / outdoor ~85 `$VOL` defaults.** A field-tested estimate, not a measurement. The only instrumented volume data is 100 vs 30 with a microphone. Removed from Practical levels. `src: protocol/brx-protocol.md` (`$VOL` row), docs/experiment-log.md #6 and #33 (field estimate)
- **"Install accessory" boot = RIGHT vs RIGHT+SELECT.** Owners report RIGHT+SELECT; the Extended User Guide says RIGHT. Published RIGHT only in the firmware page's re-pair item. `src: docs/reference/community-notes.md`, docs/reference/brx-extended-user-guide.md
- **`$ALCD` second token = current audio level.** Fell to 0 under hit function 23 and recovered 5 → 9 → 31 → 100 over ~6–8 s while the operator heard the same; one ear plus one meter, not double-instrumented. Accordion removed. `src: docs/experiment-log.md` 2026-08-27
- **Images:** no image IDs removed. SND-06 revised (menu-level tick marks dropped from the description and the prompt) because they illustrated the held volume mapping.
