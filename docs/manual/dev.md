# Developer reference
Last verified: 2026-09-06

This is the interoperability spec for the BRX tagger and headset: transport, framing, every known command and event with its field map, the `$WEAP` / `$GSET` / `$PSET` / `$SIR` tables, the optical IR word, the USB console, and a path from `pip install` to a live game. Every command, token, field name and wire value on this page is literal.

> **Credit, first.** The BRX serial protocol was discovered and proven by **LaserTagMods** (the JEDGE / JBOX / NRFL-Bases projects, github.com/LaserTagMods). Everything on this page is an independent, clean-room restatement. We verified it on our own taggers, decoded it from public app metadata, or captured it off the air. It contains no Battle Company code or assets. If you build on this, credit them too.

> **Ground rule.** Stock BRX firmware is **never modified**. Every capability below is reached over the tagger's own serial protocol, and **power-cycling always restores a tagger** to normal operation.

## Transport, framing and safety

One text protocol, three ways in. The BRX speaks a plain ASCII, comma-delimited command language on a hardware UART. Gen1 exposes it over Bluetooth Classic, Gen2/3 over BLE, and the community drives it from a wire. The frames are identical on all three.

> **Who found this.** Protocol discovery for the BRX platform is the work of **LaserTagMods** (JEDGE / JBOX). This page restates their findings independently, with our own bench verification.

**Transport by generation**

| Generation | Link | Speed | How you connect |
|---|---|---|---|
| Gen1 | Bluetooth Classic (SPP) | 57600 baud | Pair an HC-05 module (PIN `0001`, master role). The headset must be connected for Bluetooth to function. |
| Gen2/3 | BLE (Nordic UART Service, NUS) | UART bridge at 115200 behind the radio | Connect from any BLE central: laptop (bleak), ESP32, phone. No pairing/PIN. |
| Any | Hardware UART inside the gun | 115200 | What JEDGE drives directly (`Serial1`). No external accessory port exists on the BRX. A wired tap means opening the gun. Untested by us. |
| Any | Micro-USB "Programing Port" | USB CDC (baud ignored) | **Not** the `$` protocol. It is a separate `QUERY`/`SETUP` console. See the USB serial console section. |

**BLE: Nordic UART Service UUIDs**

| Item | Value |
|---|---|
| Service | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX characteristic (**write** to tagger) | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| TX characteristic (**notify** from tagger) | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |
| Advertised name | `Tactix-XXXX` (the last two bytes of the BLE MAC). The NUS service UUID **is** present in the advertisement, so scan-time generation detection works. |
| ATT MTU | Negotiates to **23 bytes**. Chunk writes to ~20-byte payloads. This is required, not defensive. |
| Round trip | `$PING,*` to `$PONG,*` is about 59 ms over BLE. |

> **Generation detection heuristic.** Power on the tagger and run a BLE scan. If it advertises the UART service it is Gen2/3. If nothing appears on BLE but the device pairs over Bluetooth Classic it is Gen1.

**Frame anatomy**

```text
$ + COMMAND + (, + token)* + ,*
```

- ASCII, comma-delimited tokens. Starts with `$COMMAND`, ends with `,*`.
- **Empty tokens are legal and meaningful**: consecutive commas mean "leave unchanged / not applicable". `$SPAWN,,*` (one empty token) is a different command from `$SPAWN,*`.
- Example: `$PING,*` replies `$PONG,*`.
- Tokens may not contain a comma, `*` or a line break (that is the validator in `protocol.py`: `^\$[A-Z0-9!]+(,[^,*\r\n]*)*,\*$`).
- Notifications can arrive merged (`$ALCD,…$BUT,0,1,*`); split on the next `$` as well as on `*`.

**Waking a gun and holding the link**

1. Connect and subscribe to the TX notify characteristic. Establishing a link is **intermittent** (the official app behaves the same) and the link holds once it is up. Retry. That *is* the fix.
2. On a **fresh power-up**, send `$STOP,*` then `$PHONE,*` (after a power-cycle `$PHONE,*` alone wakes it). A just-booted gun ignores a bare `$VERSION,*` until then.
3. `$PHONE,*` opens the **event tap**: the gun says "phone connected", answers `$BUT,3,0,*`, streams button events and `$VOLTS` telemetry, and locks its on-gun menu until a game is configured or it is power-cycled.
4. Idle taggers are **silent**: outside app mode no unsolicited messages are sent, so no button, trigger or hit traffic.
5. The official app's connect ritual (captured, fw v4.32) is `$STOP,*`, `$PLAYX,0,*`, `$VOL,69,0,*`, `$PLAY,VA20,3,6,,,,,*` ("connection established"), then once per session `$NAME,<name>,*` plus `$VERSION,*`. It never sends `$PHONE,*`.
6. **The headset must be linked** or the gun will connect, answer a quick `$PING`, then drop within seconds and echo nothing to config. After a gun-initiated `$DISCONNECT,*`, back off at least 5 s before reconnecting.

> **The safety model.** Three layers, in order of what they protect:
>
> 1. **Firmware is never written**, so a power-cycle always restores a tagger.
> 2. **A host refuses malformed frames** and requires an explicit confirm for any command outside the known-safe list (below).
> 3. **The panic sequence** `$CLEAR,*` then `$SP,99,*` silences and stops a gun.
>
> The panic sequence leaves the gun with **no `$SIR` table, so it cannot be hit** until it is re-armed or power cycled. That is intended for a panic stop and must not be mistaken for a playable state. Battle Company's official USB updater is the factory-restore path.

