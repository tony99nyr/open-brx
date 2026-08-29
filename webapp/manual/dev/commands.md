# Command reference
_Every command we know of, with args, meaning and confidence: host → tagger, tagger → host, and headset. This page lists every frame you can send the gun. Copy them exactly as written._
Last verified: 2026-08-27

## How to read the tables.
"Direction" is host→gun (`>>`) or gun→host (`<<`). Provenance is per row: ✅ we sent/received it on hardware and know what it did; 🔍 the command class and its field names come from the Callsign app's IL2CPP metadata (names certain, wire position = declaration order); 👥 seen in LaserTagMods sources or community captures, not reproduced by us. Commands the app knows but we have never sent sit in their own table at the end of this page. Where a command's field map has its own page (`$WEAP`, `$GSET`/`$PSET`, `$SIR`) the row links there.
Source: protocol/callsign-extract/protocol-classes.md (confidence note), protocol/brx-protocol.md §3–§4

## Host → tagger: lifecycle & configuration
| Command | Dir | Args | Meaning | Conf |
|---|---|---|---|---|
| `$PING,*` | >> | n/a | Connectivity check. Reply `$PONG,*`. | ✅ |
| `$STOP,*` | >> | n/a | Stop. First frame the official app sends on every (re)connect; also part of the end-of-game tail. | ✅ |
| `$PHONE,*` | >> | n/a | App-controlled mode: opens the live event tap (buttons, `$VOLTS`), locks the on-gun menu. Reply `$BUT,3,0,*`. | ✅ |
| `$CONNECT,*` / `$INIT,*` | >> | n/a | On the known-safe list. Sent on v4.32: **no observable reply**. | ✅ |
| `$CLEAR,*` | >> | n/a | Clear current game state. First frame of every arm sequence; half of the panic sequence. | ✅ |
| `$START,*` | >> | n/a | Begin the configuration sequence. Gun echoes `$LCD,0,0,0,0,0,0,*`. | ✅ |
| `$GSET,…,*` | >> | 8 tokens | Global game settings: friendly fire, indoor/outdoor, region, ambient light, gyro, BT secondaries, crit modifier, mods. **No respawn/time/lives token.** → GSET page | ✅ |
| `$PSET,…,*` | >> | id, 0, HP, armor, shield, 50, , voice-pack… | Player settings: **token 1 = player id (0–63)**, tokens 3–5 = HP/armor/shield pools, then a positional voice pack. → PSET page | ✅ |
| `$WEAP,<slot>,…,*` | >> | slot 0–5 + ~43 tokens | Define a weapon in a slot: damage, fire interval, fire mode, clip/reserve, reload, sounds, IR type. → WEAP page | ✅ |
| `$SIR,<proto>,<subtype>,<sound>,<fn>,p5,p6,p7,p8,*` | >> | 8 tokens | Incoming-IR effects matrix: what an IR word with protocol B / subtype U does to this gun. **Unmatched cells are silently ignored.** → SIR page | ✅ |
| `$BMAP,<button>,<function>,<swap0..3>,*` | >> | button id, function, 4 swap slots | Remap physical controls. Buttons: 0 trigger · 1 alt-fire · 2 reload handle · 3 select · 4 left · 5 right · 8 gyro. Functions seen: 0 fire · 97 reload · 98 (select/left/right) · 100 weapon-cycle · 4 melee (gyro). **Mandatory**: without it the trigger only chirps "disabled". | ✅ |
| `$TID,<team>,*` | >> | team | Team id. **Masked to 2 bits** (`team & 3`) → four native teams 0–3. Drives the gun LED colour at `$SPAWN` (1 = blue, 2 = yellow observed) and is echoed as `$HIR` token 4 on the victim. A live write changes hit resolution immediately but does not repaint LEDs. | ✅ |
| `$SPAWN,,*` | >> | **one empty token** | **Go-live** and **respawn**. Restores HP/armor and (on respawn) ammo; echoes `$LCD,<hp>,<armor>,0,0,<mag>,<reserve>,*`. Also clears the `$SIR` fn-23 state (`$ALCD` token 2 back to 100). `$SPAWN,*` (no empty token) is not the same command. | ✅ |
| `$AMMO,<slot>,<mag>,<reserve>,<flag>,*` | >> | slot, magazine, reserve, 1 | Load magazines. Must follow `$SPAWN` at initial go-live or the gun is live with no ammunition. e.g. `$AMMO,0,36,108,1,*`. A bare `$WEAP` re-push resets ammo to the frame's baked values. Re-send `$AMMO` after any weapon swap. | ✅ |
| `$PLAYX,0,*` | >> | 0 | Stop/clear sound playback. Sent right after `$STOP` on connect and just before the go-live cue. | ✅ |
| `$PLAY,<sound>,<vol>,<prio>,<announcer>,,,,*` | >> | 8 tokens | Play a sound id (see the 2166-id bank). **Two independent slots**: token 1 = local/effect sound, **token 4 = announcer/voice channel**. `$PLAY,,4,6,V3A,,,,*` speaks "kill" with token 1 empty; `$PLAY,VSF,4,6,JAY,,,,*` uses both. **Tokens 2–3 are required**: `$PLAY,VA33,,,,,,,*` is silent, `$PLAY,VA33,4,6,,,,,*` speaks. Numeric values vary by client (`3,9` Android app · `3,6` iOS · `4,6` JEDGE). APK field names: soundName, addToQue1, addToQue2, loopingTime, stun, isNeedQueue. | ✅ |
| `$VOL,<0–100>,<n2>,*` | >> | volume, 0 | Master volume. Android app sends `$VOL,100,0,*`; iOS `$VOL,69,0,*`. 30 is inaudible for game audio; use 69. | ✅ |
| `$NAME,<name>,*` | >> | name | Sets the gun's **persistent** name (the USB `Gun Name` field; survives power-cycle). Opening the official app rewrites it to `Tactix2`. | ✅ |
| `$VERSION,*` | >> | n/a | Query firmware. Reply `$VERSION,v4.32,?,4,,devhost.03,*`. Token 2 is the **headset** firmware (`hds.59`) when a headset is linked. | ✅ |
| `$SP,<n>,*` | >> | n | End-of-game / stop. `$SP,99,*` is the second half of the panic sequence. Do not probe it mid-game hoping for a score. The gun keeps none. | 👥 |
| `$QUERY,*` | >> | n/a | Over BLE returns a `$`-framed status array (`$QUERY,0,0,0,0,0,,1,0,,0,…`) plus a `$LCD`. **Not** the USB device record (that is USB-only; see the Serial console page). | ✅ |
Source: protocol/brx-protocol.md §3, §7a, §7e, §7f, §7l, §7o, §7r; docs/gotchas.md; docs/experiment-log.md (2026-08-24 $QUERY)

