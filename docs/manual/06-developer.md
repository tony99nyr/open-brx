# 06 · Developer reference  (section slug: /manual/dev)
**Last verified:** 2026-08-27
**Audience:** developers, modders and integrators who want to drive a BRX from their own code — an ESP32 rider, a laptop, a phone app, a base station · **Goal of this section:** the complete interoperability spec for the BRX tagger + headset: transport, framing, every known command and event with its field map, the `$WEAP` / `$GSET` / `$PSET` / `$SIR` tables, the optical IR word, the USB console, and a copy-paste path from `pip install` to a live game — with the confidence of every fact stated per row.
**Provenance legend:** ✅ verified on our bench · 🔍 decoded from the Callsign APK · 👥 community / LaserTagMods — nothing unconfirmed is published; see Research backlog at the end.

> **Credit, first.** The BRX serial protocol was discovered and proven by **LaserTagMods** (the JEDGE / JBOX / NRFL-Bases projects, github.com/LaserTagMods). Everything on these pages is an independent, clean-room restatement — verified on our own taggers, decoded from public app metadata, or captured off the air — and contains no Battle Company code or assets. If you build on this, credit them too.

> **Ground rule of the whole section:** stock BRX firmware is **never modified**. Every capability below is reached over the tagger's own serial protocol, and **power-cycling always restores a tagger** to normal operation.

---

## Pages

### Page: Transport, framing & safety  (`/manual/dev/transport`)
_How you reach the gun, what a frame looks like, and why nothing here can brick one_

[hero] Headline: "One text protocol, three ways in." Sub: The BRX speaks a plain ASCII, comma-delimited command language on a hardware UART. Gen1 exposes it over Bluetooth Classic, Gen2/3 over BLE, and the community drives it from a wire — the frames are identical on all three. Background: DEV-01. ✅ src: protocol/brx-protocol.md §1, §7c

[callout:info] **Who found this.** Protocol discovery for the BRX platform is the work of **LaserTagMods** (JEDGE / JBOX). This page restates their findings independently, with our own bench verification noted per row. 👥 src: protocol/brx-protocol.md (header, §7d), README.md

[table] **Transport by generation**
| Generation | Link | Speed | How you connect | Confidence |
|---|---|---|---|---|
| Gen1 | Bluetooth Classic (SPP) | 57600 baud | Pair an HC-05 module (PIN `0001`, master role). The headset must be connected for Bluetooth to function. | 👥 |
| Gen2/3 | BLE — Nordic UART Service (NUS) | UART bridge at 115200 behind the radio | Connect from any BLE central: laptop (bleak), ESP32, phone. No pairing/PIN. | ✅ |
| Any | Hardware UART inside the gun | 115200 | What JEDGE drives directly (`Serial1`). No external accessory port exists on the BRX — a wired tap means opening the gun. Untested by us. | 👥 |
| Any | Micro-USB "Programing Port" | USB CDC (baud ignored) | **Not** the `$` protocol — a separate `QUERY`/`SETUP` console. See the Serial console page. | ✅ |
✅/👥 src: protocol/brx-protocol.md §1, §7c

