# BRX Serial Command Protocol Reference

**Status:** reference, current as of 2026-09-12. Each row states the current reading only. The dated
bench write-ups that produced it, with every retraction, are in
[`session-findings-2026-08.md`](session-findings-2026-08.md) (frozen) and `docs/experiment-log/`
(the live notebook). The published developer reference built from this file is
`docs/manual/dev.md`.
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
| `$GSET,<t1>,…,<t8>,*` | Global game settings, 8 tokens | `friendlyFire, outdoorMode, gunLaserRegion, autoAmbientLight, gyroscope, secondaryBluetoothWeapons, criticalShotModifier, gameMods`. Captured `$GSET,0,0,1,0,1,0,50,1,*`. **Token 1 is firmware-enforced both ways**: 0 blocks same-team damage and enemy heals, 1 opens the gate. **Token 7 is the crit modifier in percent, and it is not a generic "crit" — it is the HEADSET-sensor multiplier on `$SIR` fn 36/37 rows only** (bench 2026-09-11, §5): fn 36 = magnitude × (1 + t7/200), fn 37 = magnitude × (1 + 2·t7/100); every other function, and every gun-body hit, is unaffected by t7. The `$HIR` crit bit (token 6) is a separate, unset axis. 0 disables the fn 36/37 scaling, 100 triples fn 37 (×3; fn 36 → ×1.5); the shipped/MC-compiled 50 is why the two functions read as a fixed ×1.25/×2. **No respawn, time, lives or score token**: those live in the host (§7). **Token 2 is APK-named `outdoorMode`, but it is not the gun's persisted ALT-hold mode and does not control emitted range. It gates hit reception on the gun receiving it.** At 30 ft, t2=1 registered 0 hits from a full clip and worked only from inches; t2=0 registered 16 of 27 shots and then every aimed shot under the same conditions (field 2026-09-13). MC therefore pins t2=0 for indoor and outdoor heads, including try-outs and utility paths. What t2=1 physically changes, whether it affects all sensors equally, and whether it rejects indoor reflections are untested. The physical ALT-hold mode is a separate, measured beam-width control: outdoor mode gave roughly twice the aim tolerance on three guns, while native shots reached about 200 ft in both states. Token 3 `gunLaserRegion` remains the captured `1` at both venues; its effect is untested. Tokens 4–6 and 8 carry APK field names only and have not been characterised |
| `$PSET,<id>,0,<hp>,<armor>,<shield>,50,,<voice pack…>,*` | Player settings | **Token 1 = player id, 0-based 0–63** (the app shows 1–64 and writes id−1; out of range clamps to 63). Ends up in every IR shot's player field and comes back as `$HIR` token 3 on whoever you hit. Token 2 is inert (0/1/7 identical). Tokens 3–5 = HP / armor / **shield capacity** (the spawn shield is always 0; token 5 is the ceiling, not a starting value). The pool fills from an IR grant (fn 11/18, or armor overflow) **and over BLE from `$LIFE,0,0,<n>,*`, which is additive and takes negatives** (bench 2026-09-11, no `$SIR` row present); both saturate at t5. Armor and HP store and decrement exactly to at least 1000 (a 255 cap is policy, not a device limit); shield width is inferred, not measured. ⭐ **Token 6 is the CRIT DAMAGE MULTIPLIER, resolved 2026-09-18** (V4_31 disassembly at 0x10FBC via the LaserTagMods session): on a crit roll the SHOOTER multiplies its damage by **(100 + t6)/100**. We ship **50**, which is the whole of the x1.5 measured on the bench that day (a 9-damage weapon landing 13). ⚠️ This is why the earlier sweep found "0-200, no effect": every stock weapon ships `$WEAP` t6 = 0, so a crit never ROLLED and the multiplier had nothing to scale. The two tokens are different things and both are needed: **`$WEAP` t6 is the crit CHANCE** (bench-measured as a percentage, 14% at 20 and 45% at 50) and **`$PSET` t6 is the crit DAMAGE**. A crit-damage perk is therefore one `$PSET` token. The receiver-side `$GSET` t7 headset scaling is a further layer on top of this. Tokens 8+ are a positional voice pack of sixteen sound ids (names in `callsign-extract/protocol-classes.md`). e.g. `$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*`. **Slot↔name alignment CONFIRMED 2026-09-07** for the pool slots: the APK order is correct, `hitHp` / `hitArrmor` / `hitShield` sit exactly where the field list says (a voice line placed in the hitShield position was heard on a shield hit; an intermediate "the slots are swapped" reading was retracted after a control showed the sound had not moved). Three further findings on the effect tail, all bench-measured the same day: **(a) AN EMPTY EFFECT FIELD IS NOT SILENCE — it falls through OUTWARD to the neighbouring pool's clip.** An empty `hitShield` plays the ARMOUR clip; `hitHp` is silent only because it is the innermost pool with nothing further in to fall to. This is NOT the A15.2/A15.3 rule (an empty VOICE field really does make the gun say nothing) and does not follow from it. **(b) `energyShieldLoop` (the last token) is a REAL LOOP** that runs while the shield is up, survives a `$PSET` rewrite, and stops only on `$PLAYX,0,*` or the shield reaching zero — Callsign's stock `A10` is a geiger-ish tick, and because it loops it plays under every shield-band hit. **(c) A `$PSET` sound id is overridden by a non-empty `$SIR` `<soundID>` on the row that fired** (§5): the two do not layer, so per-weapon and per-pool audio compete for one hit. |
| `$WEAP,<slot>,…,*` | Define a weapon in slot 0–5 | ~43 tokens: damage, fire interval, fire mode, clip/reserve, reload, sounds, IR type. See §6 |
| `$SIR,<protocol>,<subtype>,<sound>,<function>,…,*` | Incoming-IR effects matrix | Maps an IR `<protocol, subtype>` key to a function (damage, heal, armor, shield, status). Unmatched cells are silently ignored. See §5 |
| `$BMAP,<button>,<function>,<swap0..3>,*` | Remap physical controls | Buttons: 0 trigger · 1 alt-fire · 2 reload handle · 3 select · 4 left · 5 right · 8 gyro. Functions seen: 0 fire · 97 reload · 98 (select/left/right) · 100 weapon-cycle · 4 melee (gyro). **Mandatory**, sent before and again after `$SPAWN`: without it the trigger only chirps "disabled". With one `$WEAP` slot loaded, function 100 has nothing to cycle to and falls back to reloading |
| `$TID,<team>,*` | Team id | **Masked to 2 bits** (`team & 3`): four native teams 0–3. Sets the default LED colour at `$SPAWN` (1 = blue, 2 = yellow observed) and is echoed as `$HIR` token 4 on the victim. A live write changes hit resolution immediately but does not repaint the LEDs. **⚠️ TEAMS ARE 0-3 (bench 2026-09-07).** The IR word's team field is 2 bits and the gun transmits `tid & 3`, but a victim compares the incoming team against its FULL tid. So on any tid >= 4: two teammates each send `tid & 3`, read it as different from their own tid and **damage each other**; their shots read as friendly to the real tid 0-3 team they alias onto, which **takes no damage**; and a gun can **kill itself** off a nearby surface (observed: a `$TID,5` gun sent `$HIR,4,0,7,1,9` naming its own player id and drained its own armour to 0). Captured words: tid 4 → `team=0`, tid 5 → `team=1`. Use 4-7 as COLOURS only, never as a team. |
| `$SPAWN,,*` | **Go-live and respawn** (note the empty token) | Restores HP/armor and, on respawn, ammo; echoes `$LCD,<hp>,<armor>,0,0,<mag>,<reserve>,*`. Clears the `$SIR` fn-23 state. **Leave at least 3 s after a death before respawning**: sent within ~2 s the headset never executes it and stays stuck in the green out-blink (1.0/2.0 s stick, 2.5/3.0/6.0 s clean, 2026-09-02). The headset is a second device behind a relay, so any command it must execute needs a settling gap. **`$SPAWN` also clears any headset colour painted with `$HLED`** (2026-09-03) |
| `$AMMO,<slot>,<mag>,<reserve>,<flag>,*` | Load magazines | Must follow `$SPAWN,,*` at initial go-live or the gun is live with no ammunition (e.g. `$AMMO,0,36,108,1,*`). A respawn `$SPAWN` restores ammo on its own. A `$WEAP` re-push resets ammo to the frame's values: re-send `$AMMO` after any weapon swap |
| `$PLAYX,0,*` | Stop/clear sound playback | Sent right after `$STOP` on connect and just before the go-live cue |
| `$PLAY,<soundID>,<volume>,<priority>,<announcerID>,,,,*` | Play a sound / voice line by id | Two slots, and they do not behave the same way (bench-proven 2026-09-11, six trials): **token 1 INTERRUPTS** — a new id in slot 1 cuts whatever is currently playing in either slot, mid-word if needed — and **token 4 QUEUES** — a new id in slot 4 waits for whatever is ahead of it and plays in order, depth ≥ 3 observed. The behaviour belongs to the SLOT, not to the kind of id: an "fx" id dropped into token 4 queues exactly like a voice line. `$PLAY,,4,6,V3A,,,,*` speaks "kill" with token 1 empty; `$PLAY,VSF,4,6,JAY,,,,*` uses both, one frame, no layering (they still resolve as interrupt/queue against whatever was already playing, not against each other in that same frame). **Tokens 2–3 are required**: `$PLAY,VA33,,,,,,,*` is silent, `$PLAY,VA33,4,6,,,,,*` speaks. A sound that must not step on an announcer line belongs in slot 4 regardless of its apparent type; hit-path/urgent sounds belong in slot 1 and accept that they can cut a line off. Valid ids: the **2,477 files on the gun** (`docs/reference/sound-catalog.md`); the app's own `Sounds.json` lists 2,166, of which 157 are not on the gun. An unknown id plays a fallback sound, not silence |
| `$VOL,<0–100>,<n2>,*` | Master volume | Android app sends `$VOL,100,0,*`; iOS `$VOL,69,0,*`. 30 is inaudible for weapon and game audio, 45 barely audible; use ≥ 65 to hear a tagger. Mission Control plays at **80 indoors / 90 outdoors** (`compile.play_volume()`), try-outs at 69, probing at 30. The on-gun 1–5 menu ↔ `$VOL` mapping is an unmeasured field estimate (roughly L2 ≈ 69), not a fact |
| `$NAME,<name>,*` | Set the gun's persistent name | The USB `Gun Name` field; survives power-cycle. Opening the official app rewrites it to `Tactix2` |
| `$VERSION,*` | Query firmware | Reply `$VERSION,v4.32,?,4,,devhost.03,*`; token 2 reads `hds.59` with a headset linked |
| `$SP,<n>,*` | End-of-game / stop (LaserTagMods) | `$SP,99,*` is the second half of the panic sequence. Other values unmapped. The gun keeps no score to report |
| `$QUERY,*` | Status array over BLE | Returns a `$`-framed array (`$QUERY,0,0,0,0,0,,1,0,,0,…`, undecoded) plus a `$LCD`. **Not** the USB device record (§9) |
| `$PBGAME` `$PBTEAM` `$PBWEAP` `$PBPERK` `$PBLIVES` `$PBTIME` `$PBSPAWN` `$PBINDOOR` `$PBLOCK` `$PBSTART` | The "playbook" pre-battle family (community, fw v4.30) | Mirrors the on-gun menu; a second remote-start path: `$PBGAME,0` FFA · `$PBWEAP,0` M4 auto · `$PBPERK,2` Body Armor · `$PBLIVES,2` 5 lives · `$PBTIME,5` infinite, then `$PBSTART,*`. `$PBWEAP,0,*` produced a "game starting" sound on our v4.32; enum tables not reproduced on v4.32 |
| `$AS,…,*` · `$UP,100,<n>,0,*` + `$UR,*` · `$RV` `$RP` `$UR` `$IT` `$KK` `$TA` `$PT` `$HS` `$PH` `$RR` `$PKC` `$HKC` `$KOTH` `$RADSK` `$INDOOR` `$#CONNECT` `$BRXSERVER` `$SSID` `$PASS` `$BRX` | LaserTagMods / community vocabulary | Seen in JEDGE sources or the v4.30 community capture; unmapped on v4.32 (`$AS` silent across seven shapes; bare `$UP,*` gets no reply; `$UP` with arguments is probably a write). Leads, not protocol |