```python
# The known-safe list enforced by brx-mcp (mcp/brx_mcp/protocol.py).
# Everything else needs confirm=True. That is the host's safety rail, not a tagger limit.
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

> **Volume.** `$VOL,30` is kind to ears on a bench but **measurably inaudible for weapon and game audio**; `$VOL,45` is barely audible. Open BRX plays at **80 indoors / 90 outdoors** (`compile.play_volume()`). The iOS app's 69 measures as roughly on-gun level 2 and was inaudible on a field (2026-08-30). Try-outs stay at 69.

### Is the baud rate real over BLE?

No. BLE has no baud. 115200 is the UART behind the radio bridge. That is why BLE and a wire speak identical frames.

### Why does my client drop at ~6.6 s?

The link *holds* fine once up (80 s+ sessions with the official app, multi-minute sessions with ours). Establishment is intermittent; retry in a loop. If it dies within seconds *and echoes nothing to config*, the headset is not linked.

### Can a command brick the gun?

Nothing in the protocol writes firmware. Every state written over BLE is wiped by a power-cycle (except `$NAME`, which persists).

## Command reference

Every command we know of, with args and meaning: host to tagger, tagger to host, and headset. Copy the frames exactly as written.

> **How to read the tables.** "Direction" is host to gun (`>>`) or gun to host (`<<`). Some commands were sent and received on hardware; others carry field names taken from the Callsign app's IL2CPP metadata (names certain, wire position = declaration order) or come from LaserTagMods sources and community captures without being reproduced by us. Each row says which. Commands the app knows but we have never sent sit in their own table at the end of this section. Where a command's field map has its own section (`$WEAP`, `$GSET`/`$PSET`, `$SIR`), the row says so.

**Host to tagger: lifecycle and configuration**

| Command | Dir | Args | Meaning |
|---|---|---|---|
| `$PING,*` | >> | n/a | Connectivity check. Reply `$PONG,*`. |
| `$STOP,*` | >> | n/a | Stop. First frame the official app sends on every (re)connect; also part of the end-of-game tail. |
| `$PHONE,*` | >> | n/a | App-controlled mode: opens the live event tap (buttons, `$VOLTS`), locks the on-gun menu. Reply `$BUT,3,0,*`. |
| `$CONNECT,*` / `$INIT,*` | >> | n/a | On the known-safe list. Sent on v4.32: **no observable reply**. |
| `$CLEAR,*` | >> | n/a | Clear current game state. First frame of every arm sequence; half of the panic sequence. **It also wipes the `$SIR` table**, and because unmatched `$SIR` cells are silently ignored, a gun left with no rows ignores every hit while still reporting alive: no `$HIR`, no headset flash, pools untouched. Always re-send `$SIR` after `$CLEAR`. |
| `$START,*` | >> | n/a | Begin the configuration sequence. Gun echoes `$LCD,0,0,0,0,0,0,*`. |
| `$GSET,…,*` | >> | 8 tokens | Global game settings: friendly fire, indoor/outdoor, region, ambient light, gyro, BT secondaries, crit modifier, mods. **No respawn/time/lives token.** See the `$GSET` and `$PSET` section. |
| `$PSET,…,*` | >> | id, 0, HP, armor, shield, 50, , voice-pack… | Player settings: **token 1 = player id (0-63)**, tokens 3-5 = HP/armor/shield pools, then a positional voice pack. See the `$GSET` and `$PSET` section. |
| `$WEAP,<slot>,…,*` | >> | slot 0-5 + ~43 tokens | Define a weapon in a slot: damage, fire interval, fire mode, clip/reserve, reload, sounds, IR type. See the `$WEAP` section. |
| `$SIR,<proto>,<subtype>,<sound>,<fn>,p5,p6,p7,p8,*` | >> | 8 tokens | Incoming-IR effects matrix: what an IR word with protocol B / subtype U does to this gun. **Unmatched cells are silently ignored.** See the `$SIR` section. |
| `$BMAP,<button>,<function>,<swap0..3>,*` | >> | button id, function, 4 swap slots | Remap physical controls. Buttons: 0 trigger, 1 alt-fire, 2 reload handle, 3 select, 4 left, 5 right, 8 gyro. Functions seen: 0 fire, 97 reload, 98 (select/left/right), 100 weapon-cycle, 4 melee (gyro). **Mandatory**: without it the trigger only chirps "disabled". |
| `$TID,<team>,*` | >> | team | Team id. **Masked to 2 bits** (`team & 3`), giving four native teams 0-3. Drives the gun LED colour at `$SPAWN` (1 = blue, 2 = yellow observed) and is echoed as `$HIR` token 4 on the victim. A live write changes hit resolution immediately but does not repaint LEDs. |
| `$SPAWN,,*` | >> | **one empty token** | **Go-live** and **respawn**. Restores HP/armor and (on respawn) ammo; echoes `$LCD,<hp>,<armor>,0,0,<mag>,<reserve>,*`. Also clears the `$SIR` fn-23 state (`$ALCD` token 2 back to 100). `$SPAWN,*` (no empty token) is not the same command. **Leave at least 3 seconds after a death before respawning**, or the headset stays stuck in the green out-blink. |
| `$AMMO,<slot>,<mag>,<reserve>,<flag>,*` | >> | slot, magazine, reserve, 1 | Load magazines. Must follow `$SPAWN` at initial go-live or the gun is live with no ammunition. e.g. `$AMMO,0,36,108,1,*`. A bare `$WEAP` re-push resets ammo to the frame's baked values. Re-send `$AMMO` after any weapon swap. |
| `$PLAYX,0,*` | >> | 0 | Stop/clear sound playback. Sent right after `$STOP` on connect and just before the go-live cue. |
| `$PLAY,<sound>,<vol>,<prio>,<announcer>,,,,*` | >> | 8 tokens | Play a sound id (2,477 on the gun; see docs/reference/sound-catalog.md for what each one is). **Two independent slots**: token 1 = local/effect sound, **token 4 = announcer/voice channel**. `$PLAY,,4,6,V3A,,,,*` speaks "kill" with token 1 empty; `$PLAY,VSF,4,6,JAY,,,,*` uses both. **Tokens 2-3 are required**: `$PLAY,VA33,,,,,,,*` is silent, `$PLAY,VA33,4,6,,,,,*` speaks. Numeric values vary by client (`3,9` Android app, `3,6` iOS, `4,6` JEDGE). APK field names: soundName, addToQue1, addToQue2, loopingTime, stun, isNeedQueue. |
| `$VOL,<0-100>,<n2>,*` | >> | volume, 0 | Master volume. Android app sends `$VOL,100,0,*`; iOS `$VOL,69,0,*`. 30 is inaudible for game audio. Open BRX plays at 80 indoors / 90 outdoors; try-outs at 69. |
| `$NAME,<name>,*` | >> | name | Sets the gun's **persistent** name (the USB `Gun Name` field; survives power-cycle). Opening the official app rewrites it to `Tactix2`. |
| `$VERSION,*` | >> | n/a | Query firmware. Reply `$VERSION,v4.32,?,4,,devhost.03,*`. Token 2 is the **headset** firmware (`hds.59`) when a headset is linked. |
| `$SP,<n>,*` | >> | n | End-of-game / stop. `$SP,99,*` is the second half of the panic sequence. Do not probe it mid-game hoping for a score. The gun keeps none. (LaserTagMods / community.) |
| `$QUERY,*` | >> | n/a | Over BLE returns a `$`-framed status array (`$QUERY,0,0,0,0,0,,1,0,,0,…`) plus a `$LCD`. **Not** the USB device record (that is USB-only; see the USB serial console section). |

**Host to tagger: in-game effects, feedback and pools**

| Command | Dir | Args | Meaning |
|---|---|---|---|
| `$SFLASH,*` | >> | n/a | **The shooter's green-sight kill-confirm flash.** The host sends exactly one per kill the holder scores, ~0.4 s after the trigger burst ends. (The APK lists it under notifications; on the wire the phone sends it.) |
| `$LIFE,<hp>,<armor>,<shields>,*` | >> | addedHP, addedArmor, addedShields | Grant health. **Additive, clamped at the pool max**, not an absolute set. Writes do not self-emit `$HP`; the new value shows on the next hit/HUD refresh. |
| `$BUMP,<hp>,<armor>,<shields>,*` | >> | hP, armor, shields | Adjust current pools. Same additive/clamped behaviour as `$LIFE`. |
| `$BHIT,<damage>,<isCrit>,<powerLevel>,*` | >> | damage, isCriticalShot, powerLevel | Four shapes sent on v4.32: each was echoed and **applied no damage**. |
| `$HFIRE,…,*` | >> | Range, CountIRPulses, RateOfFire, FlashLED | Five shapes sent on v4.32: **zero IR emitted** (receiver control passing before and after). |
| `$IRTX,…,*` | >> | iRPower, soundOnHit, rangeOutdoor, rangeIndoor | Five shapes sent on v4.32: **zero IR emitted** (receiver control passing before and after). |
| `$MELEE,<intensity>,*` | >> | intensity | `$MELEE,255,*` returns `$BUT,4,0,*` and fires no IR. |
| `$STUN,*` | >> | n/a | Listed in the APK. **Proven no-op over BLE.** |
| `$GLED,<led1>,<led2>,<led3>,<apply-gate>,<brightness>,,*` | >> | three LED colours | **Gun LED colour, per LED.** Tokens 1 to 3 are the three body LEDs, each a direct palette index. The palette is nine colours: **0 red, 1 blue, 2 yellow, 3 green, 4 purple, 5 teal, 6 white, 7 pink, 8 orange**; 9 and 10 are dark. **Token 4 is an apply gate**, not an effect enum and not an off switch: it decides whether the colour tokens in the same frame take effect at all. Values **0, 6, 7, 8, 9 and 10 apply** the colours at full brightness. Value **5 turns the LEDs OFF**, whatever the colour tokens say. Values **1, 2, 3 and 4 are no-ops**: the colour tokens are ignored and the gun keeps whatever it was already showing, which is why a sweep of this token reads differently depending on whether it blanks between rows. No token-4 value animates. `$GLED,,,,5,,,*`, the frame Callsign itself sends on death, blanks the gun because **token 4 = 5 is the off value**. Token 4 = 5 is therefore the one gate value never to send with real colour tokens: it discards them. Sending the blank once takes the strip out of the firmware's breathing loop for the rest of the life, and it is **mandatory before any paint holds**: a dark paint sent without a prior blank is simply overwritten by the breathing. It is idempotent, and after it every revert should be a dark PAINT (`$GLED,9,9,9,0,10,,*`) rather than another blank. Empty colour tokens under an applying gate leave each LED showing whatever it already had, so one segment can be repainted without redrawing the others. Token 5 is brightness and is the ONLY brightness control: 0 off, 1 dim, 2 and above full, saturating at 2 so that 2 through 255 are indistinguishable. It is **global**, applying to all three LEDs at once, so a bar of two bright segments and one dim one is not possible; a partial step has to be a blinking segment instead. Token 5 = 1 is what night mode uses. A held paint survives ordinary game traffic (`$AMMO`, `$PLAY`, `$HLED`, `$LED`) untouched, and keeps its hue at the dim setting. On a spawned gun the set colour alternates with the team colour, because a spawned gun is also using these LEDs as its own health gauge. Verified on the bench 2026-08-30: a gun held on team 1 took six different colours on command, and `$GLED,3,2,1,0,10` was predicted and confirmed as green, yellow, blue. Palette completed on 2026-09-02 with a camera rig, and token 4 re-measured the same day from a known lit start, three trials per value; normalised R/G/B signatures, all three LEDs agreeing on every row: 0 = 1.00/0.16/0.26, 1 = 0.19/0.59/1.00, 2 = 0.88/1.00/0.59, 3 = 0.18/1.00/0.54, 4 = 0.59/0.49/1.00, 5 = 0.23/1.00/0.85, 6 = 0.73/0.79/1.00, 7 = 1.00/0.30/0.66, 8 = 1.00/0.38/0.30. The camera separates the indices from each other; it does not name absolute hues, so the reading rests on relative separation measured back to back under identical conditions, on three LEDs agreeing, and on a match with an independent community source. **Corrected 2026-09-07:** that 2026-09-02 pass read token 4 = 5 as "about one third brightness", which was wrong. It was measured while the firmware's own breathing was still contending for the strip. Re-run on a blanked, host-owned strip, alternating `$GLED,3,3,3,0,10` against `$GLED,3,3,3,5,10` four times, it is bright then off with no step in between. Token 5 was A/B tested the same way and is the real dimmer. **Do NOT repaint this at speed to hold a colour against the gun's own animation**: it takes roughly 30 writes a second to win, and the result strobes. Flicker in the 10 to 25 Hz band is the photosensitive epilepsy trigger range. Signal an event with a short burst of three flashes instead. |
| `$GREN,…,*` | >> | iRType, crit, modifier, indoorMode, operationMode, channel, GrenadeType, MaxCount | Smart Grenade configuration frame, addressed to the **gun**. GrenadeMode enum: FlashBang / Gas / Confusion / Molotov. Sent on the bench: the gun emitted IR, but the emitted bits did not track the arguments. |
| `$PBGAME,$PBTEAM,$PBWEAP,$PBPERK,$PBLIVES,$PBTIME,$PBSPAWN,$PBINDOOR,$PBLOCK,$PBSTART` | >> | enum index | The **"playbook"** pre-battle family mirroring the on-gun menu. A second remote-start path captured on fw **v4.30** (`$PBGAME,0` = FFA, `$PBWEAP,0` = M4 AUTO, `$PBPERK,2` = Body Armor, `$PBLIVES,2` = 5 lives, `$PBTIME,5` = infinite). `$PBWEAP,0,*` produced a "game starting" reload sound on our v4.32. (Community.) |
| `$DD,<killerId>,<killerTeam>,<victimId>,<nonce>,*` | host to host | n/a | JEDGE's **device-to-device** kill notification. A host-side convention, not a tagger command. (Community.) |

**Headset commands (host to gun to headset)**

| Command | Args (APK) | Meaning |
|---|---|---|
| `$HLED,<colour>,<effect>,,,,,*` | LedColorType (White, Pink, Orange; plus green via `isUsedGreenLed`), BlinkLoopType (Once, ThreeTimes, Infinite), LedEffectType (incl. Heartbeat) | Headset LED. `$HLED,,6,,,,,*` is sent in the app's end-of-game tail and in the lobby. **Effect 6 is the blank, and sending it disables the firmware's own death-flash loop for the rest of that life** (bench 2026-09-07). A colour write does not. Never send it during play: the flash it removes is the brightest signal a downed player has, and nothing reports that it is gone. Use colour index 9 for a dark headset in play instead. Token 1 is a colour index sharing the gun's palette for 0 to 7 (0 red, 1 blue, 2 yellow, 3 green, 4 purple, 5 teal, 6 white, 7 pink); the two devices diverge at 8, which reads red on the headset and orange on the gun. 9 and 10 are dark. Measured 2026-09-02 with the camera rig, all visible headset modules agreeing. |
| `$HLOOP,<mode>,<period_ms>,*` | a, b | Drives the headset's small flash LED as a repeating loop, at the firmware's own drive level. `$HLOOP,2,750,*` on a downed player flashes it at about the rate the stock down signal uses, and an operator judged it at least as bright as native. `$HLOOP,0,0,*` stops the loop and is what the app sends about 1.7 s after every death. `$SPAWN` also clears it. It restores the flash even on a life where an `$HLED` blank had suppressed it. Rates of 750 and 2000 ms both work; the usable ends of the range are not measured. |

**Tagger to host: events and echoes**

| Message | Fields | Meaning |
|---|---|---|
| `$PONG,*` | n/a | Reply to `$PING`. |
| `$VERSION,<gun fw>,<headset fw>,<n>,,<host image>,*` | e.g. `v4.32,?,4,,devhost.03` | Version reply; token 2 reads `hds.59` with a headset linked, `?` otherwise. `devhost.*` = developer/host image. |
| `$DISCONNECT,*` | n/a | Gun-initiated disconnect notice (e.g. the moment its headset is switched off). |
| `$VOLTS,<pack_mV>,<cell_mV>,<t3>,<t4>,*` | e.g. `7662,3921,55,70` | Battery telemetry, about every 30 s in app mode. Token 1 = pack millivolts (7.662 V), token 2 = cell millivolts (3.921 V). Tokens 3-4: (unknown). |
| `$LCD,<hp>,<armor>,<t3>,<t4>,<mag>,<reserve>,*` | e.g. `45,70,0,0,36,216` | **Health/armor HUD echo.** `$START` gives all zeros; `$SPAWN` gives pools plus the current weapon's ammo; death gives `$LCD,0,0,0,1,1,1,*`. Tokens 3-4: (unknown). A zeroed `$LCD` after `$SPAWN` means "no config loaded" (post power-cycle tell). |
| `$ALCD,<mag>,<t2>,<slot>,<reserve>,<heat>,*` | e.g. `36,100,0,108,0` | **Ammo/weapon HUD stream.** Per-round during fire *and* reload (mag 0, 1, 2 and up as reserve drains). Token 2: (unknown). It reads 100 in normal play and drops to 0 after a `$SIR` fn 23 hit. Token 3 = weapon slot. Token 5 = **weapon heat** (0-100+, only on overheat weapons). Only streams on ammo events. Silence is not "no change". |
| `$HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,*` | e.g. `4,0,19,2,9,0,3` | **Hit received.** See the events section for the full decode. |
| `$HP,<hp>,<armor>,<shield>,*` | e.g. `43,0,0` | Pools after a hit; arrives in the same millisecond as its `$HIR`. `$HP,0,0,0` = death. |
| `$BUT,<id>,<state>,*` | id 0-5, state 1 press / 0 release | Physical button event (ids match `$BMAP`). Streams only in app mode. `$BUT,4,0` is also returned by `$MELEE`. |
| `$QUERY,…` | ~11 `value,,` pairs | Status array in reply to BLE `$QUERY,*`. |
| `$WEAP` / `$PERK` / `$HS` | n/a | Selection echoes from the on-gun menus (LaserTagMods). |

**Seen in the app's vocabulary, not exercised by us.** These are facts about the Callsign app's request namespace only. On-tagger behaviour has not been observed.

| Command | Direction | APK fields / enums | Note |
|---|---|---|---|
| `$VIB` | >> | `isEnableVibration` | Never sent by us. |
| `$ZOOM` | >> | n/a | Never sent by us. |
| `$FSET` | >> | ~38 event to sound slots: ActionKey, DeathAlarm, TickTock, HitHp, HitArmor, HitShield, HitCrit, EmpStart/Loop/End, IncendiaryStart/…, TearGasHit, … | Never sent by us. |
| `$ASSIST` | >> | `soundName` (+ SetVolume) | Never sent by us. |
| `$DLC` / `$ASKDLC` to `$GOTDLC` | >> / << | `hiddenFeatures` | The app's premium-content (BattleCoins) handshake. The metadata names three premium modes: Generals, Commanders, Swarm. Never sent by us. |
| `$BLINK` · `$CHASE` · `$LED` | >> (headset) | n/a | Listed with the headset commands. Never sent by us. |
| `$TIME` | << | n/a | Listed as a notification. Never observed on the wire. |

> **Complete vocabulary from the app's own request namespace.** AMMO ASKDLC ASSIST BHIT BMAP BUMP CLEAR DLC FSET GLED GREN GSET HFIRE IRTX LIFE MELEE NAME PLAY PLAYX PSET SIR SPAWN START STOP STUN VERSION VIB VOL WEAP ZOOM · headset BLINK CHASE HLED HLOOP LED · notifications ALCD BUT GOTDLC HIR HP LCD SFLASH TIME VERSION VOLTS. `$PING`, `$TID`, `$SP`, and the `$RV`/`$RP`/`$UR`/`$KK`/`$DD` family are **not** in it. They come from LaserTagMods and our bench. Absence from the app does not mean non-existent.

## The arm sequence: from `$CLEAR` to a live gun

The exact frame order that takes a tagger live, respawns it, and ends the game. Send these frames in this order. We captured the order from the official app and reproduced it with our own host.

> **The headset is a second device and it needs time.** A command that the tagger must relay to the headset is received, processed and executed there, not instantly. Send `$SPAWN` within about 2 seconds of a death and the headset never executes it: it stays stuck flashing the green out-blink while the gun is alive and registering hits normally, so the player looks dead while playing normally. Measured 2026-09-02: gaps of 1.0 s and 2.0 s stick, and 2.5 s, 3.0 s and 6.0 s are clean. **Leave at least 3 seconds.** The same applies to anything else with a headset side effect, such as `$HLOOP` and `$HLED`. Note the gun queues commands and drains them one at a time, so a frame echoing back proves the gun received it, not that the headset executed it.

> **`$CLEAR` wipes the `$SIR` table and the gun then ignores every hit.** This is the single most confusing failure mode we have found: the gun arms, spawns, reports full pools, answers `$QUERY` normally and looks perfectly healthy, while every shot that reaches it is discarded. There is no `$HIR`, the headset stays dark, and the pools never move, so it presents as a broken headset or a dead sensor. It is neither. The `$SIR` matrix decides what an incoming IR word does to this gun, unmatched cells are silently ignored, and after `$CLEAR` there are no cells at all. Re-sending the `$SIR` rows alone restores it immediately. Bench-proven 2026-09-02: deterministic 5/5, and independent of how long you wait between `$CLEAR` and `$SPAWN` (tested 0.05 s to 1.0 s). Note the table SIZE does not matter, only its absence: a one-row table and the full ten-row table both registered 24/24 in an interleaved A/B.

> This sequence is the official iOS app driving a live game on firmware v4.32, reproduced byte-for-byte on real taggers. Three pieces are easy to leave out, and the gun spawns wrong without them: **`$AMMO` after spawn**, **`$BMAP` before *and* after spawn**, and the **empty token in `$SPAWN,,*`**.

```text
$CLEAR,*
$START,*
$GSET,1,0,1,0,1,0,50,1,*
$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*
$WEAP,0,...                (primary)
$WEAP,1,...                (secondary)
$WEAP,4,...                (melee, always sent)
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