[spec-sheet] **BLE — Nordic UART Service UUIDs**
- Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- RX characteristic (**write** to tagger): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- TX characteristic (**notify** from tagger): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`
- Advertised name: `Tactix-XXXX` (the last two bytes of the BLE MAC). The NUS service UUID **is** present in the advertisement, so scan-time generation detection works.
- ATT MTU negotiates to **23 bytes** — chunk writes to ~20-byte payloads; this is required, not defensive.
- `$PING,*` → `$PONG,*` round trip ≈ 59 ms over BLE.
✅ src: protocol/brx-protocol.md §1, §7a, §7b; mcp/brx_mcp/protocol.py

[callout:tip] **Generation detection heuristic.** Power on the tagger and run a BLE scan. If it advertises the UART service → Gen2/3. If nothing appears on BLE but the device pairs over Bluetooth Classic → Gen1. ✅ src: protocol/brx-protocol.md §1

[diagram DEV-02] Link topology: host ↔ BLE NUS ↔ tagger ↔ (proprietary link) headset; tagger → IR → other tagger; USB console on the side. ✅ src: protocol/brx-protocol.md §1, §7c, §7r

[bit-field] **Frame anatomy** (render as an annotated string, not bits)
`$` + `COMMAND` + (`,` + token)* + `,*`
- ASCII, comma-delimited tokens. Starts with `$COMMAND`, ends with `,*`.
- **Empty tokens are legal and meaningful** — consecutive commas mean "leave unchanged / not applicable". `$SPAWN,,*` (one empty token) is a different command from `$SPAWN,*`.
- Example: `$PING,*` → reply `$PONG,*`.
- Tokens may not contain a comma, `*` or a line break (that is the validator in `protocol.py`: `^\$[A-Z0-9!]+(,[^,*\r\n]*)*,\*$`).
- Notifications can arrive merged (`$ALCD,…$BUT,0,1,*`); split on the next `$` as well as on `*`.
✅ src: protocol/brx-protocol.md §2, §7e; mcp/brx_mcp/protocol.py

[diagram DEV-03] Annotated frame anatomy. ✅ src: protocol/brx-protocol.md §2

[steps] **Waking a gun and holding the link**
1. Connect and subscribe to the TX notify characteristic. Establishing a link succeeds roughly **1 attempt in 3** (the official app behaves the same); retry — that *is* the fix.
2. On a **fresh power-up**, send `$STOP,*` then `$PHONE,*` (after a power-cycle `$PHONE,*` alone wakes it). A just-booted gun ignores a bare `$VERSION,*` until then.
3. `$PHONE,*` opens the **event tap**: the gun says "phone connected", answers `$BUT,3,0,*`, streams button events and `$VOLTS` telemetry, and locks its on-gun menu until a game is configured or it is power-cycled.
4. Idle taggers are **silent**: outside app mode no unsolicited messages are sent — no button, trigger or hit traffic.
5. The official app's connect ritual (captured, fw v4.32) is `$STOP,*` → `$PLAYX,0,*` → `$VOL,69,0,*` → `$PLAY,VA20,3,6,,,,,*` ("connection established"), then once per session `$NAME,<name>,*` + `$VERSION,*`. It never sends `$PHONE,*`.
6. **The headset must be linked** or the gun will connect, answer a quick `$PING`, then drop within seconds and echo nothing to config. After a gun-initiated `$DISCONNECT,*`, back off ≥ 5 s before reconnecting.
✅ src: protocol/brx-protocol.md §7a, §7b, §7m, §7r; docs/gotchas.md

[callout:warn] **The safety model.** Three layers, in order of what they protect: (1) firmware is never written, so **a power-cycle always restores a tagger**; (2) a host should refuse malformed frames and require an explicit confirm for any command outside the **known-safe list** (below); (3) the **panic sequence** `$CLEAR,*` then `$SP,99,*` returns a gun to a sane state. Battle Company's official USB updater is the factory-restore path. ✅ src: README.md "Safety", protocol/brx-protocol.md §8, mcp/brx_mcp/protocol.py

[code python] (copy-to-clipboard)
```python
# The known-safe list enforced by brx-mcp (mcp/brx_mcp/protocol.py).
# Everything else needs confirm=True — that is the host's safety rail, not a tagger limit.
KNOWN_SAFE_COMMANDS = {
    "PING", "CLEAR", "START", "SPAWN", "CONNECT", "INIT", "PHONE",
    "GSET", "PSET", "WEAP", "SIR", "BMAP", "GLED", "PLAY", "AS", "SP",
    "PBWEAP", "PBTEAM", "PBPERK", "TID",
    # sent by the official iOS app during a normal captured game:
    "AMMO", "STOP", "PLAYX", "VOL", "HLED", "NAME", "VERSION", "HLOOP",
    "SFLASH",
}
PANIC_SEQUENCE = ["$CLEAR,*", "$SP,99,*"]
```
✅ src: mcp/brx_mcp/protocol.py

[callout:warn] **Volume.** `$VOL,30` is kind to ears on a bench but **measurably inaudible for weapon and game audio**; `$VOL,45` is barely audible. Use **69** (the iOS app's value) for real play. ✅ src: CLAUDE.md hard rules; protocol/brx-protocol.md §3 (`$VOL`)

[faq]
- **Is the baud rate real over BLE?** No — BLE has no baud. 115200 is the UART behind the radio bridge, which is why BLE and a wire speak identical frames. ✅ src: protocol/brx-protocol.md §7c
- **Why does my client drop at ~6.6 s?** The link *holds* fine once up (80 s+ sessions with the official app, multi-minute sessions with ours). Establishment is intermittent; retry in a loop. If it dies within seconds *and echoes nothing to config*, the headset is not linked. ✅ src: protocol/brx-protocol.md §7b, §7e, §7r
- **Can a command brick the gun?** Nothing in the protocol writes firmware. Every state written over BLE is wiped by a power-cycle (except `$NAME`, which persists). ✅ src: protocol/brx-protocol.md §7r, docs/experiment-log.md (2026-08-24 `$NAME`)

---

### Page: Command reference  (`/manual/dev/commands`)
_Every command we know of — host → tagger, tagger → host, headset — with args, meaning and confidence_

[callout:info] **How to read the tables.** "Direction" is host→gun (`>>`) or gun→host (`<<`). Provenance is per row: ✅ we sent/received it on hardware and know what it did; 🔍 the command class and its field names come from the Callsign app's IL2CPP metadata (names certain, wire position = declaration order); 👥 seen in LaserTagMods sources or community captures, not reproduced by us. Commands the app knows but we have never sent sit in their own table at the end of this page. Where a command's field map has its own page (`$WEAP`, `$GSET`/`$PSET`, `$SIR`) the row links there. ✅ src: protocol/callsign-extract/protocol-classes.md (confidence note), protocol/brx-protocol.md §3–§4

[data-table:filterable] **Host → tagger: lifecycle & configuration**
| Command | Dir | Args | Meaning | Conf |
|---|---|---|---|---|
| `$PING,*` | >> | — | Connectivity check. Reply `$PONG,*`. | ✅ |
| `$STOP,*` | >> | — | Stop. First frame the official app sends on every (re)connect; also part of the end-of-game tail. | ✅ |
| `$PHONE,*` | >> | — | App-controlled mode: opens the live event tap (buttons, `$VOLTS`), locks the on-gun menu. Reply `$BUT,3,0,*`. | ✅ |
| `$CONNECT,*` / `$INIT,*` | >> | — | On the known-safe list. Sent on v4.32: **no observable reply**. | ✅ |
| `$CLEAR,*` | >> | — | Clear current game state. First frame of every arm sequence; half of the panic sequence. | ✅ |
| `$START,*` | >> | — | Begin the configuration sequence. Gun echoes `$LCD,0,0,0,0,0,0,*`. | ✅ |
| `$GSET,…,*` | >> | 8 tokens | Global game settings — friendly fire, indoor/outdoor, region, ambient light, gyro, BT secondaries, crit modifier, mods. **No respawn/time/lives token.** → GSET page | ✅ |
| `$PSET,…,*` | >> | id, 0, HP, armor, shield, 50, , voice-pack… | Player settings: **token 1 = player id (0–63)**, tokens 3–5 = HP/armor/shield pools, then a positional voice pack. → PSET page | ✅ |
| `$WEAP,<slot>,…,*` | >> | slot 0–5 + ~43 tokens | Define a weapon in a slot: damage, fire interval, fire mode, clip/reserve, reload, sounds, IR type. → WEAP page | ✅ |
| `$SIR,<proto>,<subtype>,<sound>,<fn>,p5,p6,p7,p8,*` | >> | 8 tokens | Incoming-IR effects matrix: what an IR word with protocol B / subtype U does to this gun. **Unmatched cells are silently ignored.** → SIR page | ✅ |
| `$BMAP,<button>,<function>,<swap0..3>,*` | >> | button id, function, 4 swap slots | Remap physical controls. Buttons: 0 trigger · 1 alt-fire · 2 reload handle · 3 select · 4 left · 5 right · 8 gyro. Functions seen: 0 fire · 97 reload · 98 (select/left/right) · 100 weapon-cycle · 4 melee (gyro). **Mandatory** — without it the trigger only chirps "disabled". | ✅ |
| `$TID,<team>,*` | >> | team | Team id. **Masked to 2 bits** (`team & 3`) → four native teams 0–3. Drives the gun LED colour at `$SPAWN` (1 = blue, 2 = yellow observed) and is echoed as `$HIR` token 4 on the victim. A live write changes hit resolution immediately but does not repaint LEDs. | ✅ |
| `$SPAWN,,*` | >> | **one empty token** | **Go-live** and **respawn**. Restores HP/armor and (on respawn) ammo; echoes `$LCD,<hp>,<armor>,0,0,<mag>,<reserve>,*`. Also clears the `$SIR` fn-23 state (`$ALCD` token 2 back to 100). `$SPAWN,*` (no empty token) is not the same command. | ✅ |
| `$AMMO,<slot>,<mag>,<reserve>,<flag>,*` | >> | slot, magazine, reserve, 1 | Load magazines. Must follow `$SPAWN` at initial go-live or the gun is live with no ammunition. e.g. `$AMMO,0,36,108,1,*`. A bare `$WEAP` re-push resets ammo to the frame's baked values — re-send `$AMMO` after any weapon swap. | ✅ |
| `$PLAYX,0,*` | >> | 0 | Stop/clear sound playback. Sent right after `$STOP` on connect and just before the go-live cue. | ✅ |
| `$PLAY,<sound>,<vol>,<prio>,<announcer>,,,,*` | >> | 8 tokens | Play a sound id (see the 2166-id bank). **Two independent slots**: token 1 = local/effect sound, **token 4 = announcer/voice channel** — `$PLAY,,4,6,V3A,,,,*` speaks "kill" with token 1 empty; `$PLAY,VSF,4,6,JAY,,,,*` uses both. **Tokens 2–3 are required**: `$PLAY,VA33,,,,,,,*` is silent, `$PLAY,VA33,4,6,,,,,*` speaks. Numeric values vary by client (`3,9` Android app · `3,6` iOS · `4,6` JEDGE). APK field names: soundName, addToQue1, addToQue2, loopingTime, stun, isNeedQueue. | ✅ |
| `$VOL,<0–100>,<n2>,*` | >> | volume, 0 | Master volume. Android app sends `$VOL,100,0,*`; iOS `$VOL,69,0,*`. 30 is inaudible for game audio; use 69. | ✅ |
| `$NAME,<name>,*` | >> | name | Sets the gun's **persistent** name (the USB `Gun Name` field; survives power-cycle). Opening the official app rewrites it to `Tactix2`. | ✅ |
| `$VERSION,*` | >> | — | Query firmware. Reply `$VERSION,v4.32,?,4,,devhost.03,*` — token 2 is the **headset** firmware (`hds.59`) when a headset is linked. | ✅ |
| `$SP,<n>,*` | >> | n | End-of-game / stop. `$SP,99,*` is the second half of the panic sequence. Do not probe it mid-game hoping for a score — the gun keeps none. | 👥 |
| `$QUERY,*` | >> | — | Over BLE returns a `$`-framed status array (`$QUERY,0,0,0,0,0,,1,0,,0,…`) plus a `$LCD`. **Not** the USB device record (that is USB-only — see the Serial console page). | ✅ |
✅ src: protocol/brx-protocol.md §3, §7a, §7e, §7f, §7l, §7o, §7r; docs/gotchas.md; docs/experiment-log.md (2026-08-24 `$QUERY`)

[data-table:filterable] **Host → tagger: in-game effects, feedback & pools**
| Command | Dir | Args | Meaning | Conf |
|---|---|---|---|---|
| `$SFLASH,*` | >> | — | **The shooter's green-sight kill-confirm flash.** The host sends exactly one per kill the holder scores, ~0.4 s after the trigger burst ends. (The APK lists it under notifications; on the wire the phone sends it.) | ✅ |
| `$LIFE,<hp>,<armor>,<shields>,*` | >> | addedHP, addedArmor, addedShields | Grant health. **Additive, clamped at the pool max** — not an absolute set. Writes do not self-emit `$HP`; the new value shows on the next hit/HUD refresh. | 🔍 ✅ |
| `$BUMP,<hp>,<armor>,<shields>,*` | >> | hP, armor, shields | Adjust current pools. Same additive/clamped behaviour as `$LIFE`. | 🔍 ✅ |
| `$BHIT,<damage>,<isCrit>,<powerLevel>,*` | >> | damage, isCriticalShot, powerLevel | Four shapes sent on v4.32: each was echoed and **applied no damage**. | 🔍 (fields) ✅ (bench result) |
| `$HFIRE,…,*` | >> | Range, CountIRPulses, RateOfFire, FlashLED | Five shapes sent on v4.32: **zero IR emitted** (receiver control passing before and after). | 🔍 (fields) ✅ (bench result) |
| `$IRTX,…,*` | >> | iRPower, soundOnHit, rangeOutdoor, rangeIndoor | Five shapes sent on v4.32: **zero IR emitted** (receiver control passing before and after). | 🔍 (fields) ✅ (bench result) |
| `$MELEE,<intensity>,*` | >> | intensity | `$MELEE,255,*` returns `$BUT,4,0,*` and fires no IR. | 🔍 ✅(no-op) |
| `$STUN,*` | >> | — | Listed in the APK. **Proven no-op over BLE.** | 🔍 ✅(no-op) |
| `$GLED,<mid>,<effect>,<optionA>,<optionB>,…,*` | >> | mid, effect, optionA, optionB | Gun LED **effect** — `effect` = LedEffect enum (Solid, Glow, ChaseBack, ChaseForward, StopIR). **Not RGB**: colour is team-derived from `$TID`. Used by the app during the pre-game lobby. | 🔍 ✅(not RGB) |
| `$GREN,…,*` | >> | iRType, crit, modifier, indoorMode, operationMode, channel, GrenadeType, MaxCount | Smart Grenade configuration frame, addressed to the **gun**. GrenadeMode enum: FlashBang / Gas / Confusion / Molotov. Sent on the bench: the gun emitted IR, but the emitted bits did not track the arguments. | 🔍 (fields) ✅ (bench result) |
| `$PBGAME,$PBTEAM,$PBWEAP,$PBPERK,$PBLIVES,$PBTIME,$PBSPAWN,$PBINDOOR,$PBLOCK,$PBSTART` | >> | enum index | The **"playbook"** pre-battle family mirroring the on-gun menu — a second remote-start path captured on fw **v4.30** (`$PBGAME,0` = FFA · `$PBWEAP,0` = M4 AUTO · `$PBPERK,2` = Body Armor · `$PBLIVES,2` = 5 lives · `$PBTIME,5` = infinite). `$PBWEAP,0,*` produced a "game starting" reload sound on our v4.32. | 👥 |
| `$DD,<killerId>,<killerTeam>,<victimId>,<nonce>,*` | host↔host | — | JEDGE's **device-to-device** kill notification. A host-side convention, not a tagger command. | 👥 |
✅ src: protocol/brx-protocol.md §3, §7d, §7i, §7j(community `$PB*`), §7o; protocol/callsign-extract/protocol-classes.md; docs/experiment-log.md (2026-08-26 headset emission, `$BHIT`, `$GREN` emission)

[data-table:filterable] **Headset commands (host → gun → headset)**
| Command | Args (APK) | Meaning | Conf |
|---|---|---|---|
| `$HLED,,6,,,,,*` | LedColorType (White, Pink, Orange; + green via `isUsedGreenLed`), BlinkLoopType (Once, ThreeTimes, Infinite), LedEffectType (incl. Heartbeat) | Headset LED. Exactly this frame is sent in the app's end-of-game tail and in the lobby. | ✅(captured) 🔍(fields) |
| `$HLOOP,0,0,*` | a, b | Sent by the app ~1.7 s after every death. | ✅(captured) 🔍(fields) |
✅ src: protocol/brx-protocol.md §3, §7e, §7f; protocol/callsign-extract/protocol-classes.md (Enums)

[data-table:filterable] **Tagger → host: events and echoes**
| Message | Fields | Meaning | Conf |
|---|---|---|---|
| `$PONG,*` | — | Reply to `$PING`. | ✅ |
| `$VERSION,<gun fw>,<headset fw>,<n>,,<host image>,*` | e.g. `v4.32,?,4,,devhost.03` | Version reply; token 2 reads `hds.59` with a headset linked, `?` otherwise. `devhost.*` = developer/host image. | ✅ |
| `$DISCONNECT,*` | — | Gun-initiated disconnect notice (e.g. the moment its headset is switched off). | ✅ |
| `$VOLTS,<pack_mV>,<cell_mV>,<t3>,<t4>,*` | e.g. `7662,3921,55,70` | Battery telemetry, ~every 30 s in app mode. Token 1 = pack millivolts (7.662 V), token 2 = cell millivolts (3.921 V). Tokens 3–4: — (unknown). | ✅ |
| `$LCD,<hp>,<armor>,<t3>,<t4>,<mag>,<reserve>,*` | e.g. `45,70,0,0,36,216` | **Health/armor HUD echo.** `$START` → all zeros; `$SPAWN` → pools + current weapon's ammo; death → `$LCD,0,0,0,1,1,1,*`. Tokens 3–4: — (unknown). A zeroed `$LCD` after `$SPAWN` means "no config loaded" (post power-cycle tell). | ✅ |
| `$ALCD,<mag>,<t2>,<slot>,<reserve>,<heat>,*` | e.g. `36,100,0,108,0` | **Ammo/weapon HUD stream.** Per-round during fire *and* reload (mag 0→1→2… as reserve drains). Token 2: — (unknown) — reads 100 in normal play and drops to 0 after a `$SIR` fn 23 hit. Token 3 = weapon slot. Token 5 = **weapon heat** (0–100+, only on overheat weapons). Only streams on ammo events — silence is not "no change". | ✅ |
| `$HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,*` | e.g. `4,0,19,2,9,0,3` | **Hit received.** → Events page for the full decode. | ✅ |
| `$HP,<hp>,<armor>,<shield>,*` | e.g. `43,0,0` | Pools after a hit; arrives in the same millisecond as its `$HIR`. `$HP,0,0,0` = death. | ✅ |
| `$BUT,<id>,<state>,*` | id 0–5, state 1 press / 0 release | Physical button event (ids match `$BMAP`). Streams only in app mode. `$BUT,4,0` is also returned by `$MELEE`. | ✅ |
| `$QUERY,…` | ~11 `value,,` pairs | Status array in reply to BLE `$QUERY,*`. | ✅ |
| `$WEAP` / `$PERK` / `$HS` | — | Selection echoes from the on-gun menus (LaserTagMods). | 👥 |
✅ src: protocol/brx-protocol.md §4, §7e, §7f, §7j, §7r; mcp/brx_mcp/protocol.py (parsers); docs/experiment-log.md 2026-08-27

[data-table:filterable] **Seen in the app's vocabulary, not exercised by us** — facts about the Callsign app's request namespace only; on-tagger behaviour has not been observed. 🔍
| Command | Direction | APK fields / enums | Note |
|---|---|---|---|
| `$VIB` | >> | `isEnableVibration` | Never sent by us. |
| `$ZOOM` | >> | — | Never sent by us. |
| `$FSET` | >> | ~38 event→sound slots: ActionKey, DeathAlarm, TickTock, HitHp, HitArmor, HitShield, HitCrit, EmpStart/Loop/End, IncendiaryStart/…, TearGasHit, … | Never sent by us. |
| `$ASSIST` | >> | `soundName` (+ SetVolume) | Never sent by us. |
| `$DLC` / `$ASKDLC` → `$GOTDLC` | >> / << | `hiddenFeatures` | The app's premium-content (BattleCoins) handshake. The metadata names three premium modes: Generals, Commanders, Swarm. Never sent by us. |
| `$BLINK` · `$CHASE` · `$LED` | >> (headset) | — | Listed with the headset commands. Never sent by us. |
| `$TIME` | << | — | Listed as a notification. Never observed on the wire. |
🔍 src: protocol/callsign-extract/protocol-classes.md

[callout:tip] **Complete vocabulary from the app's own request namespace** (🔍): AMMO ASKDLC ASSIST BHIT BMAP BUMP CLEAR DLC FSET GLED GREN GSET HFIRE IRTX LIFE MELEE NAME PLAY PLAYX PSET SIR SPAWN START STOP STUN VERSION VIB VOL WEAP ZOOM · headset BLINK CHASE HLED HLOOP LED · notifications ALCD BUT GOTDLC HIR HP LCD SFLASH TIME VERSION VOLTS. `$PING`, `$TID`, `$SP`, and the `$RV/$RP/$UR/$KK/$DD` family are **not** in it — they come from LaserTagMods and our bench. Absence from the app ≠ non-existent. 🔍 src: protocol/callsign-extract/protocol-classes.md

---

### Page: The arm sequence — from `$CLEAR` to a live gun  (`/manual/dev/arm-sequence`)
_The exact frame order that takes a tagger live, respawns it, and ends the game — captured from the official app and reproduced by our host_

[callout:info] This sequence was captured from the official iOS app driving a live game on firmware v4.32, then reproduced byte-for-byte by our own host on real taggers. Three pieces were missing from every earlier attempt: **`$AMMO` after spawn**, **`$BMAP` before *and* after spawn**, and the **empty token in `$SPAWN,,*`**. ✅ src: protocol/brx-protocol.md §7e, §7o; protocol/captures/2026-08-23-ios-callsign-game-start.txt

[code text] (copy-to-clipboard)
```text
$CLEAR,*
$START,*
$GSET,1,0,1,0,1,0,50,1,*
$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*
$WEAP,0,...                (primary)
$WEAP,1,...                (secondary)
$WEAP,4,...                (melee — always sent)
$SIR,... x10               (incoming-IR effects table)
$BMAP,0,0,,,,,*   $BMAP,1,100,0,1,99,99,*   $BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*  $BMAP,4,98,,,,,*          $BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$TID,<team>,*              (ours; the app relies on defaults)
$PLAYX,0,*
$PLAY,VA81,4,6,,,,,*       (go-live voice cue)
$SPAWN,,*                  <-- go-live (note the empty token)
$AMMO,0,36,108,1,*         <-- load magazines
$AMMO,1,6,12,1,*
$BMAP,0,0,,,,,*            <-- trigger re-mapped AFTER spawn
```
✅ src: protocol/brx-protocol.md §7e, §7k

[diagram DEV-04] Sequence diagram: host → gun frames above, with the gun's echoes (`$LCD,0,0,0,0,0,0` after `$START`; `$LCD,45,70,0,0,36,216` after `$SPAWN`; `$ALCD` per shot; `$BUT` per trigger). ✅ src: protocol/brx-protocol.md §7e

[table] **What the gun echoes back**
| After | Echo | Meaning |
|---|---|---|
| `$START,*` | `$LCD,0,0,0,0,0,0,*` | Cleared state |
| `$SPAWN,,*` | `$LCD,45,70,0,0,36,216,*` | Live: HP 45, armor 70, mag 36, reserve 216 (this config) |
| each shot | `$ALCD,35,100,0,108,0,*` … | Mag decrementing, slot 0, reserve, heat |
| each trigger | `$BUT,0,1,*` / `$BUT,0,0,*` | Press / release |
| ~30 s | `$VOLTS,7634,3770,53,45,*` | Telemetry continues in-game |
✅ src: protocol/brx-protocol.md §7e

[callout:warn] **The config head is silent and safe.** Writing `$CLEAR … $TID` without `$SPAWN` plays nothing and **a configured-but-unspawned gun ignores IR** — no `$HIR`, no `$HP`. "Get some" and the cocking sound belong to `$SPAWN`. A head held unspawned for ~2 minutes then spawned went live with config intact. ✅ src: protocol/brx-protocol.md §7r

[steps] **Death and respawn are host-driven**
1. Victim reports `$HP,0,0,0,*` then `$LCD,0,0,0,1,1,1,*`. The gun does **not** revive itself, and a dead gun's trigger produces `$BUT` events but no `$ALCD` decrement (it cannot fire).
2. The app sends `$HLOOP,0,0,*` ~1.7 s after death.
3. After the game's respawn delay (the app's own timer — ~10 s in the capture; 👥 community: a per-death ramp capping at 45/90 s) the host sends `$SPAWN,,*`.
4. Gun echoes `$LCD,45,70,0,0,36,216,*` — HP, armor **and ammo** restored with no `$AMMO` needed.
5. **A dead gun ignores all incoming IR** — 448 distinct words, including every grenade-beacon shape, failed to revive one. Only the host can.
✅ src: protocol/brx-protocol.md §7f, §7j(community ramp), §7q; docs/experiment-log.md (2026-08-26 448-word brute force)

[callout:warn] **After a BLE drop, re-send the whole head.** Re-sending the full sequence (`$CLEAR`→`$START`→…→`$SPAWN,,*`→`$AMMO`) on a fresh link brought a gun back in every bench case. ✅ src: protocol/brx-protocol.md §7r and §7r addendum

[code text] (copy-to-clipboard)
```text
# Clean end-of-game, as the official app does it (note the ~3.9 s settle before the last $PLAY):
$VOL,69,0,*
$HLED,,6,,,,,*
$STOP,*
$CLEAR,*
$PLAY,VSF,4,6,JAY,,,,*     # victory sting (slot 1) + "victory" announcer (slot 4); solo game: $PLAY,VS6,4,6,,,,,*
```
✅ src: protocol/brx-protocol.md §7e, §7n, §7o

[faq]
- **Do I need the reload-handle pull?** No. The manual's reload-handle pull is the *local* start; `$SPAWN,,*` is the *remote* one. Both exist. ✅ src: protocol/brx-protocol.md §7e
- **Where do respawn time, game time, lives and score-to-win go?** Nowhere on the gun. Three captures at respawn 5/15/30 s gave byte-identical `$GSET`/`$PSET`. Your host keeps the clock. ✅ src: protocol/brx-protocol.md §7n
- **Is the second `$BMAP,0,0` (after `$SPAWN`) needed?** Yes — omit it and the trigger is dead. ✅ src: protocol/brx-protocol.md §7e, §7r addendum

---

### Page: `$WEAP` — the weapon definition  (`/manual/dev/weap`)
_Forty-odd comma-separated tokens that make a weapon out of data: damage, cadence, fire mode, ammo, sounds, IR type_

[callout:info] **A weapon is data, not firmware.** The gun has no weapons baked in; the host sends a full `$WEAP` frame into one of **six slots (0–5)**. The field *names* come from the Callsign app's metadata (declaration order = wire order); the *positions and meanings* below were then pinned by capturing twenty stock weapons with the operator naming each one, and by flipping single tokens on a live gun. 🔍 ✅ src: protocol/callsign-extract/protocol-classes.md (WEAP), protocol/brx-protocol.md §6, §6.1

[code text] (copy-to-clipboard)
```text
# Two known-good frames (slot 0 Assault Rifle, slot 1 Charge Rifle):
$WEAP,0,,100,0,0,24,0,,,,,,,,100,850,32,32768,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,9999999,75,,*
$WEAP,1,,100,8,0,150,0,,,,,,,,1250,850,100,32768,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,C19,C04,20,150,100,9999999,75,,*
# A captured Shotgun (slot 1) — the only stock weapon with the extra-headset block populated:
$WEAP,1,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*
```
✅ src: protocol/brx-protocol.md §6; mcp/brx_mcp/__main__.py (captured frames)

[diagram DEV-05] Token ruler t0–t42 colour-coded by block: identity · damage/IR · secondary (dormant) · extra-headset · cadence/ammo · fire mode/overheat · sounds · tail. ✅ src: table below

[data-table:filterable] **Token map (0-indexed: `$WEAP,<t0>,<t1>,…,*`; the slot is t0)**
| tok | Field | AR | Charge Rifle | Meaning | Conf |
|---|---|---|---|---|---|
| 0 | slot | 0 | 1 | Weapon slot 0–5. Slot 4 = melee by convention (gyro swing, `$BMAP,8,4`). | ✅ |
| 1 | slotType / mode flag | — | — | `2` on exactly the three weapons carrying an extra-headset payload (t12/t13/t42 populated); `1` on melee; `0` rail gun; empty otherwise. Not fire mode. | ✅ |
| 2 | — | 100 | 100 | — (unknown) | — |
| 3 | primaryDamageType | 0 | 8 | **The IR word's B field / `$SIR` protocol key.** Writing a type here is echoed by the victim in `$HIR` token 2 and selects its `$SIR` row. DamageType enum: 0 Standard · 1 MedicHeal · 2 ActivateShield · 3 RallyPulse · 4 Radiation · 5 Cryogenic · 6 ArmorPiercing · 7 EMP · 8 Shrapnel · 9 StickyBomb · 10 StandardLethalExplosive · 11 NonLethalExplosive · 12 ShottyPellets · 13 MeleeDamage · 14 Plasma. Stock: 8 charge, 10 rocket, 11 gas, 13 melee. | ✅ (position) 🔍 (enum names) |
| 4 | primaryPowerType | 0 | 0 | IRSource enum: DeviceCommand, IRSource, GunLaser, HeadSetOnly, GunAndHead, DoubleGun, DoubleGunAndHead, DRY_FIRE, MuzzleFlash, MuzOnly, VibOnly, MuzAndVib. Order relative to t3 was settled by t3 behaving as damageType. | 🔍 |
| 5 | primaryDamage | 24 | 150 | **The raw magnitude put in the IR word** (= `$HIR` token 5). Applied damage depends on the victim's `$SIR` row. The stock AR actually emits 9; the sample's 24 is the manual's stale anchor. | ✅ |
| 6 | primaryCriticalChance | 0 | 0 | Crit chance. 0 on every stock weapon; the IR crit bit *can* be set (×1.5). | 🔍 |
| 7–11 | secondaryFireChance, secondaryDamageType, secondaryPowerType, secondaryDamage, secondaryCriticalChance | — | — | **Dormant**: empty on all 20 stock weapons. No stock BRX weapon has a secondary fire mode. | 🔍 |
| 12 | extraHeadsetDamage | — | — | Populated with t1=2: Shotgun 70, Rocket 115, Plasma Sniper 80. | ✅ (correlation) |
| 13 | extraHeadsetRangeOutdoor | — | — | 80 on the same three weapons. | ✅ (correlation) |
| 14 | **fire interval / charge time (ms)** | 100 | 1250 | **Proven by one-field flip**: a sniper with t14=1250 fired exactly one shot per second. Stock cadences: burst 75 · SMG 90 · AR 100 · sniper 300 · AMR 360 · launcher 360 · shotgun 900 · melee 1000 · rail gun 1200 · charge rifle 1250. For charge weapons this is the hold time. | ✅ |
| 15 | — | 850 | 850 | — (unknown) | — |
| 16 | maxClip | 32 | 100 | Magazine size. | ✅ |
| 17 | maxAmmo | 32768 | 32768 | Always `2 × t40` in captured frames (or 32768 as an unlimited flag). Not an independent knob. | ✅ (correlation) |
| 18 | reloadSpeed (ms) | 1400 | 2500 | Reload time. | 🔍 |
| 19 | — | 0 | 0 | — (unknown) | — |
| 20 | **fire mode** | 0 | 14 | **Proven by one-field flip**: `0` full-auto · `7` single-shot/bolt · `9` burst (cycle in t23) · `2` charge, auto-release (tap = weak shot) · `3` hold-to-charge, auto-fire (tap = sound only) · `14` tap-fire OR charge-release · `13` melee. | ✅ |
| 21 | maxAccuracy | 100 | 100 | | 🔍 |
| 22 | singleShotAccuracy | 100 | 100 | | 🔍 |
| 23 | burstWeaponTime (ms) | — | — | Burst cycle: 275 Burst Rifle, 250 Force Rifle, empty on everything else. | ✅ |
| 24 | overheat (heat per shot) | 0 | 14 | SMG 5 · Energy Rifle 6 · Charge Rifle 14 · Plasma Sniper 30. **Inert unless t37/t38 are set.** | ✅ |
| 25 | — | — | — | — (unknown) | — |
| 26 | — | — | — | — (unknown) | — |
| 27 | primaryFire_SoundName | R01 | E03 | Fire sound id. **A sound, not an identity** — Rocket Launcher and Rail Gun both fire `C03` with different stat lines. | ✅ |
| 28 | extra action sound A | — | C15 | Engage sound. `C…` ids = charge (rail gun C08, laser cannon C11, charge rifle C15); `D…` ids = extra reload parts on five-part reloads (sniper/AMR/force rifle D20, ion sniper D32). | ✅ |
| 29 | extra action sound B | — | C17 | Release sound. Present exactly when the weapon has a distinct release event (charge rifle C17, bolt weapons D19/D31); absent on auto-firing chargers. | ✅ |
| 30 | secondary_Mix_SoundName | — | — | | 🔍 |
| 31 | reloadPart1_SoundName | D04 | D30 | | ✅ |
| 32 | reloadPart2_SoundName | D03 | D29 | | ✅ |
| 33 | reloadPart3_SoundName | D02 | D37 | | ✅ |
| 34 | noAmmo_SoundName | D18 | A73 | | 🔍 |
| 35 | weaponFeatureA | — | C19 | **Overheat sound** (SMG D11, CR C19, Plasma Sniper/Energy Rifle D122). | ✅ |
| 36 | weaponFeatureB | — | C04 | Second feature sound. | 🔍 |
| 37 | overheat param A | — | 20 | **Gate for the overheat system** (with t38): transplanting `20,150` onto the SMG brought its dead heat gauge alive and the trigger locked at the top. | ✅ (gate) |
| 38 | overheat param B | — | 150 | See t37. | ✅ (gate) |
| 39 | clipStartingAmmo | 32 | 100 | Equals t16 in every captured frame. | ✅ (correlation) |
| 40 | ammoReserv | 9999999 | 9999999 | Reserve; 9999999 = unlimited. `t17 == 2 × t40` in stock frames. | 🔍 |
| 41 | — | 75 | 75 | — (unknown) | — |
| 42 | extraHeadsetRangeIndoor | — | — | 30/30/40 on the three t1=2 weapons. | ✅ (correlation) |
🔍 ✅ src: protocol/callsign-extract/protocol-classes.md (WEAP exact token positions + cap14–cap24 sections), protocol/brx-protocol.md §6.1 and the t20 / overheat sections, docs/experiment-log.md (2026-08-26 `$WEAP` token probes; charge modes; overheat solved)

[callout:warn] **Two positions that bit us.** (1) The metadata's field order has `rateOfFire` before `weaponSwapDelay`; the wire has the *rate* at **t14** and the constant 850 at t15 — a compiler that trusted the field order shipped every weapon at 10 shots/s. (2) Keying weapons by their fire sound (t27) silently merges distinct weapons. ✅ src: protocol/brx-protocol.md §6.1; protocol/callsign-extract/protocol-classes.md (cap17, cap18)

[table] **Stock weapon signatures** (fire sound → weapon → behaviour, as named by the operator at capture)
| t27 | Weapon | Fire mode / notes |
|---|---|---|
| `R01` | Assault Rifle | full auto |
| `R18` | Burst Rifle | 3-round burst (t20=9, t23=275) |
| `R23` | Force Rifle | 3-round burst (t23=250), five-part reload |
| `R12` | Bolt Rifle | single shot; carries no t28/t29 |
| `G03` | SMG | full auto, overheat mechanic (t24=5) |
| `Q06` | Suppressor | full auto, quiet, no muzzle flash (t25=2, t26=50) |
| `E11` | Stinger | full auto |
| `E12` | Energy Rifle | full auto, overheat (t24=6), 300-round clip |
| `S16` | Sniper | single shot, bolt action (t28/t29 = D20/D19) |
| `S07` | AMR | single shot, same bolt pair |
| `E07` | Ion Sniper | single shot, 2-round clip (D32/D31) |
| `E17` | Plasma Sniper | single shot, overheat (t24=30), shell reload |
| `T01` | Shotgun | single shot (t20=7), t19=2, extra-headset block, magnitude 45 |
| `J15` | Energy Launcher | clip 1 / reserve 3 |
| `C03` | Rail Gun | charges on hold, auto-fires ~1.2 s (t20=2, t28=C08) |
| `C03` | Rocket Launcher | single shot, protocol 10, magnitude 115 |
| `C06` | Laser Cannon | must be held (t20=3, t28=C11) |
| `E03` | Charge Rifle | hold, fires on release; overheats (t20=14) |
| `M92` | Melee | gyro swing, protocol 13, magnitude 90 |
✅ src: protocol/callsign-extract/protocol-classes.md (weapon signatures, cap14–cap22); docs/experiment-log.md (2026-08-26 melee capture, damage bench)

[callout:tip] **Overheat is a balance lever on any weapon.** Set t24 (heat per shot) + t35 (overheat sound) + t37/t38 (enable/params, stock `20,150`), and the live heat gauge streams in `$ALCD` token 5 — climbing ~8/shot on the Charge Rifle, crossing 100 into lockout and decaying on idle. A HUD heat bar needs no new protocol. ✅ src: protocol/brx-protocol.md §7j, overheat section; docs/experiment-log.md (overheat mechanism solved)

[faq]
- **Can I build a semi-auto rifle?** Yes — t20=7 is single-shot per pull. (An earlier note that semi-auto "may not exist" predates the t20 proof.) ✅ src: protocol/brx-protocol.md t20 section
- **What bounds a custom weapon?** The firmware's behaviour vocabulary: the DamageType and PowerType enums, ReloadType, six slots, and the 2166 sound ids. Any *combination* with arbitrary numbers is buildable; a brand-new damage *behaviour* is not. 🔍 src: protocol/callsign-extract/protocol-classes.md ("What's moddable")
- **Does a `$WEAP` re-push mid-game keep the ammo count?** No — it resets mag/reserve to the frame's values. Re-send `$AMMO`. ✅ src: docs/gotchas.md

---

### Page: `$GSET` and `$PSET` — game and player settings  (`/manual/dev/gset-pset`)
_The two frames that set on-gun rules and the player's pools, identity and voice pack_

[table] **`$GSET,<t1>,…,<t8>,*` — validated against the captured `$GSET,0,0,1,0,1,0,50,1,*`**
| # | Field | Captured | Meaning | Conf |
|---|---|---|---|---|
| 1 | friendlyFire | 0 / 1 | **Firmware-enforced, both directions.** 0 blocks same-team damage *and* heals from enemies; 1 opens the gate. Replicated 2× with alternating values plus control. | ✅ |
| 2 | outdoorMode | 0 | APK field name; not exercised on the bench. | 🔍 |
| 3 | gunLaserRegion | 1 | APK field name; not exercised on the bench. | 🔍 |
| 4 | autoAmbientLight | 0 | APK field name; not exercised on the bench. | 🔍 |
| 5 | gyroscope | 1 | APK field name; not exercised on the bench. | 🔍 |
| 6 | secondaryBluetoothWeapons | 0 | APK field name; not exercised on the bench. | 🔍 |
| 7 | criticalShotModifier | 50 | APK field name. **Not** score-to-win (byte-identical across captures with different win conditions). | 🔍 ✅ |
| 8 | gameMods | 1 | APK field name; not exercised on the bench. | 🔍 |
✅ 🔍 src: protocol/callsign-extract/protocol-classes.md (GSET), protocol/brx-protocol.md §3, §7n; docs/experiment-log.md (FF enforcement table)

[callout:info] **There is no respawn, time, lives or score token.** Three captures at respawn 5/15/30 s and different clocks produced byte-identical `$GSET` and `$PSET`, and the 8-field map from the app metadata contains none of them. Those live in the host. Stop looking. ✅ src: protocol/brx-protocol.md §7n

[table] **`$PSET,<t1>,…,*` — sample `$PSET,6,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*`**
| tok | Field | Sample | Meaning | Conf |
|---|---|---|---|---|
| 1 | **player id** | 6 | **0-based, 0–63 (6 bits)** — the app's UI shows 1–64 and writes id−1 (app 7 → wire 6, app 64 → 63, an out-of-range 69 clamps to 63). Ends up in every IR shot's P field and comes back as `$HIR` token 3 on whoever you hit. | ✅ |
| 2 | — | 0 | 0 in every capture; 0/1/7 gave byte-identical behaviour. Inert. | ✅ |
| 3 | HP | 45 | Starting/max HP. Echoed as `$LCD` token 1 after `$SPAWN`. | ✅ |
| 4 | armor | 70 | Armor pool (`$LCD` token 2, `$HP` token 2). | ✅ |
| 5 | shield | 70 | Shield **maximum**. The pool starts at 0 and only fills via an IR `$SIR` grant function — it is not BLE-writable as a value. | ✅ |
| 6 | — | 50 | — (unknown) | — |
| 7 | (empty) | — | | — |
| 8+ | **positional voice pack** | H44 JAD V33 V3I V3C V3G V3E V37 H06 H55 H13 H21 H02 U15 W71 A10 | Sixteen sound ids on the wire. The app's metadata declares these voice-pack fields: deathAlarm, stealthDeathScream, musicMixOnDeath, deathScream, battleRespawnCry, meleeGrunt, shortPain, longPain, painRelief, missShothit, hitHp, hitArrmor, hitShield, hitCrit, emptyUnboundButtonSound, ammoOrGearPickUp, energyShieldLoop. Which wire slot carries which name: — (unknown). | 🔍 |
✅ 🔍 src: protocol/brx-protocol.md §3, §7e, §7p, §7r; protocol/callsign-extract/protocol-classes.md (PSET); mcp/brx_mcp/gameconfig.py; docs/unknowns.md (A10b′, P3)

[callout:tip] **Numbering a fleet is one token.** Give every gun a distinct `$PSET` token 1 at arm time and per-player kill attribution is BLE-native — no cable, no IR receiver. Show operators 1-based ids; write `id − 1`. ✅ src: protocol/brx-protocol.md §7p, §7q

---

### Page: `$SIR` — the incoming-IR effects matrix  (`/manual/dev/sir`)
_What an IR hit does to this gun is decided by the victim's table, not by the shooter's weapon_

[callout:info] **The key idea.** An incoming IR word carries a 4-bit protocol (B) and a 2-bit subtype (U). The victim looks up the `$SIR` row with that `<protocol, subtype>` key; the row's **function** decides what the word's 8-bit magnitude is applied to — damage, heal, armor, shield, or a status. **No matching row → the hit is silently ignored.** 16 × 4 = 64 addressable cells, all writable per game over BLE. ✅ src: protocol/brx-protocol.md §5; protocol/brx-ir-protocol.md

[spec-sheet] **Format:** `$SIR,<irProtocol>,<subtype>,<soundID>,<function>,<p5>,<p6>,<p7>,<p8>,*`
- `<soundID>` plays **on the victim** when the row fires (`VA16` "armor suit", `VA8C` "shields online", `H29` stim-pack).
- `<p5>–<p8>` do **not** scale damage (`0,0,1`, `0,50,1`, `0,100,2,60`, `0,200,2,60`, `50,100,2,60` all landed exactly the magnitude).
- Max distinct IR recognitions per game: 14 (community figure).
✅ 👥 src: protocol/brx-protocol.md §5; docs/experiment-log.md (clean negatives)

[code text] (copy-to-clipboard)
```text
# The stock 10-row table the official app sends (Team Arena):
$SIR,0,0,,1,0,0,1,,*        standard weapons (AR, SMG, snipers, shotgun…) — plain damage
$SIR,0,1,,36,0,0,1,,*       Force Rifle / Sniper Rifle — ×1.25 damage
$SIR,0,3,,37,0,0,1,,*       AMR / Bolt Rifle / Burst Rifle — ×2 damage
$SIR,1,0,H29,10,0,0,1,,*    respawn + add HP
$SIR,2,1,VA8C,11,0,0,1,,*   add shields
$SIR,3,0,VA16,13,0,0,1,,*   add armor
$SIR,6,0,H02,1,0,90,1,40,*  Rail Gun
$SIR,8,0,,38,0,0,1,,*       Charge Rifle
$SIR,9,3,,24,10,0,,,*       Energy Launcher (fn 24 is a no-pool status — deals zero damage as shipped)
$SIR,10,0,X13,1,0,100,2,60,* Rocket Launcher
$SIR,11,0,VA2,28,0,0,1,,*   Tear gas
$SIR,13,0,H50,… / 13,1,H57 / 13,3,H49   Energy Blade / Rifle Bash / War Hammer (melee)
```
✅ src: protocol/brx-protocol.md §5; docs/experiment-log.md (shipped-table consequence)

[data-table:filterable] **Function map (measured at magnitude 20 on protocol 5, baseline HP 45 / armor 70 / shield 0)**
| Class | Function ids | Measured behaviour | Polarity | Conf |
|---|---|---|---|---|
| Standard damage | 1, 4, 5, 7, 29, 30, 33, 38 | −20 per hit, drains shields → armor → HP | enemy only | ✅ |
| **Armor-piercing** | 2, 6 (+17, 21 enemy-side) | HP 45→25→5 with armor **and shields** untouched | enemy only | ✅ |
| ×1.25 damage | 36 | magnitude 20 lands as 25 | enemy only | ✅ |
| ×2 damage | 37 | magnitude 20 lands as 40 | enemy only | ✅ |
| Add HP, overflow → armor | 9, 12, 16, 19 | 15→35→45, then +armor | ally only (16/19 also damage enemies) | ✅ |
| Add HP, clamp | 10, 17 | 15→35→45, no overflow | ally only (17 also AP-damages enemies) | ✅ |
| Add HP, overflow → shield | 14, 21 | 15→35→45, then +shield | ally only | ✅ |
| Add armor | 13, 15, 20, 22 | 0→20→40; overflow spills to shields | ally only (20 also strips enemy armor) | ✅ |
| Add shield | 11, 18 | 0→20→40 | ally only | ✅ |
| **`$ALCD` token-2 drop** | 23 | Registers a hit, no pool change; `$ALCD` token 2 drops 100→0 and recovers over ~6–8 s while the gun keeps firing. The state clears on `$SPAWN,,*`. | enemy | ✅ |
| Registers, no pool change | enemy 3, 8, 24, 25, 26, 27, 28, 35 · ally 31, 32, 34 | `$HIR` fires, pools unchanged, no other frame. | — | ✅ |
| No registration | 0, 39–45 (and 28/45 on protocol 5) | — | — | ✅ |
✅ src: docs/experiment-log.md (2026-08-26 complete two-sided `$SIR` map; 2026-08-27 fn 23)

[callout:warn] **Support functions are team-gated in firmware.** With `$GSET` friendlyFire = 0, heals/armor/shield grants register **only from a same-team source**, and damage registers only from another team. Set friendlyFire = 1 and everything lands from anyone. A medic gun enforces "allies only" with zero host logic. ✅ src: protocol/brx-protocol.md §5; docs/experiment-log.md (dual-polarity, FF table)

[diagram DEV-07] Damage pipeline: IR word (B,U,D,C) → victim `$SIR[B,U]` → function multiplier → ×1.5 if crit → drain shields → armor → HP → emit `$HIR` + `$HP`. ✅ src: below

[stat-row]
- **applied = magnitude × fn multiplier × (1.5 if crit)** — fn 1 ×1 · fn 36 ×1.25 · fn 37 ×2; crit stacks (fn 37 + crit = ×3). ✅
- **Drain order: shields → armor → HP.** Armor absorbs 1:1 with no per-hit cap; overflow spills into HP (a sniper's 80 split exactly 70/10). ✅
- **Heals clamp** at the pool max — magnitude 200 is a fill, not a stack. ✅
- **No function is a damage-over-time.** 18 s watched after each status hit: no ticks. ✅
- **Dead guns accept no IR at all.** ✅
src: protocol/brx-protocol.md §7r addendum; docs/experiment-log.md (tok5 raw magnitude, AP, heals clamp, DoT negative, 448-word brute force)

[faq]
- **Is there a stun?** None found. `$STUN` over BLE is a no-op, and fn 23 — the only function that visibly changes anything without touching a pool — leaves the gun firing. ✅ src: docs/experiment-log.md (2026-08-27)
- **Can I read a native game's `$SIR` table?** No — the gun never reports it. Capturing an ability's IR word tells you its protocol, not what a native victim binds to it. ✅ src: docs/experiment-log.md (2026-08-27 reframe)
- **Which protocols are free?** Stock uses 0, 8, 10, 11, 13 and 15 (grenade beacon); the app's table also ships rows on 1, 2, 3, 6, 9. Truly unused: 4, 5, 7, 12, 14 — but every cell is re-definable per game since you push the table. ✅ src: protocol/brx-ir-protocol.md

---

### Page: Events — what the gun tells you  (`/manual/dev/events`)
_Hits, health, HUD echoes, buttons and telemetry — and the proof that the gun keeps no game state_

[bit-field] **`$HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,*`** (render as labelled token boxes)
| tok | Field | Values | Notes | Conf |
|---|---|---|---|---|
| 1 | sensor that caught the IR | 0 headset **front** dome · 1 headset **back** dome · 4 gun body | Isolated with every other sensor covered. Trust for directional logic **only at field distance** — point-blank floods every receiver and the first to decode reports. | ✅ |
| 2 | shooter's IR protocol | 0 standard · 10 rocket · 13 melee … | = the shooter's `$WEAP` t3 / IR word B field. | ✅ |
| 3 | **shooter player id** | 0–63 | = the shooter's `$PSET` token 1. 32/32 hits both directions on two guns with distinct ids. | ✅ |
| 4 | **shooter team** | 0–3 | = the shooter's effective `$TID & 3`. | ✅ |
| 5 | raw magnitude | e.g. 9, 45, 80, 115 | The IR word's D field (= shooter's t5). **Not the applied damage** where a multiplier row or crit is in play — derive damage from the `$HP` delta. On a killing blow it can report the victim's remaining pool instead (overkill clamp). | ✅ |
| 6 | crit flag | 0/1 | Echoes the IR word's C bit. 0 on every stock weapon. | ✅ |
| 7 | subtype | 0–3 | Echoes the IR word's U field (sniper = 1). | ✅ |
✅ src: protocol/brx-protocol.md §4, §7k, §7q, §7r, §7r addendum, tok1 sensor-map section; protocol/brx-ir-protocol.md

[callout:info] **Not every `$HIR` is damage.** Pickups, heals and status effects arrive on the same message type — the protocol/subtype tells you which row fired. ✅ src: protocol/brx-protocol.md §7k

[table] **The other events**
| Message | Decode | Conf |
|---|---|---|
| `$HP,<hp>,<armor>,<shield>,*` | Pools after the hit; same millisecond as its `$HIR`. `$HP,0,0,0` = death. Example run at 9/hit: armor 70→61→…→0, then HP 45→43→34→…→0. Writes (`$LIFE`/`$BUMP`) do not self-emit `$HP`. | ✅ |
| `$LCD,<hp>,<armor>,<t3>,<t4>,<mag>,<reserve>,*` | Health/armor HUD echo on `$START`/`$SPAWN`/death. Tokens 3–4: — (unknown). | ✅ |
| `$ALCD,<mag>,<t2>,<slot>,<reserve>,<heat>,*` | Ammo/weapon HUD (token 2: — (unknown)): one frame per round fired *and* per round reloaded; slot changes on alt-fire cycle (0↔1); melee (slot 4) appears as an isolated frame. Heat is a raw level that exceeds 100. | ✅ |
| `$BUT,<id>,<state>,*` | 0 trigger · 1 alt-fire · 2 reload handle · 3 select · 4 left · 5 right; 1 press / 0 release. In phone mode pre-game the trigger reports but does not fire. | ✅ |
| `$VOLTS,<pack_mV>,<cell_mV>,<n3>,<n4>,*` | Battery every ~30 s in app mode. **Only reliably returned at good RSSI** — weak-signal guns in a fleet sweep returned none. | ✅ |
| `$DISCONNECT,*` | The gun is hanging up (headset switched off, or the app closing). | ✅ |
✅ src: protocol/brx-protocol.md §4, §7f, §7j, §7q, §7r; docs/experiment-log.md (2026-08-24 fleet sweep); docs/gotchas.md

[callout:warn] **The gun keeps no game state — proven three ways.** (1) Three captures at respawn 5/15/30 s: byte-identical config, nothing on the wire encodes respawn or clock. (2) The complete end-of-game tail is `$VOL → $HLED → $STOP → $CLEAR → $PLAY` — **the app never asks the gun for a score**. (3) Reconnecting after out-of-range play yields zero frames, and bare `$UP,*` gets no reply. The phone tallies `$HIR`/`$HP` live; it is the only place the score ever existed. Anything needing respawn, a clock or scoring needs a host in range for the whole match. ✅ src: protocol/brx-protocol.md §7l, §7n

[diagram DEV-08] Kill attribution + feedback sequence: victim gun → `$HIR,…,<id>,<team>,…` + `$HP,0,0,0` → host credits `<id>` → host sends shooter gun `$SFLASH,*` then `$PLAY,,4,6,V3A,,,,*` (~0.4 s) and, on a lead change, `$PLAY,,4,6,VB17,,,,*`. ✅ src: protocol/brx-protocol.md §7o, §7q

[steps] **Per-player attribution and native kill feedback over BLE — the recipe**
1. At arm time give every gun a distinct `$PSET` token 1 (0–63) and a `$TID`.
2. On the victim, store `<shooterId, shooterTeam>` from each `$HIR`; when `$HP,0,0,0` arrives, the stored shooter gets the kill.
3. Send the **shooter's** gun `$SFLASH,*` (green-sight kill confirm) and `$PLAY,,4,6,V3A,,,,*` ("kill" on the announcer slot). The official app does exactly this, three kills → three pairs.
4. Score lines (`VB17` "takes the lead") go to every gun's announcer slot from its own host. Nothing propagates gun-to-gun; there is no nRF score channel to discover.
5. Game end: `$PLAY,VSF,4,6,JAY,,,,*` on the winner's guns (victory sting + "victory").
✅ src: protocol/brx-protocol.md §4 (kill attribution pattern), §7o, §7p, §7q, §7r

[faq]
- **Why did earlier captures show shooter id 0,0?** Every gun sat on the default id. The field was always there; `$PSET` token 1 is what makes it vary. ✅ src: protocol/brx-protocol.md §7q
- **Why is `$SFLASH` in the victim's capture "never near a hit"?** Because a kill you *score* is invisible in your own `$HIR`/`$HP` stream — correlate it with `$BUT` trigger bursts. ✅ src: protocol/brx-protocol.md §7o
- **Can a dead gun fire?** No: `$BUT,0,1/0` with no `$ALCD` decrement. ✅ src: protocol/brx-protocol.md §7q

---

### Page: The IR word — what a shot carries through the air  (`/manual/dev/ir`)
_A 25-bit pulse-width-encoded word on a 38 kHz carrier, decoded from LaserTagMods' base-station source and verified on our own receiver and emitter_

[callout:info] **Credit.** The layout was decoded from **LaserTagMods' NRFL-Bases** `node1.ino` (a referee-free domination base that receives BRX shots), then bench-verified: timings, bit count, field offsets and the parity rule were all confirmed by pushing known `$WEAP` frames over BLE and watching only the expected bits move. A stock tagger then **accepted a fully synthetic word** from our emitter (invented player 42 / team 2 / damage 33 landed as a real `$HIR` and killed the player). 👥 ✅ src: protocol/brx-ir-protocol.md

[spec-sheet] **Physical layer**
- Carrier **38 kHz**, **940/980 nm** — a standard VS1838B/TSOP demodulating receiver recovers it. Laser rated 16.9 mW on the gun's USB record.
- **Sync:** one ~2 ms LOW pulse before the frame — measured **1988–1991 µs**.
- **Bits:** each bit is a LOW pulse; **long ≈ 1000 µs = 1** (measured 990–994), **short ≈ 500 µs = 0** (489–512), spaces 489–512 µs; decision threshold ~750 µs.
- **End of frame:** a trailing short pulse (< 250 µs in node1's test).
- ⚠ A `> 1500 µs` sync gate is not BRX-unique (a Sony SIRC remote's 2390 µs header passes it). Bound sync to ~1800–2200 µs and require 25 bits + the parity rule.
✅ src: protocol/brx-ir-protocol.md; protocol/brx-protocol.md §7c (laser mW)

[bit-field] **Word layout (transmit order after sync; 25 bits)**
| Field | Bits | Offset | Meaning | Bench evidence | Conf |
|---|---:|---|---|---|---|
| **B** | 4 | 0–3 | IR protocol / damage type = `$WEAP` t3 = `$HIR` tok2 = `$SIR` protocol key | AR read 0; rocket (t3=10) read 10; native melee read 13 | ✅ |
| **P** | 6 | 4–9 | player id 0–63 = `$PSET` token 1 = `$HIR` tok3 | matched the registry | ✅ |
| **T** | 2 | 10–11 | team id 0–3 = `$TID & 3` = `$HIR` tok4 | matched | ✅ |
| **D** | 8 | 12–19 | magnitude = `$WEAP` t5 = `$HIR` tok5 | pushed 22 → 9 → 115; only these bits moved | ✅ |
| **C** | 1 | 20 | critical flag → `$HIR` tok6, ×1.5 applied | emitted crit=1 → `$HIR,…,1,…` | ✅ |
| **U** | 2 | 21–22 | `$SIR` subtype → `$HIR` tok7 | U=0/1/3 registered with rows; U=2 (no row) ignored | ✅ |
| **Z** | 2 | 23–24 | parity trailer | see rule | ✅ |
✅ src: protocol/brx-ir-protocol.md; docs/experiment-log.md (2026-08-26 melee capture)

[diagram DEV-06] Bit-field ruler of the 25-bit word with the sync pulse and a sample pulse train (`1101000111010101101000110` = protocol 13, player 7, team 1, magnitude 90, crit 0, subtype 1 — a genuine captured melee swing). ✅ src: docs/experiment-log.md (2026-08-26 melee)

[callout:tip] **Parity — what genuine frames emit vs what the gun checks.** Real BRX frames set Z by parity over bits 0–22: **odd number of ones → `01`, even → `10`** (4/4 captured frames). But the gun's acceptance test is only **`Z0 ≠ Z1`**: `01` and `10` both land 8/8, `00` and `11` are rejected 0/8. Compute the true parity for fidelity; use the mismatch to tell your own traffic from a real gun's. ✅ src: protocol/brx-ir-protocol.md

[code python] (copy-to-clipboard)
```python
def encode_word(proto: int, player: int, team: int, magnitude: int, crit: int, subtype: int) -> str:
    """25-bit BRX IR word as a bit string (MSB of each field first), Z = genuine-frame parity."""
    bits = (f"{proto & 0xF:04b}{player & 0x3F:06b}{team & 0x3:02b}"
            f"{magnitude & 0xFF:08b}{crit & 1:01b}{subtype & 0x3:02b}")
    ones = bits.count("1")
    return bits + ("01" if ones % 2 else "10")

