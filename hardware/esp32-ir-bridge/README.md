# ESP32-S3 IR bridge — capture (and later emit) BRX IR

The IR capture/emit rig (the plan it grew from is archived at `docs/archive/hardware/ir-prototype-plan.md`;
its three phases are done: capture, emit, and the `$SIR` effect sweep) and the eventual Claude↔hardware bridge for
the `diag-game` block in `docs/manual/06-developer.md` (`diag-game ir`). Sketch(es) here are Arduino-IDE / arduino-esp32.

## Parts (the ordered kit)
- **ESP32-S3-DevKitC-1** (WROOM-1-N16R8) — 16 MB flash / 8 MB PSRAM.
- **VS1838B** 38 kHz IR receiver (CHANZON kit) — capture.
- **940 nm IR LED** + an NPN transistor (2N2222, from the ELEGOO kit) — emit (Phase B).
- Breadboard + jumpers + a 0.1 µF cap (ELEGOO kit).

## Two kit traps (carried from the 2026-08-26 unboxing)

1. **The CHANZON bag holds TWO different black receivers.** `IR LED Diode Kit BA0008x20` = 10× 5 mm emitter
   (clear, 940 nm, 45°) · **5× bare 5 mm IR *receiver* photodiode (black, 940 nm, 30°, 2 legs)** · **5× VS1838B
   (black, 3–5 V, 70°, 3 legs)**. Only the **3-leg VS1838B** demodulates the 38 kHz carrier; the 2-leg photodiode
   produces nothing with `ir_capture.ino`. Count legs, not colour.
2. **The VS1838B pinout is easy to mirror.** Domed face toward you, legs down: **OUT · GND · VCC, left → right**.
   The bag label lists the pins in the opposite reading order (VCC/GND/OUT), which invites a 180° mistake, and
   swapping VCC/GND kills the part.

Board notes: the ESP32-S3 DevKitC-1 (WROOM-1-N16R8) has two USB-C ports; flash via the **UART** one (see the
board registry at the end). Sketch pins RX 4 / TX 5 / status 6 are clear of the octal-PSRAM pins (33–37).

## nRF24 adapter wiring (if an nRF24L01+PA/LNA is ever added; exploratory, off the critical path)

Power the **HW-200 breakout** (AMS1117-3.3) from the ESP32 `5V`/`VIN` pin, never 3V3 (the regulator needs
headroom) and never 5 V to a bare module. SPI on the S3 (avoid GPIO 26–37): `SCK`→GPIO12, `MISO`→GPIO13,
`MOSI`→GPIO11, `CSN`→GPIO10, `CE`→GPIO9, `IRQ`→GPIO14, adapter `VCC`→5V, `GND`→GND. Reference params from
LaserTagMods' NRFL-Bases: 1 Mbps, ackPayload, 5-byte addresses, channel 76 (RF24 default). Prove two boards
with a stock RF24 `GettingStarted` ping/pong before chasing the gun's `NRFhost`/`NRFslave` mesh, whose params
are unknown. The purchase record (Aideepen 3-pack + adapters, arrived 2026-08-26) is in
`docs/archive/hardware/bench-shopping-list.md`.

## No soldering
Everything is **breadboard + jumpers** — the VS1838B (3 pins), IR LED (2 pins), and transistor
(3 pins) push straight into the breadboard. *Only* exception: if your ESP32-S3 2-pack shipped with
**loose pin headers** (some budget packs do), solder those to the board first (~16 joints, 15 min);
many DevKitC-1s come pre-soldered.

## VS1838B pinout (look at the FLAT/domed face, legs down)
```
   ___
  /   \      Pin 1 = OUT (signal)
 | () |      Pin 2 = GND
 |____|      Pin 3 = VCC (3V3)
 | | |
 1 2 3       (left→right, bulge facing you. If unsure, check your kit's datasheet —
             some VS1838B are OUT-GND-VCC, others differ.)
```

## Breadboard — `ir_capture.ino` (Phase A, CAPTURE)  ← wire this first

```
  ESP32-S3                         VS1838B (IR receiver)
 ┌─────────┐                      ┌──────────┐
 │   3V3 ●─┼──────────────────────┤ VCC (3)  │
 │   GND ●─┼───────┬──────────────┤ GND (2)  │
 │ GPIO4 ●─┼───────┼──────────────┤ OUT (1)  │
 │         │       │              └──────────┘
 │ GPIO6 ●─┼──[330Ω]──►│──┐   ← visible "RX" LED (blinks ~40 ms on each frame received)
 │   GND ●─┼────────────────┘        (anode to resistor, cathode to GND)
 └─────────┘       │   0.1 µF cap
                   └───┤├──── (other leg to VCC rail)   ← optional, reduces noise
```
The whole capture rig: **3 jumpers** (3V3, GND, GPIO4→OUT) + a **visible RX-indicator LED** on GPIO6
(GPIO6 → 330 Ω → LED anode, cathode → GND) + an optional decoupling cap. Point the VS1838B's domed
face at the gun/grenade — **the GPIO6 LED blinks every time a frame is decoded**, so you get instant
feedback even before reading the serial output.

## Flash it
1. Arduino IDE → Boards Manager → install **esp32 by Espressif** (v3.x).
2. Board: **ESP32S3 Dev Module**. Enable **USB CDC On Boot** (so Serial works over the native
   USB port). PSRAM: OPI (for N16R8).
3. Plug the S3 in. **Two USB ports** on the DevKitC-1 — try the one that enumerates a serial port;
   if upload fails, **hold BOOT, tap RESET, release BOOT**, then upload.
