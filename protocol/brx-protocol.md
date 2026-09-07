# BRX Serial Command Protocol Reference

**Status:** reference, current as of 2026-09-06. Each row states the current reading only. The dated
bench write-ups that produced it, with every retraction, are in
[`session-findings-2026-08.md`](session-findings-2026-08.md) (frozen) and `docs/experiment-log/`
(the live notebook). The published developer reference built from this file is
`docs/manual/06-developer.md`.
**Credit:** Protocol knowledge originally discovered and proven by **LaserTagMods (JEDGE / JBOX projects)** — https://github.com/LaserTagMods. This document is a fresh, independent write-up of the protocol; no code is copied.
**Scope:** Battle Company BRX taggers (Gen1, Gen2/3) over the serial link. The optical IR word is in
[`brx-ir-protocol.md`](brx-ir-protocol.md); the Smart Grenade (an IR-only device with no serial link, mode
set by its button) is in `docs/reference/grenade.md`. Field maps decoded from the Callsign app are in
[`callsign-extract/protocol-classes.md`](callsign-extract/protocol-classes.md).

---

## 1. Transport

The BRX exposes a plain-text serial command interface over Bluetooth. The tagger's stock firmware is never modified — all customization is done by sending commands over this link.

| Generation | Link type | Baud | Notes |
|---|---|---|---|
| Gen1 | Bluetooth Classic (SPP) | 57600 | Pair via HC-05 module (PIN `0001`, role master). Headset must be connected for BT to function. Community-reported; not bench-verified by us. |
| Gen2/3 | BLE — Nordic UART Service | 115200 (the UART behind the radio; BLE has no baud) | Connect from any BLE central: a laptop (`bleak`), an ESP32, a native phone app (CoreBluetooth / Android BLE). No pairing, no PIN. |
| Any | Hardware UART inside the gun | 115200 | What JEDGE drives directly. There is no external accessory port; a wired tap means opening the gun. Untested by us. |
| Any | Micro-USB "Programing Port" | USB CDC (baud ignored) | **Not** the `$` protocol: a separate `QUERY`/`SETUP` console (§9). |