def decode_word(bits: str) -> dict:
    assert len(bits) == 25
    payload, z = bits[:23], bits[23:]
    return {
        "proto": int(payload[0:4], 2), "player": int(payload[4:10], 2),
        "team": int(payload[10:12], 2), "magnitude": int(payload[12:20], 2),
        "crit": int(payload[20]), "subtype": int(payload[21:23], 2),
        "accepted": z[0] != z[1],
        "parity_matches": z == ("01" if payload.count("1") % 2 else "10"),
    }
```
✅ src: protocol/brx-ir-protocol.md (rule); illustrative implementation

[table] **Native emissions captured off the air**
| Source | Word | Note | Conf |
|---|---|---|---|
| Assault Rifle | proto 0, magnitude 9 | The stock AR emits 9, not the manual's 24 | ✅ |
| Shotgun | proto 0, magnitude 45 | | ✅ |
| Sniper | proto 0, subtype 1, magnitude 80 | | ✅ |
| Rocket Launcher | proto 10, magnitude 115 | | ✅ |
| Melee (gyro swing, native game) | proto 13, subtype 1, magnitude 90 | Subtype 1 = Rifle Bash | ✅ |
| Supremacy Sentinel death-nova (headset) | proto 10, magnitude 125, player/team = the **dying** player | Out-damages the rocket; credits kills to the corpse | ✅ |
✅ src: protocol/brx-protocol.md §7r addendum; docs/experiment-log.md

[callout:warn] **Headset emission cannot be forced over BLE.** `$IRTX`, `$HFIRE`, `$MELEE` and `$BHIT` produced zero IR with a receiver control passing before and after. The headset emits only for a physical melee swing in a native game and for the Sentinel death-nova. ✅ src: docs/experiment-log.md (2026-08-26 headset emission)

[faq]
- **Do I need a victim gun to test an emitter?** No — a VS1838B on an ESP32 decodes the word, and the sync/mark timings above are the acceptance spec. ✅ src: protocol/brx-ir-protocol.md
- **Can a station revive a dead player by IR?** No. A dead gun ignores all IR; stations *arm* a living tagger's respawn path. ✅ src: docs/experiment-log.md (448-word brute force)
- **Why do my captured frames come out as prefixes (16/17/20/21 bits)?** Your capture sketch is printing while the next frame lands. Turn the RAW dump off. ✅ src: docs/gotchas.md; protocol/brx-ir-protocol.md (capture gotcha)

---

### Page: The USB serial console — `QUERY` and `SETUP`  (`/manual/dev/serial-console`)
_The micro-USB "Programing Port" is a Teensy serial console with two commands, not the `$` protocol and not SSH_

[callout:info] The BRX has two ports: charging, and a separate micro-USB **"Programing Port"**. Plugged into a computer it enumerates as a **Teensyduino USB Serial** CDC device (Windows `COMx`, macOS `/dev/tty.usbmodem*`, Linux `/dev/ttyACM*`, VID `16C0`). Baud is ignored. This is what the community means by "PuTTY into the tagger". The command set came from LaserTagMods' headset-pairing note. ✅ 👥 src: protocol/brx-protocol.md §7c; docs/experiment-log.md (2026-08-24 B7)

[table] **What the port does and does not do**
| Sent | Result | Conf |
|---|---|---|
| `$PING,*`, `$VERSION,*`, any `$` frame | **Echoed back** (local echo on — easy to mistake for a reply); with CR: `ERROR` | ✅ |
| `?`, `help`, `AT`, `status`, … | `ERROR` | ✅ |
| `QUERY` + CR | Dumps the device record (below). Case-insensitive. | ✅ |
| `SETUP` + CR | Enters factory provisioning; prompts (EN/中文) for the **headset's** serial number | ✅ |
| Hold SELECT while powering on with USB connected | Mass-storage mode exposing the on-board sound storage (the sound-pack update path) — a different mode from the console | 👥 |
✅ src: protocol/brx-protocol.md §7c; protocol/callsign-extract/protocol-classes.md ("New sounds ON THE TAGGER")

[code text] (copy-to-clipboard)
```text
QUERY
Gun Info
Gun Version: v4.32
Serial Number/Head PIN: <SERIAL>      <- matches the sticker on the paired headset
Gun Name: Tactix2                     <- the field $NAME writes
Headset Version: hds.59               <- reads '?' briefly after a power-cycle until the headset re-handshakes
Gun: 7.671 VOLTS
PlayerID 0                            <- device-level player id (separate from the per-game $PSET id)
FieldID1
NRFhost 1
NRFslave 1
devHost 1                             <- developer/host image, not retail
Head: 3.837 VOLTS                     <- headset battery
Head Tested:
Head BURN in test: 0
Gun BURN in test: 3hours28minutes
Grenade Pin: <PIN>
Laser: 16.9 mW
PCB-5
BTchip- 4
BT central V: devhost.03
```
✅ src: protocol/brx-protocol.md §7c (values are one unit's; PIN/serial redacted)

[callout:tip] **Real-format quirks** the parser has to survive: `Gun Name` is NUL-padded, lines end `\r\r\n`, `Laser` can read `UNTESTED` instead of a number, `Grenade Pin` is a real non-zero value. `brx-mcp` ships `parse_query()` and `python -m brx_mcp usb-query [port]`, which saves a backup to `~/.brx-mcp/device-backups/`. ✅ src: docs/experiment-log.md (2026-08-24 B7); mcp/brx_mcp/protocol.py

[steps] **`SETUP` — the provisioning/re-pair path (identity lives here)**
1. Run `QUERY` on both gun and headset-side records first; `SETUP` on the gun asks for the **headset's** serial number — that is the gun↔headset pairing mechanism.
2. The "Factory Defaults" banner is a **mode header, not an action**: entering `SETUP` and power-cycling out changed nothing (field-by-field diff).
3. 👥 The community's "change tagger ID / re-pair the headset" procedure is this console (LaserTagMods' headset-pairing note); the identity fields it concerns are the ones `QUERY` prints: `PlayerID`, `FieldID`, `Serial Number/Head PIN`, `Grenade Pin`.
4. Only the first prompt (the headset serial) has been walked on our bench. Do it only on a gun you can afford to re-pair.
5. For per-game identity you do not need this: `$PSET` token 1 over BLE sets the player id each game.
✅ 👥 src: protocol/brx-protocol.md §7c, §7p; docs/experiment-log.md (2026-08-24)

[callout:warn] **Firmware backup is impossible; do not reflash.** Teensy's HalfKay bootloader is write-only by design, so no image can be read back. Rollback depends entirely on Battle Company supplying the original image. The official app's version gate (supports "until v2.01e") is an *upper* bound; it warns and still runs a game. ✅ src: protocol/brx-protocol.md §7b, §7c

[faq]
- **Is `$QUERY,*` over BLE the same thing?** No. Over BLE it returns a `$`-framed status array with no serial, PIN or version. The device record is USB-only. ✅ src: docs/experiment-log.md (2026-08-24)
- **What is the advertised BLE name vs `Gun Name`?** Two fields: the advertisement is `Tactix-XXXX` from the MAC tail; `Gun Name` is what `$NAME` writes. ✅ src: docs/experiment-log.md (2026-08-24)

---

### Page: Headset, link and what survives  (`/manual/dev/headset-link`)
_Which state lives where — and what a BLE drop, a headset switch-off, or a power-cycle each wipe_

[compare] **State survival matrix**
| State | BLE drop / reconnect | Headset switched off | Power-cycle | Conf |
|---|---|---|---|---|
| Game config (`$GSET`/`$PSET`/`$WEAP`/`$SIR`/`$BMAP`) | — (unknown) — re-send the full head after a reconnect | Gun sends `$DISCONNECT,*` and drops the link; config: — (unknown) | **Wiped** — `$SPAWN` then echoes `$LCD,0,0,0,0,0,0` + `$ALCD,0,0,0,0,0` | ✅ |
| Alive/dead + pools | Survives (a dead gun stays dead) | — | Reset | ✅ |
| Ammo | Survives | — | Wiped | ✅ |
| `$TID` team / LED colour | Survives; colour is painted at `$SPAWN` | — | Reset | ✅ |
| `$NAME` | Persists | Persists | **Persists** (only the official app rewrites it) | ✅ |
| Player id (`$PSET` t1) | Survives with config | — | Wiped (the USB `PlayerID` is separate and persistent) | ✅ |
| Score, clock, respawn timer | **Never on the gun** | — | — | ✅ |
| `$SIR` fn-23 state (`$ALCD` token 2 at 0) | Persists until `$SPAWN` | — | Cleared | ✅ |
✅ src: protocol/brx-protocol.md §7r (E1), §7n; docs/experiment-log.md (2026-08-24 `$NAME`; EMP recovery matrix)

[diagram DEV-09] The matrix above as a grid graphic. ✅ src: as above

[callout:warn] **Headset off = no BLE.** Switching a linked headset off makes the gun send `$DISCONNECT,*` and drop. A headset-less gun "connects", answers a quick `$PING`, then dies within seconds and echoes **nothing** to a config head. A power-cycled gun needs its headset re-linked before BLE holds. **A held link plus `$ALCD` echoes *is* the headset check** — there is no dedicated probe. The official app silently drops a headset-less gun within ~1.2 s. ✅ src: protocol/brx-protocol.md §7m, §7r

[table] **Headset behaviours (native, autonomous — they work under any host's game head)**
| Headset LED | When | Conf |
|---|---|---|
| Slow **rainbow** blink | Disconnected / not paired — the pre-game tell for "this gun will not join" | ✅ (operator, repeatable) |
| Team colour (red/blue…) | **Pre-game only**; goes dark once the game starts | ✅ (operator) |
| Dark | During play — normal | ✅ (operator) |
✅ src: docs/experiment-log.md (2026-08-27 headset LED)

[table] **Other headset facts**
| Fact | Source | Conf |
|---|---|---|
| The headset syncs team colour from the tagger | bench observation | ✅ |
| `$VERSION` token 2 = headset firmware (`hds.59`); USB `QUERY` shows headset version and battery | captures / USB | ✅ |
| Headset disconnecting **mid-game** locks the gun until it reconnects (anti-cheat); a gun booted with **no** headset shoots normally in local play | Battle Company manual V7 | 👥 |
| Headset pairing can take up to 3 minutes with many BT devices nearby | manual V7 | 👥 |
| Headset sensor ids: `$HIR` tok1 0 = front dome, 1 = back dome (4 = gun body) | shield-isolated bench | ✅ |
| Gun↔headset pairing PIN = the headset's serial, set via USB `SETUP` | LaserTagMods note + USB | ✅ 👥 |
| Headset LED commands `$HLED`/`$BLINK`/`$CHASE`/`$HLOOP`/`$LED` exist; only `$HLED,,6` and `$HLOOP,0,0` have been seen in use | APK + captures | 🔍 ✅ |
✅ 👥 🔍 src: protocol/brx-protocol.md §7h, §7m, §7r, tok1 section; docs/experiment-log.md (2026-08-27)

[callout:tip] **Screamers.** A tagger left powered all day can stop holding BLE — advertising normally but connect-then-drop or hanging on connect — the community-documented "screamer" state. Power-rest guns between sessions; keep them charged (firmware won't re-pair below a battery threshold). 👥 ✅ src: docs/gotchas.md; docs/experiment-log.md (2026-08-26 screamer)

---

### Page: Getting started with `brx-mcp`  (`/manual/dev/brx-mcp`)
_From `pip install` to a live game in six commands — plus the MCP tools for driving a gun from an AI agent_

[callout:info] `brx-mcp` is the project's lab instrument: a pure-Python (`bleak` + `mcp`) CLI and MCP server that runs on **whichever machine owns the Bluetooth radio** — Windows, macOS or Linux. It enforces the known-safe list, refuses malformed frames, records every session, and has a `panic` tool. ✅ src: README.md (quickstart, Safety)

[code bash] (copy-to-clipboard)
```bash
# on the machine with the BLE radio (Windows PowerShell, macOS terminal, or Linux):
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e ./mcp

