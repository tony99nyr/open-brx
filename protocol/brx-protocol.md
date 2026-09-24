# BRX Serial Command Protocol Reference

**Status:** reference, current as of 2026-09-22. Each row states the current reading only. The dated
bench write-ups that produced it, with every retraction, are in
[`session-findings-2026-08.md`](session-findings-2026-08.md) (frozen) and `docs/experiment-log/`
(the live notebook). The published developer reference built from this file is
`docs/manual/dev.md`.
**Evidence levels (2026-09-18 on).** A claim with no tag is bench-measured on our v4.32 guns. The tags:
`[disasm]` = read out of the V4_30 or V4_31 stock firmware image (Thumb-2 disassembly; V4_31 differs from
V4_30 in three routines only and still reports "v4.30"); `[sheet]` = Battle Company's own `$WEAP` / `$SIR` /
`$PSET` / `$IRTX` command spreadsheets; `[apk2018]` = BC's 2018 "Battle Royale" Android app, decompiled;
`[jay]` = LaserTagMods' JEDGE 6.0 ESP32 sources. All four came from Jay's drive on 2026-09-18 (credit:
LaserTagMods). **None of them is bench proof for v4.32.** Where a tagged claim contradicts a bench
measurement, the bench result stays the rule, the contradiction is written down, and
`docs/bench-firmware-levers-2026-09-19.md` (the "levers sheet", cited by section) names the run that settles it.
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
| Any | Hardware UART inside the gun | 115200 | The UART behind the radio module (the v4.25 changelog set its buffer to 1024 bytes). **JEDGE does not drive it** `[jay]`: Jay's ESP32 links to the gun over BLE as a NUS central (Gen2/3) or over Classic SPP as master, PIN `0001` (Gen1), with an HC-05 at 9600 as a third option; only his serial test sketch opens `Serial1`. There is no external accessory port; a wired tap means opening the gun. Untested by us. |
| Any | Micro-USB "Programing Port" | USB CDC (baud ignored) | **Not** the `$` protocol: a separate `QUERY`/`SETUP` console (§9). |

