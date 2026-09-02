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
| `$GSET,...` | Global game settings — **FULL MAP, confirmed 2026-08-24** | 8 tokens: `friendlyFire,outdoorMode,gunLaserRegion,autoAmbientLight,gyroscope,secondaryBluetoothWeapons,criticalShotModifier(%),gameMods`. Validated vs `$GSET,0,0,1,0,1,0,50,1,*`. **No respawn/time/lives token** — those are host-side. **`friendlyFire` (token 1) is GUN-ENFORCED** (bench 2026-08-26, brx-ir four-cell IR emitter, 2×+control): FF=0 blocks same-team damage AND enemy heals; FF=1 opens the gate — exactly as labelled. (An intermediate same-day gun-probe read it as not-enforced, but only reached FF=1 with an unverified victim team; MC friendly-fire is a policy/scoring layer over this enforced base.) Source: Callsign IL2CPP metadata, see `callsign-extract/protocol-classes.md` |
> **BENCH-CONFIRMED 2026-08-27 — `$GSET` token 7 is the crit modifier IN PERCENT** (measured at magnitude 20 on fn 1 with armour 200, seven t7 levels x 3 reps; the *form* is confirmed, a magnitude/function sweep would confirm it is universal)**:**
> `crit damage = magnitude × (1 + t7/100)`. Exact at t7 = 0/10/25/50/75/100/150 (3/3 reps each,
> single shots, armor 200 so nothing clipped). **t7=0 disables crits entirely; 100 doubles.** The
> shipped value is 50, which is why crit had looked like a fixed ×1.5. Non-crit damage is untouched.
> Tokens 2,3,4,5,6,8 showed **no** effect on damage / friendly fire / crit and remain unknown.
| `$PSET,...` | Player settings (health pools, audio set, etc.) | Tokens 3–5 are `<HP>,<armor>,<shield>` — verified against the `$LCD` echo in §7e. **Token 5 is a shield CAPACITY, not a starting pool** — the spawn shield is always 0 and is filled by a shield grant (fn 11/18) **or by armour overflow from fn 13/15/20/22**, saturating at t5 (bench 2026-08-27). **Not 8-bit** — but check what was actually measured: **armor and HP** were pushed to **1000** and decrement exactly, clamping at zero with no wrap. **Shield was NOT** — its only data is a grant-saturation run (cap 600, reached 500) and it was never decremented above 255. So a 255 cap is a policy choice rather than a device limit **for armor and HP**; for shield that is inferred, not measured. All at the gun-body sensor (`$HIR` tok1 = 4), ~40 cm. e.g. `$PSET,0,0,45,70,70,50,,H44,JAD,V33,...,A10,*` |
| `$WEAP,<slot>,...` | Define a weapon in slot 0–5 | ~44 tokens: damage, fire rate/delay, mag size, reload time, sounds, IR signature, ammo counts. See §6. |
| `$SIR,<protocol>,<subtype>,<sound>,<function>,...` | Configure how incoming IR events are interpreted | Maps IR signatures to effects: damage, add HP, add shields, add armor, etc. See §5. |
| `$BMAP,<button>,<function>,...` | Remap physical controls | Trigger=0, Alt-fire=1, Reload handle=2, Select=3, Left=4, Right=5, Gyro=8. Function 97=reload, **100=weapon-cycle (verified on hardware 2026-08-23)**. Note: with only one `$WEAP` slot loaded, function 100 has nothing to cycle to and **falls back to reloading** — which looks like a wrong mapping but is not. Load a secondary to see it switch. |
| `$GLED,<led1>,<led2>,<led3>,<t4>,<brightness>,,*` | **SOLVED 2026-08-30 — three INDEPENDENTLY ADDRESSABLE gun LEDs.** Tokens 1-3 are the three body LEDs front-to-back, each a **direct palette index**: **0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal/cyan · 6 white** (7-8 exist, unnamed). Verified one field at a time under a synchronous protocol, then predicted and confirmed: `$GLED,3,2,1,0,10` → **green / yellow / blue**. **`<t4>` = 3 blanks all three (night mode, P17)**; the Callsign app's `$GLED,,,,5,,,*` also blanks (sent on death). `<brightness>` is token 5. The set colour **alternates with the team colour** rather than replacing it outright. ⚠️ The APK's `mid, effect, optionA, optionB` field names do NOT match this behaviour — that teardown recovers names in declaration order with no types, and it also wrongly claims colour is team-derived. **This makes a 3-segment health/armour gauge buildable.** |
| `$PLAY,<soundID>,<volume?>,<priority?>,<announcerID?>,,,,*` | Play a sound/voice line by ID | **Complete 2166-id bank in `callsign-extract/sound-bank.md`.** e.g. `VA20`="connection established". **Two independent slots (§7o):** token 1 = local/effect sound; **token 4 = the announcer/voice channel** — `$PLAY,,4,6,V3A,,,,*` leaves token 1 empty and speaks `V3A` ("kill"). Both can carry an id at once (`$PLAY,VSF,4,6,JAY,,,,*` at game end). Any id not in the bank is invalid |
| `$AS,...` | Applicator/game-control settings | e.g. `$AS,1,0,4,0,10,0,95,*` |
| `$SP,<n>,*` | End-of-game / stop | e.g. `$SP,99,*` |
| `$STOP,*` | Stop (captured from official app, 2026-08-23) | First command the app sends on connect |
| `$PLAYX,0,*` | Stop/clear sound playback (captured) | Sent right after `$STOP,*` on connect |
| `$VOL,<volume>,<n2>,*` | Set volume (captured) | 0–100 (`MaxMusicVolume`=100). Android app sends `$VOL,100,0,*`; iOS Callsign `$VOL,69,0,*`. **On-gun menu 1–5 → `$VOL` (Tony's field-tested estimate, evenly spaced): L1=60, L2=70, L3=80, L4=90, L5=100.** Field defaults: **~75 inside (level 2.5), ~85 outside (3.5)**; L3–4 typical outdoors. `$VOL,45` = barely audible; use ≥65 to hear it. |
| `$NAME,<name>,*` | Set tagger name (captured) | App sent `$NAME,Tactix2,*` |
| `$VERSION,*` | Query firmware version (captured) | Reply: `$VERSION,v4.32,?,4,,devhost.03,*` |
| `$PBWEAP,<n>,*` / `$PBTEAM,` / `$PBPERK,` | Pre-battle weapon / team / perk selection | Mirrors the on-gun menu choices |
| `$TID,<team>,*` | Set team ID | **Masked to 2 bits — effective team = `$TID & 3`** (bench exp 4, 2026-08-26). **Four usable native teams — 0, 1, 2, 3** (a `$TID,2` shooter lands cross-team hits normally: `$HIR,4,0,0,2,24,0,0`; earlier team-2 silences were a bench-script re-setup race, not a limit). >4 squads → MC logical teams. `$HIR` token 4 echoes the shooter's effective team. |
| `$SPAWN`, `$RP`, `$RV`, `$UR`, `$IT`, `$KK`, `$TA`, `$PT`, `$HS`, `$PH` | Respawn/revive/status family | Partially mapped — see §7 Unknowns |
| **New commands from APK teardown (2026-08-24):** | | field maps in `callsign-extract/protocol-classes.md` |
| `$GREN,...` | **Smart Grenade config** (sent to the GUN, which programs the grenade) | iRType,crit,modifier,indoorMode,operationMode,channel,GrenadeType,MaxCount. GrenadeMode enum = FlashBang/Gas/Confusion/Molotov. See `callsign-extract/apk-harvest.md` |
| `$HFIRE,...` | Heavy/burst IR fire | Range,CountIRPulses,RateOfFire,FlashLED |
| `$IRTX,...` | Raw IR transmit | iRPower,soundOnHit,rangeOutdoor,rangeIndoor |
| `$LIFE,...` | Grant health | addedHP,addedArmor,addedShields |
| `$BHIT,...` | **Host-inflicted hit** | damage,isCriticalShot,powerLevel |
| `$BUMP,...` | Adjust current pools | hP,armor,shields |
| `$MELEE,<intensity>` / `$STUN` / `$VIB,<on>` / `$ZOOM` | Melee / stun / haptics / scope | |
| `$FSET,...` | Per-event sound-slot table | ~38 game-event→sound assignments |
| `$DLC` / `$ASKDLC` / `$GOTDLC` | Premium unlock handshake (BattleCoins) | hiddenFeatures |
| Headset: `$HLED` `$BLINK` `$CHASE` `$HLOOP` `$LED` | Headset LED effects | |

## 4. Messages FROM the tagger (BRX → host)

| Message | Meaning | Key tokens |
|---|---|---|
| `$PONG,*` | Ping reply | |
| `$VERSION,<ver>,?,<n>,,<host>,*` | Version reply (captured 2026-08-23) | e.g. `$VERSION,v4.32,?,4,,devhost.03,*` |
| `$DISCONNECT,*` | Tagger-initiated disconnect notice (captured) | |
| `$VOLTS,<pack_mV>,<cell_mV>,<n3>,<n4>,*` | **Battery telemetry** (verified 2026-08-23) | Periodic (~every 30 s) in app mode. Observed: `$VOLTS,7662,3921,55,70,*` — 7.662 V pack, 3.921 V cell; last two tokens likely charge %/levels (TBC) |
| `$LCD,<t1..t6>,*` | Display/state echo (observed 2026-08-23) | Seen in reply to `$START,*`: `$LCD,0,0,0,0,0,0,*` — semantics TBD |
| `$HIR,<sensor>,<irProto>,<shooterPlayerId>,<shooterTeam>,<damage>,,<subtype>,*` | **Hit! Tagger was tagged** | **token 1 = sensor that caught the IR (SHIELD-ISOLATED 2026-08-26: **0, 1, 2 and 3 are ALL HEADSET sensors; 4 = gun body** — the headset carries **four** (operator-confirmed 2026-09-01). The 2026-08-26 bench isolated 0 = FRONT and 1 = BACK; **2 and 3 are the other two and are not yet mapped to positions.** Point-blank floods mis-attribute; see the tok1 sensor map section), token 2 = shooter IR protocol (0 = standard, 10 = proto-10 e.g. rocket — §7r), token 3 = shooter player id (0–63, set by `$PSET` token 1), token 4 = shooter team (`$TID`), token 5 = the RAW magnitude from the IR word (= the shooter's `$WEAP` `t5`; **applied** damage = magnitude × the victim's `$SIR`-function multiplier × (1 + `$GSET` t7/100) if crit — §7r; the 1.5 in earlier drafts was only true because the shipped config uses t7=50), token 7 = weapon subtype echo (sniper = 1)** — hardware-verified (§7k team, §7q player id, §7r sensor/damage/protocol) |
| `$HP,<hp>,<armor>,<shield>,*` | Health update (tokens verified §7r) | `$HP,0,0,0` = player died (or turned zombie in Survival); arrives in the same ms as its `$HIR` |
| `$BUT,<id>,<state>,*` | Physical button event (verified 2026-08-23) | id: 0=trigger, 1=alt-fire, 2=reload handle, 3=select, 4=left, 5=right (matches `$BMAP` ids). state: 1=press, 0=release |
| `$UP,...` | Status/update report (0–6 tokens) | **`$UP,*` bare gets no reply** (§7l). LaserTagMods send it *with* args as `$UP,100,<n>,0,*` — likely a WRITE, not a query |
| `$AS,...` | Game/control echo (0–11 tokens; token 8 = applicator) | |
| `$SP,...` | End-of-game report (0–5 tokens) | |
| `$WEAP`, `$PERK`, `$HS` | Selection echoes from on-gun menus | |

**Kill attribution pattern (from `$HIR` + `$HP`):** store shooter ID/team from the last `$HIR`; when `$HP,0` arrives, the stored shooter gets kill credit. JEDGE encodes a kill notification between devices as: `$DD,<killerPlayerID>,<killerTeamID>,<victimID>,<nonce>,*` (host-side convention, not a tagger command).

## 5. `$SIR` — incoming IR event table (observed)

Format: `$SIR,<irProtocol>,<subtype>,<soundID>,<function>,<p5>,<p6>,<p7>,<p8>,*`

> **BENCH-PROVEN 2026-08-26 — `$SIR` is a programmable effects matrix we can drive over IR.**
> Using our own ESP32 emitter (`protocol/brx-ir-protocol.md`) against a live victim:
>
> - **`<irProtocol>` = the IR word's B field, `<subtype>` = the IR word's U field.** Together they are
>   the row's lookup key; the victim **silently ignores any IR event with no matching row**. 64 cells.
> - **The IR word's 8-bit "damage" field is really a MAGNITUDE** — the row's `<function>` decides what
>   it applies to. The same 20 means "hurt 20", "heal 20", "armor 20" or "shield 20".
> - **Functions confirmed on hardware:** `1` damage (works on protocols 0/6/8/10/13) ·
>   **`10` respawn + add HP** (HP 15→35→45, +magnitude, clamps, deals no damage) ·
>   **`11` add shields** (0→50→70) · **`13` add armor** (0→30→60→70, **overflow spills into shields**).
> - **Damage drain order confirmed on the wire: shields → armor → HP.**
> - **⚠ TEAM-GATED in firmware, by polarity** — measured as a four-team matrix across **four functions
>   (1, 2, 9, 11)**, not all 41; "all functions" is an extrapolation from those four plus the
>   polarity pattern seen in the wider map (bench 2026-08-27, `$GSET` t1=0, victim `$TID,1`, `$HIR` counted separately from
>   `$HP`):
>
>   | function | team 0 | **team 1 (victim's own)** | team 2 | team 3 |
>   |---|---|---|---|---|
>   | fn 1 damage, fn 2 armour-pierce | lands | **rejected** | lands | lands |
>   | fn 9 / 11 support grants | rejected | **lands** | rejected | rejected |
>
>   **Damage applies only from an enemy team; support only from your own.** Support-side gating was
>   established 2026-08-26 (3/3 same-team, 0/3 otherwise); the damage side is measured here.
> - ⚠️ **SCOPE — two different runs, two different starting states. Check which a number came from.**
>   The **function-class map** (`experiment-log.md` 2026-08-27) re-armed the victim to **full**
>   hp45/armour70/shield0 each cell, so in *that* run a heal/armour grant clamps and a
>   shield-drain has no shield to take — "moves no pool" is only meaningful there for **HP/armour
>   damage**. The confirmed grant figures in the bullets above (fn 10 `15→35→45`, fn 11 `0→50→70`,
>   fn 13 `0→30→60→70`) come from an earlier run with **depleted** pools and are unaffected.
>   Both were measured at the **gun-body sensor** (`$HIR` tok1 = 4), ~40 cm; whether a
>   **headset-dome** hit applies the same deltas is **untested**.
> - **The rejection emits NO `$HIR` AT ALL.** A team-blocked shot is not "received and not applied" —
>   it never reaches BLE. **Consequence: friendly fire and mis-aimed support are invisible to Mission
>   Control** and cannot be logged or scored from gun telemetry while t1=0.
>   ✅ **RESOLVED 2026-08-27.** An earlier draft claimed "damage is NOT friendly-fire gated under
>   either `$GSET` token 1 value"; that was wrong, and the generalisation to t1=0 was then flagged as
>   unsupported. It is now **measured**: at t1=0, same-team damage is rejected outright (`$HIR`=0)
>   while teams 0/2/3 land normally — see the matrix above. A medic gun enforces "allies only", and a
>   weapon enforces "enemies only", in hardware whenever friendly fire is off.
> - **`<soundID>` fires on the victim.** Heard at the bench: `VA16` = "armor suit", `VA8C` =
>   "shields online" (effect masks the first word), `H29` = a quiet sustained stim-pack medical sound.

| Example | Interpretation |
|---|---|
| `$SIR,0,0,,1,0,0,1,,*` | Standard weapons (AR, Energy Rifle, Ion Sniper, Laser Cannon, Plasma Sniper, Shotgun, SMG, Stinger, Suppressor) — damage shields→armor→HP |
| `$SIR,0,1,,36,0,0,1,,*` | Force Rifle / Sniper Rifle — fn 36 = **floor(magnitude × 1.25)** ✅ **CONFIRMED 2026-09-02, see the multiplier note below** |
| `$SIR,0,3,,37,0,0,1,,*` | AMR / Bolt Rifle / Burst Rifle — fn 37 = **magnitude × 2** ✅ **CONFIRMED 2026-09-02, see the multiplier note below** |

> ### ✅ SETTLED 2026-09-02 — the fn 36 / 37 damage multipliers are REAL
>
> **fn 36 = floor(magnitude × 1.25) · fn 37 = magnitude × 2.** Safe to use for weapon tuning.
>
> Measured 2026-09-02: **16 trials, 4 magnitudes, 8 different `$SIR` row-tail shapes.** Every trial
> carried an **fn 1 control on subtype 0** that had to read exactly the magnitude, or the trial was
> voided.
>
> | magnitude | control fn 1 | fn 36 | fn 37 |
> |---|---|---|---|
> | 20 | 20 | **25** | **40** |
> | 40 | 40 | **50** | **80** |
> | 9 | 9 | **11** | **18** |
> | 7 | 7 | **8** | **14** |
>
> **The multiplier TRUNCATES, it does not round.** Magnitude 7 settles it: 7 × 1.25 = 8.75 landed as
> **8**. This matters for hits-to-kill.
>
> **Tested and NEGATIVE: the row's trailing tokens do not gate the multiplier.** Row tails
> `0,0,1,,` / `,,,,` / `0,0,0,,` / `0,0,2,,` / `0,1,1,,` / none / `0,0,1,60` **all** produced ×1.25
> and ×2.
>
> **Scope:** measured through **our** `$SIR` table — the victim's row is what picks the function, and
> that table is the configuration we ship.
>
> #### What was retracted, and what is still unexplained
>
> The 2026-08-27 "controlled matrix" run read **×1.0 in all 24 multiplier cells** with a valid fn 1
> control. That result is **outvoted, not explained** — we still do not know why it read ×1.0. It is
> recorded here so the disagreement is not lost. The 2026-08-27 emitter exoneration still stands: the
> emitter is function-agnostic (it sends 25 bits; the victim's `$SIR` row decides the function), so an
> encoding fault cannot masquerade as a multiplier, and pool deltas measured through that rig
> (armour-piercing, add-HP, the Energy Launcher's 0/3) were never in doubt.

| `$SIR,1,0,H29,10,0,0,1,,*` | Respawn + add HP |
| `$SIR,2,1,VA8C,11,0,0,1,,*` | Add shields — **adds `magnitude` per hit, saturating at `$PSET` token 5**; the spawn shield is always 0, so t5 is a ceiling to be filled, never a starting pool (bench 2026-08-27) |
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

**✅ The full token map is now recovered** — see `callsign-extract/protocol-classes.md` for the
field names in order and a validated token table (e.g. tok5=`primaryDamage`, tok16=`maxClip`,
tok27=`primaryFire_SoundName`, charge sounds tok28/29). It was cracked from the Callsign IL2CPP
metadata + cross-validated against the two frames above, not by per-setting capture diffing.
Recognizable fields: damage, fire delay (ms), mag capacity, ammo reserve (32768/9999999 = unlimited
flags), reload time (ms), IR signature/power type, sound IDs (`R01`,`D04`,`E03`,`C15`…), range/
accuracy (%), per-slot ammo.

### 6.1 Bench-probed corrections (live tagger, 2026-08-26)

> **⚠ PARTIALLY SUPERSEDED same-day:** the open questions below (t23 'suspect', 'fire-mode not located/may not exist', charge-feel 'not localized') were ALL RESOLVED hours later — **see the t20 FIRE MODE and overheat sections near the end of this file** (t20 proven by one-field flip; t23=burst cycle; charge = t20 variants 2/3/14; overheat = t24+t35 gated by t37/t38). The proven fire-interval/850-constant findings here still stand.

Tony live-probed the built frames on a real gun (`firemode_probe.py`), one token at a time. The
bench tool prints **raw 1-indexed** positions (slot = idx1); the field map above and the compiler
are **0-indexed** (slot = tok0), so **raw idx = tok + 1**. Findings (tok = 0-indexed here):

- **`tok14` = FIRE INTERVAL (ms) — PROVEN.** A sniper built with `tok14=1250` fired **exactly one
  shot per second**. This is the real rate control. ⚠️ It **corrects** the `protocol-classes.md`
  field table, which inferred from field order that `tok14`=chargeUp-time and `tok15`=rateOfFire —
  the rate is **`tok14`**, and `tok15` is not it.
- **`tok15` = constant `850` in every captured frame; function UNKNOWN — do not write it.** The
  compiler had been writing `fire_ms` into `tok15`, so it never reached the gun and every built
  weapon inherited the AR sample's `tok14=100` → **10 shots/s full-auto regardless of config**.
  Fixed 2026-08-26 (`compile.py` maps fire→`tok14`, charge parked; commit c606417).
- **`tok19` = `reloadType` — enum-matched, UNVERIFIED.** `Magazine=0 / … / Shells=2` (`ReloadType`
  enum, `protocol-classes.md`): a magazine auto reads 0, a pump reads 2. A sniper probe of `tok19`
  changed nothing about firing → consistent with a **reload mechanism, not** the fire-mode selector.
- **`tok23` = `burstWeaponTime` — SUSPECT, unverified.** Empty in the AR/CR samples; a sniper probe
  read ≈275. Candidate burst/cycle timer.
- **Fire-mode / semi-auto — NOT located, and may not exist.** `tok1` is eliminated (a sniper with
  `tok1=2` still fired full-auto). The `GunWeaponType` enum (`FullAutoFire, Bow, ChargeAndAutoRelease,
  ChargeAndRelease`, `apk-harvest.md`) has **no semi/burst member**, so per-pull semi-auto may simply
  not be expressible in this firmware — held-trigger full-auto is the only mode we can build today.
- **Charge feel is in the frame but not localized.** A byte-identical Charge Rifle frame gives a weak
  splat on a tap vs a charged blast on a hold, so the charge behaviour is carried by `$WEAP` tokens.
  Eliminated as sole carriers: `tok3` (damageType `8`, no effect) and `tok14` (`1250`, pure rate).
  The paired fields that both read `14` on the CR (`tok20`+`tok24`) together produced a **delayed-shot
  charge feel** → the mechanism lives in that pair; isolating `tok20` alone is in progress (unverified).
  Fallback candidate if it doesn't reproduce from one token: the CR tail block `tok35`–`tok38`
  (`C19,C04,20,150`) as a unit.

## 7. Unknowns / TODO

**Much of this was SOLVED by the Callsign APK teardown (2026-08-24)** — see
`callsign-extract/protocol-classes.md` (command/field maps, WEAP token positions) and
`apk-harvest.md` (modes, stations, grenade). Status:

- ✅ **Full `$WEAP` 44-token field map** — recovered + cross-validated against two live frames
  (`protocol-classes.md`). ~6 always-empty positions still want a one-field capture to finalize.
- ✅ **Complete sound ID catalog** — 2166 ids in `callsign-extract/sound-bank.md`.
- ✅ **`$GSET` / `$PSET` token positions** — GSET fully mapped + hardware-confirmed; PSET field
  set known (maxHP/maxShields + positional voice pack).
- ✅ **Smart Grenade config** — `$GREN` sent to the gun; GrenadeMode = FlashBang/Gas/Confusion/
  Molotov. Still to test on hardware: transport (IR-on-load vs immediate) + BLE visibility (followup F).
- ⬜ **`$AS`, `$UP` semantics**; `$RV`,`$RP`,`$UR`,`$IT`,`$KK`,`$PT`,`$TA`,`$PH`, kill-confirm family — still open.
- ⬜ Gen1 vs Gen2/3 command differences (JEDGE notes fw 4.26 added `$AS`,`$SP`,`$UP`).
- ⬜ Headset link protocol (though headset LED commands HLED/BLINK/CHASE/HLOOP/LED are now known).

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

## 7c. The micro-USB "Programing Port" — full exploration record (2026-08-23)

The BRX has **two** ports (manual §7h): a charging port and a separate micro-USB
**"Programing Port"**. This documents everything tried on the latter, including what
failed, so nobody repeats it.

### Enumeration

Plugged into macOS it appears as:

```
USB Product Name = "USB Serial"
USB Vendor Name  = "Teensyduino"     -> /dev/cu.usbmodem*
```

**So the tagger's MCU is a Teensy** (PJRC ARM). On Windows/Linux expect a COM port /
`/dev/ttyACM*` instead. It is USB CDC, so **baud rate is ignored** — 115200 and 57600
behaved identically. The port disappears on unplug and returns on replug.

### What did NOT work (all tried, all dead ends)

| Sent | Result |
|---|---|
| `$PING,*` (no terminator) | echoed back verbatim — the port has **local echo on**, which is easy to mistake for a reply |
| `$PING,*\n` | echo only |
| `$VERSION,*` | echo only |
| `ZZZGARBAGE` | echoed — this is what proved it was local echo, not a response |
| `$PING,*\r\n` | `ERROR` |
| bare `\r` | `ERROR` |
| `?` `help` `HELP` `h` `menu` `MENU` `version` `VERSION` `AT` `info` `INFO` `status` `list` `commands` | all `ERROR` |
| 3 s passive listen | silence — it volunteers nothing |

**The `$` protocol does not work over USB.** Every `$` frame is rejected. This port is a
different interface entirely.

### What DOES work: `QUERY` and `SETUP` (the "PuTTY" serial console)

**This is a USB serial console, NOT SSH.** The tagger has no network stack. The micro-USB
"Programming Port" is the **Teensy's USB CDC serial port**, so it enumerates as a COM port
(Windows: `COMx`; macOS: `/dev/tty.usbmodem*`; Linux: `/dev/ttyACM*`). You open it with **PuTTY in
*Serial* mode** (or `screen`/`minicom`, or our `brx-mcp` via pyserial) — this is what the community
means by "PuTTY into the tagger." It's a plain serial terminal, not a login/shell/SSH; baud is
arbitrary (USB CDC ignores it). Commands are **case-insensitive** and need a **CR** terminator.
This is a *different* USB mode from the mass-storage disk (SELECT-hold-at-boot) used for firmware/
sound files — a normal connection gives the serial console.

The command set came from LaserTagMods' "Pairing Headset and Tagger" note, not from guessing.

**`QUERY`** — read-only, dumps the whole device record:

```
Gun Info
Gun Version: v4.32
Serial Number/Head PIN: <SERIAL>      <- matches the sticker on the paired headset
Gun Name: Tactix2
Headset Version: hds.59               <- reads '?' briefly after a power-cycle until
Gun: 7.671 VOLTS                         the headset re-handshakes; not a fault
PlayerID 0
FieldID1
NRFhost 1
NRFslave 1
devHost 1                             <- developer/host image, not retail
Head: 3.837 VOLTS
Head Tested:
Head BURN in test: 0
Gun BURN in test: 3hours28minutes
Grenade Pin: 0
Laser: 16.9 mW
Tested by: JB
PCB-5
BTchip- 4
BT central V: devhost.03
```

This is the **only local backup available** (see below). Ours is saved to
`~/.brx-mcp/device-backups/` — kept out of the repo because it contains the headset PIN.

**`SETUP`** — factory provisioning. Prompts bilingually (EN/中文):

```
SETUP
Factory Defaults 默认
Enter unique SN 进入耳机的序列号,  example 例: 00A9F
```

It asks for the **headset's** serial number — this is the gun↔headset pairing mechanism
(matching LaserTagMods' note: run `QUERY` on both, `SETUP` on whichever you want to
re-pair, enter the PIN). **We did not answer the prompt.** We abandoned it by
power-cycling, then re-ran `QUERY` and diffed field-by-field: **nothing changed** except
live sensor values (battery voltages drifting by millivolts). So the "Factory Defaults"
banner is a mode header, **not an action** — entering `SETUP` is safe, and it does not
reset anything on entry.

`SETUP` does **not** appear to expose `devHost` or the BT role; it only asked for the SN.
Whether later prompts do is unknown — we stopped rather than commit a pairing change.

**"Reset everything" / "change tagger ID" (community, Jay Burden):** this is the `SETUP` path —
"plug the tagger USB into a PC, run serial comms, and change the tagger ID." `SETUP` is the
factory-provisioning/reset flow; it re-enters IDs and the headset-pairing PIN. The `QUERY` dump
exposes the writable identity fields: **`PlayerID`** (ours reads `0` — never set), **`FieldID`**,
**`Serial Number/Head PIN`**, and **`Grenade Pin`**. So the serial console is how you set a tagger's
identity and re-pair its headset/grenade — a full re-provision, not a networked reset.

**This is the lead on per-player identity (followup P2).** FFA per-player scoring needs a unique
player id per tagger; `$HIR` only carries the *team*. The `PlayerID` in the `QUERY` record is
almost certainly what identifies a shooter, and **`SETUP` is how you set it** — walk the full
`SETUP` prompt sequence (carefully; it commits pairing/ID changes) to confirm it writes `PlayerID`,
then `QUERY` to verify. Next step for P2, and a good candidate for a `brx-mcp` **serial-console
backend** (pyserial: open the COM port, run `QUERY`/`SETUP` programmatically) so Mission Control can
read *and set* tagger identity over USB at bench-prep time.

### Firmware backup: impossible

- Teensy's **HalfKay bootloader is write-only by design** — PJRC deliberately prevents
  reading firmware back off the chip. No flash dump is possible over this port.
- **Firmware:** no flash dump over HalfKay (above). Note this port/bootloader is for *firmware*;
  it is NOT how sounds are changed.
- **Sound storage (corrected 2026-08-24):** there IS on-board sound storage, and the community
  swaps sound files over the **micro-USB data port** — SD stays hot-glued to the board; **hold
  SELECT while powering on** (USB connected) to expose it as mass storage (won't enumerate on a
  normal boot). The earlier "no SD card" claim conflated firmware backup with sound storage. See
  `callsign-extract/protocol-classes.md` → "New sounds ON THE TAGGER" and `community-notes.md`.
- Therefore **rollback depends entirely on Battle Company supplying the original image.**
  Do not reflash without it, especially on `devhost` units that may not exist in their
  retail archive.

### Where the `$` protocol actually lives

**A hardware UART at 115200**, not USB. LaserTagMods' JEDGE drives it with
`Serial1.println("$UP,100,5,0,*")`, and the Gen1 HC-05 mod bridges that same UART over
Bluetooth Classic. The built-in BLE module is likewise a UART bridge — which is why BLE
and the wire speak identical frames.

There is **no external accessory port** on these taggers (operator confirmed: micro-USB
only), so a wired UART tap means opening the gun. Untested, and not attempted — it would
need a pinout and is invasive on developer units.

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
| `$SSID` | WiFi network name | **These three together imply a WiFi/server mode we knew nothing about.** Worth investigating: if the tagger can join a network, that is a second transport entirely |
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

### Reconciling with the manual

The manual (§7h) says an on-gun game is started by **pulling the reload handle**, which had
been our leading hypothesis for the remote-start stall. That hypothesis is **superseded**:
the capture shows the app starting a game with no reload-handle pull at all. The handle is
the *local* start control; `$SPAWN,,*` is the *remote* one. Both exist.

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

### `$HIR,<sensor>,<irProto>,<player>,<team>,<magnitude>,<crit>,<subtype>,*`

Observed forms: `$HIR,0,0,1,1,9,0,3,*` and `$HIR,4,0,1,1,9,0,3,*`. Only the **first token
varies** across this capture — the IR protocol id, matching `$SIR`'s first field.
Protocol `0` hits drained **18** armor each; protocol `4` hits drained **9**.
Token 5 was `9` in both, so it is **not** simply the damage value — the `$SIR` table's
mapping of protocol → effect is what determines damage.
> **Corrected (§7r, 2026-08-26): token 5 = the RAW magnitude in the IR word** (= the shooter's `$WEAP`
> `t5`), and the **applied** damage = magnitude × the `$SIR`-function multiplier × (1 + `$GSET` t7/100) if
> crit — see §7r. (Earlier drafts said a flat ×1.5; that is only the shipped t7=50 case.)
> ⚠️ **The old "protocol 0 → 18 vs protocol 4 → 9" split is NOT explained by that**, and a first attempt
> to explain it that way was wrong: in these two frames (`$HIR,0,0,1,1,9,0,3` / `$HIR,4,0,1,1,9,0,3`)
> the varying token is **token 1, the SENSOR** — `irProto` (token 2) is **0 in both**. The "protocol 4"
> reading predates the token-1 = sensor decode and is retracted here. **The 18-vs-9 damage split
> remains unexplained.** Shooter-ID semantics could not be
confirmed from this capture (both players sat on default ids) — **now resolved, see §7k.**

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
| `$SFLASH,*` | **SOLVED — the shooter's green-sight kill-confirm flash (§7o).** No arguments. The host sends exactly one per **kill the holder scores**. The "periodic, never near a hit" reading in this row was wrong: this capture is the **victim's** gun, so its kills are outgoing — correlate with `$BUT` trigger bursts, not with `$HIR`/`$HP`. |
| `$HLOOP,<a>,<b>,*` | Seen only as `$HLOOP,0,0,*`, immediately after each death. Was a §7d lead from LaserTagMods sources; now confirmed live. |

## 7g. Callsign's game model (operator walkthrough, 2026-08-23)

How the official app structures a game, from the operator driving both phones for the
§7f capture. Useful because it tells us which app-level concepts map onto which frames.

### Flow

1. **Host phone** creates a game: name → game type → settings → create.
2. **Client phone** waits **~1 minute** for the game to appear as joinable, joins,
   picks primary + secondary weapons, hits ready.
3. **Host launches.** Both taggers go live.
4. In-game the app shows a HUD: health, shield, ammo, current weapon.

### Game types

| Type | Sub-modes |
|---|---|
| Team Arena | Arena, Team Arena, Team Snipers, Capture the Flag |
| Battle Royale | — |
| Battle Lines | — |
| Faction Wars | — |
| Infection | — |

The §7e/§7f captures are both **Team Arena → Team Arena**.

### Settings exposed, and where they probably live

Time limit, score to win, respawn type, respawn time, indoor/outdoor mode, weapon
selection, weapon respawn, voice.

- **Respawn time** is a *game setting*, which is why §7f's ~10 s gap between `$HP,0`
  and `$SPAWN,,*` is the app obeying config, not app latency. Host-driven respawn is
  by design.
- **Weapon selection** maps to the three `$WEAP` frames: slot 0 primary, slot 1
  secondary, slot 4 melee (always sent, never user-selected).
- **Time / score-to-win / respawn / lives are NOT in `$GSET`** — three captures at different
  respawn values produced byte-identical `$GSET` (§7n), and the confirmed 8-token map (§3, from the
  APK) contains none of them: token 7's `50` is `criticalShotModifier` (%), not score-to-win. These
  settings live in the host/app, not on the gun. `$GSET` sets on-gun things: friendlyFire, region,
  ambient light, gyro, crit modifier.
- **Indoor/outdoor** does map to `$GSET` (token 2, `outdoorMode`).
- **HUD** is fed by `$LCD`/`$ALCD` echoes; the app does not track health/ammo
  independently, the gun reports it.

### Architectural implications

- **The phone is the game engine.** The tagger enforces nothing: it does not know the
  rules, the score, or the clock, and it does not revive itself. Everything is host
  logic pushed over the serial protocol. Our `server/` can therefore replace the app
  outright without touching the gun.
- **There is a separate phone-to-phone lobby layer.** Game discovery/join/ready is not
  BLE — the ~1 minute before a game appears suggests a **cloud round-trip**, not local
  discovery. An open replacement needs its own answer here; possibly related to the
  `$BRXSERVER` / `$SSID` / `$PASS` commands in §7d. **Unverified — worth capturing the
  phone's network traffic (not BLE) to find out.**

### `$GSET` decoding — DONE (this experiment is retired)

The `$GSET` 8-token map is decoded and hardware-confirmed (see §3 and
`callsign-extract/protocol-classes.md`). The differential-capture approach was also proven a
**dead end for respawn/time/score** — three captures at different respawn values gave
byte-identical `$GSET` (§7n), because those settings aren't sent to the gun at all. The one place
differential capture still helps is pinning `$WEAP`'s ~6 always-empty tokens (`diff_captures`/
`gsetdiff` tools exist for it).

## 7h. Facts from the official BRX manual (V7)

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

## 7i. `$GLED` is not RGB — inconclusive probe (2026-08-23)

Walked primary-colour candidates one at a time with the operator watching the gun LED:

| Sent | If tokens were r,g,b | Actually observed |
|---|---|---|
| `$GLED,0,1,0,0,10,,*` | red | **blue** |
| `$GLED,0,0,1,0,10,,*` | green | **red** |
| `$GLED,0,0,0,1,10,,*` | blue | **blue** |
| `$GLED,0,1,1,1,10,,*` | white | blue |
| `$GLED,1,1,1,0,10,,*` | (doc example) | blue |
| `$GLED,0,0,0,0,10,,*` | off | red |

**The `<r>,<g>,<b>` interpretation in §3 is disproven** — `1,0,0` gave blue and `0,1,0`
gave red. The operator also reported the colour changing several times during a single
4 s hold.

Two candidate explanations, neither tested:
1. **The LED is a status indicator.** The manual (§7h) says the gun LED shows ammo and
   health, so game state may be animating it and overriding whatever we set. The probe ran
   outside a game, which is *not* a controlled state.
2. **Token 1 is a team index** selecting a preset colour, and tokens 2-5 are not a colour.

**Do not guess a colour constant from this data.** A proper experiment needs the tagger in
a known, static state (ideally mid-game with health and ammo full so the status animation
is stable), one token varied at a time, and the operator naming the colour each time.

Motivation for solving it: free-for-all has no teams, so a neutral LED (white) is wanted,
while team modes need red/green/blue — the engine needs both.

**Community lead (FB group, Jay Burden — 2026-08 crawl) that likely reconciles this:** the
colour is a **single index field** (not RGB), format `$GLED,x,x,x,1,2000,2000,*` (token 4 =
effect, 5/6 = durations), with a **9-colour map: 0 red · 1 blue · 2 yellow · 3 green · 4 purple ·
5 cyan · 6 white · 7 pink · 8 orange** (4 playable teams: red/blue/yellow/green). Cross-checked
against the probe above, **token 2 as the colour index fits 5 of our 6 observations**
(`0,1,0,0`→blue=1 ✓; `0,0,1,0`→red, token2=0 ✓; `0,0,0,0`→red=0 ✓; `0,1,1,1`→blue=1 ✓;
`1,1,1,0`→blue — token1=1?), the lone miss (`0,0,0,1`→blue) being the effect token or the
mid-hold colour flip the operator saw. **Re-probe with `$GLED,<0-8>,0,0,1,2000,2000,*` varying
only field 1 (and field 2), mid-game.** Source: https://www.facebook.com/groups/712027809192113/posts/1691669094561308/

### RESOLVED (same day): LED colour comes from `$TID`, not `$GLED`

Two taggers were given identical configs differing **only** in team id — `$TID,1,*` vs
`$TID,2,*`, with no `$GLED` sent at all — and they lit **different colours**:

| `$TID` | Observed LED |
|---|---|
| 1 | blue |
| 2 | yellow |

⚠️ **PARTLY RETRACTED 2026-08-30.** What stands: `$TID` does set a default colour, and
`$GLED` has no `<r>,<g>,<b>` tokens — that is why walking them produced nonsense.
What is **wrong**: the conclusion that colour is *only* team-derived and `$GLED` cannot
set it. `$GLED,<led1>,<led2>,<led3>,<t4>,<brightness>` drives **three independently
addressable body LEDs**, each a direct palette index, and a gun held on `$TID,1` took six
colours on command. The §7i probe corroborated the wrong reading because it ran on a
tagger that was already blue **and** was walking the wrong token positions.

**Still unknown:** the full team→colour table, what `$GLED`'s tokens actually do, and
whether a neutral/no-team colour exists. **Next test: `$TID,0,*`** — free-for-all has no
teams, so if a null team yields white that is the semantically correct way to set an FFA
LED rather than forcing a colour.

## 7j. `$ALCD` decoded — ammo/weapon HUD stream (verified 2026-08-23)

From a two-minute FFA run with three weapons loaded (`deathmatch` command).

```
$ALCD,<mag>,<100>,<slot>,<reserve>,<0>,*
```

- **Token 3 is the weapon slot.** Ammo is tracked per weapon: slot 0 `36/108`,
  slot 1 `6/12`, slot 4 `1/0`.
- **Alt-fire (`$BMAP` function 100) cycles between the gun slots 0 and 1** — each appears
  as a long run of `$ALCD` frames while it is held and fired.
- **Slot 4 (melee) is NOT in that cycle.** It is triggered by physically **swinging the
  butt of the gun upward**, detected by the gyro — which is what `$BMAP,8,4,,,,,*` maps
  (button 8 = Gyro → function 4). In the stream it shows as an **isolated single `$ALCD`
  frame** that immediately reverts to the weapon in hand, not a run.
  (Corrected after an initial misreading: seeing `4` appear between runs of `0` and `1`
  looks like a cycle position until you know the operator was swinging the gun.)
- Token 2 was `100` throughout. **⚠ IDENTIFIED 2026-08-27: token 2 is the gun's AUDIO LEVEL** (normally 100). A `$SIR` **function-23** hit drives it to **0** and it recovers over ~6–8 s, during which the operator reported *no sound on trigger pull, then quieter, then normal* — while the gun kept firing and emitting IR normally. **Best explanation from one ear + one meter, not a second independent instrument** — treat as strong but single-sourced.
- **Token 5 = WEAPON HEAT — decoded 2026-08-26 (cap19 + a re-read of cap16).** It is non-zero in
  **exactly the two captures whose weapon has an overheat mechanic** — the SMG (`G03`, `$WEAP`
  `t24`=5) and the Charge Rifle — and **`0` across 400+ `$ALCD` frames in the twelve other
  captures**, which between them cover AR, burst rifle, sniper, AMR, launcher, rail gun, rocket
  launcher, laser cannon, shotgun and melee.

  It **accumulates with sustained fire and resets after cooling**. From cap19, firing the Charge
  Rifle (operator: *"it got hotter on light trigger pulls"*):

  ```
  $ALCD,58,100,0,100,86,*     light pulls cost 1 ammo and drive heat up
  $ALCD,57,100,0,100,82,*
  $ALCD,55,100,0,100,89,*
  $ALCD,54,100,0,100,97,*
  $ALCD,54,100,0,100,106,*    <- peak (note: exceeds 100, so not a percentage)
  $ALCD,53,100,0,100,14,*     <- reset after cooldown/overheat
  ```

  **This is live weapon telemetry a host can read over BLE** — Mission Control can show a heat bar,
  and a mode could react to overheating. It cost nothing to obtain: cap16 already contained it and
  we had logged the field as "unknown".
- **Reload is round-by-round.** A slot-1 reload emitted one `$ALCD` per round as the
  magazine refilled and the reserve drained in step:
  `mag 0→1→2→3→4→5` while `reserve 12→11→10→9→8→7`. A HUD should expect a burst of
  `$ALCD` frames during reload, not a single updated total.
- `$ALCD` is therefore the **ammo/weapon** stream; `$LCD` (§7e/§7f) is the
  **health/armor** one. Both are echoes — the gun reports its own state; the host does
  not compute it.

## 7k. SOLVED — `$HIR` token 4 is the shooter's team (verified 2026-08-23)

> **Update 2026-08-25 (§7q):** the "tokens 2 and 3 were `0,0`" observation below was a confound — every gun
> in this capture had player id 0. **Token 3 IS the shooter's player id** once guns carry distinct
> `$PSET` token-1 ids. The FFA caveat at the end of this section is therefore resolved: no unique-`$TID`
> workaround is needed.

Ran one game across **two taggers from a single host** (`arena` command), configs identical
except for the team id: `$TID,1,*` on one, `$TID,2,*` on the other. 42 hits exchanged.

```
tagger on team 1 receives:  $HIR,4,0,0,2,9,0,3,*     <- token 4 = 2
tagger on team 2 receives:  $HIR,4,0,0,1,9,0,3,*     <- token 4 = 1
```

**Token 4 is the shooter's team id** — each tagger reports the *other* team's number,
consistently across every hit. This is what §7f could not determine, because with both
players on default ids every frame read `1,1` and carried no distinguishing information.
Giving the taggers distinct `$TID`s made it immediate.

```
$HIR,<irProto>,<t2>,<t3>,<shooterTeam>,<t5>,<t6>,<t7>,*
```

- **Token 1 = IR protocol**, matching `$SIR`'s first field (confirmed again here). One
  frame arrived as `$HIR,1,...`, and §5 maps protocol `1` to "respawn + add HP" — so
  pickups and hits share this message type; do not assume every `$HIR` is damage.
- **Tokens 2 and 3 were `0,0`** throughout. The player-id hypothesis in §4 is **not**
  supported — team id is what varies. A per-player id may live elsewhere (`QUERY` reports
  a device-level `PlayerID`, which we never changed).
- **Tokens 5-7:** normally `9,0,3`. Two other forms appeared, `45,0,0` and `70,0,0` —
  suspicious because `45` and `70` are exactly the configured starting HP and armor, and
  the tail differs (`0,0` not `0,3`). **Meaning unknown; not damage.** Do not guess.

### Kill attribution is therefore possible, with a caveat

`$HIR` names the shooter's **team**, not the shooter. In team modes that is enough to
credit a team. For free-for-all — where every player needs a distinct identity — either
each player must be given a unique `$TID`, or per-player identity has to come from
somewhere we have not yet found.

## 7l. `$UP` probed — bare form does nothing (2026-08-23)

Probed while hunting for a way to read results back off a tagger after out-of-range play
(the gun volunteers nothing on reconnect — see the field test in `docs/experiment-log.md`).
`$UP` was the leading candidate because §4 lists it as a "status/update report".

**Result: `$UP,*` produced no reply at all.**

```
baseline 3 s listen : 0 frames (silent, despite the tagger still being mid-game)
>> $UP,*            : no reply within 2.5 s
+4 s later          : nothing
```

So the bare form is **not** a query, and `$UP` is not the results read-back command — at
least not like this.

### But LaserTagMods send `$UP` *with arguments*

Their host code (JEDGE) does:

```
Serial1.println("$UP,100,5,0,*")
Serial1.println("$UP,100,6,0,*")
Serial1.println("$UP,100,7,0,*")
Serial1.println("$UP,100,8,0,*")
Serial1.println("$UR,*")
```

Four `$UP,100,<n>,0,*` calls with `<n>` walking 5→8, followed by `$UR,*`. So `$UP` **is**
a host→tagger command in real use, and the incrementing middle token looks like an index
(slot? player? display line?) rather than a query parameter. `$UR` plausibly commits or
refreshes whatever `$UP` staged.

**Untested, and treat as a WRITE not a read.** A command taking a value (`100`) and an
index is far more likely to set something than to report it. Do not send it mid-game
expecting a harmless answer. If it is probed, do it on a tagger in a known throwaway state
and `QUERY` over USB before and after to see what moved.

### Consequence

Reading results back after out-of-range play remains **unsolved**, and may be impossible:
§7g established the phone is the game engine and the tagger enforces nothing, so there may
be no score stored to read. The way to settle it is a capture of a complete Callsign game
through its end-of-round summary, to see whether the app ever asks the gun for anything —
see `docs/experiment-log.md` (the Mac Callsign capture sessions). **Do not probe `$SP` on hardware to shortcut
this**: it is documented as the end-of-game report, but `$SP,99,*` is half the panic
sequence and may destroy the results it is meant to report.

## 7m. THE HEADSET IS REQUIRED for the official app (2026-08-23)

**With no headset paired, Callsign connects to the tagger and immediately disconnects it,
silently — no error, no voice line.** With the headset present it connects and holds.

This is an operational gotcha that wasted a large part of an evening. It also explains a
run of "the app is flaky" failures: a capture taken during them
(`disconnects.log`) shows the app completing its connect ritual, receiving **zero frames
back**, and hanging up ~1.2 s later — while the very same tagger answered our own client's
`$PING` with `$PONG` in 120 ms. The gun was never the problem.

Corroboration: the two captures that *did* work (§7e game start, §7f combat) were taken
while `QUERY` reported `Headset Version: hds.59` — i.e. a linked headset.

Related but distinct, from the manual (§7h): a headset that drops **mid-game** locks the
gun until it reconnects (anti-cheat), while a gun booted with **no** headset shoots fine
locally. So the gun tolerates a missing headset; **the app does not.**

**Before any capture or app-driven session: confirm the headset is on and paired.**
Pairing can take up to 3 minutes with many BT devices around (§7h). `QUERY` over USB shows
`Headset Version` and `Head: <voltage>` — use it to verify rather than guessing.

### The green icon is a precondition, not just an indicator

Callsign has a **connection-status icon in the top right**, and **you cannot create a game
at all unless it is green and reads "connected"**. That is the gate. It is also the source
of truth — the tagger's voice lines are not: "phone connected" only means a central
attached, and "phone disconnected" indicates a *graceful* teardown (abrupt link loss is
silent until supervision timeout).

**This is the whole explanation for the "app is flaky, then suddenly works" pattern.**
Nothing intermittent was happening. When the headset was linked, the app went green and
games could be created; when it was not, the app silently dropped the tagger and game
creation was simply unavailable. Neither operator nor agent was tracking headset state, so
the same underlying condition looked like random flakiness for hours.

**Workflow rule: get the icon green before doing anything else.** If it will not go green,
the problem is the headset, not the app, the gun, or the radio.

## 7n. SETTLED — the gun holds no game state; out-of-range play cannot work over BLE

Three deliberate captures (`cap5` respawn **15 s**, `cap6` respawn **30 s**, `cap7`
respawn **5 s**, Team Arena) plus a complete game ending caught inside `cap5`.

### Respawn and game time are NOT sent to the tagger

```
cap5 (respawn 15): $GSET,1,0,1,0,1,0,50,1,*
cap6 (respawn 30): $GSET,1,0,1,0,1,0,50,1,*
cap7 (respawn  5): $GSET,1,0,1,0,1,0,50,1,*      <- all byte-identical
```

Not one token moved, across three well-separated values. `$PSET` is identical too, and the
**only** frame unique to any one capture is a `$VOLTS` battery reading, which drifts by
itself. So **nothing anywhere in the host→tagger stream encodes respawn time.**

Game time behaved the same way — `cap5` used a 1-minute clock and its `$GSET` still matched
the earlier default-clock captures (§7e/§7f) exactly.

(Method note: `cap6`'s secondary weapon changed unintentionally, so the cap5/cap6 pair was
contaminated. `cap7` was taken specifically to re-test with a third value, and the
conclusion no longer rests on that pair.)

**The app keeps the clock and drives respawn itself.** This is consistent with §7f, where
the *app* sent `$SPAWN,,*` about 10 s after death. The manual (§7h) lists respawn and time
as on-gun menu settings, so the firmware can do it — **Callsign simply does not use that
path**, and therefore no capture will ever reveal a command for it.

### The app never asks the gun for results

End of game, from `cap5`:

```
[38.202s] >> $SPAWN,,*                 game starts
[44.882s] << $VOLTS,7395,3791,33,48,*  last frame the tagger ever sends
[60.795s] >> $VOL,69,0,*
[60.998s] >> $HLED,,6,,,,,*
[61.198s] >> $STOP,*
[61.397s] >> $CLEAR,*
[61.595s] >> $PLAY,VS6,4,6,,,,,*
```

**No query. No score request. Nothing.** The app stops the game and plays a sound. This
explains why `$UP,*` got no reply (§7l) and why reconnecting after a field game produced
zero frames: **the gun keeps no score, so there is nothing to read.** The phone tallies
`$HIR`/`$HP` events live — it is the only place the score has ever existed.

### Consequence for the one-laptop field design

**Out-of-range play cannot work over BLE.** This is a design property, not a missing
command. A tagger with no host in range will not respawn anyone, will not end the round,
and will not remember what happened. Confirmed empirically by the field test
(`docs/experiment-log.md`): the guns kept *shooting* with no host, but nothing respawned,
the round never ended, and nothing was recoverable afterwards.

Anything that needs respawn, a clock, or scoring **requires a host in BLE range for the
whole match**. The options are therefore:

1. **A device per player** — what the official system does; the phone is ~1 m away.
2. **A relay in range** — a cheap ESP32 per player bridging to WiFi/LoRa. This is what
   LaserTagMods build.
3. **The nRF radio.** `QUERY` reports `NRFhost 1` / `NRFslave 1`, and LaserTagMods ship
   `NRFL-Bases` and `LoRa-Controlled-Taggers`. **If these guns already carry a long-range
   radio, BLE is simply the wrong transport for field play.** Unprobed, and now clearly
   **the most valuable unexplored thread in the project.**
4. **On-gun menu configuration** — set respawn/time by hand on each gun before a match, and
   accept no central scoring. Viable for casual play; does not scale to 20 taggers.

**Stop looking for a `$GSET` respawn token.** It is not there.

## 7j. Community-captured `$PB*` remote-start sequence (FB group, v4.30)

A full remote-start sequence captured on **firmware v4.30** via serial debug (Don Richardson,
FB group — [post](https://www.facebook.com/groups/712027809192113/posts/1628528407542044/)). This
is the **`$PB*` "playbook" family** — the pre-battle config path (complementary to the `$SPAWN`
remote-start in §7e). Order as sent:

```
$#CONNECT,*
$INDOOR,1,1,*
$VERSION,*
$RADSK,*
$PBLOCK,*
$PBGAME,0,*     game mode      0 = Free-for-all
$PBTEAM,0,*     team
$PBWEAP,0,*     weapon         0 = M4 AUTO
$PBPERK,2,*     perk           2 = Body Armor
$PBLIVES,2,*    lives          2 = 5 lives
$PBTIME,5,*     time           5 = Infinite
$PBSPAWN,0,*    spawn
$PBINDOOR,1,*   indoor/outdoor
$PBSTART,*      >>> start the game
$DISCONNECT,*
```

Also seen alongside: `$HP,0,0,0,*`. **Version quirk:** on v4.30, prefixing the session with
`$INIT,*` makes the gun *accept* commands but then **NOT start** after `$PBSTART` — omit `$INIT`
for a clean start. These enum values (game/weapon/perk/lives/time indices) are a starting map to
confirm against our own `$GSET`/`$PSET` findings — treat as **community-reported until we reproduce
on our hardware/version** (ours is v4.32; behaviour may differ). See followup for mapping the full
`$PB*` enum tables.

**Respawn delay** is a game setting that **ramps per death, capping at 45 s / 90 s** (FB group —
[post](https://www.facebook.com/groups/712027809192113/posts/2284364655291746/)) — consistent with
§7f's observed ~10 s first-death gap.

## 7o. SOLVED — native kill feedback IS BLE-drivable (`$SFLASH` + the announcer slot)

**Capture:** `cap8` (2026-08-25, MacBook/PacketLogger). Two taggers, official iOS Callsign,
3 kills scored by the captured gun. **This overturns the 2026-08-25 bench conclusion that the
green sight and killstreak announcer are nRF-only and unreachable from BLE.**

### What the app actually does

The captured gun is the **shooter** (`$ALCD` ammo 36→6, `$BUT` trigger bursts, never hit). Each
kill produced, from the phone, over plain BLE:

```
[215.031s] << $BUT,0,1,*              # last shot of the burst
[215.423s] >> $SFLASH,*               # <- the green-sight kill-confirm flash
[215.622s] >> $PLAY,,4,6,V3A,,,,*     # <- "kill" on the announcer slot
[216.423s] >> $PLAY,,4,6,VB17,,,,*    # <- score line ("<team> takes the lead")
```

Three kills → three `$SFLASH` + three `V3A`, each ~0.4 s after a trigger burst ends. `V3A` is
independently documented as **"kill"** in our own `sound-bank.md`. `VB17` fired only on the
**first** kill — the moment the lead changed — and is the line Tony heard as *"red team takes
the lead"*.

**So the phone is the scorekeeper and it drives the feedback.** There is no nRF handshake to
discover: Callsign has no nRF radio either. It does exactly what our Mission Control was designed
to do, using two commands we had misread.

### Two commands corrected

- **`$SFLASH,*` = the shooter's kill-confirm sight flash** (one per kill), not a periodic
  keep-alive. §7f called it *"never near a hit or death, purpose unknown"* because that capture
  was the **victim's** gun — a kill you *score* is invisible in your own `$HIR`/`$HP` stream, so
  it must be correlated against `$BUT` trigger bursts.
- **`$PLAY` has a second, independent sound slot at token 4** — the announcer/voice channel.
  `$PLAY,,4,6,V3A,,,,*` plays a voice line with token 1 empty. Both slots can be used at once:
  the game-end frame is `$PLAY,VSF,4,6,JAY,,,,*`.

Why the bench `$GLED` probes failed: right observation, wrong command. `$GLED` drives the three
**body** LEDs (solved 2026-08-30) and never drives the **sight** flash; `$SFLASH` does.

### Game end is host-driven, and uses both `$PLAY` slots

The operator ended the match by hand (**Settings ▸ End Game** on the host phone) after the third
kill — the game did not end on a limit. The tail is therefore the app's deliberate end-game
sequence:

```
[252.223s] >> $VOL,69,0,*
[252.424s] >> $HLED,,6,,,,,*
[252.624s] >> $STOP,*
[252.824s] >> $CLEAR,*
[256.709s] >> $PLAY,VSF,4,6,JAY,,,,*   # both slots: VSF sting + JAY (5.69 s) outro
```

Same shape as the solo capture's ending (`$VOL → $HLED → $STOP → $CLEAR → $PLAY`), but the solo
game closed with a single-slot `$PLAY,VS6` — here the two-slot form carries a short sting **and** a
long announcer clip. Note the ~3.9 s gap before the final `$PLAY`: the app lets `$CLEAR` settle
before speaking.

**`cap8` is operator-annotated end to end** — connect → arm → 3 kills scored → manual end — with
every step confirmed against what the operator did and heard. That makes it the reference trace for
what a complete hosted game looks like on the wire.

### The enabler frame does not exist — and is not needed

Callsign's arm is otherwise **byte-identical to ours** (`$CLEAR → $START → $GSET → $PSET →
$WEAP×3 → $SIR×10 → $BMAP×7 → $PLAYX → $PLAY,VA81 → $SPAWN → $AMMO → $BMAP`; same
`$GSET,1,0,1,0,1,0,50,1`). **No channel, session, network-id, `$PB*` or `$NRF*` frame anywhere.**
The hypothesis that some BLE frame flips guns into autonomous nRF peering is **dead** — but so is
its consequence, because the feedback layer turns out to be directly commandable.

Only difference worth noting: `$WEAP,1` carried a different secondary (`J15`, 1/3 ammo — a
launcher) because a different loadout was picked in-app, and `$VOL,69` vs our 75.

### Consequence

A **BLE-only Mission Control can deliver the full native feel** — green-sight kill confirm,
kill/announcer voice, and score lines — with no nRF hardware. This retires the "audio compensates
for the lost visual" compromise: the visual is available too. Per-player attribution (P2) remains
the one thing BLE cannot give us, since `$HIR` names the shooter's **team**, not the shooter.

Corroboration: the identical `$SFLASH → $PLAY,,4,6,V3A → VB17` pattern is present in the
**2026-08-23** two-tagger capture (lines 99–101, 172–173). We had the evidence for two days and
misread it.

### The capture is the HOST phone's view — the role MC plays

`cap8` contains exactly **one** BLE connection, yet **both** taggers announced the score line. The
setup (operator-confirmed): the **captured iPhone hosted the game** and a second phone **joined it
through Callsign** (§7g's host/client lobby), each phone bonded to its own tagger.

So the architecture is: **game state is shared phone-to-phone over the network, and each phone
drives only the one gun it owns over BLE.** Nothing propagates gun-to-gun — there is no nRF score
channel, and none is needed. The score line reached the second tagger because the *client phone*
sent it there.

This matters for us in two ways:

- **What we captured is the host's own traffic** — the same role Mission Control occupies. The kill
  burst above is not a client echoing someone else's decision; it is the authority acting on a kill
  it scored.
- **MC collapses the topology.** Callsign needs one phone per player because a phone can hold one
  gun; MC connects to the whole fleet from a single machine, so the network sync layer between
  phones disappears and every gun's feedback is driven directly. Fewer moving parts than the
  official system, not more.

## 7p. CONFIRMED — `$PSET` token 1 IS the PLAYER ID, settable over BLE (P2 set-path)

**Capture:** `cap10` (2026-08-25). Single device, Callsign **Start Offline Game**, with the app's
**player id set to 69**.

The whole arm sequence is identical to every previous capture except **one token**:

```
cap10:              $PSET,63,0,45,70,70,50,,H44,JAD,V33,…
every other capture: $PSET,0,0,45,70,70,50,,H44,JAD,V33,…
                           ^
```

**The operator entered 69; the wire carries 63.** That is not a mismatch — **63 is the 6-bit
maximum**, and the BRX IR shot payload's player field is **exactly 6 bits (0–63)**, decoded
independently from LaserTagMods' NRFL-Bases source (`brx-ir-protocol.md`). An out-of-range 69
clamped to 63 is precisely what a 6-bit field does.

Two independent sources agreeing — a wire capture and a decompiled IR encoder — is what makes this
more than a coincidence.

### Why this matters

**Per-player identity has been the single remaining stock-feel gap over pure BLE.** `$HIR` names the
shooter's *team*, not the shooter, so BLE scoring is team-granular and FFA can't credit a specific
killer. The assumed fix was either the USB `SETUP` console (cable per gun at Armory Setup) or an IR
receiver decoding the 6-bit field out of the air. If `$PSET` token 1 sets it, **identity is
assignable over BLE at arm time, per game, with no cable and no extra hardware** — Mission Control
can just number the fleet.

### CONFIRMED by `cap11` — with a prediction made in advance

Two further observations settled it the same evening:

- Re-opening the app showed the id field **prefilled with 64**, not 69 — so the app clamps to a max
  of **64**, and its range is **1–64** (64 distinct values, 1-based).
- That predicted a **0-based wire**: app 64 → wire 63, so app **7 should send 6**. Captured
  (`cap11`): **`$PSET,6,0,45,70,70,50,…`**. Exactly as predicted.

| | app (Callsign UI) | wire (`$PSET` token 1) |
|---|---|---|
| range | 1 – 64 | **0 – 63** (6 bits) |
| example | 7 | 6 |
| max | 64 | 63 |
| out of range | 69 → clamped to 64 | 63 |

**`$PSET` token 1 = player id, 0-based, 0–63.** Subtract one from any 1-based number you show an
operator. This matches the IR shot payload's 6-bit player field exactly, which is presumably where
the value ends up.

(The APK's source-derived `$PSET` map in `protocol-classes.md` starts at `maxHP, maxShields,
criticalDamageBonus…` and never names tokens 1–2 — so the decompiled map is simply incomplete here,
and the wire is the better authority.)

### What this closes, and what it doesn't

**Closed: SETTING identity.** No USB `SETUP` cable per gun, no IR hardware. Mission Control numbers
the fleet over BLE at arm time, per game, in the frame it already sends.

**READING who fired — CLOSED the same evening, see §7q:** with distinct `$PSET` ids on two guns,
`$HIR` token 3 reports the shooter's id on every hit. P2 is fully solved over BLE.

**Token 2 remains `0` in every capture, including this one — still unknown.**

## 7q. CONFIRMED — `$HIR` token 3 IS the shooter's PLAYER ID (P2 read-path; P2 CLOSED over BLE)

**Bench, 2026-08-25, two taggers (`Tactix-E20D`, `Tactix-3D4F`), driven from the Windows `brx-mcp`
server.** Standard TDM arm at vol 69 (the §7e sequence), config-all-then-spawn-all (B10), identical on
both guns except two frames:

| gun | `$PSET` token 1 | `$TID` |
|---|---|---|
| E20D | `6` (app "7") | `1` (blue) |
| 3D4F | `19` (app "20") | `2` (yellow) |

Both echoed `$LCD,45,70,0,0,36,216` on spawn (live, headsets linked). Then each shot the other:

```
3D4F shoots E20D  →  E20D receives  $HIR,4,0,19,2,9,0,3,*   × 26 (two full kills)
E20D shoots 3D4F  →  3D4F receives  $HIR,4,0,6,1,9,0,3,*    × 6
                                           ^^ ^
                                           |  token 4 = shooter's $TID  (§7k)
                                           token 3 = shooter's $PSET player id  (this section)
```

Every hit, both directions, token 3 = the *shooter's* `$PSET` token 1 and token 4 = the shooter's `$TID`.
No exceptions across 32 hits.

```
$HIR,<irProto>,<t2>,<shooterPlayerId>,<shooterTeam>,<t5>,<t6>,<t7>,*
```

### Why every earlier capture missed it
§7f/§7k read tokens 2–3 as a constant `0,0` because **all guns were at the default id 0** — the field
was there all along (`protocol.py` had parsed token 3 as `shooter_player_id` since day one, on the
strength of the LaserTagMods note), it just never varied. `$PSET` token 1 (§7p) is what makes it vary.

### Consequences — the last stock-feel gap over pure BLE is gone
- **Per-player kill attribution is BLE-native.** Victim-side `$HIR` tok3 + `$HP,0` names the exact
  killer. FFA, individual K/D, assists, Syphon (heal the *killer*), and per-player kill feedback
  (`$SFLASH` to the right gun) all work with no extra hardware.
- **No USB `SETUP` cable, no IR receiver** are needed for identity. MC assigns 0–63 at arm time in
  `$PSET`. The VS1838B/ESP32 IR bench (B13) is now about *stations* (B4) and emit, not attribution.
- **Display convention:** show operators 1-based ids (Callsign parity, 1–64); write `id-1` on the wire.
- **FFA no longer needs a unique `$TID` per player** (the §7k caveat / P9 workaround) — one team, FF on,
  distinct `$PSET` ids. `$TID` goes back to being purely team + LED colour.

### Other observations in the same run
- **Token 1 varied on kill shots:** the frames that took HP (after armor was exhausted) arrived as
  `$HIR,0,…` and the killing hit as `$HIR,2,…`, vs `$HIR,4,…` while armor absorbed. Token 1 is the IR
  protocol/effect class (§7k) — apparently the *applied* effect, not just the weapon. Unexplained; logged.
- **A dead gun cannot fire:** trigger pulls on the `$HP,0` gun produced `$BUT,0,1/0` but **no `$ALCD`
  decrement**. Settles the Counter-Strike "dead can't plant" gate (mode-limits.md) in the affirmative.
- **Damage model reconfirmed:** armor 70 → 61 → 52 → … → 7 → 0 (9/hit), then HP 45 → 43/34/25/16/7 → 0.
  ~13 hits to kill at default `$PSET`.
- **Token 2 still `0` in every frame** — still unknown.
- Our raw bleak client still dropped E20D once at ~6.6 s after the first connect (before any frame was
  written); reconnect held for the whole session (~3.5 min).

## 7r. BENCH 2026-08-25 (late) — `$HIR` token 1 = SENSOR, `$HP` = hp/armor/shield, headset-off, `$PLAY` tokens

Two taggers (GUN-A = player 6 / team 1, GUN-B = player 19 / team 2), the MC golden
`FrameBundle` head written verbatim over BLE from the bench rig (`$VOL,60`). Findings, each observed directly:

- **`$HIR` token 1 is the SENSOR that caught the IR, not a damage class.** Aimed shots: headset-only hits →
  `$HIR,1,…`; gun-body hits → `$HIR,4,…`; a third value `0` appeared on unaimed hits (a HEADSET sensor — the headset has four, 0-3).
  A kill is NOT marked in `$HIR` (no `2`): the kill is `$HP,0,0,0` followed by `$LCD,0,0,0,0,<mag>,<reserve>`.
  §7q's "4 = armor absorbed / 0 = HP / 2 = kill" reading is **retracted**. Token 5 = the raw magnitude in the
  IR word (24 here = this config's `$WEAP` `t5`; **applied** = magnitude × the victim's `$SIR`-function
  multiplier × (1 + `$GSET` t7/100) if crit — see the §7r addendum; ×1.5 is only the shipped t7=50).
  **tok1 sensor map — RESOLVED by shielded isolation (2026-08-26):** `0` = headset **FRONT** dome,
  `1` = headset **BACK** dome, `4` = gun body (full method in the tok1 sensor-map section at the end of
  this file). A headset/head hit is tok1 ∈ {0,1,2,3} (the headset has FOUR sensors — operator-confirmed 2026-09-01; only 0 and 1 were bench-isolated) (0 vs 1 = front vs back); the earlier bench's "token 1
  == 1 is a headshot" was half-right — 1 is specifically the BACK dome. ⚠ Trust tok1 for directional
  logic **only at field distance**: a five-phase point-blank sweep saw only {0,4}, because IR floods
  every receiver and the first to catch it reports, so aim→sensor doesn't map at close range.
- **`$HP,<hp>,<armor>,<shield>,*`** — token 2 is the armor pool (70 → 46 → 22 → 0 at 24/hit, spill into HP:
  `$HP,43,0,0`). `$HP` and its `$HIR` arrive in the same millisecond.
- **Headset OFF = no BLE.** Switching a headset off while linked makes the gun send `$DISCONNECT,*` and drop the
  link; a new link to a headset-less gun "connects", answers a quick `$PING`, then dies within seconds and
  echoes NOTHING to a config head (no `$ALCD`, no `$LCD`). So there is no headset probe to design: a held link
  + `$ALCD` echoes IS the headset check (A5.4). Reconnecting too fast after the gun's own `$DISCONNECT` gives
  a dead session (`BleakCharacteristicNotFoundError` for the NUS TX char from a fresh process) — power-cycle.
- **`$VERSION` token 2 = headset firmware** (`hds.59` with the headset linked; earlier captures show `?`).
- **Fresh power-up needs the handshake.** A just-booted gun ignores a bare `$VERSION,*`; after
  `$STOP,*` → `$PHONE,*` it answers (§7m). The node's pre-config probe set is mandatory, not cosmetic.
- **The config head is SILENT.** Writing `$CLEAR…$TID` (no `$SPAWN`) plays nothing; "get some" + the cock
  belong to `$SPAWN`. The T-10 s head re-write (M-START) costs no audio.
- **A configured-but-unspawned gun ignores IR** — no `$HIR`, no `$HP`, no reaction. Kit-out try-outs are safe.
- **`$PSET` token 2 is inert**: 0 / 1 / 7 gave byte-identical `$HIR`, identical damage, LEDs, hit grunts.
- **Live `$TID` write takes effect immediately for hit resolution** (same-team → zero `$HIR` both ways **[✅ CONFIRMED: FF IS firmware-enforced — with `$GSET` friendlyFire=0 a same-team hit does zero damage, so this observation was right. An intermediate 2026-08-26 gun-probe called it superseded, but that probe only reached FF=1 with an unverified victim team; brx-ir's four-cell IR emitter (2×, control) confirmed FF=0 blocks same-team damage AND enemy heals]**; back to
  the other team → damage resumes on the next hit) but does NOT repaint the LEDs — colour is set at `$SPAWN`.
- **Resync (M-NODE §3.10) verified:** on a fresh link a dead gun volunteers nothing and `$PHONE,*` returns
  nothing (the link is alive — `$VERSION` answers). Trigger while dead → `$BUT,0,1/0` only; reload handle →
  `$BUT,2,1/0` only. Alive: `$BUT,0,1` + `$ALCD,<mag-1>,…` per shot; reload = `$BUT,2` then `$ALCD,32,…,<reserve>`
  with reserve accounted per round (384 → 352 → 338). `$SPAWN,,*` + `$AMMO` on the fresh link revived it with
  config intact (`$LCD,45,70,0,0,32,32768`): **config survives a BLE drop (E1 ✅)**.
- **Hold-across-disperse:** a head held unspawned for ~2 min then `$SPAWN`ed went live with config intact.
  The 5-min run was cut by the headset event — re-run.
- **`$PLAY` needs the volume/priority tokens.** `$PLAY,VA33,,,,,,,*` was SILENT; `$PLAY,VA33,4,6,,,,,*` spoke
  "game over". `$PLAY,VSF,4,6,JAY,,,,*` = victory sting + "victory" — the §7o end line is the WINNER's cue.
- **LEDs**: in this app-derived config the LEDs slow-blink the team colour and never show HP; Tony reports the
  on-gun native games show life on the LEDs — a config token to find (FOLLOWUPS).
- Kill in 5 hits at 24 dmg from 45/70 (matches the sim).
- **Power-cycle WIPES the config** (E1 second half): after off/on, `$PHONE,*` alone wakes the gun (`$VERSION`
  answers — `$STOP` is not needed), and `$SPAWN,,*` echoes `$LCD,0,0,0,0,0,0` + `$ALCD,0,0,0,0,0` — a live gun
  with nothing loaded. That zeroed `$LCD` is the node's tell for "re-push the head". A power-cycled gun also
  needs its headset re-linked before BLE holds (connects then drops within ~1 s until the headset is back).

### 7r bench addendum — 2026-08-26 (handoff experiment 2): damage exact, armor model, `$HIR` tok2/tok7

Two guns, victim rebuilt to full 45/70 before each single shot (`mcp/tools/damage_bench.py`):

- **`$HIR` token 5 = the RAW magnitude carried in the IR word** (= the shooter's `$WEAP` `t5`), **not
  necessarily the applied damage.** ⚠ Refined 2026-08-26 (night, brx-ir emitter) — the **applied**
  damage is `magnitude × the victim's $SIR-function multiplier × (1 + $GSET t7/100 if the crit bit is
  set)`. ⚠️ Caveat added 2026-08-27: the crit term is **not a fixed ×1.5** (that is only t7=50).
  ✅ Settled 2026-09-02: the **fn 36 = floor(magnitude × 1.25) / fn 37 = magnitude × 2** multipliers
  are **CONFIRMED** (16 trials, 4 magnitudes, 8 row-tail shapes, fn 1 control in every trial; the
  ×1.25 truncates — 7 → 8), so the worked example `mag 20 @ fn 37 crit → 60` stands again. The
  2026-08-27 24-cell ×1.0 matrix is outvoted but still unexplained — see §5. Exp-2's 4-weapon
  read (AR `t5`=9 → armor −9; Shotgun `T01` 45 → −45; Sniper 80 → 70 absorbed +10 HP; Rocket 115 → kill)
  was **correct for what it tested** — all four key to `$SIR` **fn-1** rows (mult 1, crit 0) where raw ==
  applied — a scope limit found later, not an error. Where a multiplier row or crit is in play, tok5 ≠
  applied → **derive damage from the `$HP` delta, never tok5.** It does confirm the AR emits **9** — the
  manual's "M-4 = 24" was stale. (The 2026-08-25 "24 here" above was that day's 24-magnitude config.)
  Frames verbatim:
  `$HIR,4,0,5,1,9,0,0` · `$HIR,4,0,5,1,45,0,0` · `$HIR,4,0,5,1,80,0,1` (+ a gun-sensor variant
  `$HIR,0,…`) · `$HIR,4,10,5,1,115,0,0`. Kill-shot anomaly: the shotgun's fatal hit reported
  `$HIR,4,0,5,1,70,0,0` — `70` = the victim's *entire remaining pool*, i.e. an overkill/pool-clamped
  report on the killing blow, not `t5`.
- **Armor model pinned:** armor absorbs **1:1 first**, overflow **spills into HP**, **no per-hit cap**
  (the sniper's 80 split exactly 70/10). The old "~9/hit absorption" reading was just the AR dealing 9.
- **`$HIR` token 2 = the shooter's IR protocol** — `10` on the rocket (proto 10), `0` on standard
  weapons. Every prior "always 0" reading was standard-protocol-only traffic. **Token 7 = subtype
  echo** — the sniper's hit carried `…,1` (its subtype 1).
- **Operational (bench):** `$BMAP,0,0,,,,,*` is **required** or the trigger is dead; a **dead gun does
  not revive on `$SPAWN` alone** — a full cold start (`$CLEAR`→`$START`→…→`$SPAWN`) is needed; and a
  victim registers **non-standard IR only if its `$SIR` table has the matching protocol/subtype rows**
  — a single-row `$SIR,0,0` ignores the sniper's subtype-1 hit (the full 10-row captured `$SIR` table
  is in `damage_bench.py`).

## 8. Safe testing notes

- The tagger's stock firmware is untouched by all of this; power-cycling the tagger restores normal operation.
- Factory restore path: Battle Company's official USB updater.
- Recommended probe sequence: connect → `$PING,*` → await `$PONG` → read-only listen session (pull trigger, get tagged, watch `$BUT`/`$HIR`/`$HP` traffic) before sending any config.


### $HIR token 1 — sensor id map (SHIELD-ISOLATED, 2026-08-26)

`0` = headset FRONT dome · `1` = headset BACK dome · **`2` and `3` = the headset's other two sensors (it has FOUR — operator-confirmed 2026-09-01; positions unmapped)** · `4` = gun body sensor. Each isolated with every
other sensor covered; multiple clean hits per id. Supersedes the earlier "1=headset, 4/0=gun" guess
(1 is specifically the BACK dome). Point-blank shots flood multiple sensors — the reporting id then
reflects whichever receiver won, so directional logic should trust tok1 only at field distances.


### $WEAP t20 — FIRE MODE (PROVEN by one-field flip, 2026-08-26)

`0` full-auto · `7` single-shot/bolt · `9` burst (cycle in `t23`, ms) · `2` charge-auto-release (tap = weak shot) · `3` hold-to-charge auto-fire (tap = sound only, no discharge) · `14` tap-fire OR charge-release · `13` melee — ALL trigger-confirmed 2026-08-26. Proof: the
captured sniper frame fired single-shot at t20=7 and full-auto with ONLY t20 flipped to 0; the
captured Burst Rifle (t20=9, t23=275) fired exactly 3 rounds per pull. Correlated 19/19 with
capture-time behaviour notes (brx-opus2). Supersedes the "(secondary/overheat)" field-map guess —
overheat is t24/t35.


### Overheat + the $ALCD heat gauge (CONFIRMED 2026-08-26)

> **⚠ CORRECTED (same day, bench-proven):** t24/t35 are **INERT on their own** — three weapons carrying them (SMG, Energy Rifle, Plasma Sniper) never overheat as shipped. The mechanism is **enabled/parameterized by t37/t38** (Charge Rifle stock: t37=20, t38=150; transplanting them onto the SMG brought its dead heat gauge alive). t37-vs-t38 semantics still unmapped.

`$WEAP` t24 = heat added per shot (nonzero on SMG 5, Energy Rifle 6, Charge Rifle 14, Plasma Sniper 30);
t35 = the overheat sound. `$ALCD`'s LAST token is a live 0–100+ heat gauge — watched climbing ~8/shot
on the Charge Rifle, crossing 100 (overheat lockout) and decaying on idle. HUD heat bars need no new
protocol — the gauge already streams.