# first contact — no MCP client needed:
python -m brx_mcp scan             # find taggers (Gen2/3 advertise the Nordic UART service)
python -m brx_mcp identify <addr>  # $PING → generation check, firmware, host image
python -m brx_mcp listen <addr>    # read-only live console: pull the trigger, watch $BUT/$HIR/$HP
```
✅ src: README.md

[code bash] (copy-to-clipboard)
```bash
# ...and now actually play. Your laptop drives the guns directly over BLE,
# so everyone stays within BLE range of it (a room or a yard).
python -m brx_mcp play tdm <addr1> <addr2> volume=69   # a real Team Deathmatch with live scoring
#   modes: tdm ffa infection lms cs domination koth ctf extraction
#   run `python -m brx_mcp` with no arguments for the full command list

# no guns to hand? this needs no hardware at all:
python -m brx_mcp game-sim tdm                         # narrated demo match in your terminal

# read the USB device record (tagger on the Programing Port):
python -m brx_mcp usb-query                            # QUERY over the Teensy serial console
```
✅ src: README.md; mcp/brx_mcp/__main__.py

[code bash] (copy-to-clipboard)
```bash
# register with Claude Code as an MCP server:
claude mcp add brx -- python -m brx_mcp
# WSL2 has no Bluetooth — develop in WSL, run the server with Windows Python:
claude mcp add brx -- python.exe -m brx_mcp
```
✅ src: README.md (Platform notes)

[table] **CLI commands**
| Command | What it does |
|---|---|
| `scan` · `identify <addr>` · `listen <addr>` · `probe <addr>` | Discover, check, watch, probe a single gun |
| `startgame <addr>` · `deathmatch <addr>` · `arena <addr1> <addr2>` · `fieldstart …` | Earlier single-purpose game drivers (the §7e sequence) |
| `play <mode> <addr…> [volume=69]` | Hosted match with live scoring; modes tdm ffa infection lms cs domination koth ctf extraction |
| `game-sim <mode>` · `extraction-sim` | Hardware-free narrated simulations |
| `diag <addr>` · `diagnose <addr>` · `diag-game <addr>` · `fleet` | Diagnostics, fleet battery/reachability sweep |
| `usb-query [port]` · `enroll` · `armory` · `rename` · `reset` | USB device record, armory enrolment, persistent `$NAME`, reset |
| `ir-capture` · `ir-emit` · `ir-range` | Drive the ESP32 IR transceiver rig |
✅ src: mcp/brx_mcp/__main__.py (dispatch table)

[table] **MCP tools (what an agent can call)**
| Tool | Purpose |
|---|---|
| `scan(duration_s)` · `identify(address)` · `diagnostics(address)` · `fleet_status(addresses)` | Discovery and health |
| `connect(address, alias)` · `disconnect(alias)` · `list_connections()` | Session management |
| `send(alias, command, confirm=False)` · `send_batch(alias, commands, gap_ms=100)` | Write frames; anything outside the known-safe list needs `confirm=True` |
| `get_events(alias, since_seq)` · `wait_for(alias, prefix, timeout_s)` | Read the buffered event stream / block on a message |
| `session_log(alias, action, label)` · `diff_captures(file_a, file_b)` | Record and diff sessions |
| `panic(alias)` | `$CLEAR,*` then `$SP,99,*` |
| `parse_query_dump(text)` | Parse a USB `QUERY` record |
| Resources: `protocol_doc`, `known_devices`, `capture` | The protocol reference, the device registry, capture files |
✅ src: mcp/brx_mcp/server.py

[callout:tip] **Platform notes.** macOS: grant your terminal Bluetooth permission; CoreBluetooth reports per-machine **UUIDs instead of MAC addresses**, so never pattern-match on address format and expect to re-scan per machine. Gen1 taggers use Bluetooth Classic — `bleak` is BLE-only, so pair in the OS and use the serial port (guide todo). Captures and the device registry live in `~/.brx-mcp/`. ✅ src: README.md; CLAUDE.md; docs/gotchas.md

[steps] **Recommended first session (safe order)**
1. `scan` → note the address. `identify` → confirm `$PONG` and read the `$VERSION` reply.
2. `listen` read-only: pull the trigger, get tagged by another gun, watch `$BUT`/`$HIR`/`$HP` — send **no** config yet.
3. `play tdm … volume=69` on two guns; confirm each echoes `$LCD,45,70,0,0,36,216` on spawn.
4. If anything looks wrong: `panic`, then power-cycle — that always restores the tagger.
✅ src: protocol/brx-protocol.md §8; README.md

---

### Page: Captures — recording and decoding the official app  (`/manual/dev/captures`)
_How every fact on these pages was obtained, and how to take the next one_

[callout:info] **Method.** Almost everything here came from three instruments: BLE HCI captures of the official Callsign app (Android HCI snoop; iOS via macOS PacketLogger), a VS1838B/ESP32 IR receiver+emitter, and a live tagger driven one token at a time. Captures are decoded with `python -m brx_mcp.btsnoop <file>` into `>>` (host→tagger) / `<<` (tagger→host) transcripts. ✅ src: protocol/captures/README.md; docs/capture-runbook.md

[steps] **iOS (the one that works — Callsign is effectively iOS-only)**
1. Plug the iPhone into a Mac. Open **PacketLogger** (Xcode additional tools) → **File → New iOS Trace**. **Confirm lines are scrolling before you do anything.**
2. Make sure the tagger's **headset is on and paired** — the app silently drops a headset-less gun and you capture nothing. Get the app's connection icon green first.
3. Drive the app: connect, create/join, arm, play, end. For a differential capture change **exactly one** setting per trace.
4. **File → Export → btsnoop**. Two traps: export acts on the *frontmost* window (easy to re-export an old trace), and a trace that wasn't recording writes a silently useless file.
5. `python -m brx_mcp.btsnoop <file>` → transcript. `python -m brx_mcp.gsetdiff <capA> <capB> [capC]` diffs the config frames across raw captures.
✅ src: docs/capture-runbook.md (Job 2); protocol/brx-protocol.md §7m; protocol/captures/README.md

[steps] **Android (partial — the app rarely holds a connection here)**
1. Enable **Developer options → Bluetooth HCI snoop log**.
2. Run the app; then `adb bugreport` (5–10 min; keep the phone still) — the btsnoop log rides inside.
3. Decode with `python -m brx_mcp.btsnoop`. This route yielded the connect ritual and the version exchange, never a game.
✅ src: docs/experiment-log.md (#5 HCI snoop)

[code bash] (copy-to-clipboard)
```bash
python -m brx_mcp.btsnoop capture.btsnoop            # → '>> $CLEAR,*' / '<< $LCD,…' transcript with timestamps
python -m brx_mcp.gsetdiff cap5.btsnoop cap6.btsnoop # byte-diff the $GSET/$PSET frames across captures
python -m brx_mcp.weapmap cap14.btsnoop cap15.btsnoop # token × weapon table from operator-annotated captures
```
✅ src: protocol/captures/README.md; protocol/callsign-extract/protocol-classes.md

[callout:warn] **Decoder gotchas we hit.** Apple's btsnoop export uses datalink 1001 (no HCI type byte — the type is in the record flags), which decoded to zero frames until handled. With two guns in one trace, streams must be keyed on the **ACL connection handle** or they merge into garbage silently. ✅ src: docs/experiment-log.md (#4 PacketLogger; cap8 notes)

[table] **Published transcripts** (decoded frames only — raw btsnoop files contain all of a phone's Bluetooth traffic and are not published)
| File | Shows |
|---|---|
| `2026-08-23-ios-callsign-game-start.txt` | The full working arm sequence (§7e) |
| `2026-08-23-ios-callsign-two-tagger-combat.txt` | `$HIR`/`$HP` damage, death, host-driven respawn (§7f) |
| `2026-08-23-gset-respawn15.txt` / `-respawn30.txt` / `-respawn05.txt` | Byte-identical `$GSET` at three respawn values; `respawn15` also contains a complete game ending (§7n) |
| `2026-08-23-no-headset-disconnects.txt` | App ritual completes, zero frames back, hangs up ~1.2 s later (§7m) |
✅ src: protocol/captures/README.md

[steps] **IR capture rig (ESP32-S3 + VS1838B)**
1. A phone camera **cannot** see the ~5 mA IR LED — judge with the receiver, never a camera.
2. Turn the sketch's per-frame RAW dump **off** (`r`) for any capture that matters; it takes ~15–20 ms at 115200 and truncates the next frame into a prefix.
3. Attenuate at close range — the VS1838B's AGC saturates point-blank; a gun at 1 m decodes cleanly where an LED at 5 cm does not.
4. Never fire toward the rig from the gun under test: reflected IR hits your own headset, drains armor and kills the player mid-window.
5. Bound the sync to ~1800–2200 µs and require 25 bits + `Z0 ≠ Z1`, or a TV remote will decode as a BRX frame.
✅ src: docs/gotchas.md (Capturing IR); protocol/brx-ir-protocol.md

[callout:tip] **Measurement discipline that mattered.** Check the control *before* reading the result; one clean-looking run is not a result (everything that held was measured 3× with alternating conditions, or came from a human's senses); a host-visible field that correlates with a state is not evidence of that state; damage is a property of the (weapon, victim `$SIR` table) pair, never of the weapon alone. ✅ src: docs/gotchas.md (Interpreting)

---

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|
| DEV-01 | Transport — hero | Atmospheric hero: a laser-tag rifle silhouette in profile, low-key, with a faint oscilloscope-style serial pulse train sweeping across the lower third and soft concentric radio arcs emanating from the receiver; a single amber dot for the IR emitter. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a sleek futuristic laser-tag rifle in side profile, rim-lit in electric blue, with thin concentric radio arcs radiating from its rear and a crisp oscilloscope pulse train (long and short pulses) glowing along the bottom edge; one small amber point of light at the muzzle; shallow depth of field, matte surfaces, no visible branding. |
| DEV-02 | Transport — after the generation table | Link topology. Boxes: HOST (laptop/phone/ESP32) — TAGGER — HEADSET — OTHER TAGGER — USB CONSOLE. Arrows: host→tagger labelled "BLE NUS write 6E400002" and tagger→host "notify 6E400003"; a dashed bidirectional line tagger↔headset labelled "proprietary link (team colour, hit sensors)"; tagger→other tagger a dotted amber arrow labelled "IR 38 kHz, 25-bit word"; a side arrow USB CONSOLE→tagger labelled "QUERY / SETUP (CR-terminated, not $)". A small note on the Gen1 path: "Gen1: SPP 57600 via HC-05". | SVG (build in site) | protocol/brx-protocol.md §1, §7c, §7r | — |
| DEV-03 | Transport — frame anatomy | Annotated frame `$PLAY,,4,6,V3A,,,,*` as monospace chips: `$` (start), `PLAY` (command), `,` separators, an **empty** token highlighted in amber with the note "empty = leave unchanged", `4`, `6`, `V3A` (announcer slot), trailing empties, `,*` (terminator). Callouts: "max ~20-byte BLE chunks", "no commas / * / newlines inside tokens". | SVG (build in site) | protocol/brx-protocol.md §2, §7o; mcp/brx_mcp/protocol.py | — |
| DEV-04 | Arm sequence | Sequence diagram, two lifelines HOST and TAGGER. Downward arrows in order: `$CLEAR` `$START` (return `$LCD,0,0,0,0,0,0`) `$GSET` `$PSET` `$WEAP×3` `$SIR×10` `$BMAP×7` `$TID` `$PLAYX,0` `$PLAY,VA81,4,6` `$SPAWN,,` (return `$LCD,45,70,0,0,36,216`) `$AMMO,0,36,108,1` `$AMMO,1,6,12,1` `$BMAP,0,0`. Then a shaded "in play" band with `$BUT,0,1`/`$ALCD` returns. Then a death band: return `$HP,0,0,0` + `$LCD,0,0,0,1,1,1`; host `$HLOOP,0,0` (~1.7 s); host `$SPAWN,,` (~10 s) return `$LCD,45,70,0,0,36,216`. Then end: `$VOL,69,0` `$HLED,,6` `$STOP` `$CLEAR` `$PLAY,VSF,4,6,JAY`. Blue for host frames, amber for gun echoes. | SVG (build in site) | protocol/brx-protocol.md §7e, §7f, §7o | — |
| DEV-05 | `$WEAP` page | A horizontal token ruler of 43 cells (t0–t42) colour-coded by block: identity (t0–t2), damage/IR (t3–t6), secondary-dormant (t7–t11, hatched grey), extra-headset (t12–t13, t42), cadence & ammo (t14–t19), fire mode/accuracy/burst/overheat (t20–t26), sounds (t27–t36), overheat gate (t37–t38), ammo tail (t39–t41). Each cell shows its index and a short label; t14 and t20 get a "bench-proven" badge; t15 gets a "constant 850 — don't write" badge. | SVG (build in site) | protocol/callsign-extract/protocol-classes.md; protocol/brx-protocol.md §6.1 | — |
| DEV-06 | IR page | 25-bit field ruler: B(4) P(6) T(2) D(8) C(1) U(2) Z(2) with bit offsets 0–24 below, plus a pulse-train strip above showing the 2 ms sync, then long (≈1000 µs) and short (≈500 µs) marks for the sample word `1101000111010101101000110`, and the trailing short end pulse. Under each field: "= $WEAP t3 / $HIR tok2", "= $PSET t1 / $HIR tok3", "= $TID & 3 / $HIR tok4", "= $WEAP t5 / $HIR tok5", "= $HIR tok6 (×1.5)", "= $SIR subtype / $HIR tok7", "parity: odd→01 even→10; gun checks only Z0≠Z1". | SVG (build in site) | protocol/brx-ir-protocol.md | — |
| DEV-07 | `$SIR` page | Damage pipeline flow: [IR word: B,U,D,C] → [victim looks up $SIR(B,U)] → branch "no row → dropped silently" / "row found" → [function class: damage ×1 / ×1.25 / ×2 / AP / heal / armor / shield / status] → [×1.5 if C=1] → [team gate: FF=0 blocks same-team damage and enemy heals] → [drain shields → armor → HP] → [emit $HIR + $HP]. Use amber for the drop/gate branches. | SVG (build in site) | protocol/brx-protocol.md §5, §7r addendum; docs/experiment-log.md | — |
| DEV-08 | Events page | Kill attribution sequence with three lifelines: VICTIM GUN, HOST, SHOOTER GUN. Victim → host: `$HIR,4,0,19,2,9,0,3` (×N) then `$HIR` + `$HP,0,0,0` (same ms). Host box: "credit player 19 / team 2". Host → shooter: `$SFLASH,*` (+0.4 s), `$PLAY,,4,6,V3A,,,,*` (+0.2 s), `$PLAY,,4,6,VB17,,,,*` (lead change only). Host → victim after respawn delay: `$SPAWN,,*`. | SVG (build in site) | protocol/brx-protocol.md §7o, §7q | — |
| DEV-09 | Headset/link page | Grid: rows = config, alive/dead+pools, ammo, `$TID`/LED colour, `$NAME`, player id, score/clock, fn-23 state; columns = BLE drop, headset off, power-cycle. Cells filled blue "survives", amber "wiped", grey "never on gun / untested", each with a two-word note. | SVG (build in site) | protocol/brx-protocol.md §7r, §7n; docs/experiment-log.md | — |
| DEV-10 | Serial console page — header | Atmosphere: a micro-USB cable plugged into the side of a matte device, a faint terminal glow reflecting on the surface; extreme close-up, shallow focus. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: extreme close-up of a micro-USB cable seated in the port of a matte dark polymer device, a faint electric-blue glow spilling from an out-of-focus terminal screen in the background, one small amber status LED beside the port, shallow depth of field, no readable characters anywhere. |

## Interactive ideas (≤5)
1. **`$WEAP` frame builder** — sliders/selects for damage (t5), fire interval (t14), fire mode (t20: auto/single/burst/charge variants/melee), burst cycle (t23), clip/reserve (t16/t39/t40, with t17 auto-derived as 2×t40), reload ms (t18), IR protocol (t3, DamageType enum names), overheat (t24/t35/t37/t38), and sound-id pickers from the bank for t27–t36. Outputs the exact frame string with copy-to-clipboard; locks t15 to 850 and greys the dormant t7–t11.
2. **Frame decoder** — paste any `$…,*` frame; it tokenises and labels every position from the tables on these pages (`$WEAP`, `$GSET`, `$PSET`, `$SIR`, `$HIR`, `$HP`, `$LCD`, `$ALCD`, `$PLAY`, `$AMMO`, `$BMAP`), flags empty tokens, shows the per-token confidence, and validates against the framing regex.
3. **IR word encoder/decoder** — six fields → 25-bit string, pulse-train visualisation (sync + long/short marks), true parity vs the gun's `Z0≠Z1` test, and the `$SIR` cell `<B,U>` it would key into; paste a bit string to reverse it.
4. **Damage calculator** — pick a weapon (magnitude, protocol/subtype), the victim's `$SIR` row function, crit on/off, `$GSET` friendly-fire, teams, and starting pools; shows applied damage, drain order across shields→armor→HP, hits-to-kill, and the resulting `$HIR`/`$HP` frames.
5. **`$SIR` matrix explorer** — a 16 × 4 grid of `<protocol, subtype>` cells; click a cell to assign a function class and sound, see stock rows pre-filled, and export the full `$SIR` block for a game head.

## Sources used
- `protocol/brx-protocol.md` — §1–§8 in full (transport, framing, command/event tables, `$SIR`, `$WEAP`, and findings §7a–§7r, the tok1 sensor map, t20 fire mode, overheat).
- `protocol/callsign-extract/protocol-classes.md` — command vocabulary, `$GSET`/`$PSET`/`$WEAP`/`$BMAP`/`$GLED`/`$GREN`/`$LIFE`/`$BHIT`/`$BUMP`/`$FSET` field maps, enums, weapon signatures, token-position validation.
- `protocol/callsign-extract/config-facts.md`, `protocol/callsign-extract/README.md` — APK teardown method and non-wire facts.
- `protocol/brx-ir-protocol.md` — the 25-bit IR word, timings, parity, bench verification.
- `protocol/captures/README.md`, `docs/capture-runbook.md` — transcripts, capture jobs and traps.
- `README.md` — quickstart, safety, platform notes; `mcp/brx_mcp/protocol.py` (known-safe list, panic, parsers), `mcp/brx_mcp/server.py` (MCP tools), `mcp/brx_mcp/__main__.py` (CLI dispatch, captured frames), `mcp/brx_mcp/gameconfig.py` (`$PSET` builder), `mcp/brx_mcp/btsnoop.py`.
- `docs/experiment-log.md` — `$WEAP` token probes (tok14/850), charge/overheat, `$SIR` function maps and FF enforcement, tok5 raw magnitude, fn 23 audio suppression, `$GREN` emission, headset LED, USB `QUERY`/`$QUERY`, `$NAME` persistence, capture decoder fixes.
- `docs/gotchas.md`, `docs/unknowns.md`, `docs/VISION.md` ("The definitive BRX manual"), `CLAUDE.md` (hard rules).
- External, credited: LaserTagMods (JEDGE / JBOX / NRFL-Bases), Battle Company BRX Manual V7, the owner community (Facebook group captures on fw v4.30).

## Research backlog (held — NOT published)
Everything below was removed from the pages above because it is unconfirmed, single-sourced, contradicted between sources, or a guess. Nothing here renders on the site. Each item moves up into the manual when a controlled bench method confirms it.

**Commands held from the command tables**
- **`$CONNECT` / `$INIT` semantics** — described in LaserTagMods material as handshake/initialise; on v4.30 `$INIT` was reported to make the gun accept but not start a `$PB*` game. Our v4.32 bench saw no reply (that part is published).
- **`$AS,…,*`** (👥 JEDGE, e.g. `$AS,1,0,4,0,10,0,95,*`, up to 11 tokens; labelled "applicator/game-control settings") — silent on v4.32 across seven shapes; semantics unknown.
- **`$UP,100,<n>,0,*` + `$UR,*`** (👥 JEDGE sends four `$UP,100,5..8,0` then `$UR`) — bare `$UP,*` gets no reply on v4.32 (published on the Events page as evidence the gun keeps no score); whether `$UP` is a write and what it writes is untested.
- **`$RADSK,*` · `$INDOOR,1,1,*` · `$#CONNECT,*`** — seen in the v4.30 community sequence; meaning unknown.
- **`$RP` `$RV` `$UR` `$IT` `$KK` `$TA` `$PT` `$HS` `$PH` `$RR` `$PKC` `$HKC` `$KOTH`** — respawn/revive/status/kill-confirm family from LaserTagMods sources; unmapped on v4.32.
- **`$BRXSERVER` `$SSID` `$PASS` `$BRX`** — together suggest a Wi-Fi/server mode in some firmware; unprobed.
- **`$UP` / `$AS` / `$SP` as tagger→host echoes** — reported by LaserTagMods (0–11 tokens); never seen from our v4.32 units.
- **`$SP` full semantics** — published only as "end-of-game / stop; half of the panic sequence" (👥). `$SP,<n>` values other than 99 are unmapped. JEDGE notes fw 4.26 added `$AS`, `$SP`, `$UP` (Gen1 vs Gen2/3 command differences unmapped).
- **`$PB*` playbook enums on v4.32** — full value→meaning tables exist only from the v4.30 community capture.
- **`$GLED` colour index** — a community lead suggests a single 0–8 colour index (0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 cyan · 6 white · 7 pink · 8 orange); unreproduced. Also open: what its four fields do, how to turn the gun LEDs **off**, which token gives the native "LED life gauge".
- **`$GREN`** — whether the gun programs the grenade from this frame; the exact frame the app sends; which emitter (muzzle or headset) fires when it is sent (the bench saw IR whose bits did not track the arguments).
- **`$HLOOP,0,0,*`** — guess: a death audio-loop control. Only the captured fact (sent ~1.7 s after death) is published.
- **`$HLED` / `$BLINK` / `$CHASE` / `$LED`** field semantics — never mapped on the bench.
- **`$QUERY` over BLE** — the status array (`~11 value,, pairs`) is undecoded.
- **`$TIME`** — APK-listed notification, never observed; meaning unknown.
- **Gen1 reply prefix** — brx-protocol.md §2 says Gen1 *may* prefix replies as `$!DFP,PONG,*`; not verified on a Gen1 unit.
- **On-gun volume menu ↔ `$VOL`** — the 1–5 menu ≈ `$VOL` 60/70/80/90/100 is a field estimate (brx-protocol.md §3), not measured.