**BLE UUIDs (Nordic UART Service):**
- Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- RX characteristic (write to tagger): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- TX characteristic (notify from tagger): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`
- Advertised name `Tactix-XXXX` (last two bytes of the BLE address). The NUS service UUID is present in the
  advertisement, so scan-time generation detection works.
- ATT MTU negotiates to **23 bytes**: chunk writes to ~20-byte payloads. `$PING,*` → `$PONG,*` ≈ 59 ms.

**Generation detection heuristic:** power on the tagger and run a BLE scan. If it advertises the UART service → Gen2/3. If nothing appears on BLE but the device pairs over Bluetooth Classic → Gen1.

**Waking a gun and holding the link.** Establishing a link is intermittent (the official app behaves the
same); a link holds once it is up, so retry in a loop. On a fresh power-up send `$STOP,*` then `$PHONE,*`
(after a power-cycle `$PHONE,*` alone wakes it); a just-booted gun ignores a bare `$VERSION,*` until then.
`$PHONE,*` opens the event tap (buttons, `$VOLTS`) and locks the on-gun menu. Idle taggers are silent:
outside app mode nothing unsolicited is sent. **The headset must be linked** or the gun connects, answers a
quick `$PING`, then drops within seconds and echoes nothing to config. After a gun-initiated
`$DISCONNECT,*` back off at least 5 s.

**The official app's connect ritual (fw v4.32):** `$STOP,*` → `$PLAYX,0,*` → `$VOL,<n>,0,*` →
`$PLAY,VA20,3,<p>,,,,,*` ("connection established"), then once per session `$NAME,<name>,*` +
`$VERSION,*`. It never sends `$PHONE,*`. Android sends `$VOL,100` / `$PLAY,VA20,3,9`; iOS sends `$VOL,69` /
`$PLAY,VA20,3,6`: the numbers are app conventions, not protocol constants.

## 2. Message framing

- Messages are ASCII, comma-delimited tokens.
- Start with `$COMMAND`, end with `,*`. Validator: `^\$[A-Z0-9!]+(,[^,*\r\n]*)*,\*$` (no comma, `*` or line break inside a token).
- Empty tokens are allowed (consecutive commas) and mean "leave unchanged / not applicable." **`$SPAWN,,*` (one empty token) is a different command from `$SPAWN,*`.**
- Example: `$PING,*` → tagger replies `$PONG,*` (Gen1 may prefix: `$!DFP,PONG,*`; unverified).
- Notifications can arrive merged (`$ALCD,…$BUT,0,1,*`): split on the next `$` as well as on `*`.

## 3. Commands TO the tagger (host → BRX)

### 3.1 Lifecycle and configuration

| Command | Purpose | Notes / observed examples |
|---|---|---|
| `$PING,*` | Connectivity check | Reply: `$PONG,*` |
| `$STOP,*` | Stop | First frame the app sends on every (re)connect; also part of the end-of-game tail |
| `$PHONE,*` | App-controlled mode | Opens the live event tap (buttons, `$VOLTS`), locks the on-gun menu. Reply `$BUT,3,0,*` |
| `$CONNECT,*` / `$INIT,*` | Handshake / initialise (LaserTagMods) | On v4.32: no observable reply. On v4.30 `$INIT` reportedly makes the gun accept but not start a `$PB*` game |
| `$CLEAR,*` | Clear current game state | First frame of every arm sequence; half of the panic sequence. **Wipes the `$SIR` table**: a gun with no `$SIR` rows silently ignores every hit (no `$HIR`, no headset flash, pools untouched) while reporting alive. Always re-send `$SIR` after `$CLEAR` (deterministic 5/5, 2026-09-02; table size does not matter, only its absence) |
| `$START,*` | Begin the configuration sequence | Gun echoes `$LCD,0,0,0,0,0,0,*` |
| `$GSET,<t1>,…,<t8>,*` | Global game settings, 8 tokens | `friendlyFire, outdoorMode, gunLaserRegion, autoAmbientLight, gyroscope, secondaryBluetoothWeapons, criticalShotModifier, gameMods`. Captured `$GSET,0,0,1,0,1,0,50,1,*`. **Token 1 is firmware-enforced both ways**: 0 blocks same-team damage and enemy heals, 1 opens the gate. **Token 7 is the crit modifier in percent**: crit damage = magnitude × (1 + t7/100), exact at seven levels; 0 disables crits, 100 doubles, the shipped 50 is why crit looked like a fixed ×1.5. **No respawn, time, lives or score token**: those live in the host (§7). Tokens 2–6 and 8 carry the APK field names only; none has been flipped on the bench |
| `$PSET,<id>,0,<hp>,<armor>,<shield>,50,,<voice pack…>,*` | Player settings | **Token 1 = player id, 0-based 0–63** (the app shows 1–64 and writes id−1; out of range clamps to 63). Ends up in every IR shot's player field and comes back as `$HIR` token 3 on whoever you hit. Token 2 is inert (0/1/7 identical). Tokens 3–5 = HP / armor / **shield capacity** (the spawn shield is always 0; it fills only from an IR grant, fn 11/18, or armor overflow, saturating at t5). Armor and HP store and decrement exactly to at least 1000 (a 255 cap is policy, not a device limit); shield width is inferred, not measured. Token 6 is unknown (0–200 swept, no effect). Tokens 8+ are a positional voice pack of sixteen sound ids (names in `callsign-extract/protocol-classes.md`). e.g. `$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*`. **Slot↔name alignment CONFIRMED 2026-09-07** for the pool slots: the APK order is correct, `hitHp` / `hitArrmor` / `hitShield` sit exactly where the field list says (a voice line placed in the hitShield position was heard on a shield hit; an intermediate "the slots are swapped" reading was retracted after a control showed the sound had not moved). Three further findings on the effect tail, all bench-measured the same day: **(a) AN EMPTY EFFECT FIELD IS NOT SILENCE — it falls through OUTWARD to the neighbouring pool's clip.** An empty `hitShield` plays the ARMOUR clip; `hitHp` is silent only because it is the innermost pool with nothing further in to fall to. This is NOT the A15.2/A15.3 rule (an empty VOICE field really does make the gun say nothing) and does not follow from it. **(b) `energyShieldLoop` (the last token) is a REAL LOOP** that runs while the shield is up, survives a `$PSET` rewrite, and stops only on `$PLAYX,0,*` or the shield reaching zero — Callsign's stock `A10` is a geiger-ish tick, and because it loops it plays under every shield-band hit. **(c) A `$PSET` sound id is overridden by a non-empty `$SIR` `<soundID>` on the row that fired** (§5): the two do not layer, so per-weapon and per-pool audio compete for one hit. |
| `$WEAP,<slot>,…,*` | Define a weapon in slot 0–5 | ~43 tokens: damage, fire interval, fire mode, clip/reserve, reload, sounds, IR type. See §6 |
| `$SIR,<protocol>,<subtype>,<sound>,<function>,…,*` | Incoming-IR effects matrix | Maps an IR `<protocol, subtype>` key to a function (damage, heal, armor, shield, status). Unmatched cells are silently ignored. See §5 |
| `$BMAP,<button>,<function>,<swap0..3>,*` | Remap physical controls | Buttons: 0 trigger · 1 alt-fire · 2 reload handle · 3 select · 4 left · 5 right · 8 gyro. Functions seen: 0 fire · 97 reload · 98 (select/left/right) · 100 weapon-cycle · 4 melee (gyro). **Mandatory**, sent before and again after `$SPAWN`: without it the trigger only chirps "disabled". With one `$WEAP` slot loaded, function 100 has nothing to cycle to and falls back to reloading |
| `$TID,<team>,*` | Team id | **Masked to 2 bits** (`team & 3`): four native teams 0–3. Sets the default LED colour at `$SPAWN` (1 = blue, 2 = yellow observed) and is echoed as `$HIR` token 4 on the victim. A live write changes hit resolution immediately but does not repaint the LEDs. **⚠️ TEAMS ARE 0-3 (bench 2026-09-07).** The IR word's team field is 2 bits and the gun transmits `tid & 3`, but a victim compares the incoming team against its FULL tid. So on any tid >= 4: two teammates each send `tid & 3`, read it as different from their own tid and **damage each other**; their shots read as friendly to the real tid 0-3 team they alias onto, which **takes no damage**; and a gun can **kill itself** off a nearby surface (observed: a `$TID,5` gun sent `$HIR,4,0,7,1,9` naming its own player id and drained its own armour to 0). Captured words: tid 4 → `team=0`, tid 5 → `team=1`. Use 4-7 as COLOURS only, never as a team. |
| `$SPAWN,,*` | **Go-live and respawn** (note the empty token) | Restores HP/armor and, on respawn, ammo; echoes `$LCD,<hp>,<armor>,0,0,<mag>,<reserve>,*`. Clears the `$SIR` fn-23 state. **Leave at least 3 s after a death before respawning**: sent within ~2 s the headset never executes it and stays stuck in the green out-blink (1.0/2.0 s stick, 2.5/3.0/6.0 s clean, 2026-09-02). The headset is a second device behind a relay, so any command it must execute needs a settling gap. **`$SPAWN` also clears any headset colour painted with `$HLED`** (2026-09-03) |
| `$AMMO,<slot>,<mag>,<reserve>,<flag>,*` | Load magazines | Must follow `$SPAWN,,*` at initial go-live or the gun is live with no ammunition (e.g. `$AMMO,0,36,108,1,*`). A respawn `$SPAWN` restores ammo on its own. A `$WEAP` re-push resets ammo to the frame's values: re-send `$AMMO` after any weapon swap |
| `$PLAYX,0,*` | Stop/clear sound playback | Sent right after `$STOP` on connect and just before the go-live cue |
| `$PLAY,<soundID>,<volume>,<priority>,<announcerID>,,,,*` | Play a sound / voice line by id | **Two independent slots**: token 1 = local/effect sound, **token 4 = the announcer/voice channel**. `$PLAY,,4,6,V3A,,,,*` speaks "kill" with token 1 empty; `$PLAY,VSF,4,6,JAY,,,,*` uses both. **Tokens 2–3 are required**: `$PLAY,VA33,,,,,,,*` is silent, `$PLAY,VA33,4,6,,,,,*` speaks. Valid ids: the **2,477 files on the gun** (`docs/reference/sound-catalog.md`); the app's own `Sounds.json` lists 2,166, of which 157 are not on the gun. An unknown id plays a fallback sound, not silence |
| `$VOL,<0–100>,<n2>,*` | Master volume | Android app sends `$VOL,100,0,*`; iOS `$VOL,69,0,*`. 30 is inaudible for weapon and game audio, 45 barely audible; use ≥ 65 to hear a tagger. Mission Control plays at **80 indoors / 90 outdoors** (`compile.play_volume()`), try-outs at 69, probing at 30. The on-gun 1–5 menu ↔ `$VOL` mapping is an unmeasured field estimate (roughly L2 ≈ 69), not a fact |
| `$NAME,<name>,*` | Set the gun's persistent name | The USB `Gun Name` field; survives power-cycle. Opening the official app rewrites it to `Tactix2` |
| `$VERSION,*` | Query firmware | Reply `$VERSION,v4.32,?,4,,devhost.03,*`; token 2 reads `hds.59` with a headset linked |
| `$SP,<n>,*` | End-of-game / stop (LaserTagMods) | `$SP,99,*` is the second half of the panic sequence. Other values unmapped. The gun keeps no score to report |
| `$QUERY,*` | Status array over BLE | Returns a `$`-framed array (`$QUERY,0,0,0,0,0,,1,0,,0,…`, undecoded) plus a `$LCD`. **Not** the USB device record (§9) |
| `$PBGAME` `$PBTEAM` `$PBWEAP` `$PBPERK` `$PBLIVES` `$PBTIME` `$PBSPAWN` `$PBINDOOR` `$PBLOCK` `$PBSTART` | The "playbook" pre-battle family (community, fw v4.30) | Mirrors the on-gun menu; a second remote-start path: `$PBGAME,0` FFA · `$PBWEAP,0` M4 auto · `$PBPERK,2` Body Armor · `$PBLIVES,2` 5 lives · `$PBTIME,5` infinite, then `$PBSTART,*`. `$PBWEAP,0,*` produced a "game starting" sound on our v4.32; enum tables not reproduced on v4.32 |
| `$AS,…,*` · `$UP,100,<n>,0,*` + `$UR,*` · `$RV` `$RP` `$UR` `$IT` `$KK` `$TA` `$PT` `$HS` `$PH` `$RR` `$PKC` `$HKC` `$KOTH` `$RADSK` `$INDOOR` `$#CONNECT` `$BRXSERVER` `$SSID` `$PASS` `$BRX` | LaserTagMods / community vocabulary | Seen in JEDGE sources or the v4.30 community capture; unmapped on v4.32 (`$AS` silent across seven shapes; bare `$UP,*` gets no reply; `$UP` with arguments is probably a write). Leads, not protocol |