**What the gun echoes back**

| After | Echo | Meaning |
|---|---|---|
| `$START,*` | `$LCD,0,0,0,0,0,0,*` | Cleared state |
| `$SPAWN,,*` | `$LCD,45,70,0,0,36,216,*` | Live: HP 45, armor 70, mag 36, reserve 216 (this config) |
| each shot | `$ALCD,35,100,0,108,0,*` … | Mag decrementing, slot 0, reserve, heat |
| each trigger | `$BUT,0,1,*` / `$BUT,0,0,*` | Press / release |
| ~30 s | `$VOLTS,7634,3770,53,45,*` | Telemetry continues in-game |

> **The config head is silent and safe.** Writing `$CLEAR` through `$TID` without `$SPAWN` plays nothing, and **a configured-but-unspawned gun ignores IR**: no `$HIR`, no `$HP`. "Get some" and the cocking sound belong to `$SPAWN`. A head held unspawned for about 2 minutes then spawned went live with config intact.

**Death and respawn are host-driven**

1. Victim reports `$HP,0,0,0,*` then `$LCD,0,0,0,1,1,1,*`. The gun does **not** revive itself, and a dead gun's trigger produces `$BUT` events but no `$ALCD` decrement (it cannot fire).
2. The app sends `$HLOOP,0,0,*` about 1.7 s after death.
3. After the game's respawn delay (the app's own timer, about 10 s in the capture; community reports a per-death ramp capping at 45/90 s) the host sends `$SPAWN,,*`.
4. Gun echoes `$LCD,45,70,0,0,36,216,*`: HP, armor **and ammo** restored with no `$AMMO` needed.
5. **A dead gun ignores all incoming IR**: 448 distinct words, including every grenade-beacon shape, failed to revive one. Only the host can.