4. Open Serial Monitor @ **115200**.

## Use it
Fire a stock gun (or trigger a grenade) at the VS1838B. Each frame prints:
```
RAW <n> edges=<k> us=[d1,d2,d3,...]      # raw mark/space durations
DECODE bits=<b> val=<25-bit string>       # long mark(~1000us)=1, short(~500us)=0
```
Sweep every **weapon** (`$WEAP`), **team** (`$TID`), and **grenade mode** (Hill/Respawn beacon,
Assault/CTF capture) — log each `val`. **Diff the bit strings** to find which bits carry
type / team / mode / damage. That table **is followup B13** and unblocks the Utility Box emit side.

## Notes / tuning
- The VS1838B is **active-low** (idles HIGH, pulls LOW on carrier). The sketch times edges and takes
  the LOW durations as marks.
- If decode looks off, tune `MARK_THRESH_US` (default 750 µs — halfway between the known 500/1000 µs).
- `micros()` edge timing is framework-light and transparent — ideal for RE. A later revision can move
  to the RMT peripheral for tighter timing + TX.

## Breadboard — `ir_emit.ino` (Phase B, EMIT)  ← add this after capture works

Drive the 940 nm IR LED through the transistor (from the ELEGOO kit) for real range. The IR LED
is **invisible** — to check it's firing, view it through a **phone camera** (you'll see it flash).

```
  ESP32-S3                2N2222 (NPN, flat face toward you: E B C)
 ┌─────────┐                 │ │ │
 │ GPIO5 ●─┼──[330Ω]─────────┘ │ └────────────┐   collector
 │   GND ●─┼───────────────────┘              │
 └─────────┘                 emitter          │
                                              │
        +3V3 (or +5V breadboard rail) ──[100Ω]┴──►│─── IR LED ───┘
                                                (anode)   (cathode → collector)
```
- **GPIO5 → 330 Ω → base**; **emitter → GND**; **collector → IR-LED cathode**;
  **IR-LED anode → 100 Ω → +3V3/+5V rail**.
- **Visible "TX" LED (same as capture):** **GPIO6 → 330 Ω → visible-LED anode, cathode → GND.**
  The firmware lights it solid for ~40 ms on every frame it emits — so you *see* each transmission
  (and can still confirm the invisible IR LED itself via a phone camera).
- 2N2222 pinout (TO-92, flat side facing you, legs down): **E–B–C** left→right (verify on your kit —
  some are E-B-C, the PN2222A in the ELEGOO kit is too).
- Use the **breadboard power module** (from the kit) for the +5V rail if you want more LED range;
  the ESP32's 3V3 works at shorter range.

## Serial command protocol (what the MCP tools speak)
- **capture firmware** streams: `RAW <n> edges=<k> us=[d1,d2,…]` then `DECODE bits=<b> val=<bits>`.
- **emit firmware** accepts: `TX <bits>`, `TXN <n> <bits>`, `PING`→`PONG`.

Drive it from the repo (Windows Python, where pyserial + the COM port live):
```
python -m brx_mcp ir-capture [port] [seconds]      # auto-detects the ESP32 port
python -m brx_mcp ir-emit <bits> [port] [repeat]
```
`ir-capture` prints each decoded frame and **diffs distinct words** (surfaces the type/team/mode
bits). These are the same calls the `diag-game ir` cases use once the bridge is present.

## Next
- Tune `ir_emit.ino`'s `MARK_ONE/MARK_ZERO/BIT_SPACE/START_*` to the timings `ir-capture` recorded,
  then emit a captured "hit" and confirm a stock gun reports `$HIR` (Phase B).
- Wire the two `ir.*` diagnostic cases (`diag/cases.py`) to call `IRBridge` so `diag-game <addr> ir`
  runs capture+emit as scored tests.

## Board registry — which ESP32-S3 is which (2026-08-26)

COM numbers move around; the **CH343 bridge chip serial does not**. Identify a board with:

```bash
powershell.exe -NoProfile -Command "Get-CimInstance Win32_PnPEntity | Where-Object { \$_.Name -match 'COM\d+' } | Select-Object Name, DeviceID | Format-List"
```

| Board | CH343 chip serial | Role | Sketch | Wiring | Seen as |
|---|---|---|---|---|---|
| **A** | `5C93045958` | **RECEIVER** | `ir_capture.ino` | VS1838B: OUT→**GPIO4**, GND→GND, VCC→3V3 | COM7 |
| **B** | `5C4C136487` | **EMITTER** | `ir_emit.ino` | GPIO**5**→330Ω→2N2222A base · 3V3→100Ω→IR-LED anode · LED cathode→collector · emitter→GND | COM8 |

**Always flash via the `UART` USB-C port**, which enumerates as `USB-Enhanced-SERIAL CH343`
(`VID_1A86&PID_55D3`). The *other* port is the S3's **native USB** (`VID_303A&PID_4001`) and is a trap:
it enumerates from ROM whether or not the sketch uses it, so the port appears healthy while
`Serial` is actually bound to UART0 and nothing answers. Symptom seen on this bench: a `PING` to the
native port returned 6 bytes of junk (`50%B`) instead of the `# BRX IR emit ready` banner. Using the
native port requires **Tools → USB CDC On Boot → Enabled**; simpler to just use UART.

**Windows serial ports are exclusive** — close the Arduino Serial Monitor before any `brx_mcp`
capture/emit, or it fails with `PermissionError(13, 'Access is denied.')`.