### 3.2 In-game effects, feedback and pools

| Command | Purpose | Notes |
|---|---|---|
| `$SFLASH,*` | **The shooter's green-sight kill-confirm flash** | No arguments. The host sends exactly one per kill the holder scores, ~0.4 s after the trigger burst. Works on an idle unspawned gun. Verified from our own stack |
| `$LIFE,<hp>,<armor>,<shields>,*` | Grant health | **Additive, clamped at the pool max**, never an absolute set. Writes do not self-emit `$HP` |
| `$BUMP,<hp>,<armor>,<shields>,*` | Adjust current pools | Same additive / clamped behaviour |
| `$GLED,<led1>,<led2>,<led3>,<apply-gate>,<brightness>,,*` | **Gun body LEDs, one palette index per LED** | Palette: **0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink · 8 orange**; 9 and 10 dark (measured with a camera rig 2026-09-02, all three LEDs agreeing). **Token 4 is an apply gate**: 0, 6, 7, 8, 9, 10 apply the colour tokens at full brightness; 1–4 are no-ops (the gun keeps what it was showing). **⚠️ CORRECTED 2026-09-07: gate 5 is OFF, not one-third.** `$GLED,3,3,3,5,10,,*` on a host-owned strip reads as DARK, not a dim green (A/B against gate 0 at the same level, operator call: "bright then off, no steps in between"). The earlier "~1/3" reading was taken while the firmware breathing was still contending and does not survive a clean A/B. Gate 5 is what makes the blank `$GLED,,,,5,,,*` work, and it should never be sent with colour tokens. **The real dimmer is token 5** (see below). No value animates. There is no dedicated off value: `$GLED,,,,5,,,*` (Callsign's on-death frame, and the night-mode frame we ship) blanks the gun because its colour tokens are empty and 5 applies them. **Token 5 is brightness, and it is the night dimmer**: 0 off, 1 clearly dim, ≥ 2 full (saturates). Confirmed 2026-09-07 by A/B on a blanked (host-owned) strip: level 1 vs level 10 steps visibly and the hue stays clean ("now its dim green"), including on a mixed per-LED frame (`$GLED,3,3,9,0,1` = dim green / dim green / dark). The two do not compose: gate 5 is off, so use gate 0 + token 5 for brightness. **The blank is required before any paint holds** (2026-09-07): `$GLED,9,9,9,0,10,,*` sent to a spawned gun with NO prior blank leaves it breathing; after the blank the same frame holds dark. ONE blank per life is enough (it is idempotent, and only `$SPAWN` re-enables the breathing), and a held paint SURVIVES `$AMMO`, `$PLAY`, `$HLED` and `$LED` traffic. Without a blank, a painted colour alternates with the native animation; repainting fast enough to win (~30 Hz) strobes in the photosensitive band, so signal events with a short burst of three flashes (0.08 s pulses, 0.10 s apart) instead |
| `$HLED,<colour>,<effect>,<on_ms>,<off_ms>,<brightness>,<count>,*` | **Headset LED** | Token 1 = colour, **same palette as `$GLED` for 0-7, all eight verified on hardware 2026-09-07** (0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink; 8 reads red on the headset and orange on the gun, unverified since; 9 and 10 dark). ⚠️ **A COLOUR INDEX IS NOT A TEAM ID.** `$TID,0..7` are all accepted and the firmware breathes the matching colour, but **only tids 0-3 work in combat** — see the `$TID` row. **The headset is one lamp with one colour: token 1 is global, tokens 2+ never address the four modules individually** (2026-09-02). Token 2 effect: 0 solid · 1 breathe · 2 blink · 4 fade-out blink (Callsign's low-health form) · 6 blank · 3, 5, 7, 8 nothing/dark. Tokens 3/4 on/off ms. Token 5 brightness: 1 dim, ≥ 2 full, saturated by 10 (Callsign's 10 is already maximum). Token 6 flash count. The first flash is always bright and the rest dim (firmware). **⚠️ EFFECT 6 (blank) DISABLES THE FIRMWARE'S OWN DEATH-FLASH LOOP for the rest of the life (bench 2026-09-07): a gun killed after any `$HLED,,6` does NOT run the native out-flash, while the same gun killed after a COLOUR write does. Use `$HLED,9,0,,,10,,*` (colour 9 = dark) to darken the headset in play; keep effect 6 for teardown only. The native HIT flash is unaffected by either.** **`$SPAWN` and every registered hit clear a painted colour**; a single frame painted after spawn holds until the next hit, so a persistent team/out colour must be re-painted after every `$SPAWN` and every `$HIR` (2026-09-03). Captured app frames: `$HLED,<team>,0,,,10,,*` pre-game, `$HLED,7,4,90,90,10,15,*` on the victim at armour 0, `$HLED,,6,,,,,*` at game end |
| `$HLOOP,<0 disable / 1 enable / 2 heartbeat>,<rate_ms>,*` | **Headset LED loop — drives the SMALL flash LED at firmware drive** | **Bench-proven 2026-09-07 (Tactix-XXXX, alive AND dead):** `$HLOOP,2,<ms>,*` and `$HLOOP,1,<ms>,*` (indistinguishable by eye) blink the **small green flash LED** — the lamp the firmware uses for its own hit / out flash — indefinitely. **Token 2 is a period in ms** (750 vs 2000 visibly different). On a DEAD gun whose death loop had been suppressed by an `$HLED,,6`, it **restores the flash at native drive or brighter** (operator, side by side with the native blink he had just seen: "looks like native", "might be brighter"). The **big RGB LED is untouched** and holds whatever `$HLED` painted — the two lamps are independent. `$HLOOP,0,0,*` stops it, and **`$SPAWN` clears it on its own**, so a revived player cannot be left flashing. Callsign's `$HLOOP,0,0,*` ~1.7 s after every death is the disable of this loop. ⚠ Not metered against a native out-blink; rate range untested |
| `$LED,<colour>,<isUsedGreenLed>,*` | The headset's small green flash LED | Exactly two fields. `$LED,9,1,*` = one visible green flash (~66 ms); colour paints the big LED at the same time (9 = leave it alone). No intensity, duration or count field |
| `$BLINK,<colour>,<on_ms>,<off_ms>,<level 0-10>,<loop>,*` · `$CHASE,<colour>,<rate>,<level>,<loop>,*` | Headset blink / chase (APK layouts) | Never sent in the right shape on the bench |
| `$BHIT,<bulletType>,<playerId>,<team>,<damage>,<isCrit>,<powerLevel>,<direction>,*` | Host-injected hit (APK layout, read 2026-09-04) | Runs the firmware's own hit path in the app's model. Earlier probes used a 3-token guess and were echoed with no damage; **untested in the real shape** |
| `$HFIRE,…,*` (11 fields) · `$IRTX,…,*` (11 fields) | Heavy/burst fire, raw IR transmit (APK layouts) | Earlier 4-field guesses emitted zero IR with a receiver control. Untested in the real shape |
| `$MELEE,<intensity>,*` | Melee | `$MELEE,255,*` returns `$BUT,4,0,*` and fires no IR |
| `$STUN,*` | Stun | Proven no-op over BLE |
| `$GREN,<iRType>,<crit>,<modifier>,<indoorMode>,<operationMode>,<channel>,<GrenadeType>,<MaxCount>,*` | Smart Grenade frame, addressed to the gun | **Does not set the grenade's objective mode** (button-locked on the device). `GrenadeType` = FlashBang / Gas / Confusion / Molotov is the blast type of a paired thrown grenade (untested end to end). On the bench the gun emitted IR whose bits did not track the arguments |
| `$VIB` · `$ZOOM` · `$FSET` (~38 event→sound slots) · `$ASSIST` · `$DLC` / `$ASKDLC` → `$GOTDLC` | Seen in the app's vocabulary only | Never sent by us; on-tagger behaviour unobserved |

## 4. Messages FROM the tagger (BRX → host)

| Message | Meaning | Key tokens |
|---|---|---|
| `$PONG,*` | Ping reply | |
| `$VERSION,<gun fw>,<headset fw>,<n>,,<host image>,*` | Version reply | e.g. `$VERSION,v4.32,?,4,,devhost.03,*`; token 2 = `hds.59` with a headset linked, `?` otherwise |
| `$DISCONNECT,*` | Gun-initiated disconnect notice | e.g. the moment its headset is switched off |
| `$VOLTS,<pack_mV>,<cell_mV>,<t3>,<t4>,*` | Battery telemetry, ~every 30 s in app mode | `$VOLTS,7662,3921,55,70,*` = 7.662 V pack, 3.921 V cell; tokens 3–4 undecoded. Only reliably returned at good RSSI |
| `$LCD,<hp>,<armor>,<t3>,<t4>,<mag>,<reserve>,*` | Health/armor HUD echo | `$START` → all zeros; `$SPAWN` → pools + current weapon's ammo; death → `$LCD,0,0,0,1,1,1,*`. A zeroed `$LCD` after `$SPAWN` means no config is loaded (the post-power-cycle tell). Tokens 3–4 undecoded |
| `$ALCD,<mag>,<audio>,<slot>,<reserve>,<heat>,*` | Ammo/weapon HUD stream | One frame per round fired **and** per round reloaded (a reload is a burst of frames). Token 2 = the gun's audio level, 100 in normal play, driven to 0 by a `$SIR` fn-23 hit and recovering over ~6–8 s. Token 3 = weapon slot (alt-fire cycles 0↔1; melee slot 4 appears as an isolated frame on a gyro swing). Token 5 = **weapon heat** (raw, exceeds 100 at overheat; non-zero only on overheat weapons). Only streams on ammo events: silence is not "no change" |
| `$HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,*` | **Hit received** | See §4.1 |
| `$HP,<hp>,<armor>,<shield>,*` | Pools after a hit | Same millisecond as its `$HIR`. `$HP,0,0,0` = death. Writes (`$LIFE`/`$BUMP`) do not self-emit it |
| `$BUT,<id>,<state>,*` | Physical button event | id 0 trigger · 1 alt-fire · 2 reload handle · 3 select · 4 left · 5 right (matches `$BMAP`); state 1 press / 0 release. Streams only in app mode; pre-game the trigger reports but does not fire. A dead gun's trigger gives `$BUT` with no `$ALCD` decrement |
| `$QUERY,…` | Status array in reply to BLE `$QUERY,*` | ~11 `value,,` pairs, undecoded |
| `$UP` · `$AS` · `$SP` · `$WEAP` · `$PERK` · `$HS` | Echoes reported by LaserTagMods | Never seen from our v4.32 units |

### 4.1 `$HIR` decode

| tok | Field | Values | Notes |
|---|---|---|---|
| 1 | sensor that caught the IR | 0 headset **front** dome · 1 headset **back** dome · 2, 3 the headset's other two domes (positions unmapped) · 4 gun body | Isolated with every other sensor covered (2026-08-26). Trust for directional logic **only at field distance**: point-blank IR floods every receiver and the first to decode reports |
| 2 | shooter's IR protocol | 0 standard · 10 rocket · 13 melee · 15 grenade beacon … | = the shooter's `$WEAP` t3 / IR word B field; selects the victim's `$SIR` row |
| 3 | shooter player id | 0–63 | = the shooter's `$PSET` token 1 (32/32 hits both directions on two guns) |
| 4 | shooter team | 0–3 | = the shooter's effective `$TID & 3` |
| 5 | raw magnitude | e.g. 9, 45, 80, 115 | The IR word's D field (= shooter's t5). **Not the applied damage** where a multiplier row or crit is in play: derive damage from the `$HP` delta. On a killing blow it can report the victim's remaining pool instead (overkill clamp) |
| 6 | crit flag | 0/1 | Echoes the IR word's C bit; 0 on every stock weapon |
| 7 | subtype | 0–3 | Echoes the IR word's U field (sniper = 1) |