> **After a BLE drop, re-send the whole head.** Re-sending the full sequence (`$CLEAR`, `$START`, …, `$SPAWN,,*`, `$AMMO`) on a fresh link brought a gun back in every bench case.

```text
# Clean end-of-game, as the official app does it (note the ~3.9 s settle before the last $PLAY):
$VOL,69,0,*
$HLED,,6,,,,,*
$STOP,*
$CLEAR,*
$PLAY,VSF,4,6,JAY,,,,*     # victory sting (slot 1) + "victory" announcer (slot 4); solo game: $PLAY,VS6,4,6,,,,,*
```

### Do I need the reload-handle pull?

No. The manual's reload-handle pull is the *local* start; `$SPAWN,,*` is the *remote* one. Both exist.

### Where do respawn time, game time, lives and score-to-win go?

Nowhere on the gun. Three captures at respawn 5/15/30 s gave byte-identical `$GSET`/`$PSET`. Your host keeps the clock.

### Is the second `$BMAP,0,0` (after `$SPAWN`) needed?

Yes. Omit it and the trigger is dead.

## `$WEAP`: the weapon definition

Forty-odd comma-separated tokens make a weapon out of data: damage, cadence, fire mode, ammo, sounds, IR type. This section maps every token.

> **A weapon is data, not firmware.** The gun has no weapons baked in; the host sends a full `$WEAP` frame into one of **six slots (0-5)**. The field *names* come from the Callsign app's metadata (declaration order = wire order); the *positions and meanings* below were then pinned by capturing the 19 stock weapons (20 frames) with the operator naming each one, and by flipping single tokens on a live gun.

```text
# Two known-good frames (slot 0 Assault Rifle, slot 1 Charge Rifle):
$WEAP,0,,100,0,0,24,0,,,,,,,,100,850,32,32768,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,9999999,75,,*
$WEAP,1,,100,8,0,150,0,,,,,,,,1250,850,100,32768,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,C19,C04,20,150,100,9999999,75,,*
# A captured Shotgun (slot 1): the only stock weapon with the extra-headset block populated:
$WEAP,1,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*
```

**Token map** (0-indexed: `$WEAP,<t0>,<t1>,…,*`; the slot is t0)

| tok | Field | AR | Charge Rifle | Meaning |
|---|---|---|---|---|
| 0 | slot | 0 | 1 | Weapon slot 0-5. Slot 4 = melee by convention (gyro swing, `$BMAP,8,4`). |
| 1 | slotType / mode flag | n/a | n/a | `2` on exactly the three weapons carrying an extra-headset payload (t12/t13/t42 populated); `1` on melee; `0` rail gun; empty otherwise. Not fire mode. |
| 2 | n/a | 100 | 100 | (unknown) |
| 3 | primaryDamageType | 0 | 8 | **The IR word's B field / `$SIR` protocol key.** Writing a type here is echoed by the victim in `$HIR` token 2 and selects its `$SIR` row. DamageType enum: 0 Standard, 1 MedicHeal, 2 ActivateShield, 3 RallyPulse, 4 Radiation, 5 Cryogenic, 6 ArmorPiercing, 7 EMP, 8 Shrapnel, 9 StickyBomb, 10 StandardLethalExplosive, 11 NonLethalExplosive, 12 ShottyPellets, 13 MeleeDamage, 14 Plasma. Stock: 8 charge, 10 rocket, 11 gas, 13 melee. The wire position is bench-proven; the enum names come from the APK. |
| 4 | primaryPowerType | 0 | 0 | IRSource enum: DeviceCommand, IRSource, GunLaser, HeadSetOnly, GunAndHead, DoubleGun, DoubleGunAndHead, DRY_FIRE, MuzzleFlash, MuzOnly, VibOnly, MuzAndVib. Order relative to t3 was settled by t3 behaving as damageType. |
| 5 | primaryDamage | 24 | 150 | **The raw magnitude put in the IR word** (= `$HIR` token 5). Applied damage depends on the victim's `$SIR` row. The stock AR actually emits 9; the sample's 24 is the manual's stale anchor (protocol/brx-protocol.md §6). |
| 6 | primaryCriticalChance | 0 | 0 | Crit chance. 0 on every stock weapon; the IR crit bit *can* be set (applies `$GSET` t7, ×1.5 at the shipped t7=50). |
| 7-11 | secondaryFireChance, secondaryDamageType, secondaryPowerType, secondaryDamage, secondaryCriticalChance | n/a | n/a | **Dormant**: empty on all 20 captured stock frames. No stock BRX weapon has a secondary fire mode. |
| 12 | extraHeadsetDamage | n/a | n/a | Populated with t1=2: Shotgun 70, Rocket 115, Plasma Sniper 80. |
| 13 | extraHeadsetRangeOutdoor | n/a | n/a | 80 on the same three weapons. |
| 14 | **fire interval / charge time (ms)** | 100 | 1250 | **Proven by one-field flip**: a sniper with t14=1250 slowed to one shot every 1.25 s (timed by ear as roughly one per second). Stock cadences read from the captured frames: burst 75, SMG 90, AR 100, sniper 300, AMR 360, launcher 360, shotgun 900, melee 1000, rail gun 1200, charge rifle 1250. For charge weapons this is the hold time. |
| 15 | weaponSwapDelay | 850 | 850 | Weapon-swap delay in ms: how long after an ALT (weapon-cycle) press the gun refuses to fire while it draws the other weapon. Bench 2026-09-04: 1700 doubled the swap, 425 halved it, 100 ran at 100; linear with no floor. The gun uses the larger of the two loaded slots' values in both directions, so a fast pistol paired with a rifle draws at the rifle's speed. Melee ships 100. |
| 16 | maxClip | 32 | 100 | Magazine size. |
| 17 | maxAmmo | 32768 | 32768 | Always `2 × t40` in captured frames (or 32768 as an unlimited flag). Not an independent knob. |
| 18 | reloadSpeed (ms) | 1400 | 2500 | Reload time. |
| 19 | n/a | 0 | 0 | (unknown) |
| 20 | **fire mode** | 0 | 14 | **Proven by one-field flip**: `0` full-auto, `7` single-shot/bolt, `9` burst (cycle in t23), `2` charge, auto-release (tap = weak shot), `3` hold-to-charge, auto-fire (tap = sound only), `14` tap-fire OR charge-release, `13` melee. |
| 21 | maxAccuracy | 100 | 100 | |
| 22 | singleShotAccuracy | 100 | 100 | |
| 23 | burstWeaponTime (ms) | n/a | n/a | Burst cycle: 275 Burst Rifle, 250 Force Rifle, empty on everything else. |
| 24 | overheat (heat per shot) | 0 | 14 | SMG 5, Energy Rifle 6, Charge Rifle 14, Plasma Sniper 30. **Inert unless t37/t38 are set.** |
| 25 | n/a | n/a | n/a | (unknown) |
| 26 | n/a | n/a | n/a | (unknown) |
| 27 | primaryFire_SoundName | R01 | E03 | Fire sound id. **A sound, not an identity**. Rocket Launcher and Rail Gun both fire `C03` with different stat lines. |
| 28 | extra action sound A | n/a | C15 | Engage sound. `C…` ids = charge (rail gun C08, laser cannon C11, charge rifle C15); `D…` ids = extra reload parts on five-part reloads (sniper/AMR/force rifle D20, ion sniper D32). |
| 29 | extra action sound B | n/a | C17 | Release sound. Present exactly when the weapon has a distinct release event (charge rifle C17, bolt weapons D19/D31); absent on auto-firing chargers. |
| 30 | secondary_Mix_SoundName | n/a | n/a | |
| 31 | reloadPart1_SoundName | D04 | D30 | |
| 32 | reloadPart2_SoundName | D03 | D29 | |
| 33 | reloadPart3_SoundName | D02 | D37 | |
| 34 | noAmmo_SoundName | D18 | A73 | |
| 35 | weaponFeatureA | n/a | C19 | **Overheat sound** (SMG D11, CR C19, Plasma Sniper/Energy Rifle D122). |
| 36 | weaponFeatureB | n/a | C04 | Second feature sound. |
| 37 | overheat param A | n/a | 20 | **Gate for the overheat system** (with t38): transplanting `20,150` onto the SMG brought its dead heat gauge alive (28 to 52 through a mag dump) and the trigger gated at the top like an empty clip. At these values the 72-round magazine empties before a hard lockout. |
| 38 | overheat param B | n/a | 150 | See t37. |
| 39 | clipStartingAmmo | 32 | 100 | Equals t16 in every captured frame. |
| 40 | ammoReserv | 9999999 | 9999999 | Reserve; 9999999 = unlimited. `t17 == 2 × t40` in stock frames. |
| 41 | gunRangeIndoor | 75 | 75 | **The gun's INDOOR IR range**, as a percent. The APK field order places `gunRangeIndoor` here, between `ammoReserv` (t40) and `extraHeadsetRangeIndoor` (t42), and it reads 75 on all eighteen guns and **20 on melee**, which is the direction physics demands. `$GSET` token 2 selects whether the indoor or outdoor profile is live. **Lowering this is the most promising route to a weaker indoor beam** for tight spaces where bounced IR registers hits. Untested on the bench. |
| 42 | extraHeadsetRangeIndoor | n/a | n/a | The **headset's** indoor range, separate from the gun's (t41). 30/30/40 on the three t1=2 weapons, blank elsewhere. There are four range fields in all: gun and headset, each with an indoor and an outdoor value. |

