# BRX Serial Command Protocol Reference (Draft)

**Status:** Draft v0.1 — extracted by independent analysis of the BRX tagger's Bluetooth serial interface.
**Credit:** Protocol knowledge originally discovered and proven by **LaserTagMods (JEDGE / JBOX projects)** — https://github.com/LaserTagMods. This document is a fresh, independent write-up of the protocol; no code is copied.
**Scope:** Battle Company BRX taggers (Gen1, Gen2/3). Smart Grenade: unknown, under investigation.

---

## 1. Transport

The BRX exposes a plain-text serial command interface over Bluetooth. The tagger's stock firmware is never modified — all customization is done by sending commands over this link.

| Generation | Link type | Baud | Notes |
|---|---|---|---|
| Gen1 | Bluetooth Classic (SPP) | 57600 | Pair via HC-05 module (PIN `0001`, role master). Headset must be connected for BT to function. |
| Gen2/3 | BLE — Nordic UART Service | 115200 | Connect directly from any BLE central (ESP32, Raspberry Pi, Web Bluetooth). |

**BLE UUIDs (Nordic UART Service):**
- Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- RX characteristic (write to tagger): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- TX characteristic (notify from tagger): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`

**Generation detection heuristic:** power on the tagger and run a BLE scan. If it advertises the UART service → Gen2/3. If nothing appears on BLE but the device pairs over Bluetooth Classic → Gen1.

## 2. Message framing

- Messages are ASCII, comma-delimited tokens.
- Start with `$COMMAND`, end with `,*`.
- Empty tokens are allowed (consecutive commas) and mean "leave unchanged / not applicable."
- Example: `$PING,*` → tagger replies `$PONG,*` (Gen1 may prefix: `$!DFP,PONG,*`).

## 3. Commands TO the tagger (host → BRX)

| Command | Purpose | Notes / observed examples |
|---|---|---|
| `$PING,*` | Connectivity check | Reply: `$PONG,*` |
| `$CLEAR,*` | Clear current game state | Sent before configuring a new game |
| `$START,*` | Begin configuration/start sequence | |
| `$SPAWN,*` / `$SPAWN,,*` | Spawn the player into the game | |
| `$CONNECT,*` | Connection handshake | |
| `$INIT,*` | Initialize | |
| `$PHONE,*` | Put tagger in app-controlled mode | Same mode the official app uses |
| `$GSET,...` | Global game settings | e.g. `$GSET,0,0,1,0,1,0,50,1,*` — token 1: free-for-all off/on |
| `$PSET,...` | Player settings (health pools, audio set, etc.) | e.g. `$PSET,63,2,<HP,Armor,Shield>,50,,H44,JAD,V33,...,*` — health passed as `HP,Armor,Shield` triplet (e.g. `500,250,150`) |
| `$WEAP,<slot>,...` | Define a weapon in slot 0–5 | ~44 tokens: damage, fire rate/delay, mag size, reload time, sounds, IR signature, ammo counts. See §6. |
| `$SIR,<protocol>,<subtype>,<sound>,<function>,...` | Configure how incoming IR events are interpreted | Maps IR signatures to effects: damage, add HP, add shields, add armor, etc. See §5. |
| `$BMAP,<button>,<function>,...` | Remap physical controls | Trigger=0, Alt-fire=1, Reload handle=2, Select=3, Left=4, Right=5, Gyro=8. Function 97=reload, 100=weapon-cycle |
| `$GLED,<team?>,<r>,<g>,<b>,<intensity?>,,*` | Set gun LED color/state | e.g. `$GLED,1,1,1,0,10,,*` |
| `$PLAY,<soundID>,<volume?>,<priority?>,,,,,*` | Play a sound/voice line by ID | Sound IDs like `VA9E`, `V3M`, `VNM`, `VA1L`, `H29`… Large audio bank; IDs not fully mapped yet |
| `$AS,...` | Applicator/game-control settings | e.g. `$AS,1,0,4,0,10,0,95,*` |
| `$SP,<n>,*` | End-of-game / stop | e.g. `$SP,99,*` |
| `$STOP,*` | Stop (captured from official app, 2026-08-23) | First command the app sends on connect |
| `$PLAYX,0,*` | Stop/clear sound playback (captured) | Sent right after `$STOP,*` on connect |
| `$VOL,<volume>,<n2>,*` | Set volume (captured) | App sends `$VOL,100,0,*` on connect |
| `$NAME,<name>,*` | Set tagger name (captured) | App sent `$NAME,Tactix2,*` |
| `$VERSION,*` | Query firmware version (captured) | Reply: `$VERSION,v4.32,?,4,,devhost.03,*` |
| `$PBWEAP,<n>,*` / `$PBTEAM,` / `$PBPERK,` | Pre-battle weapon / team / perk selection | Mirrors the on-gun menu choices |
| `$TID,` | Set team ID | |
| `$SPAWN`, `$RP`, `$RV`, `$UR`, `$IT`, `$KK`, `$TA`, `$PT`, `$HS`, `$PH` | Respawn/revive/status family | Partially mapped — see §7 Unknowns |

## 4. Messages FROM the tagger (BRX → host)

| Message | Meaning | Key tokens |
|---|---|---|
| `$PONG,*` | Ping reply | |
| `$VERSION,<ver>,?,<n>,,<host>,*` | Version reply (captured 2026-08-23) | e.g. `$VERSION,v4.32,?,4,,devhost.03,*` |
| `$DISCONNECT,*` | Tagger-initiated disconnect notice (captured) | |
| `$VOLTS,<pack_mV>,<cell_mV>,<n3>,<n4>,*` | **Battery telemetry** (verified 2026-08-23) | Periodic (~every 30 s) in app mode. Observed: `$VOLTS,7662,3921,55,70,*` — 7.662 V pack, 3.921 V cell; last two tokens likely charge %/levels (TBC) |
| `$LCD,<t1..t6>,*` | Display/state echo (observed 2026-08-23) | Seen in reply to `$START,*`: `$LCD,0,0,0,0,0,0,*` — semantics TBD |
| `$HIR,...` | **Hit! Tagger was tagged** | token 3 = shooter player ID, token 4 = shooter team ID |
| `$HP,<hp>,...` | Health update | `$HP,0,...` = player died (or turned zombie in Survival) |
| `$BUT,<id>,<state>,*` | Physical button event (verified 2026-08-23) | id: 0=trigger, 1=alt-fire, 2=reload handle, 3=select, 4=left, 5=right (matches `$BMAP` ids). state: 1=press, 0=release |
| `$UP,...` | Status/update report (0–6 tokens) | |
| `$AS,...` | Game/control echo (0–11 tokens; token 8 = applicator) | |
| `$SP,...` | End-of-game report (0–5 tokens) | |
| `$WEAP`, `$PERK`, `$HS` | Selection echoes from on-gun menus | |

**Kill attribution pattern (from `$HIR` + `$HP`):** store shooter ID/team from the last `$HIR`; when `$HP,0` arrives, the stored shooter gets kill credit. JEDGE encodes a kill notification between devices as: `$DD,<killerPlayerID>,<killerTeamID>,<victimID>,<nonce>,*` (host-side convention, not a tagger command).

## 5. `$SIR` — incoming IR event table (observed)

Format: `$SIR,<irProtocol>,<subtype>,<soundID>,<function>,<p5>,<p6>,<p7>,<p8>,*`

| Example | Interpretation |
|---|---|
| `$SIR,0,0,,1,0,0,1,,*` | Standard weapons (AR, Energy Rifle, Ion Sniper, Laser Cannon, Plasma Sniper, Shotgun, SMG, Stinger, Suppressor) — damage shields→armor→HP |
| `$SIR,0,1,,36,0,0,1,,*` | Force Rifle / Sniper Rifle (pass-through damage) |
| `$SIR,0,3,,37,0,0,1,,*` | AMR / Bolt Rifle / Burst Rifle |
| `$SIR,1,0,H29,10,0,0,1,,*` | Respawn + add HP |
| `$SIR,2,1,VA8C,11,0,0,1,,*` | Add shields |
| `$SIR,3,0,VA16,13,0,0,1,,*` | Add armor |
| `$SIR,6,0,H02,1,0,90,1,40,*` | Rail Gun |
| `$SIR,8,0,,38,0,0,1,,*` | Charge Rifle |
| `$SIR,9,3,,24,10,0,,,*` | Energy Launcher |
| `$SIR,10,0,X13,1,0,100,2,60,*` | Rocket Launcher |
| `$SIR,11,0,VA2,28,0,0,1,,*` | Tear gas (reported not working) |
| `$SIR,13,0,H50,…` / `13,1,H57` / `13,3,H49` | Energy Blade / Rifle Bash / War Hammer (melee) |
| Max distinct IR recognitions | 14 |

## 6. `$WEAP` — weapon definition (observed examples)

Six slots (0–5). Example known-good definitions:

```
Assault Rifle : $WEAP,0,,100,0,0,24,0,,,,,,,,100,850,32,32768,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,9999999,75,,*
Charge Rifle  : $WEAP,1,,100,8,0,150,0,,,,,,,,1250,850,100,32768,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,C19,C04,20,150,100,9999999,75,,*
(Slot 2)      : $WEAP,2,,100,0,0,150,0,,,,,,,,1000,850,2,32768,2000,0,7,100,100,,0,,,E07,D32,D31,,D17,D16,D15,A73,,,,,2,9999999,75,,*
Gas Melee     : $WEAP,3,1,90,11,1,1,0,,,,,,1,80,1400,50,10,0,0,10,11,100,100,,0,,,S16,D20,D19,,D04,D03,D21,D18,,,,,10,9999999,30,30,*
Melee         : $WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,32768,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,9999999,30,,*
(Slot 5)      : $WEAP,5,1,90,10,0,115,0,,,,,,115,80,1000,850,2,32768,1200,0,7,100,100,,0,,,C03,,,,D14,D13,D12,D18,,,,,2,9999999,30,20,*
```

Recognizable fields (positions to be confirmed by testing): damage value, fire delay (ms), mag capacity, ammo reserve (32768 ≈ unlimited flag?), reload time (ms), IR signature/type, sound IDs (letter+number codes: `R01`, `D04`, `E03`, `C15`…), range/power (%), and per-slot ammo counts. **Full token map is the top reverse-engineering priority** — best method: diff the official app's output while changing one setting at a time.

## 7. Unknowns / TODO

- Full `$WEAP` 44-token field map (highest value)
- Complete sound ID catalog (`$PLAY` bank)
- Exact semantics of `$AS`, `$UP`, `$GSET`, `$PSET` token positions
- `$RADSK`, `$RV`, `$RP`, `$UR`, `$IT`, `$KK`, `$PT`, `$TA`, `$PH`, `$HKC`/`$PKC` (host/player kill-confirm family)
- Smart Grenade: BLE-visible? Same protocol? IR-configurable?
- Gen1 vs Gen2/3 command differences (JEDGE notes firmware 4.26 added `$AS`, `$SP`, `$UP`)
- Headset link protocol

## 7a. Session findings (Tactix Gen2/3, verified 2026-08-23)

- Gen2/3 advertises as `Tactix-XXXX` (last 2 MAC bytes). The Nordic UART service UUID **is**
  present in the advertisement, so scan-time generation detection works.
- `$PING,*` → `$PONG,*` round trip ~59 ms over BLE.
- **Idle taggers are silent.** Outside app mode, no unsolicited messages are sent — button
  presses, trigger pulls, IR hits produce nothing on the wire.
- **`$PHONE,*` opens the event tap** (tagger announces "phone connected", replies
  `$BUT,3,0,*`): all button events stream live, `$VOLTS` telemetry starts, and the on-gun
  menu/controls are locked out until the game is configured/started by the host (or
  power-cycle). `$CONNECT,*` and `$INIT,*` alone produced no observable reply.
- In phone mode pre-game, the trigger emits `$BUT,0,…` but does not fire.
- **Official app connect ritual (HCI snoop capture, firmware v4.32):** the app does NOT
  send `$PHONE,*`. On each (re)connect it sends `$STOP,*` → `$PLAYX,0,*` → `$VOL,100,0,*` →
  `$PLAY,VA20,3,9,,,,,*` ("connection established" voice), and once per session
  `$NAME,<name>,*` + `$VERSION,*`. No game-start sequence captured yet (app couldn't hold
  its connection long enough to start a game).
- Sound IDs confirmed: `VA20` = "connection established"; `U16` also played on connect.

## 7b. Facts from the official BRX manual (V7, battlecompany.com)

Source: https://battlecompany.com/wp-content/uploads/2021/01/BRX_Manual_V7_FINAL.pdf

- **No user-accessible SD card on the BRX.** SD-card sound updates are a commercial-line
  feature (Battle Rifle Pro/XL/BRM). The BRX has a micro-USB **"Programing Port"**
  (distinct from the charging port) — the official updater path.
- **On-gun game start: pull the reload handle.** Flow: mode → team/faction → weapon
  (trigger cycles) → perk (ALT cycles) → reload-handle pull starts the game. Hypothesis
  for remote start: our BLE config reaches "ready mode" and the tagger awaits the
  reload-handle pull (`$BUT,2`) — test config-push + physical pull.
- **Headset lockout:** disconnecting the headset after game start locks the gun until
  reconnected ("prevent cheating"); the gun shoots normally if no headset was connected
  at boot. Candidate explanation for guns refusing to fire — control for headset state.
- Indoor/outdoor mode: hold ALT 3 s. Target mode (sighting): hold LEFT while powering on.
- Stock weapons (name, damage, ROF, accuracy, mag): M-4 24/545/96-91/30 ·
  SMG-X3 25/545/96-88/26 · MG-7 38/342/66-45/75 · SR-100 140/44/100-90/4 ·
  TAC-87 120-40/150/95-80/8. (M-4 damage 24 matches token 6 of the known-good
  `$WEAP,0` assault-rifle string — supports the damage-token hypothesis.)
- Supremacy characters carry HP/Armor/Shield stat triplets (e.g. Soldier 100/50/–,
  Guardian 75/–/125) — same triplet shape as `$PSET` health tokens.
- Modes: Free For All, Team Death Match (Alpha/Bravo, perks), Supremacy (factions:
  Resistance red / Vanguard green / Nexus blue, 9 characters), Survival (Human/Infected).
  Settings ranges: lives ∞/1/3/5/10/15 · time off/5–30 min · respawn off/15/30/60/
  ramp45/ramp90 · volume 1–5.
- Headset pairing can take up to 3 min with many BT devices nearby (relevant to
  multi-tagger events).

## 8. Safe testing notes

- The tagger's stock firmware is untouched by all of this; power-cycling the tagger restores normal operation.
- Factory restore path: Battle Company's official USB updater.
- Recommended probe sequence: connect → `$PING,*` → await `$PONG` → read-only listen session (pull trigger, get tagged, watch `$BUT`/`$HIR`/`$HP` traffic) before sending any config.