Not every `$HIR` is damage: pickups, heals and status effects arrive on the same message, keyed by protocol
and subtype. A team-rejected shot (same-team damage, or enemy support, with friendly fire off) emits **no
`$HIR` at all**, so friendly fire is invisible to the host while `$GSET` t1 = 0.

**Kill attribution pattern:** store `<shooterId, shooterTeam>` from each `$HIR`; when `$HP,0,0,0` arrives the
stored shooter gets the kill. Send the shooter's gun `$SFLASH,*` then `$PLAY,,4,6,V3A,,,,*`; the official app
does exactly this. JEDGE encodes the kill between its own devices as `$DD,<killerId>,<killerTeam>,<victimId>,<nonce>,*`
(a host-side convention, not a tagger command).

## 5. `$SIR` — incoming IR effects matrix

Format: `$SIR,<irProtocol>,<subtype>,<soundID>,<function>,<p5>,<p6>,<p7>,<p8>,*`

- `<irProtocol>` = the IR word's B field (4 bits), `<subtype>` = its U field (2 bits): together the row's lookup
  key, 16 × 4 = 64 cells, all writable per game. **No matching row → the hit is silently ignored.**
- The IR word's 8-bit "damage" is a **magnitude**; the row's `<function>` decides what it applies to.
- `<soundID>` plays on the victim when the row fires (`VA16` "armor suit", `VA8C` "shields online", `H29` stim-pack).
- `<p5>`–`<p8>` do not scale damage (five shapes tried, all landed exactly the magnitude); their role is open.
- **Team-gated in firmware by polarity** while `$GSET` t1 = 0: damage lands only from an enemy team, support
  (heal / armor / shield grants) only from the victim's own team; a rejected frame emits no `$HIR`. With t1 = 1
  everything lands from anyone.