**BLE UUIDs (Nordic UART Service):**
- Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- RX characteristic (write to tagger): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- TX characteristic (notify from tagger): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`
- Advertised name `Tactix-XXXX` (last two bytes of the BLE address). The NUS service UUID is present in the
  advertisement, so scan-time generation detection works.
- ATT MTU negotiates to **23 bytes**: chunk writes to ~20-byte payloads. `$PING,*` → `$PONG,*` ≈ 59 ms.

**The gun's serial parser** `[disasm]` (V4_30/V4_31; `docs/spec/transport-hardening.md` §1 designs against it):
- The main loop reads **one byte per pass** from the radio UART (1 KB buffer). A burst faster than the loop drains
  fills the buffer; bytes past 1 KB are lost. The loop's pass time is not measured (screamers sheet Phase A; levers sheet §19).
- `$` starts a frame and resets the token index; `,` advances it; `*` dispatches. Up to **60 tokens**; token 61
  wraps to 1 and the gun prints "overflow". No per-token length limit, no frame timeout.
- **A lost `*` corrupts the NEXT frame**: a new `$` clears only token 0, and tokens 1-59 keep their old text until a
  handler finishes, so the next frame's tokens get the stale text prepended. Nothing tells the sender.
- Parser state persists across reads, so a frame split over 20-byte BLE packets reassembles (this is how every
  arm since 2026-08 has gone in). The headset UART has its own parser of the same shape (up to 8 bytes per pass).
- **Six audio waits block the loop** with `delay(10)` and no timeout, serial unread: `$DPLAY` (reachable over
  BLE), the mode announcement, game-over audio and two channel-4 waits in the standalone game paths. A looping
  clip on a waited channel leaves the gun playing its last buffer with the port unread: the likely "screamer".
  There is **no hardware watchdog** (standard Teensy startup disables it), and the gun's Bluetooth watchdog
  (`$RADSK,*` to the headset every 3 s, checked every 6 s, radio reset pulse 500 ms in V4_31) runs inside the
  serial routine, so a blocked loop never recovers. `$DPLAY` is in `HANG_PRONE_COMMANDS` (§3.3). Screamers sheet Phase A, steps A1-A3.

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
- Sending: keep every frame under 60 tokens and never omit the `*` (§1, the parser). The 2018 BC app framed its
  commands with a leading comma or space (`,$PSET,…`, ` $STOP,*`) and the gun resynced on `$` `[apk2018]`; our
  validator refuses those shapes and there is no reason to send them.

## 3. Commands TO the tagger (host → BRX)

### 3.1 Lifecycle and configuration

| Command | Purpose | Notes / observed examples |
|---|---|---|
| `$PING,*` | Connectivity check | Reply: `$PONG,*` |
| `$STOP,*` | Stop | First frame the app sends on every (re)connect; also part of the end-of-game tail. `[disasm]` **Disarms IR reception**: while the started flag is clear the receive routine drops every word ("not start"). Levers sheet §12 (F121). **Bench-confirmed 2026-09-18 (levers §23 steps 2-3): the "drops every word" reading is refined.** `$STOP` blocks a hit's pool effect but not the hit itself: a hit while stopped still returns `$HIR` (no `$HP`, no pool change). `$STOP` also SURVIVES `$SPAWN`: reception stayed blocked through a `$SPAWN,,*` plus a `$TMP` t8 write, and only `$START,*` (plus a `$GSET`/`$TID` re-send) reopened it. Design rule: anything that sends `$STOP` must send `$START` before the next life |
| `$PHONE,*` | App-controlled mode | Opens the live event tap (buttons, `$VOLTS`), locks the on-gun menu. Reply `$BUT,3,0,*` |
| `$CONNECT,*` / `$INIT,*` | Handshake / initialise (LaserTagMods) | On v4.32: no observable reply. On v4.30 `$INIT` reportedly makes the gun accept but not start a `$PB*` game |
| `$CLEAR,*` | Clear current game state | First frame of every arm sequence; half of the panic sequence. **Wipes the `$SIR` table**: a gun with no `$SIR` rows silently ignores every hit (no `$HIR`, no headset flash, pools untouched) while reporting alive. Always re-send `$SIR` after `$CLEAR` (deterministic 5/5, 2026-09-02; table size does not matter, only its absence) |
| `$START,*` | Begin the configuration sequence | Gun echoes `$LCD,0,0,0,0,0,0,*`. `[disasm]` Sets the started flag that **arms IR reception** (`$STOP` clears it); BC's own sheet says the same ("really it starts the IR sensor to apply damage") `[sheet]`. Levers sheet §12 |
| `$GSET,<t1>,…,<t8>,*` | Global game settings, 8 tokens | `friendlyFire, outdoorMode, gunLaserRegion, autoAmbientLight, gyroscope, secondaryBluetoothWeapons, criticalShotModifier, gameMods`. Captured `$GSET,0,0,1,0,1,0,50,1,*`. **Token 1 is firmware-enforced both ways**: 0 blocks same-team damage and enemy heals, 1 opens the gate. **Token 7 contributes to the headset-sensor multiplier on `$SIR` fn 36/37 and to an incoming C-bit bonus** (bench 2026-09-11, §5): fn 36 = magnitude × (1 + t7/200), fn 37 = magnitude × (1 + 2·t7/100); other functions and gun-body hits did not scale in that non-crit sensor sweep; the IR C bit can trigger a separate t7 bonus (see §5). The `$HIR` crit bit (token 6) is a separate axis; it was unset in that sensor sweep. 0 disables the fn 36/37 scaling, 100 triples fn 37 (×3; fn 36 → ×1.5); 50 was the old default and is why the two functions read as a fixed ×1.25/×2 on the 2026-09-11 bench; MC compiles t7 = 0 since 2026-09-17 (`mcp/brx_mcp/gameconfig.py`, `GameConfig.crit_modifier`): four of the five hit sensors sit on the headset and BRX players aim there, so Open BRX ships the headset multiplier off. **No respawn, time, lives or score token**: those live in the host (§7). **Token 2 is APK-named `outdoorMode`, but it is not the gun's persisted ALT-hold mode and does not control emitted range. It gates hit reception on the gun receiving it.** At 30 ft, t2=1 registered 0 hits from a full clip and worked only from inches; t2=0 registered 16 of 27 shots and then every aimed shot under the same conditions (field 2026-09-13). MC therefore pins t2=0 for indoor and outdoor heads, including try-outs and utility paths. What t2=1 physically changes, whether it affects all sensors equally, and whether it rejects indoor reflections are untested. The physical ALT-hold mode is a separate, measured beam-width control: outdoor mode gave roughly twice the aim tolerance on three guns, while native shots reached about 200 ft in both states. Token 3 `gunLaserRegion` remains the captured `1` at both venues; its effect is untested. Tokens 4–6 and 8 carry APK field names only and have not been characterised. `[disasm]` `[apk2018]` **t2 = 1 means INDOOR**: `$GSET` t2 and `$IRLVL` write the same variable, the menu announces a non-zero value as "Indoor", and the 2018 app sent t2 = 1 for its indoor (night) preset and 0 for outdoor; that fits the field result (indoor is the short-range mode), and `callsign-extract/protocol-classes.md` had the polarity backwards. The 2026-09-18 Callsign capture (cap30) agrees: Callsign sent t2 = 0 with its venue on OUTDOOR, its default. `[disasm]` t1 is read by every polarity check; t5 = gyroscope (forced to 0 with "GYRO FAIL" when the gyro does not start; the melee swing needs it); t7 = the crit modifier (see §5, the crit bonus); **t3 `gunLaserRegion` is stored and never read (inert)** (V4_31 trace); t4/t6/t8 are stored and their uses were not traced. The IR level t2 also selects the emitter power: duty 20 % indoor, 38 % outdoor (§6, t2). The 2018 app's team preset carried `100,90,80` in t4–t6 `[apk2018]`, so those three may be percentages, not flags. `$GSET` also sets the "app mode" flag that `$START`/`$STOP` clear and that changes how `$DIE`, `$BHIT` and the fn 24–27 expiry behave |
| `$PSET,<id>,<team>,<hp>,<armor>,<shield>,<critBonus>,<deathAlarm>,<16 more sound ids>,*` | Player settings | **Token 1 = player id, 0-based 0–63** (the app shows 1–64 and writes id−1; out of range clamps to 63). Ends up in every IR shot's player field and comes back as `$HIR` token 3 on whoever you hit. ⭐ **Token 2 = TEAM** `[disasm]` (V4_31: the gun keeps ONE team byte; `$TID`, `$TEAM` and this token all write it, the outgoing word reads it, the friendly-fire compare uses it, and the last writer wins). The old reading "inert (0/1/7 identical)" was measured with `$TID` sent AFTER the `$PSET`, so it could not see this. **This is F206**: MC hard-coded t2 = 0 and the node wrote a `$PSET` before every `$SPAWN`, so every gun went live as team 0 and with `$GSET` t1 = 0 dropped every enemy hit. Fix shipped 2026-09-18 (every `$PSET` carries the `$TID` team, and `$TID` is re-sent after `$SPAWN`); **bench-confirmed 2026-09-18 at the wire level** (levers sheet §1, runs a-e: run a reproduces F206 with 0 hits, run b fixes it with 6 hits and `$HIR` token 4 = 2). Run f, a real TDM through Mission Control, is still open. Tokens 3–5 = HP / armor / **shield capacity** (the spawn shield is always 0; token 5 is the ceiling, not a starting value). The pool fills from an IR grant (fn 11/18, or armor overflow) **and over BLE from `$LIFE,0,0,<n>,*`, which is additive and takes negatives** (bench 2026-09-11, no `$SIR` row present); both saturate at t5. Armor and HP store and decrement exactly to at least 1000 (a 255 cap is policy, not a device limit); shield width is inferred, not measured. ⭐ **Token 6 = `CriticalDamageBonus`, the CRIT DAMAGE MULTIPLIER, resolved 2026-09-18** `[sheet]` `[disasm]` (V4_31 disassembly at 0x10FBC): on a crit roll the SHOOTER multiplies its damage by **(100 + t6)/100**. We ship **50**, which is the whole of the x1.5 measured on the bench that day at `$GSET` t7 = 0 (a 9-damage weapon landing 13). ⚠️ This is why the earlier sweep found "0-200, no effect": every stock weapon ships `$WEAP` t6 = 0, so a crit never ROLLED and the multiplier had nothing to scale. The two tokens are different things and both are needed: **`$WEAP` t6 is the crit CHANCE** (bench-measured as a percentage, 14% at 20 and 45% at 50) and **`$PSET` t6 is the crit DAMAGE**. A crit-damage perk is therefore one `$PSET` token. The receiver-side `$GSET` t7 headset scaling is a further layer on top of this (levers sheet §9 tests both). **Token 7 = `deathAlarm`** (empty in every Callsign capture; the 2018 app sends `NA0` `[apk2018]`), and **tokens 7–23 are SEVENTEEN sound ids** `[disasm]` (the V4_30 handler reads 17 strings at t7–t23; BC's sheet names 17 `[sheet]`): t8 stealthDeathScream, t9 musicMixOnDeath, t10 deathScream, t11 battleRespawnCry, t12 meleeGrunt, t13 shortPain, t14 longPain, t15 painRelief, t16 missShotHit, t17 hitHp, t18 hitArmor, t19 hitShield, t20 hitCrit, t21 emptyUnboundButtonSound, t22 ammoOrGearPickUp, t23 energyShieldLoop. Our builder (`gameconfig._PSET_HEAD`) has always used this map; the ear-confirmed `H06` near-miss sits at t16 and the hitCrit slot at t20. An earlier "sixteen ids from token 8" reading in this row and in `docs/manual/dev.md` was off by one. e.g. `$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*`. **Slot↔name alignment CONFIRMED 2026-09-07** for the pool slots: the APK order is correct, `hitHp` / `hitArrmor` / `hitShield` sit exactly where the field list says (a voice line placed in the hitShield position was heard on a shield hit; an intermediate "the slots are swapped" reading was retracted after a control showed the sound had not moved). Three further findings on the effect tail, all bench-measured the same day: **(a) AN EMPTY EFFECT FIELD IS NOT SILENCE — it falls through OUTWARD to the neighbouring pool's clip.** An empty `hitShield` plays the ARMOUR clip; `hitHp` is silent only because it is the innermost pool with nothing further in to fall to. This is NOT the A15.2/A15.3 rule (an empty VOICE field really does make the gun say nothing) and does not follow from it. **(b) `energyShieldLoop` (the last token) is a REAL LOOP** that runs while the shield is up, survives a `$PSET` rewrite, and stops only on `$PLAYX,0,*` or the shield reaching zero — Callsign's stock `A10` is a geiger-ish tick, and because it loops it plays under every shield-band hit. **(c) A `$PSET` sound id is overridden by a non-empty `$SIR` `<soundID>` on the row that fired** (§5): the two do not layer, so per-weapon and per-pool audio compete for one hit. |
| `$WEAP,<slot>,…,*` | Define a weapon in slot 0–5 | ~43 tokens: damage, fire interval, fire mode, clip/reserve, reload, sounds, IR type. See §6 |
| `$SIR,<protocol>,<subtype>,<sound>,<function>,…,*` | Incoming-IR effects matrix | Maps an IR `<protocol, subtype>` key to a function (damage, heal, armor, shield, status). Unmatched cells are silently ignored. See §5 |
| `$BMAP,<button>,<function>,<swap0..3>,*` | Remap physical controls | Buttons: 0 trigger · 1 alt-fire · 2 reload handle · 3 select · 4 left · 5 right · 8 gyro. Functions seen: 0 fire · 97 reload · 98 (select/left/right) · 100 weapon-cycle · 4 melee (gyro). **Mandatory**, sent before and again after `$SPAWN`: without it the trigger only chirps "disabled". With one `$WEAP` slot loaded, function 100 has nothing to cycle to and falls back to reloading. `[disasm]` The parser takes buttons 0–29 ("over weapon limit" above) and functions 0–130; an empty function, or one over 130, means unbound (99); 97 marks the reload button; a function over 99 fills a 4-entry cycle list from tokens 3–6; a function of 11 or less on button 8 makes that slot the gyro swing's weapon. The 2018 app bound `$BMAP,0,-1` (unbind the trigger), `$BMAP,1,99` and `$BMAP,8,7` (melee in slot 7) `[apk2018]`; Jay's arm binds select/left/right to melee slots 3/4/5 `[jay]`. `$BUT` id 5 is "select" in Jay's parser and 3 in ours: one to check |
| `$TID,<team>,*` | Team id | ⭐ `[disasm]` **One team byte.** `$TID` t1, `$TEAM` t1 and `$PSET` t2 write the same variable; the outgoing IR word reads it and the friendly-fire compare tests it (as a full byte, which is the tid ≥ 4 alias bug below). The last writer wins, so any `$PSET` sent after `$TID` must carry the same team (F206); `$SIR` and `$SPAWN` leave the team alone (bench 2026-09-16). `$SITE` sets a flag that makes a later reset force team 2; V4_30 attributes the same behavior to `$INVU`, but corrected v4.32 does not resolve that command (levers §7). Jay's hosted-game path sends `$TID` a second time 2 s after the gun's own start `[jay]`. **Masked to 2 bits** (`team & 3`): four native teams 0–3. Sets the default LED colour at `$SPAWN` (1 = blue, 2 = yellow observed) and is echoed as `$HIR` token 4 on the victim. A live write changes hit resolution immediately but does not repaint the LEDs. **⚠️ TEAMS ARE 0-3 (bench 2026-09-07).** The IR word's team field is 2 bits and the gun transmits `tid & 3`, but a victim compares the incoming team against its FULL tid. So on any tid >= 4: two teammates each send `tid & 3`, read it as different from their own tid and **damage each other**; their shots read as friendly to the real tid 0-3 team they alias onto, which **takes no damage**; and a gun can **kill itself** off a nearby surface (observed: a `$TID,5` gun sent `$HIR,4,0,7,1,9` naming its own player id and drained its own armour to 0). Captured words: tid 4 → `team=0`, tid 5 → `team=1`. Use 4-7 as COLOURS only, never as a team. |
| `$SPAWN,,*` | **Go-live and respawn** (note the empty token) | Restores HP/armor and, on respawn, ammo; echoes `$LCD,<hp>,<armor>,0,0,<mag>,<reserve>,*`. **VERSION CONFLICT, unbenched:** V4_30 `[disasm]` reads token 1 as starting shield, but the corrected v4.32 dispatcher consumes no argument before the common spawn routine. Existing empty-token spawns at shield 0 do not distinguish those readings; levers §6 now compares independently re-armed `$SPAWN,0,*` and `$SPAWN,50,*`. Do not rely on a spawn shield. On V4_30 `$SPAWN,*` and `$SPAWN,,*` parse to the same value, so the difference we measured on v4.32 is not in this handler. Clears the `$SIR` fn-23 state. **Leave at least 3 s after a death before respawning**: sent within ~2 s the headset never executes it and stays stuck in the green out-blink (1.0/2.0 s stick, 2.5/3.0/6.0 s clean, 2026-09-02). The headset is a second device behind a relay, so any command it must execute needs a settling gap. **`$SPAWN` also clears any headset colour painted with `$HLED`** (2026-09-03) |
| `$AMMO,<slot>,<mag>,<reserve>,<flag>,*` | Load magazines | Must follow `$SPAWN,,*` at initial go-live or the gun is live with no ammunition (e.g. `$AMMO,0,36,108,1,*`). A respawn `$SPAWN` restores ammo on its own. A `$WEAP` re-push resets ammo to the frame's values: re-send `$AMMO` after any weapon swap |
| `$PLAYX,0,*` | Stop/clear sound playback | Sent right after `$STOP` on connect and just before the go-live cue |
| `$PLAY,<soundID>,<volume>,<priority>,<announcerID>,,,,*` | Play a sound / voice line by id | Two slots, and they do not behave the same way (bench-proven 2026-09-11, six trials): **token 1 INTERRUPTS** — a new id in slot 1 cuts whatever is currently playing in either slot, mid-word if needed — and **token 4 QUEUES** — a new id in slot 4 waits for whatever is ahead of it and plays in order, depth ≥ 3 observed. The behaviour belongs to the SLOT, not to the kind of id: an "fx" id dropped into token 4 queues exactly like a voice line. `$PLAY,,4,6,V3A,,,,*` speaks "kill" with token 1 empty; `$PLAY,VSF,4,6,JAY,,,,*` uses both, one frame, no layering (they still resolve as interrupt/queue against whatever was already playing, not against each other in that same frame). **Tokens 2–3 are required**: `$PLAY,VA33,,,,,,,*` is silent, `$PLAY,VA33,4,6,,,,,*` speaks. A sound that must not step on an announcer line belongs in slot 4 regardless of its apparent type; hit-path/urgent sounds belong in slot 1 and accept that they can cut a line off. Valid ids: the **2,477 files on the gun** (`docs/reference/sound-catalog.md`); the app's own `Sounds.json` lists 2,166, of which 157 are not on the gun. An unknown id plays a fallback sound, not silence |
| `$VOL,<0–100>,<n2>,*` | Master volume | Android app sends `$VOL,100,0,*`; iOS `$VOL,69,0,*`. 30 is inaudible for weapon and game audio, 45 barely audible; use ≥ 65 to hear a tagger. Mission Control plays at **80 indoors / 90 outdoors** (`compile.play_volume()`), try-outs at 69, probing at 30. The on-gun 1–5 menu ↔ `$VOL` mapping is an unmeasured field estimate (roughly L2 ≈ 69), not a fact |
| `$NAME,<name>,*` | Set the gun's persistent name | The USB `Gun Name` field; survives power-cycle. Opening the official app rewrites it to `Tactix2` |
| `$VERSION,*` | Query firmware | Reply `$VERSION,v4.32,?,4,,devhost.03,*`; token 2 reads `hds.59` with a headset linked. `[disasm]` The fields: `<gun fw>,<headset fw>,4 (a constant),<BT peripheral version>,<BT central version>`; `devhost.03` is the central radio's version and the empty token 4 is the peripheral's. A V4_31 gun still answers "v4.30" (the string was not bumped) |
| `$SP,<n>,*` | End-of-game / stop (LaserTagMods) | `$SP,99,*` is the second half of the panic sequence. `[jay]` t1 = the winner: 100 + player id (FFA) or the team id; 98 = no leader; 99 = the arcade/stop value; `$SP,<id>,99,1,1,*` is another form. The gun keeps no score to report |
| `$QUERY,*` | Status array over BLE | Returns a `$`-framed array (`$QUERY,0,0,0,0,0,,1,0,,0,…`) plus a `$LCD`. `[disasm]` The first seven fields: `<playerId>,<team>,<hpMax>,<armourMax>,<shieldMax>,<one $PSET sound id (t11)>,<gyro ok 0/1>`, then a per-weapon-slot loop (not decoded). Fits the capture; unverified beyond the shape. The team field is the read-back that would have caught F206 at the lobby (`transport-hardening.md` §6). **Not** the USB device record (§9). **On a dead gun (bench 2026-09-18) the `$LCD` half arrives at once and the rest of the body about 2 s later**, with no trailing `*`: too slow for a repeated poll, use `$LIFE,*` instead |
| `$PBGAME` `$PBTEAM` `$PBWEAP` `$PBPERK` `$PBLIVES` `$PBTIME` `$PBSPAWN` `$PBINDOOR` `$PBLOCK` `$PBSTART` | The "playbook" pre-battle family (community, fw v4.30) | Mirrors the on-gun menu; a second remote-start path: `$PBGAME,0` FFA · `$PBWEAP,0` M4 auto · `$PBPERK,2` Body Armor · `$PBLIVES,2` 5 lives · `$PBTIME,5` infinite, then `$PBSTART,*`. `$PBWEAP,0,*` produced a "game starting" sound on our v4.32; enum tables not reproduced on v4.32 |
| `$AS,<action>,<mode>,<rules>,<lighting>,<minutes>,<respawn s>,<volume>[,1,<fieldId>],*` · `$UP,100,<event>,<arg>,*` · `$KK,<kills>,*` · `$IT,<gunId>,4,0,0,0,0,0,75,0,*` · `$RADSK,*` | **The native hosting vocabulary** (fw 4.20+) `[jay]` `[disasm]` | What Jay's ESP32 sends a gun to run the gun's OWN game (the "scoring" firmware paths). `$AS` actions: 1 start · 2 perk · 3 team · 4 lock · 5 weapon; modes 0 FFA · 1 DeathMatch · 2 Generals · 3 Supremacy · 4 Commanders · 5 Survival · 6 The Swarm; rules 1 timed deathmatch · 2 assault (shared lives) · 3 battle royale · 4 brawl (gun game) · 5 CTF · 6 KOTH; lighting 0 outdoor · 1 indoor · 2 stealth; minutes (0 = unlimited); respawn 0 = auto or 15/30/45/60/90 s; volume 75–100. `$AS,4,0,0,0,0,0,75,*` locks the gun between games. `$UP,100,<ev>`: 1 lead change (arg = team) · 5 two minutes · 6 one minute · 7 30 s · 8 the 10 s countdown. `$KK,<total kills>` tells the killer's gun it scored a confirmed kill (the gun has no IR kill-confirm of its own; confirmation travels headset to headset over ESP-NOW in the scoring firmware). `$IT` = "set player id and lock". `$RADSK,*` is the headset keepalive: JEDGE sends it every 4 s to fake a headset ("Faux Headset"), and the gun itself sends it to a real headset every 3 s. `$PBTEAM,<t>` goes 300 ms before the start, `$PBPERK`/`$PBWEAP` twice 200 ms apart, `$TID` again 2 s after `$AS,1`. On our v4.32: `$AS` silent across seven shapes, bare `$UP,*` no reply; none of these is used by MC (the gun keeps no score in app mode, §7). `$RV` `$DK` `$FL` `$SLO` `$IF` `$IK` are the rest of the scoring-net set `[disasm]`; `$RP` `$TA` `$PT` `$HS` `$PH` `$RR` `$PKC` `$HKC` `$KOTH` `$BRXSERVER` `$SSID` `$PASS` `$BRX` are host-to-host messages between Jay's ESP32s and are NOT in the gun `[disasm]` |

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
| `$LIFE,<hp>,<armor>,<shields>[,<mode>],*` | Grant **or drain** a pool | `[disasm]` **A 4th token is a mode**: 0 or empty = additive (what we send), 1 = absolute set, clamped at the maxima, 2 = absolute set with no clamp; a dead gun ignores `$LIFE` when token 1 is 0. The 2018 app revived a downed player with `$LIFE,30,0,0,1,*` and polled a silent gun with a bare `$LIFE,*` `[apk2018]`. ⚠️ **Probe hazard, bench-confirmed 2026-09-18 (levers §16): mode 0 on a dead gun is the safe read probe, but ANY non-zero mode 1/2 write REVIVES it.** `$LIFE,30,0,0,1,*` on a dead gun gave `$HP,30,0,0` and the gun took hits again immediately. Keep the poll bare or all-zero-with-mode-0; never send mode 1/2 to a gun you have not decided to bring back. ⚠️ BC's own sheet lists the tokens as **shields, armour, HP** `[sheet]`, the reverse of our bench-measured order (HP, armour, shield): our order stands (measured 2026-09-09 and 2026-09-11 on separate pools), but in set mode the wrong order would set HP to 0, so levers sheet §6 reads the current pools from `$HP` / `$LCD` before every set (`$QUERY` returns the pool MAXIMA `[disasm]`, not the current pools). **Bench-measured 2026-09-09** (first time either direction was ever measured; the old row was APK/spec-derived). **A bare `$LIFE,*` or an all-zero `$LIFE,0,0,0,*` is a read probe (bench-confirmed 2026-09-18): it changes nothing and self-emits `$HP` on both a live and a dead gun, returning `$HP,0,0,0` on the dead gun.** Poll gun state this way, not with `$QUERY`. Additive, clamped at the pool max, never an absolute set — and it **DOES self-emit `$HP`**, contrary to what this row used to say. ⭐ **It accepts NEGATIVES and drains**: `$LIFE,0,-5,0,*` took armour 66 → 61. A negative is **per-pool and floors at 0 with NO spill** — `$LIFE,0,-100,0,*` on armour 61 left armour 0 and HP untouched at 45, so it does **not** cascade shield → armour → HP the way IR damage does; a host applying damage must do its own pool arithmetic. ⚠️ **A lethal negative really kills** (headset green out-flash, trigger dead, `$BUT` with no `$ALCD`) but announces it with `$LCD,0,0,0,0,<mag>,<reserve>,*` and **never `$HP,0,0,0`** — see the `$HP` row ⚠ **Contrast with `$QUERY` on a dead gun (bench 2026-09-18): it returns its `$LCD` at once, but the status array body follows about 2 s LATER and WITHOUT its trailing `*`, against about 30 ms on a live gun. That is why the node polls with `$LIFE` and sends `$QUERY` only once a gun has already proved itself alive.** |
| `$BUMP,<amount>,<hp 0/1>,<armour 0/1>,<shield 0/1>,<sound>,*` | Adjust current pools **as a cascade**; **LIVE for the armour flag, and this is Callsign's shield recharge** | ⭐ **Capture 2026-09-18 (cap30, `captures/2026-09-18-callsign-shield-recharge.txt`) overturns the 2026-09-09 "INERT" row.** Callsign sends **`$BUMP,12,,1,,,*`** and every frame raises the ARMOUR pool (`$HP` token 2) by 12 within ~50 ms, clamping at the `$PSET` armour value (…,64 → 70). `[disasm]` `[sheet]` `[apk2018]` The shape is five fields (the V4_30 handler reads 5; BC's sheet header is `Amount, HP, Armor, Shields, Sound`; the 2018 app sent `$BUMP,<n>,1,,,N94,*` for zone damage and the negative of it to kill a player): token 1 is the amount and tokens 2–4 are on/off flags that pick which pools take part. The capture agrees: its token 3 = 1 is the armour flag. Our 2026-09-09 bench shapes (`$BUMP,-5,0,0,*` on full HP and `$BUMP,0,5,0,*` on armour at 61, with a validated read either side) set no flag, so they asked for nothing; the tokens were never in a wrong order. **Bench-confirmed 2026-09-18 (levers sheet §5, closes F65):** a negative amount drains armour first and overflows into HP once armour is empty; a positive amount heals HP first and overflows into armour once HP is full. Each of the hp/armour flags gates its own pool independently, and with BOTH flags 0 the gun does nothing at all and sends no `$HP` reply, which is why the 2026-09-09 bench read it as inert: those probes set no pool flag. **The shield flag and the sound token are confirmed too (bench 2026-09-18), closing `$BUMP` out in full**: the shield flag gates the shield pool the same independent way, a negative amount drains it first and cascades into whichever other selected pool is open (matching this row's V4_30-read cascade order), and the sound token plays the named id, silent when empty. Recharge recipe in S45; `$LIFE` still works for grants |
| `$GLED,<led1>,<led2>,<led3>,<apply-gate>,<brightness>,,*` | **Gun body LEDs, one palette index per LED** | Palette: **0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink · 8 orange**; 9 and 10 dark (measured with a camera rig 2026-09-02, all three LEDs agreeing). **Token 4 is an apply gate**: 0, 6, 7, 8, 9, 10 apply the colour tokens at full brightness; 1–4 are no-ops (the gun keeps what it was showing). **⚠️ CORRECTED 2026-09-07: gate 5 is OFF, not one-third.** `$GLED,3,3,3,5,10,,*` on a host-owned strip reads as DARK, not a dim green (A/B against gate 0 at the same level, operator call: "bright then off, no steps in between"). The earlier "~1/3" reading was taken while the firmware breathing was still contending and does not survive a clean A/B. Gate 5 is what makes the blank `$GLED,,,,5,,,*` work, and it should never be sent with colour tokens. **The real dimmer is token 5** (see below). No value animates. `$GLED,,,,5,,,*` (Callsign's on-death frame, and the night-mode frame we ship) blanks the gun because gate 5 is OFF. ⭐ **AN EMPTY COLOUR TOKEN IS RED, NOT "LEAVE THIS LED ALONE"** (bench 2026-09-09, controlled test): a blank field parses as 0 and 0 is red, so on a strip held at three solid purple, `$GLED,,9,,0,10,,*` produced red / dark / red. **Always write all three colour tokens**; there is no way to move one segment without restating the others. **Token 5 is brightness, and it is the night dimmer**: 0 off, 1 clearly dim, ≥ 2 full (saturates). Confirmed 2026-09-07 by A/B on a blanked (host-owned) strip: level 1 vs level 10 steps visibly and the hue stays clean ("now its dim green"), including on a mixed per-LED frame (`$GLED,3,3,9,0,1` = dim green / dim green / dark). The two do not compose: gate 5 is off, so use gate 0 + token 5 for brightness. **The blank is required before any paint holds** (2026-09-07): `$GLED,9,9,9,0,10,,*` sent to a spawned gun with NO prior blank leaves it breathing; after the blank the same frame holds dark. ONE blank per life is enough (it is idempotent, and only `$SPAWN` re-enables the breathing), and a held paint SURVIVES `$AMMO`, `$PLAY`, `$HLED` and `$LED` traffic. Without a blank, a painted colour alternates with the native animation; repainting fast enough to win (~30 Hz) strobes in the photosensitive band, so signal events with a short burst of three flashes (0.08 s pulses, 0.10 s apart) instead |
| `$HLED,<colour>,<effect>,<on_ms>,<off_ms>,<brightness>,<count>,*` | **Headset LED** | Token 1 = colour, **same palette as `$GLED` for 0-7, all eight verified on hardware 2026-09-07** (0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink; 8 reads red on the headset and orange on the gun, unverified since; 9 and 10 dark). ⚠️ **A COLOUR INDEX IS NOT A TEAM ID.** `$TID,0..7` are all accepted and the firmware breathes the matching colour, but **only tids 0-3 work in combat** — see the `$TID` row. **The headset is one lamp with one colour: token 1 is global, tokens 2+ never address the four modules individually** (2026-09-02). Token 2 effect: 0 solid · 1 breathe · 2 blink · 4 fade-out blink (Callsign's low-health form) · 6 blank · 3, 5, 7, 8 nothing/dark. Tokens 3/4 on/off ms. Token 5 brightness: 1 dim, ≥ 2 full, saturated by 10 (Callsign's 10 is already maximum). Token 6 flash count. The first flash is always bright and the rest dim (firmware). **⚠️ EFFECT 6 (blank) DISABLES THE FIRMWARE'S OWN DEATH-FLASH LOOP for the rest of the life (bench 2026-09-07): a gun killed after any `$HLED,,6` does NOT run the native out-flash, while the same gun killed after a COLOUR write does. Use `$HLED,9,0,,,10,,*` (colour 9 = dark) to darken the headset in play; keep effect 6 for teardown only. The native HIT flash is unaffected by either.** **`$SPAWN` and every registered hit clear a painted colour**; a single frame painted after spawn holds until the next hit, so a persistent team/out colour must be re-painted after every `$SPAWN` and every `$HIR` (2026-09-03). Captured app frames: `$HLED,<team>,0,,,10,,*` pre-game, `$HLED,7,4,90,90,10,15,*` on the victim at armour 0, `$HLED,,6,,,,,*` at game end |
| `$HLOOP,<0 disable / 1 enable / 2 heartbeat>,<rate_ms>,*` | **Headset LED loop — drives the SMALL flash LED at firmware drive** | **Bench-proven 2026-09-07 (Tactix-XXXX, alive AND dead):** `$HLOOP,2,<ms>,*` and `$HLOOP,1,<ms>,*` (indistinguishable by eye) blink the **small green flash LED** — the lamp the firmware uses for its own hit / out flash — indefinitely. **Token 2 is a period in ms** (750 vs 2000 visibly different). On a DEAD gun whose death loop had been suppressed by an `$HLED,,6`, it **restores the flash at native drive or brighter** (operator, side by side with the native blink he had just seen: "looks like native", "might be brighter"). The **big RGB LED is untouched** and holds whatever `$HLED` painted — the two lamps are independent. `$HLOOP,0,0,*` stops it, and **`$SPAWN` clears it on its own**, so a revived player cannot be left flashing. Callsign's `$HLOOP,0,0,*` ~1.7 s after every death is the disable of this loop. ⚠ Not metered against a native out-blink; rate range untested |
| `$LED,<colour>,<isUsedGreenLed>,*` | The headset's small green flash LED | Exactly two fields. `$LED,9,1,*` = one visible green flash (~66 ms); colour paints the big LED at the same time (9 = leave it alone). No intensity, duration or count field |
| `$BLINK,<colour>,<on_ms>,<off_ms>,<level 0-10>,<loop>,*` · `$CHASE,<colour>,<rate>,<level>,<loop>,*` | Headset blink / chase (APK layouts) | Never sent in the right shape on the bench |
| `$BHIT,…,*` | **Version-conflicted event/hit command** | V4_30 `[disasm]` and BC's sheet describe seven fields (`BulletType, PlayerID, TeamType, Damage, IsCriticalShot, PowerLevel, IRDirection`) and a real `$SIR` hit path. **Corrected v4.32 code contradicts that shape:** its `$BHIT` branch consumes only token 1 as an event byte and never reads the seven-field tail. Jay's ESP32 injects decoded IR with the separate `$HIT,<proto>,<pid>,<team>,<dmg>,<crit>,<power>,0,*` name. No `$BHIT` shape is promoted for v4.32 until levers §3 holds token 1 constant while changing the tail and checks IR, `$HIR` and pools. |
| `$HFIRE,…,*` (11 fields) | Heavy/burst fire (APK layout) | `Direction, BulletType, PlayerId, Team, Damage, IsCriticalShot, PowerLevel, Range, CountIRPulses, RateOfFire, FlashLED`. An earlier 4-field guess emitted zero IR with a receiver control. Untested in the real shape |
| `$IRTX,<Direction>,<BulletType>,<PlayerId>,<ImmuneTeamColor>,<Damage>,<IsCriticalShot>,<PowerLevel>,<IrRange>,<ToggleIRLoop>,<TimeFireLoop>,<FlashLED>,*` | **Raw IR transmit, relayed to the headset emitter** | `[sheet]` `[disasm]` `[apk2018]` `[jay]` Field meanings from BC's own sheet: Direction 0 = front … 100 = all; **field 4 is `ImmuneTeamColor`, not the shooter's team** (BC's note: "misleading; BRX seems to treat team 2 (yellow) as the broadcast team"); PowerLevel = the word's subtype ("ability power 0-3"); IrRange = emit power in percent; ToggleIRLoop 0 = once, 1–99 = that many repeats, 100 = loop; TimeFireLoop = ms between repeats; FlashLED 0/1. Sample: `$IRTX,100,15,63,0,6,1,0,100,100,5000,1,*` ("Red Respawn Looped"). `[disasm]` (headset LTPhead V1_35) Field 8 sets the headset's IR **carrier frequency** (the headset formula, §6 the `2, 41` row), at a fixed duty with no indoor/outdoor switch; field 1 = 1/2/3 selects one emitter dome, any other value the fourth, 100 all; **field 9 = 0 STOPS the emitter** (which may be why earlier zero-IR probes emitted nothing), 1 = one shot with a 199 ms rate guard, more than 1 loops with field 10 as the period (minimum 200 ms). A host-sent `$IRTX` is forwarded verbatim to the headset by the gun; the barrel never fires it, so a receiver control must face the headset domes. The gun's own IR-send routine builds an `IRTX,…` string for the HEADSET, and Jay's headset code accepts `$IRTX` (11 fields), so this is the gun-to-headset "emit this word" frame and a host can send it too; the 2018 app sent `$IRTX,0,14,<pid>,<team>,1,0,0,<range>,1,,1,*` once a second as a revive beam. **Never captured on our wire, never accepted by a gun in our hands** (levers sheet §16). Eleven fields, recovered from the 2026-09-04 il2cpp metadata read (`callsign-extract/protocol-classes.md` "Other command field maps"; the shape itself is written out in `docs/bench-flash-control-2026-09-05.md` §"`$IRTX` (11)"). **Never captured on the wire, never sent by MC, never accepted by a gun in our hands.** ⚠️ **A SECOND, OLDER FIELD LIST FOR THIS COMMAND IS WRONG.** `callsign-extract/protocol-classes.md`'s table also carries a 4-field row `iRPower, soundOnHit, rangeOutdoor, rangeIndoor` — it reads like a direct indoor/outdoor range control, which is why it keeps getting picked up, but that shape was probed on the bench and **emitted zero IR** against a receiver control. Trust the 11-field shape. In it, `$IRTX` **transmits a word**: `Power`/`IrRange` are parameters of the shot it sends, not a persisted venue mode, and whether they also stick for the trigger's own later shots is unmeasured. Enums as for `$BHIT` (BulletType Standard 0 · MeleeDamage 13; IRDirection Front 0 … All 100). A zero-damage probe frame is staged in `mc/compile.py` behind `DRIVE_IO_MODE` (FOLLOWUPS F162, experiment-log Run E) and is **not** emitted by any shipped head |
| `$MELEE,<intensity>,*` | **Version-conflicted melee path** | `$MELEE,255,*` returns `$BUT,4,0,*` and fires no IR. V4_30 has no `$MELEE` handler, so the reply may be a coincidence. An older V4_31 read attributes the swing to the gyro, `BMAP[8]` and the ordinary weapon path, but the corrected v4.32 pass did not recover that chain or its earlier 2500/600 thresholds. It instead finds a one-byte `$BHIT` event path. Levers §2 compares the unknown-command control, mapped event injection and independent barrel/headset sensors before promoting either reading. |
| `$STUN,<ms>,*` | **A timed stun** | ⭐ "Proven no-op" was measured with `$STUN,*`, which is a 0 ms stun. `[disasm]` `[apk2018]` The handler reads one token, a duration in ms, and runs a `millis()` loop that sets a "stunned" flag (the trigger and the gyro swing refuse while it is set); the 2018 app sent `$STUN,2000,*` every 2 s to hold a reviver busy and `$STUN,<ms>` while unpacking loot. A `$SIR` row whose p5 is 64 or more stuns the victim for p5 ms on every registered hit (§5). **Bench-confirmed 2026-09-18 (levers sheet §4): a real, native, SILENT stun.** `$STUN,6000,*` blocked the trigger for about 6 s (a control fired 5 of 5 pulls; the stunned run blocked two pulls and fired again at +6.08 s) and the gun played no sound of its own. A host using this must play its own cue; bench pick by ear is `X17`, matching Battle Company's UART sheet entry for the concussion grenade |
| `$PRES,<proto>,<sub>,<pct>,*` | **Version-conflicted per-cell modifier candidate** | V4_30 `[disasm]` says every damage function multiplies by `(100 + pct) / 100` for that `<proto,sub>` cell. Corrected v4.32 cannot safely bind the name to that handler: the nearby routine formats/forwards values and is not local multiplier proof. Confirmation is required until levers §7 distinguishes half/double damage from filtering or a no-op. |
| `$TMP,<t1>,…,<t11>,*` | **Temporary modifier set** `[disasm]` | Each token is optional; an empty token leaves that token alone. t1/t2/t3 are HP / armour / shield maximum bonuses; t4 changes accuracy; t5 changes the full-auto fire interval; t6 changes reload time; t7 changes outgoing barrel damage; t8 changes incoming damage; t9 adds a magazine bonus; t10 is the traced crit-chance field; t11 is the default hit sound. The effects of t4–t9 are bench-confirmed except for t10; effect evidence does not prove whether a repeated write replaces or adds. The table below is the authority for write semantics. `$SPAWN` clears every token, while a `$LIFE,<hp>,0,0,1,*` revive preserves them. t4 is last-writer-wins against fn 23 smoke, whose timer later resets t4 to 0. `$AMMO` set mode ignores a t9-raised cap. |
| `$INVU,*` | **Version-conflicted invulnerability candidate** | V4_30 `[disasm]` attributes a `$TMP` t8 = −100 write and a later force-team-2 flag to this name. Corrected v4.32 does not: its apparent string reference belongs to the following command, and the located −100 write belongs to indoor mode. Confirmation is required; levers §7 separately tests registered zero-damage, filtering, no-op, t8 reset and team state, then mandates a power cycle. |
| `$DIE,*` | Kill self `[disasm]` | Runs the death routine; in app mode it reports instead. Unverified |
| `$FIREX,…,*` | **Version-conflicted fire/forward command** | V4_30 `[disasm]` describes one slot byte 0–11 and an inferred fire/select call. Corrected v4.32 consumes five fields and forwards them; their meanings and emitted effect are unresolved. `$FIREX,4,*` is not a valid melee bypass proof. Levers §2 blocks replay until a complete five-field frame is captured. |
| `$TEAM,<t>,*` · `$PID,<id>,*` | Team / player id `[disasm]` | The same variables as `$TID` t1 and `$PSET` t1, without the debug print. Not needed; listed so a stray one is understood |
| `$DPLAY,<sound>,<channel>,<t3>,*` · `$QFX,<sound>,*` · `$QPLAY,<sound>,*` · `$QHIT,<s1>,<vol 0-9>,<s2>,<vol 0-9>,*` | More sound paths `[disasm]` | `$DPLAY` plays a sound and then **blocks the main loop until that channel finishes**, serial unread: with a looping clip the gun never comes back. **Hang-prone** (`HANG_PRONE_COMMANDS`, §3.3): the node never sends it, and the instrument sends it only with `confirm=true` AND `allow_hang=true` (screamers sheet A1-A3 uses it under supervision to make a screamer on demand). `$QFX`/`$QPLAY` queue a sound; `$QHIT` queues a two-part hit sound. `$PLAY` remains the one we use |
| `$GREN,<iRType>,<crit>,<modifier>,<indoorMode>,<operationMode>,<channel>,<GrenadeType>,<MaxCount>,*` | Smart Grenade frame, addressed to the gun | **Does not set the grenade's objective mode** (button-locked on the device). `GrenadeType` = FlashBang / Gas / Confusion / Molotov is the blast type of a paired thrown grenade (untested end to end). On the bench the gun emitted IR whose bits did not track the arguments |
| `$VIB` · `$ZOOM` · `$FSET` (~38 event→sound slots) · `$ASSIST` · `$DLC` / `$ASKDLC` → `$GOTDLC` | Seen in the app's vocabulary only | Never sent by us; on-tagger behaviour unobserved |

### `$TMP` per-token write semantics

"Write semantics" answers one narrow question: when the host sends the same non-zero token twice, does the
second write replace the first value or add another effect? A confirmed token effect does not answer that question.
`UNMEASURED` means a repeated production writer is unsafe until the named bench control runs.

| token | firmware effect | write semantics | current owner and re-send rule | evidence / remaining gap |
|---|---|---|---|---|
| `t1` | HP maximum bonus | **UNMEASURED** | no shipped writer; do not build a repeated writer | V4_30 code read only; levers §21 steps 12–14 remain open |
| `t2` | armour maximum bonus | **UNMEASURED** | no shipped writer; do not build a repeated writer | V4_30 code read only; levers §21 steps 12–14 remain open |
| `t3` | shield maximum bonus | **UNMEASURED** | no shipped writer; do not build a repeated writer | V4_30 code read only; levers §21 steps 12–14 remain open |
| `t4` | accuracy modifier | **ABSOLUTE** | the phone owns recoil; re-send after `$SPAWN`, not after a `$LIFE` revive; pause during fn 23 smoke and re-send after its timer | repeated values replaced the live accuracy; S55 owns the smoke collision |
| `t5` | full-auto fire-interval percentage | **UNMEASURED** | no shipped writer; do not build a repeated writer | effect confirmed on full auto, but repeated-write behaviour was not measured |
| `t6` | reload-time percentage | **UNMEASURED** | no shipped writer; F281 Quick Hands remains blocked | effect confirmed at +50%; send t6 = 50 twice and time one reload |
| `t7` | outgoing barrel-damage percentage | **UNMEASURED** | no shipped writer; do not build a repeated writer | effect confirmed before the IR word leaves the shooter; repeated-write behaviour was not measured |
| `t8` | incoming-damage percentage | **ABSOLUTE** | the spawn-protection owner writes after `$SPAWN`; a `$LIFE` revive preserves the current value | −50 and −100 replaced the live modifier; `$SPAWN` reset it to 0 |
| `t9` | magazine bonus in raw rounds (`clip × t9 / 100`) | **ADDITIVE, ONE-SHOT** | no shipped writer; a future owner writes once per life and never blind-replays a full `$TMP` vector | sending the same value again added rounds again; `$AMMO` set ignores the raised cap |
| `t10` | crit-chance points | **UNMEASURED** | no shipped writer | traced in V4_30; levers §21 step 19 remains open |
| `t11` | default hit sound | **UNMEASURED** | no shipped writer | V4_30 code read only; no v4.32 write experiment |

All `$TMP` writers send a frame with all eleven token positions, leaving every unowned position empty. That does
not mean replaying every owned value: an additive, one-shot t9 value is populated only for its one deliberate
write per life. The terminating `*` stores 0 in the token position where it lands, so a short frame can clear later
tokens by accident. See the levers sheet §21 frame-shape rule.

### 3.3 The firmware's whole vocabulary, and what the instrument refuses

`[disasm]` The source counts **145 distinct gun commands across all ten gun images**, 85 of them absent from our docs (this file and `docs/manual/dev.md`) at the time. The names
that matter are in the rows above. The rest fall into families a host never needs: the gun↔radio-module control
frames (`$!…`, `$^…`, `$&…`, plus `$BTV`, `$INQ`, `$LINK`, `$HADSK`, `$#DISCONNECT`, `$PHONECONNECT`,
`$PHONEDISCONNECT`), grenade pairing (`$GPAIR`, `$GPAIRX`, `$GPING`), factory and hardware tests (`$FTST`,
`$BURN`, `$DUTY`, `$SOL`, `$MUZ`, `$FLED`, `$DEV`, `$DTYPE`, `$TSTRNAME`, `$ASKSN`, `$SHOWNAME`), firmware
update (`$CDFU`, `$HEADDFU`, `$DDFU`), and setup (`$FACTORY`, `$RESET`, `$SITE`, `$IRT` = the Arena/Retail IR
word-format switch, `$IRLVL` = the same IR-level variable as `$GSET` t2, `$INDOOR` = the on-gun mode byte only (range trace: it reaches the IR level only when the setup routine copies it over), `$VIBTOGGLE`, `$LIGHT`). Removed
before v3: `$SHIELD`, `$MSHIELD`, `$IRG/H/L/S`, `$GAMEPAD`, `$PIN`, `$PAIR`. Commands our doc once listed that
V4_30 does NOT have: `$MELEE`, `$HFIRE`, `$ZOOM`, `$FSET`, `$ASSIST` (Callsign app vocabulary) and the
`$UR` `$RP` `$TA` `$PT` `$HS` `$PH` `$RR` `$PKC` `$HKC` `$KOTH` `$BRXSERVER` `$SSID` `$PASS` `$BRX` set (JEDGE
host-to-host). The headset's own vocabulary is separate (`$IRTX`, `$SGREN`, `$HLOOP`, `$HLED`, `$SOLID`,
`$BLINK`, `$CHASE`, `$GLOW`, `$SITE`, `$INDOOR`, `$ZOM`/`$ZTOG`/`$ZON`/`$ZOFF`, `$BOOM`, `$BURN`, `$RADSK`,
`$HADSK`, `$BAT`, `$HFIRM`, `$HIT`, `$VERSION`, and an unlock command whose literal is not reproduced).

