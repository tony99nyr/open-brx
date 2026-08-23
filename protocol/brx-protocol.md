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
| `$SPAWN,,*` | **Takes the tagger live** | The empty token matters — `$SPAWN,,*`, not `$SPAWN,*`. See §7e |
| `$AMMO,<slot>,<mag>,<reserve>,<flag>,*` | **Load magazines** (verified 2026-08-23) | Sent immediately after `$SPAWN,,*`. Without it the gun goes live with no ammunition. e.g. `$AMMO,0,36,108,1,*` |
| `$CONNECT,*` | Connection handshake | |
| `$INIT,*` | Initialize | |
| `$PHONE,*` | Put tagger in app-controlled mode | Same mode the official app uses |
| `$GSET,...` | Global game settings | e.g. `$GSET,0,0,1,0,1,0,50,1,*` — token 1: free-for-all off/on |
| `$PSET,...` | Player settings (health pools, audio set, etc.) | Tokens 3–5 are `<HP>,<armor>,<shield>` — verified against the `$LCD` echo in §7e. e.g. `$PSET,0,0,45,70,70,50,,H44,JAD,V33,...,A10,*` |
| `$WEAP,<slot>,...` | Define a weapon in slot 0–5 | ~44 tokens: damage, fire rate/delay, mag size, reload time, sounds, IR signature, ammo counts. See §6. |
| `$SIR,<protocol>,<subtype>,<sound>,<function>,...` | Configure how incoming IR events are interpreted | Maps IR signatures to effects: damage, add HP, add shields, add armor, etc. See §5. |
| `$BMAP,<button>,<function>,...` | Remap physical controls | Trigger=0, Alt-fire=1, Reload handle=2, Select=3, Left=4, Right=5, Gyro=8. Function 97=reload, 100=weapon-cycle |
| `$GLED,<team?>,<r>,<g>,<b>,<intensity?>,,*` | Set gun LED color/state | e.g. `$GLED,1,1,1,0,10,,*` |
| `$PLAY,<soundID>,<volume?>,<priority?>,,,,,*` | Play a sound/voice line by ID | Sound IDs like `VA9E`, `V3M`, `VNM`, `VA1L`, `H29`… Large audio bank; IDs not fully mapped yet |
| `$AS,...` | Applicator/game-control settings | e.g. `$AS,1,0,4,0,10,0,95,*` |
| `$SP,<n>,*` | End-of-game / stop | e.g. `$SP,99,*` |
| `$STOP,*` | Stop (captured from official app, 2026-08-23) | First command the app sends on connect |
| `$PLAYX,0,*` | Stop/clear sound playback (captured) | Sent right after `$STOP,*` on connect |
| `$VOL,<volume>,<n2>,*` | Set volume (captured) | Android app sends `$VOL,100,0,*`; iOS Callsign sends `$VOL,69,0,*` |
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

## 7b. iOS Callsign capture — firmware version gate (verified 2026-08-23)

PacketLogger btsnoop capture from an iPhone X running the official **Callsign** app,
against two different Tactix2 taggers. Decoded with `python -m brx_mcp.btsnoop`.

- **Callsign connect ritual** differs from the Android app's: `$STOP,*` → `$PLAYX,0,*` →
  `$VOL,69,0,*` → `$PLAY,VA20,3,6,,,,,*` (Android used `$VOL,100,0,*` / `$PLAY,VA20,3,9`).
  The volume and `$PLAY` arguments are therefore **app-specific, not protocol constants**.
- Once per session the app then sends `$NAME,Tactix2,*` + `$VERSION,*`.
- **The version reply is the last frame of the session.** In 463 s of capture across ~8
  connection attempts, the tagger sent exactly one message:
  `$VERSION,v4.32,?,4,,devhost.03,*`. The app never sends game config and never attempts a
  start — it queries the version, and abandons the session. This is the on-the-wire form of
  Callsign's version-gate warning. **Remote game start cannot be captured from this app.**