**Field-map positions blanked to `— (unknown)`**
- **`$WEAP` t2** — 100 on every stock gun, 90 on melee/gas-melee; function unknown.
- **`$WEAP` t15** — 850 on every stock gun, 100 on melee; read as `weaponSwapDelay` from the APK name order, never proven. (The "don't write it — a compiler once wrote the fire rate here" warning stays published because the 850 constant and the bug are both bench facts.)
- **`$WEAP` t19** — guess `reloadType` (ReloadType enum: Magazine, Quiver, Shells, SingleBolt, BoltWithMagazine, AutoReload). Shotgun reads 2, melee 10, but the shell-reload Plasma Sniper reads 0; a sniper probe changed nothing about firing.
- **`$WEAP` t25 / t26** — `2` and `50` on the Suppressor only (melee t25 = 0). Read as "suppress the muzzle flash" and a loudness value; single sample each.
- **`$WEAP` t37 / t38** — the pair enables overheat (published); which is threshold and which is cooldown is unmapped.
- **`$WEAP` t41** — APK name `gunRange` (%); 75 on every stock weapon; whether it changes emitted range is untested.
- **`$PSET` t6** — APK source order suggests `criticalDamageBonus`; unverified. **`$PSET` t4 armor > 255** — clamp vs wrap untested.
- **`$PSET` voice pack slot↔name alignment** — 17 metadata names vs 16 wire ids; not proven by ear.
- **`$GSET` fields 2–8** — only the APK names are published; none has been flipped on the bench.
- **`$LCD` tokens 3–4, `$VOLTS` tokens 3–4** — never decoded (`$VOLTS` 3–4 were read as charge %/levels; unconfirmed).
- **`$ALCD` token 2** — single-sourced reading: an audio level (100 normal, `$SIR` fn 23 drives it to 0). Only the observed 100→0 drop and ~6–8 s recovery is published; the "audio suppression" interpretation is held.