## Host → tagger: in-game effects, feedback & pools
| Command | Dir | Args | Meaning | Conf |
|---|---|---|---|---|
| `$SFLASH,*` | >> | n/a | **The shooter's green-sight kill-confirm flash.** The host sends exactly one per kill the holder scores, ~0.4 s after the trigger burst ends. (The APK lists it under notifications; on the wire the phone sends it.) | ✅ |
| `$LIFE,<hp>,<armor>,<shields>,*` | >> | addedHP, addedArmor, addedShields | Grant health. **Additive, clamped at the pool max**, not an absolute set. Writes do not self-emit `$HP`; the new value shows on the next hit/HUD refresh. | 🔍 ✅ |
| `$BUMP,<hp>,<armor>,<shields>,*` | >> | hP, armor, shields | Adjust current pools. Same additive/clamped behaviour as `$LIFE`. | 🔍 ✅ |
| `$BHIT,<damage>,<isCrit>,<powerLevel>,*` | >> | damage, isCriticalShot, powerLevel | Four shapes sent on v4.32: each was echoed and **applied no damage**. | 🔍 (fields) ✅ (bench result) |
| `$HFIRE,…,*` | >> | Range, CountIRPulses, RateOfFire, FlashLED | Five shapes sent on v4.32: **zero IR emitted** (receiver control passing before and after). | 🔍 (fields) ✅ (bench result) |
| `$IRTX,…,*` | >> | iRPower, soundOnHit, rangeOutdoor, rangeIndoor | Five shapes sent on v4.32: **zero IR emitted** (receiver control passing before and after). | 🔍 (fields) ✅ (bench result) |
| `$MELEE,<intensity>,*` | >> | intensity | `$MELEE,255,*` returns `$BUT,4,0,*` and fires no IR. | 🔍 ✅(no-op) |
| `$STUN,*` | >> | n/a | Listed in the APK. **Proven no-op over BLE.** | 🔍 ✅(no-op) |
| `$GLED,<mid>,<effect>,<optionA>,<optionB>,…,*` | >> | mid, effect, optionA, optionB | Gun LED **effect**. `effect` = LedEffect enum (Solid, Glow, ChaseBack, ChaseForward, StopIR). **Not RGB**: colour is team-derived from `$TID`. Used by the app during the pre-game lobby. | 🔍 ✅(not RGB) |
| `$GREN,…,*` | >> | iRType, crit, modifier, indoorMode, operationMode, channel, GrenadeType, MaxCount | Smart Grenade configuration frame, addressed to the **gun**. GrenadeMode enum: FlashBang / Gas / Confusion / Molotov. Sent on the bench: the gun emitted IR, but the emitted bits did not track the arguments. | 🔍 (fields) ✅ (bench result) |
| `$PBGAME,$PBTEAM,$PBWEAP,$PBPERK,$PBLIVES,$PBTIME,$PBSPAWN,$PBINDOOR,$PBLOCK,$PBSTART` | >> | enum index | The **"playbook"** pre-battle family mirroring the on-gun menu. A second remote-start path captured on fw **v4.30** (`$PBGAME,0` = FFA · `$PBWEAP,0` = M4 AUTO · `$PBPERK,2` = Body Armor · `$PBLIVES,2` = 5 lives · `$PBTIME,5` = infinite). `$PBWEAP,0,*` produced a "game starting" reload sound on our v4.32. | 👥 |
| `$DD,<killerId>,<killerTeam>,<victimId>,<nonce>,*` | host↔host | n/a | JEDGE's **device-to-device** kill notification. A host-side convention, not a tagger command. | 👥 |
Source: protocol/brx-protocol.md §3, §7d, §7i, §7j(community $PB*), §7o; protocol/callsign-extract/protocol-classes.md; docs/experiment-log.md (2026-08-26 headset emission, $BHIT, $GREN emission)

