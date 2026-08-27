# Bench plan — IR + nRF hardware (✅ ARRIVED 2026-08-26)

> **⚠️ SUPERSEDED for session planning (2026-08-26 overnight).** Sessions 0, 1, 1½b/1½c and 2 are
> **DONE** — the toolchain works, the IR word is bench-verified (B13), U7 is closed, the U bits turned
> out to be the `$SIR` subtype, and a stock tagger **accepts fully synthetic shots from our emitter**
> (B4's gating proof). **For what to actually do next, use [`bench-tomorrow.md`](bench-tomorrow.md).**
> This file remains the reference for *how* to wire and flash the rig, and for the sessions still open:
> **1½a (U2 `t41` range)**, **1½d (crit flag in the wild)**, **3 (IR range walk-back)** and **4 (nRF)**.

> **Update 2026-08-25 — P2 is CLOSED over pure BLE** (`protocol/brx-protocol.md` §7p/§7q): `$PSET` token 1 sets the gun's player id (0–63) and `$HIR` token 3 reports the shooter's id on every hit, bench-verified both directions. No USB `SETUP`, no IR receiver needed for per-player attribution. References to P2 below are historical.

Ready-to-run playbook for the incoming kit. Do the sessions in order; each has a **goal**, **wiring**,
**flash/run**, **expected output**, and a **pass/fail** line. Ground truth: `protocol/brx-ir-protocol.md`
(IR word), `hardware/ir-breadboard.svg` (wiring), `hardware/bench-shopping-list.md` (parts + power).

**✅ In hand (2026-08-26, unopened at time of writing):** ELEGOO 235-pc kit
(breadboard/jumpers/2N2222/resistors/caps/LEDs) · CHANZON 940nm IR (emitters + **VS1838B** receivers) ·
2× **ESP32-S3-DevKitC-1** · Aideepen 3× **nRF24L01+PA/LNA** + 3× adapter boards.
**Unbox check before Session 0:** confirm the CHANZON pack really contains the **VS1838B/HX1838 38 kHz
demodulating** receivers (they sit next to bare 940 nm photodiode receivers in the same bag and look
similar — only the 3-pin demodulator works with `ir_capture.ino`), and that both ESP32-S3 boards are
DevKitC-1 (two USB-C ports: use the one silkscreened **UART**).

**Safety / mandates:** never modify stock BRX firmware. Panic on any tagger: `$CLEAR,*` then `$SP,99,*`.
Headsets **ON** or guns won't join (§7m). Volume **69** for real games. Keep headset PINs out of the repo.

---

## Session 0 — toolchain + smoke test (~15 min)  · needs: 1 ESP32-S3

**Goal:** each ESP32-S3 flashes and talks serial.
1. Arduino IDE → install **esp32 by Espressif v3.x** (the sketches use the v3.x `ledcAttach` API).
   For the nRF work later, also add the **RF24** library (TMRh20).
2. Board: *ESP32S3 Dev Module*. Plug USB-C into the board's **`UART`** port. Pick the serial port.
3. Flash `hardware/esp32-ir-bridge/ir_capture.ino`. Open Serial Monitor @ **115200**.
- **Expect:** `# BRX IR capture ready (ESP32-S3, VS1838B on GPIO4).`
- **PASS:** banner prints on both boards. If no port: try the other USB-C port / hold BOOT while plugging.

---

## Session 1 — IR CAPTURE (the key session) (~45 min)  · needs: ESP32-S3 + VS1838B + breadboard

**Goal:** capture and field-decode a real BRX shot; confirm it matches `brx-ir-protocol.md`.

**Wire** (see `hardware/ir-breadboard.svg`):
- VS1838B: `OUT`→**GPIO4**, `VCC`→**3V3**, `GND`→**GND**. 0.1 µF across VCC/GND (ELEGOO kit).
- Status LED: **GPIO6** → 220 Ω → LED → GND (use a **green** LED for the RX board). Blinks on each frame.

**Run:** flash `ir_capture.ino` (already on from Session 0). Point a tagger (headset on, in a game or
just powered) at the VS1838B from ~1 m and **fire**.

**Expect** per shot (three lines):
```
RAW 1 edges=52 us=[2000,500,1000,500,500,500, ... ]
DECODE bits=25 val=0011101010100000100100001
SHOT player=42 team=2 dmg=9 proto=3 crit=0 parityOK=1
```
- **PASS (core):** `DECODE bits=25` and `parityOK=1` on clean shots, and the **green LED blinks** each shot.
- If `bits=26` or `parityOK=0` on every shot → the sync-strip threshold is off; check the first `us=[...]`
  value (should be ~2000) and adjust `SYNC_MIN_US` in the sketch. (This is exactly the bug the code review
  fixed — verify it's gone.)

**Field verification (B13 — do this to trust the decode):**
1. **Team:** fire from a red gun, then a blue gun → the `team=` field changes. Note which value = which team
   (reconcile with `$TID`: 1=blue, 2=yellow, 0=red — the IR encoding may differ; record the mapping).
2. **Weapon:** switch weapons on the gun, fire each → `proto=` and/or `dmg=` change. Build the map.
3. **Player id (P2):** the `player=` field is a **6-bit shooter id**. It only varies if guns have **distinct
   ids** — set them first via the USB `SETUP` console (see `brx-protocol.md` §7c; QUERY `PlayerID` reads 0
   by default). Fire from two differently-id'd guns → `player=` differs. **This is the per-player
   attribution win** — record it in the experiment log.
4. **Capture to file + decode offline:** `python -m brx_mcp ir-capture <port> 15` (fire during the window).
   The host-side decoder (`brx_mcp.irbridge`: `IRFrame.shot()`, `decode_word`, `pulses_to_bits`) decodes the
   same fields from the raw pulses — cross-check it agrees with the ESP32's `SHOT` line.

**Deliverable:** append to `docs/experiment-log.md` — the field map (which bits are team/weapon/player/dmg),
and whether player-id decodes per-gun. Update `protocol/brx-ir-protocol.md` if the bench differs from source.

---

## Session 1½ — THE RECEIVER AS AN INSTRUMENT (~25 min) · needs: Session 1 rig, ONE gun

**Why this session exists (added 2026-08-26, after the kit landed):** every contaminated bench result
we have came from the **victim gun** — screamer degradation, arming races, re-setup windows (U2 died
exactly this way; see exp-log "U2 attempt CONTAMINATED"). A VS1838B on an ESP32 can't scream, can't
half-arm, and reports a hard count. **Wherever the question is "what did the SHOOTER emit", use the
receiver, not a second tagger.** Same rig as Session 1, no rewiring.

**1½a — U2: does `t41` change emitted range?** (supersedes the fresh-fleet two-gun A/B in FOLLOWUPS)
- Tape-mark ONE spot at a measured distance. Receiver fixed, gun at the mark, same aim both legs.
- Push the sniper frame with `t41=100`; `python -m brx_mcp ir-range <port> 12 10` → record detect% / decode%.
- Re-push identical frame with **only** `t41=5`; same spot, same count. Re-push `t41=100` as a closing
  control (the control leg is the whole point — it is what would have caught the last rig degradation).
- **PASS:** detect% differs materially between legs with the bracketing controls agreeing. **NULL:**
  all three legs equal → `t41` does not drive emitted IR range (a real, publishable answer too).

**1½b — U7: the damage ceiling.** Read the `D8` field directly off the wire across AR (9) / shotgun
(45) / sniper (80) / rocket (115). Confirms the 8-bit field and whether a >115 value is even emittable
(caps any future double-damage powerup). **PASS:** `dmg=` tracks `$WEAP` t5 exactly, as BLE `$HIR` tok5 does.

**1½c — where does the IR *protocol type* live?** BLE `$HIR` tok2 carries it (0 standard, 10 rocket,
11 gas, 13 melee — §7r). The decoded word (`brx-ir-protocol.md`) has a 4-bit **B** (now known: the IR protocol / DamageType) and
2 unknown **U** bits. Fire each of those weapon types at the receiver and watch which bits move.
*(Answered 2026-08-26: the U bits are the `$SIR` **subtype**, so B+U form the table's composite key.)*

**1½d — is the crit flag ever set?** We have never observed a crit on the BLE side. Fire everything,
watch `crit=`. Cheap; either it is dead in stock play or we just found a mechanic.

**Deliverable:** one exp-log entry closing U2 + U7 and naming the protocol-type bits.

---

## Session 2 — IR EMIT / replay (~30 min)  · needs: 2nd ESP32-S3 + IR LED + 2N2222

**Goal:** replay a captured word and make a stock gun react — the Utility Box emit side.

**Wire** (second board): **GPIO5** → 330 Ω → 2N2222 base; IR LED anode → 3V3 via 100 Ω → collector;
emitter → GND. Status LED on **GPIO6** (use a **red** LED for the TX board).

**Run:** flash `ir_emit.ino`. `PING`→`PONG` to confirm. Then emit a word captured in Session 1:
`python -m brx_mcp ir-emit <port> <25-bit-string>` (or type `TX <bits>` in the monitor).
- Point the IR LED at a tagger's headset. Watch that tagger over BLE (`python passive_listen.py <addr>` or
  the mcp listen) for a `$HIR`/`$HP` reaction.
- **PASS:** the gun registers a hit (`$HIR` appears / `$HP` drops), and the red TX LED lights per frame.
- If no reaction: the **2 ms sync** must lead the frame (`START_MARK=2000` — the review fixed this); then
  tune `MARK_ONE/MARK_ZERO/BIT_SPACE` to the exact microseconds Session 1 recorded. 940 nm should trigger
  the (wideband 38 kHz) receiver; if range is poor, drive the LED harder / move closer.

---

## Session 3 — IR RANGE (optional, ~20 min)  · needs: Session 1 rig + tape measure

Walk-back per `hardware/range-experiment.md`: `python -m brx_mcp ir-range <port> 12 10` at set distances →
reports **detect%** (did the shot reach) and **decode%** (signal clean enough for 25 bits). Tabulate per
distance. Establishes effective IR range for the Utility Box / station placement.

---

## Session 4 — nRF24 bring-up (when Aideepen arrives) (~45 min)  · needs: 2× ESP32-S3 + 2× nRF24+adapter

**Goal (step 1 — prove the radios):** get two ESP32-S3 + nRF24 talking to each other. Do NOT skip to
sniffing the gun before the radios themselves work.

**Wire** (each board, nRF24 via its **adapter**; power the adapter from **5V/VIN**, not 3V3):
`SCK`→GPIO12, `MISO`→GPIO13, `MOSI`→GPIO11, `CSN`→GPIO10, `CE`→GPIO9, `IRQ`→GPIO14, adapter `VCC`→5V, `GND`→GND.
(Avoid GPIO 26–37 on N16R8.) Reference params from NRFL-Bases: **1 Mbps, ackPayload, 5-byte addresses,
channel 76 (RF24 default), CE/CSN as wired.**

**Run:** a stock RF24 `GettingStarted` ping/pong sketch (one TX, one RX, address `"1Node"/"2Node"`).
- **PASS:** ping/pong round-trips. Brownout/no-link → the adapter power (5V) and antenna seating are the
  usual causes. This proves our nRF24 stack works before we chase the gun's mesh.

**Goal (step 2 — exploratory, tap the BRX mesh — now ONLY for per-player attribution P2):** feedback no
longer needs this (it's BLE-drivable via `$SFLASH`, §7o) — the only remaining reason to tap the mesh is to
learn **who** shot (the shot's 6-bit player id), which BLE `$HIR` gives only at team granularity. The gun's
native `NRFhost/NRFslave` params are **unknown** (NRFL-Bases uses IR→gun + nRF only base-to-base). Try:
scan channels during a native 2-gun game, or nRF24 promiscuous tricks (address `0x00AA`/`0x0055`, CRC off)
to catch preambles. **Time-box to 30 min** — and note the IR shot *also* carries the player id (Session 1),
a cheaper P2 path. Don't over-invest.

---

## ✅ Callsign BLE capture — RESOLVED 2026-08-25 (was a parallel Mac/iPhone track)

Done — see `protocol/brx-protocol.md` §7o. **There is no nRF-enable
frame** (the app's arm is byte-identical to ours). Instead the app **scores on the phone and drives the
feedback over plain BLE**: per kill it sends **`$SFLASH,*`** (green-sight flash) + **`$PLAY,,4,6,V3A,,,,*`**
(kill line, token-4 announcer slot) + a lead-change score line. So **BLE reaches the whole feedback layer
— visual included** — and MC (which connects to *every* gun) is structurally better placed than the app
(one phone per gun). `KillAnnouncer` (B18) emits these. The nRF24 tap is **no longer needed for feedback**
— only for per-player attribution (P2).

---

## Order of leverage (revised 2026-08-26, kit in hand)

P2 is closed and feedback is BLE-native, so the *reasons* below are not the ones this plan was
originally written with. Current ranking:

1. **Session 0 + 1 (smoke test + IR capture)** — B13 is decoded from LaserTagMods source but has never
   been seen on our own bench; nothing downstream (emit, stations) is trustworthy until it is.
2. **Session 1½ (receiver as instrument)** — closes **U2** and **U7** and names the protocol-type bits,
   using one gun and no victim tagger. Highest answers-per-minute on the whole board right now.
3. **Session 2 (IR emit)** — **the prize.** With the grenade proven sealed (G7 USB-C is power-only,
   G8 `$GREN` objective-drive negative), an emitter we control is the *only* route to objective
   stations, respawn stations, pickups, and the medic/EMP emitters — i.e. all of B4 and the
   special-weapons tier.
4. **Session 3 (IR range walk-back)** — station placement numbers; do it once the emit side works.
5. **Session 4 step 1 (nRF ping/pong)** — proves our RF24 stack, ~30 min, worth banking.
6. **Session 4 step 2 (tap the gun mesh)** — D1/D4, the multikill kill-confirm. Unknown
   channel/address/CRC/rate: a lottery ticket. **Time-box 30 min and walk away.** Highest-upside
   unknown left, but on no critical path.

## What's already hardened & ready
- `ir_capture.ino` / `ir_emit.ino` — reviewed + fixed (sync strip + field decode; emit sync; no frame-long
  ISR lockout). Pins: RX GPIO4, TX GPIO5, status GPIO6.
- `brx_mcp/irbridge.py` — host-side capture + **field decoder** (`decode_word`/`pulses_to_bits`/`shot()`),
  unit-tested (`tests/test_irbridge.py`, part of the 324-test suite). Decodes captures offline, cross-checks
  the firmware.
- Bench tools: `arm_test.py` (synced multi-gun arm), `passive_listen.py` (silent BLE tap), `play_probe.py`
  ($PLAY audio) — stdout-hardened, argv-guarded.