- Drain order: **shields → armor → HP**. Armor absorbs 1:1 with no per-hit cap; overflow spills into HP (a sniper's
  80 split exactly 70/10). Heals clamp at the pool max. No function is a damage-over-time. Dead guns accept no IR.
- Applied damage = magnitude × function multiplier × (1 + `$GSET` t7/100 if the crit bit is set).
- Max distinct IR recognitions per game: 14 (community figure).

**Function map** (magnitude 20, baseline 45/70/0, gun-body sensor at ~40 cm; protocol independence measured for
fn 1, 3, 8, 23–28, 35 across protocols 0/5/7/9/10; a headset-dome hit is untested):

| Class | Function ids | Measured behaviour | Polarity |
|---|---|---|---|
| Standard damage | 1, 3, 4, 5, 7, 29, 30, 33, 38 | −magnitude per hit, shields → armor → HP | enemy only |
| Armor-piercing | 2, 6 (+17, 21 enemy-side) | HP drops with armor and shields untouched | enemy only |
| ×1.25 damage, truncated | 36 | 20 → 25, 40 → 50, 9 → 11, **7 → 8** (floor); 16 trials, 4 magnitudes, 8 row-tail shapes, fn 1 control in every trial (2026-09-02) | enemy only |
| ×2 damage | 37 | 20 → 40, 40 → 80, 9 → 18, 7 → 14 | enemy only |
| Add HP, overflow → armor | 9, 12, 16, 19 | 15 → 35 → 45, then +armor | ally only (16/19 also damage enemies) |
| Add HP, clamp | 10, 17 | 15 → 35 → 45, no overflow; fn 10 is the "respawn + add HP" row | ally only (17 also AP-damages enemies) |
| Add HP, overflow → shield | 14, 21 | 15 → 35 → 45, then +shield | ally only |
| Add armor | 13, 15, 20, 22 | 0 → 20 → 40; overflow spills to shields | ally only (20 also strips enemy armor) |
| Add shield | 11, 18 | 0 → 20 → 40, saturating at `$PSET` t5 | ally only |
| **Audio suppression** | 23 | Registers a hit, no pool change; the gun goes silent (`$ALCD` token 2 drops 100 → 0) and recovers over ~6–8 s (0 → 5 → 9 → 31 → 100) while it keeps firing and emitting IR normally; cleared by `$SPAWN,,*`. The only native "silence" effect found; usable by any host today (2026-08-27) | enemy |
| Registers, no pool change | enemy 8, 24, 25, 26, 27, 28, 35 · ally 31, 32, 34 | `$HIR` fires, pools unchanged (re-tested with 150 shield available); a stun / fire-rate buff / nothing is not distinguished | n/a |
| No registration | 0, 39–45 | | n/a |