## Headset commands (host → gun → headset)
| Command | Args (APK) | Meaning | Conf |
|---|---|---|---|
| `$HLED,,6,,,,,*` | LedColorType (White, Pink, Orange; + green via `isUsedGreenLed`), BlinkLoopType (Once, ThreeTimes, Infinite), LedEffectType (incl. Heartbeat) | Headset LED. Exactly this frame is sent in the app's end-of-game tail and in the lobby. | ✅(captured) 🔍(fields) |
| `$HLOOP,0,0,*` | a, b | Sent by the app ~1.7 s after every death. | ✅(captured) 🔍(fields) |
Source: protocol/brx-protocol.md §3, §7e, §7f; protocol/callsign-extract/protocol-classes.md (Enums)

## Tagger → host: events and echoes
| Message | Fields | Meaning | Conf |
|---|---|---|---|
| `$PONG,*` | n/a | Reply to `$PING`. | ✅ |
| `$VERSION,<gun fw>,<headset fw>,<n>,,<host image>,*` | e.g. `v4.32,?,4,,devhost.03` | Version reply; token 2 reads `hds.59` with a headset linked, `?` otherwise. `devhost.*` = developer/host image. | ✅ |
| `$DISCONNECT,*` | n/a | Gun-initiated disconnect notice (e.g. the moment its headset is switched off). | ✅ |
| `$VOLTS,<pack_mV>,<cell_mV>,<t3>,<t4>,*` | e.g. `7662,3921,55,70` | Battery telemetry, ~every 30 s in app mode. Token 1 = pack millivolts (7.662 V), token 2 = cell millivolts (3.921 V). Tokens 3–4: (unknown). | ✅ |
| `$LCD,<hp>,<armor>,<t3>,<t4>,<mag>,<reserve>,*` | e.g. `45,70,0,0,36,216` | **Health/armor HUD echo.** `$START` → all zeros; `$SPAWN` → pools + current weapon's ammo; death → `$LCD,0,0,0,1,1,1,*`. Tokens 3–4: (unknown). A zeroed `$LCD` after `$SPAWN` means "no config loaded" (post power-cycle tell). | ✅ |
| `$ALCD,<mag>,<t2>,<slot>,<reserve>,<heat>,*` | e.g. `36,100,0,108,0` | **Ammo/weapon HUD stream.** Per-round during fire *and* reload (mag 0→1→2… as reserve drains). Token 2: (unknown). It reads 100 in normal play and drops to 0 after a `$SIR` fn 23 hit. Token 3 = weapon slot. Token 5 = **weapon heat** (0–100+, only on overheat weapons). Only streams on ammo events. Silence is not "no change". | ✅ |
| `$HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,*` | e.g. `4,0,19,2,9,0,3` | **Hit received.** → Events page for the full decode. | ✅ |
| `$HP,<hp>,<armor>,<shield>,*` | e.g. `43,0,0` | Pools after a hit; arrives in the same millisecond as its `$HIR`. `$HP,0,0,0` = death. | ✅ |
| `$BUT,<id>,<state>,*` | id 0–5, state 1 press / 0 release | Physical button event (ids match `$BMAP`). Streams only in app mode. `$BUT,4,0` is also returned by `$MELEE`. | ✅ |
| `$QUERY,…` | ~11 `value,,` pairs | Status array in reply to BLE `$QUERY,*`. | ✅ |
| `$WEAP` / `$PERK` / `$HS` | n/a | Selection echoes from the on-gun menus (LaserTagMods). | 👥 |
Source: protocol/brx-protocol.md §4, §7e, §7f, §7j, §7r; mcp/brx_mcp/protocol.py (parsers); docs/experiment-log.md 2026-08-27