**⚠️ Canonical arm sequence — don't hand-roll this.** A partial one still spawns and shows HP/armor
(looks armed) while the trigger fires nothing (2026-09-10 bench incident). Slot 0 is PRIMARY (what the
trigger fires), slot 1 is SECONDARY.

| # | Frame | Why | Omit it and… |
|---|---|---|---|
| 1 | `$CLEAR,*` | reset game state | stale config from a prior game may linger |
| 2 | `$START,*` | enter config mode | later config frames aren't guaranteed to take |
| 3 | `$GSET,…,*` | game rules (FF, receive gate, crit) | rules default to the last game's |
| 4 | `$PSET,…,*` | HP/armor/shield + voice pack | pools/sounds default to the last game's |
| 5 | `$WEAP,0,…,*` / `$WEAP,1,…,*` | load weapons — **0 = primary, 1 = secondary** | weapon in slot 1 only ⇒ trigger fires nothing (slot 0 is empty) |
| 6 | `$SIR,…,*` ×10 | incoming-IR effect table | **must follow any `$CLEAR`** (F11) — a gun with no rows silently eats every hit while reporting healthy |
| 7 | `$BMAP,…,*` ×7 | bind buttons to weapon slots | trigger gives the "disabled" chirp, or fires nothing |
| 8 | `$TID,<team>,*` | team (0-3 only, see the `$TID` row) | wrong-team damage resolution |
| 9 | `$SPAWN,,*` | **go live** — note the empty token; `$SPAWN,*` is a different command | gun never actually goes live: looks armed, trigger does nothing |
| 10 | `$AMMO,0,…,*` / `$AMMO,1,…,*` | load magazines, **after** `$SPAWN,,*` | gun is live with an empty magazine — spawns and shows HP/armor, trigger fires nothing |
| 11 | `$BMAP,0,0,,,,,*` | re-send after `$SPAWN` | app does this; matches the captured sequence |