**The command rail (`mcp/brx_mcp/protocol.py`, three tiers).** `KNOWN_COMMANDS` names every command the
instrument sends without confirm, with the token count the V4_30 handler reads and whether our v4.32 guns have
shown the effect; an unproven one is sent and the reply says so. `DENIED_COMMANDS` is refused **even with
confirm**, with the reason: everything above that writes persistent state, re-pairs or re-flashes a radio, switches
the IR word format or runs a factory test, plus the USB console word `SETUP`. `$DPLAY` is not in it (see below).
`DENIED_COMMANDS` and `HANG_PRONE_COMMANDS` both reach the phone as `NODE_DENIED_COMMANDS` and the node drops such a frame at its one write path;
the compiler refuses to build a bundle that carries one (`docs/spec/transport-hardening.md` §4). The hang-prone
class (`HANG_PRONE_COMMANDS`, today `$DPLAY`) has one door for the bench: `send` with `confirm=true` AND
`allow_hang=true`, one frame, never a batch (screamers sheet A1-A3). Everything else needs `confirm=true`.

## 4. Messages FROM the tagger (BRX → host)

| Message | Meaning | Key tokens |
|---|---|---|
| `$PONG,*` | Ping reply | |
| `$VERSION,<gun fw>,<headset fw>,<n>,,<host image>,*` | Version reply | e.g. `$VERSION,v4.32,?,4,,devhost.03,*`; token 2 = `hds.59` with a headset linked, `?` otherwise |
| `$DISCONNECT,*` | Gun-initiated disconnect notice | e.g. the moment its headset is switched off |
| `$VOLTS,<pack_mV>,<cell_mV>,<t3>,<t4>,*` | Battery telemetry, ~every 30 s in app mode | `$VOLTS,7662,3921,55,70,*` = 7.662 V pack, 3.921 V cell; tokens 3–4 undecoded. Only reliably returned at good RSSI |
| `$LCD,<hp>,<armor>,<shield>,<slot>,<mag>,<reserve>,*` | Health/armor HUD echo | `$START` → all zeros; `$SPAWN` → pools + current weapon's ammo; death → `$LCD,0,0,0,1,1,1,*`. A zeroed `$LCD` after `$SPAWN` means no config is loaded (the post-power-cycle tell). `[disasm]` `[apk2018]` Token 3 = the **current shield** (the variable `$SPAWN` t1, `$LIFE` t3 and the shield functions write); token 4 = the slot-like byte `$FIREX` writes and `$SPAWN` zeroes (the 2018 app parses them as `shield, weaponSlot`). Not measured by us |
| `$ALCD,<mag>,<accuracy>,<slot>,<reserve>,<heat>,*` | Ammo/weapon HUD stream | One frame per round fired **and** per round reloaded (a reload is a burst of frames). ⭐⭐ **THE NATIVE WALK IS PER GUN, NOT PER WEAPON, AND CANNOT BE BALANCED (bench 2026-09-18, the decisive control).** Two taggers, the SAME `$WEAP` frame (t21 100, t22 50): one walked 90 to 60 over sixteen rounds and KEPT WALKING WHILE RESTING ON A TABLE; the other stuck at 90 and never moved. So it is unit variance, not a mechanic and not motion, and two players with identical loadouts would carry measurably different weapons. **This is why every weapon ships `t21 == t22 == 100`, the walk off, and the node drives accuracy itself** (F230, and see `$TMP` t4, which does move the real hit rate: 20 of 20 at 100, 7 of 17 at 50). ⚠ **Never grade or balance a weapon on native accuracy: there is no such thing as the native accuracy of a WEAPON, only of a GUN.** ⭐ **Token 2 is the LIVE ACCURACY of the simulated-recoil model, bench-proven 2026-09-09** — not the "audio level" this row used to claim. It arms at `$WEAP` **t21** (the ceiling), under sustained fire it falls in **five steps of one fifth of the t21-to-t22 range**, floors at `$WEAP` **t22**, recovers with time between shots, and **resets to t21 on reload**. ⚠️ The steps do NOT land one per shot: the two measured walks reached their floor on shot **8** and shot **11**, so shots-per-step is not fixed and is uncharacterised (n=2). Measured on the AR at t14=100 ms: t22=0 walked 80·60·40·40·40·20·20·0 and pinned at 0; t22=50 walked 90·90·90·90·90·80·70·70·70·60·50 and pinned at exactly 50 for the remaining 22 rounds; stock t21=t22=100 never moved off 100 across 32 rounds. ⚠️ The `$SIR` fn-23 "audio suppression" finding cited this token dropping 100→0 as its evidence. The silence was heard by ear so the effect is probably real, but the NUMBER quoted as proof was this accuracy field — re-read fn 23 before trusting its mechanism (F66). Token 3 = weapon slot (alt-fire cycles 0↔1; melee slot 4 appears as an isolated frame on a gyro swing). Token 5 = **weapon heat**: raw, above 100 at lockout, and non-zero only on a weapon whose overheat is switched on (`$WEAP` t38). Bench 2026-09-17 (F229): an Energy Rifle at t38 = 150 climbed about 3 per shot under full auto, stopped firing at **99** after about 30 rounds, and read 102 while locked. **Self-cooling is per weapon.** The Charge Rifle cooled about 30 per second on its own and restarted from 0 after a 4.8 s lockout; the Energy Rifle did not fall at all while locked and needed the reload lever, which vents about 35 per pull (three taps, or one held pull, and the same hold recharges the cell). Only streams on ammo events: silence is not "no change" |
| `$HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,*` | **Hit received** | See §4.1 |
| `$HP,<hp>,<armor>,<shield>,*` | Pools after a hit | Same millisecond as its `$HIR`. `$HP,0,0,0` = death. **A `$LIFE` write DOES self-emit it (bench 2026-09-09) — but only while the write is non-lethal.** A `$LIFE` that takes a pool to zero emits `$LCD,0,0,0,0,<mag>,<reserve>,*` INSTEAD, and no `$HP` at all: the frame shape swaps on the lethal write. ⚠️ **Our stack DOES handle this** (checked 2026-09-10): `engine.js`'s `case 'LCD'` books a death at `hp === 0`, and `stage.py` routes `$LCD` through the same `_on_pools`. An earlier note here claiming they were blind to it was wrong (F64). The frame-shape swap itself is real and is why this row exists |
| `$BUT,<id>,<state>,*` | Physical button event | id 0 trigger · 1 alt-fire · 2 reload handle · 3 select · 4 left · 5 right (matches `$BMAP`); state 1 press / 0 release. Streams only in app mode; pre-game the trigger reports but does not fire. A dead gun's trigger gives `$BUT` with no `$ALCD` decrement |
| `$QUERY,…` | Status array in reply to BLE `$QUERY,*` | First seven fields `[disasm]`: player id, team, HP max, armour max, shield max, one `$PSET` sound id, gyro ok; then a per-slot loop (undecoded). Levers sheet §18 |
| `$DD,<killerId>,<killerTeam>,*` | **A death report from the gun** `[jay]` | Jay's ESP32 parses `$DD` FROM the gun (on BLE and on the SPP headset link) and builds its kill confirmation on it. Our doc called `$DD` a host-side convention. **Bench-confirmed 2026-09-18 (levers sheet §13/§22): REFUTED on our gun.** A one-hit kill gave `$HP,0,0,0` then `$LCD,0,0,0,0,6,24`, with NO `$DD` in between. Do not build a death cure on `$DD` from the gun |
| `$AD,1,*` | Sent on connect `[disasm]` | V4_30 only; meaning unknown |
| `$UP` · `$AS` · `$SP` · `$WEAP` · `$PERK` · `$HS` | Echoes reported by LaserTagMods | Never seen from our v4.32 units |