> **Two positions to get right.**
>
> 1. The metadata's field order has `rateOfFire` before `weaponSwapDelay`, but the wire has the *rate* at **t14** and the constant 850 at t15. A compiler that trusts the field order ships every weapon at 10 shots/s.
> 2. Keying weapons by their fire sound (t27) silently merges distinct weapons. The Rocket Launcher and the Rail Gun both fire `C03`.

**Stock weapon signatures** (fire sound to weapon to behaviour, as named by the operator at capture)

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

> **Overheat is a balance lever on any weapon.** Set t24 (heat per shot), t35 (overheat sound) and t37/t38 (enable/params, stock `20,150`), and the live heat gauge streams in `$ALCD` token 5, climbing about 8 per shot on the Charge Rifle, crossing 100 into lockout and decaying on idle. A HUD heat bar needs no new protocol.

### Can I build a semi-auto rifle?

Yes. Set `$WEAP` t20 to `7`: one shot per trigger pull. The Shotgun and the Rocket Launcher both
ship that way.

### What bounds a custom weapon?

The firmware's behaviour vocabulary: the DamageType and PowerType enums, ReloadType, six slots, and the 2,477 on-gun sound ids. Any *combination* with arbitrary numbers is buildable; a brand-new damage *behaviour* is not.

### Does a `$WEAP` re-push mid-game keep the ammo count?

No. It resets mag/reserve to the frame's values. Re-send `$AMMO`.

## `$GSET` and `$PSET`: game and player settings

These two frames set the on-gun rules and the player's pools, identity and voice pack.

**`$GSET,<t1>,…,<t8>,*`**, validated against the captured `$GSET,0,0,1,0,1,0,50,1,*`

| # | Field | Captured | Meaning |
|---|---|---|---|
| 1 | friendlyFire | 0 / 1 | **Firmware-enforced, both directions.** 0 blocks same-team damage *and* heals from enemies; 1 opens the gate. Replicated twice with alternating values plus control. |
| 2 | outdoorMode | 0 | The **indoor/outdoor** setting, the same one the gun toggles natively on a 3 second ALT hold. Outdoor raises IR range, hit-LED brightness and blast radius; indoor shrinks them. See [Operating the BRX](/manual/operate). Field name and mapping are APK-decoded; **setting it over BLE and observing the change is untested**. |
| 3 | gunLaserRegion | 1 | **IR transmit power, as a regional legal limit** (USA vs International). This is the one field that looks like a direct power control, so it is the first thing to try if you want a weaker beam for indoor play. APK-decoded; **untested on the bench**, and whether it is two coarse levels or finer is unmapped. |
| 4 | autoAmbientLight | 0 | APK field name. The user guide describes a sunlight IR-noise filter; whether this field is that control is unmapped. Not exercised on the bench. |
| 5 | gyroscope | 1 | APK field name; not exercised on the bench. |
| 6 | secondaryBluetoothWeapons | 0 | APK field name; not exercised on the bench. |
| 7 | criticalShotModifier | 50 | APK field name. **Not** score-to-win (byte-identical across captures with different win conditions). |
| 8 | gameMods | 1 | APK field name; not exercised on the bench. |

> **There is no respawn, time, lives or score token.** Three captures at respawn 5/15/30 s and different clocks produced byte-identical `$GSET` and `$PSET`, and the 8-field map from the app metadata contains none of them. Those live in the host. Stop looking.

**`$PSET,<t1>,…,*`**, sample `$PSET,6,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*`

| tok | Field | Sample | Meaning |
|---|---|---|---|
| 1 | **player id** | 6 | **0-based, 0-63 (6 bits)**. The app's UI shows 1-64 and writes id−1 (app 7 gives wire 6, app 64 gives 63, an out-of-range 69 clamps to 63). Ends up in every IR shot's P field and comes back as `$HIR` token 3 on whoever you hit. |
| 2 | n/a | 0 | 0 in every capture; 0/1/7 gave byte-identical behaviour. Inert. |
| 3 | HP | 45 | Starting/max HP. Echoed as `$LCD` token 1 after `$SPAWN`. |
| 4 | armor | 70 | Armor pool (`$LCD` token 2, `$HP` token 2). |
| 5 | shield | 70 | Shield **maximum**. The pool starts at 0 and only fills via an IR `$SIR` grant function. It is not BLE-writable as a value. |
| 6 | n/a | 50 | (unknown) |
| 7 | (empty) | n/a | |
| 8+ | **positional voice pack** | H44 JAD V33 V3I V3C V3G V3E V37 H06 H55 H13 H21 H02 U15 W71 A10 | Sixteen sound ids on the wire. The app's metadata declares these voice-pack fields: deathAlarm, stealthDeathScream, musicMixOnDeath, deathScream, battleRespawnCry, meleeGrunt, shortPain, longPain, painRelief, missShothit, hitHp, hitArrmor, hitShield, hitCrit, emptyUnboundButtonSound, ammoOrGearPickUp, energyShieldLoop. Which wire slot carries which name: (unknown). |

> **Numbering a fleet is one token.** Give every gun a distinct `$PSET` token 1 at arm time and per-player kill attribution is BLE-native: no cable, no IR receiver. Show operators 1-based ids; write `id − 1`.

## `$SIR`: the incoming-IR effects matrix

What an IR hit does to a gun is decided by the victim's table, not by the shooter's weapon. This section shows how to write that table.

> **The key idea.** An incoming IR word carries a 4-bit protocol (B) and a 2-bit subtype (U). The victim looks up the `$SIR` row with that `<protocol, subtype>` key; the row's **function** decides what the word's 8-bit magnitude is applied to: damage, heal, armor, shield, or a status. **No matching row means the hit is silently ignored.** The same is true of a **wrongly-teamed** shot: damage applies only from an enemy team and support only from your own, and a rejected frame emits **no `$HIR` at all**. It never reaches BLE. 16 × 4 = 64 addressable cells, all writable per game over BLE.

| Item | Value |
|---|---|
| Format | `$SIR,<irProtocol>,<subtype>,<soundID>,<function>,<p5>,<p6>,<p7>,<p8>,*` |
| `<soundID>` | Plays **on the victim** when the row fires (`VA16` "armor suit", `VA8C` "shields online", `H29` stim-pack). |
| `<p5>` to `<p8>` | Do **not** scale damage (`0,0,1`, `0,50,1`, `0,100,2,60`, `0,200,2,60`, `50,100,2,60` all landed exactly the magnitude). |
| Max distinct IR recognitions per game | 14 (community figure). |

```text
# The stock 10-row table the official app sends (Team Arena):
$SIR,0,0,,1,0,0,1,,*        standard weapons (AR, SMG, snipers, shotgun…): plain damage
$SIR,0,1,,36,0,0,1,,*       Force Rifle / Sniper Rifle: fn 36 (floor of magnitude ×1.25)
$SIR,0,3,,37,0,0,1,,*       AMR / Bolt Rifle / Burst Rifle: fn 37 (magnitude ×2)
$SIR,1,0,H29,10,0,0,1,,*    respawn + add HP
$SIR,2,1,VA8C,11,0,0,1,,*   add shields
$SIR,3,0,VA16,13,0,0,1,,*   add armor
$SIR,6,0,H02,1,0,90,1,40,*  Rail Gun
$SIR,8,0,,38,0,0,1,,*       Charge Rifle
$SIR,9,3,,24,10,0,,,*       Energy Launcher (fn 24 is a no-pool status; deals zero damage as shipped)
$SIR,10,0,X13,1,0,100,2,60,* Rocket Launcher
$SIR,11,0,VA2,28,0,0,1,,*   Tear gas
$SIR,13,0,H50,… / 13,1,H57 / 13,3,H49   Energy Blade / Rifle Bash / War Hammer (melee)
```

**Function map.** Measured at magnitude 20, baseline HP 45 / armor 70 / shield 0, **at the gun-body sensor (`$HIR` tok1 = 4) from about 40 cm**. Protocol independence is measured for 10 of the 41 functions (fn 1, 3, 8, 23, 24, 25, 26, 27, 28, 35). Those ran on the enemy team at subtype 0 only, across protocols 0, 5, 7, 9 and 10. That is 50 cells, none of which varied. Applying the result to the grant and ally functions is an extrapolation, not a measurement. Whether a **headset-dome** hit behaves the same is **untested**. The two multiplier functions, 36 and 37, were measured again on 2026-09-02 across magnitudes 20, 40, 9 and 7 and across 8 different `$SIR` row-tail shapes, 16 trials, each with an fn 1 control that had to read the magnitude exactly. The row tail does not change the multiplier.