- **The gate is an UPPER bound, not a lower one.** Callsign (latest iOS build, 2026-08-23)
  reports verbatim: *"your current firmware version of gun is v4.32. supported version is
  until v2.01e. please update firmware to supported version or check for callsign updates
  if you have latest firmware version."* The taggers are **ahead of / outside** the app's
  supported range, not behind it. Combined with the `devhost.03` build string, this
  suggests these units run a **developer/host image that was never in the retail version
  sequence**. Do not reflash: the Teensy HalfKay bootloader is write-only (no backup is
  possible), and "downgrading" to v2.01e is irreversible and unverified. Confirm with
  Battle Company what `v4.32 / devhost.03` is before touching firmware.
- ~~**v4.32 does not sustain a BLE link.**~~ **RETRACTED — see §7e.** This capture shows
  the app reconnecting roughly every 8 s, which we read as a firmware-level BLE fault
  because our own bleak/CoreBluetooth client independently drops at ~6.6 s on two taggers
  and on both macOS and Windows. That inference was wrong: a later capture (§7e) shows the
  **same tagger holding a single continuous session for 80+ seconds** with the iOS app.
  The tagger's BLE stack is fine. The repeated reconnects here are the app's own behaviour
  around the version gate, not a link failure.
  **Still open:** why our bleak client drops at ~6.6 s. Treat it as a client-side bug —
  connection parameters, notification handling, or macOS/WinRT power management — not a
  firmware defect. Do not repeat the "firmware is broken" conclusion without new evidence.
- **ATT MTU negotiates to 23 bytes** (client requests 293, tagger answers 23), confirming
  the ~20-byte payload chunking in `ble.py` is required, not merely defensive.
- Build string `devhost.03` may indicate a developer/host image rather than a retail one —
  worth confirming with Battle Company before reflashing.

## 8. Safe testing notes

- The tagger's stock firmware is untouched by all of this; power-cycling the tagger restores normal operation.
- Factory restore path: Battle Company's official USB updater.
- Recommended probe sequence: connect → `$PING,*` → await `$PONG` → read-only listen session (pull trigger, get tagged, watch `$BUT`/`$HIR`/`$HP` traffic) before sending any config.

## 7c. Hardware findings (2026-08-23)

- **The tagger's MCU is a Teensy** (PJRC). Its micro-USB port enumerates on macOS as
  `USB Serial` / vendor `Teensyduino` → `/dev/cu.usbmodem*`.
- That USB port is **not** the `$` protocol. It echoes input locally and answers any
  CR-terminated line with `ERROR` — including bare CR, `$PING,*`, `help`, `?`, `AT`.
  It is presumed to be Battle Company's updater/console interface; its command set is
  unknown and was deliberately not brute-forced.
- **Firmware cannot be backed up.** Teensy's HalfKay bootloader is write-only by design,
  so no flash read-back is possible over USB. The SD card is the only backup, and rollback
  depends entirely on Battle Company supplying the original image.
- **The `$` protocol runs on a hardware UART at 115200**, not USB. LaserTagMods' JEDGE
  drives it via `Serial1.println("$UP,100,5,0,*")` etc., and the Gen1 HC-05 mod bridges the
  same UART over Bluetooth Classic. The built-in BLE module is likewise a UART bridge.
  → A **wired UART tap on the accessory port** would bypass the v4.32 BLE stack entirely
  and is the most promising route to a stable link (untested; needs pinout).

## 7d. Commands seen in LaserTagMods sources but not yet documented above

Observed in public LaserTagMods project sources (JEDGE/JBOX et al.), **not present in §3/§4
above, and not verified by us on the wire**. Leads for probing, not confirmed protocol:

| Command | Guess at purpose | Why it's interesting |
|---|---|---|
| `$KOTH` | King-of-the-hill game mode | A named game mode implies host-driven mode selection — directly relevant to the unsolved remote game start |
| `$HLED` | Headset//hit LED control | Pairs with the documented `$GLED` (gun LED) |
| `$HLOOP` | Looping sound/haptic on headset? | `H`-prefixed like `$HLED`/`$HS`/`$HKC` — likely the headset family |
| `$RR` | Reload/respawn related | Adjacent to documented `$RP`/`$RV` |
| `$BRXSERVER` | Server/host mode | — |
| `$SSID` | WiFi network name | **These three together imply a WiFi/server mode we knew nothing about.** Worth investigating: if the tagger can join a network, that is a second transport entirely and would sidestep the v4.32 BLE fault |
| `$PASS` | WiFi password | |
| `$BRX` | Device/mode identifier | — |