### 4.1 `$HIR` decode

| tok | Field | Values | Notes |
|---|---|---|---|
| 1 | sensor that caught the IR | 0 headset **front** dome · 1 headset **back** dome · 2, 3 the headset's other two domes (positions unmapped) · 4 gun body | Isolated with every other sensor covered (2026-08-26). Trust for directional logic **only at field distance**: point-blank IR floods every receiver and the first to decode reports |
| 2 | shooter's IR protocol | 0 standard · 10 rocket · 13 melee · 15 grenade beacon … | = the shooter's `$WEAP` t3 / IR word B field; selects the victim's `$SIR` row |
| 3 | shooter player id | 0–63 | = the shooter's `$PSET` token 1 (32/32 hits both directions on two guns) |
| 4 | shooter team | 0–3 | = the shooter's effective `$TID & 3` |
| 5 | raw magnitude | e.g. 9, 45, 80, 115 | The IR word's D field (= shooter's t5). **Not the applied damage** where a multiplier row or crit is in play: derive damage from the `$HP` delta. On a killing blow it can report the victim's remaining pool instead (overkill clamp) |
| 6 | crit flag | 0/1 | Echoes the IR word's C bit. It reads 0 on every stock weapon only because every stock weapon ships `$WEAP` t6 = 0. ⭐ **2026-09-18: set t6 non-zero and the TAGGER rolls its own crits and sets this bit.** At t6 = 50 a bench AR landed 44 crits in 87 hits with token 6 = 1 on every one of them, and token 6 = 0 on the other 43. So a victim's node can tell a crit from a normal hit on the wire. Rates and crit damage: the `t6` table in §6 |
| 7 | subtype | 0–3 | Echoes the IR word's U field (sniper = 1). BC's sheet and the 2018 app call it `power` / `PowerLevel` `[sheet]` `[apk2018]`; same bits |