| Class | Function ids | Measured behaviour | Polarity |
|---|---|---|---|
| Standard damage | 1, **3**, 4, 5, 7, 29, 30, 33, 38 | −20 per hit, drains shields, then armor, then HP | enemy only |
| **Armor-piercing** | 2, 6 (+17, 21 enemy-side) | HP 45 to 25 to 5 with armor **and shields** untouched | enemy only |
| **×1.25 damage (truncated)** | 36 | magnitude 20 lands as **25**, 40 as **50**, 9 as **11**, 7 as **8**. The result is the **floor**: 7 × 1.25 = 8.75 lands as 8, not 9 | enemy only |
| **×2 damage** | 37 | magnitude 20 lands as **40**, 40 as **80**, 9 as **18**, 7 as **14** | enemy only |
| Add HP, overflow to armor | 9, 12, 16, 19 | 15 to 35 to 45, then +armor | ally only (16/19 also damage enemies) |
| Add HP, clamp | 10, 17 | 15 to 35 to 45, no overflow | ally only (17 also AP-damages enemies) |
| Add HP, overflow to shield | 14, 21 | 15 to 35 to 45, then +shield | ally only |
| Add armor | 13, 15, 20, 22 | 0 to 20 to 40; overflow spills to shields | ally only (20 also strips enemy armor) |
| Add shield | 11, 18 | 0 to 20 to 40 | ally only |
| **`$ALCD` token-2 drop** | 23 | Registers a hit, no pool change; `$ALCD` token 2 drops 100 to 0 and recovers over about 6-8 s while the gun keeps firing. The state clears on `$SPAWN,,*`. | enemy |
| Registers, no pool change | enemy 8, 24, 25, 26, 27, 28, 35 · ally 31, 32, 34 | `$HIR` fires, pools unchanged, no other frame. The enemy functions are identical on protocols 0/5/7/9/10, `fn 28` on protocol 5 included. The ally functions are not protocol tested. **The reading is scoped, not general.** The victim is at full health for these trials (HP 45, armour 70), and a heal or armour grant into a full pool is clamped, so it reads as no change: `fn 10` is respawn plus add HP and belongs in that class, not this one. The seven enemy functions here moved no pool with 150 shield available, so for them the reading is real. `fn 3` drains shield exactly as plain damage does and is classed as damage. | n/a |
| No registration | 0, 39-45 | n/a. 0/39/40 re-measured 2026-08-27; 41-45 not re-tested. | n/a |

> **Support functions are team-gated in firmware.** With `$GSET` friendlyFire = 0, heals/armor/shield grants register **only from a same-team source**, and damage registers only from another team. Set friendlyFire = 1 and everything lands from anyone. A medic gun enforces "allies only" with zero host logic.

- **applied = magnitude × fn multiplier × (1 + `$GSET` t7/100 if crit)**: the crit modifier is a **per-game tunable**, not a fixed ×1.5: t7=0 disables crits, t7=100 doubles. ×1.5 is simply the shipped t7=50. Exact at seven levels, 3/3 each.
- **Drain order: shields, then armor, then HP.** Armor absorbs 1:1 with no per-hit cap; overflow spills into HP (a sniper's 80 split exactly 70/10).
- **Heals clamp** at the pool max. Magnitude 200 is a fill, not a stack.
- **No function is a damage-over-time.** 18 s watched after each status hit: no ticks.
- **Dead guns accept no IR at all.**

### Is there a stun?

None found. `$STUN` over BLE is a no-op, and fn 23 (the only function that visibly changes anything without touching a pool) leaves the gun firing.

### Can I read a native game's `$SIR` table?

No. The gun never reports it. Capturing an ability's IR word tells you its protocol, not what a native victim binds to it.

### Which protocols are free?

Stock uses 0, 8, 10, 11, 13 and 15 (grenade beacon); the app's table also ships rows on 1, 2, 3, 6, 9. Truly unused: 4, 5, 7, 12, 14. Every cell is still re-definable per game, since you push the table.

## Events: what the gun tells you

Hits, health, HUD echoes, buttons and telemetry, plus the proof that the gun keeps no game state.

**`$HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,*`**

| tok | Field | Values | Notes |
|---|---|---|---|
| 1 | sensor that caught the IR | 0 headset **front** dome · 1 headset **back** dome · 4 gun body | Isolated with every other sensor covered. Trust for directional logic **only at field distance**. Point-blank floods every receiver, and the first to decode reports. |
| 2 | shooter's IR protocol | 0 standard · 10 rocket · 13 melee … | = the shooter's `$WEAP` t3 / IR word B field. |
| 3 | **shooter player id** | 0-63 | = the shooter's `$PSET` token 1. 32/32 hits both directions on two guns with distinct ids. |
| 4 | **shooter team** | 0-3 | = the shooter's effective `$TID & 3`. |
| 5 | raw magnitude | e.g. 9, 45, 80, 115 | The IR word's D field (= shooter's t5). **Not the applied damage** where a multiplier row or crit is in play. Derive damage from the `$HP` delta. On a killing blow it can report the victim's remaining pool instead (overkill clamp). |
| 6 | crit flag | 0/1 | Echoes the IR word's C bit. 0 on every stock weapon. |
| 7 | subtype | 0-3 | Echoes the IR word's U field (sniper = 1). |

> **Not every `$HIR` is damage.** Pickups, heals and status effects arrive on the same message type. The protocol/subtype tells you which row fired.

**The other events**

| Message | Decode |
|---|---|
| `$HP,<hp>,<armor>,<shield>,*` | Pools after the hit; same millisecond as its `$HIR`. `$HP,0,0,0` = death. Example run at 9/hit: armor 70 to 61 down to 0, then HP 45 to 43 to 34 down to 0. Writes (`$LIFE`/`$BUMP`) do not self-emit `$HP`. |
| `$LCD,<hp>,<armor>,<t3>,<t4>,<mag>,<reserve>,*` | Health/armor HUD echo on `$START`/`$SPAWN`/death. Tokens 3-4: (unknown). |
| `$ALCD,<mag>,<t2>,<slot>,<reserve>,<heat>,*` | Ammo/weapon HUD (token 2: (unknown)): one frame per round fired *and* per round reloaded; slot changes on alt-fire cycle (0 to 1 and back); melee (slot 4) appears as an isolated frame. Heat is a raw level that exceeds 100. |
| `$BUT,<id>,<state>,*` | 0 trigger · 1 alt-fire · 2 reload handle · 3 select · 4 left · 5 right; 1 press / 0 release. In phone mode pre-game the trigger reports but does not fire. |
| `$VOLTS,<pack_mV>,<cell_mV>,<n3>,<n4>,*` | Battery every ~30 s in app mode. **Only reliably returned at good RSSI**. Weak-signal guns in a fleet sweep returned none. |
| `$DISCONNECT,*` | The gun is hanging up (headset switched off, or the app closing). |

> **The gun keeps no game state.** Three separate proofs:
>
> 1. Three captures at respawn 5, 15 and 30 s produce byte-identical config. Nothing on the wire encodes a respawn time or a clock.
> 2. The complete end-of-game tail is `$VOL`, `$HLED`, `$STOP`, `$CLEAR`, `$PLAY`. **The app never asks the gun for a score.**
> 3. Reconnecting after out-of-range play yields zero frames, and a bare `$UP,*` gets no reply.
>
> The phone tallies `$HIR`/`$HP` live, and it is the only place the score ever existed. Anything needing respawn, a clock or scoring needs a host in range for the whole match.

**Per-player attribution and native kill feedback over BLE: the recipe**

1. At arm time give every gun a distinct `$PSET` token 1 (0-63) and a `$TID`.
2. On the victim, store `<shooterId, shooterTeam>` from each `$HIR`; when `$HP,0,0,0` arrives, the stored shooter gets the kill.
3. Send the **shooter's** gun `$SFLASH,*` (green-sight kill confirm) and `$PLAY,,4,6,V3A,,,,*` ("kill" on the announcer slot). The official app does exactly this, three kills giving three pairs.
4. Score lines go to every gun's announcer slot from its own host: on a lead change, `$PLAY,,4,6,VB17,,,,*` ("takes the lead"). Nothing propagates gun-to-gun; there is no nRF score channel to discover.
5. Game end: `$PLAY,VSF,4,6,JAY,,,,*` on the winner's guns (victory sting plus "victory").

### Why does a capture show shooter id 0,0?

Every gun on that capture sat on the default id. The field is always present; `$PSET` token 1 is what makes it vary.

### Why is `$SFLASH` in the victim's capture "never near a hit"?

Because a kill you *score* is invisible in your own `$HIR`/`$HP` stream. Correlate it with `$BUT` trigger bursts.

### Can a dead gun fire?

No: `$BUT,0,1/0` with no `$ALCD` decrement.

## The IR word: what a shot carries through the air

A 25-bit pulse-width-encoded word on a 38 kHz carrier, decoded from LaserTagMods' base-station source and verified on our own receiver and emitter. Read this section if you are building your own IR sender or receiver.

> **Credit.** The layout was decoded from **LaserTagMods' NRFL-Bases** `node1.ino` (a referee-free domination base that receives BRX shots), then bench-verified: timings, bit count, field offsets and the parity rule were all confirmed by pushing known `$WEAP` frames over BLE and watching only the expected bits move. A stock tagger then **accepted a fully synthetic word** from our emitter (invented player 42 / team 2 / damage 33 landed as a real `$HIR` and killed the player).