The remaining commands found in their sources (`$PERK` `$PBPERK` `$PBTEAM` `$TA` `$AS`
`$UP` `$GLED` `$DD` `$PH` `$PKC` `$HKC` `$HS` `$PT` `$RV` `$RADSK` `$KK` `$TID`) are
already covered in §3/§4.

- `$UP,100,<n>,0,*` and `$UR,*` appear together in their host code.
- `$PLAY` argument sets vary by client (`VA20,3,9` Android app; `VA20,3,6` iOS Callsign;
  `VA20,4,6` JEDGE) — the numeric fields are parameters, not constants.
- The `$PB*` family is of particular interest: `$PBWEAP,0,*` is the one command we have
  seen produce a "game starting" reload sound.

**Credit:** protocol discovery for the BRX platform is overwhelmingly the work of
**LaserTagMods** (JEDGE / JBOX) — https://github.com/LaserTagMods. Their repositories carry
no license (all rights reserved), so nothing here is copied from their sources; these are
independently restated observations. Anyone building on this should credit them too.

## 7e. SOLVED — remote game start (iOS Callsign capture, 2026-08-23)

Captured with PacketLogger from the official iOS Callsign app driving a full game on a
Tactix2 (fw v4.32). Decoded transcript: `protocol/captures/2026-08-23-ios-callsign-game-start.txt`.
This is the sequence that actually takes a tagger live. Three pieces were missing from our
previous `GAME_SEQUENCE`, which is why config was accepted but the gun never fired.

### The sequence (host → tagger)

```
$CLEAR,*
$START,*
$GSET,1,0,1,0,1,0,50,1,*
$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*
$WEAP,0,...   (primary)
$WEAP,1,...   (secondary)
$WEAP,4,...   (melee)
$SIR,... x10  (IR event table)
$BMAP,0,0,,,,,*          $BMAP,1,100,0,1,99,99,*   $BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*         $BMAP,4,98,,,,,*          $BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$PLAYX,0,*
$PLAY,VA81,4,6,,,,,*
$SPAWN,,*                <-- go-live
$AMMO,0,36,108,1,*       <-- load magazines
$AMMO,1,6,12,1,*
$BMAP,0,0,,,,,*          <-- trigger re-mapped AFTER spawn
```

### The three missing pieces

1. **`$AMMO,<slot>,<mag>,<reserve>,<flag>,*` — previously undocumented.** Configuration
   alone never loads ammunition; without it the gun has nothing to fire.
2. **`$BMAP` is mandatory and is sent twice** — all seven mappings before `$SPAWN`, then
   `$BMAP,0,0,,,,,*` again immediately after. Confirms the earlier hypothesis that the
   "disabled" chirp was an unmapped trigger, not a refusal to start.
3. **`$SPAWN,,*`** (with the empty token), not `$SPAWN,*`.

### Confirmations from the tagger

```
<< $LCD,45,70,0,0,36,216,*     after $SPAWN: HP 45, armor 70, mag 36, reserve 216
<< $ALCD,36,100,0,108,0,*      then 35, 34, 33 ... as the trigger is pulled
<< $BUT,0,1,* / $BUT,0,0,*     199 trigger events, live
<< $VOLTS,7634,3770,53,45,*    telemetry continues in-game
```

- **`$PSET` health offsets corrected:** tokens 3–5 are `<HP>,<armor>,<shield>` (`45,70,70`),
  matching the `$LCD` echo. §3's earlier description of this field was wrong.
- **Clean end-of-game:** `$VOL,69,0,*` → `$HLED,,6,,,,,*` → `$STOP,*` → `$CLEAR,*` →
  `$PLAY,VS6,4,6,,,,,*`.
- `$GLED`/`$HLED` are used for gun/headset LEDs during the pre-game lobby.

### Not covered by this capture

Only one tagger was active, so **no hits were taken**: the capture contains no `$HIR`
(incoming hit) or `$HP` (health update) traffic, and no death/respawn cycle. The in-game
damage path is therefore still unverified on the wire. A two-tagger capture is the next
one worth taking — it would confirm `$HIR` shooter/team attribution, the `$HP,0` death
edge, and whatever the app sends to respawn a downed player.