Build this with `gameconfig.arm_sequence(team, player_id, weapon, extra_sir=…)`
(`mcp/brx_mcp/gameconfig.py`) instead of typing it by hand — it reuses the same wire tables the CLI and
MC compiler use, in this order, and `assert_arm_sequence_complete()` raises before you send a bundle
that's missing `$START`, any `$AMMO`, any `$BMAP`, the correct `$SPAWN,,*` form, or a slot-0 weapon.

### 3.2 In-game effects, feedback and pools

| Command | Purpose | Notes |
|---|---|---|
| `$SFLASH,*` | **The shooter's green-sight kill-confirm flash** | No arguments. The host sends exactly one per kill the holder scores, ~0.4 s after the trigger burst. Works on an idle unspawned gun. Verified from our own stack |
| `$LIFE,<hp>,<armor>,<shields>,*` | Grant **or drain** a pool | **Bench-measured 2026-09-09** (first time either direction was ever measured; the old row was APK/spec-derived). Additive, clamped at the pool max, never an absolute set — and it **DOES self-emit `$HP`**, contrary to what this row used to say. ⭐ **It accepts NEGATIVES and drains**: `$LIFE,0,-5,0,*` took armour 66 → 61. A negative is **per-pool and floors at 0 with NO spill** — `$LIFE,0,-100,0,*` on armour 61 left armour 0 and HP untouched at 45, so it does **not** cascade shield → armour → HP the way IR damage does; a host applying damage must do its own pool arithmetic. ⚠️ **A lethal negative really kills** (headset green out-flash, trigger dead, `$BUT` with no `$ALCD`) but announces it with `$LCD,0,0,0,0,<mag>,<reserve>,*` and **never `$HP,0,0,0`** — see the `$HP` row |
| `$BUMP,<amount>,,<pool?>,,,*` | Add to a pool — **LIVE; this is Callsign's shield recharge** | ⭐ **Capture 2026-09-18 (cap30, `captures/2026-09-18-callsign-shield-recharge.txt`) overturns the 2026-09-09 "INERT" row.** Callsign sends **`$BUMP,12,,1,,,*`** (six tokens) and every frame raises the ARMOUR pool (`$HP` token 2) by 12 within ~50 ms, clamping at the `$PSET` armour value (…,64 → 70). The bench shapes that did nothing were `$BUMP,-5,0,0,*` and `$BUMP,0,5,0,*` (hp,armor,shields per the APK name order), so **the APK order is wrong or incomplete, as it was for `$GLED`**. Reading, unproven beyond this one shape: token 1 = amount, token 3 = pool selector (1 = armour). Untested: other pool values, negatives, the empty tokens. Recharge recipe in S45; `$LIFE` still works for grants (F65) |
| `$GLED,<led1>,<led2>,<led3>,<apply-gate>,<brightness>,,*` | **Gun body LEDs, one palette index per LED** | Palette: **0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink · 8 orange**; 9 and 10 dark (measured with a camera rig 2026-09-02, all three LEDs agreeing). **Token 4 is an apply gate**: 0, 6, 7, 8, 9, 10 apply the colour tokens at full brightness; 1–4 are no-ops (the gun keeps what it was showing). **⚠️ CORRECTED 2026-09-07: gate 5 is OFF, not one-third.** `$GLED,3,3,3,5,10,,*` on a host-owned strip reads as DARK, not a dim green (A/B against gate 0 at the same level, operator call: "bright then off, no steps in between"). The earlier "~1/3" reading was taken while the firmware breathing was still contending and does not survive a clean A/B. Gate 5 is what makes the blank `$GLED,,,,5,,,*` work, and it should never be sent with colour tokens. **The real dimmer is token 5** (see below). No value animates. `$GLED,,,,5,,,*` (Callsign's on-death frame, and the night-mode frame we ship) blanks the gun because gate 5 is OFF. ⭐ **AN EMPTY COLOUR TOKEN IS RED, NOT "LEAVE THIS LED ALONE"** (bench 2026-09-09, controlled test): a blank field parses as 0 and 0 is red, so on a strip held at three solid purple, `$GLED,,9,,0,10,,*` produced red / dark / red. **Always write all three colour tokens**; there is no way to move one segment without restating the others. **Token 5 is brightness, and it is the night dimmer**: 0 off, 1 clearly dim, ≥ 2 full (saturates). Confirmed 2026-09-07 by A/B on a blanked (host-owned) strip: level 1 vs level 10 steps visibly and the hue stays clean ("now its dim green"), including on a mixed per-LED frame (`$GLED,3,3,9,0,1` = dim green / dim green / dark). The two do not compose: gate 5 is off, so use gate 0 + token 5 for brightness. **The blank is required before any paint holds** (2026-09-07): `$GLED,9,9,9,0,10,,*` sent to a spawned gun with NO prior blank leaves it breathing; after the blank the same frame holds dark. ONE blank per life is enough (it is idempotent, and only `$SPAWN` re-enables the breathing), and a held paint SURVIVES `$AMMO`, `$PLAY`, `$HLED` and `$LED` traffic. Without a blank, a painted colour alternates with the native animation; repainting fast enough to win (~30 Hz) strobes in the photosensitive band, so signal events with a short burst of three flashes (0.08 s pulses, 0.10 s apart) instead |
| `$HLED,<colour>,<effect>,<on_ms>,<off_ms>,<brightness>,<count>,*` | **Headset LED** | Token 1 = colour, **same palette as `$GLED` for 0-7, all eight verified on hardware 2026-09-07** (0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink; 8 reads red on the headset and orange on the gun, unverified since; 9 and 10 dark). ⚠️ **A COLOUR INDEX IS NOT A TEAM ID.** `$TID,0..7` are all accepted and the firmware breathes the matching colour, but **only tids 0-3 work in combat** — see the `$TID` row. **The headset is one lamp with one colour: token 1 is global, tokens 2+ never address the four modules individually** (2026-09-02). Token 2 effect: 0 solid · 1 breathe · 2 blink · 4 fade-out blink (Callsign's low-health form) · 6 blank · 3, 5, 7, 8 nothing/dark. Tokens 3/4 on/off ms. Token 5 brightness: 1 dim, ≥ 2 full, saturated by 10 (Callsign's 10 is already maximum). Token 6 flash count. The first flash is always bright and the rest dim (firmware). **⚠️ EFFECT 6 (blank) DISABLES THE FIRMWARE'S OWN DEATH-FLASH LOOP for the rest of the life (bench 2026-09-07): a gun killed after any `$HLED,,6` does NOT run the native out-flash, while the same gun killed after a COLOUR write does. Use `$HLED,9,0,,,10,,*` (colour 9 = dark) to darken the headset in play; keep effect 6 for teardown only. The native HIT flash is unaffected by either.** **`$SPAWN` and every registered hit clear a painted colour**; a single frame painted after spawn holds until the next hit, so a persistent team/out colour must be re-painted after every `$SPAWN` and every `$HIR` (2026-09-03). Captured app frames: `$HLED,<team>,0,,,10,,*` pre-game, `$HLED,7,4,90,90,10,15,*` on the victim at armour 0, `$HLED,,6,,,,,*` at game end |
| `$HLOOP,<0 disable / 1 enable / 2 heartbeat>,<rate_ms>,*` | **Headset LED loop — drives the SMALL flash LED at firmware drive** | **Bench-proven 2026-09-07 (Tactix-XXXX, alive AND dead):** `$HLOOP,2,<ms>,*` and `$HLOOP,1,<ms>,*` (indistinguishable by eye) blink the **small green flash LED** — the lamp the firmware uses for its own hit / out flash — indefinitely. **Token 2 is a period in ms** (750 vs 2000 visibly different). On a DEAD gun whose death loop had been suppressed by an `$HLED,,6`, it **restores the flash at native drive or brighter** (operator, side by side with the native blink he had just seen: "looks like native", "might be brighter"). The **big RGB LED is untouched** and holds whatever `$HLED` painted — the two lamps are independent. `$HLOOP,0,0,*` stops it, and **`$SPAWN` clears it on its own**, so a revived player cannot be left flashing. Callsign's `$HLOOP,0,0,*` ~1.7 s after every death is the disable of this loop. ⚠ Not metered against a native out-blink; rate range untested |
| `$LED,<colour>,<isUsedGreenLed>,*` | The headset's small green flash LED | Exactly two fields. `$LED,9,1,*` = one visible green flash (~66 ms); colour paints the big LED at the same time (9 = leave it alone). No intensity, duration or count field |
| `$BLINK,<colour>,<on_ms>,<off_ms>,<level 0-10>,<loop>,*` · `$CHASE,<colour>,<rate>,<level>,<loop>,*` | Headset blink / chase (APK layouts) | Never sent in the right shape on the bench |
| `$BHIT,<bulletType>,<playerId>,<team>,<damage>,<isCrit>,<powerLevel>,<direction>,*` | Host-injected hit (APK layout, read 2026-09-04) | Runs the firmware's own hit path in the app's model. Earlier probes used a 3-token guess and were echoed with no damage; **untested in the real shape** |
| `$HFIRE,…,*` (11 fields) | Heavy/burst fire (APK layout) | `Direction, BulletType, PlayerId, Team, Damage, IsCriticalShot, PowerLevel, Range, CountIRPulses, RateOfFire, FlashLED`. An earlier 4-field guess emitted zero IR with a receiver control. Untested in the real shape |
| `$IRTX,<Direction>,<BulletType>,<PlayerId>,<Team>,<Damage>,<IsCriticalShot>,<Power>,<IrRange>,<LoopFire>,<IrPulse>,<FlashLED>,*` | **Raw IR transmit — APK-only, unmapped, untested** | Eleven fields, recovered from the 2026-09-04 il2cpp metadata read (`callsign-extract/protocol-classes.md` "Other command field maps"; the shape itself is written out in `docs/bench-flash-control-2026-09-05.md` §"`$IRTX` (11)"). **Never captured on the wire, never sent by MC, never accepted by a gun in our hands.** ⚠️ **A SECOND, OLDER FIELD LIST FOR THIS COMMAND IS WRONG.** `callsign-extract/protocol-classes.md`'s table also carries a 4-field row `iRPower, soundOnHit, rangeOutdoor, rangeIndoor` — it reads like a direct indoor/outdoor range control, which is why it keeps getting picked up, but that shape was probed on the bench and **emitted zero IR** against a receiver control. Trust the 11-field shape. In it, `$IRTX` **transmits a word**: `Power`/`IrRange` are parameters of the shot it sends, not a persisted venue mode, and whether they also stick for the trigger's own later shots is unmeasured. Enums as for `$BHIT` (BulletType Standard 0 · MeleeDamage 13; IRDirection Front 0 … All 100). A zero-damage probe frame is staged in `mc/compile.py` behind `DRIVE_IO_MODE` (FOLLOWUPS F162, experiment-log Run E) and is **not** emitted by any shipped head |
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
| `$ALCD,<mag>,<accuracy>,<slot>,<reserve>,<heat>,*` | Ammo/weapon HUD stream | One frame per round fired **and** per round reloaded (a reload is a burst of frames). ⭐ **Token 2 is the LIVE ACCURACY of the simulated-recoil model, bench-proven 2026-09-09** — not the "audio level" this row used to claim. It arms at `$WEAP` **t21** (the ceiling), under sustained fire it falls in **five steps of one fifth of the t21-to-t22 range**, floors at `$WEAP` **t22**, recovers with time between shots, and **resets to t21 on reload**. ⚠️ The steps do NOT land one per shot: the two measured walks reached their floor on shot **8** and shot **11**, so shots-per-step is not fixed and is uncharacterised (n=2). Measured on the AR at t14=100 ms: t22=0 walked 80·60·40·40·40·20·20·0 and pinned at 0; t22=50 walked 90·90·90·90·90·80·70·70·70·60·50 and pinned at exactly 50 for the remaining 22 rounds; stock t21=t22=100 never moved off 100 across 32 rounds. ⚠️ The `$SIR` fn-23 "audio suppression" finding cited this token dropping 100→0 as its evidence. The silence was heard by ear so the effect is probably real, but the NUMBER quoted as proof was this accuracy field — re-read fn 23 before trusting its mechanism (F66). Token 3 = weapon slot (alt-fire cycles 0↔1; melee slot 4 appears as an isolated frame on a gyro swing). Token 5 = **weapon heat** (raw, exceeds 100 at overheat; non-zero only on overheat weapons). Only streams on ammo events: silence is not "no change" |
| `$HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,*` | **Hit received** | See §4.1 |
| `$HP,<hp>,<armor>,<shield>,*` | Pools after a hit | Same millisecond as its `$HIR`. `$HP,0,0,0` = death. **A `$LIFE` write DOES self-emit it (bench 2026-09-09) — but only while the write is non-lethal.** A `$LIFE` that takes a pool to zero emits `$LCD,0,0,0,0,<mag>,<reserve>,*` INSTEAD, and no `$HP` at all: the frame shape swaps on the lethal write. ⚠️ **Our stack DOES handle this** (checked 2026-09-10): `engine.js`'s `case 'LCD'` books a death at `hp === 0`, and `stage.py` routes `$LCD` through the same `_on_pools`. An earlier note here claiming they were blind to it was wrong (F64). The frame-shape swap itself is real and is why this row exists |
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
| 6 | crit flag | 0/1 | Echoes the IR word's C bit. It reads 0 on every stock weapon only because every stock weapon ships `$WEAP` t6 = 0. ⭐ **2026-09-18: set t6 non-zero and the TAGGER rolls its own crits and sets this bit.** At t6 = 50 a bench AR landed 44 crits in 87 hits with token 6 = 1 on every one of them, and token 6 = 0 on the other 43. So a victim's node can tell a crit from a normal hit on the wire |
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
- ⭐ **A MAGNITUDE-0 WORD IS A MISS, AND IT IS INVISIBLE OVER BLE (bench-proven 2026-09-09).** The victim's gun
  **vibrates and plays its `$PSET` `missShotHit` sound** (we ship `H06`; Tony confirmed by ear it is a bullet
  near-miss, which also settles the H06 half of F45) but emits **NO `$HIR` and NO `$HP` at all**. Measured with a
  same-aim control minutes apart: three magnitude-9 words gave two `$HIR` (sensors 2 and 4) plus `$HP` 70→61→52;
  three magnitude-0 words gave zero events. Spaced single words play the sound every time; three fired
  back-to-back played it once, so there is a rate gate or a batch collapse (F67). **Consequence for a host:** a
  miss reaches the PLAYER (haptic + audio, natively, no work from us) and reaches the SOFTWARE not at all. Our
  accuracy stat is accidentally correct because it counts shots from the shooter's `$ALCD` and hits from the
  victim's `$HIR`, so a miss lands right by never arriving — but nothing can REACT to a miss, on either phone.
- **Team-gated in firmware by polarity** while `$GSET` t1 = 0: damage lands only from an enemy team, support
  (heal / armor / shield grants) only from the victim's own team; a rejected frame emits no `$HIR`. With t1 = 1
  everything lands from anyone.
- Drain order: **shields → armor → HP**. Armor absorbs 1:1 with no per-hit cap; overflow spills into HP (a sniper's
  80 split exactly 70/10). Heals clamp at the pool max. No function is a damage-over-time. Dead guns accept no IR.
- Applied damage = magnitude × function multiplier, and **the multiplier is SENSOR-gated** (bench 2026-09-11,
  gun Tactix-3D4F): the gun-body sensor applies the raw magnitude (×1) for every function, fn 36/37 included; the
  headset sensor scales fn 36 by `1 + t7/200` and fn 37 by `1 + 2·t7/100`, where t7 is the compiled `$GSET`
  criticalShotModifier (×1.25 / ×2 at t7=50, the MC default). The `$HIR` crit bit (token 6) read 0 on every one
  of 15 headset hits in that session — it is a SEPARATE, unset axis, not what drives this.
- Max distinct IR recognitions per game: 14 (community figure).

**Function map** (magnitude 20, baseline 45/70/0; protocol independence measured for fn 1, 3, 8, 23–28, 35
across protocols 0/5/7/9/10; the sensor split for fn 36/37 confirmed 2026-09-11 — see above):

| Class | Function ids | Measured behaviour | Polarity |
|---|---|---|---|
| Standard damage | 1, 3, 4, 5, 7, 29, 30, 33, 38 | −magnitude per hit, shields → armor → HP | enemy only |
| Armor-piercing | 2, 6 (+17, 21 enemy-side) | HP drops with armor and shields untouched | enemy only |
| ×1.25 damage, truncated, HEADSET ONLY | 36 | Gun body: ×1 always. Headset at t7=50: 20 → 25, 40 → 50, 9 → 11, **7 → 8** (floor(magnitude × (1+t7/200))); 16 trials, 4 magnitudes, 8 row-tail shapes, fn 1 control in every trial (2026-09-02), sensor split + t7 dependence confirmed 2026-09-11 | enemy only |
| ×2 damage, HEADSET ONLY | 37 | Gun body: ×1 always. Headset at t7=50: 20 → 40, 40 → 80, 9 → 18, 7 → 14 (floor(magnitude × (1+2·t7/100))); a t7=0 closing control read the headset back to ×1 (bench 2026-09-11) | enemy only |
| Add HP, overflow → armor | 9, 12, 16, 19 | 15 → 35 → 45, then +armor | ally only (16/19 also damage enemies) |
| Add HP, clamp | 10, 17 | 15 → 35 → 45, no overflow; fn 10 is the "respawn + add HP" row | ally only (17 also AP-damages enemies) |
| Add HP, overflow → shield | 14, 21 | 15 → 35 → 45, then +shield | ally only |
| Add armor | 13, 15, 20, 22 | 0 → 20 → 40; overflow spills to shields | ally only (20 also strips enemy armor) |
| **Strip armour, enemy side** | 20 | ⭐ **MEASURED 2026-09-18.** Against an enemy, fn 20 takes the word's magnitude from **ARMOUR ONLY** and never touches health: 70 → 61 → 52 → 43 → 34 → 25 → 16 → 7 → **0** at magnitude 9 a hit, with health fixed at 972 throughout. At 0 armour it goes **completely inert**: eleven further hits each raised a `$HIR` and moved nothing. So a weapon keyed here strips plates and **cannot kill anyone**. It is the only anti-armour primitive found that is not armour-piercing, and it is the natural counter to a big armour pool | ally grants armour, enemy loses it |
| Add shield | 11, 18 | 0 → 20 → 40, saturating at `$PSET` t5 | ally only |
| **Audio suppression** | 23 | Registers a hit, no pool change; the gun goes silent (`$ALCD` token 2 drops 100 → 0) and recovers over ~6–8 s (0 → 5 → 9 → 31 → 100) while it keeps firing and emitting IR normally; cleared by `$SPAWN,,*`. The only native "silence" effect found; usable by any host today (2026-08-27). ⚠️ **The number quoted as proof was the ACCURACY field, not an audio level** — see the `$ALCD` row in §4 and F66. The silence was heard by ear so the effect is probably real, but the MECHANISM is unverified: re-read this row before trusting it | enemy |
| **Phantom hit generator** | 24, 25, 26, 27 | ⭐ **RE-MEASURED 2026-09-18, two guns, single hand-aimed shots: these apply NO DAMAGE AT ALL, and they leave the victim's gun manufacturing a repeating fake hit.** One shot registers normally on the sensor that was struck (`$HIR,4,...`) with the pools UNCHANGED. Then, from about 5 s later, the victim raises a `$HIR` **on sensor 0** every **5.07 s** (gaps 5140/5070/5071/5069/5001/5139 ms), carrying the original word's magnitude, shooter id and team, with the pools still unchanged, **for as long as the life lasts**: 13 replays over 61 s in run 1 and no sign of stopping. The SOURCE gun is long since idle, so this is generated inside the victim. **`$SPAWN` is the only thing that clears it** (last replay 321027, `$SPAWN` 323019, silence for 35 s after). Each hit starts its OWN timer: three hits gave overlapping replays 80 ms apart. To the player it is indistinguishable from being shot, because every replay plays the grenade-style ticking clip, then a hit sound, with vibration and a headset flash (Tony, by ear). ⚠️ **This is why the Energy Launcher dealt zero damage**: its key `<9,3>` landed on this family through `gameconfig._SIR_TABLE`'s `$SIR,9,3,,24` row. Reproduced and fixed on hardware in one minute: on fn 24 a magnitude-115 word moved 999 → 999, on fn 1 the same word moved 999 → 884. **Never ship 24-27 on a cell any weapon can reach.** The earlier "1 to 3 delayed damage ticks" reading came from a grenade beacon that kept re-arriving and is retracted for the single-word case | enemy |
| Registers, no pool change | enemy 8, 28, 35 · ally 31, 32, 34 | `$HIR` fires, pools unchanged **at the cell itself** — ⭐ **2026-09-18: 25, 26 and 27 MOVED OUT of this row into the phantom family above** (each was fired single-shot at a covered sensor and each began the 5.07 s replay). **fn 28 and fn 35 were re-confirmed clean in the same session**: three hits each, no pool change, and NO replay after 20 s, so fn 28 remains the row to ship for a silent beacon. ⭐ **They differ in PLAYER FEEDBACK, bench-swept 2026-09-10** (free cell, one row only, `$HIR` protocol verified per trial): **fn 28 registers with NOTHING — no sound, no headset flash, no vibration**, so a host can read an IR event the player never perceives (the row to ship for beacons). **fn 8** is silent but still flashes and vibrates. **fn 25/26/27** fire a long grenade-ish clip (hiss → timer → explosion; the "varied sounds" reported are that one clip truncated by the next event) — ⚠ the SOUND is measured; whether they also flash and vibrate was never observed and is marked `?` in the source tables, so do not read "additionally" into it; whether they also carry fn 24's delayed tick is UNTESTED. fn 35 and the ally trio unswept. **Polarity measured both ways on fn 28:** enemy-only under `$GSET` t1=0 (ally words silently rejected, 0/3), and with **t1=1 it registers ally words too** with the owner in `$HIR` token 4 — which is how a host reads who holds a control point | n/a |
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
| `$SIR,9,3,,24,10,0,,,*` | Energy Launcher (fn 24 was read as "a no-pool status: zero damage as shipped" — ⚠ **now suspect**: bench 2026-09-11 found fn 24 applies damage ~4 s AFTER the triggering word, on the grenade's `<15,0>` cell, so this row may tick a victim's pools a few seconds after every Energy Launcher hit and nobody was watching for it. Unverified on this cell — the delayed tick was only measured against the beacon) |
| `$SIR,10,0,X13,1,0,100,2,60,*` | Rocket Launcher |
| `$SIR,11,0,VA2,28,0,0,1,,*` | Tear gas (community: not working; unverified) |
| `$SIR,13,0,H50,…` / `13,1,H57` / `13,3,H49` | Energy Blade / Rifle Bash / War Hammer (melee) |

Protocols in use: stock 0, 8, 10, 11, 13 and 15 (grenade beacon); the app's table also ships rows on 1, 2, 3, 6, 9.
Unused: 4, 5, 7, 12, 14. `$SIR,15,<sub>,,24,0,0,1,,*` (friendly fire on) surfaces grenade-station words as `$HIR`
with no pool change.

## 6. `$WEAP` — weapon definition

Six slots (0–5); slot 4 = melee by convention (gyro swing, `$BMAP,8,4`). The full 0-indexed token map with
APK field names is in [`callsign-extract/protocol-classes.md`](callsign-extract/protocol-classes.md) and is
rendered with per-token confidence in `docs/manual/dev.md`. Known-good frames:

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
| 14 | **fire interval / charge time (ms)** | one-field flip: a sniper at t14 = 1250 fired one shot every 1.25 s. A compiler that trusted the APK field order wrote the rate into t15 and shipped every weapon at 10 shots/s. ⭐ **CALIBRATED 2026-09-10: t14 IS MILLISECONDS PER ROUND, near enough 1:1.** An AR at t14 = 100, trigger held, measured **101.6 and 102.0 ms/round** across two independent bursts (15 rounds in 1530 ms; 31 rounds in 3150 ms), counted from `$ALCD` magazine decrements off the wire — not from trigger pulls, which under fire mode 14 can release two rounds on one press. So a wanted cadence is just `t14 = ms/round`, with ~2 ms of firmware overhead on top; **RoF tuning is arithmetic, not guesswork**. ⚠ Two points, both at t14 = 100 and both full-auto: the ~2 ms overhead is not shown to be constant across the range, and **no floor has been measured** — how low t14 can go before the firmware clamps it, or before the IR word stops keying reliably, is UNKNOWN (`docs/bench-grenade.md` rung Z sweeps it). Note t14 also sets how hard the t21/t22 recoil model bites (see that row) |
| 15 | **weapon-swap delay (ms)** | 1700 doubled the swap, 425 halved it, 100 ran at 100; linear, no floor; the gun takes the larger of the two loaded slots' values (2026-09-04). Stock 850, melee 100 |
| 16 / 39 / 40 / 17 | maxClip / clipStartingAmmo / ammoReserv / maxAmmo | t39 = t16 and t17 = 2 × t40 in every stock frame; 9999999 / 32768 = unlimited |
| 20 | **fire mode** | `0` full-auto · `7` single-shot/bolt · `9` burst (cycle in t23) · `2` charge, auto-release (a tap also fires) · `3` hold-to-charge, auto-fire (a tap is sound only) · `14` tap-fire or charge-release · `13` melee. Proven by flipping only t20 on a captured sniper (7 → 0 went full-auto); the Burst Rifle (t20 = 9, t23 = 275) fires exactly three rounds per pull |
| **21 / 22** | **maxAccuracy / singleShotAccuracy = the simulated-recoil CEILING and FLOOR** | ⭐ **BENCH-PROVEN 2026-09-09.** t21 is the accuracy ceiling (t21=0 armed `$ALCD` token 2 at 0 before a shot was fired); t22 is the FLOOR (t22=50 floored at exactly 50 and stayed for 22 more rounds; t22=0 floored at 0). Accuracy is a **per-shot hit probability**: a shot fired below the ceiling can emit **magnitude 0** — the manual's "miss" — and at floor 50 the recovered words were 4 × `mag=0` to 12 × `mag=9`, at floor 0 they were 16 × `mag=0` to 12 × `mag=9`. **Stock ships 100/100, which makes ceiling = floor and disables the model** — which is why every capture we and JEDGE ever took looked inert. The drop is ~1/5 of the range per shot and the decay races a native time-based recovery, so **t14 (fire interval) sets how hard it bites**: at t22=0, single shots ~2 s apart held a flat 80 while a held trigger reached 0 in eight rounds. Live value streams in `$ALCD` token 2 |
| 23 | burstWeaponTime (ms) | 275 Burst Rifle, 250 Force Rifle, empty elsewhere |
| 24 / 35 / 37 / 38 | overheat: heat per shot / overheat sound / enable-and-parameter pair | t24 and t35 are **inert on their own** (SMG, Energy Rifle, Plasma Sniper ship them and never overheat). t37/t38 (Charge Rifle stock `20,150`) switch the mechanism on: transplanting them onto the SMG brought its heat gauge alive. Which of t37/t38 is threshold vs cooldown is unmapped. Live heat streams in `$ALCD` token 5 |
| 27 / 28 / 29 | fire sound / engage sound / release sound | t27 is a sound, not an identity (Rocket Launcher and Rail Gun both fire `C03`). `C…` in t28 = a charge sound; `D…` = extra reload parts; t29 present only when the weapon has a distinct release event |
| 2, 41 | **range is a CARRIER FREQUENCY, not a power** | ⭐ **2026-09-18, V4_31/V4_30 disassembly via the LaserTagMods session** (trace, not bench proof). The gun emitter's carrier is **`38000 − 125 × (100 − range)` Hz** for range 0-99, and exactly **38 kHz** at 100 or more. No table, no clamp. Emitter POWER does not move with range at all: PWM duty is about 20% indoors and 38% outdoors, set by the indoor/outdoor level alone. So a low `t2` does not shorten the beam, it **detunes the carrier out of the receiver's ~38 kHz band-pass**, which is why `t2` = 5 (26.1 kHz) landed 0 of 38 shots even muzzle to dome, and why the knee we measured around 31 (29.4 kHz) is a property of the RECEIVER rather than of the firmware. Reference points: 75 → 34.9 kHz, 50 → 31.75 kHz, 31 → 29.4 kHz, 22 → 28.25 kHz. ⚠️ **Consequence for balance: above the knee every value is inside the pass-band, so the differences we ship there are probably not felt.** Calibrate in kHz against the receiver's response curve, not as a percentage ladder. **`t41` is read ONLY when the IR-level variable is non-zero (indoor) AND `t41` itself is non-zero**; indoors with `t41` = 0 it falls back to `t2`, and outdoors it is never read, which is exactly the inertness F231 measured. The same rule makes `t42` replace `t13` indoors. That variable is written by `$GSET` t2, by `$IRLVL`, and by the on-gun mode (0 outdoor, 1 indoor, 2 night = indoor plus stealth); `$GSET` t3 is stored and never read |
| 1, 12, 13, 42 | **the second word: the SHOOTER's headset emits it** | ⭐ **NAMED 2026-09-18 from Battle Company's own weapon sheets** (via the LaserTagMods material; names STRONG, behaviour NOT bench-proven). **t1 = `WeaponIRSource`**: 0 gun laser · 1 headset only · **2 gun AND headset** · 3 double gun · 4 double gun + headset · 5 dry fire. **t12 = `ExtraHeadsetDamage`, t13 = `ExtraHeadsetRangeOutdoor`, t42 = `ExtraHeadsetRangeIndoor`.** The three stock weapons at t1 = 2 are the **Shotgun (t5 45, t12 70)**, **Rocket Launcher (115, 115)** and **Plasma Sniper (25, 80)**, all with t13 80 and t42 30/30/40. ⚠️ **The emitter is the SHOOTER's headset, not a bonus for hitting the victim's.** Three things agree: t1 names an IR SOURCE; V4_30 builds an `$IRTX,<dir>,<proto>,<id>,<team>,<damage>,…` frame and sends it to the gun's own headset to emit; and the community scoring readme says a swap-in headset with no high-power LED "means no shotguns, melee, explosions", which is about the shooter's hardware. t37/t38 (`HeadsetDirection`/`HeadsetRepeat`) probably steer it and set its repeat count. **So one Shotgun pull may put TWO words in the air, 45 and 70, at different ranges, and a victim can take either or BOTH — and 45 + 70 is 115, exactly the standard pool.** Test on the SHOOTER: fire once with its headset covered and gun exposed, once with the gun covered and headset exposed, reading the victim's `$HIR` magnitude, protocol and sensor each time; or put one pull into the IR rig and count the words. Our melee frame leaves t13/t42 EMPTY |
| 7–11 | **secondary-fire block — LIVE, not dead** | ⭐ **2026-09-18 (V4_31 disassembly via the LaserTagMods session; trace, not bench proof).** The block works: **t7 = chance %, t8/t9 = the `$SIR` key that roll uses, t10 = damage, t11 = crit %**. It is empty on all 20 captured stock frames only because no stock weapon uses it, NOT because the firmware ignores it. When the roll hits, BOTH the barrel word and any headset word switch to the t8/t9 key. So a weapon with a real alt-fire is buildable with no firmware change: a percentage of shots landing on a different table cell with their own damage |

Unknown or unverified: t2 (100 on guns, 90 on melee), t19 (not simply reloadType), t25/t26 (Suppressor only),
t41 (APK name gunRangeIndoor, 75 on every gun and 20 on melee; whether it changes emitted range is untested).
(**t21/t22 accuracy left this list 2026-09-09**, and **t6 crit chance left it 2026-09-18** — both bench-proven, see the `$WEAP` table.)

⭐ **`t6` is `primaryCritChance`, and it is a straight percentage the GUN rolls per shot** (bench 2026-09-18, F62 answered). Two settings on one bench AR at 9 damage, against a victim with no armour so the `$HP` delta is the applied damage:

| `t6` | hits | crits | rate | crit damage |
|---|---|---|---|---|
| 20 | 64 | 9 | 14.1% | 13 |
| 50 | 119 | 54 | 45.4% | 13 |

Both rates sit within about one standard deviation of the token value. **A crit is the magnitude x1.5, truncated** (9 → 13), the same multiplier our own emitter's C bit produces, and it is **not** the `$GSET` t7 headset scaling, which is a separate axis and ships at 0. The crit echoes on `$HIR` token 6, so a proc is visible to the victim's node: this is the mechanism a crit-chance perk, a high-variance weapon, or a poison-on-a-percentage-of-shots round would use.

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
- ⚠️ **The F11 rule: `$CLEAR` wipes the `$SIR` table, so never end a bench run on a bare `$CLEAR`.** A gun with no rows silently ignores every hit (no `$HIR`, no headset flash, pools untouched) while reporting itself alive and healthy, which looks like a broken emitter, a dead receiver or a bad config in turn. Re-arm it (re-send `$SIR`) or power-cycle it before you walk away.

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