The stock 10-row table the official app sends (Team Arena):

| Row | Interpretation |
|---|---|
| `$SIR,0,0,,1,0,0,1,,*` | Standard weapons (AR, SMG, Energy Rifle, Ion Sniper, Laser Cannon, Plasma Sniper, Shotgun, Stinger, Suppressor): plain damage |
| `$SIR,0,1,,36,0,0,1,,*` | Force Rifle / Sniper Rifle: floor(magnitude × 1.25) |
| `$SIR,0,3,,37,0,0,1,,*` | AMR / Bolt Rifle / Burst Rifle: magnitude × 2 |
| `$SIR,1,0,H29,10,0,0,1,,*` | Respawn + add HP |
| `$SIR,2,1,VA8C,11,0,0,1,,*` | Add shields |
| `$SIR,3,0,VA16,13,0,0,1,,*` | Add armor |
| `$SIR,6,0,H02,1,0,90,1,40,*` | Rail Gun |
| `$SIR,8,0,,38,0,0,1,,*` | Charge Rifle |
| `$SIR,9,3,,24,10,0,,,*` | Energy Launcher (fn 24 is a no-pool status: zero damage as shipped) |
| `$SIR,10,0,X13,1,0,100,2,60,*` | Rocket Launcher |
| `$SIR,11,0,VA2,28,0,0,1,,*` | Tear gas (community: not working; unverified) |
| `$SIR,13,0,H50,…` / `13,1,H57` / `13,3,H49` | Energy Blade / Rifle Bash / War Hammer (melee) |