### Note on how this capture became possible

Earlier attempts appeared to fail, and two conditions differed here: the **headset link was
up** (`Headset Version: hds.59`, §7c) and the **tagger was on USB**. But neither is
established as necessary. The operator notes the app's UI makes connection state ambiguous,
and that Callsign may well have been connected during earlier attempts too — iOS has
reportedly been the only platform Callsign works on for years. So the honest summary is:

- The tagger sustains long BLE sessions with the iOS app (80+ s here, single connection).
- Callsign's version-gate warning is **soft** — it warns about v4.32 but still runs a game.
- Whether the headset link or USB matters is **untested**; do not assume either is required.
- Connecting is **intermittent**: the operator reports Callsign succeeding on roughly
  1 attempt in 3, with repeated force-closes and retries in between. A session that comes
  up cleanly then holds. This suggests the failure is in **connection establishment**, not
  in sustaining a link.
- Our own client's ~6.6 s drop remains unexplained and is the main open question. Note we
  never retried in a loop — every test was a small number of single attempts. Retrying
  connects repeatedly is the obvious untried experiment.

## 7f. Combat, death and respawn (two-tagger iOS Callsign capture, 2026-08-23)

Second PacketLogger capture, two taggers in a live game, tracing the **victim's** phone.
Decoded transcript: `protocol/captures/2026-08-23-ios-callsign-two-tagger-combat.txt`
(372 frames; 23 `$HIR`, 23 `$HP`, 3 `$SPAWN`). Fills the §7e gap.

### `$HP,<hp>,<armor>,<shield>,*`

Three pools, not one. **Damage drains armor before HP** (matching the §5 `$SIR` note).
Shield stayed 0 throughout this capture — untested.

```
<< $HP,45,52,0,*     armor 70 -> 52, HP untouched
<< $HP,45,16,0,*     armor still absorbing
<< $HP,43,0,0,*      armor exhausted, overflow begins cutting HP
<< $HP,7,0,0,*
<< $HP,0,0,0,*       death
<< $LCD,0,0,0,1,1,1,*
```

### `$HIR,<irProto>,<t2>,<t3>,<t4>,<t5>,<t6>,<t7>,*`

Observed forms: `$HIR,0,0,1,1,9,0,3,*` and `$HIR,4,0,1,1,9,0,3,*`. Only the **first token
varies** across this capture — the IR protocol id, matching `$SIR`'s first field.
Protocol `0` hits drained **18** armor each; protocol `4` hits drained **9**.
Token 5 was `9` in both, so it is **not** simply the damage value — the `$SIR` table's
mapping of protocol → effect is what determines damage. Shooter-ID semantics from §4 are
**not confirmed** here: tokens 3 and 4 were `1,1` for every hit in a two-player game, so
they could be player/team or something else. Needs a capture with distinct player IDs.

### Death and respawn — host-driven

The **host drives respawn**, the gun does not self-revive:

```
345.58  << $HP,0,0,0,*                  death
345.61  << $LCD,0,0,0,1,1,1,*
347.27  >> $HLOOP,0,0,*                 host, ~1.7 s after death
355.66  >> $SPAWN,,*                    host respawns, ~10 s after death
355.75  << $LCD,45,70,0,0,36,216,*      HP, armor AND ammo restored
```

- **`$SPAWN,,*` serves double duty** — initial go-live (§7e) and respawn.
- **Respawn restores ammo implicitly**: the `$LCD` echo shows `36,216` with no `$AMMO`
  sent. `$AMMO` appears to be needed only at initial spawn.
- Respawn timing is the host's choice (~10 s here), which is the hook a game engine needs.
- `$HLOOP,0,0,*` is sent by the host shortly after each death — likely stopping/starting a
  death audio loop. Purpose unconfirmed.

### Newly observed commands

| Command | Notes |
|---|---|
| `$SFLASH,*` | No arguments. Sent by the host periodically during play (4x here, ~30–60 s apart), never near a hit or death. Purpose unknown. |
| `$HLOOP,<a>,<b>,*` | Seen only as `$HLOOP,0,0,*`, immediately after each death. Was a §7d lead from LaserTagMods sources; now confirmed live. |