**Physical layer**

| Item | Value |
|---|---|
| Carrier | **38 kHz**, **940/980 nm**. A standard VS1838B/TSOP demodulating receiver recovers it. Laser rated 16.9 mW on the gun's USB record. |
| Sync | One ~2 ms LOW pulse before the frame, measured **1988-1991 µs**. |
| Bits | Each bit is a LOW pulse; **long ≈ 1000 µs = 1** (measured 990-994), **short ≈ 500 µs = 0** (489-512), spaces 489-512 µs; decision threshold ~750 µs. |
| End of frame | A trailing short pulse (< 250 µs in node1's test). |

> **Sync gating.** A `> 1500 µs` sync gate is not BRX-unique (a Sony SIRC remote's 2390 µs header passes it). Bound sync to about 1800-2200 µs and require 25 bits plus the parity rule.

**Word layout** (transmit order after sync; 25 bits)

| Field | Bits | Offset | Meaning | Bench evidence |
|---|---:|---|---|---|
| **B** | 4 | 0-3 | IR protocol / damage type = `$WEAP` t3 = `$HIR` tok2 = `$SIR` protocol key | AR read 0; rocket (t3=10) read 10; native melee read 13 |
| **P** | 6 | 4-9 | player id 0-63 = `$PSET` token 1 = `$HIR` tok3 | matched the registry |
| **T** | 2 | 10-11 | team id 0-3 = `$TID & 3` = `$HIR` tok4 | matched |
| **D** | 8 | 12-19 | magnitude = `$WEAP` t5 = `$HIR` tok5 | pushed 22, then 9, then 115; only these bits moved |
| **C** | 1 | 20 | critical flag to `$HIR` tok6, applies ×(1 + `$GSET` t7/100) | emitted crit=1 gave `$HIR,…,1,…` |
| **U** | 2 | 21-22 | `$SIR` subtype to `$HIR` tok7 | U=0/1/3 registered with rows; U=2 (no row) ignored |
| **Z** | 2 | 23-24 | parity trailer | see rule |

A genuine captured melee swing decodes as `1101000111010101101000110` = protocol 13, player 7, team 1, magnitude 90, crit 0, subtype 1.

> **Parity: what genuine frames emit vs what the gun checks.** Real BRX frames set Z by parity over bits 0-22: **odd number of ones gives `01`, even gives `10`** (4/4 captured frames). But the gun's acceptance test is only **`Z0 ≠ Z1`**: `01` and `10` both land 8/8, `00` and `11` are rejected 0/8. Compute the true parity for fidelity; use the mismatch to tell your own traffic from a real gun's.

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

**Native emissions captured off the air**

| Source | Word | Note |
|---|---|---|
| Assault Rifle | proto 0, magnitude 9 | The stock AR emits 9, not the manual's 24 |
| Shotgun | proto 0, magnitude 45 | |
| Sniper | proto 0, subtype 1, magnitude 80 | |
| Rocket Launcher | proto 10, magnitude 115 | |
| Melee (gyro swing, native game) | proto 13, subtype 1, magnitude 90 | Subtype 1 = Rifle Bash |
| Supremacy Sentinel death-nova (headset) | proto 10, magnitude 125, player/team = the **dying** player | Out-damages the rocket; credits kills to the corpse |
| Smart Grenade, Respawn station: boot word | proto 15, player 0, team 0, magnitude 56 | Sent once at power-up; before a game starts it arms a tagger to the station (self-respawn off) |
| Respawn station: beacon | proto 15, player 0, team = owner, magnitude 6 | Every ~2.5 s; revives a dead, armed gun of that team (4/4; wrong team 0/1). Does not arm a running game |
| Respawn station: button | proto 15, team = owner, magnitude 6, crit 1 | The beacon with the crit bit set; arms a tagger mid-game. All three were replayed from our ESP32 emitter with the grenade out of the building (2026-09-04); host-driven games ignore them |

> **Headset emission cannot be forced over BLE.** `$IRTX`, `$HFIRE`, `$MELEE` and `$BHIT` produced zero IR with a receiver control passing before and after. The headset emits only for a physical melee swing in a native game and for the Sentinel death-nova.

### Do I need a victim gun to test an emitter?

No. A VS1838B on an ESP32 decodes the word, and the sync/mark timings above are the acceptance spec.

### Can a station revive a dead player by IR?

No. A dead gun ignores all IR; stations *arm* a living tagger's respawn path.

### Why do my captured frames come out as prefixes (16/17/20/21 bits)?

Your capture sketch is printing while the next frame lands. Turn the RAW dump off.

## The USB serial console: `QUERY` and `SETUP`

The micro-USB "Programing Port" is a Teensy serial console with two commands. It is not the `$` protocol and not SSH.

> The BRX has two ports: charging, and a separate micro-USB **"Programing Port"**. Plugged into a computer it enumerates as a **Teensyduino USB Serial** CDC device (Windows `COMx`, macOS `/dev/tty.usbmodem*`, Linux `/dev/ttyACM*`, VID `16C0`). Baud is ignored. This is what the community means by "PuTTY into the tagger". The command set came from LaserTagMods' headset-pairing note.

**What the port does and does not do**

| Sent | Result |
|---|---|
| `$PING,*`, `$VERSION,*`, any `$` frame | **Echoed back** (local echo is on, which is easy to mistake for a reply); with CR: `ERROR` |
| `?`, `help`, `AT`, `status`, … | `ERROR` |
| `QUERY` + CR | Dumps the device record (below). Case-insensitive. |
| `SETUP` + CR | Enters factory provisioning; prompts (EN/中文) for the **headset's** serial number |
| Hold SELECT while powering on with USB connected | Mass-storage mode exposing the on-board sound storage (the sound-pack update path). This is a different mode from the console (community) |

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

> **Real-format quirks** the parser has to survive: `Gun Name` is NUL-padded, lines end `\r\r\n`, `Laser` can read `UNTESTED` instead of a number, `Grenade Pin` is a real non-zero value. `brx-mcp` ships `parse_query()` and `python -m brx_mcp usb-query [port]`, which saves a backup to `~/.brx-mcp/device-backups/`.

**`SETUP`: the provisioning/re-pair path (identity lives here)**

1. Run `QUERY` on both gun and headset-side records first; `SETUP` on the gun asks for the **headset's** serial number. That is the gun to headset pairing mechanism.
2. The "Factory Defaults" banner is a **mode header, not an action**: entering `SETUP` and power-cycling out changed nothing (field-by-field diff).
3. The community's "change tagger ID / re-pair the headset" procedure is this console (LaserTagMods' headset-pairing note); the identity fields it concerns are the ones `QUERY` prints: `PlayerID`, `FieldID`, `Serial Number/Head PIN`, `Grenade Pin`.
4. Only the first prompt (the headset serial) has been walked on our bench. Do it only on a gun you can afford to re-pair.
5. For per-game identity you do not need this: `$PSET` token 1 over BLE sets the player id each game.

> **Firmware backup is impossible; do not reflash.** Teensy's HalfKay bootloader is write-only by design, so no image can be read back. Rollback depends entirely on Battle Company supplying the original image. The official app's version gate (supports "until v2.01e") is an *upper* bound; it warns and still runs a game.

### Is `$QUERY,*` over BLE the same thing?

No. Over BLE it returns a `$`-framed status array with no serial, PIN or version. The device record is USB-only.

### What is the advertised BLE name vs `Gun Name`?

Two fields: the advertisement is `Tactix-XXXX` from the MAC tail; `Gun Name` is what `$NAME` writes.

## Headset, link and what survives

Which state lives where, and what a BLE drop, a headset switch-off, or a power-cycle each wipe. Read this before you write code that reconnects to a gun.

**State survival matrix**

| State | BLE drop / reconnect | Headset switched off | Power-cycle |
|---|---|---|---|
| Game config (`$GSET`/`$PSET`/`$WEAP`/`$SIR`/`$BMAP`) | (unknown). Re-send the full head after a reconnect | Gun sends `$DISCONNECT,*` and drops the link; config: (unknown) | **Wiped**. `$SPAWN` then echoes `$LCD,0,0,0,0,0,0` + `$ALCD,0,0,0,0,0` |
| Alive/dead + pools | Survives (a dead gun stays dead) | n/a | Reset |
| Ammo | Survives | n/a | Wiped |
| `$TID` team / LED colour | Survives; colour is painted at `$SPAWN` | n/a | Reset |
| `$NAME` | Persists | Persists | **Persists** (only the official app rewrites it) |
| Player id (`$PSET` t1) | Survives with config | n/a | Wiped (the USB `PlayerID` is separate and persistent) |
| Score, clock, respawn timer | **Never on the gun** | n/a | n/a |
| `$SIR` fn-23 state (`$ALCD` token 2 at 0) | Persists until `$SPAWN` | n/a | Cleared |

> **Headset off means no BLE.** Switching a linked headset off makes the gun send `$DISCONNECT,*` and drop. A headset-less gun "connects", answers a quick `$PING`, then dies within seconds and echoes **nothing** to a config head. A power-cycled gun needs its headset re-linked before BLE holds. **A held link plus `$ALCD` echoes *is* the headset check.** There is no dedicated probe. The official app silently drops a headset-less gun within about 1.2 s.

**Headset behaviours** (native and autonomous: they work under any host's game head)

| Headset LED | When | Evidence |
|---|---|---|
| Slow **rainbow** blink | Disconnected / not paired. The pre-game tell for "this gun will not join" | operator, repeatable |
| Team colour (red/blue…) | **Pre-game only**; goes dark once the game starts | operator |
| Dark | During play (normal) | operator |

**Other headset facts**

| Fact | Source |
|---|---|
| The headset syncs team colour from the tagger | bench observation |
| `$VERSION` token 2 = headset firmware (`hds.59`); USB `QUERY` shows headset version and battery | captures / USB |
| Headset disconnecting **mid-game** locks the gun until it reconnects (anti-cheat); a gun booted with **no** headset shoots normally in local play | Battle Company manual V7 |
| Headset pairing can take up to 3 minutes with many BT devices nearby | manual V7 |
| Headset sensor ids: `$HIR` tok1 0 = front dome, 1 = back dome (4 = gun body) | shield-isolated bench |
| Gun to headset pairing PIN = the headset's serial, set via USB `SETUP` | LaserTagMods note + USB |
| Headset LED commands `$HLED`/`$BLINK`/`$CHASE`/`$HLOOP`/`$LED` exist; only `$HLED,,6` and `$HLOOP,0,0` have been seen in use | APK + captures |

> **Screamers.** A tagger left powered all day can stop holding BLE. It still advertises, but the connection drops or hangs. The community calls this the "screamer" state. Power-rest guns between sessions; keep them charged (firmware will not re-pair below a battery threshold).

## Getting started with `brx-mcp`

From `pip install` to a live game in six commands, plus the MCP tools for driving a gun from an AI agent.

> `brx-mcp` is the project's lab instrument: a pure-Python (`bleak` + `mcp`) CLI and MCP server that runs on **whichever machine owns the Bluetooth radio**: Windows, macOS or Linux. It enforces the known-safe list, refuses malformed frames, records every session, and has a `panic` tool.

```bash
# on the machine with the BLE radio (Windows PowerShell, macOS terminal, or Linux):
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e ./mcp

# first contact, no MCP client needed:
python -m brx_mcp scan             # find taggers (Gen2/3 advertise the Nordic UART service)
python -m brx_mcp identify <addr>  # $PING → generation check, firmware, host image
python -m brx_mcp listen <addr>    # read-only live console: pull the trigger, watch $BUT/$HIR/$HP
```

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

```bash
# register with Claude Code as an MCP server:
claude mcp add brx -- python -m brx_mcp
# WSL2 has no Bluetooth: develop in WSL, run the server with Windows Python:
claude mcp add brx -- python.exe -m brx_mcp
```

**CLI commands**

| Command | What it does |
|---|---|
| `scan` · `identify <addr>` · `listen <addr>` · `probe <addr>` | Discover, check, watch, probe a single gun |
| `startgame <addr>` · `deathmatch <addr>` · `arena <addr1> <addr2>` · `fieldstart …` | Earlier single-purpose game drivers (the arm sequence) |
| `play <mode> <addr…> [volume=69]` | Hosted match with live scoring; modes tdm ffa infection lms cs domination koth ctf extraction |
| `game-sim <mode>` · `extraction-sim` | Hardware-free narrated simulations |
| `diag <addr>` · `diagnose <addr>` · `diag-game <addr>` · `fleet` | Diagnostics, fleet battery/reachability sweep |
| `usb-query [port]` · `enroll` · `armory` · `rename` · `reset` | USB device record, armory enrolment, persistent `$NAME`, reset |
| `ir-capture` · `ir-emit` · `ir-range` | Drive the ESP32 IR transceiver rig |

**`diag-game`: the repeatable diagnostic game**

| Item | Value |
|---|---|
| What | A structured pass/fail scorecard of every BLE capability on one tagger: connectivity (ping, firmware, battery), config + spawn echoes, trigger and button events, audio (a sound by id, volume audible at 75), team LEDs, and with a second gun as shooter, damage (armor absorbs, `$LIFE` heals) and `$HIR` shooter attribution, plus the grenade Hill/Respawn beacon (`$HIR` token 2 = 15). |
| Run it | `python -m brx_mcp diag-game <addr>` · `… 2guns` adds the shooter · `… 2guns ir` adds the ESP32 IR bridge. Cases a rig cannot serve **skip**, they do not fail; a run is **CLEAN** when nothing failed or errored. |
| How it judges | Declarative cases (`diag/cases.py`) with pure predicates over the parsed receive stream (`diag/model.py`, unit-tested with no BLE); a human answers y/N where the wire cannot judge ("did you hear it?", "are the LEDs blue?"). Reports save as JSON under `~/.brx-mcp/diag-reports/`. |
| Why | A regression baseline. A firmware update or a new tagger? Re-run and diff the scorecard instead of re-deriving "does health-write work?" each session. |

**MCP tools (what an agent can call)**

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

> **Platform notes.** macOS: grant your terminal Bluetooth permission; CoreBluetooth reports per-machine **UUIDs instead of MAC addresses**, so never pattern-match on address format, and expect to re-scan per machine. Gen1 taggers use Bluetooth Classic. `bleak` is BLE-only, so pair in the OS and use the serial port. Captures and the device registry live in `~/.brx-mcp/`.

**Recommended first session (safe order)**

1. `scan` to note the address. `identify` to confirm `$PONG` and read the `$VERSION` reply.
2. `listen` read-only: pull the trigger, get tagged by another gun, watch `$BUT`/`$HIR`/`$HP`. Send **no** config yet.
3. `play tdm … volume=69` on two guns; confirm each echoes `$LCD,45,70,0,0,36,216` on spawn.
4. If anything looks wrong: `panic`, then power-cycle. That always restores the tagger.

## Captures: recording and decoding the official app

How every fact here was obtained, and how to take the next one.

> **Method.** Almost everything here came from three instruments: BLE HCI captures of the official Callsign app (Android HCI snoop; iOS via macOS PacketLogger), a VS1838B/ESP32 IR receiver and emitter, and a live tagger driven one token at a time. Captures are decoded with `python -m brx_mcp.btsnoop <file>` into `>>` (host to tagger) and `<<` (tagger to host) transcripts.

**iOS (the one that works; Callsign is effectively iOS-only)**

1. Plug the iPhone into a Mac. Open **PacketLogger** (Xcode additional tools), then **File → New iOS Trace**. **Confirm lines are scrolling before you do anything.**
2. Make sure the tagger's **headset is on and paired**. The app silently drops a headset-less gun and you capture nothing. Get the app's connection icon green first.
3. Drive the app: connect, create/join, arm, play, end. For a differential capture change **exactly one** setting per trace.
4. **File → Export → btsnoop**. Two traps: export acts on the *frontmost* window (easy to re-export an old trace), and a trace that was not recording writes a silently useless file.
5. `python -m brx_mcp.btsnoop <file>` gives the transcript. `python -m brx_mcp.gsetdiff <capA> <capB> [capC]` diffs the config frames across raw captures.

**Android (partial; the app rarely holds a connection here)**

1. Enable **Developer options → Bluetooth HCI snoop log**.
2. Run the app; then `adb bugreport` (5-10 min; keep the phone still). The btsnoop log rides inside.
3. Decode with `python -m brx_mcp.btsnoop`. This route yielded the connect ritual and the version exchange, never a game.

```bash
python -m brx_mcp.btsnoop capture.btsnoop            # → '>> $CLEAR,*' / '<< $LCD,…' transcript with timestamps
python -m brx_mcp.gsetdiff cap5.btsnoop cap6.btsnoop # byte-diff the $GSET/$PSET frames across captures
python -m brx_mcp.weapmap cap14.btsnoop cap15.btsnoop # token × weapon table from operator-annotated captures
```

> **Decoder gotchas we hit.** Apple's btsnoop export uses datalink 1001 (no HCI type byte; the type is in the record flags), which decoded to zero frames until handled. With two guns in one trace, streams must be keyed on the **ACL connection handle** or they merge into garbage silently.

**Published transcripts** (decoded frames only; raw btsnoop files contain all of a phone's Bluetooth traffic and are not published)

| File | Shows |
|---|---|
| `2026-08-23-ios-callsign-game-start.txt` | The full working arm sequence (findings §7e) |
| `2026-08-23-ios-callsign-two-tagger-combat.txt` | `$HIR`/`$HP` damage, death, host-driven respawn (findings §7f) |
| `2026-08-23-gset-respawn15.txt` / `-respawn30.txt` / `-respawn05.txt` | Byte-identical `$GSET` at three respawn values; `respawn15` also contains a complete game ending (findings §7n) |
| `2026-08-23-no-headset-disconnects.txt` | App ritual completes, zero frames back, hangs up about 1.2 s later (findings §7m) |

**IR capture rig (ESP32-S3 + VS1838B)**

1. A phone camera **cannot** see the ~5 mA IR LED. Judge with the receiver, never a camera.
2. Turn the sketch's per-frame RAW dump **off** (`r`) for any capture that matters; it takes about 15-20 ms at 115200 and truncates the next frame into a prefix.
3. Attenuate at close range. The VS1838B's AGC saturates point-blank. A gun at 1 m decodes cleanly where an LED at 5 cm does not.
4. Never fire toward the rig from the gun under test: reflected IR hits your own headset, drains armor and kills the player mid-window.
5. Bound the sync to about 1800-2200 µs and require 25 bits plus `Z0 ≠ Z1`, or a TV remote will decode as a BRX frame.

> **Measurement discipline that mattered.** Check the control *before* reading the result; one clean-looking run is not a result (everything that held was measured three times with alternating conditions, or came from a human's senses); a host-visible field that correlates with a state is not evidence of that state; damage is a property of the (weapon, victim `$SIR` table) pair, never of the weapon alone.