**`$SIR` and IR**
- **fn 23** — is it audio suppression? The `$ALCD` token-2 drop is published; the explanation is single-sourced (experiment-log 2026-08-27).
- **Status functions** enemy 3, 8, 24–28, 35 and ally 31, 32, 34 — register and move no pool; a stun, a fire-rate buff, or nothing? Needs a trigger pulled during each to detect a fire lockout. Only "registers, no pool change" is published.
- **`$SIR` p5–p8** — not a multiplier (published); what they are is open.
- **Tear gas row (`$SIR,11,…,28`)** — reported by the community as not working; unverified.
- **Grenade station beacon word** — predicted protocol 15 with the mode in the magnitude (Respawn 6, Hill 8); never captured intact. The native **Sentinel EMP** word has also never been captured intact.
- **The 18-vs-9 armor drain split** in the first two-tagger capture remains unexplained.
- **`$HIR` tok1 at field distance** — the front/back/gun sensor map was isolated at the bench; point-blank floods all receivers.
- **Melee under a host-pushed head** — frames byte-identical to the app's, yet gyro melee only worked in a native on-gun game; cause unknown.

**Link, headset, state**
- **`$SPAWN` alone after a BLE drop — two contradicting bench readings.** (a) On a fresh link after a drop, `$SPAWN,,*` + `$AMMO` revived a dead gun with config intact (brx-protocol.md §7r). (b) A later note: a dead gun did **not** revive on `$SPAWN` alone and needed the full cold start (§7r addendum). Published: only "re-send the whole head after a reconnect". The state-survival matrix's *config ↔ BLE drop* cell (and diagram DEV-09's matching cell) therefore renders as unknown.
- **Headset green LED** — the operator reports it blinks green on a hit and flashes/stays green on a kill, and flags uncertainty about whose hit/kill it reports. Held until repeated.
- **Gun↔headset link protocol** — never characterised or driven.
- **The nRF radio** (`NRFhost 1` / `NRFslave 1` in `QUERY`) — is there a native gun-to-gun mesh, and does it carry the multikill confirm? Unwired.
- **`SETUP` full prompt sequence** — believed (👥) to write `PlayerID` / headset pairing / grenade pin; only the first prompt has been walked. Whether later prompts expose `devHost` or the BT role is unknown.
- **`devhost.03` firmware image** — guess that dev-host units run an image outside the retail version sequence; unverified.

**Captures still worth taking** (docs/capture-runbook.md)
- Callsign HTTPS API via mitmproxy (iPhone + Mac, no gun; cert install + full trust) → server-side weapon stats, voice packs, ability parameters.
- `$PB*` playbook enums on v4.32 (PacketLogger + one gun, one field per trace) → value→meaning tables for the second remote-start path.
- The app configuring a grenade (PacketLogger + grenade) → the exact `$GREN` frame.