Not every `$HIR` is damage: pickups, heals and status effects arrive on the same message, keyed by protocol
and subtype. A team-rejected shot (same-team damage, or enemy support, with friendly fire off) emits **no
`$HIR` at all**, so friendly fire is invisible to the host while `$GSET` t1 = 0.

**Kill attribution pattern:** store `<shooterId, shooterTeam>` from each `$HIR`; when `$HP,0,0,0` arrives the
stored shooter gets the kill. Send the shooter's gun `$SFLASH,*` then `$PLAY,,4,6,V3A,,,,*`; the official app
does exactly this. JEDGE encodes the kill between its own devices as `$DD,<killerId>,<killerTeam>,<victimId>,<nonce>,*`
(the victim's node broadcasts it and retries until the killer acks with `$PKC` and the host with `$HKC`; the killer
dedupes on the nonce and sends its own gun `$KK,<totalKills>,*`) `[jay]`. The gun's death routine has no IR send
`[disasm]`, so there is no kill-confirm word in the air; and the gun itself emits a two-field `$DD,<killer>,<team>`
on death, which Jay's code reads (§4 table). **Bench-confirmed 2026-09-18: REFUTED on our gun.** A one-hit kill
sent no `$DD` at all between `$HP,0,0,0` and the following `$LCD`. Do not rely on the gun sending `$DD`.

## 5. `$SIR` — incoming IR effects matrix

Format: `$SIR,<irProtocol>,<subtype>,<soundID>,<function>,<p5>,<p6>,<p7>,<p8>,*`

- `<irProtocol>` = the IR word's B field (4 bits), `<subtype>` = its U field (2 bits): together the row's lookup
  key, 16 × 4 = 64 cells, all writable per game. **No matching row → the hit is silently ignored.**
- The IR word's 8-bit "damage" is a **magnitude**; the row's `<function>` decides what it applies to.
- `<soundID>` plays on the victim when the row fires (`VA16` "armor suit", `VA8C` "shields online", `H29` stim-pack).
- `<p5>`–`<p8>` do not scale damage (five shapes tried, all landed exactly the magnitude). Their role `[sheet]`
  `[disasm]`: **p5 `Modifier`** = a stun duration in ms when 64 or more (the victim is stunned for p5 ms on every
  registered hit to a live gun), or on fn 24–27 the packed cell key of the delayed hit (low nibble = protocol, high
  nibble = subtype); **p6 `RangeOutdoor`** = splash re-emit power, 0 = none, 100 = full (the victim re-transmits the
  word on direction 100 with crit = 1, a 249 ms "double boom" guard stops chains, and p6 > 0 also disables the crit
  bonus); **p7 `Random`** = sound variation (1 = two random sounds, the gun adds one to the id's last character;
  default 1 when the row has no sound); **p8 `RangeIndoor`** = replaces p6 when `$GSET` t2 is non-zero. Stock
  Rail Gun p6/p8 = 90/40, Rocket = 100/60: the victim of a rocket hits everyone around it. Unverified on v4.32
  (levers sheet §4, §8, §11).
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
  80 split exactly 70/10). Heals clamp at the pool max. No function is a damage-over-time. Dead guns accept no IR, with one
  exception `[disasm]`: **fn 34 (ally) and fn 35 (enemy) pass the dead-player guard**, register a `$HIR` and move
  nothing, so a host can read a revive or medic beam aimed at a dead player (the 2018 app's revive beam is fn 34 on
  protocol 14 `[apk2018]`). Our 448-word test had no such row in the table. Levers sheet §10.
