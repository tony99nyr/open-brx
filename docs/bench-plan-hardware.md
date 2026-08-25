# Bench plan — IR + nRF hardware (arriving 2026-08-26)

Ready-to-run playbook for the incoming kit. Do the sessions in order; each has a **goal**, **wiring**,
**flash/run**, **expected output**, and a **pass/fail** line. Ground truth: `protocol/brx-ir-protocol.md`
(IR word), `hardware/ir-breadboard.svg` (wiring), `hardware/bench-shopping-list.md` (parts + power).

**Arriving:** ELEGOO 235-pc kit (breadboard/jumpers/2N2222/resistors/caps/LEDs) · CHANZON 940nm IR
(emitters + **VS1838B** receivers) · 2× **ESP32-S3-DevKitC-1** · Aideepen 3× **nRF24L01+PA/LNA** + 3×
adapter boards (overnight).

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
SHOT player=42 team=2 dmg=9 bullet=3 crit=0 parityOK=1
```
- **PASS (core):** `DECODE bits=25` and `parityOK=1` on clean shots, and the **green LED blinks** each shot.
- If `bits=26` or `parityOK=0` on every shot → the sync-strip threshold is off; check the first `us=[...]`
  value (should be ~2000) and adjust `SYNC_MIN_US` in the sketch. (This is exactly the bug the code review
  fixed — verify it's gone.)

**Field verification (B13 — do this to trust the decode):**
1. **Team:** fire from a red gun, then a blue gun → the `team=` field changes. Note which value = which team
   (reconcile with `$TID`: 1=blue, 2=yellow, 0=red — the IR encoding may differ; record the mapping).
2. **Weapon:** switch weapons on the gun, fire each → `bullet=` and/or `dmg=` change. Build the map.
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

**Goal (step 2 — exploratory, tap the BRX mesh):** the BRX gun's native `NRFhost/NRFslave` kill-confirm
mesh params are **unknown** (NRFL-Bases uses IR→gun + nRF only base-to-base, so its params are NOT the
gun's). Try: scan channels for gun-to-gun traffic during a native 2-gun game, or use nRF24 promiscuous
tricks (address `0x00AA`/`0x0055`, CRC off) to catch preambles. **Time-box to 30 min** — if nothing, log it;
this likely needs the Callsign BLE capture (below) or a proper 2.4 GHz sniffer. Don't over-invest.

---

## Parallel track (Mac + iPhone, no bench hardware): Callsign BLE capture

Independent of the above and higher-leverage for the nRF question: **does Callsign enable native nRF
peering over BLE?** Full procedure in `docs/handoff-callsign-nrf-capture.md` (iOS PacketLogger → diff the
app's game-start frames vs our `arm_test.py` sequence, hunting a channel/session/`$PB*` frame). If it does,
our BLE game could light up native feedback for free — settle this before committing to the nRF24 tap.

---

## Order of leverage (if bench time is short)
1. **Session 1 (IR capture + field decode)** — unlocks B13 + P2, uses only the IR kit. Highest value.
2. **Callsign BLE capture** (Mac/iPhone) — decides the whole nRF-over-BLE question, no hardware.
3. **Session 2 (IR emit)** — unlocks the Utility Box (B4).
4. **Session 4 (nRF)** — prove the radios; the gun-mesh tap is exploratory.

## What's already hardened & ready
- `ir_capture.ino` / `ir_emit.ino` — reviewed + fixed (sync strip + field decode; emit sync; no frame-long
  ISR lockout). Pins: RX GPIO4, TX GPIO5, status GPIO6.
- `brx_mcp/irbridge.py` — host-side capture + **field decoder** (`decode_word`/`pulses_to_bits`/`shot()`),
  unit-tested (`tests/test_irbridge.py`, part of the 324-test suite). Decodes captures offline, cross-checks
  the firmware.
- Bench tools: `arm_test.py` (synced multi-gun arm), `passive_listen.py` (silent BLE tap), `play_probe.py`
  ($PLAY audio) — stdout-hardened, argv-guarded.