Protocols in use: stock 0, 8, 10, 11, 13 and 15 (grenade beacon); the app's table also ships rows on 1, 2, 3, 6, 9.
Unused: 4, 5, 7, 12, 14. `$SIR,15,<sub>,,24,0,0,1,,*` (friendly fire on) surfaces grenade-station words as `$HIR`
with no pool change.

## 6. `$WEAP` — weapon definition

Six slots (0–5); slot 4 = melee by convention (gyro swing, `$BMAP,8,4`). The full 0-indexed token map with
APK field names is in [`callsign-extract/protocol-classes.md`](callsign-extract/protocol-classes.md) and is
rendered with per-token confidence in `docs/manual/06-developer.md`. Known-good frames:

```
Assault Rifle : $WEAP,0,,100,0,0,24,0,,,,,,,,100,850,32,32768,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,9999999,75,,*
Charge Rifle  : $WEAP,1,,100,8,0,150,0,,,,,,,,1250,850,100,32768,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,C19,C04,20,150,100,9999999,75,,*
(Slot 2)      : $WEAP,2,,100,0,0,150,0,,,,,,,,1000,850,2,32768,2000,0,7,100,100,,0,,,E07,D32,D31,,D17,D16,D15,A73,,,,,2,9999999,75,,*
Gas Melee     : $WEAP,3,1,90,11,1,1,0,,,,,,1,80,1400,50,10,0,0,10,11,100,100,,0,,,S16,D20,D19,,D04,D03,D21,D18,,,,,10,9999999,30,30,*
Melee         : $WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,32768,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,9999999,30,,*
(Slot 5)      : $WEAP,5,1,90,10,0,115,0,,,,,,115,80,1000,850,2,32768,1200,0,7,100,100,,0,,,C03,,,,D14,D13,D12,D18,,,,,2,9999999,30,20,*
Shotgun (cap) : $WEAP,1,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*
```
(The AR sample's t5 = 24 is the manual's stale M-4 anchor; the stock Callsign AR actually emits 9.)

**Bench-proven tokens** (0-indexed; the bench tool prints raw 1-indexed positions, so raw = tok + 1):

| tok | Field | Proof |
|---|---|---|
| 3 | primaryDamageType = the IR word's B field / `$SIR` protocol key | echoed as `$HIR` tok2; stock 8 charge, 10 rocket, 11 gas, 13 melee |
| 5 | primaryDamage = the raw magnitude in the IR word | = `$HIR` tok5; pushed 22 → 9 → 115 and only those bits moved |
| 14 | **fire interval / charge time (ms)** | one-field flip: a sniper at t14 = 1250 fired one shot every 1.25 s. A compiler that trusted the APK field order wrote the rate into t15 and shipped every weapon at 10 shots/s |
| 15 | **weapon-swap delay (ms)** | 1700 doubled the swap, 425 halved it, 100 ran at 100; linear, no floor; the gun takes the larger of the two loaded slots' values (2026-09-04). Stock 850, melee 100 |
| 16 / 39 / 40 / 17 | maxClip / clipStartingAmmo / ammoReserv / maxAmmo | t39 = t16 and t17 = 2 × t40 in every stock frame; 9999999 / 32768 = unlimited |
| 20 | **fire mode** | `0` full-auto · `7` single-shot/bolt · `9` burst (cycle in t23) · `2` charge, auto-release (a tap also fires) · `3` hold-to-charge, auto-fire (a tap is sound only) · `14` tap-fire or charge-release · `13` melee. Proven by flipping only t20 on a captured sniper (7 → 0 went full-auto); the Burst Rifle (t20 = 9, t23 = 275) fires exactly three rounds per pull |
| 23 | burstWeaponTime (ms) | 275 Burst Rifle, 250 Force Rifle, empty elsewhere |
| 24 / 35 / 37 / 38 | overheat: heat per shot / overheat sound / enable-and-parameter pair | t24 and t35 are **inert on their own** (SMG, Energy Rifle, Plasma Sniper ship them and never overheat). t37/t38 (Charge Rifle stock `20,150`) switch the mechanism on: transplanting them onto the SMG brought its heat gauge alive. Which of t37/t38 is threshold vs cooldown is unmapped. Live heat streams in `$ALCD` token 5 |
| 27 / 28 / 29 | fire sound / engage sound / release sound | t27 is a sound, not an identity (Rocket Launcher and Rail Gun both fire `C03`). `C…` in t28 = a charge sound; `D…` = extra reload parts; t29 present only when the weapon has a distinct release event |
| 1, 12, 13, 42 | extra-headset block | t1 = 2 on exactly the three weapons carrying extra-headset damage / range (Shotgun, Rocket, Plasma Sniper) |
| 7–11 | secondary-fire block | empty on all 20 captured stock frames: no stock weapon has an alt-fire |