- Rejection reasons the receive path prints `[disasm]`: "not start" (before `$START`), "self hit" (own id and team
  within 124 ms of own shot), "double boom" (< 249 ms after a splash), "double shot" (same shooter/proto/damage
  within 54 ms), "beacon block" (identical word within 159 ms), "dead player", "null Hit" (fn 0), "bad IR length",
  "bad checksum", "Block Type". A magnitude-0 word takes the miss path (below) unless the row is fn 28 or fn 31.
- Applied damage = magnitude × function multiplier, and **the multiplier is SENSOR-gated** (bench 2026-09-11,
  gun Tactix-3D4F): the gun-body sensor applies the raw magnitude (×1) for every function, fn 36/37 included; the
  headset sensor scales fn 36 by `1 + t7/200` and fn 37 by `1 + 2·t7/100`, where t7 is the compiled `$GSET`
  criticalShotModifier (×1.25 / ×2 at t7=50, the Callsign capture; Open BRX compiles t7 = 0, so both read ×1).
  The `$HIR` crit bit (token 6) read 0 on every one
  of 15 headset hits in that session — it is a SEPARATE, unset axis, not what drives this.
- Max distinct IR recognitions per game: 14 (community figure).

**Function map** (magnitude 20, baseline 45/70/0; protocol independence measured for fn 1, 3, 8, 23–28, 35
across protocols 0/5/7/9/10; the sensor split for fn 36/37 confirmed 2026-09-11 — see above):

| Class | Function ids | Measured behaviour | Polarity |
|---|---|---|---|
| Standard damage | 1, 3, 4, 5, 7, 29, 30, 33, 38 | −magnitude per hit, shields → armor → HP | enemy only |
| Armor-piercing | 2, 6 (+17, 21 enemy-side) | HP drops with armor and shields untouched | enemy only |
| ×1.25 damage, truncated, source 0–3 in code | 36 | Bench: gun-body source 4 applied ×1; headset source 0 at t7=50 gave 20 → 25, 40 → 50, 9 → 11, **7 → 8** (floor(magnitude × (1+t7/200))). The bench did not isolate sources 1–3. Sixteen trials, four magnitudes, eight row-tail shapes, fn 1 control in every trial (2026-09-02); source split and t7 dependence confirmed 2026-09-11 | enemy only |
| ×2 damage, source 0–3 in code | 37 | Bench: gun-body source 4 applied ×1; headset source 0 at t7=50 gave 20 → 40, 40 → 80, 9 → 18, 7 → 14 (floor(magnitude × (1+2·t7/100))). The bench did not isolate sources 1–3. A t7=0 closing control read the headset back to ×1 (2026-09-11) | enemy only |
| Add HP, overflow → armor | 9, 12, 16, 19 | 15 → 35 → 45, then +armor | ally only (16/19 also damage enemies) |
| Add HP, clamp | 10, 17 | 15 → 35 → 45, no overflow; fn 10 is the "respawn + add HP" row | ally only (17 also AP-damages enemies) |
| Add HP, overflow → shield | 14, 21 | 15 → 35 → 45, then +shield | ally only |
| Add armor | 13, 15, 20, 22 | 0 → 20 → 40; overflow spills to shields | ally grant; v4.32 also has opposing-team subtraction branches for 20 and 22, with the latter unmeasured |
| **Strip armour, enemy side** | 20 | ⭐ **MEASURED 2026-09-18.** Against an enemy, fn 20 takes the word's magnitude from **ARMOUR ONLY** and never touches health: 70 → 61 → 52 → 43 → 34 → 25 → 16 → 7 → **0** at magnitude 9 a hit, with health fixed at 972 throughout. At 0 armour it goes **completely inert**: eleven further hits each raised a `$HIR` and moved nothing. So a weapon keyed here strips plates and **cannot kill anyone**. It is the only anti-armour primitive found that is not armour-piercing, and it is the natural counter to a big armour pool | ally grants armour, enemy loses it |
| Add shield | 11, 18 | 0 → 20 → 40, saturating at `$PSET` t5 | ally grant; v4.32 also has an opposing-team subtraction branch for 18, unmeasured |
| **Audio suppression** | 23 | Registers a hit, no pool change; the gun goes silent (`$ALCD` token 2 drops 100 → 0) and recovers over ~6–8 s (0 → 5 → 9 → 31 → 100) while it keeps firing and emitting IR normally; cleared by `$SPAWN,,*`. The only native "silence" effect found; usable by any host today (2026-08-27). ⚠️ **The number quoted as proof was the ACCURACY field, not an audio level** — see the `$ALCD` row in §4 and F66. The silence was heard by ear so the effect is probably real, but the MECHANISM is unverified: re-read this row before trusting it | enemy |
| **Phantom hit generator** | 24, 25, 26, 27 | ⭐ **RE-MEASURED 2026-09-18, two guns, single hand-aimed shots: these apply NO DAMAGE AT ALL, and they leave the victim's gun manufacturing a repeating fake hit.** One shot registers normally on the sensor that was struck (`$HIR,4,...`) with the pools UNCHANGED. Then, from about 5 s later, the victim raises a `$HIR` **on sensor 0** every **5.07 s** (gaps 5140/5070/5071/5069/5001/5139 ms), carrying the original word's magnitude, shooter id and team, with the pools still unchanged, **for as long as the life lasts**: 13 replays over 61 s in run 1 and no sign of stopping. The SOURCE gun is long since idle, so this is generated inside the victim. **`$SPAWN` is the only thing that clears it** (last replay 321027, `$SPAWN` 323019, silence for 35 s after). Each hit starts its OWN timer: three hits gave overlapping replays 80 ms apart. To the player it is indistinguishable from being shot, because every replay plays the grenade-style ticking clip, then a hit sound, with vibration and a headset flash (Tony, by ear). ⚠️ **This is why the Energy Launcher dealt zero damage**: its key `<9,3>` landed on this family through `gameconfig._SIR_TABLE`'s `$SIR,9,3,,24` row. Reproduced and fixed on hardware in one minute: on fn 24 a magnitude-115 word moved 999 → 999, on fn 1 the same word moved 999 → 884. **Never ship 24-27 on a cell any weapon can reach.** The earlier "1 to 3 delayed damage ticks" reading came from a grenade beacon that kept re-arriving and is retracted for the single-word case | enemy |
| Registers, no pool change | enemy 8, 28, 35 · ally 31, 32, 34 | `$HIR` fires, pools unchanged **at the cell itself** — ⭐ **2026-09-18: 25, 26 and 27 MOVED OUT of this row into the phantom family above** (each was fired single-shot at a covered sensor and each began the 5.07 s replay). **fn 28 and fn 35 were re-confirmed clean in the same session**: three hits each, no pool change, and NO replay after 20 s, so fn 28 remains the row to ship for a silent beacon. ⭐ **They differ in PLAYER FEEDBACK, bench-swept 2026-09-10** (free cell, one row only, `$HIR` protocol verified per trial): **fn 28 registers with NOTHING — no sound, no headset flash, no vibration**, so a host can read an IR event the player never perceives (the row to ship for beacons). **fn 8** is silent but still flashes and vibrates. The ally trio (31, 32, 34) is unswept. **Polarity measured both ways on fn 28:** enemy-only under `$GSET` t1=0 (ally words silently rejected, 0/3), and with **t1=1 it registers ally words too** with the owner in `$HIR` token 4 — which is how a host reads who holds a control point | n/a |
| No registration | 0, 39–45 | | n/a |

**What the V4_30 image says about the whole switch** `[disasm]` (the hit handler jumps on fn 1–52; fn 0 = "null
Hit"; every damage path runs crit bonus → `$TMP` t8 → `$PRES` → the pool routines; "enemy"/"ally" = the polarity
under `$GSET` t1 = 0). Each row is unverified on v4.32 unless it repeats a measured row above; the levers sheet
section that settles it is named.

| fn | V4_30 reading | Agrees with the bench? |
|---|---|---|
| 1–22 | own handlers; polarity 1–8 enemy, 9–15 ally, 16 splits on team | yes, where measured |
| 23 | plays the row sound, sets the ACCURACY modifier (`$TMP` t4) to −100, stamps a recovery timer, reports | fits the `$ALCD` 100 → 0 → recovery (F66: it is an accuracy effect, not audio). S53 calls it SMOKE |
| 24–27 | one handler: a fuse of **5000 / 4000 / 3000 / 2000 ms**, up to four at once, ticking clip, `$HIR`. On expiry, standalone: the gun's own hit handler runs on the cell p5 names; in app mode a hard-coded protocol-9 word is injected instead (proven call, meaning inferred). Stock Energy Launcher row p5 = 10 = "after 5 s, hit me with cell `<10,0>`", a sticky bomb | fn 24 = 5.07 s replays ✓. **The endless loop** (bench 2026-09-18) is explained: our `<9,3>` row pointed back at fn 24, so each injected protocol-9 word re-armed the fuse. Prediction: with `<9,3>` on fn 1 (as shipped since 2026-09-18) one fn-24 hit gives ONE delayed hit, then stops. "25, 26, 27 do the same" needs re-timing at 4/3/2 s. Levers sheet §8 |
| 28 | registers only; enemy always, ally only with t1 = 1 | ✓ measured both ways |
| 29 | stores sensor + 1 as a hit direction, then normal damage (a splash then emits from a per-sensor direction) | unmeasured |
| 30 | normal damage; an internal source value of 1 doubles magnitude and can set a silent-death flag. The direct IR decoder passes 4, while the `$HIT` parser passes a dynamic source value. A sensor-1 capture still needs to prove this path | unmeasured; §10 |
| 31 | registers only; ally always, enemy only with t1 = 1 (the ally twin of 28) | unmeasured |
| 32 | ally: computes damage, changes no pool, calls the team-colour routine, reports | unmeasured |
| 33 | normal damage; any kill is SILENT (no death alarm: the scoring readme's "stealth kills") | unmeasured; §10 |
| 34 / 35 | register only, ally / enemy, **work on a dead gun**, never cause a death | see above; §10 |
| 36 / 37 | source values 0–3: × (100 + t7/2)/100 and × (100 + 2·t7)/100; source 4: × 1 | bench confirmed source 0 and body source 4; code gates all values below 4 |
| 38 | shield, then armour, then **half** of the remainder reaches HP (call order proven, helper meaning inferred) | measured as plain damage at a 70-armour baseline, which never shows the HP halving; re-test at 0 armour, §10 |
| 39–49 | no-op | ✓ 39–45 |
| 50 / 51 / 52 | call the team-colour repaint only, no `$HIR`; 50 enemy or open-team mode, 51 ally, 52 anyone | unmeasured; v4.32 switch confirms the gates, and the 2018 app ships `$SIR,15,1,NULL,50` |

After the switch: p5 ≥ 64 → stun; HP ≤ 0 and fn not 34/35 → death (silent if flagged); p6 > 0 → splash re-emit
unless the incoming word already had crit = 1. **The crit bonus** `[disasm]`: when the row's p6 = 0 and the word's
C bit is set, damage × (100 + `$GSET` t7)/100, applied only when t7 ≠ 0. On the bench a crit measured **× 1.5 at
t7 = 0** (9 → 13), and the V4_31 trace explains it: **on a crit roll the SHOOTER multiplies the barrel word's damage
by (100 + `$PSET` t6)/100** (`CriticalDamageBonus`, shipped as 50 `[sheet]`) before it leaves, and the victim's t7
bonus is a second layer on top of that. So the bench number is the shooter's t6, and levers sheet §9 (t6 = 0 / 50 /
100 on the shooter, then t7 on the victim) confirms both layers on v4.32. A row whose sound is the literal
`NULL` plays nothing; an empty sound uses the default.

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
| `$SIR,9,3,,24,10,0,,,*` | Energy Launcher: BC's own sheet labels this row **"Delayed Explosion"** `[sheet]`; p5 = 10 names cell `<10,0>` (the Rocket) as what lands 5 s later `[disasm]`. Bench 2026-09-18: as shipped by us it dealt NO damage and replayed for ever, because our `<9,3>` row itself was fn 24; MC now ships `<9,3>` on fn 1 (see the fn 24–27 rows above). The weapon itself stays out of every POOL (`policy.UNPLAYABLE_IDS`) |
| `$SIR,10,0,X13,1,0,100,2,60,*` | Rocket Launcher |
| `$SIR,11,0,VA2,28,0,0,1,,*` | Tear gas (community: not working; unverified) |
| `$SIR,13,0,H50,…` / `13,1,H57` / `13,3,H49` | Energy Blade / Rifle Bash / War Hammer (melee) |