## Seen in the app's vocabulary, not exercised by us
facts about the Callsign app's request namespace only. On-tagger behaviour has not been observed. 🔍
| Command | Direction | APK fields / enums | Note |
|---|---|---|---|
| `$VIB` | >> | `isEnableVibration` | Never sent by us. |
| `$ZOOM` | >> | n/a | Never sent by us. |
| `$FSET` | >> | ~38 event→sound slots: ActionKey, DeathAlarm, TickTock, HitHp, HitArmor, HitShield, HitCrit, EmpStart/Loop/End, IncendiaryStart/…, TearGasHit, … | Never sent by us. |
| `$ASSIST` | >> | `soundName` (+ SetVolume) | Never sent by us. |
| `$DLC` / `$ASKDLC` → `$GOTDLC` | >> / << | `hiddenFeatures` | The app's premium-content (BattleCoins) handshake. The metadata names three premium modes: Generals, Commanders, Swarm. Never sent by us. |
| `$BLINK` · `$CHASE` · `$LED` | >> (headset) | n/a | Listed with the headset commands. Never sent by us. |
| `$TIME` | << | n/a | Listed as a notification. Never observed on the wire. |
Source: protocol/callsign-extract/protocol-classes.md

## Complete vocabulary from the app's own request namespace
(🔍): AMMO ASKDLC ASSIST BHIT BMAP BUMP CLEAR DLC FSET GLED GREN GSET HFIRE IRTX LIFE MELEE NAME PLAY PLAYX PSET SIR SPAWN START STOP STUN VERSION VIB VOL WEAP ZOOM · headset BLINK CHASE HLED HLOOP LED · notifications ALCD BUT GOTDLC HIR HP LCD SFLASH TIME VERSION VOLTS. `$PING`, `$TID`, `$SP`, and the `$RV/$RP/$UR/$KK/$DD` family are **not** in it. They come from LaserTagMods and our bench. Absence from the app ≠ non-existent.
Source: protocol/callsign-extract/protocol-classes.md