Unknown or unverified: t2 (100 on guns, 90 on melee), t19 (not simply reloadType), t25/t26 (Suppressor only),
t41 (APK name gunRangeIndoor, 75 on every gun and 20 on melee; whether it changes emitted range is untested),
t6 crit chance, t21/t22 accuracy.

## 7. What the gun does NOT hold

Three captures at respawn 5 / 15 / 30 s produced byte-identical `$GSET` and `$PSET`; the 8-field `$GSET` map
has no respawn, time, lives or score token; the app's end-of-game tail is `$VOL → $HLED,,6 → $STOP → $CLEAR →
$PLAY` and it never asks the gun for a score; reconnecting after out-of-range play yields zero frames. **The
gun keeps no game state.** Respawn, the clock and the score live in the host, which must stay in BLE range for
the whole match (the phone in the official system; a per-player node in ours).

**State survival:** game config, alive/dead, ammo and `$TID` survive a BLE drop (re-send the whole head after a
reconnect anyway; see the retractions table in `session-findings-2026-08.md` for the two contradicting
`$SPAWN`-after-drop readings); a power-cycle wipes everything except `$NAME`; switching the headset off makes
the gun send `$DISCONNECT,*` and drop the link; a power-cycled gun needs its headset re-linked before BLE holds.

**Still open on v4.32:** `$AS` / `$UP` / `$SP` semantics and the `$RV`/`$RP`/`$KK`… family; the `$PB*` enum
tables; `$BHIT` / `$HFIRE` / `$IRTX` in their real 11- and 7-field shapes; `$QUERY` over BLE; `$LCD` and
`$VOLTS` tokens 3–4; `$SIR` p5–p8 and the "registers, no pool change" functions; the gun↔headset link protocol
and the nRF radio (`NRFhost 1` / `NRFslave 1` in the USB record); Gen1 command differences.

## 8. Safe testing notes

- The tagger's stock firmware is untouched by all of this; power-cycling the tagger restores normal operation.
- Factory restore path: Battle Company's official USB updater.
- Recommended probe sequence: connect → `$PING,*` → await `$PONG` → read-only listen session (pull trigger, get tagged, watch `$BUT`/`$HIR`/`$HP` traffic) before sending any config.
- Panic sequence: `$CLEAR,*` then `$SP,99,*`. It leaves the gun with no `$SIR` table, so it cannot be hit until it is re-armed or power-cycled: correct for a panic stop, not a playable state.

## 9. The micro-USB "Programing Port" console

The tagger's MCU is a PJRC Teensy; the port enumerates as a **Teensyduino USB Serial** CDC device (VID `16C0`,
Windows `COMx`, macOS `/dev/tty.usbmodem*`, Linux `/dev/ttyACM*`). Baud is ignored. It is a plain serial
terminal (PuTTY in serial mode, `screen`, pyserial), not the `$` protocol: every `$` frame is echoed back (local
echo is on) and, with a CR, answered `ERROR`. Two case-insensitive, CR-terminated commands work (command set from
LaserTagMods' headset-pairing note):

- **`QUERY`** dumps the device record: gun version, `Serial Number/Head PIN` (matches the paired headset's
  sticker), `Gun Name` (the `$NAME` field), headset version (`?` briefly after a power-cycle), gun and headset
  volts, `PlayerID`, `FieldID`, `NRFhost`/`NRFslave`, `devHost`, burn-in times, `Grenade Pin`, laser mW (`16.9 mW`
  on one unit; can read `UNTESTED`), `PCB-5`, `BTchip- 4`, `BT central V: devhost.03`. Lines end `\r\r\n`, `Gun
  Name` is NUL-padded. `python -m brx_mcp usb-query` parses it and saves a backup to `~/.brx-mcp/device-backups/`
  (kept out of the repo: it holds the headset PIN). This is the only local backup the tagger offers.
- **`SETUP`** enters factory provisioning and prompts (EN/中文) for the **headset's serial number**: the
  gun↔headset pairing mechanism. The "Factory Defaults" banner is a mode header, not an action: entering and
  power-cycling out changed nothing. Only the first prompt has been walked. Per-game identity does not need it
  (`$PSET` token 1).
- Hold SELECT while powering on with USB connected → a different mode: USB mass storage exposing the firmware
  `.BIN` and the `AUDIO` folder (the sound-pack update path).
- **Firmware backup is impossible**: Teensy's HalfKay bootloader is write-only. Rollback depends on Battle
  Company supplying the original image; the official app's version gate ("supported until v2.01e") is an upper
  bound that warns and still runs a game. Do not reflash `devhost` units.