Protocols in use: stock 0, 8, 10, 11, 13 and 15 (grenade beacon); the app's table also ships rows on 1, 2, 3, 6, 9;
Jay's arm adds `$SIR,4,0,,1,0,0,1,,*` ("captured flag pole") on protocol 4 and the 2018 app used protocol 14 for its
revive beam (fn 34) `[jay]` `[apk2018]`. Unused: 5, 7, 12. `$SIR,15,<sub>,,28,0,0,1,,*` surfaces grenade-station
words as `$HIR` with no pool change (fn 28, not 24: 24 is the fuse).

**Protocol-15 station labels** `[jay]`: JBOX and JHALO put a source-side code in the MAGNITUDE of a protocol-15
word: 6 = respawn, 8 = "perk / KOTH loop", 10 = "proximity", 50 = capture notice. Our bench independently proves
one same-team magnitude-6 pulse revives a station-armed native gun, magnitude 8 is a real hill beacon and magnitude
50 is a real grenade capture event. **It does not prove a generic perk effect for 8 or any gun-side effect for 10;**
those labels do not name an observable bench state and remain unresolved in levers §17. Other source labels:
perk box = protocol 3, subtype 1, magnitude 10 (key
`<3,1>`; the stock table only has `<3,0>`); gas = protocol 11, player 64, magnitude 1, power 1; heavy damage =
protocol 0, player 63, magnitude 100 every 1000 ms; "Order 66" = protocol 10, player 64, team 2, magnitude 200.
The player field is 6 bits, so "player 64" is a wrap. Levers sheet §17.

## 6. `$WEAP` — weapon definition

Six slots (0–5) in Callsign's convention; slot 4 = melee (gyro swing, `$BMAP,8,4`). The 2018 app loaded slots 0–7
with melee in 7 (`$BMAP,8,7`) `[apk2018]`, and the firmware's slot byte runs 0–11 `[disasm]`, so six is not a
firmware limit. The full 0-indexed token map with APK field names is in
[`callsign-extract/protocol-classes.md`](callsign-extract/protocol-classes.md) and is rendered with per-token
confidence in `docs/manual/dev.md`. Known-good frames:

```
Assault Rifle : $WEAP,0,,100,0,0,24,0,,,,,,,,100,850,32,32768,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,9999999,75,,*
Charge Rifle  : $WEAP,1,,100,8,0,150,0,,,,,,,,1250,850,100,32768,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,C19,C04,20,150,100,9999999,75,,*
(Slot 2)      : $WEAP,2,,100,0,0,150,0,,,,,,,,1000,850,2,32768,2000,0,7,100,100,,0,,,E07,D32,D31,,D17,D16,D15,A73,,,,,2,9999999,75,,*
Gas Melee     : $WEAP,3,1,90,11,1,1,0,,,,,,1,80,1400,50,10,0,0,10,11,100,100,,0,,,S16,D20,D19,,D04,D03,D21,D18,,,,,10,9999999,30,30,*
Melee         : $WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,32768,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,9999999,30,,*
(Slot 5)      : $WEAP,5,1,90,10,0,115,0,,,,,,115,80,1000,850,2,32768,1200,0,7,100,100,,0,,,C03,,,,D14,D13,D12,D18,,,,,2,9999999,30,20,*
Shotgun (cap) : $WEAP,1,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*
```
(The AR sample's t5 = 24 comes from BC's "Boss WEAP Modified" sheet, a boosted enemy-tier variant `[sheet]`; the
stock Callsign AR emits 9.)

**Bench-proven tokens** (0-indexed; the bench tool prints raw 1-indexed positions, so raw = tok + 1):

| tok | Field | Proof |
|---|---|---|
| 2 | **gunRangeOutdoor = the range token** (a carrier frequency — see the `2, 41` row below) | ⭐ **BENCH-MEASURED 2026-09-17 (F231/F234)**, garden ladder, two guns, both in physical outdoor mode. Every captured gun reads **100** here and melee reads 90. t2 = 5 landed **0 hits from 38 shots**, muzzle on the dome included; 13 to 26 is a real transition band (13 gave 3 of 8 at 15 m on precise aim); about 31 to 100 is a flat shelf that behaved alike at every distance the garden could pace. ⚠️ **The ladder stands; the mechanism it was read as does not.** The 2026-09-18 V4_31 trace (the `2, 41` row below) shows the token sets the emitter's CARRIER FREQUENCY, not its power. A low value detunes the word out of the receiver's band-pass near 38 kHz; it does not shorten the beam. Read the shelf as the pass-band and the 13-to-26 band as its edge. ⚠ Whether t2 can fence a weapon at a chosen distance is **UNRESOLVED**: the whole ladder was shot into a dome in direct sun with the light moving, so every sub-30 number is a lower bound and the run needs repeating with the dome shaded. Below 26 the groups stopped being monotonic, so the values there cannot be separated. MC writes t2 only at an outdoor venue and refuses a value under 13 (`compile.gun_range_outdoor_pct`) |
| 3 | primaryDamageType = the IR word's B field / `$SIR` protocol key | echoed as `$HIR` tok2; stock 8 charge, 10 rocket, 11 gas, 13 melee |
| 5 | primaryDamage = the raw magnitude in the IR word | = `$HIR` tok5; pushed 22 → 9 → 115 and only those bits moved |
| 14 | **fire interval / charge time (ms)** | one-field flip: a sniper at t14 = 1250 fired one shot every 1.25 s. A compiler that trusted the APK field order wrote the rate into t15 and shipped every weapon at 10 shots/s. ⭐ **CALIBRATED 2026-09-10: t14 IS MILLISECONDS PER ROUND, near enough 1:1.** An AR at t14 = 100, trigger held, measured **101.6 and 102.0 ms/round** across two independent bursts (15 rounds in 1530 ms; 31 rounds in 3150 ms), counted from `$ALCD` magazine decrements off the wire — not from trigger pulls, which under fire mode 14 can release two rounds on one press. So a wanted cadence is just `t14 = ms/round`, with ~2 ms of firmware overhead on top; **RoF tuning is arithmetic, not guesswork**. ⚠ Two points, both at t14 = 100 and both full-auto: the ~2 ms overhead is not shown to be constant across the range, and **no floor has been measured** — how low t14 can go before the firmware clamps it, or before the IR word stops keying reliably, is UNKNOWN (`docs/bench-grenade.md` rung Z sweeps it). Note t14 also sets how hard the t21/t22 recoil model bites (see that row) |
| 15 | **weapon-swap delay (ms)** | 1700 doubled the swap, 425 halved it, 100 ran at 100; linear, no floor; the gun takes the larger of the two loaded slots' values (2026-09-04). Stock 850, melee 100 |
| 16 / 39 / 40 / 17 | maxClip / clipStartingAmmo / ammoReserv / maxAmmo | t39 = t16 and t17 = 2 × t40 in every stock frame; 9999999 / 32768 = unlimited. ⭐ **t17 is the count the player CARRIES; t40 is what a bare `$WEAP` leaves behind** (F207 2026-09-16, CORRECTED by main's perks bench 2026-09-18). The gun's `$ALCD` reserve mirrors t40 only in the ~200 ms between `$WEAP` and `$SPAWN`: on the real AR frame (t17 192, t40 96) the reserve read 96 after `$WEAP`, then 192 after `$SPAWN` and after MC's `$AMMO`. The 2026-09-16 reading was taken inside that window and reported a transient as the steady state, which is why a mid-match `$WEAP` re-push must always be followed by `$AMMO`. A start-up echo check that compared the reserve against t17 could never pass on any weapon; it passed on four weapons the moment it compared against t40. Read t17 as a derived ceiling, not as the reserve |
| 20 | **fire mode** | `0` full-auto · `7` single-shot/bolt · `9` burst (cycle in t23) · `2` charge, auto-release (a tap also fires) · `3` hold-to-charge, auto-fire (a tap is sound only) · `14` tap-fire or charge-release · `13` melee. Proven by flipping only t20 on a captured sniper (7 → 0 went full-auto); the Burst Rifle (t20 = 9, t23 = 275) fires exactly three rounds per pull |
| **21 / 22** | **maxAccuracy / singleShotAccuracy = the simulated-recoil CEILING and FLOOR** | ⭐ **BENCH-PROVEN 2026-09-09.** t21 is the accuracy ceiling (t21=0 armed `$ALCD` token 2 at 0 before a shot was fired); t22 is the FLOOR (t22=50 floored at exactly 50 and stayed for 22 more rounds; t22=0 floored at 0). Accuracy is a **per-shot hit probability**: a shot fired below the ceiling can emit **magnitude 0** — the manual's "miss" — and at floor 50 the recovered words were 4 × `mag=0` to 12 × `mag=9`, at floor 0 they were 16 × `mag=0` to 12 × `mag=9`. **Stock ships 100/100, which makes ceiling = floor and disables the model** — which is why every capture we and JEDGE ever took looked inert. The drop is ~1/5 of the range per shot and the decay races a native time-based recovery, so **t14 (fire interval) sets how hard it bites**: at t22=0, single shots ~2 s apart held a flat 80 while a held trigger reached 0 in eight rounds. Live value streams in `$ALCD` token 2 |
| 23 | burstWeaponTime (ms) | 275 Burst Rifle, 250 Force Rifle, empty elsewhere |
| 24 / 35 / 37 / 38 | overheat: heat per shot / overheat sound / charge-tap damage / **overheat enable** | ⭐ **BENCH-PROVEN 2026-09-17 (F229), and it retracts the old "t37/t38 enable pair, stock `20,150`" reading.** **t38 alone switches the mechanism on**: an Energy Rifle frame with only `t38` = 150 added locked the gun out at heat 99 after about 30 full-auto rounds, from a frame that never overheated before. **t37 is the tap damage of a charge weapon**, not a heat token: t37 = 30 made every tap land 30 while the full charge still landed t5. t24 and t35 stay **inert on their own** (the SMG, the Energy Rifle and the Plasma Sniper all ship them and never overheat). t35 is the overheat sound, and the captured ids do not all name one: `D11` (the SMG's) is the overheat cue, ear-confirmed on a real lockout; `C19` (the Charge Rifle's) is the charge's early-release cue; `D122` (the Energy Rifle's and the Plasma Sniper's) sounds like a reload. Live heat streams in `$ALCD` token 5 |
| 27 / 28 / 29 | fire sound / engage sound / release sound | t27 is a sound, not an identity (Rocket Launcher and Rail Gun both fire `C03`). `C…` in t28 = a charge sound; `D…` = extra reload parts; t29 present only when the weapon has a distinct release event |
| 2, 41 | **range is a CARRIER FREQUENCY, not a power** | ⭐ **2026-09-18, V4_31/V4_30 disassembly via the LaserTagMods session** (trace, not bench proof). The gun emitter's carrier is **`38000 − 125 × (100 − range)` Hz** for range 0-99, and exactly **38 kHz** at 100 or more. No table, no floor; a ceiling at 100. **This formula is the gun barrel's.** A word the **headset** emits (a t1 = 1 melee word at range t2/t41; the t1 = 2 extra word at t13/t42; a host `$IRTX` field 8) uses a steeper slope, **`38000 − 140 × (100 − range)` Hz** (range trace, headset LTPhead V1_35): t13 = 80 is 35.2 kHz, 30 is 28.2 kHz, 13 is 25.8 kHz. Emitter POWER does not move with range at all: PWM duty is about 20% indoors and 38% outdoors, set by the indoor/outdoor level alone. So a low `t2` does not shorten the beam, it **detunes the carrier out of the receiver's ~38 kHz band-pass**, which is why `t2` = 5 (26.1 kHz) landed 0 of 38 shots even muzzle to dome, and why the knee we measured around 31 (29.4 kHz) is a property of the RECEIVER rather than of the firmware. Reference points: 75 → 34.9 kHz, 50 → 31.75 kHz, 31 → 29.4 kHz, 22 → 28.25 kHz. ⚠️ **Consequence for balance: above the knee every value is inside the pass-band, so the differences we ship there are probably not felt.** Calibrate in kHz against the receiver's response curve, not as a percentage ladder. **`t41` is read ONLY when the IR-level variable is non-zero (indoor) AND `t41` itself is non-zero**; indoors with `t41` = 0 it falls back to `t2`, and outdoors it is never read, which is exactly the inertness F231 measured. The same rule makes `t42` replace `t13` indoors. That variable is written by `$GSET` t2, by `$IRLVL`, and by the on-gun mode (0 outdoor, 1 indoor, 2 night = indoor plus stealth); `$GSET` t3 is stored and never read |
| 1, 12, 13, 42 | **the second word: the SHOOTER's headset emits it** | ⭐ **NAMED 2026-09-18 from Battle Company's own weapon sheets** (via the LaserTagMods material; names STRONG, behaviour NOT bench-proven). **t1 = `WeaponIRSource`**: 0 gun laser · 1 headset only · **2 gun AND headset** · 3 double gun · 4 double gun + headset · 5 dry fire. **t12 = `ExtraHeadsetDamage`, t13 = `ExtraHeadsetRangeOutdoor`, t42 = `ExtraHeadsetRangeIndoor`.** The three stock weapons at t1 = 2 are the **Shotgun (t5 45, t12 70)**, **Rocket Launcher (115, 115)** and **Plasma Sniper (25, 80)**, all with t13 80 and t42 30/30/40. ⚠️ **The emitter is the SHOOTER's headset, not a bonus for hitting the victim's.** Three things agree: t1 names an IR SOURCE; V4_30 builds an `$IRTX,<dir>,<proto>,<id>,<team>,<damage>,…` frame and sends it to the gun's own headset to emit; and the community scoring readme says a swap-in headset with no high-power LED "means no shotguns, melee, explosions", which is about the shooter's hardware. t37/t38 (`HeadsetDirection`/`HeadsetRepeat`) probably steer it and set its repeat count. **So one Shotgun pull may put TWO words in the air, 45 and 70, at different ranges, and a victim can take either or BOTH — and 45 + 70 is 115, exactly the standard pool.** Test on the SHOOTER: fire once with its headset covered and gun exposed, once with the gun covered and headset exposed, reading the victim's `$HIR` magnitude, protocol and sensor each time; or put one pull into the IR rig and count the words. Our melee frame leaves t13/t42 EMPTY |
| 7–11 | **secondary-fire block — LIVE, not dead** | ⭐ **2026-09-18 (V4_31 disassembly via the LaserTagMods session; trace, not bench proof).** The block works: **t7 = chance %, t8/t9 = the `$SIR` key that roll uses, t10 = damage, t11 = crit %**. It is empty on all 20 captured stock frames only because no stock weapon uses it, NOT because the firmware ignores it. When the roll hits, BOTH the barrel word and any headset word switch to the t8/t9 key. So a weapon with a real alt-fire is buildable with no firmware change: a percentage of shots landing on a different table cell with their own damage |

**Field names from Battle Company's own weapon sheet** `[sheet]` (the raw `$WEAP` header row; the names are BC's,
the effects are unverified unless a bench row above says otherwise):

| tok | BC's name | Enum / note |
|---|---|---|
| 1 | `WeaponIRSource` | 0 GunLaser · 1 HeadSetOnly · 2 GunAndHead · 3 DoubleGun · 4 DoubleGunAndHead · 5 DRY_FIRE. `[disasm]` The V4_31 fire path branches on it: **0** = the barrel only, range t2/t41; **1** = the HEADSET only, as an `$IRTX` frame to the headset at range t2/t41 (**t13/t42 are not read**, so an empty t13/t42 on our melee row is NOT a K4 lead; the row stays as captured); **2** = the barrel (t2/t41) plus a headset `$IRTX` with damage t12 and range t13/t42; **3** = the barrel twice, the second shot with damage t12 and range t13/t42. Every stock melee row ships 1, which fits the scoring readme ("swaptx headsets have no high-watt IR LED, meaning no shotguns, melee, explosions"). Levers sheet §2 |
| 2 | `GunRangeOutdoor` | 100 on guns, 90 on melee. **Bench 2026-09-17: t2 IS the range lever** (the range test). `[disasm]` The mechanism is the IR carrier frequency, not power: the formulas (gun and headset) are in the `2, 41` row of the table above. `$DUTY` is test-only; every shot overwrites it. Calibrate in kHz, not percent (S48, S49) |
| 12 / 13 / 42 | `ExtraHeadsetDamage` / `ExtraHeadsetRangeOutdoor` / `ExtraHeadsetRangeIndoor` | `[disasm]` read only when t1 = 2 or 3: the second (headset or barrel) word's damage and range; t42 replaces t13 only when indoor AND non-zero, like t41/t2. For a t1 = 2 weapon (the stock Shotgun, Rocket, Plasma Sniper) the headset word carries the **same `$SIR` key** as the barrel word (t3/t4, or t8/t9 when the secondary roll fires), damage **t12 as sent** (the shooter's crit multiplier applies only to the barrel word; the crit flag rides on both), the same player and team, direction t37, loop count max(1, t38) and interval t23 (the headset clamps it to ≥ 200 ms). With t38 = N ≥ 2 the headset delivers the word N + 1 times (the counter order is a reading; the receiver rig confirms it) |
| 7–11 | `SecondaryFireChance` / `SecondaryDamageType` / `PowerType` / `Damage` / `CriticalChance` | `[disasm]` **live** in V4_31: t7 is the chance in %, t8 the protocol and t9 the subtype (the secondary `$SIR` key), t10 the damage, t11 the crit %; one fire mode adds 60 to the damage. Empty on every stock frame, so untested |
| 19 | `ReloadType` | 0 Magazine · 1 Quiver · 2 Shells · 3 SingleBolt · 4 BoltWithMagazine · 5 AutoReload · 6 NoReloadRequired · 10 bottomless magazine (melee ships 10). So "reloadType" was right after all |
| 20 | `GunWeaponType` | 0 FullAutoFire · 1 Bow · 2 ChargeAndAutoRelease · 3 ChargeAndRelease · 4 TapChargeAndRelease · 5 ChargeAndLooping · 6 Passive · **7–12 Burst1–Burst6** · 13 MeleeWeaponSlot · 14 PlasmaPistol. Agrees with the bench: 7 = one round per pull, 9 = three per pull |
| 25 / 26 | `MuzzleFlash` / `Volume` | the Suppressor's two fields (2, 50) |
| 30 | `Secondary_Mix_SoundName` | |
| 31–34 | `ReloadPart1` / `ReloadPart2` / `ReloadPart3` / `NoAmmo` sounds | the D-series reload parts |
| 35 / 36 | `WeaponFeatureA` / `WeaponFeatureB` | sound ids in the sheet (Charge Rifle C19/C04, SMG D11); the bench found t35 inert on its own |
| 37 / 38 | `HeadsetDirection` / `HeadsetRepeat` | ⚠️ **Disagrees with the bench**, which measured t37/t38 as the overheat enable pair (the Charge Rifle's `20,150` transplanted onto the SMG brought its heat gauge alive, 2026-09). The 2018 app names them `extraHeadsetDirection`/`extraHeadsetRepeat` too `[apk2018]`, and `[disasm]` the V4_31 fire path puts t37 (low byte) in the headset `$IRTX` direction field and `max(1, t38)` in its loop field (with t23 as the pulse period) whenever t1 is 1 or 2. **The bench result stands** until re-measured with that in mind (a headset word repeated t38 times that also feeds the heat gauge is possible); levers sheet §19 (the gap sweep) |
| 41 | `GunRangeIndoor` | 75 on guns, 20 on melee; **inert outdoors** (range test 2026-09-17). `[disasm]` Explained: t41 replaces t2 only when the IR level is non-zero (indoor) AND t41 is non-zero; outdoors it is never read, and indoors t41 = 0 falls back to t2. Same carrier-frequency formula as t2 |

The `Legend` sheet also gives `WeaponSlotType` 0 Primary · 1 Secondary · 2 PrimaryOffhand · 3 SecondaryOffhand ·
4 Melee, and the headset changelog gives the useful band of the range tokens: 70–90 % ≈ 10–30 ft in sun,
"suggest shotty/melee 80–85 %, explosives and healing 75–80 %" `[jay]`.

Unknown or unverified: whether t25/t26 do anything outside the Suppressor; t30; t35/t36's effect.
(**t21/t22 accuracy left this list 2026-09-09**, **t6 crit chance left it 2026-09-18**, and t2/t19/t20/t41 gained
their names the same week; all bench-proven rows are in the `$WEAP` table.)

⭐ **`t6` is `primaryCritChance`, and it is a straight percentage the GUN rolls per shot** (bench 2026-09-18, F62 answered). Two settings on one bench AR at 9 damage, against a victim with no armour so the `$HP` delta is the applied damage:

| `t6` | hits | crits | rate | crit damage |
|---|---|---|---|---|
| 20 | 64 | 9 | 14.1% | 13 |
| 50 | 119 | 54 | 45.4% | 13 |

Both rates sit within about one standard deviation of the token value. **A crit is the magnitude x1.5, truncated** (9 → 13). Our own emitter's C bit also measured ×1.5 (a rig word at magnitude 20 took 30, `docs/weapon-design.md` §6.3; the victim's `$GSET` t7 on that run was not recorded, and at the then-default 50 the victim-side t7 bonus alone
gives ×1.5). This contradicts the 2026-09-11 bench, which found t7 acts only on fn 36/37; levers §9 step 5
decides. The gun's crit is **not** the `$GSET` t7 headset scaling, which is a separate axis and ships at 0. `[disasm]` The V4_31 trace names the cause: on a crit roll the shooter multiplies the word's damage by (100 + `$PSET` t6)/100 (`CriticalDamageBonus`, shipped as 50), and the victim's `$GSET` t7 is a second layer on top (§5, the crit bonus). So the two ×1.5 results may have different causes: levers sheet §9 step 5 fires a rig word with C = 1 at a victim with t7 = 0, and expects ×1 if the crit is shooter-side. A "Critical Strike" perk is therefore one `$PSET` token on the shooter. The crit echoes on `$HIR` token 6, so a proc is visible to the victim's node: this is the mechanism a crit-chance perk, a high-variance weapon, or a poison-on-a-percentage-of-shots round would use.

## 7. What the gun does NOT hold

Three captures at respawn 5 / 15 / 30 s produced byte-identical `$GSET` and `$PSET`; the 8-field `$GSET` map
has no respawn, time, lives or score token; the app's end-of-game tail is `$VOL → $HLED,,6 → $STOP → $CLEAR →
$PLAY` and it never asks the gun for a score; reconnecting after out-of-range play yields zero frames. **The
gun keeps no game state.** Respawn, the clock and the score live in the host, which must stay in BLE range for
the whole match (the phone in the official system; a per-player node in ours). `[disasm]` `[jay]` This is true
of **app mode** (the mode `$GSET` sets, which `$START`/`$STOP` clear): in the gun's own hosted games (fw 4.20+,
`$AS`) the gun keeps kills, lives, tickets and flags locally and a "host" gun keeps team scores in its headset.
Nothing we ship uses that path.

**State survival:** game config, alive/dead, ammo and `$TID` survive a BLE drop (re-send the whole head after a
reconnect anyway; see the retractions table in `session-findings-2026-08.md` for the two contradicting
`$SPAWN`-after-drop readings); a power-cycle wipes everything except `$NAME`; switching the headset off makes
the gun send `$DISCONNECT,*` and drop the link; a power-cycled gun needs its headset re-linked before BLE holds.
**Bench-confirmed 2026-09-18: only `$CLEAR` wipes the `$SIR` function table; `$SPAWN` and death do not**, so a
row sent once at arm still registers hits after a `$SPAWN,,*` with no re-send. `$SPAWN` DOES zero every `$TMP`
token, so a per-life `$TMP` write (spawn protection, live accuracy, …) must land AFTER `$SPAWN`, never before it.

**Still open on v4.32:** `$AS` / `$UP` / `$SP` winner and end-game semantics (the `$SP,99,*` panic effect is
proven) and the `$RV`/`$RP`/`$KK`… family; the `$PB*` enum tables; `$BHIT`'s v4.32 shape and effect; `$HFIRE`'s
11-field behavior; `$LCD` and
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
- Two more console words, from Jay's JEDGE install document `[jay]`, untested by us: `QUERY` then `BLUETOOTH`
  then `4` then `Disconnect` ("fixes a Bluetooth issue with the tagger"), and `QUERY` then `PCB` then `4` (a PCB
  fault). They match the `BTchip- 4` and `PCB-5` lines of the record.
- The `SETUP` menu's options, from the V4_30 strings `[disasm]` (no code or unlock value is reproduced here):
  device type (gun / gun with gyro); reload device (bolt / button / magazine and bolt); recoil device (linear /
  vibration); owner type (commercial / retail / demo); Bluetooth type (HC-05 BT 2.0, nRF52 slave + HC-05 host,
  nRF52 host and slave, nRF52 devHost); PCB revision (v1–v4 retail, nRF52 v1/v2 retail); gun model (standard BRX /
  BRM metal); DLC toggles 0–11 (Generals, Commander, Swarm, TAR33, Sil.AR, Crit. Perk, Mercenary, Grenadier,
  Valkyrie, Sniper, Foregrip, Focus/Laser; 100 all on, 101 all off); debug serial output 0 off · 1 basic · 2 IR
  debug · 3 IR deep debug · 4 IR noise detector · 6 USB BT emulator. Level 2/3 would print IR decode detail on the
  USB console, a receiver diagnostic that needs no gun opening. The instrument never sends `SETUP`.
- Hold SELECT while powering on with USB connected → a different mode: USB mass storage exposing the firmware
  `.BIN` and the `AUDIO` folder (the sound-pack update path).
- **Firmware backup is impossible**: Teensy's HalfKay bootloader is write-only. Rollback depends on Battle
  Company supplying the original image; the official app's version gate ("supported until v2.01e") is an upper
  bound that warns and still runs a game. Do not reflash `devhost` units.
